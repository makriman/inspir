import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
} from "./historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES,
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
  canonicalHistoricalFresh0016DatabaseMarkerValue,
  createHistoricalFresh0016DatabaseMarker,
  historicalFresh0016MigrationBindingSchema,
  parseCanonicalHistoricalFresh0016DatabaseMarkerValue,
  parseHistoricalFresh0016MigrationBinding,
  readHistoricalFresh0016RenderedMigration,
  type HistoricalFresh0016MigrationBinding,
} from "./historical-data-fresh-0016-migration";
import {
  D1_DATABASE_NAME,
  runWrangler,
  type WranglerRunner,
} from "./migration-config";
import { createHistoricalDataWranglerRunner } from "./historical-data-wrangler-runner";
import {
  buildRepoSourceFingerprint,
} from "./source-fingerprint";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
  RUNTIME_MIGRATION_EVIDENCE_KIND,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
  verifyD1RuntimeMigrations,
} from "./verify-d1-runtime-migrations";

export const HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_KIND =
  "inspir-historical-data-fresh-0016-runtime-verification-v2" as const;
export const HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ = 32 as const;

export const HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL = `
WITH fixed_marker AS (
  SELECT value, updated_at
  FROM app_metadata
  WHERE key = '${RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY}'
  LIMIT 1
), fresh_marker AS (
  SELECT value, updated_at
  FROM app_metadata
  WHERE key = '${HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.freshCutoverMarkerKey}'
  LIMIT 1
)
SELECT
  fixed_marker.value AS fixed_value,
  fixed_marker.updated_at AS fixed_updated_at,
  fresh_marker.value AS fresh_value,
  fresh_marker.updated_at AS fresh_updated_at,
  CASE WHEN EXISTS (
    SELECT 1
    FROM memory_vector_cleanup_outbox
    LIMIT 1
  ) THEN 1 ELSE 0 END AS outbox_has_rows
FROM fixed_marker
CROSS JOIN fresh_marker;
`.trim();

export const HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS = [
  ...RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
  "0016-rendered-migration-exact",
  "0016-fixed-marker-exact",
  "0016-fresh-cutover-marker-exact",
  "0016-marker-timestamp-order",
  "0016-cleanup-outbox-empty",
  "fresh-0016-source-fingerprint-stable",
] as const;

const sha256Pattern = /^[a-f0-9]{64}$/;
const workerVersionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256Schema = z.string().regex(sha256Pattern);
const nonNegativeSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  "Expected a non-negative safe integer.",
);
const positiveSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const canonicalTimestampSchema = z.string().refine(
  (value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  },
  "Expected a canonical ISO timestamp.",
);
const absolutePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => path.isAbsolute(value) && path.resolve(value) === value, {
    message: "Expected a normalized absolute path.",
  });
const sourceIdentitySchema = z
  .object({
    sha256: sha256Schema,
    fileCount: positiveSafeIntegerSchema,
  })
  .strict();
const verificationCheckIdSchema = z.enum(
  HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS,
);
const verificationCheckSchema = z
  .object({
    id: verificationCheckIdSchema,
    ok: z.literal(true),
  })
  .strict();

