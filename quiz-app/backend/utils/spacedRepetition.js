/**
 * SM-2 Spaced Repetition Algorithm Implementation
 *
 * This implements the SuperMemo SM-2 algorithm for optimal flashcard review scheduling.
 *
 * The algorithm uses:
 * - Quality: 0-5 rating of how well the user recalled the card
 * - Ease Factor: Multiplier that adjusts based on performance
 * - Interval: Days until next review
 * - Repetition Count: Number of times reviewed
 *
 * Quality ratings:
 * 0 - Complete blackout, didn't remember at all
 * 1 - Incorrect response, but recognized the answer when shown
 * 2 - Incorrect response, but it felt familiar
 * 3 - Correct response, but required significant effort
 * 4 - Correct response, with some hesitation
 * 5 - Perfect response, immediate recall
 */

/**
 * Calculate the next review date and updated card statistics
 *
 * @param {number} quality - User's self-assessment (0-5)
 * @param {object} currentState - Current card state
 * @param {number} currentState.easeFactor - Current ease factor (default 2.5)
 * @param {number} currentState.intervalDays - Current interval in days
 * @param {number} currentState.reviewCount - Number of previous reviews
 * @param {number} currentState.masteryLevel - Current mastery level (0-5)
 * @returns {object} Updated card state with new ease factor, interval, and next review date
 */
export function calculateNextReview(quality, currentState = {}) {
  // Validate quality
  if (quality < 0 || quality > 5) {
    throw new Error('Quality must be between 0 and 5');
  }

  // Extract current state with defaults
  let easeFactor = currentState.easeFactor || 2.5;
  let intervalDays = currentState.intervalDays || 0;
  let reviewCount = currentState.reviewCount || 0;
  let masteryLevel = currentState.masteryLevel || 0;

  // Calculate new ease factor based on performance
  // Formula: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  const newEaseFactor = Math.max(
    1.3, // Minimum ease factor
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  let newInterval;
  let newMasteryLevel = masteryLevel;

  // If quality < 3, card needs to be reviewed again soon (failure)
  if (quality < 3) {
    newInterval = 0; // Review again in the same session or next day
    newMasteryLevel = Math.max(0, masteryLevel - 1); // Decrease mastery
  } else {
    // Card was recalled successfully
    if (reviewCount === 0) {
      // First successful review - review in 1 day
      newInterval = 1;
      newMasteryLevel = Math.min(5, 1);
    } else if (reviewCount === 1) {
      // Second successful review - review in 6 days
      newInterval = 6;
      newMasteryLevel = Math.min(5, 2);
    } else {
      // Subsequent reviews - multiply previous interval by ease factor
      newInterval = Math.round(intervalDays * newEaseFactor);

      // Update mastery level based on interval
      if (newInterval >= 30) {
        newMasteryLevel = Math.min(5, 5); // Mastered
      } else if (newInterval >= 14) {
        newMasteryLevel = Math.min(5, 4); // Well-known
      } else if (newInterval >= 7) {
        newMasteryLevel = Math.min(5, 3); // Familiar
      }
    }

    reviewCount++; // Increment review count only on success
  }

  // Calculate next review date
  const now = new Date();
  const nextReviewAt = new Date(now.getTime() + newInterval * 24 * 60 * 60 * 1000);

  return {
    easeFactor: parseFloat(newEaseFactor.toFixed(2)),
    intervalDays: newInterval,
    reviewCount: reviewCount,
    masteryLevel: newMasteryLevel,
    nextReviewAt: nextReviewAt.toISOString(),
    lastReviewedAt: now.toISOString()
  };
}

/**
 * Get cards due for review
 * Returns cards that should be reviewed now based on their next_review_at date
 *
 * @param {Array} progressRecords - Array of progress records from database
 * @param {number} maxCards - Maximum number of cards to return (default 20)
 * @returns {Array} Sorted array of card IDs due for review
 */
