import fs from "node:fs";
import path from "node:path";
import {
  readPrivateJsonNoFollow,
  writePrivateJsonDurably,
} from "./d1-release-budget-ledger";
import {
  cloudflareDir,
  VECTORIZE_INDEX_NAME,
} from "./migration-config";
import {
  assertReleaseSequenceCurrentReleaseBinding,
  parseReleaseSequenceIdentity,
  releaseSequenceIdentityFromCurrentRelease,
  type ReleaseSequenceCurrentRelease,
  type ReleaseSequenceIdentity,
  type ReleaseSequenceServingPhase,
} from "./release-sequence-attestations";

const VECTORIZE_READINESS_REPORT = "cloudflare/vectorize-readiness-report.json";
const VECTORIZE_READINESS_EVIDENCE_KIND = "vectorize-readiness-v2" as const;
const VECTORIZE_READINESS_MAX_AGE_MS = 30 * 60 * 1_000;
const VECTORIZE_READINESS_MAX_JSON_BYTES = 64 * 1_024;
const VECTORIZE_READINESS_DIMENSIONS = 512;
const VECTORIZE_READINESS_METRIC = "cosine" as const;
const VECTORIZE_READINESS_BINDING = "MEMORY_VECTORIZE";
const VECTORIZE_READINESS_REMOTE_QUERIES = 5 as const;
const VECTORIZE_READINESS_COMMANDS = [
  "deployments status (before)",
  "vectorize get",
  "vectorize info",
  "vectorize list-metadata-index",
  "deployments status (after)",
] as const;
const VECTORIZE_READINESS_METADATA_INDEXES = [
  { propertyName: "chatId", indexType: "string" },
  { propertyName: "userId", indexType: "string" },
] as const;

const workerName = "inspirlearning";
const workerVersionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type VectorizeMetadataIndex = {
  propertyName: string;
  indexType: string;
};

export type VectorizeInfo = {
  dimensions: number;
  vectorCount: number;
};

export type VectorizeIndexConfiguration = {
  name: string;
  dimensions: number;
  metric: string;
};

export type VectorizeReadinessReport = {
  kind: typeof VECTORIZE_READINESS_EVIDENCE_KIND;
  createdAt: string;
  backupDir: string;
  mode: "remote-production-read-only";
  ok: true;
  workerName: typeof workerName;
  phase: ReleaseSequenceServingPhase;
  release: ReleaseSequenceIdentity;
  servingObservation: {
    soleServingVersionId: string;
    phaseEvidenceSha256: string;
    phaseEvidenceCreatedAt: string;
    observedBeforeAt: string;
    observedAfterAt: string;
  };
  vectorize: {
    binding: typeof VECTORIZE_READINESS_BINDING;
    indexName: typeof VECTORIZE_INDEX_NAME;
    dimensions: typeof VECTORIZE_READINESS_DIMENSIONS;
    metric: typeof VECTORIZE_READINESS_METRIC;
    vectorCount: number;
    metadataIndexes: VectorizeMetadataIndex[];
  };
  readOnly: {
    remoteQueries: typeof VECTORIZE_READINESS_REMOTE_QUERIES;
    mutationCommands: 0;
    commands: [...typeof VECTORIZE_READINESS_COMMANDS];
  };
};

export type VectorizeReadinessCurrentRelease = ReleaseSequenceCurrentRelease;

export function readConfiguredVectorizeBinding(cwd = process.cwd()) {
  const configPath = path.resolve(cwd, "wrangler.jsonc");
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Vectorize readiness requires a regular non-symlink wrangler.jsonc.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(fs.readFileSync(configPath, "utf8")));
  } catch {
    throw new Error("Vectorize readiness could not parse wrangler.jsonc.");
  }
  const config = recordValue(parsed, "Wrangler configuration");
  if (!Array.isArray(config.vectorize) || config.vectorize.length !== 1) {
    throw new Error("Vectorize readiness requires exactly one configured Vectorize binding.");
  }
  const binding = exactRecord(
    config.vectorize[0],
    ["binding", "index_name"],
    "Vectorize binding",
  );
  if (
    binding.binding !== VECTORIZE_READINESS_BINDING ||
    binding.index_name !== VECTORIZE_INDEX_NAME
  ) {
    throw new Error(
      `Vectorize readiness requires ${VECTORIZE_READINESS_BINDING} to bind exact index ${VECTORIZE_INDEX_NAME}.`,
    );
  }
  return {
    binding: VECTORIZE_READINESS_BINDING,
    indexName: VECTORIZE_INDEX_NAME,
  } as const;
}

