import { z } from "zod";
import {
  CHESS_MAX_PLIES,
  CHESS_INITIAL_FEN,
  chessMoveSchema,
  chessStateSnapshotSchema,
  parseChessResultSubmissionState,
  type ChessState,
} from "./chess";
import {
  CHESS_LOCAL_STRATEGY_ID,
  CHESS_LOCAL_STRATEGY_VERSION,
  chooseChessOpponentTokenFromLegalMoves,
} from "./chess-strategy";
import {
  CONNECT_FOUR_ENGINE_ID,
  CONNECT_FOUR_ENGINE_VERSION,
  createConnectFourState,
  applyConnectFourMove,
  connectFourMoveSchema,
  connectFourStateSchema,
  type ConnectFourState,
} from "./connect-four";
import {
  CONNECT_FOUR_LOCAL_STRATEGY_ID,
  CONNECT_FOUR_LOCAL_STRATEGY_VERSION,
  chooseConnectFourOpponentAction,
} from "./connect-four-strategy";
import {
  GAME_RESULT_SCHEMA_VERSION,
  gameOutcomeSchema,
  gameWinnerSchema,
  outcomeForWinner,
} from "./contracts";
import {
  CHESS_ENGINE_ID,
  CHESS_ENGINE_VERSION,
  TIC_TAC_TOE_ENGINE_ID,
  TIC_TAC_TOE_ENGINE_VERSION,
} from "./catalog";
import {
  applyTicTacToeMove,
  createTicTacToeState,
  ticTacToeMoveSchema,
  ticTacToeStateSchema,
  type TicTacToeState,
} from "./tic-tac-toe";
import {
  TIC_TAC_TOE_LOCAL_STRATEGY_ID,
  TIC_TAC_TOE_LOCAL_STRATEGY_VERSION,
  chooseTicTacToeOpponentAction,
} from "./tic-tac-toe-strategy";

export const MAX_GAME_RESULT_REQUEST_BYTES = 96 * 1024;
export const MAX_PERSISTED_GAME_PLIES = CHESS_MAX_PLIES;
export const MAX_REPORTED_GAME_DURATION_MS = 24 * 60 * 60 * 1000;

export const localStrategyIds = {
  "tic-tac-toe": TIC_TAC_TOE_LOCAL_STRATEGY_ID,
  "connect-four": CONNECT_FOUR_LOCAL_STRATEGY_ID,
  chess: CHESS_LOCAL_STRATEGY_ID,
} as const;

export const localStrategyVersions = {
  "tic-tac-toe": TIC_TAC_TOE_LOCAL_STRATEGY_VERSION,
  "connect-four": CONNECT_FOUR_LOCAL_STRATEGY_VERSION,
  chess: CHESS_LOCAL_STRATEGY_VERSION,
} as const;

export const gameResultIdSchema = z.string().regex(/^gr_[a-f0-9]{32}$/).brand<"game-result-id">();
export type GameResultId = z.infer<typeof gameResultIdSchema>;

const utcTimestampSchema = z.string().datetime({ offset: true });
const engineSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(80),
  })
  .strict();

const deterministicOpponentSchema = z
  .object({
    kind: z.literal("deterministic-engine"),
    engine: engineSchema,
  })
  .strict();

const publicResultBase = {
  schemaVersion: z.literal(GAME_RESULT_SCHEMA_VERSION),
  id: gameResultIdSchema,
  winner: gameWinnerSchema,
  outcome: gameOutcomeSchema,
  plyCount: z.number().int().nonnegative().max(MAX_PERSISTED_GAME_PLIES),
  startedAt: utcTimestampSchema.nullable(),
  completedAt: utcTimestampSchema,
  durationMs: z.number().int().nonnegative().max(MAX_REPORTED_GAME_DURATION_MS).nullable(),
  createdAt: utcTimestampSchema,
} as const;

const ticTacToePublicResultSchema = z
  .object({
    ...publicResultBase,
    gameSlug: z.literal("tic-tac-toe"),
    engine: z
      .object({
        id: z.literal(TIC_TAC_TOE_ENGINE_ID),
        version: z.literal(TIC_TAC_TOE_ENGINE_VERSION),
      })
      .strict(),
    opponent: z
      .object({
        kind: z.literal("deterministic-engine"),
        engine: z
          .object({
            id: z.literal(localStrategyIds["tic-tac-toe"]),
            version: z.literal(localStrategyVersions["tic-tac-toe"]),
          })
          .strict(),
      })
      .strict(),
    terminalCode: z.enum(["tic-tac-toe:three-in-a-row", "tic-tac-toe:board-full"]),
    winningCells: z
      .tuple([
        z.number().int().min(0).max(8),
        z.number().int().min(0).max(8),
        z.number().int().min(0).max(8),
      ])
      .readonly()
      .nullable(),
    state: ticTacToeStateSchema,
    replay: z
      .object({
        initialState: z.object({ humanMark: z.enum(["x", "o"]) }).strict(),
        moves: z.array(ticTacToeMoveSchema).max(9).readonly(),
      })
      .strict(),
  })
  .strict();

