import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  PRODUCTION_VALIDATION_LOCK_KEY,
  acquireProductionValidationLock,
  acquireProductionValidationExclusion,
  acquireProductionMaintenanceRecoveryExclusion,
  accountProductionValidationLockBilling,
  attestProductionValidationExclusion,
  assertNoLiveProductionValidationLock,
  assertProductionReleaseChildExclusion,
  assertProductionValidationLockAbsent,
  buildProductionValidationLockAcquireSql,
  canonicalProductionValidationLockOwner,
  clearProductionMaintenanceState,
  createProductionMaintenanceState,
  createProductionValidationLockBudget,
  parseD1StatementResult,
  parseProductionValidationLockOwner,
  parseStoredProductionValidationLockOwner,
  PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV,
  PRODUCTION_RELEASE_OPERATION_ENV,
  PRODUCTION_MAINTENANCE_STATE_KEY,
  releaseProductionValidationLock,
  releaseProductionValidationExclusion,
  reserveProductionValidationLockOperation,
  verifyProductionValidationLock,
  type ProductionValidationLockOwner,
  type ProductionValidationLockRunner,
} from "../scripts/cloudflare/production-validation-lock";

const nowMs = Date.now();
const ownerA: ProductionValidationLockOwner = {
  candidateVersionId: "11111111-1111-4111-8111-111111111111",
  leaseExpiresAt: nowMs + 90 * 60_000,
  leaseId: "55555555-5555-4555-8555-555555555555",
  runId: "22222222-2222-4222-8222-222222222222",
  sourceFingerprintSha256: "a".repeat(64),
};
const ownerB: ProductionValidationLockOwner = {
  candidateVersionId: "33333333-3333-4333-8333-333333333333",
  leaseExpiresAt: nowMs + 100 * 60_000,
  leaseId: "66666666-6666-4666-8666-666666666666",
  runId: "44444444-4444-4444-8444-444444444444",
  sourceFingerprintSha256: "b".repeat(64),
};

test("production validation lock owner is canonical exact-schema non-secret JSON", () => {
  const canonical = canonicalProductionValidationLockOwner(ownerA);
  assert.equal(
    canonical,
    `{"candidateVersionId":"${ownerA.candidateVersionId}","leaseExpiresAt":${ownerA.leaseExpiresAt},"leaseId":"${ownerA.leaseId}","runId":"${ownerA.runId}","sourceFingerprintSha256":"${ownerA.sourceFingerprintSha256}"}`,
  );
  assert.deepEqual(parseStoredProductionValidationLockOwner(canonical), ownerA);
  assert.throws(
    () => parseProductionValidationLockOwner({ ...ownerA, email: "owner@example.com" }),
    /wrong schema/,
  );
  assert.throws(
    () => parseStoredProductionValidationLockOwner(JSON.stringify({ ...ownerA, extra: true })),
    /wrong schema/,
  );
  assert.throws(
    () => parseStoredProductionValidationLockOwner(`{ "runId": "${ownerA.runId}" }`),
    /wrong schema/,
  );
});

test("CAS SQL validates exact prior JSON before same-owner renewal or expired takeover", () => {
  const sql = buildProductionValidationLockAcquireSql(ownerA);
  assert.match(sql, /on conflict\("key"\) do update/);
  assert.match(sql, /json_valid\(app_metadata\.value\) = 1/);
  assert.match(sql, /select count\(\*\) from json_each\(app_metadata\.value\)\) = 5/);
  assert.match(sql, /where key not in \('candidateVersionId', 'leaseExpiresAt', 'leaseId', 'runId', 'sourceFingerprintSha256'\)/);
  assert.match(sql, /app_metadata\.value = json_object/);
  assert.match(sql, /strftime\('%s', 'now'\)/);
  assert.match(sql, /returning "key", value, updated_at, .* as server_now/);
  assert.doesNotMatch(sql, /owner@example|E2E_TEST_AUTH|capability|secret/i);
});

