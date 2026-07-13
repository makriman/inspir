import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { languageConfigs, type SupportedLanguage } from "../lib/content/languages";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "../lib/i18n/main-app-source";
import { readStaticMainAppTranslations } from "../lib/i18n/static-main-app-translations";
import {
  isCaseOnlyPseudoTranslation,
  listCaseOnlyPseudoTranslations,
} from "../lib/i18n/translation-field-validation";

const workspaceRoot = process.cwd();
const sourceStrings = getMainAppSourceStrings();
const sourceHash = getMainAppSourceHash(sourceStrings);
const sourceKeyCount = Object.keys(sourceStrings).length;
const fixture = parseFixture(
  JSON.parse(
    fs.readFileSync(
      path.join(
        workspaceRoot,
        "tests/fixtures/as-mr-gu-th-main-app-corrections.json",
      ),
      "utf8",
    ),
  ),
);

const localeConfig = {
  as: {
    language: "Assamese",
    expectedCaseOnlyCorrections: 117,
    expectedCorrections: 118,
    semanticBlockers: ["topic.reading-companion.subText"],
  },
  mr: {
    language: "Marathi",
    expectedCaseOnlyCorrections: 52,
    expectedCorrections: 53,
    semanticBlockers: ["topic.homework-coach.inputboxText"],
  },
  gu: {
    language: "Gujarati",
    expectedCaseOnlyCorrections: 20,
    expectedCorrections: 21,
    semanticBlockers: ["topic.reading-companion.subText"],
  },
  th: {
    language: "Thai",
    expectedCaseOnlyCorrections: 9,
    expectedCorrections: 11,
    semanticBlockers: [
      "topic.reading-companion.subText",
      "topic.study-timer.subText",
    ],
  },
} as const satisfies Record<
  Locale,
  {
    language: SupportedLanguage;
    expectedCaseOnlyCorrections: number;
    expectedCorrections: number;
    semanticBlockers: readonly string[];
  }
>;

test("Assamese, Marathi, Gujarati, and Thai keep every audited main-app repair", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.kind, "as-mr-gu-th-main-app-corrections");
  assert.equal(fixture.sourceHash, sourceHash);

  for (const locale of locales) {
    const expected = localeConfig[locale];
    const localeFixture = fixture.locales[locale];
    assert.equal(localeFixture.language, expected.language, `${locale}/language`);
    assert.equal(
      localeFixture.expectedCaseOnlyCorrections,
      expected.expectedCaseOnlyCorrections,
      `${locale}/case-count`,
    );
    assert.equal(
      Object.keys(localeFixture.corrections).length,
      expected.expectedCorrections,
      `${locale}/correction-count`,
    );
    assert.deepEqual(
      expected.semanticBlockers.filter((key) => key in localeFixture.corrections),
      expected.semanticBlockers,
      `${locale}/semantic-blockers`,
    );

    const strings = readStaticMainAppTranslations(
      {
        namespace: mainAppTranslationNamespace,
        sourceHash,
        sourceStrings,
      },
      expected.language,
      workspaceRoot,
    );
    assert.ok(strings, locale);

    for (const [key, translated] of Object.entries(localeFixture.corrections)) {
      const source = sourceStrings[key];
      assert.equal(typeof source, "string", `${locale}/${key}/source-key`);
      assert.equal(translated, translated.normalize("NFC"), `${locale}/${key}/NFC`);
      assert.deepEqual(
        placeholders(translated),
        placeholders(source),
        `${locale}/${key}/placeholders`,
      );
      assert.equal(strings[key], translated, `${locale}/${key}/value`);
      assert.equal(
        isCaseOnlyPseudoTranslation(source, translated, expected.language, key),
        false,
        `${locale}/${key}/case-only`,
      );
    }
  }
});

test("the four compact packs keep exact language, source-hash, and key-count metadata", () => {
  for (const locale of locales) {
    const expected = localeConfig[locale];
    const pack = readRecordJson(
      path.join(workspaceRoot, "translations/static-main-app", `${locale}.json`),
    );
    assert.equal(pack.schemaVersion, 1, `${locale}/schemaVersion`);
    assert.equal(pack.kind, "static-main-app-values", `${locale}/kind`);
    assert.equal(pack.language, expected.language, `${locale}/language`);
    assert.equal(pack.locale, languageConfigs[expected.language].locale, `${locale}/locale`);
    assert.equal(pack.sourceHash, sourceHash, `${locale}/sourceHash`);
    assert.equal(pack.keyCount, sourceKeyCount, `${locale}/keyCount`);
    assert.ok(Array.isArray(pack.strings), `${locale}/strings`);
    assert.equal(pack.strings.length, sourceKeyCount, `${locale}/strings.length`);
  }
});

