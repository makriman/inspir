import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { generateFlashcards, sanitizeFlashcardState } from "@/lib/activities/flashcards";
import { createActivityRun, getOwnedChat, getUserById, insertMessage } from "@/lib/db/queries";
import { calculateAge } from "@/lib/profile/age";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startFlashcardsSchema = z.object({
  chatId: z.uuid(),
  topic: z.string().trim().min(1).max(180),
  source: z.string().trim().max(5000).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = startFlashcardsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid flashcard request" }, { status: 400 });

  const owned = await getOwnedChat(parsed.data.chatId, session.user.id);
  if (!owned?.topic || owned.topic.slug !== "flashcard-builder") {
    return NextResponse.json({ error: "Flashcard chat not found" }, { status: 404 });
  }

  const user = await getUserById(session.user.id);
  const flashcards = await generateFlashcards(parsed.data.topic, parsed.data.source, {
    learnerAge: calculateAge(user?.dateOfBirth),
    preferredLanguage: user?.preferredLanguage,
  });
  const run = await createActivityRun({
    chatId: parsed.data.chatId,
    type: "flashcards",
    state: flashcards,
    score: 0,
    maxScore: flashcards.maxCards,
  });

  await insertMessage({
    chatId: parsed.data.chatId,
    role: "user",
    content: `Build flashcards for ${parsed.data.topic}`,
    metadata: { activityRunId: run.id, activityType: "flashcards", event: "started" },
  });
  await insertMessage({
    chatId: parsed.data.chatId,
    role: "assistant",
    content: `Your ${flashcards.maxCards}-card deck on ${parsed.data.topic} is ready. Reveal each answer, rate your recall, and review the cards you missed.`,
    metadata: { activityRunId: run.id, activityType: "flashcards", event: "started" },
  });

  return NextResponse.json({ activityRun: { ...run, state: sanitizeFlashcardState(flashcards) } });
}
