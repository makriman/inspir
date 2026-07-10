"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  applyChessMove,
  createChessState,
  legalChessActions,
  type ChessLegalAction,
  type ChessState,
} from "@/lib/games/chess";
import { chooseChessOpponentAction } from "@/lib/games/chess-strategy";
import { GameFrame } from "../../_components/game-frame";
import { useCompletedGameNavigation } from "../../_components/result-client";
import { ResultSaveRecovery } from "../../_components/result-save-recovery";
import { ChessBoardView } from "./chess-board";

export function ChessGame() {
  const [state, setState] = useState<ChessState>(() => createChessState({ humanColor: "w" }));
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [selected, setSelected] = useState<string | null>(null);
  const [promotionChoices, setPromotionChoices] = useState<readonly ChessLegalAction[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const promotionDialogRef = useRef<HTMLDialogElement>(null);
  const legalActions = useMemo(() => legalChessActions(state), [state]);
  const legalTargets = useMemo(() => {
    const targets = new Set<string>();
    for (const action of legalActions) {
      if (action.from === selected) targets.add(action.to);
    }
    return targets;
  }, [legalActions, selected]);
  const completionNavigation = useCompletedGameNavigation({
    slug: "chess",
    state,
    startedAt,
    complete: state.result !== null,
  });

  useEffect(() => {
    if (state.activeActor !== "opponent" || state.result) return;
    const timer = window.setTimeout(() => {
      setState((current) => {
        const action = chooseChessOpponentAction(current);
        if (!action) return current;
        const applied = applyChessMove(current, "opponent", action);
        return applied.ok ? applied.state : current;
      });
    }, 380);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const dialog = promotionDialogRef.current;
    if (!dialog) return;
    if (promotionChoices.length > 0) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [promotionChoices]);

  function chooseSquare(square: string) {
    if (state.activeActor !== "human" || state.result) return;
    const origins = legalActions.filter((action) => action.from === square);
    if (!selected) {
      if (origins.length > 0) setSelected(square);
      return;
    }

    const destinationMoves = legalActions.filter(
      (action) => action.from === selected && action.to === square,
    );
    if (destinationMoves.length > 0) {
      if (destinationMoves.some((action) => action.promotion)) {
        setPromotionChoices(destinationMoves);
      } else {
        commitMove(destinationMoves[0]);
      }
      return;
    }

    setPromotionChoices([]);
    setSelected(origins.length > 0 ? square : null);
  }

  function commitMove(action: ChessLegalAction | undefined) {
    if (!action) return;
    setState((current) => {
      const applied = applyChessMove(current, "human", { token: action.token });
      return applied.ok ? applied.state : current;
    });
    setPromotionChoices([]);
    setSelected(null);
  }

  function restart() {
    setState(createChessState({ humanColor: "w" }));
    setStartedAt(new Date().toISOString());
    setSelected(null);
    setPromotionChoices([]);
  }

  function handleSquareKeyDown(event: KeyboardEvent<HTMLButtonElement>, square: string) {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    let targetFile = file;
    let targetRank = rank;
    if (event.key === "ArrowLeft") targetFile = (file + 7) % 8;
    else if (event.key === "ArrowRight") targetFile = (file + 1) % 8;
    else if (event.key === "ArrowUp") targetRank = rank === 8 ? 1 : rank + 1;
    else if (event.key === "ArrowDown") targetRank = rank === 1 ? 8 : rank - 1;
    else return;
    event.preventDefault();
    const target = `${String.fromCharCode(97 + targetFile)}${targetRank}`;
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-square="${target}"]`)?.focus();
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
          ? "Local strategy is calculating a legal move…"
          : selected
            ? `${selected} selected · choose a highlighted destination`
            : "Your turn · select a white piece";

  return (
    <GameFrame
      slug="chess"
      gameName="Chess"
      mark="♞"
      eyebrow="64 squares · full rules"
      description="Play as White under standard chess rules. Select a piece, then a highlighted square."
      accent="cyan"
      status={status}
      aside={
        <>
          <section className="game-instructions-card">
            <p className="game-card-label">How to play</p>
            <h2>Build the position.</h2>
            <p>Arrow keys move focus. Enter or Space selects a piece and its destination.</p>
            <button className="game-reset-button" type="button" onClick={restart} data-testid="restart-game">
              Restart game
            </button>
          </section>
          <section className="chess-moves-card" aria-label="Recent moves">
            <p className="game-card-label">Recent moves</p>
            {state.history.length === 0 ? (
              <p>No moves yet.</p>
            ) : (
              <ol>
                {state.history.slice(-8).map((move) => (
                  <li key={move.ply}>
                    <span>{move.ply}</span>
                    <strong>{move.san}</strong>
                    <small>{move.actor === "human" ? "You" : "Local"}</small>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <ResultSaveRecovery navigation={completionNavigation} />
        </>
      }
    >
      <div className="game-board-panel game-board-panel--chess" ref={boardRef}>
        <dialog
          ref={promotionDialogRef}
          className="chess-promotion-picker"
          aria-label="Choose promotion piece"
          data-testid="promotion-picker"
          onCancel={(event) => event.preventDefault()}
        >
          <p>Promote the pawn to:</p>
          <div>
            {promotionChoices.map((action) => (
              <button
                key={action.token}
                type="button"
                onClick={() => commitMove(action)}
                aria-label={`Promote to ${promotionName(action.promotion)}`}
              >
                <span aria-hidden="true">{promotionGlyph(action.promotion)}</span>
                {promotionName(action.promotion)}
              </button>
            ))}
          </div>
        </dialog>
        <ChessBoardView
          state={state}
          selected={selected}
          legalTargets={legalTargets}
          interactive={state.activeActor === "human" && !state.result}
          onSquare={chooseSquare}
          onSquareKeyDown={handleSquareKeyDown}
        />
        <div className="game-player-key" aria-label="Players">
          <span><i className="player-dot player-dot--white" /> You · White</span>
          <span><i className="player-dot player-dot--black" /> Local strategy · Black</span>
        </div>
      </div>
    </GameFrame>
  );
}

function promotionName(piece: ChessLegalAction["promotion"]) {
  if (piece === "q") return "queen";
  if (piece === "r") return "rook";
  if (piece === "b") return "bishop";
  if (piece === "n") return "knight";
  return "piece";
}

function promotionGlyph(piece: ChessLegalAction["promotion"]) {
  if (piece === "q") return "♕";
  if (piece === "r") return "♖";
  if (piece === "b") return "♗";
  if (piece === "n") return "♘";
  return "";
}

function resultStatus(state: ChessState) {
  if (state.result?.outcome === "win") return "Checkmate — you win.";
  if (state.result?.outcome === "loss") return "Checkmate — local strategy wins.";
  return "The game is drawn.";
}
