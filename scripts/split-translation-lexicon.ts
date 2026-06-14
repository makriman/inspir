import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { languageConfigs, normalizeLanguage, type SupportedLanguage } from "@/lib/content/languages";

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

type LexiconChunk = Omit<LexiconPack, "kind"> & {
  kind: "translation-lexicon-chunk";
  part: {
    index: number;
    total: number;
  };
};

type Args = {
  inDir: string;
  outDir: string;
  languages: SupportedLanguage[];
  chunkSize: number;
  clean: boolean;
};

const args = parseArgs(process.argv.slice(2));

for (const language of args.languages) {
  const lexicon = readLexicon(args.inDir, language);
  const chunks = chunkArray(lexicon.entries, args.chunkSize);
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const outputDir = join(resolve(process.cwd(), args.outDir), locale);

  if (args.clean && existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk: LexiconChunk = {
      schemaVersion: lexicon.schemaVersion,
      kind: "translation-lexicon-chunk",
      language: lexicon.language,
      locale: lexicon.locale,
      part: {
        index: index + 1,
        total: chunks.length,
      },
      namespaces: lexicon.namespaces,
      entries: chunks[index],
    };
    const filePath = join(
      outputDir,
      `lexicon.part-${String(index + 1).padStart(3, "0")}-of-${String(chunks.length).padStart(3, "0")}.json`,
    );
    writeFileSync(filePath, `${JSON.stringify(chunk, null, 2)}\n`);
  }

  console.log(
    JSON.stringify({
      event: "translation_lexicon_split",
      language,
      locale,
      entries: lexicon.entries.length,
      chunkSize: args.chunkSize,
      chunks: chunks.length,
      outputDir,
    }),
  );
}

function readLexicon(rootDir: string, language: SupportedLanguage) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const filePath = join(resolve(process.cwd(), rootDir), locale, "lexicon.json");
  if (!existsSync(filePath)) throw new Error(`Missing lexicon file: ${filePath}`);

  const lexicon = JSON.parse(readFileSync(filePath, "utf8")) as LexiconPack;
  if (lexicon.kind !== "translation-lexicon" || normalizeLanguage(lexicon.language) !== language) {
    throw new Error(`Invalid lexicon for ${language}: ${filePath}`);
  }
  return lexicon;
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
  let inDir = "translations/workbench";
  let outDir = "translations/workbench-chunks";
  let chunkSize = 160;
  let clean = false;

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
    } else if (arg === "--chunk-size") {
      chunkSize = readPositiveInteger(rawArgs[index + 1], chunkSize);
      index += 1;
    } else if (arg.startsWith("--chunk-size=")) {
      chunkSize = readPositiveInteger(arg.slice("--chunk-size=".length), chunkSize);
    } else if (arg === "--clean") {
      clean = true;
    }
  }

  return {
    inDir,
    outDir,
    languages: normalizeRequestedLanguages(languages),
    chunkSize,
    clean,
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

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