export function parseVectorizeInfoOutput(output: string): VectorizeInfo {
  const value = boundedJson(output, "Vectorize info");
  const info = recordValue(value, "Vectorize info");
  const dimensions = nonNegativeSafeInteger(info.dimensions, "Vectorize dimensions");
  const vectorCount = positiveSafeInteger(info.vectorCount, "Vectorize vector count");
  if (dimensions !== VECTORIZE_READINESS_DIMENSIONS) {
    throw new Error(
      `Vectorize index dimensions differ: expected ${VECTORIZE_READINESS_DIMENSIONS}, received ${dimensions}.`,
    );
  }
  return { dimensions, vectorCount };
}

export function parseVectorizeIndexConfigurationOutput(
  output: string,
): VectorizeIndexConfiguration {
  const value = boundedJson(output, "Vectorize index configuration");
  const index = recordValue(value, "Vectorize index configuration");
  const config = recordValue(index.config, "Vectorize index immutable configuration");
  const name = requiredNonEmptyString(index.name, "Vectorize index name");
  const dimensions = nonNegativeSafeInteger(
    config.dimensions,
    "Vectorize configured dimensions",
  );
  const metric = requiredNonEmptyString(config.metric, "Vectorize distance metric");
  if (
    name !== VECTORIZE_INDEX_NAME ||
    dimensions !== VECTORIZE_READINESS_DIMENSIONS ||
    metric !== VECTORIZE_READINESS_METRIC
  ) {
    throw new Error(
      `Vectorize immutable configuration must be exact index ${VECTORIZE_INDEX_NAME}, ` +
        `${VECTORIZE_READINESS_DIMENSIONS} dimensions, and ${VECTORIZE_READINESS_METRIC} metric.`,
    );
  }
  return { name, dimensions, metric };
}

export function parseVectorizeMetadataIndexesOutput(output: string): VectorizeMetadataIndex[] {
  const value = boundedJson(output, "Vectorize metadata indexes");
  if (!Array.isArray(value)) {
    throw new Error("Vectorize metadata-index output must be a JSON array.");
  }
  const indexes = value.map((entry, index) => {
    const record = exactRecord(
      entry,
      ["indexType", "propertyName"],
      `Vectorize metadata index ${index + 1}`,
    );
    if (typeof record.propertyName !== "string" || typeof record.indexType !== "string") {
      throw new Error(`Vectorize metadata index ${index + 1} has an invalid contract.`);
    }
    return {
      propertyName: record.propertyName,
      indexType: record.indexType,
    };
  });
  indexes.sort(compareMetadataIndexes);
  if (!sameMetadataIndexes(indexes, VECTORIZE_READINESS_METADATA_INDEXES)) {
    throw new Error(
      "Vectorize metadata indexes must be exactly chatId:string and userId:string.",
    );
  }
  return indexes;
}

export function createVectorizeReadinessReport(input: {
  createdAt: string;
  backupDir: string;
  currentRelease: VectorizeReadinessCurrentRelease;
  servingObservation: { observedBeforeAt: string; observedAfterAt: string };
  vectorizeIndex: VectorizeIndexConfiguration;
  vectorizeInfo: VectorizeInfo;
  metadataIndexes: readonly VectorizeMetadataIndex[];
}): VectorizeReadinessReport {
  if (
    input.vectorizeIndex.name !== VECTORIZE_INDEX_NAME ||
    input.vectorizeIndex.dimensions !== VECTORIZE_READINESS_DIMENSIONS ||
    input.vectorizeIndex.metric !== VECTORIZE_READINESS_METRIC ||
    input.vectorizeInfo.dimensions !== VECTORIZE_READINESS_DIMENSIONS ||
    input.vectorizeInfo.dimensions !== input.vectorizeIndex.dimensions ||
    !Number.isSafeInteger(input.vectorizeInfo.vectorCount) ||
    input.vectorizeInfo.vectorCount <= 0
  ) {
    throw new Error(
      "Vectorize readiness cannot attest a mismatched, non-cosine, or empty observed index.",
    );
  }
  const report: VectorizeReadinessReport = {
    kind: VECTORIZE_READINESS_EVIDENCE_KIND,
    createdAt: input.createdAt,
    backupDir: path.resolve(input.backupDir),
    mode: "remote-production-read-only",
    ok: true,
    workerName,
    phase: input.currentRelease.phase,
    release: releaseSequenceIdentityFromCurrentRelease(input.currentRelease),
    servingObservation: {
      soleServingVersionId: input.currentRelease.soleServingVersionId,
      phaseEvidenceSha256: input.currentRelease.phaseEvidenceSha256,
      phaseEvidenceCreatedAt: input.currentRelease.phaseEvidenceCreatedAt,
      observedBeforeAt: input.servingObservation.observedBeforeAt,
      observedAfterAt: input.servingObservation.observedAfterAt,
    },
    vectorize: {
      binding: VECTORIZE_READINESS_BINDING,
      indexName: VECTORIZE_INDEX_NAME,
      dimensions: input.vectorizeIndex.dimensions,
      metric: input.vectorizeIndex.metric,
      vectorCount: input.vectorizeInfo.vectorCount,
      metadataIndexes: input.metadataIndexes.map((entry) => ({ ...entry })),
    },
    readOnly: {
      remoteQueries: VECTORIZE_READINESS_REMOTE_QUERIES,
      mutationCommands: 0,
      commands: [...VECTORIZE_READINESS_COMMANDS],
    },
  };
  return parseVectorizeReadinessReport(report);
}

