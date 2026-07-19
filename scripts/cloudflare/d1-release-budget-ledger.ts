import fs from "node:fs";
import path from "node:path";
import {
  assertD1FreeDailyBudget,
  D1_FREE_SAFE_ROWS_READ_LIMIT,
  D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  cloudflareDir,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
} from "./migration-config";

export const D1_RELEASE_BUDGET_LEDGER_KIND = "d1-release-budget-ledger" as const;
export const D1_RELEASE_BUDGET_LEDGER_SCHEMA_VERSION = 4 as const;
const D1_RELEASE_BUDGET_LEDGER_LEGACY_SCHEMA_VERSION = 1 as const;
const D1_RELEASE_BUDGET_LEDGER_SOURCE_BOUND_SCHEMA_VERSION = 2 as const;
const D1_RELEASE_BUDGET_LEDGER_CHILD_ACCOUNTING_SCHEMA_VERSION = 3 as const;
const D1_RELEASE_BUDGET_LEDGER_MAX_BYTES = 4 * 1024 * 1024;
export const D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE =
  "workers-free" as const;
export const D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE =
  "paid-expedited" as const;

export type D1ReleaseBudgetAdmissionMode =
  | typeof D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE
  | typeof D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE;

export type D1ReleaseSourceIdentity = {
  sha256: string;
  fileCount: number;
};

export type D1ReleaseBudgetReservationPhase = "maximum" | "exact";

export type D1ReleaseBudgetReservation = {
  operationId: string;
  operation: string;
  candidateVersionId: string | null;
  phase: D1ReleaseBudgetReservationPhase;
  rowsRead: number;
  rowsWritten: number;
  maximumRowsRead: number;
  maximumRowsWritten: number;
  createdAt: string;
  updatedAt: string;
};

export type D1ReleaseBudgetLedgerReservation = D1ReleaseBudgetReservation & {
  sourceFingerprint: D1ReleaseSourceIdentity;
  accountingParentOperationId: string | null;
};

export type D1ReleaseBudgetObservedUsageFloor = D1DailyUsage & {
  observedAt: string;
};

export type D1ReleaseBudgetLedger = {
  kind: typeof D1_RELEASE_BUDGET_LEDGER_KIND;
  schemaVersion: typeof D1_RELEASE_BUDGET_LEDGER_SCHEMA_VERSION;
  revision: number;
  utcDay: string;
  createdAt: string;
  updatedAt: string;
  database: {
    id: typeof D1_DATABASE_ID;
    name: typeof D1_DATABASE_NAME;
  };
  safeDailyLimits: {
    rowsRead: typeof D1_FREE_SAFE_ROWS_READ_LIMIT;
    rowsWritten: typeof D1_FREE_SAFE_ROWS_WRITTEN_LIMIT;
  };
  admissionMode: D1ReleaseBudgetAdmissionMode;
  observedUsageFloor: D1ReleaseBudgetObservedUsageFloor;
  reservations: D1ReleaseBudgetLedgerReservation[];
  totals: {
    rowsRead: number;
    rowsWritten: number;
  };
  accountedUsage: {
    rowsRead: number;
    rowsWritten: number;
  };
};

export type ReserveD1ReleaseBudgetInput = {
  backupDir: string;
  operationId: string;
  operation: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  candidateVersionId?: string;
  phase: D1ReleaseBudgetReservationPhase;
  rowsRead: number;
  rowsWritten: number;
  observedUsage: D1DailyUsage;
  accountingParentOperationId?: string;
  admissionMode?: D1ReleaseBudgetAdmissionMode;
  now?: Date;
  expectedUtcDay?: string;
  allowStaleMaximumChildReservationsOnExactAggregate?: boolean;
};

export type D1ReleaseBudgetReservationResult = {
  ledgerPath: string;
  utcDay: string;
  revision: number;
  idempotent: boolean;
  reservation: D1ReleaseBudgetReservation;
  totals: D1ReleaseBudgetLedger["totals"];
  accountedUsage: D1ReleaseBudgetLedger["accountedUsage"];
};

export type AssertD1ReleaseBudgetReservationInput = {
  ledgerPath: string;
  utcDay: string;
  operationId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  candidateVersionId?: string;
  phase: D1ReleaseBudgetReservationPhase;
  rowsRead: number;
  rowsWritten: number;
  accountingParentOperationId?: string;
  now?: Date;
  allowHistoricalExactReservation?: boolean;
};

