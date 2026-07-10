import type { ChessResult, ChessState } from "./chess";
import type { ConnectFourResult, ConnectFourState } from "./connect-four";
import type { TicTacToeResult, TicTacToeState } from "./tic-tac-toe";

export type GameState = TicTacToeState | ConnectFourState | ChessState;
export type GameTerminalResult = TicTacToeResult | ConnectFourResult | ChessResult;

export function isCompletedGameState(state: GameState): boolean {
  switch (state.gameSlug) {
    case "tic-tac-toe":
    case "connect-four":
    case "chess":
      return state.result !== null;
  }
}
