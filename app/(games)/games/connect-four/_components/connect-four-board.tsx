import type { KeyboardEvent } from "react";
import {
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
  type ConnectFourState,
} from "@/lib/games/connect-four";

const CONNECT_FOUR_COLUMN_CELLS = Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, column) => ({
  column,
  id: `column-${column + 1}`,
}));
const CONNECT_FOUR_ROW_CELLS = Array.from({ length: CONNECT_FOUR_ROWS }, (_, row) => ({
  row,
  id: `row-${row + 1}`,
}));

type ConnectFourBoardProps = Readonly<{
  state: ConnectFourState;
  interactive?: boolean;
  onColumn?(column: number): void;
  onColumnKeyDown?(event: KeyboardEvent<HTMLButtonElement>, column: number): void;
}>;

export function ConnectFourBoardView({
  state,
  interactive = false,
  onColumn,
  onColumnKeyDown,
}: ConnectFourBoardProps) {
  const winning = new Set(state.result?.winningCells ?? []);
  return (
    <div className="connect-board-wrap" data-testid="connect-board">
      {interactive ? (
        <div className="connect-controls" aria-label="Choose a column">
          {CONNECT_FOUR_COLUMN_CELLS.map(({ column, id }) => {
            const isLegal = state.board[column] === null && state.activeActor === "human";
            return (
              <button
                type="button"
                key={id}
                aria-label={`Drop a disc in column ${column + 1}`}
                aria-disabled={!isLegal}
                onClick={() => {
                  if (isLegal) onColumn?.(column);
                }}
                onKeyDown={(event) => onColumnKeyDown?.(event, column)}
                data-column={column}
                data-testid={`connect-column-${column}`}
              >
                <span aria-hidden="true">↓</span>
                <small>{column + 1}</small>
              </button>
            );
          })}
        </div>
      ) : null}
      <table className="connect-board" aria-label="Connect Four board">
        <tbody style={{ display: "contents" }}>
          {CONNECT_FOUR_ROW_CELLS.map(({ row, id: rowId }) => (
            <tr key={rowId} style={{ display: "contents" }}>
              {CONNECT_FOUR_COLUMN_CELLS.map(({ column, id: columnId }) => {
                const index = row * CONNECT_FOUR_COLUMNS + column;
                const cell = state.board[index];
                return (
                  <td
                    className={`connect-cell${winning.has(index) ? " is-winning" : ""}`}
                    aria-label={`Row ${row + 1}, column ${column + 1}${cell ? `, ${cell} disc` : ", empty"}`}
                    key={columnId}
                    data-testid={`connect-cell-${index}`}
                  >
                    <span
                      className={cell ? `connect-disc connect-disc--${cell}` : "connect-disc"}
                      aria-hidden="true"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
