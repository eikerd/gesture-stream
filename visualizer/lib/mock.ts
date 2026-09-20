import { type PoseFrame, COCO_KEYPOINT_NAMES } from "./pose";
import { createReplay } from "./mediapipe";

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

// ─── Motion utilities ─────────────────────────────────────────────────────────

/** Cubic ease-in-out (smoothstep). Input must be [0,1]. */
const smoothstep = (x: number): number => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};

/** Symmetric 0→1→0 rep driver, eased. One full cycle per 1/hz seconds. */
function repPhase(t: number, hz: number, phaseOffset = 0): number {
  const p = ((t * hz + phaseOffset) % 1 + 1) % 1; // [0,1)
  // Remap: spend 45% descending, 10% at bottom, 45% ascending
  if (p < 0.45) return smoothstep(p / 0.45);
  if (p < 0.55) return 1;
  return smoothstep(1 - (p - 0.55) / 0.45);
}

/** Slow breathing oscillation (~0.2 Hz), returns y-offset. */
const breathe = (t: number): number => 0.004 * Math.sin(2 * Math.PI * 0.2 * t);

/**
 * Pseudo-natural noise from summed incommensurable sines.
 * seed keeps different keypoints independent; amp ~0.002–0.004 is realistic.
 */
function jitter(t: number, seed: number, amp = 0.003): number {
  return amp * (
    Math.sin(t * 17.31 + seed) * 0.50 +
    Math.sin(t * 43.70 + seed * 1.3) * 0.30 +
    Math.sin(t * 97.20 + seed * 2.1) * 0.15 +
    Math.sin(t * 153.9 + seed * 0.7) * 0.05
  );
}

/** Linear interpolation */
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

// ─── Canonical neutral skeleton (17 COCO keypoints) ───────────────────────────
//
// Front-facing upright standing pose. All coordinates normalised 0→1.
// x: 0=left-of-frame, 1=right; y: 0=top, 1=bottom.
// Limb lengths are fixed here and preserved via keyframe blending.
//
// Measured proportions (per 1.7m adult, scaled to ~0.82 canvas height):
//   SHIN = THIGH ≈ 0.19   TORSO ≈ 0.26   UPPER_ARM ≈ 0.14   FOREARM ≈ 0.12
//
const STAND: [number,number][] = [
  [0.500, 0.085], // 0  nose
  [0.473, 0.072], // 1  left_eye
  [0.527, 0.072], // 2  right_eye
  [0.447, 0.078], // 3  left_ear
  [0.553, 0.078], // 4  right_ear
  [0.406, 0.235], // 5  left_shoulder
  [0.594, 0.235], // 6  right_shoulder
  [0.357, 0.375], // 7  left_elbow
  [0.643, 0.375], // 8  right_elbow
  [0.344, 0.505], // 9  left_wrist
  [0.656, 0.505], // 10 right_wrist
  [0.428, 0.510], // 11 left_hip
  [0.572, 0.510], // 12 right_hip
  [0.422, 0.690], // 13 left_knee
  [0.578, 0.690], // 14 right_knee
  [0.414, 0.878], // 15 left_ankle
  [0.586, 0.878], // 16 right_ankle
];

/** Blend two 17-kp poses elementwise by factor u ∈ [0,1]. */
function blend(
  a: [number,number][],
  b: [number,number][],
  u: number
): [number,number][] {
  return a.map(([ax,ay], i) => [
    lerp(ax, b[i][0], u),
    lerp(ay, b[i][1], u),
  ]) as [number,number][];
}

/** Add per-keypoint noise + breathing to a pose array. */
function addMotion(
  pts: [number,number][],
  t: number,
  noiseAmp = 0.003,
  breatheScale = 1.0
): [number,number][] {
  const by = breathe(t) * breatheScale;
  return pts.map(([x, y], i) => [
    x + jitter(t, i * 7.41, noiseAmp),
    y + jitter(t, i * 3.17 + 100, noiseAmp) + by,
  ]) as [number,number][];
}

// ─── Exercise key poses ───────────────────────────────────────────────────────
// Biometrically grounded positions from Zengin thresholds.
// Each generator returns a [number,number][] of 17 COCO keypoints.

