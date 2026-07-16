import { randomUUID } from "node:crypto";
import {
  D1_DATABASE_NAME,
  runWrangler,
} from "./migration-config";

export const PRODUCTION_VALIDATION_LOCK_KEY = "native-production-validation-lock-v1";
export const PRODUCTION_MAINTENANCE_STATE_KEY = "native-production-maintenance-state-v1";
const PRODUCTION_VALIDATION_LOCK_MIN_LEASE_MS = 60 * 60 * 1_000;
const PRODUCTION_VALIDATION_LOCK_MAX_LEASE_MS = 2 * 60 * 60 * 1_000;
export const PRODUCTION_VALIDATION_LOCK_RENEWAL_FLOOR_MS = 60 * 60 * 1_000;
export const PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS = 30 * 60 * 1_000;
// This is still far below the D1 Free daily read allowance, while leaving a
// recovery manifest enough room for repeated lost-response resolution and a
// final exact release instead of becoming unrecoverable after two attempts.
export const PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ = 1_024;
export const PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN = 64;
export const PRODUCTION_VALIDATION_LOCK_MAX_OPERATIONS = 128;
export const PRODUCTION_MAINTENANCE_STATE_MAX_BILLED_ROWS_READ = 4;
export const PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV = "INSPIR_PRODUCTION_RELEASE_EXCLUSION_OWNER";
export const PRODUCTION_RELEASE_OPERATION_ENV = "INSPIR_PRODUCTION_RELEASE_OPERATION";
export const productionReleaseOperationNames = [
  "apply-d1-runtime-migrations",
  "apply-d1-runtime-migration-0017",
  "sync-site-translation-sources",
  "sync-topic-seeds",
  "rollback",
] as const;
export type ProductionReleaseOperationName = (typeof productionReleaseOperationNames)[number];

const genericUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const runUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ProductionValidationLockOwner = {
  candidateVersionId: string;
  leaseExpiresAt: number;
  leaseId: string;
  runId: string;
  sourceFingerprintSha256: string;
};

export type ProductionValidationLockOperation = "acquire" | "verify" | "release";

export type ProductionValidationLockBudget = {
  operations: number;
  reservedRowsRead: number;
  reservedRowsWritten: number;
  billedRowsRead: number;
  billedRowsWritten: number;
};

export type ProductionValidationLockRunner = (args: string[]) => string;

export type ProductionValidationExclusion = {
  owner: ProductionValidationLockOwner;
  budget: ProductionValidationLockBudget;
  serverNowMs: number;
};

export type ProductionMaintenanceState = {
  candidateVersionId: string;
  lockRunId: string;
  maintenanceVersionId: string;
  repairRunId: string;
  sourceFingerprintSha256: string;
  startedAt: number;
};

type D1StatementResult = {
  rows: Array<Record<string, unknown>>;
  rowsRead: number;
  rowsWritten: number;
};

const operationProjection: Record<
  ProductionValidationLockOperation,
  { rowsRead: number; rowsWritten: number }
> = {
  // A live-conflict or expired-owner path currently bills 18 indexed reads in
  // Miniflare/D1. Keep explicit headroom so a successful takeover can never be
  // rejected after it has already committed, which would strand an unknown
  // owner until lease expiry.
  acquire: { rowsRead: 32, rowsWritten: 4 },
  verify: { rowsRead: 4, rowsWritten: 0 },
  release: { rowsRead: 8, rowsWritten: 4 },
};

export function createProductionValidationLockBudget(): ProductionValidationLockBudget {
  return {
    operations: 0,
    reservedRowsRead: 0,
    reservedRowsWritten: 0,
    billedRowsRead: 0,
    billedRowsWritten: 0,
  };
}

export function acquireProductionValidationExclusion(input: {
  candidateVersionId: string;
  sourceFingerprintSha256: string;
  runner?: ProductionValidationLockRunner;
}) {
  assertNoUnresolvedProductionMaintenance({ runner: input.runner });
  const owner: ProductionValidationLockOwner = {
    candidateVersionId: input.candidateVersionId,
    leaseExpiresAt: Date.now() + 90 * 60 * 1_000,
    leaseId: randomUUID(),
    runId: randomUUID(),
    sourceFingerprintSha256: input.sourceFingerprintSha256,
  };
  const acquired = acquireProductionValidationLock({
    owner,
    budget: createProductionValidationLockBudget(),
    runner: input.runner,
  });
  try {
    assertNoUnresolvedProductionMaintenance({ runner: input.runner });
    return {
      owner: acquired.owner,
      budget: acquired.budget,
      serverNowMs: acquired.serverNowMs,
    };
  } catch (error) {
    let releaseError: unknown = null;
    try {
      releaseProductionValidationLock({
        owner: acquired.owner,
        budget: acquired.budget,
        runner: input.runner,
      });
    } catch (caught) {
      releaseError = caught;
    }
    throw new AggregateError(
      [error, releaseError]
        .filter((entry): entry is NonNullable<unknown> => entry !== null && entry !== undefined)
        .map(asError),
      "Production exclusion acquisition found unresolved maintenance and exact release was attempted.",
    );
  }
}

function canonicalProductionMaintenanceState(value: ProductionMaintenanceState) {
  return JSON.stringify(parseProductionMaintenanceState(value));
}

