import { NextRequest, NextResponse } from "next/server";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";
import { eq, sql as dsql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { aiRuns, users } from "@/lib/db/schema";
import { getContextMessages, getOwnedChat, insertMessage } from "@/lib/db/queries";
import { buildModelMessages } from "@/lib/ai/prompts";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatRequestSchema = z.object({
  chatId: z.uuid(),
  content: z.string().trim().min(1).max(6000),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rate = checkRateLimit(`chat:${session.user.id}`, 60, 24 * 60 * 60 * 1000);
  if (!rate.ok) {
    return NextResponse.json({ error: "Daily message limit reached" }, { status: 429 });
  }

  const parsed = chatRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });
  }

  const owned = await getOwnedChat(parsed.data.chatId, session.user.id);
  if (!owned?.topic) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const userMessage = await insertMessage({
    chatId: parsed.data.chatId,
    role: "user",
    content: parsed.data.content,
  });

  const context = await getContextMessages(parsed.data.chatId);
  const assembled = buildModelMessages(owned.topic.systemPrompt, context);
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  const [run] = await db
    .insert(aiRuns)
    .values({
      chatId: parsed.data.chatId,
      userMessageId: userMessage.id,
      model,
      status: "started",
    })
    .returning();

  try {
    const result = streamText({
      model: openai(model),
      system: assembled.system,
      messages: assembled.messages,
      temperature: 0.7,
      maxOutputTokens: 2500,
      onFinish: async (event) => {
        const assistant = await insertMessage({
          chatId: parsed.data.chatId,
          role: "assistant",
          content: event.text,
        });
        await db
          .update(aiRuns)
          .set({
            assistantMessageId: assistant.id,
            promptTokens: event.totalUsage.inputTokens ?? null,
            completionTokens: event.totalUsage.outputTokens ?? null,
            totalTokens: event.totalUsage.totalTokens ?? null,
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(aiRuns.id, run.id));
        if (owned.topic?.slug === "quiz-me-on-trivia" && /^correct\b/i.test(event.text.trim())) {
          await db
            .update(users)
            .set({ score: dsql`${users.score} + 1`, updatedAt: new Date() })
            .where(eq(users.id, session.user.id));
        }
      },
    });

    return result.toTextStreamResponse();
  } catch (error) {
    await db
      .update(aiRuns)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown AI error",
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, run.id));
    return NextResponse.json({ error: "The assistant could not answer right now." }, { status: 500 });
  }
}
