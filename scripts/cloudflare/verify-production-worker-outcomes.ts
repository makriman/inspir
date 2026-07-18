import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLanguage, languageConfigs } from "../../lib/content/languages";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "../../lib/i18n/main-app-static-asset";
import { staticSiteLanguagesForPath } from "../../lib/i18n/static-availability";
import { writePrivateJsonDurably } from "./d1-release-budget-ledger";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";

const workerName = "inspirlearning";
const defaultBaseUrl = "https://inspirlearning.com";
const tailSessionHeader = "x-inspir-tail-session";
const tailReadyTimeoutMs = 180_000;
const tailCaptureTimeoutMs = 30_000;
const tailPollMs = 1_000;
const tailSettleGraceMs = 2_000;
const tailShutdownTimeoutMs = 5_000;
const workerProbePaceMs = 1_500;
const freePlanCpuLimitMs = 10;
const outcomeSoakSessionPurpose = "production-outcome-soak" as const;
export type ExistingValidationSessionPurpose =
  | "production-playwright"
  | typeof outcomeSoakSessionPurpose;
export const workerCpuHeadroomThresholdMs = 8;

type ExpectedDelivery = "static-assets" | "static-redirect" | "lean-api-worker";

type SoakRequestResult = {
  route: string;
  requestKey: string;
  method: "GET" | "POST" | "DELETE";
  status: number | null;
  ok: boolean;
  expectedStatus: number;
  expectedDelivery: ExpectedDelivery;
  actualDelivery?: string | null;
  actualLocation?: string | null;
  contentType?: string | null;
  cacheControl?: string | null;
  bodyBytes?: number;
  privateNoStoreValid?: boolean;
  parsedOpenAiDeltaCount?: number;
  guestQuotaHeadersValid?: boolean;
  guestMessagesUsed?: number;
  guestMessagesLimit?: number;
  problems?: string[];
  error?: string;
};

type SoakRoute = {
  route: string;
  method: "GET" | "POST" | "DELETE";
  expectedStatus: number;
  expectedDelivery: ExpectedDelivery;
  headers?: Record<string, string>;
  body?: string;
  requireNonEmptyBody?: boolean;
  expectedContentType?: string;
  requireImmutablePublicCache?: boolean;
  expectedLocationPathname?: string;
  expectedLocationTopic?: string;
  requireOpenAiDelta?: boolean;
  requireGuestQuotaHeaders?: boolean;
  requirePrivateNoStore?: boolean;
  expectedBody?: string;
  requireEmptyBody?: boolean;
};