function parseProductionMaintenanceState(value: unknown): ProductionMaintenanceState {
  if (!isRecord(value) || !hasExactKeys(value, [
    "candidateVersionId",
    "lockRunId",
    "maintenanceVersionId",
    "repairRunId",
    "sourceFingerprintSha256",
    "startedAt",
  ])) {
    throw new Error("Production maintenance state has the wrong schema.");
  }
  if (
    typeof value.candidateVersionId !== "string" ||
    !genericUuidPattern.test(value.candidateVersionId) ||
    typeof value.maintenanceVersionId !== "string" ||
    !genericUuidPattern.test(value.maintenanceVersionId) ||
    typeof value.lockRunId !== "string" ||
    !runUuidPattern.test(value.lockRunId) ||
    typeof value.repairRunId !== "string" ||
    !runUuidPattern.test(value.repairRunId) ||
    typeof value.sourceFingerprintSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceFingerprintSha256) ||
    typeof value.startedAt !== "number" ||
    !Number.isSafeInteger(value.startedAt) ||
    value.startedAt < 1
  ) {
    throw new Error("Production maintenance state is malformed.");
  }
  return {
    candidateVersionId: value.candidateVersionId,
    lockRunId: value.lockRunId,
    maintenanceVersionId: value.maintenanceVersionId,
    repairRunId: value.repairRunId,
    sourceFingerprintSha256: value.sourceFingerprintSha256,
    startedAt: value.startedAt,
  };
}

function parseStoredProductionMaintenanceState(value: unknown) {
  if (typeof value !== "string") throw new Error("Production maintenance row omitted its JSON value.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Production maintenance row contains malformed JSON.");
  }
  const state = parseProductionMaintenanceState(parsed);
  if (canonicalProductionMaintenanceState(state) !== value) {
    throw new Error("Production maintenance row is not canonical exact-schema JSON.");
  }
  return state;
}

export function releaseProductionValidationExclusion(
  exclusion: ProductionValidationExclusion,
  runner?: ProductionValidationLockRunner,
) {
  return releaseProductionValidationLock({
    owner: exclusion.owner,
    budget: exclusion.budget,
    runner,
  });
}

export function attestProductionValidationExclusion(
  exclusion: ProductionValidationExclusion,
  runner?: ProductionValidationLockRunner,
): ProductionValidationExclusion {
  const verified = verifyProductionValidationLock({
    owner: exclusion.owner,
    budget: exclusion.budget,
    runner,
  });
  if (
    verified.owner.leaseExpiresAt - verified.serverNowMs >
      PRODUCTION_VALIDATION_LOCK_RENEWAL_FLOOR_MS
  ) {
    return {
      owner: verified.owner,
      budget: verified.budget,
      serverNowMs: verified.serverNowMs,
    };
  }
  const renewedOwner: ProductionValidationLockOwner = {
    ...verified.owner,
    leaseExpiresAt: verified.serverNowMs + 90 * 60 * 1_000,
    leaseId: randomUUID(),
  };
  const renewed = acquireProductionValidationLock({
    owner: renewedOwner,
    previousOwner: verified.owner,
    budget: verified.budget,
    runner,
  });
  return {
    owner: renewed.owner,
    budget: renewed.budget,
    serverNowMs: renewed.serverNowMs,
  };
}

export function assertProductionValidationExclusionCommandWindow(
  exclusion: ProductionValidationExclusion,
  maximumCommandMs = PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS,
) {
  return assertProductionValidationLockCommandWindow(
    exclusion.owner,
    exclusion.serverNowMs,
    maximumCommandMs,
  );
}

export function assertProductionValidationLockCommandWindow(
  ownerInput: ProductionValidationLockOwner,
  serverNowMs: number,
  maximumCommandMs = PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS,
) {
  const owner = parseProductionValidationLockOwner(ownerInput);
  const serverNow = nonNegativeSafeInteger(serverNowMs, "production validation lock command-window server clock");
  if (
    !Number.isSafeInteger(maximumCommandMs) ||
    maximumCommandMs < 1 ||
    maximumCommandMs >= PRODUCTION_VALIDATION_LOCK_RENEWAL_FLOOR_MS
  ) {
    throw new Error("Protected production command timeout must fit strictly inside the lock renewal floor.");
  }
  const remainingMs = owner.leaseExpiresAt - serverNow;
  if (remainingMs <= PRODUCTION_VALIDATION_LOCK_RENEWAL_FLOOR_MS) {
    throw new Error("Production validation exclusion does not have a full protected-command window.");
  }
  return remainingMs;
}

export function assertProductionReleaseChildExclusion(
  expectedOperation: Exclude<ProductionReleaseOperationName, "rollback">,
  input: {
    env?: NodeJS.ProcessEnv;
    runner?: ProductionValidationLockRunner;
  } = {},
) {
  const env = input.env ?? process.env;
  if (env[PRODUCTION_RELEASE_OPERATION_ENV] !== expectedOperation) {
    throw new Error(`Production ${expectedOperation} must run through the guarded release-operation wrapper.`);
  }
  const rawOwner = env[PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV];
  if (!rawOwner) {
    throw new Error(`Production ${expectedOperation} omitted its guarded exclusion owner.`);
  }
  const owner = parseStoredProductionValidationLockOwner(rawOwner);
  const verified = verifyProductionValidationLock({
    owner,
    budget: createProductionValidationLockBudget(),
    runner: input.runner,
  });
  assertProductionValidationLockCommandWindow(verified.owner, verified.serverNowMs);
  return verified;
}