export const historicalFresh0016RuntimeVerificationReportSchema = z
  .object({
    kind: z.literal(HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_KIND),
    schemaVersion: z.literal(2),
    createdAt: canonicalTimestampSchema,
    ok: z.literal(true),
    backupDir: absolutePathSchema,
    runDirectory: absolutePathSchema,
    renderedMigrationPath: absolutePathSchema,
    database: z
      .object({
        id: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY.database.id),
        name: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY.database.name),
      })
      .strict(),
    binding: historicalFresh0016MigrationBindingSchema,
    evidence: z
      .object({
        predecessorCompleteSha256: sha256Schema,
        preWriteEvidenceSha256: sha256Schema,
        migrationAuthorizationSha256: sha256Schema,
        renderedMigrationSha256: sha256Schema,
        productionExclusionOwnerSha256: sha256Schema,
      })
      .strict(),
    activeWorkerVersion: z.string().regex(workerVersionPattern),
    sourceFingerprint: sourceIdentitySchema,
    sourceFingerprintStable: z.literal(true),
    renderedMigration: z
      .object({
        sourceBytes: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES),
        sourceSha256: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256),
        renderedSha256: sha256Schema,
        freshMarkerValueSha256: sha256Schema,
      })
      .strict(),
    staticVerification: z
      .object({
        kind: z.literal(RUNTIME_MIGRATION_EVIDENCE_KIND),
        createdAt: canonicalTimestampSchema,
        rowsRead: nonNegativeSafeIntegerSchema,
        rowsWritten: z.literal(0),
        totalAttempts: z.literal(1),
        checkCount: z.literal(RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length),
      })
      .strict(),
    post0016Verification: z
      .object({
        querySha256: sha256Schema,
        rowsRead: nonNegativeSafeIntegerSchema.refine(
          (value) =>
            value <= HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ,
          "Post-0016 verification exceeded its fixed read bound.",
        ),
        rowsWritten: z.literal(0),
        totalAttempts: z.literal(1),
        fixedMarker: z
          .object({
            key: z.literal(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY),
            valueSha256: sha256Schema,
            updatedAt: positiveSafeIntegerSchema,
          })
          .strict(),
        freshMarker: z
          .object({
            key: z.literal(
              HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
                .freshCutoverMarkerKey,
            ),
            valueSha256: sha256Schema,
            updatedAt: positiveSafeIntegerSchema,
          })
          .strict(),
        cleanupOutboxRowCount: z.literal(0),
      })
      .strict(),
    totalRowsRead: nonNegativeSafeIntegerSchema,
    totalRowsWritten: z.literal(0),
    checks: z.array(verificationCheckSchema).length(
      HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS.length,
    ),
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.evidence.predecessorCompleteSha256 !==
        report.binding.predecessorCompleteSha256
    ) {
      context.addIssue({
        code: "custom",
        message: "The report predecessor hash does not match its migration binding.",
      });
    }
    if (
      report.sourceFingerprint.sha256 !==
        report.binding.sourceFingerprint.sha256 ||
      report.sourceFingerprint.fileCount !==
        report.binding.sourceFingerprint.fileCount
    ) {
      context.addIssue({
        code: "custom",
        message: "The report source does not match its migration binding.",
      });
    }
    if (
      report.renderedMigration.renderedSha256 !==
        report.evidence.renderedMigrationSha256
    ) {
      context.addIssue({
        code: "custom",
        message: "The report rendered migration hash is inconsistent.",
      });
    }
    if (
      report.totalRowsRead !==
        report.staticVerification.rowsRead +
          report.post0016Verification.rowsRead
    ) {
      context.addIssue({
        code: "custom",
        message: "The report read total is inconsistent.",
      });
    }
    if (
      report.post0016Verification.freshMarker.updatedAt <
        report.post0016Verification.fixedMarker.updatedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "The fresh marker predates the fixed 0016 completion marker.",
      });
    }
    const actualCheckIds = report.checks.map((check) => check.id);
    if (
      actualCheckIds.some(
        (id, index) =>
          id !== HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The report checks are not the exact ordered verification set.",
      });
    }
  });

export type HistoricalFresh0016RuntimeVerificationReport = z.infer<
  typeof historicalFresh0016RuntimeVerificationReportSchema
>;

export type VerifyHistoricalFresh0016MigrationOptions = Readonly<{
  binding: unknown;
  predecessorCompleteSha256: string;
  preWriteEvidenceSha256: string;
  migrationAuthorizationSha256: string;
  renderedMigrationSha256: string;
  productionExclusionOwnerSha256: string;
  activeWorkerVersion: string;
  sourceFingerprint: {
    sha256: string;
    fileCount: number;
  };
  cwd: string;
  backupDir: string;
  runDirectory: string;
  runner?: WranglerRunner;
  now?: Date;
}>;

