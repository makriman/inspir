import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import {
  buildMainAppTranslationBundle,
  getEnglishMainAppTranslationBundle,
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "@/lib/i18n/main-app-source";
import { getAppTranslation, upsertAppTranslation } from "@/lib/db/queries";
import { resolveTranslationModelName } from "@/lib/ai/model-router";
import type { MainAppTranslationBundle } from "./main-app-types";
import { isFreshAppTranslation, validateTranslationPayload } from "./translation-validation";

const generatedTranslationSchema = z.object({
  strings: z.record(z.string(), z.string()),
});

export async function getCachedMainAppTranslationBundle(language: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return getEnglishMainAppTranslationBundle();

  const sourceStrings = getMainAppSourceStrings();
  const sourceHash = getMainAppSourceHash(sourceStrings);
  const cached = await getAppTranslation(mainAppTranslationNamespace, normalized);
  if (!isFreshAppTranslation(cached, sourceHash)) return null;
  return buildMainAppTranslationBundle(normalized, cached.payload);
}

export async function getOrCreateMainAppTranslationBundle(language: string): Promise<MainAppTranslationBundle> {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return getEnglishMainAppTranslationBundle();

  const cached = await getCachedMainAppTranslationBundle(normalized);
  if (cached) return cached;

  const sourceStrings = getMainAppSourceStrings();
  const sourceHash = getMainAppSourceHash(sourceStrings);
  const model = resolveTranslationModelName();

  if (!process.env.OPENAI_API_KEY) {
    return getEnglishMainAppTranslationBundle();
  }

  const result = await generateObject({
    model: openai(model),
    schema: generatedTranslationSchema,
    system: [
      "You are a meticulous product localization specialist for an education app.",
      "Translate every value into the target language while preserving the exact JSON keys.",
      "Preserve placeholders like {name}, punctuation that belongs with placeholders, and product name inspir.",
      "Do not translate code identifiers, URLs, markdown syntax, or bracketed control markers unless they are natural visible copy.",
      "Return natural UI copy, not literal word-for-word text when that would sound awkward.",
    ].join("\n"),
    prompt: JSON.stringify({
      targetLanguage: normalized,
      sourceLanguage: defaultLanguage,
      strings: sourceStrings,
    }),
    temperature: 0.2,
    maxOutputTokens: 20000,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
    providerOptions: {
      openai: {
        reasoningEffort: "medium",
        textVerbosity: "low",
      },
    },
  });

  if (!validateTranslationPayload(sourceStrings, result.object.strings)) {
    throw new Error("Generated translation payload failed validation");
  }

  await upsertAppTranslation({
    namespace: mainAppTranslationNamespace,
    language: normalized,
    sourceHash,
    payload: result.object.strings,
    model,
  });

  return buildMainAppTranslationBundle(normalized, result.object.strings);
}
