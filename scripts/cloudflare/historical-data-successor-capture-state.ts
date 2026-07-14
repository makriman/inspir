import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const HISTORICAL_SUCCESSOR_CAPTURE_LOCK_KIND =
  "inspir-historical-data-successor-capture-lock-v1" as const;
export const HISTORICAL_SUCCESSOR_CAPTURE_SCAN_AUTHORIZED_KIND =
  "inspir-historical-data-successor-capture-scan-authorized-v1" as const;
export const HISTORICAL_SUCCESSOR_CAPTURE_RESUME_LEASE_KIND =
  "inspir-historical-data-successor-capture-resume-lease-v1" as const;
export const HISTORICAL_SUCCESSOR_CAPTURE_PREPARED_KIND =
  "inspir-historical-data-successor-capture-prepared-v1" as const;
export const HISTORICAL_SUCCESSOR_CAPTURE_COMPLETE_KIND =
  "inspir-historical-data-successor-capture-complete-v1" as const;

export const HISTORICAL_SUCCESSOR_CAPTURE_FILE_NAMES = {
  lock: "successor-capture.lock.json",
  scanAuthorized: "successor-capture-scan-authorized.json",
  prepared: "successor-capture-prepared.json",
  complete: "successor-capture-complete.json",
} as const;

const historicalSuccessorCapturePublicFileNames = new Set<string>(
  Object.values(HISTORICAL_SUCCESSOR_CAPTURE_FILE_NAMES),
);
const historicalSuccessorResumeLeaseFilePattern =
  /^successor-capture-resume-(\d{2})\.json$/;
const MAXIMUM_SUCCESSOR_RESUME_ATTEMPTS = 8;

function isHistoricalSuccessorCapturePublicFileName(fileName: string) {
  return historicalSuccessorCapturePublicFileNames.has(fileName) ||
    historicalSuccessorResumeLeaseFilePattern.test(fileName);
}

const CLAIM_MAX_BYTES = 64 * 1024;
const MARKER_MAX_BYTES = 16 * 1024 * 1024;
const CANONICAL_BASELINE_MAX_BYTES = 16 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type SuccessorCaptureJsonPrimitive = string | number | boolean | null;
export type SuccessorCaptureJsonValue =
  | SuccessorCaptureJsonPrimitive
  | SuccessorCaptureJsonValue[]
  | SuccessorCaptureJsonObject;
export type SuccessorCaptureJsonObject = {
  [key: string]: SuccessorCaptureJsonValue;
};

const safePositiveIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const sha256Schema = z.string().regex(sha256Pattern);
const uuidSchema = z.string().regex(uuidPattern);
const canonicalTimestampSchema = z.string().refine(
  (value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  },
  "Expected a canonical ISO timestamp.",
);
const utcDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
    "Expected a valid UTC day.",
  );
const absolutePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => path.isAbsolute(value) && path.resolve(value) === value, {
    message: "Expected a normalized absolute path.",
  });
const boundedIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Identifiers cannot contain control characters.",
  });
const operationIdSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Operation IDs cannot contain control characters.",
  });
const sourceIdentitySchema = z
  .object({
    sha256: sha256Schema,
    fileCount: safePositiveIntegerSchema,
  })
  .strict();
const ownerSchema = z
  .object({
    hostname: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    pid: safePositiveIntegerSchema,
  })
  .strict();
const expectedIdentitySchema = z
  .object({
    backupDir: absolutePathSchema,
    policyId: boundedIdentifierSchema,
    policySha256: sha256Schema,
    archiveManifestSha256: sha256Schema,
    predecessorBaselineSha256: sha256Schema,
    predecessorHmacKeyId: sha256Schema,
    source: sourceIdentitySchema,
    operationId: operationIdSchema,
    utcDay: utcDaySchema,
    windowEndsAt: canonicalTimestampSchema,
    snapshotPlanSha256: sha256Schema,
    maximumRowsRead: safePositiveIntegerSchema,
  })
  .strict();
const jsonObjectSchema = z.custom<SuccessorCaptureJsonObject>(isJsonObject, {
  message: "Expected a plain JSON object.",
});

const claimSchema = z
  .object({
    kind: z.literal(HISTORICAL_SUCCESSOR_CAPTURE_LOCK_KIND),
    schemaVersion: z.literal(1),
    runId: uuidSchema,
    createdAt: canonicalTimestampSchema,
    backupDir: absolutePathSchema,
    policyId: boundedIdentifierSchema,
    policySha256: sha256Schema,
    archiveManifestSha256: sha256Schema,
    predecessorBaselineSha256: sha256Schema,
    predecessorHmacKeyId: sha256Schema,
    source: sourceIdentitySchema,
    operationId: operationIdSchema,
    utcDay: utcDaySchema,
    windowEndsAt: canonicalTimestampSchema,
    owner: ownerSchema,
  })
  .strict()
  .superRefine((claim, context) => {
    if (claim.createdAt.slice(0, 10) !== claim.utcDay) {
      context.addIssue({
        code: "custom",
        message: "The claim timestamp must be on its bound UTC day.",
      });
    }
    if (Date.parse(claim.createdAt) > Date.parse(claim.windowEndsAt)) {
      context.addIssue({
        code: "custom",
        message: "The claim timestamp must not exceed its capture window.",
      });
    }
  });

const resumeLeaseSchema = z
  .object({
    kind: z.literal(HISTORICAL_SUCCESSOR_CAPTURE_RESUME_LEASE_KIND),
    schemaVersion: z.literal(1),
    runId: uuidSchema,
    attempt: safePositiveIntegerSchema.refine(
      (value) => value <= MAXIMUM_SUCCESSOR_RESUME_ATTEMPTS,
      "Successor resume attempt exceeds its fixed bound.",
    ),
    createdAt: canonicalTimestampSchema,
    claimSha256: sha256Schema,
    previousLeaseSha256: sha256Schema.nullable(),
    owner: ownerSchema,
    leaseNonce: uuidSchema,
  })
  .strict();

const scanAuthorizedSchema = z
  .object({
    kind: z.literal(HISTORICAL_SUCCESSOR_CAPTURE_SCAN_AUTHORIZED_KIND),
    schemaVersion: z.literal(1),
    runId: uuidSchema,
    createdAt: canonicalTimestampSchema,
    lockSha256: sha256Schema,
    policyId: boundedIdentifierSchema,
    policySha256: sha256Schema,
    source: sourceIdentitySchema,
    operationId: operationIdSchema,
    utcDay: utcDaySchema,
    snapshotPlanSha256: sha256Schema,
    maximumRowsRead: safePositiveIntegerSchema,
    resumeLeaseSha256: sha256Schema.nullable(),
    d1ExecutionMayHaveStarted: z.literal(true),
  })
  .strict();

const preparedSchema = z
  .object({
    kind: z.literal(HISTORICAL_SUCCESSOR_CAPTURE_PREPARED_KIND),
    schemaVersion: z.literal(1),
    runId: uuidSchema,
    createdAt: canonicalTimestampSchema,
    lockSha256: sha256Schema,
    scanAuthorizedSha256: sha256Schema,
    reportSha256: sha256Schema,
    report: jsonObjectSchema,
  })
  .strict()
  .superRefine((prepared, context) => {
    if (successorCaptureJsonSha256(prepared.report) !== prepared.reportSha256) {
      context.addIssue({
        code: "custom",
        message: "The prepared report hash does not match its canonical report.",
      });
    }
  });

const completeSchema = z
  .object({
    kind: z.literal(HISTORICAL_SUCCESSOR_CAPTURE_COMPLETE_KIND),
    schemaVersion: z.literal(1),
    runId: uuidSchema,
    completedAt: canonicalTimestampSchema,
    lockSha256: sha256Schema,
    scanAuthorizedSha256: sha256Schema,
    preparedSha256: sha256Schema,
    canonicalBaselinePath: absolutePathSchema,
    canonicalBaselineSha256: sha256Schema,
    backupDir: absolutePathSchema,
    policyId: boundedIdentifierSchema,
    policySha256: sha256Schema,
    archiveManifestSha256: sha256Schema,
    predecessorBaselineSha256: sha256Schema,
    predecessorHmacKeyId: sha256Schema,
    source: sourceIdentitySchema,
    operationId: operationIdSchema,
    utcDay: utcDaySchema,
    windowEndsAt: canonicalTimestampSchema,
    snapshotPlanSha256: sha256Schema,
    maximumRowsRead: safePositiveIntegerSchema,
  })
  .strict();

