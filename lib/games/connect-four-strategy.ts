import {
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
  applyConnectFourMove,
  legalConnectFourActions,
  type ConnectFourAction,
  type ConnectFourBoard,
  type ConnectFourDisc,
  type ConnectFourState,
} from "./connect-four";

export const CONNECT_FOUR_LOCAL_STRATEGY_ID = "inspir.local-strategy.connect-four" as const;
export const CONNECT_FOUR_LOCAL_STRATEGY_VERSION = "1.0.0" as const;

const columnPreference = [3, 2, 4, 1, 5, 0, 6] as const;

export function chooseConnectFourOpponentAction(state: ConnectFourState): ConnectFourAction | null {
  if (state.result || state.activeActor !== "opponent") return null;
  const legal = legalConnectFourActions(state);

  const winning = legal.find((action) => {
    const applied = applyConnectFourMove(state, "opponent", action);
    return applied.ok && applied.state.result?.winner === "opponent";
  });
  if (winning) return winning;

  const block = legal.find((action) => hypotheticalMoveWins(state.board, action.column, state.humanDisc));
  if (block) return block;

  for (const column of columnPreference) {
    if (legal.some((action) => action.column === column)) return { column };
  }
  return null;
}

function hypotheticalMoveWins(board: ConnectFourBoard, column: number, disc: ConnectFourDisc) {
  const row = lowestOpenRow(board, column);
  if (row === null) return false;
  const candidate = board.map((cell, index) => (index === cellIndex(row, column) ? disc : cell));

  for (let rowIndex = 0; rowIndex < CONNECT_FOUR_ROWS; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < CONNECT_FOUR_COLUMNS; columnIndex += 1) {
      if (lineMatches(candidate, rowIndex, columnIndex, 0, 1, disc)) return true;
      if (lineMatches(candidate, rowIndex, columnIndex, 1, 0, disc)) return true;
      if (lineMatches(candidate, rowIndex, columnIndex, 1, 1, disc)) return true;
      if (lineMatches(candidate, rowIndex, columnIndex, -1, 1, disc)) return true;
    }
  }
  return false;
}

function lineMatches(
  board: readonly (ConnectFourDisc | null)[],
  row: number,
  column: number,
  rowStep: number,
  columnStep: number,
  disc: ConnectFourDisc,
) {
  for (let offset = 0; offset < 4; offset += 1) {
    const targetRow = row + rowStep * offset;
    const targetColumn = column + columnStep * offset;
    if (
      targetRow < 0 ||
      targetRow >= CONNECT_FOUR_ROWS ||
      targetColumn < 0 ||
      targetColumn >= CONNECT_FOUR_COLUMNS ||
      board[cellIndex(targetRow, targetColumn)] !== disc
    ) {
      return false;
    }
  }
  return true;
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
