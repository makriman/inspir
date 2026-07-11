import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLanguage, languageConfigs } from "../../lib/content/languages";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "../../lib/i18n/main-app-static-asset";
import { staticSiteLanguagesForPath } from "../../lib/i18n/static-availability";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";

const workerName = "inspirlearning";
const defaultBaseUrl = "https://inspirlearning.com";
const tailSessionHeader = "x-inspir-tail-session";
const tailReadyTimeoutMs = 60_000;
const tailCaptureTimeoutMs = 30_000;
const tailPollMs = 1_000;
const tailSettleGraceMs = 2_000;
const tailShutdownTimeoutMs = 5_000;
const workerProbePaceMs = 1_500;
const freePlanCpuLimitMs = 10;
export const workerCpuHeadroomThresholdMs = 8;

type ExpectedDelivery = "static-assets" | "static-redirect" | "lean-api-worker";

type SoakRequestResult = {
  route: string;
  requestKey: string;
  method: "GET" | "POST";
  status: number | null;
  ok: boolean;
  expectedStatus: number;
  expectedDelivery: ExpectedDelivery;
  actualDelivery?: string | null;
  actualLocation?: string | null;
  contentType?: string | null;
  cacheControl?: string | null;
  bodyBytes?: number;
  parsedOpenAiDeltaCount?: number;
  guestQuotaHeadersValid?: boolean;
  problems?: string[];
  error?: string;
};