export type HistoricalSuccessorCaptureClaim = z.infer<typeof claimSchema>;
export type HistoricalSuccessorCaptureResumeLease = z.infer<
  typeof resumeLeaseSchema
>;
export type HistoricalSuccessorCaptureScanAuthorization = z.infer<
  typeof scanAuthorizedSchema
>;
export type HistoricalSuccessorCapturePrepared = z.infer<typeof preparedSchema>;
export type HistoricalSuccessorCaptureComplete = z.infer<typeof completeSchema>;

export type HistoricalSuccessorCaptureStatePaths = {
  stateDirectory: string;
  lock: string;
  scanAuthorized: string;
  prepared: string;
  complete: string;
};

export type HistoricalSuccessorCaptureFileHandle<T> = {
  path: string;
  value: T;
  sha256: string;
  identity: {
    device: number;
    inode: number;
  };
};

export type HistoricalSuccessorCaptureExpectedIdentity = {
  backupDir: string;
  policyId: string;
  policySha256: string;
  archiveManifestSha256: string;
  predecessorBaselineSha256: string;
  predecessorHmacKeyId: string;
  source: {
    sha256: string;
    fileCount: number;
  };
  operationId: string;
  utcDay: string;
  windowEndsAt: string;
  snapshotPlanSha256: string;
  maximumRowsRead: number;
};

export type HistoricalSuccessorCaptureState =
  | {
      status: "empty";
      d1ScanMayHaveStarted: false;
      automaticRescanAllowed: true;
    }
  | {
      status: "claimed-pre-scan";
      d1ScanMayHaveStarted: false;
      automaticRescanAllowed: false;
      claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
    }
  | {
      status: "scan-authorization-publication-interrupted";
      d1ScanMayHaveStarted: false;
      automaticRescanAllowed: false;
      canResumeExactAuthorization: true;
      claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
      scanAuthorized: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>;
    }
  | {
      status: "scan-authorized-unresolved";
      d1ScanMayHaveStarted: true;
      automaticRescanAllowed: false;
      claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
      scanAuthorized: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>;
    }
  | {
      status: "prepared";
      d1ScanMayHaveStarted: true;
      automaticRescanAllowed: false;
      canFinalizeWithoutScan: true;
      claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
      scanAuthorized: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>;
      prepared: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared>;
    }
  | {
      status: "complete-retained-claim";
      d1ScanMayHaveStarted: true;
      automaticRescanAllowed: false;
      canReplayWithoutScan: true;
      claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
      scanAuthorized: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>;
      prepared: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared>;
      complete: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureComplete>;
    }
  | {
      status: "complete";
      d1ScanMayHaveStarted: true;
      automaticRescanAllowed: false;
      canReplayWithoutScan: true;
      scanAuthorized: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>;
      prepared: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared>;
      complete: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureComplete>;
    };

export type HistoricalSuccessorCaptureStateErrorCode =
  | "STATE_DIRECTORY_UNSAFE"
  | "STATE_CONFLICT"
  | "STATE_MISSING"
  | "STATE_FILE_UNSAFE"
  | "STATE_SCHEMA_INVALID"
  | "STATE_CHAIN_BROKEN"
  | "STATE_HANDLE_CHANGED"
  | "STATE_INCONSISTENT";

export class HistoricalSuccessorCaptureStateError extends Error {
  readonly code: HistoricalSuccessorCaptureStateErrorCode;

  constructor(code: HistoricalSuccessorCaptureStateErrorCode, message: string) {
    super(message);
    this.name = "HistoricalSuccessorCaptureStateError";
    this.code = code;
  }
}

export function historicalSuccessorCaptureStatePaths(
  stateDirectory: string,
): HistoricalSuccessorCaptureStatePaths {
  const absolute = path.resolve(stateDirectory);
  return {
    stateDirectory: absolute,
    lock: path.join(absolute, HISTORICAL_SUCCESSOR_CAPTURE_FILE_NAMES.lock),
    scanAuthorized: path.join(
      absolute,
      HISTORICAL_SUCCESSOR_CAPTURE_FILE_NAMES.scanAuthorized,
    ),
    prepared: path.join(
      absolute,
      HISTORICAL_SUCCESSOR_CAPTURE_FILE_NAMES.prepared,
    ),
    complete: path.join(
      absolute,
      HISTORICAL_SUCCESSOR_CAPTURE_FILE_NAMES.complete,
    ),
  };
}

