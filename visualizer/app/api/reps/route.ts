import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/reps — log a rep event
// Body: { sessionId: string, repNumber: number, exercise: string }
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sessionId: string;
      repNumber: number;
      exercise: string;
    };

    if (!body.sessionId || body.repNumber == null || !body.exercise) {
      return NextResponse.json(
        { error: "sessionId, repNumber, and exercise are required" },
        { status: 400 }
      );
    }

    const rep = await prisma.repEvent.create({
      data: {
        sessionId: body.sessionId,
        repNumber: body.repNumber,
        exercise: body.exercise,
      },
    });

    return NextResponse.json(rep, { status: 201 });
  } catch (err) {
    console.error("[/api/reps]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/reps?sessionId=xxx — list reps for a session
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    const reps = await prisma.repEvent.findMany({
      where: sessionId ? { sessionId } : undefined,
      orderBy: { timestamp: "desc" },
      take: 200,
    });

    return NextResponse.json(reps);
  } catch (err) {
    console.error("[/api/reps GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
