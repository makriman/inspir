import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildPublicGameResult } from "../lib/games/results";

test("production verification covers the resource-outage and game relaunch contracts", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/verify-production.ts"), "utf8");
  const outcomes = fs.readFileSync(
    path.resolve("scripts/cloudflare/verify-production-worker-outcomes.ts"),
    "utf8",
  );

  assert.match(source, /checkRuntimeHealth/);
  assert.match(source, /checkCacheRevalidation/);
  assert.match(source, /findStableCachePair/);
  assert.match(source, /nextCache === "HIT"/);
  assert.match(source, /staleState === "STALE"/);
  assert.match(source, /checkAuthCacheIsolation/);
  assert.match(source, /checkRemovedTranslationApis/);
  assert.match(source, /checkGameMiniApps/);
  assert.match(source, /checkDurableGameResult/);
  assert.match(source, /durable game result replay and provenance/);
  assert.match(source, /completedStrategyConnectFourState/);
  assert.match(source, /completedStrategyChessState/);
  assert.match(source, /Cloudflare-Workers-Version-Overrides/);
  assert.match(source, /expectedWorkerVersion/);
  assert.match(outcomes, /--version-id/);
  assert.match(outcomes, /exceededCpu/);
  assert.match(outcomes, /exceededMemory/);
  assert.match(outcomes, /Dummy queue is not implemented/);
  assert.match(outcomes, /minimumCapturedInvocations/);
  assert.match(source, /\/api\/games\/results/);
  assert.match(source, /checkLocaleResourceSoak/);
  assert.match(source, /checkImmutableLocalizedCacheControl/);
  assert.match(source, /s-maxage>=31536000/);
  assert.doesNotMatch(source, /checkSharedIsrCacheControl/);
  assert.match(source, /REQUIRE_RESOURCE_SOAK/);
  assert.match(source, /supportedLanguages/);
  assert.match(source, /ai-game-arena/);
  assert.match(source, /cf-cache-status/);
});

test("production smoke generators create server-valid completed Chess submissions", async () => {
  const previousExpectedVersion = process.env.EXPECTED_WORKER_VERSION;
  process.env.EXPECTED_WORKER_VERSION = "00000000-0000-4000-8000-000000000001";
  try {
    const production = await import("../scripts/cloudflare/verify-production");
    const outcomes = await import("../scripts/cloudflare/verify-production-worker-outcomes");
    const generators = [production.completedStrategyChessState, outcomes.completedStrategyChessState] as const;

    for (const [index, generate] of generators.entries()) {
      const state = generate();
      assert.ok(state.result, `generator ${index + 1} should reach a terminal Chess state`);
      assert.ok(state.history.length > 0 && state.history.length <= 128);

      const built = buildPublicGameResult(
        { state, startedAt: "2026-07-10T11:59:00.000Z" },
        {
          now: new Date("2026-07-10T12:00:00.000Z"),
          resultId: `gr_${String(index + 1).padStart(32, "0")}`,
        },
      );
      assert.equal(built.ok, true, `generator ${index + 1} should pass server replay validation`);
      if (built.ok) {
        assert.equal(built.result.gameSlug, "chess");
        assert.equal(built.result.plyCount, state.history.length);
      }
    }
  } finally {
    if (previousExpectedVersion === undefined) delete process.env.EXPECTED_WORKER_VERSION;
    else process.env.EXPECTED_WORKER_VERSION = previousExpectedVersion;
  }
});
