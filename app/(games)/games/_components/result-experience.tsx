"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { loadCompletedGame, type LoadedGameResult } from "./result-client";

const COMPLETED_AT_FORMATTER = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export type GameResultAdapter<State> = Readonly<{
  gameName: string;
  slug: "tic-tac-toe" | "connect-four" | "chess";
  accent: "violet" | "amber" | "cyan";
  parseState(value: unknown): State | null;
  replayAt(state: State, ply: number): State;
  historyLength(state: State): number;
  outcome(state: State): "win" | "loss" | "draw";
  terminalCode(state: State): string;
  resultReason(state: State): string;
  engineIdentity(state: State): Readonly<{ id: string; version: string }>;
  describeMove(state: State, index: number): string;
  renderBoard(state: State, replayPly: number): ReactNode;
}>;

type ResultExperienceProps<State> = Readonly<{
  resultId: string;
  adapter: GameResultAdapter<State>;
}>;

type ResultExperienceState<State> = Readonly<{
  loaded: LoadedGameResult | null;
  gameState: State | null;
  loadingState: "loading" | "ready" | "missing";
  replayPly: number;
  copyStatus: string;
}>;

type ResultExperienceAction<State> =
  | Readonly<{ type: "load-missing" }>
  | Readonly<{
      type: "load-ready";
      loaded: LoadedGameResult;
      gameState: State;
      replayPly: number;
    }>
  | Readonly<{ type: "step-replay"; delta: -1 | 1; totalPly: number }>
  | Readonly<{ type: "set-replay"; replayPly: number }>
  | Readonly<{ type: "set-copy-status"; copyStatus: string }>;

function resultExperienceReducer<State>(
  current: ResultExperienceState<State>,
  action: ResultExperienceAction<State>,
): ResultExperienceState<State> {
  switch (action.type) {
    case "load-missing":
      return {
        loaded: null,
        gameState: null,
        loadingState: "missing",
        replayPly: 0,
        copyStatus: "",
      };
    case "load-ready":
      return {
        loaded: action.loaded,
        gameState: action.gameState,
        loadingState: "ready",
        replayPly: action.replayPly,
        copyStatus: "",
      };
    case "step-replay":
      return {
        ...current,
        replayPly: Math.min(action.totalPly, Math.max(0, current.replayPly + action.delta)),
      };
    case "set-replay":
      return { ...current, replayPly: action.replayPly };
    case "set-copy-status":
      return { ...current, copyStatus: action.copyStatus };
  }
}

