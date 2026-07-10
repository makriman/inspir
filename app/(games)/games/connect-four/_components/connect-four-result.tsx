"use client";

import {
  applyConnectFourMove,
  createConnectFourState,
  parseConnectFourState,
  type ConnectFourState,
} from "@/lib/games/connect-four";
import { ResultExperience, type GameResultAdapter } from "../../_components/result-experience";
import { ConnectFourBoardView } from "./connect-four-board";

const adapter: GameResultAdapter<ConnectFourState> = {
  gameName: "Connect Four",
  slug: "connect-four",
  accent: "amber",
  parseState(value) {
    const parsed = parseConnectFourState(value);
    return parsed.success && parsed.data.result ? parsed.data : null;
  },
  replayAt(state, ply) {
    let replay = createConnectFourState(state.humanDisc);
    for (const move of state.history.slice(0, ply)) {
      const applied = applyConnectFourMove(replay, move.actor, { column: move.column });
      if (!applied.ok) return replay;
      replay = applied.state;
    }
    return replay;
  },
  historyLength: (state) => state.history.length,
  outcome: (state) => state.result?.outcome ?? "draw",
  terminalCode: (state) => state.result?.terminalCode ?? "connect-four:board-full",
  resultReason(state) {
    return state.result?.terminalCode === "connect-four:four-in-a-row"
      ? `${state.result.outcome === "win" ? "Your" : "The local opponent’s"} discs completed a line of four.`
      : "Every slot was occupied without a completed line of four.";
  },
  engineIdentity: (state) => ({ id: state.engineId, version: state.engineVersion }),
  describeMove(state, index) {
    const move = state.history[index];
    if (!move) return "Unknown move";
    return `${move.actor === "human" ? "You" : "Local"} · ${move.disc} · column ${move.column + 1}`;
  },
  renderBoard: (state) => <ConnectFourBoardView state={state} />,
};

export function ConnectFourResult({ resultId }: Readonly<{ resultId: string }>) {
  return <ResultExperience resultId={resultId} adapter={adapter} />;
}
