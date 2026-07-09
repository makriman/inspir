"use client";

import { useMemo, useReducer, useState, type ReactNode } from "react";
import { Bot, Brain, CircleDot, RotateCcw, Sparkles, Swords } from "lucide-react";
import {
  type ActivityRun,
  type ActivityRunResponse,
  isGameArenaState,
  mergeActivityState,
  type PublicChessPiece,
  type PublicGameArenaLegalAction,
  type PublicGameArenaState,
} from "@/components/chat/activity-model";

type GameArenaWorkspaceProps = {
  activeChatId?: string;
  activeTopicId: string;
  activityRun: ActivityRun | null;
  createChat: (topicId?: string) => Promise<string>;
  onActivityRun: (run: ActivityRun | null) => void;
};

type GameSlug = PublicGameArenaState["gameSlug"];
type ModelProfile = PublicGameArenaState["modelProfile"];

type GameOption = {
  slug: GameSlug;
  name: string;
  description: string;
  sides: readonly [string, string];
  icon: string;
};

const gameOptions: readonly GameOption[] = [
  {
    slug: "chess",
    name: "Chess",
    description: "Legal-move chess powered by chess.js validation.",
    sides: ["White", "Black"],
    icon: "♞",
  },
  {
    slug: "connect-four",
    name: "Connect Four",
    description: "Drop discs and race to four in a row.",
    sides: ["Red", "Yellow"],
    icon: "●",
  },
  {
    slug: "tic-tac-toe",
    name: "Tic-Tac-Toe",
    description: "A quick tactical warm-up against the model.",
    sides: ["X", "O"],
    icon: "X",
  },
] as const;

const modelOptions: ReadonlyArray<{ profile: ModelProfile; label: string; description: string }> = [
  { profile: "fast", label: "GPT-5 mini", description: "Quick replies" },
  { profile: "reasoning", label: "GPT-5", description: "Stronger play" },
] as const;

