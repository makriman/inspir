import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicSystemPrompt } from "../lib/ai/prompts";
import {
  formatMemoryPromptContext,
  memoryRunMetadata,
  shouldUseMemoryHeuristic,
  type MemoryPromptContext,
  type MemoryRetrievalResult,
} from "../lib/ai/memory";
import { topicSeeds } from "../lib/content/topics";

test("prompt assembly omits memory section when no memory is selected", () => {
  const seed = topicSeeds.find((topic) => topic.slug === "learn-anything");
  assert.ok(seed);

  const prompt = buildTopicSystemPrompt(seed, "English", {
    memoryContext: {
      used: false,
      memories: [],
      profiles: [],
      chatSummaries: [],
    },
  });

  assert.equal(prompt.includes("Relevant learner memory"), false);
});

test("prompt assembly includes only selected memory with override guidance", () => {
  const seed = topicSeeds.find((topic) => topic.slug === "learn-anything");
  assert.ok(seed);

  const memoryContext: MemoryPromptContext = {
    used: true,
    gateReason: "The learner asked for personalized help.",
    memories: [
      {
        id: "mem1",
        kind: "explicit",
        category: "preferences",
        content: "The learner prefers short explanations with examples.",
        tags: ["style"],
      },
    ],
    profiles: [{ category: "preferences", summary: "Prefers concise, example-led tutoring." }],
    chatSummaries: [{ chatId: "chat1", summary: "Previously practiced algebra mistakes.", topics: ["Algebra"] }],
  };

  const formatted = formatMemoryPromptContext(memoryContext);
  assert.ok(formatted?.includes("Relevant learner memory"));
  assert.ok(formatted?.includes("current message and current chat override older memory"));

  const prompt = buildTopicSystemPrompt(seed, "English", { memoryContext });
  assert.ok(prompt.includes("The learner prefers short explanations with examples."));
  assert.ok(prompt.includes("Prefers concise, example-led tutoring."));
  assert.ok(prompt.includes("Previously practiced algebra mistakes."));
});

test("memory relevance heuristic avoids generic turns and catches personal continuity", () => {
  assert.equal(shouldUseMemoryHeuristic("Explain photosynthesis in simple terms"), false);
  assert.equal(shouldUseMemoryHeuristic("Continue my exam revision plan from last time"), true);
  assert.equal(shouldUseMemoryHeuristic("Remember that I prefer visual examples"), true);
  assert.equal(shouldUseMemoryHeuristic("Forget my old project preference"), true);
});

test("run metadata records selected memory ids and profile categories", () => {
  const retrieval: MemoryRetrievalResult = {
    settingsEnabled: true,
    used: true,
    gateReason: "Personalized request.",
    memories: [],
    profiles: [],
    chatSummaries: [],
    memoryIds: ["mem1", "mem2"],
    profileCategories: ["preferences"],
    chatSummaryIds: ["chat1"],
  };

  assert.deepEqual(memoryRunMetadata(retrieval), {
    used: true,
    gateReason: "Personalized request.",
    memoryIds: ["mem1", "mem2"],
    profileCategories: ["preferences"],
    chatSummaryIds: ["chat1"],
  });
});
