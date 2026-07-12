"use client";

import { type FormEvent, useEffect, useReducer, useRef } from "react";
import { Clipboard, RotateCcw } from "lucide-react";
import {
  type ActivityRun,
  type ActivityRunResponse,
  isFlashcardState,
  mergeActivityState,
  type PublicFlashcardState,
} from "@/components/chat/activity-model";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import { FlashcardBuildLoader } from "@/components/chat/FlashcardBuildLoader";
import { FlashcardReview } from "@/components/chat/FlashcardReview";
import { FlashcardStat } from "@/components/chat/FlashcardStat";
import {
  formatMainAppActivity,
  translateMainAppActivity,
} from "@/lib/i18n/main-app-activity-copy";

type FlashcardWorkspaceProps = {
  activeChatId?: string;
  activeTopicId: string;
  activityRun: ActivityRun | null;
  createChat: (topicId?: string) => Promise<string>;
  onActivityRun: (run: ActivityRun | null) => void;
  onReset: () => void;
  t: UiTranslator;
};

type FlashcardWorkspaceState = {
  topic: string;
  source: string;
  loading: boolean;
  buildProgress: number;
  reviewing: boolean;
  error: string;
  hintCardId: string | null;
};

type FlashcardReviewAction = "reveal" | "known" | "again";

export function FlashcardWorkspace({
  activeChatId,
  activeTopicId,
  activityRun,
  createChat,
  onActivityRun,
  onReset,
  t,
}: FlashcardWorkspaceProps) {
  const [{ topic, source, loading, buildProgress, reviewing, error, hintCardId }, updateFlashcardState] = useReducer(
    mergeActivityState<FlashcardWorkspaceState>,
    { topic: "", source: "", loading: false, buildProgress: 0, reviewing: false, error: "", hintCardId: null },
  );
  const pendingBuildRequest = useRef<{ signature: string; requestId: string } | null>(null);
  const deck = activityRun?.type === "flashcards" && isFlashcardState(activityRun.state) ? activityRun.state : null;

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
      const normalizedSource = source.trim();
      const signature = `${chatId}\n${deckTopic}\n${normalizedSource}`;
      const buildRequest = pendingBuildRequest.current?.signature === signature
        ? pendingBuildRequest.current
        : { signature, requestId: crypto.randomUUID() };
      pendingBuildRequest.current = buildRequest;
      const response = await fetch("/api/activities/flashcards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chatId,
          topic: deckTopic,
          source: normalizedSource || undefined,
          requestId: buildRequest.requestId,
        }),
      });
      if (!response.ok) throw new Error("Could not build flashcards");
      const data = (await response.json()) as ActivityRunResponse;
      pendingBuildRequest.current = null;
      updateFlashcardState({ buildProgress: 100 });
      onActivityRun(data.activityRun);
    } catch {
      updateFlashcardState({
        error: translateMainAppActivity(t, "activity.flashcards.error.build"),
        buildProgress: 0,
      });
    } finally {
      updateFlashcardState({ loading: false });
    }
  }

  async function reviewCard(action: FlashcardReviewAction) {
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
      updateFlashcardState({
        error: translateMainAppActivity(t, "activity.flashcards.error.review"),
      });
    } finally {
      updateFlashcardState({ reviewing: false });
    }
  }

  function changeDeck() {
    onReset();
    updateFlashcardState({ topic: "", source: "", error: "", hintCardId: null, buildProgress: 0 });
  }

  function reviewMissed(deckState: PublicFlashcardState) {
    updateFlashcardState({
      topic: formatMainAppActivity(t, "activity.flashcards.weakSpots", {
        topic: deckState.topic,
      }),
      source: buildMissedReviewSource(deckState, t),
      error: "",
      hintCardId: null,
    });
    onActivityRun(null);
  }

  return (
    <main className="inspir-workspace inspir-flashcard-workspace" data-no-auto-translate>
      {!deck ? (
        <FlashcardStart
          topic={topic}
          source={source}
          loading={loading}
          buildProgress={buildProgress}
          error={error}
          t={t}
          onTopicChange={(nextTopic) => updateFlashcardState({ topic: nextTopic })}
          onSourceChange={(nextSource) => updateFlashcardState({ source: nextSource })}
          onSubmit={startFlashcards}
        />
      ) : (
        <FlashcardDeck
          deck={deck}
          reviewing={reviewing}
          error={error}
          hintCardId={hintCardId}
          t={t}
          onChangeDeck={changeDeck}
          onReviewMissed={reviewMissed}
          onReviewCard={reviewCard}
          onToggleHint={(nextHintCardId) => updateFlashcardState({ hintCardId: nextHintCardId })}
        />
      )}
    </main>
  );
}

