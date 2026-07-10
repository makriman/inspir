import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLanguage, languageConfigs, supportedLanguages } from "../../lib/content/languages";
import {
  applyChessMove,
  createChessState,
  legalChessActions,
  type ChessState,
} from "../../lib/games/chess";
import { chooseChessOpponentAction } from "../../lib/games/chess-strategy";
import {
  applyConnectFourMove,
  createConnectFourState,
  legalConnectFourActions,
  type ConnectFourState,
} from "../../lib/games/connect-four";
import { chooseConnectFourOpponentAction } from "../../lib/games/connect-four-strategy";
import {
  applyTicTacToeMove,
  createTicTacToeState,
  legalTicTacToeActions,
  type TicTacToeState,
} from "../../lib/games/tic-tac-toe";
import { chooseTicTacToeOpponentAction } from "../../lib/games/tic-tac-toe-strategy";
import { cloudflareDir, resolveBackupDir } from "./migration-config";

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
  const home = await request("/");
  checkResponse("home", home, {
    bodyIncludes: [/free ai learning/i, /learn/i],
    requireCloudflare: true,
  });

  await checkRuntimeHealth();
  await checkCacheRevalidation();
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
  checkImmutableLocalizedCacheControl("localized Hindi route", localized);

  const localizedChat = await request("/hi/chat/learn-anything");
  checkResponse("localized Hindi chat route", localizedChat);
  if ((localizedChat.headers["set-cookie"] ?? "").includes("inspir_locale=Hindi")) {
    pass("localized Hindi chat route language cookie");
  } else {
    fail("localized Hindi chat route language cookie", { setCookie: localizedChat.headers["set-cookie"] ?? null });
  }
  checkCacheControl("localized Hindi chat route", localizedChat, [/private/i, /no-store/i]);

  const unavailableLocalized = await request("/hi/mission");
  if (unavailableLocalized.status === 308 && new URL(unavailableLocalized.headers.location ?? "/", baseUrl).pathname === "/mission") {
    pass("unavailable localized route canonical redirect", {
      status: unavailableLocalized.status,
      location: unavailableLocalized.headers.location,
    });
  } else {
    fail("unavailable localized route canonical redirect", {
      status: unavailableLocalized.status,
      location: unavailableLocalized.headers.location,
    });
  }

  const robots = await request("/robots.txt");
  checkResponse("robots", robots, { bodyIncludes: [/User-Agent/i] });

  const sitemap = await request("/sitemap");
  checkResponse("sitemap index", sitemap, { bodyIncludes: [/<sitemapindex/i] });

  const englishSitemap = await request("/sitemap/en-US.xml");
  checkResponse("English sitemap", englishSitemap, { bodyIncludes: [/<urlset/i] });

  const rss = await request("/rss.xml");
  checkResponse("RSS", rss, { bodyIncludes: [/<rss/i] });

  const og = await request("/og");
  checkResponse("OG image", og, { contentTypeIncludes: "image/png" });

  const topics = await request("/api/topics");
  checkResponse("topics API", topics, { contentTypeIncludes: "application/json" });
  checkCacheControl("topics API", topics, [/public/i, /max-age=300/i, /s-maxage=3600/i]);
  checkTopicsPayload(topics);

  await checkRemovedTranslationApis();
  await checkGameMiniApps();
  await checkLocaleResourceSoak();

  await checkGuestChat();

  const ok = writeReport();
  if (!ok) process.exitCode = 1;
}

async function checkRuntimeHealth() {
  const health = await request("/api/health");
  checkResponse("Worker health", health, { contentTypeIncludes: "application/json", requireCloudflare: true });
  checkCacheControl("Worker health", health, [/private/i, /no-store/i]);

  const payload = parseJsonObject(health.body);
  const version = objectValue(payload?.version);
  const build = objectValue(payload?.build);
  const architecture = objectValue(payload?.architecture);
  if (
    version.id === expectedWorkerVersion &&
    typeof build.id === "string" &&
    build.id !== "unknown-build" &&
    architecture.cacheRevalidationQueue === true &&
    architecture.incrementalCache === "regional-r2" &&
    architecture.workerWideCache === false
  ) {
    pass("Worker health architecture", {
      versionId: version.id,
      expectedWorkerVersion,
      buildId: build.id,
      architecture,
    });
  } else {
    fail("Worker health architecture", { expectedWorkerVersion, version, build, architecture });
  }
}