export function writeVectorizeReadinessReport(
  report: VectorizeReadinessReport,
  backupDir: string,
) {
  const reportPath = vectorizeReadinessReportPath(backupDir);
  return writePrivateJsonDurably(reportPath, report, { replace: fs.existsSync(reportPath) });
}

export function assertFreshProductionVectorizeReadiness(input: {
  backupDir: string;
  currentRelease: VectorizeReadinessCurrentRelease;
  requiredPhase: ReleaseSequenceServingPhase;
  now?: Date;
}) {
  const report = assertProductionVectorizeReadinessReleaseBinding(input);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Vectorize readiness validation clock is invalid.");
  }
  const createdAt = Date.parse(report.createdAt);
  const ageMs = now.getTime() - createdAt;
  if (ageMs < 0 || ageMs > VECTORIZE_READINESS_MAX_AGE_MS) {
    throw new Error("Vectorize readiness evidence is stale or from the future.");
  }
  return report;
}

export function assertProductionVectorizeReadinessReleaseBinding(input: {
  backupDir: string;
  currentRelease: VectorizeReadinessCurrentRelease;
  requiredPhase: ReleaseSequenceServingPhase;
}) {
  const report = parseVectorizeReadinessReport(
    readPrivateJsonNoFollow(
      vectorizeReadinessReportPath(input.backupDir),
      VECTORIZE_READINESS_MAX_JSON_BYTES,
    ),
  );
  const current = assertReleaseSequenceCurrentReleaseBinding({
    backupDir: input.backupDir,
    currentRelease: input.currentRelease,
  });
  const mismatches: string[] = [];
  if (path.resolve(report.backupDir) !== path.resolve(input.backupDir)) {
    mismatches.push("backup directory");
  }
  if (
    report.phase !== input.requiredPhase ||
    current.currentRelease.phase !== input.requiredPhase
  ) {
    mismatches.push("required serving phase");
  }
  if (!sameReleaseIdentity(report.release, current.identity)) {
    mismatches.push("immutable candidate release identity");
  }
  if (
    report.servingObservation.soleServingVersionId !==
      current.currentRelease.soleServingVersionId ||
    report.servingObservation.phaseEvidenceSha256 !==
      current.currentRelease.phaseEvidenceSha256 ||
    report.servingObservation.phaseEvidenceCreatedAt !==
      current.currentRelease.phaseEvidenceCreatedAt
  ) {
    mismatches.push("phase evidence or sole-serving Worker version");
  }
  if (mismatches.length) {
    throw new Error(`Vectorize readiness evidence does not authorize this release: ${mismatches.join(", ")}.`);
  }
  return report;
}

