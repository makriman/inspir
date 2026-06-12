import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultLanguage,
  normalizeLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { translationStringsFromDbPayload } from "@/lib/i18n/db-translations";
import { getMainAppSourceHash, getMainAppSourceStrings, mainAppTranslationNamespace } from "@/lib/i18n/main-app-source";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
  isKnownSiteTranslationNamespace,
} from "@/lib/i18n/site-source";
import type { TranslationSource } from "@/lib/i18n/translation-types";

type Args = {
  languages: SupportedLanguage[];
  namespaces: string[];
};

type DbTranslationRow = {
  namespace: string;
  language: string;
  sourceHash: string;
  payload: Record<string, unknown>;
};

const explicitEnv = new Set(Object.keys(process.env));
loadEnvFile(".env.local", explicitEnv);
loadEnvFile(".env.vercel.production.local", explicitEnv);
loadEnvFile(".env.production.local", explicitEnv);

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const queries = await import("@/lib/db/queries");
  const client = await import("@/lib/db/client");
  const rows = (await queries.getAppTranslations(args.namespaces, args.languages)) as DbTranslationRow[];
  const rowByKey = new Map(rows.map((row) => [`${row.namespace}\u0000${row.language}`, row]));

  const byNamespace: Record<string, { complete: number; incomplete: number; total: number }> = {};
  const incomplete: Array<{
    namespace: string;
    language: SupportedLanguage;
    translatedCount: number;
    totalCount: number;
    sourceHashFresh: boolean;
    rowExists: boolean;
  }> = [];
  let complete = 0;

  try {
    for (const namespace of args.namespaces) {
      const source = sourceForNamespace(namespace);
      byNamespace[namespace] = { complete: 0, incomplete: 0, total: args.languages.length };

      for (const language of args.languages) {
        const totalCount = Object.keys(source.sourceStrings).length;
        if (language === defaultLanguage) {
          complete += 1;
          byNamespace[namespace].complete += 1;
          continue;
        }

        const row = rowByKey.get(`${namespace}\u0000${language}`);
        const sourceHashFresh = row?.sourceHash === source.sourceHash;
        const strings = row && sourceHashFresh ? translationStringsFromDbPayload(source, row.payload, language) : {};
        const translatedCount = Object.keys(strings).length;
        const isComplete = sourceHashFresh && translatedCount === totalCount;

        if (isComplete) {
          complete += 1;
          byNamespace[namespace].complete += 1;
        } else {
          byNamespace[namespace].incomplete += 1;
          incomplete.push({
            namespace,
            language,
            translatedCount,
            totalCount,
            sourceHashFresh,
            rowExists: Boolean(row),
          });
        }
      }
    }
  } finally {
    await client.sql.end({ timeout: 5 });
  }

  console.log(
    JSON.stringify({
      event: "db_translation_status_complete",
      complete,
      incompleteCount: incomplete.length,
      byNamespace,
      total: args.languages.length * args.namespaces.length,
      incomplete: incomplete.slice(0, 120),
      incompleteTruncated: incomplete.length > 120,
    }),
  );
}

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
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
