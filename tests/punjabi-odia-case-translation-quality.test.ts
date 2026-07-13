import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { SupportedLanguage } from "../lib/content/languages";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "../lib/i18n/main-app-source";
import { readStaticMainAppTranslations } from "../lib/i18n/static-main-app-translations";
import { isPreservedTranslationLiteral } from "../lib/i18n/translation-field-validation";

const workspaceRoot = process.cwd();
const sourceStrings = getMainAppSourceStrings();
const source = {
  namespace: mainAppTranslationNamespace,
  sourceHash: getMainAppSourceHash(sourceStrings),
  sourceStrings,
};

type LocaleAudit = {
  language: SupportedLanguage;
  fixture: string;
  expectedCorrections: number;
};

const audits: readonly LocaleAudit[] = [
  {
    language: "Punjabi",
    fixture: "punjabi-main-app-case-corrections.json",
    expectedCorrections: 159,
  },
  {
    language: "Odia",
    fixture: "odia-main-app-case-corrections.json",
    expectedCorrections: 138,
  },
];

test("Punjabi and Odia keep every audited case-only main-app repair", () => {
  for (const audit of audits) {
    const corrections = readCorrections(audit.fixture);
    const bundle = readStaticMainAppTranslations(source, audit.language, workspaceRoot);
    assert.ok(bundle, audit.language);
    assert.equal(Object.keys(corrections).length, audit.expectedCorrections, audit.language);

    for (const [key, value] of Object.entries(corrections)) {
      assert.ok(key in sourceStrings, `unknown ${audit.language} regression key ${key}`);
      assert.equal(bundle[key], value, `${audit.language}/${key}`);
      assert.deepEqual(
        placeholders(value),
        placeholders(sourceStrings[key]),
        `placeholders ${audit.language}/${key}`,
      );
    }
  }
});

test("Punjabi and Odia have no unprotected case-only source matches", () => {
  for (const audit of audits) {
    const bundle = readStaticMainAppTranslations(source, audit.language, workspaceRoot);
    assert.ok(bundle, audit.language);
    const caseOnlyMatches = Object.entries(sourceStrings).filter(([key, sourceValue]) => {
      const translated = bundle[key];
      return (
        translated.trim().toLocaleLowerCase("en-US") ===
          sourceValue.trim().toLocaleLowerCase("en-US") &&
        !isPreservedTranslationLiteral(sourceValue, translated, audit.language)
      );
    });

    assert.deepEqual(
      caseOnlyMatches.map(([key]) => key),
      [],
      `${audit.language} unprotected case-only source matches`,
    );
  }
});

function readCorrections(file: string) {
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, "tests/fixtures", file), "utf8"),
  );
  if (!isRecord(value)) throw new Error(`Invalid ${file} correction fixture.`);

  const corrections: Record<string, string> = {};
  for (const [key, translated] of Object.entries(value)) {
    if (typeof translated !== "string" || !translated.trim()) {
      throw new Error(`Invalid ${file} correction for ${key}.`);
    }
    corrections[key] = translated;
  }
  return corrections;
}

function placeholders(value: string) {
  return [...value.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((match) => match[0]).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
