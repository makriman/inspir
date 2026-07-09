import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  WriteFreezeError,
  assertWritesAllowed,
  isWriteFreezeEnabled,
  writeFreezeErrorCode,
  writeFreezeResponse,
} from "../lib/migration/write-freeze";

test("write freeze flag is opt-in and accepts explicit truthy values only", () => {
  assert.equal(isWriteFreezeEnabled({ APP_WRITE_FREEZE: "0" }), false);
  assert.equal(isWriteFreezeEnabled({ APP_WRITE_FREEZE: "" }), false);
  assert.equal(isWriteFreezeEnabled({ APP_WRITE_FREEZE: "1" }), true);
  assert.equal(isWriteFreezeEnabled({ APP_WRITE_FREEZE: "true" }), true);
  assert.equal(isWriteFreezeEnabled({ WRITE_FREEZE: "yes" }), true);
});

test("write freeze guard throws a typed error for lower-level DB adapters", () => {
  assert.doesNotThrow(() => assertWritesAllowed("auth"));

  const original = process.env.APP_WRITE_FREEZE;
  process.env.APP_WRITE_FREEZE = "1";
  try {
    assert.throws(
      () => assertWritesAllowed("auth"),
      (error) => error instanceof WriteFreezeError && error.code === writeFreezeErrorCode && error.surface === "auth",
    );
  } finally {
    restoreEnv("APP_WRITE_FREEZE", original);
  }
});

test("write freeze response is a 503 with retry guidance", async () => {
  const originalFreeze = process.env.APP_WRITE_FREEZE;
  const originalRetry = process.env.APP_WRITE_FREEZE_RETRY_AFTER_SECONDS;
  process.env.APP_WRITE_FREEZE = "1";
  process.env.APP_WRITE_FREEZE_RETRY_AFTER_SECONDS = "120";
  try {
    const response = writeFreezeResponse("chat");
    assert.ok(response);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "120");
    assert.deepEqual(await response.json(), {
      error: "The service is temporarily read-only while a migration is in progress.",
      code: writeFreezeErrorCode,
      surface: "chat",
    });
  } finally {
    restoreEnv("APP_WRITE_FREEZE", originalFreeze);
    restoreEnv("APP_WRITE_FREEZE_RETRY_AFTER_SECONDS", originalRetry);
  }
});

test("durable mutation routes are covered by the migration write-freeze guard", () => {
  const durableMutationRoutes = [
    "app/api/auth/[...all]/route.ts",
    "app/api/chat/route.ts",
    "app/api/guest-chat/route.ts",
    "app/api/chats/route.ts",
    "app/api/activities/quiz/route.ts",
    "app/api/activities/quiz/[activityRunId]/answer/route.ts",
    "app/api/activities/flashcards/route.ts",
    "app/api/activities/flashcards/[activityRunId]/review/route.ts",
    "app/api/activities/game-arena/route.ts",
    "app/api/activities/game-arena/[activityRunId]/move/route.ts",
    "app/api/me/route.ts",
    "app/api/me/photo/route.ts",
    "app/api/admin/topics/route.ts",
    "app/api/admin/users/route.ts",
    "app/api/analytics/events/route.ts",
    "app/api/memory/route.ts",
    "app/api/memory/[memoryId]/route.ts",
    "app/api/memory/source-feedback/route.ts",
    "app/api/cron/memory-dreaming/route.ts",
  ];

  for (const route of durableMutationRoutes) {
    const content = fs.readFileSync(path.resolve(route), "utf8");
    assert.match(content, /writeFreezeResponse/, `${route} must call writeFreezeResponse before durable writes`);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
