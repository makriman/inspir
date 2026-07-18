import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { redactProductionPlaywrightOutput } from "../scripts/cloudflare/production-playwright-safety";

test("production Playwright output redacts capabilities, account identity, and session cookies", () => {
  const secret = 'temporary-production-capability-secret"\\suffix';
  const email = "owner\\tag@example.com";
  const output = redactProductionPlaywrightOutput(
    `${JSON.stringify({ secret, email })} encoded=${encodeURIComponent(secret)} ` +
      `better-auth.session_token=session.value-1 ` +
      `__Secure-better-auth.session_token%3Dsecure.value-2`,
    [secret, email],
  );
  assert.doesNotMatch(
    output,
    /temporary-production-capability|owner(?:\\|%5C)tag|session\.value|secure\.value/,
  );
  assert.equal((output.match(/\[REDACTED\]/g) ?? []).length, 5);
});

test("authenticated validation binds every secret-derived version and recovery manifest to one release", async () => {
  const {
    assertProductionValidationVersionTransition,
    parseProductionValidationVersionSnapshot,
    parseRecoveryManifest,
  } = await import("../scripts/cloudflare/run-authenticated-production-validation");
  const candidateVersionId = "11111111-1111-4111-8111-111111111111";
  const childVersionId = "22222222-2222-4222-8222-222222222222";
  const baseline = parseProductionValidationVersionSnapshot({
    id: candidateVersionId,
    resources: {
      script: { etag: "immutable-script-etag", handlers: ["fetch"] },
      script_runtime: { compatibility_date: "2026-07-12" },
      bindings: [
        { name: "DB", type: "d1", id: "database-id" },
        { name: "AUTH_SECRET", type: "secret_text" },
      ],
    },
    annotations: { "workers/triggered_by": "upload" },
  }, candidateVersionId);
  const child = parseProductionValidationVersionSnapshot({
    id: childVersionId,
    resources: {
      script: { etag: "immutable-script-etag", handlers: ["fetch"] },
      script_runtime: { compatibility_date: "2026-07-12" },
      bindings: [
        { name: "E2E_TEST_AUTH_EXPIRES_AT", type: "secret_text" },
        { name: "AUTH_SECRET", type: "secret_text" },
        { name: "DB", type: "d1", id: "database-id" },
      ],
    },
    annotations: { "workers/triggered_by": "secret" },
  }, childVersionId);
  assert.doesNotThrow(() => assertProductionValidationVersionTransition({
    baseline,
    previousVersionId: candidateVersionId,
    current: child,
    expectedTemporarySecretNames: new Set(["E2E_TEST_AUTH_EXPIRES_AT"]),
    requireNewVersion: true,
  }));
  assert.throws(() => assertProductionValidationVersionTransition({
    baseline,
    previousVersionId: candidateVersionId,
    current: { ...child, immutableReleaseIdentity: "different-release" },
    expectedTemporarySecretNames: new Set(["E2E_TEST_AUTH_EXPIRES_AT"]),
    requireNewVersion: true,
  }), /changed the immutable Worker release/);
  assert.throws(() => assertProductionValidationVersionTransition({
    baseline,
    previousVersionId: candidateVersionId,
    current: { ...child, versionId: candidateVersionId },
    expectedTemporarySecretNames: new Set(["E2E_TEST_AUTH_EXPIRES_AT"]),
    requireNewVersion: true,
  }), /did not activate a new Worker version/);

  const now = new Date().toISOString();
  const manifest = {
    kind: "authenticated-production-validation-recovery-v1",
    createdAt: now,
    updatedAt: now,
    candidateVersionId,
    authenticatedVersionId: childVersionId,
    activeVersionId: childVersionId,
    mutationRunId: "33333333-3333-4333-8333-333333333333",
    capabilityExpiresAt: "1",
    existingSessionPurposes: ["production-playwright", "production-outcome-soak"],
    sourceFingerprintSha256: "a".repeat(64),
    sourceFingerprintFileCount: 10,
    translationReconciliationKind: "production-translation-reconciliation-v1",
    translationReconciliationSha256: "b".repeat(64),
    stagedCleanupRunId: null,
    stagedCleanupEvidenceSha256: null,
    stagedCleanupPreWriteEvidenceSha256: null,
    stagedCleanupResolvedEvidenceSha256: null,
    immutableReleaseIdentity: baseline.immutableReleaseIdentity,
    baselineSecretNames: ["AUTH_SECRET"],
    installedTemporarySecrets: ["E2E_TEST_AUTH_EXPIRES_AT"],
    capabilityInstallationAttemptedAt: null,
    validationLockOwner: {
      candidateVersionId,
      leaseExpiresAt: 1,
      leaseId: "44444444-4444-4444-8444-444444444444",
      runId: "33333333-3333-4333-8333-333333333333",
      sourceFingerprintSha256: "a".repeat(64),
    },
    validationLockPreviousOwner: null,
    validationLockBudget: {
      operations: 0,
      reservedRowsRead: 0,
      reservedRowsWritten: 0,
      billedRowsRead: 0,
      billedRowsWritten: 0,
    },
    validationLockAcquisitionAttemptedAt: null,
    validationLockAcquiredAt: null,
    validationLockReleasedAt: null,
    residueZeroVerifiedAt: now,
    secretsAbsentVerifiedAt: null,
  };
  assert.equal(parseRecoveryManifest(manifest).capabilityExpiresAt, "1");
  const stagedManifest = {
    ...manifest,
    translationReconciliationKind:
      "production-staged-translation-reconciliation-v1",
    stagedCleanupRunId:
      "2026-07-15T12-00-00-000Z-66666666-6666-4666-8666-666666666666",
    stagedCleanupEvidenceSha256: "c".repeat(64),
    stagedCleanupPreWriteEvidenceSha256: "d".repeat(64),
    stagedCleanupResolvedEvidenceSha256: "e".repeat(64),
  };
  assert.equal(
    parseRecoveryManifest(stagedManifest).stagedCleanupRunId,
    stagedManifest.stagedCleanupRunId,
  );
  assert.throws(
    () =>
      parseRecoveryManifest({
        ...manifest,
        translationReconciliationKind:
          "production-staged-translation-reconciliation-v1",
      }),
    /malformed/,
  );
  const pendingRenewal = {
    ...manifest,
    validationLockOwner: {
      ...manifest.validationLockOwner,
      leaseExpiresAt: 2,
      leaseId: "55555555-5555-4555-8555-555555555555",
    },
    validationLockPreviousOwner: manifest.validationLockOwner,
  };
  assert.equal(
    parseRecoveryManifest(pendingRenewal).validationLockPreviousOwner?.leaseId,
    manifest.validationLockOwner.leaseId,
  );
  assert.throws(
    () => parseRecoveryManifest({
      ...pendingRenewal,
      validationLockPreviousOwner: pendingRenewal.validationLockOwner,
    }),
    /lock identity is inconsistent/,
  );
  assert.throws(
    () => parseRecoveryManifest({ ...manifest, E2E_TEST_AUTH_SECRET: "must-not-be-stored" }),
    /malformed/,
  );
});