/** 1. Jumping Jacks  — arms overhead + legs spread (Zengin: 1.3 Hz) */
function jumpingJacks(t: number): [number,number][] {
  const OPEN: [number,number][] = [
    [0.500, 0.080], // nose (slight jump)
    [0.473, 0.067],
    [0.527, 0.067],
    [0.447, 0.073],
    [0.553, 0.073],
    [0.380, 0.200], // shoulders rise slightly
    [0.620, 0.200],
    [0.265, 0.115], // elbows high & wide (≥150° arm angle)
    [0.735, 0.115],
    [0.210, 0.065], // wrists fully overhead
    [0.790, 0.065],
    [0.428, 0.500], // hips — no vertical change
    [0.572, 0.500],
    [0.370, 0.693], // knees spread wide
    [0.630, 0.693],
    [0.308, 0.873], // ankles spread
    [0.692, 0.873],
  ];
  const u = repPhase(t, 1.3);
  return addMotion(blend(STAND, OPEN, u), t, 0.003, 0.6);
}

/**
 * 2. Wall Sit — SIDE VIEW, person facing right, back flat against wall (left edge).
 * Classic 90° knee: thighs parallel to floor, shins vertical.
 * This view makes the knee angle immediately obvious.
 */
function wallSit(t: number): [number,number][] {
  // Wall is at x≈0.12. Person faces right.
  // Near-camera side = left landmarks; far side = right landmarks (slight +x,+y offset).
  const SIT: [number,number][] = [
    [0.215, 0.280], // nose
    [0.215, 0.265],
    [0.225, 0.268], // right eye (far side, slightly right)
    [0.201, 0.271], // left ear
    [0.228, 0.274], // right ear
    [0.175, 0.420], // left shoulder (against wall)
    [0.200, 0.435], // right shoulder (depth offset)
    [0.380, 0.440], // left elbow (arm resting on thigh)
    [0.405, 0.455],
    [0.460, 0.448], // left wrist (on knee)
    [0.485, 0.463],
    [0.175, 0.630], // left hip (back against wall, low)
    [0.200, 0.645], // right hip
    [0.490, 0.638], // left knee (thigh is horizontal → knee far from hip in x)
    [0.515, 0.653], // right knee
    [0.490, 0.876], // left ankle (shin vertical → ankle directly below knee)
    [0.515, 0.876], // right ankle
  ];
  // Subtle quad tremor at 3.5 Hz
  const tremor = 0.005 * Math.sin(2 * Math.PI * 3.5 * t);
  const pts = addMotion(SIT, t, 0.0022, 0.15);
  pts[13][1] += tremor;
  pts[14][1] += tremor;
  return pts;
}

/** 3. Push-up — horizontal, elbow flex/extend (Zengin: 0.55 Hz) */
function pushUp(t: number): [number,number][] {
  // Side view: head left, feet right; body horizontal ~y=0.45
  // "Up" = arms extended (elbow ~150°), "Down" = chest near floor (elbow ~70°)
  const UP: [number,number][] = [
    [0.130, 0.440], // nose
    [0.130, 0.424],
    [0.130, 0.456],
    [0.116, 0.430],
    [0.116, 0.450],
    [0.240, 0.395], // left shoulder
    [0.240, 0.470], // right shoulder (depth-offset)
    [0.215, 0.360], // left elbow — arms extended upward
    [0.215, 0.435],
    [0.190, 0.355], // left wrist (on floor)
    [0.190, 0.430],
    [0.590, 0.408], // left hip
    [0.590, 0.462],
    [0.720, 0.412], // left knee
    [0.720, 0.466],
    [0.850, 0.418], // left ankle
    [0.850, 0.472],
  ];
  const DOWN: [number,number][] = [
    [0.130, 0.495],
    [0.130, 0.479],
    [0.130, 0.511],
    [0.116, 0.485],
    [0.116, 0.505],
    [0.240, 0.458], // shoulders drop
    [0.240, 0.532],
    [0.225, 0.432], // elbows bent ~70°
    [0.225, 0.506],
    [0.190, 0.355], // wrists fixed on floor
    [0.190, 0.430],
    [0.590, 0.408],
    [0.590, 0.462],
    [0.720, 0.412],
    [0.720, 0.466],
    [0.850, 0.418],
    [0.850, 0.472],
  ];
  const u = repPhase(t, 0.55);
  return addMotion(blend(UP, DOWN, u), t, 0.003, 0.3);
}