export function acquireHistoricalSuccessorCaptureClaim(input: {
  stateDirectory: string;
  backupDir: string;
  policyId: string;
  policySha256: string;
  archiveManifestSha256: string;
  predecessorBaselineSha256: string;
  predecessorHmacKeyId: string;
  source: { sha256: string; fileCount: number };
  operationId: string;
  utcDay: string;
  windowEndsAt: string;
  now?: Date;
  runId?: string;
  hostname?: string;
  pid?: number;
}): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim> {
  const paths = historicalSuccessorCaptureStatePaths(input.stateDirectory);
  const directoryIdentity = assertPrivateStateDirectory(paths.stateDirectory);
  assertPathsAbsent(
    [paths.scanAuthorized, paths.prepared, paths.complete],
    "Successor capture evidence already exists; classify or recover it before acquiring a new claim.",
  );
  const now = canonicalDate(input.now ?? new Date(), "claim clock");
  const claim = parseStateValue(
    claimSchema,
    {
      kind: HISTORICAL_SUCCESSOR_CAPTURE_LOCK_KIND,
      schemaVersion: 1,
      runId: input.runId ?? randomUUID(),
      createdAt: now.toISOString(),
      backupDir: path.resolve(input.backupDir),
      policyId: input.policyId,
      policySha256: input.policySha256,
      archiveManifestSha256: input.archiveManifestSha256,
      predecessorBaselineSha256: input.predecessorBaselineSha256,
      predecessorHmacKeyId: input.predecessorHmacKeyId,
      source: input.source,
      operationId: input.operationId,
      utcDay: input.utcDay,
      windowEndsAt: input.windowEndsAt,
      owner: {
        hostname: input.hostname ?? os.hostname(),
        pid: input.pid ?? process.pid,
      },
    },
    "successor capture claim",
  );
  const handle = writeExclusiveCanonicalState(
    paths.lock,
    claim,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  assertSameDirectoryIdentity(paths.stateDirectory, directoryIdentity);
  assertPathsAbsent(
    [paths.scanAuthorized, paths.prepared, paths.complete],
    "Successor capture evidence appeared while the claim was being acquired.",
  );
  return handle;
}

export function readHistoricalSuccessorCaptureResumeLeases(
  stateDirectory: string,
): Array<
  HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureResumeLease>
> {
  const paths = historicalSuccessorCaptureStatePaths(stateDirectory);
  assertPrivateStateDirectory(paths.stateDirectory);
  const entries = fs.readdirSync(paths.stateDirectory)
    .map((entry) => {
      const match = historicalSuccessorResumeLeaseFilePattern.exec(entry);
      return match
        ? { entry, attempt: Number.parseInt(match[1]!, 10) }
        : undefined;
    })
    .filter((entry): entry is { entry: string; attempt: number } =>
      entry !== undefined
    )
    .sort((left, right) => left.attempt - right.attempt);
  if (entries.length > MAXIMUM_SUCCESSOR_RESUME_ATTEMPTS) {
    throw stateError(
      "STATE_INCONSISTENT",
      "Historical successor resume evidence exceeds its fixed attempt bound.",
    );
  }
  const leases: Array<
    HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureResumeLease>
  > = [];
  for (const [index, entry] of entries.entries()) {
    const expectedAttempt = index + 1;
    if (entry.attempt !== expectedAttempt) {
      throw stateError(
        "STATE_INCONSISTENT",
        "Historical successor resume evidence contains a gap or duplicate attempt.",
      );
    }
    const lease = readCanonicalState(
      path.join(paths.stateDirectory, entry.entry),
      resumeLeaseSchema,
      `successor resume lease ${expectedAttempt}`,
      CLAIM_MAX_BYTES,
    );
    const previous = leases.at(-1);
    if (
      lease.value.attempt !== expectedAttempt ||
      lease.value.previousLeaseSha256 !== (previous?.sha256 ?? null) ||
      (previous && lease.value.runId !== previous.value.runId)
    ) {
      throw stateError(
        "STATE_CHAIN_BROKEN",
        "Historical successor resume lease chain is not exact and contiguous.",
      );
    }
    leases.push(lease);
  }
  return leases;
}

export function acquireHistoricalSuccessorCaptureResumeLease(input: {
  stateDirectory: string;
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
  expectedLatestLease?: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureResumeLease>;
  now?: Date;
  hostname?: string;
  pid?: number;
}): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureResumeLease> {
  const paths = historicalSuccessorCaptureStatePaths(input.stateDirectory);
  const directoryIdentity = assertPrivateStateDirectory(paths.stateDirectory);
  const claim = assertCurrentHandle(
    input.claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  const leases = readAndValidateResumeLeaseChain(paths.stateDirectory, claim);
  const latest = leases.at(-1);
  if (
    (latest === undefined) !== (input.expectedLatestLease === undefined) ||
    (latest &&
      input.expectedLatestLease &&
      (latest.sha256 !== input.expectedLatestLease.sha256 ||
        !sameFileIdentity(latest.identity, input.expectedLatestLease.identity)))
  ) {
    throw stateError(
      "STATE_CONFLICT",
      "Historical successor resume ownership changed before lease acquisition.",
    );
  }
  assertResumeTakeoverOwnerUnavailable(
    latest?.value.owner ?? claim.value.owner,
  );
  const attempt = leases.length + 1;
  if (attempt > MAXIMUM_SUCCESSOR_RESUME_ATTEMPTS) {
    throw stateError(
      "STATE_CONFLICT",
      "Historical successor resume attempts exhausted their fixed reviewed bound.",
    );
  }
  const now = canonicalDate(input.now ?? new Date(), "resume-lease clock");
  assertWithinClaimWindow(now, claim.value, "resume lease");
  const lease = parseStateValue(
    resumeLeaseSchema,
    {
      kind: HISTORICAL_SUCCESSOR_CAPTURE_RESUME_LEASE_KIND,
      schemaVersion: 1,
      runId: claim.value.runId,
      attempt,
      createdAt: now.toISOString(),
      claimSha256: claim.sha256,
      previousLeaseSha256: latest?.sha256 ?? null,
      owner: {
        hostname: input.hostname ?? os.hostname(),
        pid: input.pid ?? process.pid,
      },
      leaseNonce: randomUUID(),
    },
    `successor resume lease ${attempt}`,
  );
  const file = path.join(
    paths.stateDirectory,
    `successor-capture-resume-${String(attempt).padStart(2, "0")}.json`,
  );
  const handle = writeExclusiveCanonicalState(
    file,
    lease,
    resumeLeaseSchema,
    `successor resume lease ${attempt}`,
    CLAIM_MAX_BYTES,
  );
  assertSameDirectoryIdentity(paths.stateDirectory, directoryIdentity);
  assertCurrentHandle(
    claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  const after = readAndValidateResumeLeaseChain(paths.stateDirectory, claim);
  const current = after.at(-1);
  if (
    after.length !== attempt ||
    !current ||
    current.sha256 !== handle.sha256 ||
    !sameFileIdentity(current.identity, handle.identity)
  ) {
    throw stateError(
      "STATE_CONFLICT",
      "Historical successor resume lease lost its exact atomic acquisition.",
    );
  }
  return current;
}

export function authorizeHistoricalSuccessorCaptureScan(input: {
  stateDirectory: string;
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
  resumeLease?: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureResumeLease>;
  snapshotPlanSha256: string;
  maximumRowsRead: number;
  now?: Date;
}): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization> {
  const paths = historicalSuccessorCaptureStatePaths(input.stateDirectory);
  const directoryIdentity = assertPrivateStateDirectory(paths.stateDirectory);
  const claim = assertCurrentHandle(
    input.claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  const resumeLease = input.resumeLease
    ? assertCurrentLatestResumeLease({
        stateDirectory: paths.stateDirectory,
        claim,
        resumeLease: input.resumeLease,
        requireCurrentProcessOwner: true,
      })
    : undefined;
  assertPathsAbsent(
    [paths.scanAuthorized, paths.prepared, paths.complete],
    "A successor scan authorization or later marker already exists.",
  );
  const now = canonicalDate(input.now ?? new Date(), "scan-authorization clock");
  assertWithinClaimWindow(now, claim.value, "scan authorization");
  const authorization = parseStateValue(
    scanAuthorizedSchema,
    {
      kind: HISTORICAL_SUCCESSOR_CAPTURE_SCAN_AUTHORIZED_KIND,
      schemaVersion: 1,
      runId: claim.value.runId,
      createdAt: now.toISOString(),
      lockSha256: claim.sha256,
      policyId: claim.value.policyId,
      policySha256: claim.value.policySha256,
      source: claim.value.source,
      operationId: claim.value.operationId,
      utcDay: claim.value.utcDay,
      snapshotPlanSha256: input.snapshotPlanSha256,
      maximumRowsRead: input.maximumRowsRead,
      resumeLeaseSha256: resumeLease?.sha256 ?? null,
      d1ExecutionMayHaveStarted: true,
    },
    "successor scan authorization",
  );
  const handle = writeExclusiveCanonicalState(
    paths.scanAuthorized,
    authorization,
    scanAuthorizedSchema,
    "successor scan authorization",
    CLAIM_MAX_BYTES,
  );
  assertSameDirectoryIdentity(paths.stateDirectory, directoryIdentity);
  assertCurrentHandle(
    claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  return handle;
}

export function prepareHistoricalSuccessorCapture(input: {
  stateDirectory: string;
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
  scanAuthorized: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>;
  report: unknown;
  forbiddenPlaintextValues: readonly [string, ...string[]];
  now?: Date;
}): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared> {
  const paths = historicalSuccessorCaptureStatePaths(input.stateDirectory);
  const directoryIdentity = assertPrivateStateDirectory(paths.stateDirectory);
  const claim = assertCurrentHandle(
    input.claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  const scanAuthorized = assertCurrentHandle(
    input.scanAuthorized,
    paths.scanAuthorized,
    scanAuthorizedSchema,
    "successor scan authorization",
    CLAIM_MAX_BYTES,
  );
  assertAuthorizationBindsClaim(scanAuthorized, claim);
  assertPathsAbsent(
    [paths.prepared, paths.complete],
    "A prepared or complete successor capture marker already exists.",
  );
  const now = canonicalDate(input.now ?? new Date(), "prepared-marker clock");
  assertWithinClaimWindow(now, claim.value, "prepared marker");
  assertTimestampOrder(
    scanAuthorized.value.createdAt,
    now.toISOString(),
    "The prepared marker cannot predate scan authorization.",
  );
  const report = parseStateValue(
    jsonObjectSchema,
    input.report,
    "prepared successor report",
  );
  assertForbiddenPlaintextAbsent(report, input.forbiddenPlaintextValues);
  const prepared = parseStateValue(
    preparedSchema,
    {
      kind: HISTORICAL_SUCCESSOR_CAPTURE_PREPARED_KIND,
      schemaVersion: 1,
      runId: claim.value.runId,
      createdAt: now.toISOString(),
      lockSha256: claim.sha256,
      scanAuthorizedSha256: scanAuthorized.sha256,
      reportSha256: successorCaptureJsonSha256(report),
      report,
    },
    "prepared successor capture",
  );
  const handle = writeExclusiveCanonicalState(
    paths.prepared,
    prepared,
    preparedSchema,
    "prepared successor capture",
    MARKER_MAX_BYTES,
  );
  assertSameDirectoryIdentity(paths.stateDirectory, directoryIdentity);
  assertCurrentHandle(
    claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  assertCurrentHandle(
    scanAuthorized,
    paths.scanAuthorized,
    scanAuthorizedSchema,
    "successor scan authorization",
    CLAIM_MAX_BYTES,
  );
  return handle;
}

export function completeHistoricalSuccessorCapture(input: {
  stateDirectory: string;
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
  scanAuthorized: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>;
  prepared: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared>;
  canonicalBaselinePath: string;
  now?: Date;
}): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureComplete> {
  const paths = historicalSuccessorCaptureStatePaths(input.stateDirectory);
  const directoryIdentity = assertPrivateStateDirectory(paths.stateDirectory);
  const claim = assertCurrentHandle(
    input.claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  const scanAuthorized = assertCurrentHandle(
    input.scanAuthorized,
    paths.scanAuthorized,
    scanAuthorizedSchema,
    "successor scan authorization",
    CLAIM_MAX_BYTES,
  );
  const prepared = assertCurrentHandle(
    input.prepared,
    paths.prepared,
    preparedSchema,
    "prepared successor capture",
    MARKER_MAX_BYTES,
  );
  assertAuthorizationBindsClaim(scanAuthorized, claim);
  assertPreparedBindsChain(prepared, claim, scanAuthorized);
  assertPathsAbsent(
    [paths.complete],
    "A complete successor capture marker already exists.",
  );
  const now = canonicalDate(input.now ?? new Date(), "completion-marker clock");
  assertTimestampOrder(
    prepared.value.createdAt,
    now.toISOString(),
    "The completion marker cannot predate the prepared marker.",
  );
  const baselinePath = parseStateValue(
    absolutePathSchema,
    path.resolve(input.canonicalBaselinePath),
    "canonical baseline path",
  );
  const baseline = readPrivateJsonDocument(
    baselinePath,
    "canonical successor baseline",
    CANONICAL_BASELINE_MAX_BYTES,
  );
  if (successorCaptureJsonSha256(baseline.value) !== prepared.value.reportSha256) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The canonical successor baseline does not equal the prepared report.",
    );
  }
  const complete = parseStateValue(
    completeSchema,
    {
      kind: HISTORICAL_SUCCESSOR_CAPTURE_COMPLETE_KIND,
      schemaVersion: 1,
      runId: claim.value.runId,
      completedAt: now.toISOString(),
      lockSha256: claim.sha256,
      scanAuthorizedSha256: scanAuthorized.sha256,
      preparedSha256: prepared.sha256,
      canonicalBaselinePath: baselinePath,
      canonicalBaselineSha256: baseline.sha256,
      backupDir: claim.value.backupDir,
      policyId: claim.value.policyId,
      policySha256: claim.value.policySha256,
      archiveManifestSha256: claim.value.archiveManifestSha256,
      predecessorBaselineSha256: claim.value.predecessorBaselineSha256,
      predecessorHmacKeyId: claim.value.predecessorHmacKeyId,
      source: claim.value.source,
      operationId: claim.value.operationId,
      utcDay: claim.value.utcDay,
      windowEndsAt: claim.value.windowEndsAt,
      snapshotPlanSha256: scanAuthorized.value.snapshotPlanSha256,
      maximumRowsRead: scanAuthorized.value.maximumRowsRead,
    },
    "complete successor capture",
  );
  const handle = writeExclusiveCanonicalState(
    paths.complete,
    complete,
    completeSchema,
    "complete successor capture",
    CLAIM_MAX_BYTES,
  );
  assertSameDirectoryIdentity(paths.stateDirectory, directoryIdentity);
  assertCurrentHandle(
    claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  assertCurrentHandle(
    prepared,
    paths.prepared,
    preparedSchema,
    "prepared successor capture",
    MARKER_MAX_BYTES,
  );
  return handle;
}

export function finalizeHistoricalSuccessorScanAuthorizationPublication(input: {
  stateDirectory: string;
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
  resumeLease: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureResumeLease>;
  scanAuthorized: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>;
}): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization> {
  const paths = historicalSuccessorCaptureStatePaths(input.stateDirectory);
  const directoryIdentity = assertPrivateStateDirectory(paths.stateDirectory);
  const claim = assertCurrentHandle(
    input.claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  assertCurrentLatestResumeLease({
    stateDirectory: paths.stateDirectory,
    claim,
    resumeLease: input.resumeLease,
    requireCurrentProcessOwner: true,
  });
  const resumeLeaseChain = readAndValidateResumeLeaseChain(
    paths.stateDirectory,
    claim,
  );
  if (path.resolve(input.scanAuthorized.path) !== paths.scanAuthorized) {
    throw stateError(
      "STATE_HANDLE_CHANGED",
      "The interrupted scan authorization points outside its fixed state path.",
    );
  }
  const authorizationValue = parseStateValue(
    scanAuthorizedSchema,
    input.scanAuthorized.value,
    "interrupted successor scan authorization",
  );
  const expectedPayload = Buffer.from(
    `${canonicalSuccessorCaptureJson(authorizationValue)}\n`,
    "utf8",
  );
  const expectedSha256 = createHash("sha256")
    .update(expectedPayload)
    .digest("hex");
  if (expectedSha256 !== input.scanAuthorized.sha256) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The interrupted scan authorization handle has the wrong canonical hash.",
    );
  }
  if (
    authorizationValue.resumeLeaseSha256 !== null &&
    !resumeLeaseChain.some(
      (lease) => lease.sha256 === authorizationValue.resumeLeaseSha256,
    )
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The interrupted scan authorization is bound to a different resume lease.",
    );
  }
  const alias = inspectExactPublishedTemporaryStateAlias(
    paths.scanAuthorized,
    "successor scan authorization",
  );
  if (
    !alias ||
    !sameFileIdentity(alias.identity, input.scanAuthorized.identity)
  ) {
    throw stateError(
      "STATE_HANDLE_CHANGED",
      "The interrupted scan authorization no longer has its exact publication alias.",
    );
  }
  assertAuthorizationBindsClaim(input.scanAuthorized, claim);

  // This is the first successful directory sync for an earlier interrupted
  // publication. Only after it succeeds may this exact authorization be used
  // at the last pre-D1 cut line.
  fsyncDirectory(paths.stateDirectory);
  try {
    removePublishedTemporaryStateAlias({
      temporaryFile: alias.aliasFile,
      publicFile: paths.scanAuthorized,
      expectedIdentity: alias.identity,
      expectedPayload,
    });
    fsyncDirectory(paths.stateDirectory);
  } catch {
    // The exact public inode is durable; retained alias cleanup is recoverable.
  }
  assertSameDirectoryIdentity(paths.stateDirectory, directoryIdentity);
  const finalized = readCanonicalState(
    paths.scanAuthorized,
    scanAuthorizedSchema,
    "successor scan authorization",
    CLAIM_MAX_BYTES,
  );
  if (
    finalized.sha256 !== input.scanAuthorized.sha256 ||
    !sameFileIdentity(finalized.identity, input.scanAuthorized.identity)
  ) {
    throw stateError(
      "STATE_HANDLE_CHANGED",
      "The scan authorization changed while its publication was finalized.",
    );
  }
  assertAuthorizationBindsClaim(finalized, claim);
  return finalized;
}

export function classifyHistoricalSuccessorCaptureState(input: {
  stateDirectory: string;
  expected?: HistoricalSuccessorCaptureExpectedIdentity;
}): HistoricalSuccessorCaptureState {
  const paths = historicalSuccessorCaptureStatePaths(input.stateDirectory);
  assertPrivateStateDirectory(paths.stateDirectory);
  const presence = {
    lock: pathEntryExists(paths.lock),
    scanAuthorized: pathEntryExists(paths.scanAuthorized),
    prepared: pathEntryExists(paths.prepared),
    complete: pathEntryExists(paths.complete),
  };
  if (!presence.lock && !presence.scanAuthorized && !presence.prepared && !presence.complete) {
    return {
      status: "empty",
      d1ScanMayHaveStarted: false,
      automaticRescanAllowed: true,
    };
  }
  const claim = presence.lock
    ? readHistoricalSuccessorCaptureClaim(paths.stateDirectory)
    : undefined;
  const resumeLeases = claim
    ? readAndValidateResumeLeaseChain(paths.stateDirectory, claim)
    : readHistoricalSuccessorCaptureResumeLeases(paths.stateDirectory);
  if (!claim && resumeLeases.length > 0) {
    throw stateError(
      "STATE_INCONSISTENT",
      "Historical successor resume leases exist without their immutable claim.",
    );
  }
  const interruptedAuthorizationAlias = presence.scanAuthorized &&
      !presence.prepared &&
      !presence.complete
    ? inspectExactPublishedTemporaryStateAlias(
        paths.scanAuthorized,
        "successor scan authorization",
      )
    : undefined;
  const scanAuthorized = presence.scanAuthorized
    ? interruptedAuthorizationAlias
      ? readCanonicalState(
          paths.scanAuthorized,
          scanAuthorizedSchema,
          "successor scan authorization",
          CLAIM_MAX_BYTES,
          { preserveExactPublicationAlias: interruptedAuthorizationAlias },
        )
      : readHistoricalSuccessorCaptureScanAuthorization(paths.stateDirectory)
    : undefined;
  const prepared = presence.prepared
    ? readHistoricalSuccessorCapturePrepared(paths.stateDirectory)
    : undefined;
  const complete = presence.complete
    ? readHistoricalSuccessorCaptureComplete(paths.stateDirectory)
    : undefined;

  if (
    scanAuthorized?.value.resumeLeaseSha256 !== null &&
    scanAuthorized?.value.resumeLeaseSha256 !== undefined &&
    !resumeLeases.some(
      (lease) => lease.sha256 === scanAuthorized.value.resumeLeaseSha256,
    )
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "Successor scan authorization references a missing resume lease.",
    );
  }

  if (scanAuthorized && claim) assertAuthorizationBindsClaim(scanAuthorized, claim);
  if (prepared) {
    if (!scanAuthorized) {
      throw stateError(
        "STATE_INCONSISTENT",
        "Prepared successor capture evidence exists without scan authorization.",
      );
    }
    assertPreparedBindsAuthorization(prepared, scanAuthorized);
    if (claim) assertPreparedBindsChain(prepared, claim, scanAuthorized);
  }
  if (complete) {
    if (!scanAuthorized || !prepared) {
      throw stateError(
        "STATE_INCONSISTENT",
        "Complete successor capture evidence lacks its authorization or prepared marker.",
      );
    }
    assertCompleteBindsChain(complete, claim, scanAuthorized, prepared);
    assertCompletedBaselineCurrent(complete, prepared);
    if (input.expected) {
      assertExpectedIdentity(
        input.expected,
        claim?.value ?? complete.value,
        scanAuthorized.value,
      );
    }
    if (claim) {
      return {
        status: "complete-retained-claim",
        d1ScanMayHaveStarted: true,
        automaticRescanAllowed: false,
        canReplayWithoutScan: true,
        claim,
        scanAuthorized,
        prepared,
        complete,
      };
    }
    return {
      status: "complete",
      d1ScanMayHaveStarted: true,
      automaticRescanAllowed: false,
      canReplayWithoutScan: true,
      scanAuthorized,
      prepared,
      complete,
    };
  }

  if (!claim) {
    throw stateError(
      "STATE_INCONSISTENT",
      "Unresolved successor capture evidence exists without its exact claim.",
    );
  }
  if (input.expected) {
    assertExpectedIdentity(input.expected, claim.value, scanAuthorized?.value);
  }
  if (prepared) {
    if (!scanAuthorized) {
      throw stateError(
        "STATE_INCONSISTENT",
        "Prepared successor capture evidence exists without scan authorization.",
      );
    }
    return {
      status: "prepared",
      d1ScanMayHaveStarted: true,
      automaticRescanAllowed: false,
      canFinalizeWithoutScan: true,
      claim,
      scanAuthorized,
      prepared,
    };
  }
  if (scanAuthorized) {
    if (interruptedAuthorizationAlias) {
      return {
        status: "scan-authorization-publication-interrupted",
        d1ScanMayHaveStarted: false,
        automaticRescanAllowed: false,
        canResumeExactAuthorization: true,
        claim,
        scanAuthorized,
      };
    }
    return {
      status: "scan-authorized-unresolved",
      d1ScanMayHaveStarted: true,
      automaticRescanAllowed: false,
      claim,
      scanAuthorized,
    };
  }
  return {
    status: "claimed-pre-scan",
    d1ScanMayHaveStarted: false,
    automaticRescanAllowed: false,
    claim,
  };
}

export function readHistoricalSuccessorCaptureClaim(
  stateDirectory: string,
): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim> {
  const paths = historicalSuccessorCaptureStatePaths(stateDirectory);
  assertPrivateStateDirectory(paths.stateDirectory);
  return readCanonicalState(
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
}

function readHistoricalSuccessorCaptureScanAuthorization(
  stateDirectory: string,
): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization> {
  const paths = historicalSuccessorCaptureStatePaths(stateDirectory);
  assertPrivateStateDirectory(paths.stateDirectory);
  return readCanonicalState(
    paths.scanAuthorized,
    scanAuthorizedSchema,
    "successor scan authorization",
    CLAIM_MAX_BYTES,
  );
}

function readHistoricalSuccessorCapturePrepared(
  stateDirectory: string,
): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared> {
  const paths = historicalSuccessorCaptureStatePaths(stateDirectory);
  assertPrivateStateDirectory(paths.stateDirectory);
  return readCanonicalState(
    paths.prepared,
    preparedSchema,
    "prepared successor capture",
    MARKER_MAX_BYTES,
  );
}

function readHistoricalSuccessorCaptureComplete(
  stateDirectory: string,
): HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureComplete> {
  const paths = historicalSuccessorCaptureStatePaths(stateDirectory);
  assertPrivateStateDirectory(paths.stateDirectory);
  return readCanonicalState(
    paths.complete,
    completeSchema,
    "complete successor capture",
    CLAIM_MAX_BYTES,
  );
}

export function canonicalSuccessorCaptureJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw stateError(
        "STATE_SCHEMA_INVALID",
        "Successor capture evidence cannot contain a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSuccessorCaptureJson).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareUnicodeCodePoints)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalSuccessorCaptureJson(value[key])}`,
      )
      .join(",")}}`;
  }
  throw stateError(
    "STATE_SCHEMA_INVALID",
    `Successor capture evidence cannot encode a value of type ${typeof value}.`,
  );
}

export function successorCaptureJsonSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalSuccessorCaptureJson(value), "utf8")
    .digest("hex");
}

export function successorCaptureStateFileSha256(value: unknown): string {
  return createHash("sha256")
    .update(`${canonicalSuccessorCaptureJson(value)}\n`, "utf8")
    .digest("hex");
}

function readAndValidateResumeLeaseChain(
  stateDirectory: string,
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>,
) {
  const leases = readHistoricalSuccessorCaptureResumeLeases(stateDirectory);
  for (const lease of leases) {
    if (
      lease.value.runId !== claim.value.runId ||
      lease.value.claimSha256 !== claim.sha256 ||
      Date.parse(lease.value.createdAt) < Date.parse(claim.value.createdAt) ||
      Date.parse(lease.value.createdAt) > Date.parse(claim.value.windowEndsAt)
    ) {
      throw stateError(
        "STATE_CHAIN_BROKEN",
        "Historical successor resume lease does not bind the exact claim and capture window.",
      );
    }
  }
  return leases;
}

function assertResumeTakeoverOwnerUnavailable(owner: {
  hostname: string;
  pid: number;
}) {
  if (owner.hostname !== os.hostname()) {
    throw stateError(
      "STATE_CONFLICT",
      "Historical successor resume cannot take ownership from another host.",
    );
  }
  if (owner.pid === process.pid) return;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") return;
    throw stateError(
      "STATE_CONFLICT",
      "Historical successor resume could not prove that the prior owner exited.",
    );
  }
  throw stateError(
    "STATE_CONFLICT",
    "Historical successor resume refuses to supersede a live prior owner.",
  );
}

function assertCurrentLatestResumeLease(input: {
  stateDirectory: string;
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
  resumeLease: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureResumeLease>;
  requireCurrentProcessOwner: boolean;
}) {
  const paths = historicalSuccessorCaptureStatePaths(input.stateDirectory);
  const claim = assertCurrentHandle(
    input.claim,
    paths.lock,
    claimSchema,
    "successor capture claim",
    CLAIM_MAX_BYTES,
  );
  const leases = readAndValidateResumeLeaseChain(paths.stateDirectory, claim);
  const latest = leases.at(-1);
  if (
    !latest ||
    latest.sha256 !== input.resumeLease.sha256 ||
    !sameFileIdentity(latest.identity, input.resumeLease.identity)
  ) {
    throw stateError(
      "STATE_HANDLE_CHANGED",
      "Historical successor resume lease is not the exact latest owner.",
    );
  }
  if (
    input.requireCurrentProcessOwner &&
    (latest.value.owner.hostname !== os.hostname() ||
      latest.value.owner.pid !== process.pid)
  ) {
    throw stateError(
      "STATE_CONFLICT",
      "Historical successor resume lease is not owned by this exact process.",
    );
  }
  return latest;
}

function assertAuthorizationBindsClaim(
  authorization: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>,
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>,
) {
  const authorized = authorization.value;
  const locked = claim.value;
  if (
    authorized.runId !== locked.runId ||
    authorized.lockSha256 !== claim.sha256 ||
    authorized.policyId !== locked.policyId ||
    authorized.policySha256 !== locked.policySha256 ||
    authorized.source.sha256 !== locked.source.sha256 ||
    authorized.source.fileCount !== locked.source.fileCount ||
    authorized.operationId !== locked.operationId ||
    authorized.utcDay !== locked.utcDay ||
    Date.parse(authorized.createdAt) < Date.parse(locked.createdAt) ||
    Date.parse(authorized.createdAt) > Date.parse(locked.windowEndsAt)
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The scan-authorization marker does not bind the exact successor capture claim.",
    );
  }
}

function assertPreparedBindsAuthorization(
  prepared: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared>,
  authorization: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>,
) {
  if (
    prepared.value.runId !== authorization.value.runId ||
    prepared.value.lockSha256 !== authorization.value.lockSha256 ||
    prepared.value.scanAuthorizedSha256 !== authorization.sha256 ||
    Date.parse(prepared.value.createdAt) < Date.parse(authorization.value.createdAt)
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The prepared marker does not bind the exact scan authorization.",
    );
  }
}

function assertPreparedBindsChain(
  prepared: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared>,
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>,
  authorization: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>,
) {
  assertPreparedBindsAuthorization(prepared, authorization);
  if (
    prepared.value.runId !== claim.value.runId ||
    prepared.value.lockSha256 !== claim.sha256 ||
    Date.parse(prepared.value.createdAt) > Date.parse(claim.value.windowEndsAt)
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The prepared marker does not bind the exact successor capture claim.",
    );
  }
}

function assertCompleteBindsChain(
  complete: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureComplete>,
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim> | undefined,
  authorization: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>,
  prepared: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared>,
) {
  const marker = complete.value;
  if (
    marker.runId !== authorization.value.runId ||
    marker.runId !== prepared.value.runId ||
    marker.lockSha256 !== authorization.value.lockSha256 ||
    marker.lockSha256 !== prepared.value.lockSha256 ||
    marker.scanAuthorizedSha256 !== authorization.sha256 ||
    marker.preparedSha256 !== prepared.sha256 ||
    marker.policyId !== authorization.value.policyId ||
    marker.policySha256 !== authorization.value.policySha256 ||
    marker.source.sha256 !== authorization.value.source.sha256 ||
    marker.source.fileCount !== authorization.value.source.fileCount ||
    marker.operationId !== authorization.value.operationId ||
    marker.utcDay !== authorization.value.utcDay ||
    marker.snapshotPlanSha256 !== authorization.value.snapshotPlanSha256 ||
    marker.maximumRowsRead !== authorization.value.maximumRowsRead ||
    Date.parse(marker.completedAt) < Date.parse(prepared.value.createdAt)
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The completion marker does not bind its exact successor capture evidence chain.",
    );
  }
  if (claim) {
    assertAuthorizationBindsClaim(authorization, claim);
    assertPreparedBindsChain(prepared, claim, authorization);
    assertExpectedIdentity(
      completeIdentity(marker),
      claim.value,
      authorization.value,
    );
    if (marker.lockSha256 !== claim.sha256) {
      throw stateError(
        "STATE_CHAIN_BROKEN",
        "The completion marker does not bind the current successor capture claim.",
      );
    }
  }
}

function assertCompletedBaselineCurrent(
  complete: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureComplete>,
  prepared: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCapturePrepared>,
) {
  const baseline = readPrivateJsonDocument(
    complete.value.canonicalBaselinePath,
    "canonical successor baseline",
    CANONICAL_BASELINE_MAX_BYTES,
  );
  if (
    baseline.sha256 !== complete.value.canonicalBaselineSha256 ||
    successorCaptureJsonSha256(baseline.value) !== prepared.value.reportSha256
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The canonical successor baseline changed after completion.",
    );
  }
}

function assertExpectedIdentity(
  expectedInput: HistoricalSuccessorCaptureExpectedIdentity,
  actual:
    | HistoricalSuccessorCaptureClaim
    | HistoricalSuccessorCaptureComplete,
  authorization?: HistoricalSuccessorCaptureScanAuthorization,
) {
  const expected = parseExpectedIdentity(expectedInput);
  if (
    actual.backupDir !== expected.backupDir ||
    actual.policyId !== expected.policyId ||
    actual.policySha256 !== expected.policySha256 ||
    actual.archiveManifestSha256 !== expected.archiveManifestSha256 ||
    actual.predecessorBaselineSha256 !== expected.predecessorBaselineSha256 ||
    actual.predecessorHmacKeyId !== expected.predecessorHmacKeyId ||
    actual.source.sha256 !== expected.source.sha256 ||
    actual.source.fileCount !== expected.source.fileCount ||
    actual.operationId !== expected.operationId ||
    actual.utcDay !== expected.utcDay ||
    actual.windowEndsAt !== expected.windowEndsAt ||
    ("snapshotPlanSha256" in actual &&
      actual.snapshotPlanSha256 !== expected.snapshotPlanSha256) ||
    ("maximumRowsRead" in actual &&
      actual.maximumRowsRead !== expected.maximumRowsRead) ||
    (authorization !== undefined &&
      (authorization.snapshotPlanSha256 !== expected.snapshotPlanSha256 ||
        authorization.maximumRowsRead !== expected.maximumRowsRead))
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "Successor capture evidence does not match the expected policy, source, or operation.",
    );
  }
}

function parseExpectedIdentity(
  value: HistoricalSuccessorCaptureExpectedIdentity,
): HistoricalSuccessorCaptureExpectedIdentity {
  return parseStateValue(
    expectedIdentitySchema,
    value,
    "expected successor capture identity",
  );
}

function completeIdentity(
  value: HistoricalSuccessorCaptureComplete,
): HistoricalSuccessorCaptureExpectedIdentity {
  return {
    backupDir: value.backupDir,
    policyId: value.policyId,
    policySha256: value.policySha256,
    archiveManifestSha256: value.archiveManifestSha256,
    predecessorBaselineSha256: value.predecessorBaselineSha256,
    predecessorHmacKeyId: value.predecessorHmacKeyId,
    source: value.source,
    operationId: value.operationId,
    utcDay: value.utcDay,
    windowEndsAt: value.windowEndsAt,
    snapshotPlanSha256: value.snapshotPlanSha256,
    maximumRowsRead: value.maximumRowsRead,
  };
}

function assertWithinClaimWindow(
  value: Date,
  claim: HistoricalSuccessorCaptureClaim,
  label: string,
) {
  const timestamp = value.toISOString();
  if (
    timestamp.slice(0, 10) !== claim.utcDay ||
    Date.parse(timestamp) < Date.parse(claim.createdAt) ||
    Date.parse(timestamp) > Date.parse(claim.windowEndsAt)
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      `The ${label} is outside the exact successor capture window.`,
    );
  }
}

function assertTimestampOrder(before: string, after: string, message: string) {
  if (Date.parse(after) < Date.parse(before)) {
    throw stateError("STATE_CHAIN_BROKEN", message);
  }
}

function assertCurrentHandle<T>(
  expected: HistoricalSuccessorCaptureFileHandle<T>,
  expectedPath: string,
  schema: z.ZodType<T>,
  label: string,
  maximumBytes: number,
): HistoricalSuccessorCaptureFileHandle<T> {
  if (path.resolve(expected.path) !== expectedPath) {
    throw stateError(
      "STATE_HANDLE_CHANGED",
      `The ${label} handle points outside its fixed state path.`,
    );
  }
  const current = readCanonicalState(
    expectedPath,
    schema,
    label,
    maximumBytes,
  );
  if (
    current.sha256 !== expected.sha256 ||
    !sameFileIdentity(current.identity, expected.identity)
  ) {
    throw stateError(
      "STATE_HANDLE_CHANGED",
      `The ${label} changed after its exact handle was acquired.`,
    );
  }
  return current;
}

function writeExclusiveCanonicalState<T>(
  file: string,
  value: T,
  schema: z.ZodType<T>,
  label: string,
  maximumBytes: number,
): HistoricalSuccessorCaptureFileHandle<T> {
  const parsed = parseStateValue(schema, value, label);
  const payload = Buffer.from(`${canonicalSuccessorCaptureJson(parsed)}\n`, "utf8");
  if (payload.byteLength <= 0 || payload.byteLength > maximumBytes) {
    throw stateError(
      "STATE_SCHEMA_INVALID",
      `The ${label} exceeds its bounded evidence size.`,
    );
  }
  const directory = path.dirname(file);
  const directoryIdentity = assertPrivateStateDirectory(directory);
  const temporaryFile = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      temporaryFile,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} staging file could not be created exclusively and safely.`,
    );
  }
  let writeError: unknown;
  let temporaryIdentity: { device: number; inode: number } | undefined;
  try {
    fs.fchmodSync(descriptor, 0o600);
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      (opened.mode & 0o777) !== 0o600 ||
      opened.nlink !== 1 ||
      opened.size !== 0 ||
      (typeof process.getuid === "function" && opened.uid !== process.getuid())
    ) {
      throw stateError(
        "STATE_FILE_UNSAFE",
        `The ${label} staging file has unsafe initial ownership, mode, type, link count, or size.`,
      );
    }
    temporaryIdentity = statIdentity(opened);
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    const staged = fs.fstatSync(descriptor);
    if (
      !staged.isFile() ||
      (staged.mode & 0o777) !== 0o600 ||
      staged.nlink !== 1 ||
      staged.size !== payload.byteLength ||
      (typeof process.getuid === "function" && staged.uid !== process.getuid())
    ) {
      throw stateError(
        "STATE_FILE_UNSAFE",
        `The ${label} staging file has unsafe ownership, mode, type, link count, or size.`,
      );
    }
    if (!sameFileIdentity(statIdentity(staged), temporaryIdentity)) {
      throw stateError(
        "STATE_HANDLE_CHANGED",
        `The ${label} staging inode changed during its exact write.`,
      );
    }
  } catch (error) {
    writeError = error;
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch (error) {
      writeError ??= error;
    }
  }
  if (writeError !== undefined || !temporaryIdentity) {
    if (temporaryIdentity) {
      tryRemoveExactTemporaryStateFile({
        temporaryFile,
        expectedIdentity: temporaryIdentity,
      });
      fsyncDirectory(directory);
    }
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} staging write was interrupted; no public state file was published.`,
    );
  }
  try {
    // A hard link publishes the fully fsynced inode only when the public name
    // is absent. Unlike rename(), this cannot overwrite a concurrent winner.
    fs.linkSync(temporaryFile, file);
  } catch (error) {
    tryRemoveExactTemporaryStateFile({
      temporaryFile,
      expectedIdentity: temporaryIdentity,
    });
    fsyncDirectory(directory);
    if (isNodeError(error) && error.code === "EEXIST") {
      throw stateError(
        "STATE_CONFLICT",
        `The ${label} is already active or unresolved.`,
      );
    }
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} could not be published atomically without replacement.`,
    );
  }
  // The public name is not a durable authorization until this directory sync
  // succeeds. Cleanup after this point is cosmetic: an exact nlink=2 staging
  // alias is recoverable and must never make the already-durable writer fail.
  try {
    fsyncDirectory(directory);
  } catch {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} publication was interrupted before its first directory sync.`,
    );
  }
  try {
    removePublishedTemporaryStateAlias({
      temporaryFile,
      publicFile: file,
      expectedIdentity: temporaryIdentity,
      expectedPayload: payload,
    });
    fsyncDirectory(directory);
  } catch {
    // The public inode is already complete and durable. A retained exact
    // staging alias is safe and will be retried by a later reader.
  }
  assertSameDirectoryIdentity(directory, directoryIdentity);
  const readback = readCanonicalState(file, schema, label, maximumBytes);
  const expectedSha256 = createHash("sha256").update(payload).digest("hex");
  if (readback.sha256 !== expectedSha256) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      `The ${label} failed exact durable readback.`,
    );
  }
  return readback;
}

function readCanonicalState<T>(
  file: string,
  schema: z.ZodType<T>,
  label: string,
  maximumBytes: number,
  options?: {
    preserveExactPublicationAlias?: ExactPublishedTemporaryStateAlias;
  },
): HistoricalSuccessorCaptureFileHandle<T> {
  const document = readPrivateJsonDocument(file, label, maximumBytes, options);
  const value = parseStateValue(schema, document.value, label);
  const expected = Buffer.from(
    `${canonicalSuccessorCaptureJson(value)}\n`,
    "utf8",
  );
  if (!document.bytes.equals(expected)) {
    throw stateError(
      "STATE_SCHEMA_INVALID",
      `The ${label} is not canonical exact-schema JSON.`,
    );
  }
  return {
    path: path.resolve(file),
    value,
    sha256: document.sha256,
    identity: document.identity,
  };
}

function readPrivateJsonDocument(
  file: string,
  label: string,
  maximumBytes: number,
  options?: {
    preserveExactPublicationAlias?: ExactPublishedTemporaryStateAlias;
  },
): {
  value: SuccessorCaptureJsonObject;
  bytes: Buffer;
  sha256: string;
  identity: { device: number; inode: number };
} {
  const absolute = path.resolve(file);
  const preservedAlias = options?.preserveExactPublicationAlias;
  if (!preservedAlias) recoverPublishedTemporaryStateAlias(absolute, label);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw stateError("STATE_MISSING", `The ${label} is missing.`);
    }
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} must be a regular owner-only mode-0600 non-symlink file.`,
    );
  }
  try {
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      (before.mode & 0o777) !== 0o600 ||
      before.nlink !== (preservedAlias ? 2 : 1) ||
      before.size <= 0 ||
      before.size > maximumBytes ||
      (typeof process.getuid === "function" && before.uid !== process.getuid())
    ) {
      throw stateError(
        "STATE_FILE_UNSAFE",
        `The ${label} has unsafe ownership, mode, type, link count, or size.`,
      );
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      bytes.byteLength !== before.size ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      after.nlink !== before.nlink
    ) {
      throw stateError(
        "STATE_FILE_UNSAFE",
        `The ${label} changed while it was being read.`,
      );
    }
    if (preservedAlias) {
      assertExactPublishedTemporaryStateAliasCurrent(
        absolute,
        preservedAlias,
        label,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw stateError(
        "STATE_SCHEMA_INVALID",
        `The ${label} is not valid JSON.`,
      );
    }
    const value = parseStateValue(jsonObjectSchema, parsed, label);
    return {
      value,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      identity: statIdentity(before),
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

type ExactPublishedTemporaryStateAlias = {
  aliasFile: string;
  identity: { device: number; inode: number };
};

function inspectExactPublishedTemporaryStateAlias(
  file: string,
  label: string,
): ExactPublishedTemporaryStateAlias | undefined {
  if (!isHistoricalSuccessorCapturePublicFileName(path.basename(file))) {
    return undefined;
  }
  const directory = path.dirname(file);
  assertPrivateStateDirectory(directory);
  let publicStat: fs.Stats;
  try {
    publicStat = fs.lstatSync(file);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} public state path could not be inspected safely.`,
    );
  }
  if (publicStat.nlink === 1) return undefined;
  if (
    publicStat.nlink !== 2 ||
    !publicStat.isFile() ||
    publicStat.isSymbolicLink() ||
    (publicStat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && publicStat.uid !== process.getuid())
  ) {
    return undefined;
  }
  const prefix = `.${path.basename(file)}.`;
  const aliases = fs.readdirSync(directory)
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".tmp"))
    .map((entry) => path.join(directory, entry))
    .filter((entry) => {
      const stat = fs.lstatSync(entry);
      return sameFileIdentity(statIdentity(stat), statIdentity(publicStat));
    });
  if (aliases.length !== 1) return undefined;
  return {
    aliasFile: aliases[0]!,
    identity: statIdentity(publicStat),
  };
}

function assertExactPublishedTemporaryStateAliasCurrent(
  publicFile: string,
  expected: ExactPublishedTemporaryStateAlias,
  label: string,
) {
  const publicStat = safeLstat(publicFile, label);
  const aliasStat = safeLstat(
    expected.aliasFile,
    "successor capture staging alias",
  );
  if (
    !publicStat.isFile() ||
    publicStat.isSymbolicLink() ||
    !aliasStat.isFile() ||
    aliasStat.isSymbolicLink() ||
    publicStat.nlink !== 2 ||
    aliasStat.nlink !== 2 ||
    (publicStat.mode & 0o777) !== 0o600 ||
    (aliasStat.mode & 0o777) !== 0o600 ||
    !sameFileIdentity(statIdentity(publicStat), expected.identity) ||
    !sameFileIdentity(statIdentity(aliasStat), expected.identity) ||
    (typeof process.getuid === "function" &&
      (publicStat.uid !== process.getuid() || aliasStat.uid !== process.getuid()))
  ) {
    throw stateError(
      "STATE_HANDLE_CHANGED",
      `The ${label} publication alias changed while it was inspected.`,
    );
  }
}

function recoverPublishedTemporaryStateAlias(file: string, label: string) {
  const alias = inspectExactPublishedTemporaryStateAlias(file, label);
  if (!alias) return;
  try {
    removePublishedTemporaryStateAlias({
      temporaryFile: alias.aliasFile,
      publicFile: file,
      expectedIdentity: alias.identity,
    });
    fsyncDirectory(path.dirname(file));
  } catch {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} has an unresolved publication alias.`,
    );
  }
}

