import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  applyD1RuntimeMigration0017,
  assertRuntimeMigration0017ChildIdentityBeforeFirstD1,
  buildRuntimeMigration0017GuardedSql,
  D1_RUNTIME_MIGRATION_0017_GUARD_TABLE,
  D1_RUNTIME_MIGRATION_0017_APPLY_VERIFICATION_REPORT,
  D1_RUNTIME_MIGRATION_0017_OUTCOME_REPORT,
  D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_KIND,
  D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_REPORT,
} from "../scripts/cloudflare/apply-d1-runtime-migration-0017";
import type {
  D1RuntimePre0016StateProof,
} from "../scripts/cloudflare/d1-runtime-pre-0016-state";
import {
  loadRuntimeMigration0017Cardinalities,
  projectRuntimeMigration0017Storage,
  projectRuntimeMigration0017Usage,
  RUNTIME_MIGRATION_0017_FILE,
  RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
  RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
  RUNTIME_MIGRATION_0017_MAX_USERS,
  readAndValidateRuntimeMigration0017BudgetEvidence,
  runRuntimeMigration0017BudgetCheck,
  writeRuntimeMigration0017BudgetReport,
} from "../scripts/cloudflare/check-d1-runtime-migration-0017-budget";
import {
  D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
  type D1DailyUsage,
} from "../scripts/cloudflare/d1-free-budget";
import {
  D1_FREE_STORAGE_ADMISSION_CEILING_BYTES,
  type D1DatabaseStorageInfo,
} from "../scripts/cloudflare/d1-free-storage-admission";
import {
  reserveD1ReleaseBudget,
  type D1ReleaseSourceIdentity,
  readD1ReleaseBudgetLedger,
  readPrivateJsonNoFollow,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  type WranglerRunner,
} from "../scripts/cloudflare/migration-config";
import { buildRepoSourceFingerprint } from "../scripts/cloudflare/source-fingerprint";
import {
  canonicalProductionValidationLockOwner,
  createProductionValidationLockBudget,
  parseStoredProductionValidationLockOwner,
  PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV,
  PRODUCTION_RELEASE_OPERATION_ENV,
  PRODUCTION_VALIDATION_LOCK_KEY,
  type ProductionValidationExclusion,
  type ProductionValidationLockOwner,
} from "../scripts/cloudflare/production-validation-lock";
import {
  evaluateRuntimeMigration0017VerificationRows,
  parseRuntimeMigration0017CliExpectation,
  RUNTIME_MIGRATION_0017_CHECK_ID,
  RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
  RUNTIME_MIGRATION_0017_EXPECT_ABSENT_DEFERRED_FLAG,
  RUNTIME_MIGRATION_0017_VERIFICATION_SQL,
  runtimeMigration0017VerificationReportPath,
  runtimeMigration0017ReportMatchesCliExpectation,
  type RuntimeMigration0017State,
  type RuntimeMigration0017VerificationReport,
} from "../scripts/cloudflare/verify-d1-runtime-migration-0017";
import {
  readHistoricalFresh0016PredecessorPrerequisites,
  verifyHistoricalFresh0016PredecessorRuntimeGate,
} from "../scripts/cloudflare/historical-data-fresh-0016-prerequisites";
import {
  topicAttestationPath,
  translationAttestationPath,
} from "../scripts/cloudflare/release-sequence-attestations";
import {
  buildWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
  workerReleaseMessageSha256,
  writeWorkerCandidateEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const now = new Date("2026-07-15T10:00:00.000Z");
const dailyUsage: D1DailyUsage = {
  databaseCount: 1,
  queryGroups: 1,
  rowsRead: 0,
  rowsWritten: 0,
  executions: 1,
  windowMinutes: 60,
};
const storageInfo: D1DatabaseStorageInfo = {
  databaseName: D1_DATABASE_NAME,
  databaseUuid: D1_DATABASE_ID,
  databaseSizeBytes: 25_000_000,
  tableCount: 30,
};

test("0017 projects bounded Free-plan reads, writes, and storage", () => {
  const measured = {
    cardinalities: {
      users: RUNTIME_MIGRATION_0017_MAX_USERS,
      idUtf8Bytes: RUNTIME_MIGRATION_0017_MAX_USERS * 36,
      emailUtf8Bytes: RUNTIME_MIGRATION_0017_MAX_USERS * 128,
    },
    rowsRead: RUNTIME_MIGRATION_0017_MAX_USERS,
    rowsWritten: 0 as const,
    totalAttempts: 1 as const,
  };
  const projection = projectRuntimeMigration0017Usage(measured);
  assert.ok(projection.rowsRead <= RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ);
  assert.ok(projection.rowsWritten <= RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN);
  assert.equal(projection.indexBuildRowsWritten, RUNTIME_MIGRATION_0017_MAX_USERS * 3);
  const storage = projectRuntimeMigration0017Storage(
    measured.cardinalities,
    storageInfo,
  );
  assert.equal(storage.admissible, true);
  assert.ok(storage.projectedFinalDatabaseBytes < storage.admissionCeilingBytes);

  assert.throws(
    () =>
      projectRuntimeMigration0017Usage({
        ...measured,
        cardinalities: {
          ...measured.cardinalities,
          users: RUNTIME_MIGRATION_0017_MAX_USERS + 1,
        },
      }),
    /outside its bounded range/,
  );
  assert.equal(
    projectRuntimeMigration0017Storage(
      { users: 1, idUtf8Bytes: 36, emailUtf8Bytes: 128 },
      {
        ...storageInfo,
        databaseSizeBytes: D1_FREE_STORAGE_ADMISSION_CEILING_BYTES,
      },
    ).admissible,
    false,
  );
});

test("0017 cardinality evidence requires one bounded read-only D1 attempt", () => {
  const validRunner: WranglerRunner = () =>
    JSON.stringify([
      {
        results: [{ users: 2, id_utf8_bytes: 72, email_utf8_bytes: 40 }],
        meta: { rows_read: 2, rows_written: 0, total_attempts: 1 },
      },
    ]);
  assert.deepEqual(loadRuntimeMigration0017Cardinalities(validRunner), {
    cardinalities: { users: 2, idUtf8Bytes: 72, emailUtf8Bytes: 40 },
    rowsRead: 2,
    rowsWritten: 0,
    totalAttempts: 1,
  });
  assert.throws(
    () =>
      loadRuntimeMigration0017Cardinalities(() =>
        JSON.stringify([
          {
            results: [{ users: 2, id_utf8_bytes: 72, email_utf8_bytes: 40 }],
            meta: { rows_read: 2, rows_written: 0, total_attempts: 2 },
          },
        ]),
      ),
    /exactly one attempt/,
  );
});

test("0017 verifier distinguishes exact, absent, and partial index state", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("create table users (id text primary key not null, email text not null)");
    assert.equal(evaluateRuntimeMigration0017VerificationRows([]).detail.state, "absent");
    database.exec(
      fs.readFileSync(path.resolve(RUNTIME_MIGRATION_0017_FILE), "utf8"),
    );
    const rows = database
      .prepare(RUNTIME_MIGRATION_0017_VERIFICATION_SQL)
      .all()
      .map((row) => ({ ...row }));
    const exact = evaluateRuntimeMigration0017VerificationRows(rows);
    assert.equal(exact.ok, true);
    assert.equal(exact.detail.state, "applied");

    const partial = evaluateRuntimeMigration0017VerificationRows(
      rows.map((row) =>
        row.kind === "schema"
          ? { ...row, index_sql: "create index users_normalized_email_lookup_idx on users(email)" }
          : row,
      ),
    );
    assert.equal(partial.ok, false);
    assert.equal(partial.detail.state, "partial");
  } finally {
    database.close();
  }
});