export type HistoricalFresh0016RuntimeVerificationErrorCode =
  | "INPUT_INVALID"
  | "ARTIFACT_INVALID"
  | "STATIC_VERIFICATION_FAILED"
  | "POST_VERIFICATION_FAILED"
  | "SOURCE_CHANGED";

export class HistoricalFresh0016RuntimeVerificationError extends Error {
  readonly code: HistoricalFresh0016RuntimeVerificationErrorCode;

  constructor(
    code: HistoricalFresh0016RuntimeVerificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HistoricalFresh0016RuntimeVerificationError";
    this.code = code;
  }
}

export function verifyHistoricalDataFresh0016Migration(
  options: VerifyHistoricalFresh0016MigrationOptions,
): DeepReadonly<HistoricalFresh0016RuntimeVerificationReport> {
  const binding = parseHistoricalFresh0016MigrationBinding(options.binding);
  const input = parseVerificationInput(options, binding);
  const now = validDate(options.now ?? new Date());
  const runner = createHistoricalDataWranglerRunner(
    options.runner ?? runWrangler,
  );
  const sourceBefore = compactSourceFingerprint(
    buildRepoSourceFingerprint(input.cwd),
  );
  assertExactSource(sourceBefore, input.sourceFingerprint, binding);

  let rendered;
  try {
    rendered = readHistoricalFresh0016RenderedMigration({
      cwd: input.cwd,
      backupDir: input.backupDir,
      runDirectory: input.runDirectory,
      binding,
    });
  } catch {
    throw verificationError(
      "ARTIFACT_INVALID",
      "The exact rendered fresh-0016 migration artifact could not be verified.",
    );
  }
  if (
    rendered.evidence.renderedMigration.sha256 !==
      input.renderedMigrationSha256
  ) {
    throw verificationError(
      "ARTIFACT_INVALID",
      "The rendered fresh-0016 migration hash does not match its bound evidence.",
    );
  }

  let staticReport;
  try {
    const strictStaticRunner: WranglerRunner = (args, runnerOptions) => {
      const output = runner(args, runnerOptions);
      assertSuccessfulReadOnlySingleAttemptResults(
        output,
        "static runtime migration verification",
      );
      return output;
    };
    staticReport = verifyD1RuntimeMigrations({
      backupDir: input.backupDir,
      cwd: input.cwd,
      nowMs: now.getTime(),
      runner: strictStaticRunner,
    });
  } catch {
    throw verificationError(
      "STATIC_VERIFICATION_FAILED",
      "The static runtime migration verification did not complete successfully in one read-only attempt.",
    );
  }
  assertStaticVerification(staticReport, input.sourceFingerprint);

  let postVerification;
  try {
    const output = runner([
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--remote",
      "--json",
      "--command",
      HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
    ]);
    postVerification = parsePost0016Verification(
      output,
      binding,
    );
  } catch {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      "The fresh-0016 marker and empty-outbox proof failed closed.",
    );
  }

  const sourceAfter = compactSourceFingerprint(
    buildRepoSourceFingerprint(input.cwd),
  );
  assertExactSource(sourceAfter, input.sourceFingerprint, binding);
  if (!sameSource(sourceBefore, sourceAfter)) {
    throw verificationError(
      "SOURCE_CHANGED",
      "The source fingerprint changed during fresh-0016 runtime verification.",
    );
  }

  const expectedMarker = createHistoricalFresh0016DatabaseMarker(binding);
  const expectedMarkerValue =
    canonicalHistoricalFresh0016DatabaseMarkerValue(expectedMarker);
  const checks = HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS.map(
    (id) => ({ id, ok: true as const }),
  );
  const totalRowsRead = safeAdd(
    staticReport.rowsRead,
    postVerification.rowsRead,
  );
  const report = parseSchema(
    historicalFresh0016RuntimeVerificationReportSchema,
    {
      kind: HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_KIND,
      schemaVersion: 2,
      createdAt: now.toISOString(),
      ok: true,
      backupDir: fs.realpathSync.native(input.backupDir),
      runDirectory: path.dirname(rendered.path),
      renderedMigrationPath: rendered.path,
      database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
      binding,
      evidence: {
        predecessorCompleteSha256: input.predecessorCompleteSha256,
        preWriteEvidenceSha256: input.preWriteEvidenceSha256,
        migrationAuthorizationSha256:
          input.migrationAuthorizationSha256,
        renderedMigrationSha256: input.renderedMigrationSha256,
        productionExclusionOwnerSha256:
          input.productionExclusionOwnerSha256,
      },
      activeWorkerVersion: input.activeWorkerVersion,
      sourceFingerprint: sourceAfter,
      sourceFingerprintStable: true,
      renderedMigration: {
        sourceBytes: rendered.evidence.migrationSource.bytes,
        sourceSha256: rendered.evidence.migrationSource.sha256,
        renderedSha256: rendered.evidence.renderedMigration.sha256,
        freshMarkerValueSha256: sha256(expectedMarkerValue),
      },
      staticVerification: {
        kind: staticReport.kind,
        createdAt: staticReport.createdAt,
        rowsRead: staticReport.rowsRead,
        rowsWritten: staticReport.rowsWritten,
        totalAttempts: staticReport.totalAttempts,
        checkCount: staticReport.checks.length,
      },
      post0016Verification: {
        querySha256: sha256(HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL),
        rowsRead: postVerification.rowsRead,
        rowsWritten: postVerification.rowsWritten,
        totalAttempts: postVerification.totalAttempts,
        fixedMarker: {
          key: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
          valueSha256: sha256(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE),
          updatedAt: postVerification.fixedUpdatedAt,
        },
        freshMarker: {
          key:
            HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
              .freshCutoverMarkerKey,
          valueSha256: sha256(postVerification.freshValue),
          updatedAt: postVerification.freshUpdatedAt,
        },
        cleanupOutboxRowCount: 0,
      },
      totalRowsRead,
      totalRowsWritten: 0,
      checks,
    },
    "fresh-0016 runtime verification report",
  );
  return deepFreeze(report);
}