function parseVectorizeReadinessReport(value: unknown): VectorizeReadinessReport {
  const report = exactRecord(
    value,
    [
      "backupDir",
      "createdAt",
      "kind",
      "mode",
      "ok",
      "phase",
      "readOnly",
      "release",
      "servingObservation",
      "vectorize",
      "workerName",
    ],
    "Vectorize readiness evidence",
  );
  const servingObservation = exactRecord(
    report.servingObservation,
    [
      "observedAfterAt",
      "observedBeforeAt",
      "phaseEvidenceCreatedAt",
      "phaseEvidenceSha256",
      "soleServingVersionId",
    ],
    "Vectorize serving observation",
  );
  const vectorize = exactRecord(
    report.vectorize,
    ["binding", "dimensions", "indexName", "metadataIndexes", "metric", "vectorCount"],
    "Vectorize remote evidence",
  );
  const readOnly = exactRecord(
    report.readOnly,
    ["commands", "mutationCommands", "remoteQueries"],
    "Vectorize read-only evidence",
  );

  const createdAt = requiredIsoTimestamp(report.createdAt, "Vectorize readiness createdAt");
  const phase = requiredServingPhase(report.phase);
  const release = parseReleaseSequenceIdentity(report.release);
  const soleServingVersionId = requiredWorkerVersion(
    servingObservation.soleServingVersionId,
    "Vectorize sole-serving Worker version",
  );
  const phaseEvidenceSha256 = requiredSha256(
    servingObservation.phaseEvidenceSha256,
    "Vectorize phase evidence hash",
  );
  const phaseEvidenceCreatedAt = requiredIsoTimestamp(
    servingObservation.phaseEvidenceCreatedAt,
    "Vectorize phase evidence timestamp",
  );
  const observedBeforeAt = requiredIsoTimestamp(
    servingObservation.observedBeforeAt,
    "Vectorize first serving observation",
  );
  const observedAfterAt = requiredIsoTimestamp(
    servingObservation.observedAfterAt,
    "Vectorize final serving observation",
  );
  if (
    Date.parse(phaseEvidenceCreatedAt) > Date.parse(observedBeforeAt) ||
    Date.parse(observedBeforeAt) > Date.parse(observedAfterAt) ||
    Date.parse(observedAfterAt) > Date.parse(createdAt)
  ) {
    throw new Error("Vectorize readiness timestamps are not in causal order.");
  }
  const expectedServingVersionId =
    phase === "uploaded-inactive"
      ? release.serviceBaselineVersionId
      : release.targetCandidateVersionId;
  if (soleServingVersionId !== expectedServingVersionId) {
    throw new Error("Vectorize readiness has the wrong phase-specific serving version.");
  }
  if (
    phase === "uploaded-inactive" &&
    phaseEvidenceSha256 !== release.uploadEvidenceSha256
  ) {
    throw new Error(
      "Uploaded-inactive Vectorize readiness must use immutable upload evidence as phase evidence.",
    );
  }

  if (!Array.isArray(vectorize.metadataIndexes)) {
    throw new Error("Vectorize readiness metadata indexes are malformed.");
  }
  const metadataIndexes = vectorize.metadataIndexes.map((entry, index) => {
    const parsed = exactRecord(
      entry,
      ["indexType", "propertyName"],
      `Vectorize readiness metadata index ${index + 1}`,
    );
    return {
      propertyName: requiredNonEmptyString(parsed.propertyName, "metadata property name"),
      indexType: requiredNonEmptyString(parsed.indexType, "metadata index type"),
    };
  }).sort(compareMetadataIndexes);
  if (!sameMetadataIndexes(metadataIndexes, VECTORIZE_READINESS_METADATA_INDEXES)) {
    throw new Error("Vectorize readiness evidence has the wrong metadata indexes.");
  }
  if (
    report.kind !== VECTORIZE_READINESS_EVIDENCE_KIND ||
    report.mode !== "remote-production-read-only" ||
    report.ok !== true ||
    report.workerName !== workerName ||
    vectorize.binding !== VECTORIZE_READINESS_BINDING ||
    vectorize.indexName !== VECTORIZE_INDEX_NAME ||
    vectorize.dimensions !== VECTORIZE_READINESS_DIMENSIONS ||
    vectorize.metric !== VECTORIZE_READINESS_METRIC ||
    readOnly.remoteQueries !== VECTORIZE_READINESS_REMOTE_QUERIES ||
    readOnly.mutationCommands !== 0 ||
    !sameStringSequence(readOnly.commands, VECTORIZE_READINESS_COMMANDS)
  ) {
    throw new Error("Vectorize readiness evidence has the wrong production contract.");
  }

  return {
    kind: VECTORIZE_READINESS_EVIDENCE_KIND,
    createdAt,
    backupDir: requiredAbsolutePath(report.backupDir, "Vectorize backup directory"),
    mode: "remote-production-read-only",
    ok: true,
    workerName,
    phase,
    release,
    servingObservation: {
      soleServingVersionId,
      phaseEvidenceSha256,
      phaseEvidenceCreatedAt,
      observedBeforeAt,
      observedAfterAt,
    },
    vectorize: {
      binding: VECTORIZE_READINESS_BINDING,
      indexName: VECTORIZE_INDEX_NAME,
      dimensions: VECTORIZE_READINESS_DIMENSIONS,
      metric: VECTORIZE_READINESS_METRIC,
      vectorCount: positiveSafeInteger(vectorize.vectorCount, "Vectorize vector count"),
      metadataIndexes,
    },
    readOnly: {
      remoteQueries: VECTORIZE_READINESS_REMOTE_QUERIES,
      mutationCommands: 0,
      commands: [...VECTORIZE_READINESS_COMMANDS],
    },
  };
}

