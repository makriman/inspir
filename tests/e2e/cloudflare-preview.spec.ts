import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Response,
} from "@playwright/test";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { parseOpenAiSseText } from "../../components/chat/openai-sse";

type ResponseWithHeaders = Pick<APIResponse, "headers"> | Pick<Response, "headers">;

const e2eAuthSecret = process.env.E2E_TEST_AUTH_SECRET ?? "";
const e2eAuthEmail = process.env.E2E_TEST_AUTH_EMAIL ?? "";
const e2eMutationRunId = process.env.E2E_TEST_MUTATION_RUN_ID ?? "";
const e2eCapabilityExpiresAt = process.env.E2E_TEST_AUTH_EXPIRES_AT ?? "";
const expectedWorkerVersion = process.env.EXPECTED_WORKER_VERSION?.trim() ?? "";
const requireAuthenticatedE2E = process.env.REQUIRE_AUTHENTICATED_E2E === "1";
const e2eAuthConfigured =
  new TextEncoder().encode(e2eAuthSecret).byteLength >= 32 &&
  /^[\x21-\x7e]+$/.test(e2eAuthSecret) &&
  e2eAuthEmail === e2eAuthEmail.trim() &&
  e2eAuthEmail === e2eAuthEmail.toLowerCase() &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e2eAuthEmail);
const requireLiveAi = process.env.REQUIRE_LIVE_AI === "1";
const productionE2eReadOnly = process.env.PRODUCTION_E2E_READ_ONLY === "1";
const productionE2eBindingConfigured =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    e2eMutationRunId,
  ) &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    expectedWorkerVersion,
  ) &&
  /^[1-9][0-9]{0,15}$/.test(e2eCapabilityExpiresAt);
const resolvedPlaywrightOrigin = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8787",
).origin;
const productionOrigin = new URL("https://inspirlearning.com/").origin;
const productionOrigins = new Set([
  productionOrigin,
  new URL("https://www.inspirlearning.com/").origin,
]);

if (productionOrigins.has(resolvedPlaywrightOrigin) && !productionE2eReadOnly) {
  throw new Error(
    "Refusing to load production Playwright tests unless PRODUCTION_E2E_READ_ONLY=1.",
  );
}

if (requireAuthenticatedE2E && !e2eAuthConfigured) {
  throw new Error(
    "Production E2E requires an exact lowercase E2E_TEST_AUTH_EMAIL and an E2E_TEST_AUTH_SECRET of at least 32 UTF-8 bytes.",
  );
}

if (requireAuthenticatedE2E && productionE2eReadOnly && !productionE2eBindingConfigured) {
  throw new Error(
    "Production E2E requires E2E_TEST_MUTATION_RUN_ID, E2E_TEST_AUTH_EXPIRES_AT, and EXPECTED_WORKER_VERSION binding.",
  );
}

test.beforeEach(async ({ page }) => {
  if (!productionE2eReadOnly) return;
  await page.route("**/api/analytics/events", async (route) => {
    await route.fulfill({
      status: 204,
      headers: { "cache-control": "private, no-store" },
      body: "",
    });
  });
});

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
    deploymentMode: "free-static-native-accounts",
    publicDocuments: "workers-static-assets",
    workerCpuPlan: "free-10ms",
    games: false,
    accounts: true,
    savedState: true,
    memory: true,
    admin: true,
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
    "/hi/mission",
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

  const icon = await request.get("/icon.png");
  expect(icon.status()).toBe(200);
  expectStaticAssetDelivery(icon, "/icon.png");
  expect(icon.headers()["content-type"] ?? "").toContain("image/png");
  expect((await icon.body()).byteLength).toBeGreaterThan(100);

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
    expect(response.headers()["x-inspir-delivery"], legacyRoute).toBe("lean-api-worker");
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

test("query topic URLs hydrate once while legacy paths use the lean redirect router", async ({ page }) => {
  const socratic = await page.goto("/chat?topic=socratic-instruction");
  expect(socratic?.status()).toBe(200);
  expectStaticAssetDelivery(socratic, "/chat?topic=socratic-instruction");
  await expect(page.getByRole("textbox", { name: "Concept" })).toBeVisible();
  await expect(page.getByText("Socratic Instruction", { exact: true }).first()).toBeVisible();

  const hindiPlaceholder = translatedMainAppText("Hindi", "What are you curious about today?");
  const hindiSignIn = translatedMainAppText("Hindi", "Continue with Google");
  const hindi = await page.goto("/hi/chat?topic=learn-anything");
  expect(hindi?.status()).toBe(200);
  expectStaticAssetDelivery(hindi, "/hi/chat?topic=learn-anything");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("textarea.inspir-composer-input")).toHaveAttribute("placeholder", hindiPlaceholder);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*follow/i);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: hindiSignIn, exact: true }).first()).toBeVisible();

  const arabic = await page.goto("/ar/chat?topic=learn-anything");
  expect(arabic?.status()).toBe(200);
  expectStaticAssetDelivery(arabic, "/ar/chat?topic=learn-anything");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("account failures are visible and never resemble an empty lost chat", async ({ page }) => {
  await page.goto("/chat?topic=learn-anything&error=oauth_callback_failed");
  await expect(page.locator(".inspir-auth-error-notice")).toHaveAttribute("role", "alert");
  await expect(page.locator(".inspir-auth-error-notice")).toContainText(/could not sign you in/i);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();

  await page.route("**/api/auth/sign-in/social", async (route) => {
    await route.fulfill({
      status: 503,
      headers: { "cache-control": "private, no-store", "content-type": "application/json" },
      body: JSON.stringify({ error: "temporarily unavailable" }),
    });
  });
  await page.getByRole("button", { name: /continue with google|sign in/i }).first().click();
  await expect(page.locator(".google-auth-error").first()).toHaveAttribute("role", "alert");
  await expect(page.locator(".google-auth-error").first()).toContainText(/could not sign you in/i);
  await page.unroute("**/api/auth/sign-in/social");

  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 503,
      headers: { "cache-control": "private, no-store", "content-type": "application/json" },
      body: JSON.stringify({ error: "temporarily unavailable" }),
    });
  });
  await page.goto("/chat?topic=learn-anything&bootstrap_failure_probe=1");
  const failure = page.locator(".inspir-bootstrap-error");
  await expect(failure).toHaveAttribute("role", "alert");
  await expect(failure).toContainText(/saved data has not been changed/i);
  await expect(failure.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.locator(".inspir-workspace")).toHaveAttribute("data-bootstrap-load", "failed");
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
  await expect(page.getByRole("button", { name: /continue with google|sign in/i }).first()).toBeVisible();
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
  expect(apiRequests).toContain("GET /api/me");
  expect(apiRequests).toContain("POST /api/guest-chat");
  expect(
    apiRequests.filter(
      (request) =>
        request !== "GET /api/topics" &&
        request !== "GET /api/me" &&
        request !== "POST /api/analytics/events" &&
        request !== "POST /api/guest-chat",
    ),
  ).toEqual([]);
  expect(rscRequests).toEqual([]);
});

