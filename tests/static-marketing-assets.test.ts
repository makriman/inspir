import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultLanguage, languageConfigs, supportedLanguages } from "../lib/content/languages";
import { topicSeeds } from "../lib/content/topics";
import {
  STATIC_ASSET_RELEASE_FILE_LIMIT,
  assertStaticAssetReleaseFileCount,
  materializeStaticMarketingAssets,
  validateStaticMarketingAssetRelease,
} from "../scripts/cloudflare/materialize-static-marketing-assets";
import { expectedLocalizedStaticAssetPaths } from "../scripts/cloudflare/static-asset-release-contract";

const fixtureIcon = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

test("OpenNext prerenders become direct Free-plan static assets", () => {
  const cwd = makeFixture();
  try {
    const report = materializeFixture(cwd);

    assert.equal(report.htmlDocuments, 54 + (supportedLanguages.length - 1) + supportedLanguages.length);
    assert.equal(report.localizedHomeDocuments, supportedLanguages.length - 1);
    assert.equal(report.staticChatDocuments, supportedLanguages.length);
    assert.equal(report.staticChatRedirects, topicSeeds.length * 2);
    assert.equal(report.staticChatExactRedirects, topicSeeds.length);
    assert.equal(report.staticChatDynamicRedirects, topicSeeds.length);
    assert.ok(report.staticChatDynamicRedirects < 100);
    assert.equal(report.staticMainAppBundles, supportedLanguages.length);
    assert.equal(report.legacyTranslationApiAssets, 4);
    assert.equal(report.legacyMainAppTranslationResponses, 2);
    assert.equal(report.legacySiteTranslationResponses, 2);
    assert.equal(report.legacyCompleteTranslationResponses, 4);
    assert.equal(report.legacyIncompleteTranslationResponses, 0);
    assert.equal(
      report.generatedPaths.some((entry) => entry.includes(".incomplete.json")),
      false,
    );
    assert.ok(report.legacyTranslationApiBytes > 0);
    assert.equal(report.routeDocuments, 9);
    assert.equal(report.skippedEntries, 5);
    assert.ok(report.assetFiles <= STATIC_ASSET_RELEASE_FILE_LIMIT);
    assert.match(report.outputSha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(cwd, ".open-next/assets/index.html"), "utf8"), "<h1>Home</h1>");
    assert.equal(fs.readFileSync(path.join(cwd, ".open-next/assets/about-0/index.html"), "utf8"), "<h1>0</h1>");
    assert.equal(fs.readFileSync(path.join(cwd, ".open-next/assets/sitemap.xml"), "utf8"), "<xml>index</xml>");
    assert.equal(
      fs.readFileSync(path.join(cwd, ".open-next/assets/manifest.webmanifest"), "utf8"),
      '{"name":"inspir"}',
    );
    assert.deepEqual(fs.readFileSync(path.join(cwd, ".open-next/assets/icon.png")), fixtureIcon);
    assert.equal(fs.existsSync(path.join(cwd, ".open-next/assets/api/secret/index.html")), false);
    assert.equal(fs.readFileSync(path.join(cwd, ".open-next/assets/api/topics"), "utf8"), '{"topics":[]}');
    assert.equal(fs.readFileSync(path.join(cwd, ".open-next/assets/chat/index.html"), "utf8"), "<h1>Chat</h1>");
    assert.equal(fs.readFileSync(path.join(cwd, ".open-next/assets/admin/index.html"), "utf8"), "<h1>Admin</h1>");
    assert.equal(
      fs.readFileSync(path.join(cwd, ".open-next/assets/reset_pw/index.html"), "utf8"),
      "<h1>Account recovery</h1>",
    );
    assert.equal(
      fs.readFileSync(path.join(cwd, ".open-next/assets/hi/chat/index.html"), "utf8"),
      "<h1>Hindi chat</h1>",
    );
    const hindiBundlePath = report.generatedPaths.find((entry) => entry.startsWith("i18n/main-app/hi."));
    assert.ok(hindiBundlePath);
    assert.match(hindiBundlePath, /^i18n\/main-app\/hi\.[a-f0-9]{64}\.[a-f0-9]{64}\.json$/);
    const hindiBundle = JSON.parse(
      fs.readFileSync(path.join(cwd, ".open-next/assets", hindiBundlePath), "utf8"),
    ) as { language?: string; sourceHash?: string; strings?: Record<string, string> };
    assert.equal(hindiBundle.language, "Hindi");
    assert.match(hindiBundle.sourceHash ?? "", /^[a-f0-9]{64}$/);
    assert.ok(Object.keys(hindiBundle.strings ?? {}).length > 1_000);
    const hindiBundleContent = fs.readFileSync(path.join(cwd, ".open-next/assets", hindiBundlePath));
    const hindiBundleFilenameParts = path.basename(hindiBundlePath, ".json").split(".");
    assert.equal(hindiBundleFilenameParts[1], hindiBundle.sourceHash);
    assert.equal(
      hindiBundleFilenameParts[2],
      crypto.createHash("sha256").update(hindiBundleContent).digest("hex"),
    );
    assert.equal(report.outputSha256, hashGeneratedOutput(cwd, report.generatedPaths));
    const redirects = fs.readFileSync(path.join(cwd, ".open-next/assets/_redirects"), "utf8");
    assert.match(redirects, /^\/tnc \/terms 308/m);
    assert.match(redirects, /^\/chat\/learn-anything \/chat\?topic=learn-anything 308$/m);
    assert.match(
      redirects,
      /^\/:locale\/chat\/learn-anything \/:locale\/chat\?topic=learn-anything 308$/m,
    );
    assert.equal(redirects.match(/^\/chat\/[a-z0-9-]+ \/chat\?topic=[a-z0-9-]+ 308$/gm)?.length, topicSeeds.length);
    assert.equal(
      redirects.match(/^\/:locale\/chat\/[a-z0-9-]+ \/:locale\/chat\?topic=[a-z0-9-]+ 308$/gm)?.length,
      topicSeeds.length,
    );
    assert.doesNotMatch(redirects, /\/chat(?:\?topic=[^\s]+)? 200$/m);
    assert.doesNotMatch(redirects, /\/chat\/\*/);
    assert.equal(fs.existsSync(path.join(cwd, ".open-next/assets/games")), false);
    assert.equal(fs.existsSync(path.join(cwd, ".open-next/assets/hi/games/index.html")), false);
    assert.equal(fs.existsSync(path.join(cwd, ".open-next/assets/hi/admin/index.html")), false);
    assert.equal(fs.existsSync(path.join(cwd, ".open-next/assets/hi/chat/private/index.html")), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("default release materialization seals the exact complete legacy contract", () => {
  const cwd = makeFixture();
  try {
    populateExpectedLocalizedCache(cwd);
    const report = materializeStaticMarketingAssets(cwd);
    const validation = validateStaticMarketingAssetRelease(cwd, {
      nowMs: Date.parse(report.createdAt),
    });

    assert.equal(report.legacyTranslationApiAssets, 280);
    assert.equal(report.legacyMainAppTranslationResponses, 70);
    assert.equal(report.legacySiteTranslationResponses, 210);
    assert.equal(report.legacyCompleteTranslationResponses, 280);
    assert.equal(report.legacyIncompleteTranslationResponses, 0);
    assert.equal(validation.assetFiles, report.assetFiles);
    assert.equal(validation.legacyTranslationPaths, 280);
    assert.equal(validation.assetManifest.bytes, report.assetManifestBytes);
    assert.equal(validation.assetManifest.sha256, report.assetManifestSha256);
    assert.equal(validation.outputSha256, report.outputSha256);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

function populateExpectedLocalizedCache(cwd: string) {
  for (const assetPath of expectedLocalizedStaticAssetPaths) {
    const cacheKey = assetPath.slice(0, -"/index.html".length);
    const cachePath = path.join(cwd, ".open-next/cache/build-test", `${cacheKey}.cache`);
    if (fs.existsSync(cachePath)) continue;
    writeCache(cwd, cacheKey, app(`<h1>${cacheKey}</h1>`));
  }
}

test("static materialization enforces the internal 5,000-file release limit", () => {
  assert.equal(STATIC_ASSET_RELEASE_FILE_LIMIT, 5_000);
  assert.doesNotThrow(() =>
    assertStaticAssetReleaseFileCount(STATIC_ASSET_RELEASE_FILE_LIMIT),
  );
  assert.throws(
    () => assertStaticAssetReleaseFileCount(STATIC_ASSET_RELEASE_FILE_LIMIT + 1),
    /Static asset count 5001 exceeds the internal release limit 5000/,
  );
});

test("static materialization refuses an actual release output above 5,000 files", () => {
  const cwd = makeFixture();
  try {
    const retainedAssets = path.join(cwd, ".open-next/assets/release-cap-fixture");
    fs.mkdirSync(retainedAssets, { recursive: true });
    for (let index = 0; index < STATIC_ASSET_RELEASE_FILE_LIMIT; index += 1) {
      fs.writeFileSync(path.join(retainedAssets, `${index}.txt`), "x");
    }
    assert.throws(
      () => materializeFixture(cwd),
      /Static asset count \d+ exceeds the internal release limit 5000/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("static materialization rejects unknown OpenNext cache contracts", () => {
  const cwd = makeFixture();
  try {
    writeCache(cwd, "broken", { type: "future-cache-contract", value: true });
    assert.throws(() => materializeFixture(cwd), /Unsupported OpenNext cache entry/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("static materialization rejects an invalid cached app icon", () => {
  const cwd = makeFixture();
  try {
    writeCache(cwd, "icon.png", binaryRoute(Buffer.from("not a png"), "image/png"));
    assert.throws(() => materializeFixture(cwd), /icon\.png cache must contain a valid PNG/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("static materialization rejects billable Next image optimizer URLs", () => {
  const cwd = makeFixture();
  try {
    writeCache(cwd, "optimizer-dependent", app('<img src="/_next/image?url=%2Fmedia%2Fhero.jpg&amp;w=640&amp;q=75">'));
    assert.throws(
      () => materializeFixture(cwd),
      /must not depend on the billable Next image optimizer/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("static materialization rejects residual game assets outside route HTML", () => {
  const cwd = makeFixture();
  try {
    fs.mkdirSync(path.join(cwd, ".open-next/assets/_next/static/chunks/app/games"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".open-next/assets/_next/static/chunks/app/games/page.js"),
      "removed game bundle",
    );
    assert.throws(
      () => materializeFixture(cwd),
      /Game assets must not be present in the static production output/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("static materialization counts committed and generated dynamic redirects together", () => {
  const cwd = makeFixture();
  try {
    const existingDynamicRules = Array.from(
      { length: 101 - topicSeeds.length },
      (_, index) => `/:locale/legacy-${index} /:locale/replacement-${index} 308`,
    );
    fs.writeFileSync(path.join(cwd, "public/_redirects"), `${existingDynamicRules.join("\n")}\n`);
    assert.throws(
      () => materializeFixture(cwd),
      /dynamic redirect rules; the limit is 100/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("static materialization counts committed and generated static redirects together", () => {
  const cwd = makeFixture();
  try {
    const existingStaticRules = Array.from(
      { length: 2_001 - topicSeeds.length },
      (_, index) => `/legacy-${index} /replacement-${index} 308`,
    );
    fs.writeFileSync(path.join(cwd, "public/_redirects"), `${existingStaticRules.join("\n")}\n`);
    assert.throws(
      () => materializeFixture(cwd),
      /redirect rules exceed the platform limits: 2001 static/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

function makeFixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-static-assets-"));
  fs.mkdirSync(path.join(cwd, ".open-next/assets"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".open-next/cache/build-test"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "public"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".open-next/assets/app.js"), "export{};");
  fs.mkdirSync(path.join(cwd, ".open-next/assets/games/tic-tac-toe"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".open-next/assets/games/tic-tac-toe/index.html"), "stale game");
  fs.writeFileSync(path.join(cwd, "public/_redirects"), "/tnc /terms 308\n");

  writeCache(cwd, "index", app("<h1>Home</h1>"));
  writeCache(cwd, "_not-found", app("<h1>Not found</h1>"));
  for (const language of supportedLanguages) {
    if (language === defaultLanguage) continue;
    const prefix = languageConfigs[language].prefix;
    writeCache(cwd, prefix, app(`<h1>${language}</h1>`));
  }
  for (let index = 0; index < 50; index += 1) {
    writeCache(cwd, `about-${index}`, app(`<h1>${index}</h1>`));
  }
  writeCache(cwd, "api/secret", app("private"));
  writeCache(cwd, "games", app("removed"));
  writeCache(cwd, "hi/games", app("removed localized game"));
  writeCache(cwd, "hi/admin", app("removed localized admin"));
  writeCache(cwd, "hi/chat/private", app("removed private chat"));
  writeCache(cwd, "admin", app("<h1>Admin</h1>"));
  writeCache(cwd, "chat", app("<h1>Chat</h1>"));
  writeCache(cwd, "reset_pw", app("<h1>Account recovery</h1>"));
  for (const language of supportedLanguages) {
    if (language === defaultLanguage) continue;
    const prefix = languageConfigs[language].prefix;
    writeCache(cwd, `${prefix}/chat`, app(language === "Hindi" ? "<h1>Hindi chat</h1>" : `<h1>${language} chat</h1>`));
  }
  writeCache(cwd, "api/topics", route('{"topics":[]}'));
  writeCache(cwd, "robots.txt", route("User-agent: *"));
  writeCache(cwd, "sitemap", route("<xml>index</xml>"));
  writeCache(cwd, "sitemap/en-US.xml", route("<xml>en</xml>"));
  writeCache(cwd, "llms.txt", route("# inspir"));
  writeCache(cwd, "llms-full.txt", route("# inspir full"));
  writeCache(cwd, "manifest.webmanifest", route('{"name":"inspir"}'));
  writeCache(cwd, "icon.png", binaryRoute(fixtureIcon, "image/png"));
  writeCache(cwd, "rss.xml", route("<rss />"));
  return cwd;
}

function materializeFixture(cwd: string) {
  return materializeStaticMarketingAssets(cwd, {
    legacyTranslationApi: {
      mainAppLanguages: ["English", "Hindi"],
      sitePairs: [
        { language: "English", namespace: "route:home" },
        { language: "Hindi", namespace: "route:home" },
      ],
    },
  });
}

function app(html: string) {
  return { type: "app", html };
}

function route(body: string) {
  return { type: "route", body };
}

function binaryRoute(body: Buffer, contentType: string) {
  return {
    type: "route",
    meta: { status: 200, headers: { "content-type": contentType } },
    body: body.toString("base64"),
  };
}

function writeCache(cwd: string, key: string, payload: object) {
  const file = path.join(cwd, ".open-next/cache/build-test", `${key}.cache`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
}

function hashGeneratedOutput(cwd: string, generatedPaths: string[]) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of generatedPaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(cwd, ".open-next/assets", relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