const connectFourPublicResultSchema = z
  .object({
    ...publicResultBase,
    gameSlug: z.literal("connect-four"),
    engine: z
      .object({
        id: z.literal(CONNECT_FOUR_ENGINE_ID),
        version: z.literal(CONNECT_FOUR_ENGINE_VERSION),
      })
      .strict(),
    opponent: z
      .object({
        kind: z.literal("deterministic-engine"),
        engine: z
          .object({
            id: z.literal(localStrategyIds["connect-four"]),
            version: z.literal(localStrategyVersions["connect-four"]),
          })
          .strict(),
      })
      .strict(),
    terminalCode: z.enum(["connect-four:four-in-a-row", "connect-four:board-full"]),
    winningCells: z
      .tuple([
        z.number().int().min(0).max(41),
        z.number().int().min(0).max(41),
        z.number().int().min(0).max(41),
        z.number().int().min(0).max(41),
      ])
      .readonly()
      .nullable(),
    state: connectFourStateSchema,
    replay: z
      .object({
        initialState: z.object({ humanDisc: z.enum(["red", "yellow"]) }).strict(),
        moves: z.array(connectFourMoveSchema).max(42).readonly(),
      })
      .strict(),
  })
  .strict();

const chessPublicResultSchema = z
  .object({
    ...publicResultBase,
    gameSlug: z.literal("chess"),
    engine: z
      .object({
        id: z.literal(CHESS_ENGINE_ID),
        version: z.literal(CHESS_ENGINE_VERSION),
      })
      .strict(),
    opponent: z
      .object({
        kind: z.literal("deterministic-engine"),
        engine: z
          .object({
            id: z.literal(localStrategyIds.chess),
            version: z.literal(localStrategyVersions.chess),
          })
          .strict(),
      })
      .strict(),
    terminalCode: z.enum([
      "chess:checkmate",
      "chess:stalemate",
      "chess:insufficient-material",
      "chess:threefold-repetition",
      "chess:fifty-move-rule",
      "chess:move-limit",
    ]),
    winningCells: z.null(),
    // The authoritative POST replay already proves chess semantics and the
    // deterministic opponent. Immutable snapshots only need structural and
    // cross-field validation when inserted or read back from D1.
    state: chessStateSnapshotSchema,
    replay: z
      .object({
        initialState: z
          .object({
            initialFen: z.literal(CHESS_INITIAL_FEN),
            humanColor: z.enum(["w", "b"]),
          })
          .strict(),
        moves: z.array(chessMoveSchema).max(MAX_PERSISTED_GAME_PLIES).readonly(),
      })
      .strict(),
  })
  .strict();

export const publicGameResultSchema = z
  .discriminatedUnion("gameSlug", [
    ticTacToePublicResultSchema,
    connectFourPublicResultSchema,
    chessPublicResultSchema,
  ])
  .superRefine((record, context) => {
    const stateResult = record.state.result;
    if (!stateResult) {
      context.addIssue({ code: "custom", path: ["state", "result"], message: "Game is incomplete." });
      return;
    }
    if (
      stateResult.winner !== record.winner ||
      stateResult.outcome !== record.outcome ||
      stateResult.terminalCode !== record.terminalCode ||
      stateResult.plyCount !== record.plyCount
    ) {
      context.addIssue({ code: "custom", path: ["state", "result"], message: "Result does not match state." });
    }
    if (record.outcome !== outcomeForWinner(record.winner)) {
      context.addIssue({ code: "custom", path: ["outcome"], message: "Outcome does not match winner." });
    }
    if (record.createdAt !== record.completedAt) {
      context.addIssue({ code: "custom", path: ["createdAt"], message: "Created and completed times must match." });
    }
    const completedAt = Date.parse(record.completedAt);
    if (record.startedAt === null) {
      if (record.durationMs !== null) {
        context.addIssue({ code: "custom", path: ["durationMs"], message: "Duration requires a start time." });
      }
    } else {
      const expectedDuration = completedAt - Date.parse(record.startedAt);
      if (expectedDuration < 0 || record.durationMs !== expectedDuration) {
        context.addIssue({ code: "custom", path: ["durationMs"], message: "Duration does not match timestamps." });
      }
    }
    if (!sameJson(record.replay.moves, record.state.history)) {
      context.addIssue({ code: "custom", path: ["replay", "moves"], message: "Replay does not match state history." });
    }
    if (record.gameSlug === "tic-tac-toe") {
      if (record.replay.initialState.humanMark !== record.state.humanMark) {
        context.addIssue({ code: "custom", path: ["replay", "initialState"], message: "Replay side does not match." });
      }
      const result = record.state.result;
      if (!result || !sameNumbers(record.winningCells, result.winningCells)) {
        context.addIssue({ code: "custom", path: ["winningCells"], message: "Winning cells do not match." });
      }
    } else if (record.gameSlug === "connect-four") {
      if (record.replay.initialState.humanDisc !== record.state.humanDisc) {
        context.addIssue({ code: "custom", path: ["replay", "initialState"], message: "Replay side does not match." });
      }
      const result = record.state.result;
      if (!result || !sameNumbers(record.winningCells, result.winningCells)) {
        context.addIssue({ code: "custom", path: ["winningCells"], message: "Winning cells do not match." });
      }
    } else {
      if (
        record.replay.initialState.initialFen !== record.state.initialFen ||
        record.replay.initialState.humanColor !== record.state.humanColor
      ) {
        context.addIssue({ code: "custom", path: ["replay", "initialState"], message: "Replay side does not match." });
      }
    }
  });