test("removed games stay closed while legacy i18n and signed-out account contracts work", async ({ request }) => {
  const staticNotFoundRoutes = [
    "/__inspir_static_404_preview_probe",
    "/api/__inspir_static_404_preview_probe",
    "/games",
    "/og",
  ];

  for (const route of staticNotFoundRoutes) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(404);
    expectStaticAssetDelivery(response, route);
  }

  const languagePreference = await request.post("/api/language-preference", {
    data: { language: "Hindi", pathname: "/mission" },
  });
  expect(languagePreference.status()).toBe(200);
  expectLeanWorkerDelivery(languagePreference, "/api/language-preference");
  expect(await languagePreference.json()).toEqual({
    language: "Hindi",
    redirectTo: "/hi/mission",
  });
  expect(languagePreference.headers()["set-cookie"]).toContain("inspir_locale=Hindi");

  const mainAppTranslations = await request.get(
    "/api/main-app-translations?language=English",
  );
  expect(mainAppTranslations.status()).toBe(200);
  expectLeanWorkerDelivery(mainAppTranslations, "/api/main-app-translations", "public");
  expect(mainAppTranslations.headers()["cache-control"]).toContain("public");
  expect(await mainAppTranslations.json()).toMatchObject({
    bundle: { namespace: "main-app", language: "English" },
    complete: true,
  });

  const siteTranslations = await request.get(
    "/api/site-translations?language=English&namespace=route%3Ahome",
  );
  expect(siteTranslations.status()).toBe(200);
  expectLeanWorkerDelivery(siteTranslations, "/api/site-translations", "public");
  expect(siteTranslations.headers()["cache-control"]).toContain("public");
  expect(await siteTranslations.json()).toMatchObject({
    bundle: { namespace: "route:home", language: "English" },
    complete: true,
  });

  const writeFreeze = await request.get("/api/migration/write-freeze");
  expect(writeFreeze.status()).toBe(409);
  expectLeanWorkerDelivery(writeFreeze, "/api/migration/write-freeze");
  expect(await writeFreeze.json()).toEqual({
    ok: false,
    writeFreezeActive: false,
    code: "write_freeze_inactive",
    versionId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  });

  const accountRecovery = await request.get("/reset_pw");
  expect(accountRecovery.status()).toBe(200);
  expectStaticAssetDelivery(accountRecovery, "/reset_pw");
  expect(await accountRecovery.text()).toMatch(/no inspir password to reset/i);

  const admin = await request.get("/admin");
  expect(admin.status()).toBe(200);
  expectStaticAssetDelivery(admin, "/admin");

  const authSession = await request.get("/api/auth/get-session");
  expect(authSession.status()).toBe(200);
  expectLeanWorkerDelivery(authSession, "/api/auth/get-session");

  for (const route of [
    "/api/chat",
    "/api/chat/finalize",
    "/api/chats",
    "/api/me",
    "/api/memory",
    "/api/account/topics",
    "/api/activities/quiz",
    "/api/admin/topics",
  ]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(401);
    expectLeanWorkerDelivery(response, route);
  }

  for (const route of [
    "/chat/not-a-real-topic",
    "/chat/learn-anything/deeper",
    "/hi/chat/not-a-real-topic",
    "/toString/chat/learn-anything",
  ]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(404);
    expectLeanWorkerDelivery(response, route);
  }

  const savedChatShell = await request.get("/chat/00000000-0000-4000-8000-000000000000");
  expect(savedChatShell.status()).toBe(200);
  expectLeanWorkerDelivery(savedChatShell, "saved chat shell");
  expect((await savedChatShell.text()).length).toBeGreaterThan(500);

  const chatMutation = await request.post("/api/chat", {
    data: {},
    headers: { accept: "text/event-stream" },
  });
  expect(chatMutation.status()).toBe(401);
  expectLeanWorkerDelivery(chatMutation, "/api/chat POST");

  const logout = await request.post("/api/logout", { data: {} });
  expect(logout.status()).toBe(204);
  expectLeanWorkerDelivery(logout, "/api/logout");
});

test("production validation reads preserved account data without mutating the learner", async ({ page }) => {
  test.skip(!productionE2eReadOnly, "This preservation gate runs only against production.");
  test.skip(!e2eAuthConfigured, "Set E2E_TEST_AUTH_SECRET and E2E_TEST_AUTH_EMAIL to run authenticated E2E.");
  test.setTimeout(120_000);
  const request = page.request;
  let authAttempted = false;

  try {
    authAttempted = true;
    const authUser = await authenticateMigrationE2E(request);
    expect(authUser.email).toBe(e2eAuthEmail);
    expect(authUser.isAdmin, "E2E_TEST_AUTH_EMAIL must be an existing configured admin").toBe(true);

    const me = await request.get("/api/me");
    expect(me.status()).toBe(200);
    expectLeanWorkerDelivery(me, "/api/me production read-only");
    const profile = requiredRecord(
      (await readJsonRecord(me, "/api/me production read-only")).user,
      "/api/me production user",
    );
    expect(profile.email).toBe(e2eAuthEmail);
    expect(requiredNonNegativeInteger(profile.score, "production user score")).toBeGreaterThanOrEqual(0);

    const topicsResponse = await request.get("/api/account/topics");
    expect(topicsResponse.status()).toBe(200);
    expectLeanWorkerDelivery(topicsResponse, "/api/account/topics production read-only");
    const topics = requiredArray(
      (await readJsonRecord(topicsResponse, "/api/account/topics production read-only")).topics,
      "production account topics",
    );
    expect(topics.length).toBeGreaterThan(50);
    expect(
      topics.some((value) => optionalRecord(value)?.slug === "learn-anything"),
      "production account learn-anything topic",
    ).toBe(true);

    const chatsResponse = await request.get("/api/chats");
    expect(chatsResponse.status()).toBe(200);
    expectLeanWorkerDelivery(chatsResponse, "/api/chats production read-only");
    const chatsPayload = await readJsonRecord(chatsResponse, "/api/chats production read-only");
    const chats = requiredArray(chatsPayload.chats, "production saved chats");
    const firstChat = optionalRecord(chats[0]);
    if (firstChat && typeof firstChat.id === "string") {
      const chatResponse = await request.get(`/api/chats/${encodeURIComponent(firstChat.id)}`);
      expect(chatResponse.status()).toBe(200);
      expectLeanWorkerDelivery(chatResponse, "/api/chats/:id production read-only");
      expect(requiredRecord(
        (await readJsonRecord(chatResponse, "/api/chats/:id production read-only")).chat,
        "production saved chat",
      ).id).toBe(firstChat.id);
    }

    const memoryResponse = await request.get("/api/memory");
    expect(memoryResponse.status()).toBe(200);
    expectLeanWorkerDelivery(memoryResponse, "/api/memory production read-only");
    const memory = await readJsonRecord(memoryResponse, "/api/memory production read-only");
    requiredRecord(memory.settings, "production memory settings");
    requiredRecord(memory.memoryPage, "production memory page");
    requiredArray(memory.memories, "production memories");

    const adminResponse = await request.get("/api/admin/dashboard?days=7");
    expect(adminResponse.status()).toBe(200);
    expectLeanWorkerDelivery(adminResponse, "/api/admin/dashboard production read-only");
    const adminPayload = await readJsonRecord(adminResponse, "/api/admin/dashboard production read-only");
    expect(requiredRecord(adminPayload.user, "production admin user").email).toBe(e2eAuthEmail);
    const totals = requiredRecord(
      requiredRecord(adminPayload.dashboard, "production admin dashboard").totals,
      "production admin totals",
    );
    for (const key of ["users", "chats", "messages", "aiRuns"] as const) {
      expect(requiredNonNegativeInteger(totals[key], `production admin ${key}`)).toBeGreaterThanOrEqual(0);
    }

  } finally {
    // APIRequestContext retains Set-Cookie even when response validation throws.
    // Always prove the temporary D1 session was deleted after the auth request,
    // including malformed or non-admin 200 responses.
    if (authAttempted) {
      const logout = await request.post("/api/logout");
      expect(logout.status()).toBe(204);
      expect(["deleted", "absent", "not-present"]).toContain(
        logout.headers()["x-inspir-session-cleanup"],
      );
      await cleanupProductionExistingValidationSession(request);
      const signedOut = await request.get("/api/auth/get-session?disableRefresh=true");
      expect(signedOut.status()).toBe(200);
      expectLeanWorkerDelivery(signedOut, "production session cleanup readback");
      expect(await signedOut.text()).toBe("null");
    }
  }
});