export function reserveD1ReleaseBudget(
  input: ReserveD1ReleaseBudgetInput,
): D1ReleaseBudgetReservationResult {
  const now = validDate(input.now ?? new Date(), "reservation clock");
  const utcDay = utcDayOf(now);
  if (input.expectedUtcDay !== undefined) {
    assertD1ReleaseBudgetUtcDay(input.expectedUtcDay, now);
  }
  const sourceFingerprint = validateSourceIdentity(input.sourceFingerprint);
  const operationId = validateOperationId(input.operationId);
  const operation = validateOperation(input.operation);
  const candidateVersionId = validateCandidateVersion(input.candidateVersionId);
  const rowsRead = nonNegativeSafeInteger(input.rowsRead, "reserved rows read");
  const rowsWritten = nonNegativeSafeInteger(input.rowsWritten, "reserved rows written");
  const accountingParentOperationId = input.accountingParentOperationId === undefined
    ? null
    : validateOperationId(input.accountingParentOperationId);
  const requestedAdmissionMode = validateAdmissionMode(
    input.admissionMode ?? D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE,
  );
  if (accountingParentOperationId === operationId) {
    throw new Error("A D1 release budget reservation cannot account under itself.");
  }
  validateObservedUsage(input.observedUsage);

  const ledgerPath = d1ReleaseBudgetLedgerPath(input.backupDir, utcDay);
  return withLedgerLock(ledgerPath, now, () => {
    const existing = readD1ReleaseBudgetLedgerIfPresent(ledgerPath);
    if (existing) {
      if (existing.utcDay !== utcDay) {
        throw new Error("D1 release budget ledger UTC day changed; start a new release operation.");
      }
      if (now.getTime() < Date.parse(existing.updatedAt)) {
        throw new Error("D1 release budget reservation clock moved backwards; refusing to rewrite the ledger.");
      }
    }

    const timestamp = now.toISOString();
    if (accountingParentOperationId !== null && !existing) {
      throw new Error("A D1 release budget child requires an existing aggregate envelope.");
    }
    const admissionMode = nextAdmissionMode(
      existing?.admissionMode,
      requestedAdmissionMode,
    );
    if (admissionMode === D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE) {
      assertD1FreeDailyBudget(input.observedUsage, {
        operation,
        rowsRead: 0,
        rowsWritten: 0,
      });
    }
    const observedUsageFloor = existing
      ? accountingParentOperationId === null
        ? mergeObservedUsageFloor(existing.observedUsageFloor, input.observedUsage, timestamp)
        : existing.observedUsageFloor
      : { ...input.observedUsage, observedAt: timestamp };
    const reservations = existing ? [...existing.reservations] : [];
    if (accountingParentOperationId !== null) {
      assertLiveAccountingParent({
        reservations,
        accountingParentOperationId,
        sourceFingerprint,
        candidateVersionId,
      });
    }
    const reservationIndex = reservations.findIndex((reservation) =>
      sameReservationIdentity(reservation, operationId, sourceFingerprint),
    );
    const prior = reservationIndex >= 0 ? reservations[reservationIndex] : undefined;
    const transition = transitionReservation({
      prior,
      operationId,
      operation,
      sourceFingerprint,
      candidateVersionId,
      accountingParentOperationId,
      phase: input.phase,
      rowsRead,
      rowsWritten,
      timestamp,
    });
    if (reservationIndex >= 0) reservations[reservationIndex] = transition.reservation;
    else reservations.push(transition.reservation);
    reservations.sort(compareReservationIdentity);
    assertAggregateRefinementCoversChildren(
      transition.reservation,
      reservations,
      input.allowStaleMaximumChildReservationsOnExactAggregate === true,
    );

    const totals = sumReservations(reservations);
    const accountedUsage = {
      rowsRead: safeAdd(observedUsageFloor.rowsRead, totals.rowsRead, "accounted rows read"),
      rowsWritten: safeAdd(
        observedUsageFloor.rowsWritten,
        totals.rowsWritten,
        "accounted rows written",
      ),
    };
    assertAccountedUsageWithinLimits(
      operation,
      admissionMode,
      observedUsageFloor,
      totals,
      accountedUsage,
    );

    const usageFloorChanged =
      existing !== undefined &&
      !sameObservedUsageFloor(existing.observedUsageFloor, observedUsageFloor);
    if (existing && transition.idempotent && !usageFloorChanged) {
      return {
        ledgerPath,
        utcDay,
        revision: existing.revision,
        idempotent: true,
        reservation: outwardReservation(
          requiredReservation(existing, operationId, sourceFingerprint),
        ),
        totals: existing.totals,
        accountedUsage: existing.accountedUsage,
      };
    }

    const next: D1ReleaseBudgetLedger = {
      kind: D1_RELEASE_BUDGET_LEDGER_KIND,
      schemaVersion: D1_RELEASE_BUDGET_LEDGER_SCHEMA_VERSION,
      revision: existing ? existing.revision + 1 : 1,
      utcDay,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      database: { id: D1_DATABASE_ID, name: D1_DATABASE_NAME },
      safeDailyLimits: {
        rowsRead: D1_FREE_SAFE_ROWS_READ_LIMIT,
        rowsWritten: D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
      },
      admissionMode,
      observedUsageFloor,
      reservations,
      totals,
      accountedUsage,
    };
    if (Buffer.byteLength(JSON.stringify(next), "utf8") + 1 > D1_RELEASE_BUDGET_LEDGER_MAX_BYTES) {
      throw new Error("D1 release budget ledger exceeds its bounded evidence size.");
    }
    writePrivateJsonDurably(ledgerPath, next, { replace: existing !== undefined });
    const stored = readD1ReleaseBudgetLedger(ledgerPath);
    const reservation = outwardReservation(
      requiredReservation(stored, operationId, sourceFingerprint),
    );
    return {
      ledgerPath,
      utcDay,
      revision: stored.revision,
      idempotent: transition.idempotent,
      reservation,
      totals: stored.totals,
      accountedUsage: stored.accountedUsage,
    };
  });
}

