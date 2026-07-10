import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLanguage, languageConfigs } from "../../lib/content/languages";
import { staticSiteLanguagesForPath } from "../../lib/i18n/static-availability";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";

const workerName = "inspirlearning";
const defaultBaseUrl = "https://inspirlearning.com";
const tailStartupMs = 5_000;
const tailDrainMs = 8_000;
const freePlanCpuLimitMs = 10;
export const workerCpuHeadroomThresholdMs = 8;

type SoakRequestResult = {
  route: string;
  requestKey: string;
  method: "GET" | "POST";
  status: number | null;
  ok: boolean;
  expectedStatus: number;
  expectedDelivery: "static-assets" | "static-redirect" | "worker";
  actualDelivery?: string | null;
  bodyBytes?: number;
  error?: string;
};

type SoakRoute = {
  route: string;
  method: "GET" | "POST";
  expectedStatus: number;
  expectedDelivery: "static-assets" | "static-redirect" | "worker";
  headers?: Record<string, string>;
  body?: string;
  requireNonEmptyBody?: boolean;
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
  const tail = spawn(
    wrangler,
    ["tail", workerName, "--format", "json", "--version-id", expectedVersion],
    { cwd: process.cwd(), env: commandEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const capture = captureOutput(tail);

  try {
    await delay(tailStartupMs);
    if (tail.exitCode !== null) throw new Error(`Wrangler tail exited before the soak (${tail.exitCode}).`);

    const { probeToken, requests, staticRequestKeys, workerRequestKeys } = await runResourceSoak(baseUrl, expectedVersion);
    await delay(tailDrainMs);
    await stopTail(tail);

    const records = extractJsonObjects(capture.output()).map(objectRecord).filter(isRecord);
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
      missingWorkerInvocations.length === 0 &&
      missingCpuSamples.length === 0 &&
      cpuThresholdViolations.length === 0 &&
      nonOkOutcomes.length === 0 &&
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
      tailExitCode: tail.exitCode,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    if (tail.exitCode === null) await stopTail(tail);
  }
}

async function runResourceSoak(baseUrl: string, expectedVersion: string) {
  const nonce = crypto.randomUUID();
  const localeRoutes = staticSiteLanguagesForPath("/")
    .filter((language) => language !== defaultLanguage)
    .map((language) => `/${languageConfigs[language].prefix}`);
  const workerRoutes: SoakRoute[] = [
    ...Array.from({ length: 12 }, (_, index) =>
      workerGet(`/api/health?resource_soak=${nonce}-health-${index}`),
    ),
    workerGet(`/api/auth/get-session?resource_soak=${nonce}-auth-0`),
    ...Array.from({ length: 4 }, (_, index) =>
      workerGet(`/api/topics?resource_soak=${nonce}-topics-${index}`),
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      workerGet(`/chat/learn-anything?resource_soak=${nonce}-chat-${index}`),
    ),
    {
      route: `/api/guest-chat?resource_soak=${nonce}-guest-chat-0`,
      method: "POST",
      expectedStatus: 200,
      expectedDelivery: "worker",
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
    staticGet(`/__inspir_static_404_probe?resource_soak=${nonce}-unknown-public-0`, 404),
    staticGet(`/api/__inspir_static_404_probe?resource_soak=${nonce}-unknown-api-0`, 404),
    staticGet(`/api/site-translations?resource_soak=${nonce}-removed-translation-0`, 404),
    staticGet(`/games?resource_soak=${nonce}-removed-games-0`, 404),
    staticGet(`/og?resource_soak=${nonce}-removed-og-0`, 404),
    staticRedirect(`/tnc?resource_soak=${nonce}-tnc-0`, 308),
  ];
  const routes = [...workerRoutes, ...staticRoutes];
  const results: SoakRequestResult[] = [];
  for (let index = 0; index < routes.length; index += 8) {
    const batch = routes.slice(index, index + 8);
    results.push(
      ...(await Promise.all(
        batch.map(async (probe) => {
          const headers = new Headers({
            "cache-control": "no-cache",
            "x-inspir-resource-soak": nonce,
            "Cloudflare-Workers-Version-Overrides": `${workerName}="${expectedVersion}"`,
            ...probe.headers,
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
            const bodyBytes = (await response.arrayBuffer()).byteLength;
            return {
              route: probe.route,
              requestKey,
              method: probe.method,
              status: response.status,
              ok:
                response.status === probe.expectedStatus &&
                (probe.expectedDelivery === "worker"
                  ? actualDelivery !== "static-assets"
                  : probe.expectedDelivery === "static-redirect"
                    ? actualDelivery === null
                    : actualDelivery === "static-assets") &&
                (!probe.requireNonEmptyBody || bodyBytes > 0),
              expectedStatus: probe.expectedStatus,
              expectedDelivery: probe.expectedDelivery,
              actualDelivery,
              bodyBytes,
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
        }),
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

function workerGet(route: string): SoakRoute {
  return { route, method: "GET", expectedStatus: 200, expectedDelivery: "worker" };
}

function staticGet(route: string, expectedStatus = 200): SoakRoute {
  return { route, method: "GET", expectedStatus, expectedDelivery: "static-assets" };
}

function staticRedirect(route: string, expectedStatus: number): SoakRoute {
  return { route, method: "GET", expectedStatus, expectedDelivery: "static-redirect" };
}

function requestKeyForRoute(route: string, baseUrl: string) {
  const url = new URL(route, baseUrl);
  return `${url.pathname}${url.search}`;
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
  const append = (chunk: Buffer | string) => {
    if (output.length < 16 * 1024 * 1024) output += chunk.toString();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { output: () => output };
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

async function stopTail(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGINT");
  const graceful = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
  if (!graceful && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5_000)]);
  }
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
    if (request.expectedDelivery !== "worker") continue;
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
