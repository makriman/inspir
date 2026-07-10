import { z } from "zod";
import {
  GAME_STATE_SCHEMA_VERSION,
  gameActorSchema,
  gameOutcomeSchema,
  gameWinnerSchema,
  outcomeForWinner,
  type ApplyGameMoveResult,
  type GameActor,
} from "./contracts";
import { CONNECT_FOUR_ENGINE_ID, CONNECT_FOUR_ENGINE_VERSION } from "./catalog";

export { CONNECT_FOUR_ENGINE_ID, CONNECT_FOUR_ENGINE_VERSION } from "./catalog";
export const CONNECT_FOUR_ROWS = 6 as const;
export const CONNECT_FOUR_COLUMNS = 7 as const;

const connectFourDiscSchema = z.enum(["red", "yellow"]);
export type ConnectFourDisc = z.infer<typeof connectFourDiscSchema>;

const connectFourCellSchema = connectFourDiscSchema.nullable();
export type ConnectFourCell = z.infer<typeof connectFourCellSchema>;

export const connectFourBoardSchema = z.array(connectFourCellSchema).length(42).readonly();
export type ConnectFourBoard = z.infer<typeof connectFourBoardSchema>;

const connectFourActionSchema = z
  .object({
    column: z.number().int().min(0).max(CONNECT_FOUR_COLUMNS - 1),
  })
  .strict();
export type ConnectFourAction = z.infer<typeof connectFourActionSchema>;

const connectFourWinningCellsSchema = z
  .tuple([
    z.number().int().min(0).max(41),
    z.number().int().min(0).max(41),
    z.number().int().min(0).max(41),
    z.number().int().min(0).max(41),
  ])
  .readonly();

export const connectFourResultSchema = z
  .object({
    gameSlug: z.literal("connect-four"),
    engineVersion: z.literal(CONNECT_FOUR_ENGINE_VERSION),
    winner: gameWinnerSchema,
    outcome: gameOutcomeSchema,
    terminalCode: z.enum(["connect-four:four-in-a-row", "connect-four:board-full"]),
    plyCount: z.number().int().min(7).max(42),
    winningCells: connectFourWinningCellsSchema.nullable(),
  })
  .strict();
export type ConnectFourResult = z.infer<typeof connectFourResultSchema>;

export const connectFourMoveSchema = z
  .object({
    ply: z.number().int().min(1).max(42),
    actor: gameActorSchema,
    disc: connectFourDiscSchema,
    column: z.number().int().min(0).max(CONNECT_FOUR_COLUMNS - 1),
    row: z.number().int().min(0).max(CONNECT_FOUR_ROWS - 1),
  })
  .strict();
export type ConnectFourMove = z.infer<typeof connectFourMoveSchema>;

const connectFourStateBaseSchema = z
  .object({
    schemaVersion: z.literal(GAME_STATE_SCHEMA_VERSION),
    gameSlug: z.literal("connect-four"),
    engineId: z.literal(CONNECT_FOUR_ENGINE_ID),
    engineVersion: z.literal(CONNECT_FOUR_ENGINE_VERSION),
    humanDisc: connectFourDiscSchema,
    opponentDisc: connectFourDiscSchema,
    board: connectFourBoardSchema,
    activeActor: gameActorSchema.nullable(),
    plyCount: z.number().int().min(0).max(42),
    history: z.array(connectFourMoveSchema).max(42).readonly(),
    result: connectFourResultSchema.nullable(),
  })
  .strict();
type ConnectFourStateShape = z.infer<typeof connectFourStateBaseSchema>;

export const connectFourStateSchema = connectFourStateBaseSchema.superRefine((state, context) => {
  validateConnectFourState(state, (path, message) => {
    context.addIssue({ code: "custom", path, message });
  });
});
export type ConnectFourState = z.infer<typeof connectFourStateSchema>;

type ValidationIssue = (path: PropertyKey[], message: string) => void;
type WinningCells = readonly [number, number, number, number];
type ConnectFourEvaluation = {
  winnerDisc: ConnectFourDisc | null;
  winningCells: WinningCells | null;
};
type ConnectFourStatus = {
  activeActor: GameActor | null;
  result: ConnectFourResult | null;
};

