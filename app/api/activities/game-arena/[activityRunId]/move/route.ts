import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  getActivityRunById,
  getOwnedChat,
  getUserLearningProfileById,
  insertMessage,
  updateActivityRunGuarded,
} from "@/lib/db/queries";
import {
  applyHumanGameMove,
  applyModelGameMove,
  gameArenaActivityType,
  gameArenaScore,
  parseGameArenaState,
  sanitizeGameArenaState,
} from "@/lib/activities/game-arena";
import { consumeAiQuota, numberFromEnv, quotaDefaults, safeQuotaKeyPart } from "@/lib/utils/rate-limit";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moveSchema = z.object({
  action: z.string().trim().min(1).max(20),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ activityRunId: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("activities");
  if (freeze) return freeze;

  const body = moveSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid move" }, { status: 400 });

  const { activityRunId } = await params;
  const run = await getActivityRunById(activityRunId);
  if (!run || run.type !== gameArenaActivityType) {
    return NextResponse.json({ error: "Game arena match not found" }, { status: 404 });
  }

  const owned = await getOwnedChat(run.chatId, session.user.id);
  if (!owned) return NextResponse.json({ error: "Game arena match not found" }, { status: 404 });

  const parsed = parseGameArenaState(run.state);
  if (!parsed.success) return NextResponse.json({ error: "Game arena state is invalid" }, { status: 409 });

  const humanMove = applyHumanGameMove(parsed.data, body.data.action);
  if (!humanMove.ok) {
    return NextResponse.json(
      { error: humanMove.error, activityRun: { ...run, state: sanitizeGameArenaState(humanMove.state) } },
      { status: 400 },
    );
  }

  const user = await getUserLearningProfileById(session.user.id);
  let nextState = humanMove.state;
  if (!nextState.completed && nextState.activePlayer === "model") {
    const limit = await consumeGameArenaQuota(session.user.id);
    if (!limit.ok) return quotaResponse(limit.error, limit.retryAfterSeconds);

    const modelMove = await applyModelGameMove(nextState, { preferredLanguage: user?.preferredLanguage });
    if (modelMove.ok) nextState = modelMove.state;
  }

  const score = gameArenaScore(nextState);
  const updated = await updateActivityRunGuarded(
    run.id,
    {
      status: nextState.completed ? "completed" : "active",
      state: nextState,
      score: score.score,
      maxScore: score.maxScore,
      completedAt: nextState.completed ? new Date() : null,
    },
    { currentIndex: parsed.data.currentIndex, status: run.status },
  );

  if (!updated) {
    const latest = await getActivityRunById(run.id);
    const latestState = latest ? parseGameArenaState(latest.state) : null;
    return NextResponse.json(
      {
        activityRun:
          latest && latestState?.success
            ? { ...latest, state: sanitizeGameArenaState(latestState.data) }
            : latest,
      },
      { status: 409 },
    );
  }

  if (nextState.completed && run.status !== "completed") {
    await insertMessage({
      chatId: run.chatId,
      role: "assistant",
      content: `${nextState.gameName} complete: ${completionLabel(nextState.winner)}.`,
      metadata: { activityRunId: run.id, activityType: gameArenaActivityType, event: "completed" },
    });
  }

  return NextResponse.json({
    activityRun: { ...updated, state: sanitizeGameArenaState(nextState) },
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

function completionLabel(winner: "human" | "model" | "draw" | null) {
  if (winner === "human") return "you won";
  if (winner === "model") return "OpenAI won";
  return "draw";
}
