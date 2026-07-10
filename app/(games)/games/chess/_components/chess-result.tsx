"use client";

import {
  applyChessMove,
  createChessState,
  parseChessState,
  type ChessState,
} from "@/lib/games/chess";
import { ResultExperience, type GameResultAdapter } from "../../_components/result-experience";
import { ChessBoardView } from "./chess-board";

const terminalReason: Readonly<Record<string, string>> = {
  "chess:checkmate": "The king was checkmated: in check with no legal move remaining.",
  "chess:stalemate": "The side to move had no legal move and was not in check.",
  "chess:insufficient-material": "Neither side had enough material remaining to force checkmate.",
  "chess:threefold-repetition": "The same position occurred three times.",
  "chess:fifty-move-rule": "Fifty moves elapsed without a pawn move or capture.",
};

const adapter: GameResultAdapter<ChessState> = {
  gameName: "Chess",
  slug: "chess",
  accent: "cyan",
  parseState(value) {
    const parsed = parseChessState(value);
    return parsed.success && parsed.data.result ? parsed.data : null;
  },
  replayAt(state, ply) {
    let replay = createChessState({ humanColor: state.humanColor, initialFen: state.initialFen });
    for (const move of state.history.slice(0, ply)) {
      const applied = applyChessMove(replay, move.actor, { token: move.token });
      if (!applied.ok) return replay;
      replay = applied.state;
    }
    return replay;
  },
  historyLength: (state) => state.history.length,
  outcome: (state) => state.result?.outcome ?? "draw",
  terminalCode: (state) => state.result?.terminalCode ?? "chess:stalemate",
  resultReason(state) {
    const code = state.result?.terminalCode ?? "";
    return terminalReason[code] ?? "The position reached a terminal state under the recorded rules.";
  },
  engineIdentity: (state) => ({ id: state.engineId, version: state.engineVersion }),
  describeMove(state, index) {
    const move = state.history[index];
    if (!move) return "Unknown move";
    return `${move.actor === "human" ? "You" : "Local"} · ${move.san} · ${move.from}→${move.to}`;
  },
  renderBoard: (state) => <ChessBoardView state={state} />,
};

export function ChessResult({ resultId }: Readonly<{ resultId: string }>) {
  return <ResultExperience resultId={resultId} adapter={adapter} />;
}
