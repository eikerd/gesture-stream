import { type PoseFrame, COCO_KEYPOINT_NAMES } from "./pose";
import { type ExerciseId } from "./mock";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RepPhase = "up" | "down";

export interface RepEvent {
  repNumber: number;
  isGood: boolean;
  peakAngle: number;
}

interface Point2D {
  x: number;
  y: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute angle at joint B in degrees (A-B-C), using dot product. */
export function angle(a: Point2D, b: Point2D, c: Point2D): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBa = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const magBc = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
  if (magBa === 0 || magBc === 0) return 0;
  const cosTheta = Math.max(-1, Math.min(1, dot / (magBa * magBc)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

function kp(frame: PoseFrame, name: (typeof COCO_KEYPOINT_NAMES)[number]): Point2D {
  const found = frame.keypoints.find((k) => k.name === name);
  return found ?? { x: 0.5, y: 0.5 };
}

// ─── Abstract base class ──────────────────────────────────────────────────────

export abstract class ExerciseRepCounter {
  protected phase: RepPhase = "up";
  protected count = 0;
  protected currentAngle = 0;
  protected peakAngle = 0; // worst (most extreme) angle seen this rep
  protected completionPct = 0; // 0-100

  abstract update(frame: PoseFrame): RepEvent | null;

  getCount(): number {
    return this.count;
  }

  getAngle(): number {
    return this.currentAngle;
  }

  getCompletionPct(): number {
    return this.completionPct;
  }

  reset(): void {
    this.phase = "up";
    this.count = 0;
    this.currentAngle = 0;
    this.peakAngle = 0;
    this.completionPct = 0;
  }
}

// ─── Squat counter ────────────────────────────────────────────────────────────
// Tracks left_hip → left_knee → left_ankle angle.
// Down phase: angle < 100°, Up phase: angle > 160°.
// Good form: peak angle < 95° (deep squat).

export class SquatCounter extends ExerciseRepCounter {
  private readonly DOWN_THRESHOLD = 100;
  private readonly UP_THRESHOLD = 160;
  private readonly GOOD_ANGLE_MAX = 95; // must go this low for good rep

  update(frame: PoseFrame): RepEvent | null {
    const hip = kp(frame, "left_hip");
    const knee = kp(frame, "left_knee");
    const ankle = kp(frame, "left_ankle");
    const a = angle(hip, knee, ankle);
    this.currentAngle = a;

    // Completion percentage: 0% at full extension (UP_THRESHOLD), 100% at full depth (DOWN_THRESHOLD)
    this.completionPct = Math.max(0, Math.min(100, ((this.UP_THRESHOLD - a) / (this.UP_THRESHOLD - this.DOWN_THRESHOLD)) * 100));

    if (this.phase === "up" && a < this.DOWN_THRESHOLD) {
      this.phase = "down";
      this.peakAngle = a;
    } else if (this.phase === "down") {
      if (a < this.peakAngle) this.peakAngle = a; // track minimum (deepest) angle
      if (a > this.UP_THRESHOLD) {
        this.count += 1;
        const isGood = this.peakAngle <= this.GOOD_ANGLE_MAX;
        const event: RepEvent = { repNumber: this.count, isGood, peakAngle: this.peakAngle };
        this.phase = "up";
        this.peakAngle = 180;
        return event;
      }
    }

    return null;
  }
}

// ─── Push-up counter ─────────────────────────────────────────────────────────
// Tracks left_shoulder → left_elbow → left_wrist angle.
// Down phase: angle < 90°, Up phase: angle > 160°.
// Good form: peak angle < 85°.

export class PushUpCounter extends ExerciseRepCounter {
  private readonly DOWN_THRESHOLD = 90;
  private readonly UP_THRESHOLD = 160;
  private readonly GOOD_ANGLE_MAX = 85;

  update(frame: PoseFrame): RepEvent | null {
    const shoulder = kp(frame, "left_shoulder");
    const elbow = kp(frame, "left_elbow");
    const wrist = kp(frame, "left_wrist");
    const a = angle(shoulder, elbow, wrist);
    this.currentAngle = a;

    this.completionPct = Math.max(0, Math.min(100, ((this.UP_THRESHOLD - a) / (this.UP_THRESHOLD - this.DOWN_THRESHOLD)) * 100));

    if (this.phase === "up" && a < this.DOWN_THRESHOLD) {
      this.phase = "down";
      this.peakAngle = a;
    } else if (this.phase === "down") {
      if (a < this.peakAngle) this.peakAngle = a;
      if (a > this.UP_THRESHOLD) {
        this.count += 1;
        const isGood = this.peakAngle <= this.GOOD_ANGLE_MAX;
        const event: RepEvent = { repNumber: this.count, isGood, peakAngle: this.peakAngle };
        this.phase = "up";
        this.peakAngle = 180;
        return event;
      }
    }

    return null;
  }
}

// ─── Lunge counter ────────────────────────────────────────────────────────────
// Tracks left_hip → left_knee → left_ankle angle.
// Down phase: angle < 100°, Up phase: angle > 160°.
// Good form: peak angle < 100°.

export class LungeCounter extends ExerciseRepCounter {
  private readonly DOWN_THRESHOLD = 100;
  private readonly UP_THRESHOLD = 160;
  private readonly GOOD_ANGLE_MAX = 95;

  update(frame: PoseFrame): RepEvent | null {
    const hip = kp(frame, "left_hip");
    const knee = kp(frame, "left_knee");
    const ankle = kp(frame, "left_ankle");
    const a = angle(hip, knee, ankle);
    this.currentAngle = a;

    this.completionPct = Math.max(0, Math.min(100, ((this.UP_THRESHOLD - a) / (this.UP_THRESHOLD - this.DOWN_THRESHOLD)) * 100));

    if (this.phase === "up" && a < this.DOWN_THRESHOLD) {
      this.phase = "down";
      this.peakAngle = a;
    } else if (this.phase === "down") {
      if (a < this.peakAngle) this.peakAngle = a;
      if (a > this.UP_THRESHOLD) {
        this.count += 1;
        const isGood = this.peakAngle <= this.GOOD_ANGLE_MAX;
        const event: RepEvent = { repNumber: this.count, isGood, peakAngle: this.peakAngle };
        this.phase = "up";
        this.peakAngle = 180;
        return event;
      }
    }

    return null;
  }
}

// ─── High knees counter ───────────────────────────────────────────────────────
// Uses left knee y relative to left hip y.
// "Up" when knee.y < hip.y - threshold (knee above hip midpoint).
// Good form: knee rises at least 60% of the way to hip height.

export class HighKneesCounter extends ExerciseRepCounter {
  private readonly LIFT_THRESHOLD = 0.10; // knee must be this many units above hip
  private readonly GOOD_LIFT_MIN = 0.13; // good form needs deeper lift

  update(frame: PoseFrame): RepEvent | null {
    const hip = kp(frame, "left_hip");
    const knee = kp(frame, "left_knee");

    // Lift = how far knee is above hip (positive = above hip)
    const lift = hip.y - knee.y;
    this.currentAngle = Math.round(lift * 1000) / 10; // store as % lift (repurposed field)

    // Completion: 0% at hip level (lift=0), 100% at full lift (lift=GOOD_LIFT_MIN)
    this.completionPct = Math.max(0, Math.min(100, (lift / this.GOOD_LIFT_MIN) * 100));

    if (this.phase === "up" && lift < 0) {
      // knee came back down
      this.phase = "down";
      this.peakAngle = 0;
    } else if (this.phase === "down" || this.phase === "up") {
      if (lift > this.LIFT_THRESHOLD) {
        if (this.phase === "down") {
          this.phase = "up";
          this.peakAngle = lift;
        } else if (lift > this.peakAngle) {
          this.peakAngle = lift;
        }
      }
    }

    // Rep completes when knee has been up and comes back below hip
    if (this.phase === "up" && lift < 0.02 && this.peakAngle > this.LIFT_THRESHOLD) {
      this.count += 1;
      const isGood = this.peakAngle >= this.GOOD_LIFT_MIN;
      // Use same % units as currentAngle so callers handle high-knees consistently
      const event: RepEvent = {
        repNumber: this.count,
        isGood,
        peakAngle: Math.round(this.peakAngle * 1000) / 10,
      };
      this.phase = "down";
      this.peakAngle = 0;
      return event;
    }

    return null;
  }
}

// ─── Jumping jacks counter ────────────────────────────────────────────────────
// Tracks left_elbow → left_shoulder → left_hip angle.
// Up (arms raised): angle > 120°, Down (arms at sides): angle < 50°.
// Good form: arms reach > 120°.

export class JumpingJackCounter extends ExerciseRepCounter {
  private readonly UP_THRESHOLD = 120;
  private readonly DOWN_THRESHOLD = 50;
  private readonly GOOD_ANGLE_MIN = 120;
  // Arms start at sides — phase must be "down" so the first raise is detected
  protected phase: RepPhase = "down";

  update(frame: PoseFrame): RepEvent | null {
    const elbow = kp(frame, "left_elbow");
    const shoulder = kp(frame, "left_shoulder");
    const hip = kp(frame, "left_hip");
    const a = angle(elbow, shoulder, hip);
    this.currentAngle = a;

    // Completion: 0% at sides (50°), 100% at full raise (120°)
    this.completionPct = Math.max(0, Math.min(100, ((a - this.DOWN_THRESHOLD) / (this.UP_THRESHOLD - this.DOWN_THRESHOLD)) * 100));

    if (this.phase === "down" && a > this.UP_THRESHOLD) {
      this.phase = "up";
      this.peakAngle = a;
    } else if (this.phase === "up") {
      if (a > this.peakAngle) this.peakAngle = a;
      if (a < this.DOWN_THRESHOLD) {
        this.count += 1;
        const isGood = this.peakAngle >= this.GOOD_ANGLE_MIN;
        const event: RepEvent = { repNumber: this.count, isGood, peakAngle: this.peakAngle };
        this.phase = "down";
        this.peakAngle = 0;
        return event;
      }
    }

    return null;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createRepCounter(exerciseId: ExerciseId): ExerciseRepCounter | null {
  switch (exerciseId) {
    case "squat":
      return new SquatCounter();
    case "push-up":
      return new PushUpCounter();
    case "lunge":
      return new LungeCounter();
    case "high-knees":
      return new HighKneesCounter();
    case "jumping-jacks":
      return new JumpingJackCounter();
    default:
      return null;
  }
}
