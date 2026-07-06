import { expect, test, type Page } from "@playwright/test";

type ApiResult<T = unknown> = {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: T | null;
};

test("public, localized, SEO, and topic API routes work on Cloudflare preview", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Free AI learning/i);
  await expect(page.locator("body")).toContainText(/learn/i);

  for (const route of ["/about", "/mission", "/schools", "/trust", "/topics", "/learn", "/subjects", "/blog"]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    expect((await response.text()).length, route).toBeGreaterThan(500);
  }

  const localized = await request.get("/hi");
  expect(localized.status()).toBe(200);
  expect(localized.headers()["set-cookie"] ?? "").toContain("inspir_locale=Hindi");

  for (const route of ["/hi/topics", "/hi/chat/learn-anything"]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
  }

  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("User-Agent");

  const sitemap = await request.get("/sitemap");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain("<sitemapindex");

  const englishSitemap = await request.get("/sitemap/en-US.xml");
  expect(englishSitemap.status()).toBe(200);
  expect(await englishSitemap.text()).toContain("<urlset");

  const rss = await request.get("/rss.xml");
  expect(rss.status()).toBe(200);
  expect(await rss.text()).toContain("<rss");

  const og = await request.get("/og");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"] ?? "").toContain("image/png");

  const topics = await request.get("/api/topics");
  expect(topics.status()).toBe(200);
  const payload = await topics.json();
  expect(payload.topics.length).toBeGreaterThan(50);
  expect(payload.topics.some((topic: { slug?: string }) => topic.slug === "learn-anything")).toBe(true);
});

test("guest-only activity modes show the Google gate instead of private tooling", async ({ page }) => {
  await page.goto("/chat/quiz-me-on-trivia");
  await expect(page.getByRole("main").getByRole("heading", { name: /continue with google to use scored ai quizzes/i })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: /continue with google/i })).toBeVisible();

  await page.goto("/chat/flashcard-builder");
  await expect(page.getByRole("main").getByRole("heading", { name: /continue with google to use ai flashcard decks/i })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: /continue with google/i })).toBeVisible();
});

test("private and admin APIs fail closed for signed-out users", async ({ page, request }) => {
  await page.goto("/admin");
  expect(new URL(page.url()).pathname).toBe("/");

  const privateGets = ["/api/chats", "/api/me", "/api/memory"];
  for (const route of privateGets) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(401);
  }

  const privatePosts = [
    {
      route: "/api/chats",
      data: { topicId: "00000000-0000-4000-8000-000000000000" },
      expectedStatus: 401,
    },
    {
      route: "/api/activities/quiz",
      data: { chatId: "00000000-0000-4000-8000-000000000000", topic: "migration safety" },
      expectedStatus: 401,
    },
    {
      route: "/api/activities/flashcards",
      data: { chatId: "00000000-0000-4000-8000-000000000000", topic: "migration safety" },
      expectedStatus: 401,
    },
    {
      route: "/api/memory",
      data: { content: "Remember that this migration must preserve data exactly.", category: "projects" },
      expectedStatus: 401,
    },
    {
      route: "/api/admin/topics",
      data: {
        name: "Migration E2E Probe",
        subText: "Probe",
        description: "Probe",
        inputboxText: "Probe",
        systemPrompt: "Probe",
      },
      expectedStatus: 403,
    },
  ];

  for (const check of privatePosts) {
    const response = await request.post(check.route, { data: check.data });
    expect(response.status(), check.route).toBe(check.expectedStatus);
  }

  const memoryPatch = await request.patch("/api/memory", { data: { savedMemoryEnabled: false } });
  expect(memoryPatch.status()).toBe(401);

  const memoryDelete = await request.delete("/api/memory");
  expect(memoryDelete.status()).toBe(401);
});

test("migration write-freeze status endpoint exposes the expected readiness contract", async ({ request }) => {
  const response = await request.get("/api/migration/write-freeze", {
    headers: {
      accept: "application/json",
      "cache-control": "no-store",
    },
  });
  const payload = (await response.json()) as { ok?: boolean; writeFreezeActive?: boolean; code?: string };

  expect([200, 409]).toContain(response.status());
  expect(response.headers()["cache-control"] ?? "").toContain("no-store");
  expect(typeof payload.writeFreezeActive).toBe("boolean");
  expect(payload.ok).toBe(payload.writeFreezeActive);
  expect(payload.code).toBe(payload.writeFreezeActive ? "write_freeze_active" : "write_freeze_inactive");
});