const winningLines = buildWinningLines();

export function createConnectFourState(humanDisc: ConnectFourDisc = "red"): ConnectFourState {
  const board = connectFourBoardSchema.parse(Array<ConnectFourCell>(42).fill(null));
  return buildConnectFourState({ humanDisc, board, history: [] });
}

export function parseConnectFourState(value: unknown) {
  return connectFourStateSchema.safeParse(value);
}

export function legalConnectFourActions(state: ConnectFourState): readonly ConnectFourAction[] {
  const current = connectFourStateSchema.parse(state);
  if (current.result) return [];
  return Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, column) => column).flatMap((column) =>
    current.board[column] === null ? [{ column }] : [],
  );
}

export function applyConnectFourMove(
  state: ConnectFourState,
  actor: GameActor,
  action: ConnectFourAction,
): ApplyGameMoveResult<ConnectFourState, ConnectFourAction> {
  const current = connectFourStateSchema.parse(state);
  if (current.result) return { ok: false, state: current, error: "game-complete" };
  if (current.activeActor !== actor) return { ok: false, state: current, error: "not-your-turn" };

  const parsedAction = connectFourActionSchema.safeParse(action);
  if (!parsedAction.success) return { ok: false, state: current, error: "illegal-move" };
  const row = lowestOpenRow(current.board, parsedAction.data.column);
  if (row === null) return { ok: false, state: current, error: "illegal-move" };

  const disc = discForPly(current.plyCount + 1);
  const targetIndex = cellIndex(row, parsedAction.data.column);
  const board = connectFourBoardSchema.parse(
    current.board.map((cell, index) => (index === targetIndex ? disc : cell)),
  );
  const history = [
    ...current.history,
    {
      ply: current.plyCount + 1,
      actor,
      disc,
      column: parsedAction.data.column,
      row,
    },
  ];
  const next = buildConnectFourState({ humanDisc: current.humanDisc, board, history });
  return { ok: true, state: next, action: parsedAction.data };
}

function buildConnectFourState(input: {
  humanDisc: ConnectFourDisc;
  board: ConnectFourBoard;
  history: readonly ConnectFourMove[];
}): ConnectFourState {
  const opponentDisc = oppositeDisc(input.humanDisc);
  const status = connectFourStatus(input.board, input.humanDisc, input.history.length);
  return connectFourStateSchema.parse({
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    gameSlug: "connect-four",
    engineId: CONNECT_FOUR_ENGINE_ID,
    engineVersion: CONNECT_FOUR_ENGINE_VERSION,
    humanDisc: input.humanDisc,
    opponentDisc,
    board: input.board,
    activeActor: status.activeActor,
    plyCount: input.history.length,
    history: input.history,
    result: status.result,
  });
}

function connectFourStatus(
  board: ConnectFourBoard,
  humanDisc: ConnectFourDisc,
  plyCount: number,
): ConnectFourStatus {
  const evaluation = evaluateConnectFourBoard(board);
  if (evaluation.winnerDisc && evaluation.winningCells) {
    const winner = actorForDisc(evaluation.winnerDisc, humanDisc);
    return {
      activeActor: null,
      result: {
        gameSlug: "connect-four",
        engineVersion: CONNECT_FOUR_ENGINE_VERSION,
        winner,
        outcome: outcomeForWinner(winner),
        terminalCode: "connect-four:four-in-a-row",
        plyCount,
        winningCells: evaluation.winningCells,
      },
    };
  }

  if (board.every((cell) => cell !== null)) {
    return {
      activeActor: null,
      result: {
        gameSlug: "connect-four",
        engineVersion: CONNECT_FOUR_ENGINE_VERSION,
        winner: "draw",
        outcome: "draw",
        terminalCode: "connect-four:board-full",
        plyCount,
        winningCells: null,
      },
    };
  }

  return {
    activeActor: actorForDisc(discForPly(plyCount + 1), humanDisc),
    result: null,
  };
}

