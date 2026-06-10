import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defaultLanguage, languageConfigs, normalizeLanguage, supportedLanguages, type SupportedLanguage } from "@/lib/content/languages";
import { getMainAppSourceHash, getMainAppSourceStrings, mainAppTranslationNamespace } from "@/lib/i18n/main-app-source";
import { getAllSiteTranslationNamespaces, getSiteTranslationSource, isKnownSiteTranslationNamespace } from "@/lib/i18n/site-source";

type Args = {
  dir: string;
  languages: SupportedLanguage[];
  namespaces: string[];
  force: boolean;
};

type Source = {
  namespace: string;
  sourceHash: string;
  sourceStrings: Record<string, string>;
};

loadEnvFile(".env.local", new Set(Object.keys(process.env)));
loadEnvFile(".env", new Set(Object.keys(process.env)));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { getAppTranslations } = await import("@/lib/db/queries");
  const rows = await getAppTranslations(args.namespaces, args.languages);
  const rowsByKey = new Map(rows.map((row) => [`${row.namespace}\u0000${row.language}`, row]));

  let exported = 0;
  let skipped = 0;
  let failed = 0;

  for (const namespace of args.namespaces) {
    const source = sourceForNamespace(namespace);
    for (const language of args.languages) {
      const row = rowsByKey.get(`${namespace}\u0000${language}`);
      if (!row) {
        skipped += 1;
        console.log(JSON.stringify({ event: "cached_translation_missing", namespace, language }));
        continue;
      }

      const payload = normalizePayload(row.payload);
      const missing = Object.keys(source.sourceStrings).filter((key) => !payload[key]?.trim());
      if (row.sourceHash !== source.sourceHash || missing.length) {
        failed += 1;
        console.log(
          JSON.stringify({
            event: "cached_translation_not_exported",
            namespace,
            language,
            staleSourceHash: row.sourceHash !== source.sourceHash,
            missingCount: missing.length,
            missing: missing.slice(0, 10),
          }),
        );
        continue;
      }

      const path = packPath(args.dir, language, namespace);
      if (existsSync(path) && !args.force) {
        skipped += 1;
        console.log(JSON.stringify({ event: "cached_translation_export_skipped", namespace, language, path }));
        continue;
      }

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(packFor(source, language, payload), null, 2)}\n`);
      exported += 1;
      console.log(
        JSON.stringify({
          event: "cached_translation_exported",
          namespace,
          language,
          path,
          translatedCount: Object.keys(source.sourceStrings).length,
        }),
      );
    }
  }

  console.log(JSON.stringify({ event: "cached_translation_export_complete", exported, skipped, failed }));
  if (failed) process.exitCode = 1;
}

function sourceForNamespace(namespace: string): Source {
  if (namespace === mainAppTranslationNamespace) {
    const sourceStrings = getMainAppSourceStrings();
    return {
      namespace,
      sourceHash: getMainAppSourceHash(sourceStrings),
      sourceStrings,
    };
  }

  if (!isKnownSiteTranslationNamespace(namespace)) throw new Error(`Unknown translation namespace: ${namespace}`);
  return getSiteTranslationSource(namespace);
}

function normalizePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && value.trim()) strings[key] = value;
  }
  return strings;
}

function packFor(source: Source, language: SupportedLanguage, payload: Record<string, string>) {
  return {
    schemaVersion: 1,
    language,
    locale: languageConfigs[language].prefix || languageConfigs[language].locale,
    namespace: source.namespace,
    sourceHash: source.sourceHash,
    entries: Object.entries(source.sourceStrings).map(([key, sourceValue]) => ({
      key,
      source: sourceValue,
      value: payload[key],
    })),
  };
}

function packPath(rootDir: string, language: SupportedLanguage, namespace: string) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  return join(resolve(process.cwd(), rootDir), locale, `${fileSafeNamespace(namespace)}.json`);
}

function fileSafeNamespace(namespace: string) {
  return namespace.replace(/[^a-z0-9.-]+/gi, "__");
}

function parseArgs(rawArgs: string[]): Args {
  const languages: string[] = [];
  const namespaces: string[] = [];
  let allLanguages = false;
  let allNamespaces = false;
  let dir = "translations/curated";
  let force = false;

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
    }
  }

  return {
    dir,
    languages: normalizeRequestedLanguages(allLanguages ? [...supportedLanguages] : languages),
    namespaces: normalizeRequestedNamespaces(
      allNamespaces ? [mainAppTranslationNamespace, ...getAllSiteTranslationNamespaces()] : namespaces,
    ),
    force,
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
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}