test("guest chat returns streamed text with sane limit headers or an explicit provider failure", async ({ request }) => {
  const response = await request.post("/api/guest-chat", {
    data: {
      topicId: "learn-anything",
      content: "Say hello in one short sentence.",
      preferredLanguage: "English",
      messages: [],
    },
  });
  const body = await response.text();

  if (response.status() === 500 && body.includes("The assistant could not answer right now.")) {
    test.skip(
      process.env.REQUIRE_LIVE_AI !== "1",
      "Live AI provider is unavailable with the current OpenAI key; set REQUIRE_LIVE_AI=1 to fail this gate.",
    );
  }

  expect(response.status(), body).toBe(200);
  const used = Number(response.headers()["x-guest-messages-used"]);
  const limit = Number(response.headers()["x-guest-messages-limit"]);
  expect(Number.isInteger(used), "x-guest-messages-used must be an integer").toBe(true);
  expect(Number.isInteger(limit), "x-guest-messages-limit must be an integer").toBe(true);
  expect(used).toBeGreaterThanOrEqual(1);
  expect(limit).toBeGreaterThanOrEqual(used);
  expect(body.trim().length).toBeGreaterThan(0);
});

test("Google sign-in and sign-out work with the dedicated test account", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithGoogle(page);
  await expect(page.getByRole("button", { name: /open profile/i })).toBeVisible();

  await page.getByRole("button", { name: /open profile/i }).click();
  await expect(page.getByRole("heading", { name: /make inspir feel like it knows how you learn/i })).toBeVisible();
  await page.getByRole("button", { name: /logout/i }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect
    .poll(
      async () => {
        const session = await api<{ user?: { email?: string } }>(page, "GET", "/api/auth/get-session");
        return Boolean(session.json?.user?.email);
      },
      { message: "logout should clear the authenticated Better Auth session", timeout: 30_000 },
    )
    .toBe(false);
});

