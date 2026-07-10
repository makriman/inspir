import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("production health exposes version-attributed architecture without cacheable state", () => {
  const route = fs.readFileSync(path.resolve("app/api/health/route.ts"), "utf8");
  const wrangler = fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8");

  assert.match(route, /CF_VERSION_METADATA\.id/);
  assert.match(route, /process\.env\.OPEN_NEXT_BUILD_ID/);
  assert.match(route, /deploymentMode: "free-static-first"/);
  assert.match(route, /publicDocuments: "workers-static-assets"/);
  assert.match(route, /workerCpuPlan: "free-10ms"/);
  assert.match(route, /games: false/);
  assert.match(route, /Boolean\(env\.NEXT_CACHE_DO_QUEUE\)/);
  assert.match(route, /workerWideCache: false/);
  assert.match(route, /Cloudflare-CDN-Cache-Control/);
  assert.match(route, /private, no-store/);
  assert.match(wrangler, /"version_metadata"/);
  assert.match(wrangler, /"binding": "CF_VERSION_METADATA"/);
});

test("obsolete public ISR health probe is not exposed on the Free Worker", () => {
  assert.equal(fs.existsSync(path.resolve("app/api/cache-health/route.ts")), false);
});
