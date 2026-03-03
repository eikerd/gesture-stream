import { type PoseFrame, COCO_KEYPOINT_NAMES } from "./pose";
import { type ExerciseId } from "./mock";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SimulationVariant = "good" | "bad";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth ease-in-out, maps t∈[0,1] → [0,1] */
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Head cluster: [nose, left_eye, right_eye, left_ear, right_ear] */
function head(cx: number, cy: number): [number, number][] {
  return [
    [cx, cy],
    [cx - 0.03, cy - 0.02],
    [cx + 0.03, cy - 0.02],
    [cx - 0.06, cy - 0.01],
    [cx + 0.06, cy - 0.01],
  ];
}

/** Rep duration in seconds — ~2.5s per rep = ~24 reps/min */
const REP_DURATION = 2.5;

/** Normalized phase within current rep, 0-1 */
function repPhase(t: number): number {
  return (t % REP_DURATION) / REP_DURATION;
}

/**
 * Smooth triangle wave: rises 0→1 in first half, falls 1→0 in second half.
 * Using smooth() on each half for ease-in-out.
 */
function repCycle(t: number): number {
  const p = repPhase(t);
  if (p < 0.5) return smooth(p * 2);
  return smooth((1 - p) * 2);
}

type KP17 = [
  [number, number], [number, number], [number, number], [number, number], [number, number],
  [number, number], [number, number], [number, number], [number, number], [number, number],
  [number, number], [number, number], [number, number], [number, number], [number, number],
  [number, number], [number, number],
];

// ─── Exercise simulations ─────────────────────────────────────────────────────

/**
 * Squat simulation.
 * Good: deep squat, knee angle ~85°, proper alignment.
 * Bad: shallow squat (knee angle ~130°), knees cave inward.
 */
function simSquat(t: number, variant: SimulationVariant): [number, number][] {
  const u = repCycle(t);

  // Good: body drops 0.22, knees spread naturally
  // Bad: body only drops 0.10, knees cave inward by 0.08
  const bodyDrop = variant === "good" ? lerp(0, 0.22, u) : lerp(0, 0.10, u);
  const kneeSpread = variant === "good" ? lerp(0, 0.05, u) : lerp(0, -0.04, u); // negative = cave inward
  const armRaise = lerp(0, 0.14, u);

  // Knee x positions
  const lKnX = 0.40 - kneeSpread;
  const rKnX = 0.60 + kneeSpread;

  return [
    ...head(0.5, 0.12 + bodyDrop),
    [0.42, 0.28 + bodyDrop], [0.58, 0.28 + bodyDrop],                          // shoulders
    [0.37, 0.40 + bodyDrop - armRaise], [0.63, 0.40 + bodyDrop - armRaise],    // elbows
    [0.34, 0.38 + bodyDrop - armRaise], [0.66, 0.38 + bodyDrop - armRaise],    // wrists
    [0.44, 0.56 + bodyDrop], [0.56, 0.56 + bodyDrop],                          // hips
    [lKnX, 0.72 + bodyDrop * 0.35], [rKnX, 0.72 + bodyDrop * 0.35],           // knees
    [lKnX, 0.88], [rKnX, 0.88],                                                 // ankles (stay planted)
  ] as [number, number][];
}

/**
 * Push-up simulation (side view).
 * Good: chest nearly touches floor, elbow angle ~80°.
 * Bad: hips sag during down phase, only reaches ~100° elbow angle.
 */
function simPushUp(t: number, variant: SimulationVariant): [number, number][] {
  const u = repCycle(t);

  // Good: full depth (chest drops to floor level)
  // Bad: hips sag (hip y rises) and arms only partially bend
  const armDrop = variant === "good" ? lerp(0, 0.12, u) : lerp(0, 0.06, u);

  // Hip sag on bad form: hips drop below body line during down phase
  const hipSag = variant === "bad" ? lerp(0, 0.06, u) : 0;

  return [
    ...head(0.14, 0.48),
    [0.26, 0.42], [0.26, 0.52],                                                 // shoulders
    [0.24, 0.38 + armDrop], [0.24, 0.46 + armDrop],                            // elbows
    [0.18, 0.40 + armDrop], [0.18, 0.48 + armDrop],                            // wrists
    [0.60, 0.42 + hipSag], [0.60, 0.52 + hipSag],                              // hips
    [0.73, 0.42], [0.73, 0.52],                                                 // knees
    [0.86, 0.43], [0.86, 0.53],                                                 // ankles
  ] as [number, number][];
}