export function parseProductionValidationLockBudget(
  value: unknown,
): ProductionValidationLockBudget {
  if (!isRecord(value) || !hasExactKeys(value, [
    "billedRowsRead",
    "billedRowsWritten",
    "operations",
    "reservedRowsRead",
    "reservedRowsWritten",
  ])) {
    throw new Error("Production validation lock budget has the wrong schema.");
  }
  const budget: ProductionValidationLockBudget = {
    operations: nonNegativeSafeInteger(value.operations, "lock budget operations"),
    reservedRowsRead: nonNegativeSafeInteger(value.reservedRowsRead, "lock budget reserved reads"),
    reservedRowsWritten: nonNegativeSafeInteger(value.reservedRowsWritten, "lock budget reserved writes"),
    billedRowsRead: nonNegativeSafeInteger(value.billedRowsRead, "lock budget billed reads"),
    billedRowsWritten: nonNegativeSafeInteger(value.billedRowsWritten, "lock budget billed writes"),
  };
  assertProductionValidationLockBudget(budget);
  if (
    budget.billedRowsRead > budget.reservedRowsRead ||
    budget.billedRowsWritten > budget.reservedRowsWritten
  ) {
    throw new Error("Production validation lock budget bills exceed reservations.");
  }
  return budget;
}

export function reserveProductionValidationLockOperation(
  budget: ProductionValidationLockBudget,
  operation: ProductionValidationLockOperation,
) {
  assertProductionValidationLockBudget(budget);
  const projection = operationProjection[operation];
  const next: ProductionValidationLockBudget = {
    ...budget,
    operations: budget.operations + 1,
    reservedRowsRead: budget.reservedRowsRead + projection.rowsRead,
    reservedRowsWritten: budget.reservedRowsWritten + projection.rowsWritten,
  };
  assertProductionValidationLockBudget(next);
  return next;
}

export function accountProductionValidationLockBilling(
  budget: ProductionValidationLockBudget,
  operation: ProductionValidationLockOperation,
  billed: { rowsRead: number; rowsWritten: number },
) {
  assertProductionValidationLockBudget(budget);
  const rowsRead = nonNegativeSafeInteger(billed.rowsRead, "billed lock rows read");
  const rowsWritten = nonNegativeSafeInteger(billed.rowsWritten, "billed lock rows written");
  const projection = operationProjection[operation];
  if (rowsRead > projection.rowsRead || rowsWritten > projection.rowsWritten) {
    throw new Error(`Production validation lock ${operation} exceeded its reserved D1 rows.`);
  }
  const next: ProductionValidationLockBudget = {
    ...budget,
    billedRowsRead: budget.billedRowsRead + rowsRead,
    billedRowsWritten: budget.billedRowsWritten + rowsWritten,
  };
  assertProductionValidationLockBudget(next);
  if (
    next.billedRowsRead > next.reservedRowsRead ||
    next.billedRowsWritten > next.reservedRowsWritten
  ) {
    throw new Error("Production validation lock billed rows exceeded their pre-reservation.");
  }
  return next;
}

export function canonicalProductionValidationLockOwner(
  value: ProductionValidationLockOwner,
) {
  const owner = parseProductionValidationLockOwner(value);
  return JSON.stringify(owner);
}

export function parseProductionValidationLockOwner(
  value: unknown,
): ProductionValidationLockOwner {
  if (!isRecord(value) || !hasExactKeys(value, [
    "candidateVersionId",
    "leaseExpiresAt",
    "leaseId",
    "runId",
    "sourceFingerprintSha256",
  ])) {
    throw new Error("Production validation lock owner has the wrong schema.");
  }
  if (
    typeof value.candidateVersionId !== "string" ||
    !genericUuidPattern.test(value.candidateVersionId) ||
    typeof value.runId !== "string" ||
    !runUuidPattern.test(value.runId) ||
    typeof value.leaseId !== "string" ||
    !runUuidPattern.test(value.leaseId) ||
    typeof value.sourceFingerprintSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceFingerprintSha256) ||
    typeof value.leaseExpiresAt !== "number" ||
    !Number.isSafeInteger(value.leaseExpiresAt) ||
    value.leaseExpiresAt < 1
  ) {
    throw new Error("Production validation lock owner is malformed.");
  }
  return {
    candidateVersionId: value.candidateVersionId,
    leaseExpiresAt: value.leaseExpiresAt,
    leaseId: value.leaseId,
    runId: value.runId,
    sourceFingerprintSha256: value.sourceFingerprintSha256,
  };
}

export function parseStoredProductionValidationLockOwner(
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new Error("Production validation lock row omitted its JSON value.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Production validation lock row contains malformed JSON.");
  }
  const owner = parseProductionValidationLockOwner(parsed);
  if (canonicalProductionValidationLockOwner(owner) !== value) {
    throw new Error("Production validation lock row is not canonical exact-schema JSON.");
  }
  return owner;
}

