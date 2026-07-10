"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  applyTicTacToeMove,
  createTicTacToeState,
  type TicTacToeState,
} from "@/lib/games/tic-tac-toe";
import { chooseTicTacToeOpponentAction } from "@/lib/games/tic-tac-toe-strategy";
import { GameFrame } from "../../_components/game-frame";
import { useCompletedGameNavigation } from "../../_components/result-client";
import { ResultSaveRecovery } from "../../_components/result-save-recovery";
import { TicTacToeBoardView } from "./tic-tac-toe-board";

export function TicTacToeGame() {
  const [state, setState] = useState<TicTacToeState>(() => createTicTacToeState("x"));
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const boardRef = useRef<HTMLDivElement>(null);
  const completionNavigation = useCompletedGameNavigation({
    slug: "tic-tac-toe",
    state,
    startedAt,
    complete: state.result !== null,
  });

  useEffect(() => {
    if (state.activeActor !== "opponent" || state.result) return;
    const timer = window.setTimeout(() => {
      setState((current) => {
        const action = chooseTicTacToeOpponentAction(current);
        if (!action) return current;
        const applied = applyTicTacToeMove(current, "opponent", action);
        return applied.ok ? applied.state : current;
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [state]);

  function playCell(index: number) {
    setState((current) => {
      const applied = applyTicTacToeMove(current, "human", { index });
      return applied.ok ? applied.state : current;
    });
  }

  function restart() {
    setState(createTicTacToeState("x"));
    setStartedAt(new Date().toISOString());
  }

  function handleCellKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = Math.floor(index / 3);
    const column = index % 3;
    let target = index;
    if (event.key === "ArrowLeft") target = row * 3 + ((column + 2) % 3);
    else if (event.key === "ArrowRight") target = row * 3 + ((column + 1) % 3);
    else if (event.key === "ArrowUp") target = ((row + 2) % 3) * 3 + column;
    else if (event.key === "ArrowDown") target = ((row + 1) % 3) * 3 + column;
    else return;
    event.preventDefault();
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-cell-index="${target}"]`)?.focus();
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
          ? "Local strategy is choosing a move…"
          : "Your turn · place ×";

  return (
    <GameFrame
      slug="tic-tac-toe"
      gameName="Tic-Tac-Toe"
      mark="×"
      eyebrow="3 × 3 · local strategy"
      description="Make three in a row. You are × and always move first."
      accent="violet"
      status={status}
      aside={
        <>
          <section className="game-instructions-card">
            <p className="game-card-label">How to play</p>
            <h2>Own a line of three.</h2>
            <p>Select any empty square. Use the arrow keys to move around the board.</p>
            <button className="game-reset-button" type="button" onClick={restart} data-testid="restart-game">
              Restart board
            </button>
          </section>
          <ResultSaveRecovery navigation={completionNavigation} />
        </>
      }
    >
      <div className="game-board-panel" ref={boardRef}>
        <TicTacToeBoardView
          state={state}
          interactive
          onCell={playCell}
          onCellKeyDown={handleCellKeyDown}
        />
        <div className="game-player-key" aria-label="Players">
          <span><i className="player-dot player-dot--human" /> You · ×</span>
          <span><i className="player-dot player-dot--opponent" /> Local strategy · ○</span>
        </div>
      </div>
    </GameFrame>
  );
}

function resultStatus(state: TicTacToeState) {
  if (state.result?.outcome === "win") return "Three in a row — you win.";
  if (state.result?.outcome === "loss") return "Local strategy made three in a row.";
  return "The board is full — draw.";
}