test("D1 CAS admits one owner, renews it, rejects a live foreign owner, and releases exactly", () => {
  const database = lockDatabase();
  const runner = sqliteWranglerRunner(database);
  let budget = createProductionValidationLockBudget();
  assert.deepEqual(
    assertProductionValidationLockAbsent({ runner }),
    { rowsRead: 1, serverNowMs: null },
  );
  const acquired = acquireProductionValidationLock({ owner: ownerA, budget, runner });
  budget = acquired.budget;
  assert.deepEqual(acquired.owner, ownerA);
  assert.equal(acquired.recoveredFromLostResponse, false);
  assert.equal(acquired.budget.reservedRowsWritten, 4);
  assert.equal(acquired.budget.billedRowsWritten, 2);
  assert.throws(() => assertProductionValidationLockAbsent({ runner }), /lock is present/);

  const renewedOwner = {
    ...ownerA,
    leaseExpiresAt: nowMs + 110 * 60_000,
    leaseId: "77777777-7777-4777-8777-777777777777",
  };
  assert.throws(
    () => acquireProductionValidationLock({ owner: renewedOwner, budget, runner }),
    /different release run/,
  );
  const renewed = acquireProductionValidationLock({
    owner: renewedOwner,
    previousOwner: ownerA,
    budget,
    runner,
  });
  budget = renewed.budget;
  assert.deepEqual(renewed.owner, renewedOwner);
  const copiedRecoveryOwner = {
    ...renewedOwner,
    leaseId: "88888888-8888-4888-8888-888888888888",
  };
  assert.throws(
    () => acquireProductionValidationLock({
      owner: copiedRecoveryOwner,
      previousOwner: ownerA,
      budget,
      runner,
    }),
    /different release run/,
  );
  assert.throws(
    () => acquireProductionValidationLock({ owner: ownerB, budget, runner }),
    /different release run/,
  );
  assert.deepEqual(verifyProductionValidationLock({ owner: renewedOwner, budget, runner }).owner, renewedOwner);

  const released = releaseProductionValidationLock({ owner: renewedOwner, budget, runner });
  assert.equal(released.recoveredFromLostResponse, false);
  assert.equal(readLockValue(database), null);
  assertProductionValidationLockAbsent({ runner });
});

test("malformed lock rows fail closed while a strict expired owner can be replaced", () => {
  const database = lockDatabase();
  const runner = sqliteWranglerRunner(database);
  writeRawLock(database, "{\"bad\":true}", nowMs - 1);
  assert.throws(
    () => acquireProductionValidationLock({
      owner: ownerB,
      budget: createProductionValidationLockBudget(),
      runner,
    }),
    /malformed JSON|wrong schema|wrong contract/,
  );
  assert.equal(readLockValue(database), "{\"bad\":true}");

  database.prepare("delete from app_metadata").run();
  const expiredOwner = { ...ownerA, leaseExpiresAt: nowMs - 60_000 };
  const nonCanonicalExpiredOwner = JSON.stringify({
    runId: expiredOwner.runId,
    candidateVersionId: expiredOwner.candidateVersionId,
    leaseId: expiredOwner.leaseId,
    leaseExpiresAt: expiredOwner.leaseExpiresAt,
    sourceFingerprintSha256: expiredOwner.sourceFingerprintSha256,
  });
  writeRawLock(database, nonCanonicalExpiredOwner, nowMs - 2);
  assert.throws(
    () => acquireProductionValidationLock({
      owner: ownerB,
      budget: createProductionValidationLockBudget(),
      runner,
    }),
    /not canonical/,
  );
  assert.equal(readLockValue(database), nonCanonicalExpiredOwner);

  database.prepare("delete from app_metadata").run();
  writeRawLock(database, canonicalProductionValidationLockOwner(expiredOwner), nowMs - 2);
  const available = assertNoLiveProductionValidationLock({ runner });
  assert.equal(available.available, true);
  assert.deepEqual(available.expiredOwner, expiredOwner);
  assert.throws(
    () => verifyProductionValidationLock({
      owner: expiredOwner,
      budget: createProductionValidationLockBudget(),
      runner,
    }),
    /expired according to D1/,
  );
  const acquired = acquireProductionValidationLock({
    owner: ownerB,
    budget: createProductionValidationLockBudget(),
    runner,
  });
  assert.deepEqual(acquired.owner, ownerB);
  assert.throws(() => assertNoLiveProductionValidationLock({ runner }), /lock is live/);
});

