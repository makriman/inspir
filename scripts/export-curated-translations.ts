import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defaultLanguage, languageConfigs, normalizeLanguage, supportedLanguages } from "@/lib/content/languages";
import { getMainAppSourceHash, getMainAppSourceStrings, mainAppTranslationNamespace } from "@/lib/i18n/main-app-source";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
  isKnownSiteTranslationNamespace,
} from "@/lib/i18n/site-source";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import type { SupportedLanguage } from "@/lib/content/languages";

type CuratedTranslationEntry = {
  key: string;
  source: string;
  value: string;
};

type CuratedTranslationPack = {
  schemaVersion: 1;
  language: SupportedLanguage;
  locale: string;
  namespace: string;
  sourceHash: string;
  part?: {
    index: number;
    total: number;
  };
  entries: CuratedTranslationEntry[];
};

type Args = {
  dir: string;
  languages: SupportedLanguage[];
  namespaces: string[];
  force: boolean;
  missingOnly: boolean;
  chunkSize?: number;
};

const args = parseArgs(process.argv.slice(2));

for (const language of args.languages) {
  for (const namespace of args.namespaces) {
    const source = sourceForNamespace(namespace);
    const existingValues = args.force
      ? new Map<string, string>()
      : readExistingValuesForNamespace(args.dir, language, namespace, source.sourceStrings);
    const sourceEntries = Object.entries(source.sourceStrings).filter(([key]) => {
      return !args.missingOnly || !existingValues.has(key);
    });

    if (!sourceEntries.length) {
      console.log(
        JSON.stringify({
          event: "curated_translation_export_no_missing",
          language,
          namespace,
          totalEntries: Object.keys(source.sourceStrings).length,
          existingEntries: existingValues.size,
        }),
      );
      continue;
    }

    const entryChunks = args.chunkSize ? chunkArray(sourceEntries, args.chunkSize) : [sourceEntries];
    const forcePartFiles = args.missingOnly && basePackExists(args.dir, language, namespace);

    for (let chunkIndex = 0; chunkIndex < entryChunks.length; chunkIndex += 1) {
      const filePath = packPath(
        args.dir,
        language,
        namespace,
        entryChunks.length > 1 || forcePartFiles ? chunkIndex : undefined,
        entryChunks.length > 1 ? entryChunks.length : forcePartFiles ? 1 : undefined,
      );
      const pack: CuratedTranslationPack = {
        schemaVersion: 1,
        language,
        locale: languageConfigs[language].locale,
        namespace,
        sourceHash: source.sourceHash,
        ...(entryChunks.length > 1
          ? {
              part: {
                index: chunkIndex + 1,
                total: entryChunks.length,
              },
            }
          : {}),
        entries: entryChunks[chunkIndex].map(([key, sourceText]) => ({
          key,
          source: sourceText,
          value: existingValues.get(key) ?? "",
        })),
      };

      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(pack, null, 2)}\n`);
      console.log(
        JSON.stringify({
          event: "curated_translation_pack_exported",
          language,
          namespace,
          filePath,
          entries: pack.entries.length,
          missingOnly: args.missingOnly,
          existingEntries: existingValues.size,
          totalEntries: Object.keys(source.sourceStrings).length,
          part: pack.part,
        }),
      );
    }
  }
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

function packPath(
  rootDir: string,
  language: SupportedLanguage,
  namespace: string,
  partIndex?: number,
  partTotal?: number,
) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const safeNamespace = fileSafeNamespace(namespace);
  const fileName =
    partIndex === undefined
      ? `${safeNamespace}.json`
      : `${safeNamespace}.part-${String(partIndex + 1).padStart(3, "0")}-of-${String(partTotal ?? 0).padStart(3, "0")}.json`;
  return join(resolve(process.cwd(), rootDir), locale, fileName);
}

function basePackExists(rootDir: string, language: SupportedLanguage, namespace: string) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const safeNamespace = fileSafeNamespace(namespace);
  return existsSync(join(resolve(process.cwd(), rootDir), locale, `${safeNamespace}.json`));
}

function fileSafeNamespace(namespace: string) {
  return namespace.replace(/[^a-z0-9.-]+/gi, "__");
}

function readExistingValuesForNamespace(
  rootDir: string,
  language: SupportedLanguage,
  namespace: string,
  sourceStrings: Record<string, string>,
) {
  const values = new Map<string, string>();
  const valuesBySource = new Map<string, string>();
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const languageDir = join(resolve(process.cwd(), rootDir), locale);
  if (!existsSync(languageDir)) return values;

  const safeNamespace = fileSafeNamespace(namespace);
  const files = readdirSync(languageDir).filter((file) => file.endsWith(".json"));

  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(languageDir, file), "utf8")) as Partial<CuratedTranslationPack> & {
      translations?: Record<string, string>;
    };
    const isSameNamespace = file === `${safeNamespace}.json` || file.startsWith(`${safeNamespace}.part-`);

    for (const entry of parsed.entries ?? []) {
      if (entry?.source && typeof entry.value === "string" && entry.value.trim()) {
        if (isValidFieldTranslation(entry.source, entry.value, language)) valuesBySource.set(entry.source, entry.value);
      }
      if (isSameNamespace && entry?.key && typeof entry.value === "string" && entry.value.trim()) {
        const source = sourceStrings[entry.key];
        if (source && isValidFieldTranslation(source, entry.value, language)) values.set(entry.key, entry.value);
      }
    }

    if (!isSameNamespace) continue;
    for (const [key, value] of Object.entries(parsed.translations ?? {})) {
      const source = sourceStrings[key];
      if (source && typeof value === "string" && value.trim() && isValidFieldTranslation(source, value, language)) {
        values.set(key, value);
      }
    }
  }

  for (const [key, source] of Object.entries(sourceStrings)) {
    if (values.has(key)) continue;
    const existing = valuesBySource.get(source);
    if (existing?.trim()) values.set(key, existing);
  }

  return values;
}

function chunkArray<T>(values: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function parseArgs(rawArgs: string[]): Args {
  const languages: string[] = [];
  const namespaces: string[] = [];
  let allLanguages = false;
  let allNamespaces = false;
  let dir = "translations/curated";
  let force = false;
  let missingOnly = false;
  let chunkSize: number | undefined;

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
    } else if (arg === "--all-languages") {
      allLanguages = true;
    } else if (arg === "--namespace") {
      namespaces.push(rawArgs[index + 1] ?? "");
      index += 1;
    } else if (arg.startsWith("--namespace=")) {
      namespaces.push(arg.slice("--namespace=".length));
    } else if (arg === "--all-namespaces") {
      allNamespaces = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--missing-only") {
      missingOnly = true;
    } else if (arg === "--chunk-size") {
      chunkSize = readPositiveInteger(rawArgs[index + 1]);
      index += 1;
    } else if (arg.startsWith("--chunk-size=")) {
      chunkSize = readPositiveInteger(arg.slice("--chunk-size=".length));
    } else if (!arg.startsWith("--")) {
      languages.push(...splitCsv(arg));
    }
  }

  return {
    dir,
    languages: normalizeRequestedLanguages(allLanguages ? [...supportedLanguages] : languages),
    namespaces: normalizeRequestedNamespaces(
      allNamespaces ? [mainAppTranslationNamespace, ...getAllSiteTranslationNamespaces()] : namespaces,
    ),
    force,
    missingOnly,
    chunkSize,
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

function readPositiveInteger(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, got: ${value}`);
  return parsed;
}
