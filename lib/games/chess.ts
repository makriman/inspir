import { Chess, DEFAULT_POSITION, type Color, type Move } from "chess.js";
import { z } from "zod";
import {
  GAME_STATE_SCHEMA_VERSION,
  gameActorSchema,
  gameOutcomeSchema,
  gameWinnerSchema,
  outcomeForWinner,
  type ApplyGameMoveResult,
  type GameActor,
  type GameWinner,
} from "./contracts";
import { CHESS_ENGINE_ID, CHESS_ENGINE_VERSION } from "./catalog";

export { CHESS_ENGINE_ID, CHESS_ENGINE_VERSION } from "./catalog";
export const CHESS_INITIAL_FEN = DEFAULT_POSITION;
export const CHESS_MAX_PLIES = 128;

const chessColorSchema = z.enum(["w", "b"]);
export type ChessColor = z.infer<typeof chessColorSchema>;

const chessPieceSchema = z.enum(["p", "n", "b", "r", "q", "k"]);
const chessPromotionSchema = z.enum(["n", "b", "r", "q"]);
const chessSquareSchema = z.string().regex(/^[a-h][1-8]$/);
const chessMoveTokenSchema = z.string().regex(/^[a-h][1-8][a-h][1-8][nbrq]?$/);

const chessActionSchema = z
  .object({
    token: chessMoveTokenSchema,
  })
  .strict();
export type ChessAction = z.infer<typeof chessActionSchema>;

export const chessLegalActionSchema = z
  .object({
    token: chessMoveTokenSchema,
    san: z.string().min(1).max(32),
    from: chessSquareSchema,
    to: chessSquareSchema,
    piece: chessPieceSchema,
    promotion: chessPromotionSchema.optional(),
  })
  .strict();
export type ChessLegalAction = z.infer<typeof chessLegalActionSchema>;

export const chessResultSchema = z
  .object({
    gameSlug: z.literal("chess"),
    engineVersion: z.literal(CHESS_ENGINE_VERSION),
    winner: gameWinnerSchema,
    outcome: gameOutcomeSchema,
    terminalCode: z.enum([
      "chess:checkmate",
      "chess:stalemate",
      "chess:insufficient-material",
      "chess:threefold-repetition",
      "chess:fifty-move-rule",
      "chess:move-limit",
    ]),
    plyCount: z.number().int().nonnegative().max(CHESS_MAX_PLIES),
    finalFen: z.string().min(1).max(120),
  })
  .strict();
export type ChessResult = z.infer<typeof chessResultSchema>;

export const chessMoveSchema = z
  .object({
    ply: z.number().int().min(1).max(CHESS_MAX_PLIES),
    actor: gameActorSchema,
    color: chessColorSchema,
    token: chessMoveTokenSchema,
    san: z.string().min(1).max(32),
    from: chessSquareSchema,
    to: chessSquareSchema,
    piece: chessPieceSchema,
    captured: chessPieceSchema.optional(),
    promotion: chessPromotionSchema.optional(),
  })
  .strict();
export type ChessMove = z.infer<typeof chessMoveSchema>;

export const chessStateSnapshotSchema = z
  .object({
    schemaVersion: z.literal(GAME_STATE_SCHEMA_VERSION),
    gameSlug: z.literal("chess"),
    engineId: z.literal(CHESS_ENGINE_ID),
    engineVersion: z.literal(CHESS_ENGINE_VERSION),
    initialFen: z.string().min(1).max(120),
    fen: z.string().min(1).max(120),
    humanColor: chessColorSchema,
    opponentColor: chessColorSchema,
    activeActor: gameActorSchema.nullable(),
    plyCount: z.number().int().nonnegative().max(CHESS_MAX_PLIES),
    history: z.array(chessMoveSchema).max(CHESS_MAX_PLIES).readonly(),
    result: chessResultSchema.nullable(),
  })
  .strict();
type ChessStateShape = z.infer<typeof chessStateSnapshotSchema>;

export const chessStateSchema = chessStateSnapshotSchema.superRefine((state, context) => {
  validateChessState(state, (path, message) => {
    context.addIssue({ code: "custom", path, message });
  });
});
export type ChessState = z.infer<typeof chessStateSchema>;
export type ChessOpponentTokenSelector = (legalMoves: readonly Move[]) => string | null;

export type ChessResultSubmissionStateParse =
  | { success: true; data: ChessState }
  | { success: false };

type ValidationIssue = (path: PropertyKey[], message: string) => void;

