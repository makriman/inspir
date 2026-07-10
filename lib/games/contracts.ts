import { z } from "zod";

export const GAME_STATE_SCHEMA_VERSION = 1 as const;
export const GAME_RESULT_SCHEMA_VERSION = 1 as const;

export const gameSlugSchema = z.enum(["tic-tac-toe", "connect-four", "chess"]);
export type GameSlug = z.infer<typeof gameSlugSchema>;

export const gameActorSchema = z.enum(["human", "opponent"]);
export type GameActor = z.infer<typeof gameActorSchema>;

export const gameWinnerSchema = z.union([gameActorSchema, z.literal("draw")]);
export type GameWinner = z.infer<typeof gameWinnerSchema>;

export const gameOutcomeSchema = z.enum(["win", "loss", "draw"]);
export type GameOutcome = z.infer<typeof gameOutcomeSchema>;

export type GameMoveErrorCode = "game-complete" | "not-your-turn" | "illegal-move";

const gameTerminalCodeSchema = z.enum([
  "tic-tac-toe:three-in-a-row",
  "tic-tac-toe:board-full",
  "connect-four:four-in-a-row",
  "connect-four:board-full",
  "chess:checkmate",
  "chess:stalemate",
  "chess:insufficient-material",
  "chess:threefold-repetition",
  "chess:fifty-move-rule",
  "chess:move-limit",
]);
export type GameTerminalCode = z.infer<typeof gameTerminalCodeSchema>;

const engineIdentitySchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(80),
  })
  .strict();

const opponentProvenanceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("deterministic-engine"),
      engine: engineIdentitySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("model"),
      provider: z.string().trim().min(1).max(80),
      model: z.string().trim().min(1).max(160),
      modelVersion: z.string().trim().min(1).max(160),
      responseId: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("deterministic-fallback"),
      intendedProvider: z.string().trim().min(1).max(80),
      intendedModel: z.string().trim().min(1).max(160),
      intendedModelVersion: z.string().trim().min(1).max(160),
      fallbackEngine: engineIdentitySchema,
      reason: z.enum(["credentials-unavailable", "provider-error", "invalid-model-move", "timeout"]),
    })
    .strict(),
]);
export type OpponentProvenance = z.infer<typeof opponentProvenanceSchema>;

const gameResultProvenanceSchema = z
  .object({
    rulesEngine: engineIdentitySchema,
    opponent: opponentProvenanceSchema,
  })
  .strict();
export type GameResultProvenance = z.infer<typeof gameResultProvenanceSchema>;

const terminalCodesByGame: Record<GameSlug, ReadonlySet<GameTerminalCode>> = {
  "tic-tac-toe": new Set(["tic-tac-toe:three-in-a-row", "tic-tac-toe:board-full"]),
  "connect-four": new Set(["connect-four:four-in-a-row", "connect-four:board-full"]),
  chess: new Set([
    "chess:checkmate",
    "chess:stalemate",
    "chess:insufficient-material",
    "chess:threefold-repetition",
    "chess:fifty-move-rule",
    "chess:move-limit",
  ]),
};

export const gameResultSnapshotSchema = z
  .object({
    schemaVersion: z.literal(GAME_RESULT_SCHEMA_VERSION),
    gameSlug: gameSlugSchema,
    engineId: z.string().trim().min(1).max(120),
    engineVersion: z.string().trim().min(1).max(80),
    winner: gameWinnerSchema,
    outcome: gameOutcomeSchema,
    terminalCode: gameTerminalCodeSchema,
    plyCount: z.number().int().nonnegative(),
    provenance: gameResultProvenanceSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (!terminalCodesByGame[result.gameSlug].has(result.terminalCode)) {
      context.addIssue({
        code: "custom",
        path: ["terminalCode"],
        message: `Terminal code does not belong to ${result.gameSlug}.`,
      });
    }

    if (result.outcome !== outcomeForWinner(result.winner)) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Outcome does not match the winner.",
      });
    }

    if (result.engineVersion !== result.provenance.rulesEngine.version) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "rulesEngine", "version"],
        message: "Rules-engine provenance must match the result engine version.",
      });
    }

    if (result.engineId !== result.provenance.rulesEngine.id) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "rulesEngine", "id"],
        message: "Rules-engine provenance must match the result engine ID.",
      });
    }
  });
export type GameResultSnapshot = z.infer<typeof gameResultSnapshotSchema>;

export type ApplyGameMoveResult<State, Action> =
  | { ok: true; state: State; action: Action }
  | { ok: false; state: State; error: GameMoveErrorCode };

export function outcomeForWinner(winner: GameWinner): GameOutcome {
  if (winner === "human") return "win";
  if (winner === "opponent") return "loss";
  return "draw";
}
