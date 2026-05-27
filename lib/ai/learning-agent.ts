import { openai } from "@ai-sdk/openai";
import { ToolLoopAgent, type ToolLoopAgentOnFinishCallback } from "ai";
import type { Topic } from "@/lib/db/schema";
import { buildTopicSystemPrompt, getTopicMetadata } from "./prompts";
import { resolveModelForTopic, resolveTemperature } from "./model-router";

export function createLearningAgent({
  topic,
  model = resolveModelForTopic(topic),
  preferredLanguage,
  onFinish,
}: {
  topic: Topic;
  model?: string;
  preferredLanguage?: string;
  onFinish?: ToolLoopAgentOnFinishCallback;
}) {
  const profile = getTopicMetadata(topic)?.modelProfile ?? "fast";
  return new ToolLoopAgent({
    id: `inspir-${topic.slug}`,
    model: openai(model),
    instructions: buildTopicSystemPrompt(topic, preferredLanguage),
    tools: {},
    temperature: resolveTemperature(profile),
    maxOutputTokens: profile === "reasoning" ? 3200 : 2400,
    onFinish,
  });
}
