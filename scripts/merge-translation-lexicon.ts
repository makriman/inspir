import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { languageConfigs, normalizeLanguage, type SupportedLanguage } from "@/lib/content/languages";

type LexiconEntry = {
  source: string;
  value: string;
  refs: Array<{
    namespace: string;
    key: string;
  }>;
};

type LexiconChunk = {
  schemaVersion?: number;
  kind?: string;
  language?: string;
  locale?: string;
  part?: {
    index?: number;
    total?: number;
  };
  namespaces?: Record<string, { sourceHash?: string }>;
  entries?: LexiconEntry[];
};

type LexiconPack = {
  schemaVersion: 1;
  kind: "translation-lexicon";
  language: SupportedLanguage;
  locale: string;
  namespaces: Record<string, { sourceHash: string }>;
  entries: LexiconEntry[];
};

type Args = {
  inDir: string;
  outDir: string;
  baseDir?: string;
  languages: SupportedLanguage[];
  requireCompleteValues: boolean;
  preferChunks: boolean;
};

const args = parseArgs(process.argv.slice(2));
let hasFailure = false;

for (const language of args.languages) {
  const result = mergeLanguage(
    args.inDir,
    args.outDir,
    args.baseDir,
    language,
    args.requireCompleteValues,
    args.preferChunks,
  );
  if (!result.ok) hasFailure = true;
  console.log(JSON.stringify({ event: "translation_lexicon_merge", language, ...result }));
}

if (hasFailure) process.exitCode = 1;

