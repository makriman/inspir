import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import type { SupportedLanguage } from "@/lib/content/languages";
import { getMainAppSourceHash, getMainAppSourceStrings, mainAppTranslationNamespace } from "@/lib/i18n/main-app-source";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
  isKnownSiteTranslationNamespace,
} from "@/lib/i18n/site-source";

type CuratedTranslationEntry = {
  key: string;
  source?: string;
  value?: string;
};

type CuratedTranslationPack = {
  schemaVersion?: number;
  language: string;
  namespace: string;
  sourceHash?: string;
  model?: string;
  entries?: CuratedTranslationEntry[];
  translations?: Record<string, string>;
};

type CuratedLanguageBundle = {
  schemaVersion?: number;
  kind?: string;
  language?: string;
  locale?: string;
  namespaces?: Record<
    string,
    {
      sourceHash?: string;
      entries?: CuratedTranslationEntry[];
      translations?: Record<string, string>;
      model?: string;
    }
  >;
};

type LoadedCuratedTranslationPack = {
  filePath: string;
  pack: CuratedTranslationPack;
  language: SupportedLanguage;
  namespace: string;
};

type Args = {
  dir: string;
  languages?: Set<SupportedLanguage>;
  namespaces?: Set<string>;
  files?: Set<string>;
  dryRun: boolean;
  allowPartial: boolean;
  allowStale: boolean;
};

let upsertTranslation:
  | ((input: {
      namespace: string;
      language: string;
      sourceHash: string;
      payload: Record<string, string>;
      model: string;
    }) => Promise<unknown>)
  | undefined;
let sqlConnection: { end(options: { timeout: number }): Promise<void> } | undefined;
let validateFieldTranslation: ((source: string, value: string | undefined, language?: string) => boolean) | undefined;

const explicitEnv = new Set(Object.keys(process.env));
loadEnvFile(".env.local", explicitEnv);
loadEnvFile(".env.vercel.production.local", explicitEnv);
loadEnvFile(".env.production.local", explicitEnv);

main().catch(async (error) => {
  console.error(summarizeError(error));
  await sqlConnection?.end({ timeout: 5 });
  process.exit(1);
});

async function main() {
  const queries = await import("@/lib/db/queries");
  const client = await import("@/lib/db/client");
  const validation = await import("@/lib/i18n/translation-field-validation");
  upsertTranslation = queries.upsertAppTranslation;
  sqlConnection = client.sql;
  validateFieldTranslation = validation.isValidFieldTranslation;

  const args = parseArgs(process.argv.slice(2));
  const files = collectJsonFiles(resolve(process.cwd(), args.dir));
  const groups = groupLoadedPacks(files.flatMap((filePath) => loadPack(filePath, args) ?? []));
  const results = [];
  let hasFailure = false;

  try {
    for (const group of groups) {
      const result = await importPackGroup(group, args);
      results.push(result);
      if (!result.ok) hasFailure = true;
      console.log(JSON.stringify({ event: "curated_translation_pack_checked", ...result }));
    }
  } finally {
    await sqlConnection?.end({ timeout: 5 });
  }

  console.log(
    JSON.stringify({
      event: "curated_translation_import_complete",
      dryRun: args.dryRun,
      checked: results.length,
      imported: results.filter((result) => result.imported).length,
      failed: results.filter((result) => !result.ok).length,
    }),
  );

  if (hasFailure) process.exitCode = 1;
}

function loadPack(filePath: string, args: Args): LoadedCuratedTranslationPack[] | null {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as CuratedTranslationPack | CuratedLanguageBundle;
  if (isCuratedLanguageBundle(parsed)) return loadLanguageBundle(filePath, parsed, args);

  const pack = parsed as CuratedTranslationPack;
  const language = normalizeLanguage(pack.language);
  const namespace = pack.namespace?.trim();

  if (language === defaultLanguage) return null;
  if (args.languages && !args.languages.has(language)) return null;
  if (args.namespaces && !args.namespaces.has(namespace)) return null;
  if (args.files && !args.files.has(filePath)) return null;

  return [{ filePath, pack, language, namespace }];
}