test("0017 verifier CLI keeps applied verification separate from Free-plan deferral", () => {
  const fixture = makeBudgetFixture();
  try {
    assert.equal(
      parseRuntimeMigration0017CliExpectation(["--confirm-production"]),
      "applied",
    );
    assert.equal(
      parseRuntimeMigration0017CliExpectation([
        "--confirm-production",
        RUNTIME_MIGRATION_0017_EXPECT_ABSENT_DEFERRED_FLAG,
      ]),
      "absent-deferred-free-plan",
    );
    assert.equal(
      parseRuntimeMigration0017CliExpectation([
        RUNTIME_MIGRATION_0017_EXPECT_ABSENT_DEFERRED_FLAG,
        "--confirm-production",
      ]),
      "absent-deferred-free-plan",
    );
    assert.throws(
      () => parseRuntimeMigration0017CliExpectation([]),
      /requires --confirm-production/,
    );
    assert.throws(
      () =>
        parseRuntimeMigration0017CliExpectation([
          "--confirm-production",
          RUNTIME_MIGRATION_0017_EXPECT_ABSENT_DEFERRED_FLAG,
          RUNTIME_MIGRATION_0017_EXPECT_ABSENT_DEFERRED_FLAG,
        ]),
      /at most once/,
    );
    assert.throws(
      () =>
        parseRuntimeMigration0017CliExpectation([
          "--confirm-production",
          "--unsupported",
        ]),
      /accepts only --confirm-production/,
    );

    const absent = migration0017Report(
      fixture.repoDir,
      fixture.backupDir,
      "absent",
    );
    const applied = migration0017Report(
      fixture.repoDir,
      fixture.backupDir,
      "applied",
    );
    const partial = migration0017Report(
      fixture.repoDir,
      fixture.backupDir,
      "partial",
    );
    assert.equal(
      runtimeMigration0017ReportMatchesCliExpectation(absent, "absent-deferred-free-plan"),
      true,
    );
    assert.equal(
      runtimeMigration0017ReportMatchesCliExpectation(absent, "applied"),
      false,
    );
    assert.equal(
      runtimeMigration0017ReportMatchesCliExpectation(applied, "applied"),
      true,
    );
    assert.equal(
      runtimeMigration0017ReportMatchesCliExpectation(applied, "absent-deferred-free-plan"),
      false,
    );
    assert.equal(
      runtimeMigration0017ReportMatchesCliExpectation(partial, "absent-deferred-free-plan"),
      false,
    );
    assert.equal(
      runtimeMigration0017ReportMatchesCliExpectation(
        { ...absent, error: "wrangler failed", totalAttempts: null },
        "absent-deferred-free-plan",
      ),
      false,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("0017 budget retains its conservative maximum instead of refining before verification", () => {
  const fixture = makeBudgetFixture();
  try {
    assert.equal(fixture.report.exact, false);
    assert.equal(fixture.report.reservationPhase, "maximum");
    assert.equal(fixture.report.storage.users, RUNTIME_MIGRATION_0017_MAX_USERS);
    assert.ok(
      fixture.report.storage.idUtf8Bytes > fixture.report.cardinalities.idUtf8Bytes,
    );
    assert.ok(
      fixture.report.storage.emailUtf8Bytes > fixture.report.cardinalities.emailUtf8Bytes,
    );
    const ledger = readD1ReleaseBudgetLedger(fixture.report.ledger.ledgerPath);
    const reservation = ledger.reservations.find(
      (entry) => entry.operationId === "d1-runtime-migration-0017",
    );
    assert.ok(reservation);
    assert.equal(reservation.phase, "maximum");
    assert.equal(
      reservation.candidateVersionId,
      fixture.exclusion.owner.candidateVersionId,
    );
    assert.equal(reservation.rowsRead, RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ);
    assert.equal(reservation.rowsWritten, RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("0017 budget binds reservation and readback to one canonical exclusion snapshot", () => {
  const canonicalCandidate = "11111111-1111-4111-8111-111111111111";
  const driftCandidate = "44444444-4444-4444-8444-444444444444";
  let reservationOwnerReads = 0;
  const fixture = makeBudgetFixture((repoDir) =>
    getterBackedExclusionOwner({
      repoDir,
      canonicalCandidate,
      driftCandidate,
      recordRead: () => {
        reservationOwnerReads += 1;
        return reservationOwnerReads;
      },
    }),
  );
  try {
    const storedOwner = parseStoredProductionValidationLockOwner(
      fixture.report.productionExclusionOwner,
    );
    const ledger = readD1ReleaseBudgetLedger(fixture.report.ledger.ledgerPath);
    const reservation = ledger.reservations.find(
      (entry) => entry.operationId === "d1-runtime-migration-0017",
    );
    assert.ok(reservation);
    assert.equal(storedOwner.candidateVersionId, canonicalCandidate);
    assert.equal(reservation.candidateVersionId, canonicalCandidate);
    assert.equal(reservationOwnerReads, 3);

    let readbackOwnerReads = 0;
    const currentExclusionOwner = getterBackedExclusionOwner({
      repoDir: fixture.repoDir,
      canonicalCandidate,
      driftCandidate,
      recordRead: () => {
        readbackOwnerReads += 1;
        return readbackOwnerReads;
      },
    });
    const source = buildRepoSourceFingerprint(fixture.repoDir);
    const evidence = readAndValidateRuntimeMigration0017BudgetEvidence({
      backupDir: fixture.backupDir,
      currentSource: { sha256: source.sha256, fileCount: source.fileCount },
      currentExclusionOwner,
      now: new Date(now),
    });
    assert.equal(evidence.productionExclusionOwner, fixture.report.productionExclusionOwner);
    assert.equal(readbackOwnerReads, 3);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("0017 atomic SQL binds the live exclusion and removes its admission guard", () => {
  const installedWranglerSource = fs.readFileSync(
    path.resolve("node_modules/wrangler/wrangler-dist/cli.js"),
    "utf8",
  );
  assert.match(
    installedWranglerSource,
    /D1 runs your SQL in a transaction for you\./,
  );
  const owner = {
    candidateVersionId: "11111111-1111-4111-8111-111111111111",
    leaseExpiresAt: Date.now() + 90 * 60 * 1_000,
    leaseId: "22222222-2222-4222-8222-222222222222",
    runId: "33333333-3333-4333-8333-333333333333",
    sourceFingerprintSha256: "a".repeat(64),
  };
  const migrationSql = fs.readFileSync(path.resolve(RUNTIME_MIGRATION_0017_FILE), "utf8");
  const guardedSql = buildRuntimeMigration0017GuardedSql({
    migrationSql,
    exclusionOwner: owner,
  });
  assert.doesNotMatch(guardedSql, /\b(?:BEGIN|COMMIT|ROLLBACK)\b/i);
  assert.match(guardedSql, new RegExp(PRODUCTION_VALIDATION_LOCK_KEY));
  assert.match(guardedSql, new RegExp(D1_RUNTIME_MIGRATION_0017_GUARD_TABLE));

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      "create table users (id text primary key not null, email text not null);" +
        "create table app_metadata (key text primary key not null, value text not null, updated_at integer not null);",
    );
    database.prepare("insert into users (id, email) values (?, ?)").run("user-1", "one@example.com");
    database.prepare("insert into app_metadata (key, value, updated_at) values (?, ?, ?)").run(
      PRODUCTION_VALIDATION_LOCK_KEY,
      canonicalProductionValidationLockOwner(owner),
      Date.now(),
    );
    database.exec(`BEGIN IMMEDIATE;\n${guardedSql}\nCOMMIT;`);
    const indexCount = database
      .prepare("select count(*) as count from sqlite_schema where type = 'index' and name = ?")
      .get("users_normalized_email_lookup_idx");
    const guardCount = database
      .prepare("select count(*) as count from sqlite_schema where type = 'table' and name = ?")
      .get(D1_RUNTIME_MIGRATION_0017_GUARD_TABLE);
    assert.ok(indexCount);
    assert.ok(guardCount);
    assert.deepEqual({ ...indexCount }, { count: 1 });
    assert.deepEqual({ ...guardCount }, { count: 0 });
  } finally {
    database.close();
  }

  const wrongOwnerDatabase = new DatabaseSync(":memory:");
  try {
    wrongOwnerDatabase.exec(
      "create table users (id text primary key not null, email text not null);" +
        "create table app_metadata (key text primary key not null, value text not null, updated_at integer not null);",
    );
    wrongOwnerDatabase
      .prepare("insert into app_metadata (key, value, updated_at) values (?, ?, ?)")
      .run(
        PRODUCTION_VALIDATION_LOCK_KEY,
        canonicalProductionValidationLockOwner({
          ...owner,
          leaseId: "44444444-4444-4444-8444-444444444444",
        }),
        Date.now(),
      );
    assert.throws(() => {
      try {
        wrongOwnerDatabase.exec(`BEGIN IMMEDIATE;\n${guardedSql}\nCOMMIT;`);
      } catch (error) {
        wrongOwnerDatabase.exec("ROLLBACK;");
        throw error;
      }
    }, /NOT NULL constraint failed/);
    const state = wrongOwnerDatabase
      .prepare(
        "select count(*) as indexes, " +
          `(select count(*) from sqlite_schema where type = 'table' and name = '${D1_RUNTIME_MIGRATION_0017_GUARD_TABLE}') as guards ` +
          "from sqlite_schema where type = 'index' and name = 'users_normalized_email_lookup_idx'",
      )
      .get();
    assert.ok(state);
    assert.deepEqual({ ...state }, { indexes: 0, guards: 0 });
  } finally {
    wrongOwnerDatabase.close();
  }
});

test("0017 child validates exact target owner and nofollow upload evidence before first D1", () => {
  const fixture = makeBudgetFixture();
  try {
    const upload = writeRuntimeMigration0017UploadEvidence({
      backupDirectory: fixture.backupDir,
      sourceFingerprint: fixture.releaseIdentity.sourceFingerprint,
      targetCandidateVersionId:
        fixture.releaseIdentity.targetCandidateVersionId,
      serviceBaselineVersionId:
        fixture.releaseIdentity.serviceBaselineVersionId,
    });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      [PRODUCTION_RELEASE_OPERATION_ENV]:
        "apply-d1-runtime-migration-0017",
      [PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV]:
        canonicalProductionValidationLockOwner(fixture.exclusion.owner),
    };
    const checked = assertRuntimeMigration0017ChildIdentityBeforeFirstD1({
      args: ["--confirm-production"],
      backupDir: fixture.backupDir,
      cwd: fixture.repoDir,
      env,
    });
    assert.equal(
      checked.release.targetCandidateVersionId,
      fixture.exclusion.owner.candidateVersionId,
    );
    assert.equal(checked.release.uploadEvidenceSha256, upload.sha256);
    assert.equal(
      checked.owner.candidateVersionId,
      checked.release.targetCandidateVersionId,
    );

    let identityReads = 0;
    assert.throws(
      () =>
        assertRuntimeMigration0017ChildIdentityBeforeFirstD1(
          {
            args: ["--confirm-production", "--unsupported"],
            backupDir: fixture.backupDir,
            cwd: fixture.repoDir,
            env,
          },
          {
            readReleaseIdentity: () => {
              identityReads += 1;
              return fixture.releaseIdentity;
            },
          },
        ),
      /accepts only the exact --confirm-production argument/,
    );
    assert.equal(identityReads, 0);

    assert.throws(
      () =>
        assertRuntimeMigration0017ChildIdentityBeforeFirstD1(
          {
            args: ["--confirm-production"],
            backupDir: fixture.backupDir,
            cwd: fixture.repoDir,
            env: {
              ...env,
              [PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV]:
                canonicalProductionValidationLockOwner({
                  ...fixture.exclusion.owner,
                  candidateVersionId:
                    fixture.releaseIdentity.serviceBaselineVersionId,
                }),
            },
          },
          {
            readReleaseIdentity: () => fixture.releaseIdentity,
          },
        ),
      /owner does not match the canonical inactive candidate.*before first D1/,
    );

    const uploadPath = workerCandidateUploadEvidencePath(fixture.backupDir);
    const realUploadPath = `${uploadPath}.real`;
    fs.renameSync(uploadPath, realUploadPath);
    fs.symlinkSync(realUploadPath, uploadPath);
    assert.throws(
      () =>
        assertRuntimeMigration0017ChildIdentityBeforeFirstD1({
          args: ["--confirm-production"],
          backupDir: fixture.backupDir,
          cwd: fixture.repoDir,
          env,
        }),
      /evidence.*(?:regular|symlink|safely|private)/i,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("0017 apply requires exact pre-0016 state, writes once, and exact-verifies", () => {
  const fixture = makeBudgetFixture();
  try {
    const source = buildRepoSourceFingerprint(fixture.repoDir);
    let verificationCall = 0;
    let writeCalls = 0;
    const runner: WranglerRunner = (args) => {
      if (args[1] === "time-travel") {
        return JSON.stringify({ bookmark: "bookmark-0017-proof" });
      }
      if (args.includes("--file")) {
        writeCalls += 1;
        return "[]";
      }
      throw new Error(`Unexpected Wrangler call: ${args.join(" ")}`);
    };
    const outcome = applyD1RuntimeMigration0017({
      confirmed: true,
      backupDir: fixture.backupDir,
      cwd: fixture.repoDir,
      runner,
      clock: () => new Date(now),
      pre0016StateVerifier: () => pre0016StateProof(fixture.repoDir),
      migration0017Verifier: () => {
        verificationCall += 1;
        return migration0017Report(
          fixture.repoDir,
          fixture.backupDir,
          verificationCall === 1 ? "absent" : "applied",
        );
      },
      storageLoader: () => storageInfo,
      usageLoader: () => dailyUsage,
      exclusionLoader: () => fixture.exclusion,
      releaseIdentityLoader: () => fixture.releaseIdentity,
      cardinalityLoader: () => ({
        cardinalities: { users: 25, idUtf8Bytes: 900, emailUtf8Bytes: 600 },
        rowsRead: 25,
        rowsWritten: 0,
        totalAttempts: 1,
      }),
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, "verified");
    assert.equal(writeCalls, 1);
    assert.equal(verificationCall, 2);
    assert.equal(outcome.stateBefore, "absent");
    assert.equal(outcome.stateAfter, "applied");
    assert.equal(
      outcome.applyVerificationEvidencePath,
      path.join(
        fixture.backupDir,
        "cloudflare",
        D1_RUNTIME_MIGRATION_0017_APPLY_VERIFICATION_REPORT,
      ),
    );
    assert.match(outcome.applyVerificationEvidenceSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(
      fs.statSync(outcome.applyVerificationEvidencePath).mode & 0o777,
      0o600,
    );
    const immutableApplyVerification = readPrivateJsonNoFollow(
      outcome.applyVerificationEvidencePath,
    );
    assert.ok(isRecord(immutableApplyVerification));
    assert.equal(immutableApplyVerification.state, "applied");
    assert.ok(outcome.preWriteEvidencePath);
    assert.equal(fs.statSync(outcome.preWriteEvidencePath).mode & 0o777, 0o600);
    const writeAttemptPath = path.join(
      fixture.backupDir,
      "cloudflare",
      D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_REPORT,
    );
    const writeAttemptStat = fs.statSync(writeAttemptPath);
    assert.equal(writeAttemptStat.mode & 0o777, 0o600);
    assert.equal(writeAttemptStat.nlink, 1);
    const writeAttempt = readPrivateJsonNoFollow(writeAttemptPath);
    assert.ok(isRecord(writeAttempt));
    assert.equal(writeAttempt.kind, D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_KIND);
    assert.equal(writeAttempt.writeAttempted, true);
    assert.equal(writeAttempt.responseConfirmed, false);
    assert.equal(writeAttempt.automaticRetryPermitted, false);
    assert.deepEqual(writeAttempt.sourceFingerprint, {
      sha256: source.sha256,
      fileCount: source.fileCount,
    });
    assert.equal(
      writeAttempt.productionExclusionOwner,
      canonicalProductionValidationLockOwner(fixture.exclusion.owner),
    );
    const markerLedger = writeAttempt.ledger;
    assert.ok(isRecord(markerLedger));
    assert.equal(markerLedger.reservationRetainedAtMaximum, true);
    const markerReservation = markerLedger.reservation;
    assert.ok(isRecord(markerReservation));
    assert.equal(markerReservation.phase, "maximum");
    assert.equal(
      markerReservation.candidateVersionId,
      fixture.exclusion.owner.candidateVersionId,
    );
    assert.equal(markerReservation.rowsRead, RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ);
    assert.equal(
      markerReservation.rowsWritten,
      RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
    );
    const markerAttestation = writeAttempt.guardedSqlAttestation;
    assert.ok(isRecord(markerAttestation));
    const markerGuardedSqlFile = writeAttempt.guardedSqlFile;
    assert.ok(isRecord(markerGuardedSqlFile));
    assert.ok(Array.isArray(writeAttempt.wranglerArgs));
    assert.equal(writeAttempt.wranglerArgs[4], "--file");
    assert.equal(writeAttempt.wranglerArgs[5], markerAttestation.path);
    assert.equal(markerAttestation.sha256, markerGuardedSqlFile.sha256);
    assert.equal(
      fs.statSync(
        path.join(
          fixture.backupDir,
          "cloudflare",
          D1_RUNTIME_MIGRATION_0017_OUTCOME_REPORT,
        ),
      ).mode & 0o777,
      0o600,
    );

    const sourceIdentity = {
      sha256: source.sha256,
      fileCount: source.fileCount,
    };
    const serviceBaselineVersionId =
      "99999999-9999-4999-8999-999999999999";
    const upload = writeRuntimeMigration0017UploadEvidence({
      backupDirectory: fixture.backupDir,
      sourceFingerprint: sourceIdentity,
      targetCandidateVersionId: fixture.exclusion.owner.candidateVersionId,
      serviceBaselineVersionId,
    });
    writeEarlierDayPrerequisiteAttestations({
      backupDirectory: fixture.backupDir,
      sourceFingerprint: sourceIdentity,
      targetCandidateVersionId: fixture.exclusion.owner.candidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256: upload.sha256,
    });
    const predecessorStartAt = new Date("2026-07-16T23:45:00.000Z");
    const liveRuntimeState = verifyRuntimeMigration0017PrerequisiteGate({
      backupDirectory: fixture.backupDir,
      cwd: fixture.repoDir,
      sourceFingerprint: sourceIdentity,
      targetCandidateVersionId: fixture.exclusion.owner.candidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256: upload.sha256,
      predecessorStartAt,
    });
    fs.writeFileSync(
      runtimeMigration0017VerificationReportPath(fixture.backupDir),
      `${JSON.stringify(
        migration0017Report(
          fixture.repoDir,
          fixture.backupDir,
          "absent",
          predecessorStartAt,
        ),
      )}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    const prerequisiteInput = {
      backupDirectory: fixture.backupDir,
      sourceFingerprint: sourceIdentity,
      targetCandidateVersionId: fixture.exclusion.owner.candidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256: upload.sha256,
      predecessorStartAt,
      liveRuntimeState,
    } as const;
    const prerequisites = readHistoricalFresh0016PredecessorPrerequisites(
      prerequisiteInput,
    );
    assert.equal(
      prerequisites.runtimeMigration0017.state,
      "absent-deferred-free-plan",
    );
    assert.equal(
      prerequisites.runtimeMigration0017.verifiedAt,
      predecessorStartAt.toISOString(),
    );

    assert.throws(
      () => readHistoricalFresh0016PredecessorPrerequisites({
        ...prerequisiteInput,
        targetCandidateVersionId:
          "44444444-4444-4444-8444-444444444444",
      }),
      /exact inactive upload evidence/,
    );

    fs.writeFileSync(
      writeAttemptPath,
      `${JSON.stringify({
        ...writeAttempt,
        ledger: {
          ...markerLedger,
          reservation: {
            ...markerReservation,
            candidateVersionId: null,
          },
        },
      }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    assert.doesNotThrow(
      () => readHistoricalFresh0016PredecessorPrerequisites(prerequisiteInput),
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("0017 apply fails closed on a partial pre-state without a write", () => {
  const fixture = makeBudgetFixture();
  try {
    let runnerCalls = 0;
    assert.throws(
      () =>
        applyD1RuntimeMigration0017({
          confirmed: true,
          backupDir: fixture.backupDir,
          cwd: fixture.repoDir,
          runner: () => {
            runnerCalls += 1;
            return "[]";
          },
          clock: () => new Date(now),
          pre0016StateVerifier: () => pre0016StateProof(fixture.repoDir),
          migration0017Verifier: () =>
            migration0017Report(fixture.repoDir, fixture.backupDir, "partial"),
          storageLoader: () => storageInfo,
          usageLoader: () => dailyUsage,
          exclusionLoader: () => fixture.exclusion,
          releaseIdentityLoader: () => fixture.releaseIdentity,
          cardinalityLoader: () => ({
            cardinalities: { users: 25, idUtf8Bytes: 900, emailUtf8Bytes: 600 },
            rowsRead: 25,
            rowsWritten: 0,
            totalAttempts: 1,
          }),
        }),
      /partial or malformed/,
    );
    assert.equal(runnerCalls, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("0017 bounded user creation at the write boundary remains inside the retained maximum", () => {
  const fixture = makeBudgetFixture();
  try {
    let writeCalls = 0;
    let cardinalityCall = 0;
    let verificationCall = 0;
    const outcome = applyD1RuntimeMigration0017({
      confirmed: true,
      backupDir: fixture.backupDir,
      cwd: fixture.repoDir,
      runner: (args) => {
        if (args[1] === "time-travel") {
          return JSON.stringify({ bookmark: "bookmark-0017-proof" });
        }
        if (args.includes("--file")) writeCalls += 1;
        return "[]";
      },
      clock: () => new Date(now),
      pre0016StateVerifier: () => pre0016StateProof(fixture.repoDir),
      migration0017Verifier: () => {
        verificationCall += 1;
        return migration0017Report(
          fixture.repoDir,
          fixture.backupDir,
          verificationCall === 1 ? "absent" : "applied",
        );
      },
      storageLoader: () => storageInfo,
      usageLoader: () => dailyUsage,
      exclusionLoader: () => fixture.exclusion,
      releaseIdentityLoader: () => fixture.releaseIdentity,
      cardinalityLoader: () => {
        cardinalityCall += 1;
        const users = cardinalityCall === 1 ? 25 : 26;
        return {
          cardinalities: {
            users,
            idUtf8Bytes: users * 36,
            emailUtf8Bytes: users * 24,
          },
          rowsRead: users,
          rowsWritten: 0,
          totalAttempts: 1,
        };
      },
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.cardinalitiesAtWrite?.users, 26);
    assert.equal(writeCalls, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("0017 re-admits fresh account usage at the actual write boundary", () => {
  const fixture = makeBudgetFixture();
  try {
    let usageCall = 0;
    let writeCalls = 0;
    assert.throws(
      () =>
        applyD1RuntimeMigration0017({
          confirmed: true,
          backupDir: fixture.backupDir,
          cwd: fixture.repoDir,
          runner: (args) => {
            if (args[1] === "time-travel") {
              return JSON.stringify({ bookmark: "bookmark-0017-proof" });
            }
            if (args.includes("--file")) writeCalls += 1;
            return "[]";
          },
          clock: () => new Date(now),
          pre0016StateVerifier: () => pre0016StateProof(fixture.repoDir),
          migration0017Verifier: () =>
            migration0017Report(fixture.repoDir, fixture.backupDir, "absent"),
          storageLoader: () => storageInfo,
          exclusionLoader: () => fixture.exclusion,
          releaseIdentityLoader: () => fixture.releaseIdentity,
          usageLoader: () => {
            usageCall += 1;
            return usageCall === 1
              ? dailyUsage
              : {
                  ...dailyUsage,
                  rowsWritten:
                    D1_FREE_SAFE_ROWS_WRITTEN_LIMIT -
                    RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN +
                    1,
                };
          },
          cardinalityLoader: () => ({
            cardinalities: { users: 25, idUtf8Bytes: 900, emailUtf8Bytes: 600 },
            rowsRead: 25,
            rowsWritten: 0,
            totalAttempts: 1,
          }),
        }),
      /final write boundary exceeds the reserved Workers Free D1 daily budget/,
    );
    assert.equal(usageCall, 2);
    assert.equal(writeCalls, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("0017 revalidates immutable candidate identity before its sole D1 write", () => {
  const fixture = makeBudgetFixture();
  try {
    let releaseIdentityReads = 0;
    let writeCalls = 0;
    assert.throws(
      () =>
        applyD1RuntimeMigration0017({
          confirmed: true,
          backupDir: fixture.backupDir,
          cwd: fixture.repoDir,
          runner: (args) => {
            if (args[1] === "time-travel") {
              return JSON.stringify({ bookmark: "bookmark-0017-proof" });
            }
            if (args.includes("--file")) writeCalls += 1;
            return "[]";
          },
          clock: () => new Date(now),
          pre0016StateVerifier: () => pre0016StateProof(fixture.repoDir),
          migration0017Verifier: () =>
            migration0017Report(fixture.repoDir, fixture.backupDir, "absent"),
          storageLoader: () => storageInfo,
          exclusionLoader: () => fixture.exclusion,
          releaseIdentityLoader: () => {
            releaseIdentityReads += 1;
            return releaseIdentityReads === 1
              ? fixture.releaseIdentity
              : {
                  ...fixture.releaseIdentity,
                  targetCandidateVersionId:
                    "44444444-4444-4444-8444-444444444444",
                };
          },
          usageLoader: () => dailyUsage,
          cardinalityLoader: () => ({
            cardinalities: { users: 25, idUtf8Bytes: 900, emailUtf8Bytes: 600 },
            rowsRead: 25,
            rowsWritten: 0,
            totalAttempts: 1,
          }),
        }),
      /canonical inactive upload identity changed before final write admission/,
    );
    assert.equal(releaseIdentityReads, 2);
    assert.equal(writeCalls, 0);
    assert.equal(
      fs.existsSync(
        path.join(
          fixture.backupDir,
          "cloudflare",
          D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_REPORT,
        ),
      ),
      false,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("0017 records one indeterminate write attempt and refuses every retry", () => {
  const fixture = makeBudgetFixture();
  try {
    let verificationCall = 0;
    let writeCalls = 0;
    const base = {
      confirmed: true,
      backupDir: fixture.backupDir,
      cwd: fixture.repoDir,
      clock: () => new Date(now),
      pre0016StateVerifier: () => pre0016StateProof(fixture.repoDir),
      storageLoader: () => storageInfo,
      exclusionLoader: () => fixture.exclusion,
      releaseIdentityLoader: () => fixture.releaseIdentity,
      usageLoader: () => dailyUsage,
      cardinalityLoader: () => ({
        cardinalities: { users: 25, idUtf8Bytes: 900, emailUtf8Bytes: 600 },
        rowsRead: 25,
        rowsWritten: 0 as const,
        totalAttempts: 1 as const,
      }),
    };
    assert.throws(
      () =>
        applyD1RuntimeMigration0017({
          ...base,
          runner: (args) => {
            if (args[1] === "time-travel") {
              return JSON.stringify({ bookmark: "bookmark-0017-proof" });
            }
            if (args.includes("--file")) {
              writeCalls += 1;
              throw new Error("lost import response");
            }
            return "[]";
          },
          migration0017Verifier: () => {
            verificationCall += 1;
            return migration0017Report(fixture.repoDir, fixture.backupDir, "absent");
          },
        }),
      /did not exact-verify after its single write attempt/,
    );
    assert.equal(verificationCall, 2);
    assert.equal(writeCalls, 1);

    assert.throws(
      () =>
        applyD1RuntimeMigration0017({
          ...base,
          runner: () => {
            throw new Error("a refused retry must not call Wrangler");
          },
          migration0017Verifier: () =>
            migration0017Report(fixture.repoDir, fixture.backupDir, "absent"),
        }),
      /already durably fenced a write attempt/,
    );
    assert.equal(writeCalls, 1);
    const retained = readD1ReleaseBudgetLedger(fixture.report.ledger.ledgerPath);
    assert.equal(
      retained.reservations.find((entry) => entry.operationId === "d1-runtime-migration-0017")?.phase,
      "maximum",
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test(
  "0017 durable pre-spawn fence survives SIGKILL and prevents a second --file invocation",
  { skip: process.platform === "win32", timeout: 20_000 },
  async () => {
    const fixture = makeBudgetFixture();
    const invocationsPath = path.join(fixture.root, "wrangler-file-invocations.log");
    const readyPath = path.join(fixture.root, "wrangler-file-invoked.ready");
    const writeAttemptPath = path.join(
      fixture.backupDir,
      "cloudflare",
      D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_REPORT,
    );
    const outcomePath = path.join(
      fixture.backupDir,
      "cloudflare",
      D1_RUNTIME_MIGRATION_0017_OUTCOME_REPORT,
    );
    const childSource = runtimeMigration0017SigkillHarnessSource();
    const childArgs = ["--import", "tsx", "--input-type=module", "--eval", childSource];
    let child: ChildProcess | null = null;
    let temporarySqlDirectory: string | null = null;
    try {
      const baseConfig = {
        backupDir: fixture.backupDir,
        repoDir: fixture.repoDir,
        invocationsPath,
        readyPath,
      };
      let childOutput = "";
      child = spawn(process.execPath, childArgs, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          INSPIR_0017_SIGKILL_CONFIG: JSON.stringify({
            ...baseConfig,
            blockOnWrite: true,
          }),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk: Buffer) => {
        childOutput += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        childOutput += chunk.toString("utf8");
      });
      await waitForFileWhileChildRuns(readyPath, child, () => childOutput, 10_000);

      assert.equal(fs.existsSync(writeAttemptPath), true);
      assert.equal(fs.existsSync(outcomePath), false);
      const markerBytesBeforeKill = fs.readFileSync(writeAttemptPath);
      const marker = readPrivateJsonNoFollow(writeAttemptPath);
      assert.ok(isRecord(marker));
      assert.equal(marker.kind, D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_KIND);
      assert.equal(marker.writeAttempted, true);
      assert.equal(marker.responseConfirmed, false);
      assert.equal(marker.automaticRetryPermitted, false);
      const markerStat = fs.statSync(writeAttemptPath);
      assert.equal(markerStat.mode & 0o777, 0o600);
      assert.equal(markerStat.nlink, 1);
      const attestation = marker.guardedSqlAttestation;
      assert.ok(isRecord(attestation));
      const attestedDirectory = attestation.directory;
      assert.ok(isRecord(attestedDirectory));
      const attestedDirectoryPath = attestedDirectory.path;
      assert.equal(typeof attestedDirectoryPath, "string");
      if (typeof attestedDirectoryPath !== "string") {
        throw new Error("SIGKILL marker omitted its attested SQL directory path.");
      }
      temporarySqlDirectory = attestedDirectoryPath;
      assert.ok(Array.isArray(marker.wranglerArgs));
      assert.equal(marker.wranglerArgs[4], "--file");
      assert.equal(marker.wranglerArgs[5], attestation.path);

      assert.equal(child.kill("SIGKILL"), true);
      const killed = await waitForChildClose(child, 5_000);
      assert.equal(killed.signal, "SIGKILL");
      child = null;
      assert.equal(fs.existsSync(outcomePath), false);

      const rerun = spawnSync(process.execPath, childArgs, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          INSPIR_0017_SIGKILL_CONFIG: JSON.stringify({
            ...baseConfig,
            blockOnWrite: false,
          }),
        },
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.notEqual(rerun.status, 0, rerun.stdout);
      assert.match(
        `${rerun.stdout}\n${rerun.stderr}`,
        /already durably fenced a write attempt/u,
      );
      assert.deepEqual(fs.readFileSync(writeAttemptPath), markerBytesBeforeKill);
      const invocations = fs
        .readFileSync(invocationsPath, "utf8")
        .split("\n")
        .filter(Boolean);
      assert.deepEqual(invocations, ["--file"]);
    } finally {
      if (child?.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (temporarySqlDirectory) {
        fs.rmSync(temporarySqlDirectory, { recursive: true, force: true });
      }
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  },
);

function makeBudgetFixture(
  exclusionOwnerFactory?: (repoDir: string) => ProductionValidationLockOwner,
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "inspir-0017-")),
  );
  const repoDir = path.join(root, "repo");
  const backupDir = path.join(root, "evidence");
  fs.mkdirSync(path.join(repoDir, "drizzle-d1"), { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(RUNTIME_MIGRATION_0017_FILE),
    path.join(repoDir, RUNTIME_MIGRATION_0017_FILE),
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const defaultExclusion = testExclusion(repoDir);
  const exclusion: ProductionValidationExclusion = {
    ...defaultExclusion,
    owner: exclusionOwnerFactory?.(repoDir) ?? defaultExclusion.owner,
  };
  const report = runRuntimeMigration0017BudgetCheck({
    backupDir,
    cwd: repoDir,
    clock: () => new Date(now),
    runner: () => {
      throw new Error("Injected 0017 budget dependencies must avoid Wrangler.");
    },
    usageLoader: () => dailyUsage,
    cardinalityLoader: () => ({
      cardinalities: { users: 25, idUtf8Bytes: 900, emailUtf8Bytes: 600 },
      rowsRead: 25,
      rowsWritten: 0,
      totalAttempts: 1,
    }),
    storageLoader: () => storageInfo,
    exclusionOwner: exclusion.owner,
  });
  writeRuntimeMigration0017BudgetReport(backupDir, report);
  const source = buildRepoSourceFingerprint(repoDir);
  const releaseIdentity = {
    targetCandidateVersionId: defaultExclusion.owner.candidateVersionId,
    serviceBaselineVersionId: "99999999-9999-4999-8999-999999999999",
    uploadEvidenceSha256: "a".repeat(64),
    sourceFingerprint: {
      sha256: source.sha256,
      fileCount: source.fileCount,
    },
  } as const;
  return {
    root,
    repoDir,
    backupDir,
    exclusion,
    report,
    releaseIdentity,
  };
}

function getterBackedExclusionOwner(input: Readonly<{
  repoDir: string;
  canonicalCandidate: string;
  driftCandidate: string;
  recordRead: () => number;
}>): ProductionValidationLockOwner {
  const source = buildRepoSourceFingerprint(input.repoDir);
  return {
    get candidateVersionId() {
      return input.recordRead() <= 3
        ? input.canonicalCandidate
        : input.driftCandidate;
    },
    leaseExpiresAt: now.getTime() + 90 * 60 * 1_000,
    leaseId: "22222222-2222-4222-8222-222222222222",
    runId: "33333333-3333-4333-8333-333333333333",
    sourceFingerprintSha256: source.sha256,
  };
}

function testExclusion(repoDir: string): ProductionValidationExclusion {
  const source = buildRepoSourceFingerprint(repoDir);
  return {
    owner: {
      candidateVersionId: "11111111-1111-4111-8111-111111111111",
      leaseExpiresAt: now.getTime() + 90 * 60 * 1_000,
      leaseId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      sourceFingerprintSha256: source.sha256,
    },
    budget: createProductionValidationLockBudget(),
    serverNowMs: now.getTime(),
  };
}

function writeRuntimeMigration0017UploadEvidence(input: Readonly<{
  backupDirectory: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
}>) {
  fs.chmodSync(input.backupDirectory, 0o700);
  const evidencePath = workerCandidateUploadEvidencePath(
    input.backupDirectory,
  );
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(evidencePath), 0o700);
  const releaseMessageSha256 = workerReleaseMessageSha256(
    "runtime-0017 prerequisite candidate fixture",
  );
  const evidence = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-15T06:01:00.000Z",
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    expectedReleaseTag: "runtime-0017-fixture",
    expectedReleaseMessageSha256: releaseMessageSha256,
    uploadCommandEvidenceSha256: "1".repeat(64),
    workerDeployPreparationSha256: "2".repeat(64),
    git: {
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    },
    artifacts: {
      sourceFingerprintSha256: input.sourceFingerprint.sha256,
      sourceFingerprintFileCount: input.sourceFingerprint.fileCount,
      workerSourceSha256: "d".repeat(64),
      wranglerConfigSha256: "e".repeat(64),
      assetManifestSha256: "f".repeat(64),
      assetManifestFileCount: 100,
      assetManifestBytes: 10_000,
    },
    uploadOutput: {
      type: "version-upload",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-fixture-tag",
      versionId: input.targetCandidateVersionId,
      previewUrl: null,
      previewAliasUrl: null,
      wranglerEnvironment: null,
      workerNameOverridden: false,
      timestamp: "2026-07-15T06:00:00.000Z",
    },
    versionView: {
      versionId: input.targetCandidateVersionId,
      createdAt: "2026-07-15T05:59:00.000Z",
      source: "fixture",
      releaseTag: "runtime-0017-fixture",
      releaseMessageSha256,
      resourceConfigSha256: "3".repeat(64),
    },
    soleBaselineTopology: {
      deploymentId: "77777777-7777-4777-8777-777777777777",
      serviceBaselineVersionId: input.serviceBaselineVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  return writeWorkerCandidateEvidence(
    evidencePath,
    evidence,
  );
}

function verifyRuntimeMigration0017PrerequisiteGate(input: Readonly<{
  backupDirectory: string;
  cwd: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  predecessorStartAt: Date;
}>) {
  const topologyObservedAt = new Date(
    input.predecessorStartAt.getTime() - 60_000,
  );
  return verifyHistoricalFresh0016PredecessorRuntimeGate({
    backupDirectory: input.backupDirectory,
    cwd: input.cwd,
    sourceFingerprint: input.sourceFingerprint,
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
    liveDeploymentStatusOutput: JSON.stringify({
      id: "77777777-7777-4777-8777-777777777777",
      versions: [{
        version_id: input.serviceBaselineVersionId,
        percentage: 100,
      }],
    }),
    liveTopologyObservedAt: topologyObservedAt,
    predecessorStartAt: input.predecessorStartAt,
    runner: () => {
      throw new Error("Injected runtime-0017 prerequisite gate must avoid Wrangler.");
    },
    clock: () => new Date(input.predecessorStartAt.getTime() + 60_000),
    usageLoader: () => dailyUsage,
    reserveBudget: reserveD1ReleaseBudget,
    pre0016StateVerifier: () => pre0016StateProof(input.cwd),
    migration0017Verifier: () =>
      migration0017Report(
        input.cwd,
        input.backupDirectory,
        "absent",
        input.predecessorStartAt,
      ),
  });
}

function writeEarlierDayPrerequisiteAttestations(input: Readonly<{
  backupDirectory: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
}>) {
  const release = {
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
    git: {
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    },
    artifactEvidence: {
      sourceFingerprintSha256: input.sourceFingerprint.sha256,
      sourceFingerprintFileCount: input.sourceFingerprint.fileCount,
      workerSourceSha256: "d".repeat(64),
      wranglerConfigSha256: "e".repeat(64),
      assetManifestSha256: "f".repeat(64),
      assetManifestFileCount: 100,
      assetManifestBytes: 10_000,
    },
  } as const;
  const topicCreatedAt = "2026-07-15T08:00:00.000Z";
  fs.writeFileSync(
    topicAttestationPath(input.backupDirectory),
    `${JSON.stringify({
      kind: "production-topic-reconciliation-v1",
      createdAt: topicCreatedAt,
      backupDir: path.resolve(input.backupDirectory),
      status: "reconciled",
      ok: true,
      release,
      vectorizeReadinessCreatedAt: "2026-07-15T07:55:00.000Z",
      topic: {
        seedSha256: "b".repeat(64),
        verifiedTopics: 12,
        verifiedArchivedTopics: 1,
      },
    })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  fs.writeFileSync(
    translationAttestationPath(input.backupDirectory),
    `${JSON.stringify({
      kind: "production-translation-reconciliation-v1",
      createdAt: "2026-07-15T09:00:00.000Z",
      backupDir: path.resolve(input.backupDirectory),
      status: "reconciled",
      ok: true,
      release,
      vectorizeReadinessCreatedAt: "2026-07-15T07:55:00.000Z",
      topicReconciliationCreatedAt: topicCreatedAt,
      method: "read-only-drift",
      verification: {
        remoteQueries: 3,
        billedRowsRead: 100,
        repairApplied: false,
      },
    })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

function pre0016StateProof(repoDir: string): D1RuntimePre0016StateProof {
  const source = buildRepoSourceFingerprint(repoDir);
  return {
    classification: "exact-pre-0016",
    sourceFingerprint: { sha256: source.sha256, fileCount: source.fileCount },
    staticRowsRead: 13,
    probeRowsRead: 9,
    staticTotalAttempts: 1,
    probeTotalAttempts: 1,
    appliedCheckCount: 8,
    absentCheckCount: 5,
    schemaObjectsAbsent: true,
    fixedMarkerAbsent: true,
    freshMarkerAbsent: true,
  };
}

function migration0017Report(
  repoDir: string,
  backupDir: string,
  state: RuntimeMigration0017State,
  createdAt: Date = now,
): RuntimeMigration0017VerificationReport {
  const source = buildRepoSourceFingerprint(repoDir);
  const ok = state === "applied";
  return {
    kind: RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
    schemaVersion: 1,
    createdAt: createdAt.toISOString(),
    backupDir,
    database: D1_DATABASE_NAME,
    migration: RUNTIME_MIGRATION_0017_FILE,
    ok,
    state,
    sourceFingerprintBefore: source,
    sourceFingerprint: source,
    sourceFingerprintStable: true,
    rowsRead: state === "absent" ? 0 : 5,
    rowsWritten: 0,
    totalAttempts: 1,
    checks: [
      {
        id: RUNTIME_MIGRATION_0017_CHECK_ID,
        ok,
        detail: {
          state,
          schemaRows: state === "absent" ? 0 : 1,
          catalogRows: state === "absent" ? 0 : 1,
          keyRows: state === "absent" ? 0 : 3,
          tableMatches: ok,
          sqlMatches: ok,
          catalogMatches: ok,
          keySequenceMatches: ok,
        },
      },
    ],
  };
}

function runtimeMigration0017SigkillHarnessSource() {
  const applyUrl = pathToFileURL(
    path.resolve("scripts/cloudflare/apply-d1-runtime-migration-0017.ts"),
  ).href;
  const budgetUrl = pathToFileURL(
    path.resolve("scripts/cloudflare/check-d1-runtime-migration-0017-budget.ts"),
  ).href;
  const migrationConfigUrl = pathToFileURL(
    path.resolve("scripts/cloudflare/migration-config.ts"),
  ).href;
  const sourceFingerprintUrl = pathToFileURL(
    path.resolve("scripts/cloudflare/source-fingerprint.ts"),
  ).href;
  const productionLockUrl = pathToFileURL(
    path.resolve("scripts/cloudflare/production-validation-lock.ts"),
  ).href;
  const migration0017VerifierUrl = pathToFileURL(
    path.resolve("scripts/cloudflare/verify-d1-runtime-migration-0017.ts"),
  ).href;
  return `
import fs from "node:fs";
import path from "node:path";
import { applyD1RuntimeMigration0017 } from ${JSON.stringify(applyUrl)};
import { RUNTIME_MIGRATION_0017_FILE } from ${JSON.stringify(budgetUrl)};
import { D1_DATABASE_ID, D1_DATABASE_NAME } from ${JSON.stringify(migrationConfigUrl)};
import { buildRepoSourceFingerprint } from ${JSON.stringify(sourceFingerprintUrl)};
import { createProductionValidationLockBudget } from ${JSON.stringify(productionLockUrl)};
import { RUNTIME_MIGRATION_0017_CHECK_ID, RUNTIME_MIGRATION_0017_EVIDENCE_KIND } from ${JSON.stringify(migration0017VerifierUrl)};

const rawConfig = process.env.INSPIR_0017_SIGKILL_CONFIG;
if (!rawConfig) throw new Error("Missing SIGKILL test configuration.");
const config = JSON.parse(rawConfig);
const now = new Date("2026-07-15T10:00:00.000Z");
const source = buildRepoSourceFingerprint(config.repoDir);
const exclusion = {
  owner: {
    candidateVersionId: "11111111-1111-4111-8111-111111111111",
    leaseExpiresAt: now.getTime() + 90 * 60 * 1000,
    leaseId: "22222222-2222-4222-8222-222222222222",
    runId: "33333333-3333-4333-8333-333333333333",
    sourceFingerprintSha256: source.sha256,
  },
  budget: createProductionValidationLockBudget(),
  serverNowMs: now.getTime(),
};
const releaseIdentity = {
  targetCandidateVersionId: exclusion.owner.candidateVersionId,
  serviceBaselineVersionId: "99999999-9999-4999-8999-999999999999",
  uploadEvidenceSha256: "a".repeat(64),
  sourceFingerprint: {
    sha256: source.sha256,
    fileCount: source.fileCount,
  },
};

function fsyncParent(file) {
  const descriptor = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function appendInvocation(file) {
  const descriptor = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, "--file\\n", "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncParent(file);
}

function writeReady(file) {
  const descriptor = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, "ready\\n", "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncParent(file);
}

const pre0016StateProof = {
  classification: "exact-pre-0016",
  sourceFingerprint: { sha256: source.sha256, fileCount: source.fileCount },
  staticRowsRead: 13,
  probeRowsRead: 9,
  staticTotalAttempts: 1,
  probeTotalAttempts: 1,
  appliedCheckCount: 8,
  absentCheckCount: 5,
  schemaObjectsAbsent: true,
  fixedMarkerAbsent: true,
  freshMarkerAbsent: true,
};

const absentReport = {
  kind: RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
  schemaVersion: 1,
  createdAt: now.toISOString(),
  backupDir: config.backupDir,
  database: D1_DATABASE_NAME,
  migration: RUNTIME_MIGRATION_0017_FILE,
  ok: false,
  state: "absent",
  sourceFingerprintBefore: source,
  sourceFingerprint: source,
  sourceFingerprintStable: true,
  rowsRead: 0,
  rowsWritten: 0,
  totalAttempts: 1,
  checks: [{
    id: RUNTIME_MIGRATION_0017_CHECK_ID,
    ok: false,
    detail: {
      state: "absent",
      schemaRows: 0,
      catalogRows: 0,
      keyRows: 0,
      tableMatches: false,
      sqlMatches: false,
      catalogMatches: false,
      keySequenceMatches: false,
    },
  }],
};

try {
  applyD1RuntimeMigration0017({
    confirmed: true,
    backupDir: config.backupDir,
    cwd: config.repoDir,
    clock: () => new Date(now),
    runner: (args) => {
      if (args[1] === "time-travel") {
        return JSON.stringify({ bookmark: "bookmark-0017-sigkill-proof" });
      }
      if (args.includes("--file")) {
        appendInvocation(config.invocationsPath);
        if (config.blockOnWrite) {
          writeReady(config.readyPath);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return "[]";
      }
      throw new Error("Unexpected injected Wrangler call: " + args.join(" "));
    },
    pre0016StateVerifier: () => pre0016StateProof,
    migration0017Verifier: () => absentReport,
    storageLoader: () => ({
      databaseName: D1_DATABASE_NAME,
      databaseUuid: D1_DATABASE_ID,
      databaseSizeBytes: 25_000_000,
      tableCount: 30,
    }),
    cardinalityLoader: () => ({
      cardinalities: { users: 25, idUtf8Bytes: 900, emailUtf8Bytes: 600 },
      rowsRead: 25,
      rowsWritten: 0,
      totalAttempts: 1,
    }),
    usageLoader: () => ({
      databaseCount: 1,
      queryGroups: 1,
      rowsRead: 0,
      rowsWritten: 0,
      executions: 1,
      windowMinutes: 60,
    }),
    exclusionLoader: () => exclusion,
    releaseIdentityLoader: () => releaseIdentity,
  });
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\\n");
  process.exitCode = 1;
}
`;
}

async function waitForFileWhileChildRuns(
  file: string,
  child: ChildProcess,
  output: () => string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `SIGKILL test child exited before its injected --file call: ${output()}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for injected --file call: ${output()}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

function waitForChildClose(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        child.off("close", onClose);
        reject(new Error("Timed out waiting for SIGKILLed child to close."));
      }, timeoutMs);
      const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      };
      child.once("close", onClose);
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
