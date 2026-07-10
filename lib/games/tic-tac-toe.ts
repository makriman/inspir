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
import { TIC_TAC_TOE_ENGINE_ID, TIC_TAC_TOE_ENGINE_VERSION } from "./catalog";

export { TIC_TAC_TOE_ENGINE_ID, TIC_TAC_TOE_ENGINE_VERSION } from "./catalog";

const ticTacToeMarkSchema = z.enum(["x", "o"]);
export type TicTacToeMark = z.infer<typeof ticTacToeMarkSchema>;

const ticTacToeCellSchema = ticTacToeMarkSchema.nullable();
export type TicTacToeCell = z.infer<typeof ticTacToeCellSchema>;

export const ticTacToeBoardSchema = z.array(ticTacToeCellSchema).length(9).readonly();
export type TicTacToeBoard = z.infer<typeof ticTacToeBoardSchema>;

const ticTacToeActionSchema = z
  .object({
    index: z.number().int().min(0).max(8),
  })
  .strict();
export type TicTacToeAction = z.infer<typeof ticTacToeActionSchema>;

const winningCellsSchema = z
  .tuple([
    z.number().int().min(0).max(8),
    z.number().int().min(0).max(8),
    z.number().int().min(0).max(8),
  ])
  .readonly();

const ticTacToeResultSchema = z
  .object({
    gameSlug: z.literal("tic-tac-toe"),
    engineVersion: z.literal(TIC_TAC_TOE_ENGINE_VERSION),
    winner: gameWinnerSchema,
    outcome: gameOutcomeSchema,
    terminalCode: z.enum(["tic-tac-toe:three-in-a-row", "tic-tac-toe:board-full"]),
    plyCount: z.number().int().min(5).max(9),
    winningCells: winningCellsSchema.nullable(),
  })
  .strict();
export type TicTacToeResult = z.infer<typeof ticTacToeResultSchema>;

export const ticTacToeMoveSchema = z
  .object({
    ply: z.number().int().min(1).max(9),
    actor: gameActorSchema,
    mark: ticTacToeMarkSchema,
    index: z.number().int().min(0).max(8),
  })
  .strict();
export type TicTacToeMove = z.infer<typeof ticTacToeMoveSchema>;

export const ticTacToeStateSchema = z
  .object({
    schemaVersion: z.literal(GAME_STATE_SCHEMA_VERSION),
    gameSlug: z.literal("tic-tac-toe"),
    engineId: z.literal(TIC_TAC_TOE_ENGINE_ID),
    engineVersion: z.literal(TIC_TAC_TOE_ENGINE_VERSION),
    humanMark: ticTacToeMarkSchema,
    opponentMark: ticTacToeMarkSchema,
    board: ticTacToeBoardSchema,
    activeActor: gameActorSchema.nullable(),
    plyCount: z.number().int().min(0).max(9),
    history: z.array(ticTacToeMoveSchema).max(9).readonly(),
    result: ticTacToeResultSchema.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    validateTicTacToeState(state, (path, message) => {
      context.addIssue({ code: "custom", path, message });
    });
  });
export type TicTacToeState = z.infer<typeof ticTacToeStateSchema>;

type ValidationIssue = (path: PropertyKey[], message: string) => void;

type TicTacToeEvaluation = {
  winnerMark: TicTacToeMark | null;
  winningCells: readonly [number, number, number] | null;
};
type TicTacToeStatus = {
  activeActor: GameActor | null;
  result: TicTacToeResult | null;
};

const winningLines: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function createTicTacToeState(humanMark: TicTacToeMark = "x"): TicTacToeState {
  const board = ticTacToeBoardSchema.parse(Array<TicTacToeCell>(9).fill(null));
  return buildTicTacToeState({ humanMark, board, history: [] });
}

export function parseTicTacToeState(value: unknown) {
  return ticTacToeStateSchema.safeParse(value);
}

export function legalTicTacToeActions(state: TicTacToeState): readonly TicTacToeAction[] {
  const current = ticTacToeStateSchema.parse(state);
  if (current.result) return [];
  return current.board.flatMap((cell, index) => (cell === null ? [{ index }] : []));
}

export function applyTicTacToeMove(
  state: TicTacToeState,
  actor: GameActor,
  action: TicTacToeAction,
): ApplyGameMoveResult<TicTacToeState, TicTacToeAction> {
  const current = ticTacToeStateSchema.parse(state);
  if (current.result) return { ok: false, state: current, error: "game-complete" };
  if (current.activeActor !== actor) return { ok: false, state: current, error: "not-your-turn" };

  const parsedAction = ticTacToeActionSchema.safeParse(action);
  if (!parsedAction.success || current.board[parsedAction.data.index] !== null) {
    return { ok: false, state: current, error: "illegal-move" };
  }

  const mark = markForPly(current.plyCount + 1);
  const board = ticTacToeBoardSchema.parse(
    current.board.map((cell, index) => (index === parsedAction.data.index ? mark : cell)),
  );
  const history = [
    ...current.history,
    {
      ply: current.plyCount + 1,
      actor,
      mark,
      index: parsedAction.data.index,
    },
  ];
  const next = buildTicTacToeState({ humanMark: current.humanMark, board, history });
  return { ok: true, state: next, action: parsedAction.data };
}