export function assertD1ReleaseBudgetReservation(
  input: AssertD1ReleaseBudgetReservationInput,
): D1ReleaseBudgetReservationResult {
  const now = validDate(input.now ?? new Date(), "reservation validation clock");
  if (input.allowHistoricalExactReservation && input.phase !== "exact") {
    throw new Error("Only exact D1 release budget reservations may be replayed historically.");
  }
  const expectedUtcDay = input.allowHistoricalExactReservation
    ? validateUtcDay(input.utcDay)
    : assertD1ReleaseBudgetUtcDay(input.utcDay, now);
  const ledger = readD1ReleaseBudgetLedger(path.resolve(input.ledgerPath));
  if (ledger.utcDay !== expectedUtcDay) {
    throw new Error("D1 release budget evidence points to the wrong UTC-day ledger.");
  }
  const sourceFingerprint = validateSourceIdentity(input.sourceFingerprint);
  const storedReservation = requiredReservation(
    ledger,
    validateOperationId(input.operationId),
    sourceFingerprint,
  );
  const reservation = outwardReservation(storedReservation);
  const candidateVersionId = validateCandidateVersion(input.candidateVersionId);
  if (
    storedReservation.accountingParentOperationId !==
      (input.accountingParentOperationId === undefined
        ? null
        : validateOperationId(input.accountingParentOperationId)) ||
    reservation.candidateVersionId !== candidateVersionId ||
    reservation.phase !== input.phase ||
    reservation.rowsRead !== nonNegativeSafeInteger(input.rowsRead, "expected rows read") ||
    reservation.rowsWritten !== nonNegativeSafeInteger(input.rowsWritten, "expected rows written")
  ) {
    throw new Error("D1 release budget reservation no longer matches its exact release evidence.");
  }
  return {
    ledgerPath: path.resolve(input.ledgerPath),
    utcDay: ledger.utcDay,
    revision: ledger.revision,
    idempotent: true,
    reservation,
    totals: ledger.totals,
    accountedUsage: ledger.accountedUsage,
  };
}

export function assertD1ReleaseBudgetUtcDay(expectedUtcDay: string, now = new Date()) {
  const validatedDay = validateUtcDay(expectedUtcDay);
  const currentDay = utcDayOf(validDate(now, "UTC-day validation clock"));
  if (currentDay !== validatedDay) {
    throw new Error(
      `D1 release operation crossed the UTC billing-day boundary (${validatedDay} -> ${currentDay}); rerun all budget gates.`,
    );
  }
  return validatedDay;
}

export function d1ReleaseBudgetLedgerPath(backupDir: string, utcDay: string) {
  const day = validateUtcDay(utcDay);
  return path.join(
    cloudflareDir(path.resolve(backupDir)),
    `d1-release-budget-ledger-${day}.json`,
  );
}

export function readD1ReleaseBudgetLedger(ledgerPath: string): D1ReleaseBudgetLedger {
  const value = readPrivateJsonNoFollow(ledgerPath, D1_RELEASE_BUDGET_LEDGER_MAX_BYTES);
  return parseLedger(value);
}

export function parseD1ReleaseBudgetLedger(value: unknown): D1ReleaseBudgetLedger {
  return parseLedger(value);
}

