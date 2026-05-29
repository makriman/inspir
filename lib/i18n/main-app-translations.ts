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
import { isFreshAppTranslation, placeholdersIn, validateTranslationPayload } from "./translation-validation";

const generatedTranslationSchema = z.object({
  value: z.string(),
});

const defaultTranslationConcurrency = 16;
const defaultTranslationFlushEvery = 25;

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
  if (!validateTranslationPayload(sourceStrings, cached.payload)) return null;
  return buildMainAppTranslationBundle(normalized, cached.payload);
}

export async function getOrCreateMainAppTranslationBundle(language: string): Promise<MainAppTranslationBundle> {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return getEnglishMainAppTranslationBundle();

  const sourceStrings = getMainAppSourceStrings();
  const sourceHash = getMainAppSourceHash(sourceStrings);
  let cached;
  try {
    cached = await getAppTranslation(mainAppTranslationNamespace, normalized);
  } catch (error) {
    console.error("Could not read main app translation cache", error);
  }
  if (cached && isFreshAppTranslation(cached, sourceHash) && validateTranslationPayload(sourceStrings, cached.payload)) {
    return buildMainAppTranslationBundle(normalized, cached.payload);
  }

  const model = resolveTranslationModelName();

  if (!process.env.OPENAI_API_KEY) {
    return getEnglishMainAppTranslationBundle();
  }

  const initialStrings = cached && isFreshAppTranslation(cached, sourceHash) ? cached.payload : {};
  const strings = await generateTranslationsPerField({
    language: normalized,
    sourceStrings,
    initialStrings,
    model,
    onProgress: async (payload) => {
      await upsertAppTranslation({
        namespace: mainAppTranslationNamespace,
        language: normalized,
        sourceHash,
        payload,
        model,
      });
    },
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

async function generateTranslationsPerField({
  language,
  sourceStrings,
  initialStrings,
  model,
  onProgress,
}: {
  language: string;
  sourceStrings: Record<string, string>;
  initialStrings: Record<string, string>;
  model: string;
  onProgress: (payload: Record<string, string>) => Promise<void>;
}) {
  const translated: Record<string, string> = {};
  const entries = Object.entries(sourceStrings);
  for (const [key, source] of entries) {
    if (isValidFieldTranslation(source, initialStrings[key])) translated[key] = initialStrings[key];
  }

  const missingEntries = entries.filter(([key]) => !translated[key]);
  const concurrency = readPositiveIntegerEnv("OPENAI_TRANSLATION_CONCURRENCY", defaultTranslationConcurrency);
  const flushEvery = readPositiveIntegerEnv("OPENAI_TRANSLATION_FLUSH_EVERY", defaultTranslationFlushEvery);
  const failures: Array<{ key: string; error: unknown }> = [];
  let nextEntryIndex = 0;
  let completedSinceFlush = 0;
  let completed = 0;
  let flushPromise = Promise.resolve();

  async function flushProgress(force = false) {
    if (!force && completedSinceFlush < flushEvery) return;
    completedSinceFlush = 0;
    const payload = { ...translated };
    flushPromise = flushPromise.then(async () => {
      try {
        await onProgress(payload);
      } catch (error) {
        console.error("Could not write main app translation progress", error);
      }
    });
    await flushPromise;
  }

  async function runWorker() {
    while (nextEntryIndex < missingEntries.length) {
      const entryIndex = nextEntryIndex;
      nextEntryIndex += 1;
      const [key, source] = missingEntries[entryIndex];
      try {
        const value = await generateTranslationField({ language, key, source, model });
        translated[key] = value;
        completed += 1;
        completedSinceFlush += 1;
        console.info("Main app translation field complete", {
          language,
          key,
          completed,
          total: missingEntries.length,
        });
        await flushProgress();
      } catch (error) {
        failures.push({ key, error });
        console.error("Main app translation field failed", { language, key, error });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, missingEntries.length) }, runWorker));
  await flushProgress(true);

  if (failures.length) {
    throw new Error(`Failed to translate ${failures.length} main app fields`);
  }

  if (!validateTranslationPayload(sourceStrings, translated)) {
    throw new Error("Generated translation payload failed validation");
  }

  return translated;
}

async function generateTranslationField({
  language,
  key,
  source,
  model,
}: {
  language: string;
  key: string;
  source: string;
  model: string;
}) {
  const result = await generateObject({
    model: openai(model),
    schema: generatedTranslationSchema,
    system: [
      "You are a meticulous product localization specialist for an education app.",
      "Translate exactly the provided UI text into the target language.",
      "Return only the translated value in the structured field.",
      "Preserve placeholders like {name}, punctuation that belongs with placeholders, markdown markers, and the product name inspir.",
      "Do not translate code identifiers, URLs, class names, or bracketed control markers unless the text is natural visible copy.",
      "Use natural product UI copy, not literal word-for-word text when that would sound awkward.",
    ].join("\n"),
    prompt: JSON.stringify({
      targetLanguage: language,
      sourceLanguage: defaultLanguage,
      fieldKey: key,
      sourceText: source,
    }),
    temperature: 0.2,
    maxOutputTokens: maxOutputTokensForField(source),
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(90_000),
    providerOptions: {
      openai: {
        reasoningEffort: "medium",
        textVerbosity: "low",
      },
    },
  });

  const value = result.object.value;
  if (!isValidFieldTranslation(source, value)) {
    throw new Error("Generated translation field failed validation");
  }

  return value;
}

function isValidFieldTranslation(source: string, value: string | undefined) {
  if (!value?.trim()) return false;
  const sourcePlaceholders = placeholdersIn(source).sort().join("|");
  const valuePlaceholders = placeholdersIn(value).sort().join("|");
  return sourcePlaceholders === valuePlaceholders;
}

function maxOutputTokensForField(source: string) {
  return Math.max(256, Math.min(2000, source.length * 4 + 128));
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
