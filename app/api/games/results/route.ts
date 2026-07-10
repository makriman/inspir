import { writeFreezeResponse } from "@/lib/migration/write-freeze";
import { insertPublicGameResult } from "@/lib/games/result-repository";
import {
  noStoreGameResultJson,
  protectGameResultResponse,
  readBoundedGameResultJson,
} from "@/lib/games/result-http";
import { consumeGameResultGuestQuota } from "@/lib/games/result-rate-limit";
import { buildPublicGameResult } from "@/lib/games/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public writes are intentional: submitted games contain no account or personal data.
 * Every write is byte-bounded, server-rate-limited, strictly replayed, and completed
 * before a durable public snapshot is created.
 */
export async function POST(request: Request) {
  const freeze = writeFreezeResponse("game-results");
  if (freeze) return protectGameResultResponse(freeze);

  // Consume the authoritative edge-derived quota before reading or parsing an
  // attacker-controlled body. D1 failures fail closed inside this game-only limiter.
  const quota = await consumeGameResultGuestQuota(request);
  if (!quota.ok) {
    return noStoreGameResultJson(
      { error: "Game result limit reached", code: "rate-limit", bucket: quota.bucket },
      429,
      { "Retry-After": String(quota.retryAfterSeconds) },
    );
  }

  const body = await readBoundedGameResultJson(request);
  if (!body.ok) {
    const status = body.code === "payload-too-large" ? 413 : body.code === "invalid-content-type" ? 415 : 400;
    return noStoreGameResultJson({ error: "Invalid game result request", code: body.code }, status);
  }

  const built = buildPublicGameResult(body.value);
  if (!built.ok) {
    const status = built.code === "incomplete-game" || built.code === "too-many-moves" ? 422 : 400;
    return noStoreGameResultJson({ error: "Invalid completed game", code: built.code }, status);
  }

  try {
    await insertPublicGameResult(built.result);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "game_result_insert_failed",
        resultId: built.result.id,
        gameSlug: built.result.gameSlug,
        error: error instanceof Error ? error.message : "Unknown D1 failure",
      }),
    );
    return noStoreGameResultJson(
      { error: "Game result storage is temporarily unavailable", code: "storage-unavailable" },
      503,
      { "Retry-After": "5" },
    );
  }

  return noStoreGameResultJson(
    { result: built.result },
    201,
    { Location: `/api/games/results/${built.result.id}` },
  );
}
