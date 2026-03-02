import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/sessions — start or end a session
// Body: { action: "start", exercise?: string } | { action: "end", sessionId: string }
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action: "start" | "end";
      exercise?: string;
      sessionId?: string;
    };

    if (body.action === "start") {
      const session = await prisma.session.create({
        data: { exercise: body.exercise ?? null },
      });
      return NextResponse.json(session, { status: 201 });
    }

    if (body.action === "end") {
      if (!body.sessionId) {
        return NextResponse.json(
          { error: "sessionId is required to end a session" },
          { status: 400 }
        );
      }
      const session = await prisma.session.update({
        where: { id: body.sessionId },
        data: { endedAt: new Date() },
      });
      return NextResponse.json(session);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[/api/sessions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/sessions — list sessions
export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      include: { reps: true },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return NextResponse.json(sessions);
  } catch (err) {
    console.error("[/api/sessions GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
