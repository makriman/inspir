import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { languageConfigs, normalizeLanguage, type SupportedLanguage } from "@/lib/content/languages";

type CuratedTranslationEntry = {
  key: string;
  source?: string;
  value?: string;
};

type CuratedTranslationPack = {
  schemaVersion?: number;
  kind?: string;
  language?: string;
  locale?: string;
  namespace?: string;
  sourceHash?: string;
  model?: string;
  entries?: CuratedTranslationEntry[];
  translations?: Record<string, string>;
};

type CuratedLanguageBundle = {
  schemaVersion: 1;
  kind: "curated-language-bundle";
  language: SupportedLanguage;
  locale: string;
  namespaces: Record<
    string,
    {
      sourceHash?: string;
      model?: string;
      entries: Array<Required<Pick<CuratedTranslationEntry, "key" | "value">> & Pick<CuratedTranslationEntry, "source">>;
    }
  >;
};

type NamespaceAccumulator = {
  sourceHash?: string;
  model?: string;
  entries: Map<string, { key: string; source?: string; value: string }>;
};

type Args = {
  dir: string;
  outDir: string;
  clean: boolean;
};

const args = parseArgs(process.argv.slice(2));
const sourceRoot = resolve(process.cwd(), args.dir);
const outputRoot = resolve(process.cwd(), args.outDir);

if (!existsSync(sourceRoot)) throw new Error(`Curated translation directory does not exist: ${sourceRoot}`);
if (args.clean && existsSync(outputRoot)) rmSync(outputRoot, { recursive: true, force: true });

const byLanguage = new Map<SupportedLanguage, Map<string, NamespaceAccumulator>>();

for (const filePath of collectJsonFiles(sourceRoot)) {
  const pack = JSON.parse(readFileSync(filePath, "utf8")) as CuratedTranslationPack;
  if (pack.kind === "curated-language-bundle") continue;
  if (!pack.language || !pack.namespace) continue;

  const language = normalizeLanguage(pack.language);
  const namespaces = byLanguage.get(language) ?? new Map<string, NamespaceAccumulator>();
  const namespace = pack.namespace.trim();
  const accumulator =
    namespaces.get(namespace) ??
    ({
      sourceHash: pack.sourceHash,
      model: pack.model,
      entries: new Map<string, { key: string; source?: string; value: string }>(),
    } satisfies NamespaceAccumulator);

  if (pack.sourceHash && accumulator.sourceHash && pack.sourceHash !== accumulator.sourceHash) {
    throw new Error(`Conflicting source hashes for ${language} ${namespace}`);
  }
  accumulator.sourceHash = accumulator.sourceHash ?? pack.sourceHash;
  accumulator.model = accumulator.model ?? pack.model;

  for (const [key, value] of Object.entries(pack.translations ?? {})) {
    if (typeof value === "string" && value.trim()) {
      setEntry(accumulator, { key, value });
    }
  }

  for (const entry of pack.entries ?? []) {
    if (!entry.key || typeof entry.value !== "string" || !entry.value.trim()) continue;
    setEntry(accumulator, {
      key: entry.key,
      source: entry.source,
      value: entry.value,
    });
  }

  namespaces.set(namespace, accumulator);
  byLanguage.set(language, namespaces);
}

for (const [language, namespaces] of Array.from(byLanguage.entries()).sort(([a], [b]) => a.localeCompare(b))) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const bundle: CuratedLanguageBundle = {
    schemaVersion: 1,
    kind: "curated-language-bundle",
    language,
    locale: languageConfigs[language].locale,
    namespaces: Object.fromEntries(
      Array.from(namespaces.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([namespace, accumulator]) => [
          namespace,
          {
            sourceHash: accumulator.sourceHash,
            model: accumulator.model,
            entries: Array.from(accumulator.entries.values()).sort((a, b) => a.key.localeCompare(b.key)),
          },
        ]),
    ),
  };
  const outputPath = join(outputRoot, `${locale}.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(bundle)}\n`);
  console.log(
    JSON.stringify({
      event: "curated_translation_bundle_written",
      language,
      outputPath,
      namespaces: namespaces.size,
      entries: Array.from(namespaces.values()).reduce((total, namespace) => total + namespace.entries.size, 0),
    }),
  );
}

function setEntry(accumulator: NamespaceAccumulator, entry: { key: string; source?: string; value: string }) {
  const existing = accumulator.entries.get(entry.key);
  if (existing && existing.value !== entry.value) {
    throw new Error(`Conflicting values for translation key ${entry.key}`);
  }
  accumulator.entries.set(entry.key, entry);
}

function collectJsonFiles(root: string) {
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
    collect(join(path, entry), files);
  }
}

function parseArgs(rawArgs: string[]): Args {
  let dir = "translations/curated";
  let outDir = "translations/curated-bundles";
  let clean = false;

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
    } else if (arg === "--clean") {
      clean = true;
    }
  }

  return { dir, outDir, clean };
}
