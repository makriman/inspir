import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  expirationDateForRetirement,
  retiredBuildRuleName,
  retiredCachePrefix,
} from "../scripts/cloudflare/retire-next-cache-build";

test("OpenNext R2 retention targets only a verified retired build prefix", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/retire-next-cache-build.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(retiredCachePrefix("Zc9XxoyRGMm9AMhoWkpR7"), "incremental-cache/Zc9XxoyRGMm9AMhoWkpR7/");
  assert.match(retiredBuildRuleName("Zc9XxoyRGMm9AMhoWkpR7"), /^inspir-opennext-retired-[a-f0-9]{16}$/);
  assert.throws(() => retiredCachePrefix("../active"));
  assert.throws(() => retiredCachePrefix("no-build-id"));
  assert.throws(() => retiredCachePrefix("unknown-build"));
  assert.equal(expirationDateForRetirement(new Date("2026-07-10T12:00:00Z")), "2026-10-08");
  assert.match(source, /const retentionDays = 90/);
  assert.match(source, /if \(!before\.includes\(ruleName\)\)/);
  assert.match(source, /activeIdentity\.buildId === buildId/);
  assert.match(source, /--expected-active-version/);
  assert.match(source, /--expected-active-build/);
  assert.match(source, /deployments", "status", "--json"/);
  assert.match(source, /versions\.length !== 1/);
  assert.match(source, /--expire-date/);
  assert.doesNotMatch(source, /--expire-days/);
  assert.match(source, /expirationDate === expectedExpirationDate/);
  assert.match(source, /expirationDateIsFuture\(expirationDate, retirementTime\)/);
  assert.match(source, /record\?\.ok === true/);
  assert.match(source, /retiredCachePrefix\(buildId\)/);
  assert.match(source, /R2_BUCKET_NAME/);
  assert.equal(
    packageJson.scripts?.["cf:r2:retire-cache-build"],
    "tsx scripts/cloudflare/retire-next-cache-build.ts",
  );
});
