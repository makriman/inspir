import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultLanguage, supportedLanguages } from "../lib/content/languages";
import { handleLegacyI18nApiRequest } from "../lib/free-runtime/legacy-i18n-api";
import {
  getPublishedLegacySiteTranslationNamespaces,
  getPublishedLegacySiteTranslationPairs,
  isPublishedLegacySiteTranslationPair,
  legacyTranslationAssetPath,
} from "../lib/i18n/legacy-api-compat";
import { renderLocalizedSiteTranslationNamespaces } from "../lib/i18n/render-localized-namespaces";
import { staticSiteTranslationNamespaceAvailability } from "../lib/i18n/site-availability-manifest";
import { materializeLegacyTranslationApiAssets } from "../scripts/cloudflare/materialize-legacy-translation-api-assets";

test("legacy site compatibility allowlist exactly follows published translation availability", () => {
  const pairs = getPublishedLegacySiteTranslationPairs();
  assert.equal(supportedLanguages.length, 70);
  assert.equal(pairs.length, 210);
  assert.equal(new Set(pairs.map(({ language, namespace }) => `${language}\u0000${namespace}`)).size, 210);

  for (const language of supportedLanguages) {
    const expected =
      language === defaultLanguage
        ? renderLocalizedSiteTranslationNamespaces
        : (staticSiteTranslationNamespaceAvailability[language] ?? []);
    assert.deepEqual(getPublishedLegacySiteTranslationNamespaces(language), expected);
    assert.deepEqual(
      pairs.filter((pair) => pair.language === language).map((pair) => pair.namespace),
      [...expected],
    );
  }

  assert.equal(isPublishedLegacySiteTranslationPair("Hindi", "route:home"), true);
  assert.equal(isPublishedLegacySiteTranslationPair("Hindi", "route:about"), false);
});

test("legacy language preference redirects only to published localized site paths", async () => {
  const env = fakeAssets();
  const response = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/language-preference", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "Hindi", pathname: "/es/about?ref=legacy" }),
    }),
    env,
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    language: "Hindi",
    redirectTo: "/about?ref=legacy",
  });
  const cookies = response.headers.get("set-cookie") ?? "";
  assert.match(cookies, /inspir_locale=Hindi/);
  assert.match(cookies, /inspir_locale_prompt_dismissed=1/);
  assert.match(cookies, /Max-Age=31536000/);
  assert.match(cookies, /SameSite=Lax/);
  assert.match(cookies, /Secure/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);

  const published = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/language-preference", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "Hindi", pathname: "/es/mission?ref=legacy" }),
    }),
    env,
  );
  assert.ok(published);
  assert.deepEqual(await published.json(), {
    language: "Hindi",
    redirectTo: "/hi/mission?ref=legacy",
  });
});

test("legacy language preference bounds input and closes scheme-relative redirects", async () => {
  const env = fakeAssets();
  const unsafe = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/language-preference", {
      method: "POST",
      body: JSON.stringify({ language: "Hindi", pathname: "/hi//outside.example" }),
    }),
    env,
  );
  assert.ok(unsafe);
  assert.deepEqual(await unsafe.json(), { language: "Hindi", redirectTo: "/hi" });

  const malformed = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/language-preference", {
      method: "POST",
      body: "not-json",
    }),
    env,
  );
  assert.ok(malformed);
  assert.deepEqual(await malformed.json(), { language: "English", redirectTo: "/" });

  const oversized = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/language-preference", {
      method: "POST",
      body: JSON.stringify({ pathname: `/${"x".repeat(4_096)}` }),
    }),
    env,
  );
  assert.ok(oversized);
  assert.equal(oversized.status, 413);
});

