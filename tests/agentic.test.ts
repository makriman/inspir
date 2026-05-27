import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicSystemPrompt, INSPIR_TUTOR_CONTRACT } from "../lib/ai/prompts";
import { resolveModelName } from "../lib/ai/model-router";
import { answerQuizQuestion, sanitizeQuizState, type QuizState } from "../lib/activities/quiz";
import { topicSeeds } from "../lib/content/topics";

test("topic registry exposes exactly 50 learner modes and preserves legacy slugs", () => {
  assert.equal(topicSeeds.length, 50);
  for (const slug of [
    "learn-anything",
    "socratic-instruction",
    "collaborative-instruction",
    "interactive-instruction",
    "quiz-me-on-trivia",
    "time-travel",
    "talk-to-a-historical-person",
    "debate-with-a-personality",
    "debate-any-topic",
  ]) {
    assert.ok(topicSeeds.some((topic) => topic.slug === slug), `${slug} should remain available`);
  }
});

test("prompt assembly includes the shared tutor contract and selected mode prompt", () => {
  const seed = topicSeeds.find((topic) => topic.slug === "socratic-instruction");
  assert.ok(seed);
  const prompt = buildTopicSystemPrompt({
    name: seed.name,
    slug: seed.slug,
    systemPrompt: seed.systemPrompt,
    metadata: seed.metadata,
  });
  assert.ok(prompt.includes(INSPIR_TUTOR_CONTRACT));
  assert.ok(prompt.includes("Selected mode: Socratic Instruction"));
  assert.ok(prompt.includes("Profile language: English"));
  assert.ok(prompt.includes("Ask one focused diagnostic question"));
});

test("prompt assembly includes selected profile language", () => {
  const seed = topicSeeds.find((topic) => topic.slug === "learn-anything");
  assert.ok(seed);
  const prompt = buildTopicSystemPrompt(
    {
      name: seed.name,
      slug: seed.slug,
      systemPrompt: seed.systemPrompt,
      metadata: seed.metadata,
    },
    "Spanish",
  );
  assert.ok(prompt.includes("Profile language: Spanish"));
  assert.ok(prompt.includes("Respond in Spanish"));
});

test("collaborative instruction no longer defaults to Hindi", () => {
  const seed = topicSeeds.find((topic) => topic.slug === "collaborative-instruction");
  assert.ok(seed);
  const text = [seed.subText, seed.description, seed.inputboxText, seed.systemPrompt, ...seed.metadata.starters].join(" ");
  assert.equal(/Hindi|Aaj|Chalo|saath|Mujhe/.test(text), false);
});

test("model router uses profile-specific env vars with OPENAI_MODEL fallback", () => {
  const previous = {
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_FAST_MODEL: process.env.OPENAI_FAST_MODEL,
    OPENAI_REASONING_MODEL: process.env.OPENAI_REASONING_MODEL,
    OPENAI_STRUCTURED_MODEL: process.env.OPENAI_STRUCTURED_MODEL,
  };
  process.env.OPENAI_MODEL = "fallback-model";
  delete process.env.OPENAI_FAST_MODEL;
  process.env.OPENAI_REASONING_MODEL = "reasoning-model";
  process.env.OPENAI_STRUCTURED_MODEL = "structured-model";

  assert.equal(resolveModelName("fast"), "fallback-model");
  assert.equal(resolveModelName("reasoning"), "reasoning-model");
  assert.equal(resolveModelName("structured"), "structured-model");

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("quiz state hides future answers and scores a submitted answer", () => {
  const state: QuizState = {
    topic: "Planets",
    currentIndex: 0,
    score: 0,
    maxScore: 10,
    completed: false,
    questions: Array.from({ length: 10 }, (_, index) => ({
      id: `q${index + 1}`,
      prompt: `Question ${index + 1}`,
      options: ["A", "B", "C", "D"],
      correctIndex: 1,
      explanation: "Because B is correct.",
    })),
  };

  const hidden = sanitizeQuizState(state);
  assert.equal(hidden.questions[0].correctIndex, undefined);
  assert.equal(hidden.questions[0].explanation, undefined);

  const answered = answerQuizQuestion(state, 1);
  assert.equal(answered.wasCorrect, true);
  assert.equal(answered.state.score, 1);
  const visible = sanitizeQuizState(answered.state);
  assert.equal(visible.questions[0].correctIndex, 1);
  assert.equal(visible.questions[1].correctIndex, undefined);
});
