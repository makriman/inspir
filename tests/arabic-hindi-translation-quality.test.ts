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

const workspaceRoot = process.cwd();
const sourceStrings = getMainAppSourceStrings();
const sourceHash = getMainAppSourceHash(sourceStrings);
const corrections = parseLocaleCorrections(
  JSON.parse(
    fs.readFileSync(
      path.join(
        workspaceRoot,
        "tests/fixtures/arabic-hindi-main-app-corrections.json",
      ),
      "utf8",
    ),
  ),
);
const languageByLocale = {
  ar: "Arabic",
  hi: "Hindi",
} as const satisfies Record<keyof typeof corrections, SupportedLanguage>;

test("Arabic and Hindi main-app bundles keep every audited semantic repair", () => {
  assert.equal(Object.keys(corrections.ar).length, 305);
  assert.equal(Object.keys(corrections.hi).length, 207);

  for (const locale of ["ar", "hi"] as const) {
    const strings = readStaticMainAppTranslations(
      {
        namespace: mainAppTranslationNamespace,
        sourceHash,
        sourceStrings,
      },
      languageByLocale[locale],
      workspaceRoot,
    );
    assert.ok(strings, locale);

    for (const [key, expected] of Object.entries(corrections[locale])) {
      const source = sourceStrings[key];
      assert.equal(typeof source, "string", `${locale}/${key}/source-key`);
      assert.equal(expected, expected.normalize("NFC"), `${locale}/${key}/NFC`);
      assert.deepEqual(
        placeholders(expected),
        placeholders(source),
        `${locale}/${key}/placeholders`,
      );
      assert.equal(strings[key], expected, `${locale}/${key}`);
    }
  }
});

function parseLocaleCorrections(value: unknown) {
  assert.ok(isRecord(value), "correction fixture must be an object");
  return {
    ar: parseStringRecord(value.ar, "ar"),
    hi: parseStringRecord(value.hi, "hi"),
  };
}

function parseStringRecord(value: unknown, locale: string) {
  assert.ok(isRecord(value), `${locale} corrections must be an object`);
  const result: Record<string, string> = {};
  for (const [key, translated] of Object.entries(value)) {
    assert.ok(typeof translated === "string", `${locale}/${key}`);
    assert.ok(translated.trim(), `${locale}/${key}`);
    result[key] = translated;
  }
  return result;
}

function placeholders(value: string) {
  return [...value.matchAll(/\{[a-zA-Z0-9_]+\}/g)]
    .map(([placeholder]) => placeholder)
    .sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
