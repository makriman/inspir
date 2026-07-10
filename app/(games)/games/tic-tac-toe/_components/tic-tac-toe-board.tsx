import type { KeyboardEvent } from "react";
import type { TicTacToeState } from "@/lib/games/tic-tac-toe";

const TIC_TAC_TOE_CELLS = Array.from({ length: 9 }, (_, index) => ({
  index,
  id: `row-${Math.floor(index / 3) + 1}-column-${(index % 3) + 1}`,
}));

type TicTacToeBoardProps = Readonly<{
  state: TicTacToeState;
  interactive?: boolean;
  onCell?(index: number): void;
  onCellKeyDown?(event: KeyboardEvent<HTMLButtonElement>, index: number): void;
}>;

export function TicTacToeBoardView({
  state,
  interactive = false,
  onCell,
  onCellKeyDown,
}: TicTacToeBoardProps) {
  const winning = new Set(state.result?.winningCells ?? []);
  return (
    <div className="tic-board" role="grid" aria-label="Tic-Tac-Toe board" data-testid="tic-board">
      {TIC_TAC_TOE_CELLS.map(({ index, id }) => {
        const cell = state.board[index];
        const row = Math.floor(index / 3) + 1;
        const column = (index % 3) + 1;
        const isLegal = interactive && cell === null && state.activeActor === "human";
        return (
          <button
            className={`tic-cell${winning.has(index) ? " is-winning" : ""}`}
            type="button"
            role="gridcell"
            key={id}
            aria-label={`Row ${row}, column ${column}${cell ? `, ${cell.toUpperCase()}` : ", empty"}`}
            aria-disabled={!isLegal}
            onClick={() => {
              if (isLegal) onCell?.(index);
            }}
            onKeyDown={(event) => onCellKeyDown?.(event, index)}
            data-cell-index={index}
            data-testid={`tic-cell-${index}`}
          >
            <span className={cell ? `tic-mark tic-mark--${cell}` : "tic-mark"} aria-hidden="true">
              {cell === "x" ? "×" : cell === "o" ? "○" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