export function buildProductionValidationLockAcquireSql(
  ownerInput: ProductionValidationLockOwner,
  previousOwnerInput: ProductionValidationLockOwner | null = null,
) {
  const owner = parseProductionValidationLockOwner(ownerInput);
  const previousOwner = previousOwnerInput
    ? validateLeaseTransition(previousOwnerInput, owner)
    : null;
  const value = sqlString(canonicalProductionValidationLockOwner(owner));
  const key = sqlString(PRODUCTION_VALIDATION_LOCK_KEY);
  const serverNow = productionValidationLockServerNowSql();
  const strictStoredOwner = strictStoredOwnerSql("app_metadata.value");
  const canonicalStoredOwner = canonicalStoredOwnerSql("app_metadata.value");
  const exactPreviousOwner = previousOwner
    ? `app_metadata.value = ${sqlString(canonicalProductionValidationLockOwner(previousOwner))}`
    : "0 = 1";
  return `insert into app_metadata ("key", value, updated_at)
select ${key}, ${value}, ${serverNow}
where ${owner.leaseExpiresAt} >= ${serverNow} + ${PRODUCTION_VALIDATION_LOCK_MIN_LEASE_MS}
  and ${owner.leaseExpiresAt} <= ${serverNow} + ${PRODUCTION_VALIDATION_LOCK_MAX_LEASE_MS}
on conflict("key") do update set
  value = excluded.value,
  updated_at = excluded.updated_at
where
  ${exactPreviousOwner}
  or (
    (${strictStoredOwner})
    and (${canonicalStoredOwner})
    and json_extract(app_metadata.value, '$.leaseExpiresAt') <= ${serverNow}
  )
returning "key", value, updated_at, ${serverNow} as server_now;`;
}

function buildProductionValidationLockVerifySql() {
  return `select "key", value, updated_at, ${productionValidationLockServerNowSql()} as server_now
from app_metadata
where "key" = ${sqlString(PRODUCTION_VALIDATION_LOCK_KEY)}
limit 1;`;
}

function buildProductionValidationLockReleaseSql(
  ownerInput: ProductionValidationLockOwner,
) {
  const owner = parseProductionValidationLockOwner(ownerInput);
  return `delete from app_metadata
where "key" = ${sqlString(PRODUCTION_VALIDATION_LOCK_KEY)}
  and value = ${sqlString(canonicalProductionValidationLockOwner(owner))}
returning "key", value, updated_at, ${productionValidationLockServerNowSql()} as server_now;`;
}

export function acquireProductionValidationLock(input: {
  owner: ProductionValidationLockOwner;
  previousOwner?: ProductionValidationLockOwner | null;
  budget: ProductionValidationLockBudget;
  runner?: ProductionValidationLockRunner;
  onReserved?: (budget: ProductionValidationLockBudget) => void;
}) {
  const owner = parseProductionValidationLockOwner(input.owner);
  const previousOwner = input.previousOwner
    ? validateLeaseTransition(input.previousOwner, owner)
    : null;
  const runner = input.runner ?? defaultRunner;
  let budget = reserveProductionValidationLockOperation(input.budget, "acquire");
  input.onReserved?.(budget);
  let result: D1StatementResult;
  try {
    result = executeLockSql(
      buildProductionValidationLockAcquireSql(owner, previousOwner),
      runner,
    );
  } catch (error) {
    const verified = verifyProductionValidationLock({
      owner,
      budget,
      runner,
      onReserved: input.onReserved,
    });
    return {
      owner: verified.owner,
      serverNowMs: verified.serverNowMs,
      budget: verified.budget,
      recoveredFromLostResponse: true,
      acquireError: safeErrorMessage(error),
    };
  }
  budget = accountProductionValidationLockBilling(budget, "acquire", result);
  input.onReserved?.(budget);
  try {
    const acquired = exactOwnerRow(result.rows, "acquire", true);
    assertSameOwner(acquired.owner, owner);
    return {
      owner: acquired.owner,
      serverNowMs: acquired.serverNowMs,
      budget,
      recoveredFromLostResponse: false,
    };
  } catch (error) {
    const verified = verifyProductionValidationLock({
      owner,
      budget,
      runner,
      onReserved: input.onReserved,
    });
    return {
      owner: verified.owner,
      serverNowMs: verified.serverNowMs,
      budget: verified.budget,
      recoveredFromLostResponse: true,
      acquireError: safeErrorMessage(error),
    };
  }
}

export function verifyProductionValidationLock(input: {
  owner: ProductionValidationLockOwner;
  budget: ProductionValidationLockBudget;
  runner?: ProductionValidationLockRunner;
  onReserved?: (budget: ProductionValidationLockBudget) => void;
}) {
  const expected = parseProductionValidationLockOwner(input.owner);
  const runner = input.runner ?? defaultRunner;
  let budget = reserveProductionValidationLockOperation(input.budget, "verify");
  input.onReserved?.(budget);
  const result = executeLockSql(buildProductionValidationLockVerifySql(), runner);
  budget = accountProductionValidationLockBilling(budget, "verify", result);
  input.onReserved?.(budget);
  const actual = exactOwnerRow(result.rows, "verify", true);
  assertSameOwner(actual.owner, expected);
  return { owner: actual.owner, serverNowMs: actual.serverNowMs, budget };
}