export function GameArenaWorkspace({
  activeChatId,
  activeTopicId,
  activityRun,
  createChat,
  onActivityRun,
}: GameArenaWorkspaceProps) {
  const arena = activityRun?.type === "game-arena" && isGameArenaState(activityRun.state) ? activityRun.state : null;
  const [{ selectedGame, selectedSide, selectedModel, loading, thinking, error, setupOpen }, updateArenaState] =
    useReducer(
      mergeActivityState<{
        selectedGame: GameSlug;
        selectedSide: string;
        selectedModel: ModelProfile;
        loading: boolean;
        thinking: boolean;
        error: string;
        setupOpen: boolean;
      }>,
      {
        selectedGame: arena?.gameSlug ?? "chess",
        selectedSide: arena?.humanSide ?? "White",
        selectedModel: arena?.modelProfile ?? "fast",
        loading: false,
        thinking: false,
        error: "",
        setupOpen: false,
      },
    );
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const currentGame = gameOptions.find((game) => game.slug === selectedGame) ?? gameOptions[0];
  const showSetup = setupOpen || !arena;

  function chooseGame(slug: GameSlug) {
    const game = gameOptions.find((option) => option.slug === slug) ?? gameOptions[0];
    updateArenaState({ selectedGame: slug, selectedSide: game.sides[0], error: "" });
  }

  async function startMatch() {
    if (loading) return;
    updateArenaState({ loading: true, error: "" });
    try {
      const chatId = activeChatId ?? (await createChat(activeTopicId));
      const response = await fetch("/api/activities/game-arena", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chatId,
          gameSlug: selectedGame,
          humanSide: selectedSide,
          modelProfile: selectedModel,
        }),
      });
      if (!response.ok) throw new Error("Could not start game");
      const data = (await response.json()) as ActivityRunResponse;
      onActivityRun(data.activityRun);
      updateArenaState({ setupOpen: false });
    } catch {
      updateArenaState({ error: "I could not start that match. Try again in a moment." });
    } finally {
      updateArenaState({ loading: false });
    }
  }

  async function playMove(action: string) {
    if (!activityRun || thinking || arena?.activePlayer !== "human") return;
    updateArenaState({ thinking: true, error: "" });
    try {
      const response = await fetch(`/api/activities/game-arena/${activityRun.id}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as ActivityRunResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not play move");
      onActivityRun(data.activityRun);
    } catch (caught) {
      updateArenaState({
        error: caught instanceof Error ? caught.message : "I could not submit that move. Please try again.",
      });
    } finally {
      updateArenaState({ thinking: false });
    }
  }

  return (
    <main className="inspir-workspace inspir-game-workspace">
      {showSetup ? (
        <section className="inspir-game-setup">
          <div className="inspir-game-setup-copy">
            <div className="inspir-game-icon">
              <Swords size={30} />
            </div>
            <span>AI game arena</span>
            <h2>Play strategy games against OpenAI.</h2>
            <p>Choose a game, pick your side, and play a turn-by-turn match inside this workspace.</p>
          </div>

          <div className="inspir-game-setup-panel">
            <div className="inspir-game-picker" aria-label="Choose a game">
              {gameOptions.map((game) => (
                <button
                  key={game.slug}
                  type="button"
                  className={game.slug === selectedGame ? "is-selected" : ""}
                  onClick={() => chooseGame(game.slug)}
                >
                  <strong>{game.icon}</strong>
                  <span>{game.name}</span>
                  <small>{game.description}</small>
                </button>
              ))}
            </div>

            <SegmentedControl
              label="Your side"
              options={currentGame.sides.map((side) => ({ value: side, label: side }))}
              value={selectedSide}
              onChange={(side) => updateArenaState({ selectedSide: side })}
            />

            <SegmentedControl
              label="Opponent"
              options={modelOptions.map((model) => ({
                value: model.profile,
                label: model.label,
                description: model.description,
              }))}
              value={selectedModel}
              onChange={(profile) => updateArenaState({ selectedModel: profile })}
            />

            <button
              type="button"
              className="inspir-game-start"
              disabled={loading}
              onClick={() => void startMatch()}
            >
              {loading ? (
                <>
                  <Sparkles size={17} />
                  Starting match
                </>
              ) : (
                <>
                  <CircleDot size={17} />
                  Start match
                </>
              )}
            </button>
            {arena ? (
              <button
                type="button"
                className="inspir-game-return"
                onClick={() => updateArenaState({ setupOpen: false, error: "" })}
              >
                Return to current match
              </button>
            ) : null}
            {error ? <span className="inspir-quiz-error">{error}</span> : null}
          </div>
        </section>
      ) : arena ? (
        <section className="inspir-game-shell">
          <header className="inspir-game-header">
            <div>
              <span>Live match</span>
              <h2>{arena.gameName}</h2>
              <p>{arena.statusText}</p>
            </div>
            <button type="button" onClick={() => updateArenaState({ setupOpen: true, error: "" })}>
              <RotateCcw size={16} />
              New match
            </button>
          </header>

          <div className="inspir-game-seat-row">
            <SeatCard label="You" side={arena.humanSide} active={arena.activePlayer === "human"} />
            <SeatCard
              label={arena.modelProfile === "reasoning" ? "GPT-5" : "GPT-5 mini"}
              side={arena.modelSide}
              active={arena.activePlayer === "model"}
              icon={<Bot size={17} />}
            />
          </div>

          <div className="inspir-game-stage">
            <div className="inspir-game-board-wrap">
              {arena.gameSlug === "chess" ? (
                <ChessBoard
                  arena={arena}
                  selectedSquare={selectedSquare}
                  thinking={thinking}
                  onSelectSquare={setSelectedSquare}
                  onMove={(action) => void playMove(action)}
                />
              ) : arena.gameSlug === "connect-four" ? (
                <ConnectFourBoard arena={arena} thinking={thinking} onMove={(action) => void playMove(action)} />
              ) : (
                <TicTacToeBoard arena={arena} thinking={thinking} onMove={(action) => void playMove(action)} />
              )}
            </div>

            <aside className="inspir-game-panel">
              <div className="inspir-game-status" aria-live="polite">
                {thinking || arena.activePlayer === "model" ? (
                  <>
                    <Brain size={18} />
                    <strong>OpenAI is thinking</strong>
                    <span>The board will update after the model move.</span>
                  </>
                ) : arena.completed ? (
                  <>
                    <Sparkles size={18} />
                    <strong>{resultTitle(arena.winner)}</strong>
                    <span>{resultSubtitle(arena.winner)}</span>
                  </>
                ) : (
                  <>
                    <CircleDot size={18} />
                    <strong>Your move</strong>
                    <span>Pick any highlighted legal action.</span>
                  </>
                )}
              </div>

              <div className="inspir-game-history">
                <span>Move history</span>
                {arena.moveHistory.length ? (
                  <ol>
                    {arena.moveHistory.slice().reverse().map((move) => (
                      <li key={move.id}>
                        <strong>{move.player === "human" ? "You" : "OpenAI"}</strong>
                        <span>{move.label}</span>
                        {move.note ? <small>{move.note}</small> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No moves yet.</p>
                )}
              </div>
            </aside>
          </div>
          {error ? <span className="inspir-quiz-error">{error}</span> : null}
        </section>
      ) : null}
    </main>
  );
}

function SegmentedControl<TValue extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: TValue; label: string; description?: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="inspir-game-segment">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? "is-selected" : ""}
            onClick={() => onChange(option.value)}
          >
            <strong>{option.label}</strong>
            {option.description ? <small>{option.description}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function SeatCard({
  label,
  side,
  active,
  icon,
}: {
  label: string;
  side: string;
  active: boolean;
  icon?: ReactNode;
}) {
  return (
    <article className={`inspir-game-seat ${active ? "is-active" : ""}`}>
      <span>{icon ?? <CircleDot size={16} />}</span>
      <div>
        <strong>{label}</strong>
        <small>{side}</small>
      </div>
    </article>
  );
}

function TicTacToeBoard({
  arena,
  thinking,
  onMove,
}: {
  arena: PublicGameArenaState;
  thinking: boolean;
  onMove: (action: string) => void;
}) {
  const legalByIndex = legalActionsByNumber(arena.legalActions, "index");
  return (
    <div className="inspir-game-ttt" role="grid" aria-label="Tic-tac-toe board">
      {Array.from({ length: 9 }, (_, index) => {
        const value = arena.board?.[index] ?? "";
        const legal = legalByIndex.get(index);
        return (
          <button
            key={index}
            type="button"
            role="gridcell"
            disabled={!legal || thinking || arena.activePlayer !== "human"}
            onClick={() => legal ? onMove(legal.token) : undefined}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

function ConnectFourBoard({
  arena,
  thinking,
  onMove,
}: {
  arena: PublicGameArenaState;
  thinking: boolean;
  onMove: (action: string) => void;
}) {
  const legalByColumn = legalActionsByNumber(arena.legalActions, "column");
  return (
    <div className="inspir-game-connect" aria-label="Connect Four board">
      {Array.from({ length: 42 }, (_, index) => {
        const column = index % 7;
        const legal = legalByColumn.get(column);
        const value = arena.board?.[index] ?? "";
        return (
          <button
            key={index}
            type="button"
            className={value === "X" ? "is-red" : value === "O" ? "is-yellow" : ""}
            disabled={!legal || thinking || arena.activePlayer !== "human"}
            onClick={() => legal ? onMove(legal.token) : undefined}
            aria-label={`Column ${column + 1}`}
          >
            <span />
          </button>
        );
      })}
    </div>
  );
}

function ChessBoard({
  arena,
  selectedSquare,
  thinking,
  onSelectSquare,
  onMove,
}: {
  arena: PublicGameArenaState;
  selectedSquare: string | null;
  thinking: boolean;
  onSelectSquare: (square: string | null) => void;
  onMove: (action: string) => void;
}) {
  const humanColor = arena.humanSide === "White" ? "w" : "b";
  const orientedRows = useMemo(() => chessCells(arena.chessBoard ?? [], humanColor), [arena.chessBoard, humanColor]);
  const legalByFrom = useMemo(() => groupActionsByFrom(arena.legalActions), [arena.legalActions]);
  const selectedTargets = selectedSquare ? legalByFrom.get(selectedSquare) ?? [] : [];

  return (
    <div className="inspir-game-chess" role="grid" aria-label="Chess board">
      {orientedRows.flatMap((row) =>
        row.map((cell) => {
          const { piece, square } = cell;
          const actionsFromSquare = legalByFrom.get(square) ?? [];
          const selectedAction = selectedTargets.find((action) => action.to === square);
          const selectable = actionsFromSquare.length > 0 && piece?.color === humanColor;
          return (
            <button
              key={square}
              type="button"
              role="gridcell"
              className={[
                selectedSquare === square ? "is-selected" : "",
                selectedAction ? "is-target" : "",
                piece?.color === "w" ? "has-white" : piece?.color === "b" ? "has-black" : "",
              ].filter(Boolean).join(" ")}
              disabled={thinking || arena.activePlayer !== "human"}
              onClick={() => {
                if (selectedAction) {
                  onMove(selectedAction.token);
                  onSelectSquare(null);
                  return;
                }
                onSelectSquare(selectable ? square : null);
              }}
              aria-label={piece ? `${piece.color === "w" ? "White" : "Black"} ${piece.type} on ${square}` : square}
            >
              {piece ? chessGlyph(piece) : null}
            </button>
          );
        }),
      )}
    </div>
  );
}

function legalActionsByNumber(
  actions: PublicGameArenaLegalAction[],
  key: "index" | "column",
) {
  const map = new Map<number, PublicGameArenaLegalAction>();
  for (const action of actions) {
    const value = action[key];
    if (typeof value === "number") map.set(value, action);
  }
  return map;
}

function groupActionsByFrom(actions: PublicGameArenaLegalAction[]) {
  const map = new Map<string, PublicGameArenaLegalAction[]>();
  for (const action of actions) {
    if (!action.from) continue;
    const existing = map.get(action.from) ?? [];
    existing.push(action);
    map.set(action.from, existing);
  }
  return map;
}

function chessCells(board: Array<Array<PublicChessPiece | null>>, humanColor: "w" | "b") {
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const rows = board.map((row, rowIndex) =>
    row.map((piece, columnIndex) => ({
      square: `${files[columnIndex]}${8 - rowIndex}`,
      piece,
    })),
  );
  if (humanColor === "w") return rows;
  return rows.map((row) => row.slice().reverse()).slice().reverse();
}

function chessGlyph(piece: PublicChessPiece) {
  const glyphs: Record<PublicChessPiece["color"], Record<PublicChessPiece["type"], string>> = {
    w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
    b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
  };
  return glyphs[piece.color][piece.type];
}

function resultTitle(winner: PublicGameArenaState["winner"]) {
  if (winner === "human") return "You won";
  if (winner === "model") return "OpenAI won";
  return "Draw";
}

function resultSubtitle(winner: PublicGameArenaState["winner"]) {
  if (winner === "human") return "Nice. Review the move history and try a harder side.";
  if (winner === "model") return "Replay the turning point and try another line.";
  return "Balanced game. Try changing sides or model strength.";
}