test("configured native session preserves account, saved chat, memory, topics, and admin contracts", async ({
  page,
}) => {
  test.skip(!e2eAuthConfigured, "Set E2E_TEST_AUTH_SECRET and E2E_TEST_AUTH_EMAIL to run authenticated E2E.");
  test.skip(productionE2eReadOnly, "Production validation exercises these contracts through the read-only account test.");
  test.setTimeout(120_000);
  const request = page.request;

  const nonce = e2eNonce();
  let chatId: string | null = null;
  let memoryId: string | null = null;
  let originalProfile: ProfileSnapshot | null = null;
  let originalMemorySettings: MemorySettingsSnapshot | null = null;
  let authenticated = false;
  const uiMemoryCleanupContents: string[] = [];

  try {
    const authUser = await authenticateMigrationE2E(request);
    authenticated = true;
    expect(authUser.email).toBe(e2eAuthEmail);
    expect(authUser.isAdmin, "E2E_TEST_AUTH_EMAIL must be a configured or bootstrap admin").toBe(true);

    const me = await request.get("/api/me");
    expect(me.status()).toBe(200);
    expectLeanWorkerDelivery(me, "/api/me authenticated");
    const profile = requiredRecord((await readJsonRecord(me, "/api/me")).user, "/api/me user");
    expect(profile.email).toBe(e2eAuthEmail);
    originalProfile = profileSnapshot(profile);

    const updatedName = `Inspir E2E ${nonce}`;
    const updatedLanguage = originalProfile.preferredLanguage === "Hindi" ? "English" : "Hindi";
    const profileUpdate = await request.patch("/api/me", {
      data: { name: updatedName, preferredLanguage: updatedLanguage },
    });
    expect(profileUpdate.status()).toBe(200);
    expectLeanWorkerDelivery(profileUpdate, "/api/me PATCH");
    const updatedProfile = requiredRecord(
      (await readJsonRecord(profileUpdate, "/api/me PATCH")).user,
      "/api/me PATCH user",
    );
    expect(updatedProfile).toMatchObject({
      email: e2eAuthEmail,
      name: updatedName,
      preferredLanguage: updatedLanguage,
    });

    const topicsResponse = await request.get("/api/account/topics");
    expect(topicsResponse.status()).toBe(200);
    expectLeanWorkerDelivery(topicsResponse, "/api/account/topics");
    const topics = requiredArray(
      (await readJsonRecord(topicsResponse, "/api/account/topics")).topics,
      "/api/account/topics topics",
    );
    expect(topics.length).toBeGreaterThan(50);
    const topicSlugs = new Set(
      topics.flatMap((value) => {
        const topic = optionalRecord(value);
        return topic && typeof topic.slug === "string" ? [topic.slug] : [];
      }),
    );
    for (const slug of ["learn-anything", "quiz-me-on-trivia", "flashcard-builder"]) {
      expect(topicSlugs.has(slug), `account topic ${slug}`).toBe(true);
    }

    chatId = await createOwnedChat(request, "learn-anything");
    const chatsResponse = await request.get("/api/chats?topicId=learn-anything");
    expect(chatsResponse.status()).toBe(200);
    expectLeanWorkerDelivery(chatsResponse, "/api/chats list");
    const chats = requiredArray(
      (await readJsonRecord(chatsResponse, "/api/chats list")).chats,
      "/api/chats list chats",
    );
    expect(chats.some((value) => optionalRecord(value)?.id === chatId)).toBe(true);

    const chatResponse = await request.get(`/api/chats/${chatId}`);
    expect(chatResponse.status()).toBe(200);
    expectLeanWorkerDelivery(chatResponse, "/api/chats/:id GET");
    const savedChat = await readJsonRecord(chatResponse, "/api/chats/:id GET");
    expect(requiredRecord(savedChat.chat, "saved chat").id).toBe(chatId);
    expect(requiredRecord(savedChat.topic, "saved chat topic").slug).toBe("learn-anything");
    expect(requiredArray(savedChat.messages, "saved chat messages")).toEqual([]);
    expect(requiredRecord(savedChat.messagePage, "saved chat message page")).toMatchObject({
      hasMore: false,
      nextCursor: null,
      limit: 30,
    });
    expect(savedChat.activityRun).toBeNull();

    const savedChatShell = await request.get(`/chat/${chatId}`);
    expect(savedChatShell.status()).toBe(200);
    expectLeanWorkerDelivery(savedChatShell, "authenticated saved-chat shell");
    expect(savedChatShell.headers()["content-type"] ?? "").toContain("text/html");
    expect((await savedChatShell.text()).length).toBeGreaterThan(500);

    const memoryResponse = await request.get("/api/memory");
    expect(memoryResponse.status()).toBe(200);
    expectLeanWorkerDelivery(memoryResponse, "/api/memory GET");
    const initialMemory = await readJsonRecord(memoryResponse, "/api/memory GET");
    expect(requiredRecord(initialMemory.memoryPage, "/api/memory page")).toMatchObject({ limit: 50 });
    originalMemorySettings = memorySettingsSnapshot(
      requiredRecord(initialMemory.settings, "/api/memory settings"),
    );

    const nextMemorySettings: MemorySettingsSnapshot = {
      enabled: true,
      savedMemoryEnabled: true,
      chatHistoryEnabled: originalMemorySettings.chatHistoryEnabled,
      dreamingEnabled: !originalMemorySettings.dreamingEnabled,
    };
    const settingsUpdate = await request.patch("/api/memory", { data: nextMemorySettings });
    expect(settingsUpdate.status()).toBe(200);
    expectLeanWorkerDelivery(settingsUpdate, "/api/memory PATCH");
    expect(
      memorySettingsSnapshot(
        requiredRecord(
          (await readJsonRecord(settingsUpdate, "/api/memory PATCH")).settings,
          "/api/memory PATCH settings",
        ),
      ),
    ).toEqual(nextMemorySettings);

    const initialMemoryContent = `E2E learning preference ${nonce}: use compact worked examples.`;
    const memoryCreate = await request.post("/api/memory", {
      data: { category: "preferences", content: initialMemoryContent },
    });
    expect(memoryCreate.status()).toBe(201);
    expectLeanWorkerDelivery(memoryCreate, "/api/memory POST");
    const createdPayload = await readJsonRecord(memoryCreate, "/api/memory POST");
    const createdMemory = requiredRecord(createdPayload.memory, "created memory");
    expect(createdMemory.content).toBe(initialMemoryContent);
    memoryId = requiredString(createdMemory.id, "created memory id");
    expect(createdMemory).toMatchObject({
      category: "preferences",
      content: initialMemoryContent,
      pinned: true,
      sourceType: "manual",
    });

    const updatedMemoryContent = `E2E learning goal ${nonce}: verify each answer with one example.`;
    const memoryUpdate = await request.patch(`/api/memory/${memoryId}`, {
      data: {
        category: "goals",
        content: updatedMemoryContent,
        tags: ["e2e", "verification"],
        pinned: false,
        doNotMention: false,
      },
    });
    expect(memoryUpdate.status()).toBe(200);
    expectLeanWorkerDelivery(memoryUpdate, "/api/memory/:id PATCH");
    const updatedMemory = requiredRecord(
      (await readJsonRecord(memoryUpdate, "/api/memory/:id PATCH")).memory,
      "updated memory",
    );
    expect(updatedMemory).toMatchObject({
      id: memoryId,
      category: "goals",
      content: updatedMemoryContent,
      pinned: false,
      doNotMention: false,
    });
    expect(requiredArray(updatedMemory.tags, "updated memory tags")).toEqual(
      expect.arrayContaining(["e2e", "verification", "manual"]),
    );

    const feedback = await request.post("/api/memory/source-feedback", {
      data: {
        memoryId,
        action: "relevant",
        note: `Authenticated E2E verification ${nonce}`,
      },
    });
    expect(feedback.status()).toBe(200);
    expectLeanWorkerDelivery(feedback, "/api/memory/source-feedback");
    expect(await readJsonRecord(feedback, "/api/memory/source-feedback")).toEqual({ ok: true });

    const memoryList = await request.get("/api/memory");
    expect(memoryList.status()).toBe(200);
    const listedMemory = findMemoryByContent(
      await readJsonRecord(memoryList, "/api/memory final GET"),
      updatedMemoryContent,
    );
    expect(listedMemory.id).toBe(memoryId);

    const admin = await request.get("/api/admin/dashboard?days=7");
    expect(admin.status()).toBe(200);
    expectLeanWorkerDelivery(admin, "/api/admin/dashboard");
    const adminPayload = await readJsonRecord(admin, "/api/admin/dashboard");
    expect(requiredRecord(adminPayload.user, "admin user").email).toBe(e2eAuthEmail);
    const totals = requiredRecord(
      requiredRecord(adminPayload.dashboard, "admin dashboard").totals,
      "admin totals",
    );
    for (const key of ["users", "chats", "messages", "aiRuns"] as const) {
      expect(requiredNonNegativeInteger(totals[key], `admin totals ${key}`)).toBeGreaterThanOrEqual(0);
    }
    const snapshotUpdatedAt = requiredNonNegativeInteger(
      totals.snapshotUpdatedAt,
      "admin totals snapshotUpdatedAt",
    );
    expect(snapshotUpdatedAt).toBeGreaterThan(0);
    expect(snapshotUpdatedAt).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1_000);
    if (process.env.EXPECTED_WORKER_VERSION?.trim()) {
      expect(requiredNonNegativeInteger(totals.users, "production admin totals users")).toBeGreaterThan(0);
      expect(Date.now() - snapshotUpdatedAt).toBeLessThanOrEqual(48 * 60 * 60 * 1_000);
    }
    expect(requiredArray(adminPayload.admins, "admin list").length).toBeGreaterThan(0);

    const savedShellNavigation = await page.goto(`/chat/${chatId}`);
    expect(savedShellNavigation?.status()).toBe(200);
    expectLeanWorkerDelivery(savedShellNavigation, "authenticated saved-chat browser navigation");
    await expect(page.locator(".inspir-chat-root")).toBeVisible();
    await expect(page.locator(".inspir-sidebar .inspir-avatar-button")).toBeVisible();
    await expect(page.locator(".inspir-guest-auth-button")).toHaveCount(0);
    await expect(page.locator(".inspir-workspace")).not.toBeEmpty();
    if (originalProfile.dateOfBirth === null) {
      const agePrompt = page.locator(".inspir-age-modal");
      await expect(agePrompt).toBeVisible();
      await agePrompt.locator(".inspir-guest-modal-secondary").click();
      await expect(agePrompt).toHaveCount(0);
    }
    await page.locator(".inspir-sidebar .inspir-avatar-button").click();
    await expect(page.locator(".inspir-profile-panel")).toBeVisible();
    await expect(page.locator('.inspir-profile-details-form input[readonly]')).toHaveValue(e2eAuthEmail);
    await expect(page.getByText(updatedMemoryContent, { exact: true })).toBeVisible();

    const uiMemoryContent = `E2E compact UI memory ${nonce}`;
    const uiUpdatedMemoryContent = `${uiMemoryContent} updated`;
    uiMemoryCleanupContents.push(uiMemoryContent, uiUpdatedMemoryContent);
    await page.locator(".inspir-memory-summary-actions button").first().click();
    await page.locator(".inspir-memory-add textarea").fill(uiMemoryContent);
    await page.locator(".inspir-memory-add-actions button").first().click();
    const createdUiMemory = page.locator("article.inspir-memory-item").filter({ hasText: uiMemoryContent });
    await expect(createdUiMemory).toHaveCount(1);
    await createdUiMemory.locator(".inspir-memory-actions button").first().click();
    await createdUiMemory.locator("textarea.inspir-memory-edit").fill(uiUpdatedMemoryContent);
    await createdUiMemory.locator(".inspir-memory-actions button").first().click();
    const updatedUiMemory = page.locator("article.inspir-memory-item").filter({ hasText: uiUpdatedMemoryContent });
    await expect(updatedUiMemory).toHaveCount(1);
    await updatedUiMemory.locator(".inspir-memory-actions button").nth(2).click();
    await expect(page.getByText(uiUpdatedMemoryContent, { exact: true })).toHaveCount(0);

    const memoryDelete = await request.delete(`/api/memory/${memoryId}`);
    expect(memoryDelete.status()).toBe(200);
    expectLeanWorkerDelivery(memoryDelete, "/api/memory/:id DELETE");
    expect(await readJsonRecord(memoryDelete, "/api/memory/:id DELETE")).toEqual({ ok: true });
    memoryId = null;
    const memoryAfterDelete = await request.get("/api/memory");
    expect(memoryAfterDelete.status()).toBe(200);
    expect(
      requiredArray(
        (await readJsonRecord(memoryAfterDelete, "/api/memory after DELETE")).memories,
        "/api/memory after DELETE memories",
      ).some((value) => optionalRecord(value)?.content === updatedMemoryContent),
    ).toBe(false);

    await restoreMemorySettings(request, originalMemorySettings);
    originalMemorySettings = null;
    await deleteChatAndAssertGone(request, chatId);
    chatId = null;
    await restoreProfile(request, originalProfile);
    originalProfile = null;

    const logout = await request.post("/api/logout");
    expect(logout.status()).toBe(204);
    expectLeanWorkerDelivery(logout, "/api/logout authenticated");
    authenticated = false;
    const meAfterLogout = await request.get("/api/me");
    expect(meAfterLogout.status()).toBe(401);
    expectLeanWorkerDelivery(meAfterLogout, "/api/me after logout");
  } finally {
    if (authenticated && uiMemoryCleanupContents.length > 0) {
      await deleteMemoriesByContent(request, uiMemoryCleanupContents).catch(() => undefined);
    }
    if (memoryId) await request.delete(`/api/memory/${memoryId}`).catch(() => undefined);
    if (originalMemorySettings) await restoreMemorySettings(request, originalMemorySettings).catch(() => undefined);
    if (chatId) await request.delete(`/api/chats/${chatId}`).catch(() => undefined);
    if (originalProfile) await restoreProfile(request, originalProfile).catch(() => undefined);
    if (authenticated) await request.post("/api/logout").catch(() => undefined);
  }
});