type SoakRoute = {
  route: string;
  method: "GET" | "POST";
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
  const expectedVersion = requireWorkerVersion(getArg("--expected-version") ?? process.env.EXPECTED_WORKER_VERSION);
  const baseUrl = normalizeBaseUrl(getArg("--base-url") ?? process.env.PRODUCTION_BASE_URL ?? defaultBaseUrl);
  const reportPath = path.join(
    cloudflareDir(resolveBackupDir()),
    "production-worker-outcomes-report.json",
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

    const { probeToken, requests, staticRequestKeys, workerRequestKeys } = await runResourceSoak(
      baseUrl,
      expectedVersion,
      tailSessionToken,
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
    const workerRequestKeySet = new Set(workerRequestKeys);
    const staticRequestKeySet = new Set(staticRequestKeys);
    const workerProbeInvocations = probeInvocations.filter(
      (invocation) => invocation.requestKey !== null && workerRequestKeySet.has(invocation.requestKey),
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
        (invocation) => invocation.requestKey !== null && staticRequestKeySet.has(invocation.requestKey),
      )
      .slice(0, 50);
    const missingWorkerInvocations = workerRequestKeys.filter(
      (requestKey) => !workerProbeInvocations.some((invocation) => invocation.requestKey === requestKey),
    );
    const unexpectedProbeInvocations = probeInvocations
      .filter(
        (invocation) =>
          invocation.requestKey === null ||
          (!workerRequestKeySet.has(invocation.requestKey) && !staticRequestKeySet.has(invocation.requestKey)),
      )
      .slice(0, 50);
    const cpuSamples = workerProbeInvocations.flatMap((invocation) =>
      invocation.cpuTimeMs === null
        ? []
        : [{ requestKey: invocation.requestKey, path: invocation.path, cpuTimeMs: invocation.cpuTimeMs }],
    );
    const missingCpuSamples = workerRequestKeys.filter(
      (requestKey) => !cpuSamples.some((sample) => sample.requestKey === requestKey),
    );
    const cpuThresholdViolations = cpuSamples.filter(
      (sample) => sample.cpuTimeMs >= workerCpuHeadroomThresholdMs,
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
      missingCpuSamples.length === 0 &&
      cpuThresholdViolations.length === 0 &&
      nonOkOutcomes.length === 0 &&
      nonOkInvocations.length === 0 &&
      exceptionCount === 0 &&
      forbiddenLogs.length === 0 &&
      workerInvokedStaticRoutes.length === 0 &&
      unexpectedProbeInvocations.length === 0 &&
      routeCounts.every((route) => route.captured >= route.expected && route.cpuSamples >= route.expected) &&
      failedRequests.length === 0;
    const report = {
      createdAt: new Date().toISOString(),
      ok,
      workerName,
      expectedVersion,
      activeDeployment,
      baseUrl,
      probeToken,
      requestCount: requests.length,
      failedRequests,
      expectedWorkerInvocations: workerRequestKeys.length,
      capturedProbeInvocations: probeInvocations.length,
      capturedWorkerInvocations: workerProbeInvocations.length,
      missingWorkerInvocations,
      routeCounts,
      outcomeCounts,
      nonOkOutcomes,
      nonOkInvocations,
      workerInvokedStaticRoutes,
      unexpectedProbeInvocations,
      exceptionCount,
      forbiddenLogs,
      cpuPolicy: {
        freePlanLimitMs: freePlanCpuLimitMs,
        failAtOrAboveMs: workerCpuHeadroomThresholdMs,
        reservedHeadroomMs: freePlanCpuLimitMs - workerCpuHeadroomThresholdMs,
      },
      cpuSamples,
      missingCpuSamples,
      cpuThresholdViolations,
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
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
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
) {
  const nonce = createPublicProbeToken("resource-soak");
  const localeRoutes = staticSiteLanguagesForPath("/")
    .filter((language) => language !== defaultLanguage)
    .map((language) => `/${languageConfigs[language].prefix}`);
  const hindiMainAppTranslationBundle = getCuratedMainAppTranslationBundle("Hindi");
  if (!hindiMainAppTranslationBundle) throw new Error("The curated Hindi main-app bundle is missing.");
  const hindiMainAppAsset = buildStaticMainAppBundleAsset("hi", hindiMainAppTranslationBundle);
  const workerRoutes: SoakRoute[] = [
    workerGet(`/api/health?resource_soak=${nonce}-health-0`),
    {
      route: `/api/guest-chat?resource_soak=${nonce}-guest-chat-0`,
      method: "POST",
      expectedStatus: 200,
      expectedDelivery: "lean-api-worker",
      headers: {
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
        "user-agent": `inspir-worker-outcome-soak-${nonce}`,
      },
      body: JSON.stringify({
        topicId: "learn-anything",
        content: "Reply with one short sentence confirming the production tutor works.",
        preferredLanguage: "English",
        messages: [],
      }),
      requireNonEmptyBody: true,
      expectedContentType: "text/event-stream",
      requireOpenAiDelta: true,
      requireGuestQuotaHeaders: true,
    },
  ];
  const staticRoutes: SoakRoute[] = [
    staticGet(`/?resource_soak=${nonce}-home-0`),
    staticGet(`/robots.txt?resource_soak=${nonce}-robots-0`),
    staticGet(`/sitemap.xml?resource_soak=${nonce}-sitemap-index-0`),
    staticGet(`/sitemap/en-US.xml?resource_soak=${nonce}-sitemap-en-0`),
    staticGet(`/rss.xml?resource_soak=${nonce}-rss-0`),
    staticGet(`/manifest.webmanifest?resource_soak=${nonce}-manifest-0`),
    staticGet(`/loading?resource_soak=${nonce}-loading-0`),
    staticGet(`/inspir-social-preview.png?resource_soak=${nonce}-social-0`),
    ...localeRoutes.map((route, index) => staticGet(`${route}?resource_soak=${nonce}-locale-${index}`)),
    staticGet(`/api/topics?resource_soak=${nonce}-topics-0`),
    staticImmutableJson(
      `${hindiMainAppAsset.publicPath}?resource_soak=${nonce}-main-app-hi-0`,
    ),
    staticGet(`/chat?topic=learn-anything&resource_soak=${nonce}-chat-en-0`),
    staticGet(`/hi/chat?topic=learn-anything&resource_soak=${nonce}-chat-hi-0`),
    staticTopicRedirect(
      `/chat/learn-anything?resource_soak=${nonce}-chat-en-legacy-0`,
      "/chat",
      "learn-anything",
    ),
    staticTopicRedirect(
      `/hi/chat/learn-anything?resource_soak=${nonce}-chat-hi-legacy-0`,
      "/hi/chat",
      "learn-anything",
    ),
    staticGet(`/chat/__inspir_unknown_topic__?resource_soak=${nonce}-chat-unknown-0`, 404),
    staticGet(`/chat/learn-anything/deep?resource_soak=${nonce}-chat-deep-0`, 404),
    staticGet(
      `/chat/123e4567-e89b-42d3-a456-426614174000?resource_soak=${nonce}-chat-uuid-0`,
      404,
    ),
    staticGet(`/hi/chat/learn-anything/deep?resource_soak=${nonce}-chat-hi-deep-0`, 404),
    staticGet(`/__inspir_static_404_probe?resource_soak=${nonce}-unknown-public-0`, 404),
    staticGet(`/api/__inspir_static_404_probe?resource_soak=${nonce}-unknown-api-0`, 404),
    staticGet(`/api/site-translations?resource_soak=${nonce}-removed-translation-0`, 404),
    staticGet(`/api/main-app-translations?resource_soak=${nonce}-removed-main-translation-0`, 404),
    staticGet(`/games?resource_soak=${nonce}-removed-games-0`, 404),
    staticGet(`/games/arena?resource_soak=${nonce}-removed-games-deep-0`, 404),
    staticGet(`/api/auth/get-session?resource_soak=${nonce}-removed-auth-0`, 404),
    staticGet(`/api/me?resource_soak=${nonce}-removed-account-0`, 404),
    staticGet(`/api/chats?resource_soak=${nonce}-removed-saved-chats-0`, 404),
    staticGet(`/api/memory?resource_soak=${nonce}-removed-memory-0`, 404),
    staticGet(`/admin?resource_soak=${nonce}-removed-admin-page-0`, 404),
    staticGet(`/api/admin/users?resource_soak=${nonce}-removed-admin-api-0`, 404),
    staticPost(`/api/chat?resource_soak=${nonce}-removed-chat-mutation-0`, { content: "probe" }),
    staticPost(`/api/analytics/events?resource_soak=${nonce}-removed-analytics-mutation-0`, {
      event: "production_static_404_probe",
    }),
    staticPost(`/api/logout?resource_soak=${nonce}-removed-logout-0`, {}),
    staticGet(`/og?resource_soak=${nonce}-removed-og-0`, 404),
    staticRedirect(`/tnc?resource_soak=${nonce}-tnc-0`, 308),
  ];
  const results: SoakRequestResult[] = [];

  for (let index = 0; index < workerRoutes.length; index += 1) {
    results.push(
      await executeSoakProbe(
        workerRoutes[index],
        baseUrl,
        expectedVersion,
        tailSessionToken,
        nonce,
      ),
    );
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

  return {
    probeToken: nonce,
    requests: results,
    workerRequestKeys: workerRoutes.map((probe) => requestKeyForRoute(probe.route, baseUrl)),
    staticRequestKeys: staticRoutes.map((probe) => requestKeyForRoute(probe.route, baseUrl)),
  };
}

async function executeSoakProbe(
  probe: SoakRoute,
  baseUrl: string,
  expectedVersion: string,
  tailSessionToken: string,
  nonce: string,
): Promise<SoakRequestResult> {
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
      parsedOpenAiDeltaCount,
      guestQuotaHeadersValid,
      problems,
    };
  } catch (error) {
    return {
      route: probe.route,
      requestKey,
      method: probe.method,
      status: null,
      ok: false,
      expectedStatus: probe.expectedStatus,
      expectedDelivery: probe.expectedDelivery,
      error: classifySoakRequestError(error),
    };
  }
}

function workerGet(route: string): SoakRoute {
  return { route, method: "GET", expectedStatus: 200, expectedDelivery: "lean-api-worker" };
}

function staticGet(route: string, expectedStatus = 200): SoakRoute {
  return { route, method: "GET", expectedStatus, expectedDelivery: "static-assets" };
}

function staticPost(route: string, body: unknown): SoakRoute {
  return {
    route,
    method: "POST",
    expectedStatus: 405,
    expectedDelivery: "static-assets",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
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

function staticTopicRedirect(
  route: string,
  expectedLocationPathname: string,
  expectedLocationTopic: string,
): SoakRoute {
  return {
    route,
    method: "GET",
    expectedStatus: 308,
    expectedDelivery: "static-redirect",
    expectedLocationPathname,
    expectedLocationTopic,
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
  const normalized = source.replaceAll("\r\n", "\n");
  for (const rawEvent of normalized.split("\n\n")) {
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;

    let payload: Record<string, unknown> | null = null;
    try {
      payload = objectRecord(JSON.parse(data) as unknown);
    } catch {
      // A malformed or provider-specific event is not an OpenAI text delta.
    }
    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    for (const choice of choices) {
      const delta = objectRecord(objectRecord(choice)?.delta);
      if (typeof delta?.content === "string" && delta.content.length > 0) {
        deltas.push(delta.content);
      }
    }
  }
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
  return waitForTailProbe(
    child,
    output,
    diagnostics,
    baseUrl,
    expectedVersion,
    "tail_ready_probe",
    tailReadyTimeoutMs,
    tailSessionToken,
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
  parameter: "tail_ready_probe" | "tail_settle_probe",
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
    const capturedRequestKeys = new Set(extractTailRequestKeys(output()));
    missing = requestKeys.filter((requestKey) => !capturedRequestKeys.has(requestKey));
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

  const capturedRequestKeys = new Set(extractTailRequestKeys(output()));
  missing = requestKeys.filter((requestKey) => !capturedRequestKeys.has(requestKey));
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
    const pathname = new URL(request.requestKey, "https://probe.invalid").pathname;
    expectedByPath.set(pathname, (expectedByPath.get(pathname) ?? 0) + 1);
  }

  return [...expectedByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pathname, expected]) => {
      const captured = invocations.filter((invocation) => invocation.path === pathname);
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

function normalizeBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
