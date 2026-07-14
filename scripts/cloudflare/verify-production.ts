import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLanguage, languageConfigs } from "../../lib/content/languages";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "../../lib/i18n/main-app-static-asset";
import { staticSiteLanguagesForPath } from "../../lib/i18n/static-availability";
import { writePrivateJsonDurably } from "./d1-release-budget-ledger";
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

  const accountRecovery = await request("/reset_pw");
  checkResponse("static account recovery", accountRecovery, {
    bodyIncludes: [/no inspir password to reset/i, /Google/i],
  });
  checkStaticAssetDelivery("static account recovery", accountRecovery);

  await checkRuntimeHealth();

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

  const englishLegacyChat = await request("/chat/learn-anything");
  checkWorkerTopicRedirect(
    "known English legacy chat route",
    englishLegacyChat,
    "/chat",
    "learn-anything",
  );
  const englishChat = await request("/chat?topic=learn-anything");
  checkResponse("known English chat route", englishChat);
  checkStaticAssetDelivery("known English chat route", englishChat);

  const localizedLegacyChat = await request("/hi/chat/learn-anything");
  checkWorkerTopicRedirect(
    "known localized Hindi legacy chat route",
    localizedLegacyChat,
    "/hi/chat",
    "learn-anything",
  );
  const localizedChat = await request("/hi/chat?topic=learn-anything");
  checkResponse("known localized Hindi chat route", localizedChat);
  if ((localizedChat.headers["set-cookie"] ?? "").includes("inspir_locale=Hindi")) {
    fail("known localized Hindi chat route language cookie suppressed", {
      setCookie: localizedChat.headers["set-cookie"] ?? null,
    });
  } else {
    pass("known localized Hindi chat route language cookie suppressed", {
      setCookie: localizedChat.headers["set-cookie"] ?? null,
    });
  }
  checkStaticAssetDelivery("known localized Hindi chat route", localizedChat);

  const hindiMainAppTranslationBundle = getCuratedMainAppTranslationBundle("Hindi");
  if (!hindiMainAppTranslationBundle) {
    fail("immutable Hindi main-app bundle source", "The curated Hindi bundle is missing.");
  } else {
    const hindiMainAppAsset = buildStaticMainAppBundleAsset("hi", hindiMainAppTranslationBundle);
    const hindiMainAppBundle = await request(hindiMainAppAsset.publicPath);
    checkResponse("immutable Hindi main-app bundle", hindiMainAppBundle, {
      contentTypeIncludes: "application/json",
    });
    checkStaticAssetDelivery("immutable Hindi main-app bundle", hindiMainAppBundle, { immutable: true });
    checkLocalizedMainAppBundle(hindiMainAppBundle, "Hindi", hindiMainAppAsset.sourceHash);
  }

  const localizedMission = await request("/hi/mission");
  checkResponse("localized Hindi mission", localizedMission, {
    bodyIncludes: [/lang=["']hi["']/i, /सीख|शिक्षा|मिशन|उद्देश्य/i],
  });
  checkStaticAssetDelivery("localized Hindi mission", localizedMission);

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
    bodyIncludes: [/"start_url":"\/chat\?topic=learn-anything"/],
    contentTypeIncludes: "application/manifest+json",
  });
  checkStaticAssetDelivery("web app manifest", manifest);

  const tnc = await request("/tnc");
  const tncPathname = new URL(tnc.headers.location ?? "/", baseUrl).pathname;
  if (
    tnc.status === 308 &&
    tncPathname === "/terms" &&
    isStaticRedirectDelivery(tnc.headers["x-inspir-delivery"])
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
  checkStaticAssetDelivery("topics API", topics, { allowFreshPublicCache: true });
  checkTopicsPayload(topics);

  await checkNativeSignedOutSurfaces(englishChat);
  await checkRetiredStaticSurfaces();
  await checkLegacyTranslationApis();
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
  const architecture = objectValue(payload?.architecture);
  if (
    version.id === expectedWorkerVersion &&
    architecture.deploymentMode === "free-static-native-accounts" &&
    architecture.publicDocuments === "workers-static-assets" &&
    architecture.workerCpuPlan === "free-10ms" &&
    architecture.openNext === false &&
    architecture.accounts === true &&
    architecture.savedState === true &&
    architecture.games === false
  ) {
    pass("unpinned Worker health architecture", {
      versionId: version.id,
      expectedWorkerVersion,
      architecture,
    });
  } else {
    fail("unpinned Worker health architecture", { expectedWorkerVersion, version, architecture });
  }
}

