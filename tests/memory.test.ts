import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicSystemPrompt } from "../lib/ai/prompts";
import {
  detectMemoryIntent,
  extractDirectMemoryActions,
  extractDirectMemoryActionsFromTurn,
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
      priorChatTurns: [],
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
    priorChatTurns: [
      {
        id: "turn1",
        chatId: "chat2",
        question: "How should I revise simultaneous equations?",
        answerExcerpt: "Inspir suggested substitution practice and checking mistakes.",
        topics: ["Maths"],
      },
    ],
  };

  const formatted = formatMemoryPromptContext(memoryContext);
  assert.ok(formatted?.includes("Relevant learner memory"));
  assert.ok(formatted?.includes("current message and current chat override older memory"));

  const prompt = buildTopicSystemPrompt(seed, "English", { memoryContext });
  assert.ok(prompt.includes("The learner prefers short explanations with examples."));
  assert.ok(prompt.includes("Prefers concise, example-led tutoring."));
  assert.ok(prompt.includes("Previously practiced algebra mistakes."));
  assert.ok(prompt.includes("How should I revise simultaneous equations?"));
});

test("memory relevance heuristic avoids generic turns and catches personal continuity", () => {
  assert.equal(shouldUseMemoryHeuristic("Explain photosynthesis in simple terms"), false);
  assert.equal(shouldUseMemoryHeuristic("Continue my exam revision plan from last time"), true);
  assert.equal(shouldUseMemoryHeuristic("Remember that I prefer visual examples"), true);
  assert.equal(shouldUseMemoryHeuristic("I prefer visual examples"), true);
  assert.equal(shouldUseMemoryHeuristic("Forget my old project preference"), true);
  assert.equal(shouldUseMemoryHeuristic("What is my favourite foos?"), true);
});

test("memory prompt explains signed-in memory capability for direct memory turns", () => {
  const context: MemoryPromptContext = {
    used: true,
    gateReason: "Memory intent detected: explicit_remember.",
    status: {
      enabled: true,
      intent: "explicit_remember",
      shouldAcknowledge: true,
    },
    memories: [],
    profiles: [],
    chatSummaries: [],
    priorChatTurns: [],
  };
  const formatted = formatMemoryPromptContext(context);
  assert.ok(formatted?.includes("Memory is enabled for this signed-in learner"));
  assert.ok(formatted?.includes("Do not say you only remember during this conversation"));
  assert.ok(formatted?.includes("briefly acknowledge that it will be saved"));
});

test("direct memory extraction saves explicit remember requests", () => {
  const extraction = extractDirectMemoryActions("Can you remember that I like maths and the colour red?");
  assert.equal(extraction.clearAll, false);
  assert.equal(extraction.forget.length, 0);
  assert.equal(extraction.memories.length, 1);
  assert.equal(extraction.memories[0]?.kind, "explicit");
  assert.equal(extraction.memories[0]?.category, "preferences");
  assert.equal(extraction.memories[0]?.content, "I like maths and the colour red");
});

test("direct memory extraction is typo tolerant for explicit remember requests", () => {
  const extraction = extractDirectMemoryActions("Can you remeber that I like maths?");
  assert.equal(extraction.clearAll, false);
  assert.equal(extraction.forget.length, 0);
  assert.equal(extraction.memories.length, 1);
  assert.equal(extraction.memories[0]?.kind, "explicit");
  assert.equal(extraction.memories[0]?.content, "I like maths");
});

test("completed turn extraction resolves explicit favorite-food references from the acknowledgement", () => {
  const extraction = extractDirectMemoryActionsFromTurn({
    userMessage: "remeber its my favourite food?",
    assistantMessage:
      "Got it! Puttu Kadala is your favorite food. That's a delicious choice. I'll remember that for future chats.",
  });
  assert.equal(extraction.clearAll, false);
  assert.equal(extraction.forget.length, 0);
  assert.equal(extraction.memories.length, 1);
  assert.equal(extraction.memories[0]?.kind, "explicit");
  assert.equal(extraction.memories[0]?.category, "preferences");
  assert.equal(extraction.memories[0]?.content, "Puttu Kadala is the learner's favourite food.");
});

test("direct memory extraction treats forget as deletion only", () => {
  const extraction = extractDirectMemoryActions("Please forget that I like red");
  assert.equal(extraction.memories.length, 0);
  assert.equal(extraction.forget.length, 1);
  assert.equal(extraction.forget[0]?.query, "I like red");
});

test("memory intent detects questions about saved knowledge", () => {
  assert.equal(detectMemoryIntent("What do you know about me?"), "ask_about_memory");
  assert.equal(detectMemoryIntent("Can you remember that I prefer short hints?"), "explicit_remember");
  assert.equal(detectMemoryIntent("Can you remeber that I prefer short hints?"), "explicit_remember");
  assert.equal(detectMemoryIntent("What is my favourite foos?"), "personalized");
  assert.equal(detectMemoryIntent("Explain gravity simply"), "generic");
});

test("run metadata records selected memory ids and profile categories", () => {
  const retrieval: MemoryRetrievalResult = {
    settingsEnabled: true,
    used: true,
    gateReason: "Personalized request.",
    status: {
      enabled: true,
      intent: "personalized",
      shouldAcknowledge: false,
    },
    memories: [],
    profiles: [],
    chatSummaries: [],
    priorChatTurns: [],
    memoryIds: ["mem1", "mem2"],
    profileCategories: ["preferences"],
    chatSummaryIds: ["chat1"],
    chatTurnIds: ["turn1"],
  };

  assert.deepEqual(memoryRunMetadata(retrieval), {
    used: true,
    gateReason: "Personalized request.",
    memoryIds: ["mem1", "mem2"],
    profileCategories: ["preferences"],
    chatSummaryIds: ["chat1"],
    chatTurnIds: ["turn1"],
    memoryIntent: "personalized",
  });
});
