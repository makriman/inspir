import { ToolLoopAgent, type ToolLoopAgentOnFinishCallback } from "ai";
import type { Topic } from "@/lib/db/schema";
import { buildTopicSystemPrompt, getTopicMetadata } from "./prompts";
import { resolveModelForTopic, resolveTemperature } from "./model-router";
import type { MemoryPromptContext } from "@/lib/ai/memory";
import { openAiLanguageModel } from "@/lib/ai/openai-provider";

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
  const modelSettings = isOpenAiReasoningModel(model)
    ? {
        providerOptions: {
          openai: {
            reasoningEffort: profile === "reasoning" ? "low" : "minimal",
          },
        },
      }
    : { temperature: resolveTemperature(profile) };

  return new ToolLoopAgent({
    id: `inspir-${topic.slug}`,
    model: openAiLanguageModel(model),
    instructions: buildTopicSystemPrompt(topic, preferredLanguage, { learnerAge, memoryContext }),
    tools: {},
    maxOutputTokens: profile === "reasoning" ? 3200 : 2400,
    onFinish,
    ...modelSettings,
  });
}

function isOpenAiReasoningModel(model: string) {
  return (
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4-mini") ||
    (model.startsWith("gpt-5") && !model.startsWith("gpt-5-chat"))
  );
}
