import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { languageConfigs, normalizeLanguage, type SupportedLanguage } from "@/lib/content/languages";
import { getMainAppSourceHash, getMainAppSourceStrings, mainAppTranslationNamespace } from "@/lib/i18n/main-app-source";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
  isKnownSiteTranslationNamespace,
} from "@/lib/i18n/site-source";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";

type SourceBundle = {
  namespace: string;
  sourceHash: string;
  sourceStrings: Record<string, string>;
};

type LexiconPack = {
  schemaVersion?: number;
  kind?: string;
  language?: string;
  namespaces?: Record<string, { sourceHash?: string }>;
  entries?: Array<{
    source?: string;
    value?: string;
  }>;
};

type CuratedTranslationPack = {
  schemaVersion: 1;
  language: SupportedLanguage;
  locale: string;
  namespace: string;
  sourceHash: string;
  entries: Array<{
    key: string;
    source: string;
    value: string;
  }>;
};

type Args = {
  inDir: string;
  outDir: string;
  languages: SupportedLanguage[];
  namespaces: string[];
  allowPartial: boolean;
};

const args = parseArgs(process.argv.slice(2));
let hasFailure = false;

for (const language of args.languages) {
  const lexicon = readLexicon(args.inDir, language);
  const values = valuesFromLexicon(lexicon, language);

  for (const namespace of args.namespaces) {
    const source = sourceForNamespace(namespace);
    const staleSourceHash = lexicon.namespaces?.[namespace]?.sourceHash !== source.sourceHash;
    const entries: CuratedTranslationPack["entries"] = [];
    const missing: string[] = [];
    const invalid: Array<{ key: string; source: string; value?: string }> = [];

    for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
      const value = values.get(sourceText);
      if (!value?.trim()) {
        missing.push(key);
        continue;
      }
      if (!isValidFieldTranslation(sourceText, value, language, key)) {
        invalid.push({ key, source: sourceText, value });
        continue;
      }
      entries.push({ key, source: sourceText, value });
    }

    const ok = !staleSourceHash && !invalid.length && (args.allowPartial || !missing.length);
    if (!ok) hasFailure = true;
    if (!entries.length) {
      console.log(
        JSON.stringify({
          event: "curated_from_lexicon_skipped",
          language,
          namespace,
          staleSourceHash,
          missingCount: missing.length,
          invalidCount: invalid.length,
        }),
      );
      continue;
    }

    const pack: CuratedTranslationPack = {
      schemaVersion: 1,
      language,
      locale: languageConfigs[language].locale,
      namespace,
      sourceHash: source.sourceHash,
      entries,
    };
    const outputPath = packPath(args.outDir, language, namespace);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(pack, null, 2)}\n`);
    console.log(
      JSON.stringify({
        event: "curated_from_lexicon_written",
        language,
        namespace,
        outputPath,
        entries: entries.length,
        totalEntries: Object.keys(source.sourceStrings).length,
        complete: entries.length === Object.keys(source.sourceStrings).length,
        staleSourceHash,
        missingCount: missing.length,
        invalidCount: invalid.length,
      }),
    );
  }
}

if (hasFailure) process.exitCode = 1;

function readLexicon(rootDir: string, language: SupportedLanguage) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const filePath = join(resolve(process.cwd(), rootDir), locale, "lexicon.json");
  if (!existsSync(filePath)) throw new Error(`Missing lexicon file: ${filePath}`);
  const pack = JSON.parse(readFileSync(filePath, "utf8")) as LexiconPack;
  if (pack.kind !== "translation-lexicon" || normalizeLanguage(pack.language ?? "") !== language) {
    throw new Error(`Invalid lexicon for ${language}: ${filePath}`);
  }
  return pack;
}

function valuesFromLexicon(lexicon: LexiconPack, language: SupportedLanguage) {
  const values = new Map<string, string>();
  for (const entry of lexicon.entries ?? []) {
    if (!entry.source?.trim() || !entry.value?.trim()) continue;
    if (isValidFieldTranslation(entry.source, entry.value, language)) values.set(entry.source, entry.value);
  }
  return values;
}

function sourceForNamespace(namespace: string): SourceBundle {
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

function packPath(rootDir: string, language: SupportedLanguage, namespace: string) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  return join(resolve(process.cwd(), rootDir), locale, `${namespace.replace(/[^a-z0-9.-]+/gi, "__")}.json`);
}

function parseArgs(rawArgs: string[]): Args {
  const languages: string[] = [];
  const namespaces: string[] = [];
  let inDir = "translations/workbench";
  let outDir = "translations/curated";
  let allNamespaces = false;
  let allowPartial = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--in-dir") {
      inDir = rawArgs[index + 1] ?? inDir;
      index += 1;
    } else if (arg.startsWith("--in-dir=")) {
      inDir = arg.slice("--in-dir=".length);
    } else if (arg === "--out-dir") {
      outDir = rawArgs[index + 1] ?? outDir;
      index += 1;
    } else if (arg.startsWith("--out-dir=")) {
      outDir = arg.slice("--out-dir=".length);
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
    } else if (arg === "--all-namespaces") {
      allNamespaces = true;
    } else if (arg === "--allow-partial") {
      allowPartial = true;
    }
  }

  return {
    inDir,
    outDir,
    allowPartial,
    languages: normalizeRequestedLanguages(languages),
    namespaces: normalizeRequestedNamespaces(
      allNamespaces ? [mainAppTranslationNamespace, ...getAllSiteTranslationNamespaces()] : namespaces,
    ),
  };
}

function normalizeRequestedLanguages(languages: string[]) {
  const requested = new Set<SupportedLanguage>();
  for (const language of languages) requested.add(normalizeLanguage(language));
  if (!requested.size) throw new Error("Pass --languages=Hindi,Spanish.");
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