export function createChessState(input: {
  humanColor?: ChessColor;
  initialFen?: string;
} = {}): ChessState {
  const humanColor = input.humanColor ?? "w";
  const initialFen = input.initialFen ?? CHESS_INITIAL_FEN;
  const chess = new Chess(initialFen);
  return buildChessState({ chess, initialFen, humanColor, history: [] });
}

export function parseChessState(value: unknown) {
  return chessStateSchema.safeParse(value);
}

/**
 * Strictly validate an untrusted result submission and its deterministic
 * opponent in one chess replay. Immutable server-derived and stored snapshots
 * use chessStateSnapshotSchema because their replay was already proven here.
 */
export function parseChessResultSubmissionState(
  value: unknown,
  opponentTokenSelector: ChessOpponentTokenSelector,
): ChessResultSubmissionStateParse {
  const parsed = chessStateSnapshotSchema.safeParse(value);
  if (!parsed.success) return { success: false };

  let valid = true;
  validateChessState(
    parsed.data,
    () => {
      valid = false;
    },
    opponentTokenSelector,
  );
  return valid ? { success: true, data: parsed.data } : { success: false };
}

export function legalChessActions(state: ChessState): readonly ChessLegalAction[] {
  const current = chessStateSchema.parse(state);
  if (current.result) return [];
  const chess = replayChess(current.initialFen, current.history);
  return chess.moves({ verbose: true }).map(legalActionFromMove);
}

export function applyChessMove(
  state: ChessState,
  actor: GameActor,
  action: ChessAction,
): ApplyGameMoveResult<ChessState, ChessLegalAction> {
  const current = chessStateSchema.parse(state);
  if (current.result) return { ok: false, state: current, error: "game-complete" };
  if (current.activeActor !== actor) return { ok: false, state: current, error: "not-your-turn" };

  const parsedAction = chessActionSchema.safeParse(action);
  if (!parsedAction.success) return { ok: false, state: current, error: "illegal-move" };

  const chess = replayChess(current.initialFen, current.history);
  const legalMove = chess.moves({ verbose: true }).find((candidate) => candidate.lan === parsedAction.data.token);
  if (!legalMove) return { ok: false, state: current, error: "illegal-move" };

  const moved = chess.move(legalMove.san);
  const history = [
    ...current.history,
    moveRecordFromMove(moved, current.plyCount + 1, actor),
  ];
  const next = buildChessState({
    chess,
    initialFen: current.initialFen,
    humanColor: current.humanColor,
    history,
  });
  return { ok: true, state: next, action: legalActionFromMove(moved) };
}

function buildChessState(input: {
  chess: Chess;
  initialFen: string;
  humanColor: ChessColor;
  history: readonly ChessMove[];
}): ChessState {
  const result = chessResult(input.chess, input.humanColor, input.history.length);
  return chessStateSchema.parse({
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    gameSlug: "chess",
    engineId: CHESS_ENGINE_ID,
    engineVersion: CHESS_ENGINE_VERSION,
    initialFen: input.initialFen,
    fen: input.chess.fen(),
    humanColor: input.humanColor,
    opponentColor: oppositeColor(input.humanColor),
    activeActor: result ? null : actorForColor(input.chess.turn(), input.humanColor),
    plyCount: input.history.length,
    history: input.history,
    result,
  });
}

function validateChessState(
  state: ChessStateShape,
  issue: ValidationIssue,
  opponentTokenSelector?: ChessOpponentTokenSelector,
) {
  if (state.opponentColor !== oppositeColor(state.humanColor)) {
    issue(["opponentColor"], "Opponent color must be the opposite human color.");
  }
  if (state.plyCount !== state.history.length) {
    issue(["plyCount"], "Ply count must equal history length.");
  }

  let chess: Chess;
  try {
    chess = new Chess(state.initialFen);
  } catch {
    issue(["initialFen"], "Initial FEN is invalid.");
    return;
  }

  for (const [index, move] of state.history.entries()) {
    if (chessResult(chess, state.humanColor, index)) {
      issue(["history", index], "History contains a move after the game ended.");
      break;
    }

    const expectedPly = index + 1;
    const expectedColor = chess.turn();
    if (move.ply !== expectedPly) issue(["history", index, "ply"], "Move ply is out of sequence.");
    if (move.color !== expectedColor) issue(["history", index, "color"], "Move color is out of sequence.");
    if (move.actor !== actorForColor(expectedColor, state.humanColor)) {
      issue(["history", index, "actor"], "Move actor does not own this color.");
    }

    const legalMoves = chess.moves({ verbose: true });
    if (
      move.actor === "opponent" &&
      opponentTokenSelector &&
      opponentTokenSelector(legalMoves) !== move.token
    ) {
      issue(["history", index, "token"], "Opponent move does not match the deterministic strategy.");
    }
    const legalMove = legalMoves.find((candidate) => candidate.lan === move.token);
    if (!legalMove) {
      issue(["history", index, "token"], "Move is not legal in the replayed position.");
      break;
    }
    const replayed = chess.move(legalMove.san);
    if (!moveMatches(move, replayed)) {
      issue(["history", index], "Move record does not match the legal replay.");
    }
  }

  if (state.fen !== chess.fen()) issue(["fen"], "FEN does not match move history.");
  const expectedResult = chessResult(chess, state.humanColor, state.history.length);
  const expectedActor = expectedResult ? null : actorForColor(chess.turn(), state.humanColor);
  if (state.activeActor !== expectedActor) issue(["activeActor"], "Active actor does not match the position.");
  if (!sameChessResult(state.result, expectedResult)) issue(["result"], "Result does not match the position.");
}