function removePublishedTemporaryStateAlias(options: {
  temporaryFile: string;
  publicFile: string;
  expectedIdentity: { device: number; inode: number };
  expectedPayload?: Buffer;
}) {
  let temporaryStat: fs.Stats;
  try {
    temporaryStat = fs.lstatSync(options.temporaryFile);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      assertPublishedAliasRemoved(options);
      return;
    }
    throw stateError(
      "STATE_FILE_UNSAFE",
      "The successor capture staging alias could not be inspected safely.",
    );
  }
  const publicStat = safeLstat(options.publicFile, "successor capture public state");
  if (publicStat.nlink === 1) {
    assertPublishedAliasRemoved(options);
    return;
  }
  if (
    !temporaryStat.isFile() ||
    temporaryStat.isSymbolicLink() ||
    !publicStat.isFile() ||
    publicStat.isSymbolicLink() ||
    (temporaryStat.mode & 0o777) !== 0o600 ||
    (publicStat.mode & 0o777) !== 0o600 ||
    temporaryStat.nlink !== 2 ||
    publicStat.nlink !== 2 ||
    !sameFileIdentity(statIdentity(temporaryStat), options.expectedIdentity) ||
    !sameFileIdentity(statIdentity(publicStat), options.expectedIdentity) ||
    (typeof process.getuid === "function" &&
      (temporaryStat.uid !== process.getuid() || publicStat.uid !== process.getuid()))
  ) {
    throw stateError(
      "STATE_HANDLE_CHANGED",
      "The successor capture publication alias changed before exact cleanup.",
    );
  }
  try {
    fs.unlinkSync(options.temporaryFile);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      throw stateError(
        "STATE_FILE_UNSAFE",
        "The successor capture staging alias could not be removed safely.",
      );
    }
  }
  assertPublishedAliasRemoved(options);
}

