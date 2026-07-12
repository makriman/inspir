import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  defaultTopicPath,
  defaultTopicSlug,
  defaultTopicWorkspacePath,
  topicPath,
  topicSlugFromChatLocation,
  topicWorkspacePath,
} from "../lib/content/topic-path";
import { parsePublicTopicsResponse } from "../lib/content/public-topic-contract";
import {
  getPublicSeededTopics,
  type PublicSeededTopic,
} from "../lib/content/public-topics";

test("static topic payload validates without exposing private prompt fields", () => {
  const payload = JSON.parse(JSON.stringify({ topics: getPublicSeededTopics() })) as unknown;
  const topics = parsePublicTopicsResponse(payload);

  assert.ok(topics);
  assert.ok(topics.length > 50);
  assert.ok(topics.some((topic) => topic.slug === "learn-anything"));
  assert.equal(topics.some((topic) => topic.slug === "ai-game-arena"), false);
  for (const slug of ["quiz-me-on-trivia", "flashcard-builder"]) {
    const publicTopic: PublicSeededTopic | undefined = topics.find(
      (candidate) => candidate.slug === slug,
    );
    assert.ok(publicTopic);
    assert.equal(publicTopic.metadata.uiMode, "chat");
    assert.equal(Object.hasOwn(publicTopic, "systemPrompt"), false);
  }
  assert.equal(JSON.stringify(payload).includes("systemPrompt"), false);
});

test("static topic payload rejects UUID ids, duplicate slugs, and malformed metadata", () => {
  const topics = getPublicSeededTopics();
  assert.equal(
    parsePublicTopicsResponse({
      topics: topics.map((topic, index) =>
        index === 0 ? { ...topic, id: "123e4567-e89b-42d3-a456-426614174000" } : topic,
      ),
    }),
    null,
  );
  assert.equal(
    parsePublicTopicsResponse({
      topics: topics.map((topic, index) =>
        index === 1 ? { ...topic, id: topics[0]?.slug, slug: topics[0]?.slug } : topic,
      ),
    }),
    null,
  );
  assert.equal(
    parsePublicTopicsResponse({
      topics: topics.map((topic, index) =>
        index === 0 ? { ...topic, metadata: { ...topic.metadata, uiMode: "unsafe" } } : topic,
      ),
    }),
    null,
  );
});

test("guest chat URL helpers do not pull private topic seeds into the client graph", () => {
  const helper = fs.readFileSync(path.resolve("lib/content/topic-path.ts"), "utf8");
  const clientFiles = [
    "components/chat/ChatClient.tsx",
    "components/chat/topic-model.ts",
  ];

  assert.equal(defaultTopicSlug, "learn-anything");
  assert.equal(topicPath("writing-coach"), "/chat/writing-coach");
  assert.equal(topicWorkspacePath("writing-coach"), "/chat?topic=writing-coach");
  assert.equal(defaultTopicPath(), "/chat/learn-anything");
  assert.equal(defaultTopicWorkspacePath(), "/chat?topic=learn-anything");
  assert.equal(topicSlugFromChatLocation("/chat?topic=writing-coach"), "writing-coach");
  assert.equal(topicSlugFromChatLocation("/hi/chat?topic=WRITING-COACH"), "writing-coach");
  assert.equal(topicSlugFromChatLocation("/chat/socratic-instruction?topic=writing-coach"), "socratic-instruction");
  assert.equal(topicSlugFromChatLocation("/chat?topic=../../private"), null);
  assert.equal(topicSlugFromChatLocation("/chat?topic=123e4567-e89b-42d3-a456-426614174000"), null);
  assert.throws(() => topicWorkspacePath("../../private"), TypeError);
  assert.doesNotMatch(helper, /topicSeeds|systemPrompt|content\/topics|content\/topic-routing/);

  for (const file of clientFiles) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.match(source, /@\/lib\/content\/topic-path/);
    assert.doesNotMatch(source, /@\/lib\/content\/(?:topics|topic-routing)/);
  }

  const guestGate = fs.readFileSync(path.resolve("components/chat/GuestFeatureGate.tsx"), "utf8");
  assert.doesNotMatch(guestGate, /@\/lib\/content\/(?:topics|topic-routing)/);

  const chatClient = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");
  assert.match(chatClient, /dynamic\(\(\) =>\s*import\("@\/components\/chat\/ProfilePanel"\)/);
  assert.doesNotMatch(chatClient, /import \{ ProfilePanel \} from "@\/components\/chat\/ProfilePanel"/);
});
