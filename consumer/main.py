"""CLI entry point for the pi-vision consumer.

Connects to the Pi Zero 2W pose stream, counts reps, and renders a live
terminal dashboard.  Every 10 reps, Claude is consulted for form feedback.

Usage::

    # Default — connects to ws://pi-zero-ai.local:8765
    python -m consumer.main

    # Custom host
    PI_HOST=192.168.1.42 python -m consumer.main

Environment variables:
    PI_HOST         Pi hostname or IP (default: pi-zero-ai.local)
    PI_WS_PORT      WebSocket port (default: 8765)
    MQTT_BROKER     If set, also subscribes to MQTT for pose data
    ANTHROPIC_API_KEY  Enables Claude feedback (optional)
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

from rich.columns import Columns
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from .feedback import FeedbackAgent
from .pose import PoseFrame
from .rep_counter import RepCounter
from .stream import PoseStream

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

_FEEDBACK_INTERVAL: int = 10  # Request feedback every N reps.


# ---------------------------------------------------------------------------
# Dashboard rendering
# ---------------------------------------------------------------------------


def _build_dashboard(
    exercise: str,
    reps: int,
    phase: str,
    fps: float,
    feedback: str,
    session_reps: list[tuple[int, str]],
) -> Layout:
    """Compose the Rich layout for the live terminal UI.

    Args:
        exercise: Currently detected exercise name.
        reps: Completed rep count.
        phase: Current movement phase label.
        fps: Approximate frames-per-second being processed.
        feedback: Most recent Claude feedback string.
        session_reps: List of (rep_number, exercise) tuples for history table.

    Returns:
        A :class:`rich.layout.Layout` ready to be rendered.
    """
    layout = Layout()
    layout.split_column(
        Layout(name="header", size=3),
        Layout(name="body"),
        Layout(name="feedback", size=6),
    )
    layout["body"].split_row(
        Layout(name="stats", ratio=1),
        Layout(name="history", ratio=2),
    )

    # Header
    title = Text("Pi-Vision Rep Counter", style="bold cyan", justify="center")
    layout["header"].update(Panel(title))

    # Stats panel
    stats_table = Table.grid(padding=(0, 2))
    stats_table.add_column(style="bold")
    stats_table.add_column()

    exercise_display = exercise.replace("_", " ").title() if exercise != "unknown" else "[dim]detecting...[/dim]"
    stats_table.add_row("Exercise:", exercise_display)
    stats_table.add_row("Reps:", f"[bold green]{reps}[/bold green]")
    stats_table.add_row("Phase:", f"[yellow]{phase}[/yellow]")
    stats_table.add_row("FPS:", f"{fps:.1f}")

    layout["stats"].update(
        Panel(stats_table, title="[bold]Live Stats[/bold]", border_style="blue")
    )

    # History table
    history = Table(show_header=True, header_style="bold magenta")
    history.add_column("Rep #", width=6)
    history.add_column("Exercise")
    for rep_num, ex in session_reps[-20:]:
        history.add_row(str(rep_num), ex.replace("_", " ").title())

    layout["history"].update(
        Panel(history, title="[bold]Rep History[/bold]", border_style="green")
    )

    # Feedback panel
    feedback_text = Text(feedback, overflow="fold")
    layout["feedback"].update(
        Panel(
            feedback_text,
            title="[bold]Claude Feedback[/bold]",
            border_style="yellow",
        )
    )

    return layout


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


async def run() -> None:
    """Main async entry point: stream -> count -> display -> feedback."""
    host = os.environ.get("PI_HOST", "pi-zero-ai.local")
    port = int(os.environ.get("PI_WS_PORT", 8765))
    uri = f"ws://{host}:{port}"

    console = Console()
    counter = RepCounter()
    agent = FeedbackAgent()
    stream = PoseStream()

    session_reps: list[tuple[int, str]] = []
    frame_count = 0
    fps = 0.0
    fps_window_start = time.monotonic()
    fps_window_frames = 0
    last_rep_time: Optional[float] = None
    next_feedback_at = _FEEDBACK_INTERVAL

    console.print(f"[cyan]Connecting to [bold]{uri}[/bold]...[/cyan]")

    with Live(console=console, refresh_per_second=10, screen=False) as live:
        async for frame in stream.frames(uri):
            frame_count += 1
            fps_window_frames += 1

            now = time.monotonic()
            if now - fps_window_start >= 1.0:
                fps = fps_window_frames / (now - fps_window_start)
                fps_window_frames = 0
                fps_window_start = now

            result = counter.update(frame)

            if result is not None:
                duration = (now - last_rep_time) if last_rep_time is not None else 0.0
                last_rep_time = now
                session_reps.append((result, counter.exercise_name))
                agent.record_rep(
                    rep_number=result,
                    exercise=counter.exercise_name,
                    duration_s=duration,
                )

                if result >= next_feedback_at:
                    next_feedback_at += _FEEDBACK_INTERVAL
                    # Fire feedback request without blocking the render loop.
                    asyncio.create_task(_fetch_feedback(agent))

            phase_label = counter.exercise.phase.name
            layout = _build_dashboard(
                exercise=counter.exercise_name,
                reps=counter.total_reps,
                phase=phase_label,
                fps=fps,
                feedback=agent.last_feedback,
                session_reps=session_reps,
            )
            live.update(layout)


async def _fetch_feedback(agent: FeedbackAgent) -> None:
    """Background task: request Claude feedback and update agent state.

    Args:
        agent: The :class:`~feedback.FeedbackAgent` to query.
    """
    try:
        await agent.maybe_get_feedback()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Feedback fetch failed: %s", exc)


def main() -> None:
    """Synchronous wrapper for CLI invocation."""
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