export function assertProductionValidationLockAbsent(input: {
  runner?: ProductionValidationLockRunner;
} = {}) {
  const result = executeLockSql(
    buildProductionValidationLockVerifySql(),
    input.runner ?? defaultRunner,
  );
  if (result.rowsRead > operationProjection.verify.rowsRead || result.rowsWritten !== 0) {
    throw new Error("Production validation lock absence check exceeded its read-only D1 budget.");
  }
  if (result.rows.length === 0) {
    return { rowsRead: result.rowsRead, serverNowMs: null };
  }
  if (result.rows.length !== 1) {
    throw new Error("Production validation lock absence check returned multiple rows.");
  }
  const active = parseOwnerRow(result.rows[0], false);
  throw new Error(
    `Production validation lock is present for run ${active.owner.runId} until ${active.owner.leaseExpiresAt}.`,
  );
}

export function assertNoLiveProductionValidationLock(input: {
  runner?: ProductionValidationLockRunner;
} = {}) {
  assertNoUnresolvedProductionMaintenance(input);
  const result = executeLockSql(
    buildProductionValidationLockVerifySql(),
    input.runner ?? defaultRunner,
  );
  if (result.rowsRead > operationProjection.verify.rowsRead || result.rowsWritten !== 0) {
    throw new Error("Production validation lock availability check exceeded its read-only D1 budget.");
  }
  if (result.rows.length === 0) {
    return { available: true as const, expiredOwner: null, serverNowMs: null };
  }
  if (result.rows.length !== 1) {
    throw new Error("Production validation lock availability check returned multiple rows.");
  }
  const existing = parseOwnerRow(result.rows[0], false);
  if (existing.owner.leaseExpiresAt > existing.serverNowMs) {
    throw new Error(
      `Production validation lock is live for run ${existing.owner.runId} until ${existing.owner.leaseExpiresAt}.`,
    );
  }
  // Leave the exact expired row in place. The following acquire CAS must
  // replace it atomically; a preflight delete would create its own race.
  return {
    available: true as const,
    expiredOwner: existing.owner,
    serverNowMs: existing.serverNowMs,
  };
}

export function readProductionMaintenanceState(input: {
  runner?: ProductionValidationLockRunner;
} = {}) {
  const result = executeLockSql(
    `select "key", value, updated_at, ${productionValidationLockServerNowSql()} as server_now
from app_metadata
where "key" = ${sqlString(PRODUCTION_MAINTENANCE_STATE_KEY)}
limit 1;`,
    input.runner ?? defaultRunner,
  );
  if (
    result.rowsRead > PRODUCTION_MAINTENANCE_STATE_MAX_BILLED_ROWS_READ ||
    result.rowsWritten !== 0
  ) {
    throw new Error("Production maintenance state read exceeded its read-only D1 budget.");
  }
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) throw new Error("Production maintenance state returned multiple rows.");
  const row = result.rows[0]!;
  if (
    !hasExactKeys(row, ["key", "server_now", "updated_at", "value"]) ||
    row.key !== PRODUCTION_MAINTENANCE_STATE_KEY ||
    typeof row.updated_at !== "number" ||
    !Number.isSafeInteger(row.updated_at) ||
    row.updated_at < 0
  ) {
    throw new Error("Production maintenance state row has the wrong contract.");
  }
  return {
    state: parseStoredProductionMaintenanceState(row.value),
    serverNowMs: nonNegativeSafeInteger(row.server_now, "production maintenance state server clock"),
  };
}

export function assertNoUnresolvedProductionMaintenance(input: {
  runner?: ProductionValidationLockRunner;
} = {}) {
  const active = readProductionMaintenanceState(input);
  if (active) {
    throw new Error(
      `Production maintenance is unresolved for repair ${active.state.repairRunId} on version ${active.state.maintenanceVersionId}.`,
    );
  }
}

export function createProductionMaintenanceState(input: {
  exclusion: ProductionValidationExclusion;
  state: ProductionMaintenanceState;
  runner?: ProductionValidationLockRunner;
}) {
  const state = parseProductionMaintenanceState(input.state);
  if (
    state.candidateVersionId !== input.exclusion.owner.candidateVersionId ||
    state.lockRunId !== input.exclusion.owner.runId ||
    state.sourceFingerprintSha256 !== input.exclusion.owner.sourceFingerprintSha256
  ) {
    throw new Error("Production maintenance state is not bound to the active exclusion owner.");
  }
  const verified = verifyProductionValidationLock({
    owner: input.exclusion.owner,
    budget: input.exclusion.budget,
    runner: input.runner,
  });
  const runner = input.runner ?? defaultRunner;
  const canonicalOwner = canonicalProductionValidationLockOwner(verified.owner);
  let writeError: unknown = null;
  let result: D1StatementResult | null = null;
  try {
    result = executeLockSql(
      `insert into app_metadata ("key", value, updated_at)
select ${sqlString(PRODUCTION_MAINTENANCE_STATE_KEY)}, ${sqlString(canonicalProductionMaintenanceState(state))}, ${productionValidationLockServerNowSql()}
where not exists (
  select 1 from app_metadata where "key" = ${sqlString(PRODUCTION_MAINTENANCE_STATE_KEY)}
)
  and exists (
    select 1 from app_metadata lock_owner
    where lock_owner."key" = ${sqlString(PRODUCTION_VALIDATION_LOCK_KEY)}
      and lock_owner.value = ${sqlString(canonicalOwner)}
      and json_extract(lock_owner.value, '$.leaseExpiresAt') > ${productionValidationLockServerNowSql()}
  )
returning "key", value, updated_at, ${productionValidationLockServerNowSql()} as server_now;`,
      runner,
    );
  } catch (error) {
    writeError = error;
  }
  if (result && (result.rowsRead > 32 || result.rowsWritten > 4)) {
    throw new Error("Production maintenance state creation exceeded its D1 budget.");
  }
  const readback = readProductionMaintenanceState({ runner });
  if (
    !readback ||
    canonicalProductionMaintenanceState(readback.state) !== canonicalProductionMaintenanceState(state)
  ) {
    throw new AggregateError(
      [writeError, new Error("Production maintenance state creation did not exact-verify.")]
        .filter((error): error is NonNullable<unknown> => error !== null && error !== undefined)
        .map(asError),
      "Production maintenance state creation is indeterminate.",
    );
  }
  const postVerified = verifyProductionValidationLock({
    owner: verified.owner,
    budget: verified.budget,
    runner: input.runner,
  });
  return {
    state: readback.state,
    exclusion: {
      owner: postVerified.owner,
      budget: postVerified.budget,
      serverNowMs: postVerified.serverNowMs,
    },
    recoveredFromLostResponse: writeError !== null,
  };
}