async function checkCacheRevalidation() {
  const first = await request("/api/cache-health");
  checkResponse("ISR cache health", first, { contentTypeIncludes: "application/json" });
  const stable = await findStableCachePair(first);
  if (!stable) {
    fail("OpenNext ISR cache hit", {
      firstGeneratedAt: stringValue(parseJsonObject(first.body)?.generatedAt),
      firstRenderCache: renderCacheState(first) || null,
    });
    return;
  }

  const baselineGeneratedAt = stringValue(parseJsonObject(stable.body)?.generatedAt);
  pass("OpenNext ISR cache hit", {
    generatedAt: baselineGeneratedAt,
    renderCache: renderCacheState(stable),
  });
  await delay(6_000);
  const stale = await request("/api/cache-health");
  const staleGeneratedAt = stringValue(parseJsonObject(stale.body)?.generatedAt);
  const staleState = renderCacheState(stale);
  if (staleGeneratedAt === baselineGeneratedAt && staleState === "STALE") {
    pass("OpenNext ISR stale transition", { generatedAt: staleGeneratedAt, nextCache: staleState });
  } else {
    fail("OpenNext ISR stale transition", { generatedAt: staleGeneratedAt, nextCache: staleState || null });
  }

  let revalidated: FetchResult | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = await request("/api/cache-health");
    const generatedAt = stringValue(parseJsonObject(candidate.body)?.generatedAt);
    const nextCache = renderCacheState(candidate);
    if (
      baselineGeneratedAt &&
      generatedAt &&
      generatedAt !== baselineGeneratedAt &&
      (nextCache === "HIT" || nextCache === "REVALIDATED")
    ) {
      revalidated = candidate;
      break;
    }
    await delay(500);
  }

  if (revalidated) {
    pass("OpenNext Durable Object cache revalidation", {
      before: baselineGeneratedAt,
      after: stringValue(parseJsonObject(revalidated.body)?.generatedAt),
      renderCache: renderCacheState(revalidated) || null,
    });
  } else {
    fail("OpenNext Durable Object cache revalidation", {
      before: baselineGeneratedAt,
      staleRenderCache: renderCacheState(stale) || null,
    });
  }
}

async function findStableCachePair(initial: FetchResult) {
  let previous = initial;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(250);
    const candidate = await request("/api/cache-health");
    const previousGeneratedAt = stringValue(parseJsonObject(previous.body)?.generatedAt);
    const generatedAt = stringValue(parseJsonObject(candidate.body)?.generatedAt);
    const nextCache = renderCacheState(candidate);
    if (previousGeneratedAt && previousGeneratedAt === generatedAt && nextCache === "HIT") return candidate;
    previous = candidate;
  }
  return null;
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
    if (result.status === 404) pass(`${route} removed`, { status: result.status });
    else fail(`${route} removed`, { status: result.status, bodyPreview: result.bodyPreview });
  }
}

