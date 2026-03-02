#!/usr/bin/env python3
"""
mediapipe_to_coco.py — Convert MediaPipe BlazePose 33-landmark data to COCO-17 JSON

Supported input formats
-----------------------
  --format full        CSV: label, x0,y0,z0,v0, x1,y1,z1,v1, ...  (133 cols)
  --format xy          CSV: label, x0,y0, x1,y1, ...               ( 67 cols)
  --format xyzv        CSV: x0,y0,z0,v0, ...  no label             (132 cols)
  --format xy_nolabel  CSV: x0,y0, ...  no label                   ( 66 cols)
  --format auto        Detect from column count (default)
  --format json        Each line is a JSON array of 33 {x,y,z,visibility} dicts
  --format named       CSV: label, nose_x, nose_y, nose_z, nose_v, ...
                       (NgoQuocBao-style; named columns, COCO-17 subset)

Output
------
  A JSON file (or stdout) of shape:
    {
      "frames": [{"ts": 0.033, "keypoints": [{"name": "nose", "x": 0.5, "y": 0.3, "score": 0.98}, ...]}, ...],
      "labels": ["DOWN", "DOWN", "UP", ...]   // null entries when no label
    }

  Or --output-format ndjson for one PoseFrame JSON object per line (streamable).

Usage examples
--------------
  # DanielGuarnizo squats CSV (pixel space 640×360, full format)
  python mediapipe_to_coco.py squats.csv -o squats_coco.json \\
      --width 640 --height 360 --format full --fps 30

  # NgoQuocBao plank CSV (normalised, named columns, correct-form rows only)
  python mediapipe_to_coco.py plank_train.csv -o plank.json \\
      --format named --filter-label C --every-nth 3 --max-frames 90 --fps 10

  # Normalised xy CSV, no label column
  python mediapipe_to_coco.py run.csv -o run_coco.json --format xy_nolabel

  # Batch convert a directory
  python mediapipe_to_coco.py data/*.csv -o combined.json --width 640 --height 360

  # Print as NDJSON to stdout (pipe into curl/nc)
  python mediapipe_to_coco.py run.csv --output-format ndjson | head -5
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Optional

# ─── MediaPipe 33 → COCO-17 index map ────────────────────────────────────────
#
# Each entry: (coco_idx, coco_name, mp_idx)
# Eye centre landmarks used: left_eye=2, right_eye=5  (skips inner/outer)

COCO_KEYPOINT_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
    "left_hip", "right_hip",
    "left_knee", "right_knee",
    "left_ankle", "right_ankle",
]

# (coco_idx, mp_idx)
COCO_TO_MP: list[tuple[int, int]] = [
    (0,  0),   # nose
    (1,  2),   # left_eye  (center; MP inner=1, center=2, outer=3)
    (2,  5),   # right_eye (center; MP inner=4, center=5, outer=6)
    (3,  7),   # left_ear
    (4,  8),   # right_ear
    (5,  11),  # left_shoulder
    (6,  12),  # right_shoulder
    (7,  13),  # left_elbow
    (8,  14),  # right_elbow
    (9,  15),  # left_wrist
    (10, 16),  # right_wrist
    (11, 23),  # left_hip
    (12, 24),  # right_hip
    (13, 25),  # left_knee
    (14, 26),  # right_knee
    (15, 27),  # left_ankle
    (16, 28),  # right_ankle
]

MP_IDX_FOR_COCO: dict[int, int] = {coco: mp for coco, mp in COCO_TO_MP}

# ─── Types ────────────────────────────────────────────────────────────────────

Landmark = dict  # {x, y, z, visibility}
Pose33   = list[Landmark]   # exactly 33


# ─── Conversion core ──────────────────────────────────────────────────────────

def mp_to_coco(
    pose: Pose33,
    ts: float = 0.0,
    image_width:  Optional[float] = None,
    image_height: Optional[float] = None,
) -> dict:
    """Convert one MP33 pose into a COCO-17 PoseFrame dict."""
    if len(pose) != 33:
        raise ValueError(f"Expected 33 landmarks, got {len(pose)}")

    scale_x = 1 / image_width  if image_width  else 1.0
    scale_y = 1 / image_height if image_height else 1.0

    keypoints = []
    for coco_idx, name in enumerate(COCO_KEYPOINT_NAMES):
        mp_idx = MP_IDX_FOR_COCO[coco_idx]
        lm = pose[mp_idx]
        keypoints.append({
            "name":  name,
            "x":     lm["x"] * scale_x,
            "y":     lm["y"] * scale_y,
            "score": lm.get("visibility", 1.0),
        })

    return {"ts": ts, "keypoints": keypoints}


# ─── CSV parsers ──────────────────────────────────────────────────────────────

def _parse_csv_row(
    cols: list[str],
    fmt: str,
    image_width:  Optional[float],
    image_height: Optional[float],
) -> tuple[Optional[str], dict]:
    """
    Returns (label_or_None, pose_frame_dict).
    fmt must be one of: full | xy | xyzv | xy_nolabel | auto
    """
    n = len(cols)

    if fmt == "auto":
        if n == 133:   fmt = "full"
        elif n == 67:  fmt = "xy"
        elif n == 132: fmt = "xyzv"
        elif n == 66:  fmt = "xy_nolabel"
        else:
            raise ValueError(f"Cannot auto-detect CSV layout from {n} columns")

    has_label: bool
    data_start: int
    stride: int
    has_vis: bool

    if fmt == "full":
        has_label, data_start, stride, has_vis = True,  1, 4, True
    elif fmt == "xy":
        has_label, data_start, stride, has_vis = True,  1, 2, False
    elif fmt == "xyzv":
        has_label, data_start, stride, has_vis = False, 0, 4, True
    elif fmt == "xy_nolabel":
        has_label, data_start, stride, has_vis = False, 0, 2, False
    else:
        raise ValueError(f"Unknown format: {fmt!r}")

    label = cols[0] if has_label else None

    scale_x = 1 / image_width  if image_width  else 1.0
    scale_y = 1 / image_height if image_height else 1.0

    pose: Pose33 = []
    for i in range(33):
        base = data_start + i * stride
        pose.append({
            "x":          float(cols[base])     * scale_x,
            "y":          float(cols[base + 1]) * scale_y,
            "z":          float(cols[base + 2]) if stride >= 3 else 0.0,
            "visibility": float(cols[base + 3]) if has_vis else 1.0,
        })

    return label, pose


def parse_csv_file(
    path: Path,
    fmt: str,
    fps: float,
    image_width:  Optional[float],
    image_height: Optional[float],
    skip_header: bool = True,
) -> tuple[list[dict], list[Optional[str]]]:
    frames: list[dict] = []
    labels: list[Optional[str]] = []

    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        if skip_header:
            next(reader, None)
        for frame_idx, cols in enumerate(reader):
            if not any(c.strip() for c in cols):
                continue
            try:
                label, pose = _parse_csv_row(cols, fmt, image_width, image_height)
                frames.append(mp_to_coco(pose, ts=frame_idx / fps))
                labels.append(label)
            except (ValueError, IndexError) as e:
                print(f"  skip row {frame_idx}: {e}", file=sys.stderr)

    return frames, labels


def parse_named_csv_file(
    path: Path,
    fps: float,
    image_width:  Optional[float],
    image_height: Optional[float],
    filter_label: Optional[str] = None,
    every_nth: int = 1,
    max_frames: Optional[int] = None,
) -> tuple[list[dict], list[Optional[str]]]:
    """
    NgoQuocBao named-column format:
      label, nose_x, nose_y, nose_z, nose_v, left_shoulder_x, left_shoulder_y, ...

    Columns are named by COCO keypoint name + '_x/_y/_z/_v'.
    Only a subset of COCO-17 keypoints may be present; missing ones get score=0.
    Eyes and ears are typically absent from gym-exercise captures.
    """
    scale_x = 1 / image_width  if image_width  else 1.0
    scale_y = 1 / image_height if image_height else 1.0

    frames: list[dict] = []
    labels: list[Optional[str]] = []
    frame_idx = 0  # counts output frames

    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row_idx, row in enumerate(reader):
            if not any(v.strip() for v in row.values()):
                continue

            label = row.get("label") or row.get("class")

            # label filter
            if filter_label is not None and label != filter_label:
                continue

            # stride filter
            if row_idx % every_nth != 0:
                continue

            keypoints = []
            for name in COCO_KEYPOINT_NAMES:
                x_col, y_col, v_col = f"{name}_x", f"{name}_y", f"{name}_v"
                if x_col in row and row[x_col].strip():
                    x     = float(row[x_col]) * scale_x
                    y     = float(row[y_col]) * scale_y
                    score = float(row[v_col]) if v_col in row else 1.0
                else:
                    x, y, score = 0.0, 0.0, 0.0  # landmark absent → invisible

                keypoints.append({"name": name, "x": x, "y": y, "score": score})

            frames.append({"ts": frame_idx / fps, "keypoints": keypoints})
            labels.append(label)
            frame_idx += 1

            if max_frames is not None and frame_idx >= max_frames:
                break

    return frames, labels


def parse_json_file(
    path: Path,
    fps: float,
    image_width:  Optional[float],
    image_height: Optional[float],
) -> tuple[list[dict], list[Optional[str]]]:
    """
    Input JSON format: a list of pose objects, each being either:
      - list of 33 landmarks [{x,y,z,visibility}, ...]
      - dict with keys "landmarks" and optional "label"
    """
    data = json.loads(path.read_text())
    frames = []
    labels = []

    if not isinstance(data, list):
        data = [data]

    for frame_idx, item in enumerate(data):
        label = None
        if isinstance(item, dict):
            label = item.get("label")
            pose  = item.get("landmarks", item.get("pose", item))
        else:
            pose = item

        try:
            frames.append(mp_to_coco(pose, ts=frame_idx / fps,
                                      image_width=image_width,
                                      image_height=image_height))
            labels.append(label)
        except (ValueError, KeyError) as e:
            print(f"  skip entry {frame_idx}: {e}", file=sys.stderr)

    return frames, labels


# ─── CLI ──────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Convert MediaPipe 33-landmark data to COCO-17 PoseFrame JSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("inputs", nargs="+", type=Path, metavar="FILE",
                   help="Input CSV or JSON file(s)")
    p.add_argument("-o", "--output", type=Path, default=None, metavar="FILE",
                   help="Output file (default: stdout)")
    p.add_argument("--format",
                   choices=["auto", "full", "xy", "xyzv", "xy_nolabel", "json", "named"],
                   default="auto", metavar="FMT",
                   help="Input data layout (default: auto-detect). "
                        "'named' = NgoQuocBao-style named columns (nose_x, left_shoulder_y, ...)")
    p.add_argument("--output-format", choices=["json", "ndjson"],
                   default="json", dest="output_format",
                   help="Output encoding: json (default) or ndjson (one frame per line)")
    p.add_argument("--fps", type=float, default=30.0,
                   help="Source frame rate for timestamp synthesis (default: 30)")
    p.add_argument("--width",  type=float, default=None,
                   help="Image width in pixels for normalisation (omit if already 0-1)")
    p.add_argument("--height", type=float, default=None,
                   help="Image height in pixels for normalisation (omit if already 0-1)")
    p.add_argument("--no-header", action="store_true",
                   help="CSV has no header row")
    p.add_argument("--include-labels", action="store_true",
                   help="Include the label column in output JSON")
    p.add_argument("--filter-label", default=None, metavar="LABEL",
                   help="Only include rows whose label column matches LABEL (e.g. 'C' for correct)")
    p.add_argument("--every-nth", type=int, default=1, metavar="N",
                   help="Keep every Nth row (stride for downsampling, default: 1 = keep all)")
    p.add_argument("--max-frames", type=int, default=None, metavar="N",
                   help="Stop after N output frames")
    return p


def main() -> None:
    args = build_parser().parse_args()

    all_frames: list[dict] = []
    all_labels: list[Optional[str]] = []

    for path in args.inputs:
        if not path.exists():
            print(f"error: {path} not found", file=sys.stderr)
            sys.exit(1)

        print(f"processing {path} ...", file=sys.stderr)

        if args.format == "json" or path.suffix.lower() == ".json":
            frames, labels = parse_json_file(
                path, args.fps, args.width, args.height)
        elif args.format == "named":
            frames, labels = parse_named_csv_file(
                path, args.fps, args.width, args.height,
                filter_label=args.filter_label,
                every_nth=args.every_nth,
                max_frames=args.max_frames)
        else:
            frames, labels = parse_csv_file(
                path, args.format, args.fps,
                args.width, args.height,
                skip_header=not args.no_header)

        # Apply every-nth stride and label filter for non-named formats
        if args.format != "named":
            if args.filter_label is not None:
                paired = [(f, l) for f, l in zip(frames, labels) if l == args.filter_label]
                frames, labels = (list(x) for x in zip(*paired)) if paired else ([], [])
            if args.every_nth > 1:
                frames = frames[::args.every_nth]
                labels = labels[::args.every_nth]
            if args.max_frames is not None:
                frames = frames[:args.max_frames]
                labels = labels[:args.max_frames]

        all_frames.extend(frames)
        all_labels.extend(labels)
        print(f"  → {len(frames)} frames", file=sys.stderr)

    print(f"total: {len(all_frames)} frames", file=sys.stderr)

    # ── Build output ──────────────────────────────────────────────────────────
    out_fh = open(args.output, "w", encoding="utf-8") if args.output else sys.stdout

    try:
        if args.output_format == "ndjson":
            for frame in all_frames:
                out_fh.write(json.dumps(frame, separators=(",", ":")) + "\n")
        else:
            payload: dict = {"frames": all_frames}
            if args.include_labels:
                payload["labels"] = all_labels
            json.dump(payload, out_fh, indent=2)
            out_fh.write("\n")
    finally:
        if args.output:
            out_fh.close()

    if args.output:
        print(f"wrote {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