/**
 * Lunge simulation.
 * Good: front knee bends to ~90°, proper alignment.
 * Bad: front knee barely bends (stays at ~130°), insufficient depth.
 */
function simLunge(t: number, variant: SimulationVariant): [number, number][] {
  const u = repCycle(t);

  // Alternate sides every 2 reps
  const repIndex = Math.floor(t / REP_DURATION);
  const side = repIndex % 2 === 0 ? 1 : -1; // 1=left forward, -1=right forward

  // Good: deep lunge, bodyDrop=0.12
  // Bad: shallow lunge, bodyDrop=0.05
  const bodyDrop = variant === "good" ? lerp(0, 0.12, u) : lerp(0, 0.05, u);

  // Forward knee x: good stays over ankle, bad pushes past it slightly
  const fwdKnX = side > 0 ? 0.36 : 0.64;
  const bkKnX = side > 0 ? 0.58 : 0.42;
  const fwdAnX = side > 0 ? 0.32 : 0.68;
  const bkAnX = side > 0 ? 0.60 : 0.40;

  // Forward knee y: good goes low (0.68), bad stays high (0.73)
  const fwdKnY = variant === "good"
    ? lerp(0.72, 0.68, u)
    : lerp(0.72, 0.73, u); // barely bends

  const bkKnY = lerp(0.72, 0.80, u);

  return [
    ...head(0.5, 0.12 + bodyDrop),
    [0.42, 0.28 + bodyDrop], [0.58, 0.28 + bodyDrop],
    [0.37, 0.42 + bodyDrop], [0.63, 0.42 + bodyDrop],
    [0.33, 0.52 + bodyDrop], [0.67, 0.52 + bodyDrop],
    [0.44, 0.55 + bodyDrop], [0.56, 0.55 + bodyDrop],
    [fwdKnX, fwdKnY + bodyDrop], [bkKnX, bkKnY + bodyDrop],
    [fwdAnX, 0.86], [bkAnX, 0.82],
  ] as [number, number][];
}

/**
 * High knees simulation.
 * Good: knee rises well above hip.
 * Bad: knees only lift 40% of proper height.
 */
function simHighKnees(t: number, variant: SimulationVariant): [number, number][] {
  // Alternate legs: left up when phase < 0.5, right up when phase >= 0.5
  const p = repPhase(t);
  const leftPhase = p < 0.5 ? smooth(p * 2) : smooth((1 - p) * 2);
  const rightPhase = p >= 0.5 ? smooth((p - 0.5) * 2) : smooth((0.5 - p) * 2);

  // Good: knee lifts from 0.72 to 0.35 (lift = 0.37)
  // Bad: knee only lifts from 0.72 to 0.57 (lift = 0.15, ~40% of proper)
  const lKnYFull = variant === "good" ? 0.35 : 0.57;
  const rKnYFull = variant === "good" ? 0.35 : 0.57;

  const lKnY = lerp(0.72, lKnYFull, leftPhase);
  const rKnY = lerp(0.72, rKnYFull, rightPhase);
  const lAnY = lerp(0.88, lKnYFull + 0.14, leftPhase);
  const rAnY = lerp(0.88, rKnYFull + 0.14, rightPhase);

  // Arms pump opposite to legs
  const lElbY = lerp(0.42, 0.28, rightPhase);
  const rElbY = lerp(0.42, 0.28, leftPhase);
  const lWrY = lerp(0.52, 0.20, rightPhase);
  const rWrY = lerp(0.52, 0.20, leftPhase);

  return [
    ...head(0.5, 0.11),
    [0.42, 0.27], [0.58, 0.27],
    [0.37, lElbY], [0.63, rElbY],
    [0.35, lWrY], [0.65, rWrY],
    [0.44, 0.54], [0.56, 0.54],
    [0.44, lKnY], [0.56, rKnY],
    [0.44, lAnY], [0.56, rAnY],
  ] as [number, number][];
}

