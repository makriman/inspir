import { Chess, type Move } from "chess.js";
import type { ChessAction, ChessState } from "./chess";

export const CHESS_LOCAL_STRATEGY_ID = "inspir.local-strategy.chess" as const;
export const CHESS_LOCAL_STRATEGY_VERSION = "1.0.0" as const;

const pieceValue: Readonly<Record<string, number>> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

export function chooseChessOpponentAction(state: ChessState): ChessAction | null {
  if (state.result || state.activeActor !== "opponent") return null;
  const token = chooseChessOpponentTokenFromPosition(new Chess(state.fen));
  return token ? { token } : null;
}

export function chooseChessOpponentTokenFromPosition(position: Chess): string | null {
  return chooseChessOpponentTokenFromLegalMoves(position.moves({ verbose: true }));
}

/** Rank an already-generated legal move list so authoritative replays do not
 * make chess.js generate the same position's legal moves a second time. */
export function chooseChessOpponentTokenFromLegalMoves(moves: readonly Move[]): string | null {
  const ranked = [...moves].sort((left, right) => {
    const scoreDelta = actionScore(right) - actionScore(left);
    return scoreDelta !== 0 ? scoreDelta : left.lan.localeCompare(right.lan);
  });
  return ranked[0]?.lan ?? null;
}

function actionScore(action: Move) {
  if (action.san.endsWith("#")) return 1_000_000;
  const captureScore = action.captured ? pieceValue[action.captured] ?? 0 : 0;
  const promotionScore = action.promotion ? pieceValue[action.promotion] ?? 0 : 0;
  const checkScore = action.san.endsWith("+") ? 35 : 0;
  const file = action.to.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(action.to[1]) - 1;
  const centreScore = 12 - Math.abs(file - 3.5) * 2 - Math.abs(rank - 3.5) * 2;
  return captureScore * 10 + promotionScore * 10 + checkScore + centreScore;
}
