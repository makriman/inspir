"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  applyConnectFourMove,
  createConnectFourState,
  type ConnectFourState,
} from "@/lib/games/connect-four";
import { chooseConnectFourOpponentAction } from "@/lib/games/connect-four-strategy";
import { GameFrame } from "../../_components/game-frame";
import { useCompletedGameNavigation } from "../../_components/result-client";
import { ResultSaveRecovery } from "../../_components/result-save-recovery";
import { ConnectFourBoardView } from "./connect-four-board";

export function ConnectFourGame() {
  const [state, setState] = useState<ConnectFourState>(() => createConnectFourState("red"));
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const boardRef = useRef<HTMLDivElement>(null);
  const completionNavigation = useCompletedGameNavigation({
    slug: "connect-four",
    state,
    startedAt,
    complete: state.result !== null,
  });

  useEffect(() => {
    if (state.activeActor !== "opponent" || state.result) return;
    const timer = window.setTimeout(() => {
      setState((current) => {
        const action = chooseConnectFourOpponentAction(current);
        if (!action) return current;
        const applied = applyConnectFourMove(current, "opponent", action);
        return applied.ok ? applied.state : current;
      });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [state]);

  function playColumn(column: number) {
    setState((current) => {
      const applied = applyConnectFourMove(current, "human", { column });
      return applied.ok ? applied.state : current;
    });
  }

  function restart() {
    setState(createConnectFourState("red"));
    setStartedAt(new Date().toISOString());
  }

  function handleColumnKeyDown(event: KeyboardEvent<HTMLButtonElement>, column: number) {
    let target = column;
    if (event.key === "ArrowLeft") target = (column + 6) % 7;
    else if (event.key === "ArrowRight") target = (column + 1) % 7;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = 6;
    else return;
    event.preventDefault();
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-column="${target}"]`)?.focus();
  }

  const status = completionNavigation.status === "saving"
    ? "Game complete. Saving the replay…"
    : completionNavigation.status === "local"
      ? "Saved on this device. Opening the result…"
      : completionNavigation.status === "failed"
        ? "Result not saved. Retry or export the completed game below."
      : state.result
        ? resultStatus(state)
        : state.activeActor === "opponent"
          ? "Local strategy is choosing a column…"
          : "Your turn · drop a red disc";

  return (
    <GameFrame
      slug="connect-four"
      gameName="Connect Four"
      mark="●"
      eyebrow="7 columns · local strategy"
      description="Stack four discs vertically, horizontally, or diagonally. You play red."
      accent="amber"
      status={status}
      aside={
        <>
          <section className="game-instructions-card">
            <p className="game-card-label">How to play</p>
            <h2>Shape two threats at once.</h2>
            <p>Choose a column to drop a disc. Use left and right arrow keys to move between columns.</p>
            <button className="game-reset-button" type="button" onClick={restart} data-testid="restart-game">
              Restart board
            </button>
          </section>
          <ResultSaveRecovery navigation={completionNavigation} />
        </>
      }
    >
      <div className="game-board-panel game-board-panel--wide" ref={boardRef}>
        <ConnectFourBoardView
          state={state}
          interactive
          onColumn={playColumn}
          onColumnKeyDown={handleColumnKeyDown}
        />
        <div className="game-player-key" aria-label="Players">
          <span><i className="player-dot player-dot--red" /> You · red</span>
          <span><i className="player-dot player-dot--yellow" /> Local strategy · yellow</span>
        </div>
      </div>
    </GameFrame>
  );
}

function resultStatus(state: ConnectFourState) {
  if (state.result?.outcome === "win") return "Four connected — you win.";
  if (state.result?.outcome === "loss") return "Local strategy connected four.";
  return "The grid is full — draw.";
}