function loadLanguageBundle(
  filePath: string,
  bundle: CuratedLanguageBundle,
  args: Args,
): LoadedCuratedTranslationPack[] | null {
  const language = normalizeLanguage(bundle.language ?? "");
  if (language === defaultLanguage) return null;
  if (args.languages && !args.languages.has(language)) return null;
  if (args.files && !args.files.has(filePath)) return null;

  const loaded: LoadedCuratedTranslationPack[] = [];
  for (const [namespace, namespacePack] of Object.entries(bundle.namespaces ?? {})) {
    const normalizedNamespace = namespace.trim();
    if (args.namespaces && !args.namespaces.has(normalizedNamespace)) continue;

    loaded.push({
      filePath,
      language,
      namespace: normalizedNamespace,
      pack: {
        schemaVersion: bundle.schemaVersion,
        language,
        namespace: normalizedNamespace,
        sourceHash: namespacePack.sourceHash,
        model: namespacePack.model,
        entries: namespacePack.entries,
        translations: namespacePack.translations,
      },
    });
  }

  return loaded;
}

function isCuratedLanguageBundle(value: CuratedTranslationPack | CuratedLanguageBundle): value is CuratedLanguageBundle {
  return "namespaces" in value && value.kind === "curated-language-bundle";
}

function groupLoadedPacks(packs: LoadedCuratedTranslationPack[]) {
  const groups = new Map<string, LoadedCuratedTranslationPack[]>();
  for (const pack of packs) {
    const key = `${pack.language}\u0000${pack.namespace}`;
    const group = groups.get(key);
    if (group) group.push(pack);
    else groups.set(key, [pack]);
  }
  return Array.from(groups.values());
}

async function importPackGroup(group: LoadedCuratedTranslationPack[], args: Args) {
  const [{ language, namespace }] = group;

  const source = sourceForNamespace(namespace);
  const invalid: Array<{ key: string; source: string; value: string }> = [];
  const unknownKeys: string[] = [];
  const conflictKeys: string[] = [];
  const staleFiles: string[] = [];
  const validPayload: Record<string, string> = {};
  const valuesByKey = new Map<string, string>();

  for (const { filePath, pack } of group) {
    const translations = translationsFromPack(pack);
    const entrySourceByKey = new Map((pack.entries ?? []).map((entry) => [entry.key, entry.source]));
    if (pack.sourceHash && pack.sourceHash !== source.sourceHash) staleFiles.push(filePath);

    for (const [key, value] of Object.entries(translations)) {
      const sourceText = source.sourceStrings[key];
      if (!sourceText) {
        unknownKeys.push(key);
        continue;
      }

      const entrySource = entrySourceByKey.get(key);
      if (entrySource && entrySource !== sourceText && !args.allowStale) {
        invalid.push({ key, source: sourceText, value });
        continue;
      }

      if (!validateFieldTranslation?.(sourceText, value, language)) {
        invalid.push({ key, source: sourceText, value });
        continue;
      }

      const previousValue = valuesByKey.get(key);
      if (previousValue && previousValue !== value) {
        conflictKeys.push(key);
        continue;
      }

      valuesByKey.set(key, value);
      validPayload[key] = value;
    }
  }

  const totalCount = Object.keys(source.sourceStrings).length;
  const translatedCount = Object.keys(validPayload).length;
  const missingCount = totalCount - translatedCount;
  const staleSourceHash = staleFiles.length > 0;
  const ok =
    !unknownKeys.length &&
    !invalid.length &&
    !conflictKeys.length &&
    (!staleSourceHash || args.allowStale) &&
    (args.allowPartial || missingCount === 0);

  if (ok && !args.dryRun) {
    if (!upsertTranslation) throw new Error("Translation importer was not initialized.");
    await upsertTranslation({
      namespace,
      language,
      sourceHash: source.sourceHash,
      payload: validPayload,
      model: group.find(({ pack }) => pack.model?.trim())?.pack.model?.trim() || "curated-codex-v1",
    });
  }

  return {
    ok,
    imported: ok && !args.dryRun,
    language,
    namespace,
    files: group.map(({ filePath }) => filePath),
    translatedCount,
    totalCount,
    missingCount,
    staleSourceHash,
    staleFiles: staleFiles.slice(0, 10),
    unknownKeys: unknownKeys.slice(0, 10),
    conflictKeys: Array.from(new Set(conflictKeys)).slice(0, 10),
    invalid: invalid.slice(0, 10),
  };
}

