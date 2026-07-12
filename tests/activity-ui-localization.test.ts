import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  formatMainAppActivity,
  interpolateMainAppActivityTemplate,
  mainAppActivityNewSourceStrings,
  mainAppActivitySourceStrings,
} from "../lib/i18n/main-app-activity-copy";
import { getMainAppSourceStrings } from "../lib/i18n/main-app-source";

const activityComponentPaths = [
  "components/chat/QuizWorkspace.tsx",
  "components/chat/QuizFeedback.tsx",
  "components/chat/QuizReview.tsx",
  "components/chat/QuizBuildLoader.tsx",
  "components/chat/FlashcardWorkspace.tsx",
  "components/chat/FlashcardReview.tsx",
  "components/chat/FlashcardBuildLoader.tsx",
] as const;

test("quiz and flashcard UI copy is registered under typed main-app source keys", () => {
  const mainAppSource = getMainAppSourceStrings();
  const entries = Object.entries(mainAppActivitySourceStrings);
  assert.ok(entries.length >= 70);
  for (const [key, source] of entries) {
    const registeredSources = Object.values(mainAppSource).filter((value) => value === source);
    assert.ok(registeredSources.length > 0, key);
  }
  assert.equal(Object.keys(mainAppActivityNewSourceStrings).length, 29);
  for (const [key, source] of Object.entries(mainAppActivityNewSourceStrings)) {
    assert.equal(mainAppSource[key], source, key);
  }

  assert.equal(mainAppSource["activity.quiz.progress"], "Question {current} of {total}");
  assert.equal(
    mainAppSource["activity.flashcards.review.complete"],
    "Deck complete: {known}/{total} known",
  );
  assert.equal(
    mainAppSource["activity.flashcards.review.missed.one"],
    "{count} card to review again.",
  );
  assert.equal(
    mainAppSource["activity.flashcards.review.missed.other"],
    "{count} cards to review again.",
  );
});

test("activity templates interpolate after translation and preserve unresolved placeholders", () => {
  const reorderedQuestion = formatMainAppActivity(
    (source) =>
      source === "Question {current} of {total}"
        ? "Total {total}; current {current}"
        : source,
    "activity.quiz.progress",
    { current: 3, total: 10 },
  );
  assert.equal(reorderedQuestion, "Total 10; current 3");

  const one = formatMainAppActivity(
    (source) => source,
    "activity.flashcards.review.missed.one",
    { count: 1 },
  );
  const many = formatMainAppActivity(
    (source) => source,
    "activity.flashcards.review.missed.other",
    { count: 4 },
  );
  assert.equal(one, "1 card to review again.");
  assert.equal(many, "4 cards to review again.");

  assert.equal(
    interpolateMainAppActivityTemplate(
      "{known}/{total} · {curatorMustTranslate}",
      { known: "$&1", total: 12 },
    ),
    "$&1/12 · {curatorMustTranslate}",
  );
});

test("activity result components render through the lookup instead of hardcoded or DOM-walked copy", () => {
  const componentSources = activityComponentPaths.map((file) => ({
    file,
    source: fs.readFileSync(path.resolve(file), "utf8"),
  }));

  for (const [key, sourceText] of Object.entries(mainAppActivitySourceStrings)) {
    for (const component of componentSources) {
      assert.equal(
        component.source.includes(JSON.stringify(sourceText)),
        false,
        `${component.file} hardcodes ${key}`,
      );
    }
  }

  const quiz = componentSources.find((entry) => entry.file.endsWith("QuizWorkspace.tsx"))?.source ?? "";
  const flashcards =
    componentSources.find((entry) => entry.file.endsWith("FlashcardWorkspace.tsx"))?.source ?? "";
  for (const source of [quiz, flashcards]) {
    assert.match(source, /data-no-auto-translate/);
    assert.match(source, /translateMainAppActivity/);
    assert.match(source, /formatMainAppActivity/);
  }

  const chatClient = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");
  assert.match(chatClient, /<QuizWorkspace[\s\S]{0,400}t=\{translateUi\}/);
  assert.match(chatClient, /<FlashcardWorkspace[\s\S]{0,500}t=\{translateUi\}/);
});
