"""Pose data model and geometric utilities.

Parses keypoint frames received from the Pi Zero 2W publisher and provides
angle computation for joint analysis.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

# Minimum confidence score to treat a keypoint as valid.
MIN_SCORE: float = 0.3

# All expected keypoint names in MoveNet/IMX500 order.
KEYPOINT_NAMES: list[str] = [
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


@dataclass(frozen=True)
class Keypoint:
    """A single body keypoint with normalized coordinates and confidence.

    Attributes:
        name: Keypoint label (e.g. 'left_elbow').
        x: Horizontal position normalized to [0.0, 1.0].
        y: Vertical position normalized to [0.0, 1.0].
        score: Detection confidence in [0.0, 1.0].
    """

    name: str
    x: float
    y: float
    score: float

    @property
    def valid(self) -> bool:
        """Return True when confidence exceeds the minimum threshold."""
        return self.score >= MIN_SCORE


@dataclass(frozen=True)
class PoseFrame:
    """One complete pose observation from the camera.

    Attributes:
        ts: Unix timestamp (seconds) when the frame was captured.
        keypoints: Mapping of keypoint name to Keypoint.
    """

    ts: float
    keypoints: dict[str, Keypoint]

    def get(self, name: str) -> Keypoint | None:
        """Return a keypoint only if it exists and passes confidence threshold.

        Args:
            name: Keypoint name to look up.

        Returns:
            Keypoint if present and valid, otherwise None.
        """
        kp = self.keypoints.get(name)
        return kp if kp is not None and kp.valid else None


def angle(a: Keypoint, b: Keypoint, c: Keypoint) -> float:
    """Compute the interior angle at joint *b* formed by the segment a-b-c.

    Uses the dot-product formula so results are always in [0°, 180°].

    Args:
        a: First endpoint keypoint.
        b: Vertex keypoint (the joint whose angle is measured).
        c: Second endpoint keypoint.

    Returns:
        Angle in degrees at point b, in the range [0.0, 180.0].
    """
    # Vectors from b to a and from b to c.
    ba_x = a.x - b.x
    ba_y = a.y - b.y
    bc_x = c.x - b.x
    bc_y = c.y - b.y

    dot = ba_x * bc_x + ba_y * bc_y
    mag_ba = math.hypot(ba_x, ba_y)
    mag_bc = math.hypot(bc_x, bc_y)

    if mag_ba == 0.0 or mag_bc == 0.0:
        return 0.0

    # Clamp to [-1, 1] to guard against floating-point drift.
    cos_angle = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
    return math.degrees(math.acos(cos_angle))


def from_json(data: dict[str, Any]) -> PoseFrame:
    """Parse a raw JSON payload into a PoseFrame.

    The expected format is::

        {
            "ts": 1234567890.123,
            "keypoints": [
                {"name": "nose", "x": 0.5, "y": 0.3, "score": 0.9},
                ...
            ]
        }

    Args:
        data: Decoded JSON dictionary from the WebSocket stream.

    Returns:
        PoseFrame populated with all received keypoints.

    Raises:
        KeyError: If required top-level keys are missing.
        ValueError: If keypoint entries are malformed.
    """
    ts: float = float(data["ts"])
    keypoints: dict[str, Keypoint] = {}

    for entry in data["keypoints"]:
        name: str = entry["name"]
        kp = Keypoint(
            name=name,
            x=float(entry["x"]),
            y=float(entry["y"]),
            score=float(entry["score"]),
        )
        keypoints[name] = kp

    return PoseFrame(ts=ts, keypoints=keypoints)
