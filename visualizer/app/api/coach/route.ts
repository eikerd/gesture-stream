import { NextRequest, NextResponse } from "next/server";
import { type CoachRepSummary } from "@/lib/chatTypes";

const COACH_MODEL =
  process.env.ANTHROPIC_COACH_MODEL ?? "claude-haiku-4-5-20251001";

const STATIC_TIPS: Record<string, string[]> = {
  squat: [
    "Drive through your heels",
    "Keep your chest tall",
    "Knees tracking over toes",
    "Breathe in on the way down",
  ],
  "push-up": [
    "Keep your core tight",
    "Full range of motion",
    "Elbows at 45°, not flared",
    "Slow and controlled",
  ],
  "jumping-jacks": [
    "Full arm extension overhead",
    "Land softly on your feet",
    "Keep breathing rhythmically",
  ],
  lunge: [
    "Front knee stays above ankle",
    "Back knee hovers above floor",
    "Torso stays upright",
  ],
  "high-knees": [
    "Drive your knees to hip height",
    "Pump your arms",
    "Stay on the balls of your feet",
  ],
};

const DEFAULT_TIPS = [
  "Maintain steady breathing",
  "Keep your core engaged",
  "Focus on full range of motion",
  "Control the movement, don't rush",
];

function getStaticTip(exercise: string): string {
  const exerciseKey = exercise.toLowerCase().replace(/\s+/g, "-");
  const tips = STATIC_TIPS[exerciseKey] ?? DEFAULT_TIPS;
  return tips[Math.floor(Math.random() * tips.length)];
}

interface RawBody {
  exercise?: unknown;
  reps?: unknown;
  formOk?: unknown;
}

function parseBody(raw: RawBody): {
  exercise: string;
  reps: CoachRepSummary[];
  formOk: boolean;
} {
  return {
    exercise:
      typeof raw.exercise === "string" ? raw.exercise.slice(0, 50) : "",
    reps: Array.isArray(raw.reps) ? (raw.reps as CoachRepSummary[]) : [],
    formOk: Boolean(raw.formOk),
  };
}

export async function POST(request: NextRequest) {
  let raw: RawBody;
  try {
    raw = (await request.json()) as RawBody;
  } catch {
    return NextResponse.json({ tip: getStaticTip("") });
  }

  const { exercise, reps, formOk } = parseBody(raw);
  if (!exercise) {
    return NextResponse.json({ tip: getStaticTip("") }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ tip: getStaticTip(exercise) });
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const repSummary = reps
      .slice(-5)
      .map(
        (r) =>
          `Rep ${r.repNumber}: ${r.formOk ? "good" : "needs work"}${r.angle !== undefined ? `, angle ${r.angle.toFixed(0)}°` : ""}`
      )
      .join("; ");

    const prompt = `You are a fitness coach. Exercise: ${exercise}. Last 5 reps: ${repSummary || "no data"}. Overall form: ${formOk ? "good" : "needs improvement"}. Give a single encouraging 1-sentence coaching tip. Be specific and actionable.`;

    const message = await client.messages.create({
      model: COACH_MODEL,
      max_tokens: 80,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type === "text" && content.text.trim()) {
      return NextResponse.json({ tip: content.text.trim() });
    }

    return NextResponse.json({ tip: getStaticTip(exercise) });
  } catch (err) {
    console.error("[/api/coach]", err);
    return NextResponse.json({ tip: getStaticTip(exercise) });
  }
}