export function vectorizeReadinessReportPath(backupDir: string) {
  return path.join(cloudflareDir(path.resolve(backupDir)), path.basename(VECTORIZE_READINESS_REPORT));
}

function boundedJson(output: string, label: string): unknown {
  if (
    typeof output !== "string" ||
    Buffer.byteLength(output, "utf8") === 0 ||
    Buffer.byteLength(output, "utf8") > VECTORIZE_READINESS_MAX_JSON_BYTES
  ) {
    throw new Error(`${label} output is empty or exceeds the bounded JSON limit.`);
  }
  try {
    const parsed: unknown = JSON.parse(output.trim());
    return parsed;
  } catch {
    throw new Error(`${label} output is not exact JSON.`);
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  return record;
}

function exactRecord(value: unknown, keys: readonly string[], label: string) {
  const record = recordValue(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (!sameStringSequence(actual, expected)) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
  return record;
}

function requiredNonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string" || !value || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function requiredWorkerVersion(value: unknown, label: string) {
  const version = requiredNonEmptyString(value, label);
  if (!workerVersionPattern.test(version)) throw new Error(`${label} must be a lowercase Worker UUID.`);
  return version;
}

function requiredSha256(value: unknown, label: string) {
  const hash = requiredNonEmptyString(value, label);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`${label} must be a lowercase SHA-256 hash.`);
  return hash;
}

function requiredIsoTimestamp(value: unknown, label: string) {
  const timestamp = requiredNonEmptyString(value, label);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw new Error(`${label} must be an exact ISO timestamp.`);
  }
  return timestamp;
}

function requiredAbsolutePath(value: unknown, label: string) {
  const filePath = requiredNonEmptyString(value, label);
  if (!path.isAbsolute(filePath)) throw new Error(`${label} must be absolute.`);
  return filePath;
}

function nonNegativeSafeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, label: string) {
  const integer = nonNegativeSafeInteger(value, label);
  if (integer === 0) throw new Error(`${label} must be a positive safe integer.`);
  return integer;
}

function compareMetadataIndexes(left: VectorizeMetadataIndex, right: VectorizeMetadataIndex) {
  const propertyOrder = left.propertyName.localeCompare(right.propertyName);
  return propertyOrder === 0 ? left.indexType.localeCompare(right.indexType) : propertyOrder;
}

function sameMetadataIndexes(
  actual: readonly VectorizeMetadataIndex[],
  expected: readonly VectorizeMetadataIndex[],
) {
  return actual.length === expected.length && expected.every((entry, index) =>
    actual[index]?.propertyName === entry.propertyName &&
    actual[index]?.indexType === entry.indexType
  );
}

function sameReleaseIdentity(
  left: ReleaseSequenceIdentity,
  right: ReleaseSequenceIdentity,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requiredServingPhase(value: unknown): ReleaseSequenceServingPhase {
  if (value !== "uploaded-inactive" && value !== "candidate-active") {
    throw new Error("Vectorize readiness serving phase must be explicit.");
  }
  return value;
}

function sameStringSequence(value: unknown, expected: readonly string[]) {
  return Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((entry, index) => value[index] === entry);
}

function stripJsonComments(input: string) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    const next = input[index + 1];
    if (inLineComment) {
      if (character === "\n" || character === "\r") {
        inLineComment = false;
        output += character;
      }
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === "/" && next === "/") {
      inLineComment = true;
      index += 1;
    } else if (character === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
    } else {
      output += character;
    }
  }
  if (inString || inBlockComment) throw new Error("Wrangler JSONC is unterminated.");
  return output;
}
