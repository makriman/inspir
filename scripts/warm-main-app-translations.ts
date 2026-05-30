import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const defaultLanguages = ["Hindi", "Kannada", "Tamil", "Malayalam", "Arabic", "Spanish", "Telugu"];
const explicitEnv = new Set(Object.keys(process.env));

loadEnvFile(".env.local", explicitEnv);
loadEnvFile(".env.vercel.production.local", explicitEnv);

if (!process.env.OPENAI_TRANSLATION_MODEL?.trim()) {
  process.env.OPENAI_TRANSLATION_MODEL =
    process.env.OPENAI_FAST_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
}
process.env.OPENAI_TRANSLATION_BATCH_SIZE ??= "48";
process.env.OPENAI_TRANSLATION_CONCURRENCY ??= "4";
process.env.OPENAI_TRANSLATION_MAX_RETRIES ??= "2";

let sqlConnection: { end(options: { timeout: number }): Promise<void> } | undefined;
let getTranslationResult:
  | ((
      language: string,
    ) => Promise<{
      complete: boolean;
      translatedCount: number;
      totalCount: number;
      retryAfterMs?: number;
    }>)
  | undefined;
type SupportedLanguage = string;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required.");

  const { defaultLanguage, supportedLanguages } = await import("@/lib/content/languages");
  const { getOrCreateMainAppTranslationResult } = await import("@/lib/i18n/main-app-translations");
  const { sql } = await import("@/lib/db/client");
  sqlConnection = sql;
  getTranslationResult = getOrCreateMainAppTranslationResult;

  const { languages, languageConcurrency } = parseArgs(process.argv.slice(2), {
    defaultLanguage,
    supportedLanguages,
  });
  const startedAt = Date.now();

  console.log(
    JSON.stringify({
      event: "translation_warmup_start",
      languages,
      languageConcurrency,
      model: process.env.OPENAI_TRANSLATION_MODEL,
      batchSize: process.env.OPENAI_TRANSLATION_BATCH_SIZE,
      fieldConcurrency: process.env.OPENAI_TRANSLATION_CONCURRENCY,
    }),
  );

  const results = await runWithConcurrency(languages, languageConcurrency, warmLanguage);
  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

  console.log(
    JSON.stringify({
      event: "translation_warmup_complete",
      durationSeconds,
      results,
    }),
  );
}

async function warmLanguage(language: SupportedLanguage) {
  let previousCount = -1;
  let stalledRounds = 0;
  let rounds = 0;

  while (true) {
    rounds += 1;
    const startedAt = Date.now();
    if (!getTranslationResult) throw new Error("Translation warmup was not initialized.");
    const result = await getTranslationResult(language);
    const durationMs = Date.now() - startedAt;
    const added = previousCount < 0 ? result.translatedCount : Math.max(0, result.translatedCount - previousCount);

    console.log(
      JSON.stringify({
        event: "translation_language_progress",
        language,
        round: rounds,
        translatedCount: result.translatedCount,
        totalCount: result.totalCount,
        added,
        complete: result.complete,
        durationMs,
      }),
    );

    if (result.complete) {
      return {
        language,
        translatedCount: result.translatedCount,
        totalCount: result.totalCount,
        rounds,
      };
    }

    if (result.translatedCount <= previousCount) stalledRounds += 1;
    else stalledRounds = 0;

    if (stalledRounds >= 12) {
      throw new Error(`${language} translation warmup stalled at ${result.translatedCount}/${result.totalCount}.`);
    }

    previousCount = result.translatedCount;
    await sleep(result.retryAfterMs ?? 1500);
  }
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const itemIndex = nextIndex;
      nextIndex += 1;
      results[itemIndex] = await worker(items[itemIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

function parseArgs(
  args: string[],
  languageConfig: {
    defaultLanguage: string;
    supportedLanguages: readonly string[];
  },
) {
  const languages: string[] = [];
  let languageConcurrency = readPositiveInteger(process.env.TRANSLATION_WARMUP_LANGUAGE_CONCURRENCY, 2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--language-concurrency") {
      languageConcurrency = readPositiveInteger(args[index + 1], languageConcurrency);
      index += 1;
    } else if (arg.startsWith("--language-concurrency=")) {
      languageConcurrency = readPositiveInteger(arg.slice("--language-concurrency=".length), languageConcurrency);
    } else if (arg === "--languages") {
      languages.push(...splitLanguages(args[index + 1] ?? ""));
      index += 1;
    } else if (arg.startsWith("--languages=")) {
      languages.push(...splitLanguages(arg.slice("--languages=".length)));
    } else if (!arg.startsWith("--")) {
      languages.push(...splitLanguages(arg));
    }
  }

  return {
    languages: normalizeRequestedLanguages(languages.length ? languages : defaultLanguages, languageConfig),
    languageConcurrency,
  };
}

function normalizeRequestedLanguages(
  languages: string[],
  {
    defaultLanguage,
    supportedLanguages,
  }: {
    defaultLanguage: string;
    supportedLanguages: readonly string[];
  },
) {
  const requested = new Set<SupportedLanguage>();

  for (const language of languages) {
    const match = supportedLanguages.find((supportedLanguage) => supportedLanguage === language.trim());
    if (!match) throw new Error(`Unsupported language: ${language}`);
    if (match !== defaultLanguage) requested.add(match);
  }

  return Array.from(requested);
}

function splitLanguages(value: string) {
  return value
    .split(",")
    .map((language) => language.trim())
    .filter(Boolean);
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadEnvFile(filename: string, protectedKeys: Set<string>) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (protectedKeys.has(key)) continue;
    const value = parseEnvValue(rawValue);
    if (value) process.env[key] = value;
  }
}

function parseEnvValue(rawValue: string) {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\n/g, "\n");
  }
  return value.replace(/\s+#.*$/, "");
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sqlConnection?.end({ timeout: 5 });
  });