test("legacy main-app translation API streams complete static envelopes", async () => {
  const assetPath = legacyTranslationAssetPath({
    kind: "main-app",
    language: "Hindi",
  });
  const payload = JSON.stringify({
    bundle: { language: "Hindi" },
    complete: true,
    translatedCount: 1,
    totalCount: 1,
  });
  const env = fakeAssets(new Map([[`/${assetPath}`, payload]]));
  const response = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/main-app-translations?language=Hindi"),
    env,
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), payload);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=3600");
  assert.deepEqual(env.calls, [`/${assetPath}`]);

  const headResponse = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/main-app-translations?language=Hindi", {
      method: "HEAD",
    }),
    env,
  );
  assert.ok(headResponse);
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), "");
  assert.deepEqual(env.calls, [`/${assetPath}`, `/${assetPath}`]);
});

test("legacy site translation API streams one complete published asset", async () => {
  const completePath = legacyTranslationAssetPath({
    kind: "site",
    language: "Hindi",
    namespace: "route:home",
  });
  const payload = JSON.stringify({
    bundle: { namespace: "route:home", language: "Hindi", strings: { example: "उदाहरण" } },
    complete: true,
    translatedCount: 1,
    totalCount: 1,
  });
  const env = fakeAssets(new Map([[`/${completePath}`, payload]]));
  const response = await handleLegacyI18nApiRequest(
    new Request(
      "https://inspirlearning.com/api/site-translations?language=Hindi&namespace=route%3Ahome",
    ),
    env,
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), payload);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=3600");
  assert.deepEqual(env.calls, [`/${completePath}`]);
});

test("known unpublished legacy site pairs return private 404 without an asset lookup", async () => {
  const env = fakeAssets();
  const route =
    "https://inspirlearning.com/api/site-translations?language=Hindi&namespace=route%3Aabout";
  const response = await handleLegacyI18nApiRequest(new Request(route), env);

  assert.ok(response);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Translation bundle is not published" });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("cdn-cache-control"), "private, no-store");
  assert.deepEqual(env.calls, []);

  const headResponse = await handleLegacyI18nApiRequest(
    new Request(route, { method: "HEAD" }),
    env,
  );
  assert.ok(headResponse);
  assert.equal(headResponse.status, 404);
  assert.equal(await headResponse.text(), "");
  assert.deepEqual(env.calls, []);
});

test("missing published legacy site assets remain logged private 503 responses", async () => {
  const completePath = legacyTranslationAssetPath({
    kind: "site",
    language: "Hindi",
    namespace: "route:home",
  });
  const env = fakeAssets();
  const errors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (value?: unknown) => {
    errors.push(String(value));
  };
  try {
    const response = await handleLegacyI18nApiRequest(
      new Request(
        "https://inspirlearning.com/api/site-translations?language=Hindi&namespace=route%3Ahome",
      ),
      env,
    );

    assert.ok(response);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Translation bundle is temporarily unavailable",
    });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(env.calls, [`/${completePath}`]);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /"event":"legacy_translation_asset_missing"/);
  assert.match(errors[0] ?? "", /"namespace":"route:home"/);
});

test("legacy translation APIs retain strict parameter and method contracts", async () => {
  const env = fakeAssets();
  const invalidLanguage = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/main-app-translations?language=hindi"),
    env,
  );
  assert.ok(invalidLanguage);
  assert.equal(invalidLanguage.status, 400);
  assert.deepEqual(await invalidLanguage.json(), { error: "Unsupported language" });

  const invalidNamespace = await handleLegacyI18nApiRequest(
    new Request(
      "https://inspirlearning.com/api/site-translations?language=Hindi&namespace=unknown",
    ),
    env,
  );
  assert.ok(invalidNamespace);
  assert.equal(invalidNamespace.status, 400);
  assert.deepEqual(await invalidNamespace.json(), { error: "Unsupported namespace" });

  const wrongMethod = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/main-app-translations?language=Hindi", {
      method: "POST",
    }),
    env,
  );
  assert.ok(wrongMethod);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET, HEAD");
  assert.deepEqual(env.calls, []);
});

