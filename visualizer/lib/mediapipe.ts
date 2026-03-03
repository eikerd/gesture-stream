/**
 * MediaPipe BlazePose 33-landmark → COCO-17 converter
 *
 * MediaPipe landmark indices (33 total):
 *   0  nose
 *   1  left_eye_inner   2  left_eye   3  left_eye_outer
 *   4  right_eye_inner  5  right_eye  6  right_eye_outer
 *   7  left_ear         8  right_ear
 *   9  mouth_left       10 mouth_right
 *   11 left_shoulder    12 right_shoulder
 *   13 left_elbow       14 right_elbow
 *   15 left_wrist       16 right_wrist
 *   17 left_pinky       18 right_pinky
 *   19 left_index       20 right_index
 *   21 left_thumb       22 right_thumb
 *   23 left_hip         24 right_hip
 *   25 left_knee        26 right_knee
 *   27 left_ankle       28 right_ankle
 *   29 left_heel        30 right_heel
 *   31 left_foot_index  32 right_foot_index
 *
 * COCO-17 uses the eye *center* landmark (2, 5) rather than inner/outer
 * subdivisions; all other body joints are direct 1:1 matches by anatomy.
 */

import { type PoseFrame, type Keypoint, COCO_KEYPOINT_NAMES } from "./pose";

// ─── Mapping table: [COCO_idx, MP_idx] ───────────────────────────────────────

/** Direct mapping from each COCO-17 index to the corresponding MP33 index. */
const COCO_TO_MP: readonly [number, number][] = [
  [0,  0],  // nose         → nose
  [1,  2],  // left_eye     → left_eye (center; skips inner=1, outer=3)
  [2,  5],  // right_eye    → right_eye (center; skips inner=4, outer=6)
  [3,  7],  // left_ear     → left_ear
  [4,  8],  // right_ear    → right_ear
  [5,  11], // left_shoulder
  [6,  12], // right_shoulder
  [7,  13], // left_elbow
  [8,  14], // right_elbow
  [9,  15], // left_wrist
  [10, 16], // right_wrist
  [11, 23], // left_hip
  [12, 24], // right_hip
  [13, 25], // left_knee
  [14, 26], // right_knee
  [15, 27], // left_ankle
  [16, 28], // right_ankle
] as const;

/** Build a lookup: COCO index → MP index */
const COCO_IDX_TO_MP_IDX: number[] = new Array(17);
for (const [cocoIdx, mpIdx] of COCO_TO_MP) {
  COCO_IDX_TO_MP_IDX[cocoIdx] = mpIdx;
}

// ─── Input types ──────────────────────────────────────────────────────────────

/** Single MediaPipe landmark as returned by the Python/JS API. */
export interface MPLandmark {
  x: number;          // normalized [0,1] in image space (or pixel if from pixel variant)
  y: number;
  z?: number;         // depth — ignored
  visibility?: number; // confidence [0,1]; falls back to 1.0 if absent
}

/** One MP33 pose result: an array of exactly 33 MPLandmark objects. */
export type MPPose = MPLandmark[];

// ─── Converter ────────────────────────────────────────────────────────────────

/**
 * Convert a MediaPipe 33-landmark pose into a COCO-17 PoseFrame.
 *
 * @param mp          Array of 33 MPLandmark objects (normalized coords).
 * @param ts          Optional timestamp in seconds; defaults to Date.now()/1000.
 * @param imageWidth  If MP coords are pixel-space, provide width to normalise.
 * @param imageHeight If MP coords are pixel-space, provide height to normalise.
 */
export function mpToCoco(
  mp: MPPose,
  ts?: number,
  imageWidth?: number,
  imageHeight?: number,
): PoseFrame {
  if (mp.length !== 33) {
    throw new Error(`Expected 33 MP landmarks, got ${mp.length}`);
  }

  const scaleX = imageWidth  ? 1 / imageWidth  : 1;
  const scaleY = imageHeight ? 1 / imageHeight : 1;

  const keypoints: Keypoint[] = COCO_KEYPOINT_NAMES.map((name, cocoIdx) => {
    const mpIdx = COCO_IDX_TO_MP_IDX[cocoIdx];
    const lm = mp[mpIdx];
    return {
      name,
      x: lm.x * scaleX,
      y: lm.y * scaleY,
      score: lm.visibility ?? 1.0,
    };
  });

  return { ts: ts ?? Date.now() / 1000, keypoints };
}

// ─── CSV row parser ───────────────────────────────────────────────────────────

/**
 * Supported CSV column layouts:
 *
 *   "full"    label, x0,y0,z0,v0, x1,y1,z1,v1, ... (33×4 + 1 = 133 cols)
 *   "xy"      label, x0,y0, x1,y1, ...              (33×2 + 1 =  67 cols)
 *   "xyzv"    no label, x0,y0,z0,v0, ...             (33×4     = 132 cols)
 *   "xy_nolabel" no label, x0,y0, ...                (33×2     =  66 cols)
 *
 * Auto-detected from column count when format is not specified.
 */
