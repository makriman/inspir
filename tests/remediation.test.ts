import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as memoryCronGet } from "../app/api/cron/memory-dreaming/route";
import { generateQuiz } from "../lib/activities/quiz";
import { topicFromSeed } from "../lib/content/seeded-topics";
import { topicSeeds } from "../lib/content/topics";
import { d1ContainsLikePattern } from "../lib/db/like";
import { toPublicTopic } from "../lib/db/queries";
import { vectorizeFullMetadataTopK } from "../lib/db/vectorize";
import { buildForwardedRequestHeaders } from "../lib/http/forwarded-request-headers";
import {
  requestLanguageHeader,
  requestPathnameHeader,
  requestRecommendedLanguageHeader,
} from "../lib/i18n/routing";
import {
  dailyLimitReset,
  llmBudgetShardCountFromEnv,
  normalizeLlmBudgetShardCount,
  numberFromEnv,
  safeQuotaKeyPart,
  sqlTimestamp,
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
  assert.equal(sqlTimestamp(now), 1781222341000);

  if (previous === undefined) delete process.env.TEST_LIMIT_VALUE;
  else process.env.TEST_LIMIT_VALUE = previous;
});

test("LLM daily budget sharding stays bounded and D1-migrated", () => {
  const previous = process.env.LLM_GLOBAL_DAILY_SHARDS;
  delete process.env.LLM_GLOBAL_DAILY_SHARDS;

  assert.equal(llmBudgetShardCountFromEnv(), 16);
  assert.equal(normalizeLlmBudgetShardCount(0), 1);
  assert.equal(normalizeLlmBudgetShardCount(1.9), 1);
  assert.equal(normalizeLlmBudgetShardCount(999), 128);
  assert.equal(normalizeLlmBudgetShardCount(Number.NaN), 16);

  process.env.LLM_GLOBAL_DAILY_SHARDS = "64";
  assert.equal(llmBudgetShardCountFromEnv(), 64);
  process.env.LLM_GLOBAL_DAILY_SHARDS = "10000";
  assert.equal(llmBudgetShardCountFromEnv(), 128);

  const supplementalMigrations = readdirSync("drizzle-d1")
    .filter((file) => file.endsWith(".sql") && !file.startsWith("0000_"))
    .sort()
    .map((file) => readFileSync(`drizzle-d1/${file}`, "utf8"))
    .join("\n");
  assert.match(supplementalMigrations, /CREATE TABLE IF NOT EXISTS `llm_usage_daily_shards`/);
  assert.match(supplementalMigrations, /PRIMARY KEY\(`day`, `shard`\)/);
  assert.match(supplementalMigrations, /CREATE INDEX IF NOT EXISTS `llm_usage_daily_shards_day_idx`/);
  assert.match(supplementalMigrations, /INSERT INTO `llm_usage_daily_shards`/);
  assert.match(supplementalMigrations, /FROM `llm_usage_daily`/);
  assert.match(supplementalMigrations, /DROP TABLE `llm_usage_daily`/);

  if (previous === undefined) delete process.env.LLM_GLOBAL_DAILY_SHARDS;
  else process.env.LLM_GLOBAL_DAILY_SHARDS = previous;
});

test("D1 LIKE patterns stay within the platform byte limit", () => {
  const pattern = d1ContainsLikePattern("हिन्दी_%_search_".repeat(10));
  assert.ok(pattern);
  assert.ok(new TextEncoder().encode(pattern).byteLength <= 50);
  assert.match(pattern, /^%.*%$/);
  assert.ok(pattern.includes("\\_"));
  assert.ok(pattern.includes("\\%"));
});

test("Vectorize full metadata queries stay within Cloudflare's topK limit", () => {
  assert.equal(vectorizeFullMetadataTopK(0), 1);
  assert.equal(vectorizeFullMetadataTopK(1), 1);
  assert.equal(vectorizeFullMetadataTopK(49.9), 49);
  assert.equal(vectorizeFullMetadataTopK(50), 50);
  assert.equal(vectorizeFullMetadataTopK(51), 50);
  assert.equal(vectorizeFullMetadataTopK(100), 50);
  assert.equal(vectorizeFullMetadataTopK(Number.NaN), 1);
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

test("middleware request forwarding strips spoofed provider and internal headers", () => {
  const source = new Headers({
    accept: "text/html",
    authorization: "Bearer user-controlled",
    cookie: "session=abc",
    "cf-ipcountry": "IN",
    "next-router-state-tree": "%5B%5D",
    rsc: "1",
    "x-inspir-language": "English",
    "x-inspir-pathname": "/spoofed",
    "x-worker-ip-country": "US",
  });

  const forwarded = buildForwardedRequestHeaders(source, [
    [requestLanguageHeader, "Hindi"],
    [requestPathnameHeader, "/chat"],
    [requestRecommendedLanguageHeader, "Hindi"],
  ]);

  assert.equal(forwarded.get("accept"), "text/html");
  assert.equal(forwarded.get("cookie"), "session=abc");
  assert.equal(forwarded.get("cf-ipcountry"), "IN");
  assert.equal(forwarded.get("next-router-state-tree"), "%5B%5D");
  assert.equal(forwarded.get("rsc"), "1");
  assert.equal(forwarded.get("authorization"), null);
  assert.equal(forwarded.get("x-worker-ip-country"), null);
  assert.equal(forwarded.get(requestLanguageHeader), "Hindi");
  assert.equal(forwarded.get(requestPathnameHeader), "/chat");
  assert.equal(forwarded.get(requestRecommendedLanguageHeader), "Hindi");
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
