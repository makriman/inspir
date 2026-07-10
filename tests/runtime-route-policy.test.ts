import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("public topics API is bounded by a cache policy", () => {
  const source = read("app/api/topics/route.ts");

  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /Cache-Control/);
  assert.match(source, /public, max-age=300, s-maxage=3600, stale-while-revalidate=86400/);
});

test("marketing rendering is documented as coverage-scoped and deploy-time immutable", () => {
  const layout = read("app/(marketing)/layout.tsx");
  const docs = read("docs/runtime-routes.md");

  assert.doesNotMatch(layout, /export const dynamic = "force-dynamic"/);
  assert.match(docs, /Localized marketing HTML is deploy-time immutable/);
  assert.match(docs, /source-hash-exact curated packs/);
  assert.match(docs, /Generated links use canonical English when coverage is missing/);
  assert.match(docs, /direct unsupported localized URL receives the static `404`/);
  assert.doesNotMatch(docs, /future static-marketing project/);
});

test("static SEO and AI discovery routes stay explicitly static or cached", () => {
  const staticRoutes = [
    "app/sitemap/route.ts",
    "app/sitemap/[locale]/route.ts",
    "app/rss.xml/route.ts",
    "app/llms.txt/route.ts",
    "app/llms-full.txt/route.ts",
    "app/ai-content-index.json/route.ts",
  ];

  for (const route of staticRoutes) {
    const source = read(route);
    assert.match(source, /force-static|s-maxage|revalidate/, `${route} should declare static rendering or cache headers`);
  }
});

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}