function validateConnectFourState(state: ConnectFourStateShape, issue: ValidationIssue) {
  if (state.opponentDisc !== oppositeDisc(state.humanDisc)) {
    issue(["opponentDisc"], "Opponent disc must be the opposite human disc.");
  }
  if (state.plyCount !== state.history.length) {
    issue(["plyCount"], "Ply count must equal history length.");
  }

  const replay = Array<ConnectFourCell>(42).fill(null);
  let terminalReached = false;
  for (const [index, move] of state.history.entries()) {
    const expectedPly = index + 1;
    const expectedDisc = discForPly(expectedPly);
    if (terminalReached) issue(["history", index], "History contains a move after the game ended.");
    if (move.ply !== expectedPly) issue(["history", index, "ply"], "Move ply is out of sequence.");
    if (move.disc !== expectedDisc) issue(["history", index, "disc"], "Move disc is out of sequence.");
    if (move.actor !== actorForDisc(expectedDisc, state.humanDisc)) {
      issue(["history", index, "actor"], "Move actor does not own this disc.");
    }

    const replayBoard = connectFourBoardSchema.parse(replay);
    const expectedRow = lowestOpenRow(replayBoard, move.column);
    if (expectedRow === null || move.row !== expectedRow) {
      issue(["history", index, "row"], "Move violates column gravity.");
    } else {
      replay[cellIndex(move.row, move.column)] = move.disc;
    }
    const nextReplayBoard = connectFourBoardSchema.parse(replay);
    terminalReached =
      evaluateConnectFourBoard(nextReplayBoard).winnerDisc !== null || replay.every((cell) => cell !== null);
  }

  for (const [index, cell] of state.board.entries()) {
    if (cell !== replay[index]) issue(["board", index], "Board does not match move history.");
  }

  const expectedBoard = connectFourBoardSchema.parse(replay);
  const expected = connectFourStatus(expectedBoard, state.humanDisc, state.history.length);
  if (state.activeActor !== expected.activeActor) {
    issue(["activeActor"], "Active actor does not match the position.");
  }
  if (!sameConnectFourResult(state.result, expected.result)) {
    issue(["result"], "Result does not match the position.");
  }
}

function evaluateConnectFourBoard(board: ConnectFourBoard): ConnectFourEvaluation {
  for (const line of winningLines) {
    const first = board[line[0]];
    if (first && first === board[line[1]] && first === board[line[2]] && first === board[line[3]]) {
      return { winnerDisc: first, winningCells: line };
    }
  }
  return { winnerDisc: null, winningCells: null };
}

function buildWinningLines(): readonly WinningCells[] {
  const lines: WinningCells[] = [];
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    for (let column = 0; column < CONNECT_FOUR_COLUMNS; column += 1) {
      const start = cellIndex(row, column);
      if (column <= 3) lines.push([start, start + 1, start + 2, start + 3]);
      if (row <= 2) lines.push([start, start + 7, start + 14, start + 21]);
      if (row <= 2 && column <= 3) lines.push([start, start + 8, start + 16, start + 24]);
      if (row >= 3 && column <= 3) lines.push([start, start - 6, start - 12, start - 18]);
    }
  }
  return lines;
}

function sameConnectFourResult(left: ConnectFourResult | null, right: ConnectFourResult | null) {
  if (!left || !right) return left === right;
  return (
    left.winner === right.winner &&
    left.outcome === right.outcome &&
    left.terminalCode === right.terminalCode &&
    left.plyCount === right.plyCount &&
    sameNumbers(left.winningCells, right.winningCells)
  );
}

function sameNumbers(left: readonly number[] | null, right: readonly number[] | null) {
  if (!left || !right) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function lowestOpenRow(board: ConnectFourBoard, column: number) {
  for (let row = CONNECT_FOUR_ROWS - 1; row >= 0; row -= 1) {
    if (board[cellIndex(row, column)] === null) return row;
  }
  return null;
}

function cellIndex(row: number, column: number) {
  return row * CONNECT_FOUR_COLUMNS + column;
}

function discForPly(ply: number): ConnectFourDisc {
  return ply % 2 === 1 ? "red" : "yellow";
}

function oppositeDisc(disc: ConnectFourDisc): ConnectFourDisc {
  return disc === "red" ? "yellow" : "red";
}

function actorForDisc(disc: ConnectFourDisc, humanDisc: ConnectFourDisc): GameActor {
  return disc === humanDisc ? "human" : "opponent";
}
