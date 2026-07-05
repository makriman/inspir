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

test("marketing dynamic rendering is documented as localization-sensitive", () => {
  const layout = read("app/(marketing)/layout.tsx");
  const docs = read("docs/runtime-routes.md");

  assert.match(layout, /export const dynamic = "force-dynamic"/);
  assert.match(docs, /Marketing HTML under `app\/\(marketing\)` is intentionally dynamic today/);
  assert.match(docs, /preserved DB-backed translations/);
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
