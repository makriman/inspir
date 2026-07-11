import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { defaultLanguage, languageConfigs, supportedLanguages } from "../lib/content/languages";
import { staticSiteTranslationNamespaceAvailability } from "../lib/i18n/site-availability-manifest";
import { siteSourceManifest } from "../lib/i18n/site-source-manifest";
import { staticSiteLanguagesForPath } from "../lib/i18n/static-availability";

type CuratedPack = {
  language: string;
  namespace: string;
  sourceHash: string;
  translations?: Record<string, string>;
  entries?: Array<{ key?: string; value?: string }>;
};

test("localized routes are generated only for proven route coverage", () => {
  assert.equal(
    staticSiteLanguagesForPath("/").filter((language) => language !== defaultLanguage).length,
    supportedLanguages.length - 1,
  );
  assert.deepEqual(staticSiteLanguagesForPath("/mission"), [defaultLanguage, "Spanish"]);
  assert.deepEqual(staticSiteLanguagesForPath("/about"), [defaultLanguage]);
  assert.deepEqual(staticSiteLanguagesForPath("/reset_pw"), [defaultLanguage]);

  const localeRoot = path.resolve("app/[locale]");
  const pages = fs
    .readdirSync(localeRoot, { recursive: true })
    .filter((file): file is string => typeof file === "string" && /(?:^|\/)page\.tsx$/.test(file));
  assert.equal(pages.length, 18);

  for (const page of pages) {
    const source = fs.readFileSync(path.join(localeRoot, page), "utf8");
    assert.match(source, /generateLocalizedStaticParams\(/, `${page} must scope its generated locales to route coverage`);
    assert.match(source, /export const revalidate = false;/, `${page} must be immutable between deployments`);
    assert.doesNotMatch(source, /revalidate = 3600/);
  }

  const layout = fs.readFileSync(path.join(localeRoot, "layout.tsx"), "utf8");
  assert.match(layout, /export const dynamicParams = false;/);
  assert.match(layout, /export const revalidate = false;/);
  assert.doesNotMatch(layout, /supportedLanguages/);
});

test("every advertised deploy translation is committed, complete, and source-hash exact", () => {
  for (const language of supportedLanguages) {
    if (language === defaultLanguage) continue;
    const namespaces = staticSiteTranslationNamespaceAvailability[language] ?? [];
    const locale = languageConfigs[language].prefix || languageConfigs[language].locale;

    for (const namespace of namespaces ?? []) {
      const source = siteSourceManifest[namespace as keyof typeof siteSourceManifest];
      assert.ok(source, `Missing source manifest namespace ${namespace}`);
      const safeNamespace = namespace.replace(/[^a-z0-9.-]+/gi, "__");
      const filePath = path.resolve("translations/curated", locale, `${safeNamespace}.json`);
      assert.ok(fs.existsSync(filePath), `Missing deploy pack ${path.relative(process.cwd(), filePath)}`);

      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const pack = parseCuratedPack(parsed);
      assert.ok(pack, `Invalid deploy pack ${path.relative(process.cwd(), filePath)}`);
      assert.equal(pack.language, language);
      assert.equal(pack.namespace, namespace);
      assert.equal(pack.sourceHash, source.sourceHash);

      const strings: Record<string, string> = { ...pack.translations };
      for (const entry of pack.entries ?? []) {
        if (entry.key && entry.value?.trim()) strings[entry.key] = entry.value;
      }
      for (const key of Object.keys(source.sourceStrings)) {
        assert.ok(strings[key]?.trim(), `${language}/${namespace} is missing ${key}`);
      }
    }
  }
});

function parseCuratedPack(value: unknown): CuratedPack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.language !== "string" || typeof record.namespace !== "string" || typeof record.sourceHash !== "string") {
    return null;
  }
  const translations = record.translations;
  const rawEntries = record.entries;
  if (translations !== undefined && !isStringRecord(translations)) return null;
  if (rawEntries !== undefined && !Array.isArray(rawEntries)) return null;

  const entries: Array<{ key?: string; value?: string }> = [];
  for (const entry of rawEntries ?? []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    entries.push({
      key: typeof item.key === "string" ? item.key : undefined,
      value: typeof item.value === "string" ? item.value : undefined,
    });
  }

  return {
    language: record.language,
    namespace: record.namespace,
    sourceHash: record.sourceHash,
    translations,
    entries,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "string");
}