test("legacy translation runtime stays dictionary-free and fails closed without Static Assets", async () => {
  const runtimeSource = fs.readFileSync(
    path.resolve("lib/free-runtime/legacy-i18n-api.ts"),
    "utf8",
  );
  const pathSource = fs.readFileSync(path.resolve("lib/i18n/legacy-api-compat.ts"), "utf8");
  assert.doesNotMatch(
    `${runtimeSource}\n${pathSource}`,
    /node:|curated-translations|site-source-manifest|main-app-source/,
  );

  const response = await handleLegacyI18nApiRequest(
    new Request("https://inspirlearning.com/api/main-app-translations?language=English"),
    {},
  );
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("legacy translation response materialization creates exact complete static result assets", () => {
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-legacy-i18n-"));
  try {
    const report = materializeLegacyTranslationApiAssets(assetsRoot, {
      mainAppLanguages: ["English", "Hindi"],
      sitePairs: [
        { language: "English", namespace: "route:home" },
        { language: "Hindi", namespace: "route:home" },
      ],
    });
    assert.equal(report.mainAppResponses, 2);
    assert.equal(report.siteResponses, 2);
    assert.equal(report.paths.length, 4);
    assert.equal(report.completeResponses, 4);
    assert.equal(report.incompleteResponses, 0);
    assert.ok(report.paths.every((assetPath) => assetPath.endsWith(".complete.json")));
    assert.ok(report.bytes > 0);

    const englishMainPath = legacyTranslationAssetPath({
      kind: "main-app",
      language: "English",
    });
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(assetsRoot, englishMainPath), "utf8"),
    );
    assert.ok(isRecord(parsed));
    assert.deepEqual(Object.keys(parsed).sort(), [
      "bundle",
      "complete",
      "totalCount",
      "translatedCount",
    ]);
    assert.equal(parsed.complete, true);
    assert.equal(parsed.translatedCount, parsed.totalCount);
  } finally {
    fs.rmSync(assetsRoot, { recursive: true, force: true });
  }
});

test("default legacy materialization emits exactly the 280 complete compatibility assets", () => {
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-legacy-i18n-full-"));
  try {
    const report = materializeLegacyTranslationApiAssets(assetsRoot);
    assert.equal(report.mainAppResponses, 70);
    assert.equal(report.siteResponses, 210);
    assert.equal(report.paths.length, 280);
    assert.equal(report.completeResponses, 280);
    assert.equal(report.incompleteResponses, 0);
    assert.ok(report.paths.every((assetPath) => assetPath.endsWith(".complete.json")));
    assert.equal(
      report.paths.some((assetPath) => assetPath.includes(".incomplete.json")),
      false,
    );
  } finally {
    fs.rmSync(assetsRoot, { recursive: true, force: true });
  }
});

test("legacy translation response materialization rejects namespaces outside the generated manifest", () => {
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-legacy-i18n-invalid-"));
  try {
    assert.throws(
      () =>
        materializeLegacyTranslationApiAssets(assetsRoot, {
          mainAppLanguages: ["English"],
          sitePairs: [{ language: "English", namespace: "route:retired-game-arena" }],
        }),
      /Unknown legacy site-translation namespace/,
    );
  } finally {
    fs.rmSync(assetsRoot, { recursive: true, force: true });
  }
});

test("legacy translation response materialization rejects known unpublished pairs", () => {
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-legacy-i18n-unpublished-"));
  try {
    assert.throws(
      () =>
        materializeLegacyTranslationApiAssets(assetsRoot, {
          mainAppLanguages: ["English"],
          sitePairs: [{ language: "English", namespace: "route:about" }],
        }),
      /Unpublished legacy site-translation pair: English\/route:about/,
    );
  } finally {
    fs.rmSync(assetsRoot, { recursive: true, force: true });
  }
});

function fakeAssets(responses: ReadonlyMap<string, string> = new Map()) {
  const calls: string[] = [];
  return {
    calls,
    ASSETS: {
      async fetch(request: Request) {
        const pathname = new URL(request.url).pathname;
        calls.push(pathname);
        const body = responses.get(pathname);
        return body === undefined
          ? new Response("not found", { status: 404 })
          : new Response(request.method === "HEAD" ? null : body, {
              status: 200,
              headers: { "content-type": "application/json" },
            });
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
