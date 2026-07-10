import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { materializeStaticMarketingAssets } from "../scripts/cloudflare/materialize-static-marketing-assets";

test("OpenNext prerenders become direct Free-plan static assets", () => {
  const cwd = makeFixture();
  try {
    const report = materializeStaticMarketingAssets(cwd);

    assert.equal(report.htmlDocuments, 102);
    assert.equal(report.localizedHomeDocuments, 50);
    assert.equal(report.routeDocuments, 7);
    assert.equal(report.skippedEntries, 2);
    assert.ok(report.assetFiles < 20_000);
    assert.match(report.outputSha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(cwd, ".open-next/assets/index.html"), "utf8"), "<h1>Home</h1>");
    assert.equal(fs.readFileSync(path.join(cwd, ".open-next/assets/about-0/index.html"), "utf8"), "<h1>0</h1>");
    assert.equal(fs.readFileSync(path.join(cwd, ".open-next/assets/sitemap.xml"), "utf8"), "<xml>index</xml>");
    assert.equal(
      fs.readFileSync(path.join(cwd, ".open-next/assets/manifest.webmanifest"), "utf8"),
      '{"name":"inspir"}',
    );
    assert.equal(fs.existsSync(path.join(cwd, ".open-next/assets/api/secret/index.html")), false);
    assert.equal(fs.existsSync(path.join(cwd, ".open-next/assets/games/index.html")), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("static materialization rejects unknown OpenNext cache contracts", () => {
  const cwd = makeFixture();
  try {
    writeCache(cwd, "broken", { type: "future-cache-contract", value: true });
    assert.throws(() => materializeStaticMarketingAssets(cwd), /Unsupported OpenNext cache entry/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("static materialization rejects billable Next image optimizer URLs", () => {
  const cwd = makeFixture();
  try {
    writeCache(cwd, "optimizer-dependent", app('<img src="/_next/image?url=%2Fmedia%2Fhero.jpg&amp;w=640&amp;q=75">'));
    assert.throws(
      () => materializeStaticMarketingAssets(cwd),
      /must not depend on the billable Next image optimizer/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

function makeFixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-static-assets-"));
  fs.mkdirSync(path.join(cwd, ".open-next/assets"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".open-next/cache/build-test"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".open-next/assets/app.js"), "export{};");

  writeCache(cwd, "index", app("<h1>Home</h1>"));
  writeCache(cwd, "_not-found", app("<h1>Not found</h1>"));
  for (let index = 0; index < 50; index += 1) {
    writeCache(cwd, localeCode(index), app(`<h1>Locale ${index}</h1>`));
  }
  for (let index = 0; index < 50; index += 1) {
    writeCache(cwd, `about-${index}`, app(`<h1>${index}</h1>`));
  }
  writeCache(cwd, "api/secret", app("private"));
  writeCache(cwd, "games", app("removed"));
  writeCache(cwd, "robots.txt", route("User-agent: *"));
  writeCache(cwd, "sitemap", route("<xml>index</xml>"));
  writeCache(cwd, "sitemap/en-US.xml", route("<xml>en</xml>"));
  writeCache(cwd, "llms.txt", route("# inspir"));
  writeCache(cwd, "llms-full.txt", route("# inspir full"));
  writeCache(cwd, "manifest.webmanifest", route('{"name":"inspir"}'));
  writeCache(cwd, "rss.xml", route("<rss />"));
  return cwd;
}

function app(html: string) {
  return { type: "app", html };
}

function route(body: string) {
  return { type: "route", body };
}

function localeCode(index: number) {
  const first = String.fromCharCode(97 + Math.floor(index / 26));
  const second = String.fromCharCode(97 + (index % 26));
  return `${first}${second}`;
}

function writeCache(cwd: string, key: string, payload: object) {
  const file = path.join(cwd, ".open-next/cache/build-test", `${key}.cache`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
}
