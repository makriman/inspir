import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  languageConfigs,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import type { TranslationSource } from "@/lib/i18n/translation-types";

const staticMainAppRoot = "translations/static-main-app";

/**
 * Main-app translation shards are a local editing workbench and are ignored by
 * Git. This compact, tracked representation is the deploy input so a clean
 * checkout can materialize every localized static chat page without D1.
 *
 * Values are stored in sorted source-key order. The source hash and key count
 * make that compact representation fail closed whenever the source contract
 * changes.
 */
export function readStaticMainAppTranslations(
  source: TranslationSource,
  language: SupportedLanguage,
  workspaceRoot = process.cwd(),
): Record<string, string> | null {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const filePath = join(resolve(workspaceRoot, staticMainAppRoot), `${locale}.json`);
  if (!existsSync(filePath)) return null;

  const value: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isRecord(value)) throw invalidPack(language, "root must be an object");
  if (value.schemaVersion !== 1 || value.kind !== "static-main-app-values") {
    throw invalidPack(language, "unsupported schema");
  }
  if (value.language !== language || value.locale !== languageConfigs[language].locale) {
    throw invalidPack(language, "language metadata does not match");
  }
  if (value.sourceHash !== source.sourceHash) {
    throw invalidPack(language, "source hash is stale");
  }

  const sourceKeys = Object.keys(source.sourceStrings).sort();
  if (value.keyCount !== sourceKeys.length || !Array.isArray(value.strings)) {
    throw invalidPack(language, "source key count does not match");
  }
  if (value.strings.length !== sourceKeys.length) {
    throw invalidPack(language, "translation count does not match");
  }

  const strings: Record<string, string> = {};
  for (let index = 0; index < sourceKeys.length; index += 1) {
    const translated = value.strings[index];
    if (typeof translated !== "string" || !translated.trim()) {
      throw invalidPack(language, `translation ${index} is empty`);
    }
    if (translated !== translated.normalize("NFC")) {
      throw invalidPack(language, `translation ${index} is not NFC-normalized`);
    }
    const key = sourceKeys[index];
    if (!isValidFieldTranslation(source.sourceStrings[key], translated, language, key)) {
      throw invalidPack(language, `translation ${index} is invalid for ${key}`);
    }
    strings[key] = translated;
  }
  return strings;
}

function invalidPack(language: SupportedLanguage, reason: string) {
  return new Error(`Invalid tracked main-app translations for ${language}: ${reason}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