export function clearProductionMaintenanceState(input: {
  exclusion: ProductionValidationExclusion;
  state: ProductionMaintenanceState;
  runner?: ProductionValidationLockRunner;
}) {
  const state = parseProductionMaintenanceState(input.state);
  const verified = verifyProductionValidationLock({
    owner: input.exclusion.owner,
    budget: input.exclusion.budget,
    runner: input.runner,
  });
  const runner = input.runner ?? defaultRunner;
  const canonicalOwner = canonicalProductionValidationLockOwner(verified.owner);
  let clearError: unknown = null;
  let result: D1StatementResult | null = null;
  try {
    result = executeLockSql(
      `delete from app_metadata
where "key" = ${sqlString(PRODUCTION_MAINTENANCE_STATE_KEY)}
  and value = ${sqlString(canonicalProductionMaintenanceState(state))}
  and exists (
    select 1 from app_metadata lock_owner
    where lock_owner."key" = ${sqlString(PRODUCTION_VALIDATION_LOCK_KEY)}
      and lock_owner.value = ${sqlString(canonicalOwner)}
      and json_extract(lock_owner.value, '$.leaseExpiresAt') > ${productionValidationLockServerNowSql()}
  )
returning "key", value, updated_at, ${productionValidationLockServerNowSql()} as server_now;`,
      runner,
    );
  } catch (error) {
    clearError = error;
  }
  if (result && (result.rowsRead > 32 || result.rowsWritten > 4)) {
    throw new Error("Production maintenance state clear exceeded its D1 budget.");
  }
  const readback = readProductionMaintenanceState({ runner });
  if (readback) {
    throw new AggregateError(
      [clearError, new Error("Production maintenance state clear did not prove absence.")]
        .filter((error): error is NonNullable<unknown> => error !== null && error !== undefined)
        .map(asError),
      "Production maintenance state clear is indeterminate.",
    );
  }
  const postVerified = verifyProductionValidationLock({
    owner: verified.owner,
    budget: verified.budget,
    runner: input.runner,
  });
  return {
    exclusion: {
      owner: postVerified.owner,
      budget: postVerified.budget,
      serverNowMs: postVerified.serverNowMs,
    },
    recoveredFromLostResponse: clearError !== null,
  };
}

export function acquireProductionMaintenanceRecoveryExclusion(input: {
  state: ProductionMaintenanceState;
  runner?: ProductionValidationLockRunner;
}) {
  const expected = parseProductionMaintenanceState(input.state);
  const current = readProductionMaintenanceState({ runner: input.runner });
  if (
    !current ||
    canonicalProductionMaintenanceState(current.state) !== canonicalProductionMaintenanceState(expected)
  ) {
    throw new Error("Production maintenance recovery state changed before exclusion acquisition.");
  }
  const owner: ProductionValidationLockOwner = {
    candidateVersionId: expected.candidateVersionId,
    leaseExpiresAt: Date.now() + 90 * 60 * 1_000,
    leaseId: randomUUID(),
    runId: randomUUID(),
    sourceFingerprintSha256: expected.sourceFingerprintSha256,
  };
  const acquired = acquireProductionValidationLock({
    owner,
    budget: createProductionValidationLockBudget(),
    runner: input.runner,
  });
  const after = readProductionMaintenanceState({ runner: input.runner });
  if (
    !after ||
    canonicalProductionMaintenanceState(after.state) !== canonicalProductionMaintenanceState(expected)
  ) {
    let releaseError: unknown = null;
    try {
      releaseProductionValidationLock({
        owner: acquired.owner,
        budget: acquired.budget,
        runner: input.runner,
      });
    } catch (error) {
      releaseError = error;
    }
    throw new AggregateError(
      [
        new Error("Production maintenance recovery state changed during exclusion acquisition."),
        releaseError,
      ]
        .filter((error): error is NonNullable<unknown> => error !== null && error !== undefined)
        .map(asError),
      "Production maintenance recovery acquisition failed and exact release was attempted.",
    );
  }
  return {
    owner: acquired.owner,
    budget: acquired.budget,
    serverNowMs: acquired.serverNowMs,
  };
}