export function getDueCards(progressRecords, maxCards = 20) {
  const now = new Date();

  // Filter cards due for review
  const dueCards = progressRecords
    .filter(record => {
      const nextReview = new Date(record.next_review_at);
      return nextReview <= now;
    })
    .sort((a, b) => {
      // Sort by next_review_at (oldest first)
      const dateA = new Date(a.next_review_at);
      const dateB = new Date(b.next_review_at);
      return dateA - dateB;
    })
    .slice(0, maxCards)
    .map(record => record.card_id);

  return dueCards;
}

/**
 * Get new cards (cards not yet studied)
 *
 * @param {Array} allCardIds - All card IDs in the deck
 * @param {Array} progressRecords - Array of progress records
 * @param {number} maxNewCards - Maximum new cards to introduce (default 10)
 * @returns {Array} Array of new card IDs
 */
export function getNewCards(allCardIds, progressRecords, maxNewCards = 10) {
  const studiedCardIds = new Set(progressRecords.map(r => r.card_id));

  const newCards = allCardIds
    .filter(cardId => !studiedCardIds.has(cardId))
    .slice(0, maxNewCards);

  return newCards;
}

/**
 * Calculate mastery statistics for a deck
 *
 * @param {Array} progressRecords - Array of progress records
 * @returns {object} Statistics object
 */
export function calculateMasteryStats(progressRecords) {
  if (progressRecords.length === 0) {
    return {
      total: 0,
      new: 0,
      learning: 0,
      familiar: 0,
      wellKnown: 0,
      mastered: 0,
      averageMastery: 0
    };
  }

  const stats = {
    total: progressRecords.length,
    new: 0,
    learning: 0,
    familiar: 0,
    wellKnown: 0,
    mastered: 0
  };

  let totalMastery = 0;

  progressRecords.forEach(record => {
    totalMastery += record.mastery_level;

    switch (record.mastery_level) {
      case 0:
        stats.new++;
        break;
      case 1:
      case 2:
        stats.learning++;
        break;
      case 3:
        stats.familiar++;
        break;
      case 4:
        stats.wellKnown++;
        break;
      case 5:
        stats.mastered++;
        break;
    }
  });

  stats.averageMastery = parseFloat((totalMastery / progressRecords.length).toFixed(2));

  return stats;
}

/**
 * Convert quality score to rating text
 *
 * @param {number} quality - Quality score (0-5)
 * @returns {string} Rating description
 */
export function qualityToRating(quality) {
  const ratings = {
    0: 'Complete Blackout',
    1: 'Incorrect - But Recognized',
    2: 'Incorrect - Felt Familiar',
    3: 'Correct - Hard',
    4: 'Correct - Good',
    5: 'Correct - Perfect'
  };

  return ratings[quality] || 'Unknown';
}

/**
 * Get recommended study session size based on deck size and progress
 *
 * @param {number} totalCards - Total cards in deck
 * @param {number} newCardsCount - Number of unstudied cards
 * @param {number} dueCardsCount - Number of cards due for review
 * @returns {object} Recommended session configuration
 */
export function getRecommendedSession(totalCards, newCardsCount, dueCardsCount) {
  // Prioritize due cards over new cards
  const maxDueCards = Math.min(20, dueCardsCount);
  const maxNewCards = Math.min(10, Math.max(0, 25 - maxDueCards), newCardsCount);

  return {
    dueCards: maxDueCards,
    newCards: maxNewCards,
    totalSession: maxDueCards + maxNewCards,
    recommendation: maxDueCards > 15
      ? 'You have many cards to review. Focus on reviewing before learning new cards.'
      : maxNewCards > 0
        ? 'Good balance of review and new cards.'
        : dueCardsCount === 0
          ? 'All caught up! Great job!'
          : 'Focus on reviewing your existing cards.'
  };
}

export default {
  calculateNextReview,
  getDueCards,
  getNewCards,
  calculateMasteryStats,
  qualityToRating,
  getRecommendedSession
};
