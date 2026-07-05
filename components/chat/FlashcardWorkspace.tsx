"use client";

import { FormEvent, useEffect, useReducer } from "react";
import { Clipboard, RotateCcw } from "lucide-react";
import {
  type ActivityRun,
  type ActivityRunResponse,
  isFlashcardState,
  mergeActivityState,
  type PublicFlashcardState,
} from "@/components/chat/activity-model";
import { FlashcardBuildLoader } from "@/components/chat/FlashcardBuildLoader";
import { FlashcardReview } from "@/components/chat/FlashcardReview";
import { FlashcardStat } from "@/components/chat/FlashcardStat";

type FlashcardWorkspaceProps = {
  activeChatId?: string;
  activeTopicId: string;
  activityRun: ActivityRun | null;
  createChat: (topicId?: string) => Promise<string>;
  onActivityRun: (run: ActivityRun | null) => void;
  onReset: () => void;
};

export function FlashcardWorkspace({
  activeChatId,
  activeTopicId,
  activityRun,
  createChat,
  onActivityRun,
  onReset,
}: FlashcardWorkspaceProps) {
  const [{ topic, source, loading, buildProgress, reviewing, error, hintCardId }, updateFlashcardState] = useReducer(
    mergeActivityState<{
      topic: string;
      source: string;
      loading: boolean;
      buildProgress: number;
      reviewing: boolean;
      error: string;
      hintCardId: string | null;
    }>,
    { topic: "", source: "", loading: false, buildProgress: 0, reviewing: false, error: "", hintCardId: null },
  );
  const deck = activityRun?.type === "flashcards" && isFlashcardState(activityRun.state) ? activityRun.state : null;
  const currentCard = deck?.cards[deck.currentIndex];
  const missedCards = deck?.cards.filter((card) => card.rating === "again") ?? [];
  const remainingCount = deck ? Math.max(0, deck.maxCards - deck.reviewedCount) : 0;
  const progressPercent = deck ? Math.round((deck.reviewedCount / deck.maxCards) * 100) : 0;
  const hintOpen = Boolean(currentCard && hintCardId === currentCard.id);

  useEffect(() => {
    if (!loading) return;
    const interval = window.setInterval(() => {
      updateFlashcardState((current) => ({
        buildProgress: Math.min(94, current.buildProgress + Math.max(4, Math.round((100 - current.buildProgress) / 6))),
      }));
    }, 520);

    return () => window.clearInterval(interval);
  }, [loading]);

  async function startFlashcards(event?: FormEvent) {
    event?.preventDefault();
    const deckTopic = topic.trim();
    if (!deckTopic || loading) return;
    updateFlashcardState({ error: "", buildProgress: 8, loading: true });
    try {
      const chatId = activeChatId ?? (await createChat(activeTopicId));
      const response = await fetch("/api/activities/flashcards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, topic: deckTopic, source: source.trim() || undefined }),
      });
      if (!response.ok) throw new Error("Could not build flashcards");
      const data = (await response.json()) as ActivityRunResponse;
      updateFlashcardState({ buildProgress: 100 });
      onActivityRun(data.activityRun);
    } catch {
      updateFlashcardState({
        error: "I could not build that deck right now. Try a shorter topic or simpler notes.",
        buildProgress: 0,
      });
    } finally {
      updateFlashcardState({ loading: false });
    }
  }

  async function reviewCard(action: "reveal" | "known" | "again") {
    if (!activityRun || reviewing) return;
    updateFlashcardState({ reviewing: true, error: "" });
    try {
      const response = await fetch(`/api/activities/flashcards/${activityRun.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "reveal" ? { action: "reveal" } : { action: "rate", rating: action },
        ),
      });
      if (!response.ok) throw new Error("Could not review card");
      const data = (await response.json()) as ActivityRunResponse;
      onActivityRun(data.activityRun);
    } catch {
      updateFlashcardState({ error: "I could not save that card review. Please try again." });
    } finally {
      updateFlashcardState({ reviewing: false });
    }
  }

  function changeDeck() {
    onReset();
    updateFlashcardState({ topic: "", source: "", error: "", hintCardId: null, buildProgress: 0 });
  }

  function reviewMissed(deckState: PublicFlashcardState) {
    const missed = deckState.cards.filter((card) => card.rating === "again");
    updateFlashcardState({
      topic: `Weak spots from ${deckState.topic}`,
      source: missed
        .map((card, index) => `${index + 1}. ${card.front}\nAnswer: ${card.back ?? ""}\nTrap: ${card.trap ?? ""}`)
        .join("\n\n"),
      error: "",
      hintCardId: null,
    });
    onActivityRun(null);
  }

  return (
    <main className="inspir-workspace inspir-flashcard-workspace">
      {!deck ? (
        loading ? (
          <FlashcardBuildLoader topic={topic} progress={buildProgress} />
        ) : (
          <form onSubmit={startFlashcards} className="inspir-flashcard-start">
            <div className="inspir-flashcard-start-copy">
              <div className="inspir-flashcard-start-icon">
                <Clipboard size={28} />
              </div>
              <span>Active recall builder</span>
              <h2>Turn material into a deck you actually test yourself on.</h2>
              <p>Give me a topic or paste notes. I will build 12 focused cards with optional hints, traps, and examples.</p>
            </div>
            <div className="inspir-flashcard-start-panel">
              <div className="inspir-flashcard-input-stack">
                <label>
                  <span>Deck topic</span>
                  <input
                    value={topic}
                    onChange={(event) => updateFlashcardState({ topic: event.target.value })}
                    placeholder="Mitosis, climate zones, irregular verbs..."
                    disabled={loading}
                  />
                </label>
                <label>
                  <span>Source notes</span>
                  <textarea
                    value={source}
                    onChange={(event) => updateFlashcardState({ source: event.target.value })}
                    placeholder="Optional: paste notes, syllabus points, or facts to prioritize"
                    disabled={loading}
                    rows={5}
                  />
                </label>
              </div>
              <button type="submit" disabled={loading || !topic.trim()}>
                Build deck
              </button>
              <div className="inspir-flashcard-start-rules" aria-label="Deck rules">
                <span>Recall before reveal</span>
                <span>Hints stay optional</span>
                <span>Misses become a smaller review deck</span>
              </div>
              {error ? <span className="inspir-quiz-error">{error}</span> : null}
            </div>
          </form>
        )
      ) : (
        <section className="inspir-flashcard-shell">
          <header className="inspir-flashcard-header">
            <div>
              <span>Flashcards on</span>
              <h2>{deck.topic}</h2>
            </div>
            <button type="button" onClick={changeDeck}>
              <RotateCcw size={16} />
              <span>Change deck</span>
            </button>
          </header>
          <div className="inspir-quiz-progress">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="inspir-flashcard-stats" aria-label="Deck progress">
            <FlashcardStat label="Known" value={`${deck.knownCount}/${deck.maxCards}`} />
            <FlashcardStat label="Again" value={String(missedCards.length)} />
            <FlashcardStat label="Left" value={String(remainingCount)} />
          </div>

          {deck.completed ? (
            <FlashcardReview deck={deck} onReviewMissed={reviewMissed} onStartOver={changeDeck} />
          ) : currentCard ? (
            <article className={`inspir-flashcard-card ${currentCard.back ? "is-revealed" : ""}`}>
              <div className="inspir-flashcard-card-top">
                <span>
                  Card {deck.currentIndex + 1} of {deck.maxCards}
                </span>
                <div>
                  {(currentCard.tags ?? []).map((tag) => (
                    <small key={tag}>{tag}</small>
                  ))}
                </div>
              </div>
              <h3>{currentCard.front}</h3>
              {currentCard.hint && hintOpen && !currentCard.back ? (
                <p className="inspir-flashcard-hint">
                  <strong>Hint</strong>
                  {currentCard.hint}
                </p>
              ) : null}

              {currentCard.back ? (
                <div className="inspir-flashcard-answer">
                  <strong>Answer</strong>
                  <p>{currentCard.back}</p>
                  {currentCard.example ? <span>Example: {currentCard.example}</span> : null}
                  {currentCard.trap ? <span>Watch out: {currentCard.trap}</span> : null}
                </div>
              ) : null}

              <div className="inspir-flashcard-actions">
                {!currentCard.back ? (
                  <>
                    {currentCard.hint ? (
                      <button
                        type="button"
                        disabled={reviewing}
                        onClick={() => updateFlashcardState({ hintCardId: hintOpen ? null : currentCard.id })}
                      >
                        {hintOpen ? "Hide hint" : "Need a hint"}
                      </button>
                    ) : null}
                    <button type="button" disabled={reviewing} onClick={() => void reviewCard("reveal")}>
                      Show answer
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={reviewing} onClick={() => void reviewCard("again")}>
                      Review again
                    </button>
                    <button type="button" disabled={reviewing} onClick={() => void reviewCard("known")}>
                      I knew it
                    </button>
                  </>
                )}
              </div>
            </article>
          ) : null}
          {error ? <span className="inspir-quiz-error">{error}</span> : null}
        </section>
      )}
    </main>
  );
}
