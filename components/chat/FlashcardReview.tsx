import type { UiTranslator } from "@/components/chat/chat-ui-types";
import {
  formatMainAppActivity,
  translateMainAppActivity,
} from "@/lib/i18n/main-app-activity-copy";

type FlashcardReviewCard = {
  id: string;
  front: string;
  back?: string;
  trap?: string;
  rating?: "known" | "again";
};

type FlashcardReviewDeck = {
  topic: string;
  source?: string;
  currentIndex: number;
  knownCount: number;
  reviewedCount: number;
  maxCards: 12;
  completed: boolean;
  cards: FlashcardReviewCard[];
};

export function FlashcardReview({
  deck,
  onReviewMissed,
  onStartOver,
  t,
}: {
  deck: FlashcardReviewDeck;
  onReviewMissed: (deck: FlashcardReviewDeck) => void;
  onStartOver: () => void;
  t: UiTranslator;
}) {
  const missed = deck.cards.filter((card) => card.rating === "again");
  return (
    <article className="inspir-flashcard-review">
      <h3>
        {formatMainAppActivity(t, "activity.flashcards.review.complete", {
          known: deck.knownCount,
          total: deck.maxCards,
        })}
      </h3>
      <p>
        {missed.length
          ? `${formatMainAppActivity(
              t,
              missed.length === 1
                ? "activity.flashcards.review.missed.one"
                : "activity.flashcards.review.missed.other",
              { count: missed.length },
            )} ${translateMainAppActivity(t, "activity.flashcards.review.missedBody")}`
          : translateMainAppActivity(t, "activity.flashcards.review.cleanBody")}
      </p>
      <div className="inspir-flashcard-review-actions">
        {missed.length ? (
          <button type="button" onClick={() => onReviewMissed(deck)}>
            {translateMainAppActivity(t, "activity.flashcards.review.missedAction")}
          </button>
        ) : null}
        <button type="button" onClick={onStartOver}>
          {translateMainAppActivity(t, "activity.flashcards.review.anotherAction")}
        </button>
      </div>
      <div className="inspir-review-list">
        {deck.cards.map((card, index) => (
          <div key={card.id} className={card.rating === "known" ? "is-correct" : "is-wrong"}>
            <strong>
              {index + 1}. {card.front}
            </strong>
            <span>{card.back}</span>
            {card.trap ? (
              <p>
                {formatMainAppActivity(t, "activity.flashcards.review.trap", {
                  trap: card.trap,
                })}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}