function parseVerificationInput(
  options: VerifyHistoricalFresh0016MigrationOptions,
  binding: HistoricalFresh0016MigrationBinding,
) {
  const inputSchema = z
    .object({
      predecessorCompleteSha256: sha256Schema,
      preWriteEvidenceSha256: sha256Schema,
      migrationAuthorizationSha256: sha256Schema,
      renderedMigrationSha256: sha256Schema,
      productionExclusionOwnerSha256: sha256Schema,
      activeWorkerVersion: z.string().regex(workerVersionPattern),
      sourceFingerprint: sourceIdentitySchema,
      cwd: z.string().min(1).max(4_096),
      backupDir: z.string().min(1).max(4_096),
      runDirectory: z.string().min(1).max(4_096),
    })
    .strict();
  const parsed = parseSchema(
    inputSchema,
    {
      predecessorCompleteSha256: options.predecessorCompleteSha256,
      preWriteEvidenceSha256: options.preWriteEvidenceSha256,
      migrationAuthorizationSha256:
        options.migrationAuthorizationSha256,
      renderedMigrationSha256: options.renderedMigrationSha256,
      productionExclusionOwnerSha256:
        options.productionExclusionOwnerSha256,
      activeWorkerVersion: options.activeWorkerVersion,
      sourceFingerprint: options.sourceFingerprint,
      cwd: options.cwd,
      backupDir: options.backupDir,
      runDirectory: options.runDirectory,
    },
    "fresh-0016 runtime verification input",
  );
  if (
    parsed.predecessorCompleteSha256 !==
      binding.predecessorCompleteSha256
  ) {
    throw verificationError(
      "INPUT_INVALID",
      "The predecessor completion hash does not match the migration binding.",
    );
  }
  return {
    ...parsed,
    cwd: path.resolve(parsed.cwd),
    backupDir: path.resolve(parsed.backupDir),
    runDirectory: path.resolve(parsed.runDirectory),
  };
}