function replayChess(initialFen: string, history: readonly ChessMove[]) {
  const chess = new Chess(initialFen);
  for (const move of history) {
    const legalMove = chess.moves({ verbose: true }).find((candidate) => candidate.lan === move.token);
    if (!legalMove) throw new Error("Chess history contains an illegal move.");
    chess.move(legalMove.san);
  }
  return chess;
}

function chessResult(chess: Chess, humanColor: ChessColor, plyCount: number): ChessResult | null {
  const finalFen = chess.fen();
  if (chess.isCheckmate()) {
    const winner = actorForColor(oppositeColor(chess.turn()), humanColor);
    return resultFor("chess:checkmate", winner, plyCount, finalFen);
  }
  if (chess.isStalemate()) return resultFor("chess:stalemate", "draw", plyCount, finalFen);
  if (chess.isInsufficientMaterial()) {
    return resultFor("chess:insufficient-material", "draw", plyCount, finalFen);
  }
  if (chess.isThreefoldRepetition()) {
    return resultFor("chess:threefold-repetition", "draw", plyCount, finalFen);
  }
  if (chess.isDrawByFiftyMoves()) {
    return resultFor("chess:fifty-move-rule", "draw", plyCount, finalFen);
  }
  if (plyCount >= CHESS_MAX_PLIES) {
    return resultFor("chess:move-limit", "draw", plyCount, finalFen);
  }
  return null;
}

function resultFor(
  terminalCode: ChessResult["terminalCode"],
  winner: GameWinner,
  plyCount: number,
  finalFen: string,
) {
  return chessResultSchema.parse({
    gameSlug: "chess",
    engineVersion: CHESS_ENGINE_VERSION,
    winner,
    outcome: outcomeForWinner(winner),
    terminalCode,
    plyCount,
    finalFen,
  });
}

function legalActionFromMove(move: Move): ChessLegalAction {
  return chessLegalActionSchema.parse({
    token: move.lan,
    san: move.san,
    from: move.from,
    to: move.to,
    piece: move.piece,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  });
}

function moveRecordFromMove(move: Move, ply: number, actor: GameActor): ChessMove {
  return chessMoveSchema.parse({
    ply,
    actor,
    color: move.color,
    token: move.lan,
    san: move.san,
    from: move.from,
    to: move.to,
    piece: move.piece,
    ...(move.captured ? { captured: move.captured } : {}),
    ...(move.promotion ? { promotion: move.promotion } : {}),
  });
}

function moveMatches(record: ChessMove, replayed: Move) {
  return (
    record.color === replayed.color &&
    record.token === replayed.lan &&
    record.san === replayed.san &&
    record.from === replayed.from &&
    record.to === replayed.to &&
    record.piece === replayed.piece &&
    record.captured === replayed.captured &&
    record.promotion === replayed.promotion
  );
}

function sameChessResult(left: ChessResult | null, right: ChessResult | null) {
  if (!left || !right) return left === right;
  return (
    left.winner === right.winner &&
    left.outcome === right.outcome &&
    left.terminalCode === right.terminalCode &&
    left.plyCount === right.plyCount &&
    left.finalFen === right.finalFen
  );
}

function oppositeColor(color: ChessColor | Color): ChessColor {
  return color === "w" ? "b" : "w";
}

function actorForColor(color: ChessColor | Color, humanColor: ChessColor): GameActor {
  return color === humanColor ? "human" : "opponent";
}