/**
 * Jumping jacks simulation.
 * Good: arms reach fully overhead (arm angle > 120°).
 * Bad: arms only reach 60° (half raise).
 */
function simJumpingJacks(t: number, variant: SimulationVariant): [number, number][] {
  const u = repCycle(t);

  // Good: full raise, elbows go from 0.42 to 0.18 y, wide x spread
  // Bad: partial raise, elbows only go to 0.30 y
  const lElbXBase = 0.35, lElbXFull = 0.20;
  const rElbXBase = 0.65, rElbXFull = 0.80;
  const lElbYBase = 0.42;
  const lElbYFull = variant === "good" ? 0.18 : 0.30;
  const lWrYBase = 0.56;
  const lWrYFull = variant === "good" ? 0.08 : 0.28;

  const lElbX = lerp(lElbXBase, lElbXFull, u);
  const rElbX = lerp(rElbXBase, rElbXFull, u);
  const lElbY = lerp(lElbYBase, lElbYFull, u);
  const rElbY = lerp(lElbYBase, lElbYFull, u);
  const lWrX = lerp(0.30, variant === "good" ? 0.14 : 0.22, u);
  const rWrX = lerp(0.70, variant === "good" ? 0.86 : 0.78, u);
  const lWrY = lerp(lWrYBase, lWrYFull, u);
  const rWrY = lerp(lWrYBase, lWrYFull, u);

  // Legs spread on good, partial spread on bad
  const lKnX = lerp(0.44, variant === "good" ? 0.36 : 0.41, u);
  const rKnX = lerp(0.56, variant === "good" ? 0.64 : 0.59, u);
  const lAnX = lerp(0.44, variant === "good" ? 0.28 : 0.38, u);
  const rAnX = lerp(0.56, variant === "good" ? 0.72 : 0.62, u);

  const bobY = -0.015 * u;

  return [
    ...head(0.5, 0.12 + bobY),
    [0.42, 0.28 + bobY], [0.58, 0.28 + bobY],
    [lElbX, lElbY + bobY], [rElbX, rElbY + bobY],
    [lWrX, lWrY + bobY], [rWrX, rWrY + bobY],
    [0.44, 0.56 + bobY], [0.56, 0.56 + bobY],
    [lKnX, 0.72 + bobY], [rKnX, 0.72 + bobY],
    [lAnX, 0.88 + bobY], [rAnX, 0.88 + bobY],
  ] as [number, number][];
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

type SimGenerator = (t: number, variant: SimulationVariant) => [number, number][];

const SIM_GENERATORS: Partial<Record<ExerciseId, SimGenerator>> = {
  squat: simSquat,
  "push-up": simPushUp,
  lunge: simLunge,
  "high-knees": simHighKnees,
  "jumping-jacks": simJumpingJacks,
};

export function generateSimFrame(
  exercise: ExerciseId,
  variant: SimulationVariant,
  t: number
): PoseFrame {
  const generator = SIM_GENERATORS[exercise];

  let positions: [number, number][];
  if (generator) {
    positions = generator(t, variant);
  } else {
    // Fallback: neutral standing pose
    positions = [
      ...head(0.5, 0.12),
      [0.42, 0.28], [0.58, 0.28],
      [0.38, 0.40], [0.62, 0.40],
      [0.35, 0.52], [0.65, 0.52],
      [0.44, 0.56], [0.56, 0.56],
      [0.44, 0.72], [0.56, 0.72],
      [0.44, 0.88], [0.56, 0.88],
    ] as [number, number][];
  }

  const keypoints = COCO_KEYPOINT_NAMES.map((name, i) => {
    const [x, y] = positions[i] ?? [0.5, 0.5];
    return { name, x, y, score: 0.85 };
  });

  return { ts: t, keypoints };
}