export function readPrivateJsonNoFollow(file: string, maximumBytes = 16 * 1024 * 1024): unknown {
  const absolute = path.resolve(file);
  const maxBytes = positiveSafeInteger(maximumBytes, "private evidence byte limit");
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw new Error(`Private release evidence must be a regular owner-only mode-0600 file: ${absolute}.`);
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.nlink !== 1 ||
      stat.size <= 0 ||
      stat.size > maxBytes ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw new Error(
        `Private release evidence must be a non-empty owner-only mode-0600 file no larger than ${maxBytes} bytes: ${absolute}.`,
      );
    }
    const content = fs.readFileSync(descriptor, "utf8");
    const statAfterRead = fs.fstatSync(descriptor);
    const contentBytes = Buffer.byteLength(content, "utf8");
    if (
      !sameStablePrivateFile(stat, statAfterRead) ||
      contentBytes !== stat.size ||
      contentBytes <= 0 ||
      contentBytes > maxBytes
    ) {
      throw new Error(`Private release evidence changed while it was being read: ${absolute}.`);
    }
    let namedStat: fs.Stats;
    try {
      namedStat = fs.lstatSync(absolute);
    } catch {
      throw new Error(`Private release evidence changed while it was being read: ${absolute}.`);
    }
    if (!sameStablePrivateFile(statAfterRead, namedStat)) {
      throw new Error(`Private release evidence changed while it was being read: ${absolute}.`);
    }
    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      throw new Error(`Private release evidence is not valid JSON: ${absolute}.`);
    }
    return value;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function writePrivateJsonDurably(
  file: string,
  value: unknown,
  options: { replace: boolean },
) {
  const absolute = path.resolve(file);
  const directory = path.dirname(absolute);
  assertRegularDirectory(directory);
  const serialized = JSON.stringify(value, null, 2);
  if (typeof serialized !== "string" || !serialized) {
    throw new Error("Private release evidence must serialize to a non-empty JSON value.");
  }
  const payload = `${serialized}\n`;
  if (Buffer.byteLength(payload, "utf8") > 16 * 1024 * 1024) {
    throw new Error("Private release evidence exceeds the 16 MiB durability limit.");
  }
  if (!options.replace) {
    writeExclusivePrivateFile(absolute, payload);
    fsyncDirectory(directory);
    return absolute;
  }

  // Refuse to replace a symlink, broad-permission file, or non-regular target.
  readPrivateJsonNoFollow(absolute);
  const temporary = path.join(
    directory,
    `.${path.basename(absolute)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeExclusivePrivateFile(temporary, payload);
    fs.renameSync(temporary, absolute);
    fsyncDirectory(directory);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return absolute;
}

function transitionReservation(input: {
  prior: D1ReleaseBudgetLedgerReservation | undefined;
  operationId: string;
  operation: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  candidateVersionId: string | null;
  accountingParentOperationId: string | null;
  phase: D1ReleaseBudgetReservationPhase;
  rowsRead: number;
  rowsWritten: number;
  timestamp: string;
}): { idempotent: boolean; reservation: D1ReleaseBudgetLedgerReservation } {
  const prior = input.prior;
  if (!prior) {
    return {
      idempotent: false,
      reservation: {
        operationId: input.operationId,
        operation: input.operation,
        sourceFingerprint: input.sourceFingerprint,
        accountingParentOperationId: input.accountingParentOperationId,
        candidateVersionId: input.candidateVersionId,
        phase: input.phase,
        rowsRead: input.rowsRead,
        rowsWritten: input.rowsWritten,
        maximumRowsRead: input.rowsRead,
        maximumRowsWritten: input.rowsWritten,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      } satisfies D1ReleaseBudgetLedgerReservation,
    };
  }
  if (
    prior.operation !== input.operation ||
    prior.candidateVersionId !== input.candidateVersionId ||
    prior.accountingParentOperationId !== input.accountingParentOperationId
  ) {
    throw new Error("D1 release budget operation ID was reused for a different release operation.");
  }
  if (prior.phase === "exact") {
    const maximumReplay =
      input.phase === "maximum" &&
      input.rowsRead === prior.maximumRowsRead &&
      input.rowsWritten === prior.maximumRowsWritten;
    const exactReplay =
      input.phase === "exact" &&
      input.rowsRead === prior.rowsRead &&
      input.rowsWritten === prior.rowsWritten;
    if (!maximumReplay && !exactReplay) {
      throw new Error("An exact D1 release budget reservation cannot be changed or widened.");
    }
    return { idempotent: true, reservation: prior };
  }
  if (input.phase === "maximum") {
    if (input.rowsRead !== prior.rowsRead || input.rowsWritten !== prior.rowsWritten) {
      throw new Error("A maximum D1 release budget reservation cannot be changed in place.");
    }
    return { idempotent: true, reservation: prior };
  }
  if (input.rowsRead > prior.rowsRead || input.rowsWritten > prior.rowsWritten) {
    throw new Error("An exact D1 release budget reservation must not exceed its maximum reservation.");
  }
  return {
    idempotent: false,
    reservation: {
      ...prior,
      phase: "exact",
      rowsRead: input.rowsRead,
      rowsWritten: input.rowsWritten,
      updatedAt: input.timestamp,
    },
  };
}

function parseLedger(value: unknown): D1ReleaseBudgetLedger {
  if (!isRecord(value)) throw new Error("D1 release budget ledger is not an object.");
  const schemaVersion = value.schemaVersion;
  if (
    value.kind !== D1_RELEASE_BUDGET_LEDGER_KIND ||
    (schemaVersion !== D1_RELEASE_BUDGET_LEDGER_LEGACY_SCHEMA_VERSION &&
      schemaVersion !== D1_RELEASE_BUDGET_LEDGER_SOURCE_BOUND_SCHEMA_VERSION &&
      schemaVersion !== D1_RELEASE_BUDGET_LEDGER_CHILD_ACCOUNTING_SCHEMA_VERSION &&
      schemaVersion !== D1_RELEASE_BUDGET_LEDGER_SCHEMA_VERSION)
  ) {
    throw new Error("D1 release budget ledger has an unsupported schema.");
  }
  const legacySourceFingerprint =
    schemaVersion === D1_RELEASE_BUDGET_LEDGER_LEGACY_SCHEMA_VERSION
      ? validateSourceIdentity(
          requiredRecord(value.sourceFingerprint, "legacy ledger source fingerprint"),
        )
      : undefined;
  if (
    schemaVersion !== D1_RELEASE_BUDGET_LEDGER_LEGACY_SCHEMA_VERSION &&
    Object.hasOwn(value, "sourceFingerprint")
  ) {
    throw new Error(
      "D1 release budget ledger schema v2+ must bind source fingerprints only to reservations.",
    );
  }
  const database = requiredRecord(value.database, "ledger database");
  if (database.id !== D1_DATABASE_ID || database.name !== D1_DATABASE_NAME) {
    throw new Error("D1 release budget ledger targets the wrong database.");
  }
  const limits = requiredRecord(value.safeDailyLimits, "ledger daily limits");
  if (
    limits.rowsRead !== D1_FREE_SAFE_ROWS_READ_LIMIT ||
    limits.rowsWritten !== D1_FREE_SAFE_ROWS_WRITTEN_LIMIT
  ) {
    throw new Error("D1 release budget ledger daily limits do not match this source revision.");
  }
  const usage = requiredRecord(value.observedUsageFloor, "ledger observed usage floor");
  const admissionMode =
    schemaVersion === D1_RELEASE_BUDGET_LEDGER_SCHEMA_VERSION
      ? validateAdmissionMode(value.admissionMode)
      : D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE;
  const observedUsageFloor: D1ReleaseBudgetObservedUsageFloor = {
    databaseCount: positiveSafeInteger(usage.databaseCount, "ledger database count"),
    queryGroups: nonNegativeSafeInteger(usage.queryGroups, "ledger query groups"),
    rowsRead: nonNegativeSafeInteger(usage.rowsRead, "ledger observed rows read"),
    rowsWritten: nonNegativeSafeInteger(usage.rowsWritten, "ledger observed rows written"),
    executions: nonNegativeSafeInteger(usage.executions, "ledger executions"),
    windowMinutes: positiveSafeInteger(usage.windowMinutes, "ledger usage window"),
    observedAt: validIsoTimestamp(usage.observedAt, "ledger observed-at timestamp"),
  };
  validateObservedUsage(observedUsageFloor);
  if (!Array.isArray(value.reservations)) {
    throw new Error("D1 release budget ledger reservations must be an array.");
  }
  if (value.reservations.length === 0) {
    throw new Error("D1 release budget ledger must contain at least one reservation.");
  }
  const reservations = value.reservations.map((reservation, index) =>
    parseReservation(reservation, index, legacySourceFingerprint, schemaVersion),
  );
  if (
    new Set(reservations.map(reservationIdentityKey)).size !== reservations.length
  ) {
    throw new Error(
      "D1 release budget ledger contains duplicate operation-and-source identities.",
    );
  }
  validateAccountingParents(reservations);
  const totals = sumReservations(reservations);
  const storedTotals = requiredRecord(value.totals, "ledger reservation totals");
  if (storedTotals.rowsRead !== totals.rowsRead || storedTotals.rowsWritten !== totals.rowsWritten) {
    throw new Error("D1 release budget ledger reservation totals are inconsistent.");
  }
  const accountedUsage = {
    rowsRead: safeAdd(observedUsageFloor.rowsRead, totals.rowsRead, "ledger accounted rows read"),
    rowsWritten: safeAdd(
      observedUsageFloor.rowsWritten,
      totals.rowsWritten,
      "ledger accounted rows written",
    ),
  };
  const storedAccounted = requiredRecord(value.accountedUsage, "ledger accounted usage");
  if (
    storedAccounted.rowsRead !== accountedUsage.rowsRead ||
    storedAccounted.rowsWritten !== accountedUsage.rowsWritten
  ) {
    throw new Error("D1 release budget ledger accounted usage is inconsistent.");
  }
  assertAccountedUsageWithinLimits(
    "Stored D1 release budget ledger",
    admissionMode,
    observedUsageFloor,
    totals,
    accountedUsage,
  );
  const utcDay = validateUtcDay(value.utcDay);
  const createdAt = validIsoTimestamp(value.createdAt, "ledger creation timestamp");
  const updatedAt = validIsoTimestamp(value.updatedAt, "ledger update timestamp");
  if (utcDayOf(new Date(createdAt)) !== utcDay || utcDayOf(new Date(updatedAt)) !== utcDay) {
    throw new Error("D1 release budget ledger timestamps do not match its UTC day.");
  }
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error("D1 release budget ledger update timestamp predates its creation timestamp.");
  }
  for (const reservation of reservations) {
    if (
      utcDayOf(new Date(reservation.createdAt)) !== utcDay ||
      utcDayOf(new Date(reservation.updatedAt)) !== utcDay ||
      Date.parse(reservation.updatedAt) < Date.parse(reservation.createdAt)
    ) {
      throw new Error("D1 release budget reservation timestamps do not match its UTC-day ledger.");
    }
  }
  return {
    kind: D1_RELEASE_BUDGET_LEDGER_KIND,
    schemaVersion: D1_RELEASE_BUDGET_LEDGER_SCHEMA_VERSION,
    revision: positiveSafeInteger(value.revision, "ledger revision"),
    utcDay,
    createdAt,
    updatedAt,
    database: { id: D1_DATABASE_ID, name: D1_DATABASE_NAME },
    safeDailyLimits: {
      rowsRead: D1_FREE_SAFE_ROWS_READ_LIMIT,
      rowsWritten: D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
    },
    admissionMode,
    observedUsageFloor,
    reservations,
    totals,
    accountedUsage,
  };
}

function parseReservation(
  value: unknown,
  index: number,
  legacySourceFingerprint: D1ReleaseSourceIdentity | undefined,
  schemaVersion:
    | typeof D1_RELEASE_BUDGET_LEDGER_LEGACY_SCHEMA_VERSION
    | typeof D1_RELEASE_BUDGET_LEDGER_SOURCE_BOUND_SCHEMA_VERSION
    | typeof D1_RELEASE_BUDGET_LEDGER_CHILD_ACCOUNTING_SCHEMA_VERSION
    | typeof D1_RELEASE_BUDGET_LEDGER_SCHEMA_VERSION,
): D1ReleaseBudgetLedgerReservation {
  if (!isRecord(value)) throw new Error(`D1 release budget reservation ${index} is invalid.`);
  if (legacySourceFingerprint && Object.hasOwn(value, "sourceFingerprint")) {
    throw new Error(
      `Legacy D1 release budget reservation ${index} contains an ambiguous source fingerprint.`,
    );
  }
  const sourceFingerprint = legacySourceFingerprint
    ? { ...legacySourceFingerprint }
    : validateSourceIdentity(
        requiredRecord(
          value.sourceFingerprint,
          `reservation ${index} source fingerprint`,
        ),
      );
  const phase = value.phase;
  if (phase !== "maximum" && phase !== "exact") {
    throw new Error(`D1 release budget reservation ${index} has an invalid phase.`);
  }
  const candidate = value.candidateVersionId;
  const candidateVersionId =
    candidate === null
      ? null
      : validateCandidateVersion(requiredString(candidate, `reservation ${index} candidate`));
  const rowsRead = nonNegativeSafeInteger(value.rowsRead, `reservation ${index} rows read`);
  const rowsWritten = nonNegativeSafeInteger(
    value.rowsWritten,
    `reservation ${index} rows written`,
  );
  const maximumRowsRead = nonNegativeSafeInteger(
    value.maximumRowsRead,
    `reservation ${index} maximum rows read`,
  );
  const maximumRowsWritten = nonNegativeSafeInteger(
    value.maximumRowsWritten,
    `reservation ${index} maximum rows written`,
  );
  if (rowsRead > maximumRowsRead || rowsWritten > maximumRowsWritten) {
    throw new Error(`D1 release budget reservation ${index} exceeds its recorded maximum.`);
  }
  const accountingParentOperationId = (
    schemaVersion === D1_RELEASE_BUDGET_LEDGER_CHILD_ACCOUNTING_SCHEMA_VERSION ||
    schemaVersion === D1_RELEASE_BUDGET_LEDGER_SCHEMA_VERSION
  )
    ? value.accountingParentOperationId === null
      ? null
      : validateOperationId(
          requiredString(
            value.accountingParentOperationId,
            `reservation ${index} accounting parent`,
          ),
        )
    : null;
  return {
    operationId: validateOperationId(value.operationId),
    operation: validateOperation(value.operation),
    sourceFingerprint,
    accountingParentOperationId,
    candidateVersionId,
    phase,
    rowsRead,
    rowsWritten,
    maximumRowsRead,
    maximumRowsWritten,
    createdAt: validIsoTimestamp(value.createdAt, `reservation ${index} creation timestamp`),
    updatedAt: validIsoTimestamp(value.updatedAt, `reservation ${index} update timestamp`),
  };
}

function readD1ReleaseBudgetLedgerIfPresent(ledgerPath: string) {
  try {
    return readD1ReleaseBudgetLedger(ledgerPath);
  } catch (error) {
    if (isMissingFileError(ledgerPath)) return undefined;
    throw error;
  }
}

function isMissingFileError(file: string) {
  try {
    fs.lstatSync(file);
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === "ENOENT";
  }
}

function withLedgerLock<T>(ledgerPath: string, now: Date, action: () => T): T {
  const lockPath = `${ledgerPath}.lock`;
  const directory = path.dirname(ledgerPath);
  assertRegularDirectory(directory);
  let descriptor: number;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
  } catch {
    throw new Error(
      `D1 release budget ledger is locked by another operation or an unresolved interrupted update: ${lockPath}.`,
    );
  }
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify({ pid: process.pid, acquiredAt: now.toISOString() })}\n`,
      "utf8",
    );
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(directory);
  try {
    return action();
  } finally {
    fs.rmSync(lockPath, { force: true });
    fsyncDirectory(directory);
  }
}

