import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assertD1FreeDailyBudget,
  D1_FREE_SAFE_ROWS_READ_LIMIT,
  D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
  loadAccountD1DailyUsage,
  parseD1InsightsRows,
  utcUsageWindowMinutes,
} from "../scripts/cloudflare/d1-free-budget";
import {
  RUNTIME_MIGRATION_0016_FIXED_ROWS_READ,
  RUNTIME_MIGRATION_0016_FIXED_ROWS_WRITTEN,
  evaluateRuntimeMigrationBudget,
  loadRuntimeMigrationCardinalities,
  projectRuntimeMigrationUsage,
} from "../scripts/cloudflare/check-d1-runtime-migration-budget";
import type { WranglerRunner } from "../scripts/cloudflare/migration-config";

test("D1 Free daily gate uses the UTC day and keeps analytics headroom", () => {
  assert.equal(utcUsageWindowMinutes(new Date("2026-07-11T00:00:00.000Z")), 1);
  assert.equal(utcUsageWindowMinutes(new Date("2026-07-11T12:10:59.000Z")), 731);
  assert.ok(D1_FREE_SAFE_ROWS_READ_LIMIT < 5_000_000);
  assert.ok(D1_FREE_SAFE_ROWS_WRITTEN_LIMIT < 100_000);

  assert.deepEqual(
    assertD1FreeDailyBudget(
      {
        databaseCount: 1,
        queryGroups: 10,
        rowsRead: 100_000,
        rowsWritten: 1_000,
        executions: 20,
        windowMinutes: 731,
      },
      { operation: "safe migration", rowsRead: 200_000, rowsWritten: 2_000 },
    ),
    { rowsReadAfter: 300_000, rowsWrittenAfter: 3_000 },
  );

  assert.throws(
    () =>
      assertD1FreeDailyBudget(
        {
          databaseCount: 1,
          queryGroups: 10,
          rowsRead: 3_950_000,
          rowsWritten: 1_000,
          executions: 20,
          windowMinutes: 731,
        },
        { operation: "unsafe migration", rowsRead: 100_000, rowsWritten: 0 },
      ),
    /Wait for the next 00:00 UTC reset/,
  );
  assert.throws(
    () =>
      assertD1FreeDailyBudget(
        {
          databaseCount: 0,
          queryGroups: 0,
          rowsRead: 0,
          rowsWritten: 0,
          executions: 0,
          windowMinutes: 1,
        },
        { operation: "invalid database inventory", rowsRead: 0, rowsWritten: 0 },
      ),
    /Invalid database count/,
  );
  assert.throws(
    () =>
      assertD1FreeDailyBudget(
        {
          databaseCount: 1,
          queryGroups: 0,
          rowsRead: 0,
          rowsWritten: 0,
          executions: 0,
          windowMinutes: 1_441,
        },
        { operation: "invalid usage window", rowsRead: 0, rowsWritten: 0 },
      ),
    /must not exceed one UTC day/,
  );
});

test("D1 insights parsing rejects malformed or truncated usage", () => {
  assert.deepEqual(
    parseD1InsightsRows([
      { totalRowsRead: 12, totalRowsWritten: 3, numberOfTimesRun: 2 },
    ]),
    [{ totalRowsRead: 12, totalRowsWritten: 3, numberOfTimesRun: 2 }],
  );
  assert.throws(
    () => parseD1InsightsRows([{ totalRowsRead: -1, totalRowsWritten: 0, numberOfTimesRun: 1 }]),
    /Invalid insight 0 rows read/,
  );
  assert.throws(
    () =>
      parseD1InsightsRows(
        Array.from({ length: 10_000 }, () => ({
          totalRowsRead: 0,
          totalRowsWritten: 0,
          numberOfTimesRun: 0,
        })),
      ),
    /refusing a truncated budget/,
  );
});

