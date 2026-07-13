import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "../lib/content/languages";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "../lib/i18n/main-app-source";
import { readStaticMainAppTranslations } from "../lib/i18n/static-main-app-translations";
import {
  isCaseOnlyPseudoTranslation,
  isValidFieldTranslation,
  listCaseOnlyPseudoTranslations,
} from "../lib/i18n/translation-field-validation";

type LocaleCorrections = {
  language: SupportedLanguage;
  corrections: Record<string, string>;
};

type SemanticCorrectionsFixture = {
  schemaVersion: 1;
  kind: "main-app-semantic-corrections";
  sourceHash: string;
  languages: Record<string, LocaleCorrections>;
};

const expectedCorrectionCounts: Record<string, number> = {
  ne: 263,
  ur: 196,
  mr: 1,
  gu: 1,
  pa: 1,
  as: 1,
  si: 1,
  th: 2,
  fil: 1,
  yo: 1,
  ha: 1,
  so: 1,
  de: 1,
  ko: 1,
  ml: 14,
};

const sourceStrings = getMainAppSourceStrings();
const sourceHash = getMainAppSourceHash(sourceStrings);
const source = {
  namespace: mainAppTranslationNamespace,
  sourceHash,
  sourceStrings,
};
const fixture = readFixture();

test("reviewed main-app semantic corrections remain exact and structurally valid", () => {
  assert.equal(fixture.sourceHash, sourceHash);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(fixture.languages).map(([locale, data]) => [
        locale,
        Object.keys(data.corrections).length,
      ]),
    ),
    expectedCorrectionCounts,
  );

  for (const [locale, data] of Object.entries(fixture.languages)) {
    const configuredLocale =
      languageConfigs[data.language].prefix || languageConfigs[data.language].locale;
    assert.equal(locale, configuredLocale, `${data.language} locale metadata drifted`);

    const strings = readStaticMainAppTranslations(source, data.language);
    assert.ok(strings, `missing ${data.language} main-app pack`);

    for (const [key, expected] of Object.entries(data.corrections)) {
      const sourceValue = sourceStrings[key];
      assert.equal(typeof sourceValue, "string", `${locale} fixture has unknown key ${key}`);
      assert.equal(expected, expected.normalize("NFC"), `${locale}/${key} is not NFC`);
      assert.equal(
        isValidFieldTranslation(sourceValue, expected, data.language, key),
        true,
        `${locale}/${key} violates translation structure`,
      );
      assert.equal(
        isCaseOnlyPseudoTranslation(sourceValue, expected, data.language, key),
        false,
        `${locale}/${key} is only a case-changed source copy`,
      );
      assert.equal(strings[key], expected, `${locale}/${key} semantic correction regressed`);
    }
  }
});

test("Nepali and Urdu main-app packs contain no case-only pseudo-translations", () => {
  for (const language of ["Nepali", "Urdu"] satisfies SupportedLanguage[]) {
    const strings = readStaticMainAppTranslations(source, language);
    assert.ok(strings, `missing ${language} main-app pack`);
    assert.deepEqual(listCaseOnlyPseudoTranslations(sourceStrings, strings, language), []);
  }
});

test("all 69 localized main-app packs reject unapproved case-only source copies", () => {
  const localizedLanguages = supportedLanguages.filter(
    (language) => language !== defaultLanguage,
  );
  assert.equal(localizedLanguages.length, 69);

  for (const language of localizedLanguages) {
    const strings = readStaticMainAppTranslations(source, language);
    assert.ok(strings, `missing ${language} main-app pack`);
    assert.deepEqual(
      listCaseOnlyPseudoTranslations(sourceStrings, strings, language),
      [],
      `${language} contains an unapproved case-only source copy`,
    );
  }
});

function readFixture(): SemanticCorrectionsFixture {
  const filePath = path.join(
    process.cwd(),
    "tests/fixtures/main-app-semantic-corrections.json",
  );
  const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "main-app-semantic-corrections" ||
    typeof value.sourceHash !== "string" ||
    !isRecord(value.languages)
  ) {
    throw new Error("Invalid main-app semantic corrections fixture metadata.");
  }

  const languages: Record<string, LocaleCorrections> = {};
  for (const [locale, localeValue] of Object.entries(value.languages)) {
    if (
      !isRecord(localeValue) ||
      typeof localeValue.language !== "string" ||
      !isSupportedLanguage(localeValue.language) ||
      !isRecord(localeValue.corrections)
    ) {
      throw new Error(`Invalid main-app semantic corrections fixture for ${locale}.`);
    }

    const corrections: Record<string, string> = {};
    for (const [key, translated] of Object.entries(localeValue.corrections)) {
      if (typeof translated !== "string" || !translated.trim()) {
        throw new Error(`Invalid main-app semantic correction for ${locale}/${key}.`);
      }
      corrections[key] = translated;
    }
    languages[locale] = { language: localeValue.language, corrections };
  }

  return {
    schemaVersion: 1,
    kind: "main-app-semantic-corrections",
    sourceHash: value.sourceHash,
    languages,
  };
}

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.some((language) => language === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