export type PublicGameResult = z.infer<typeof publicGameResultSchema>;
const serverValidatedPublicGameResultSchema = publicGameResultSchema.brand<"server-validated-game-result">();
export type ServerValidatedPublicGameResult = z.infer<typeof serverValidatedPublicGameResultSchema>;

const gameResultSubmissionSchema = z
  .object({
    state: z.unknown(),
    startedAt: utcTimestampSchema.optional(),
  })
  .strict();

export type GameResultBuildErrorCode =
  | "invalid-request"
  | "unsupported-game"
  | "invalid-state"
  | "incomplete-game"
  | "too-many-moves"
  | "invalid-started-at";

export type GameResultBuildResult =
  | { ok: true; result: ServerValidatedPublicGameResult }
  | { ok: false; code: GameResultBuildErrorCode };

export function buildPublicGameResult(
  input: unknown,
  options: { now?: Date; resultId?: string } = {},
): GameResultBuildResult {
  const submission = gameResultSubmissionSchema.safeParse(input);
  if (!submission.success) return { ok: false, code: "invalid-request" };

  const now = options.now ?? new Date();
  const times = parseResultTimes(submission.data.startedAt, now);
  if (!times) return { ok: false, code: "invalid-started-at" };

  const parsedResultId = gameResultIdSchema.safeParse(options.resultId ?? createOpaqueGameResultId());
  if (!parsedResultId.success) return { ok: false, code: "invalid-request" };
  const resultId = parsedResultId.data;

  const rawSlug = objectProperty(submission.data.state, "gameSlug");
  const rawHistory = objectProperty(submission.data.state, "history");
  if (!Array.isArray(rawHistory)) return { ok: false, code: "invalid-state" };
  if (rawHistory.length > MAX_PERSISTED_GAME_PLIES) return { ok: false, code: "too-many-moves" };

  if (rawSlug === "tic-tac-toe") {
    return buildTicTacToeResult(submission.data.state, resultId, times);
  }
  if (rawSlug === "connect-four") {
    return buildConnectFourResult(submission.data.state, resultId, times);
  }
  if (rawSlug === "chess") {
    return buildChessResult(submission.data.state, resultId, times);
  }
  return { ok: false, code: "unsupported-game" };
}

