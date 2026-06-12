import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  defaultLanguage,
  languageConfigs,
  normalizeLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
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

type LexiconEntry = {
  source: string;
  value: string;
  refs: Array<{
    namespace: string;
    key: string;
  }>;
};

type LexiconPack = {
  schemaVersion: 1;
  kind: "translation-lexicon";
  language: SupportedLanguage;
  locale: string;
  namespaces: Record<string, { sourceHash: string }>;
  entries: LexiconEntry[];
};

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

type Args = {
  dir: string;
  outDir: string;
  languages: SupportedLanguage[];
  namespaces: string[];
  missingOnly: boolean;
};

const args = parseArgs(process.argv.slice(2));
const sources = args.namespaces.map(sourceForNamespace);

for (const language of args.languages) {
  const existingBySource = readExistingTranslationsBySource(args.dir, language, sources);
  const entriesBySource = new Map<string, LexiconEntry>();
  const namespaces = Object.fromEntries(sources.map((source) => [source.namespace, { sourceHash: source.sourceHash }]));

  for (const source of sources) {
    for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
      const existingValue = existingBySource.get(sourceText) ?? "";
      if (args.missingOnly && existingValue) continue;

      const entry =
        entriesBySource.get(sourceText) ??
        ({
          source: sourceText,
          value: existingValue,
          refs: [],
        } satisfies LexiconEntry);
      entry.refs.push({ namespace: source.namespace, key });
      entriesBySource.set(sourceText, entry);
    }
  }

  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const pack: LexiconPack = {
    schemaVersion: 1,
    kind: "translation-lexicon",
    language,
    locale: languageConfigs[language].locale,
    namespaces,
    entries: Array.from(entriesBySource.values()).sort((a, b) => a.source.localeCompare(b.source)),
  };
  const outputPath = join(resolve(process.cwd(), args.outDir), locale, "lexicon.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(
    JSON.stringify({
      event: "translation_lexicon_exported",
      language,
      outputPath,
      entries: pack.entries.length,
      missingOnly: args.missingOnly,
      namespaces: Object.keys(namespaces).length,
    }),
  );
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

function readExistingTranslationsBySource(rootDir: string, language: SupportedLanguage, sources: SourceBundle[]) {
  const values = new Map<string, string>();
  const sourceByNamespaceKey = new Map<string, string>();
  for (const source of sources) {
    for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
      sourceByNamespaceKey.set(`${source.namespace}\u0000${key}`, sourceText);
    }
  }

  const languageDir = join(resolve(process.cwd(), rootDir), languageConfigs[language].prefix || languageConfigs[language].locale);
  if (!existsSync(languageDir)) return values;

  for (const file of readdirSync(languageDir).filter((item) => item.endsWith(".json"))) {
    const pack = JSON.parse(readFileSync(join(languageDir, file), "utf8")) as CuratedTranslationPack;
    if (pack.language !== language || !pack.namespace) continue;

    for (const entry of pack.entries ?? []) {
      if (!entry.key || typeof entry.value !== "string" || !entry.value.trim()) continue;
      const sourceText = entry.source ?? sourceByNamespaceKey.get(`${pack.namespace}\u0000${entry.key}`);
      if (sourceText && isValidFieldTranslation(sourceText, entry.value, language)) values.set(sourceText, entry.value);
    }

    for (const [key, value] of Object.entries(pack.translations ?? {})) {
      if (typeof value !== "string" || !value.trim()) continue;
      const sourceText = sourceByNamespaceKey.get(`${pack.namespace}\u0000${key}`);
      if (sourceText && isValidFieldTranslation(sourceText, value, language)) values.set(sourceText, value);
    }
  }

  return values;
}

function parseArgs(rawArgs: string[]): Args {
  const languages: string[] = [];
  const namespaces: string[] = [];
  let allLanguages = false;
  let allNamespaces = false;
  let dir = "translations/curated";
  let outDir = "translations/workbench";
  let missingOnly = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--dir") {
      dir = rawArgs[index + 1] ?? dir;
      index += 1;
    } else if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
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
    } else if (arg === "--all-languages") {
      allLanguages = true;
    } else if (arg === "--namespace") {
      namespaces.push(rawArgs[index + 1] ?? "");
      index += 1;
    } else if (arg.startsWith("--namespace=")) {
      namespaces.push(arg.slice("--namespace=".length));
    } else if (arg === "--all-namespaces") {
      allNamespaces = true;
    } else if (arg === "--missing-only") {
      missingOnly = true;
    }
  }

  return {
    dir,
    outDir,
    missingOnly,
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