function assertStaticVerification(
  report: ReturnType<typeof verifyD1RuntimeMigrations>,
  expectedSource: { sha256: string; fileCount: number },
) {
  if (
    !report.ok ||
    !report.sourceFingerprintStable ||
    report.rowsWritten !== 0 ||
    report.totalAttempts !== 1 ||
    report.checks.length !== RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length ||
    report.checks.some(
      (check, index) =>
        !check.ok ||
        check.id !== RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS[index],
    ) ||
    report.sourceFingerprintBefore.sha256 !== expectedSource.sha256 ||
    report.sourceFingerprintBefore.fileCount !== expectedSource.fileCount ||
    report.sourceFingerprint.sha256 !== expectedSource.sha256 ||
    report.sourceFingerprint.fileCount !== expectedSource.fileCount
  ) {
    throw verificationError(
      "STATIC_VERIFICATION_FAILED",
      "The static runtime migration checks, attempt metadata, or source binding failed.",
    );
  }
}

function parsePost0016Verification(
  output: string,
  binding: HistoricalFresh0016MigrationBinding,
) {
  const result = assertSuccessfulReadOnlySingleAttemptResult(
    output,
    "fresh-0016 post-migration verification",
  );
  const rowsRead = requiredNonNegativeSafeInteger(
    result.meta.rows_read,
    "fresh-0016 rows read",
  );
  if (rowsRead > HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      "The fresh-0016 verification exceeded its bounded row-read ceiling.",
    );
  }
  if (!Array.isArray(result.results) || result.results.length !== 1) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      "The fresh-0016 verification returned the wrong result-row count.",
    );
  }
  const row = result.results[0];
  if (
    !isRecord(row) ||
    !hasExactKeys(row, [
      "fixed_updated_at",
      "fixed_value",
      "fresh_updated_at",
      "fresh_value",
      "outbox_has_rows",
    ])
  ) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      "The fresh-0016 verification row has an invalid exact schema.",
    );
  }
  if (row.fixed_value !== RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      "The fixed 0016 completion marker is missing or wrong.",
    );
  }
  const fixedUpdatedAt = requiredPositiveSafeInteger(
    row.fixed_updated_at,
    "fixed 0016 marker timestamp",
  );
  const freshUpdatedAt = requiredPositiveSafeInteger(
    row.fresh_updated_at,
    "fresh 0016 marker timestamp",
  );
  if (freshUpdatedAt < fixedUpdatedAt) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      "The fresh 0016 marker predates the fixed completion marker.",
    );
  }
  const actualFreshMarker =
    parseCanonicalHistoricalFresh0016DatabaseMarkerValue(row.fresh_value);
  const expectedFreshMarker = createHistoricalFresh0016DatabaseMarker(binding);
  const actualValue =
    canonicalHistoricalFresh0016DatabaseMarkerValue(actualFreshMarker);
  const expectedValue =
    canonicalHistoricalFresh0016DatabaseMarkerValue(expectedFreshMarker);
  if (actualValue !== expectedValue) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      "The fresh 0016 marker does not match the exact cutover binding.",
    );
  }
  if (row.outbox_has_rows !== 0) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      "The new memory cleanup outbox is not exactly empty.",
    );
  }
  return {
    rowsRead,
    rowsWritten: 0 as const,
    totalAttempts: 1 as const,
    fixedUpdatedAt,
    freshUpdatedAt,
    freshValue: actualValue,
  };
}

function assertSuccessfulReadOnlySingleAttemptResults(
  output: string,
  label: string,
) {
  const parsed = parseWranglerJson(output);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every(isRecord)
  ) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      `The ${label} returned an invalid result set.`,
    );
  }
  const results: unknown[] = [];
  let rowsRead = 0;
  for (const [index, result] of parsed.entries()) {
    if (result.success !== true || !isRecord(result.meta)) {
      throw verificationError(
        "POST_VERIFICATION_FAILED",
        `The ${label} did not report explicit success metadata.`,
      );
    }
    const resultRowsRead = requiredNonNegativeSafeInteger(
      result.meta.rows_read,
      `${label} result set ${index + 1} rows read`,
    );
    const rowsWritten = requiredNonNegativeSafeInteger(
      result.meta.rows_written,
      `${label} result set ${index + 1} rows written`,
    );
    const totalAttempts = requiredNonNegativeSafeInteger(
      result.meta.total_attempts,
      `${label} result set ${index + 1} total attempts`,
    );
    if (rowsWritten !== 0 || totalAttempts !== 1) {
      throw verificationError(
        "POST_VERIFICATION_FAILED",
        `The ${label} was not one exact read-only attempt.`,
      );
    }
    if (!Array.isArray(result.results)) {
      throw verificationError(
        "POST_VERIFICATION_FAILED",
        `The ${label} returned invalid result rows.`,
      );
    }
    rowsRead += resultRowsRead;
    results.push(...result.results);
  }
  return {
    resultSetCount: parsed.length,
    results,
    meta: {
      rows_read: rowsRead,
      rows_written: 0,
      total_attempts: 1,
    },
  };
}