function mergeLanguage(
  rootDir: string,
  outDir: string,
  baseDir: string | undefined,
  language: SupportedLanguage,
  requireCompleteValues: boolean,
  preferChunks: boolean,
) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const languageDir = join(resolve(process.cwd(), rootDir), locale);
  if (!existsSync(languageDir)) throw new Error(`Missing chunk directory: ${languageDir}`);

  const files = readdirSync(languageDir)
    .filter((file) => /^lexicon\.part-\d{3}-of-\d{3}\.json$/.test(file))
    .sort();
  if (!files.length) throw new Error(`No lexicon chunk files found in ${languageDir}`);

  const chunks = files.map((file) => JSON.parse(readFileSync(join(languageDir, file), "utf8")) as LexiconChunk);
  const expectedTotal = chunks[0]?.part?.total;
  const namespaces: Record<string, { sourceHash: string }> = {};
  const entriesBySource = new Map<string, LexiconEntry>();
  const entryOrigins = new Map<string, "base" | "chunk">();
  const conflicts: string[] = [];

  if (baseDir) {
    const baseLexicon = readBaseLexicon(baseDir, language);
    for (const [namespace, value] of Object.entries(baseLexicon.namespaces)) namespaces[namespace] = value;
    for (const entry of baseLexicon.entries) {
      if (entry.source?.trim()) {
        entriesBySource.set(entry.source, entry);
        entryOrigins.set(entry.source, "base");
      }
    }
  }

  if (!Number.isInteger(expectedTotal) || expectedTotal !== files.length) {
    return {
      ok: false,
      outputPath: null,
      files: files.length,
      entries: 0,
      missingValues: 0,
      conflicts: 0,
      error: `Expected ${expectedTotal ?? "unknown"} files, found ${files.length}.`,
    };
  }

  chunks.forEach((chunk, arrayIndex) => {
    const expectedIndex = arrayIndex + 1;
    if (chunk.kind !== "translation-lexicon-chunk") throw new Error(`Invalid chunk kind in ${files[arrayIndex]}`);
    if (normalizeLanguage(chunk.language ?? "") !== language) throw new Error(`Invalid language in ${files[arrayIndex]}`);
    if (chunk.part?.index !== expectedIndex || chunk.part?.total !== expectedTotal) {
      throw new Error(`Invalid part metadata in ${files[arrayIndex]}`);
    }

    for (const [namespace, value] of Object.entries(chunk.namespaces ?? {})) {
      if (!value.sourceHash) throw new Error(`Missing sourceHash for ${namespace} in ${files[arrayIndex]}`);
      const existing = namespaces[namespace]?.sourceHash;
      if (existing && existing !== value.sourceHash) throw new Error(`Conflicting sourceHash for ${namespace}`);
      namespaces[namespace] = { sourceHash: value.sourceHash };
    }

    for (const entry of chunk.entries ?? []) {
      if (!entry.source?.trim()) continue;
      const existing = entriesBySource.get(entry.source);
      if (existing && existing.value && entry.value && existing.value !== entry.value) {
        if (preferChunks && entryOrigins.get(entry.source) === "base") {
          entriesBySource.set(entry.source, { ...existing, value: entry.value });
          entryOrigins.set(entry.source, "chunk");
          continue;
        }
        conflicts.push(entry.source);
        continue;
      }
      entriesBySource.set(entry.source, entry.value?.trim() ? entry : (existing ?? entry));
      if (entry.value?.trim()) entryOrigins.set(entry.source, "chunk");
    }
  });

  const outputPath = join(resolve(process.cwd(), outDir), locale, "lexicon.json");
  const missingValues = Array.from(entriesBySource.values()).filter((entry) => !entry.value?.trim());
  const ok = !conflicts.length && (!requireCompleteValues || !missingValues.length);
  if (ok) {
    const pack: LexiconPack = {
      schemaVersion: 1,
      kind: "translation-lexicon",
      language,
      locale: languageConfigs[language].locale,
      namespaces: Object.fromEntries(Object.entries(namespaces).sort(([a], [b]) => a.localeCompare(b))),
      entries: Array.from(entriesBySource.values()).sort((a, b) => a.source.localeCompare(b.source)),
    };
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(pack, null, 2)}\n`);
  }

  return {
    ok,
    outputPath: ok ? outputPath : null,
    files: files.length,
    entries: entriesBySource.size,
    missingValues: missingValues.length,
    conflicts: conflicts.length,
  };
}

function readBaseLexicon(rootDir: string, language: SupportedLanguage) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const filePath = join(resolve(process.cwd(), rootDir), locale, "lexicon.json");
  if (!existsSync(filePath)) throw new Error(`Missing base lexicon file: ${filePath}`);

  const lexicon = JSON.parse(readFileSync(filePath, "utf8")) as LexiconPack;
  if (lexicon.kind !== "translation-lexicon" || normalizeLanguage(lexicon.language) !== language) {
    throw new Error(`Invalid base lexicon for ${language}: ${filePath}`);
  }
  return lexicon;
}

function parseArgs(rawArgs: string[]): Args {
  const languages: string[] = [];
  let inDir = "translations/workbench-chunks";
  let outDir = "translations/workbench";
  let baseDir: string | undefined;
  let requireCompleteValues = false;
  let preferChunks = false;

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
    } else if (arg === "--base-dir") {
      baseDir = rawArgs[index + 1];
      index += 1;
    } else if (arg.startsWith("--base-dir=")) {
      baseDir = arg.slice("--base-dir=".length);
    } else if (arg === "--languages") {
      languages.push(...splitCsv(rawArgs[index + 1] ?? ""));
      index += 1;
    } else if (arg.startsWith("--languages=")) {
      languages.push(...splitCsv(arg.slice("--languages=".length)));
    } else if (arg === "--require-complete-values") {
      requireCompleteValues = true;
    } else if (arg === "--prefer-chunks") {
      preferChunks = true;
    }
  }

  return {
    inDir,
    outDir,
    baseDir,
    languages: normalizeRequestedLanguages(languages),
    requireCompleteValues,
    preferChunks,
  };
}

function normalizeRequestedLanguages(languages: string[]) {
  const requested = new Set<SupportedLanguage>();
  for (const language of languages) requested.add(normalizeLanguage(language));
  if (!requested.size) throw new Error("Pass --languages=Hindi,Spanish.");
  return Array.from(requested);
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
