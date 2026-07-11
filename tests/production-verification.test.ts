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
  const workerRoutes = outcomes.match(
    /const workerRoutes: SoakRoute\[\] = \[([\s\S]*?)\n  \];\n  const staticRoutes/,
  )?.[1];
  const staticRoutes = outcomes.match(
    /const staticRoutes: SoakRoute\[\] = \[([\s\S]*?)\n  \];\n  const results/,
  )?.[1];

  assert.ok(workerRoutes, "Worker route list should remain statically inspectable");
  assert.ok(staticRoutes, "static route list should remain statically inspectable");

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
  assert.match(source, /delivery === "lean-api-worker"/);
  assert.match(source, /deploymentMode === "free-static-lean-guest"/);
  assert.match(source, /architecture\.openNext === false/);
  assert.match(source, /architecture\.accounts === false/);
  assert.match(source, /architecture\.savedState === false/);
  assert.match(source, /architecture\.games === false/);
  assert.doesNotMatch(source, /checkCacheRevalidation/);
  assert.doesNotMatch(source, /findStableCachePair/);
  assert.doesNotMatch(source, /\/api\/cache-health/);
  assert.doesNotMatch(source, /checkAuthCacheIsolation/);
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
  assert.match(outcomes, /waitForTailReadiness/);
  assert.match(outcomes, /tail_ready_probe/);
  assert.match(outcomes, /tail_settle_probe/);
  assert.match(outcomes, /waitForCapturedRequestKeys/);
  assert.match(outcomes, /tailOutputBytes/);
  assert.match(outcomes, /tailDiagnosticsBytes/);
  assert.match(outcomes, /x-inspir-tail-session/);
  assert.match(outcomes, /Cloudflare tail redacts UUID-like query values/);
  assert.match(outcomes, /SIGKILL/);
  assert.match(outcomes, /static-redirect/);
  assert.match(outcomes, /static-redirect-delivery/);
  assert.match(outcomes, /workerProbePaceMs/);
  assert.match(outcomes, /for \(let index = 0; index < workerRoutes\.length; index \+= 1\)/);
  assert.match(outcomes, /await delay\(workerProbePaceMs\)/);
  assert.equal([...workerRoutes.matchAll(/workerGet\(/g)].length, 1);
  assert.match(workerRoutes, /\/api\/health\?resource_soak/);
  assert.match(workerRoutes, /\/api\/guest-chat\?resource_soak/);
  assert.doesNotMatch(workerRoutes, /\/api\/topics|\/api\/auth|\/chat\/learn-anything/);
  assert.match(outcomes, /actualDelivery !== probe\.expectedDelivery/);
  assert.match(outcomes, /expectedDelivery: "lean-api-worker"/);
  assert.match(outcomes, /expectedContentType: "text\/event-stream"/);
  assert.match(outcomes, /requireOpenAiDelta: true/);
  assert.match(outcomes, /requireGuestQuotaHeaders: true/);
  assert.match(outcomes, /parsedOpenAiDeltaCount/);
  assert.match(outcomes, /guestQuotaHeadersValid/);
  assert.match(outcomes, /method: "POST"/);
  assert.match(outcomes, /safeRequestUrl/);
  assert.match(outcomes, /classifySoakRequestError/);
  assert.match(outcomes, /sample\.cpuTimeMs >= workerCpuHeadroomThresholdMs/);
  assert.match(source, /checkLocaleResourceSoak/);
  assert.match(source, /checkStaticAssetDelivery/);
  assert.match(source, /checkStaticNotFound/);
  assert.match(source, /unknown public route/);
  assert.match(source, /unknown API route/);
  assert.match(source, /x-inspir-delivery/);
  assert.match(source, /\/sitemap\.xml/);
  assert.match(source, /\/manifest\.webmanifest/);
  assert.match(source, /static legal redirect/);
  assert.match(source, /isStaticRedirectDelivery\(tnc\.headers\["x-inspir-delivery"\]\)/);
  assert.match(source, /\/loading/);
  assert.match(source, /\/inspir-social-preview\.png/);
  assert.match(source, /staticSiteLanguagesForPath/);
  assert.doesNotMatch(source, /checkImmutableLocalizedCacheControl/);
  assert.match(headers, /X-Inspir-Delivery: static-assets/);
  assert.match(headers, /^\/chat$/m);
  assert.match(headers, /^\/:locale\/chat$/m);
  assert.doesNotMatch(headers, /^\/chat\*$/m);
  assert.doesNotMatch(headers, /^\/\*\/chat\*$/m);
  assert.match(source, /REQUIRE_RESOURCE_SOAK/);
  assert.match(source, /ai-game-arena/);
  assert.match(source, /route: "\/games"/);
  assert.match(source, /removed game surface/);
  assert.match(source, /known English chat route/);
  assert.match(source, /known localized Hindi chat route/);
  assert.match(source, /known English legacy chat route/);
  assert.match(source, /known localized Hindi legacy chat route/);
  assert.match(source, /checkStaticTopicRedirect/);
  assert.match(source, /request\("\/chat\?topic=learn-anything"\)/);
  assert.match(source, /request\("\/hi\/chat\?topic=learn-anything"\)/);
  assert.match(source, /getCuratedMainAppTranslationBundle/);
  assert.match(source, /buildStaticMainAppBundleAsset/);
  assert.doesNotMatch(source, /getMainAppSourceHash/);
  assert.match(source, /immutable Hindi main-app bundle/);
  assert.match(source, /checkLocalizedMainAppBundle/);
  assert.match(source, /hindiMainAppBundle, \{ immutable: true \}/);
  assert.match(source, /\/chat\/__inspir_unknown_topic__/);
  assert.match(source, /\/chat\/learn-anything\/deep/);
  assert.match(source, /123e4567-e89b-42d3-a456-426614174000/);
  assert.match(source, /route: "\/api\/auth\/get-session"/);
  assert.match(source, /route: "\/api\/me"/);
  assert.match(source, /route: "\/api\/admin\/users"/);
  assert.match(source, /route: "\/api\/chat"/);
  assert.match(source, /contentTypeIncludes: "text\/event-stream"/);
  assert.match(source, /parseOpenAiTextDeltas\(response\.body\)/);
  assert.match(source, /x-guest-messages-used/);
  assert.match(source, /x-guest-messages-limit/);
  assert.match(source, /checkStaticAssetDelivery\("topics API", topics/);

  assert.match(staticRoutes, /\/api\/topics\?resource_soak/);
  assert.match(outcomes, /getCuratedMainAppTranslationBundle/);
  assert.match(outcomes, /buildStaticMainAppBundleAsset/);
  assert.doesNotMatch(outcomes, /getMainAppSourceHash/);
  assert.match(staticRoutes, /staticImmutableJson/);
  assert.match(staticRoutes, /\$\{hindiMainAppAsset\.publicPath\}\?resource_soak/);
  assert.match(staticRoutes, /\/chat\?topic=learn-anything&resource_soak/);
  assert.match(staticRoutes, /\/hi\/chat\?topic=learn-anything&resource_soak/);
  assert.match(staticRoutes, /staticTopicRedirect/);
  assert.match(outcomes, /expectedLocationPathname/);
  assert.match(outcomes, /expectedLocationTopic/);
  assert.match(staticRoutes, /\/api\/auth\/get-session\?resource_soak/);
  assert.match(staticRoutes, /\/api\/admin\/users\?resource_soak/);
  assert.match(staticRoutes, /\/games\?resource_soak/);
  assert.match(staticRoutes, /staticPost\(`\/api\/chat\?resource_soak/);
  assert.match(outcomes, /requireImmutablePublicCache/);
  assert.match(outcomes, /hasOneYearImmutablePublicCache/);
  assert.match(outcomes, /public-max-age-31536000-immutable/);
  assert.match(outcomes, /expectedStatus: 405/);
});

test("Worker outcome soak records sanitized failures and parses structured tail keys", async () => {
  const {
    classifySoakRequestError,
    createPublicProbeToken,
    extractTailRequestKeys,
    parseOpenAiTextDeltas,
    tailOutputHasRequestPrefix,
    workerCpuHeadroomThresholdMs,
  } = await import(
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

  const delayedAttempt = "/api/health?tail_ready_probe=stable-token-0";
  const tailOutput = JSON.stringify({
    outcome: "ok",
    cpuTime: 1,
    event: { request: { url: `https://inspirlearning.com${delayedAttempt}` } },
  });
  assert.deepEqual(extractTailRequestKeys(tailOutput), [delayedAttempt]);
  assert.equal(
    tailOutputHasRequestPrefix(tailOutput, "/api/health?tail_ready_probe=stable-token-"),
    true,
  );
  assert.equal(tailOutputHasRequestPrefix(tailOutput, "/api/health?tail_ready_probe=other-"), false);

  const publicProbeToken = createPublicProbeToken("resource-soak");
  assert.match(publicProbeToken, /^resource-soak-\d+-\d+$/);
  assert.doesNotMatch(publicProbeToken, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  assert.throws(() => createPublicProbeToken("NOT SAFE"), /lowercase letters/);

  const sse = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    "",
    "data: not-json",
    "",
    'data: {"choices":[{"delta":{"content":" world"}}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\r\n");
  assert.deepEqual(parseOpenAiTextDeltas(sse), ["Hello", " world"]);
});
