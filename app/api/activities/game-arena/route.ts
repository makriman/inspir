import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createActivityRun, getOwnedChat, getUserLearningProfileById, insertMessage } from "@/lib/db/queries";
import {
  applyModelGameMove,
  createGameArenaState,
  gameArenaActivityType,
  gameArenaCatalog,
  gameArenaModelOptions,
  gameArenaScore,
  gameArenaTopicSlug,
  sanitizeGameArenaState,
} from "@/lib/activities/game-arena";
import { consumeAiQuota, numberFromEnv, quotaDefaults, safeQuotaKeyPart } from "@/lib/utils/rate-limit";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startGameArenaSchema = z.object({
  chatId: z.uuid(),
  gameSlug: z.enum(["tic-tac-toe", "connect-four", "chess"]),
  humanSide: z.string().trim().min(1).max(20).optional(),
  modelProfile: z.enum(["fast", "reasoning"]).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("activities");
  if (freeze) return freeze;

  const parsed = startGameArenaSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid game request" }, { status: 400 });

  const owned = await getOwnedChat(parsed.data.chatId, session.user.id);
  if (!owned?.topic || owned.topic.slug !== gameArenaTopicSlug) {
    return NextResponse.json({ error: "Game arena chat not found" }, { status: 404 });
  }

  const user = await getUserLearningProfileById(session.user.id);
  let state = createGameArenaState(parsed.data);
  if (state.activePlayer === "model") {
    const limit = await consumeGameArenaQuota(session.user.id);
    if (!limit.ok) return quotaResponse(limit.error, limit.retryAfterSeconds);

    const result = await applyModelGameMove(state, { preferredLanguage: user?.preferredLanguage });
    if (result.ok) state = result.state;
  }
  const score = gameArenaScore(state);
  const run = await createActivityRun({
    chatId: parsed.data.chatId,
    type: gameArenaActivityType,
    status: state.completed ? "completed" : "active",
    state,
    score: score.score,
    maxScore: score.maxScore,
  });

  await insertMessage({
    chatId: parsed.data.chatId,
    role: "user",
    content: `Start an AI game arena match: ${state.gameName}`,
    metadata: { activityRunId: run.id, activityType: gameArenaActivityType, event: "started" },
  });
  await insertMessage({
    chatId: parsed.data.chatId,
    role: "assistant",
    content: `${state.gameName} is ready. You are ${state.humanSide}; OpenAI is ${state.modelSide}.`,
    metadata: { activityRunId: run.id, activityType: gameArenaActivityType, event: "started" },
  });

  return NextResponse.json({
    activityRun: { ...run, state: sanitizeGameArenaState(state) },
    catalog: { games: gameArenaCatalog, models: gameArenaModelOptions },
  });
}

async function consumeGameArenaQuota(userId: string) {
  const limit = await consumeAiQuota({
    key: `activity:game-arena:${safeQuotaKeyPart(userId)}`,
    limit: numberFromEnv("RATE_LIMIT_ACTIVITY_DAILY", quotaDefaults.activityDaily),
  });
  if (!limit.quota.ok) {
    return { ok: false as const, error: "Daily activity limit reached", retryAfterSeconds: limit.quota.retryAfterSeconds };
  }
  if (limit.budget && !limit.budget.ok) {
    return { ok: false as const, error: "Daily AI usage limit reached", retryAfterSeconds: limit.budget.retryAfterSeconds };
  }
  return { ok: true as const };
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
