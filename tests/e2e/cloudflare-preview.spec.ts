import { expect, test, type APIResponse, type Response } from "@playwright/test";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { parseOpenAiSseText } from "../../components/chat/openai-sse";

type ResponseWithHeaders = Pick<APIResponse, "headers"> | Pick<Response, "headers">;

test("production traffic reaches the exact lean Worker version", async ({ request }) => {
  const expectedVersion = process.env.EXPECTED_WORKER_VERSION?.trim();
  test.skip(!expectedVersion, "Worker version pinning is a production-only contract.");

  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-inspir-delivery"]).toBe("lean-api-worker");
  expect(response.headers()["cache-control"] ?? "").toMatch(/private/i);
  expect(response.headers()["cache-control"] ?? "").toMatch(/no-store/i);
  const payload = (await response.json()) as {
    version?: { id?: string };
    architecture?: Record<string, unknown>;
  };
  expect(payload.version?.id).toBe(expectedVersion);
  expect(payload.architecture).toMatchObject({
    deploymentMode: "free-static-lean-guest",
    publicDocuments: "workers-static-assets",
    workerCpuPlan: "free-10ms",
    games: false,
    accounts: false,
    savedState: false,
    openNext: false,
  });
});

test("public, localized, SEO, chat, and topics documents are direct Static Assets", async ({ page, request }) => {
  const home = await page.goto("/");
  expect(home?.status()).toBe(200);
  expectStaticAssetDelivery(home, "/");
  await expect(page).toHaveTitle(/Free AI learning/i);
  await expect(page.locator("body")).toContainText(/learn/i);

  for (const route of [
    "/about",
    "/mission",
    "/schools",
    "/trust",
    "/topics",
    "/learn",
    "/subjects",
    "/blog",
    "/loading",
    "/hi",
    "/chat?topic=learn-anything",
    "/chat?topic=socratic-instruction",
    "/hi/chat?topic=learn-anything",
    "/ar/chat?topic=learn-anything",
  ]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    expectStaticAssetDelivery(response, route);
    expect((await response.text()).length, route).toBeGreaterThan(500);
  }

  for (const [route, fragment] of [
    ["/robots.txt", "User-Agent"],
    ["/sitemap.xml", "<sitemapindex"],
    ["/sitemap/en-US.xml", "<urlset"],
    ["/rss.xml", "<rss"],
  ] as const) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    expectStaticAssetDelivery(response, route);
    expect(await response.text(), route).toContain(fragment);
  }

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expectStaticAssetDelivery(manifest, "/manifest.webmanifest");
  expect(manifest.headers()["content-type"] ?? "").toContain("application/manifest+json");
  expect((await manifest.json()).start_url).toBe("/chat?topic=learn-anything");

  const topics = await request.get("/api/topics");
  expect(topics.status()).toBe(200);
  expectStaticAssetDelivery(topics, "/api/topics", "data");
  const payload = (await topics.json()) as { topics: Array<{ slug?: string }> };
  expect(payload.topics.length).toBeGreaterThan(50);
  expect(payload.topics.some((topic) => topic.slug === "learn-anything")).toBe(true);
  expect(payload.topics.some((topic) => topic.slug === "ai-game-arena")).toBe(false);

  for (const [legacyRoute, expectedPathname, topic] of [
    ["/chat/learn-anything", "/chat", "learn-anything"],
    ["/chat/socratic-instruction", "/chat", "socratic-instruction"],
    ["/hi/chat/learn-anything", "/hi/chat", "learn-anything"],
    ["/ar/chat/learn-anything", "/ar/chat", "learn-anything"],
  ] as const) {
    const response = await request.get(legacyRoute, { maxRedirects: 0 });
    expect(response.status(), legacyRoute).toBe(308);
    expect([undefined, "static-assets"], legacyRoute).toContain(
      response.headers()["x-inspir-delivery"],
    );
    const location = new URL(response.headers().location ?? "/", "http://localhost");
    expect(location.pathname, legacyRoute).toBe(expectedPathname);
    expect(location.searchParams.get("topic"), legacyRoute).toBe(topic);
  }

  const tnc = await request.get("/tnc", { maxRedirects: 0 });
  expect(tnc.status()).toBe(308);
  expect([undefined, "static-assets"]).toContain(tnc.headers()["x-inspir-delivery"]);
  expect(new URL(tnc.headers().location ?? "/", "http://localhost").pathname).toBe("/terms");

  const socialPreview = await request.get("/inspir-social-preview.png");
  expect(socialPreview.status()).toBe(200);
  expectStaticAssetDelivery(socialPreview, "/inspir-social-preview.png", "immutable");
  expect(socialPreview.headers()["content-type"] ?? "").toContain("image/png");
});

