import { createHash, stableStringify } from "./migration-config";

export type ExpectedRemoteVector = {
  namespace?: string;
  valuesSha256?: string;
  metadata?: Record<string, unknown>;
};

export type RemoteVectorRow = {
  namespace?: string;
  values?: unknown;
  metadata?: Record<string, unknown>;
};

export function remoteVectorRowProblems(row: RemoteVectorRow, expected: ExpectedRemoteVector | undefined, dimensions = 512) {
  const problems: string[] = [];
  if (row.namespace !== expected?.namespace) problems.push("namespace mismatch");

  if (!Array.isArray(row.values)) {
    problems.push("values missing");
  } else {
    if (row.values.length !== dimensions) problems.push(`values length is ${row.values.length}`);
    if (!row.values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      problems.push("values contain non-finite or non-numeric entries");
    }
    if (expected?.valuesSha256 && hashStable(row.values) !== expected.valuesSha256) {
      problems.push("values hash mismatch");
    }
  }

  problems.push(...exactMetadataProblems(row.metadata ?? {}, expected?.metadata ?? {}));
  return problems;
}

export function exactMetadataProblems(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  const problems: string[] = [];
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  const extraKeys = actualKeys.filter((key) => !Object.hasOwn(expected, key));
  const missingKeys = expectedKeys.filter((key) => !Object.hasOwn(actual, key));

  for (const key of missingKeys) problems.push(`metadata.${key} missing`);
  for (const key of extraKeys) problems.push(`metadata.${key} unexpected`);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(actual, key)) continue;
    if (stableStringify(actual[key]) !== stableStringify(expected[key])) problems.push(`metadata.${key} mismatch`);
  }
  return problems;
}

function hashStable(value: unknown) {
  return createHash().update(stableStringify(value)).digest("hex");
}