function writeExclusivePrivateFile(file: string, content: string) {
  const payload = Buffer.from(content, "utf8");
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new Error(
      `Private release evidence must be created at a new non-symlink path: ${file}.`,
    );
  }
  let writtenStat: fs.Stats;
  try {
    fs.fchmodSync(descriptor, 0o600);
    const emptyStat = fs.fstatSync(descriptor);
    assertWrittenPrivateFileStat(emptyStat, 0, file);
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    writtenStat = fs.fstatSync(descriptor);
    assertWrittenPrivateFileStat(writtenStat, payload.byteLength, file);
    if (!samePrivateFileIdentity(emptyStat, writtenStat)) {
      throw new Error(`Private release evidence changed during its durable write: ${file}.`);
    }
  } finally {
    fs.closeSync(descriptor);
  }

  let readDescriptor: number;
  try {
    readDescriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw new Error(`Private release evidence changed before exact readback: ${file}.`);
  }
  try {
    const beforeRead = fs.fstatSync(readDescriptor);
    assertWrittenPrivateFileStat(beforeRead, payload.byteLength, file);
    const readback = fs.readFileSync(readDescriptor);
    const afterRead = fs.fstatSync(readDescriptor);
    assertWrittenPrivateFileStat(afterRead, payload.byteLength, file);
    if (
      !sameStablePrivateFile(writtenStat, beforeRead) ||
      !sameStablePrivateFile(beforeRead, afterRead) ||
      !readback.equals(payload)
    ) {
      throw new Error(`Private release evidence failed exact durable readback: ${file}.`);
    }
    const namedStat = fs.lstatSync(file);
    assertWrittenPrivateFileStat(namedStat, payload.byteLength, file);
    if (!sameStablePrivateFile(afterRead, namedStat)) {
      throw new Error(`Private release evidence path changed during exact readback: ${file}.`);
    }
  } finally {
    fs.closeSync(readDescriptor);
  }
}

