import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES,
  STAGED_TRANSLATION_D1_PLAN_KIND,
  STAGED_TRANSLATION_D1_RELEASE_MODE,
  buildExactStagedD1StorageAdmission,
  buildStagedTranslationD1Sql,
  compactReleaseSourceFingerprint,
  readAndValidateStagedTranslationD1LocalAuthorization,
  validateStagedTranslationD1ResumeEvidence,
  verifyRemoteStagedTranslationD1,
  writeStagedTranslationD1LocalAuthorization,
  writeStagedTranslationD1ResumeEvidence,
  type StagedTranslationD1Plan,
  type StagedTranslationD1Row,
} from "../scripts/cloudflare/reconcile-staged-translation-fallback";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
} from "../scripts/cloudflare/migration-config";
import { splitSqlStatements } from "../scripts/cloudflare/repair-seo-cta-translations";
import type { StagedTranslationReconciliationBinding } from "../scripts/cloudflare/release-sequence-attestations";
import {
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
  buildSiteTranslationSourceSyncPlan,
} from "../scripts/cloudflare/sync-site-translation-sources";
import { CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND } from "../scripts/staged-translation-fallback-release-attestation";

const rows = Object.freeze([
  Object.freeze({
    namespace: "main-app",
    language: "Afrikaans",
    sourceHash: hash("main-app-source"),
    payload: Object.freeze({ greeting: "Hallo", prompt: "Leer nou" }),
    model: "codex-curated-free-static-no-games-main-app-v1",
    sourceRelativePath: "translations/static-main-app/af.json",
    sourceFileSha256: hash("main-app-file"),
    partition: "main-app",
  }),
  Object.freeze({
    namespace: "route:home",
    language: "Spanish",
    sourceHash: hash("route-home-source"),
    payload: Object.freeze({ greeting: "Hola", prompt: "Aprende ahora" }),
    model: "fixture-curated-model",
    sourceRelativePath: "translations/curated/es/route__home.json",
    sourceFileSha256: hash("route-home-file"),
    partition: "site",
  }),
]) satisfies readonly StagedTranslationD1Row[];

test("staged SQL resets exact payloads, deletes every non-member, and guards the symmetric set", () => {
  const sql = buildStagedTranslationD1Sql(rows);
  const statements = splitSqlStatements(sql);
  assert.match(sql, /DELETE FROM app_translations[\s\S]*NOT EXISTS/);
  assert.match(sql, /staged-translation-exact-partition-guard-failed/);
  assert.equal(sql.includes("marketing-site"), false);
  assert.equal(
    statements.filter((statement) => /^INSERT INTO app_translations/m.test(statement)).length,
    rows.length,
  );
  assert.equal(
    statements.filter(
      (statement) =>
        /^INSERT INTO app_translations/m.test(statement) &&
        /json\('\{\}'\)/.test(statement),
    ).length,
    rows.length,
  );
  assert.ok(
    statements.every(
      (statement) => Buffer.byteLength(statement, "utf8") <= 100_000,
    ),
  );
});

test("staged SQL rejects duplicates, unsorted rows, and oversized fields", () => {
  assert.throws(
    () => buildStagedTranslationD1Sql([rows[0], rows[0]]),
    /duplicates/,
  );
  assert.throws(
    () => buildStagedTranslationD1Sql([rows[1], rows[0]]),
    /canonical order/,
  );
  assert.throws(
    () => buildStagedTranslationD1Sql([
      {
        ...rows[0],
        payload: { greeting: "x".repeat(100_000) },
      },
    ]),
    /oversized|exceeds/i,
  );
});

