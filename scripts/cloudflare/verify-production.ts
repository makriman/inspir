import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLanguage, languageConfigs } from "../../lib/content/languages";
import { staticSiteLanguagesForPath } from "../../lib/i18n/static-availability";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";

type Check = {
  name: string;
  status: "pass" | "fail";
  detail?: unknown;
};

type FetchResult = {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  bodyPreview: string;
};

const backupDir = resolveBackupDir();
const baseUrl = normalizeBaseUrl(getArg("--base-url") ?? process.env.PRODUCTION_BASE_URL ?? "https://inspirlearning.com");
const expectedWorkerVersion = requireExpectedWorkerVersion(
  getArg("--expected-version") ?? process.env.EXPECTED_WORKER_VERSION,
);
const outputPath = path.join(cloudflareDir(backupDir), "production-smoke-report.json");
const checks: Check[] = [];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    fail("production smoke runtime", error instanceof Error ? error.message : String(error));
    writeReport();
    process.exitCode = 1;
  });
}

async function main() {
  await checkWwwCanonicalRedirect();
  checkActiveMainWorkerDeployment();

  const home = await request("/");
  checkResponse("home", home, {
    bodyIncludes: [/free ai learning/i, /learn/i],
    requireCloudflare: true,
  });
  checkStaticAssetDelivery("home", home);

  const loading = await request("/loading");
  checkResponse("static loading state", loading, { bodyIncludes: [/Getting your learning space ready/i] });
  checkStaticAssetDelivery("static loading state", loading);

  await checkRuntimeHealth();
  await checkAuthCacheIsolation();

  const localized = await request("/hi");
  checkResponse("localized Hindi route", localized, {
    bodyIncludes: [/learn|सीख|सीखने|शिक्ष/i],
  });
  if ((localized.headers["set-cookie"] ?? "").includes("inspir_locale=Hindi")) {
    fail("localized Hindi route language cookie suppressed", { setCookie: localized.headers["set-cookie"] ?? null });
  } else {
    pass("localized Hindi route language cookie suppressed", { setCookie: localized.headers["set-cookie"] ?? null });
  }
  checkStaticAssetDelivery("localized Hindi route", localized);

  const localizedChat = await request("/hi/chat/learn-anything");
  checkResponse("localized Hindi chat route", localizedChat);
  if ((localizedChat.headers["set-cookie"] ?? "").includes("inspir_locale=Hindi")) {
    pass("localized Hindi chat route language cookie");
  } else {
    fail("localized Hindi chat route language cookie", { setCookie: localizedChat.headers["set-cookie"] ?? null });
  }
  checkCacheControl("localized Hindi chat route", localizedChat, [/private/i, /no-store/i]);

  const unavailableLocalized = await request("/hi/mission");
  checkStaticNotFound("unsupported localized route", unavailableLocalized);

  const robots = await request("/robots.txt");
  checkResponse("robots", robots, { bodyIncludes: [/User-Agent/i] });
  checkStaticAssetDelivery("robots", robots);

  const sitemap = await request("/sitemap.xml");
  checkResponse("sitemap index", sitemap, { bodyIncludes: [/<sitemapindex/i] });
  checkStaticAssetDelivery("sitemap index", sitemap);

  const englishSitemap = await request("/sitemap/en-US.xml");
  checkResponse("English sitemap", englishSitemap, { bodyIncludes: [/<urlset/i] });
  checkStaticAssetDelivery("English sitemap", englishSitemap);

  const rss = await request("/rss.xml");
  checkResponse("RSS", rss, { bodyIncludes: [/<rss/i] });
  checkStaticAssetDelivery("RSS", rss);

  const manifest = await request("/manifest.webmanifest");
  checkResponse("web app manifest", manifest, {
    bodyIncludes: [/"start_url":"\/chat\/learn-anything"/],
    contentTypeIncludes: "application/manifest+json",
  });
  checkStaticAssetDelivery("web app manifest", manifest);

  const tnc = await request("/tnc");
  const tncPathname = new URL(tnc.headers.location ?? "/", baseUrl).pathname;
  if (
    tnc.status === 308 &&
    tncPathname === "/terms" &&
    tnc.headers["x-inspir-delivery"] === undefined
  ) {
    pass("static legal redirect", { status: tnc.status, location: tnc.headers.location });
  } else {
    fail("static legal redirect", {
      status: tnc.status,
      location: tnc.headers.location ?? null,
      delivery: tnc.headers["x-inspir-delivery"] ?? null,
    });
  }

  const socialPreview = await request("/inspir-social-preview.png");
  checkResponse("social preview image", socialPreview, { contentTypeIncludes: "image/png" });
  checkStaticAssetDelivery("social preview image", socialPreview, { immutable: true });

  const unknownPublic = await request(`/__inspir_static_404_probe_${Date.now()}`);
  checkStaticNotFound("unknown public route", unknownPublic);

  const unknownApi = await request(`/api/__inspir_static_404_probe_${Date.now()}`);
  checkStaticNotFound("unknown API route", unknownApi);

  const topics = await request("/api/topics");
  checkResponse("topics API", topics, { contentTypeIncludes: "application/json" });
  checkCacheControl("topics API", topics, [/public/i, /max-age=300/i, /s-maxage=3600/i]);
  checkTopicsPayload(topics);

  const retiredGames = await request("/games");
  checkStaticNotFound("removed game surface", retiredGames);

  await checkRemovedTranslationApis();
  await checkLocaleResourceSoak();

  await checkGuestChat();

  const ok = writeReport();
  if (!ok) process.exitCode = 1;
}

