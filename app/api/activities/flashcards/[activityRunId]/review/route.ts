import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  parseFlashcardState,
  reviewFlashcard,
  sanitizeFlashcardState,
} from "@/lib/activities/flashcards";
import {
  getActivityRunById,
  getOwnedChat,
  insertMessage,
  updateActivityRun,
} from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reveal") }),
  z.object({ action: z.literal("rate"), rating: z.enum(["known", "again"]) }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ activityRunId: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = reviewSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid flashcard review" }, { status: 400 });

  const { activityRunId } = await params;
  const run = await getActivityRunById(activityRunId);
  if (!run || run.type !== "flashcards") {
    return NextResponse.json({ error: "Flashcard deck not found" }, { status: 404 });
  }

  const owned = await getOwnedChat(run.chatId, session.user.id);
  if (!owned) return NextResponse.json({ error: "Flashcard deck not found" }, { status: 404 });

  const parsed = parseFlashcardState(run.state);
  if (!parsed.success) return NextResponse.json({ error: "Flashcard state is invalid" }, { status: 409 });

  const result = reviewFlashcard(parsed.data, body.data);
  if (!result.changed) {
    return NextResponse.json({
      activityRun: { ...run, state: sanitizeFlashcardState(result.state) },
    });
  }

  const updated = await updateActivityRun(run.id, {
    status: result.state.completed ? "completed" : "active",
    state: result.state,
    score: result.state.knownCount,
    maxScore: result.state.maxCards,
    completedAt: result.state.completed ? new Date() : null,
  });

  if (result.state.completed && run.status !== "completed") {
    await insertMessage({
      chatId: run.chatId,
      role: "assistant",
      content: `Flashcard deck complete: ${result.state.knownCount}/${result.state.maxCards} cards marked known for ${result.state.topic}.`,
      metadata: { activityRunId: run.id, activityType: "flashcards", event: "completed" },
    });
  }

  return NextResponse.json({
    activityRun: updated ? { ...updated, state: sanitizeFlashcardState(result.state) } : null,
  });
}
