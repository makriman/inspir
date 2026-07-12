export const mainAppActivitySourceStrings = {
  "activity.quiz.error.build":
    "I could not build that quiz right now. Try a simpler topic or try again.",
  "activity.quiz.error.score": "I could not score that answer. Please try again.",
  "activity.quiz.start.title": "What would you like to be quizzed on today?",
  "activity.quiz.start.body":
    "Pick any topic. I will build 10 multiple-choice questions and score you as you go.",
  "activity.quiz.start.topicLabel": "Quiz topic",
  "activity.quiz.start.topicPlaceholder": "Space exploration, Indian history, algebra...",
  "activity.quiz.start.action": "Start",
  "activity.quiz.header": "Quiz on",
  "activity.quiz.progress": "Question {current} of {total}",
  "activity.quiz.feedback.correct": "Correct",
  "activity.quiz.feedback.incorrect": "Not quite",
  "activity.quiz.review.score": "Final score: {score}/{total}",
  "activity.quiz.review.strong": "Strong work.",
  "activity.quiz.review.base": "Good base. Review the misses below.",
  "activity.quiz.review.rebuild":
    "You have a starting map now. Let us rebuild the weak spots.",
  "activity.quiz.review.userAnswer": "Your answer: {answer}",
  "activity.quiz.review.correctAnswer": "Correct answer: {answer}",
  "activity.quiz.review.notAnswered": "Not answered",
  "activity.quiz.loader.title": "Building your quiz",
  "activity.quiz.loader.topicFallback": "Your topic",
  "activity.quiz.loader.scan": "Scanning the topic",
  "activity.quiz.loader.balance": "Balancing difficulty",
  "activity.quiz.loader.options": "Writing clear options",
  "activity.quiz.loader.answers": "Hiding the answers",
  "activity.quiz.loader.explanations": "Preparing explanations",
  "activity.quiz.loader.shuffle": "Shuffling the challenge",
  "activity.flashcards.error.build":
    "I could not build that deck right now. Try a shorter topic or simpler notes.",
  "activity.flashcards.error.review": "I could not save that card review. Please try again.",
  "activity.flashcards.weakSpots": "Weak spots from {topic}",
  "activity.flashcards.start.kicker": "Active recall builder",
  "activity.flashcards.start.title": "Turn material into a deck you actually test yourself on.",
  "activity.flashcards.start.body":
    "Give me a topic or paste notes. I will build 12 focused cards with optional hints, traps, and examples.",
  "activity.flashcards.start.topicLabel": "Deck topic",
  "activity.flashcards.start.topicPlaceholder": "Mitosis, climate zones, irregular verbs...",
  "activity.flashcards.start.sourceLabel": "Source notes",
  "activity.flashcards.start.sourcePlaceholder":
    "Optional: paste notes, syllabus points, or facts to prioritize",
  "activity.flashcards.start.action": "Build deck",
  "activity.flashcards.start.rulesLabel": "Deck rules",
  "activity.flashcards.start.ruleRecall": "Recall before reveal",
  "activity.flashcards.start.ruleHints": "Hints stay optional",
  "activity.flashcards.start.ruleMisses": "Misses become a smaller review deck",
  "activity.flashcards.header": "Flashcards on",
  "activity.flashcards.changeDeck": "Change deck",
  "activity.flashcards.progressLabel": "Deck progress",
  "activity.flashcards.stat.known": "Known",
  "activity.flashcards.stat.again": "Again",
  "activity.flashcards.stat.left": "Left",
  "activity.flashcards.progress": "Card {current} of {total}",
  "activity.flashcards.hint": "Hint",
  "activity.flashcards.answer": "Answer",
  "activity.flashcards.example": "Example: {example}",
  "activity.flashcards.watchOut": "Watch out: {trap}",
  "activity.flashcards.hideHint": "Hide hint",
  "activity.flashcards.needHint": "Need a hint",
  "activity.flashcards.showAnswer": "Show answer",
  "activity.flashcards.reviewAgain": "Review again",
  "activity.flashcards.knewIt": "I knew it",
  "activity.flashcards.review.complete": "Deck complete: {known}/{total} known",
  "activity.flashcards.review.missed.one": "{count} card to review again.",
  "activity.flashcards.review.missed.other": "{count} cards to review again.",
  "activity.flashcards.review.missedBody":
    "Review the cards marked again, then rebuild a smaller deck from those weak spots.",
  "activity.flashcards.review.cleanBody":
    "Clean sweep. Come back later and test the same deck from memory.",
  "activity.flashcards.review.missedAction": "Review missed cards",
  "activity.flashcards.review.anotherAction": "Build another deck",
  "activity.flashcards.review.trap": "Trap: {trap}",
  "activity.flashcards.review.sourceItem":
    "{number}. {front}\nAnswer: {answer}\nTrap: {trap}",
  "activity.flashcards.loader.title": "Building your deck",
  "activity.flashcards.loader.topicFallback": "Your topic",
  "activity.flashcards.loader.atomic": "Finding atomic ideas",
  "activity.flashcards.loader.prompts": "Writing recall prompts",
  "activity.flashcards.loader.hints": "Adding memory hints",
  "activity.flashcards.loader.traps": "Checking common traps",
  "activity.flashcards.loader.stack": "Stacking the deck",
  "activity.flashcards.loader.ready": "Ready for review",
} as const;

