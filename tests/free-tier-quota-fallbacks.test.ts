import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULT_GLOBAL_DAILY_CALL_LIMIT, globalDailyCallLimitFromEnv } from "../lib/free-runtime/global-ai-budget";
import {
  FREE_TIER_QUOTA_FALLBACKS,
  freeTierDailyCapFromEnv,
  type FreeTierQuotaFallbackName,
} from "../lib/free-runtime/free-tier-quota-fallbacks";

const quotaNames = Object.keys(FREE_TIER_QUOTA_FALLBACKS) as FreeTierQuotaFallbackName[];

const productionCallSites = [
  "lib/free-runtime/guest-chat.ts",
  "lib/free-runtime/protected-ai-api.ts",
  "lib/free-runtime/state-api.ts",
] as const;

function wranglerQuotaVars() {
  const wrangler = JSON.parse(fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8")) as {
    vars?: Record<string, string>;
  };
  return wrangler.vars ?? {};
}

test("missing-var Free daily caps match wrangler and are never looser", () => {
  const vars = wranglerQuotaVars();
  for (const name of quotaNames) {
    const configured = vars[name];
    assert.equal(typeof configured, "string", name);
    assert.match(configured ?? "", /^\d+$/, name);
    const production = Number(configured);
    const fallback = FREE_TIER_QUOTA_FALLBACKS[name];
    assert.equal(fallback, production, name);
    assert.ok(fallback <= production, name);
  }
  assert.equal(DEFAULT_GLOBAL_DAILY_CALL_LIMIT, FREE_TIER_QUOTA_FALLBACKS.LLM_GLOBAL_DAILY_CALL_LIMIT);
  assert.equal(
    DEFAULT_GLOBAL_DAILY_CALL_LIMIT,
    Number(vars.LLM_GLOBAL_DAILY_CALL_LIMIT),
  );
});

test("missing or unparsable Free daily caps use the wrangler fallback", () => {
  for (const name of quotaNames) {
    const fallback = FREE_TIER_QUOTA_FALLBACKS[name];
    assert.equal(freeTierDailyCapFromEnv(undefined, name), fallback);
    assert.equal(freeTierDailyCapFromEnv("", name), fallback);
    assert.equal(freeTierDailyCapFromEnv("   ", name), fallback);
    assert.equal(freeTierDailyCapFromEnv("nope", name), fallback);
    assert.equal(freeTierDailyCapFromEnv("-4", name), 0);
    assert.equal(freeTierDailyCapFromEnv("3.9", name), 3);
  }

  assert.equal(freeTierDailyCapFromEnv(undefined, "RATE_LIMIT_MEMORY_DAILY"), 20);
  assert.equal(freeTierDailyCapFromEnv("20", "RATE_LIMIT_MEMORY_DAILY"), 20);
  assert.equal(freeTierDailyCapFromEnv("7", "RATE_LIMIT_MEMORY_DAILY"), 7);
  assert.equal(globalDailyCallLimitFromEnv(undefined), 1_000);
  assert.equal(globalDailyCallLimitFromEnv(""), 0);
  assert.equal(globalDailyCallLimitFromEnv("nope"), 0);
});

test("native quota call sites use the shared Free fallbacks", () => {
  const sources = productionCallSites.map((file) => fs.readFileSync(path.resolve(file), "utf8"));
  const combined = sources.join("\n");
  const globalBudget = fs.readFileSync(path.resolve("lib/free-runtime/global-ai-budget.ts"), "utf8");

  for (const name of [
    "RATE_LIMIT_USER_CHAT_DAILY",
    "RATE_LIMIT_GUEST_SESSION_DAILY",
    "RATE_LIMIT_GUEST_FINGERPRINT_DAILY",
    "RATE_LIMIT_GUEST_IP_DAILY",
    "RATE_LIMIT_ACTIVITY_DAILY",
    "RATE_LIMIT_MEMORY_DAILY",
  ] as const) {
    assert.match(
      combined,
      new RegExp(`freeTierDailyCapFromEnv\\([\\s\\S]{0,160}?${name}[\\s\\S]{0,80}?"${name}"\\)`),
    );
  }
  assert.equal(combined.match(/freeTierDailyCapFromEnv\(env\.RATE_LIMIT_ACTIVITY_DAILY, "RATE_LIMIT_ACTIVITY_DAILY"\)/g)?.length, 2);
  assert.doesNotMatch(combined, /RATE_LIMIT_[A-Z0-9_]+,\s*\d+/);
  assert.doesNotMatch(combined, /nonNegativeInteger(?:FromEnv)?\(env\.RATE_LIMIT_/);
  assert.match(
    globalBudget,
    /export const DEFAULT_GLOBAL_DAILY_CALL_LIMIT = FREE_TIER_QUOTA_FALLBACKS\.LLM_GLOBAL_DAILY_CALL_LIMIT;/,
  );

  const memoryQuota = combined.slice(
    combined.indexOf("async function consumeMemoryQuota"),
    combined.indexOf("type QueuedMemoryEventAction"),
  );
  assert.match(
    memoryQuota,
    /freeTierDailyCapFromEnv\(env\.RATE_LIMIT_MEMORY_DAILY, "RATE_LIMIT_MEMORY_DAILY"\)/,
  );
  assert.doesNotMatch(memoryQuota, /\b60\b/);
});