function assertWrittenPrivateFileStat(stat: fs.Stats, expectedBytes: number, file: string) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size !== expectedBytes ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(
      `Private release evidence has unsafe type, links, mode, ownership, or bytes: ${file}.`,
    );
  }
}

function samePrivateFileIdentity(left: fs.Stats, right: fs.Stats) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStablePrivateFile(left: fs.Stats, right: fs.Stats) {
  return (
    samePrivateFileIdentity(left, right) &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertRegularDirectory(directory: string) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Private release evidence directory must be a real directory: ${directory}.`);
  }
}

function requiredReservation(
  ledger: D1ReleaseBudgetLedger,
  operationId: string,
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  const matches = ledger.reservations.filter(
    (reservation) =>
      sameReservationIdentity(reservation, operationId, sourceFingerprint),
  );
  if (matches.length !== 1) {
    throw new Error(
      `D1 release budget ledger is missing exact operation ${operationId} for the requested source fingerprint; a different source fingerprint cannot validate it.`,
    );
  }
  return matches[0];
}

function outwardReservation(
  reservation: D1ReleaseBudgetLedgerReservation,
): D1ReleaseBudgetReservation {
  return {
    operationId: reservation.operationId,
    operation: reservation.operation,
    candidateVersionId: reservation.candidateVersionId,
    phase: reservation.phase,
    rowsRead: reservation.rowsRead,
    rowsWritten: reservation.rowsWritten,
    maximumRowsRead: reservation.maximumRowsRead,
    maximumRowsWritten: reservation.maximumRowsWritten,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

function sameReservationIdentity(
  reservation: D1ReleaseBudgetLedgerReservation,
  operationId: string,
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  return (
    reservation.operationId === operationId &&
    sameSourceIdentity(reservation.sourceFingerprint, sourceFingerprint)
  );
}

function reservationIdentityKey(reservation: D1ReleaseBudgetLedgerReservation) {
  return `${reservation.operationId}\u0000${reservation.sourceFingerprint.sha256}\u0000${reservation.sourceFingerprint.fileCount}`;
}

function compareReservationIdentity(
  left: D1ReleaseBudgetLedgerReservation,
  right: D1ReleaseBudgetLedgerReservation,
) {
  const operationOrder = left.operationId.localeCompare(right.operationId);
  if (operationOrder !== 0) return operationOrder;
  const sourceOrder = left.sourceFingerprint.sha256.localeCompare(
    right.sourceFingerprint.sha256,
  );
  if (sourceOrder !== 0) return sourceOrder;
  if (left.sourceFingerprint.fileCount === right.sourceFingerprint.fileCount) return 0;
  return left.sourceFingerprint.fileCount < right.sourceFingerprint.fileCount ? -1 : 1;
}

function sumReservations(reservations: D1ReleaseBudgetLedgerReservation[]) {
  return reservations.filter(
    (reservation) => reservation.accountingParentOperationId === null,
  ).reduce(
    (total, reservation) => ({
      rowsRead: safeAdd(total.rowsRead, reservation.rowsRead, "reserved rows read"),
      rowsWritten: safeAdd(total.rowsWritten, reservation.rowsWritten, "reserved rows written"),
    }),
    { rowsRead: 0, rowsWritten: 0 },
  );
}

function assertLiveAccountingParent(input: Readonly<{
  reservations: readonly D1ReleaseBudgetLedgerReservation[];
  accountingParentOperationId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  candidateVersionId: string | null;
}>) {
  const parents = input.reservations.filter(
    (reservation) =>
      reservation.operationId === input.accountingParentOperationId &&
      sameSourceIdentity(reservation.sourceFingerprint, input.sourceFingerprint),
  );
  if (parents.length !== 1) {
    throw new Error("A D1 release budget child is missing its exact aggregate envelope.");
  }
  const parent = parents[0]!;
  if (
    parent.accountingParentOperationId !== null ||
    parent.phase !== "maximum" ||
    (input.candidateVersionId !== null &&
      parent.candidateVersionId !== input.candidateVersionId)
  ) {
    throw new Error("A D1 release budget child requires one live top-level maximum envelope.");
  }
}

function validateAccountingParents(
  reservations: readonly D1ReleaseBudgetLedgerReservation[],
) {
  for (const child of reservations) {
    if (child.accountingParentOperationId === null) continue;
    const parents = reservations.filter(
      (reservation) =>
        reservation.operationId === child.accountingParentOperationId &&
        sameSourceIdentity(reservation.sourceFingerprint, child.sourceFingerprint),
    );
    if (
      parents.length !== 1 ||
      parents[0]!.accountingParentOperationId !== null ||
      (child.candidateVersionId !== null &&
        parents[0]!.candidateVersionId !== child.candidateVersionId)
    ) {
      throw new Error("D1 release budget child accounting is not bound to one aggregate envelope.");
    }
  }
}

function assertAggregateRefinementCoversChildren(
  reservation: D1ReleaseBudgetLedgerReservation,
  reservations: readonly D1ReleaseBudgetLedgerReservation[],
  allowStaleMaximumChildren: boolean,
) {
  if (
    reservation.accountingParentOperationId !== null ||
    reservation.phase !== "exact"
  ) {
    return;
  }
  const children = reservations.filter(
    (candidate) =>
      candidate.accountingParentOperationId === reservation.operationId &&
      sameSourceIdentity(
        candidate.sourceFingerprint,
        reservation.sourceFingerprint,
      ),
  );
  const maximumChildren = children.filter((child) => child.phase === "maximum");
  if (maximumChildren.length > 0 && !allowStaleMaximumChildren) {
    throw new Error(
      "A D1 release aggregate envelope cannot refine while a bound child remains maximum.",
    );
  }
  const exactChildren = children.filter((child) => child.phase === "exact");
  if (maximumChildren.length > 0 && exactChildren.length === 0) {
    throw new Error(
      "A D1 release aggregate envelope cannot refine stale maximum children without at least one exact child proof.",
    );
  }
  const exactChildUsage = exactChildren.reduce(
    (total, child) => ({
      rowsRead: safeAdd(
        total.rowsRead,
        child.rowsRead,
        "aggregate child rows read",
      ),
      rowsWritten: safeAdd(
        total.rowsWritten,
        child.rowsWritten,
        "aggregate child rows written",
      ),
    }),
    { rowsRead: 0, rowsWritten: 0 },
  );
  if (
    exactChildUsage.rowsRead > reservation.rowsRead ||
    exactChildUsage.rowsWritten > reservation.rowsWritten
  ) {
    throw new Error(
      "An exact D1 release aggregate envelope must cover every bound child exact reservation.",
    );
  }
}

function mergeObservedUsageFloor(
  current: D1ReleaseBudgetObservedUsageFloor,
  observed: D1DailyUsage,
  observedAt: string,
): D1ReleaseBudgetObservedUsageFloor {
  const merged = {
    databaseCount: Math.max(current.databaseCount, observed.databaseCount),
    queryGroups: Math.max(current.queryGroups, observed.queryGroups),
    rowsRead: Math.max(current.rowsRead, observed.rowsRead),
    rowsWritten: Math.max(current.rowsWritten, observed.rowsWritten),
    executions: Math.max(current.executions, observed.executions),
    windowMinutes: Math.max(current.windowMinutes, observed.windowMinutes),
  };
  const changed =
    merged.databaseCount !== current.databaseCount ||
    merged.queryGroups !== current.queryGroups ||
    merged.rowsRead !== current.rowsRead ||
    merged.rowsWritten !== current.rowsWritten ||
    merged.executions !== current.executions ||
    merged.windowMinutes !== current.windowMinutes;
  return { ...merged, observedAt: changed ? observedAt : current.observedAt };
}

function sameObservedUsageFloor(
  left: D1ReleaseBudgetObservedUsageFloor,
  right: D1ReleaseBudgetObservedUsageFloor,
) {
  return (
    left.databaseCount === right.databaseCount &&
    left.queryGroups === right.queryGroups &&
    left.rowsRead === right.rowsRead &&
    left.rowsWritten === right.rowsWritten &&
    left.executions === right.executions &&
    left.windowMinutes === right.windowMinutes &&
    left.observedAt === right.observedAt
  );
}

function assertAccountedUsageWithinLimits(
  operation: string,
  admissionMode: D1ReleaseBudgetAdmissionMode,
  observed: D1ReleaseBudgetObservedUsageFloor,
  totals: D1ReleaseBudgetLedger["totals"],
  accounted: D1ReleaseBudgetLedger["accountedUsage"],
) {
  if (admissionMode === D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE) {
    return;
  }
  if (
    accounted.rowsRead > D1_FREE_SAFE_ROWS_READ_LIMIT ||
    accounted.rowsWritten > D1_FREE_SAFE_ROWS_WRITTEN_LIMIT
  ) {
    throw new Error(
      `${operation} exceeds the cumulative lag-safe Workers Free D1 daily budget: ` +
        `read ${observed.rowsRead}+${totals.rowsRead}=${accounted.rowsRead}/` +
        `${D1_FREE_SAFE_ROWS_READ_LIMIT}; write ${observed.rowsWritten}+${totals.rowsWritten}=` +
        `${accounted.rowsWritten}/${D1_FREE_SAFE_ROWS_WRITTEN_LIMIT}. ` +
        "Wait for the next 00:00 UTC reset and start a new UTC-day ledger.",
    );
  }
}

function nextAdmissionMode(
  existing: D1ReleaseBudgetAdmissionMode | undefined,
  requested: D1ReleaseBudgetAdmissionMode,
): D1ReleaseBudgetAdmissionMode {
  if (
    existing === D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE ||
    requested === D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE
  ) {
    return D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE;
  }
  return D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE;
}

function validateAdmissionMode(value: unknown): D1ReleaseBudgetAdmissionMode {
  if (
    value === D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE ||
    value === D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE
  ) {
    return value;
  }
  throw new Error("D1 release budget ledger has an invalid admission mode.");
}

function validateObservedUsage(usage: D1DailyUsage) {
  positiveSafeInteger(usage.databaseCount, "database count");
  nonNegativeSafeInteger(usage.queryGroups, "query group count");
  nonNegativeSafeInteger(usage.rowsRead, "observed rows read");
  nonNegativeSafeInteger(usage.rowsWritten, "observed rows written");
  nonNegativeSafeInteger(usage.executions, "execution count");
  const windowMinutes = positiveSafeInteger(usage.windowMinutes, "usage window minutes");
  if (windowMinutes > 24 * 60) {
    throw new Error("D1 release budget usage window must not exceed one UTC day.");
  }
}

function validateSourceIdentity(value: unknown): D1ReleaseSourceIdentity {
  if (!isRecord(value)) throw new Error("D1 release budget requires a source fingerprint.");
  const sha256 = requiredString(value.sha256, "source fingerprint SHA-256");
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("D1 release budget requires a valid source fingerprint SHA-256.");
  }
  return {
    sha256,
    fileCount: positiveSafeInteger(value.fileCount, "source fingerprint file count"),
  };
}

function sameSourceIdentity(
  left: D1ReleaseSourceIdentity,
  right: D1ReleaseSourceIdentity,
) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function validateCandidateVersion(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("D1 release budget candidate version must be an exact Worker UUID.");
  }
  return value.toLowerCase();
}

function validateOperationId(value: unknown) {
  const operationId = requiredString(value, "D1 release operation ID");
  if (
    operationId.length > 200 ||
    !/^[a-z0-9][a-z0-9._:@/-]*$/.test(operationId)
  ) {
    throw new Error("D1 release budget operation ID must be a bounded stable lowercase identifier.");
  }
  return operationId;
}

function validateOperation(value: unknown) {
  const operation = requiredString(value, "D1 release operation");
  if (
    !operation.trim() ||
    operation.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(operation)
  ) {
    throw new Error("D1 release budget operation name must be non-empty and bounded.");
  }
  return operation;
}

function validateUtcDay(value: unknown) {
  const day = requiredString(value, "D1 release UTC day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || utcDayOf(new Date(`${day}T00:00:00.000Z`)) !== day) {
    throw new Error("D1 release budget requires a valid UTC day.");
  }
  return day;
}

function utcDayOf(value: Date) {
  return validDate(value, "UTC-day clock").toISOString().slice(0, 10);
}

function validDate(value: Date, label: string) {
  if (!Number.isFinite(value.getTime())) throw new Error(`D1 release budget requires a valid ${label}.`);
  return value;
}

function validIsoTimestamp(value: unknown, label: string) {
  const timestamp = requiredString(value, label);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error(`D1 release budget requires a valid ${label}.`);
  }
  return timestamp;
}

function safeAdd(left: number, right: number, label: string) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`D1 release budget ${label} total is unsafe.`);
  }
  return result;
}

function positiveSafeInteger(value: unknown, label: string) {
  const integer = nonNegativeSafeInteger(value, label);
  if (integer === 0) throw new Error(`Invalid D1 release budget ${label}.`);
  return integer;
}

function nonNegativeSafeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid D1 release budget ${label}.`);
  }
  return value;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${label}.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
