"""WebSocket (and optional MQTT) ingestion for pose keypoint frames.

The primary transport is a WebSocket connection to the Pi Zero 2W publisher.
An optional MQTT path is activated when the ``MQTT_BROKER`` environment
variable is set.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import AsyncGenerator

import websockets
from websockets.exceptions import ConnectionClosed

from .pose import PoseFrame, from_json

logger = logging.getLogger(__name__)

# Reconnection back-off parameters.
_BACKOFF_BASE: float = 1.0   # seconds
_BACKOFF_MAX: float = 60.0   # seconds
_BACKOFF_FACTOR: float = 2.0


class PoseStream:
    """Async iterable that yields :class:`~pose.PoseFrame` objects.

    Supports two transports:

    * **WebSocket** — primary, always active.
    * **MQTT** — optional, enabled by setting the ``MQTT_BROKER`` environment
      variable.  Frames received on MQTT are merged into the same async queue
      so callers only need to consume :meth:`frames`.

    Example::

        stream = PoseStream()
        async for frame in stream.frames("ws://pi-zero-ai.local:8765"):
            process(frame)
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[PoseFrame] = asyncio.Queue(maxsize=64)
        self._mqtt_task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def frames(self, uri: str) -> AsyncGenerator[PoseFrame, None]:
        """Yield pose frames from the given WebSocket URI.

        Reconnects automatically with exponential back-off on failure.
        MQTT ingestion (if configured) runs as a background task and feeds
        into the same queue.

        Args:
            uri: WebSocket endpoint, e.g. ``ws://pi-zero-ai.local:8765``.

        Yields:
            :class:`~pose.PoseFrame` objects as they arrive.
        """
        mqtt_broker = os.environ.get("MQTT_BROKER")
        if mqtt_broker:
            self._mqtt_task = asyncio.create_task(
                self._run_mqtt(mqtt_broker), name="mqtt-ingest"
            )

        try:
            async for frame in self._run_ws(uri):
                yield frame
        finally:
            if self._mqtt_task is not None:
                self._mqtt_task.cancel()
                try:
                    await self._mqtt_task
                except asyncio.CancelledError:
                    pass

    # ------------------------------------------------------------------
    # WebSocket transport
    # ------------------------------------------------------------------

    async def _run_ws(self, uri: str) -> AsyncGenerator[PoseFrame, None]:
        """Connect to *uri* and yield frames; reconnect on failure.

        Args:
            uri: WebSocket server address.

        Yields:
            Parsed :class:`~pose.PoseFrame` objects.
        """
        delay = _BACKOFF_BASE
        while True:
            try:
                logger.info("Connecting to WebSocket %s", uri)
                async with websockets.connect(
                    uri,
                    open_timeout=10,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    logger.info("WebSocket connected.")
                    delay = _BACKOFF_BASE  # Reset back-off on success.
                    async for raw in ws:
                        frame = self._parse(raw)
                        if frame is not None:
                            yield frame

            except ConnectionClosed as exc:
                logger.warning("WebSocket closed: %s. Reconnecting in %.1fs.", exc, delay)
            except OSError as exc:
                logger.warning("WebSocket OS error: %s. Reconnecting in %.1fs.", exc, delay)
            except Exception as exc:  # noqa: BLE001
                logger.error("Unexpected WebSocket error: %s. Reconnecting in %.1fs.", exc, delay)

            await asyncio.sleep(delay)
            delay = min(delay * _BACKOFF_FACTOR, _BACKOFF_MAX)

    # ------------------------------------------------------------------
    # MQTT transport (optional)
    # ------------------------------------------------------------------

    async def _run_mqtt(self, broker: str) -> None:
        """Subscribe to the MQTT pose topic and push frames into the queue.

        This runs as a background task.  Frames are placed in
        :attr:`_queue`; callers retrieve them via a parallel consumer
        (not yet wired into :meth:`frames` — the queue is available for
        future integration).

        Args:
            broker: MQTT broker hostname or IP address.
        """
        mqtt_port = int(os.environ.get("MQTT_PORT", 1883))
        mqtt_topic = os.environ.get("MQTT_TOPIC", "fitness/pose")

        try:
            import paho.mqtt.client as mqtt  # type: ignore[import]
        except ImportError:
            logger.error("paho-mqtt is not installed; MQTT ingestion disabled.")
            return

        loop = asyncio.get_running_loop()

        def on_message(
            client: mqtt.Client,
            userdata: object,
            msg: mqtt.MQTTMessage,
        ) -> None:
            try:
                payload = json.loads(msg.payload.decode())
                frame = from_json(payload)
                # Thread-safe enqueue into the asyncio event loop.
                loop.call_soon_threadsafe(self._queue.put_nowait, frame)
            except Exception as exc:  # noqa: BLE001
                logger.warning("MQTT parse error: %s", exc)

        client = mqtt.Client()
        client.on_message = on_message

        try:
            client.connect(broker, mqtt_port)
            client.subscribe(mqtt_topic)
            logger.info("MQTT connected to %s:%d, topic=%s", broker, mqtt_port, mqtt_topic)

            # Run the blocking network loop in a thread executor.
            await loop.run_in_executor(None, client.loop_forever)
        except Exception as exc:  # noqa: BLE001
            logger.error("MQTT error: %s", exc)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse(raw: str | bytes) -> PoseFrame | None:
        """Decode a raw WebSocket message into a PoseFrame.

        Args:
            raw: JSON string or bytes from the WebSocket.

        Returns:
            Parsed frame, or None if parsing fails.
        """
        try:
            data = json.loads(raw)
            return from_json(data)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Frame parse error: %s", exc)
            return None