/** 4. Ab Crunch — supine, knees up, torso curls */
function abCrunch(t: number): [number,number][] {
  const REST: [number,number][] = [
    [0.100, 0.480],
    [0.100, 0.464],
    [0.100, 0.496],
    [0.086, 0.470],
    [0.086, 0.490],
    [0.220, 0.480],
    [0.220, 0.530],
    [0.310, 0.475],
    [0.310, 0.525],
    [0.360, 0.470],
    [0.360, 0.520],
    [0.540, 0.480],
    [0.540, 0.530],
    [0.545, 0.380],
    [0.545, 0.430],
    [0.540, 0.290],
    [0.540, 0.340],
  ];
  const CRUNCH: [number,number][] = [
    [0.220, 0.450], // head rises toward knees
    [0.220, 0.434],
    [0.220, 0.466],
    [0.206, 0.440],
    [0.206, 0.460],
    [0.280, 0.445],
    [0.280, 0.495],
    [0.340, 0.440],
    [0.340, 0.490],
    [0.380, 0.435],
    [0.380, 0.485],
    [0.540, 0.480],
    [0.540, 0.530],
    [0.545, 0.380],
    [0.545, 0.430],
    [0.540, 0.290],
    [0.540, 0.340],
  ];
  const u = repPhase(t, 0.6);
  return addMotion(blend(REST, CRUNCH, u), t, 0.0025, 0.2);
}

/** 5. Step-up — alternating knee lifts with arm drive */
function stepUp(t: number): [number,number][] {
  // Bilateral at 0.8 Hz, offset half-cycle per side
  const liftL = Math.max(0, Math.sin(2 * Math.PI * 0.8 * t));
  const liftR = Math.max(0, Math.sin(2 * Math.PI * 0.8 * t + Math.PI));
  const uL = smoothstep(liftL);
  const uR = smoothstep(liftR);

  const pts = STAND.map(([x, y]) => [x, y] as [number, number]);
  // Left leg: knee comes up to hip height
  pts[13] = [0.422, lerp(0.690, 0.420, uL)];
  pts[15] = [0.414, lerp(0.878, 0.540, uL)];
  // Right leg
  pts[14] = [0.578, lerp(0.690, 0.420, uR)];
  pts[16] = [0.586, lerp(0.878, 0.540, uR)];
  // Arms swing counter to legs
  pts[7]  = [0.357, lerp(0.375, 0.275, uR)]; // left elbow rises with right leg
  pts[9]  = [0.344, lerp(0.505, 0.200, uR)];
  pts[8]  = [0.643, lerp(0.375, 0.275, uL)];
  pts[10] = [0.656, lerp(0.505, 0.200, uL)];
  return addMotion(pts, t, 0.003, 0.8);
}

/**
 * 6. Squat — deep knee/hip bend, arms extended for balance (Zengin: 0.6 Hz)
 * Zengin: hip angle 165° (stand) → 85° (bottom). Good squat ≤ 90° knee depth.
 */
function squat(t: number): [number,number][] {
  // Deep squat: body drops ~0.18, knees spread, arms come forward
  const BOTTOM: [number,number][] = [
    [0.500, 0.270], // nose (body drops ~0.18)
    [0.473, 0.257],
    [0.527, 0.257],
    [0.447, 0.263],
    [0.553, 0.263],
    [0.406, 0.415], // shoulders drop
    [0.594, 0.415],
    [0.344, 0.375], // elbows extend forward for balance
    [0.656, 0.375],
    [0.305, 0.340], // wrists forward (arms extended ~horizontal)
    [0.695, 0.340],
    [0.410, 0.685], // hips drop (close to knee height)
    [0.590, 0.685],
    [0.358, 0.720], // knees spread wide, travel forward
    [0.642, 0.720],
    [0.414, 0.878], // ankles fixed
    [0.586, 0.878],
  ];
  const u = repPhase(t, 0.6);
  return addMotion(blend(STAND, BOTTOM, u), t, 0.003, 0.8);
}