type ProductionE2EAuth = {
  email: string;
  secret: string;
  runId: string;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main() {
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Production Worker outcome verification requires --confirm-production.");
  }
  if (process.env.REQUIRE_LIVE_AI !== "1") {
    throw new Error("Production Worker outcome verification requires REQUIRE_LIVE_AI=1.");
  }
  const secretFree = process.argv.includes("--secret-free");
  const e2eAuth = secretFree ? null : requireProductionE2EAuth();
  const guestQuotaScope = requireGuestQuotaScope(
    process.env.E2E_TEST_GUEST_QUOTA_SCOPE,
    e2eAuth?.runId,
  );
  const disabledAuthProbeSecret = secretFree
    ? requireProductionProbeSecret(process.env.E2E_TEST_AUTH_SECRET)
    : null;
  const expectedVersion = requireWorkerVersion(getArg("--expected-version") ?? process.env.EXPECTED_WORKER_VERSION);
  const baseUrl = normalizeBaseUrl(getArg("--base-url") ?? process.env.PRODUCTION_BASE_URL ?? defaultBaseUrl);
  const reportPath = path.join(
    cloudflareDir(resolveBackupDir()),
    secretFree
      ? "production-worker-outcomes-secret-free-report.json"
      : "production-worker-outcomes-report.json",
  );
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  const activeDeployment = requireActiveDeployment(wrangler, expectedVersion);
  const tailSessionToken = crypto.randomUUID();
  const tail = spawn(
    wrangler,
    [
      "tail",
      workerName,
      "--format",
      "json",
      "--version-id",
      expectedVersion,
      "--header",
      `${tailSessionHeader}:${tailSessionToken}`,
    ],
    { cwd: process.cwd(), env: commandEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const capture = captureOutput(tail);

  try {
    const tailReadiness = await waitForTailReadiness(
      tail,
      capture.output,
      capture.diagnostics,
      baseUrl,
      expectedVersion,
      tailSessionToken,
    );

    const { probeToken, requests, staticRequestKeys, workerRequestKeys, guestQuotaEvidence } = await runResourceSoak(
      baseUrl,
      expectedVersion,
      tailSessionToken,
      e2eAuth,
      disabledAuthProbeSecret,
      guestQuotaScope,
    );
    const tailCapture = await waitForCapturedRequestKeys(
      tail,
      capture.output,
      workerRequestKeys,
      tailCaptureTimeoutMs,
    );
    const tailSettle = await waitForTailSettle(
      tail,
      capture.output,
      capture.diagnostics,
      baseUrl,
      expectedVersion,
      tailSessionToken,
    );
    const tailShutdown = await stopTail(tail, capture.closed);

    const tailOutput = capture.output();
    const records = extractJsonObjects(tailOutput).map(objectRecord).filter(isRecord);
    const captured = records.map((record) => ({ record, invocation: summarizeInvocation(record) }));
    const probeCaptured = captured.filter(({ invocation }) => invocation.resourceSoak?.startsWith(`${probeToken}-`));
    const probeInvocations = probeCaptured.map(({ invocation }) => invocation);
    const workerRequestKeySet = new Set(workerRequestKeys.map(comparableTailRequestKey));
    const staticRequestKeySet = new Set(staticRequestKeys.map(comparableTailRequestKey));
    const workerProbeInvocations = probeInvocations.filter(
      (invocation) =>
        invocation.comparableRequestKey !== null &&
        workerRequestKeySet.has(invocation.comparableRequestKey),
    );
    const outcomes = probeInvocations
      .map((invocation) => invocation.outcome)
      .filter((outcome): outcome is string => outcome !== null);
    const outcomeCounts = Object.fromEntries(
      Array.from(new Set(outcomes)).sort().map((outcome) => [outcome, outcomes.filter((value) => value === outcome).length]),
    );
    const nonOkOutcomes = outcomes.filter((outcome) => outcome !== "ok");
    const exceptionCount = probeInvocations.reduce((total, invocation) => total + invocation.exceptions.length, 0);
    const nonOkInvocations = probeInvocations
      .filter((invocation) => invocation.outcome !== "ok" || invocation.exceptions.length > 0)
      .slice(0, 50);
    const workerInvokedStaticRoutes = probeInvocations
      .filter(
        (invocation) =>
          invocation.comparableRequestKey !== null &&
          staticRequestKeySet.has(invocation.comparableRequestKey),
      )
      .slice(0, 50);
    const missingWorkerInvocations = workerRequestKeys.filter(
      (requestKey) => !workerProbeInvocations.some(
        (invocation) => invocation.comparableRequestKey === comparableTailRequestKey(requestKey),
      ),
    );
    const duplicateWorkerInvocations = workerRequestKeys.flatMap((requestKey) => {
      const comparable = comparableTailRequestKey(requestKey);
      const matches = workerProbeInvocations.filter(
        (invocation) => invocation.comparableRequestKey === comparable,
      );
      return matches.length > 1 ? [{ requestKey, captured: matches.length }] : [];
    });
    const unexpectedProbeInvocations = probeInvocations
      .filter(
        (invocation) =>
          invocation.requestKey === null ||
          invocation.comparableRequestKey === null ||
          (
            !workerRequestKeySet.has(invocation.comparableRequestKey) &&
            !staticRequestKeySet.has(invocation.comparableRequestKey)
          ),
      )
      .slice(0, 50);
    const cpuSamples = workerProbeInvocations.flatMap((invocation) =>
      invocation.cpuTimeMs === null
        ? []
        : [{ requestKey: invocation.requestKey, path: invocation.path, cpuTimeMs: invocation.cpuTimeMs }],
    );
    const missingCpuSamples = workerRequestKeys.filter(
      (requestKey) => !workerProbeInvocations.some(
        (invocation) =>
          invocation.comparableRequestKey === comparableTailRequestKey(requestKey) &&
          invocation.cpuTimeMs !== null,
      ),
    );
    const cpuThresholdViolations = cpuSamples.filter(
      (sample) => !workerCpuSampleIsWithinHeadroom(sample.cpuTimeMs),
    );
    const routeCounts = buildRouteCounts(requests, workerProbeInvocations);
    const forbiddenLogPatterns = [
      /Dummy queue is not implemented/i,
      /exceededCpu/i,
      /exceededMemory/i,
    ];
    const logText = probeCaptured.map(({ record }) => JSON.stringify(record.logs ?? [])).join("\n");
    const forbiddenLogs = forbiddenLogPatterns
      .filter((pattern) => pattern.test(logText))
      .map((pattern) => pattern.source);
    const failedRequests = requests.filter((request) => !request.ok);
    const ok =
      !tailCapture.timedOut &&
      !tailCapture.tailExited &&
      tailCapture.captured === tailCapture.expected &&
      !tailSettle.tailExited &&
      tailShutdown.requested &&
      tailShutdown.streamsClosed &&
      missingWorkerInvocations.length === 0 &&
      duplicateWorkerInvocations.length === 0 &&
      missingCpuSamples.length === 0 &&
      cpuThresholdViolations.length === 0 &&
      nonOkOutcomes.length === 0 &&
      nonOkInvocations.length === 0 &&
      exceptionCount === 0 &&
      forbiddenLogs.length === 0 &&
      workerInvokedStaticRoutes.length === 0 &&
      unexpectedProbeInvocations.length === 0 &&
      routeCounts.every((route) => route.captured === route.expected && route.cpuSamples === route.expected) &&
      failedRequests.length === 0;
    const report = {
      createdAt: new Date().toISOString(),
      ok,
      workerName,
      expectedVersion,
      activeDeployment,
      baseUrl,
      probeToken,
      validationMode: secretFree ? "secret-free" : "authenticated",
      authenticatedAdminVerified: e2eAuth !== null,
      requestCount: requests.length,
      failedRequests,
      expectedWorkerInvocations: workerRequestKeys.length,
      capturedProbeInvocations: probeInvocations.length,
      capturedWorkerInvocations: workerProbeInvocations.length,
      missingWorkerInvocations,
      duplicateWorkerInvocations,
      routeCounts,
      outcomeCounts,
      nonOkOutcomes,
      nonOkInvocations,
      workerInvokedStaticRoutes,
      unexpectedProbeInvocations,
      exceptionCount,
      forbiddenLogs,
      cpuPolicy: {
        minimumInclusiveMs: 0,
        freePlanLimitMs: freePlanCpuLimitMs,
        failAtOrAboveMs: workerCpuHeadroomThresholdMs,
        reservedHeadroomMs: freePlanCpuLimitMs - workerCpuHeadroomThresholdMs,
      },
      cpuSamples,
      missingCpuSamples,
      cpuThresholdViolations,
      guestQuotaEvidence,
      tailReadiness,
      tailCapture,
      tailSettle,
      tailShutdown,
      tailOutputBytes: Buffer.byteLength(tailOutput),
      tailDiagnosticsBytes: Buffer.byteLength(capture.diagnostics()),
      tailJsonObjects: records.length,
      tailExitCode: tail.exitCode,
      tailSignalCode: tail.signalCode,
    };
    writePrivateJsonDurably(reportPath, report, { replace: pathEntryExists(reportPath) });
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    if (!hasChildExited(tail)) await stopTail(tail, capture.closed);
  }
}

async function runResourceSoak(
  baseUrl: string,
  expectedVersion: string,
  tailSessionToken: string,
  e2eAuth: ProductionE2EAuth | null,
  disabledAuthProbeSecret: string | null,
  guestQuotaScope: string,
) {
  const nonce = createPublicProbeToken("resource-soak");
  const localeRoutes = staticSiteLanguagesForPath("/")
    .filter((language) => language !== defaultLanguage)
    .map((language) => `/${languageConfigs[language].prefix}`);
  const hindiMainAppTranslationBundle = getCuratedMainAppTranslationBundle("Hindi");
  if (!hindiMainAppTranslationBundle) throw new Error("The curated Hindi main-app bundle is missing.");
  const hindiMainAppAsset = buildStaticMainAppBundleAsset("hi", hindiMainAppTranslationBundle);
  const origin = new URL(baseUrl).origin;
  const oauthFirstUseRoute = nativePost(
    `/api/auth/sign-in/social?resource_soak=${nonce}-oauth-initiation-first-use`,
    200,
    { provider: "google", callbackURL: "/chat", disableRedirect: true },
    { origin, "sec-fetch-site": "same-origin" },
  );
  const oauthFirstUse = await executeSoakProbeWithCapture(
    oauthFirstUseRoute,
    baseUrl,
    expectedVersion,
    tailSessionToken,
    nonce,
  );
  await delay(workerProbePaceMs);
  const oauthWarmRoute = nativePost(
    `/api/auth/sign-in/social?resource_soak=${nonce}-oauth-initiation-warm`,
    200,
    { provider: "google", callbackURL: "/chat", disableRedirect: true },
    { origin, "sec-fetch-site": "same-origin" },
  );
  const oauthWarm = await executeSoakProbeWithCapture(
    oauthWarmRoute,
    baseUrl,
    expectedVersion,
    tailSessionToken,
    nonce,
  );
  await delay(workerProbePaceMs);

  const authenticationRoute = e2eAuth
    ? nativePost(
        `/api/migration/e2e-auth?resource_soak=${nonce}-e2e-auth-0`,
        200,
        {
          action: "authenticate-existing",
          email: e2eAuth.email,
          runId: e2eAuth.runId,
          candidateVersionId: expectedVersion,
          sessionPurpose: outcomeSoakSessionPurpose,
        },
        {
          "x-migration-e2e-auth-secret": e2eAuth.secret,
          origin,
          "sec-fetch-site": "same-origin",
        },
      )
    : null;
  const existingCleanupRoutes = e2eAuth
    ? existingSessionCleanupRoutes({
        nonce,
        expectedVersion,
        runId: e2eAuth.runId,
        secret: e2eAuth.secret,
        origin,
        purpose: outcomeSoakSessionPurpose,
      })
    : null;
  let authentication: Awaited<ReturnType<typeof executeSoakProbeWithCapture>> | null = null;
  let sessionCookie: string | null = null;
  if (e2eAuth && authenticationRoute) {
    let attemptedSessionCookie: string | null = null;
    let authenticationVerified = false;
    try {
      authentication = await executeSoakProbeWithCapture(
        authenticationRoute,
        baseUrl,
        expectedVersion,
        tailSessionToken,
        nonce,
      );
      attemptedSessionCookie = capturedNativeSessionCookie(authentication);
      sessionCookie = requireAuthenticatedAdminSession(
        authentication,
        e2eAuth.email,
        e2eAuth.runId,
        expectedVersion,
        attemptedSessionCookie,
      );
      authenticationVerified = true;
    } finally {
      if (!authenticationVerified) {
        const cleanupHeaders: Record<string, string> = {
          origin,
          "sec-fetch-site": "same-origin",
        };
        if (attemptedSessionCookie) cleanupHeaders.cookie = attemptedSessionCookie;
        await executeSoakProbe(
          nativePost(
            `/api/logout?resource_soak=${nonce}-failed-authentication-logout-0`,
            204,
            {},
            cleanupHeaders,
            { requireEmptyBody: true },
          ),
          baseUrl,
          expectedVersion,
          tailSessionToken,
          nonce,
        );
        if (existingCleanupRoutes && e2eAuth) {
          await executeExistingSessionCleanupVerification({
            routes: existingCleanupRoutes,
            baseUrl,
            expectedVersion,
            tailSessionToken,
            nonce,
            runId: e2eAuth.runId,
            purpose: outcomeSoakSessionPurpose,
          });
        }
      }
    }
    await delay(workerProbePaceMs);
  }
  const authenticatedHeaders = sessionCookie ? { cookie: sessionCookie } : null;

  const workerRoutes: SoakRoute[] = [
    workerGet(`/api/health?resource_soak=${nonce}-health-0`),
    nativePost(
      `/api/language-preference?resource_soak=${nonce}-language-preference-0`,
      200,
      { language: "Hindi", pathname: "/mission" },
    ),
    legacyTranslationGet(
      `/api/main-app-translations?language=English&resource_soak=${nonce}-main-app-translations-0`,
    ),
    legacyTranslationGet(
      `/api/main-app-translations?language=Hindi&resource_soak=${nonce}-main-app-translations-hi-0`,
    ),
    legacyTranslationGet(
      `/api/site-translations?language=English&namespace=route%3Ahome&resource_soak=${nonce}-site-translations-0`,
    ),
    legacyTranslationGet(
      `/api/site-translations?language=Hindi&namespace=route%3Amission&resource_soak=${nonce}-site-translations-mission-hi-0`,
    ),
    legacyTranslationErrorGet(
      `/api/site-translations?language=Hindi&namespace=route%3Aabout&resource_soak=${nonce}-site-translations-unpublished-hi-0`,
      404,
      "Translation bundle is not published",
    ),
    legacyTranslationErrorGet(
      `/api/site-translations?language=English&namespace=unknown&resource_soak=${nonce}-site-translations-unknown-0`,
      400,
      "Unsupported namespace",
    ),
    nativeGet(`/api/auth/get-session?resource_soak=${nonce}-auth-session-0`, 200, {
      expectedBody: "null",
    }),
    nativeGet(`/api/me?resource_soak=${nonce}-profile-0`, 401),
    nativeGet(`/api/chats?resource_soak=${nonce}-saved-chats-0`, 401),
    nativeGet(`/api/memory?resource_soak=${nonce}-memory-0`, 401),
    nativeGet(`/api/account/topics?resource_soak=${nonce}-account-topics-0`, 401),
    nativeGet(`/api/admin/dashboard?resource_soak=${nonce}-admin-dashboard-0`, 401),
    nativePost(
      `/api/activities/quiz?resource_soak=${nonce}-quiz-0`,
      401,
      { chatId: "123e4567-e89b-42d3-a456-426614174000", topic: "production probe" },
    ),
    nativePost(
      `/api/chat?resource_soak=${nonce}-authenticated-chat-0`,
      401,
      {
        chatId: "123e4567-e89b-42d3-a456-426614174000",
        content: "signed-out production probe",
      },
    ),
    nativePost(
      `/api/chat/finalize?resource_soak=${nonce}-authenticated-finalize-0`,
      401,
      {
        aiRunId: "123e4567-e89b-42d3-a456-426614174000",
        chatId: "123e4567-e89b-42d3-a456-426614174000",
        userMessageId: "123e4567-e89b-42d3-a456-426614174000",
        content: "signed-out production probe",
      },
    ),
    nativePost(
      `/api/logout?resource_soak=${nonce}-logout-cross-origin-0`,
      403,
      {},
      {
        origin: "https://signed-out-probe.invalid",
        "sec-fetch-site": "cross-site",
      },
    ),
    nativePost(
      `/api/logout?resource_soak=${nonce}-logout-0`,
      204,
      {},
      {
        origin: new URL(baseUrl).origin,
        "sec-fetch-site": "same-origin",
      },
      { requireEmptyBody: true },
    ),
    ...(disabledAuthProbeSecret
      ? [hiddenAuthDisabledProbe(nonce, disabledAuthProbeSecret, origin)]
      : []),
    ...(authenticatedHeaders
      ? [
          withProbeHeaders(
            nativeGet(`/api/me?resource_soak=${nonce}-profile-first-use`, 200),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(`/api/me?resource_soak=${nonce}-profile-warm`, 200),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(`/api/chats?resource_soak=${nonce}-saved-chats-first-use`, 200),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(`/api/chats?resource_soak=${nonce}-saved-chats-warm`, 200),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(`/api/account/topics?resource_soak=${nonce}-account-topics-first-use`, 200),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(`/api/account/topics?resource_soak=${nonce}-account-topics-warm`, 200),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(`/api/memory?resource_soak=${nonce}-memory-first-use`, 200),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(`/api/memory?resource_soak=${nonce}-memory-warm`, 200),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(
              `/api/admin/dashboard?days=7&resource_soak=${nonce}-admin-dashboard-first-use`,
              200,
            ),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(
              `/api/admin/dashboard?days=7&resource_soak=${nonce}-admin-dashboard-warm`,
              200,
            ),
            authenticatedHeaders,
          ),
          withProbeHeaders(
            nativeGet(
              `/chat/00000000-0000-4000-8000-000000000000?resource_soak=${nonce}-chat-uuid-shell-0`,
              200,
              { expectedContentType: "text/html" },
            ),
            authenticatedHeaders,
          ),
        ]
      : []),
    workerTopicRedirect(
      `/chat/learn-anything?resource_soak=${nonce}-chat-en-legacy-0`,
      "/chat",
      "learn-anything",
    ),
    workerTopicRedirect(
      `/hi/chat/learn-anything?resource_soak=${nonce}-chat-hi-legacy-0`,
      "/hi/chat",
      "learn-anything",
    ),
    guestChatProbe(
      `/api/guest-chat?resource_soak=${nonce}-guest-chat-sse-first-use`,
      "sse",
      guestQuotaScope,
    ),
    guestChatProbe(
      `/api/guest-chat?resource_soak=${nonce}-guest-chat-sse-warm`,
      "sse",
      guestQuotaScope,
    ),
    guestChatProbe(
      `/api/guest-chat?resource_soak=${nonce}-guest-chat-legacy-first-use`,
      "legacy-text",
      guestQuotaScope,
    ),
    guestChatProbe(
      `/api/guest-chat?resource_soak=${nonce}-guest-chat-legacy-warm`,
      "legacy-text",
      guestQuotaScope,
    ),
  ];
  const staticRoutes: SoakRoute[] = [
    staticGet(`/?resource_soak=${nonce}-home-0`),
    staticGet(`/robots.txt?resource_soak=${nonce}-robots-0`),
    staticGet(`/sitemap.xml?resource_soak=${nonce}-sitemap-index-0`),
    staticGet(`/sitemap/en-US.xml?resource_soak=${nonce}-sitemap-en-0`),
    staticGet(`/rss.xml?resource_soak=${nonce}-rss-0`),
    staticGet(`/manifest.webmanifest?resource_soak=${nonce}-manifest-0`),
    staticGet(`/loading?resource_soak=${nonce}-loading-0`),
    staticGet(`/reset_pw?resource_soak=${nonce}-account-recovery-0`),
    staticGet(`/hi/mission?resource_soak=${nonce}-mission-hi-0`),
    staticGet(`/inspir-social-preview.png?resource_soak=${nonce}-social-0`),
    ...localeRoutes.map((route, index) => staticGet(`${route}?resource_soak=${nonce}-locale-${index}`)),
    staticGet(`/api/topics?resource_soak=${nonce}-topics-0`),
    staticImmutableJson(
      `${hindiMainAppAsset.publicPath}?resource_soak=${nonce}-main-app-hi-0`,
    ),
    staticGet(`/chat?topic=learn-anything&resource_soak=${nonce}-chat-en-0`),
    staticGet(`/hi/chat?topic=learn-anything&resource_soak=${nonce}-chat-hi-0`),
    staticGet(`/admin?resource_soak=${nonce}-admin-shell-0`),
    staticGet(`/__inspir_static_404_probe?resource_soak=${nonce}-unknown-public-0`, 404),
    staticGet(`/api/__inspir_static_404_probe?resource_soak=${nonce}-unknown-api-0`, 404),
    staticGet(`/games?resource_soak=${nonce}-removed-games-0`, 404),
    staticGet(`/games/arena?resource_soak=${nonce}-removed-games-deep-0`, 404),
    staticGet(`/og?resource_soak=${nonce}-removed-og-0`, 404),
    staticRedirect(`/tnc?resource_soak=${nonce}-tnc-0`, 308),
  ];
  const logoutRoute = authenticatedHeaders
    ? nativePost(
        `/api/logout?resource_soak=${nonce}-authenticated-logout-0`,
        204,
        {},
        { ...authenticatedHeaders, origin, "sec-fetch-site": "same-origin" },
        { requireEmptyBody: true },
      )
    : null;
  const results: SoakRequestResult[] = [
    oauthFirstUse.result,
    oauthWarm.result,
    ...(authentication ? [authentication.result] : []),
  ];
  let guestCookieHeader: string | null = null;
  let guestSessionId: string | null = null;
  let guestMessagesUsed = 0;
  let guestMessagesLimit: number | null = null;

  try {
    for (let index = 0; index < workerRoutes.length; index += 1) {
      const route = workerRoutes[index];
      if (new URL(route.route, baseUrl).pathname === "/api/guest-chat") {
        const execution = await executeSoakProbeWithCapture(
          guestCookieHeader ? withProbeHeaders(route, { cookie: guestCookieHeader }) : route,
          baseUrl,
          expectedVersion,
          tailSessionToken,
          nonce,
        );
        results.push(execution.result);
        const returnedGuestCookies = capturedGuestQuotaCookies(execution.responseHeaders);
        if (!returnedGuestCookies) {
          throw new Error(
            "Production Worker soak did not preserve its single server-issued guest quota session.",
          );
        }
        if (guestSessionId && returnedGuestCookies.sessionId !== guestSessionId) {
          throw new Error("Production Worker soak changed its server-issued guest quota session.");
        }
        const expectedUsed = guestMessagesUsed + 1;
        if (
          execution.result.guestMessagesUsed !== expectedUsed ||
          returnedGuestCookies.used !== expectedUsed ||
          execution.result.guestMessagesLimit === undefined ||
          execution.result.guestMessagesLimit < expectedUsed ||
          (guestMessagesLimit !== null && execution.result.guestMessagesLimit !== guestMessagesLimit)
        ) {
          throw new Error("Production Worker soak guest quota usage was not exact and monotonic.");
        }
        guestSessionId = returnedGuestCookies.sessionId;
        guestMessagesUsed = expectedUsed;
        guestMessagesLimit = execution.result.guestMessagesLimit;
        guestCookieHeader = returnedGuestCookies.header;
      } else {
        results.push(
          await executeSoakProbe(
            route,
            baseUrl,
            expectedVersion,
            tailSessionToken,
            nonce,
          ),
        );
      }
      if (index < workerRoutes.length - 1) await delay(workerProbePaceMs);
    }

    for (let index = 0; index < staticRoutes.length; index += 8) {
      const batch = staticRoutes.slice(index, index + 8);
      results.push(
        ...(await Promise.all(
          batch.map((probe) =>
            executeSoakProbe(probe, baseUrl, expectedVersion, tailSessionToken, nonce),
          ),
        )),
      );
    }
  } finally {
    if (logoutRoute) {
      results.push(
        await executeSoakProbe(logoutRoute, baseUrl, expectedVersion, tailSessionToken, nonce),
      );
    }
    if (existingCleanupRoutes && e2eAuth) {
      results.push(
        ...(await executeExistingSessionCleanupVerification({
          routes: existingCleanupRoutes,
          baseUrl,
          expectedVersion,
          tailSessionToken,
          nonce,
          runId: e2eAuth.runId,
          purpose: outcomeSoakSessionPurpose,
        })),
      );
    }
  }

  return {
    probeToken: nonce,
    requests: results,
    workerRequestKeys: [
      oauthFirstUseRoute,
      oauthWarmRoute,
      ...(authenticationRoute ? [authenticationRoute] : []),
      ...workerRoutes,
      ...(logoutRoute ? [logoutRoute] : []),
      ...(existingCleanupRoutes
        ? [existingCleanupRoutes.cleanup, existingCleanupRoutes.verify]
        : []),
    ].map((probe) => requestKeyForRoute(probe.route, baseUrl)),
    staticRequestKeys: staticRoutes.map((probe) => requestKeyForRoute(probe.route, baseUrl)),
    guestQuotaEvidence: {
      stableFingerprintVersion: "v1",
      unchangedSession: guestSessionId !== null,
      requests: guestMessagesUsed,
      finalUsed: guestMessagesUsed,
      limit: guestMessagesLimit,
      maximumNewExpiringRateLimitRowsThisRun: 3,
    },
  };
}

async function executeSoakProbe(
  probe: SoakRoute,
  baseUrl: string,
  expectedVersion: string,
  tailSessionToken: string,
  nonce: string,
): Promise<SoakRequestResult> {
  return (await executeSoakProbeWithCapture(probe, baseUrl, expectedVersion, tailSessionToken, nonce)).result;
}

async function executeSoakProbeWithCapture(
  probe: SoakRoute,
  baseUrl: string,
  expectedVersion: string,
  tailSessionToken: string,
  nonce: string,
): Promise<{ result: SoakRequestResult; body: string | null; responseHeaders: Headers | null }> {
  const headers = new Headers({
    "cache-control": "no-cache",
    "x-inspir-resource-soak": nonce,
    "Cloudflare-Workers-Version-Overrides": `${workerName}="${expectedVersion}"`,
    ...probe.headers,
    [tailSessionHeader]: tailSessionToken,
  });
  const requestKey = requestKeyForRoute(probe.route, baseUrl);
  try {
    const response = await fetch(new URL(probe.route, baseUrl), {
      method: probe.method,
      headers,
      body: probe.body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const actualDelivery = response.headers.get("x-inspir-delivery");
    const actualLocation = response.headers.get("location");
    const contentType = response.headers.get("content-type");
    const cacheControl = response.headers.get("cache-control");
    const body = await response.text();
    const bodyBytes = Buffer.byteLength(body);
    const parsedOpenAiDeltaCount = probe.requireOpenAiDelta
      ? parseOpenAiTextDeltas(body).length
      : undefined;
    const used = Number(response.headers.get("x-guest-messages-used"));
    const limit = Number(response.headers.get("x-guest-messages-limit"));
    const guestQuotaHeadersValid = probe.requireGuestQuotaHeaders
      ? Number.isInteger(used) && Number.isInteger(limit) && used >= 1 && limit >= used
      : undefined;
    const privateNoStoreValid = probe.requirePrivateNoStore
      ? hasPrivateNoStore(cacheControl)
      : undefined;
    const problems: string[] = [];
    if (response.status !== probe.expectedStatus) problems.push(`status=${probe.expectedStatus}`);
    if (probe.expectedDelivery === "static-redirect") {
      if (actualDelivery !== null && actualDelivery !== "static-assets") {
        problems.push("static-redirect-delivery");
      }
    } else if (actualDelivery !== probe.expectedDelivery) {
      problems.push(`x-inspir-delivery=${probe.expectedDelivery}`);
    }
    if (probe.requireNonEmptyBody && bodyBytes === 0) problems.push("non-empty-body");
    if (probe.expectedContentType && !contentType?.includes(probe.expectedContentType)) {
      problems.push(`content-type=${probe.expectedContentType}`);
    }
    if (probe.requireImmutablePublicCache && !hasOneYearImmutablePublicCache(cacheControl)) {
      problems.push("public-max-age-31536000-immutable");
    }
    if (probe.requirePrivateNoStore && !privateNoStoreValid) {
      problems.push("private-no-store");
    }
    if (probe.expectedBody !== undefined && body.trim() !== probe.expectedBody) {
      problems.push(`body=${probe.expectedBody}`);
    }
    if (probe.requireEmptyBody && bodyBytes !== 0) problems.push("empty-body");
    if (probe.expectedLocationPathname || probe.expectedLocationTopic) {
      const location = safeResponseLocation(actualLocation, response.url);
      if (
        !location ||
        location.pathname !== probe.expectedLocationPathname ||
        location.searchParams.get("topic") !== probe.expectedLocationTopic
      ) {
        problems.push(
          `location=${probe.expectedLocationPathname ?? ""}?topic=${probe.expectedLocationTopic ?? ""}`,
        );
      }
    }
    if (probe.requireOpenAiDelta && parsedOpenAiDeltaCount === 0) {
      problems.push("parsed-openai-delta");
    }
    if (probe.requireGuestQuotaHeaders && !guestQuotaHeadersValid) {
      problems.push("valid-guest-quota-headers");
    }
    return {
      result: {
        route: probe.route,
        requestKey,
        method: probe.method,
        status: response.status,
        ok: problems.length === 0,
        expectedStatus: probe.expectedStatus,
        expectedDelivery: probe.expectedDelivery,
        actualDelivery,
        actualLocation,
        contentType,
        cacheControl,
        bodyBytes,
        privateNoStoreValid,
        parsedOpenAiDeltaCount,
      guestQuotaHeadersValid,
      ...(probe.requireGuestQuotaHeaders && Number.isInteger(used)
        ? { guestMessagesUsed: used }
        : {}),
      ...(probe.requireGuestQuotaHeaders && Number.isInteger(limit)
        ? { guestMessagesLimit: limit }
        : {}),
        problems,
      },
      body,
      responseHeaders: response.headers,
    };
  } catch (error) {
    return {
      result: {
        route: probe.route,
        requestKey,
        method: probe.method,
        status: null,
        ok: false,
        expectedStatus: probe.expectedStatus,
        expectedDelivery: probe.expectedDelivery,
        error: classifySoakRequestError(error),
      },
      body: null,
      responseHeaders: null,
    };
  }
}

function workerGet(route: string): SoakRoute {
  return {
    route,
    method: "GET",
    expectedStatus: 200,
    expectedDelivery: "lean-api-worker",
    requireNonEmptyBody: true,
    expectedContentType: "application/json",
    requirePrivateNoStore: true,
  };
}

function guestChatProbe(
  route: string,
  contract: "sse" | "legacy-text",
  guestQuotaScope: string,
): SoakRoute {
  const sse = contract === "sse";
  return {
    route,
    method: "POST",
    expectedStatus: 200,
    expectedDelivery: "lean-api-worker",
    headers: {
      accept: sse ? "text/event-stream" : "text/plain",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/json",
      "user-agent": `inspir-worker-outcome-soak-v1/${guestQuotaScope}`,
    },
    body: JSON.stringify({
      topicId: "learn-anything",
      content: "Reply with one short sentence confirming the production tutor works.",
      preferredLanguage: "English",
      messages: [],
    }),
    requireNonEmptyBody: true,
    expectedContentType: sse ? "text/event-stream" : "text/plain",
    requireOpenAiDelta: sse,
    requireGuestQuotaHeaders: true,
    requirePrivateNoStore: true,
  };
}

type NativeProbeOptions = Pick<
  SoakRoute,
  | "expectedBody"
  | "expectedContentType"
  | "requireEmptyBody"
  | "requireNonEmptyBody"
  | "requireOpenAiDelta"
>;

function nativeGet(
  route: string,
  expectedStatus: number,
  options: NativeProbeOptions = {},
): SoakRoute {
  return {
    route,
    method: "GET",
    expectedStatus,
    expectedDelivery: "lean-api-worker",
    expectedContentType: options.expectedContentType ?? "application/json",
    requireNonEmptyBody: options.requireNonEmptyBody ?? expectedStatus !== 204,
    requirePrivateNoStore: true,
    ...options,
  };
}

function nativePost(
  route: string,
  expectedStatus: number,
  body: unknown,
  headers: Record<string, string> = {},
  options: NativeProbeOptions = {},
): SoakRoute {
  return {
    route,
    method: "POST",
    expectedStatus,
    expectedDelivery: "lean-api-worker",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    expectedContentType: expectedStatus === 204 ? undefined : "application/json",
    requireNonEmptyBody: expectedStatus !== 204,
    requirePrivateNoStore: true,
    ...options,
  };
}

function hiddenAuthDisabledProbe(
  nonce: string,
  probeSecret: string,
  origin: string,
): SoakRoute {
  return {
    route: `/api/migration/e2e-auth?resource_soak=${nonce}-hidden-auth-disabled-0`,
    method: "POST",
    expectedStatus: 404,
    expectedDelivery: "lean-api-worker",
    headers: {
      "content-type": "application/json",
      "x-migration-e2e-auth-secret": probeSecret,
      origin,
      "sec-fetch-site": "same-origin",
    },
    body: "{}",
    requireEmptyBody: true,
    requirePrivateNoStore: true,
  };
}

function existingSessionCleanupRoutes(input: {
  nonce: string;
  expectedVersion: string;
  runId: string;
  secret: string;
  origin: string;
  purpose: ExistingValidationSessionPurpose;
}) {
  const route = (
    action: "cleanup-existing-session" | "verify-existing-session-cleanup",
    suffix: string,
  ) => nativePost(
    `/api/migration/e2e-auth?resource_soak=${input.nonce}-${suffix}`,
    200,
    {
      action,
      runId: input.runId,
      candidateVersionId: input.expectedVersion,
      sessionPurpose: input.purpose,
    },
    {
      "x-migration-e2e-auth-secret": input.secret,
      origin: input.origin,
      "sec-fetch-site": "same-origin",
    },
  );
  return {
    cleanup: route("cleanup-existing-session", "existing-session-cleanup-0"),
    verify: route("verify-existing-session-cleanup", "existing-session-verify-0"),
  };
}

async function executeExistingSessionCleanupVerification(input: {
  routes: { cleanup: SoakRoute; verify: SoakRoute };
  baseUrl: string;
  expectedVersion: string;
  tailSessionToken: string;
  nonce: string;
  runId: string;
  purpose: ExistingValidationSessionPurpose;
}) {
  const results: SoakRequestResult[] = [];
  const errors: Error[] = [];
  let cleanupIdentity: { sessionRef: string; userRef: string } | null = null;
  const cleanup = await executeSoakProbeWithCapture(
    input.routes.cleanup,
    input.baseUrl,
    input.expectedVersion,
    input.tailSessionToken,
    input.nonce,
  );
  results.push(cleanup.result);
  try {
    if (!cleanup.result.ok) throw new Error("Existing-session cleanup request failed.");
    cleanupIdentity = assertExistingSessionCleanupResponse(cleanup.body, {
      expectedVersion: input.expectedVersion,
      expectedRuntimeVersion: input.expectedVersion,
      runId: input.runId,
      purpose: input.purpose,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  }

  const verify = await executeSoakProbeWithCapture(
    input.routes.verify,
    input.baseUrl,
    input.expectedVersion,
    input.tailSessionToken,
    input.nonce,
  );
  results.push(verify.result);
  try {
    if (!verify.result.ok) throw new Error("Existing-session cleanup verification failed.");
    const verifyIdentity = assertExistingSessionCleanupResponse(verify.body, {
      expectedVersion: input.expectedVersion,
      expectedRuntimeVersion: input.expectedVersion,
      runId: input.runId,
      purpose: input.purpose,
    });
    if (
    cleanupIdentity &&
      (
        cleanupIdentity.sessionRef !== verifyIdentity.sessionRef ||
        cleanupIdentity.userRef !== verifyIdentity.userRef
      )
    ) {
      throw new Error("Existing-session cleanup and verification identities differ.");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  }
  if (errors.length) {
    throw new AggregateError(errors, "Existing-account validation session cleanup is indeterminate.");
  }
  return results;
}

export function assertExistingSessionCleanupResponse(
  source: string | null,
  expected: {
    expectedVersion: string;
    expectedRuntimeVersion?: string;
    runId: string;
    purpose: ExistingValidationSessionPurpose;
  },
) {
  const payload = source === null ? null : parseCapturedJson(source);
  if (
    !payload ||
    !hasExactKeys(payload, ["after", "before", "ok", "runtimeVersionId", "session"])
  ) {
    throw new Error("Existing-session cleanup response has the wrong top-level contract.");
  }
  const expectedRuntimeVersion = expected.expectedRuntimeVersion ?? expected.expectedVersion;
  if (payload.runtimeVersionId !== expectedRuntimeVersion) {
    throw new Error("Existing-session cleanup response came from the wrong runtime Worker version.");
  }
  const session = objectRecord(payload.session);
  if (
    payload.ok !== true ||
    !session ||
    !hasExactKeys(session, ["candidateVersionId", "purpose", "runId", "sessionRef", "userRef"]) ||
    session.candidateVersionId !== expected.expectedVersion ||
    session.runId !== expected.runId ||
    session.purpose !== expected.purpose ||
    typeof session.sessionRef !== "string" ||
    !/^[a-f0-9]{64}$/.test(session.sessionRef) ||
    typeof session.userRef !== "string" ||
    !/^[a-f0-9]{64}$/.test(session.userRef)
  ) {
    throw new Error("Existing-session cleanup response has the wrong deterministic identity.");
  }
  const before = exactExistingSessionInventory(payload.before, "before");
  const after = exactExistingSessionInventory(payload.after, "after");
  if (
    before.idRows !== before.exactSessions ||
    before.exactSessions !== before.markerSessions ||
    before.exactSessions > 1
  ) {
    throw new Error("Existing-session cleanup response has ambiguous ownership.");
  }
  if (after.idRows !== 0 || after.exactSessions !== 0 || after.markerSessions !== 0) {
    throw new Error("Existing-session cleanup response did not prove an all-zero inventory.");
  }
  return { sessionRef: session.sessionRef, userRef: session.userRef };
}

function exactExistingSessionInventory(value: unknown, label: string) {
  const inventory = objectRecord(value);
  if (!inventory || !hasExactKeys(inventory, ["exactSessions", "idRows", "markerSessions"])) {
    throw new Error(`Existing-session ${label} inventory has the wrong contract.`);
  }
  const idRows = requiredNonNegativeSafeInteger(inventory.idRows, `${label} idRows`);
  const exactSessions = requiredNonNegativeSafeInteger(
    inventory.exactSessions,
    `${label} exactSessions`,
  );
  const markerSessions = requiredNonNegativeSafeInteger(
    inventory.markerSessions,
    `${label} markerSessions`,
  );
  return {
    idRows,
    exactSessions,
    markerSessions,
  };
}

function requiredNonNegativeSafeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Existing-session inventory ${label} is invalid.`);
  }
  return value;
}

function hasExactKeys(record: Record<string, unknown>, names: readonly string[]) {
  const actual = Object.keys(record).sort();
  const expected = [...names].sort();
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function legacyTranslationGet(route: string): SoakRoute {
  return {
    route,
    method: "GET",
    expectedStatus: 200,
    expectedDelivery: "lean-api-worker",
    expectedContentType: "application/json",
    requireNonEmptyBody: true,
  };
}

function legacyTranslationErrorGet(
  route: string,
  expectedStatus: 400 | 404,
  error: string,
): SoakRoute {
  return nativeGet(route, expectedStatus, {
    expectedBody: JSON.stringify({ error }),
  });
}

function withProbeHeaders(probe: SoakRoute, headers: Record<string, string>): SoakRoute {
  return { ...probe, headers: { ...probe.headers, ...headers } };
}

function requireAuthenticatedAdminSession(
  execution: Awaited<ReturnType<typeof executeSoakProbeWithCapture>>,
  expectedEmail: string,
  expectedRunId: string,
  expectedVersion: string,
  sessionCookie: string | null,
) {
  if (!execution.result.ok || !execution.body || !execution.responseHeaders) {
    throw new Error("Production Worker soak could not establish its authenticated E2E session.");
  }
  assertAuthenticatedAdminSessionResponse(execution.body, {
    expectedEmail,
    expectedRunId,
    expectedVersion,
    purpose: outcomeSoakSessionPurpose,
  });
  if (!sessionCookie) {
    throw new Error("Production Worker soak authentication did not return a session cookie.");
  }
  return sessionCookie;
}

export function assertAuthenticatedAdminSessionResponse(
  source: string | null,
  expected: {
    expectedEmail: string;
    expectedRunId: string;
    expectedVersion: string;
    purpose: ExistingValidationSessionPurpose;
  },
) {
  const payload = source === null ? null : parseCapturedJson(source);
  if (
    !payload ||
    !hasExactKeys(payload, ["ok", "runtimeVersionId", "user", "validationSession"])
  ) {
    throw new Error("Production Worker soak authentication response has the wrong contract.");
  }
  if (payload.runtimeVersionId !== expected.expectedVersion) {
    throw new Error("Production Worker soak authentication came from the wrong runtime Worker version.");
  }
  const user = objectRecord(payload.user);
  if (
    !user ||
    !hasExactKeys(user, ["email", "isAdmin"]) ||
    payload.ok !== true ||
    user.email !== expected.expectedEmail ||
    user.isAdmin !== true
  ) {
    throw new Error(
      "Production Worker soak E2E_TEST_AUTH_EMAIL is not the exact existing configured admin.",
    );
  }
  const validationSession = objectRecord(payload.validationSession);
  if (
    !validationSession ||
    !hasExactKeys(
      validationSession,
      ["candidateVersionId", "purpose", "runId", "sessionRef", "userRef"],
    ) ||
    validationSession.candidateVersionId !== expected.expectedVersion ||
    validationSession.runId !== expected.expectedRunId ||
    validationSession.purpose !== expected.purpose ||
    typeof validationSession.userRef !== "string" ||
    !/^[a-f0-9]{64}$/.test(validationSession.userRef) ||
    typeof validationSession.sessionRef !== "string" ||
    !/^[a-f0-9]{64}$/.test(validationSession.sessionRef)
  ) {
    throw new Error("Production Worker soak returned the wrong deterministic validation session.");
  }
  return {
    sessionRef: validationSession.sessionRef,
    userRef: validationSession.userRef,
  };
}

function capturedNativeSessionCookie(
  execution: Awaited<ReturnType<typeof executeSoakProbeWithCapture>>,
) {
  const setCookie = execution.responseHeaders?.get("set-cookie") ?? "";
  const match = setCookie.match(
    /(?:^|,\s*)((?:__Secure-)?better-auth\.session_token)=([^;,\s]+)/,
  );
  return match?.[1] && match[2] ? `${match[1]}=${match[2]}` : null;
}

export function capturedGuestCookieHeader(headers: Headers | null) {
  return capturedGuestQuotaCookies(headers)?.header ?? null;
}

export function capturedGuestQuotaCookies(headers: Headers | null) {
  const setCookie = headers?.get("set-cookie") ?? "";
  const values = new Map<string, string>();
  for (const match of setCookie.matchAll(
    /(?:^|,\s*|;\s*)(inspir_guest_(?:session|messages_used))=([^;,\s]+)/g,
  )) {
    if (match[1] && match[2]) values.set(match[1], match[2]);
  }
  const session = values.get("inspir_guest_session");
  const usage = values.get("inspir_guest_messages_used");
  const used = Number(usage);
  if (!session || !isWorkerVersionUuid(session) || !Number.isSafeInteger(used) || used < 0) {
    return null;
  }
  return {
    header: `inspir_guest_session=${session}; inspir_guest_messages_used=${used}`,
    sessionId: session.toLowerCase(),
    used,
  };
}

function parseCapturedJson(body: string) {
  try {
    return objectRecord(JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

function workerTopicRedirect(
  route: string,
  expectedLocationPathname: string,
  expectedLocationTopic: string,
): SoakRoute {
  return {
    route,
    method: "GET",
    expectedStatus: 308,
    expectedDelivery: "lean-api-worker",
    expectedLocationPathname,
    expectedLocationTopic,
  };
}

function staticGet(route: string, expectedStatus = 200): SoakRoute {
  return { route, method: "GET", expectedStatus, expectedDelivery: "static-assets" };
}

function staticImmutableJson(route: string): SoakRoute {
  return {
    route,
    method: "GET",
    expectedStatus: 200,
    expectedDelivery: "static-assets",
    expectedContentType: "application/json",
    requireNonEmptyBody: true,
    requireImmutablePublicCache: true,
  };
}

function staticRedirect(route: string, expectedStatus: number): SoakRoute {
  return { route, method: "GET", expectedStatus, expectedDelivery: "static-redirect" };
}

function requestKeyForRoute(route: string, baseUrl: string) {
  const url = new URL(route, baseUrl);
  return `${url.pathname}${url.search}`;
}

function hasOneYearImmutablePublicCache(cacheControl: string | null) {
  if (!cacheControl || !/\bpublic\b/i.test(cacheControl) || !/\bimmutable\b/i.test(cacheControl)) {
    return false;
  }
  const maxAge = cacheControl.match(/(?:^|,)\s*max-age=([0-9]+)/i);
  return maxAge !== null && Number(maxAge[1]) >= 365 * 24 * 60 * 60;
}

function hasPrivateNoStore(cacheControl: string | null) {
  return Boolean(
    cacheControl && /\bprivate\b/i.test(cacheControl) && /\bno-store\b/i.test(cacheControl),
  );
}

function safeResponseLocation(value: string | null, responseUrl: string) {
  if (!value) return null;
  try {
    return new URL(value, responseUrl);
  } catch {
    return null;
  }
}

export function parseOpenAiTextDeltas(source: string) {
  const deltas: string[] = [];
  let terminalSeen = false;
  const normalized = source.replaceAll("\r\n", "\n");
  for (const rawEvent of normalized.split("\n\n")) {
    const eventName = rawEvent
      .split("\n")
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    if (eventName === "error") {
      throw new Error("OpenAI SSE contained an error event.");
    }
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) continue;
    if (terminalSeen) throw new Error("OpenAI SSE continued after its terminal event.");
    if (data === "[DONE]") {
      terminalSeen = true;
      continue;
    }

    let payload: Record<string, unknown> | null;
    try {
      payload = objectRecord(JSON.parse(data) as unknown);
    } catch {
      throw new Error("OpenAI SSE contained malformed JSON.");
    }
    if (!payload || payload.error !== undefined || !Array.isArray(payload.choices)) {
      throw new Error("OpenAI SSE contained a malformed or error frame.");
    }
    const choices = payload.choices;
    for (const choice of choices) {
      const delta = objectRecord(objectRecord(choice)?.delta);
      if (typeof delta?.content === "string" && delta.content.length > 0) {
        deltas.push(delta.content);
      }
    }
  }
  if (!terminalSeen) throw new Error("OpenAI SSE ended without a terminal event.");
  return deltas;
}

export function classifySoakRequestError(error: unknown) {
  if (!(error instanceof Error)) return "network:unknown";
  if (error.name === "TimeoutError" || error.name === "AbortError" || /timeout/i.test(error.message)) {
    return "timeout";
  }
  const safeName = error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80);
  return safeName ? `network:${safeName}` : "network:error";
}

function captureOutput(child: ChildProcess) {
  let output = "";
  let diagnostics = "";
  const appendOutput = (chunk: Buffer | string) => {
    if (output.length < 16 * 1024 * 1024) output += chunk.toString();
  };
  const appendDiagnostics = (chunk: Buffer | string) => {
    if (diagnostics.length < 2 * 1024 * 1024) diagnostics += chunk.toString();
  };
  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendDiagnostics);
  const closed = Promise.all(
    [child.stdout, child.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (!stream || stream.destroyed) {
            resolve();
            return;
          }
          stream.once("close", resolve);
        }),
    ),
  ).then(() => undefined);
  return {
    output: () => output,
    diagnostics: () => diagnostics,
    closed: (timeoutMs: number) => resolvesWithin(closed, timeoutMs),
  };
}

async function waitForTailReadiness(
  child: ChildProcess,
  output: () => string,
  diagnostics: () => string,
  baseUrl: string,
  expectedVersion: string,
  tailSessionToken: string,
) {
  const startedAt = Date.now();
  const token = createPublicProbeToken("tail-readiness");
  const requestKeyPrefix = `/api/health?tail_readiness_probe=${token}-`;
  let attempts = 0;
  let lastStatus: number | null = null;
  while (Date.now() - startedAt < tailReadyTimeoutMs) {
    if (wranglerTailDiagnosticIsConnected(`${output()}\n${diagnostics()}`)) {
      return {
        source: "wrangler-connected-diagnostic" as const,
        durationMs: Date.now() - startedAt,
        attempts,
        lastStatus,
      };
    }
    if (hasChildExited(child)) {
      throw new Error(
        `Wrangler tail exited before its connection diagnostic (${child.exitCode ?? child.signalCode}).`,
      );
    }
    const requestKey = `${requestKeyPrefix}${attempts}`;
    attempts += 1;
    try {
      const response = await fetch(new URL(requestKey, baseUrl), {
        headers: {
          "cache-control": "no-cache",
          "Cloudflare-Workers-Version-Overrides": `${workerName}="${expectedVersion}"`,
          [tailSessionHeader]: tailSessionToken,
        },
        signal: AbortSignal.timeout(10_000),
      });
      lastStatus = response.status;
      await response.arrayBuffer();
    } catch {
      lastStatus = null;
    }
    await delay(tailPollMs);
    if (tailOutputHasRequestPrefix(output(), requestKeyPrefix)) {
      return {
        source: "tail-readiness-probe" as const,
        durationMs: Date.now() - startedAt,
        attempts,
        lastStatus,
      };
    }
    if (attempts % 10 === 0) {
      console.error(
        JSON.stringify({
          stage: "tail_readiness_probe",
          attempts,
          stdoutBytes: Buffer.byteLength(output()),
          stderrBytes: Buffer.byteLength(diagnostics()),
          parsedRequestEvents: extractTailRequestKeys(output()).length,
        }),
      );
    }
  }
  const parsedRequestEvents = extractTailRequestKeys(output()).length;
  throw new Error(
    `Wrangler tail did not report its connected state within ${tailReadyTimeoutMs}ms ` +
      `or capture a readiness probe after ${attempts} attempts ` +
      `(${Buffer.byteLength(output())} stdout bytes, ${Buffer.byteLength(diagnostics())} stderr bytes, ${parsedRequestEvents} parsed request events).`,
  );
}

async function waitForTailSettle(
  child: ChildProcess,
  output: () => string,
  diagnostics: () => string,
  baseUrl: string,
  expectedVersion: string,
  tailSessionToken: string,
) {
  const sentinel = await waitForTailProbe(
    child,
    output,
    diagnostics,
    baseUrl,
    expectedVersion,
    "tail_settle_probe",
    tailCaptureTimeoutMs,
    tailSessionToken,
  );
  await delay(tailSettleGraceMs);
  return {
    ...sentinel,
    graceMs: tailSettleGraceMs,
    tailExited: hasChildExited(child),
  };
}

async function waitForTailProbe(
  child: ChildProcess,
  output: () => string,
  diagnostics: () => string,
  baseUrl: string,
  expectedVersion: string,
  parameter: "tail_settle_probe",
  timeoutMs: number,
  tailSessionToken: string,
) {
  // Cloudflare tail redacts UUID-like query values, so query correlation IDs must be visibly non-secret.
  const token = createPublicProbeToken(parameter.replaceAll("_", "-"));
  const requestKeyPrefix = `/api/health?${parameter}=${token}-`;
  const startedAt = Date.now();
  let attempts = 0;
  let lastStatus: number | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (hasChildExited(child)) {
      throw new Error(
        `Wrangler tail exited before its ${parameter} handshake (${child.exitCode ?? child.signalCode}).`,
      );
    }

    const requestKey = `${requestKeyPrefix}${attempts}`;
    attempts += 1;
    try {
      const response = await fetch(new URL(requestKey, baseUrl), {
        headers: {
          "cache-control": "no-cache",
          "Cloudflare-Workers-Version-Overrides": `${workerName}="${expectedVersion}"`,
          [tailSessionHeader]: tailSessionToken,
        },
        signal: AbortSignal.timeout(10_000),
      });
      lastStatus = response.status;
      await response.arrayBuffer();
    } catch {
      lastStatus = null;
    }

    await delay(tailPollMs);
    if (tailOutputHasRequestPrefix(output(), requestKeyPrefix)) {
      return {
        attempts,
        durationMs: Date.now() - startedAt,
        lastStatus,
      };
    }
    if (attempts % 10 === 0) {
      console.error(
        JSON.stringify({
          stage: parameter,
          attempts,
          stdoutBytes: Buffer.byteLength(output()),
          stderrBytes: Buffer.byteLength(diagnostics()),
          parsedRequestEvents: extractTailRequestKeys(output()).length,
        }),
      );
    }
  }

  const parsedRequestEvents = extractTailRequestKeys(output()).length;
  throw new Error(
    `Wrangler tail did not capture its ${parameter} handshake within ${timeoutMs}ms after ${attempts} attempts (${Buffer.byteLength(output())} stdout bytes, ${Buffer.byteLength(diagnostics())} stderr bytes, ${parsedRequestEvents} parsed request events).`,
  );
}

async function waitForCapturedRequestKeys(
  child: ChildProcess,
  output: () => string,
  requestKeys: string[],
  timeoutMs: number,
) {
  const startedAt = Date.now();
  let missing = requestKeys;

  while (Date.now() - startedAt < timeoutMs) {
    const capturedRequestKeys = new Set(
      extractTailRequestKeys(output()).map(comparableTailRequestKey),
    );
    missing = requestKeys.filter(
      (requestKey) => !capturedRequestKeys.has(comparableTailRequestKey(requestKey)),
    );
    if (missing.length === 0) {
      return {
        expected: requestKeys.length,
        captured: requestKeys.length,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        tailExited: false,
      };
    }
    if (hasChildExited(child)) {
      return {
        expected: requestKeys.length,
        captured: requestKeys.length - missing.length,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        tailExited: true,
      };
    }
    await delay(tailPollMs);
  }

  const capturedRequestKeys = new Set(
    extractTailRequestKeys(output()).map(comparableTailRequestKey),
  );
  missing = requestKeys.filter(
    (requestKey) => !capturedRequestKeys.has(comparableTailRequestKey(requestKey)),
  );
  return {
    expected: requestKeys.length,
    captured: requestKeys.length - missing.length,
    durationMs: Date.now() - startedAt,
    timedOut: missing.length > 0,
    tailExited: hasChildExited(child),
  };
}

export function extractTailRequestKeys(source: string) {
  return extractJsonObjects(source)
    .map(objectRecord)
    .filter(isRecord)
    .map(summarizeInvocation)
    .flatMap((invocation) => (invocation.requestKey === null ? [] : [invocation.requestKey]));
}

export function tailOutputHasRequestPrefix(source: string, prefix: string) {
  return extractTailRequestKeys(source).some((requestKey) => requestKey.startsWith(prefix));
}

export function wranglerTailDiagnosticIsConnected(source: string) {
  const normalized = source.replace(/\u001b\[[0-9;]*m/g, "");
  return /(?:^|\r?\n)Connected to [^\r\n]+, waiting for logs\.\.\.(?:\r?\n|$)/.test(normalized);
}

export function createPublicProbeToken(label: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(label)) {
    throw new Error("Probe token labels must contain only lowercase letters, numbers, and hyphens.");
  }
  return `${label}-${Date.now()}-${process.pid}`;
}

function requireActiveDeployment(wrangler: string, expectedVersion: string) {
  const result = spawnSync(
    wrangler,
    ["deployments", "status", "--json", "--name", workerName],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Unable to verify the active ${workerName} deployment: ${`${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000)}`,
    );
  }

  const deployment = parseDeploymentOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  const rawVersions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  const versions = rawVersions.flatMap((entry) => {
    const version = objectRecord(entry);
    const versionId = typeof version?.version_id === "string" ? version.version_id : null;
    const percentage = typeof version?.percentage === "number" ? version.percentage : null;
    return versionId && percentage !== null ? [{ versionId, percentage }] : [];
  });
  const active = versions.length === 1 ? versions[0] : null;
  if (active?.versionId !== expectedVersion || active.percentage !== 100) {
    throw new Error(
      `Expected ${workerName} version ${expectedVersion} at 100%, received ${JSON.stringify(versions)}.`,
    );
  }
  return active;
}

function parseDeploymentOutput(output: string) {
  try {
    return objectRecord(JSON.parse(output.trim()) as unknown);
  } catch {
    return extractJsonObjects(output)
      .map(objectRecord)
      .filter(isRecord)
      .find((record) => Array.isArray(record.versions)) ?? null;
  }
}

async function stopTail(
  child: ChildProcess,
  streamsClosed: (timeoutMs: number) => Promise<boolean>,
) {
  if (hasChildExited(child)) {
    return {
      requested: false,
      finalSignal: null,
      streamsClosed: await streamsClosed(tailShutdownTimeoutMs),
    };
  }

  const signals = ["SIGINT", "SIGTERM", "SIGKILL"] as const;
  for (const signal of signals) {
    child.kill(signal);
    if (await streamsClosed(tailShutdownTimeoutMs)) {
      return { requested: true, finalSignal: signal, streamsClosed: true };
    }
  }

  return { requested: true, finalSignal: "SIGKILL" as const, streamsClosed: false };
}

function hasChildExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function resolvesWithin(promise: Promise<unknown>, milliseconds: number) {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), milliseconds);
    void promise.then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

function extractJsonObjects(source: string) {
  const parsed: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          parsed.push(JSON.parse(source.slice(start, index + 1)) as unknown);
        } catch {
          // Wrangler status text can contain braces; only complete JSON events count.
        }
        start = -1;
      }
    }
  }
  return parsed;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

function summarizeInvocation(record: Record<string, unknown>) {
  const event = objectRecord(record.event);
  const request = objectRecord(event?.request);
  const response = objectRecord(event?.response);
  const exceptions = Array.isArray(record.exceptions) ? record.exceptions.map(objectRecord).filter(isRecord) : [];
  const requestUrl = safeRequestUrl(request?.url);
  return {
    outcome: typeof record.outcome === "string" ? record.outcome : null,
    cpuTimeMs: finiteNumber(record.cpuTime),
    wallTimeMs: finiteNumber(record.wallTime),
    method: typeof request?.method === "string" ? request.method : null,
    path: requestUrl?.pathname ?? null,
    requestKey: requestUrl ? `${requestUrl.pathname}${requestUrl.search}` : null,
    comparableRequestKey: requestUrl ? comparableTailRequestKey(requestUrl.href) : null,
    resourceSoak: requestUrl?.searchParams.get("resource_soak") ?? null,
    status: finiteNumber(response?.status),
    exceptions: exceptions
      .map((exception) => (typeof exception.message === "string" ? exception.message : null))
      .filter((message): message is string => message !== null),
  };
}

function buildRouteCounts(
  requests: SoakRequestResult[],
  invocations: Array<ReturnType<typeof summarizeInvocation>>,
) {
  const expectedByPath = new Map<string, number>();
  for (const request of requests) {
    if (request.expectedDelivery !== "lean-api-worker") continue;
    const pathname = normalizeTailPathname(
      new URL(request.requestKey, "https://probe.invalid").pathname,
    );
    expectedByPath.set(pathname, (expectedByPath.get(pathname) ?? 0) + 1);
  }

  return [...expectedByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pathname, expected]) => {
      const captured = invocations.filter(
        (invocation) => invocation.path !== null && normalizeTailPathname(invocation.path) === pathname,
      );
      return {
        path: pathname,
        expected,
        captured: captured.length,
        cpuSamples: captured.filter((invocation) => invocation.cpuTimeMs !== null).length,
        maxCpuTimeMs: Math.max(0, ...captured.flatMap((invocation) => invocation.cpuTimeMs ?? [])),
      };
    });
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function workerCpuSampleIsWithinHeadroom(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value < workerCpuHeadroomThresholdMs;
}

export function normalizeTailPathname(pathname: string) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const normalized = pathname.split("/").map((segment) =>
    segment === "REDACTED" || uuid.test(segment) ? ":uuid" : segment
  ).join("/");
  return normalized || "/";
}

export function comparableTailRequestKey(value: string) {
  const url = new URL(value, "https://tail-correlation.invalid");
  return `${normalizeTailPathname(url.pathname)}${url.search}`;
}

function safeRequestUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function requireWorkerVersion(value: string | undefined) {
  const version = value?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(version)) {
    throw new Error("Worker outcome verification requires --expected-version <Worker version UUID>.");
  }
  return version;
}

function requireProductionE2EAuth(): ProductionE2EAuth {
  const secret = process.env.E2E_TEST_AUTH_SECRET ?? "";
  const email = process.env.E2E_TEST_AUTH_EMAIL ?? "";
  const runId = process.env.E2E_TEST_MUTATION_RUN_ID ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32 || !/^[\x21-\x7e]+$/.test(secret)) {
    throw new Error(
      "Production Worker outcome verification requires E2E_TEST_AUTH_SECRET with at least 32 UTF-8 bytes.",
    );
  }
  if (
    email.length <= 3 ||
    email.length > 320 ||
    email !== email.trim() ||
    email !== email.toLowerCase() ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error(
      "Production Worker outcome verification requires the exact lowercase E2E_TEST_AUTH_EMAIL configured on the Worker.",
    );
  }
  if (!isWorkerVersionUuid(runId) || runId !== runId.toLowerCase()) {
    throw new Error(
      "Production Worker outcome verification requires exact lowercase E2E_TEST_MUTATION_RUN_ID.",
    );
  }
  return { email, secret, runId };
}

function requireProductionProbeSecret(value: string | undefined) {
  const secret = value ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32 || !/^[\x21-\x7e]+$/.test(secret)) {
    throw new Error(
      "Secret-free Worker outcome verification requires the prior E2E_TEST_AUTH_SECRET as a disabled-route probe only.",
    );
  }
  return secret;
}

function requireGuestQuotaScope(value: string | undefined, authenticatedRunId?: string) {
  const scope = value?.trim() ?? "";
  if (!isWorkerVersionUuid(scope) || scope !== scope.toLowerCase()) {
    throw new Error(
      "Production Worker outcome verification requires exact lowercase E2E_TEST_GUEST_QUOTA_SCOPE.",
    );
  }
  if (authenticatedRunId && scope !== authenticatedRunId) {
    throw new Error("Guest quota scope must equal the authenticated production validation run.");
  }
  return scope;
}

function isWorkerVersionUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function pathEntryExists(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