test("verify-only staged reconciliation byte-checks every allowed row with read-only D1", () => {
  const plan = fixturePlan();
  const observedCommands: string[][] = [];
  const report = verifyRemoteStagedTranslationD1({
    plan,
    now: new Date("2026-07-15T20:00:00.000Z"),
    runner: (args) => {
      observedCommands.push([...args]);
      const sql = args.at(-1) ?? "";
      if (sql.includes("observed_rows")) {
        return d1Output([{
          observed_rows: rows.length,
          present_rows: rows.length,
          duplicate_rows: 0,
        }]);
      }
      return d1Output(rows.map((row) => ({
        namespace: row.namespace,
        language: row.language,
        source_hash: row.sourceHash,
        payload: JSON.stringify(row.payload),
        model: row.model,
      })));
    },
  });
  assert.equal(report.ok, true);
  assert.equal(report.payloadRowsMatched, rows.length);
  assert.equal(report.databaseWrites, 0);
  assert.equal(report.exactAlready, true);
  assert.equal(report.cleanupRequiredAfterCandidateActivation, true);
  assert.ok(report.remoteQueries >= 2);
  const summarySql = observedCommands[0]?.at(-1) ?? "";
  assert.match(summarySql, /expected_presence AS/);
  assert.doesNotMatch(
    summarySql,
    /FROM app_translations AS target\s+WHERE NOT EXISTS[\s\S]*expected_staged AS expected/,
  );
  assert.ok(
    observedCommands.every(
      (args) =>
        args.includes("--remote") &&
        args.includes("--json") &&
        args.includes("--command") &&
        !args.includes("--file") &&
        !args.includes("--yes"),
    ),
  );
});

