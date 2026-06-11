import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as memoryCronGet } from "../app/api/cron/memory-dreaming/route";
import { generateQuiz } from "../lib/activities/quiz";
import { topicFromSeed } from "../lib/content/seeded-topics";
import { topicSeeds } from "../lib/content/topics";
import { toPublicTopic } from "../lib/db/queries";
import {
  dailyLimitReset,
  numberFromEnv,
  safeQuotaKeyPart,
  utcDayKey,
} from "../lib/utils/rate-limit";

test("public topic serialization excludes private prompt and legacy fields", () => {
  const seed = topicSeeds[0];
  assert.ok(seed);
  const publicTopic = toPublicTopic({
    ...topicFromSeed(seed),
    metadata: {
      ...seed.metadata,
      systemPrompt: "do not ship",
      unsafeInternalNote: "do not ship",
    },
  });

  assert.equal("systemPrompt" in publicTopic, false);
  assert.equal("legacyBubbleId" in publicTopic, false);
  assert.equal("createdAt" in publicTopic, false);
  assert.equal("updatedAt" in publicTopic, false);
  assert.equal((publicTopic.metadata as Record<string, unknown>).systemPrompt, undefined);
  assert.equal((publicTopic.metadata as Record<string, unknown>).unsafeInternalNote, undefined);
  assert.equal(typeof (publicTopic.metadata as Record<string, unknown>).uiMode, "string");
});

test("quota utility defaults and key normalization are stable", () => {
  const previous = process.env.TEST_LIMIT_VALUE;
  process.env.TEST_LIMIT_VALUE = "1000.9";
  assert.equal(numberFromEnv("TEST_LIMIT_VALUE", 5), 1000);
  process.env.TEST_LIMIT_VALUE = "not-a-number";
  assert.equal(numberFromEnv("TEST_LIMIT_VALUE", 5), 5);
  assert.equal(safeQuotaKeyPart("  user@example.com / weird value  "), "user@example.com_/_weird_value");

  const now = new Date("2026-06-11T23:59:01.000Z");
  assert.equal(utcDayKey(now), "2026-06-11");
  assert.equal(dailyLimitReset(now).toISOString(), "2026-06-12T00:00:00.000Z");

  if (previous === undefined) delete process.env.TEST_LIMIT_VALUE;
  else process.env.TEST_LIMIT_VALUE = previous;
});

test("memory cron fails closed and ignores query-string secrets", async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const missingSecret = await memoryCronGet(new NextRequest("https://inspirlearning.com/api/cron/memory-dreaming"));
  assert.equal(missingSecret.status, 401);

  process.env.CRON_SECRET = "secret";
  const querySecret = await memoryCronGet(
    new NextRequest("https://inspirlearning.com/api/cron/memory-dreaming?secret=secret"),
  );
  assert.equal(querySecret.status, 401);

  if (previous === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;
});

test("fallback quiz rotates correct answer positions", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const quiz = await generateQuiz("safe fallback testing");
  const correctIndexes = new Set(quiz.questions.map((question) => question.correctIndex));
  assert.deepEqual([...correctIndexes].sort(), [0, 1, 2, 3]);

  for (const question of quiz.questions) {
    assert.equal(question.options[question.correctIndex], "Explain it in your own words");
  }

  if (previous === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previous;
});