function assertPublishedAliasRemoved(options: {
  publicFile: string;
  expectedIdentity: { device: number; inode: number };
  expectedPayload?: Buffer;
}) {
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      options.publicFile,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw stateError(
      "STATE_FILE_UNSAFE",
      "The successor capture public state could not be reopened after alias cleanup.",
    );
  }
  try {
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      (before.mode & 0o777) !== 0o600 ||
      before.nlink !== 1 ||
      !sameFileIdentity(statIdentity(before), options.expectedIdentity) ||
      (typeof process.getuid === "function" && before.uid !== process.getuid())
    ) {
      throw stateError(
        "STATE_HANDLE_CHANGED",
        "The successor capture public state changed during alias cleanup.",
      );
    }
    if (options.expectedPayload) {
      const bytes = fs.readFileSync(descriptor);
      const after = fs.fstatSync(descriptor);
      if (
        !bytes.equals(options.expectedPayload) ||
        after.size !== before.size ||
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      ) {
        throw stateError(
          "STATE_CHAIN_BROKEN",
          "The successor capture public state failed exact alias-cleanup readback.",
        );
      }
    }
    const named = safeLstat(
      options.publicFile,
      "successor capture public state",
    );
    if (
      named.nlink !== 1 ||
      !sameFileIdentity(statIdentity(named), options.expectedIdentity)
    ) {
      throw stateError(
        "STATE_HANDLE_CHANGED",
        "The successor capture public path changed during alias cleanup.",
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function tryRemoveExactTemporaryStateFile(options: {
  temporaryFile: string;
  expectedIdentity: { device: number; inode: number };
}) {
  let temporaryStat: fs.Stats;
  try {
    temporaryStat = fs.lstatSync(options.temporaryFile);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    return;
  }
  if (
    !temporaryStat.isFile() ||
    temporaryStat.isSymbolicLink() ||
    (temporaryStat.mode & 0o777) !== 0o600 ||
    temporaryStat.nlink !== 1 ||
    !sameFileIdentity(statIdentity(temporaryStat), options.expectedIdentity) ||
    (typeof process.getuid === "function" && temporaryStat.uid !== process.getuid())
  ) {
    return;
  }
  fs.unlinkSync(options.temporaryFile);
}

function parseStateValue<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw stateError(
      "STATE_SCHEMA_INVALID",
      `The ${label} has invalid or non-exact schema.`,
    );
  }
  return result.data;
}

