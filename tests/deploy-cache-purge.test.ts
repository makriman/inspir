import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildDeployHtmlPurgeTargets } from "../scripts/cloudflare/purge-deploy-html-cache";

test("deploy cache purge is targeted, complete, and production-confirmed", () => {
  const targets = buildDeployHtmlPurgeTargets();
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/purge-deploy-html-cache.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.ok(targets.files.includes("https://inspirlearning.com/"));
  assert.ok(targets.files.includes("https://inspirlearning.com/hi"));
  assert.ok(targets.prefixes.includes("inspirlearning.com/hi/"));
  assert.ok(targets.prefixes.includes("inspirlearning.com/blog/"));
  assert.ok(targets.prefixes.includes("inspirlearning.com/api/"));
  assert.ok(targets.files.some((url) => url.startsWith("https://www.inspirlearning.com/")));
  assert.ok(targets.prefixes.some((prefix) => prefix.startsWith("www.inspirlearning.com/")));
  assert.equal(targets.prefixes.some((prefix) => prefix.includes("://")), false);
  assert.equal(new Set(targets.files).size, targets.files.length);
  assert.equal(new Set(targets.prefixes).size, targets.prefixes.length);
  assert.equal(targets.prefixes.includes("inspirlearning.com/"), false);
  assert.match(source, /--confirm-production/);
  assert.match(source, /filePurgeBatchSize = 100/);
  assert.match(source, /prefixPurgeBatchSize = 30/);
  assert.match(source, /response\.status !== 429/);
  assert.equal(
    packageJson.scripts?.["cf:cache:purge-deploy-html"],
    "tsx scripts/cloudflare/purge-deploy-html-cache.ts",
  );
});
