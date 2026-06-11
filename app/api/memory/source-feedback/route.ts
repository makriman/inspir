import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  getChatMemoryTurnsByIds,
  getUserMemory,
  getUserMemorySummary,
  insertMemorySourceFeedback,
  updateUserMemory,
  upsertUserMemorySummary,
} from "@/lib/db/memory";
import { getOwnedAiRun } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  aiRunId: z.uuid().optional(),
  memoryId: z.uuid().optional(),
  chatTurnId: z.uuid().optional(),
  summarySectionId: z.string().trim().min(1).max(120).optional(),
  action: z.enum(["relevant", "not_relevant", "dont_mention", "correction"]),
  note: z.string().trim().max(800).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = feedbackSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });

  const { aiRunId, memoryId, chatTurnId, summarySectionId, action } = parsed.data;
  if (aiRunId) {
    const run = await getOwnedAiRun(aiRunId, session.user.id);
    if (!run) return NextResponse.json({ error: "AI run not found" }, { status: 404 });
  }

  if (memoryId) {
    const memory = await getUserMemory(session.user.id, memoryId);
    if (!memory) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    if (action === "dont_mention" || action === "not_relevant") {
      await updateUserMemory(session.user.id, memoryId, { doNotMention: true });
    }
  }

  if (chatTurnId) {
    const turns = await getChatMemoryTurnsByIds(session.user.id, [chatTurnId]);
    if (!turns.length) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  if (summarySectionId && action === "dont_mention") {
    const summary = await getUserMemorySummary(session.user.id);
    if (summary) {
      await upsertUserMemorySummary({
        userId: session.user.id,
        summary: summary.summary,
        sections: (summary.sections ?? []).map((section) =>
          section.id === summarySectionId ? { ...section, doNotMention: true } : section,
        ),
        sourceMemoryIds: summary.sourceMemoryIds,
        sourceTurnIds: summary.sourceTurnIds,
        version: summary.version,
      });
    }
  }

  await insertMemorySourceFeedback({
    userId: session.user.id,
    aiRunId: aiRunId ?? null,
    memoryId: memoryId ?? null,
    chatTurnId: chatTurnId ?? null,
    summarySectionId: summarySectionId ?? null,
    action,
    note: parsed.data.note ?? null,
  });

  return NextResponse.json({ ok: true });
}