test("verify-only staged reconciliation reports extras and byte drift without writing", () => {
  const plan = fixturePlan();
  let query = 0;
  const report = verifyRemoteStagedTranslationD1({
    plan,
    runner: () => {
      query += 1;
      if (query === 1) {
        return d1Output([{
          observed_rows: rows.length + 1,
          present_rows: rows.length,
          duplicate_rows: 0,
        }]);
      }
      return d1Output(rows.map((row, index) => ({
        namespace: row.namespace,
        language: row.language,
        source_hash: row.sourceHash,
        payload: index === 0 ? "{}" : JSON.stringify(row.payload),
        model: row.model,
      })));
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.repairRequired, true);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ["exact-partition-drift", "payload-or-metadata-drift"],
  );
  assert.equal(report.databaseWrites, 0);
});

test("verify-only staged reconciliation rejects missing or retried D1 billing attempts", () => {
  const plan = fixturePlan();
  for (const totalAttempts of [null, 2] as const) {
    assert.throws(
      () =>
        verifyRemoteStagedTranslationD1({
          plan,
          runner: () => d1Output([], totalAttempts),
        }),
      /billing metadata/,
    );
  }
});

test("resume evidence is owner-only and rejects plan drift, hardlinks, and symlinks", () => {
  const backupDir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "staged-translation-resume-")),
  );
  fs.chmodSync(backupDir, 0o700);
  fs.mkdirSync(path.join(backupDir, "cloudflare"), { mode: 0o700 });
  try {
    const plan = fixturePlan();
    const written = writeStagedTranslationD1ResumeEvidence({
      plan,
      backupDir,
      createdAt: new Date("2026-07-15T20:00:00.000Z"),
    });
    assert.equal(fs.statSync(written.file).mode & 0o777, 0o600);
    assert.equal(
      validateStagedTranslationD1ResumeEvidence({
        evidencePath: written.file,
        plan,
      }).planSha256,
      written.evidence.planSha256,
    );
    assert.throws(
      () => validateStagedTranslationD1ResumeEvidence({
        evidencePath: written.file,
        plan: { ...plan, sqlSha256: hash("changed-sql") },
      }),
      /stale, mixed, or tampered/,
    );
    const hardlink = path.join(backupDir, "hardlink.json");
    fs.linkSync(written.file, hardlink);
    assert.throws(
      () => validateStagedTranslationD1ResumeEvidence({
        evidencePath: hardlink,
        plan,
      }),
      /single-link|hardlink|regular owner-only|nlink/i,
    );
    fs.unlinkSync(hardlink);
    const symlink = path.join(backupDir, "symlink.json");
    fs.symlinkSync(written.file, symlink);
    assert.throws(
      () => validateStagedTranslationD1ResumeEvidence({
        evidencePath: symlink,
        plan,
      }),
      /symbolic|nofollow|regular owner-only|ELOOP/i,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("local staged authorization binds the exact plan while granting no production or deploy authority", () => {
  const backupDir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "staged-translation-authority-")),
  );
  fs.chmodSync(backupDir, 0o700);
  fs.mkdirSync(path.join(backupDir, "cloudflare"), { mode: 0o700 });
  try {
    const plan = fixturePlan();
    const written = writeStagedTranslationD1LocalAuthorization({
      plan,
      backupDir,
      createdAt: new Date("2026-07-15T20:00:00.000Z"),
    });
    const verified = readAndValidateStagedTranslationD1LocalAuthorization({
      authorizationPath: written.file,
      plan,
    });
    assert.equal(verified.satisfiesLocalStagedReconciliationInput, true);
    assert.equal(verified.grantsProductionReadByItself, false);
    assert.equal(verified.grantsProductionWriteByItself, false);
    assert.equal(verified.grantsDeploymentByItself, false);
    assert.equal(verified.canReadProduction, false);
    assert.equal(verified.canWriteProduction, false);
    assert.equal(verified.canDeploy, false);
    assert.throws(
      () => readAndValidateStagedTranslationD1LocalAuthorization({
        authorizationPath: written.file,
        plan: { ...plan, payloadCorpusSha256: hash("changed-payload") },
      }),
      /stale, mixed, or tampered/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("candidate-active cleanup is ordered after activation and preserves source catalog rows", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "scripts/cloudflare/reconcile-staged-translation-fallback.ts",
    ),
    "utf8",
  );
  const cleanupStart = source.indexOf(
    "export function runCandidateActiveStagedTranslationD1Cleanup",
  );
  const cleanupEnd = source.indexOf(
    "function assertCandidateActiveStagedCleanupGate",
  );
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);
  assert.ok(
    cleanup.indexOf("assertCandidateActiveStagedCleanupGate({") <
      cleanup.indexOf("reserveD1ReleaseBudget({"),
  );
  assert.match(
    cleanup,
    /admissionMode: D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE/,
  );
  assert.doesNotMatch(cleanup, /assertD1FreeDailyBudget\(usage/);
  assert.doesNotMatch(cleanup, /loadAccountD1DailyUsage\(startedAt/);
  assert.doesNotMatch(cleanup, /idempotent\s*!==\s*false/);
  assert.match(cleanup, /paidExpeditedD1ObservedUsageFloor\(startedAt\)/);
  assert.match(cleanup, /cleanupReadAttemptPath/);
  assert.ok(
    cleanup.indexOf("reserveD1ReleaseBudget({") <
      cleanup.indexOf("acquireProductionValidationExclusion({"),
  );
  assert.ok(
    cleanup.indexOf("deployPinnedWorkerVersion(\n      maintenanceVersionId") <
      cleanup.indexOf("runBoundedMutationWrangler("),
  );
  assert.match(
    cleanup,
    /probeNativeWriteFreezeWithPropagationRetry\(\s*true,\s*maintenanceVersionId,\s*\)/,
  );
  assert.match(source, /nativeWriteFreezePropagationProbeAttempts = 18/);
  assert.ok(
    cleanup.indexOf("verifyRemoteStagedTranslationD1({ plan })", 1) <
      cleanup.lastIndexOf("deployPinnedWorkerVersion("),
  );
  assert.match(
    source,
    /--apply-cleanup[\s\S]*--confirm-native-write-freeze[\s\S]*--phase candidate-active/,
  );
  assert.match(
    source,
    /sourceFingerprint: compactReleaseSourceFingerprint\(input\.sourceFingerprint\)/,
  );
  assert.match(
    source,
    /cleanupWriteCeiling: STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES/,
  );
  assert.ok(
    STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES >
      MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
  );
  assert.ok(
    67_139 <= STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES,
    "paid cleanup ceiling must cover the observed candidate-active before-import projection",
  );

  const additiveSourcePlan = buildSiteTranslationSourceSyncPlan();
  assert.equal(
    /DELETE FROM app_translation_sources|DELETE FROM app_translation_source_strings/.test(
      additiveSourcePlan.sql,
    ),
    false,
  );
  assert.ok(additiveSourcePlan.logicalRowWrites > 0);
});

test("current fallback storage admission is separately pinned to exactly 668 unique rows", () => {
  const translationRows = Array.from({ length: 668 }, (_, index) => ({
    namespace: `fixture:${index}`,
    language: `Language ${index}`,
    sourceHash: hash(`source-${index}`),
    payloadJson: JSON.stringify({ value: `Translation ${index}` }),
    model: "fixture-model",
  }));
  const database = {
    databaseName: D1_DATABASE_NAME,
    databaseUuid: D1_DATABASE_ID,
    databaseSizeBytes: 0,
    tableCount: 1,
  };
  const admitted = buildExactStagedD1StorageAdmission({
    database,
    translationRows,
    sourceEntries: [],
  });
  assert.equal(admitted.plannedTranslationRows, 668);
  assert.throws(
    () => buildExactStagedD1StorageAdmission({
      database,
      translationRows: translationRows.slice(1),
      sourceEntries: [],
    }),
    /requires 668 translation rows/,
  );
  assert.throws(
    () => buildExactStagedD1StorageAdmission({
      database,
      translationRows: [...translationRows.slice(0, -1), translationRows[0]!],
      sourceEntries: [],
    }),
    /duplicate translation rows/,
  );
});

test("release source fingerprint identity omits bulky file inventories from staged evidence", () => {
  const sourceFingerprint = {
    sha256: hash("release-source"),
    fileCount: 2,
    files: [
      { path: "app/page.tsx", sha256: hash("page") },
      { path: "scripts/cloudflare/reconcile-staged-translation-fallback.ts", sha256: hash("tool") },
    ],
  } as const;
  const compact = compactReleaseSourceFingerprint(sourceFingerprint);
  assert.deepEqual(compact, {
    sha256: sourceFingerprint.sha256,
    fileCount: sourceFingerprint.fileCount,
  });
  assert.equal(Object.hasOwn(compact, "files"), false);
  assert.ok(JSON.stringify(compact).length < 160);
});

function fixturePlan(): StagedTranslationD1Plan {
  const sql = buildStagedTranslationD1Sql(rows);
  return Object.freeze({
    kind: STAGED_TRANSLATION_D1_PLAN_KIND,
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    stagedRelease: stagedBinding(),
    counts: Object.freeze({
      siteRows: 1,
      mainAppRows: 1,
      exactRows: 2,
      deferredMissingRows: 7,
      deferredStaleRows: 3,
    }),
    rowSetSha256: hash("row-set"),
    payloadCorpusSha256: hash("payload-corpus"),
    sqlSha256: hash(sql),
    sqlBytes: Buffer.byteLength(sql, "utf8"),
    sqlStatements: splitSqlStatements(sql).length,
    largestSqlStatementBytes: Math.max(
      ...splitSqlStatements(sql).map((statement) =>
        Buffer.byteLength(statement, "utf8")
      ),
    ),
    logicalUpsertWrites: splitSqlStatements(sql).filter((statement) =>
      /^(?:INSERT|UPDATE)\b/i.test(statement.trim())
    ).length,
    sql,
    rows,
  });
}

function stagedBinding(): StagedTranslationReconciliationBinding {
  return {
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    attestationKind: CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND,
    sitePromotionMode: "none-current-availability",
    artifactFileSha256: hash("artifact-file"),
    attestationSha256: hash("attestation"),
    sourceManifestFileSha256: hash("source-manifest"),
    sourceCatalogRootSha256: hash("source-root"),
    availabilityManifestFileSha256: hash("availability-file"),
    availabilityLogicalSha256: hash("availability-logical"),
    availabilityNamespaceEntries: 2,
    localizedHtmlPaths: 2,
    localizedHtmlPathsSha256: hash("localized-paths"),
    curatedSiteTreeSha256: hash("curated-tree"),
    staticMainAppTreeSha256: hash("main-tree"),
    targetSetSha256: hash("targets"),
    cleanTargetSetSha256: hash("clean-targets"),
    pendingLedgerSha256: hash("pending"),
    pendingEntries: 10,
    pendingMissing: 7,
    pendingStale: 3,
    fallbackPolicySha256: hash("fallback-policy"),
    d1Corpus: {
      siteRows: 1,
      mainAppRows: 1,
      exactRows: 2,
      rowSetSha256: hash("row-set"),
      payloadCorpusSha256: hash("payload-corpus"),
      cutoverPolicy:
        "preserve-serving-baseline-until-candidate-active-cleanup",
      preActivationMutationAllowed: false,
      postActivationExactCleanupRequired: true,
    },
  };
}

function d1Output(
  results: readonly Record<string, unknown>[],
  totalAttempts: number | null = 1,
) {
  return JSON.stringify([{
    success: true,
    results,
    meta: {
      rows_read: Math.max(1, results.length),
      rows_written: 0,
      ...(totalAttempts === null ? {} : { total_attempts: totalAttempts }),
    },
  }]);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