export function releaseProductionValidationLock(input: {
  owner: ProductionValidationLockOwner;
  budget: ProductionValidationLockBudget;
  runner?: ProductionValidationLockRunner;
  onReserved?: (budget: ProductionValidationLockBudget) => void;
}) {
  const owner = parseProductionValidationLockOwner(input.owner);
  const runner = input.runner ?? defaultRunner;
  let budget = reserveProductionValidationLockOperation(input.budget, "release");
  input.onReserved?.(budget);
  let releaseError: unknown = null;
  let result: D1StatementResult | null = null;
  try {
    result = executeLockSql(buildProductionValidationLockReleaseSql(owner), runner);
  } catch (error) {
    releaseError = error;
  }
  if (result) {
    budget = accountProductionValidationLockBilling(budget, "release", result);
    input.onReserved?.(budget);
    try {
      if (result.rows.length > 1) {
        throw new Error("Production validation lock release returned multiple rows.");
      }
      if (result.rows.length === 1) {
        assertSameOwner(parseOwnerRow(result.rows[0], false).owner, owner);
      }
    } catch (error) {
      releaseError = error;
    }
  }

  budget = reserveProductionValidationLockOperation(budget, "verify");
  input.onReserved?.(budget);
  const readback = executeLockSql(buildProductionValidationLockVerifySql(), runner);
  budget = accountProductionValidationLockBilling(budget, "verify", readback);
  input.onReserved?.(budget);
  if (readback.rows.length !== 0) {
    const actual = readback.rows.length === 1
      ? canonicalProductionValidationLockOwner(parseOwnerRow(readback.rows[0], false).owner)
      : "multiple rows";
    throw new AggregateError(
      [
        ...(releaseError ? [asError(releaseError)] : []),
        new Error(`Production validation lock release did not prove absence (${actual}).`),
      ],
      "Production validation lock release is indeterminate.",
    );
  }
  return {
    budget,
    recoveredFromLostResponse: releaseError !== null,
    releaseError: releaseError ? safeErrorMessage(releaseError) : null,
  };
}

