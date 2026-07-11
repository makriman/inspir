import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getCuratedMainAppTranslationBundle } from "../lib/i18n/main-app-curated";
import type { MainAppTranslationBundle } from "../lib/i18n/main-app-types";
import {
  buildStaticMainAppBundleAsset,
  retiredStaticGuestAuthTranslationKeys,
} from "../lib/i18n/main-app-static-asset";

const sourceHash = "a".repeat(64);

test("static main-app bundle URLs change after translation-only corrections", () => {
  const original: MainAppTranslationBundle = {
    namespace: "main-app",
    language: "Spanish",
    sourceHash,
    sourceStrings: { Continue: "Continue", Cancel: "Cancel" },
    strings: { Continue: "Continuar", Cancel: "Cancelar" },
  };
  const corrected: MainAppTranslationBundle = {
    ...original,
    strings: { ...original.strings, Continue: "Seguir" },
  };

  const first = buildStaticMainAppBundleAsset("es", original);
  const repeat = buildStaticMainAppBundleAsset("es", original);
  const changed = buildStaticMainAppBundleAsset("es", corrected);

  assert.deepEqual(first, repeat);
  assert.equal(first.sourceHash, changed.sourceHash);
  assert.notEqual(first.contentHash, changed.contentHash);
  assert.notEqual(first.publicPath, changed.publicPath);
  assert.match(
    first.publicPath,
    new RegExp(`^/i18n/main-app/es\\.${sourceHash}\\.[a-f0-9]{64}\\.json$`),
  );
  assert.deepEqual(JSON.parse(first.serialized), original);
});

test("static main-app bundle paths reject unsafe locale and source hash input", () => {
  const bundle: MainAppTranslationBundle = {
    namespace: "main-app",
    language: "English",
    sourceHash,
    sourceStrings: { Continue: "Continue" },
    strings: { Continue: "Continue" },
  };

  assert.throws(() => buildStaticMainAppBundleAsset("../en", bundle), /Unsafe main-app translation locale/);
  assert.throws(
    () => buildStaticMainAppBundleAsset("en-US", { ...bundle, sourceHash: "not-a-hash" }),
    /Invalid main-app translation source hash/,
  );
});

test("deployed guest bundles are complete translated subsets without retired account promises", () => {
  const curated = getCuratedMainAppTranslationBundle("English");
  assert.ok(curated);

  const asset = buildStaticMainAppBundleAsset("en-US", curated);
  const deployed = JSON.parse(asset.serialized) as MainAppTranslationBundle;
  const deployedSourceKeys = Object.keys(deployed.sourceStrings).sort();
  const deployedTranslationKeys = Object.keys(deployed.strings).sort();

  assert.equal(deployed.sourceHash, curated.sourceHash);
  assert.equal(deployedSourceKeys.length, Object.keys(curated.sourceStrings).length - 6);
  assert.deepEqual(deployedTranslationKeys, deployedSourceKeys);
  assert.ok(Object.values(deployed.strings).every((translation) => translation.trim().length > 0));
  for (const key of retiredStaticGuestAuthTranslationKeys) {
    assert.equal(key in deployed.sourceStrings, false);
    assert.equal(key in deployed.strings, false);
  }
  assert.doesNotMatch(
    asset.serialized,
    /Easy Google login|Continue with Google|Google email|Your saved chats|Sign in to keep learning/i,
  );
});

test("static guest bundle generation fails closed on a missing retained translation", () => {
  const bundle: MainAppTranslationBundle = {
    namespace: "main-app",
    language: "Spanish",
    sourceHash,
    sourceStrings: { Continue: "Continue" },
    strings: {},
  };

  assert.throws(
    () => buildStaticMainAppBundleAsset("es", bundle),
    /Incomplete static guest translation for es: Continue/,
  );
});

test("static guest bundle generation rejects unchanged copy and broken placeholders", () => {
  const unchanged: MainAppTranslationBundle = {
    namespace: "main-app",
    language: "Spanish",
    sourceHash,
    sourceStrings: { Continue: "Continue" },
    strings: { Continue: "Continue" },
  };
  const wrongPlaceholder: MainAppTranslationBundle = {
    namespace: "main-app",
    language: "Spanish",
    sourceHash,
    sourceStrings: { Greeting: "Hello {name}" },
    strings: { Greeting: "Hola {wrong}" },
  };

  assert.throws(
    () => buildStaticMainAppBundleAsset("es", unchanged),
    /Invalid static guest translation for es: Continue/,
  );
  assert.throws(
    () => buildStaticMainAppBundleAsset("es", wrongPlaceholder),
    /Invalid static guest translation for es: Greeting/,
  );
});

test("static guest client boundary receives an asset URL instead of translation data imports", () => {
  const page = fs.readFileSync(path.resolve("components/chat/StaticGuestChatPage.tsx"), "utf8");
  const bootstrap = fs.readFileSync(
    path.resolve("components/chat/StaticGuestChatBootstrap.tsx"),
    "utf8",
  );

  assert.doesNotMatch(page, /^"use client"/m);
  assert.match(page, /buildStaticMainAppBundleAsset/);
  assert.match(page, /translationBundleUrl=\{asset\.publicPath\}/);
  assert.doesNotMatch(
    bootstrap,
    /main-app-(?:curated|source|static-asset)|getCuratedMainAppTranslationBundle/,
  );
  assert.match(bootstrap, /fetch\(translationBundleUrl/);
});
