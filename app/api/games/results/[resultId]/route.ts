import { getPublicGameResult } from "@/lib/games/result-repository";
import { immutableGameResultJson, noStoreGameResultJson } from "@/lib/games/result-http";
import { gameResultIdSchema } from "@/lib/games/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GameResultRouteContext = {
  params: Promise<{ resultId: string }>;
};

/** Public read is intentional: immutable game snapshots contain no account or personal data. */
export async function GET(_request: Request, context: GameResultRouteContext) {
  const { resultId } = await context.params;
  const parsedId = gameResultIdSchema.safeParse(resultId);
  if (!parsedId.success) {
    return noStoreGameResultJson({ error: "Game result not found", code: "not-found" }, 404);
  }

  try {
    const result = await getPublicGameResult(parsedId.data);
    if (!result) {
      return noStoreGameResultJson({ error: "Game result not found", code: "not-found" }, 404);
    }
    return immutableGameResultJson({ result });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "game_result_read_failed",
        resultId: parsedId.data,
        error: error instanceof Error ? error.message : "Unknown D1 failure",
      }),
    );
    return noStoreGameResultJson(
      { error: "Game result storage is temporarily unavailable", code: "storage-unavailable" },
      503,
      { "Retry-After": "5" },
    );
  }
}