function summarizeError(error: unknown) {
  if (!(error instanceof Error)) return error;
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  return {
    name: error.name,
    message: truncateErrorMessage(error.message),
    cause: cause ? { code: cause.code, message: cause.message } : undefined,
  };
}

function truncateErrorMessage(message: string) {
  const withoutParams = message.split("\nparams:")[0] ?? message;
  return withoutParams.length > 1000 ? `${withoutParams.slice(0, 1000)}...` : withoutParams;
}

function sourceForNamespace(namespace: string) {
  if (namespace === mainAppTranslationNamespace) {
    const sourceStrings = getMainAppSourceStrings();
    return {
      sourceHash: getMainAppSourceHash(sourceStrings),
      sourceStrings,
    };
  }

  if (!isKnownSiteTranslationNamespace(namespace)) {
    throw new Error(`Unsupported translation namespace: ${namespace}`);
  }

  return getSiteTranslationSource(namespace);
}

function translationsFromPack(pack: CuratedTranslationPack) {
  const translations: Record<string, string> = {};

  for (const [key, value] of Object.entries(pack.translations ?? {})) {
    if (typeof value === "string" && value.trim()) translations[key] = value;
  }

  for (const entry of pack.entries ?? []) {
    if (entry.key && typeof entry.value === "string" && entry.value.trim()) {
      translations[entry.key] = entry.value;
    }
  }

  return translations;
}

function collectJsonFiles(root: string) {
  if (!existsSync(root)) throw new Error(`Curated translation directory does not exist: ${root}`);
  const files: string[] = [];
  collect(root, files);
  return files.sort();
}

function collect(path: string, files: string[]) {
  const stats = statSync(path);
  if (stats.isFile()) {
    if (path.endsWith(".json")) files.push(path);
    return;
  }
  if (!stats.isDirectory()) return;

  for (const entry of readdirSync(path)) {
    collect(`${path}/${entry}`, files);
  }
}

function parseArgs(rawArgs: string[]): Args {
  let dir = "translations/curated";
  let dryRun = false;
  let allowPartial = false;
  let allowStale = false;
  const languages: string[] = [];
  const namespaces: string[] = [];
  const files: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--dir") {
      dir = rawArgs[index + 1] ?? dir;
      index += 1;
    } else if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (arg === "--languages") {
      languages.push(...splitCsv(rawArgs[index + 1] ?? ""));
      index += 1;
    } else if (arg.startsWith("--languages=")) {
      languages.push(...splitCsv(arg.slice("--languages=".length)));
    } else if (arg === "--namespace") {
      namespaces.push(rawArgs[index + 1] ?? "");
      index += 1;
    } else if (arg.startsWith("--namespace=")) {
      namespaces.push(arg.slice("--namespace=".length));
    } else if (arg === "--file") {
      files.push(rawArgs[index + 1] ?? "");
      index += 1;
    } else if (arg.startsWith("--file=")) {
      files.push(arg.slice("--file=".length));
    } else if (arg === "--all-namespaces") {
      namespaces.push(mainAppTranslationNamespace, ...getAllSiteTranslationNamespaces());
    } else if (arg === "--dry-run" || arg === "--verify") {
      dryRun = true;
    } else if (arg === "--allow-partial") {
      allowPartial = true;
    } else if (arg === "--allow-stale") {
      allowStale = true;
    }
  }

  return {
    dir,
    languages: languages.length ? new Set(languages.map((language) => normalizeLanguage(language))) : undefined,
    namespaces: namespaces.length ? new Set(normalizeRequestedNamespaces(namespaces)) : undefined,
    files: normalizeRequestedFiles(files),
    dryRun,
    allowPartial,
    allowStale,
  };
}

function normalizeRequestedNamespaces(namespaces: string[]) {
  return namespaces.map((namespace) => {
    const value = namespace.trim();
    if (value !== mainAppTranslationNamespace && !isKnownSiteTranslationNamespace(value)) {
      throw new Error(`Unsupported translation namespace: ${namespace}`);
    }
    return value;
  });
}

function normalizeRequestedFiles(files: string[]) {
  const normalized = files
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => resolve(process.cwd(), file));
  return normalized.length ? new Set(normalized) : undefined;
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
    return value.slice(1, -1);
  }
  return value;
}