/**
 * 7. Tricep Dip — SIDE VIEW, person facing right.
 * Hands on bench behind them (left/back, low x), body hanging forward,
 * knees extended forward. Elbows bend to ~90° on the down phase.
 * This is the standard coaching image orientation.
 */
function tricepDip(t: number): [number,number][] {
  // Bench surface is at y≈0.520. Hands fixed on bench behind body.
  // "HIGH" = arms extended (~160°), hips at seat height.
  // "LOW"  = elbows bent (~90°), hips dropped below bench.
  const HIGH: [number,number][] = [
    [0.320, 0.278], // nose
    [0.320, 0.263],
    [0.330, 0.266],
    [0.306, 0.269],
    [0.333, 0.272],
    [0.290, 0.415], // left shoulder (near camera)
    [0.315, 0.430], // right shoulder (depth offset)
    [0.195, 0.428], // left elbow (arm behind, slightly bent)
    [0.220, 0.443],
    [0.155, 0.518], // left wrist — fixed on bench surface
    [0.180, 0.518],
    [0.460, 0.520], // left hip — at bench height
    [0.485, 0.535],
    [0.600, 0.518], // left knee (legs roughly horizontal)
    [0.625, 0.533],
    [0.720, 0.522], // left ankle
    [0.745, 0.537],
  ];
  const LOW: [number,number][] = [
    [0.320, 0.310], // nose (body drops)
    [0.320, 0.295],
    [0.330, 0.298],
    [0.306, 0.301],
    [0.333, 0.304],
    [0.295, 0.448], // shoulders drop
    [0.320, 0.463],
    [0.210, 0.500], // elbows bent to ~90°
    [0.235, 0.515],
    [0.155, 0.518], // wrists fixed on bench
    [0.180, 0.518],
    [0.460, 0.630], // hips dipped well below bench
    [0.485, 0.645],
    [0.600, 0.540], // knees stay roughly level
    [0.625, 0.555],
    [0.720, 0.530],
    [0.745, 0.545],
  ];
  const u = repPhase(t, 0.55);
  return addMotion(blend(HIGH, LOW, u), t, 0.003, 0.2);
}

/** 8. Plank — horizontal static hold with slow core wobble */
function plank(t: number): [number,number][] {
  const HOLD: [number,number][] = [
    [0.130, 0.448],
    [0.130, 0.432],
    [0.130, 0.464],
    [0.116, 0.438],
    [0.116, 0.458],
    [0.235, 0.402], // shoulders
    [0.235, 0.494],
    [0.192, 0.400], // elbows (forearm plank)
    [0.192, 0.492],
    [0.175, 0.402], // wrists on floor
    [0.175, 0.494],
    [0.600, 0.420], // hips level with shoulders
    [0.600, 0.478],
    [0.715, 0.424],
    [0.715, 0.476],
    [0.855, 0.428],
    [0.855, 0.472],
  ];
  // Slow hip sway (0.3 Hz), sub-cm amplitude
  const sway = 0.007 * Math.sin(2 * Math.PI * 0.3 * t);
  return addMotion(
    HOLD.map(([x, y], i) => [x, i >= 11 ? y + sway : y] as [number,number]),
    t, 0.0018, 0.1
  );
}

/**
 * 9. High Knees — rapid bilateral knee drive (Zengin: 2.4 Hz bilateral)
 * Hip flexion angle falls below 100° (knee-to-shoulder) at peak lift.
 */
function highKnees(t: number): [number,number][] {
  const liftL = Math.max(0, Math.sin(2 * Math.PI * 2.4 * t));
  const liftR = Math.max(0, Math.sin(2 * Math.PI * 2.4 * t + Math.PI));
  const uL = smoothstep(liftL);
  const uR = smoothstep(liftR);

  const pts = STAND.map(([x, y]) => [x, y] as [number, number]);
  // Left knee drives up to hip height
  pts[13] = [lerp(0.422, 0.435, uL), lerp(0.690, 0.390, uL)];
  pts[15] = [lerp(0.414, 0.440, uL), lerp(0.878, 0.510, uL)];
  // Right knee
  pts[14] = [lerp(0.578, 0.565, uR), lerp(0.690, 0.390, uR)];
  pts[16] = [lerp(0.586, 0.560, uR), lerp(0.878, 0.510, uR)];
  // Arms pump counter to legs — aggressive drive
  pts[7]  = [lerp(0.357, 0.326, uR), lerp(0.375, 0.255, uR)];
  pts[9]  = [lerp(0.344, 0.318, uR), lerp(0.505, 0.185, uR)];
  pts[8]  = [lerp(0.643, 0.674, uL), lerp(0.375, 0.255, uL)];
  pts[10] = [lerp(0.656, 0.682, uL), lerp(0.505, 0.185, uL)];
  return addMotion(pts, t, 0.004, 1.0);
}

