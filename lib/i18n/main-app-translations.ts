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

const defaultTranslationBatchSize = 24;
const defaultTranslationConcurrency = 4;
const defaultTranslationMaxRetries = 2;
const defaultTranslationRetryAfterMs = 1500;
const failedTranslationRetryAfterMs = 30_000;
const defaultTranslationTimeoutMs = 60_000;

export type MainAppTranslationResult = {
  bundle: MainAppTranslationBundle;
  complete: boolean;
  translatedCount: number;
  totalCount: number;
  retryAfterMs?: number;
};

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
  const validCachedStrings = filterValidTranslations(sourceStrings, cached.payload);
  if (!isCompleteMainAppTranslationPayload(sourceStrings, validCachedStrings)) return null;
  return buildMainAppTranslationBundle(normalized, validCachedStrings);
}

export async function getOrCreateMainAppTranslationBundle(language: string): Promise<MainAppTranslationBundle> {
  return (await getOrCreateMainAppTranslationResult(language)).bundle;
}

export async function getOrCreateMainAppTranslationResult(language: string): Promise<MainAppTranslationResult> {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) {
    const bundle = getEnglishMainAppTranslationBundle();
    return {
      bundle,
      complete: true,
      translatedCount: Object.keys(bundle.sourceStrings).length,
      totalCount: Object.keys(bundle.sourceStrings).length,
    };
  }

  const sourceStrings = getMainAppSourceStrings();
  const sourceHash = getMainAppSourceHash(sourceStrings);
  let cached;
  try {
    cached = await getAppTranslation(mainAppTranslationNamespace, normalized);
  } catch (error) {
    console.error("Could not read main app translation cache", error);
  }
  const validCachedStrings = filterValidTranslations(
    sourceStrings,
    cached?.payload ?? {},
  );
  if (isCompleteMainAppTranslationPayload(sourceStrings, validCachedStrings)) {
    const bundle = buildMainAppTranslationBundle(normalized, validCachedStrings);
    return {
      bundle,
      complete: true,
      translatedCount: Object.keys(sourceStrings).length,
      totalCount: Object.keys(sourceStrings).length,
    };
  }

  const model = resolveTranslationModelName();

  if (!process.env.OPENAI_API_KEY) {
    const bundle = getEnglishMainAppTranslationBundle();
    return {
      bundle,
      complete: false,
      translatedCount: 0,
      totalCount: Object.keys(sourceStrings).length,
    };
  }

  const batchSize = readPositiveIntegerEnv("OPENAI_TRANSLATION_BATCH_SIZE", defaultTranslationBatchSize);
  const missingEntries = Object.entries(sourceStrings)
    .filter(([key]) => !validCachedStrings[key])
    .slice(0, batchSize);
  const batchResult = await generateTranslationsForEntries({
    language: normalized,
    entries: missingEntries,
    model,
  });
  const batchStrings = batchResult.translated;
  const strings = { ...validCachedStrings, ...batchStrings };
  const validStringCount = Object.keys(filterValidTranslations(sourceStrings, strings)).length;
  const complete = validStringCount === Object.keys(sourceStrings).length;

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

  return {
    bundle: buildMainAppPartialTranslationBundle(normalized, sourceStrings, strings),
    complete,
    translatedCount: validStringCount,
    totalCount: Object.keys(sourceStrings).length,
    retryAfterMs: complete
      ? undefined
      : batchResult.failedCount > 0 && Object.keys(batchStrings).length === 0
        ? failedTranslationRetryAfterMs
        : defaultTranslationRetryAfterMs,
  };
}

async function generateTranslationsForEntries({
  language,
  entries,
  model,
}: {
  language: string;
  entries: Array<[string, string]>;
  model: string;
}) {
  const translated: Record<string, string> = {};
  const concurrency = readPositiveIntegerEnv("OPENAI_TRANSLATION_CONCURRENCY", defaultTranslationConcurrency);
  const failures: Array<{ key: string; error: unknown }> = [];
  let nextEntryIndex = 0;
  let completed = 0;

  async function runWorker() {
    while (nextEntryIndex < entries.length) {
      const entryIndex = nextEntryIndex;
      nextEntryIndex += 1;
      const [key, source] = entries[entryIndex];
      try {
        const value = await generateTranslationField({ language, key, source, model });
        translated[key] = value;
        completed += 1;
        if (translationVerboseLogs()) {
          console.info("Main app translation field complete", {
            language,
            key,
            completed,
            total: entries.length,
          });
        }
      } catch (error) {
        failures.push({ key, error });
        console.error("Main app translation field failed", {
          language,
          key,
          error: summarizeTranslationError(error),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, runWorker));

  if (failures.length) {
    console.error("Main app translation batch completed with failures", {
      language,
      failedCount: failures.length,
      translatedCount: Object.keys(translated).length,
      total: entries.length,
    });
  }

  return { translated, failedCount: failures.length };
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
  const maxRetries = readNonNegativeIntegerEnv("OPENAI_TRANSLATION_MAX_RETRIES", defaultTranslationMaxRetries);
  const maxAttempts = maxRetries + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const providerOptions = buildTranslationProviderOptions();
      const result = await generateObject({
        model: openai(model),
        schema: generatedTranslationSchema,
        system: [
          "You are a meticulous product localization specialist for an education app.",
          "Translate exactly the provided UI text into the target language.",
          "Return only the translated value in the structured field.",
          "Preserve placeholders like {name}, punctuation that belongs with placeholders, markdown markers, and the product name inspir.",
          "Do not translate code identifiers, URLs, class names, or bracketed control markers unless the text is natural visible copy.",
          "Use the field key for context, but never translate or include the key.",
          "Use natural, concise product UI copy, not literal word-for-word text when that would sound awkward.",
          "Prefer consistent education-app terminology across labels, controls, topics, onboarding, quiz, and flashcard copy.",
          "For Hindi, write in natural Devanagari Hindi. Avoid Hinglish except for brand names, common acronyms like AI, or terms that are normally left in English.",
        ].join("\n"),
        prompt: JSON.stringify({
          targetLanguage: language,
          sourceLanguage: defaultLanguage,
          fieldKey: key,
          sourceText: source,
        }),
        maxOutputTokens: maxOutputTokensForField(source),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(readPositiveIntegerEnv("OPENAI_TRANSLATION_TIMEOUT_MS", defaultTranslationTimeoutMs)),
        ...(providerOptions ? { providerOptions } : {}),
      });

      const value = result.object.value;
      if (!isValidFieldTranslation(source, value)) {
        throw new Error("Generated translation field failed validation");
      }

      return value;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.warn("Retrying main app translation field", {
          language,
          key,
          attempt,
          maxAttempts,
          error: summarizeTranslationError(error),
        });
        await sleep(250 * attempt);
      }
    }
  }

  throw lastError;
}