test("query topic URLs hydrate once while legacy paths redirect without a Worker", async ({ page }) => {
  const socratic = await page.goto("/chat?topic=socratic-instruction");
  expect(socratic?.status()).toBe(200);
  expectStaticAssetDelivery(socratic, "/chat?topic=socratic-instruction");
  await expect(page.getByRole("textbox", { name: "Concept" })).toBeVisible();
  await expect(page.getByText("Socratic Instruction", { exact: true }).first()).toBeVisible();

  const hindiPlaceholder = translatedMainAppText("Hindi", "What are you curious about today?");
  const hindi = await page.goto("/hi/chat?topic=learn-anything");
  expect(hindi?.status()).toBe(200);
  expectStaticAssetDelivery(hindi, "/hi/chat?topic=learn-anything");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("textarea.inspir-composer-input")).toHaveAttribute("placeholder", hindiPlaceholder);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*follow/i);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /continue with google|sign in/i })).toHaveCount(0);

  const arabic = await page.goto("/ar/chat?topic=learn-anything");
  expect(arabic?.status()).toBe(200);
  expectStaticAssetDelivery(arabic, "/ar/chat?topic=learn-anything");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("guest interactions stay local except for the explicit guest tutor request", async ({ page }) => {
  const apiRequests: string[] = [];
  const rscRequests: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${url.pathname}`);
    }
    if (url.searchParams.has("_rsc") || request.headers().rsc === "1") {
      rscRequests.push(`${url.pathname}${url.search}`);
    }
  });
  await page.route("**/api/guest-chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "text/event-stream; charset=utf-8",
        "x-guest-messages-limit": "10",
        "x-guest-messages-used": "1",
      },
      body: 'data: {"choices":[{"delta":{"content":"Ready to learn."}}]}\n\ndata: [DONE]\n\n',
    });
  });

  const response = await page.goto("/chat?topic=learn-anything");
  expect(response?.status()).toBe(200);
  expectStaticAssetDelivery(response, "/chat?topic=learn-anything");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(page.getByRole("button", { name: /continue with google|sign in/i })).toHaveCount(0);
  await expect(page.getByText(/sign in to|saved chats|create an account/i)).toHaveCount(0);
  await expect(page.getByText("AI Game Arena", { exact: true })).toHaveCount(0);
  await expect(page.locator('a[href^="/games"], a[href*="/games/"], a[href*="ai-game-arena"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Open learning store" }).click();
  await expect(page.getByRole("heading", { name: "Choose what lives in your sidebar." })).toBeVisible();
  await page.getByRole("textbox", { name: "Search learning store" }).fill("Learning Game Master");
  const topicTile = page.locator("article.inspir-store-tile").filter({ hasText: "Learning Game Master" });
  await expect(topicTile).toHaveCount(1);
  const sidebarButton = topicTile.getByRole("button", {
    name: /(?:Add|Remove) Learning Game Master (?:to|from) sidebar/,
  });
  await sidebarButton.click();
  await topicTile.getByRole("button", { name: "Open", exact: true }).click();

  await expect(page).toHaveURL(/\/chat\?topic=learning-game-master$/);
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible();
  await composer.fill("Turn fractions into a short learning quest.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Ready to learn.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset conversation" }).click();
  await expect(page.getByText("Ready to learn.", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(250);

  expect(apiRequests).toContain("GET /api/topics");
  expect(apiRequests).toContain("POST /api/guest-chat");
  expect(
    apiRequests.filter(
      (request) => request !== "GET /api/topics" && request !== "POST /api/guest-chat",
    ),
  ).toEqual([]);
  expect(rscRequests).toEqual([]);
});

test("unknown, private, authenticated, mutating, admin, and game surfaces fail closed in the static router", async ({ request }) => {
  const routes = [
    "/__inspir_static_404_preview_probe",
    "/api/__inspir_static_404_preview_probe",
    "/games",
    "/og",
    "/admin",
    "/reset_pw",
    "/api/auth/get-session",
    "/api/chat",
    "/api/chats",
    "/api/me",
    "/api/memory",
    "/api/admin/topics",
    "/api/migration/write-freeze",
    "/api/site-translations",
    "/api/main-app-translations",
    "/chat/not-a-real-topic",
    "/chat/00000000-0000-4000-8000-000000000000",
    "/chat/learn-anything/deeper",
    "/hi/chat/not-a-real-topic",
    "/hi/mission",
  ];

  for (const route of routes) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(404);
    expectStaticAssetDelivery(response, route);
  }

  for (const route of ["/api/chat", "/api/analytics/events", "/api/logout"]) {
    const response = await request.post(route, { data: {} });
    expect(response.status(), route).toBe(405);
    expectStaticAssetDelivery(response, route, "method-error");
  }
});

test("chat hydration chunks remain immutable Static Assets", async ({ request }) => {
  const document = await request.get("/chat?topic=learn-anything");
  expect(document.status()).toBe(200);
  expectStaticAssetDelivery(document, "/chat?topic=learn-anything");
  const html = await document.text();
  const chunkPaths = Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi), (match) => match[1])
    .filter((source): source is string => typeof source === "string")
    .map((source) => new URL(source, "http://localhost").pathname)
    .filter((pathname) => decodeURIComponent(pathname).includes("/chat/"));

  expect(chunkPaths.length).toBeGreaterThan(0);
  for (const pathname of chunkPaths) {
    const chunk = await request.get(pathname);
    expect(chunk.status(), pathname).toBe(200);
    expect(chunk.headers()["content-type"] ?? "", pathname).toMatch(/(?:java|ecma)script/i);
    expectStaticAssetDelivery(chunk, pathname, "immutable");
  }
});

test("idle static documents never trigger same-origin APIs or RSC requests", async ({ page }) => {
  const dynamicRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(page.url() || "http://localhost:8787").origin) return;
    if (url.pathname.startsWith("/api/") || url.searchParams.has("_rsc") || request.headers().rsc === "1") {
      dynamicRequests.push(`${url.pathname}${url.search}`);
    }
  });

  for (const route of ["/", "/__inspir_idle_static_404_probe"]) {
    dynamicRequests.length = 0;
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(route === "/" ? 200 : 404);
    expectStaticAssetDelivery(response, route);
    await page.waitForTimeout(1_250);
    expect(dynamicRequests, route).toEqual([]);
  }
});

test("guest chat passes through a valid OpenAI stream with server quota headers", async ({ request }) => {
  const response = await request.post("/api/guest-chat", {
    data: {
      topicId: "learn-anything",
      content: "Say hello in one short sentence.",
      preferredLanguage: "English",
      messages: [],
    },
  });
  const body = await response.text();

  if (response.status() !== 200 && process.env.REQUIRE_LIVE_AI !== "1") {
    test.skip(true, "Set REQUIRE_LIVE_AI=1 to make the live provider response a required gate.");
  }

  expect(response.status(), body).toBe(200);
  expect(response.headers()["x-inspir-delivery"]).toBe("lean-api-worker");
  expect(response.headers()["content-type"] ?? "").toContain("text/event-stream");
  expect(response.headers()["cache-control"] ?? "").toMatch(/private/i);
  expect(response.headers()["cache-control"] ?? "").toMatch(/no-store/i);
  const used = Number(response.headers()["x-guest-messages-used"]);
  const limit = Number(response.headers()["x-guest-messages-limit"]);
  expect(Number.isInteger(used)).toBe(true);
  expect(Number.isInteger(limit)).toBe(true);
  expect(used).toBeGreaterThanOrEqual(1);
  expect(limit).toBeGreaterThanOrEqual(used);
  expect(parseOpenAiSseText(body, true).text.trim().length).toBeGreaterThan(0);
});

function expectStaticAssetDelivery(
  response: ResponseWithHeaders | null,
  route: string,
  cache: "document" | "data" | "immutable" | "method-error" = "document",
) {
  expect(response, route).not.toBeNull();
  const headers = response?.headers() ?? {};
  expect(headers["x-inspir-delivery"], route).toBe("static-assets");
  expect(headers["x-nextjs-cache"], route).toBeUndefined();
  expect(headers["x-opennext-cache"], route).toBeUndefined();
  expect(headers["x-nextjs-prerender"], route).toBeUndefined();
  const cacheControl = headers["cache-control"] ?? "";
  expect(cacheControl, route).not.toMatch(/\b(?:private|no-store)\b/i);
  if (cache === "method-error") {
    if (cacheControl) expect(cacheControl, route).toMatch(/\bpublic\b/i);
    return;
  }
  expect(cacheControl, route).toMatch(/\bpublic\b/i);
  if (cache === "immutable") {
    expect(cacheControl, route).toMatch(/\bimmutable\b/i);
    expect(Number(cacheControl.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1]), route).toBeGreaterThanOrEqual(31_536_000);
  } else if (cache === "data") {
    expect(Number(cacheControl.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1]), route).toBeGreaterThanOrEqual(300);
  } else {
    expect(cacheControl, route).toMatch(/(?:^|,)\s*max-age=0(?:,|$)/i);
    expect(cacheControl, route).toMatch(/\bmust-revalidate\b/i);
  }
}

function translatedMainAppText(language: "Hindi", source: string) {
  const bundle = getCuratedMainAppTranslationBundle(language);
  if (!bundle) throw new Error(`Missing curated ${language} main-app bundle.`);
  const entry = Object.entries(bundle.sourceStrings).find(([, candidate]) => candidate === source);
  if (!entry) throw new Error(`Missing main-app source string: ${source}`);
  const translated = bundle.strings[entry[0]];
  if (!translated || translated === source) throw new Error(`Missing ${language} translation for: ${source}`);
  return translated;
}