test("real Miniflare D1 expired takeover billing fits the reserved acquire projection", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: { DB: "production-validation-lock-test" },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    await database.prepare(`create table app_metadata (
      "key" text primary key not null,
      value text not null,
      updated_at integer not null
    )`).run();
    const expiredOwner = { ...ownerA, leaseExpiresAt: Date.now() - 60_000 };
    await database.prepare(
      "insert into app_metadata (\"key\", value, updated_at) values (?1, ?2, ?3)",
    ).bind(
      PRODUCTION_VALIDATION_LOCK_KEY,
      canonicalProductionValidationLockOwner(expiredOwner),
      Date.now() - 60_000,
    ).run();

    const takeover = await database.prepare(
      buildProductionValidationLockAcquireSql(ownerB),
    ).run();
    assert.ok(takeover.meta.rows_read >= 18);
    assert.ok(takeover.meta.rows_read <= 32);
    assert.ok(takeover.meta.rows_written <= 4);
    assert.equal(takeover.results.length, 1);
    assert.equal(takeover.results[0]?.value, canonicalProductionValidationLockOwner(ownerB));

    const reserved = reserveProductionValidationLockOperation(
      createProductionValidationLockBudget(),
      "acquire",
    );
    const accounted = accountProductionValidationLockBilling(reserved, "acquire", {
      rowsRead: takeover.meta.rows_read,
      rowsWritten: takeover.meta.rows_written,
    });
    assert.equal(accounted.billedRowsRead, takeover.meta.rows_read);
    assert.equal(accounted.billedRowsWritten, takeover.meta.rows_written);
  } finally {
    await miniflare.dispose();
  }
});

test("D1 server time rejects client-skewed lease targets before inserting a lock", () => {
  const database = lockDatabase();
  const runner = sqliteWranglerRunner(database);
  for (const leaseExpiresAt of [nowMs + 30 * 60_000, nowMs + 3 * 60 * 60_000]) {
    assert.throws(
      () => acquireProductionValidationLock({
        owner: { ...ownerA, leaseExpiresAt },
        budget: createProductionValidationLockBudget(),
        runner,
      }),
      /did not return one owned row/,
    );
    assert.equal(readLockValue(database), null);
  }
});

test("a deploy or maintenance process holds the same global exclusion as validation", () => {
  const database = lockDatabase();
  const runner = sqliteWranglerRunner(database);
  let exclusion = acquireProductionValidationExclusion({
    candidateVersionId: ownerA.candidateVersionId,
    sourceFingerprintSha256: ownerA.sourceFingerprintSha256,
    runner,
  });
  assert.throws(
    () => acquireProductionValidationLock({
      owner: ownerB,
      budget: createProductionValidationLockBudget(),
      runner,
    }),
    /different release run/,
  );
  exclusion = attestProductionValidationExclusion(exclusion, runner);
  assert.ok(exclusion.budget.operations >= 2);
  releaseProductionValidationExclusion(exclusion, runner);
  assertProductionValidationLockAbsent({ runner });
});

test("a production release child proves its exact operation and live owner", () => {
  const database = lockDatabase();
  const runner = sqliteWranglerRunner(database);
  const acquired = acquireProductionValidationLock({
    owner: ownerA,
    budget: createProductionValidationLockBudget(),
    runner,
  });
  const env = {
    ...process.env,
    [PRODUCTION_RELEASE_OPERATION_ENV]: "sync-topic-seeds",
    [PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV]: canonicalProductionValidationLockOwner(ownerA),
  };
  const verified = assertProductionReleaseChildExclusion("sync-topic-seeds", { env, runner });
  assert.deepEqual(verified.owner, ownerA);
  assert.throws(
    () => assertProductionReleaseChildExclusion("sync-site-translation-sources", { env, runner }),
    /guarded release-operation wrapper/,
  );
  releaseProductionValidationLock({ owner: ownerA, budget: acquired.budget, runner });
});