/**
 * 10. Lunge — alternating forward stride, front knee at 90° (Zengin: 0.7 Hz)
 * Zengin: front knee angle left_hip→left_knee→left_ankle drops to ≤100°.
 */
function lunge(t: number): [number,number][] {
  // Alternate sides every ~1.4s
  const sidePhase = (t * 0.35) % 1; // 0.35 Hz side switch
  const isLeft = sidePhase < 0.5;
  const stepDepth = repPhase(t, 0.7);

  const pts = STAND.map(([x, y]) => [x, y] as [number, number]);
  const drop = lerp(0, 0.12, stepDepth); // body lowers on descent

  // Whole-body drop
  for (let i = 0; i < 12; i++) pts[i][1] += drop;

  if (isLeft) {
    // Left leg steps forward: knee spreads left/forward, ankle forward
    pts[13] = [lerp(0.422, 0.350, stepDepth), lerp(0.690, 0.705, stepDepth) + drop];
    pts[15] = [lerp(0.414, 0.290, stepDepth), 0.878];
    // Right leg extends back
    pts[14] = [lerp(0.578, 0.600, stepDepth), lerp(0.690, 0.760, stepDepth) + drop];
    pts[16] = [lerp(0.586, 0.610, stepDepth), 0.878];
  } else {
    // Mirror
    pts[14] = [lerp(0.578, 0.650, stepDepth), lerp(0.690, 0.705, stepDepth) + drop];
    pts[16] = [lerp(0.586, 0.710, stepDepth), 0.878];
    pts[13] = [lerp(0.422, 0.400, stepDepth), lerp(0.690, 0.760, stepDepth) + drop];
    pts[15] = [lerp(0.414, 0.390, stepDepth), 0.878];
  }
  return addMotion(pts, t, 0.003, 0.7);
}

/** 11. Push-up + Rotation — push-up then T-rotation */
function pushUpRotation(t: number): [number,number][] {
  const cycle = (t * 0.35) % 1;
  const isPush = cycle < 0.5;
  const phase = isPush ? (cycle / 0.5) : ((cycle - 0.5) / 0.5);
  const u = smoothstep(phase < 0.5 ? phase * 2 : (1 - phase) * 2);

  if (isPush) {
    // Reuse pushUp down phase
    const UP: [number,number][] = [
      [0.130, 0.440],[0.130, 0.424],[0.130, 0.456],[0.116, 0.430],[0.116, 0.450],
      [0.240, 0.395],[0.240, 0.470],[0.215, 0.360],[0.215, 0.435],
      [0.190, 0.355],[0.190, 0.430],
      [0.590, 0.408],[0.590, 0.462],[0.720, 0.412],[0.720, 0.466],[0.850, 0.418],[0.850, 0.472],
    ];
    const DOWN: [number,number][] = [
      [0.130, 0.495],[0.130, 0.479],[0.130, 0.511],[0.116, 0.485],[0.116, 0.505],
      [0.240, 0.458],[0.240, 0.532],[0.225, 0.432],[0.225, 0.506],
      [0.190, 0.355],[0.190, 0.430],
      [0.590, 0.408],[0.590, 0.462],[0.720, 0.412],[0.720, 0.466],[0.850, 0.418],[0.850, 0.472],
    ];
    return addMotion(blend(UP, DOWN, u), t, 0.003, 0.3);
  } else {
    // Rotation: rise to side-plank, left arm sweeps up
    const MID: [number,number][] = [
      [0.130, 0.440],[0.130, 0.424],[0.130, 0.456],[0.116, 0.430],[0.116, 0.450],
      [0.240, 0.395],[0.240, 0.470],[0.215, 0.360],[0.215, 0.435],
      [0.190, 0.355],[0.190, 0.430],
      [0.590, 0.408],[0.590, 0.462],[0.720, 0.412],[0.720, 0.466],[0.850, 0.418],[0.850, 0.472],
    ];
    const ROT: [number,number][] = [
      [0.130, 0.445],[0.130, 0.429],[0.130, 0.461],[0.116, 0.435],[0.116, 0.455],
      [0.240, 0.400],[0.265, 0.475],[0.220, 0.290],[0.215, 0.445], // left arm sweeps up
      [0.215, 0.210],[0.190, 0.438], // left wrist high
      [0.590, 0.415],[0.590, 0.468],[0.720, 0.418],[0.720, 0.470],[0.850, 0.422],[0.850, 0.474],
    ];
    return addMotion(blend(MID, ROT, u), t, 0.003, 0.3);
  }
}