async function checkRetiredStaticSurfaces() {
  const retiredRoutes = [
    { name: "removed game surface", route: "/games" },
    { name: "removed game deep route", route: "/games/arena" },
  ];

  for (const retired of retiredRoutes) {
    const result = await request(retired.route);
    checkStaticNotFound(retired.name, result);
  }
}

async function checkNativeSignedOutSurfaces(staticChatShell: FetchResult) {
  const uuidChat = await request("/chat/123e4567-e89b-42d3-a456-426614174000");
  checkExpectedStatus("signed-out UUID chat shell", uuidChat, 200);
  checkWorkerDelivery("signed-out UUID chat shell", uuidChat);
  checkPrivateNoStore("signed-out UUID chat shell", uuidChat);
  const uuidContentType = uuidChat.headers["content-type"] ?? "";
  if (
    uuidContentType.includes("text/html") &&
    uuidChat.body.length > 0 &&
    uuidChat.body === staticChatShell.body
  ) {
    pass("signed-out UUID chat serves only the static shell", {
      contentType: uuidContentType,
      bodyBytes: Buffer.byteLength(uuidChat.body),
    });
  } else {
    fail("signed-out UUID chat serves only the static shell", {
      contentType: uuidContentType,
      bodyBytes: Buffer.byteLength(uuidChat.body),
      staticBodyBytes: Buffer.byteLength(staticChatShell.body),
      matchesStaticShell: uuidChat.body === staticChatShell.body,
    });
  }

  const admin = await request("/admin");
  checkExpectedStatus("static admin shell", admin, 200);
  checkStaticAssetDelivery("static admin shell", admin, { allowMissingCacheControl: true });

  const chatId = "123e4567-e89b-42d3-a456-426614174000";
  const signedOutProbes: Array<{
    name: string;
    route: string;
    expectedStatus: 200 | 204 | 401 | 403;
    init?: RequestInit;
    expectedBody?: "null" | "empty";
  }> = [
    {
      name: "signed-out Better Auth session",
      route: "/api/auth/get-session",
      expectedStatus: 200,
      expectedBody: "null",
    },
    { name: "signed-out profile", route: "/api/me", expectedStatus: 401 },
    { name: "signed-out saved chats", route: "/api/chats", expectedStatus: 401 },
    { name: "signed-out memory", route: "/api/memory", expectedStatus: 401 },
    { name: "signed-out account topics", route: "/api/account/topics", expectedStatus: 401 },
    { name: "signed-out admin dashboard", route: "/api/admin/dashboard", expectedStatus: 401 },
    { name: "signed-out admin users", route: "/api/admin/users", expectedStatus: 401 },
    {
      name: "signed-out authenticated chat",
      route: "/api/chat",
      expectedStatus: 401,
      init: jsonPost({ chatId, content: "signed-out production probe" }),
    },
    {
      name: "signed-out authenticated chat finalizer",
      route: "/api/chat/finalize",
      expectedStatus: 401,
      init: jsonPost({
        aiRunId: chatId,
        chatId,
        userMessageId: chatId,
        content: "signed-out production probe",
      }),
    },
    {
      name: "signed-out quiz activity",
      route: "/api/activities/quiz",
      expectedStatus: 401,
      init: jsonPost({ chatId, topic: "production probe" }),
    },
    {
      name: "signed-out flashcard activity",
      route: "/api/activities/flashcards",
      expectedStatus: 401,
      init: jsonPost({ chatId, topic: "production probe" }),
    },
    {
      name: "cross-origin logout rejected",
      route: "/api/logout",
      expectedStatus: 403,
      init: {
        ...jsonPost({}),
        headers: {
          "content-type": "application/json",
          origin: "https://signed-out-probe.invalid",
          "sec-fetch-site": "cross-site",
        },
      },
    },
    {
      name: "signed-out logout",
      route: "/api/logout",
      expectedStatus: 204,
      expectedBody: "empty",
      init: {
        ...jsonPost({}),
        headers: {
          "content-type": "application/json",
          origin: new URL(baseUrl).origin,
          "sec-fetch-site": "same-origin",
        },
      },
    },
  ];

  for (const probe of signedOutProbes) {
    const result = await request(probe.route, probe.init);
    checkExpectedStatus(probe.name, result, probe.expectedStatus);
    checkWorkerDelivery(probe.name, result);
    checkPrivateNoStore(probe.name, result);
    if (probe.expectedBody === "null") {
      if (result.body.trim() === "null") pass(`${probe.name} null body`);
      else fail(`${probe.name} null body`, { bodyPreview: result.bodyPreview });
    }
    if (probe.expectedBody === "empty") {
      if (result.body.length === 0) pass(`${probe.name} empty body`);
      else fail(`${probe.name} empty body`, { bodyPreview: result.bodyPreview });
    }
  }
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function checkLegacyTranslationApis() {
  const languagePreference = await request(
    "/api/language-preference",
    jsonPost({ language: "Hindi", pathname: "/mission" }),
  );
  checkExpectedStatus("legacy language preference", languagePreference, 200);
  checkWorkerDelivery("legacy language preference", languagePreference);
  checkPrivateNoStore("legacy language preference", languagePreference);
  const preferencePayload = parseJsonObject(languagePreference.body);
  const preferenceCookies = languagePreference.headers["set-cookie"] ?? "";
  if (
    preferencePayload?.language === "Hindi" &&
    preferencePayload.redirectTo === "/hi/mission" &&
    preferenceCookies.includes("inspir_locale=Hindi") &&
    preferenceCookies.includes("inspir_locale_prompt_dismissed=1")
  ) {
    pass("legacy language preference contract");
  } else {
    fail("legacy language preference contract", {
      payload: preferencePayload,
      hasLocaleCookie: preferenceCookies.includes("inspir_locale=Hindi"),
      hasPromptCookie: preferenceCookies.includes("inspir_locale_prompt_dismissed=1"),
    });
  }

  for (const probe of [
    {
      name: "legacy English main-app translations",
      route: "/api/main-app-translations?language=English",
      language: "English",
      namespace: "main-app",
    },
    {
      name: "legacy Hindi main-app translations",
      route: "/api/main-app-translations?language=Hindi",
      language: "Hindi",
      namespace: "main-app",
    },
    {
      name: "legacy English site home translations",
      route: "/api/site-translations?language=English&namespace=route%3Ahome",
      language: "English",
      namespace: "route:home",
    },
    {
      name: "legacy Hindi site mission translations",
      route: "/api/site-translations?language=Hindi&namespace=route%3Amission",
      language: "Hindi",
      namespace: "route:mission",
    },
  ] as const) {
    const result = await request(probe.route);
    checkExpectedStatus(probe.name, result, 200);
    checkWorkerDelivery(probe.name, result);
    checkCacheControl(probe.name, result, [/\bpublic\b/i, /\bmax-age=300\b/i, /\bs-maxage=3600\b/i]);
    const payload = parseJsonObject(result.body);
    const bundle = objectValue(payload?.bundle);
    const translatedCount = payload?.translatedCount;
    const totalCount = payload?.totalCount;
    const containsExpectedScript =
      probe.language !== "Hindi" ||
      Object.values(objectValue(bundle.strings)).some(
        (value) => typeof value === "string" && /[\u0900-\u097f]/u.test(value),
      );
    if (
      payload?.complete === true &&
      typeof translatedCount === "number" &&
      translatedCount > 0 &&
      translatedCount === totalCount &&
      bundle.language === probe.language &&
      bundle.namespace === probe.namespace &&
      containsExpectedScript
    ) {
      pass(`${probe.name} result envelope`, {
        language: bundle.language,
        namespace: bundle.namespace,
        translatedCount,
      });
    } else {
      fail(`${probe.name} result envelope`, {
        payload: payload
          ? {
              complete: payload.complete,
              translatedCount: payload.translatedCount,
              totalCount: payload.totalCount,
              language: bundle.language,
              namespace: bundle.namespace,
              containsExpectedScript,
            }
          : null,
      });
    }
  }

  const unpublished = await request(
    "/api/site-translations?language=Hindi&namespace=route%3Aabout",
  );
  checkLegacyTranslationError(
    "legacy known unpublished site pair",
    unpublished,
    404,
    "Translation bundle is not published",
  );

  const unknown = await request(
    "/api/site-translations?language=English&namespace=unknown",
  );
  checkLegacyTranslationError(
    "legacy site translations reject unknown namespace",
    unknown,
    400,
    "Unsupported namespace",
  );
}

function checkLegacyTranslationError(
  name: string,
  result: FetchResult,
  expectedStatus: 400 | 404,
  expectedError: string,
) {
  checkExpectedStatus(name, result, expectedStatus);
  checkWorkerDelivery(name, result);
  checkPrivateNoStore(name, result);
  const error = parseJsonObject(result.body)?.error;
  if (error === expectedError) {
    pass(`${name} error contract`, { error });
  } else {
    fail(`${name} error contract`, { expectedError, actual: error ?? null });
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
      accept: "text/event-stream",
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

  checkResponse("live guest chat", response, { contentTypeIncludes: "text/event-stream" });
  checkWorkerDelivery("live guest chat", response);

  const deltas = parseOpenAiTextDeltas(response.body);
  if (response.ok && deltas.length > 0) {
    pass("live guest chat parsed OpenAI delta", {
      deltaCount: deltas.length,
      textCharacters: deltas.join("").length,
    });
  } else {
    fail("live guest chat parsed OpenAI delta", {
      status: response.status,
      bodyPreview: response.bodyPreview,
    });
  }

  const used = Number(response.headers["x-guest-messages-used"]);
  const limit = Number(response.headers["x-guest-messages-limit"]);
  if (Number.isInteger(used) && Number.isInteger(limit) && used >= 1 && limit >= used) {
    pass("live guest chat limit headers", { messagesUsed: used, messageLimit: limit });
  } else {
    fail("live guest chat limit headers", {
      messageLimit: response.headers["x-guest-messages-limit"] ?? null,
      messagesUsed: response.headers["x-guest-messages-used"] ?? null,
    });
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

    const payload = parseJsonObject(data);
    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    for (const choice of choices) {
      const delta = objectValue(objectValue(choice).delta);
      if (typeof delta.content === "string" && delta.content.length > 0) {
        deltas.push(delta.content);
      }
    }
  }
  return deltas;
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

function checkLocalizedMainAppBundle(
  result: FetchResult,
  expectedLanguage: string,
  expectedSourceHash: string,
) {
  const payload = parseJsonObject(result.body);
  const strings = objectValue(payload?.strings);
  const localizedStrings = Object.values(strings).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (
    payload?.namespace === "main-app" &&
    payload.language === expectedLanguage &&
    payload.sourceHash === expectedSourceHash &&
    localizedStrings.length > 0
  ) {
    pass("immutable Hindi main-app bundle payload", {
      language: payload.language,
      sourceHash: payload.sourceHash,
      translatedStrings: localizedStrings.length,
    });
  } else {
    fail("immutable Hindi main-app bundle payload", {
      expectedLanguage,
      expectedSourceHash,
      namespace: payload?.namespace ?? null,
      language: payload?.language ?? null,
      sourceHash: payload?.sourceHash ?? null,
      translatedStrings: localizedStrings.length,
    });
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

function checkPrivateNoStore(name: string, result: FetchResult) {
  const cacheControl = result.headers["cache-control"] ?? "";
  const cdnCacheControl = result.headers["cdn-cache-control"] ?? "";
  const cloudflareCacheControl = result.headers["cloudflare-cdn-cache-control"] ?? "";
  const valid =
    /\bprivate\b/i.test(cacheControl) &&
    /\bno-store\b/i.test(cacheControl) &&
    /\bno-store\b/i.test(cdnCacheControl);
  if (valid) {
    pass(`${name} private no-store policy`, {
      cacheControl,
      cdnCacheControl,
      cloudflareCacheControl,
    });
  } else {
    fail(`${name} private no-store policy`, {
      cacheControl,
      cdnCacheControl,
      cloudflareCacheControl,
    });
  }
}

function checkWorkerDelivery(name: string, result: FetchResult) {
  const delivery = result.headers["x-inspir-delivery"] ?? null;
  if (delivery === "lean-api-worker") {
    pass(`${name} lean API Worker delivery`, { delivery });
  } else {
    fail(`${name} lean API Worker delivery`, { expected: "lean-api-worker", actual: delivery });
  }
}

function checkWorkerTopicRedirect(
  name: string,
  result: FetchResult,
  expectedPathname: string,
  expectedTopic: string,
) {
  const location = new URL(result.headers.location ?? "/", result.url);
  const expectedOrigin = new URL(baseUrl).origin;
  const detail = {
    status: result.status,
    delivery: result.headers["x-inspir-delivery"] ?? null,
    location: result.headers.location ?? null,
  };
  if (
    result.status === 308 &&
    result.headers["x-inspir-delivery"] === "lean-api-worker" &&
    location.origin === expectedOrigin &&
    location.pathname === expectedPathname &&
    location.searchParams.get("topic") === expectedTopic
  ) {
    pass(`${name} lean Worker redirect`, detail);
  } else {
    fail(`${name} lean Worker redirect`, {
      ...detail,
      expectedLocation: `${expectedPathname}?topic=${expectedTopic}`,
    });
  }
}

function checkStaticAssetDelivery(
  name: string,
  result: FetchResult,
  options: {
    immutable?: boolean;
    allowFreshPublicCache?: boolean;
    allowMissingCacheControl?: boolean;
  } = {},
) {
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
  checkStaticStatus(name, result, 404);
}

function checkExpectedStatus(name: string, result: FetchResult, expectedStatus: number) {
  if (result.status === expectedStatus) {
    pass(`${name} status`, { status: result.status, url: result.url });
  } else {
    fail(`${name} status`, {
      status: result.status,
      expectedStatus,
      url: result.url,
      bodyPreview: result.bodyPreview,
    });
  }
}

function checkStaticStatus(name: string, result: FetchResult, expectedStatus: 404 | 405) {
  if (result.status === expectedStatus) {
    pass(`${name} status`, { status: result.status, url: result.url });
  } else {
    fail(`${name} status`, {
      status: result.status,
      expectedStatus,
      url: result.url,
      bodyPreview: result.bodyPreview,
    });
  }
  checkStaticAssetDelivery(name, result, { allowMissingCacheControl: expectedStatus === 405 });
}

function staticAssetProblems(
  result: FetchResult,
  options: {
    immutable?: boolean;
    allowFreshPublicCache?: boolean;
    allowMissingCacheControl?: boolean;
  } = {},
) {
  const cacheControl = result.headers["cache-control"] ?? "";
  const problems: string[] = [];
  if (result.headers["x-inspir-delivery"] !== "static-assets") {
    problems.push("x-inspir-delivery=static-assets");
  }
  if (/\b(?:private|no-store)\b/i.test(cacheControl)) problems.push("shared-cacheable");
  for (const header of ["x-nextjs-cache", "x-opennext-cache", "x-nextjs-prerender"] as const) {
    if (result.headers[header]) problems.push(`no-${header}`);
  }
  if (options.allowMissingCacheControl && !cacheControl) {
    return problems;
  }
  if (options.immutable) {
    const maxAge = readCacheControlSeconds(cacheControl, "max-age");
    if (maxAge === null || maxAge < 365 * 24 * 60 * 60) problems.push("max-age>=31536000");
    if (!/\bimmutable\b/i.test(cacheControl)) problems.push("immutable");
  } else {
    if (!/\bpublic\b/i.test(cacheControl)) problems.push("public");
    if (!options.allowFreshPublicCache) {
      if (readCacheControlSeconds(cacheControl, "max-age") !== 0) problems.push("max-age=0");
      if (!/\bmust-revalidate\b/i.test(cacheControl)) problems.push("must-revalidate");
    }
  }
  return problems;
}

function isStaticRedirectDelivery(delivery: string | undefined) {
  return delivery === undefined || delivery === "static-assets";
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
  writePrivateJsonDurably(outputPath, report, { replace: pathEntryExists(outputPath) });
  console.log(JSON.stringify(report, null, 2));
  return report.ok;
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
