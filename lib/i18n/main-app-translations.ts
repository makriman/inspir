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

const translationChunkSize = 180;
const translationConcurrency = 4;

export async function getCachedMainAppTranslationBundle(language: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return getEnglishMainAppTranslationBundle();

  const sourceStrings = getMainAppSourceStrings();
  const sourceHash = getMainAppSourceHash(sourceStrings);
  let cached;
  try {
    cached = await getAppTranslation(mainAppTranslationNamespace, normalized);
  } catch (error) {
    console.error("Could not read main app translation cache", error);
    return null;
  }
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

  const strings = await generateTranslationInChunks({
    language: normalized,
    sourceStrings,
    model,
  });

  try {
    await upsertAppTranslation({
      namespace: mainAppTranslationNamespace,
      language: normalized,
      sourceHash,
      payload: strings,
      model,
    });
  } catch (error) {
    console.error("Could not write main app translation cache", error);
  }

  return buildMainAppTranslationBundle(normalized, strings);
}

async function generateTranslationInChunks({
  language,
  sourceStrings,
  model,
}: {
  language: string;
  sourceStrings: Record<string, string>;
  model: string;
}) {
  const translated: Record<string, string> = {};
  const entries = Object.entries(sourceStrings);
  const chunks = Array.from({ length: Math.ceil(entries.length / translationChunkSize) }, (_, index) => {
    const start = index * translationChunkSize;
    return Object.fromEntries(entries.slice(start, start + translationChunkSize));
  });
  let nextChunkIndex = 0;

  async function runWorker() {
    while (nextChunkIndex < chunks.length) {
      const chunkIndex = nextChunkIndex;
      nextChunkIndex += 1;
      const sourceChunk = chunks[chunkIndex];
      const translatedChunk = await generateTranslationChunk({ language, sourceChunk, model, chunkIndex });
      Object.assign(translated, translatedChunk);
    }
  }

  await Promise.all(Array.from({ length: Math.min(translationConcurrency, chunks.length) }, runWorker));

  if (!validateTranslationPayload(sourceStrings, translated)) {
    throw new Error("Generated translation payload failed validation");
  }

  return translated;
}

async function generateTranslationChunk({
  language,
  sourceChunk,
  model,
  chunkIndex,
}: {
  language: string;
  sourceChunk: Record<string, string>;
  model: string;
  chunkIndex: number;
}) {
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
      targetLanguage: language,
      sourceLanguage: defaultLanguage,
      strings: sourceChunk,
    }),
    temperature: 0.2,
    maxOutputTokens: 12000,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(90_000),
    providerOptions: {
      openai: {
        reasoningEffort: "medium",
        textVerbosity: "low",
      },
    },
  });

  if (!validateTranslationPayload(sourceChunk, result.object.strings)) {
    throw new Error(`Generated translation chunk ${chunkIndex + 1} failed validation`);
  }

  return result.object.strings;
}
