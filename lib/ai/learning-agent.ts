import { openai } from "@ai-sdk/openai";
import { ToolLoopAgent, type ToolLoopAgentOnFinishCallback } from "ai";
import type { Topic } from "@/lib/db/schema";
import { buildTopicSystemPrompt, getTopicMetadata } from "./prompts";
import { resolveModelForTopic, resolveTemperature } from "./model-router";

export function createLearningAgent({
  topic,
  model = resolveModelForTopic(topic),
  preferredLanguage,
  learnerAge,
  onFinish,
}: {
  topic: Topic;
  model?: string;
  preferredLanguage?: string;
  learnerAge?: number | null;
  onFinish?: ToolLoopAgentOnFinishCallback;
}) {
  const profile = getTopicMetadata(topic)?.modelProfile ?? "fast";
  return new ToolLoopAgent({
    id: `inspir-${topic.slug}`,
    model: openai(model),
    instructions: buildTopicSystemPrompt(topic, preferredLanguage, { learnerAge }),
    tools: {},
    temperature: resolveTemperature(profile),
    maxOutputTokens: profile === "reasoning" ? 3200 : 2400,
    onFinish,
  });
}
