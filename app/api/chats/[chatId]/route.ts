import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { sanitizeActivityRun } from "@/lib/activities/quiz";
import { db } from "@/lib/db/client";
import { getChatMessages, getLatestActivityRun, getOwnedChat, toPublicTopic } from "@/lib/db/queries";
import { aiRuns } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await params;
  const owned = await getOwnedChat(chatId, session.user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [messages, activityRun] = await Promise.all([
    getChatMessages(chatId),
    getLatestActivityRun(chatId),
  ]);
  const assistantMessageIds = messages.filter((message) => message.role === "assistant").map((message) => message.id);
  const runs = assistantMessageIds.length
    ? await db
        .select({
          id: aiRuns.id,
          assistantMessageId: aiRuns.assistantMessageId,
          memoryContext: aiRuns.memoryContext,
        })
        .from(aiRuns)
        .where(inArray(aiRuns.assistantMessageId, assistantMessageIds))
    : [];
  const runByAssistantMessageId = new Map(runs.map((run) => [run.assistantMessageId, run]));
  const messagesWithMemorySources = messages.map((message) => {
    const run = message.role === "assistant" ? runByAssistantMessageId.get(message.id) : undefined;
    if (!run?.memoryContext || !Array.isArray(run.memoryContext.sources) || run.memoryContext.sources.length === 0) {
      return message;
    }
    return {
      ...message,
      metadata: {
        ...(message.metadata ?? {}),
        aiRunId: run.id,
        memorySources: run.memoryContext.sources,
      },
    };
  });
  return NextResponse.json({
    chat: owned.chat,
    topic: owned.topic ? toPublicTopic(owned.topic) : null,
    messages: messagesWithMemorySources,
    activityRun: sanitizeActivityRun(activityRun),
  });
}