test("authenticated profile uses a full-width identity and details layout", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInWithGoogle(page);

  await page.getByRole("button", { name: /open profile/i }).click();
  await expect(page.getByRole("heading", { name: /make inspir feel like it knows how you learn/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /your app identity/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /use google photo/i })).toHaveCount(0);
  await expect(page.locator(".inspir-profile-photo-button")).toHaveCount(0);
  await expect(page.locator(".inspir-profile-avatar-button")).toBeVisible();
  await expect(page.getByRole("button", { name: /change photo/i })).toBeVisible();

  const saveButton = page.getByRole("button", { name: /save profile/i });
  await expect(saveButton).toHaveCount(0);
  const displayName = page.getByLabel(/display name/i);
  const originalName = await displayName.inputValue();
  await displayName.fill(`${originalName || "Inspir E2E"} edited`);
  await expect(saveButton).toBeVisible();

  const layout = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".inspir-profile-workspace");
    const body = document.querySelector<HTMLElement>(".inspir-profile-body");
    const identity = document.querySelector<HTMLElement>(".inspir-profile-identity-section");
    const identityGrid = document.querySelector<HTMLElement>(".inspir-profile-identity-grid");
    const hero = document.querySelector<HTMLElement>(".inspir-profile-hero");
    const avatar = document.querySelector<HTMLElement>(".inspir-profile-avatar-button");
    const heroCopy = document.querySelector<HTMLElement>(".inspir-profile-hero-copy");
    const form = document.querySelector<HTMLElement>(".inspir-profile-details-form");
    const save = document.querySelector<HTMLElement>(".inspir-profile-save-button");
    const sections = Array.from(document.querySelectorAll<HTMLElement>(".inspir-profile-section"));
    const overview = sections.find((section) => section.textContent?.includes("Your learning snapshot")) ?? null;
    const stats = document.querySelector<HTMLElement>(".inspir-profile-stats-grid");

    const rect = (element: HTMLElement | null) => element?.getBoundingClientRect() ?? null;
    const bodyRect = rect(body);
    const identityRect = rect(identity);
    const heroRect = rect(hero);
    const avatarRect = rect(avatar);
    const heroCopyRect = rect(heroCopy);
    const formRect = rect(form);
    const saveRect = rect(save);
    const overviewRect = rect(overview);
    const statsRect = rect(stats);
    const bodyColumnTracks = body ? getComputedStyle(body).gridTemplateColumns.trim().split(/\s+/).filter(Boolean) : [];
    const identityColumnTracks = identityGrid
      ? getComputedStyle(identityGrid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean)
      : [];

    return {
      bodyColumnCount: bodyColumnTracks.length,
      detailsShareIdentitySection: Boolean(identity && hero && form && hero.closest("section") === identity && form.closest("section") === identity),
      identityColumnCount: identityColumnTracks.length,
      identityWidthDelta: bodyRect && identityRect ? Math.abs(bodyRect.width - identityRect.width) : null,
      overviewWidthDelta: bodyRect && overviewRect ? Math.abs(bodyRect.width - overviewRect.width) : null,
      rowTopDelta: heroRect && formRect ? Math.abs(heroRect.top - formRect.top) : null,
      heroFormGap: heroRect && formRect ? formRect.left - heroRect.right : null,
      avatarIsClickable: avatar?.tagName === "BUTTON",
      avatarSizeDelta: avatarRect ? Math.abs(avatarRect.width - avatarRect.height) : null,
      avatarWidth: avatarRect?.width ?? null,
      avatarLeftOverflow: heroRect && avatarRect ? heroRect.left - avatarRect.left : null,
      avatarRightOverflow: heroRect && avatarRect ? avatarRect.right - heroRect.right : null,
      heroCopyRightOverflow: heroRect && heroCopyRect ? heroCopyRect.right - heroRect.right : null,
      saveRightDelta: formRect && saveRect ? Math.abs(formRect.right - saveRect.right) : null,
      saveBottomDelta: formRect && saveRect ? Math.abs(formRect.bottom - saveRect.bottom) : null,
      statsWidthDelta: overviewRect && statsRect ? Math.abs(overviewRect.width - statsRect.width) : null,
      panelHorizontalOverflow: panel ? panel.scrollWidth - panel.clientWidth : null,
    };
  });

  expect(layout.detailsShareIdentitySection).toBe(true);
  expect(layout.bodyColumnCount).toBe(1);
  expect(layout.identityColumnCount).toBe(2);
  expect(layout.identityWidthDelta).not.toBeNull();
  expect(layout.identityWidthDelta ?? 999).toBeLessThanOrEqual(2);
  expect(layout.overviewWidthDelta).not.toBeNull();
  expect(layout.overviewWidthDelta ?? 999).toBeLessThanOrEqual(2);
  expect(layout.rowTopDelta).not.toBeNull();
  expect(layout.rowTopDelta ?? 999).toBeLessThanOrEqual(4);
  expect(layout.heroFormGap).not.toBeNull();
  expect(layout.heroFormGap ?? -999).toBeGreaterThanOrEqual(16);
  expect(layout.avatarIsClickable).toBe(true);
  expect(layout.avatarSizeDelta).not.toBeNull();
  expect(layout.avatarSizeDelta ?? 999).toBeLessThanOrEqual(1);
  expect(layout.avatarWidth).not.toBeNull();
  expect(layout.avatarWidth ?? 0).toBeGreaterThanOrEqual(72);
  expect(layout.avatarLeftOverflow).not.toBeNull();
  expect(layout.avatarLeftOverflow ?? 999).toBeLessThanOrEqual(1);
  expect(layout.avatarRightOverflow).not.toBeNull();
  expect(layout.avatarRightOverflow ?? 999).toBeLessThanOrEqual(1);
  expect(layout.heroCopyRightOverflow).not.toBeNull();
  expect(layout.heroCopyRightOverflow ?? 999).toBeLessThanOrEqual(1);
  expect(layout.saveRightDelta).not.toBeNull();
  expect(layout.saveRightDelta ?? 999).toBeLessThanOrEqual(2);
  expect(layout.saveBottomDelta).not.toBeNull();
  expect(layout.saveBottomDelta ?? 999).toBeLessThanOrEqual(2);
  expect(layout.statsWidthDelta).not.toBeNull();
  expect(layout.statsWidthDelta ?? 999).toBeLessThanOrEqual(36);
  expect(layout.panelHorizontalOverflow).not.toBeNull();
  expect(layout.panelHorizontalOverflow ?? 999).toBeLessThanOrEqual(2);

  await page.screenshot({ path: testInfo.outputPath("profile-layout-desktop.png"), fullPage: true });
});