type FlashcardStartProps = {
  topic: string;
  source: string;
  loading: boolean;
  buildProgress: number;
  error: string;
  t: UiTranslator;
  onTopicChange: (topic: string) => void;
  onSourceChange: (source: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function FlashcardStart({
  topic,
  source,
  loading,
  buildProgress,
  error,
  t,
  onTopicChange,
  onSourceChange,
  onSubmit,
}: FlashcardStartProps) {
  if (loading) return <FlashcardBuildLoader topic={topic} progress={buildProgress} t={t} />;

  return (
    <form onSubmit={onSubmit} className="inspir-flashcard-start">
      <div className="inspir-flashcard-start-copy">
        <div className="inspir-flashcard-start-icon">
          <Clipboard size={28} />
        </div>
        <span>{translateMainAppActivity(t, "activity.flashcards.start.kicker")}</span>
        <h2>{translateMainAppActivity(t, "activity.flashcards.start.title")}</h2>
        <p>{translateMainAppActivity(t, "activity.flashcards.start.body")}</p>
      </div>
      <div className="inspir-flashcard-start-panel">
        <div className="inspir-flashcard-input-stack">
          <label>
            <span>{translateMainAppActivity(t, "activity.flashcards.start.topicLabel")}</span>
            <input
              value={topic}
              onChange={(event) => onTopicChange(event.target.value)}
              placeholder={translateMainAppActivity(
                t,
                "activity.flashcards.start.topicPlaceholder",
              )}
              disabled={loading}
            />
          </label>
          <label>
            <span>{translateMainAppActivity(t, "activity.flashcards.start.sourceLabel")}</span>
            <textarea
              value={source}
              onChange={(event) => onSourceChange(event.target.value)}
              placeholder={translateMainAppActivity(
                t,
                "activity.flashcards.start.sourcePlaceholder",
              )}
              disabled={loading}
              rows={5}
            />
          </label>
        </div>
        <button type="submit" disabled={loading || !topic.trim()}>
          {translateMainAppActivity(t, "activity.flashcards.start.action")}
        </button>
        <div
          className="inspir-flashcard-start-rules"
          aria-label={translateMainAppActivity(t, "activity.flashcards.start.rulesLabel")}
        >
          <span>{translateMainAppActivity(t, "activity.flashcards.start.ruleRecall")}</span>
          <span>{translateMainAppActivity(t, "activity.flashcards.start.ruleHints")}</span>
          <span>{translateMainAppActivity(t, "activity.flashcards.start.ruleMisses")}</span>
        </div>
        {error ? <span className="inspir-quiz-error">{error}</span> : null}
      </div>
    </form>
  );
}

type FlashcardDeckProps = {
  deck: PublicFlashcardState;
  reviewing: boolean;
  error: string;
  hintCardId: string | null;
  t: UiTranslator;
  onChangeDeck: () => void;
  onReviewMissed: (deck: PublicFlashcardState) => void;
  onReviewCard: (action: FlashcardReviewAction) => Promise<void>;
  onToggleHint: (cardId: string | null) => void;
};

function FlashcardDeck({
  deck,
  reviewing,
  error,
  hintCardId,
  t,
  onChangeDeck,
  onReviewMissed,
  onReviewCard,
  onToggleHint,
}: FlashcardDeckProps) {
  const currentCard = deck.cards[deck.currentIndex];
  const missedCards = deck.cards.filter((card) => card.rating === "again");
  const remainingCount = Math.max(0, deck.maxCards - deck.reviewedCount);
  const progressPercent = Math.round((deck.reviewedCount / deck.maxCards) * 100);
  const hintOpen = Boolean(currentCard && hintCardId === currentCard.id);

  return (
    <section className="inspir-flashcard-shell">
      <header className="inspir-flashcard-header">
        <div>
          <span>{translateMainAppActivity(t, "activity.flashcards.header")}</span>
          <h2>{deck.topic}</h2>
        </div>
        <button type="button" onClick={onChangeDeck}>
          <RotateCcw size={16} />
          <span>{translateMainAppActivity(t, "activity.flashcards.changeDeck")}</span>
        </button>
      </header>
      <div className="inspir-quiz-progress">
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <div
        className="inspir-flashcard-stats"
        aria-label={translateMainAppActivity(t, "activity.flashcards.progressLabel")}
      >
        <FlashcardStat
          label={translateMainAppActivity(t, "activity.flashcards.stat.known")}
          value={`${deck.knownCount}/${deck.maxCards}`}
        />
        <FlashcardStat
          label={translateMainAppActivity(t, "activity.flashcards.stat.again")}
          value={String(missedCards.length)}
        />
        <FlashcardStat
          label={translateMainAppActivity(t, "activity.flashcards.stat.left")}
          value={String(remainingCount)}
        />
      </div>

      {deck.completed ? (
        <FlashcardReview
          deck={deck}
          onReviewMissed={onReviewMissed}
          onStartOver={onChangeDeck}
          t={t}
        />
      ) : currentCard ? (
        <article className={`inspir-flashcard-card ${currentCard.back ? "is-revealed" : ""}`}>
          <div className="inspir-flashcard-card-top">
            <span>
              {formatMainAppActivity(t, "activity.flashcards.progress", {
                current: deck.currentIndex + 1,
                total: deck.maxCards,
              })}
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
              <strong>{translateMainAppActivity(t, "activity.flashcards.hint")}</strong>
              {currentCard.hint}
            </p>
          ) : null}

          {currentCard.back ? (
            <div className="inspir-flashcard-answer">
              <strong>{translateMainAppActivity(t, "activity.flashcards.answer")}</strong>
              <p>{currentCard.back}</p>
              {currentCard.example ? (
                <span>
                  {formatMainAppActivity(t, "activity.flashcards.example", {
                    example: currentCard.example,
                  })}
                </span>
              ) : null}
              {currentCard.trap ? (
                <span>
                  {formatMainAppActivity(t, "activity.flashcards.watchOut", {
                    trap: currentCard.trap,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="inspir-flashcard-actions">
            {!currentCard.back ? (
              <>
                {currentCard.hint ? (
                  <button
                    type="button"
                    disabled={reviewing}
                    onClick={() => onToggleHint(hintOpen ? null : currentCard.id)}
                  >
                    {translateMainAppActivity(
                      t,
                      hintOpen
                        ? "activity.flashcards.hideHint"
                        : "activity.flashcards.needHint",
                    )}
                  </button>
                ) : null}
                <button type="button" disabled={reviewing} onClick={() => void onReviewCard("reveal")}>
                  {translateMainAppActivity(t, "activity.flashcards.showAnswer")}
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={reviewing} onClick={() => void onReviewCard("again")}>
                  {translateMainAppActivity(t, "activity.flashcards.reviewAgain")}
                </button>
                <button type="button" disabled={reviewing} onClick={() => void onReviewCard("known")}>
                  {translateMainAppActivity(t, "activity.flashcards.knewIt")}
                </button>
              </>
            )}
          </div>
        </article>
      ) : null}
      {error ? <span className="inspir-quiz-error">{error}</span> : null}
    </section>
  );
}

function buildMissedReviewSource(deck: PublicFlashcardState, t: UiTranslator) {
  const items: string[] = [];
  for (const card of deck.cards) {
    if (card.rating !== "again") continue;
    items.push(
      formatMainAppActivity(t, "activity.flashcards.review.sourceItem", {
        number: items.length + 1,
        front: card.front,
        answer: card.back ?? "",
        trap: card.trap ?? "",
      }),
    );
  }
  return items.join("\n\n");
}