/** 12. Side Plank — diagonal body, one arm raised, slow balance wobble */
function sidePlank(t: number): [number,number][] {
  const HOLD: [number,number][] = [
    [0.145, 0.360], // nose
    [0.145, 0.344],
    [0.145, 0.376],
    [0.131, 0.350],
    [0.131, 0.370],
    [0.240, 0.428], // left shoulder (lower, supporting)
    [0.285, 0.500], // right shoulder (body diagonal)
    [0.220, 0.320], // left elbow — left arm reaches up
    [0.295, 0.556], // right elbow on floor
    [0.205, 0.230], // left wrist high
    [0.290, 0.600], // right wrist on floor
    [0.495, 0.548], // left hip (body mid-point)
    [0.540, 0.590], // right hip
    [0.635, 0.630], // left knee
    [0.670, 0.660], // right knee
    [0.780, 0.688], // left ankle
    [0.815, 0.710], // right ankle
  ];
  const wobble = 0.010 * Math.sin(2 * Math.PI * 0.45 * t);
  return addMotion(
    HOLD.map(([x, y]) => [x, y + wobble] as [number, number]),
    t, 0.0020, 0.1
  );
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

// ─── Real-data registry (populated by prefetchRealData) ──────────────────────
//
// Module-level cache keyed by ExerciseId. When populated, generateMockFrame
// uses the real frames instead of the procedural generator — no API changes needed.

interface DatasetFile {
  frames: PoseFrame[];
  fps: number;
  loop: boolean;
}

const _realGenerators = new Map<ExerciseId, (wallTimeSec: number) => PoseFrame>();

/**
 * Pre-fetch a real dataset for an exercise from /public/data/<exercise>.json.
 * Must be called client-side (e.g., from a React useEffect).
 * After the fetch, generateMockFrame automatically uses the real data.
 *
 * Available datasets: "squat"
 */
export async function prefetchRealData(exercise: ExerciseId): Promise<void> {
  if (_realGenerators.has(exercise)) return; // already loaded
  try {
    const res = await fetch(`/data/${exercise}.json`);
    if (!res.ok) return; // no file for this exercise — stay procedural
    const data: DatasetFile = await res.json();
    const replay = createReplay(data.frames, { fps: data.fps ?? 10, loop: data.loop ?? true });
    _realGenerators.set(exercise, replay);
  } catch {
    // Silently fall back to procedural — offline or file missing
  }
}

// ─── Frame generator ──────────────────────────────────────────────────────────

export function generateMockFrame(exercise: ExerciseId = "jumping-jacks", t?: number): PoseFrame {
  const now = t ?? Date.now() / 1000;

  // Use real data if prefetched
  const real = _realGenerators.get(exercise);
  if (real) return real(now);

  // Procedural fallback
  const positions = GENERATORS[exercise](now);

  // Confidence scores: face kps slightly higher; simulate slow drift + tiny noise
  const keypoints = COCO_KEYPOINT_NAMES.map((name, i) => {
    const [x, y] = positions[i] ?? [0.5, 0.5];
    const base = i < 5 ? 0.89 : i < 11 ? 0.84 : 0.78;
    const score = Math.min(0.99, Math.max(0.42,
      base + 0.04 * Math.sin(now * 0.31 + i * 0.9)
    ));
    return { name, x, y, score };
  });

  return { ts: now, keypoints };
}

/** Legacy: default to jumping jacks for backward compat */
export const generateDefaultMockFrame = () => generateMockFrame("jumping-jacks");
