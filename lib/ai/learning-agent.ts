import { openai } from "@ai-sdk/openai";
import { ToolLoopAgent, type ToolLoopAgentOnFinishCallback } from "ai";
import type { Topic } from "@/lib/db/schema";
import { buildTopicSystemPrompt, getTopicMetadata } from "./prompts";
import { resolveModelForTopic, resolveTemperature } from "./model-router";
import type { MemoryPromptContext } from "@/lib/ai/memory";

export function createLearningAgent({
  topic,
  model = resolveModelForTopic(topic),
  preferredLanguage,
  learnerAge,
  memoryContext,
  onFinish,
}: {
  topic: Topic;
  model?: string;
  preferredLanguage?: string;
  learnerAge?: number | null;
  memoryContext?: MemoryPromptContext;
  onFinish?: ToolLoopAgentOnFinishCallback;
}) {
  const profile = getTopicMetadata(topic)?.modelProfile ?? "fast";
  return new ToolLoopAgent({
    id: `inspir-${topic.slug}`,
    model: openai(model),
    instructions: buildTopicSystemPrompt(topic, preferredLanguage, { learnerAge, memoryContext }),
    tools: {},
    temperature: resolveTemperature(profile),
    maxOutputTokens: profile === "reasoning" ? 3200 : 2400,
    onFinish,
  });
}
