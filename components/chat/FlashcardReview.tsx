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
}: {
  deck: FlashcardReviewDeck;
  onReviewMissed: (deck: FlashcardReviewDeck) => void;
  onStartOver: () => void;
}) {
  const missed = deck.cards.filter((card) => card.rating === "again");
  return (
    <article className="inspir-flashcard-review">
      <h3>Deck complete: {deck.knownCount}/12 known</h3>
      <p>
        {missed.length
          ? "Review the cards marked again, then rebuild a smaller deck from those weak spots."
          : "Clean sweep. Come back later and test the same deck from memory."}
      </p>
      <div className="inspir-flashcard-review-actions">
        {missed.length ? (
          <button type="button" onClick={() => onReviewMissed(deck)}>
            Review missed cards
          </button>
        ) : null}
        <button type="button" onClick={onStartOver}>
          Build another deck
        </button>
      </div>
      <div className="inspir-review-list">
        {deck.cards.map((card, index) => (
          <div key={card.id} className={card.rating === "known" ? "is-correct" : "is-wrong"}>
            <strong>
              {index + 1}. {card.front}
            </strong>
            <span>{card.back}</span>
            {card.trap ? <p>Trap: {card.trap}</p> : null}
          </div>
        ))}
      </div>
    </article>
  );
}