function isValidFieldTranslation(source: string, value: string | undefined) {
  if (!value?.trim()) return false;
  const sourcePlaceholders = placeholdersIn(source).sort().join("|");
  const valuePlaceholders = placeholdersIn(value).sort().join("|");
  if (sourcePlaceholders !== valuePlaceholders) return false;
  if (source.trim() === value.trim() && !canRemainUntranslated(source)) return false;
  return true;
}

function isCompleteMainAppTranslationPayload(
  sourceStrings: Record<string, string>,
  translatedStrings: Record<string, string>,
) {
  return (
    validateTranslationPayload(sourceStrings, translatedStrings) &&
    Object.keys(filterValidTranslations(sourceStrings, translatedStrings)).length === Object.keys(sourceStrings).length
  );
}

function filterValidTranslations(
  sourceStrings: Record<string, string>,
  translatedStrings: Record<string, string>,
) {
  return Object.fromEntries(
    Object.entries(sourceStrings)
      .filter(([key, source]) => isValidFieldTranslation(source, translatedStrings[key]))
      .map(([key]) => [key, translatedStrings[key]]),
  );
}

function buildMainAppPartialTranslationBundle(
  language: string,
  sourceStrings: Record<string, string>,
  translatedStrings: Record<string, string>,
): MainAppTranslationBundle {
  return {
    namespace: mainAppTranslationNamespace,
    language: normalizeLanguage(language),
    sourceHash: getMainAppSourceHash(sourceStrings),
    sourceStrings,
    strings: { ...sourceStrings, ...translatedStrings },
  };
}

function canRemainUntranslated(source: string) {
  const value = source.trim();
  if (!/[A-Za-z]/.test(value)) return true;
  if (value.toLowerCase() === "inspir") return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^\d+\s*[-–]\s*\d+\s*(?:min|mins|minutes|sec|secs|hours?|hrs?)$/i.test(value)) return true;
  if (isProperNameLabel(value)) return true;
  return /^[A-Z0-9][A-Z0-9\s&+./:'-]*$/.test(value) && !/[a-z]/.test(value);
}

function isProperNameLabel(value: string) {
  const normalized = value.replace(/\.{3}$/, "");
  const segments = normalized.split(",").map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return false;

  const words = segments.flatMap((segment) => segment.split(/\s+/));
  const hasProperNameSignal =
    value.includes(",") || value.includes("'") || /\d/.test(value) || /(?:[A-Z]\.\s*)+/.test(value) || words.length >= 2;
  if (!hasProperNameSignal) return false;

  return words.every((word) => /^(?:[A-Z]\.|[A-Z][A-Za-z.'-]*|\d{2,4})$/.test(word));
}

function maxOutputTokensForField(source: string) {
  return Math.max(768, Math.min(2500, source.length * 4 + 256));
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeIntegerEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function translationVerboseLogs() {
  return process.env.OPENAI_TRANSLATION_VERBOSE_LOGS === "true";
}

function buildTranslationProviderOptions() {
  const openaiOptions: Record<string, string> = {};
  const reasoningEffort = process.env.OPENAI_TRANSLATION_REASONING_EFFORT;
  const textVerbosity = process.env.OPENAI_TRANSLATION_TEXT_VERBOSITY;

  if (reasoningEffort) openaiOptions.reasoningEffort = reasoningEffort;
  if (textVerbosity) openaiOptions.textVerbosity = textVerbosity;

  return Object.keys(openaiOptions).length ? { openai: openaiOptions } : undefined;
}

function summarizeTranslationError(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };

  const details = error as Error & {
    finishReason?: unknown;
    statusCode?: unknown;
    requestId?: unknown;
    cause?: {
      finishReason?: unknown;
      statusCode?: unknown;
      requestId?: unknown;
    };
  };

  return {
    name: error.name,
    message: error.message,
    finishReason: details.finishReason ?? details.cause?.finishReason,
    statusCode: details.statusCode ?? details.cause?.statusCode,
    requestId: details.requestId ?? details.cause?.requestId,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