async function checkGameMiniApps() {
  const arena = await request("/games");
  checkResponse("game arena", arena, { bodyIncludes: [/tic.tac.toe/i, /connect four/i, /chess/i] });

  for (const slug of ["tic-tac-toe", "connect-four", "chess"] as const) {
    const game = await request(`/games/${slug}`);
    checkResponse(`${slug} mini-app`, game);
    const manifest = await request(`/games/${slug}/manifest.webmanifest`);
    checkResponse(`${slug} manifest`, manifest);
    const manifestPayload = parseJsonObject(manifest.body);
    const manifestIcons = Array.isArray(manifestPayload?.icons) ? manifestPayload.icons : [];
    const primaryIcon = objectValue(manifestIcons[0]);
    if (
      manifestPayload?.id === `/games/${slug}` &&
      manifestPayload.scope === `/games/${slug}` &&
      manifestPayload.start_url === `/games/${slug}?source=installed` &&
      primaryIcon.src === `/games/${slug}/icon.svg`
    ) {
      pass(`${slug} install identity`, {
        id: manifestPayload.id,
        scope: manifestPayload.scope,
        startUrl: manifestPayload.start_url,
        primaryIcon: primaryIcon.src,
      });
    } else {
      fail(`${slug} install identity`, manifestPayload);
    }

    const icon = await request(`/games/${slug}/icon.svg`);
    checkResponse(`${slug} install icon`, icon, { contentTypeIncludes: "image/svg+xml" });

    const serviceWorker = await request(`/games/${slug}-sw.js`);
    checkResponse(`${slug} service worker`, serviceWorker, {
      bodyIncludes: [/skipWaiting/, /clients\.claim/],
      contentTypeIncludes: "javascript",
    });
  }

  await checkDurableGameResult();
}

async function checkDurableGameResult() {
  const completedGames = [
    { slug: "tic-tac-toe", state: completedStrategyTicTacToeState() },
    { slug: "connect-four", state: completedStrategyConnectFourState() },
    { slug: "chess", state: completedStrategyChessState() },
  ] as const;

  for (const { slug, state } of completedGames) {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const created = await request("/api/games/results", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": `inspir-production-${slug}-result-smoke-${Date.now()}`,
      },
      body: JSON.stringify({ state, startedAt }),
    });
    checkResponse(`${slug} durable game result create`, created, { contentTypeIncludes: "application/json" });
    checkCacheControl(`${slug} durable game result create`, created, [/private/i, /no-store/i]);
    if (created.status !== 201) {
      fail(`${slug} durable game result create contract`, {
        status: created.status,
        bodyPreview: created.bodyPreview,
      });
      continue;
    }

    const createdResult = objectValue(parseJsonObject(created.body)?.result);
    const resultId = stringValue(createdResult.id);
    if (!resultId || !/^gr_[a-f0-9]{32}$/.test(resultId)) {
      fail(`${slug} durable game result opaque ID`, { resultId });
      continue;
    }
    pass(`${slug} durable game result opaque ID`, { resultId });

    const fetched = await request(`/api/games/results/${resultId}`);
    checkResponse(`${slug} durable game result read`, fetched, { contentTypeIncludes: "application/json" });
    checkCacheControl(`${slug} durable game result read`, fetched, [/public/i, /immutable/i]);
    const fetchedResult = objectValue(parseJsonObject(fetched.body)?.result);
    const fetchedState = objectValue(fetchedResult.state);
    const opponent = objectValue(fetchedResult.opponent);
    const opponentEngine = objectValue(opponent.engine);
    if (
      fetchedResult.id === resultId &&
      fetchedResult.gameSlug === slug &&
      fetchedState.gameSlug === slug &&
      opponent.kind === "deterministic-engine" &&
      opponentEngine.id === `inspir.local-strategy.${slug}`
    ) {
      pass(`${slug} durable game result replay and provenance`, {
        resultId,
        terminalCode: fetchedResult.terminalCode,
        opponent: opponentEngine,
      });
    } else {
      fail(`${slug} durable game result replay and provenance`, { resultId, fetchedResult });
    }

    const resultPage = await request(`/games/${slug}/results/${resultId}`);
    checkResponse(`${slug} durable game result experience`, resultPage, { bodyIncludes: [/Opening result/i] });
  }
}

function completedStrategyTicTacToeState(): TicTacToeState {
  let state = createTicTacToeState("x");
  while (!state.result) {
    const action =
      state.activeActor === "opponent"
        ? chooseTicTacToeOpponentAction(state)
        : legalTicTacToeActions(state)[0] ?? null;
    if (!action || !state.activeActor) throw new Error("Could not build deterministic Tic-Tac-Toe smoke state.");
    const applied = applyTicTacToeMove(state, state.activeActor, action);
    if (!applied.ok) throw new Error(`Tic-Tac-Toe smoke move failed: ${applied.error}`);
    state = applied.state;
  }
  return state;
}