export function ResultExperience<State>({ resultId, adapter }: ResultExperienceProps<State>) {
  const [{ loaded, gameState, loadingState, replayPly, copyStatus }, dispatch] = useReducer(
    resultExperienceReducer<State>,
    {
      loaded: null,
      gameState: null,
      loadingState: "loading",
      replayPly: 0,
      copyStatus: "",
    },
  );

  useEffect(() => {
    let active = true;
    void loadCompletedGame(resultId).then((candidate) => {
      if (!active) return;
      if (!candidate) {
        dispatch({ type: "load-missing" });
        return;
      }
      const parsedState = adapter.parseState(candidate.state);
      if (!parsedState) {
        dispatch({ type: "load-missing" });
        return;
      }
      dispatch({
        type: "load-ready",
        loaded: candidate,
        gameState: parsedState,
        replayPly: adapter.historyLength(parsedState),
      });
    });
    return () => {
      active = false;
    };
  }, [adapter, resultId]);

  const replayState = useMemo(() => {
    if (!gameState) return null;
    return adapter.replayAt(gameState, replayPly);
  }, [adapter, gameState, replayPly]);

  if (loadingState === "loading") {
    return <ResultMessage title="Opening result…" body="Checking this device and the result store." />;
  }

  if (loadingState === "missing" || !loaded || !gameState || !replayState) {
    return (
      <ResultMessage
        title="This result is not available here."
        body="Local results only work in the browser that created them. The result may also have been removed or the link may be incomplete."
      />
    );
  }

  const totalPly = adapter.historyLength(gameState);
  const outcome = adapter.outcome(gameState);
  const engine = adapter.engineIdentity(gameState);
  const opponent = loaded.opponent?.engine ?? {
    id: `inspir.local-strategy.${adapter.slug}`,
    version: "1.0.0",
  };
  const title = outcome === "win" ? "You found the win." : outcome === "loss" ? "The position got away." : "A balanced draw.";

  async function copyResultLink() {
    if (loaded?.source === "local") {
      dispatch({
        type: "set-copy-status",
        copyStatus: "Local-only result: this link works only in this browser on this device.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
      dispatch({ type: "set-copy-status", copyStatus: "Result link copied." });
    } catch {
      dispatch({
        type: "set-copy-status",
        copyStatus: "Copy the current address from your browser to share this result.",
      });
    }
  }

  return (
    <main className={`result-shell result-shell--${adapter.accent}`} data-testid="result-experience">
      <nav className="games-topbar" aria-label="Result navigation">
        <Link className="games-wordmark" href="/">
          inspir
        </Link>
        <Link className="games-back-link" href={`/games/${adapter.slug}`}>
          <span aria-hidden="true">←</span> {adapter.gameName}
        </Link>
      </nav>

      <header className="result-hero">
        <p className="games-kicker">{adapter.gameName} · complete result</p>
        <div className={`result-outcome result-outcome--${outcome}`}>{outcome}</div>
        <h1>{title}</h1>
        <p>{adapter.resultReason(gameState)}</p>
        {loaded.source === "local" ? (
          <p className="result-local-notice" data-testid="local-result-notice">
            Cloud save was unavailable, so this result is stored on this device only. Finish a game
            while online to get a shareable result.
          </p>
        ) : null}
      </header>

      <section className="result-metrics" aria-label="Result summary">
        <div>
          <span>Terminal code</span>
          <strong data-testid="result-terminal-code">{adapter.terminalCode(gameState)}</strong>
        </div>
        <div>
          <span>Turns recorded</span>
          <strong>{totalPly}</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{formatDuration(loaded.durationMs)}</strong>
        </div>
        <div>
          <span>Completed</span>
          <strong>{formatCompletedAt(loaded.completedAt)}</strong>
        </div>
      </section>

      <section className="result-grid">
        <article className="result-board-card">
          <div className="result-section-heading">
            <div>
              <p className="game-card-label">Move replay</p>
              <h2>
                Position {replayPly} of {totalPly}
              </h2>
            </div>
            <div className="replay-step-buttons">
              <button
                type="button"
                onClick={() => dispatch({ type: "step-replay", delta: -1, totalPly })}
                disabled={replayPly === 0}
                aria-label="Previous position"
                data-testid="replay-previous"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: "step-replay", delta: 1, totalPly })}
                disabled={replayPly === totalPly}
                aria-label="Next position"
                data-testid="replay-next"
              >
                →
              </button>
            </div>
          </div>
          <div className="result-board-wrap">
            <ReplayBoard renderBoard={adapter.renderBoard} state={replayState} replayPly={replayPly} />
          </div>
          <label className="replay-slider-label">
            Replay position
            <input
              type="range"
              min={0}
              max={totalPly}
              value={replayPly}
              onChange={(event) =>
                dispatch({ type: "set-replay", replayPly: event.currentTarget.valueAsNumber })
              }
              data-testid="replay-slider"
            />
          </label>
        </article>

        <aside className="result-detail-column">
          <section className="result-provenance-card">
            <p className="game-card-label">Verified provenance</p>
            <h2>What produced this result</h2>
            <dl>
              <div>
                <dt>Rules</dt>
                <dd>{engine.id}</dd>
              </div>
              <div>
                <dt>Rules version</dt>
                <dd>{engine.version}</dd>
              </div>
              <div>
                <dt>Opponent</dt>
                <dd>{opponent.id}</dd>
              </div>
              <div>
                <dt>Opponent version</dt>
                <dd>{opponent.version}</dd>
              </div>
              <div>
                <dt>Execution</dt>
                <dd>Deterministic · local</dd>
              </div>
            </dl>
          </section>

          <section className="result-move-list" aria-label="Move list">
            <p className="game-card-label">Recorded moves</p>
            <ol>
              {Array.from({ length: totalPly }, (_, index) => {
                const ply = index + 1;
                const moveKey = `ply-${ply}`;
                return (
                  <li key={moveKey}>
                    <button
                      type="button"
                      className={replayPly === ply ? "is-current" : undefined}
                      onClick={() => dispatch({ type: "set-replay", replayPly: ply })}
                    >
                      <span>{ply}</span>
                      {adapter.describeMove(gameState, index)}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </section>

      <section className="result-reflection">
        <p className="games-kicker">One move of reflection</p>
        <h2>Where did the shape of the game change?</h2>
        <p>
          Scrub through the replay and choose one turn where your plan became clearer—or where a
          different move would have changed the result.
        </p>
      </section>

      <section className="result-actions" aria-label="Next actions">
        <Link className="games-primary-link" href={`/games/${adapter.slug}?rematch=${encodeURIComponent(resultId)}`}>
          Rematch
          <span aria-hidden="true">↻</span>
        </Link>
        <Link className="games-secondary-link" href="/games">
          Choose another game
        </Link>
        <button className="games-secondary-link" type="button" onClick={copyResultLink}>
          {loaded.source === "local" ? "About this local result" : "Copy result link"}
        </button>
        <output className="result-copy-status" aria-live="polite">
          {copyStatus}
        </output>
      </section>
    </main>
  );
}

function ReplayBoard<State>({
  renderBoard,
  state,
  replayPly,
}: Readonly<{
  renderBoard: GameResultAdapter<State>["renderBoard"];
  state: State;
  replayPly: number;
}>) {
  return renderBoard(state, replayPly);
}

function ResultMessage({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <main className="result-shell result-message" data-testid="result-message">
      <Link className="games-wordmark" href="/games">
        inspir · game arena
      </Link>
      <h1>{title}</h1>
      <p>{body}</p>
      <Link className="games-primary-link" href="/games">
        Browse games <span aria-hidden="true">→</span>
      </Link>
    </main>
  );
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return "Not recorded";
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatCompletedAt(value: string) {
  return COMPLETED_AT_FORMATTER.format(new Date(value));
}
