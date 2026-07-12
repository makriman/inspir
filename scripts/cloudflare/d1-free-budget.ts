import { D1_DATABASE_NAME, runWrangler, type WranglerRunner } from "./migration-config";

// Analytics can lag behind the most recent queries. Keep explicit operating
// headroom instead of treating the published hard limits as admission limits.
export const D1_FREE_SAFE_ROWS_READ_LIMIT = 4_000_000;
export const D1_FREE_SAFE_ROWS_WRITTEN_LIMIT = 80_000;
const D1_INSIGHTS_GROUP_LIMIT = 10_000;

export type D1DailyUsage = {
  databaseCount: number;
  queryGroups: number;
  rowsRead: number;
  rowsWritten: number;
  executions: number;
  windowMinutes: number;
};

export type D1ProjectedUsage = {
  operation: string;
  rowsRead: number;
  rowsWritten: number;
};

type D1InsightRow = {
  totalRowsRead: number;
  totalRowsWritten: number;
  numberOfTimesRun: number;
};

export function utcUsageWindowMinutes(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("D1 usage gate requires a valid date.");
  return Math.max(1, now.getUTCHours() * 60 + now.getUTCMinutes() + 1);
}

export function assertD1FreeDailyBudget(usage: D1DailyUsage, projection: D1ProjectedUsage) {
  assertPositiveSafeInteger(usage.databaseCount, "database count");
  assertNonNegativeSafeInteger(usage.queryGroups, "query group count");
  assertNonNegativeSafeInteger(usage.rowsRead, "current rows read");
  assertNonNegativeSafeInteger(usage.rowsWritten, "current rows written");
  assertNonNegativeSafeInteger(usage.executions, "execution count");
  assertPositiveSafeInteger(usage.windowMinutes, "usage window minutes");
  if (usage.windowMinutes > 24 * 60) {
    throw new Error("D1 usage window must not exceed one UTC day.");
  }
  assertNonNegativeSafeInteger(projection.rowsRead, "projected rows read");
  assertNonNegativeSafeInteger(projection.rowsWritten, "projected rows written");
  if (
    !projection.operation.trim() ||
    projection.operation.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(projection.operation)
  ) {
    throw new Error("D1 usage projection requires a bounded operation name.");
  }

  const rowsReadAfter = safeAdd(usage.rowsRead, projection.rowsRead, "rows read");
  const rowsWrittenAfter = safeAdd(usage.rowsWritten, projection.rowsWritten, "rows written");
  if (
    rowsReadAfter > D1_FREE_SAFE_ROWS_READ_LIMIT ||
    rowsWrittenAfter > D1_FREE_SAFE_ROWS_WRITTEN_LIMIT
  ) {
    throw new Error(
      `${projection.operation} exceeds the reserved Workers Free D1 daily budget: ` +
        `read ${usage.rowsRead}+${projection.rowsRead}=${rowsReadAfter}/` +
        `${D1_FREE_SAFE_ROWS_READ_LIMIT}; write ${usage.rowsWritten}+${projection.rowsWritten}=` +
        `${rowsWrittenAfter}/${D1_FREE_SAFE_ROWS_WRITTEN_LIMIT}. Wait for the next 00:00 UTC reset.`,
    );
  }
  return { rowsReadAfter, rowsWrittenAfter };
}

export function parseD1InsightsRows(value: unknown): D1InsightRow[] {
  if (!Array.isArray(value)) throw new Error("Wrangler D1 insights did not return an array.");
  if (value.length >= D1_INSIGHTS_GROUP_LIMIT) {
    throw new Error(
      `Wrangler D1 insights reached its ${D1_INSIGHTS_GROUP_LIMIT}-group cap; refusing a truncated budget.`,
    );
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Invalid Wrangler D1 insight row ${index}.`);
    const totalRowsRead = requiredNonNegativeInteger(entry.totalRowsRead, `insight ${index} rows read`);
    const totalRowsWritten = requiredNonNegativeInteger(
      entry.totalRowsWritten,
      `insight ${index} rows written`,
    );
    const numberOfTimesRun = requiredNonNegativeInteger(
      entry.numberOfTimesRun,
      `insight ${index} executions`,
    );
    return { totalRowsRead, totalRowsWritten, numberOfTimesRun };
  });
}

export function loadAccountD1DailyUsage(
  now = new Date(),
  runner: WranglerRunner = runWrangler,
  clock: () => Date = () => new Date(),
): D1DailyUsage {
  const usageDay = utcDay(now);
  const databases = parseD1DatabaseList(parseWranglerJson(runner(["d1", "list", "--json"])));
  if (!databases.length) throw new Error("No Cloudflare D1 databases were available for the account budget gate.");
  let windowMinutes = utcUsageWindowMinutes(now);
  let queryGroups = 0;
  let rowsRead = 0;
  let rowsWritten = 0;
  let executions = 0;

  for (const database of databases) {
    const observedAt = clock();
    if (utcDay(observedAt) !== usageDay) {
      throw new Error("UTC day changed during D1 usage collection; rerun the budget gate.");
    }
    windowMinutes = utcUsageWindowMinutes(observedAt);
    const insights = parseD1InsightsRows(
      parseWranglerJson(
        runner(
          [
            "d1",
            "insights",
            database,
            "--time-period",
            `${windowMinutes}m`,
            "--sort-type",
            "sum",
            "--sort-by",
            "reads",
            "--limit",
            String(D1_INSIGHTS_GROUP_LIMIT),
            "--json",
          ],
          { maxBuffer: 128 * 1024 * 1024 },
        ),
      ),
    );
    if (utcDay(clock()) !== usageDay) {
      throw new Error("UTC day changed during D1 usage collection; rerun the budget gate.");
    }
    queryGroups = safeAdd(queryGroups, insights.length, "query groups");
    for (const insight of insights) {
      rowsRead = safeAdd(rowsRead, insight.totalRowsRead, "rows read");
      rowsWritten = safeAdd(rowsWritten, insight.totalRowsWritten, "rows written");
      executions = safeAdd(executions, insight.numberOfTimesRun, "executions");
    }
  }

  return {
    databaseCount: databases.length,
    queryGroups,
    rowsRead,
    rowsWritten,
    executions,
    windowMinutes,
  };
}

function parseD1DatabaseList(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Wrangler D1 list did not return an array.");
  const names = value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      throw new Error(`Invalid Wrangler D1 database row ${index}.`);
    }
    const name = entry.name.trim();
    if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error(`Invalid Wrangler D1 database name at row ${index}.`);
    }
    return name;
  });
  if (new Set(names).size !== names.length) throw new Error("Wrangler returned duplicate D1 database names.");
  if (!names.includes(D1_DATABASE_NAME)) {
    throw new Error(`The account D1 list does not include ${D1_DATABASE_NAME}.`);
  }
  return names;
}

function parseWranglerJson(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) throw new Error("Could not parse Wrangler JSON output.");
    return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  }
}

function requiredNonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function assertNonNegativeSafeInteger(value: number, label: string) {
  requiredNonNegativeInteger(value, label);
}

function assertPositiveSafeInteger(value: number, label: string) {
  assertNonNegativeSafeInteger(value, label);
  if (value === 0) throw new Error(`Invalid ${label}.`);
}

function safeAdd(left: number, right: number, label: string) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`D1 ${label} total is unsafe.`);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utcDay(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error("D1 usage gate requires a valid date.");
  return value.toISOString().slice(0, 10);
}
