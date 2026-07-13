import fs from "node:fs";
import path from "node:path";
import {
  readPrivateJsonNoFollow,
  writePrivateJsonDurably,
} from "./d1-release-budget-ledger";
import type { GitReleaseIdentity } from "./git-release-identity";
import {
  cloudflareDir,
  VECTORIZE_INDEX_NAME,
} from "./migration-config";
import type { WorkerDeployArtifactEvidence } from "./worker-deploy-evidence";

const VECTORIZE_READINESS_REPORT = "cloudflare/vectorize-readiness-report.json";
const VECTORIZE_READINESS_EVIDENCE_KIND = "vectorize-readiness-v1" as const;
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
const gitObjectPattern = /^[0-9a-f]{40,64}$/;

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
  candidateVersionId: string;
  activeVersionId: string;
  git: GitReleaseIdentity;
  artifactEvidence: {
    sourceFingerprintSha256: string;
    sourceFingerprintFileCount: number;
    workerSourceSha256: string;
    wranglerConfigSha256: string;
    assetManifestSha256: string;
    assetManifestFileCount: number;
    assetManifestBytes: number;
  };
  deployEvidence: {
    createdAt: string;
    activeDeploymentReadAt: string;
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

export type VectorizeReadinessCurrentRelease = {
  candidateVersionId: string;
  activeVersionId: string;
  git: GitReleaseIdentity;
  artifactEvidence: WorkerDeployArtifactEvidence;
};

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
  deployEvidence: { createdAt: string; activeDeploymentReadAt: string };
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
    candidateVersionId: input.currentRelease.candidateVersionId,
    activeVersionId: input.currentRelease.activeVersionId,
    git: input.currentRelease.git,
    artifactEvidence: summarizeArtifactEvidence(input.currentRelease.artifactEvidence),
    deployEvidence: input.deployEvidence,
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
}) {
  const report = parseVectorizeReadinessReport(
    readPrivateJsonNoFollow(
      vectorizeReadinessReportPath(input.backupDir),
      VECTORIZE_READINESS_MAX_JSON_BYTES,
    ),
  );
  const current = input.currentRelease;
  const expectedArtifacts = summarizeArtifactEvidence(current.artifactEvidence);
  const mismatches: string[] = [];
  if (path.resolve(report.backupDir) !== path.resolve(input.backupDir)) {
    mismatches.push("backup directory");
  }
  if (
    report.candidateVersionId !== current.candidateVersionId ||
    report.activeVersionId !== current.candidateVersionId ||
    current.activeVersionId !== current.candidateVersionId
  ) {
    mismatches.push("candidate or active Worker version");
  }
  if (!sameGitIdentity(report.git, current.git)) mismatches.push("clean pushed Git identity");
  if (!sameArtifactSummary(report.artifactEvidence, expectedArtifacts)) {
    mismatches.push("source or immutable Worker artifacts");
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
      "activeVersionId",
      "artifactEvidence",
      "backupDir",
      "candidateVersionId",
      "createdAt",
      "deployEvidence",
      "git",
      "kind",
      "mode",
      "ok",
      "readOnly",
      "vectorize",
      "workerName",
    ],
    "Vectorize readiness evidence",
  );
  const git = exactRecord(report.git, ["head", "upstream", "upstreamRef"], "Vectorize Git evidence");
  const artifacts = exactRecord(
    report.artifactEvidence,
    [
      "assetManifestBytes",
      "assetManifestFileCount",
      "assetManifestSha256",
      "sourceFingerprintFileCount",
      "sourceFingerprintSha256",
      "workerSourceSha256",
      "wranglerConfigSha256",
    ],
    "Vectorize artifact evidence",
  );
  const deploy = exactRecord(
    report.deployEvidence,
    ["activeDeploymentReadAt", "createdAt"],
    "Vectorize deploy evidence",
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
  const candidateVersionId = requiredWorkerVersion(report.candidateVersionId, "Vectorize candidate");
  const activeVersionId = requiredWorkerVersion(report.activeVersionId, "Vectorize active version");
  const parsedGit = {
    head: requiredGitObject(git.head, "Vectorize Git HEAD"),
    upstream: requiredGitObject(git.upstream, "Vectorize Git upstream"),
    upstreamRef: requiredNonEmptyString(git.upstreamRef, "Vectorize Git upstream ref"),
  };
  if (parsedGit.head !== parsedGit.upstream) {
    throw new Error("Vectorize readiness Git HEAD does not equal its pushed upstream.");
  }
  const deployCreatedAt = requiredIsoTimestamp(
    deploy.createdAt,
    "Worker deploy evidence createdAt",
  );
  const activeDeploymentReadAt = requiredIsoTimestamp(
    deploy.activeDeploymentReadAt,
    "Worker deploy active readback",
  );
  if (
    Date.parse(activeDeploymentReadAt) > Date.parse(deployCreatedAt) ||
    Date.parse(deployCreatedAt) > Date.parse(createdAt)
  ) {
    throw new Error("Vectorize readiness timestamps are not in causal order.");
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
    candidateVersionId !== activeVersionId ||
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
    candidateVersionId,
    activeVersionId,
    git: parsedGit,
    artifactEvidence: {
      sourceFingerprintSha256: requiredSha256(artifacts.sourceFingerprintSha256, "source fingerprint"),
      sourceFingerprintFileCount: nonNegativeSafeInteger(
        artifacts.sourceFingerprintFileCount,
        "source fingerprint file count",
      ),
      workerSourceSha256: requiredSha256(artifacts.workerSourceSha256, "Worker source hash"),
      wranglerConfigSha256: requiredSha256(artifacts.wranglerConfigSha256, "Wrangler config hash"),
      assetManifestSha256: requiredSha256(artifacts.assetManifestSha256, "Static Assets hash"),
      assetManifestFileCount: nonNegativeSafeInteger(
        artifacts.assetManifestFileCount,
        "Static Assets file count",
      ),
      assetManifestBytes: nonNegativeSafeInteger(artifacts.assetManifestBytes, "Static Assets bytes"),
    },
    deployEvidence: {
      createdAt: deployCreatedAt,
      activeDeploymentReadAt,
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

function summarizeArtifactEvidence(evidence: WorkerDeployArtifactEvidence) {
  return {
    sourceFingerprintSha256: evidence.sourceFingerprint.sha256,
    sourceFingerprintFileCount: evidence.sourceFingerprint.fileCount,
    workerSourceSha256: evidence.workerSourceSha256,
    wranglerConfigSha256: evidence.wranglerConfigSha256,
    assetManifestSha256: evidence.assetManifest.sha256,
    assetManifestFileCount: evidence.assetManifest.fileCount,
    assetManifestBytes: evidence.assetManifest.bytes,
  };
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

function requiredGitObject(value: unknown, label: string) {
  const objectId = requiredNonEmptyString(value, label);
  if (!gitObjectPattern.test(objectId)) throw new Error(`${label} must be an exact lowercase Git object ID.`);
  return objectId;
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

function sameGitIdentity(left: GitReleaseIdentity, right: GitReleaseIdentity) {
  return left.head === right.head && left.upstream === right.upstream && left.upstreamRef === right.upstreamRef;
}

function sameArtifactSummary(
  left: VectorizeReadinessReport["artifactEvidence"],
  right: VectorizeReadinessReport["artifactEvidence"],
) {
  return left.sourceFingerprintSha256 === right.sourceFingerprintSha256 &&
    left.sourceFingerprintFileCount === right.sourceFingerprintFileCount &&
    left.workerSourceSha256 === right.workerSourceSha256 &&
    left.wranglerConfigSha256 === right.wranglerConfigSha256 &&
    left.assetManifestSha256 === right.assetManifestSha256 &&
    left.assetManifestFileCount === right.assetManifestFileCount &&
    left.assetManifestBytes === right.assetManifestBytes;
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