function executeLockSql(sql: string, runner: ProductionValidationLockRunner) {
  const output = runner([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  return parseD1StatementResult(output);
}

export function parseD1StatementResult(output: string): D1StatementResult {
  const value = parseJsonOutput(output);
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("Production validation lock D1 output has the wrong result-set count.");
  }
  const entry = value[0];
  if (!isRecord(entry) || entry.success !== true || !Array.isArray(entry.results)) {
    throw new Error("Production validation lock D1 statement failed or omitted rows.");
  }
  if (!entry.results.every(isRecord)) {
    throw new Error("Production validation lock D1 statement returned malformed rows.");
  }
  const meta = isRecord(entry.meta) ? entry.meta : null;
  if (!meta) throw new Error("Production validation lock D1 statement omitted billing metadata.");
  return {
    rows: entry.results,
    rowsRead: nonNegativeSafeInteger(meta.rows_read, "lock rows_read"),
    rowsWritten: nonNegativeSafeInteger(meta.rows_written, "lock rows_written"),
  };
}

function exactOwnerRow(
  rows: Array<Record<string, unknown>>,
  operation: string,
  requireLive: boolean,
) {
  if (rows.length !== 1) {
    throw new Error(`Production validation lock ${operation} did not return one owned row.`);
  }
  return parseOwnerRow(rows[0], requireLive);
}

function parseOwnerRow(row: Record<string, unknown>, requireLive: boolean) {
  if (
    !hasExactKeys(row, ["key", "server_now", "updated_at", "value"]) ||
    row.key !== PRODUCTION_VALIDATION_LOCK_KEY
  ) {
    throw new Error("Production validation lock D1 row has the wrong contract.");
  }
  if (typeof row.updated_at !== "number" || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) {
    throw new Error("Production validation lock D1 row has an invalid updated_at value.");
  }
  const serverNowMs = nonNegativeSafeInteger(row.server_now, "production validation lock server clock");
  const owner = parseStoredProductionValidationLockOwner(row.value);
  if (requireLive && owner.leaseExpiresAt <= serverNowMs) {
    throw new Error("Production validation lock lease has expired according to D1.");
  }
  return { owner, serverNowMs };
}

function strictStoredOwnerSql(column: string) {
  return `json_valid(${column}) = 1
    and (select count(*) from json_each(${column})) = 5
    and not exists (
      select 1 from json_each(${column})
      where key not in ('candidateVersionId', 'leaseExpiresAt', 'leaseId', 'runId', 'sourceFingerprintSha256')
    )
    and json_type(${column}, '$.candidateVersionId') = 'text'
    and length(json_extract(${column}, '$.candidateVersionId')) = 36
    and json_extract(${column}, '$.candidateVersionId') not glob '*[^0-9a-f-]*'
    and length(replace(json_extract(${column}, '$.candidateVersionId'), '-', '')) = 32
    and replace(json_extract(${column}, '$.candidateVersionId'), '-', '') not glob '*[^0-9a-f]*'
    and substr(json_extract(${column}, '$.candidateVersionId'), 9, 1) = '-'
    and substr(json_extract(${column}, '$.candidateVersionId'), 14, 1) = '-'
    and substr(json_extract(${column}, '$.candidateVersionId'), 19, 1) = '-'
    and substr(json_extract(${column}, '$.candidateVersionId'), 24, 1) = '-'
    and json_type(${column}, '$.leaseId') = 'text'
    and length(json_extract(${column}, '$.leaseId')) = 36
    and json_extract(${column}, '$.leaseId') not glob '*[^0-9a-f-]*'
    and length(replace(json_extract(${column}, '$.leaseId'), '-', '')) = 32
    and replace(json_extract(${column}, '$.leaseId'), '-', '') not glob '*[^0-9a-f]*'
    and substr(json_extract(${column}, '$.leaseId'), 9, 1) = '-'
    and substr(json_extract(${column}, '$.leaseId'), 14, 1) = '-'
    and substr(json_extract(${column}, '$.leaseId'), 19, 1) = '-'
    and substr(json_extract(${column}, '$.leaseId'), 24, 1) = '-'
    and substr(json_extract(${column}, '$.leaseId'), 15, 1) in ('1','2','3','4','5','6','7','8')
    and substr(json_extract(${column}, '$.leaseId'), 20, 1) in ('8','9','a','b')
    and json_type(${column}, '$.runId') = 'text'
    and length(json_extract(${column}, '$.runId')) = 36
    and json_extract(${column}, '$.runId') not glob '*[^0-9a-f-]*'
    and length(replace(json_extract(${column}, '$.runId'), '-', '')) = 32
    and replace(json_extract(${column}, '$.runId'), '-', '') not glob '*[^0-9a-f]*'
    and substr(json_extract(${column}, '$.runId'), 9, 1) = '-'
    and substr(json_extract(${column}, '$.runId'), 14, 1) = '-'
    and substr(json_extract(${column}, '$.runId'), 19, 1) = '-'
    and substr(json_extract(${column}, '$.runId'), 24, 1) = '-'
    and substr(json_extract(${column}, '$.runId'), 15, 1) in ('1','2','3','4','5','6','7','8')
    and substr(json_extract(${column}, '$.runId'), 20, 1) in ('8','9','a','b')
    and json_type(${column}, '$.sourceFingerprintSha256') = 'text'
    and length(json_extract(${column}, '$.sourceFingerprintSha256')) = 64
    and json_extract(${column}, '$.sourceFingerprintSha256') not glob '*[^0-9a-f]*'
    and json_type(${column}, '$.leaseExpiresAt') = 'integer'
    and json_extract(${column}, '$.leaseExpiresAt') >= 1
    and json_extract(${column}, '$.leaseExpiresAt') <= 9007199254740991`;
}

function canonicalStoredOwnerSql(column: string) {
  return `${column} = json_object(
    'candidateVersionId', json_extract(${column}, '$.candidateVersionId'),
    'leaseExpiresAt', json_extract(${column}, '$.leaseExpiresAt'),
    'leaseId', json_extract(${column}, '$.leaseId'),
    'runId', json_extract(${column}, '$.runId'),
    'sourceFingerprintSha256', json_extract(${column}, '$.sourceFingerprintSha256')
  )`;
}

function validateLeaseTransition(
  previousInput: ProductionValidationLockOwner,
  nextInput: ProductionValidationLockOwner,
) {
  const previous = parseProductionValidationLockOwner(previousInput);
  const next = parseProductionValidationLockOwner(nextInput);
  if (
    previous.candidateVersionId !== next.candidateVersionId ||
    previous.runId !== next.runId ||
    previous.sourceFingerprintSha256 !== next.sourceFingerprintSha256 ||
    previous.leaseId === next.leaseId ||
    previous.leaseExpiresAt >= next.leaseExpiresAt
  ) {
    throw new Error("Production validation lock lease transition is not an exact forward renewal.");
  }
  return previous;
}

function productionValidationLockServerNowSql() {
  return "(cast(strftime('%s', 'now') as integer) * 1000)";
}

function assertSameOwner(actual: ProductionValidationLockOwner, expected: ProductionValidationLockOwner) {
  if (
    canonicalProductionValidationLockOwner(actual) !==
      canonicalProductionValidationLockOwner(expected)
  ) {
    throw new Error("Production validation lock is owned by a different release run.");
  }
}

function assertProductionValidationLockBudget(budget: ProductionValidationLockBudget) {
  for (const [label, value] of Object.entries(budget)) {
    nonNegativeSafeInteger(value, `production validation lock budget ${label}`);
  }
  if (
    budget.operations > PRODUCTION_VALIDATION_LOCK_MAX_OPERATIONS ||
    budget.reservedRowsRead > PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ ||
    budget.reservedRowsWritten > PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN ||
    budget.billedRowsRead > PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ ||
    budget.billedRowsWritten > PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN
  ) {
    throw new Error("Production validation lock exceeded its bounded D1 release budget.");
  }
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = output.indexOf("[");
    const last = output.lastIndexOf("]");
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(output.slice(first, last + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function defaultRunner(args: string[]) {
  return runWrangler(args);
}

function safeErrorMessage(value: unknown) {
  return value instanceof Error ? value.message.slice(0, 1_000) : "unknown failure";
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error("Unknown production validation lock failure.");
}
