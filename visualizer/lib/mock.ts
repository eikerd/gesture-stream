import { type PoseFrame, COCO_KEYPOINT_NAMES } from "./pose";

// ─── Exercise registry ────────────────────────────────────────────────────────

export type ExerciseId =
  | "jumping-jacks"
  | "wall-sit"
  | "push-up"
  | "ab-crunch"
  | "step-up"
  | "squat"
  | "tricep-dip"
  | "plank"
  | "high-knees"
  | "lunge"
  | "push-up-rotation"
  | "side-plank";

export interface Exercise {
  id: ExerciseId;
  label: string;
  order: number;
}

export const SEVEN_MINUTE_EXERCISES: Exercise[] = [
  { id: "jumping-jacks",    label: "Jumping Jacks",       order: 1 },
  { id: "wall-sit",         label: "Wall Sit",             order: 2 },
  { id: "push-up",          label: "Push-up",              order: 3 },
  { id: "ab-crunch",        label: "Ab Crunch",            order: 4 },
  { id: "step-up",          label: "Step-up",              order: 5 },
  { id: "squat",            label: "Squat",                order: 6 },
  { id: "tricep-dip",       label: "Tricep Dip",           order: 7 },
  { id: "plank",            label: "Plank",                order: 8 },
  { id: "high-knees",       label: "High Knees",           order: 9 },
  { id: "lunge",            label: "Lunge",                order: 10 },
  { id: "push-up-rotation", label: "Push-up & Rotation",  order: 11 },
  { id: "side-plank",       label: "Side Plank",           order: 12 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth 0→1→0 pulse at given Hz */
const pulse = (t: number, hz: number) => (1 - Math.cos(2 * Math.PI * t * hz)) / 2;

/** Smooth -1→1 sine at given Hz */
const osc = (t: number, hz: number, phase = 0) => Math.sin(2 * Math.PI * t * hz + phase);

/** Head cluster around (cx, cy), facing forward */
function head(cx: number, cy: number): [number, number][] {
  return [
    [cx,        cy],        // nose
    [cx - 0.03, cy - 0.02], // left_eye
    [cx + 0.03, cy - 0.02], // right_eye
    [cx - 0.06, cy - 0.01], // left_ear
    [cx + 0.06, cy - 0.01], // right_ear
  ];
}

type KP17 = [[number,number],[number,number],[number,number],[number,number],[number,number],
             [number,number],[number,number],[number,number],[number,number],[number,number],
             [number,number],[number,number],[number,number],[number,number],[number,number],
             [number,number],[number,number]];

// ─── Exercise generators ──────────────────────────────────────────────────────
// Each returns 17 [x, y] pairs in COCO keypoint order.
// Coordinates: x=0 left, x=1 right; y=0 top, y=1 bottom.

/** 1. Jumping Jacks — arms sweep up/down, legs spread/together */
function jumpingJacks(t: number): [number, number][] {
  const u = pulse(t, 1.3);
  const lElbX = lerp(0.35, 0.20, u), lElbY = lerp(0.42, 0.18, u);
  const rElbX = lerp(0.65, 0.80, u), rElbY = lerp(0.42, 0.18, u);
  const lWrX  = lerp(0.30, 0.14, u), lWrY  = lerp(0.56, 0.08, u);
  const rWrX  = lerp(0.70, 0.86, u), rWrY  = lerp(0.56, 0.08, u);
  const lKnX  = lerp(0.44, 0.36, u);
  const rKnX  = lerp(0.56, 0.64, u);
  const lAnX  = lerp(0.44, 0.28, u);
  const rAnX  = lerp(0.56, 0.72, u);
  const bobY  = -0.015 * u; // slight upward bounce
  return [
    ...head(0.5, 0.12 + bobY),
    [0.42, 0.28 + bobY], [0.58, 0.28 + bobY],  // shoulders
    [lElbX, lElbY + bobY], [rElbX, rElbY + bobY],
    [lWrX,  lWrY  + bobY], [rWrX,  rWrY  + bobY],
    [0.44, 0.56 + bobY],  [0.56, 0.56 + bobY],  // hips
    [lKnX, 0.72 + bobY],  [rKnX, 0.72 + bobY],
    [lAnX, 0.88 + bobY],  [rAnX, 0.88 + bobY],
  ] as [number,number][];
}

/** 2. Wall Sit — deep static squat, slight quad tremor */
function wallSit(t: number): [number, number][] {
  const tremor = 0.006 * osc(t, 4.0); // 4 Hz trembling
  return [
    ...head(0.5, 0.30),
    [0.42, 0.44], [0.58, 0.44],              // shoulders (lower)
    [0.38, 0.52], [0.62, 0.52],              // elbows on thighs
    [0.40, 0.62], [0.60, 0.62],              // wrists on knees
    [0.42, 0.60], [0.58, 0.60],              // hips (low — at knee height)
    [0.38, 0.60 + tremor], [0.62, 0.60 + tremor], // knees bent forward
    [0.38, 0.85], [0.62, 0.85],              // ankles below knees
  ] as [number,number][];
}

/** 3. Push-up — horizontal body, elbow flex/extend (side view) */
function pushUp(t: number): [number, number][] {
  const u = pulse(t, 0.55);
  // Body horizontal: head left, feet right
  // "Down" (u=1): elbows bent, chest near floor
  // "Up" (u=0): arms extended
  const armExtendY = lerp(0.44, 0.54, u); // chest height
  const elbY = lerp(0.38, 0.48, u);
  return [
    ...head(0.14, 0.48),
    [0.26, 0.42], [0.26, 0.52],              // shoulders L/R (depth offset)
    [0.24, elbY], [0.24, armExtendY],        // elbows
    [0.18, elbY + 0.02], [0.18, armExtendY + 0.02], // wrists
    [0.60, 0.42], [0.60, 0.52],              // hips
    [0.73, 0.42], [0.73, 0.52],              // knees
    [0.86, 0.43], [0.86, 0.53],              // ankles
  ] as [number,number][];
}

/** 4. Ab Crunch — lying, knees up, torso curls toward knees */
function abCrunch(t: number): [number, number][] {
  const u = pulse(t, 0.6);
  // Head rises (x decreases toward knees) during crunch
  const hx = lerp(0.12, 0.22, u);
  const shoulderY = lerp(0.48, 0.44, u);
  return [
    ...head(hx, 0.45),
    [0.22, shoulderY], [0.22, 0.52],         // shoulders
    [0.30, shoulderY + 0.04], [0.30, 0.56],  // elbows (behind head)
    [0.34, shoulderY + 0.03], [0.34, 0.57],  // wrists (hands behind head)
    [0.55, 0.48], [0.55, 0.52],              // hips
    [0.58, 0.36], [0.58, 0.40],              // knees bent up
    [0.60, 0.30], [0.60, 0.34],              // ankles (feet raised)
  ] as [number,number][];
}

/** 5. Step-up — upright, alternating deliberate knee lifts */
function stepUp(t: number): [number, number][] {
  // Alternate legs at 0.8 Hz, arms swing opposite
  const leftUp  = Math.max(0, osc(t, 0.8, 0));
  const rightUp = Math.max(0, osc(t, 0.8, Math.PI));
  const lKnY = lerp(0.72, 0.38, leftUp);
  const rKnY = lerp(0.72, 0.38, rightUp);
  const lAnY = lerp(0.88, 0.50, leftUp);
  const rAnY = lerp(0.88, 0.50, rightUp);
  // Arms swing counter to legs
  const lElbX = lerp(0.37, 0.32, rightUp), lElbY = lerp(0.42, 0.35, rightUp);
  const rElbX = lerp(0.63, 0.68, leftUp),  rElbY = lerp(0.42, 0.35, leftUp);
  return [
    ...head(0.5, 0.12),
    [0.42, 0.28], [0.58, 0.28],
    [lElbX, lElbY], [rElbX, rElbY],
    [lerp(0.33, 0.28, rightUp), lerp(0.52, 0.42, rightUp)],
    [lerp(0.67, 0.72, leftUp),  lerp(0.52, 0.42, leftUp)],
    [0.44, 0.56], [0.56, 0.56],
    [0.44, lKnY], [0.56, rKnY],
    [0.44, lAnY], [0.56, rAnY],
  ] as [number,number][];
}

/** 6. Squat — deep knee/hip bend, arms extended forward */
function squat(t: number): [number, number][] {
  const u = pulse(t, 0.6);
  // Body drops: nose goes from 0.12 to 0.34, hips drop to knee level
  const bodyDrop = lerp(0, 0.20, u);
  const kneeSpread = lerp(0, 0.06, u);
  const armRaise = lerp(0, 0.12, u);
  return [
    ...head(0.5, 0.12 + bodyDrop),
    [0.42, 0.28 + bodyDrop], [0.58, 0.28 + bodyDrop],
    [0.37, 0.40 + bodyDrop - armRaise], [0.63, 0.40 + bodyDrop - armRaise], // elbows raise
    [0.34, 0.38 + bodyDrop - armRaise], [0.66, 0.38 + bodyDrop - armRaise], // wrists forward
    [0.44 - kneeSpread, 0.56 + bodyDrop], [0.56 + kneeSpread, 0.56 + bodyDrop], // hips drop
    [0.40 - kneeSpread, 0.72 + bodyDrop * 0.4], [0.60 + kneeSpread, 0.72 + bodyDrop * 0.4],
    [0.40 - kneeSpread, 0.88], [0.60 + kneeSpread, 0.88],
  ] as [number,number][];
}

/** 7. Tricep Dip — seated, hips lower/raise, elbows bend behind */
function tricepDip(t: number): [number, number][] {
  const u = pulse(t, 0.55);
  // Hips lower (u=1), arms bend more
  const hipY  = lerp(0.62, 0.74, u);
  const elbY  = lerp(0.46, 0.56, u);
  return [
    ...head(0.5, 0.30),
    [0.42, 0.44], [0.58, 0.44],            // shoulders
    [0.34, elbY], [0.66, elbY],            // elbows behind/below hips
    [0.30, elbY + 0.08], [0.70, elbY + 0.08], // wrists (hands on surface)
    [0.44, hipY], [0.56, hipY],            // hips (floating, dipping)
    [0.42, 0.74], [0.58, 0.74],            // knees (bent at ~90°)
    [0.42, 0.88], [0.58, 0.88],            // ankles
  ] as [number,number][];
}

/** 8. Plank — horizontal static hold, tiny core wobble */
function plank(t: number): [number, number][] {
  const wobble = 0.008 * osc(t, 0.3); // very slow wobble
  return [
    ...head(0.14, 0.46),
    [0.26, 0.42], [0.26, 0.50],
    [0.22, 0.40 + wobble], [0.22, 0.48 + wobble],
    [0.18, 0.42 + wobble], [0.18, 0.50 + wobble],
    [0.60, 0.42 + wobble], [0.60, 0.50 + wobble],
    [0.73, 0.43 + wobble], [0.73, 0.51 + wobble],
    [0.86, 0.44], [0.86, 0.52],
  ] as [number,number][];
}

/** 9. High Knees — rapid alternating knee lifts with arm drive */
function highKnees(t: number): [number, number][] {
  const leftUp  = Math.max(0, osc(t, 2.4, 0));
  const rightUp = Math.max(0, osc(t, 2.4, Math.PI));
  const lKnY = lerp(0.72, 0.35, leftUp);
  const rKnY = lerp(0.72, 0.35, rightUp);
  const lAnY = lerp(0.88, 0.46, leftUp);
  const rAnY = lerp(0.88, 0.46, rightUp);
  // Arms pump high opposite to legs
  const lElbY = lerp(0.42, 0.28, rightUp);
  const rElbY = lerp(0.42, 0.28, leftUp);
  const lWrY  = lerp(0.52, 0.20, rightUp);
  const rWrY  = lerp(0.52, 0.20, leftUp);
  return [
    ...head(0.5, 0.11),
    [0.42, 0.27], [0.58, 0.27],
    [0.37, lElbY], [0.63, rElbY],
    [0.35, lWrY],  [0.65, rWrY],
    [0.44, 0.54],  [0.56, 0.54],
    [0.44, lKnY],  [0.56, rKnY],
    [0.44, lAnY],  [0.56, rAnY],
  ] as [number,number][];
}

/** 10. Lunge — alternating forward lunge, deep front knee bend */
function lunge(t: number): [number, number][] {
  // Alternate sides every ~1.5s
  const side  = Math.sin(2 * Math.PI * t * 0.35) > 0 ? 1 : -1; // 1=left forward, -1=right forward
  const depth = pulse(t, 0.7);
  // Forward leg: knee deep forward, back leg extended behind
  const fwdKnX = side > 0 ? 0.36 : 0.64, bkKnX = side > 0 ? 0.58 : 0.42;
  const fwdAnX = side > 0 ? 0.32 : 0.68, bkAnX = side > 0 ? 0.56 : 0.44;
  const fwdKnY = lerp(0.72, 0.68, depth);
  const bkKnY  = lerp(0.72, 0.80, depth);
  const bodyDrop = lerp(0, 0.08, depth);
  return [
    ...head(0.5, 0.12 + bodyDrop),
    [0.42, 0.28 + bodyDrop], [0.58, 0.28 + bodyDrop],
    [0.37, 0.42 + bodyDrop], [0.63, 0.42 + bodyDrop],
    [0.33, 0.52 + bodyDrop], [0.67, 0.52 + bodyDrop],
    [0.44, 0.55 + bodyDrop], [0.56, 0.55 + bodyDrop],
    [fwdKnX, fwdKnY + bodyDrop], [bkKnX, bkKnY + bodyDrop],
    [fwdAnX, 0.86],              [bkAnX,  0.82],
  ] as [number,number][];
}

/** 11. Push-up + Rotation — push-up then side twist with one arm up */
function pushUpRotation(t: number): [number, number][] {
  const cycle   = (t * 0.35) % 1; // full cycle: push-up → rotate → push-up
  const isPush  = cycle < 0.5;
  const phase   = isPush ? cycle * 2 : (cycle - 0.5) * 2;
  const u = (1 - Math.cos(phase * Math.PI)) / 2;
  if (isPush) {
    // Push-up phase
    const elbY = lerp(0.38, 0.48, u);
    return [
      ...head(0.14, 0.48),
      [0.26, 0.42], [0.26, 0.52],
      [0.24, elbY], [0.24, elbY + 0.08],
      [0.18, elbY + 0.02], [0.18, elbY + 0.10],
      [0.60, 0.42], [0.60, 0.52],
      [0.73, 0.42], [0.73, 0.52],
      [0.86, 0.43], [0.86, 0.53],
    ] as [number,number][];
  } else {
    // Rotation phase: rise to side plank, one arm twists up
    const armUpY = lerp(0.38, 0.14, u);
    const armUpX = lerp(0.24, 0.26, u);
    return [
      ...head(0.14, 0.46),
      [0.26, 0.42], [0.26, 0.50],
      [armUpX, armUpY], [0.26, 0.52],     // left arm rises
      [armUpX - 0.04, armUpY - 0.06], [0.22, 0.52], // left wrist up
      [0.60, 0.44], [0.60, 0.50],
      [0.73, 0.44], [0.73, 0.50],
      [0.86, 0.44], [0.86, 0.52],
    ] as [number,number][];
  }
}

/** 12. Side Plank — body diagonal, one arm raised, slight balance wobble */
function sidePlank(t: number): [number, number][] {
  const wobble = 0.01 * osc(t, 0.5);
  // Body diagonal: head left-high, feet right-low
  // Right arm extended to floor; left arm raised
  return [
    ...head(0.14, 0.36 + wobble),
    [0.24, 0.42 + wobble], [0.28, 0.50 + wobble], // shoulders (diagonal)
    [0.22, 0.30 + wobble], [0.30, 0.56 + wobble], // elbows: L up, R to floor
    [0.20, 0.22 + wobble], [0.28, 0.62 + wobble], // wrists: L raised, R on floor
    [0.50, 0.54 + wobble], [0.54, 0.60 + wobble], // hips
    [0.64, 0.62 + wobble], [0.68, 0.66 + wobble], // knees
    [0.78, 0.68 + wobble], [0.82, 0.72 + wobble], // ankles
  ] as [number,number][];
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

const GENERATORS: Record<ExerciseId, (t: number) => [number, number][]> = {
  "jumping-jacks":    jumpingJacks,
  "wall-sit":         wallSit,
  "push-up":          pushUp,
  "ab-crunch":        abCrunch,
  "step-up":          stepUp,
  "squat":            squat,
  "tricep-dip":       tricepDip,
  "plank":            plank,
  "high-knees":       highKnees,
  "lunge":            lunge,
  "push-up-rotation": pushUpRotation,
  "side-plank":       sidePlank,
};

export function generateMockFrame(exercise: ExerciseId = "jumping-jacks", t?: number): PoseFrame {
  const now = t ?? Date.now() / 1000;
  const positions = GENERATORS[exercise](now);

  const keypoints = COCO_KEYPOINT_NAMES.map((name, i) => {
    const [x, y] = positions[i] ?? [0.5, 0.5];
    const baseScore = i < 5 ? 0.88 : i < 11 ? 0.83 : 0.76;
    const score = Math.min(1, Math.max(0.4, baseScore + 0.07 * Math.sin(now * 0.4 + i)));
    return { name, x, y, score };
  });

  return { ts: now, keypoints };
}

/** Legacy: default to jumping jacks for backward compat */
export const generateDefaultMockFrame = () => generateMockFrame("jumping-jacks");