test("durable maintenance state blocks ordinary owners and has one exact recovery path", () => {
  const database = lockDatabase();
  const runner = sqliteWranglerRunner(database);
  let exclusion = acquireProductionValidationExclusion({
    candidateVersionId: ownerA.candidateVersionId,
    sourceFingerprintSha256: ownerA.sourceFingerprintSha256,
    runner,
  });
  const state = {
    candidateVersionId: exclusion.owner.candidateVersionId,
    lockRunId: exclusion.owner.runId,
    maintenanceVersionId: ownerB.candidateVersionId,
    repairRunId: "99999999-9999-4999-8999-999999999999",
    sourceFingerprintSha256: exclusion.owner.sourceFingerprintSha256,
    startedAt: Date.now(),
  };
  const created = createProductionMaintenanceState({ exclusion, state, runner });
  exclusion = created.exclusion;
  releaseProductionValidationExclusion(exclusion, runner);

  assert.throws(
    () => acquireProductionValidationExclusion({
      candidateVersionId: ownerA.candidateVersionId,
      sourceFingerprintSha256: ownerA.sourceFingerprintSha256,
      runner,
    }),
    /maintenance is unresolved/,
  );

  let recovery = acquireProductionMaintenanceRecoveryExclusion({ state, runner });
  const cleared = clearProductionMaintenanceState({ exclusion: recovery, state, runner });
  recovery = cleared.exclusion;
  releaseProductionValidationExclusion(recovery, runner);
  const next = acquireProductionValidationExclusion({
    candidateVersionId: ownerA.candidateVersionId,
    sourceFingerprintSha256: ownerA.sourceFingerprintSha256,
    runner,
  });
  releaseProductionValidationExclusion(next, runner);
});

test("maintenance marker billing overflow is never reclassified as a lost response", () => {
  const database = lockDatabase();
  const baseRunner = sqliteWranglerRunner(database);
  const exclusion = acquireProductionValidationExclusion({
    candidateVersionId: ownerA.candidateVersionId,
    sourceFingerprintSha256: ownerA.sourceFingerprintSha256,
    runner: baseRunner,
  });
  const state = {
    candidateVersionId: exclusion.owner.candidateVersionId,
    lockRunId: exclusion.owner.runId,
    maintenanceVersionId: ownerB.candidateVersionId,
    repairRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceFingerprintSha256: exclusion.owner.sourceFingerprintSha256,
    startedAt: Date.now(),
  };
  let markerWrites = 0;
  const excessiveRunner: ProductionValidationLockRunner = (args) => {
    const output = baseRunner(args);
    const sql = args.at(-1) ?? "";
    if (!sql.includes(PRODUCTION_MAINTENANCE_STATE_KEY) || !/^insert into app_metadata/i.test(sql.trim())) {
      return output;
    }
    markerWrites += 1;
    const parsed = JSON.parse(output) as Array<{ meta: Record<string, unknown> }>;
    parsed[0]!.meta.rows_read = 33;
    return JSON.stringify(parsed);
  };
  assert.throws(
    () => createProductionMaintenanceState({ exclusion, state, runner: excessiveRunner }),
    /exceeded its D1 budget/,
  );
  assert.equal(markerWrites, 1);
});

test("release accepts a lost command response only after exact absent readback", () => {
  const database = lockDatabase();
  const baseRunner = sqliteWranglerRunner(database);
  const acquired = acquireProductionValidationLock({
    owner: ownerA,
    budget: createProductionValidationLockBudget(),
    runner: baseRunner,
  });
  let lost = false;
  const lostReleaseRunner: ProductionValidationLockRunner = (args) => {
    const output = baseRunner(args);
    const sql = args.at(-1) ?? "";
    if (!lost && /^delete from app_metadata/i.test(sql.trim())) {
      lost = true;
      throw new Error("simulated lost Wrangler response");
    }
    return output;
  };
  const released = releaseProductionValidationLock({
    owner: ownerA,
    budget: acquired.budget,
    runner: lostReleaseRunner,
  });
  assert.equal(released.recoveredFromLostResponse, true);
  assert.equal(readLockValue(database), null);
});

