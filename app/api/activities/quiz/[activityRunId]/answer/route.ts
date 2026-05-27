import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql as dsql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  getActivityRunById,
  getOwnedChat,
  insertMessage,
  updateActivityRun,
} from "@/lib/db/queries";
import {
  answerQuizQuestion,
  parseQuizState,
  sanitizeQuizState,
} from "@/lib/activities/quiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const answerSchema = z.object({
  answerIndex: z.number().int().min(0).max(3),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ activityRunId: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = answerSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid answer" }, { status: 400 });

  const { activityRunId } = await params;
  const run = await getActivityRunById(activityRunId);
  if (!run || run.type !== "quiz") return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

  const owned = await getOwnedChat(run.chatId, session.user.id);
  if (!owned) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

  const parsed = parseQuizState(run.state);
  if (!parsed.success) return NextResponse.json({ error: "Quiz state is invalid" }, { status: 409 });

  const result = answerQuizQuestion(parsed.data, body.data.answerIndex);
  if (!result.changed) {
    return NextResponse.json({
      activityRun: { ...run, state: sanitizeQuizState(result.state) },
      wasCorrect: result.wasCorrect,
    });
  }

  const updated = await updateActivityRun(run.id, {
    status: result.state.completed ? "completed" : "active",
    state: result.state,
    score: result.state.score,
    maxScore: result.state.maxScore,
    completedAt: result.state.completed ? new Date() : null,
  });

  if (result.changed && result.state.completed && run.status !== "completed" && result.state.score > 0) {
    await db
      .update(users)
      .set({ score: dsql`${users.score} + ${result.state.score}`, updatedAt: new Date() })
      .where(eq(users.id, session.user.id));
  }

  if (result.changed && result.state.completed) {
    await insertMessage({
      chatId: run.chatId,
      role: "assistant",
      content: `Quiz complete: ${result.state.score}/${result.state.maxScore} on ${result.state.topic}.`,
      metadata: { activityRunId: run.id, activityType: "quiz", event: "completed" },
    });
  }

  return NextResponse.json({
    activityRun: updated ? { ...updated, state: sanitizeQuizState(result.state) } : null,
    wasCorrect: result.wasCorrect,
  });
}
