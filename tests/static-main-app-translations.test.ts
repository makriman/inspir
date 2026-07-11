import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
} from "../lib/content/languages";
import { getCuratedMainAppTranslationBundle } from "../lib/i18n/main-app-curated";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "../lib/i18n/main-app-source";
import { buildStaticMainAppBundleAsset } from "../lib/i18n/main-app-static-asset";
import { readStaticMainAppTranslations } from "../lib/i18n/static-main-app-translations";

const workspaceRoot = process.cwd();
const trackedRoot = path.join(workspaceRoot, "translations/static-main-app");
const sourceStrings = getMainAppSourceStrings();
const sourceHash = getMainAppSourceHash(sourceStrings);
const source = {
  namespace: mainAppTranslationNamespace,
  sourceHash,
  sourceStrings,
};

test("tracked main-app packs cover every localized static chat shell", () => {
  const localizedLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);
  const files = fs.readdirSync(trackedRoot).filter((file) => file.endsWith(".json")).sort();
  assert.equal(files.length, localizedLanguages.length);

  let totalBytes = 0;
  for (const language of localizedLanguages) {
    const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
    const filePath = path.join(trackedRoot, `${locale}.json`);
    const serialized = fs.readFileSync(filePath, "utf8");
    totalBytes += Buffer.byteLength(serialized);
    assert.doesNotMatch(serialized, /"sourceStrings"\s*:|"source"\s*:/);

    const bundle = getCuratedMainAppTranslationBundle(language);
    assert.ok(bundle, `missing ${language} main-app bundle`);
    assert.equal(bundle.language, language);
    assert.equal(bundle.sourceHash, sourceHash);
    assert.equal(Object.keys(bundle.strings).length, Object.keys(sourceStrings).length);
    assert.doesNotThrow(() => buildStaticMainAppBundleAsset(locale, bundle));
  }
  assert.ok(totalBytes < 8_000_000, `tracked main-app packs grew to ${totalBytes} bytes`);
});

test("tracked main-app pack loads with no curated shards or D1 input", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-static-main-app-"));
  try {
    const compactRoot = path.join(tempRoot, "translations/static-main-app");
    fs.mkdirSync(compactRoot, { recursive: true });
    fs.copyFileSync(
      path.join(trackedRoot, "es.json"),
      path.join(compactRoot, "es.json"),
    );

    assert.equal(fs.existsSync(path.join(tempRoot, "translations/curated")), false);
    const strings = readStaticMainAppTranslations(source, "Spanish", tempRoot);
    assert.ok(strings);
    assert.equal(Object.keys(strings).length, Object.keys(sourceStrings).length);
    assert.equal(strings["language.prompt.title"], "Elige tu idioma de aprendizaje");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("tracked main-app pack fails closed against a different source hash", () => {
  assert.throws(
    () =>
      readStaticMainAppTranslations(
        { ...source, sourceHash: "f".repeat(64) },
        "Spanish",
        workspaceRoot,
      ),
    /source hash is stale/,
  );
});
