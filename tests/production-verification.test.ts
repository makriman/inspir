import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("production verification covers the resource-outage contracts", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/verify-production.ts"), "utf8");
  const outcomes = fs.readFileSync(
    path.resolve("scripts/cloudflare/verify-production-worker-outcomes.ts"),
    "utf8",
  );
  const headers = fs.readFileSync(path.resolve("public/_headers"), "utf8");

  assert.match(source, /checkRuntimeHealth/);
  assert.match(source, /checkActiveMainWorkerDeployment/);
  assert.match(source, /deployments", "status"/);
  assert.match(source, /requiredPercentage: 100/);
  assert.match(source, /pinMainWorkerVersion: false/);
  assert.match(source, /checkWwwCanonicalRedirect/);
  assert.match(source, /www\.inspirlearning\.com\/hi\/about/);
  assert.match(source, /www-redirect-worker/);
  assert.match(source, /redirect\.status === 308/);
  assert.match(source, /checkWorkerDelivery/);
  assert.doesNotMatch(source, /checkCacheRevalidation/);
  assert.doesNotMatch(source, /findStableCachePair/);
  assert.doesNotMatch(source, /\/api\/cache-health/);
  assert.match(source, /checkAuthCacheIsolation/);
  assert.match(source, /checkRemovedTranslationApis/);
  assert.match(source, /Cloudflare-Workers-Version-Overrides/);
  assert.match(source, /expectedWorkerVersion/);
  assert.match(outcomes, /--version-id/);
  assert.match(outcomes, /exceededCpu/);
  assert.match(outcomes, /exceededMemory/);
  assert.match(outcomes, /Dummy queue is not implemented/);
  assert.match(outcomes, /requireActiveDeployment/);
  assert.match(outcomes, /missingWorkerInvocations/);
  assert.match(outcomes, /missingCpuSamples/);
  assert.match(outcomes, /cpuThresholdViolations/);
  assert.match(outcomes, /workerCpuHeadroomThresholdMs/);
  assert.match(outcomes, /routeCounts/);
  assert.match(outcomes, /resourceSoak/);
  assert.match(outcomes, /nonOkInvocations/);
  assert.match(outcomes, /workerInvokedStaticRoutes/);
  assert.match(outcomes, /\/api\/topics\?resource_soak/);
  assert.match(outcomes, /\/chat\/learn-anything\?resource_soak/);
  assert.match(outcomes, /\/api\/guest-chat\?resource_soak/);
  assert.match(outcomes, /method: "POST"/);
  assert.match(outcomes, /safeRequestUrl/);
  assert.match(outcomes, /classifySoakRequestError/);
  assert.match(source, /checkLocaleResourceSoak/);
  assert.match(source, /checkStaticAssetDelivery/);
  assert.match(source, /checkStaticNotFound/);
  assert.match(source, /unknown public route/);
  assert.match(source, /unknown API route/);
  assert.match(source, /x-inspir-delivery/);
  assert.match(source, /\/sitemap\.xml/);
  assert.match(source, /\/manifest\.webmanifest/);
  assert.match(source, /static legal redirect/);
  assert.match(source, /\/loading/);
  assert.match(source, /\/inspir-social-preview\.png/);
  assert.match(source, /staticSiteLanguagesForPath/);
  assert.doesNotMatch(source, /checkImmutableLocalizedCacheControl/);
  assert.match(headers, /X-Inspir-Delivery: static-assets/);
  assert.match(source, /REQUIRE_RESOURCE_SOAK/);
  assert.match(source, /ai-game-arena/);
  assert.match(source, /request\("\/games"\)/);
  assert.match(source, /removed game surface/);
  assert.match(source, /cf-cache-status/);
});

test("Worker outcome soak records sanitized request failures without leaking URLs", async () => {
  const { classifySoakRequestError, workerCpuHeadroomThresholdMs } = await import(
    "../scripts/cloudflare/verify-production-worker-outcomes"
  );
  assert.equal(workerCpuHeadroomThresholdMs, 8);
  const timeout = new Error("request timed out at https://inspirlearning.com/private?token=secret");
  timeout.name = "TimeoutError";
  assert.equal(classifySoakRequestError(timeout), "timeout");

  const network = new Error("fetch failed for https://inspirlearning.com/private?token=secret");
  network.name = "TypeError<script>";
  const classified = classifySoakRequestError(network);
  assert.equal(classified, "network:TypeErrorscript");
  assert.doesNotMatch(classified, /inspirlearning|private|secret/i);
  assert.equal(classifySoakRequestError("https://inspirlearning.com/private?token=secret"), "network:unknown");
});