function createOpaqueGameResultId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `gr_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function buildTicTacToeResult(
  value: unknown,
  resultId: GameResultId,
  times: ResultTimes,
): GameResultBuildResult {
  const parsed = ticTacToeStateSchema.safeParse(value);
  if (!parsed.success) return { ok: false, code: "invalid-state" };

  let state = createTicTacToeState(parsed.data.humanMark);
  for (const move of parsed.data.history) {
    if (move.actor === "opponent") {
      const expected = chooseTicTacToeOpponentAction(state);
      if (!expected || expected.index !== move.index) return { ok: false, code: "invalid-state" };
    }
    const applied = applyTicTacToeMove(state, move.actor, { index: move.index });
    if (!applied.ok) return { ok: false, code: "invalid-state" };
    state = applied.state;
  }
  if (!state.result) return { ok: false, code: "incomplete-game" };

  return parseBuiltResult({
    ...resultBase(resultId, times),
    gameSlug: "tic-tac-toe",
    engine: { id: TIC_TAC_TOE_ENGINE_ID, version: TIC_TAC_TOE_ENGINE_VERSION },
    opponent: deterministicOpponent("tic-tac-toe"),
    winner: state.result.winner,
    outcome: state.result.outcome,
    terminalCode: state.result.terminalCode,
    winningCells: state.result.winningCells,
    plyCount: state.result.plyCount,
    state,
    replay: { initialState: { humanMark: state.humanMark }, moves: state.history },
  });
}

function buildConnectFourResult(
  value: unknown,
  resultId: GameResultId,
  times: ResultTimes,
): GameResultBuildResult {
  const parsed = connectFourStateSchema.safeParse(value);
  if (!parsed.success) return { ok: false, code: "invalid-state" };

  let state = createConnectFourState(parsed.data.humanDisc);
  for (const move of parsed.data.history) {
    if (move.actor === "opponent") {
      const expected = chooseConnectFourOpponentAction(state);
      if (!expected || expected.column !== move.column) return { ok: false, code: "invalid-state" };
    }
    const applied = applyConnectFourMove(state, move.actor, { column: move.column });
    if (!applied.ok) return { ok: false, code: "invalid-state" };
    state = applied.state;
  }
  if (!state.result) return { ok: false, code: "incomplete-game" };

  return parseBuiltResult({
    ...resultBase(resultId, times),
    gameSlug: "connect-four",
    engine: { id: CONNECT_FOUR_ENGINE_ID, version: CONNECT_FOUR_ENGINE_VERSION },
    opponent: deterministicOpponent("connect-four"),
    winner: state.result.winner,
    outcome: state.result.outcome,
    terminalCode: state.result.terminalCode,
    winningCells: state.result.winningCells,
    plyCount: state.result.plyCount,
    state,
    replay: { initialState: { humanDisc: state.humanDisc }, moves: state.history },
  });
}

function buildChessResult(value: unknown, resultId: GameResultId, times: ResultTimes): GameResultBuildResult {
  if (objectProperty(value, "initialFen") !== CHESS_INITIAL_FEN) {
    return { ok: false, code: "invalid-state" };
  }
  const parsed = parseChessResultSubmissionState(value, chooseChessOpponentTokenFromLegalMoves);
  if (!parsed.success) return { ok: false, code: "invalid-state" };
  const state = parsed.data;
  if (!state.result) return { ok: false, code: "incomplete-game" };

  return parseBuiltResult({
    ...resultBase(resultId, times),
    gameSlug: "chess",
    engine: { id: CHESS_ENGINE_ID, version: CHESS_ENGINE_VERSION },
    opponent: deterministicOpponent("chess"),
    winner: state.result.winner,
    outcome: state.result.outcome,
    terminalCode: state.result.terminalCode,
    winningCells: null,
    plyCount: state.result.plyCount,
    state,
    replay: {
      initialState: { initialFen: CHESS_INITIAL_FEN, humanColor: state.humanColor },
      moves: state.history,
    },
  });
}

type ResultTimes = Readonly<{
  startedAt: string | null;
  completedAt: string;
  durationMs: number | null;
  createdAt: string;
}>;

function parseResultTimes(startedAt: string | undefined, now: Date): ResultTimes | null {
  const completedAtMs = now.getTime();
  if (!Number.isFinite(completedAtMs)) return null;
  const completedAt = new Date(completedAtMs).toISOString();
  if (startedAt === undefined) {
    return { startedAt: null, completedAt, durationMs: null, createdAt: completedAt };
  }
  const startedAtMs = Date.parse(startedAt);
  const durationMs = completedAtMs - startedAtMs;
  if (!Number.isFinite(startedAtMs) || durationMs < 0 || durationMs > MAX_REPORTED_GAME_DURATION_MS) {
    return null;
  }
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt,
    durationMs,
    createdAt: completedAt,
  };
}

function resultBase(resultId: GameResultId, times: ResultTimes) {
  return {
    schemaVersion: GAME_RESULT_SCHEMA_VERSION,
    id: resultId,
    ...times,
  } as const;
}

function deterministicOpponent(gameSlug: keyof typeof localStrategyIds) {
  return deterministicOpponentSchema.parse({
    kind: "deterministic-engine",
    engine: { id: localStrategyIds[gameSlug], version: localStrategyVersions[gameSlug] },
  });
}

function parseBuiltResult(value: unknown): GameResultBuildResult {
  const parsed = serverValidatedPublicGameResultSchema.safeParse(value);
  if (!parsed.success) throw new Error("Server-derived game result failed its storage schema.");
  return { ok: true, result: parsed.data };
}

function objectProperty(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameNumbers(left: readonly number[] | null, right: readonly number[] | null) {
  if (!left || !right) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export type CompletedGameState = TicTacToeState | ConnectFourState | ChessState;
