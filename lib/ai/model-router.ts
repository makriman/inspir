import type { Topic } from "@/lib/db/schema";
import { getTopicMetadata } from "./prompts";

export type ModelProfile = "fast" | "reasoning" | "structured";

export function resolveModelName(profile: ModelProfile = "fast") {
  const fallback = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const fastModel = process.env.OPENAI_FAST_MODEL ?? fallback;
  if (profile === "reasoning") {
    return process.env.OPENAI_REASONING_MODEL ?? process.env.OPENAI_MODEL_REASONING ?? fastModel;
  }
  if (profile === "structured") {
    return process.env.OPENAI_STRUCTURED_MODEL ?? process.env.OPENAI_MODEL_STRUCTURED ?? fastModel;
  }
  return fastModel;
}

export function resolveModelForTopic(topic: Pick<Topic, "metadata">) {
  const metadata = getTopicMetadata(topic);
  return resolveModelName(metadata?.modelProfile ?? "fast");
}

export function resolveTemperature(profile: ModelProfile = "fast") {
  if (profile === "structured") return 0.35;
  if (profile === "reasoning") return 0.55;
  return 0.7;
}
