import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gameResults } from "@/lib/db/schema";
import {
  publicGameResultSchema,
  type GameResultId,
  type PublicGameResult,
  type ServerValidatedPublicGameResult,
} from "./results";

export async function insertPublicGameResult(result: ServerValidatedPublicGameResult): Promise<void> {
  await db.insert(gameResults).values({
    id: result.id,
    schemaVersion: result.schemaVersion,
    gameSlug: result.gameSlug,
    engineId: result.engine.id,
    engineVersion: result.engine.version,
    terminalCode: result.terminalCode,
    winner: result.winner,
    outcome: result.outcome,
    plyCount: result.plyCount,
    payload: result,
    startedAt: result.startedAt ? new Date(result.startedAt) : null,
    completedAt: new Date(result.completedAt),
    durationMs: result.durationMs,
    createdAt: new Date(result.createdAt),
  });
}

export async function getPublicGameResult(resultId: GameResultId): Promise<PublicGameResult | null> {
  const rows = await db
    .select()
    .from(gameResults)
    .where(eq(gameResults.id, resultId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const parsed = publicGameResultSchema.safeParse(row.payload);
  if (!parsed.success || !rowMatchesPayload(row, parsed.data)) {
    throw new Error("Stored game result failed immutable snapshot validation.");
  }
  return parsed.data;
}

type StoredGameResultRow = typeof gameResults.$inferSelect;

function rowMatchesPayload(row: StoredGameResultRow, result: PublicGameResult) {
  return (
    row.id === result.id &&
    row.schemaVersion === result.schemaVersion &&
    row.gameSlug === result.gameSlug &&
    row.engineId === result.engine.id &&
    row.engineVersion === result.engine.version &&
    row.terminalCode === result.terminalCode &&
    row.winner === result.winner &&
    row.outcome === result.outcome &&
    row.plyCount === result.plyCount &&
    sameOptionalTimestamp(row.startedAt, result.startedAt) &&
    row.completedAt.toISOString() === result.completedAt &&
    row.durationMs === result.durationMs &&
    row.createdAt.toISOString() === result.createdAt
  );
}

function sameOptionalTimestamp(stored: Date | null, serialized: string | null) {
  if (!stored || !serialized) return stored === null && serialized === null;
  return stored.toISOString() === serialized;
}