function buildTicTacToeState(input: {
  humanMark: TicTacToeMark;
  board: TicTacToeBoard;
  history: readonly TicTacToeMove[];
}): TicTacToeState {
  const opponentMark = oppositeMark(input.humanMark);
  const status = ticTacToeStatus(input.board, input.humanMark, input.history.length);
  return ticTacToeStateSchema.parse({
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    gameSlug: "tic-tac-toe",
    engineId: TIC_TAC_TOE_ENGINE_ID,
    engineVersion: TIC_TAC_TOE_ENGINE_VERSION,
    humanMark: input.humanMark,
    opponentMark,
    board: input.board,
    activeActor: status.activeActor,
    plyCount: input.history.length,
    history: input.history,
    result: status.result,
  });
}

function ticTacToeStatus(
  board: TicTacToeBoard,
  humanMark: TicTacToeMark,
  plyCount: number,
): TicTacToeStatus {
  const evaluation = evaluateTicTacToeBoard(board);
  if (evaluation.winnerMark && evaluation.winningCells) {
    const winner = actorForMark(evaluation.winnerMark, humanMark);
    return {
      activeActor: null,
      result: {
        gameSlug: "tic-tac-toe",
        engineVersion: TIC_TAC_TOE_ENGINE_VERSION,
        winner,
        outcome: outcomeForWinner(winner),
        terminalCode: "tic-tac-toe:three-in-a-row",
        plyCount,
        winningCells: evaluation.winningCells,
      },
    };
  }

  if (board.every((cell) => cell !== null)) {
    return {
      activeActor: null,
      result: {
        gameSlug: "tic-tac-toe",
        engineVersion: TIC_TAC_TOE_ENGINE_VERSION,
        winner: "draw",
        outcome: "draw",
        terminalCode: "tic-tac-toe:board-full",
        plyCount,
        winningCells: null,
      },
    };
  }

  return {
    activeActor: actorForMark(markForPly(plyCount + 1), humanMark),
    result: null,
  };
}

function evaluateTicTacToeBoard(board: TicTacToeBoard): TicTacToeEvaluation {
  for (const line of winningLines) {
    const first = board[line[0]];
    if (first && first === board[line[1]] && first === board[line[2]]) {
      return { winnerMark: first, winningCells: line };
    }
  }
  return { winnerMark: null, winningCells: null };
}

function validateTicTacToeState(state: z.infer<typeof ticTacToeStateSchema>, issue: ValidationIssue) {
  if (state.opponentMark !== oppositeMark(state.humanMark)) {
    issue(["opponentMark"], "Opponent mark must be the opposite human mark.");
  }
  if (state.plyCount !== state.history.length) {
    issue(["plyCount"], "Ply count must equal history length.");
  }

  const replay = Array<TicTacToeCell>(9).fill(null);
  let terminalReached = false;
  for (const [index, move] of state.history.entries()) {
    const expectedPly = index + 1;
    const expectedMark = markForPly(expectedPly);
    if (terminalReached) issue(["history", index], "History contains a move after the game ended.");
    if (move.ply !== expectedPly) issue(["history", index, "ply"], "Move ply is out of sequence.");
    if (move.mark !== expectedMark) issue(["history", index, "mark"], "Move mark is out of sequence.");
    if (move.actor !== actorForMark(expectedMark, state.humanMark)) {
      issue(["history", index, "actor"], "Move actor does not own this mark.");
    }
    if (replay[move.index] !== null) {
      issue(["history", index, "index"], "A square cannot be played twice.");
    } else {
      replay[move.index] = move.mark;
    }
    const replayBoard = ticTacToeBoardSchema.parse(replay);
    terminalReached = evaluateTicTacToeBoard(replayBoard).winnerMark !== null || replay.every((cell) => cell !== null);
  }

  for (const [index, cell] of state.board.entries()) {
    if (cell !== replay[index]) issue(["board", index], "Board does not match move history.");
  }

  const expectedBoard = ticTacToeBoardSchema.parse(replay);
  const expected = ticTacToeStatus(expectedBoard, state.humanMark, state.history.length);
  if (state.activeActor !== expected.activeActor) {
    issue(["activeActor"], "Active actor does not match the position.");
  }
  if (!sameTicTacToeResult(state.result, expected.result)) {
    issue(["result"], "Result does not match the position.");
  }
}

function sameTicTacToeResult(left: TicTacToeResult | null, right: TicTacToeResult | null) {
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

function markForPly(ply: number): TicTacToeMark {
  return ply % 2 === 1 ? "x" : "o";
}

function oppositeMark(mark: TicTacToeMark): TicTacToeMark {
  return mark === "x" ? "o" : "x";
}

function actorForMark(mark: TicTacToeMark, humanMark: TicTacToeMark): GameActor {
  return mark === humanMark ? "human" : "opponent";
}
