import { GoogleGenAI, Type } from "@google/genai";
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
const defaultTranslationConcurrency = 2;
const defaultTranslationMaxRetries = 2;
const defaultTranslationRetryAfterMs = 1500;
const failedTranslationRetryAfterMs = 30_000;
const defaultTranslationTimeoutMs = 60_000;
const defaultTranslationRetryDelayMs = 1000;

const geminiTranslationResponseSchema = {
  type: Type.OBJECT,
  properties: {
    value: {
      type: Type.STRING,
    },
  },
  required: ["value"],
  propertyOrdering: ["value"],
};

let geminiTranslationClient: GoogleGenAI | undefined;
let geminiTranslationClientApiKey: string | undefined;

const languageSpecificIdenticalTranslations: Record<string, ReadonlySet<string>> = {
  Spanish: new Set(["Social"]),
};

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
  const validCachedStrings = filterValidTranslations(sourceStrings, cached.payload, normalized);
  if (!isCompleteMainAppTranslationPayload(sourceStrings, validCachedStrings, normalized)) return null;
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
    normalized,
  );
  if (isCompleteMainAppTranslationPayload(sourceStrings, validCachedStrings, normalized)) {
    const bundle = buildMainAppTranslationBundle(normalized, validCachedStrings);
    return {
      bundle,
      complete: true,
      translatedCount: Object.keys(sourceStrings).length,
      totalCount: Object.keys(sourceStrings).length,
    };
  }

  const model = resolveTranslationModelName();

  if (!resolveTranslationApiKey()) {
    const bundle = getEnglishMainAppTranslationBundle();
    return {
      bundle,
      complete: false,
      translatedCount: 0,
      totalCount: Object.keys(sourceStrings).length,
    };
  }

  const batchSize = readPositiveIntegerEnv(
    ["TRANSLATION_BATCH_SIZE", "GEMINI_TRANSLATION_BATCH_SIZE", "OPENAI_TRANSLATION_BATCH_SIZE"],
    defaultTranslationBatchSize,
  );
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
  const validStringCount = Object.keys(filterValidTranslations(sourceStrings, strings, normalized)).length;
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
  const concurrency = readPositiveIntegerEnv(
    ["TRANSLATION_CONCURRENCY", "GEMINI_TRANSLATION_CONCURRENCY", "OPENAI_TRANSLATION_CONCURRENCY"],
    defaultTranslationConcurrency,
  );
  const failures: Array<{ key: string; error: unknown }> = [];
  let nextEntryIndex = 0;
  let completed = 0;

  async function translateEntry(entryIndex: number) {
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

  async function runWorker(): Promise<void> {
    const entryIndex = nextEntryIndex;
    nextEntryIndex += 1;
    if (entryIndex >= entries.length) return;
    await translateEntry(entryIndex);
    return runWorker();
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
  const maxRetries = readNonNegativeIntegerEnv(
    ["TRANSLATION_MAX_RETRIES", "GEMINI_TRANSLATION_MAX_RETRIES", "OPENAI_TRANSLATION_MAX_RETRIES"],
    defaultTranslationMaxRetries,
  );
  const maxAttempts = maxRetries + 1;

  async function attemptTranslationField(attempt: number): Promise<string> {
    try {
      const result = await getGeminiTranslationClient().models.generateContent({
        model,
        contents: JSON.stringify({
          targetLanguage: language,
          sourceLanguage: defaultLanguage,
          fieldKey: key,
          sourceText: source,
        }),
        config: {
          systemInstruction: buildTranslationSystemInstruction(),
          responseMimeType: "application/json",
          responseSchema: geminiTranslationResponseSchema,
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: maxOutputTokensForField(source),
          abortSignal: AbortSignal.timeout(
            readPositiveIntegerEnv(
              ["TRANSLATION_TIMEOUT_MS", "GEMINI_TRANSLATION_TIMEOUT_MS", "OPENAI_TRANSLATION_TIMEOUT_MS"],
              defaultTranslationTimeoutMs,
            ),
          ),
        },
      });

      const value = parseGeneratedTranslation(result.text).value;
      if (!isValidFieldTranslation(source, value, language)) {
        throw new Error("Generated translation field failed validation");
      }

      return value;
    } catch (error) {
      if (attempt < maxAttempts) {
        console.warn("Retrying main app translation field", {
          language,
          key,
          attempt,
          maxAttempts,
          error: summarizeTranslationError(error),
        });
        await sleep(
          readPositiveIntegerEnv(["TRANSLATION_RETRY_DELAY_MS", "GEMINI_TRANSLATION_RETRY_DELAY_MS"], defaultTranslationRetryDelayMs) *
            attempt,
        );
        return attemptTranslationField(attempt + 1);
      }
      throw error;
    }
  }

  return attemptTranslationField(1);
}

function buildTranslationSystemInstruction() {
  return [
    "You are a meticulous product localization specialist for an education app.",
    "Translate exactly the provided UI text into the target language.",
    "Return only JSON with the translated value in the value field.",
    "Do not add concepts, labels, navigation words, suffixes, prefixes, or explanatory words that are not present in the source text.",
    "Preserve placeholders like {name}, punctuation that belongs with placeholders, markdown markers, and the product name inspir.",
    "Do not translate code identifiers, URLs, class names, or bracketed control markers unless the text is natural visible copy.",
    "Use the field key for context, but never translate or include the key.",
    "Use natural, concise product UI copy, not literal word-for-word text when that would sound awkward.",
    "Prefer consistent education-app terminology across labels, controls, topics, onboarding, quiz, and flashcard copy.",
    "For Hindi, write in natural Devanagari Hindi. Avoid Hinglish except for brand names, common acronyms like AI, or terms that are normally left in English.",
  ].join("\n");
}

function getGeminiTranslationClient() {
  const apiKey = resolveTranslationApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is required for translations.");
  if (!geminiTranslationClient || geminiTranslationClientApiKey !== apiKey) {
    geminiTranslationClient = new GoogleGenAI({ apiKey });
    geminiTranslationClientApiKey = apiKey;
  }
  return geminiTranslationClient;
}

function resolveTranslationApiKey() {
  return readStringEnv(["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]);
}

function parseGeneratedTranslation(text: string | undefined) {
  if (!text?.trim()) throw new Error("Gemini returned an empty translation response");

  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("```") ? stripCodeFence(trimmed) : trimmed;
  return generatedTranslationSchema.parse(JSON.parse(jsonText));
}

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function isValidFieldTranslation(source: string, value: string | undefined, language?: string) {
  if (!value?.trim()) return false;
  const sourcePlaceholders = placeholdersIn(source).sort().join("|");
  const valuePlaceholders = placeholdersIn(value).sort().join("|");
  if (sourcePlaceholders !== valuePlaceholders) return false;
  if (hasLikelyExtraneousTranslationArtifact(source, value, language)) return false;
  if (source.trim() === value.trim() && !canRemainUntranslated(source, language)) return false;
  return true;
}

function hasLikelyExtraneousTranslationArtifact(source: string, value: string, language?: string) {
  if (language !== "Spanish") return false;
  if (/\bvuelta\b/i.test(value) && !/\b(?:again|back|cycle|return|round|turn)\b/i.test(source)) return true;
  if (/\btienda\b/i.test(value) && !/\b(?:shop|store|tent)\b/i.test(source)) return true;
  return false;
}

function isCompleteMainAppTranslationPayload(
  sourceStrings: Record<string, string>,
  translatedStrings: Record<string, string>,
  language?: string,
) {
  return (
    validateTranslationPayload(sourceStrings, translatedStrings) &&
    Object.keys(filterValidTranslations(sourceStrings, translatedStrings, language)).length === Object.keys(sourceStrings).length
  );
}

function filterValidTranslations(
  sourceStrings: Record<string, string>,
  translatedStrings: Record<string, string>,
  language?: string,
) {
  const validTranslations: Record<string, string> = {};
  for (const [key, source] of Object.entries(sourceStrings)) {
    if (isValidFieldTranslation(source, translatedStrings[key], language)) {
      validTranslations[key] = translatedStrings[key];
    }
  }
  return validTranslations;
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

function canRemainUntranslated(source: string, language?: string) {
  const value = source.trim();
  if (!/[A-Za-z]/.test(value)) return true;
  if (value.toLowerCase() === "inspir") return true;
  if (language && languageSpecificIdenticalTranslations[language]?.has(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^\d+\s*[-–]\s*\d+\s*(?:min|mins|minutes|sec|secs|hours?|hrs?)$/i.test(value)) return true;
  if (isProperNameLabel(value)) return true;
  return /^[A-Z0-9][A-Z0-9\s&+./:'-]*$/.test(value) && !/[a-z]/.test(value);
}

function isProperNameLabel(value: string) {
  const normalized = value.replace(/\.{3}$/, "");
  const segments = normalized.split(",").flatMap((segment) => {
    const value = segment.trim();
    return value ? [value] : [];
  });
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

function readPositiveIntegerEnv(names: string | string[], fallback: number) {
  const parsed = Number.parseInt(readStringEnv(names) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeIntegerEnv(names: string | string[], fallback: number) {
  const parsed = Number.parseInt(readStringEnv(names) ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function translationVerboseLogs() {
  return readStringEnv(["TRANSLATION_VERBOSE_LOGS", "GEMINI_TRANSLATION_VERBOSE_LOGS", "OPENAI_TRANSLATION_VERBOSE_LOGS"]) === "true";
}

function readStringEnv(names: string | string[]) {
  const envNames = Array.isArray(names) ? names : [names];
  for (const name of envNames) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
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