test("authenticated profile photo API stores, serves, and resets image bytes", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithGoogle(page);

  const photo = await uploadTinyProfilePhoto(page);
  expect(photo.status, photo.body).toBe(200);
  expect(photo.json?.profileImageHash).toBeTruthy();

  const photoGet = await api(page, "GET", "/api/me/photo");
  expect(photoGet.status, photoGet.body).toBe(200);
  expect(photoGet.headers["content-type"]).toContain("image/png");

  await page.goto("/chat/learn-anything");
  await dismissBlockingDialogs(page);
  await page.getByRole("button", { name: /open profile/i }).click();
  const profilePhoto = page.locator(".inspir-profile-avatar img").first();
  await expect(profilePhoto).toBeVisible();
  await expect
    .poll(async () => profilePhoto.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  const photoReset = await api(page, "DELETE", "/api/me/photo");
  expect(photoReset.status, photoReset.body).toBe(200);

  const photoAfterReset = await api(page, "GET", "/api/me/photo");
  expect(photoAfterReset.status, photoAfterReset.body).toBe(404);
});

test("authenticated profile avatar falls back when cached photo cannot load", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithGoogle(page);

  const photo = await uploadTinyProfilePhoto(page);
  expect(photo.status, photo.body).toBe(200);
  expect(photo.json?.profileImageHash).toBeTruthy();

  await page.route("**/api/me/photo**", (route) => {
    if (route.request().method() !== "GET") {
      void route.continue();
      return;
    }
    void route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "No cached photo" }),
    });
  });

  await page.goto("/chat/learn-anything");
  await dismissBlockingDialogs(page);
  await page.getByRole("button", { name: /open profile/i }).click();
  const avatar = page.locator(".inspir-profile-avatar").first();
  const fallbackImage = avatar.locator("img").first();
  await expect(fallbackImage).toBeVisible();
  await expect
    .poll(async () => fallbackImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  await page.unroute("**/api/me/photo**");
  const photoReset = await api(page, "DELETE", "/api/me/photo");
  expect(photoReset.status, photoReset.body).toBe(200);
});

