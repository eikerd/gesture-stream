"""Configuration for the IMX500 pose publisher.

Loads settings from environment variables with sensible defaults.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Config:
    """Publisher configuration loaded from environment variables.

    Attributes:
        WS_PORT: WebSocket server port.
        MQTT_BROKER: MQTT broker hostname or IP. None disables MQTT.
        MQTT_PORT: MQTT broker port.
        MQTT_TOPIC: MQTT topic for pose data.
        CAMERA_WIDTH: Camera capture width in pixels.
        CAMERA_HEIGHT: Camera capture height in pixels.
        FRAMERATE: Target camera framerate.
        SCORE_THRESHOLD: Minimum keypoint confidence score to include.
    """

    WS_PORT: int = field(default=8765)
    MQTT_BROKER: Optional[str] = field(default=None)
    MQTT_PORT: int = field(default=1883)
    MQTT_TOPIC: str = field(default="fitness/pose")
    CAMERA_WIDTH: int = field(default=640)
    CAMERA_HEIGHT: int = field(default=480)
    FRAMERATE: int = field(default=15)
    SCORE_THRESHOLD: float = field(default=0.3)

    @classmethod
    def from_env(cls) -> "Config":
        """Create a Config instance populated from environment variables.

        Returns:
            Config instance with values from env vars, falling back to defaults.
        """
        return cls(
            WS_PORT=int(os.environ.get("WS_PORT", 8765)),
            MQTT_BROKER=os.environ.get("MQTT_BROKER") or None,
            MQTT_PORT=int(os.environ.get("MQTT_PORT", 1883)),
            MQTT_TOPIC=os.environ.get("MQTT_TOPIC", "fitness/pose"),
            CAMERA_WIDTH=int(os.environ.get("CAMERA_WIDTH", 640)),
            CAMERA_HEIGHT=int(os.environ.get("CAMERA_HEIGHT", 480)),
            FRAMERATE=int(os.environ.get("FRAMERATE", 15)),
            SCORE_THRESHOLD=float(os.environ.get("SCORE_THRESHOLD", 0.3)),
        )