test("production verification covers the resource-outage contracts", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/verify-production.ts"), "utf8");
  const outcomes = fs.readFileSync(
    path.resolve("scripts/cloudflare/verify-production-worker-outcomes.ts"),
    "utf8",
  );
  const productionPlaywright = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-production-playwright.ts"),
    "utf8",
  );
  const authenticatedProductionWrapper = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-authenticated-production-validation.ts"),
    "utf8",
  );
  const headers = fs.readFileSync(path.resolve("public/_headers"), "utf8");
  const workerRoutes = outcomes.match(
    /const workerRoutes: SoakRoute\[\] = \[([\s\S]*?)\n  \];\n  const staticRoutes/,
  )?.[1];
  const staticRoutes = outcomes.match(
    /const staticRoutes: SoakRoute\[\] = \[([\s\S]*?)\n  \];\n  const logoutRoute/,
  )?.[1];

  assert.ok(workerRoutes, "Worker route list should remain statically inspectable");
  assert.ok(staticRoutes, "static route list should remain statically inspectable");

  assert.match(source, /checkRuntimeHealth/);
  assert.match(source, /checkActiveMainWorkerDeployment/);
  assert.match(source, /deployments", "status"/);
  assert.match(source, /requiredPercentage: 100/);
  assert.match(source, /pinMainWorkerVersion: false/);
  assert.match(source, /checkWwwCanonicalRedirect/);
  assert.match(source, /www-redirect-worker/);
  assert.match(source, /deploymentMode === "free-static-native-accounts"/);
  assert.match(source, /architecture\.openNext === false/);
  assert.match(source, /architecture\.accounts === true/);
  assert.match(source, /architecture\.savedState === true/);
  assert.match(source, /architecture\.games === false/);
  assert.match(source, /checkNativeSignedOutSurfaces/);
  assert.match(source, /checkPrivateNoStore/);
  assert.match(source, /cloudflare-cdn-cache-control/);
  assert.match(source, /signed-out Better Auth session/);
  assert.match(source, /expectedBody: "null"/);
  assert.match(source, /signed-out profile/);
  assert.match(source, /signed-out saved chats/);
  assert.match(source, /signed-out memory/);
  assert.match(source, /signed-out account topics/);
  assert.match(source, /signed-out admin dashboard/);
  assert.match(source, /signed-out admin users/);
  assert.match(source, /signed-out authenticated chat/);
  assert.match(source, /signed-out quiz activity/);
  assert.match(source, /signed-out flashcard activity/);
  assert.match(source, /cross-origin logout rejected/);
  assert.match(source, /expectedStatus: 403/);
  assert.match(source, /signed-out logout/);
  assert.match(source, /expectedStatus: 204/);
  assert.match(source, /signed-out UUID chat serves only the static shell/);
  assert.match(source, /uuidChat\.body === staticChatShell\.body/);
  assert.match(source, /checkWorkerTopicRedirect/);
  assert.match(source, /x-inspir-delivery"\] === "lean-api-worker"/);
  assert.match(source, /static admin shell/);
  assert.match(source, /request\("\/admin"\)/);
  assert.match(source, /static account recovery/);
  assert.match(source, /request\("\/reset_pw"\)/);
  assert.match(source, /localized Hindi mission/);
  assert.match(source, /removed game surface/);
  assert.match(source, /route: "\/games"/);
  assert.match(source, /ai-game-arena/);
  assert.doesNotMatch(source, /removed auth session API|removed account API|removed memory API/);
  assert.doesNotMatch(source, /checkCacheRevalidation|findStableCachePair|\/api\/cache-health/);
  assert.match(source, /checkLegacyTranslationApis/);
  assert.match(source, /\/api\/main-app-translations\?language=English/);
  assert.match(source, /\/api\/main-app-translations\?language=Hindi/);
  assert.match(
    source,
    /\/api\/site-translations\?language=English&namespace=route%3Ahome/,
  );
  assert.match(
    source,
    /\/api\/site-translations\?language=Hindi&namespace=route%3Amission/,
  );
  assert.match(
    source,
    /\/api\/site-translations\?language=Hindi&namespace=route%3Aabout/,
  );
  assert.match(source, /legacy known unpublished site pair/);
  assert.match(source, /Translation bundle is not published/);
  assert.match(source, /\/api\/site-translations\?language=English&namespace=unknown/);
  assert.match(source, /Unsupported namespace/);
  assert.match(source, /checkLegacyTranslationError/);
  assert.match(source, /checkLocaleResourceSoak/);
  assert.match(source, /checkStaticAssetDelivery/);
  assert.match(source, /checkStaticNotFound/);
  assert.match(source, /unknown public route/);
  assert.match(source, /unknown API route/);
  assert.match(source, /\/sitemap\.xml/);
  assert.match(source, /\/manifest\.webmanifest/);
  assert.match(source, /static legal redirect/);
  assert.match(source, /REQUIRE_RESOURCE_SOAK/);
  assert.match(source, /contentTypeIncludes: "text\/event-stream"/);
  assert.match(source, /parseOpenAiTextDeltas\(response\.body\)/);
  assert.match(source, /x-guest-messages-used/);
  assert.match(source, /x-guest-messages-limit/);
  assert.match(source, /getCuratedMainAppTranslationBundle/);
  assert.match(source, /buildStaticMainAppBundleAsset/);
  assert.doesNotMatch(source, /getMainAppSourceHash/);

  assert.match(headers, /X-Inspir-Delivery: static-assets/);
  assert.match(headers, /^\/chat$/m);
  assert.match(headers, /^\/:locale\/chat$/m);
  assert.doesNotMatch(headers, /^\/chat\*$/m);
  assert.doesNotMatch(headers, /^\/\*\/chat\*$/m);

  assert.match(outcomes, /--version-id/);
  assert.match(outcomes, /requireActiveDeployment/);
  assert.match(outcomes, /missingWorkerInvocations/);
  assert.match(outcomes, /missingCpuSamples/);
  assert.match(outcomes, /cpuThresholdViolations/);
  assert.match(outcomes, /duplicateWorkerInvocations/);
  assert.match(outcomes, /route\.captured === route\.expected/);
  assert.match(outcomes, /E2E_TEST_GUEST_QUOTA_SCOPE/);
  assert.match(outcomes, /maximumNewExpiringRateLimitRowsThisRun: 3/);
  assert.match(outcomes, /workerCpuSampleIsWithinHeadroom/);
  assert.match(outcomes, /workerInvokedStaticRoutes/);
  assert.match(outcomes, /staticRequestKeySet/);
  assert.match(outcomes, /waitForTailReadiness/);
  assert.match(outcomes, /waitForCapturedRequestKeys/);
  assert.match(outcomes, /wrangler-connected-diagnostic/);
  assert.match(outcomes, /waiting for logs/);
  assert.doesNotMatch(outcomes, /"tail_ready_probe"/);
  assert.match(outcomes, /tail_settle_probe/);
  assert.match(outcomes, /x-inspir-tail-session/);
  assert.match(outcomes, /Dummy queue is not implemented/);
  assert.match(outcomes, /exceededCpu/);
  assert.match(outcomes, /exceededMemory/);
  assert.match(outcomes, /for \(let index = 0; index < workerRoutes\.length; index \+= 1\)/);
  assert.match(outcomes, /await delay\(workerProbePaceMs\)/);
  assert.match(outcomes, /requirePrivateNoStore/);
  assert.match(outcomes, /hasPrivateNoStore/);
  assert.match(outcomes, /private-no-store/);
  assert.match(outcomes, /expectedBody/);
  assert.match(outcomes, /requireEmptyBody/);
  assert.match(outcomes, /requireOpenAiDelta: sse/);
  assert.match(outcomes, /guest-chat-sse-first-use/);
  assert.match(outcomes, /guest-chat-sse-warm/);
  assert.match(outcomes, /guest-chat-legacy-first-use/);
  assert.match(outcomes, /guest-chat-legacy-warm/);
  assert.match(outcomes, /expectedContentType: sse \? "text\/event-stream" : "text\/plain"/);
  assert.match(outcomes, /requireGuestQuotaHeaders: true/);
  assert.match(outcomes, /capturedGuestCookieHeader/);
  assert.match(outcomes, /inspir_guest_session/);
  assert.match(outcomes, /guestCookieHeader \? withProbeHeaders/);
  assert.match(outcomes, /classifySoakRequestError/);
  assert.match(outcomes, /safeRequestUrl/);
  assert.match(outcomes, /workerTopicRedirect/);
  assert.match(outcomes, /requireProductionE2EAuth/);
  assert.match(outcomes, /Buffer\.byteLength\(secret, "utf8"\) < 32/);
  assert.match(outcomes, /requireAuthenticatedAdminSession/);
  assert.match(outcomes, /capturedNativeSessionCookie/);
  assert.match(outcomes, /failed-authentication-logout-0/);
  assert.match(outcomes, /if \(!authenticationVerified\)/);
  assert.ok(
    outcomes.indexOf("attemptedSessionCookie = capturedNativeSessionCookie") <
      outcomes.indexOf("requireAuthenticatedAdminSession("),
    "the soak must retain any session cookie before validating the auth payload/admin flag",
  );
  assert.match(outcomes, /user\.isAdmin !== true/);
  assert.match(outcomes, /better-auth\\\.session_token/);
  assert.doesNotMatch(outcomes, /authenticated-chat-first-use|authenticated-chat-warm|create-chat-0/);
  assert.match(outcomes, /oauth-initiation-first-use/);
  assert.match(outcomes, /oauth-initiation-warm/);
  assert.match(outcomes, /const oauthFirstUse = await executeSoakProbeWithCapture/);
  assert.match(outcomes, /const authenticationRoute = e2eAuth/);
  assert.match(outcomes, /action: "authenticate-existing"/);
  assert.match(outcomes, /candidateVersionId: expectedVersion/);
  assert.match(outcomes, /sessionPurpose: outcomeSoakSessionPurpose/);
  assert.match(outcomes, /action: "cleanup-existing-session"/);
  assert.match(outcomes, /verify-existing-session-cleanup/);
  assert.match(outcomes, /assertExistingSessionCleanupResponse/);
  assert.match(outcomes, /--secret-free/);
  assert.doesNotMatch(outcomes, /Inspir release verifier|image:\s*"\/icon\.png"/);
  assert.ok(
    outcomes.indexOf("const oauthFirstUse = await executeSoakProbeWithCapture") <
      outcomes.indexOf("const authenticationRoute = e2eAuth"),
    "OAuth first-use must run before hidden E2E auth warms shared auth primitives",
  );
  assert.match(outcomes, /profile-first-use/);
  assert.match(outcomes, /profile-warm/);
  assert.match(outcomes, /saved-chats-first-use/);
  assert.match(outcomes, /saved-chats-warm/);
  assert.match(outcomes, /account-topics-first-use/);
  assert.match(outcomes, /account-topics-warm/);
  assert.match(outcomes, /memory-first-use/);
  assert.match(outcomes, /memory-warm/);
  assert.match(outcomes, /admin-dashboard-first-use/);
  assert.match(outcomes, /admin-dashboard-warm/);
  assert.doesNotMatch(outcomes, /nativeDelete|cleanupChatRoute|chatFinalizeProbe/);
  assert.match(outcomes, /finally \{[\s\S]*logoutRoute/);
  assert.doesNotMatch(outcomes, /console\.(?:log|error)\([^\n]*(?:e2eAuth\.secret|sessionCookie)/);

  assert.match(productionPlaywright, /Buffer\.byteLength\(e2eAuthSecret, "utf8"\) < 32/);
  assert.match(productionPlaywright, /E2E_TEST_AUTH_EMAIL=<exact lowercase configured admin email>/);
  assert.match(productionPlaywright, /REQUIRE_AUTHENTICATED_E2E: "1"/);
  assert.match(productionPlaywright, /PRODUCTION_E2E_READ_ONLY: "1"/);
  assert.match(productionPlaywright, /PLAYWRIGHT_DISABLE_TRACE: "1"/);
  assert.match(productionPlaywright, /mkdtempSync/);
  assert.match(productionPlaywright, /--output", playwrightOutputDir/);
  assert.match(productionPlaywright, /finally \{[\s\S]*rmSync\(playwrightOutputDir/);
  assert.match(productionPlaywright, /redactProductionPlaywrightOutput/);
  assert.match(productionPlaywright, /writePrivateJsonDurably/);
  assert.match(productionPlaywright, /detailedOutputPersisted: false/);
  assert.doesNotMatch(productionPlaywright, /rawOutput:/);
  assert.doesNotMatch(productionPlaywright, /playwright: parsed/);
  assert.match(productionPlaywright, /migrationE2eAdminVerifiedByServer: true/);
  assert.match(productionPlaywright, /productionUserDataMutations: false/);
  assert.match(productionPlaywright, /E2E_TEST_MUTATION_RUN_ID: e2eMutationRunId/);
  assert.match(productionPlaywright, /E2E_TEST_AUTH_EXPIRES_AT: e2eAuthExpiresAt/);
  assert.doesNotMatch(productionPlaywright, /E2E_TEST_AUTH_IS_ADMIN/);

  assert.match(
    authenticatedProductionWrapper,
    /finally \{[\s\S]*cleanupTemporarySecrets\(sequence\)/,
  );
  assert.match(authenticatedProductionWrapper, /process\.once\(signal/);
  assert.match(authenticatedProductionWrapper, /"SIGINT", "SIGTERM"/);
  assert.match(authenticatedProductionWrapper, /secret", "delete"/);
  assert.match(authenticatedProductionWrapper, /assertTemporarySecretsAbsent\(\)/);
  assert.match(authenticatedProductionWrapper, /assertHiddenAuthDisabled\(secret, email\)/);
  assert.match(authenticatedProductionWrapper, /"x-migration-e2e-auth-secret": secret/);
  assert.match(authenticatedProductionWrapper, /body: JSON\.stringify\(\{ email \}\)/);
  assert.match(authenticatedProductionWrapper, /--candidate-version/);
  assert.match(
    authenticatedProductionWrapper,
    /readWorkerCandidateUploadEvidence[\s\S]*readWorkerCandidateStagedEvidence[\s\S]*readWorkerCandidateActivationEvidence[\s\S]*verifyWorkerCandidateActivationEvidence/,
  );
  assert.match(
    authenticatedProductionWrapper,
    /phase: "candidate-active"[\s\S]{0,500}targetCandidateVersionId:[\s\S]{0,200}serviceBaselineVersionId:[\s\S]{0,200}uploadEvidenceSha256:[\s\S]{0,200}phaseEvidenceSha256: activation\.sha256[\s\S]{0,200}phaseEvidenceCreatedAt: activation\.value\.createdAt[\s\S]{0,200}soleServingVersionId:/,
  );
  assert.ok(
    authenticatedProductionWrapper.match(/requiredPhase: "candidate-active"/g)
      ?.length === 2,
    "fresh and recovery validation must both require candidate-active Vectorize evidence",
  );
  assert.match(authenticatedProductionWrapper, /--recover/);
  assert.match(authenticatedProductionWrapper, /authenticated-production-validation-recovery-v1/);
  assert.match(authenticatedProductionWrapper, /writePrivateJsonDurably/);
  assert.match(authenticatedProductionWrapper, /acquireActiveProductionValidationLock/);
  assert.match(authenticatedProductionWrapper, /attestActiveProductionValidationLock/);
  assert.match(authenticatedProductionWrapper, /releaseActiveProductionValidationLock/);
  assert.match(authenticatedProductionWrapper, /runLockedPnpm/);
  assert.match(authenticatedProductionWrapper, /runWithActiveProductionValidationLockAsync/);
  assert.match(authenticatedProductionWrapper, /function productionValidationPnpmArgs/);
  assert.match(
    authenticatedProductionWrapper,
    /args\[0\]\?\.startsWith\("cf:"\)[\s\S]{0,180}"--backup"[\s\S]{0,180}resolveBackupDir\(\)/,
  );
  assert.match(
    authenticatedProductionWrapper,
    /runPnpm\(commandArgs, extraEnv\)/,
  );
  assert.match(authenticatedProductionWrapper, /validationLockPreviousOwner/);
  assert.match(authenticatedProductionWrapper, /Recovery cannot safely steal a copied, still-live generation/);
  assert.doesNotMatch(authenticatedProductionWrapper, /claimActiveProductionValidationLockForRecoveryProcess/);
  assert.match(authenticatedProductionWrapper, /assertAuthenticatedMutationResponseProof/);
  assert.match(authenticatedProductionWrapper, /validationLockOwner/);
  assert.match(authenticatedProductionWrapper, /validationLockBudget/);
  assert.ok(
    authenticatedProductionWrapper.indexOf("acquireActiveProductionValidationLock();") <
      authenticatedProductionWrapper.indexOf('putSecret(existingUserGuardSecretName, "1", sequence)'),
    "D1 ownership must be acquired before the first temporary Worker secret",
  );
  const secretFreeGateIndex = authenticatedProductionWrapper.indexOf('"--secret-free"');
  const finalProductionGateIndex = authenticatedProductionWrapper.indexOf(
    '["cf:verify:production", "--", "--expected-version", finalVersion]',
    secretFreeGateIndex,
  );
  const hiddenDisabledGateIndex = authenticatedProductionWrapper.indexOf(
    '"hidden authentication disablement probe"',
    finalProductionGateIndex,
  );
  const normalLockReleaseIndex = authenticatedProductionWrapper.indexOf(
    "releaseActiveProductionValidationLock();",
    hiddenDisabledGateIndex,
  );
  assert.ok(secretFreeGateIndex >= 0);
  assert.ok(finalProductionGateIndex > secretFreeGateIndex);
  assert.ok(hiddenDisabledGateIndex > finalProductionGateIndex);
  assert.ok(
    normalLockReleaseIndex > hiddenDisabledGateIndex,
    "the global lock must remain owned through every final secret-free child gate",
  );
  assert.match(
    authenticatedProductionWrapper,
    /requestVersion: current\.versionId,\s+identityCandidateVersion: manifest\.authenticatedVersionId \?\? current\.versionId/,
  );
  assert.match(
    authenticatedProductionWrapper,
    /assertCandidateReleaseEvidence\(manifest\.candidateVersionId, \{\s*recovery: true,\s*\}\)[\s\S]{0,500}sourceFingerprintSha256 !== manifest\.sourceFingerprintSha256/,
  );
  assert.match(
    authenticatedProductionWrapper,
    /if \(options\.recovery\)[\s\S]{0,180}assertProductionVectorizeReadinessReleaseBinding/,
  );
  assert.ok(
    authenticatedProductionWrapper.match(/E2E_TEST_GUEST_QUOTA_SCOPE: mutationRunId/g)?.length === 2,
    "authenticated and secret-free outcomes must reuse one release-scoped guest fingerprint",
  );
  assert.match(
    authenticatedProductionWrapper,
    /updateRecoveryManifest\(\{ capabilityInstallationAttemptedAt: new Date\(\)\.toISOString\(\) \}\);[\s\S]{0,180}putSecret\(authCapabilitySecretName, secret, sequence\)/,
  );
  assert.match(authenticatedProductionWrapper, /sweepAllValidationResidue/);
  assert.match(
    authenticatedProductionWrapper,
    /authenticatedVersion \|\|[\s\S]{0,120}capabilityInstallationAttemptedAt[\s\S]{0,220}cannot prove residue cleanup after the route capability disappeared prematurely/,
  );
  assert.match(authenticatedProductionWrapper, /hardExpireMintCapability/);
  assert.match(
    authenticatedProductionWrapper,
    /cleanupErrors = cleanupTemporarySecrets\(sequence\);[\s\S]{0,160}if \(cleanupErrors\.length > 0\)[\s\S]{0,160}hardExpireMintCapability\(sequence\)/,
  );
  assert.match(
    authenticatedProductionWrapper,
    /async function recoverInterruptedValidation[\s\S]*?catch \(error\) \{[\s\S]{0,160}hardExpireMintCapability\(sequence\)/,
  );
  assert.match(authenticatedProductionWrapper, /--secret-free/);
  assert.ok(
    authenticatedProductionWrapper.indexOf(
      'putSecret(existingUserGuardSecretName, "1", sequence)',
    ) <
      authenticatedProductionWrapper.indexOf(
        "putSecret(validationEmailSecretName, email, sequence)",
      ),
    "existing-user guard must be installed before the validation email",
  );
  assert.ok(
    authenticatedProductionWrapper.indexOf(
      "putSecret(validationEmailSecretName, email, sequence)",
    ) <
      authenticatedProductionWrapper.indexOf(
        "putSecret(authCapabilitySecretName, secret, sequence)",
      ),
    "the route-enabling capability secret must be installed last",
  );
  assert.ok(
    authenticatedProductionWrapper.indexOf(
      "putSecret(mutationRunSecretName, mutationRunId, sequence)",
    ) <
      authenticatedProductionWrapper.indexOf(
        "putSecret(authCapabilitySecretName, secret, sequence)",
      ),
    "the route-enabling capability secret must follow the disposable mutation run binding",
  );
  assert.ok(
    authenticatedProductionWrapper.indexOf(
      "putSecret(capabilityExpirySecretName, capabilityExpiresAt, sequence)",
    ) <
      authenticatedProductionWrapper.indexOf(
        "putSecret(authCapabilitySecretName, secret, sequence)",
      ),
    "the capability expiry must be installed before the route-enabling capability",
  );
  assert.ok(
    authenticatedProductionWrapper.indexOf("persistRecoveryManifest(false)") <
      authenticatedProductionWrapper.indexOf(
        'putSecret(existingUserGuardSecretName, "1", sequence)',
      ),
    "durable recovery state must exist before the first temporary secret is installed",
  );
  assert.ok(
    authenticatedProductionWrapper.indexOf('"cf:verify:worker-outcomes"') <
      authenticatedProductionWrapper.indexOf('"cf:verify:production"'),
    "the Tail-scored outcome gate must be the first authenticated production gate",
  );
  const residueSweepIndex = authenticatedProductionWrapper.indexOf(
    "() => sweepAllValidationResidue",
  );
  assert.ok(residueSweepIndex >= 0);
  assert.ok(
    residueSweepIndex < authenticatedProductionWrapper.indexOf("cleanupTemporarySecrets(sequence)"),
    "owned production validation residue must be swept before temporary secrets are deleted",
  );
  assert.match(
    authenticatedProductionWrapper,
    /function runLockedPnpm[\s\S]{0,420}runWithActiveProductionValidationLock/,
  );
  assert.match(
    authenticatedProductionWrapper,
    /function putSecret[\s\S]{0,260}runWithActiveProductionValidationLock/,
  );
  assert.match(authenticatedProductionWrapper, /E2E_TEST_MUTATION_RUN_ID: mutationRunId/);
  assert.match(
    authenticatedProductionWrapper,
    /verify-authenticated-production-mutations\.ts/,
  );
  assert.match(authenticatedProductionWrapper, /--expected-version"[\s\S]{0,80}authenticatedVersion/);
  assert.match(
    authenticatedProductionWrapper,
    /deleteSecretUntilVerifiedAbsent\(authCapabilitySecretName, sequence\)/,
  );
  assert.match(
    authenticatedProductionWrapper,
    /putSecret\(capabilityExpirySecretName, "1", sequence\)/,
  );
  assert.match(authenticatedProductionWrapper, /secretCleanupAttemptLimit = 3/);
  assert.match(authenticatedProductionWrapper, /if \(capabilityError\)[\s\S]{0,300}return \[capabilityError\]/);
  assert.doesNotMatch(authenticatedProductionWrapper, /cleanupFinished/);
  assert.doesNotMatch(authenticatedProductionWrapper, /E2E_TEST_AUTH_ALLOW_LOCAL_CREATE/);
  assert.match(authenticatedProductionWrapper, /PRODUCTION_E2E_READ_ONLY: "1"/);
  assert.doesNotMatch(
    authenticatedProductionWrapper,
    /console\.(?:log|error)\([^\n]*(?:\$\{secret\}|E2E_TEST_AUTH_SECRET:\s*secret|validationEnv)/,
  );

  for (const route of [
    "/api/health",
    "/api/language-preference",
    "/api/main-app-translations",
    "/api/site-translations",
    "/api/auth/get-session",
    "/api/me",
    "/api/chats",
    "/api/memory",
    "/api/account/topics",
    "/api/admin/dashboard",
    "/api/activities/quiz",
    "/api/chat",
    "/api/chat/finalize",
    "/api/logout",
    "/api/guest-chat",
    "/chat/learn-anything",
    "/hi/chat/learn-anything",
  ]) {
    assert.match(workerRoutes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(workerRoutes, /authorization|cookie/i);
  assert.match(workerRoutes, /nativeGet/);
  assert.match(workerRoutes, /nativePost/);
  assert.match(workerRoutes, /legacyTranslationGet/);
  assert.match(
    workerRoutes,
    /main-app-translations\?language=Hindi&resource_soak=.*main-app-translations-hi-0/,
  );
  assert.match(
    workerRoutes,
    /site-translations\?language=English&namespace=route%3Ahome&resource_soak=/,
  );
  assert.match(
    workerRoutes,
    /site-translations\?language=Hindi&namespace=route%3Amission&resource_soak=/,
  );
  assert.match(
    workerRoutes,
    /site-translations\?language=Hindi&namespace=route%3Aabout&resource_soak=/,
  );
  assert.match(
    workerRoutes,
    /site-translations\?language=English&namespace=unknown&resource_soak=/,
  );
  assert.match(workerRoutes, /legacyTranslationErrorGet/);
  assert.match(outcomes, /function legacyTranslationErrorGet/);
  assert.match(outcomes, /expectedBody: JSON\.stringify\(\{ error \}\)/);
  assert.match(workerRoutes, /expectedBody: "null"/);
  assert.match(workerRoutes, /204/);
  assert.match(workerRoutes, /403/);
  assert.match(workerRoutes, /expectedContentType: "text\/html"/);
  assert.match(workerRoutes, /\/chat\/00000000-0000-4000-8000-000000000000/);

  assert.match(staticRoutes, /\/api\/topics\?resource_soak/);
  assert.match(staticRoutes, /staticImmutableJson/);
  assert.match(staticRoutes, /\$\{hindiMainAppAsset\.publicPath\}\?resource_soak/);
  assert.match(staticRoutes, /\/chat\?topic=learn-anything&resource_soak/);
  assert.match(staticRoutes, /\/hi\/chat\?topic=learn-anything&resource_soak/);
  assert.match(staticRoutes, /\/admin\?resource_soak/);
  assert.match(staticRoutes, /\/reset_pw\?resource_soak/);
  assert.match(staticRoutes, /\/hi\/mission\?resource_soak/);
  assert.match(staticRoutes, /\/games\?resource_soak/);
  assert.doesNotMatch(
    staticRoutes,
    /\/api\/(?:auth|get-session|me|chats|memory|admin|activities|chat|logout|site-translations|main-app-translations)|\/chat\/learn-anything/,
  );
  assert.match(outcomes, /requireImmutablePublicCache/);
  assert.match(outcomes, /hasOneYearImmutablePublicCache/);
  assert.match(outcomes, /public-max-age-31536000-immutable/);
});

test("production Playwright proves authenticated data access without mutating learner state", () => {
  const e2e = fs.readFileSync(path.resolve("tests/e2e/cloudflare-preview.spec.ts"), "utf8");

  assert.match(e2e, /REQUIRE_AUTHENTICATED_E2E/);
  assert.match(e2e, /new TextEncoder\(\)\.encode\(e2eAuthSecret\)\.byteLength >= 32/);
  assert.match(e2e, /const request = page\.request/g);
  assert.match(e2e, /PRODUCTION_E2E_READ_ONLY/);
  assert.match(e2e, /resolvedPlaywrightOrigin/);
  assert.match(e2e, /productionOrigins\.has\(resolvedPlaywrightOrigin\) && !productionE2eReadOnly/);
  assert.match(e2e, /https:\/\/www\.inspirlearning\.com\//);
  assert.match(e2e, /Refusing to load production Playwright tests unless PRODUCTION_E2E_READ_ONLY=1/);
  assert.match(e2e, /production validation reads preserved account data without mutating the learner/i);
  assert.match(e2e, /Production validation must not change an existing learner's score/);
  assert.match(e2e, /Production validation must not create learner memories, messages, or chats/);
  assert.match(e2e, /\/api\/chats production read-only/);
  assert.match(e2e, /\/api\/memory production read-only/);
  assert.match(e2e, /\/api\/admin\/dashboard production read-only/);
  assert.match(e2e, /E2E_TEST_AUTH_EMAIL must be a configured or bootstrap admin/);
  assert.match(e2e, /page\.goto\(`\/chat\/\$\{chatId\}`\)/);
  assert.match(e2e, /inspir-profile-details-form input\[readonly\]/);
  assert.match(e2e, /inspir-memory-add textarea/);
  assert.match(e2e, /inspir-memory-edit/);
  assert.match(e2e, /x-inspir-memory-sources/);
  assert.match(e2e, /source\.type === "memory" && source\.memoryId === memoryId/);
  assert.match(e2e, /source\.type === "past_chat"/);
  assert.match(e2e, /production validation never changes disabled history consent/i);
  assert.doesNotMatch(e2e, /chatHistoryEnabled: false/);
  assert.match(e2e, /Production queue consumer has a 10-second maximum batch timeout/i);
  assert.match(e2e, /buildStaticMainAppBundleAsset/);
  assert.match(e2e, /\/api\/main-app-translations\?language=\$\{language\}/);
  assert.match(e2e, /\{ language: "Hindi", namespace: "route:mission" \}/);
  assert.match(e2e, /language=Hindi&namespace=route%3Aabout/);
  assert.match(e2e, /Translation bundle is not published/);
  assert.match(e2e, /language=English&namespace=unknown/);
  assert.match(e2e, /hindiMainAppAsset\.publicPath/);
  assert.match(e2e, /expectStaticAssetDelivery\([\s\S]{0,160}"immutable"/);
  assert.match(e2e, /authAttempted = true;[\s\S]{0,120}authenticateMigrationE2E\(request\)/);
  assert.match(e2e, /if \(authAttempted\) \{[\s\S]*x-inspir-session-cleanup[\s\S]*disableRefresh=true/);
  assert.match(e2e, /test\.beforeEach[\s\S]*\/api\/analytics\/events/);
  assert.match(
    e2e,
    /Production uses the single tail-correlated outcome-soak request to avoid duplicate quota consumption/,
  );
  assert.doesNotMatch(e2e, /E2E_TEST_AUTH_IS_ADMIN/);
});

test("production Playwright module fails closed without its read-only mode", () => {
  const playwright = path.resolve("node_modules/.bin/playwright");
  const result = spawnSync(
    playwright,
    ["test", "tests/e2e/cloudflare-preview.spec.ts", "--list"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: "https://inspirlearning.com/",
        PLAYWRIGHT_START_CF_PREVIEW: "0",
        PRODUCTION_E2E_READ_ONLY: "0",
      },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.notEqual(result.status, 0, output);
  assert.match(
    output,
    /Refusing to load production Playwright tests unless PRODUCTION_E2E_READ_ONLY=1/,
  );
});

test("Worker outcome soak records sanitized failures and parses structured tail keys", async () => {
  const {
    classifySoakRequestError,
    comparableTailRequestKey,
    createPublicProbeToken,
    capturedGuestCookieHeader,
    assertAuthenticatedAdminSessionResponse,
    assertExistingSessionCleanupResponse,
    extractTailRequestKeys,
    normalizeTailPathname,
    parseOpenAiTextDeltas,
    tailOutputHasRequestPrefix,
    workerCpuSampleIsWithinHeadroom,
    workerCpuHeadroomThresholdMs,
    wranglerTailDiagnosticIsConnected,
  } = await import(
    "../scripts/cloudflare/verify-production-worker-outcomes"
  );
  assert.equal(workerCpuHeadroomThresholdMs, 8);
  assert.equal(workerCpuSampleIsWithinHeadroom(0), true);
  assert.equal(workerCpuSampleIsWithinHeadroom(7.999), true);
  assert.equal(workerCpuSampleIsWithinHeadroom(8), false);
  assert.equal(workerCpuSampleIsWithinHeadroom(-0.001), false);
  assert.equal(workerCpuSampleIsWithinHeadroom(Number.NaN), false);
  const timeout = new Error("request timed out at https://inspirlearning.com/private?token=secret");
  timeout.name = "TimeoutError";
  assert.equal(classifySoakRequestError(timeout), "timeout");

  const network = new Error("fetch failed for https://inspirlearning.com/private?token=secret");
  network.name = "TypeError<script>";
  const classified = classifySoakRequestError(network);
  assert.equal(classified, "network:TypeErrorscript");
  assert.doesNotMatch(classified, /inspirlearning|private|secret/i);
  assert.equal(classifySoakRequestError("https://inspirlearning.com/private?token=secret"), "network:unknown");

  const delayedAttempt = "/api/health?tail_settle_probe=stable-token-0";
  const tailOutput = JSON.stringify({
    outcome: "ok",
    cpuTime: 1,
    event: { request: { url: `https://inspirlearning.com${delayedAttempt}` } },
  });
  assert.deepEqual(extractTailRequestKeys(tailOutput), [delayedAttempt]);
  assert.equal(
    tailOutputHasRequestPrefix(tailOutput, "/api/health?tail_settle_probe=stable-token-"),
    true,
  );
  assert.equal(tailOutputHasRequestPrefix(tailOutput, "/api/health?tail_settle_probe=other-"), false);

  assert.equal(
    wranglerTailDiagnosticIsConnected("Connected to inspirlearning, waiting for logs...\n"),
    true,
  );
  assert.equal(wranglerTailDiagnosticIsConnected("Creating tail...\n"), false);
  const expectedUuidRoute =
    "/chat/11111111-1111-4111-8111-111111111111?resource_soak=resource-soak-1-2-chat";
  const redactedUuidRoute =
    "/chat/REDACTED?resource_soak=resource-soak-1-2-chat";
  assert.equal(normalizeTailPathname("/chat/REDACTED"), "/chat/:uuid");
  assert.equal(
    comparableTailRequestKey(expectedUuidRoute),
    comparableTailRequestKey(redactedUuidRoute),
  );

  const guestCookies = new Headers();
  guestCookies.append(
    "set-cookie",
    "inspir_guest_session=11111111-1111-4111-8111-111111111111; Path=/; Secure; HttpOnly",
  );
  guestCookies.append(
    "set-cookie",
    "inspir_guest_messages_used=2; Path=/; Secure; HttpOnly",
  );
  assert.equal(
    capturedGuestCookieHeader(guestCookies),
    "inspir_guest_session=11111111-1111-4111-8111-111111111111; inspir_guest_messages_used=2",
  );
  assert.equal(capturedGuestCookieHeader(new Headers()), null);

  const authenticatedIdentity = assertAuthenticatedAdminSessionResponse(JSON.stringify({
    ok: true,
    runtimeVersionId: "11111111-1111-4111-8111-111111111111",
    user: { email: "owner@example.com", isAdmin: true },
    validationSession: {
      candidateVersionId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      purpose: "production-outcome-soak",
      userRef: "a".repeat(64),
      sessionRef: "b".repeat(64),
    },
  }), {
    expectedEmail: "owner@example.com",
    expectedRunId: "22222222-2222-4222-8222-222222222222",
    expectedVersion: "11111111-1111-4111-8111-111111111111",
    purpose: "production-outcome-soak",
  });
  assert.equal(authenticatedIdentity.userRef, "a".repeat(64));
  assert.throws(() => assertAuthenticatedAdminSessionResponse(JSON.stringify({
    ok: true,
    runtimeVersionId: "33333333-3333-4333-8333-333333333333",
    user: { email: "owner@example.com", isAdmin: true },
    validationSession: {
      candidateVersionId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      purpose: "production-outcome-soak",
      userRef: "a".repeat(64),
      sessionRef: "b".repeat(64),
    },
  }), {
    expectedEmail: "owner@example.com",
    expectedRunId: "22222222-2222-4222-8222-222222222222",
    expectedVersion: "11111111-1111-4111-8111-111111111111",
    purpose: "production-outcome-soak",
  }), /wrong runtime Worker version/);

  const cleanupIdentity = assertExistingSessionCleanupResponse(JSON.stringify({
    ok: true,
    runtimeVersionId: "33333333-3333-4333-8333-333333333333",
    session: {
      candidateVersionId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      purpose: "production-outcome-soak",
      userRef: "a".repeat(64),
      sessionRef: "b".repeat(64),
    },
    before: { idRows: 1, exactSessions: 1, markerSessions: 1 },
    after: { idRows: 0, exactSessions: 0, markerSessions: 0 },
  }), {
    expectedVersion: "11111111-1111-4111-8111-111111111111",
    expectedRuntimeVersion: "33333333-3333-4333-8333-333333333333",
    runId: "22222222-2222-4222-8222-222222222222",
    purpose: "production-outcome-soak",
  });
  assert.equal(cleanupIdentity.sessionRef, "b".repeat(64));
  assert.throws(() => assertExistingSessionCleanupResponse(JSON.stringify({
    ok: true,
    runtimeVersionId: "11111111-1111-4111-8111-111111111111",
    session: {
      candidateVersionId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      purpose: "production-outcome-soak",
      userRef: "a".repeat(64),
      sessionRef: "b".repeat(64),
    },
    before: { idRows: 1, exactSessions: 1, markerSessions: 1 },
    after: { idRows: 0, exactSessions: 0, markerSessions: 0 },
  }), {
    expectedVersion: "11111111-1111-4111-8111-111111111111",
    expectedRuntimeVersion: "33333333-3333-4333-8333-333333333333",
    runId: "22222222-2222-4222-8222-222222222222",
    purpose: "production-outcome-soak",
  }), /wrong runtime Worker version/);
  assert.throws(() => assertExistingSessionCleanupResponse(JSON.stringify({
    ok: true,
    runtimeVersionId: "33333333-3333-4333-8333-333333333333",
    session: {
      candidateVersionId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      purpose: "production-outcome-soak",
      userRef: "a".repeat(64),
      sessionRef: "b".repeat(64),
    },
    before: { idRows: 1, exactSessions: 1, markerSessions: 1 },
    after: { idRows: 0, exactSessions: 0, markerSessions: 0, omittedClass: 0 },
  }), {
    expectedVersion: "11111111-1111-4111-8111-111111111111",
    expectedRuntimeVersion: "33333333-3333-4333-8333-333333333333",
    runId: "22222222-2222-4222-8222-222222222222",
    purpose: "production-outcome-soak",
  }), /wrong contract/);

  const publicProbeToken = createPublicProbeToken("resource-soak");
  assert.match(publicProbeToken, /^resource-soak-\d+-\d+$/);
  assert.doesNotMatch(publicProbeToken, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  assert.throws(() => createPublicProbeToken("NOT SAFE"), /lowercase letters/);

  const sse = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    "",
    'data: {"choices":[{"delta":{"content":" world"}}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\r\n");
  assert.deepEqual(parseOpenAiTextDeltas(sse), ["Hello", " world"]);
  assert.throws(
    () => parseOpenAiTextDeltas(
      'data: {"choices":[{"delta":{"content":"truncated"}}]}\n\n',
    ),
    /without a terminal event/,
  );
  assert.throws(
    () => parseOpenAiTextDeltas("data: not-json\n\ndata: [DONE]\n\n"),
    /malformed JSON/,
  );
  assert.throws(
    () => parseOpenAiTextDeltas(
      'event: error\ndata: {"error":{"message":"redacted"}}\n\ndata: [DONE]\n\n',
    ),
    /error event/,
  );
});
