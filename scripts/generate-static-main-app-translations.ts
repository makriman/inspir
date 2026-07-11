import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "@/lib/i18n/main-app-source";
import { readStaticMainAppTranslations } from "@/lib/i18n/static-main-app-translations";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";

type Args = {
  sourceDir: string;
  outputDir: string;
  check: boolean;
  clean: boolean;
};

const args = parseArgs(process.argv.slice(2));
const sourceStrings = getMainAppSourceStrings();
const sourceHash = getMainAppSourceHash(sourceStrings);
const sourceKeys = Object.keys(sourceStrings).sort();
const localizedLanguages = supportedLanguages.filter(
  (language): language is Exclude<SupportedLanguage, typeof defaultLanguage> =>
    language !== defaultLanguage,
);

if (args.check) {
  for (const language of localizedLanguages) {
    const strings = readStaticMainAppTranslations(
      {
        namespace: mainAppTranslationNamespace,
        sourceHash,
        sourceStrings,
      },
      language,
    );
    if (!strings) throw new Error(`Missing tracked main-app translations for ${language}.`);
    validateTranslations(language, strings);
  }
  console.log(
    JSON.stringify({
      event: "static_main_app_translations_checked",
      languages: localizedLanguages.length,
      sourceHash,
      stringsPerLanguage: sourceKeys.length,
    }),
  );
} else {
  const sourceRoot = resolve(process.cwd(), args.sourceDir);
  const outputRoot = resolve(process.cwd(), args.outputDir);
  if (!existsSync(sourceRoot)) {
    throw new Error(`Curated translation source directory does not exist: ${sourceRoot}`);
  }
  if (args.clean) rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  let bytes = 0;
  for (const language of localizedLanguages) {
    const strings = readEditingPacks(sourceRoot, language);
    validateTranslations(language, strings);
    const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
    const serialized = `${JSON.stringify({
      schemaVersion: 1,
      kind: "static-main-app-values",
      language,
      locale: languageConfigs[language].locale,
      sourceHash,
      keyCount: sourceKeys.length,
      strings: sourceKeys.map((key) => strings[key]),
    })}\n`;
    writeFileSync(join(outputRoot, `${locale}.json`), serialized);
    bytes += Buffer.byteLength(serialized);
  }

  console.log(
    JSON.stringify({
      event: "static_main_app_translations_generated",
      languages: localizedLanguages.length,
      sourceHash,
      stringsPerLanguage: sourceKeys.length,
      bytes,
      outputRoot,
    }),
  );
}

function readEditingPacks(sourceRoot: string, language: SupportedLanguage) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const languageDir = join(sourceRoot, locale);
  if (!existsSync(languageDir)) throw new Error(`Missing curated translation directory for ${language}.`);

  const files = readdirSync(languageDir)
    .filter((file) => file === "main-app.json" || /^main-app\.part-[^.]+\.json$/.test(file))
    .sort();
  if (!files.length) throw new Error(`Missing curated main-app editing packs for ${language}.`);

  const strings: Record<string, string> = {};
  for (const file of files) {
    const value: unknown = JSON.parse(readFileSync(join(languageDir, file), "utf8"));
    if (!isRecord(value)) throw new Error(`Invalid curated main-app pack: ${locale}/${file}.`);
    if (
      value.language !== language ||
      value.namespace !== mainAppTranslationNamespace ||
      value.sourceHash !== sourceHash
    ) {
      throw new Error(`Stale curated main-app pack: ${locale}/${file}.`);
    }

    if (isRecord(value.translations)) {
      for (const [key, translated] of Object.entries(value.translations)) {
        setTranslation(strings, language, key, translated, file);
      }
    }
    if (Array.isArray(value.entries)) {
      for (const entry of value.entries) {
        if (!isRecord(entry) || typeof entry.key !== "string") continue;
        setTranslation(strings, language, entry.key, entry.value, file);
      }
    }
  }
  return strings;
}

function setTranslation(
  strings: Record<string, string>,
  language: SupportedLanguage,
  key: string,
  translated: unknown,
  file: string,
) {
  if (!(key in sourceStrings)) return;
  if (typeof translated !== "string" || !translated.trim()) {
    throw new Error(`Empty ${language} main-app translation for ${key} in ${file}.`);
  }
  const existing = strings[key];
  if (existing !== undefined && existing !== translated) {
    throw new Error(`Conflicting ${language} main-app translation for ${key} in ${file}.`);
  }
  strings[key] = translated;
}

function validateTranslations(language: SupportedLanguage, strings: Record<string, string>) {
  for (const key of sourceKeys) {
    const translated = strings[key];
    if (typeof translated !== "string" || !translated.trim()) {
      throw new Error(`Missing ${language} main-app translation for ${key}.`);
    }
    if (translated !== translated.normalize("NFC")) {
      throw new Error(`Non-NFC ${language} main-app translation for ${key}.`);
    }
    if (!isValidFieldTranslation(sourceStrings[key], translated, language)) {
      throw new Error(`Invalid ${language} main-app translation for ${key}.`);
    }
  }
  const unexpected = Object.keys(strings).filter((key) => !(key in sourceStrings));
  if (unexpected.length) {
    throw new Error(`Unexpected ${language} main-app translation keys: ${unexpected.slice(0, 5).join(", ")}.`);
  }
}

function parseArgs(rawArgs: string[]): Args {
  let sourceDir = "translations/curated";
  let outputDir = "translations/static-main-app";
  let check = false;
  let clean = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--source-dir") {
      sourceDir = rawArgs[index + 1] ?? sourceDir;
      index += 1;
    } else if (arg.startsWith("--source-dir=")) {
      sourceDir = arg.slice("--source-dir=".length);
    } else if (arg === "--out-dir") {
      outputDir = rawArgs[index + 1] ?? outputDir;
      index += 1;
    } else if (arg.startsWith("--out-dir=")) {
      outputDir = arg.slice("--out-dir=".length);
    } else if (arg === "--check") {
      check = true;
    } else if (arg === "--clean") {
      clean = true;
    }
  }
  return { sourceDir, outputDir, check, clean };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
