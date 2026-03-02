import { type PoseFrame, COCO_KEYPOINT_NAMES } from "./pose";

// Base normalized positions for a standing figure (x, y)
const BASE_POSITIONS: [number, number][] = [
  [0.5, 0.12],   // nose
  [0.47, 0.10],  // left_eye
  [0.53, 0.10],  // right_eye
  [0.44, 0.11],  // left_ear
  [0.56, 0.11],  // right_ear
  [0.42, 0.28],  // left_shoulder
  [0.58, 0.28],  // right_shoulder
  [0.37, 0.42],  // left_elbow
  [0.63, 0.42],  // right_elbow
  [0.33, 0.56],  // left_wrist
  [0.67, 0.56],  // right_wrist
  [0.44, 0.56],  // left_hip
  [0.56, 0.56],  // right_hip
  [0.43, 0.72],  // left_knee
  [0.57, 0.72],  // right_knee
  [0.42, 0.88],  // left_ankle
  [0.58, 0.88],  // right_ankle
];

// Amplitude of sinusoidal movement per keypoint [x_amp, y_amp]
const AMPLITUDES: [number, number][] = [
  [0.005, 0.005],  // nose
  [0.004, 0.004],  // left_eye
  [0.004, 0.004],  // right_eye
  [0.004, 0.004],  // left_ear
  [0.004, 0.004],  // right_ear
  [0.01, 0.01],    // left_shoulder
  [0.01, 0.01],    // right_shoulder
  [0.04, 0.03],    // left_elbow
  [0.04, 0.03],    // right_elbow
  [0.07, 0.05],    // left_wrist
  [0.07, 0.05],    // right_wrist
  [0.01, 0.01],    // left_hip
  [0.01, 0.01],    // right_hip
  [0.05, 0.06],    // left_knee
  [0.05, 0.06],    // right_knee
  [0.07, 0.08],    // left_ankle
  [0.07, 0.08],    // right_ankle
];

// Phase offsets per keypoint to create realistic alternating motion
const PHASE_OFFSETS: number[] = [
  0,              // nose
  0.1,            // left_eye
  -0.1,           // right_eye
  0.15,           // left_ear
  -0.15,          // right_ear
  0.2,            // left_shoulder
  -0.2,           // right_shoulder
  Math.PI + 0.3,  // left_elbow (opposite phase)
  0.3,            // right_elbow
  Math.PI + 0.4,  // left_wrist
  0.4,            // right_wrist
  0.1,            // left_hip
  -0.1,           // right_hip
  Math.PI + 0.5,  // left_knee (alternating gait)
  0.5,            // right_knee
  Math.PI + 0.6,  // left_ankle
  0.6,            // right_ankle
];

export function generateMockFrame(t?: number): PoseFrame {
  const now = t ?? Date.now() / 1000;
  const omega = 1.8; // walking frequency in rad/s

  const keypoints = COCO_KEYPOINT_NAMES.map((name, i) => {
    const [bx, by] = BASE_POSITIONS[i];
    const [ax, ay] = AMPLITUDES[i];
    const phi = PHASE_OFFSETS[i];

    const x = bx + ax * Math.sin(omega * now + phi);
    const y = by + ay * Math.cos(omega * now + phi * 0.7);

    // Confidence scores vary slightly — head/shoulders more reliable
    const baseScore = i < 7 ? 0.88 : i < 11 ? 0.82 : 0.75;
    const score = Math.min(1, Math.max(0, baseScore + 0.08 * Math.sin(now * 0.3 + i)));

    return { name, x, y, score };
  });

  return { ts: now, keypoints };
}