test("authenticated profile, activity, memory, admin, and private chat APIs work", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithGoogle(page);

  const meBefore = await api<{ user?: { email?: string; id?: string } }>(page, "GET", "/api/me");
  expect(meBefore.status, meBefore.body).toBe(200);
  expect(meBefore.json?.user?.email).toBeTruthy();

  const profile = await api<{ user?: { name?: string; preferredLanguage?: string; dateOfBirth?: string; profileImageHash?: string | null } }>(
    page,
    "PATCH",
    "/api/me",
    {
      name: `Inspir E2E ${Date.now()}`,
      preferredLanguage: "English",
      dateOfBirth: "2008-06-15",
    },
  );
  expect(profile.status, profile.body).toBe(200);
  expect(profile.json?.user?.preferredLanguage).toBe("English");
  expect(profile.json?.user?.dateOfBirth).toBe("2008-06-15");

  const photo = await uploadTinyProfilePhoto(page);
  expect(photo.status, photo.body).toBe(200);
  expect(photo.json?.profileImageHash).toBeTruthy();
  const photoGet = await api(page, "GET", "/api/me/photo");
  expect(photoGet.status, photoGet.body).toBe(200);
  expect(photoGet.headers["content-type"]).toContain("image/png");
  const photoReset = await api(page, "DELETE", "/api/me/photo");
  expect(photoReset.status, photoReset.body).toBe(200);

  const topics = await api<{ topics?: Array<{ id: string; slug: string }> }>(page, "GET", "/api/topics");
  const learnAnything = topicId(topics, "learn-anything");
  const quizTopic = topicId(topics, "quiz-me-on-trivia");
  const flashcardTopic = topicId(topics, "flashcard-builder");

  const chat = await api<{ chatId?: string }>(page, "POST", "/api/chats", { topicId: learnAnything });
  expect(chat.status, chat.body).toBe(200);
  expect(chat.json?.chatId).toBeTruthy();

  const loadedChat = await api<{ chat?: { id?: string }; messages?: unknown[] }>(page, "GET", `/api/chats/${chat.json?.chatId}`);
  expect(loadedChat.status, loadedChat.body).toBe(200);
  expect(loadedChat.json?.chat?.id).toBe(chat.json?.chatId);
  expect(Array.isArray(loadedChat.json?.messages)).toBe(true);

  if (process.env.REQUIRE_LIVE_AI === "1") {
    const chatResponse = await api(page, "POST", "/api/chat", {
      chatId: chat.json?.chatId,
      content: "Answer in one short sentence: what is 2 + 2?",
    });
    expect(chatResponse.status, chatResponse.body).toBe(200);
    expect(chatResponse.body.trim().length).toBeGreaterThan(0);

    const chatAfterSend = await api<{ messages?: unknown[] }>(page, "GET", `/api/chats/${chat.json?.chatId}`);
    expect(chatAfterSend.status, chatAfterSend.body).toBe(200);
    const messagesAfterSend = chatAfterSend.json?.messages?.length ?? 0;
    expect(messagesAfterSend).toBeGreaterThanOrEqual(2);

    await page.goto(`/chat/${chat.json?.chatId}`);
    const regenerate = page.getByRole("button", { name: /regenerate response/i });
    await expect(regenerate).toBeEnabled();
    await regenerate.click();
    await expect.poll(
      async () => {
        const refreshed = await api<{ messages?: unknown[] }>(page, "GET", `/api/chats/${chat.json?.chatId}`);
        return refreshed.json?.messages?.length ?? 0;
      },
      {
        message: "regenerate should append a fresh user/assistant turn to the saved chat",
        timeout: 90_000,
      },
    ).toBeGreaterThan(messagesAfterSend);
  } else {
    test.info().annotations.push({
      type: "live-ai",
      description: "Skipped private chat send/regenerate because REQUIRE_LIVE_AI is not set.",
    });
  }

  const quizChat = await api<{ chatId?: string }>(page, "POST", "/api/chats", { topicId: quizTopic });
  expect(quizChat.status, quizChat.body).toBe(200);
  const quiz = await api<{ activityRun?: { id?: string; state?: { questions?: unknown[] } } }>(page, "POST", "/api/activities/quiz", {
    chatId: quizChat.json?.chatId,
    topic: "Cloudflare migration safety",
  });
  expect(quiz.status, quiz.body).toBe(200);
  expect(quiz.json?.activityRun?.state?.questions?.length).toBeGreaterThan(0);
  const quizAnswer = await api(page, "POST", `/api/activities/quiz/${quiz.json?.activityRun?.id}/answer`, { answerIndex: 0 });
  expect(quizAnswer.status, quizAnswer.body).toBe(200);

  const flashcardChat = await api<{ chatId?: string }>(page, "POST", "/api/chats", { topicId: flashcardTopic });
  expect(flashcardChat.status, flashcardChat.body).toBe(200);
  const flashcards = await api<{ activityRun?: { id?: string; state?: { cards?: unknown[] } } }>(
    page,
    "POST",
    "/api/activities/flashcards",
    {
      chatId: flashcardChat.json?.chatId,
      topic: "D1 backups",
      source: "D1 backups preserve table rows and checksums before production cutover.",
    },
  );
  expect(flashcards.status, flashcards.body).toBe(200);
  expect(flashcards.json?.activityRun?.state?.cards?.length).toBeGreaterThan(0);
  const reveal = await api(page, "POST", `/api/activities/flashcards/${flashcards.json?.activityRun?.id}/review`, { action: "reveal" });
  expect(reveal.status, reveal.body).toBe(200);
  const rate = await api(page, "POST", `/api/activities/flashcards/${flashcards.json?.activityRun?.id}/review`, {
    action: "rate",
    rating: "known",
  });
  expect(rate.status, rate.body).toBe(200);

  if (process.env.REQUIRE_LIVE_AI === "1") {
    const memory = await api<{ memories?: Array<{ id?: string; content?: string }> }>(page, "POST", "/api/memory", {
      content: "Remember that my Cloudflare migration test likes exact D1 checksum parity.",
      category: "projects",
    });
    expect(memory.status, memory.body).toBe(201);
    const memoryId = memory.json?.memories?.find((item) => item.content?.includes("Cloudflare migration test"))?.id;
    expect(memoryId).toBeTruthy();

    const editMemory = await api(page, "PATCH", `/api/memory/${memoryId}`, {
      content: "Remember that my Cloudflare migration test requires exact D1 checksum parity.",
      category: "projects",
    });
    expect(editMemory.status, editMemory.body).toBe(200);

    const feedback = await api(page, "POST", "/api/memory/source-feedback", {
      memoryId,
      action: "not_relevant",
      note: "E2E migration verification",
    });
    expect(feedback.status, feedback.body).toBe(200);

    const deleteMemory = await api(page, "DELETE", `/api/memory/${memoryId}`);
    expect(deleteMemory.status, deleteMemory.body).toBe(200);
  } else {
    test.info().annotations.push({
      type: "live-ai",
      description: "Skipped memory add/edit/delete/source-feedback because REQUIRE_LIVE_AI is not set.",
    });
  }

  if (process.env.E2E_GOOGLE_IS_ADMIN === "1") {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /operations dashboard/i })).toBeVisible();
  } else {
    const admin = await api(page, "POST", "/api/admin/topics", {
      name: `Migration E2E Forbidden ${Date.now()}`,
      subText: "Forbidden",
      description: "Forbidden",
      inputboxText: "Forbidden",
      systemPrompt: "Forbidden",
    });
    expect(admin.status, admin.body).toBe(403);
  }
});