export type MainAppActivitySourceKey = keyof typeof mainAppActivitySourceStrings;

// These are the only additions to the curated main-app source contract. Every
// other activity literal above already has a source-current component key and
// therefore reuses its existing audited translation instead of creating a
// duplicate 69-language field.
export const mainAppActivityNewSourceStrings = {
  "activity.quiz.start.topicLabel": mainAppActivitySourceStrings["activity.quiz.start.topicLabel"],
  "activity.quiz.start.action": mainAppActivitySourceStrings["activity.quiz.start.action"],
  "activity.quiz.progress": mainAppActivitySourceStrings["activity.quiz.progress"],
  "activity.quiz.feedback.correct": mainAppActivitySourceStrings["activity.quiz.feedback.correct"],
  "activity.quiz.review.score": mainAppActivitySourceStrings["activity.quiz.review.score"],
  "activity.quiz.review.userAnswer": mainAppActivitySourceStrings["activity.quiz.review.userAnswer"],
  "activity.quiz.review.correctAnswer":
    mainAppActivitySourceStrings["activity.quiz.review.correctAnswer"],
  "activity.flashcards.weakSpots": mainAppActivitySourceStrings["activity.flashcards.weakSpots"],
  "activity.flashcards.start.action":
    mainAppActivitySourceStrings["activity.flashcards.start.action"],
  "activity.flashcards.stat.known": mainAppActivitySourceStrings["activity.flashcards.stat.known"],
  "activity.flashcards.stat.again": mainAppActivitySourceStrings["activity.flashcards.stat.again"],
  "activity.flashcards.stat.left": mainAppActivitySourceStrings["activity.flashcards.stat.left"],
  "activity.flashcards.progress": mainAppActivitySourceStrings["activity.flashcards.progress"],
  "activity.flashcards.hint": mainAppActivitySourceStrings["activity.flashcards.hint"],
  "activity.flashcards.answer": mainAppActivitySourceStrings["activity.flashcards.answer"],
  "activity.flashcards.example": mainAppActivitySourceStrings["activity.flashcards.example"],
  "activity.flashcards.watchOut": mainAppActivitySourceStrings["activity.flashcards.watchOut"],
  "activity.flashcards.showAnswer": mainAppActivitySourceStrings["activity.flashcards.showAnswer"],
  "activity.flashcards.reviewAgain":
    mainAppActivitySourceStrings["activity.flashcards.reviewAgain"],
  "activity.flashcards.knewIt": mainAppActivitySourceStrings["activity.flashcards.knewIt"],
  "activity.flashcards.review.complete":
    mainAppActivitySourceStrings["activity.flashcards.review.complete"],
  "activity.flashcards.review.missed.one":
    mainAppActivitySourceStrings["activity.flashcards.review.missed.one"],
  "activity.flashcards.review.missed.other":
    mainAppActivitySourceStrings["activity.flashcards.review.missed.other"],
  "activity.flashcards.review.missedBody":
    mainAppActivitySourceStrings["activity.flashcards.review.missedBody"],
  "activity.flashcards.review.cleanBody":
    mainAppActivitySourceStrings["activity.flashcards.review.cleanBody"],
  "activity.flashcards.review.missedAction":
    mainAppActivitySourceStrings["activity.flashcards.review.missedAction"],
  "activity.flashcards.review.anotherAction":
    mainAppActivitySourceStrings["activity.flashcards.review.anotherAction"],
  "activity.flashcards.review.trap":
    mainAppActivitySourceStrings["activity.flashcards.review.trap"],
  "activity.flashcards.review.sourceItem":
    mainAppActivitySourceStrings["activity.flashcards.review.sourceItem"],
} as const satisfies Partial<Record<MainAppActivitySourceKey, string>>;

type PlaceholderNames<Template extends string> =
  Template extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never;

export type MainAppActivityTemplateValues<Key extends MainAppActivitySourceKey> = Readonly<{
  [Name in PlaceholderNames<(typeof mainAppActivitySourceStrings)[Key]>]: string | number;
}>;

type ActivityTranslator = (source: string) => string;

export function translateMainAppActivity(
  translate: ActivityTranslator,
  key: MainAppActivitySourceKey,
) {
  return translate(mainAppActivitySourceStrings[key]);
}

export function formatMainAppActivity<Key extends MainAppActivitySourceKey>(
  translate: ActivityTranslator,
  key: Key,
  values: MainAppActivityTemplateValues<Key>,
) {
  return interpolateMainAppActivityTemplate(
    translate(mainAppActivitySourceStrings[key]),
    values,
  );
}

export function interpolateMainAppActivityTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}
