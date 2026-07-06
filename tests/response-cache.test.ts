import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuestStarterResponseCacheRequest,
  cachedLearningResponseStream,
  isGuestStarterCacheCandidate,
  responseCacheScope,
  responseCacheTtlSeconds,
  storeCachedLearningResponse,
} from "../lib/ai/response-cache";
import { findSeededTopic } from "../lib/content/seeded-topics";

test("guest starter response cache keys normalize identical public questions", async () => {
  const topic = findSeededTopic("learn-anything");
  assert.ok(topic);

  const first = await buildGuestStarterResponseCacheRequest({
    topic,
    content: "  Explain   BLACK holes simply\n\n\nplease ",
    preferredLanguage: "English",
    model: "gpt-5-mini",
    modelParams: { maxOutputTokens: 2400, temperature: 0.4, reasoningEffort: undefined },
  });
  const second = await buildGuestStarterResponseCacheRequest({
    topic,
    content: "explain BLACK holes simply\n\nplease",
    preferredLanguage: "English",
    model: "gpt-5-mini",
    modelParams: { temperature: 0.4, maxOutputTokens: 2400 },
  });

  assert.equal(first.scope, responseCacheScope);
  assert.equal(first.cacheKey, second.cacheKey);
  assert.equal(first.questionHash, second.questionHash);
  assert.equal(first.topicSlug, "learn-anything");
  assert.equal(first.language, "English");
});

test("guest starter response cache keys separate language and model changes", async () => {
  const topic = findSeededTopic("learn-anything");
  assert.ok(topic);

  const english = await buildGuestStarterResponseCacheRequest({
    topic,
    content: "Explain photosynthesis",
    preferredLanguage: "English",
    model: "gpt-5-mini",
    modelParams: { maxOutputTokens: 2400 },
  });
  const spanish = await buildGuestStarterResponseCacheRequest({
    topic,
    content: "Explain photosynthesis",
    preferredLanguage: "Spanish",
    model: "gpt-5-mini",
    modelParams: { maxOutputTokens: 2400 },
  });
  const largerModel = await buildGuestStarterResponseCacheRequest({
    topic,
    content: "Explain photosynthesis",
    preferredLanguage: "English",
    model: "gpt-5",
    modelParams: { maxOutputTokens: 2400 },
  });

  assert.notEqual(english.cacheKey, spanish.cacheKey);
  assert.notEqual(english.cacheKey, largerModel.cacheKey);
});

test("response cache only treats empty guest history as a public starter", () => {
  assert.equal(isGuestStarterCacheCandidate([]), true);
  assert.equal(isGuestStarterCacheCandidate([{ role: "user", content: "earlier" }]), false);
});

test("cached learning response stream replays as text deltas and finish metadata", async () => {
  const stream = cachedLearningResponseStream("Hello cached learner.");
  const reader = stream.getReader();
  const first = await reader.read();
  const second = await reader.read();
  let last = second;

  while (!last.value || (last.value as { type?: string }).type !== "finish") {
    last = await reader.read();
  }

  assert.equal((first.value as { type?: string }).type, "text-delta");
  assert.equal((last.value as { finishReason?: string }).finishReason, "stop");
  assert.deepEqual((last.value as { totalUsage?: unknown }).totalUsage, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
});

test("response cache rejects non-stop finishes before touching storage", async () => {
  const result = await storeCachedLearningResponse({
    request: {
      cacheKey: "key",
      language: "English",
      model: "gpt-5-mini",
      modelParams: {},
      promptHash: "prompt-hash",
      questionHash: "question-hash",
      scope: responseCacheScope,
      surface: "guest-chat",
      topicId: "learn-anything",
      topicSlug: "learn-anything",
    },
    responseText: "Partial answer",
    finishReason: "length",
    totalUsage: null,
  });

  assert.deepEqual(result, { stored: false, reason: "finish_reason" });
});

test("response cache TTL is bounded and configurable", () => {
  const previous = process.env.AI_RESPONSE_CACHE_TTL_SECONDS;
  process.env.AI_RESPONSE_CACHE_TTL_SECONDS = "120";
  assert.equal(responseCacheTtlSeconds(), 120);
  process.env.AI_RESPONSE_CACHE_TTL_SECONDS = "999999999";
  assert.equal(responseCacheTtlSeconds(), 30 * 24 * 60 * 60);

  if (previous === undefined) delete process.env.AI_RESPONSE_CACHE_TTL_SECONDS;
  else process.env.AI_RESPONSE_CACHE_TTL_SECONDS = previous;
});