async function signInWithGoogle(page: Page) {
  if (process.env.E2E_TEST_AUTH_SECRET?.trim()) {
    await signInWithMigrationSession(page);
    return;
  }

  test.skip(
    !process.env.E2E_GOOGLE_EMAIL || !process.env.E2E_GOOGLE_PASSWORD,
    "Provide E2E_GOOGLE_EMAIL/E2E_GOOGLE_PASSWORD for Google sign-in, private chat, profile, memory, and admin Playwright gates.",
  );

  await page.goto("/chat/learn-anything");
  const profileButton = page.getByRole("button", { name: /open profile/i });
  if (await profileButton.isVisible().catch(() => false)) return;

  const startUrl = page.url();
  await page.getByRole("button", { name: /continue with google/i }).first().click();
  await expect
    .poll(
      async () => {
        if (await profileButton.isVisible().catch(() => false)) return "signed-in";
        const currentUrl = page.url();
        if (currentUrl.includes("accounts.google.com") || currentUrl.includes("/api/auth")) return "auth-progress";
        return currentUrl === startUrl ? "waiting" : "auth-progress";
      },
      { message: "Google sign-in should leave the guest chat state", timeout: 30_000 },
    )
    .not.toBe("waiting");

  if (/accounts\.google\.com/.test(page.url())) {
    await fillFirst(page, [/email|phone/i], 'input[type="email"]', process.env.E2E_GOOGLE_EMAIL ?? "");
    await page.getByRole("button", { name: /^next$/i }).click();
    await fillFirst(page, [/password/i], 'input[type="password"]', process.env.E2E_GOOGLE_PASSWORD ?? "");
    await page.getByRole("button", { name: /^next$/i }).click();
  }

  await page.waitForURL((url) => url.pathname.startsWith("/chat"), { timeout: 90_000 });
  await dismissBlockingDialogs(page);
  await expect(page.getByRole("button", { name: /open profile/i })).toBeVisible({ timeout: 30_000 });
}

async function signInWithMigrationSession(page: Page) {
  const email = process.env.E2E_GOOGLE_EMAIL?.trim();
  const secret = process.env.E2E_TEST_AUTH_SECRET?.trim();
  test.skip(!email || !secret, "Provide E2E_GOOGLE_EMAIL/E2E_TEST_AUTH_SECRET for migration session auth.");

  const baseUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8787");
  const { cookie, setCookie } = await requestMigrationSessionCookie(baseUrl, email ?? "", secret ?? "");
  await page.context().addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: baseUrl.hostname,
      path: "/",
      httpOnly: true,
      secure: baseUrl.protocol === "https:" || /;\s*Secure(?:;|$)/i.test(setCookie ?? ""),
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    },
  ]);

  await page.goto("/chat/learn-anything");
  await dismissBlockingDialogs(page);
  await expect(page.getByRole("button", { name: /open profile/i })).toBeVisible({ timeout: 30_000 });
}

