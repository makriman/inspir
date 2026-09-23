import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("production health exposes version-attributed architecture without cacheable state", () => {
  const route = fs.readFileSync(path.resolve("cloudflare-worker.ts"), "utf8");
  const wrangler = fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8");

  assert.match(route, /CF_VERSION_METADATA\.id/);
  assert.match(route, /deploymentMode: "free-static-native-accounts"/);
  assert.match(route, /publicDocuments: "workers-static-assets"/);
  assert.match(route, /workerCpuPlan: "free-10ms"/);
  assert.match(route, /openNext: false/);
  assert.match(route, /accounts: true/);
  assert.match(route, /savedState: true/);
  assert.match(route, /memory: true/);
  assert.match(route, /admin: true/);
  assert.match(route, /games: false/);
  assert.match(route, /cacheQueueActive: false/);
  assert.match(route, /memoryQueueActive: true/);
  assert.match(route, /cloudflare-cdn-cache-control/);
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(route, /\.open-next\/worker\.js|@opennextjs\/cloudflare|next\/server/);
  assert.match(wrangler, /"version_metadata"/);
  assert.match(wrangler, /"binding": "CF_VERSION_METADATA"/);
});

test("obsolete public ISR health probe is not exposed on the Free Worker", () => {
  assert.equal(fs.existsSync(path.resolve("app/api/cache-health/route.ts")), false);
});

test("Next health stays labeled as the non-production probe", () => {
  const nextHealth = fs.readFileSync(path.resolve("app/api/health/route.ts"), "utf8");
  const liveHealth = fs.readFileSync(path.resolve("cloudflare-worker.ts"), "utf8");

  assert.match(nextHealth, /Non-production health probe/);
  assert.match(nextHealth, /pnpm dev/);
  assert.match(nextHealth, /do not deploy \.open-next\/worker\.js/i);
  assert.match(nextHealth, /deploymentMode: "free-static-first"/);
  assert.match(nextHealth, /incrementalCache: "regional-r2"/);
  assert.match(liveHealth, /Live GET \/api\/health for this Worker/);
  assert.match(liveHealth, /Trust this body over app\/api\/health\/route\.ts/);
  assert.doesNotMatch(liveHealth, /\.open-next\/worker\.js|@opennextjs\/cloudflare|next\/server/);
});