test("authenticated tutor uses saved memory and recalls an earlier chat without changing consent", async ({ page }) => {
  test.skip(!e2eAuthConfigured, "Set E2E_TEST_AUTH_SECRET and E2E_TEST_AUTH_EMAIL to run authenticated E2E.");
  test.skip(productionE2eReadOnly, "Production validation must not create learner memories, messages, or chats.");
  test.setTimeout(240_000);
  const request = page.request;
  const nonce = e2eNonce();
  const manualToken = `MANUAL-${nonce}`;
  const historyToken = `HISTORY-${nonce}`;
  const memoryContent = `Use concise two-step examples. The manual verification token is ${manualToken}.`;
  const chatIds: string[] = [];
  let memoryId: string | null = null;
  let originalSettings: MemorySettingsSnapshot | null = null;
  let authenticated = false;

  try {
    const authUser = await authenticateMigrationE2E(request);
    authenticated = true;
    expect(authUser.email).toBe(e2eAuthEmail);
    expect(authUser.isAdmin, "E2E_TEST_AUTH_EMAIL must be a configured or bootstrap admin").toBe(true);

    const memoryDashboard = await request.get("/api/memory");
    expect(memoryDashboard.status()).toBe(200);
    originalSettings = memorySettingsSnapshot(
      requiredRecord(
        (await readJsonRecord(memoryDashboard, "/api/memory before tutor memory test")).settings,
        "memory settings before tutor memory test",
      ),
    );
    if (!originalSettings.chatHistoryEnabled) {
      test.skip(true, "Cross-chat recall is skipped because production validation never changes disabled history consent.");
      return;
    }
    await setMemorySettings(request, {
      ...originalSettings,
      enabled: true,
      savedMemoryEnabled: true,
    });

    const memoryCreate = await request.post("/api/memory", {
      data: { category: "preferences", content: memoryContent },
    });
    expect(memoryCreate.status(), await errorBody(memoryCreate)).toBe(201);
    const createdMemory = requiredRecord(
      (await readJsonRecord(memoryCreate, "/api/memory tutor memory POST")).memory,
      "tutor memory",
    );
    memoryId = requiredString(createdMemory.id, "tutor memory id");

    const earlierChatId = await createOwnedChat(request, "learn-anything");
    chatIds.push(earlierChatId);
    const savedMemoryResponse = await request.post("/api/chat", {
      headers: { accept: "text/event-stream" },
      data: {
        chatId: earlierChatId,
        content: "Apply my saved study preference and include its exact manual verification token.",
      },
      timeout: 60_000,
    });
    const savedMemoryBody = await savedMemoryResponse.text();
    if (savedMemoryResponse.status() !== 200 && !requireLiveAi) {
      test.skip(
        true,
        `Authenticated tutor unavailable in this environment (${savedMemoryResponse.status()}: ${savedMemoryBody.slice(0, 240)}).`,
      );
      return;
    }
    expect(savedMemoryResponse.status(), savedMemoryBody).toBe(200);
    expectLeanWorkerDelivery(savedMemoryResponse, "/api/chat saved-memory use");
    const savedMemorySources = memorySourcesFromResponse(savedMemoryResponse);
    expect(
      savedMemorySources.some((source) => source.type === "memory" && source.memoryId === memoryId),
      "manual memory source header",
    ).toBe(true);
    expect(parseOpenAiSseText(savedMemoryBody, true).text).toContain(manualToken);
    await finalizeAuthenticatedSse(request, savedMemoryResponse, earlierChatId, savedMemoryBody);

    const historySeedResponse = await request.post("/api/chat", {
      headers: { accept: "text/event-stream" },
      data: {
        chatId: earlierChatId,
        content: `This conversation's temporary comet code is ${historyToken}. Echo the exact code once.`,
      },
      timeout: 60_000,
    });
    const historySeedBody = await historySeedResponse.text();
    expect(historySeedResponse.status(), historySeedBody).toBe(200);
    expect(parseOpenAiSseText(historySeedBody, true).text).toContain(historyToken);
    await finalizeAuthenticatedSse(request, historySeedResponse, earlierChatId, historySeedBody);

    await expect
      .poll(
        async () => {
          const detail = await request.get(`/api/chats/${earlierChatId}`);
          if (detail.status() !== 200) return 0;
          const payload = await readJsonRecord(detail, "earlier chat persistence poll");
          return requiredArray(payload.messages, "earlier chat messages").length;
        },
        { timeout: 20_000, intervals: [500, 1_000, 2_000] },
      )
      .toBeGreaterThanOrEqual(4);

    // The production queue consumer has a 10-second maximum batch timeout.
    await page.waitForTimeout(12_000);
    const laterChatId = await createOwnedChat(request, "learn-anything");
    chatIds.push(laterChatId);
    const recallResponse = await request.post("/api/chat", {
      headers: { accept: "text/event-stream" },
      data: {
        chatId: laterChatId,
        content: "What exact temporary comet code did I give you in our earlier conversation?",
      },
      timeout: 60_000,
    });
    const recallBody = await recallResponse.text();
    expect(recallResponse.status(), recallBody).toBe(200);
    const recallSources = memorySourcesFromResponse(recallResponse);
    expect(recallSources.some((source) => source.type === "past_chat"), "past-chat source header").toBe(true);
    expect(parseOpenAiSseText(recallBody, true).text).toContain(historyToken);
    await finalizeAuthenticatedSse(request, recallResponse, laterChatId, recallBody);

    await expect
      .poll(
        async () => {
          const detail = await request.get(`/api/chats/${laterChatId}`);
          if (detail.status() !== 200) return false;
          const payload = await readJsonRecord(detail, "later saved chat persistence poll");
          return requiredArray(payload.messages, "later saved chat messages").some((value) => {
            const message = optionalRecord(value);
            return typeof message?.content === "string" && message.content.includes(historyToken);
          });
        },
        { timeout: 20_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(true);
    await page.goto(`/chat/${laterChatId}`);
    await expect(page.locator(".inspir-chat-root")).toBeVisible();
    await expect(page.locator(".inspir-guest-auth-button")).toHaveCount(0);
    await expect(page.locator(".inspir-message-content").filter({ hasText: historyToken })).toBeVisible();
  } finally {
    for (const chatId of [...chatIds].reverse()) {
      await request.delete(`/api/chats/${chatId}`).catch(() => undefined);
    }
    if (memoryId) await request.delete(`/api/memory/${memoryId}`).catch(() => undefined);
    if (originalSettings) await restoreMemorySettings(request, originalSettings).catch(() => undefined);
    if (authenticated) await request.post("/api/logout").catch(() => undefined);
  }
});

test("configured native quiz reaches a complete, answer-revealing result", async ({ page }) => {
  test.skip(!e2eAuthConfigured, "Set E2E_TEST_AUTH_SECRET and E2E_TEST_AUTH_EMAIL to run authenticated E2E.");
  test.skip(productionE2eReadOnly, "Production validation must not change an existing learner's score.");
  test.setTimeout(150_000);
  const request = page.request;
  await authenticateMigrationE2E(request);
  let chatId: string | null = null;

  try {
    chatId = await createOwnedChat(request, "quiz-me-on-trivia");
    const build = await request.post("/api/activities/quiz", {
      data: { chatId, topic: `Solar system fundamentals ${e2eNonce()}` },
      timeout: 60_000,
    });
    if (build.status() !== 200) {
      const body = await build.text();
      if (!requireLiveAi) {
        await deleteChatAndAssertGone(request, chatId);
        chatId = null;
        await request.post("/api/logout");
        test.skip(true, `Quiz provider unavailable in this environment (${build.status()}: ${body.slice(0, 240)}).`);
        return;
      }
      expect(build.status(), body).toBe(200);
    }
    expectLeanWorkerDelivery(build, "/api/activities/quiz");
    let activity = activityRunFromResponse(await readJsonRecord(build, "/api/activities/quiz"), "quiz");
    const activityId = requiredString(activity.id, "quiz activity id");
    let state = requiredRecord(activity.state, "quiz state");
    expect(state).toMatchObject({ currentIndex: 0, score: 0, maxScore: 10, completed: false });
    const initialQuestions = requiredArray(state.questions, "quiz questions");
    expect(initialQuestions).toHaveLength(10);
    for (const value of initialQuestions) {
      const question = requiredRecord(value, "initial quiz question");
      expect(requiredString(question.prompt, "quiz prompt").length).toBeGreaterThan(0);
      expect(requiredArray(question.options, "quiz options")).toHaveLength(4);
      expect(question.correctIndex).toBeUndefined();
      expect(question.explanation).toBeUndefined();
    }

    for (let index = 0; index < 10; index += 1) {
      expect(state.currentIndex).toBe(index);
      const answer = await request.post(`/api/activities/quiz/${activityId}/answer`, {
        data: { answerIndex: 0 },
      });
      expect(answer.status(), await errorBody(answer)).toBe(200);
      expectLeanWorkerDelivery(answer, `/api/activities/quiz/${activityId}/answer`);
      activity = activityRunFromResponse(await readJsonRecord(answer, "quiz answer"), "quiz");
      state = requiredRecord(activity.state, "answered quiz state");
      const answeredQuestion = requiredRecord(
        requiredArray(state.questions, "answered quiz questions")[index],
        `answered quiz question ${index + 1}`,
      );
      expect(requiredNonNegativeInteger(answeredQuestion.correctIndex, "revealed correct index")).toBeLessThan(4);
      expect(requiredString(answeredQuestion.explanation, "revealed explanation").length).toBeGreaterThan(0);
      expect(answeredQuestion.userAnswerIndex).toBe(0);
      expect(typeof answeredQuestion.isCorrect).toBe("boolean");
    }

    expect(state).toMatchObject({ currentIndex: 10, maxScore: 10, completed: true });
    expect(requiredNonNegativeInteger(state.score, "completed quiz score")).toBeLessThanOrEqual(10);
    for (const value of requiredArray(state.questions, "completed quiz questions")) {
      const question = requiredRecord(value, "completed quiz question");
      expect(requiredNonNegativeInteger(question.correctIndex, "completed correct index")).toBeLessThan(4);
      expect(requiredString(question.explanation, "completed explanation").length).toBeGreaterThan(0);
    }
    await expectSavedActivityResult(request, chatId, activityId, "quiz", true);
    await deleteChatAndAssertGone(request, chatId);
    chatId = null;
    const logout = await request.post("/api/logout");
    expect(logout.status()).toBe(204);
  } finally {
    if (chatId) await request.delete(`/api/chats/${chatId}`).catch(() => undefined);
    await request.post("/api/logout").catch(() => undefined);
  }
});

test("configured native flashcards reveal every card and reach the complete result", async ({ page }) => {
  test.skip(!e2eAuthConfigured, "Set E2E_TEST_AUTH_SECRET and E2E_TEST_AUTH_EMAIL to run authenticated E2E.");
  test.skip(productionE2eReadOnly, "Production validation must not create learner activity history.");
  test.setTimeout(150_000);
  const request = page.request;
  await authenticateMigrationE2E(request);
  let chatId: string | null = null;

  try {
    chatId = await createOwnedChat(request, "flashcard-builder");
    const build = await request.post("/api/activities/flashcards", {
      data: {
        chatId,
        topic: `Photosynthesis foundations ${e2eNonce()}`,
        source: "Plants use light energy to convert carbon dioxide and water into glucose and oxygen.",
      },
      timeout: 60_000,
    });
    if (build.status() !== 200) {
      const body = await build.text();
      if (!requireLiveAi) {
        await deleteChatAndAssertGone(request, chatId);
        chatId = null;
        await request.post("/api/logout");
        test.skip(
          true,
          `Flashcard provider unavailable in this environment (${build.status()}: ${body.slice(0, 240)}).`,
        );
        return;
      }
      expect(build.status(), body).toBe(200);
    }
    expectLeanWorkerDelivery(build, "/api/activities/flashcards");
    let activity = activityRunFromResponse(
      await readJsonRecord(build, "/api/activities/flashcards"),
      "flashcards",
    );
    const activityId = requiredString(activity.id, "flashcard activity id");
    let state = requiredRecord(activity.state, "flashcard state");
    expect(state).toMatchObject({
      currentIndex: 0,
      knownCount: 0,
      reviewedCount: 0,
      maxCards: 12,
      completed: false,
    });
    const initialCards = requiredArray(state.cards, "initial flashcards");
    expect(initialCards).toHaveLength(12);
    for (const value of initialCards) {
      const card = requiredRecord(value, "initial flashcard");
      expect(requiredString(card.front, "flashcard front").length).toBeGreaterThan(0);
      expect(card.back).toBeUndefined();
      expect(card.example).toBeUndefined();
      expect(card.trap).toBeUndefined();
    }

    for (let index = 0; index < 12; index += 1) {
      expect(state.currentIndex).toBe(index);
      const reveal = await request.post(`/api/activities/flashcards/${activityId}/review`, {
        data: { action: "reveal" },
      });
      expect(reveal.status(), await errorBody(reveal)).toBe(200);
      expectLeanWorkerDelivery(reveal, `/api/activities/flashcards/${activityId}/review reveal`);
      activity = activityRunFromResponse(await readJsonRecord(reveal, "flashcard reveal"), "flashcards");
      state = requiredRecord(activity.state, "revealed flashcard state");
      const revealedCard = requiredRecord(
        requiredArray(state.cards, "revealed cards")[index],
        `revealed card ${index + 1}`,
      );
      expect(revealedCard.isRevealed).toBe(true);
      expect(requiredString(revealedCard.back, "revealed back").length).toBeGreaterThan(0);
      expect(requiredString(revealedCard.example, "revealed example").length).toBeGreaterThan(0);
      expect(requiredString(revealedCard.trap, "revealed trap").length).toBeGreaterThan(0);

      const rating = index % 2 === 0 ? "known" : "again";
      const rate = await request.post(`/api/activities/flashcards/${activityId}/review`, {
        data: { action: "rate", rating },
      });
      expect(rate.status(), await errorBody(rate)).toBe(200);
      expectLeanWorkerDelivery(rate, `/api/activities/flashcards/${activityId}/review rate`);
      activity = activityRunFromResponse(await readJsonRecord(rate, "flashcard rate"), "flashcards");
      state = requiredRecord(activity.state, "rated flashcard state");
      const ratedCard = requiredRecord(
        requiredArray(state.cards, "rated cards")[index],
        `rated card ${index + 1}`,
      );
      expect(ratedCard.rating).toBe(rating);
      expect(typeof ratedCard.reviewedAt).toBe("string");
    }

    expect(state).toMatchObject({
      currentIndex: 12,
      knownCount: 6,
      reviewedCount: 12,
      maxCards: 12,
      completed: true,
    });
    for (const value of requiredArray(state.cards, "completed flashcards")) {
      const card = requiredRecord(value, "completed flashcard");
      expect(requiredString(card.back, "completed card back").length).toBeGreaterThan(0);
      expect(requiredString(card.example, "completed card example").length).toBeGreaterThan(0);
      expect(requiredString(card.trap, "completed card trap").length).toBeGreaterThan(0);
    }
    await expectSavedActivityResult(request, chatId, activityId, "flashcards", true);
    await deleteChatAndAssertGone(request, chatId);
    chatId = null;
    const logout = await request.post("/api/logout");
    expect(logout.status()).toBe(204);
  } finally {
    if (chatId) await request.delete(`/api/chats/${chatId}`).catch(() => undefined);
    await request.post("/api/logout").catch(() => undefined);
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
  test.skip(
    productionE2eReadOnly,
    "Production uses the single tail-correlated outcome-soak request to avoid duplicate quota consumption.",
  );
  const response = await request.post("/api/guest-chat", {
    headers: { accept: "text/event-stream" },
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

type AuthenticatedE2EUser = {
  email: string;
  isAdmin: boolean;
};

type ProfileSnapshot = {
  name: string;
  preferredLanguage: string;
  dateOfBirth: string | null;
};

type MemorySettingsSnapshot = {
  enabled: boolean;
  savedMemoryEnabled: boolean;
  chatHistoryEnabled: boolean;
  dreamingEnabled: boolean;
};

type E2EMemorySource = {
  type: "memory" | "summary" | "past_chat";
  id: string;
  memoryId?: string;
};

async function authenticateMigrationE2E(request: APIRequestContext): Promise<AuthenticatedE2EUser> {
  if (!e2eAuthConfigured) throw new Error("Migration E2E authentication is not configured.");
  const response = await request.post("/api/migration/e2e-auth", {
    headers: { "x-migration-e2e-auth-secret": e2eAuthSecret },
    data: productionE2eReadOnly
      ? {
          action: "authenticate-existing",
          email: e2eAuthEmail,
          runId: e2eMutationRunId,
          candidateVersionId: expectedWorkerVersion,
          sessionPurpose: "production-playwright",
        }
      : { email: e2eAuthEmail },
  });
  const body = response.status() === 200 ? "" : await response.text();
  expect(response.status(), body).toBe(200);
  expectLeanWorkerDelivery(response, "/api/migration/e2e-auth");
  const payload = await readJsonRecord(response, "/api/migration/e2e-auth");
  expect(payload.ok).toBe(true);
  const user = requiredRecord(payload.user, "/api/migration/e2e-auth user");
  if (productionE2eReadOnly) {
    const session = requiredRecord(
      payload.validationSession,
      "/api/migration/e2e-auth validation session",
    );
    expect(session.candidateVersionId).toBe(expectedWorkerVersion);
    expect(session.runId).toBe(e2eMutationRunId);
    expect(session.purpose).toBe("production-playwright");
    expect(requiredString(session.userRef, "validation user ref")).toMatch(/^[a-f0-9]{64}$/);
    expect(requiredString(session.sessionRef, "validation session ref")).toMatch(/^[a-f0-9]{64}$/);
    expect(user.id).toBeUndefined();
    expect(user.image).toBeUndefined();
  }
  return {
    email: requiredString(user.email, "authenticated E2E email"),
    isAdmin: requiredBoolean(user.isAdmin, "authenticated E2E admin flag"),
  };
}

async function cleanupProductionExistingValidationSession(request: APIRequestContext) {
  if (!productionE2eBindingConfigured) {
    throw new Error("Production existing-session cleanup binding is unavailable.");
  }
  const base = {
    runId: e2eMutationRunId,
    candidateVersionId: expectedWorkerVersion,
    sessionPurpose: "production-playwright",
  } as const;
  const cleanup = await request.post("/api/migration/e2e-auth", {
    headers: { "x-migration-e2e-auth-secret": e2eAuthSecret },
    data: { action: "cleanup-existing-session", ...base },
  });
  expect(cleanup.status(), await errorBody(cleanup)).toBe(200);
  const cleanupPayload = await readJsonRecord(cleanup, "existing-session cleanup");
  expect(cleanupPayload.ok).toBe(true);
  expectExistingValidationSessionInventoryZero(
    requiredRecord(cleanupPayload.after, "existing-session cleanup after"),
  );

  const verify = await request.post("/api/migration/e2e-auth", {
    headers: { "x-migration-e2e-auth-secret": e2eAuthSecret },
    data: { action: "verify-existing-session-cleanup", ...base },
  });
  expect(verify.status(), await errorBody(verify)).toBe(200);
  const verifyPayload = await readJsonRecord(verify, "existing-session cleanup verification");
  expect(verifyPayload.ok).toBe(true);
  expectExistingValidationSessionInventoryZero(
    requiredRecord(verifyPayload.after, "existing-session verification after"),
  );
}

function expectExistingValidationSessionInventoryZero(inventory: Record<string, unknown>) {
  expect(Object.keys(inventory).sort()).toEqual(
    ["exactSessions", "idRows", "markerSessions"].sort(),
  );
  for (const key of ["idRows", "exactSessions", "markerSessions"] as const) {
    expect(requiredNonNegativeInteger(inventory[key], `existing-session ${key}`)).toBe(0);
  }
}

async function createOwnedChat(request: APIRequestContext, topicId: string) {
  const response = await request.post("/api/chats", { data: { topicId } });
  expect(response.status(), await errorBody(response)).toBe(200);
  expectLeanWorkerDelivery(response, `/api/chats POST (${topicId})`);
  const payload = await readJsonRecord(response, `/api/chats POST (${topicId})`);
  const chatId = requiredString(payload.chatId, "created chat id");
  expect(chatId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  expect(requiredRecord(payload.chat, "created chat").id).toBe(chatId);
  return chatId;
}

async function finalizeAuthenticatedSse(
  request: APIRequestContext,
  streamedResponse: APIResponse,
  chatId: string,
  streamBody: string,
) {
  const aiRunId = requiredString(
    streamedResponse.headers()["x-inspir-ai-run-id"],
    "authenticated stream ai run id",
  );
  const userMessageId = requiredString(
    streamedResponse.headers()["x-inspir-user-message-id"],
    "authenticated stream user message id",
  );
  expect(streamedResponse.headers()["x-inspir-chat-id"]).toBe(chatId);
  const content = parseOpenAiSseText(streamBody, true).text.trim();
  expect(content.length).toBeGreaterThan(0);
  const response = await request.post("/api/chat/finalize", {
    data: { aiRunId, chatId, userMessageId, content },
  });
  expect(response.status(), await errorBody(response)).toBe(200);
  expectLeanWorkerDelivery(response, "/api/chat/finalize");
  const payload = await readJsonRecord(response, "/api/chat/finalize");
  expect(payload.ok).toBe(true);
  return requiredString(payload.assistantMessageId, "finalized assistant message id");
}

async function deleteChatAndAssertGone(request: APIRequestContext, chatId: string) {
  const response = await request.delete(`/api/chats/${chatId}`);
  expect(response.status(), await errorBody(response)).toBe(200);
  expectLeanWorkerDelivery(response, "/api/chats/:id DELETE");
  expect(await readJsonRecord(response, "/api/chats/:id DELETE")).toEqual({ ok: true });

  const detail = await request.get(`/api/chats/${chatId}`);
  expect(detail.status()).toBe(404);
  expectLeanWorkerDelivery(detail, "/api/chats/:id after DELETE");
  const list = await request.get("/api/chats");
  expect(list.status()).toBe(200);
  const chats = requiredArray((await readJsonRecord(list, "/api/chats after DELETE")).chats, "chat list");
  expect(chats.some((value) => optionalRecord(value)?.id === chatId)).toBe(false);
}

async function restoreProfile(request: APIRequestContext, profile: ProfileSnapshot) {
  const response = await request.patch("/api/me", { data: profile });
  expect(response.status(), await errorBody(response)).toBe(200);
  const restored = requiredRecord(
    (await readJsonRecord(response, "/api/me restore")).user,
    "restored profile",
  );
  expect(restored.name).toBe(profile.name);
  expect(restored.preferredLanguage).toBe(profile.preferredLanguage);
}

async function restoreMemorySettings(request: APIRequestContext, settings: MemorySettingsSnapshot) {
  await setMemorySettings(request, settings);
}

async function setMemorySettings(request: APIRequestContext, settings: MemorySettingsSnapshot) {
  const response = await request.patch("/api/memory", { data: settings });
  expect(response.status(), await errorBody(response)).toBe(200);
  const restored = memorySettingsSnapshot(
    requiredRecord((await readJsonRecord(response, "/api/memory restore")).settings, "restored memory settings"),
  );
  expect(restored).toEqual(settings);
}

async function deleteMemoriesByContent(request: APIRequestContext, contents: readonly string[]) {
  const expected = new Set(contents);
  const response = await request.get("/api/memory");
  if (response.status() !== 200) return;
  const dashboard = await readJsonRecord(response, "/api/memory cleanup");
  for (const value of requiredArray(dashboard.memories, "/api/memory cleanup memories")) {
    const memory = optionalRecord(value);
    if (!memory || typeof memory.id !== "string") continue;
    const content = typeof memory.content === "string" ? memory.content : null;
    const displayContent = typeof memory.displayContent === "string" ? memory.displayContent : null;
    if ((content && expected.has(content)) || (displayContent && expected.has(displayContent))) {
      await request.delete(`/api/memory/${encodeURIComponent(memory.id)}`);
    }
  }
}

function memorySourcesFromResponse(response: APIResponse): E2EMemorySource[] {
  const encoded = response.headers()["x-inspir-memory-sources"];
  if (!encoded) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(encoded)) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((value) => {
    const source = optionalRecord(value);
    if (
      !source ||
      (source.type !== "memory" && source.type !== "summary" && source.type !== "past_chat") ||
      typeof source.id !== "string"
    ) {
      return [];
    }
    return [{
      type: source.type,
      id: source.id,
      ...(typeof source.memoryId === "string" ? { memoryId: source.memoryId } : {}),
    } satisfies E2EMemorySource];
  });
}

async function expectSavedActivityResult(
  request: APIRequestContext,
  chatId: string,
  activityId: string,
  activityType: "quiz" | "flashcards",
  completed: boolean,
) {
  const response = await request.get(`/api/chats/${chatId}`);
  expect(response.status(), await errorBody(response)).toBe(200);
  expectLeanWorkerDelivery(response, `/api/chats/:id completed ${activityType}`);
  const payload = await readJsonRecord(response, `/api/chats/:id completed ${activityType}`);
  const activity = requiredRecord(payload.activityRun, `saved ${activityType} activity`);
  expect(activity.id).toBe(activityId);
  expect(activity.type).toBe(activityType);
  expect(requiredRecord(activity.state, `saved ${activityType} state`).completed).toBe(completed);
  const messages = requiredArray(payload.messages, `saved ${activityType} messages`);
  expect(messages.length).toBeGreaterThanOrEqual(3);
  const completionPrefix = activityType === "quiz" ? "Quiz complete:" : "Flashcard deck complete:";
  expect(
    messages.some((value) => {
      const message = optionalRecord(value);
      return message?.role === "assistant" &&
        typeof message.content === "string" &&
        message.content.includes(completionPrefix);
    }),
  ).toBe(true);
}

function activityRunFromResponse(payload: Record<string, unknown>, expectedType: "quiz" | "flashcards") {
  const activity = requiredRecord(payload.activityRun, `${expectedType} activity run`);
  expect(activity.type).toBe(expectedType);
  expect(requiredString(activity.id, `${expectedType} activity id`)).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  expect(requiredString(activity.chatId, `${expectedType} chat id`)).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  return activity;
}

function profileSnapshot(profile: Record<string, unknown>): ProfileSnapshot {
  return {
    name: requiredString(profile.name, "profile name"),
    preferredLanguage: requiredString(profile.preferredLanguage, "profile preferred language"),
    dateOfBirth: nullableString(profile.dateOfBirth, "profile date of birth"),
  };
}

function memorySettingsSnapshot(settings: Record<string, unknown>): MemorySettingsSnapshot {
  return {
    enabled: requiredBoolean(settings.enabled, "memory enabled"),
    savedMemoryEnabled: requiredBoolean(settings.savedMemoryEnabled, "saved memory enabled"),
    chatHistoryEnabled: requiredBoolean(settings.chatHistoryEnabled, "chat history memory enabled"),
    dreamingEnabled: requiredBoolean(settings.dreamingEnabled, "dreaming enabled"),
  };
}

function findMemoryByContent(dashboard: Record<string, unknown>, content: string) {
  const memory = requiredArray(dashboard.memories, "memory dashboard items").find(
    (value) => optionalRecord(value)?.content === content,
  );
  return requiredRecord(memory, `memory with content ${content}`);
}

async function readJsonRecord(response: APIResponse, label: string) {
  const value: unknown = await response.json();
  return requiredRecord(value, `${label} JSON`);
}

async function errorBody(response: APIResponse) {
  return response.ok() ? "" : (await response.text()).slice(0, 1_000);
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function nullableString(value: unknown, label: string) {
  if (value === null) return null;
  return requiredString(value, label);
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function requiredNonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function e2eNonce() {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

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

function expectLeanWorkerDelivery(
  response: ResponseWithHeaders | null,
  route: string,
  cachePolicy: "private-no-store" | "public" = "private-no-store",
) {
  expect(response, route).not.toBeNull();
  const headers = response?.headers() ?? {};
  expect(headers["x-inspir-delivery"], route).toBe("lean-api-worker");
  const cacheControl = headers["cache-control"] ?? "";
  if (cachePolicy === "public") {
    expect(cacheControl, route).toMatch(/\bpublic\b/i);
    expect(cacheControl, route).not.toMatch(/\b(?:private|no-store)\b/i);
  } else {
    expect(cacheControl, route).toMatch(/private/i);
    expect(cacheControl, route).toMatch(/no-store/i);
  }
  expect(headers["x-nextjs-cache"], route).toBeUndefined();
  expect(headers["x-opennext-cache"], route).toBeUndefined();
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
