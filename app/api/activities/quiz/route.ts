import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createActivityRun, getOwnedChat, getUserLearningProfileById, insertMessage } from "@/lib/db/queries";
import { generateQuiz, sanitizeQuizState } from "@/lib/activities/quiz";
import { calculateAge } from "@/lib/profile/age";
import { consumeAiQuota, numberFromEnv, quotaDefaults, safeQuotaKeyPart } from "@/lib/utils/rate-limit";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startQuizSchema = z.object({
  chatId: z.uuid(),
  topic: z.string().trim().min(1).max(180),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("activities");
  if (freeze) return freeze;

  const parsed = startQuizSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid quiz request" }, { status: 400 });

  const owned = await getOwnedChat(parsed.data.chatId, session.user.id);
  if (!owned?.topic || owned.topic.slug !== "quiz-me-on-trivia") {
    return NextResponse.json({ error: "Quiz chat not found" }, { status: 404 });
  }

  const limit = await consumeAiQuota({
    key: `activity:quiz:${safeQuotaKeyPart(session.user.id)}`,
    limit: numberFromEnv("RATE_LIMIT_ACTIVITY_DAILY", quotaDefaults.activityDaily),
  });
  if (!limit.quota.ok) return quotaResponse("Daily activity limit reached", limit.quota.retryAfterSeconds);
  if (limit.budget && !limit.budget.ok) return quotaResponse("Daily AI usage limit reached", limit.budget.retryAfterSeconds);

  const user = await getUserLearningProfileById(session.user.id);
  const quiz = await generateQuiz(parsed.data.topic, {
    learnerAge: calculateAge(user?.dateOfBirth),
    preferredLanguage: user?.preferredLanguage,
  });
  const run = await createActivityRun({
    chatId: parsed.data.chatId,
    type: "quiz",
    state: quiz,
    score: 0,
    maxScore: quiz.maxScore,
  });

  await insertMessage({
    chatId: parsed.data.chatId,
    role: "user",
    content: `Quiz me on ${parsed.data.topic}`,
    metadata: { activityRunId: run.id, activityType: "quiz", event: "started" },
  });
  await insertMessage({
    chatId: parsed.data.chatId,
    role: "assistant",
    content: `Your 10-question quiz on ${parsed.data.topic} is ready. Answer one question at a time and I will score it as you go.`,
    metadata: { activityRunId: run.id, activityType: "quiz", event: "started" },
  });

  return NextResponse.json({ activityRun: { ...run, state: sanitizeQuizState(quiz) } });
}

function quotaResponse(error: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}