async function checkWwwCanonicalRedirect() {
  const query = `production_redirect_probe=${Date.now()}&next=a%2Fb`;
  const sourceUrl = `https://www.inspirlearning.com/hi/about?${query}`;
  const expectedLocation = `https://inspirlearning.com/hi/about?${query}`;
  const redirect = await request(sourceUrl, undefined, { pinMainWorkerVersion: false });
  const detail = {
    status: redirect.status,
    location: redirect.headers.location ?? null,
    delivery: redirect.headers["x-inspir-delivery"] ?? null,
    cacheControl: redirect.headers["cache-control"] ?? null,
  };

  if (
    redirect.status === 308 &&
    redirect.headers.location === expectedLocation &&
    redirect.headers["x-inspir-delivery"] === "www-redirect-worker"
  ) {
    pass("www canonical redirect Worker", detail);
  } else {
    fail("www canonical redirect Worker", { ...detail, expectedLocation });
  }
}

function checkActiveMainWorkerDeployment() {
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  const result = spawnSync(
    wrangler,
    ["deployments", "status", "--json", "--name", "inspirlearning"],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    fail("active main Worker deployment", {
      status: result.status,
      outputTail: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000),
    });
    return;
  }

  const deployment = parseJsonObjectFromOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  const versions = deploymentVersions(deployment?.versions);
  const active = versions.length === 1 ? versions[0] : null;
  if (active?.versionId === expectedWorkerVersion && active.percentage === 100) {
    pass("active main Worker deployment", active);
  } else {
    fail("active main Worker deployment", {
      expectedWorkerVersion,
      requiredPercentage: 100,
      versions,
    });
  }
}

async function checkRuntimeHealth() {
  const health = await request(
    `/api/health?production_unpinned_version_probe=${Date.now()}`,
    undefined,
    { pinMainWorkerVersion: false },
  );
  checkResponse("unpinned Worker health", health, { contentTypeIncludes: "application/json", requireCloudflare: true });
  checkWorkerDelivery("unpinned Worker health", health);
  checkCacheControl("unpinned Worker health", health, [/private/i, /no-store/i]);

  const payload = parseJsonObject(health.body);
  const version = objectValue(payload?.version);
  const build = objectValue(payload?.build);
  const architecture = objectValue(payload?.architecture);
  if (
    version.id === expectedWorkerVersion &&
    typeof build.id === "string" &&
    build.id !== "unknown-build" &&
    architecture.deploymentMode === "free-static-first" &&
    architecture.publicDocuments === "workers-static-assets" &&
    architecture.workerCpuPlan === "free-10ms" &&
    architecture.games === false
  ) {
    pass("unpinned Worker health architecture", {
      versionId: version.id,
      expectedWorkerVersion,
      buildId: build.id,
      architecture,
    });
  } else {
    fail("unpinned Worker health architecture", { expectedWorkerVersion, version, build, architecture });
  }
}

