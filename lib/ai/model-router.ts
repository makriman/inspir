import type { Topic } from "@/lib/db/schema";
import { getTopicMetadata } from "@/lib/ai/topic-metadata";

export type ModelProfile = "fast" | "reasoning" | "structured";

export function resolveModelName(profile: ModelProfile = "fast") {
  const fallback = readModelEnv("OPENAI_MODEL") ?? "gpt-4.1-mini";
  const fastModel = readModelEnv("OPENAI_FAST_MODEL") ?? fallback;
  if (profile === "reasoning") {
    return readModelEnv("OPENAI_REASONING_MODEL") ?? readModelEnv("OPENAI_MODEL_REASONING") ?? fastModel;
  }
  if (profile === "structured") {
    return readModelEnv("OPENAI_STRUCTURED_MODEL") ?? readModelEnv("OPENAI_MODEL_STRUCTURED") ?? fastModel;
  }
  return fastModel;
}

export function resolveTranslationModelName() {
  return (
    readModelEnv("GEMINI_TRANSLATION_MODEL") ??
    readModelEnv("GOOGLE_TRANSLATION_MODEL") ??
    readModelEnv("TRANSLATION_MODEL") ??
    "gemini-3.1-flash-lite"
  );
}

export function resolveEmbeddingModelName() {
  return readModelEnv("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
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

function readModelEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}
