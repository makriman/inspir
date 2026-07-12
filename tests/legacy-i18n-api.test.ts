import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleLegacyI18nApiRequest } from "../lib/free-runtime/legacy-i18n-api";
import { legacyTranslationAssetPath } from "../lib/i18n/legacy-api-compat";
import { materializeLegacyTranslationApiAssets } from "../scripts/cloudflare/materialize-legacy-translation-api-assets";

test("legacy language preference preserves cookies and locale redirects for cached pre-games clients", async () => {
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
    redirectTo: "/hi/about?ref=legacy",
  });
  const cookies = response.headers.get("set-cookie") ?? "";
  assert.match(cookies, /inspir_locale=Hindi/);
  assert.match(cookies, /inspir_locale_prompt_dismissed=1/);
  assert.match(cookies, /Max-Age=31536000/);
  assert.match(cookies, /SameSite=Lax/);
  assert.match(cookies, /Secure/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
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
    completion: "complete",
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
});

test("legacy site translation API preserves incomplete no-store results", async () => {
  const completePath = legacyTranslationAssetPath({
    kind: "site",
    language: "Hindi",
    namespace: "route:home",
    completion: "complete",
  });
  const incompletePath = legacyTranslationAssetPath({
    kind: "site",
    language: "Hindi",
    namespace: "route:home",
    completion: "incomplete",
  });
  const payload = JSON.stringify({
    bundle: { namespace: "route:home", language: "Hindi", strings: {} },
    complete: false,
    translatedCount: 0,
    totalCount: 2,
  });
  const env = fakeAssets(new Map([[`/${incompletePath}`, payload]]));
  const response = await handleLegacyI18nApiRequest(
    new Request(
      "https://inspirlearning.com/api/site-translations?language=Hindi&namespace=route%3Ahome",
    ),
    env,
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), payload);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(env.calls, [`/${completePath}`, `/${incompletePath}`]);
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

test("legacy translation response materialization creates exact static result assets", () => {
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-legacy-i18n-"));
  try {
    const report = materializeLegacyTranslationApiAssets(assetsRoot, {
      languages: ["English", "Hindi"],
      siteNamespaces: ["route:home"],
    });
    assert.equal(report.mainAppResponses, 2);
    assert.equal(report.siteResponses, 2);
    assert.equal(report.paths.length, 4);
    assert.equal(report.completeResponses + report.incompleteResponses, 4);
    assert.ok(report.bytes > 0);

    const englishMainPath = legacyTranslationAssetPath({
      kind: "main-app",
      language: "English",
      completion: "complete",
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

test("legacy translation response materialization rejects namespaces outside the generated manifest", () => {
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-legacy-i18n-invalid-"));
  try {
    assert.throws(
      () =>
        materializeLegacyTranslationApiAssets(assetsRoot, {
          languages: ["English"],
          siteNamespaces: ["route:retired-game-arena"],
        }),
      /Unknown legacy site-translation namespace/,
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