function assertPathsAbsent(files: readonly string[], message: string) {
  if (files.some(pathEntryExists)) {
    throw stateError("STATE_CONFLICT", message);
  }
}

function assertPrivateStateDirectory(directory: string) {
  const absolute = path.resolve(directory);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw stateError(
      "STATE_DIRECTORY_UNSAFE",
      "The successor capture state directory must be a real owner-only mode-0700 directory.",
    );
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw stateError(
        "STATE_DIRECTORY_UNSAFE",
        "The successor capture state directory must be a real owner-only mode-0700 directory.",
      );
    }
    return statIdentity(stat);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSameDirectoryIdentity(
  directory: string,
  expected: { device: number; inode: number },
) {
  const current = assertPrivateStateDirectory(directory);
  if (!sameFileIdentity(current, expected)) {
    throw stateError(
      "STATE_DIRECTORY_UNSAFE",
      "The successor capture state directory changed during the state transition.",
    );
  }
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(
    path.resolve(directory),
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function canonicalDate(value: Date, label: string) {
  if (!Number.isFinite(value.getTime())) {
    throw stateError("STATE_SCHEMA_INVALID", `The ${label} is invalid.`);
  }
  return new Date(value.getTime());
}

function pathEntryExists(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw stateError(
      "STATE_FILE_UNSAFE",
      "A successor capture state path could not be inspected safely.",
    );
  }
}

function safeLstat(file: string, label: string) {
  try {
    return fs.lstatSync(file);
  } catch {
    throw stateError(
      "STATE_HANDLE_CHANGED",
      `The ${label} disappeared before exact cleanup.`,
    );
  }
}

function statIdentity(stat: fs.Stats) {
  return { device: stat.dev, inode: stat.ino };
}

function sameFileIdentity(
  left: { device: number; inode: number },
  right: { device: number; inode: number },
) {
  return left.device === right.device && left.inode === right.inode;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isJsonObject(value: unknown): value is SuccessorCaptureJsonObject {
  return isPlainRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is SuccessorCaptureJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function assertForbiddenPlaintextAbsent(
  value: SuccessorCaptureJsonValue,
  forbiddenValues: readonly [string, ...string[]],
) {
  for (const forbidden of forbiddenValues) {
    if (forbidden.length < 16) {
      throw stateError(
        "STATE_SCHEMA_INVALID",
        "A forbidden plaintext guard value must contain at least 16 characters.",
      );
    }
    if (jsonValueContainsPlaintext(value, forbidden)) {
      throw stateError(
        "STATE_SCHEMA_INVALID",
        "The prepared successor report contains forbidden sensitive plaintext.",
      );
    }
  }
}

function jsonValueContainsPlaintext(
  value: SuccessorCaptureJsonValue,
  forbidden: string,
): boolean {
  if (typeof value === "string") return value.includes(forbidden);
  if (Array.isArray(value)) {
    return value.some((entry) => jsonValueContainsPlaintext(entry, forbidden));
  }
  if (isJsonObject(value)) {
    return Object.entries(value).some(
      ([key, entry]) =>
        key.includes(forbidden) || jsonValueContainsPlaintext(entry, forbidden),
    );
  }
  return false;
}

function compareUnicodeCodePoints(left: string, right: string) {
  if (left === right) return 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCodePoint = left.codePointAt(leftIndex);
    const rightCodePoint = right.codePointAt(rightIndex);
    if (leftCodePoint === undefined || rightCodePoint === undefined) {
      throw stateError(
        "STATE_SCHEMA_INVALID",
        "Canonical JSON key comparison failed.",
      );
    }
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint < rightCodePoint ? -1 : 1;
    }
    leftIndex += leftCodePoint > 0xffff ? 2 : 1;
    rightIndex += rightCodePoint > 0xffff ? 2 : 1;
  }
  return leftIndex === left.length ? -1 : 1;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function stateError(
  code: HistoricalSuccessorCaptureStateErrorCode,
  message: string,
) {
  return new HistoricalSuccessorCaptureStateError(code, message);
}
