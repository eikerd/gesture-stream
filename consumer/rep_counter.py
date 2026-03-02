"""Rep counting engine using joint-angle state machines.

Each exercise is a two-state machine (UP / DOWN).  A rep is counted on the
UP -> DOWN -> UP transition.  Auto-detection inspects the current frame to
decide which exercise is being performed.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum, auto
from typing import Optional

from .pose import PoseFrame, angle


class Phase(Enum):
    """Movement phase within a rep cycle."""

    UP = auto()
    DOWN = auto()
    UNKNOWN = auto()


class Exercise(ABC):
    """Abstract base class for a rep-counting exercise.

    Subclasses implement :meth:`update` to advance the internal state machine
    and return the accumulated rep count whenever a full rep is completed.
    """

    def __init__(self) -> None:
        self._reps: int = 0
        self._phase: Phase = Phase.UNKNOWN

    @property
    def reps(self) -> int:
        """Total completed reps."""
        return self._reps

    @property
    def phase(self) -> Phase:
        """Current movement phase."""
        return self._phase

    @abstractmethod
    def update(self, frame: PoseFrame) -> Optional[int]:
        """Process a new pose frame and update the state machine.

        Args:
            frame: Latest pose observation.

        Returns:
            Current rep count if a rep was just completed, otherwise None.
        """

    def _maybe_count_rep(self, new_phase: Phase) -> Optional[int]:
        """Advance phase and count a rep when DOWN -> UP transition occurs.

        Args:
            new_phase: Phase derived from the current frame.

        Returns:
            Updated rep count on transition, else None.
        """
        if self._phase == Phase.DOWN and new_phase == Phase.UP:
            self._reps += 1
            self._phase = new_phase
            return self._reps

        self._phase = new_phase
        return None


class PushUp(Exercise):
    """Push-up rep counter based on left-elbow angle.

    Joint triplet: left_shoulder -> left_elbow -> left_wrist.

    Phase transitions:
    - DOWN: elbow angle < 90°  (chest near floor)
    - UP:   elbow angle > 160° (arms extended)
    """

    _DOWN_THRESHOLD: float = 90.0
    _UP_THRESHOLD: float = 160.0

    def update(self, frame: PoseFrame) -> Optional[int]:
        shoulder = frame.get("left_shoulder")
        elbow = frame.get("left_elbow")
        wrist = frame.get("left_wrist")

        if shoulder is None or elbow is None or wrist is None:
            return None

        elbow_angle = angle(shoulder, elbow, wrist)

        if elbow_angle < self._DOWN_THRESHOLD:
            return self._maybe_count_rep(Phase.DOWN)
        elif elbow_angle > self._UP_THRESHOLD:
            return self._maybe_count_rep(Phase.UP)

        return None


class Squat(Exercise):
    """Squat rep counter based on left-knee angle.

    Joint triplet: left_hip -> left_knee -> left_ankle.

    Phase transitions:
    - DOWN: knee angle < 100° (deep squat position)
    - UP:   knee angle > 160° (standing upright)
    """

    _DOWN_THRESHOLD: float = 100.0
    _UP_THRESHOLD: float = 160.0

    def update(self, frame: PoseFrame) -> Optional[int]:
        hip = frame.get("left_hip")
        knee = frame.get("left_knee")
        ankle = frame.get("left_ankle")

        if hip is None or knee is None or ankle is None:
            return None

        knee_angle = angle(hip, knee, ankle)

        if knee_angle < self._DOWN_THRESHOLD:
            return self._maybe_count_rep(Phase.DOWN)
        elif knee_angle > self._UP_THRESHOLD:
            return self._maybe_count_rep(Phase.UP)

        return None


class BicepCurl(Exercise):
    """Bicep curl rep counter based on left-elbow angle.

    Joint triplet: left_shoulder -> left_elbow -> left_wrist.

    Note: the UP/DOWN semantics are inverted relative to push-ups because
    a curled arm has a *small* elbow angle.

    Phase transitions:
    - UP (curl complete): elbow angle < 60°
    - DOWN (arm lowered): elbow angle > 150°
    """

    _UP_THRESHOLD: float = 60.0
    _DOWN_THRESHOLD: float = 150.0

    def update(self, frame: PoseFrame) -> Optional[int]:
        shoulder = frame.get("left_shoulder")
        elbow = frame.get("left_elbow")
        wrist = frame.get("left_wrist")

        if shoulder is None or elbow is None or wrist is None:
            return None

        elbow_angle = angle(shoulder, elbow, wrist)

        if elbow_angle < self._UP_THRESHOLD:
            return self._maybe_count_rep(Phase.UP)
        elif elbow_angle > self._DOWN_THRESHOLD:
            return self._maybe_count_rep(Phase.DOWN)

        return None


# ---------------------------------------------------------------------------
# Auto-detecting RepCounter
# ---------------------------------------------------------------------------


class RepCounter:
    """Maintains one Exercise instance and auto-detects the current movement.

    Detection heuristic (evaluated each frame):
    - Computes elbow and knee angles from available keypoints.
    - Classifies based on which angle is most actively changing.
    - Falls back to the most recently detected exercise when confidence
      is low (i.e., keypoints are missing).

    Attributes:
        exercise_name: Name of the currently tracked exercise.
        exercise: Active Exercise state machine.
        total_reps: Cumulative reps counted.
    """

    # Exercise name -> class mapping for display purposes.
    _EXERCISE_CLASSES: dict[str, type[Exercise]] = {
        "pushup": PushUp,
        "squat": Squat,
        "bicep_curl": BicepCurl,
    }

    def __init__(self) -> None:
        self.exercise_name: str = "unknown"
        self.exercise: Exercise = PushUp()  # Neutral default.
        self.total_reps: int = 0
        self._detection_history: list[str] = []

    def _detect_exercise(self, frame: PoseFrame) -> str:
        """Classify the exercise from joint angles in the current frame.

        Args:
            frame: Current pose observation.

        Returns:
            Exercise name string, or 'unknown' if detection is inconclusive.
        """
        # --- Elbow angle (push-up / bicep curl) ---
        l_shoulder = frame.get("left_shoulder")
        l_elbow = frame.get("left_elbow")
        l_wrist = frame.get("left_wrist")
        l_hip = frame.get("left_hip")
        l_knee = frame.get("left_knee")
        l_ankle = frame.get("left_ankle")

        elbow_angle: Optional[float] = None
        knee_angle: Optional[float] = None

        if l_shoulder and l_elbow and l_wrist:
            elbow_angle = angle(l_shoulder, l_elbow, l_wrist)

        if l_hip and l_knee and l_ankle:
            knee_angle = angle(l_hip, l_knee, l_ankle)

        # Distinguish push-up from bicep curl: push-ups require the body to
        # be roughly horizontal so the hip is close in Y to the shoulder.
        if elbow_angle is not None and knee_angle is None:
            if l_shoulder and l_hip:
                hip_shoulder_y_diff = abs(l_hip.y - l_shoulder.y)
                # Horizontal posture -> hip and shoulder at similar Y.
                if hip_shoulder_y_diff < 0.25:
                    return "pushup"
            return "bicep_curl"

        if knee_angle is not None and elbow_angle is None:
            return "squat"

        if knee_angle is not None and elbow_angle is not None:
            # Both angles available: use the one deviating more from neutral.
            knee_deviation = abs(knee_angle - 160.0)
            elbow_deviation = abs(elbow_angle - 160.0)
            if knee_deviation > elbow_deviation:
                return "squat"
            # Distinguish push-up vs curl from body orientation.
            if l_shoulder and l_hip:
                hip_shoulder_y_diff = abs(l_hip.y - l_shoulder.y)
                if hip_shoulder_y_diff < 0.25:
                    return "pushup"
            return "bicep_curl"

        return "unknown"

    def _switch_exercise(self, name: str) -> None:
        """Replace the active exercise instance when detection changes.

        Args:
            name: Newly detected exercise name.
        """
        if name == self.exercise_name:
            return
        cls = self._EXERCISE_CLASSES.get(name)
        if cls is None:
            return
        self.exercise_name = name
        self.exercise = cls()

    def update(self, frame: PoseFrame) -> Optional[int]:
        """Process a frame: detect exercise, advance state machine.

        Args:
            frame: Latest pose observation.

        Returns:
            Rep count if a rep was just completed, otherwise None.
        """
        detected = self._detect_exercise(frame)

        # Use a short rolling window to smooth detection and avoid thrashing.
        self._detection_history.append(detected)
        if len(self._detection_history) > 10:
            self._detection_history.pop(0)

        # Commit to a new exercise only when the last 5 frames agree.
        if len(self._detection_history) >= 5:
            recent = self._detection_history[-5:]
            majority = max(set(recent), key=recent.count)
            if majority != "unknown":
                self._switch_exercise(majority)

        result = self.exercise.update(frame)
        if result is not None:
            self.total_reps = result
        return result
