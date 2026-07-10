import assert from "node:assert/strict";
import test from "node:test";
import { consumeGameResultGuestQuota } from "../lib/games/result-rate-limit";
import { runWithRuntimeCloudflareEnv } from "../lib/runtime/cloudflare";
import {
  consumeDailyLlmBudget,
  consumeFixedWindowQuota,
  pruneExpiredRateLimits,
} from "../lib/utils/rate-limit";

test("global LLM budget fails closed when D1 is unavailable", async () => {
  const now = new Date("2026-07-06T10:15:00.000Z");
  const result = await withSuppressedConsoleError(() =>
    runWithRuntimeCloudflareEnv({ DB: throwingD1() }, () => consumeDailyLlmBudget(5, now)),
  );

  assert.equal(result.ok, false);
  assert.equal(result.limit, 5);
  assert.equal(result.remaining, 0);
  assert.equal(result.day, "2026-07-06");
  assert.equal(result.resetAt.toISOString(), "2026-07-07T00:00:00.000Z");
});

test("per-window quota keeps the deliberate availability-biased fail-open posture", async () => {
  const now = new Date("2026-07-06T10:15:00.000Z");
  const result = await withSuppressedConsoleError(() =>
    runWithRuntimeCloudflareEnv({ DB: throwingD1() }, () => consumeFixedWindowQuota("user:test", 5, 60_000, now)),
  );

  assert.equal(result.ok, true);
  assert.equal(result.limit, 5);
  assert.equal(result.remaining, 4);
});

test("public game-result quota fails closed when D1 is unavailable", async () => {
  const request = new Request("https://example.test/api/games/results", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "203.0.113.24",
      "user-agent": "quota-test",
      "accept-language": "en",
    },
  });
  const result = await withSuppressedConsoleError(() =>
    runWithRuntimeCloudflareEnv({ DB: throwingD1() }, () => consumeGameResultGuestQuota(request)),
  );

  assert.deepEqual(result, { ok: false, bucket: "edge", retryAfterSeconds: 60 });
});

test("expired rate-limit pruning is explicit and reports deleted rows", async () => {
  const calls: Array<{ query: string; bindings: unknown[] }> = [];
  const db = {
    prepare(query: string) {
      return {
        bind(...bindings: unknown[]) {
          calls.push({ query, bindings });
          return {
            async run() {
              return { meta: { changes: 7 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  const now = new Date("2026-07-06T10:15:00.000Z");
  const result = await runWithRuntimeCloudflareEnv({ DB: db }, () => pruneExpiredRateLimits(now, 60_000));

  assert.deepEqual(result, {
    ok: true,
    cutoff: now.getTime() - 60_000,
    deletedRows: 7,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.query ?? "", /delete from rate_limit_windows where reset_at < \?/);
  assert.deepEqual(calls[0]?.bindings, [now.getTime() - 60_000]);
});

function throwingD1() {
  return {
    prepare() {
      throw new Error("D1 unavailable");
    },
  } as unknown as D1Database;
}

async function withSuppressedConsoleError<T>(callback: () => T | Promise<T>) {
  const original = console.error;
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.error = original;
  }
}