test("the four locales have zero remaining unapproved case-only pseudo-translations", () => {
  for (const locale of locales) {
    const expected = localeConfig[locale];
    const localeFixture = fixture.locales[locale];
    assert.deepEqual(
      localeFixture.reviewedCaseOnlyAllowList,
      [],
      `${locale}/reviewed-case-only-allow-list`,
    );

    const strings = readStaticMainAppTranslations(
      {
        namespace: mainAppTranslationNamespace,
        sourceHash,
        sourceStrings,
      },
      expected.language,
      workspaceRoot,
    );
    assert.ok(strings, locale);
    assert.deepEqual(
      listCaseOnlyPseudoTranslations(sourceStrings, strings, expected.language),
      [],
      `${locale}/unapproved-case-only`,
    );
  }
});

const locales = ["as", "mr", "gu", "th"] as const;
type Locale = (typeof locales)[number];

type LocaleFixture = {
  language: string;
  expectedCaseOnlyCorrections: number;
  reviewedCaseOnlyAllowList: readonly ReviewedCaseOnlyEntry[];
  corrections: Record<string, string>;
};

type ReviewedCaseOnlyEntry = {
  key: string;
  source: string;
  value: string;
  justification: string;
};

function parseFixture(value: unknown) {
  assert.ok(isRecord(value), "correction fixture must be an object");
  assert.equal(typeof value.schemaVersion, "number", "fixture/schemaVersion");
  assert.equal(typeof value.kind, "string", "fixture/kind");
  assert.equal(typeof value.sourceHash, "string", "fixture/sourceHash");
  assert.ok(isRecord(value.locales), "fixture/locales");

  return {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    sourceHash: value.sourceHash,
    locales: {
      as: parseLocaleFixture(value.locales.as, "as"),
      mr: parseLocaleFixture(value.locales.mr, "mr"),
      gu: parseLocaleFixture(value.locales.gu, "gu"),
      th: parseLocaleFixture(value.locales.th, "th"),
    },
  };
}

function parseLocaleFixture(value: unknown, locale: Locale): LocaleFixture {
  assert.ok(isRecord(value), `${locale} fixture must be an object`);
  const language = readNonEmptyString(value.language, `${locale}/language`);
  const expectedCaseOnlyCorrections = readNonNegativeInteger(
    value.expectedCaseOnlyCorrections,
    `${locale}/expectedCaseOnlyCorrections`,
  );
  assert.ok(
    Array.isArray(value.reviewedCaseOnlyAllowList),
    `${locale}/reviewedCaseOnlyAllowList`,
  );
  assert.ok(isRecord(value.corrections), `${locale}/corrections`);

  const reviewedCaseOnlyAllowList = value.reviewedCaseOnlyAllowList.map(
    (entry, index) => parseReviewedCaseOnlyEntry(entry, `${locale}/allow/${index}`),
  );
  const corrections: Record<string, string> = {};
  for (const [key, translated] of Object.entries(value.corrections)) {
    corrections[key] = readNonEmptyString(translated, `${locale}/${key}`);
  }

  return {
    language,
    expectedCaseOnlyCorrections,
    reviewedCaseOnlyAllowList,
    corrections,
  };
}

function parseReviewedCaseOnlyEntry(value: unknown, label: string): ReviewedCaseOnlyEntry {
  assert.ok(isRecord(value), label);
  return {
    key: readNonEmptyString(value.key, `${label}/key`),
    source: readNonEmptyString(value.source, `${label}/source`),
    value: readNonEmptyString(value.value, `${label}/value`),
    justification: readNonEmptyString(value.justification, `${label}/justification`),
  };
}

function readNonEmptyString(value: unknown, label: string) {
  assert.ok(typeof value === "string" && value.trim(), label);
  return value;
}

function readNonNegativeInteger(value: unknown, label: string) {
  assert.ok(typeof value === "number" && Number.isInteger(value) && value >= 0, label);
  return value;
}

function readRecordJson(file: string) {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(isRecord(value), file);
  return value;
}

function placeholders(value: string) {
  return [...value.matchAll(/\{[a-zA-Z0-9_]+\}/g)]
    .map(([placeholder]) => placeholder)
    .sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