async function requestMigrationSessionCookie(baseUrl: URL, email: string, secret: string) {
  const deadline = Date.now() + 45_000;
  const retryDelaysMs = [500, 1_000, 2_000, 5_000];
  let lastStatus = 0;
  let lastBody = "";
  let lastSetCookie: string | null = null;

  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    try {
      const response = await fetch(new URL("/api/migration/e2e-auth", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-migration-e2e-auth-secret": secret,
        },
        body: JSON.stringify({ email }),
      });
      lastStatus = response.status;
      lastBody = await response.text();
      lastSetCookie = response.headers.get("set-cookie");

      const cookie = parseSessionCookie(lastSetCookie);
      if (response.status === 200 && cookie?.value) {
        return { cookie, setCookie: lastSetCookie };
      }
    } catch (error) {
      lastStatus = 0;
      lastBody = error instanceof Error ? error.message : String(error);
      lastSetCookie = null;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const delayMs = Math.min(retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)] ?? 5_000, remainingMs);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const cookie = parseSessionCookie(lastSetCookie);
  expect(lastStatus, lastBody).toBe(200);
  expect(cookie?.value, lastBody).toBeTruthy();
  throw new Error("Migration session auth did not return a usable session cookie.");
}

async function api<T = unknown>(page: Page, method: string, path: string, data?: unknown): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ method: requestMethod, path: requestPath, data: requestData }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        headers: requestData === undefined ? undefined : { "content-type": "application/json" },
        body: requestData === undefined ? undefined : JSON.stringify(requestData),
      });
      const body = await response.text();
      let json: unknown = null;
      try {
        json = body ? JSON.parse(body) : null;
      } catch {
        json = null;
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        json,
      };
    },
    { method, path, data },
  ) as Promise<ApiResult<T>>;
}

async function uploadTinyProfilePhoto(page: Page) {
  return page.evaluate(async () => {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.set("photo", new File([bytes], "e2e-profile.png", { type: "image/png" }));
    const response = await fetch("/api/me/photo", { method: "PATCH", body: form });
    const body = await response.text();
    let json: unknown = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      json,
    };
  }) as Promise<ApiResult<{ profileImageHash?: string | null }>>;
}

function topicId(topics: ApiResult<{ topics?: Array<{ id: string; slug: string }> }>, slug: string) {
  const id = topics.json?.topics?.find((topic) => topic.slug === slug)?.id;
  expect(id, `topic id for ${slug}`).toBeTruthy();
  return id;
}

async function fillFirst(page: Page, labelPatterns: RegExp[], cssSelector: string, value: string) {
  const deadline = Date.now() + 30_000;
  for (const pattern of labelPatterns) {
    const byLabel = page.getByLabel(pattern);
    for (let index = 0; index < Math.min(await byLabel.count(), 10); index += 1) {
      const candidate = byLabel.nth(index);
      if ((await candidate.isVisible().catch(() => false)) && (await candidate.isEnabled().catch(() => false))) {
        await candidate.fill(value);
        return;
      }
    }
  }

  const fields = page.locator(cssSelector);
  while (Date.now() < deadline) {
    for (let index = 0; index < Math.min(await fields.count(), 10); index += 1) {
      const candidate = fields.nth(index);
      if ((await candidate.isVisible().catch(() => false)) && (await candidate.isEnabled().catch(() => false))) {
        await candidate.fill(value);
        return;
      }
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`No visible editable field found for ${cssSelector}`);
}

function parseSessionCookie(setCookie: string | null) {
  const pair = setCookie?.split(";")[0];
  if (!pair) return null;
  const separator = pair.indexOf("=");
  if (separator === -1) return null;
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
  };
}

async function dismissBlockingDialogs(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialog = page.getByRole("dialog").first();
    if (!(await dialog.isVisible().catch(() => false))) return;

    const closeButton = dialog.getByRole("button", { name: /^close$/i }).first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
    } else {
      await page.keyboard.press("Escape");
    }

    await expect(dialog).toBeHidden({ timeout: 5_000 });
  }
}