async function checkAuthCacheIsolation() {
  const route = `/api/auth/get-session?production_cache_probe=${Date.now()}`;
  const anonymous = await request(route);
  const repeated = await request(route);
  const cookieVariant = await request(route, {
    headers: { cookie: "better-auth.session_token=invalid-production-cache-probe" },
  });

  for (const [name, result] of [
    ["anonymous", anonymous],
    ["repeated", repeated],
    ["cookie variant", cookieVariant],
  ] as const) {
    checkResponse(`auth session ${name}`, result, { contentTypeIncludes: "application/json" });
    checkCacheControl(`auth session ${name}`, result, [/private/i, /no-store/i]);
    if ((result.headers["cf-cache-status"] ?? "").toUpperCase() === "HIT") {
      fail(`auth session ${name} bypasses shared cache`, { cfCacheStatus: result.headers["cf-cache-status"] });
    } else {
      pass(`auth session ${name} bypasses shared cache`, { cfCacheStatus: result.headers["cf-cache-status"] ?? null });
    }
  }
}

async function checkRemovedTranslationApis() {
  for (const route of ["/api/site-translations", "/api/main-app-translations"]) {
    const result = await request(route);
    checkStaticNotFound(`${route} removed`, result);
  }
}

async function checkLocaleResourceSoak() {
  if (process.env.REQUIRE_RESOURCE_SOAK !== "1") {
    fail("localized route resource soak", "Set REQUIRE_RESOURCE_SOAK=1 for the required production resource gate.");
    return;
  }

  const routes = staticSiteLanguagesForPath("/")
    .filter((language) => language !== defaultLanguage)
    .map((language) => `/${languageConfigs[language].prefix}`);
  const failures: Array<{ route: string; status: number; problems: string[] }> = [];
  for (let index = 0; index < routes.length; index += 8) {
    const batch = routes.slice(index, index + 8);
    const results = await Promise.all(batch.map(async (route) => ({ route, result: await request(route) })));
    for (const { route, result } of results) {
      const problems = staticAssetProblems(result);
      if (result.status !== 200) problems.unshift("status=200");
      if (problems.length > 0) failures.push({ route, status: result.status, problems });
    }
  }

  if (failures.length === 0) {
    pass("localized route resource soak", { routes: routes.length, delivery: "static-assets" });
  } else {
    fail("localized route resource soak", { routes: routes.length, failures });
  }
}

async function checkGuestChat() {
  if (process.env.REQUIRE_LIVE_AI !== "1") {
    fail("live guest chat", "Set REQUIRE_LIVE_AI=1 for the required production chat smoke gate.");
    return;
  }

  const response = await request("/api/guest-chat", {
    method: "POST",
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/json",
      "user-agent": `inspir-production-smoke-${Date.now()}`,
    },
    body: JSON.stringify({
      topicId: "learn-anything",
      content: "Say hello in one short sentence.",
      preferredLanguage: "English",
      messages: [],
    }),
  });

  checkResponse("live guest chat", response);
  if (response.ok && response.bodyPreview.trim().length > 0) {
    const used = Number(response.headers["x-guest-messages-used"]);
    const limit = Number(response.headers["x-guest-messages-limit"]);
    pass("live guest chat streamed body", {
      messageLimit: response.headers["x-guest-messages-limit"] ?? null,
      messagesUsed: response.headers["x-guest-messages-used"] ?? null,
    });
    if (Number.isInteger(used) && Number.isInteger(limit) && used >= 1 && limit >= used) {
      pass("live guest chat limit headers", { messagesUsed: used, messageLimit: limit });
    } else {
      fail("live guest chat limit headers", {
        messageLimit: response.headers["x-guest-messages-limit"] ?? null,
        messagesUsed: response.headers["x-guest-messages-used"] ?? null,
      });
    }
  } else {
    fail("live guest chat streamed body", {
      status: response.status,
      bodyPreview: response.bodyPreview,
    });
    fail("live guest chat limit headers", {
      messageLimit: response.headers["x-guest-messages-limit"] ?? null,
      messagesUsed: response.headers["x-guest-messages-used"] ?? null,
    });
  }
}

