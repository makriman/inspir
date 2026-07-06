import type { Topic } from "@/lib/db/schema";
import { buildTopicSystemPrompt, getTopicMetadata } from "./prompts";
import { resolveModelForTopic, resolveTemperature } from "./model-router";
import type { MemoryPromptContext } from "@/lib/ai/memory";
import { streamOpenAiChatCompletion, type OpenAiChatMessage } from "@/lib/ai/openai-client";

export function createLearningAgent({
  topic,
  model = resolveModelForTopic(topic),
  preferredLanguage,
  learnerAge,
  memoryContext,
}: {
  topic: Topic;
  model?: string;
  preferredLanguage?: string;
  learnerAge?: number | null;
  memoryContext?: MemoryPromptContext;
}) {
  const instructions = buildTopicSystemPrompt(topic, preferredLanguage, { learnerAge, memoryContext });
  const settings = learningModelSettings(topic, model);

  return {
    id: `inspir-${topic.slug}`,
    stream({ messages }: { messages: Array<OpenAiChatMessage> }) {
      return streamOpenAiChatCompletion({
        messages: [{ role: "system", content: instructions }, ...messages],
        model,
        ...settings,
      });
    },
  };
}

export function learningModelSettings(topic: Topic, model = resolveModelForTopic(topic)) {
  const profile = getTopicMetadata(topic)?.modelProfile ?? "fast";
  const reasoningEffort = isOpenAiReasoningModel(model)
    ? profile === "reasoning"
      ? ("low" as const)
      : ("minimal" as const)
    : undefined;
  return {
    maxOutputTokens: profile === "reasoning" ? 3200 : 2400,
    reasoningEffort,
    temperature: isOpenAiReasoningModel(model) ? undefined : resolveTemperature(profile),
  };
}

function isOpenAiReasoningModel(model: string) {
  return (
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4-mini") ||
    (model.startsWith("gpt-5") && !model.startsWith("gpt-5-chat"))
  );
}
