import {
  applyTicTacToeMove,
  legalTicTacToeActions,
  type TicTacToeAction,
  type TicTacToeBoard,
  type TicTacToeMark,
  type TicTacToeState,
} from "./tic-tac-toe";

export const TIC_TAC_TOE_LOCAL_STRATEGY_ID = "inspir.local-strategy.tic-tac-toe" as const;
export const TIC_TAC_TOE_LOCAL_STRATEGY_VERSION = "1.0.0" as const;

const movePreference = [4, 0, 2, 6, 8, 1, 3, 5, 7] as const;
const winningLines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export function chooseTicTacToeOpponentAction(state: TicTacToeState): TicTacToeAction | null {
  if (state.result || state.activeActor !== "opponent") return null;
  const legal = legalTicTacToeActions(state);

  const winning = legal.find((action) => {
    const applied = applyTicTacToeMove(state, "opponent", action);
    return applied.ok && applied.state.result?.winner === "opponent";
  });
  if (winning) return winning;

  const block = legal.find((action) => boardWinsWith(state.board, action.index, state.humanMark));
  if (block) return block;

  for (const index of movePreference) {
    if (legal.some((action) => action.index === index)) return { index };
  }
  return null;
}

function boardWinsWith(board: TicTacToeBoard, index: number, mark: TicTacToeMark) {
  const candidate = board.map((cell, cellIndex) => (cellIndex === index ? mark : cell));
  return winningLines.some(
    (line) => candidate[line[0]] === mark && candidate[line[1]] === mark && candidate[line[2]] === mark,
  );
}