export type MPCsvLayout = "full" | "xy" | "xyzv" | "xy_nolabel";

export interface MPCsvRow {
  label?: string;
  pose: MPPose;
}

/**
 * Parse a single CSV data row (array of string values) into MPPose.
 * Compatible with DanielGuarnizo-style CSVs and standard MediaPipe exports.
 */
export function parseMPCsvRow(
  cols: string[],
  layout?: MPCsvLayout,
  imageWidth?: number,
  imageHeight?: number,
): MPCsvRow {
  // Auto-detect layout from column count
  const detected: MPCsvLayout = layout ?? ((): MPCsvLayout => {
    switch (cols.length) {
      case 133: return "full";
      case 67:  return "xy";
      case 132: return "xyzv";
      case 66:  return "xy_nolabel";
      default:
        throw new Error(`Cannot auto-detect CSV layout from ${cols.length} columns`);
    }
  })();

  let label: string | undefined;
  let dataStart: number;
  let stride: number;
  let hasVisibility: boolean;

  switch (detected) {
    case "full":       label = cols[0]; dataStart = 1; stride = 4; hasVisibility = true;  break;
    case "xy":         label = cols[0]; dataStart = 1; stride = 2; hasVisibility = false; break;
    case "xyzv":       label = undefined; dataStart = 0; stride = 4; hasVisibility = true;  break;
    case "xy_nolabel": label = undefined; dataStart = 0; stride = 2; hasVisibility = false; break;
  }

  const scaleX = imageWidth  ? 1 / imageWidth  : 1;
  const scaleY = imageHeight ? 1 / imageHeight : 1;

  const pose: MPPose = Array.from({ length: 33 }, (_, i) => {
    const base = dataStart + i * stride;
    return {
      x: parseFloat(cols[base])     * scaleX,
      y: parseFloat(cols[base + 1]) * scaleY,
      z: stride >= 3 ? parseFloat(cols[base + 2]) : 0,
      visibility: hasVisibility ? parseFloat(cols[base + 3]) : 1.0,
    };
  });

  return { label, pose };
}

/**
 * Parse an entire CSV string (with optional header row) into PoseFrames.
 * Timestamps are synthesised at the given fps if not embedded in the data.
 *
 * @example
 *   const frames = parseMPCsv(csvText, { fps: 30, imageWidth: 640, imageHeight: 360 });
 */
export function parseMPCsv(
  csv: string,
  opts: {
    fps?: number;
    imageWidth?: number;
    imageHeight?: number;
    layout?: MPCsvLayout;
    skipHeader?: boolean;
  } = {},
): { frames: PoseFrame[]; labels: (string | undefined)[] } {
  const {
    fps = 30,
    imageWidth,
    imageHeight,
    layout,
    skipHeader = true,
  } = opts;

  const lines = csv.trim().split(/\r?\n/);
  const dataLines = skipHeader ? lines.slice(1) : lines;

  const frames: PoseFrame[] = [];
  const labels: (string | undefined)[] = [];

  dataLines.forEach((line, idx) => {
    if (!line.trim()) return;
    const cols = line.split(",");
    try {
      const { label, pose } = parseMPCsvRow(cols, layout, imageWidth, imageHeight);
      frames.push(mpToCoco(pose, idx / fps));
      labels.push(label);
    } catch {
      // Skip malformed rows silently
    }
  });

  return { frames, labels };
}

// ─── Replay helper ────────────────────────────────────────────────────────────

/**
 * Creates a function that replays a sequence of PoseFrames at real-time speed.
 * Call the returned function with the current wall-clock time (seconds) to get
 * the appropriate frame — useful for injecting pre-recorded data into the
 * existing getMockFrame / controlledFrame pipeline.
 *
 * @example
 *   const replay = createReplay(frames, { fps: 30, loop: true });
 *   // In SimulationPanel or SkeletonCanvas:
 *   const frame = replay(Date.now() / 1000);
 */
export function createReplay(
  frames: PoseFrame[],
  opts: { fps?: number; loop?: boolean } = {},
): (wallTimeSec: number) => PoseFrame {
  const { fps = 30, loop = true } = opts;
  const startWall = Date.now() / 1000;

  return (wallTimeSec: number) => {
    const elapsed = wallTimeSec - startWall;
    let idx = Math.floor(elapsed * fps);
    if (loop) {
      idx = ((idx % frames.length) + frames.length) % frames.length;
    } else {
      idx = Math.min(idx, frames.length - 1);
    }
    return frames[idx];
  };
}