function completedStrategyConnectFourState(): ConnectFourState {
  let state = createConnectFourState("red");
  while (!state.result) {
    const action =
      state.activeActor === "opponent"
        ? chooseConnectFourOpponentAction(state)
        : legalConnectFourActions(state)[0] ?? null;
    if (!action || !state.activeActor) throw new Error("Could not build deterministic Connect Four smoke state.");
    const applied = applyConnectFourMove(state, state.activeActor, action);
    if (!applied.ok) throw new Error(`Connect Four smoke move failed: ${applied.error}`);
    state = applied.state;
  }
  return state;
}

export function completedStrategyChessState(): ChessState {
  let state = createChessState({ humanColor: "w" });
  for (let turn = 0; turn < 128 && !state.result; turn += 1) {
    const action =
      state.activeActor === "opponent"
        ? chooseChessOpponentAction(state)
        : [...legalChessActions(state)].sort((left, right) => left.token.localeCompare(right.token))[0] ?? null;
    if (!action || !state.activeActor) throw new Error("Could not build deterministic Chess smoke state.");
    const applied = applyChessMove(state, state.activeActor, { token: action.token });
    if (!applied.ok) throw new Error(`Chess smoke move failed: ${applied.error}`);
    state = applied.state;
  }
  if (!state.result) throw new Error("Chess smoke game did not finish within the persisted result bound.");
  return state;
}

async function checkLocaleResourceSoak() {
  if (process.env.REQUIRE_RESOURCE_SOAK !== "1") {
    fail("localized route resource soak", "Set REQUIRE_RESOURCE_SOAK=1 for the required production resource gate.");
    return;
  }

  const routes = supportedLanguages
    .filter((language) => language !== defaultLanguage)
    .map((language) => `/${languageConfigs[language].prefix}`);
  const failures: Array<{ route: string; status: number }> = [];
  for (let index = 0; index < routes.length; index += 8) {
    const batch = routes.slice(index, index + 8);
    const results = await Promise.all(batch.map(async (route) => ({ route, result: await request(route) })));
    for (const { route, result } of results) {
      if (result.status !== 200 && result.status !== 308) failures.push({ route, status: result.status });
    }
  }

  if (failures.length === 0) pass("localized route resource soak", { routes: routes.length });
  else fail("localized route resource soak", { routes: routes.length, failures });
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

async function request(route: string, init?: RequestInit): Promise<FetchResult> {
  const url = new URL(route, baseUrl).toString();
  const headers = new Headers(init?.headers);
  headers.set(
    "Cloudflare-Workers-Version-Overrides",
    `inspirlearning="${expectedWorkerVersion}"`,
  );
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

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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

function checkImmutableLocalizedCacheControl(name: string, result: FetchResult) {
  const cacheControl = result.headers["cache-control"] ?? "";
  const sMaxAge = readCacheControlSeconds(cacheControl, "s-maxage");
  const renderCache = renderCacheState(result);
  const prerender = result.headers["x-nextjs-prerender"] ?? "";
  const missing: string[] = [];

  if (sMaxAge === null || sMaxAge < 365 * 24 * 60 * 60) missing.push("s-maxage>=31536000");
  if (/\b(?:private|no-store)\b/i.test(cacheControl)) {
    missing.push("shared-cacheable");
  }
  if (!prerender.split(",").some((value) => value.trim() === "1")) missing.push("x-nextjs-prerender=1");
  if (renderCache !== "HIT" && renderCache !== "REVALIDATED") {
    missing.push("x-nextjs-cache|x-opennext-cache=HIT|REVALIDATED");
  }

  if (missing.length === 0) {
    pass(`${name} immutable cache policy`, { cacheControl, sMaxAge, renderCache, prerender });
  } else {
    fail(`${name} immutable cache policy`, { cacheControl, sMaxAge, renderCache, prerender, missing });
  }
}

function renderCacheState(result: FetchResult) {
  return (result.headers["x-nextjs-cache"] ?? result.headers["x-opennext-cache"] ?? "").toUpperCase();
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
