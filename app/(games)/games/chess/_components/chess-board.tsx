import type { KeyboardEvent } from "react";
import type { ChessState } from "@/lib/games/chess";

type ChessBoardProps = Readonly<{
  state: ChessState;
  selected?: string | null;
  legalTargets?: ReadonlySet<string>;
  interactive?: boolean;
  onSquare?(square: string): void;
  onSquareKeyDown?(event: KeyboardEvent<HTMLButtonElement>, square: string): void;
}>;

const pieceGlyph: Readonly<Record<string, string>> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

const pieceName: Readonly<Record<string, string>> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

export function ChessBoardView({
  state,
  selected = null,
  legalTargets = new Set<string>(),
  interactive = false,
  onSquare,
  onSquareKeyDown,
}: ChessBoardProps) {
  const board = boardFromFen(state.fen);
  const lastMove = state.history.at(-1);
  return (
    <div className="chess-board" role="grid" aria-label="Chess board" data-testid="chess-board">
      {board.map(({ square, piece }, index) => {
        const row = Math.floor(index / 8);
        const column = index % 8;
        const light = (row + column) % 2 === 0;
        const legalTarget = legalTargets.has(square);
        const recentlyMoved = lastMove?.from === square || lastMove?.to === square;
        return (
          <button
            type="button"
            role="gridcell"
            className={[
              "chess-square",
              light ? "chess-square--light" : "chess-square--dark",
              selected === square ? "is-selected" : "",
              legalTarget ? "is-legal-target" : "",
              recentlyMoved ? "is-last-move" : "",
            ].filter(Boolean).join(" ")}
            key={square}
            aria-label={squareLabel(square, piece)}
            aria-selected={selected === square}
            aria-disabled={!interactive}
            onClick={() => {
              if (interactive) onSquare?.(square);
            }}
            onKeyDown={(event) => onSquareKeyDown?.(event, square)}
            data-square={square}
            data-testid={`chess-square-${square}`}
          >
            <span className="chess-coordinate chess-coordinate--file" aria-hidden="true">
              {row === 7 ? square[0] : ""}
            </span>
            <span className="chess-coordinate chess-coordinate--rank" aria-hidden="true">
              {column === 0 ? square[1] : ""}
            </span>
            <span className="chess-piece" aria-hidden="true">
              {piece ? pieceGlyph[piece] : ""}
            </span>
            {legalTarget ? <span className="chess-target-dot" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function boardFromFen(fen: string) {
  const placement = fen.split(" ")[0] ?? "";
  const cells: ReadonlyArray<Readonly<{ square: string; piece: string | null }>> = placement
    .split("/")
    .flatMap((rankText, rankIndex) => {
      const rank = 8 - rankIndex;
      const rankCells: Array<Readonly<{ square: string; piece: string | null }>> = [];
      let file = 0;
      for (const token of rankText) {
        if (/^[1-8]$/.test(token)) {
          for (let offset = 0; offset < Number(token); offset += 1) {
            rankCells.push({ square: `${String.fromCharCode(97 + file)}${rank}`, piece: null });
            file += 1;
          }
        } else {
          rankCells.push({ square: `${String.fromCharCode(97 + file)}${rank}`, piece: token });
          file += 1;
        }
      }
      return rankCells;
    });
  return cells;
}

function squareLabel(square: string, piece: string | null) {
  if (!piece) return `${square}, empty`;
  const color = piece === piece.toUpperCase() ? "white" : "black";
  return `${square}, ${color} ${pieceName[piece.toLowerCase()] ?? "piece"}`;
}
