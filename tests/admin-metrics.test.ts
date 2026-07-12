import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DISPOSABLE_VALIDATION_EMAIL_SUFFIX,
  NATIVE_ADMIN_TOTALS_KEY,
  parseNativeAdminTotalsRow,
  REFRESH_NATIVE_ADMIN_TOTALS_SQL,
} from "../lib/free-runtime/admin-metrics";

test("admin total snapshots accept only bounded non-negative integer data", () => {
  assert.deepEqual(
    parseNativeAdminTotalsRow({
      value: JSON.stringify({ users: 40_467, chats: 1_240, messages: 4_550, aiRuns: 87 }),
      updatedAt: 1_783_762_560_000,
    }),
    {
      users: 40_467,
      chats: 1_240,
      messages: 4_550,
      aiRuns: 87,
      updatedAt: 1_783_762_560_000,
    },
  );

  for (const row of [
    null,
    [],
    { value: "not-json", updatedAt: 1 },
    { value: "[]", updatedAt: 1 },
    { value: JSON.stringify({ users: -1, chats: 1, messages: 1, aiRuns: 1 }), updatedAt: 1 },
    { value: JSON.stringify({ users: 1.5, chats: 1, messages: 1, aiRuns: 1 }), updatedAt: 1 },
    { value: JSON.stringify({ users: "1", chats: 1, messages: 1, aiRuns: 1 }), updatedAt: 1 },
    { value: JSON.stringify({ users: 1, chats: 1, messages: 1, aiRuns: 1 }), updatedAt: -1 },
  ]) {
    assert.equal(parseNativeAdminTotalsRow(row), null);
  }
});

test("admin total refresh is one idempotent metadata-row write over durable counts", () => {
  assert.equal(NATIVE_ADMIN_TOTALS_KEY, "native-admin-totals-v1");
  assert.equal(DISPOSABLE_VALIDATION_EMAIL_SUFFIX, "@inspirlearning.invalid");
  assert.match(REFRESH_NATIVE_ADMIN_TOTALS_SQL, /^insert into app_metadata/i);
  assert.match(REFRESH_NATIVE_ADMIN_TOTALS_SQL, /on conflict \("key"\) do update/i);
  for (const table of ["users", "chats", "messages", "ai_runs"]) {
    assert.match(REFRESH_NATIVE_ADMIN_TOTALS_SQL, new RegExp(`select count\\(\\*\\) from ${table}(?: as|\\s)`));
  }
  assert.equal(
    REFRESH_NATIVE_ADMIN_TOTALS_SQL.match(/lower\([^)]*\.email\) (?:not )?like '%' \|\| \?3/g)?.length,
    4,
  );
  assert.equal(REFRESH_NATIVE_ADMIN_TOTALS_SQL.match(/where not exists \(/g)?.length, 3);
  assert.doesNotMatch(REFRESH_NATIVE_ADMIN_TOTALS_SQL, /(?:insert into|update|delete from) (?:users|chats|messages|ai_runs)/i);

  const migration = fs.readFileSync(
    path.resolve("drizzle-d1/0014_admin_totals_snapshot.sql"),
    "utf8",
  );
  assert.match(migration, /INSERT INTO `app_metadata`/);
  assert.match(migration, /'native-admin-totals-v1'/);
  assert.equal(migration.match(/(?:NOT )?LIKE '%@inspirlearning\.invalid'/g)?.length, 4);
  assert.equal(migration.match(/WHERE NOT EXISTS \(/g)?.length, 3);
  assert.match(migration, /ON CONFLICT \(`key`\) DO UPDATE/);
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM) `(?:users|chats|messages|ai_runs)`/i);
});
