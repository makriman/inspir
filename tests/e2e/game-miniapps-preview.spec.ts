import { expect, test } from "@playwright/test";

const miniApps = [
  {
    slug: "tic-tac-toe",
    name: "Tic-Tac-Toe",
    boardTestId: "tic-board",
    boardCellCount: 9,
  },
  {
    slug: "connect-four",
    name: "Connect Four",
    boardTestId: "connect-board",
    boardCellCount: 42,
  },
  {
    slug: "chess",
    name: "Chess",
    boardTestId: "chess-board",
    boardCellCount: 64,
  },
] as const;

test("game arena routes expose three isolated installable mini-app contracts", async ({ page, request }) => {
  await page.goto("/games");
  await expect(page.getByTestId("games-catalog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Think in moves, not loading screens." })).toBeVisible();

  for (const app of miniApps) {
    await expect(page.getByTestId(`open-${app.slug}`)).toHaveAttribute("href", `/games/${app.slug}`);

    const manifestResponse = await request.get(`/games/${app.slug}/manifest.webmanifest`);
    expect(manifestResponse.status(), `${app.slug} manifest`).toBe(200);
    expect(manifestResponse.headers()["content-type"] ?? "", `${app.slug} manifest content type`).toContain(
      "application/manifest+json",
    );
    const manifest: unknown = await manifestResponse.json();
    expect(isRecord(manifest), `${app.slug} manifest JSON`).toBe(true);
    if (!isRecord(manifest)) throw new Error(`${app.slug} manifest must be an object.`);
    expect(manifest.id).toBe(`/games/${app.slug}`);
    expect(manifest.scope).toBe(`/games/${app.slug}`);
    expect(manifest.start_url).toBe(`/games/${app.slug}?source=installed`);
    expect(manifest.display).toBe("standalone");

    const workerResponse = await request.get(`/games/${app.slug}-sw.js`);
    expect(workerResponse.status(), `${app.slug} service worker`).toBe(200);
    expect(workerResponse.headers()["content-type"] ?? "", `${app.slug} service worker content type`).toMatch(
      /javascript/i,
    );
    expect(await workerResponse.text()).toContain("clients.claim()");
  }

  const localized = await request.get("/es/games", { maxRedirects: 0 });
  expect(localized.status()).toBe(308);
  const location = localized.headers().location;
  expect(location).toBeTruthy();
  expect(new URL(location ?? "/games", "http://localhost").pathname).toBe("/games");
});

test("all three game boards are usable with keyboard focus at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const app of miniApps) {
    await page.goto(`/games/${app.slug}`);
    await expect(page.getByRole("heading", { name: app.name, exact: true })).toBeVisible();
    await expect(page.getByTestId(app.boardTestId)).toBeVisible();
    await expect(page.getByTestId("game-status")).toBeVisible();
    await expect(page.getByTestId("install-support")).toBeVisible();
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      `/games/${app.slug}/manifest.webmanifest`,
    );

    const metrics = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(metrics.documentWidth, `${app.slug} should not overflow a mobile viewport`).toBeLessThanOrEqual(
      metrics.viewportWidth + 1,
    );
  }

  await page.goto("/games/tic-tac-toe");
  await page.getByTestId("tic-cell-0").focus();
  await page.getByTestId("tic-cell-0").press("ArrowRight");
  await expect(page.getByTestId("tic-cell-1")).toBeFocused();
  await expect(page.getByRole("gridcell")).toHaveCount(miniApps[0].boardCellCount);

  await page.goto("/games/connect-four");
  await page.getByTestId("connect-column-0").focus();
  await page.getByTestId("connect-column-0").press("ArrowRight");
  await expect(page.getByTestId("connect-column-1")).toBeFocused();
  await page.getByTestId("connect-column-1").press("End");
  await expect(page.getByTestId("connect-column-6")).toBeFocused();
  await expect(page.getByRole("cell")).toHaveCount(miniApps[1].boardCellCount);

  await page.goto("/games/chess");
  await page.getByTestId("chess-square-e2").focus();
  await page.getByTestId("chess-square-e2").press("ArrowUp");
  await expect(page.getByTestId("chess-square-e3")).toBeFocused();
  await expect(page.getByRole("gridcell")).toHaveCount(miniApps[2].boardCellCount);
});

test("a deterministic Tic-Tac-Toe game persists and opens its complete replay", async ({ page, request }) => {
  test.setTimeout(45_000);
  await page.goto("/games/tic-tac-toe");
  const status = page.getByTestId("game-status");
  await expect(status).toContainText("Your turn");

  await page.getByTestId("tic-cell-0").click();
  await expect(page.getByTestId("tic-cell-4")).toHaveAccessibleName(/, O$/);
  await expect(status).toContainText("Your turn");

  await page.getByTestId("tic-cell-1").click();
  await expect(page.getByTestId("tic-cell-2")).toHaveAccessibleName(/, O$/);
  await expect(status).toContainText("Your turn");

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/games/results",
  );
  await page.getByTestId("tic-cell-3").click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  expect(createResponse.headers()["cache-control"] ?? "").toContain("no-store");
  const resultId = gameResultIdFromLocation(createResponse.headers().location);
  expect(resultId).toMatch(/^gr_[a-f0-9]{32}$/);

  await page.waitForURL(new RegExp(`/games/tic-tac-toe/results/${resultId}$`));
  await expect(page.getByTestId("result-experience")).toBeVisible();
  await expect(page.getByTestId("result-terminal-code")).toHaveText("tic-tac-toe:three-in-a-row");
  await expect(page.locator(".result-outcome")).toHaveText("loss");
  await expect(page.getByRole("heading", { name: "Position 6 of 6" })).toBeVisible();

  const replaySlider = page.getByTestId("replay-slider");
  await expect(replaySlider).toHaveAttribute("max", "6");
  await expect(replaySlider).toHaveValue("6");
  await page.getByTestId("replay-previous").click();
  await expect(replaySlider).toHaveValue("5");
  await expect(page.getByRole("heading", { name: "Position 5 of 6" })).toBeVisible();
  await page.getByTestId("replay-next").click();
  await expect(replaySlider).toHaveValue("6");
  await expect(page.getByRole("region", { name: "Next actions" }).getByRole("link", { name: /Rematch/ })).toHaveAttribute(
    "href",
    `/games/tic-tac-toe?rematch=${resultId}`,
  );

  const persistedResponse = await request.get(`/api/games/results/${resultId}`);
  expect(persistedResponse.status()).toBe(200);
  expect(persistedResponse.headers()["cache-control"] ?? "").toContain("immutable");
  const persistedBody: unknown = await persistedResponse.json();
  expect(gameResultId(persistedBody)).toBe(resultId);
  expect(gameResultProperty(persistedBody, "gameSlug")).toBe("tic-tac-toe");
  expect(gameResultProperty(persistedBody, "outcome")).toBe("loss");
  expect(gameResultProperty(persistedBody, "plyCount")).toBe(6);
});

function gameResultId(value: unknown) {
  const id = gameResultProperty(value, "id");
  if (typeof id !== "string") throw new Error("Game result response did not contain a string result ID.");
  return id;
}

function gameResultIdFromLocation(value: string | undefined) {
  if (!value) throw new Error("Game result create response did not include a Location header.");
  const resultId = new URL(value, "http://localhost").pathname.split("/").at(-1);
  if (!resultId) throw new Error("Game result Location header did not include a result ID.");
  return resultId;
}

function gameResultProperty(value: unknown, property: string): unknown {
  if (!isRecord(value) || !isRecord(value.result)) {
    throw new Error("Game result response did not contain a result object.");
  }
  return value.result[property];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