function assertSuccessfulReadOnlySingleAttemptResult(
  output: string,
  label: string,
) {
  const parsed = parseWranglerJson(output);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 1 ||
    !isRecord(parsed[0])
  ) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      `The ${label} returned an invalid result set.`,
    );
  }
  const result = parsed[0];
  if (result.success !== true || !isRecord(result.meta)) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      `The ${label} did not report explicit success metadata.`,
    );
  }
  const rowsWritten = requiredNonNegativeSafeInteger(
    result.meta.rows_written,
    `${label} rows written`,
  );
  const totalAttempts = requiredNonNegativeSafeInteger(
    result.meta.total_attempts,
    `${label} total attempts`,
  );
  if (rowsWritten !== 0 || totalAttempts !== 1) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      `The ${label} was not one exact read-only attempt.`,
    );
  }
  return { results: result.results, meta: result.meta };
}

function parseWranglerJson(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) {
      throw verificationError(
        "POST_VERIFICATION_FAILED",
        "Could not parse Wrangler fresh-0016 verification JSON.",
      );
    }
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
    } catch {
      throw verificationError(
        "POST_VERIFICATION_FAILED",
        "Could not parse Wrangler fresh-0016 verification JSON.",
      );
    }
  }
}

function assertExactSource(
  actual: { sha256: string; fileCount: number },
  expected: { sha256: string; fileCount: number },
  binding: HistoricalFresh0016MigrationBinding,
) {
  if (
    !sameSource(actual, expected) ||
    !sameSource(actual, binding.sourceFingerprint)
  ) {
    throw verificationError(
      "SOURCE_CHANGED",
      "The current source fingerprint does not match the exact cutover binding.",
    );
  }
}

function compactSourceFingerprint(value: {
  sha256: string;
  fileCount: number;
}) {
  return parseSchema(
    sourceIdentitySchema,
    { sha256: value.sha256, fileCount: value.fileCount },
    "source fingerprint",
  );
}

function sameSource(
  left: { sha256: string; fileCount: number },
  right: { sha256: string; fileCount: number },
) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function requiredNonNegativeSafeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      `The ${label} is not a non-negative safe integer.`,
    );
  }
  return value;
}

function requiredPositiveSafeInteger(value: unknown, label: string) {
  const parsed = requiredNonNegativeSafeInteger(value, label);
  if (parsed < 1) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      `The ${label} must be positive.`,
    );
  }
  return parsed;
}

function safeAdd(left: number, right: number) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw verificationError(
      "POST_VERIFICATION_FAILED",
      "Fresh-0016 verification row-read accounting overflowed.",
    );
  }
  return sum;
}

function validDate(value: Date) {
  if (!Number.isFinite(value.getTime())) {
    throw verificationError(
      "INPUT_INVALID",
      "The fresh-0016 verification clock is invalid.",
    );
  }
  return new Date(value.getTime());
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw verificationError(
      "INPUT_INVALID",
      `The ${label} has an invalid or non-exact schema.`,
    );
  }
  return result.data;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value) as DeepReadonly<T>;
}

function verificationError(
  code: HistoricalFresh0016RuntimeVerificationErrorCode,
  message: string,
) {
  return new HistoricalFresh0016RuntimeVerificationError(code, message);
}
