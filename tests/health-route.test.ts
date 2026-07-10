import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("production health exposes version-attributed architecture without cacheable state", () => {
  const route = fs.readFileSync(path.resolve("app/api/health/route.ts"), "utf8");
  const wrangler = fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8");

  assert.match(route, /CF_VERSION_METADATA\.id/);
  assert.match(route, /process\.env\.OPEN_NEXT_BUILD_ID/);
  assert.match(route, /Boolean\(env\.NEXT_CACHE_DO_QUEUE\)/);
  assert.match(route, /workerWideCache: false/);
  assert.match(route, /Cloudflare-CDN-Cache-Control/);
  assert.match(route, /private, no-store/);
  assert.match(wrangler, /"version_metadata"/);
  assert.match(wrangler, /"binding": "CF_VERSION_METADATA"/);
});

test("cache health is a tiny time-based ISR probe for the Durable Object queue", () => {
  const route = fs.readFileSync(path.resolve("app/api/cache-health/route.ts"), "utf8");

  assert.match(route, /export const dynamic = "force-static"/);
  assert.match(route, /export const revalidate = 5/);
  assert.match(route, /X-Inspir-Cache-Generated-At/);
  assert.match(route, /s-maxage=5/);
});
