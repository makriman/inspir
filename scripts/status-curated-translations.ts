import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  defaultLanguage,
  languageConfigs,
  normalizeLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getCuratedTranslationBundle } from "@/lib/i18n/curated-translations";
import { getMainAppSourceHash, getMainAppSourceStrings, mainAppTranslationNamespace } from "@/lib/i18n/main-app-source";
import { getAllSiteTranslationNamespaces, getSiteTranslationSource, isKnownSiteTranslationNamespace } from "@/lib/i18n/site-source";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import type { TranslationSource } from "@/lib/i18n/translation-types";

type Args = {
  languages: SupportedLanguage[];
  namespaces: string[];
};

const args = parseArgs(process.argv.slice(2));
const byNamespace: Record<string, { complete: number; incomplete: number; total: number }> = {};
const incomplete: Array<{
  namespace: string;
  language: SupportedLanguage;
  translatedCount: number;
  totalCount: number;
  sourceHashFresh: boolean;
}> = [];
let complete = 0;

for (const namespace of args.namespaces) {
  const source = sourceForNamespace(namespace);
  byNamespace[namespace] = { complete: 0, incomplete: 0, total: args.languages.length };
  for (const language of args.languages) {
    const bundle = getCuratedTranslationBundle(source, language);
    if (bundle) {
      complete += 1;
      byNamespace[namespace].complete += 1;
      continue;
    }
    const partial = getCuratedTranslationPartial(source, language);
    byNamespace[namespace].incomplete += 1;
    incomplete.push({
      namespace,
      language,
      translatedCount: partial.translatedCount,
      totalCount: Object.keys(source.sourceStrings).length,
      sourceHashFresh: partial.sourceHashFresh,
    });
  }
}

console.log(
  JSON.stringify({
    event: "curated_translation_status_complete",
    complete,
    incompleteCount: incomplete.length,
    byNamespace,
    total: args.languages.length * args.namespaces.length,
    incomplete: incomplete.slice(0, 120),
    incompleteTruncated: incomplete.length > 120,
  }),
);

function sourceForNamespace(namespace: string): TranslationSource {
  if (namespace === mainAppTranslationNamespace) {
    const sourceStrings = getMainAppSourceStrings();
    return {
      namespace,
      sourceHash: getMainAppSourceHash(sourceStrings),
      sourceStrings,
    };
  }

  if (!isKnownSiteTranslationNamespace(namespace)) throw new Error(`Unsupported translation namespace: ${namespace}`);
  return getSiteTranslationSource(namespace);
}

function parseArgs(rawArgs: string[]): Args {
  const languages: string[] = [];
  const namespaces: string[] = [];
  let allLanguages = false;
  let allNamespaces = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--languages") {
      languages.push(...splitCsv(rawArgs[index + 1] ?? ""));
      index += 1;
    } else if (arg.startsWith("--languages=")) {
      languages.push(...splitCsv(arg.slice("--languages=".length)));
    } else if (arg === "--all-languages") {
      allLanguages = true;
    } else if (arg === "--namespace") {
      namespaces.push(rawArgs[index + 1] ?? "");
      index += 1;
    } else if (arg.startsWith("--namespace=")) {
      namespaces.push(arg.slice("--namespace=".length));
    } else if (arg === "--all-namespaces") {
      allNamespaces = true;
    }
  }

  return {
    languages: normalizeRequestedLanguages(allLanguages ? [...supportedLanguages] : languages),
    namespaces: normalizeRequestedNamespaces(
      allNamespaces ? [mainAppTranslationNamespace, ...getAllSiteTranslationNamespaces()] : namespaces,
    ),
  };
}

function normalizeRequestedLanguages(languages: string[]) {
  const requested = new Set<SupportedLanguage>();
  for (const language of languages) {
    const normalized = normalizeLanguage(language);
    if (normalized !== defaultLanguage) requested.add(normalized);
  }
  if (!requested.size) throw new Error("Pass --languages=Hindi,Spanish or --all-languages.");
  return Array.from(requested);
}

function normalizeRequestedNamespaces(namespaces: string[]) {
  const requested = new Set<string>();
  for (const namespace of namespaces) {
    const value = namespace.trim();
    if (!value) continue;
    if (value !== mainAppTranslationNamespace && !isKnownSiteTranslationNamespace(value)) {
      throw new Error(`Unsupported translation namespace: ${namespace}`);
    }
    requested.add(value);
  }
  if (!requested.size) throw new Error("Pass --namespace=main-app or --all-namespaces.");
  return Array.from(requested);
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

type CuratedTranslationPack = {
  language?: string;
  namespace?: string;
  sourceHash?: string;
  translations?: Record<string, string>;
  entries?: Array<{
    key?: string;
    source?: string;
    value?: string;
  }>;
};

function getCuratedTranslationPartial(source: TranslationSource, language: SupportedLanguage) {
  const files = curatedPackFiles(language, source.namespace);
  const valuesByKey = new Map<string, string>();
  let staleFiles = 0;

  for (const file of files) {
    const pack = JSON.parse(readFileSync(file, "utf8")) as CuratedTranslationPack;
    if (pack.language !== language || pack.namespace !== source.namespace) continue;
    if (pack.sourceHash !== source.sourceHash) staleFiles += 1;

    for (const [key, value] of Object.entries(pack.translations ?? {})) {
      const sourceText = source.sourceStrings[key];
      if (sourceText && isValidFieldTranslation(sourceText, value, language)) valuesByKey.set(key, value);
    }

    for (const entry of pack.entries ?? []) {
      if (!entry.key) continue;
      const sourceText = source.sourceStrings[entry.key];
      if (sourceText && isValidFieldTranslation(sourceText, entry.value, language)) {
        valuesByKey.set(entry.key, entry.value ?? "");
      }
    }
  }

  return {
    translatedCount: valuesByKey.size,
    sourceHashFresh: files.length > 0 && staleFiles === 0,
  };
}

function curatedPackFiles(language: SupportedLanguage, namespace: string) {
  const languageDir = join(resolve(process.cwd(), "translations/curated"), languageConfigs[language].prefix || languageConfigs[language].locale);
  if (!existsSync(languageDir)) return [];

  const safeNamespace = namespace.replace(/[^a-z0-9.-]+/gi, "__");
  return readdirSync(languageDir)
    .filter((file) => file === `${safeNamespace}.json` || file.startsWith(`${safeNamespace}.part-`))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => join(languageDir, file));
}
