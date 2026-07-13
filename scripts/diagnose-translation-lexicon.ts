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

type LexiconEntry = {
  source?: string;
  value?: string;
};

type LexiconPack = {
  kind?: string;
  language?: string;
  entries?: LexiconEntry[];
};

type SourceBundle = {
  namespace: string;
  sourceHash: string;
  sourceStrings: Record<string, string>;
};

type InvalidEntry = {
  source: string;
  currentValue: string;
  refs: Array<{
    namespace: string;
    key: string;
  }>;
};

type Args = {
  inDir: string;
  outDir: string;
  languages: SupportedLanguage[];
  namespaces: string[];
};

const args = parseArgs(process.argv.slice(2));
let hasInvalid = false;

for (const language of args.languages) {
  const lexicon = readLexicon(args.inDir, language);
  const invalid = invalidEntriesForLanguage(lexicon, language, args.namespaces);
  const outputPath = diagnosticPath(args.outDir, language);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        language,
        count: invalid.length,
        entries: invalid,
      },
      null,
      2,
    )}\n`,
  );

  if (invalid.length) hasInvalid = true;
  console.log(JSON.stringify({ event: "translation_lexicon_diagnostics", language, outputPath, invalid: invalid.length }));
}

if (hasInvalid) process.exitCode = 1;

function invalidEntriesForLanguage(lexicon: LexiconPack, language: SupportedLanguage, namespaces: string[]) {
  const valueBySource = new Map<string, string>();
  for (const entry of lexicon.entries ?? []) {
    if (entry.source?.trim()) valueBySource.set(entry.source, entry.value ?? "");
  }

  const invalidBySource = new Map<string, InvalidEntry>();
  for (const source of namespaces.map(sourceForNamespace)) {
    for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
      const currentValue = valueBySource.get(sourceText) ?? "";
      if (isValidFieldTranslation(sourceText, currentValue, language, key)) continue;
      const existing =
        invalidBySource.get(sourceText) ??
        ({
          source: sourceText,
          currentValue,
          refs: [],
        } satisfies InvalidEntry);
      existing.refs.push({ namespace: source.namespace, key });
      invalidBySource.set(sourceText, existing);
    }
  }

  return Array.from(invalidBySource.values()).sort((a, b) => a.source.localeCompare(b.source));
}

function readLexicon(rootDir: string, language: SupportedLanguage) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const filePath = join(resolve(process.cwd(), rootDir), locale, "lexicon.json");
  if (!existsSync(filePath)) throw new Error(`Missing lexicon file: ${filePath}`);
  const lexicon = JSON.parse(readFileSync(filePath, "utf8")) as LexiconPack;
  if (lexicon.kind !== "translation-lexicon" || normalizeLanguage(lexicon.language ?? "") !== language) {
    throw new Error(`Invalid lexicon for ${language}: ${filePath}`);
  }
  return lexicon;
}

function diagnosticPath(rootDir: string, language: SupportedLanguage) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  return join(resolve(process.cwd(), rootDir), locale, "invalid.json");
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

function parseArgs(rawArgs: string[]): Args {
  const languages: string[] = [];
  const namespaces: string[] = [];
  let inDir = "translations/workbench";
  let outDir = "translations/workbench-diagnostics";
  let allNamespaces = false;

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
    }
  }

  return {
    inDir,
    outDir,
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