async function request(
  route: string,
  init?: RequestInit,
  options: { pinMainWorkerVersion?: boolean } = {},
): Promise<FetchResult> {
  const url = new URL(route, baseUrl).toString();
  const headers = new Headers(init?.headers);
  if (options.pinMainWorkerVersion !== false) {
    headers.set(
      "Cloudflare-Workers-Version-Overrides",
      `inspirlearning="${expectedWorkerVersion}"`,
    );
  }
  const response = await fetch(url, {
    ...init,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const responseHeaders = Object.fromEntries(
    [...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
  );
  const contentType = responseHeaders["content-type"] ?? "";
  const body =
    contentType.includes("image/") || response.status === 204 ? "" : await response.text().catch((error) => String(error));
  return {
    url,
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    headers: responseHeaders,
    body,
    bodyPreview: body.slice(0, 2000),
  };
}

function checkResponse(
  name: string,
  result: FetchResult,
  options: {
    bodyIncludes?: RegExp[];
    contentTypeIncludes?: string;
    requireCloudflare?: boolean;
  } = {},
) {
  if (result.ok) pass(`${name} status`, { status: result.status, url: result.url });
  else fail(`${name} status`, { status: result.status, url: result.url, bodyPreview: result.bodyPreview });

  for (const pattern of options.bodyIncludes ?? []) {
    if (pattern.test(result.body)) pass(`${name} body: ${pattern.source}`);
    else fail(`${name} body: ${pattern.source}`, { bodyPreview: result.bodyPreview });
  }

  if (options.contentTypeIncludes) {
    const contentType = result.headers["content-type"] ?? "";
    if (contentType.includes(options.contentTypeIncludes)) {
      pass(`${name} content type`, { contentType });
    } else {
      fail(`${name} content type`, { expected: options.contentTypeIncludes, actual: contentType });
    }
  }

  if (options.requireCloudflare) {
    const server = result.headers.server ?? "";
    const hasCloudflareSignal = server.toLowerCase().includes("cloudflare") || Boolean(result.headers["cf-ray"]);
    if (hasCloudflareSignal) {
      pass(`${name} Cloudflare edge signal`, { server, cfRay: result.headers["cf-ray"] ?? null });
    } else {
      fail(`${name} Cloudflare edge signal`, { server, cfRay: result.headers["cf-ray"] ?? null });
    }
  }

}

function checkTopicsPayload(result: FetchResult) {
  try {
    const payload = JSON.parse(result.body) as { topics?: Array<{ slug?: string }> };
    const topics = payload.topics ?? [];
    const hasLearnAnything = topics.some((topic) => topic.slug === "learn-anything");
    const hasRetiredArena = topics.some((topic) => topic.slug === "ai-game-arena");
    if (topics.length > 50 && hasLearnAnything && !hasRetiredArena) {
      pass("topics API payload", { topics: topics.length });
    } else {
      fail("topics API payload", { topics: topics.length, hasLearnAnything, hasRetiredArena });
    }
  } catch (error) {
    fail("topics API payload", error instanceof Error ? error.message : String(error));
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJsonObjectFromOutput(value: string) {
  const direct = parseJsonObject(value.trim());
  if (direct) return direct;
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  return first >= 0 && last > first ? parseJsonObject(value.slice(first, last + 1)) : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deploymentVersions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = objectValue(entry);
    const versionId = typeof record.version_id === "string" ? record.version_id : null;
    const percentage = typeof record.percentage === "number" ? record.percentage : null;
    return versionId && percentage !== null ? [{ versionId, percentage }] : [];
  });
}

function checkCacheControl(name: string, result: FetchResult, patterns: RegExp[]) {
  const cacheControl = result.headers["cache-control"] ?? "";
  const missing = patterns.filter((pattern) => !pattern.test(cacheControl)).map((pattern) => pattern.source);
  if (missing.length === 0) {
    pass(`${name} cache policy`, { cacheControl });
  } else {
    fail(`${name} cache policy`, { cacheControl, missing });
  }
}

function checkWorkerDelivery(name: string, result: FetchResult) {
  const delivery = result.headers["x-inspir-delivery"];
  if (delivery === undefined) {
    pass(`${name} dynamic Worker delivery`);
  } else {
    fail(`${name} dynamic Worker delivery`, { unexpectedStaticDeliveryHeader: delivery });
  }
}

function checkStaticAssetDelivery(name: string, result: FetchResult, options: { immutable?: boolean } = {}) {
  const problems = staticAssetProblems(result, options);
  if (problems.length === 0) {
    pass(`${name} direct static asset delivery`, {
      delivery: result.headers["x-inspir-delivery"],
      cacheControl: result.headers["cache-control"] ?? null,
      etag: result.headers.etag ?? null,
    });
  } else {
    fail(`${name} direct static asset delivery`, {
      delivery: result.headers["x-inspir-delivery"] ?? null,
      cacheControl: result.headers["cache-control"] ?? null,
      nextCache: result.headers["x-nextjs-cache"] ?? null,
      openNextCache: result.headers["x-opennext-cache"] ?? null,
      nextPrerender: result.headers["x-nextjs-prerender"] ?? null,
      problems,
    });
  }
}

function checkStaticNotFound(name: string, result: FetchResult) {
  if (result.status === 404) {
    pass(`${name} status`, { status: result.status, url: result.url });
  } else {
    fail(`${name} status`, { status: result.status, url: result.url, bodyPreview: result.bodyPreview });
  }
  checkStaticAssetDelivery(name, result);
}

function staticAssetProblems(result: FetchResult, options: { immutable?: boolean } = {}) {
  const cacheControl = result.headers["cache-control"] ?? "";
  const problems: string[] = [];
  if (result.headers["x-inspir-delivery"] !== "static-assets") {
    problems.push("x-inspir-delivery=static-assets");
  }
  if (/\b(?:private|no-store)\b/i.test(cacheControl)) problems.push("shared-cacheable");
  for (const header of ["x-nextjs-cache", "x-opennext-cache", "x-nextjs-prerender"] as const) {
    if (result.headers[header]) problems.push(`no-${header}`);
  }
  if (options.immutable) {
    const maxAge = readCacheControlSeconds(cacheControl, "max-age");
    if (maxAge === null || maxAge < 365 * 24 * 60 * 60) problems.push("max-age>=31536000");
    if (!/\bimmutable\b/i.test(cacheControl)) problems.push("immutable");
  } else {
    if (!/\bpublic\b/i.test(cacheControl)) problems.push("public");
    if (readCacheControlSeconds(cacheControl, "max-age") !== 0) problems.push("max-age=0");
    if (!/\bmust-revalidate\b/i.test(cacheControl)) problems.push("must-revalidate");
  }
  return problems;
}

function readCacheControlSeconds(cacheControl: string, directive: string) {
  const pattern = new RegExp(`(?:^|,)\\s*${directive}=([0-9]+)`, "i");
  const match = cacheControl.match(pattern);
  if (!match) return null;
  return Number(match[1]);
}

function writeReport() {
  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    baseUrl,
    ok: failed.length === 0,
    failedChecks: failed.length,
    checks,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  return report.ok;
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function requireExpectedWorkerVersion(value: string | undefined) {
  const version = value?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(version)) {
    throw new Error("Production verification requires --expected-version <Worker version UUID>.");
  }
  return version;
}

function pass(name: string, detail?: unknown) {
  checks.push({ name, status: "pass", detail });
}

function fail(name: string, detail?: unknown) {
  checks.push({ name, status: "fail", detail });
}
