import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicSystemPrompt } from "../lib/ai/prompts";
import { defaultLanguage } from "../lib/content/languages";
import { topicSeeds } from "../lib/content/topics";
import { getEnglishMainAppTranslationBundle, getMainAppSourceHash } from "../lib/i18n/main-app-source";
import { isFreshAppTranslation, validateTranslationPayload } from "../lib/i18n/translation-validation";
import { calculateAge, validateDateOfBirth } from "../lib/profile/age";
import { updateProfileSchema } from "../lib/profile/validation";

test("calculateAge handles birthday boundaries", () => {
  const today = new Date(Date.UTC(2026, 4, 29));

  assert.equal(calculateAge("2010-05-29", today), 16);
  assert.equal(calculateAge("2010-05-30", today), 15);
  assert.equal(calculateAge("2010-05-28", today), 16);
  assert.equal(calculateAge("not-a-date", today), null);
});

test("date of birth validation rejects invalid and future dates", () => {
  const today = new Date(Date.UTC(2026, 4, 29));

  assert.equal(validateDateOfBirth("2026-05-29", today).success, true);
  assert.equal(validateDateOfBirth("2026-05-30", today).success, false);
  assert.equal(validateDateOfBirth("2026-02-31", today).success, false);
  assert.equal(updateProfileSchema.safeParse({ dateOfBirth: "2999-01-01" }).success, false);
});

test("prompt assembly includes age context only when known", () => {
  const seed = topicSeeds.find((topic) => topic.slug === "learn-anything");
  assert.ok(seed);

  const withAge = buildTopicSystemPrompt(seed, defaultLanguage, { learnerAge: 12 });
  assert.ok(withAge.includes("The learner is 12 years old."));
  assert.ok(withAge.includes("Do not mention their age unless directly relevant or asked."));

  const withoutAge = buildTopicSystemPrompt(seed, defaultLanguage);
  assert.equal(withoutAge.includes("The learner is"), false);
});

test("main app translation source has stable keys and validates placeholders", () => {
  const bundle = getEnglishMainAppTranslationBundle();
  const sourceHash = getMainAppSourceHash(bundle.sourceStrings);

  assert.equal(bundle.sourceHash, sourceHash);
  assert.equal(bundle.strings["onboarding.age.submit"], "Continue");
  assert.ok(Object.keys(bundle.sourceStrings).some((key) => key.startsWith("topic.learn-anything.")));
  assert.equal(validateTranslationPayload(bundle.sourceStrings, bundle.strings), true);
  assert.equal(isFreshAppTranslation({ sourceHash }, sourceHash), true);
  assert.equal(isFreshAppTranslation({ sourceHash: "old" }, sourceHash), false);

  const broken: Record<string, string> = { ...bundle.strings, "onboarding.age.body": "Missing" };
  broken["onboarding.age.title"] = "";
  assert.equal(validateTranslationPayload(bundle.sourceStrings, broken), false);
});
