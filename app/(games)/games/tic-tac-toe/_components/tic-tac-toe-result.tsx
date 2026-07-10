"use client";

import {
  applyTicTacToeMove,
  createTicTacToeState,
  parseTicTacToeState,
  type TicTacToeState,
} from "@/lib/games/tic-tac-toe";
import { ResultExperience, type GameResultAdapter } from "../../_components/result-experience";
import { TicTacToeBoardView } from "./tic-tac-toe-board";

const adapter: GameResultAdapter<TicTacToeState> = {
  gameName: "Tic-Tac-Toe",
  slug: "tic-tac-toe",
  accent: "violet",
  parseState(value) {
    const parsed = parseTicTacToeState(value);
    return parsed.success && parsed.data.result ? parsed.data : null;
  },
  replayAt(state, ply) {
    let replay = createTicTacToeState(state.humanMark);
    for (const move of state.history.slice(0, ply)) {
      const applied = applyTicTacToeMove(replay, move.actor, { index: move.index });
      if (!applied.ok) return replay;
      replay = applied.state;
    }
    return replay;
  },
  historyLength: (state) => state.history.length,
  outcome: (state) => state.result?.outcome ?? "draw",
  terminalCode: (state) => state.result?.terminalCode ?? "tic-tac-toe:board-full",
  resultReason(state) {
    return state.result?.terminalCode === "tic-tac-toe:three-in-a-row"
      ? `${state.result.outcome === "win" ? "Your" : "The local opponent’s"} marks completed a line of three.`
      : "Every square was occupied without a completed line.";
  },
  engineIdentity: (state) => ({ id: state.engineId, version: state.engineVersion }),
  describeMove(state, index) {
    const move = state.history[index];
    if (!move) return "Unknown move";
    return `${move.actor === "human" ? "You" : "Local"} · ${move.mark.toUpperCase()} · square ${move.index + 1}`;
  },
  renderBoard: (state) => <TicTacToeBoardView state={state} />,
};

export function TicTacToeResult({ resultId }: Readonly<{ resultId: string }>) {
  return <ResultExperience resultId={resultId} adapter={adapter} />;
}
