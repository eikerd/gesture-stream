"""Claude API feedback agent for workout form analysis.

Batches rep data and calls the Anthropic API to generate coaching feedback.
Gracefully skips if ``ANTHROPIC_API_KEY`` is not set.
"""

from __future__ import annotations

import logging
import os
import statistics
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

_BATCH_SIZE: int = 10  # Reps to accumulate before requesting feedback.
_MODEL: str = "claude-sonnet-4-6"


@dataclass
class RepRecord:
    """Lightweight record of a single completed rep.

    Attributes:
        rep_number: Sequential rep index within the session.
        exercise: Exercise name at the time of the rep.
        duration_s: Seconds elapsed from the previous rep (inter-rep cadence).
    """

    rep_number: int
    exercise: str
    duration_s: float


@dataclass
class FeedbackAgent:
    """Accumulates rep records and periodically calls Claude for coaching tips.

    Usage::

        agent = FeedbackAgent()
        agent.record_rep(rep_num=1, exercise="pushup", duration_s=2.3)
        # After 10 reps:
        feedback = await agent.maybe_get_feedback()

    Attributes:
        last_feedback: Most recent feedback string from Claude.
    """

    last_feedback: str = field(default="(waiting for reps...)", init=False)
    _records: list[RepRecord] = field(default_factory=list, init=False)
    _api_key: Optional[str] = field(default=None, init=False)
    _client: object = field(default=None, init=False)  # anthropic.AsyncAnthropic

    def __post_init__(self) -> None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            logger.info("ANTHROPIC_API_KEY not set — feedback agent disabled.")
            return

        try:
            import anthropic  # type: ignore[import]

            self._api_key = api_key
            self._client = anthropic.AsyncAnthropic(api_key=api_key)
            logger.info("FeedbackAgent initialised with model %s.", _MODEL)
        except ImportError:
            logger.warning("anthropic package not installed; feedback disabled.")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def record_rep(self, rep_number: int, exercise: str, duration_s: float) -> None:
        """Log a completed rep for the next feedback batch.

        Args:
            rep_number: Sequential rep count within the session.
            exercise: Exercise name (e.g. 'pushup', 'squat').
            duration_s: Seconds elapsed since the previous rep.
        """
        self._records.append(
            RepRecord(rep_number=rep_number, exercise=exercise, duration_s=duration_s)
        )

    async def maybe_get_feedback(self) -> Optional[str]:
        """Request Claude feedback if a full batch has been accumulated.

        Clears the batch after a successful API call.

        Returns:
            Feedback string on success, None if the batch is incomplete
            or the API is unavailable.
        """
        if len(self._records) < _BATCH_SIZE:
            return None

        if self._client is None:
            self._records.clear()
            return None

        batch = self._records[:_BATCH_SIZE]
        self._records = self._records[_BATCH_SIZE:]

        feedback = await self._call_claude(batch)
        if feedback:
            self.last_feedback = feedback
        return feedback

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _call_claude(self, batch: list[RepRecord]) -> Optional[str]:
        """Send a batch of rep records to Claude and return its response.

        Args:
            batch: List of RepRecord objects representing recent reps.

        Returns:
            Coaching feedback string, or None on failure.
        """
        import anthropic  # type: ignore[import]

        prompt = self._build_prompt(batch)
        try:
            response = await self._client.messages.create(  # type: ignore[union-attr]
                model=_MODEL,
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text.strip()
        except anthropic.APIError as exc:
            logger.warning("Claude API error: %s", exc)
            return None
        except Exception as exc:  # noqa: BLE001
            logger.error("Unexpected feedback error: %s", exc)
            return None

    @staticmethod
    def _build_prompt(batch: list[RepRecord]) -> str:
        """Compose the coaching prompt from a rep batch.

        Args:
            batch: Recent rep records.

        Returns:
            Plain-text prompt suitable for Claude.
        """
        exercise = batch[-1].exercise if batch else "unknown"
        durations = [r.duration_s for r in batch if r.duration_s > 0]
        avg_cadence = statistics.mean(durations) if durations else 0.0
        cadence_std = statistics.stdev(durations) if len(durations) > 1 else 0.0

        lines = [
            f"Exercise: {exercise}",
            f"Reps completed: {len(batch)}",
            f"Average inter-rep cadence: {avg_cadence:.1f}s",
            f"Cadence consistency (std dev): {cadence_std:.2f}s",
            "",
            "Rep-by-rep breakdown:",
        ]
        for rec in batch:
            lines.append(f"  Rep {rec.rep_number}: {rec.duration_s:.1f}s")

        lines += [
            "",
            "You are a concise fitness coach. In 2-4 short sentences, comment on:",
            "1. Rep cadence and consistency",
            "2. Any pacing concerns or positives",
            "3. One actionable tip",
            "Keep the response under 80 words.",
        ]
        return "\n".join(lines)