test("acquire accepts a lost command response only after exact owned readback", () => {
  const database = lockDatabase();
  const baseRunner = sqliteWranglerRunner(database);
  let lost = false;
  const lostAcquireRunner: ProductionValidationLockRunner = (args) => {
    const output = baseRunner(args);
    const sql = args.at(-1) ?? "";
    if (!lost && /^insert into app_metadata/i.test(sql.trim())) {
      lost = true;
      throw new Error("simulated lost Wrangler response");
    }
    return output;
  };
  const acquired = acquireProductionValidationLock({
    owner: ownerA,
    budget: createProductionValidationLockBudget(),
    runner: lostAcquireRunner,
  });
  assert.equal(acquired.recoveredFromLostResponse, true);
  assert.deepEqual(acquired.owner, ownerA);
  assert.equal(readLockValue(database), canonicalProductionValidationLockOwner(ownerA));
});

test("acquire never reclassifies excessive D1 billing as a lost response", () => {
  let calls = 0;
  const excessiveBillingRunner: ProductionValidationLockRunner = () => {
    calls += 1;
    return JSON.stringify([{
      success: true,
      results: [{
        key: PRODUCTION_VALIDATION_LOCK_KEY,
        server_now: nowMs,
        updated_at: nowMs,
        value: canonicalProductionValidationLockOwner(ownerA),
      }],
      meta: {
        rows_read: 33,
        rows_written: 1,
      },
    }]);
  };
  assert.throws(
    () => acquireProductionValidationLock({
      owner: ownerA,
      budget: createProductionValidationLockBudget(),
      runner: excessiveBillingRunner,
    }),
    /exceeded its reserved D1 rows/,
  );
  assert.equal(calls, 1);
});

test("D1 parser and cumulative reservation fail closed on malformed or excessive billing", () => {
  assert.throws(() => parseD1StatementResult("[]"), /result-set count/);
  assert.throws(
    () => parseD1StatementResult(JSON.stringify([{ success: true, results: [], meta: {} }])),
    /rows_read/,
  );
  let budget = createProductionValidationLockBudget();
  assert.throws(() => {
    for (let index = 0; index < 200; index += 1) {
      budget = reserveProductionValidationLockOperation(budget, "verify");
    }
  }, /bounded D1 release budget/);
});

function lockDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`create table app_metadata (
    "key" text primary key not null,
    value text not null,
    updated_at integer not null
  )`);
  return database;
}

function sqliteWranglerRunner(database: DatabaseSync): ProductionValidationLockRunner {
  return (args) => {
    assert.deepEqual(args.slice(0, 5), [
      "d1",
      "execute",
      "inspirlearning-prod",
      "--remote",
      "--json",
    ]);
    assert.equal(args[5], "--command");
    const sql = args[6] ?? "";
    const rows = database.prepare(sql).all();
    const mutating = /^(?:insert|delete)\b/i.test(sql.trim());
    const changes = database.prepare("select changes() as changes").get()?.changes;
    if (typeof changes !== "number") throw new Error("SQLite changes() fixture is invalid.");
    return JSON.stringify([{
      success: true,
      results: rows,
      meta: {
        rows_read: Math.min(4, rows.length + 1),
        rows_written: mutating ? changes * 2 : 0,
      },
    }]);
  };
}

function writeRawLock(database: DatabaseSync, value: string, updatedAt: number) {
  database.prepare(
    "insert into app_metadata (\"key\", value, updated_at) values (?1, ?2, ?3)",
  ).run(PRODUCTION_VALIDATION_LOCK_KEY, value, updatedAt);
}

function readLockValue(database: DatabaseSync) {
  const value = database.prepare(
    "select value from app_metadata where \"key\" = ?1",
  ).get(PRODUCTION_VALIDATION_LOCK_KEY)?.value;
  assert.ok(value === undefined || typeof value === "string");
  return value ?? null;
}