test("D1 usage aggregation covers every account database without retaining query text", () => {
  const calls: string[][] = [];
  const runner: WranglerRunner = (args) => {
    calls.push(args);
    if (args[1] === "list") {
      return JSON.stringify([{ name: "inspirlearning-prod" }, { name: "release-audit" }]);
    }
    assert.equal(args[1], "insights");
    if (args[2] === "inspirlearning-prod") {
      return JSON.stringify([
        {
          query: "SELECT private_marker FROM users",
          totalRowsRead: 120,
          totalRowsWritten: 3,
          numberOfTimesRun: 9,
        },
      ]);
    }
    assert.equal(args[2], "release-audit");
    return JSON.stringify([
      {
        query: "SELECT another_private_marker",
        totalRowsRead: 80,
        totalRowsWritten: 2,
        numberOfTimesRun: 4,
      },
    ]);
  };
  const now = new Date("2026-07-11T12:10:59.000Z");
  const usage = loadAccountD1DailyUsage(now, runner, () => now);

  assert.deepEqual(usage, {
    databaseCount: 2,
    queryGroups: 2,
    rowsRead: 200,
    rowsWritten: 5,
    executions: 13,
    windowMinutes: 731,
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.slice(1).every((args) => args.includes("731m")));
  assert.ok(calls.every((args) => !args.includes("execute")));
  assert.doesNotMatch(JSON.stringify(usage), /private_marker/);
});

test("D1 usage aggregation refuses to mix two UTC billing days", () => {
  const clockValues = [
    new Date("2026-07-11T23:59:59.000Z"),
    new Date("2026-07-12T00:00:00.000Z"),
  ];
  const runner: WranglerRunner = (args) => {
    if (args[1] === "list") return JSON.stringify([{ name: "inspirlearning-prod" }]);
    return "[]";
  };
  assert.throws(
    () =>
      loadAccountD1DailyUsage(
        new Date("2026-07-11T23:59:58.000Z"),
        runner,
        () => clockValues.shift() ?? new Date("2026-07-12T00:00:00.000Z"),
      ),
    /UTC day changed during D1 usage collection/,
  );
});

test("runtime migration projection is conservative and bounded", () => {
  assert.deepEqual(
    projectRuntimeMigrationUsage(
      {
        users: 40_467,
        chats: 1_240,
        messages: 4_550,
        aiRuns: 500,
        rateLimitWindows: 1_000,
        opsEvents: 250,
        activityRuns: 300,
        userMemorySettings: 40_000,
        memorySourceFeedback: 1_200,
        suppressionBackfillUsers: 200,
      },
      48_307,
    ),
    {
      rowsRead: 246_978,
      rowsWritten: 7_498,
      indexedRows: 2_350,
      runtimeIndexRows: 1_750,
      activityPartialUniqueIndexRows: 600,
      snapshotRows: 46_757,
      suppressionBackfillRowsRead: 43_000,
      suppressionBackfillRowsWritten: 400,
      outboxSchemaRowsRead: RUNTIME_MIGRATION_0016_FIXED_ROWS_READ,
      outboxSchemaRowsWritten: RUNTIME_MIGRATION_0016_FIXED_ROWS_WRITTEN,
    },
  );
  assert.throws(
    () =>
      projectRuntimeMigrationUsage(
        {
          users: 40_467,
          chats: 1_240,
          messages: 4_550,
          aiRuns: 9_000,
          rateLimitWindows: 9_000,
          opsEvents: 0,
          activityRuns: 1,
          userMemorySettings: 0,
          memorySourceFeedback: 0,
          suppressionBackfillUsers: 0,
        },
        65_757,
      ),
    /write projection/,
  );
  assert.throws(
    () =>
      projectRuntimeMigrationUsage(
        {
          users: 90_001,
          chats: 1,
          messages: 1,
          aiRuns: 1,
          rateLimitWindows: 1,
          opsEvents: 1,
          activityRuns: 1,
          userMemorySettings: 0,
          memorySourceFeedback: 0,
          suppressionBackfillUsers: 0,
        },
        1,
      ),
    /bounded scan cap/,
  );
  assert.throws(
    () =>
      projectRuntimeMigrationUsage(
        {
          users: 1,
          chats: 1,
          messages: 1,
          aiRuns: 1,
          rateLimitWindows: 1,
          opsEvents: 1,
          activityRuns: 1,
          userMemorySettings: 1,
          memorySourceFeedback: 16_662,
          suppressionBackfillUsers: 1,
        },
        1,
      ),
    /memory source feedback cardinality reached its bounded scan cap/,
  );
  assert.throws(
    () =>
      projectRuntimeMigrationUsage(
        {
          users: 1,
          chats: 1,
          messages: 1,
          aiRuns: 1,
          rateLimitWindows: 1,
          opsEvents: 1,
          activityRuns: 1,
          userMemorySettings: 1,
          memorySourceFeedback: 2,
          suppressionBackfillUsers: 3,
        },
        1,
      ),
    /Suppression backfill users exceed source feedback rows/,
  );

  const source = fs.readFileSync("scripts/cloudflare/check-d1-runtime-migration-budget.ts", "utf8");
  assert.match(source, /--confirm-production/);
  assert.match(source, /loadAccountD1DailyUsage/);
  assert.match(source, /SELECT 1 FROM users LIMIT/);
  assert.match(source, /SELECT 1 FROM activity_runs LIMIT/);
  assert.match(source, /SELECT 1 FROM user_memory_settings LIMIT/);
  assert.match(source, /SELECT 1 FROM memory_source_feedback LIMIT/);
  assert.match(source, /SELECT DISTINCT feedback\.user_id/);
  assert.match(source, /native-memory-general/);
  assert.match(source, /counts\.activityRuns[\s\S]*?2,[\s\S]*?0015 activity partial unique index rows/);
  assert.match(source, /Production D1 runtime migrations 0013-0016/);
  assert.match(source, /final app_metadata completion[\s\S]*?sentinel all fit inside it/);
  assert.match(source, /populated suppression backfill is projected[\s\S]*?separately/);
  assert.doesNotMatch(source, /FROM memory_vector_cleanup_outbox/);
  assert.doesNotMatch(source, /(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\s/i);
});

test("runtime migration budget refuses exhausted usage before any D1 SQL", () => {
  let cardinalitySqlCalls = 0;
  assert.throws(
    () =>
      evaluateRuntimeMigrationBudget(
        {
          databaseCount: 2,
          queryGroups: 5,
          rowsRead: D1_FREE_SAFE_ROWS_READ_LIMIT,
          rowsWritten: 0,
          executions: 5,
          windowMinutes: 600,
        },
        () => {
          cardinalitySqlCalls += 1;
          return {
            cardinalities: {
              users: 0,
              chats: 0,
              messages: 0,
              aiRuns: 0,
              rateLimitWindows: 0,
              opsEvents: 0,
              activityRuns: 0,
              userMemorySettings: 0,
              memorySourceFeedback: 0,
              suppressionBackfillUsers: 0,
            },
            rowsRead: 0,
            rowsWritten: 0,
          };
        },
      ),
    /cardinality preflight exceeds/,
  );
  assert.equal(cardinalitySqlCalls, 0);
});

test("runtime cardinality SQL is capped and rejects write metadata", () => {
  let sql = "";
  const result = loadRuntimeMigrationCardinalities((args) => {
    assert.deepEqual(args.slice(0, 4), ["d1", "execute", "inspirlearning-prod", "--remote"]);
    sql = args.at(-1) ?? "";
    return JSON.stringify([
      {
        results: [
          {
            users: 40_467,
            chats: 1_240,
            messages: 4_550,
            ai_runs: 500,
            rate_limit_windows: 1_000,
            ops_events: 250,
            activity_runs: 300,
            user_memory_settings: 40_000,
            memory_source_feedback: 1_200,
            suppression_backfill_users: 200,
          },
        ],
        meta: { rows_read: 48_307, rows_written: 0 },
      },
    ]);
  });
  assert.equal(result.rowsWritten, 0);
  assert.deepEqual(result.cardinalities, {
    users: 40_467,
    chats: 1_240,
    messages: 4_550,
    aiRuns: 500,
    rateLimitWindows: 1_000,
    opsEvents: 250,
    activityRuns: 300,
    userMemorySettings: 40_000,
    memorySourceFeedback: 1_200,
    suppressionBackfillUsers: 200,
  });
  assert.match(sql, /SELECT 1 FROM users LIMIT 90001/);
  assert.match(sql, /SELECT 1 FROM ai_runs LIMIT 16662/);
  assert.match(sql, /SELECT 1 FROM ops_events LIMIT 16662/);
  assert.match(sql, /SELECT 1 FROM activity_runs LIMIT 16662/);
  assert.match(sql, /SELECT 1 FROM user_memory_settings LIMIT 90001/);
  assert.match(sql, /SELECT 1 FROM memory_source_feedback LIMIT 16662/);
  assert.match(sql, /SELECT DISTINCT feedback\.user_id/);
  assert.match(sql, /FROM memory_source_feedback LIMIT 16662/);
  assert.match(sql, /INNER JOIN users ON users\.id = feedback\.user_id/);

  assert.throws(
    () =>
      loadRuntimeMigrationCardinalities(() =>
        JSON.stringify([
          {
            results: [
              {
                users: 1,
                chats: 1,
                messages: 1,
                ai_runs: 1,
                rate_limit_windows: 1,
                ops_events: 1,
                activity_runs: 1,
                user_memory_settings: 1,
                memory_source_feedback: 1,
                suppression_backfill_users: 1,
              },
            ],
            meta: { rows_read: 5, rows_written: 1 },
          },
        ]),
      ),
    /unexpectedly reported rows written/,
  );
});
