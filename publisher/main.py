"""IMX500 Pose Publisher — Pi Zero 2W headless WebSocket server.

Captures pose keypoints from the IMX500 AI Camera using on-chip PoseNet /
HigherHRNet inference via picamera2, then broadcasts the data over a WebSocket
server and optionally publishes to an MQTT broker.

Usage:
    python3 main.py

Environment variables (see config.py):
    WS_PORT, MQTT_BROKER, MQTT_PORT, MQTT_TOPIC,
    CAMERA_WIDTH, CAMERA_HEIGHT, FRAMERATE, SCORE_THRESHOLD
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from typing import Any, Optional

import websockets
from websockets.server import WebSocketServerProtocol

from config import Config

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("pose_publisher")

# ---------------------------------------------------------------------------
# COCO keypoint names for HigherHRNet (17 keypoints, same as COCO standard)
# ---------------------------------------------------------------------------

COCO_KEYPOINT_NAMES: list[str] = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]

# Model preference: HigherHRNet (more accurate) then PoseNet fallback
_MODEL_CANDIDATES = [
    "/usr/share/imx500-models/imx500_network_higherhrnet_coco.rpk",
    "/usr/share/imx500-models/imx500_network_posenet.rpk",
]


def _select_model() -> str:
    """Return the path of the first available pose model.

    Returns:
        Absolute path to an .rpk model file.

    Raises:
        FileNotFoundError: If no supported model is found.
    """
    for path in _MODEL_CANDIDATES:
        if os.path.exists(path):
            log.info("Using model: %s", path)
            return path
    raise FileNotFoundError(
        "No IMX500 pose model found. "
        "Install imx500-all: sudo apt install -y imx500-all"
    )


# ---------------------------------------------------------------------------
# Camera / inference setup
# ---------------------------------------------------------------------------

def _setup_camera(cfg: Config):
    """Initialise picamera2 with IMX500 and configure for headless pose capture.

    Args:
        cfg: Publisher configuration.

    Returns:
        Tuple of (Picamera2 instance, IMX500 instance).
    """
    from picamera2 import Picamera2
    from picamera2.devices.imx500 import IMX500

    model_path = _select_model()
    imx500 = IMX500(model_path)

    picam2 = Picamera2(imx500.camera_num)
    camera_cfg = picam2.create_preview_configuration(
        main={"size": (cfg.CAMERA_WIDTH, cfg.CAMERA_HEIGHT)},
        controls={"FrameRate": cfg.FRAMERATE},
        buffer_count=6,
    )
    picam2.configure(camera_cfg)
    # No display — run headless
    picam2.start(show_preview=False)
    log.info(
        "Camera started: %dx%d @ %dfps",
        cfg.CAMERA_WIDTH,
        cfg.CAMERA_HEIGHT,
        cfg.FRAMERATE,
    )
    return picam2, imx500


def _parse_higherhrnet(outputs: Any, cfg: Config) -> list[dict[str, Any]]:
    """Extract keypoints from HigherHRNet raw outputs.

    HigherHRNet returns heatmaps that the picamera2 postprocess helper
    converts to (x, y, score) arrays shaped (N_persons, 17, 3).

    Args:
        outputs: Raw IMX500 tensor outputs.
        cfg: Publisher configuration (for score threshold).

    Returns:
        List of keypoint dicts with keys: name, x, y, score.
        Only keypoints above cfg.SCORE_THRESHOLD are included.
    """
    try:
        from picamera2.devices.imx500.postprocess_highernet import (
            postprocess_higherhrnet,
        )
    except ImportError:
        log.warning("postprocess_highernet not available, falling back to raw parse")
        return _parse_posenet_raw(outputs, cfg)

    # postprocess_higherhrnet returns list of person dicts or ndarray
    try:
        results = postprocess_higherhrnet(outputs)
    except Exception as exc:
        log.debug("postprocess_higherhrnet error: %s", exc)
        return []

    if results is None:
        return []

    import numpy as np

    # results may be a numpy array shape (N, 17, 3) or a list of such arrays
    if isinstance(results, np.ndarray):
        persons = results
    elif isinstance(results, (list, tuple)) and len(results) > 0:
        # Take first person for single-person fitness use-case
        persons = np.array(results)
    else:
        return []

    if persons.ndim == 2:
        # Single person: (17, 3)
        persons = persons[np.newaxis, ...]

    if persons.shape[0] == 0:
        return []

    # Use the highest-confidence person
    person_scores = persons[:, :, 2].mean(axis=1)
    best_idx = int(np.argmax(person_scores))
    kps = persons[best_idx]  # (17, 3) — x, y, score (normalised 0..1)

    keypoints: list[dict[str, Any]] = []
    for i, name in enumerate(COCO_KEYPOINT_NAMES):
        x, y, score = float(kps[i, 0]), float(kps[i, 1]), float(kps[i, 2])
        if score >= cfg.SCORE_THRESHOLD:
            keypoints.append({"name": name, "x": round(x, 4), "y": round(y, 4), "score": round(score, 4)})

    return keypoints


def _parse_posenet_raw(outputs: Any, cfg: Config) -> list[dict[str, Any]]:
    """Fallback parser for raw PoseNet / HigherHRNet outputs as flat arrays.

    When the postprocess helper is unavailable this attempts a best-effort
    parse of the first output tensor, which for many IMX500 pose models is
    a flat array of (y, x, score) triplets for each keypoint.

    Args:
        outputs: Raw IMX500 tensor outputs (list of numpy arrays).
        cfg: Publisher configuration (for score threshold).

    Returns:
        List of keypoint dicts, possibly empty on failure.
    """
    import numpy as np

    try:
        if outputs is None or len(outputs) == 0:
            return []
        tensor = np.array(outputs[0]).flatten()
        n_kps = len(COCO_KEYPOINT_NAMES)
        # Expect at least n_kps * 3 values
        if tensor.size < n_kps * 3:
            return []
        keypoints: list[dict[str, Any]] = []
        for i, name in enumerate(COCO_KEYPOINT_NAMES):
            base = i * 3
            y, x, score = float(tensor[base]), float(tensor[base + 1]), float(tensor[base + 2])
            if score >= cfg.SCORE_THRESHOLD:
                keypoints.append({"name": name, "x": round(x, 4), "y": round(y, 4), "score": round(score, 4)})
        return keypoints
    except Exception as exc:
        log.debug("Raw keypoint parse failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# MQTT (optional)
# ---------------------------------------------------------------------------

def _build_mqtt_client(cfg: Config):
    """Create and connect an MQTT client if MQTT_BROKER is configured.

    Args:
        cfg: Publisher configuration.

    Returns:
        Connected paho MQTT Client instance, or None if MQTT is disabled.
    """
    if not cfg.MQTT_BROKER:
        return None
    try:
        import paho.mqtt.client as mqtt

        client = mqtt.Client(client_id="pose-publisher", clean_session=True)
        client.connect(cfg.MQTT_BROKER, cfg.MQTT_PORT, keepalive=60)
        client.loop_start()
        log.info("MQTT connected: %s:%d", cfg.MQTT_BROKER, cfg.MQTT_PORT)
        return client
    except Exception as exc:
        log.warning("MQTT connect failed (%s) — MQTT disabled", exc)
        return None


# ---------------------------------------------------------------------------
# Frame producer (sync, runs in executor)
# ---------------------------------------------------------------------------

class PoseProducer:
    """Continuously captures frames and extracts pose keypoints.

    Runs on a background thread (via asyncio executor) and publishes
    JSON payloads to an asyncio Queue consumed by the WebSocket handler.

    Args:
        cfg: Publisher configuration.
        queue: Asyncio queue to push JSON strings onto.
        loop: The running event loop.
    """

    def __init__(self, cfg: Config, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> None:
        self.cfg = cfg
        self.queue = queue
        self.loop = loop
        self._stop = False

    def stop(self) -> None:
        """Signal the producer to stop."""
        self._stop = True

    def run(self) -> None:
        """Blocking main loop — call from a thread."""
        picam2, imx500 = _setup_camera(self.cfg)
        is_higherhrnet = "higherhrnet" in imx500.network_name.lower() if hasattr(imx500, "network_name") else True

        log.info("Pose producer started (model: %s)", getattr(imx500, "network_name", "unknown"))

        try:
            while not self._stop:
                metadata = picam2.capture_metadata()
                ts = time.time()

                try:
                    outputs = imx500.get_outputs(metadata, add_batch=True)
                except Exception as exc:
                    log.debug("get_outputs error: %s", exc)
                    continue

                if outputs is None:
                    continue

                if is_higherhrnet:
                    keypoints = _parse_higherhrnet(outputs, self.cfg)
                else:
                    keypoints = _parse_posenet_raw(outputs, self.cfg)

                if not keypoints:
                    continue

                payload = json.dumps({"ts": round(ts, 3), "keypoints": keypoints})
                # Non-blocking put — drop frame if queue is full (backpressure)
                asyncio.run_coroutine_threadsafe(
                    self._put(payload), self.loop
                )
        finally:
            picam2.stop()
            log.info("Camera stopped")

    async def _put(self, payload: str) -> None:
        """Put payload onto the queue, dropping if full (max 2 frames buffered)."""
        if self.queue.qsize() < 2:
            await self.queue.put(payload)


# ---------------------------------------------------------------------------
# WebSocket server
# ---------------------------------------------------------------------------

class PoseServer:
    """Async WebSocket server that fans out pose payloads to all clients.

    Args:
        cfg: Publisher configuration.
        mqtt_client: Optional connected paho MQTT client.
    """

    def __init__(self, cfg: Config, mqtt_client: Any = None) -> None:
        self.cfg = cfg
        self.mqtt_client = mqtt_client
        self._clients: set[WebSocketServerProtocol] = set()
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=4)

    async def _handler(self, websocket: WebSocketServerProtocol) -> None:
        """Handle a new WebSocket connection.

        Args:
            websocket: The connected client.
        """
        peer = websocket.remote_address
        log.info("Client connected: %s", peer)
        self._clients.add(websocket)
        try:
            # Keep connection alive; we push data from the broadcaster
            await websocket.wait_closed()
        finally:
            self._clients.discard(websocket)
            log.info("Client disconnected: %s", peer)

    async def _broadcaster(self) -> None:
        """Consume the queue and fan out to all connected clients."""
        while True:
            payload: str = await self._queue.get()

            # MQTT publish (fire-and-forget)
            if self.mqtt_client is not None:
                try:
                    self.mqtt_client.publish(self.cfg.MQTT_TOPIC, payload, qos=0)
                except Exception as exc:
                    log.debug("MQTT publish error: %s", exc)

            if not self._clients:
                continue

            # Broadcast to all clients; remove any that have disconnected
            dead: set[WebSocketServerProtocol] = set()
            for ws in list(self._clients):
                try:
                    await ws.send(payload)
                except websockets.exceptions.ConnectionClosed:
                    dead.add(ws)
                except Exception as exc:
                    log.debug("Send error to %s: %s", ws.remote_address, exc)
                    dead.add(ws)
            self._clients -= dead

    async def run(self) -> None:
        """Start the WebSocket server and the pose producer, then serve forever."""
        loop = asyncio.get_running_loop()
        producer = PoseProducer(self.cfg, self._queue, loop)

        # Run blocking camera loop in a thread pool executor
        executor_future = loop.run_in_executor(None, producer.run)

        broadcaster_task = asyncio.create_task(self._broadcaster())

        log.info("WebSocket server listening on ws://0.0.0.0:%d", self.cfg.WS_PORT)
        try:
            async with websockets.serve(self._handler, "0.0.0.0", self.cfg.WS_PORT):
                await asyncio.gather(executor_future, broadcaster_task)
        except asyncio.CancelledError:
            pass
        finally:
            producer.stop()
            broadcaster_task.cancel()
            try:
                await broadcaster_task
            except asyncio.CancelledError:
                pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Load config, set up MQTT, and run the WebSocket server."""
    cfg = Config.from_env()
    log.info(
        "Config: ws_port=%d mqtt_broker=%s score_threshold=%.2f",
        cfg.WS_PORT,
        cfg.MQTT_BROKER or "disabled",
        cfg.SCORE_THRESHOLD,
    )

    mqtt_client = _build_mqtt_client(cfg)
    server = PoseServer(cfg, mqtt_client)

    try:
        asyncio.run(server.run())
    except KeyboardInterrupt:
        log.info("Interrupted — shutting down")
    finally:
        if mqtt_client is not None:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()


if __name__ == "__main__":
    main()
