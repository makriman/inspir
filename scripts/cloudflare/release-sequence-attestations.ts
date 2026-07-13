import fs from "node:fs";
import path from "node:path";
import {
  readPrivateJsonNoFollow,
  writePrivateJsonDurably,
} from "./d1-release-budget-ledger";
import type { GitReleaseIdentity } from "./git-release-identity";
import { cloudflareDir } from "./migration-config";
import type { WorkerDeployArtifactEvidence } from "./worker-deploy-evidence";
import type {
  VectorizeReadinessCurrentRelease,
  VectorizeReadinessReport,
} from "./vectorize-readiness-evidence";

const TOPIC_RECONCILIATION_ATTESTATION =
  "cloudflare/topic-reconciliation-attestation.json";
const TRANSLATION_RECONCILIATION_ATTESTATION =
  "cloudflare/translation-reconciliation-attestation.json";
const TRANSLATION_RECONCILIATION_MAX_AGE_MS = 30 * 60 * 1_000;

const topicKind = "production-topic-reconciliation-v1" as const;
const translationKind = "production-translation-reconciliation-v1" as const;
const maximumEvidenceBytes = 64 * 1_024;
const workerVersionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const gitObjectPattern = /^[0-9a-f]{40,64}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export type ReleaseSequenceArtifactSummary = {
  sourceFingerprintSha256: string;
  sourceFingerprintFileCount: number;
  workerSourceSha256: string;
  wranglerConfigSha256: string;
  assetManifestSha256: string;
  assetManifestFileCount: number;
  assetManifestBytes: number;
};

export type ReleaseSequenceIdentity = {
  candidateVersionId: string;
  activeVersionId: string;
  git: GitReleaseIdentity;
  artifactEvidence: ReleaseSequenceArtifactSummary;
};

export type TopicReconciliationAttestation = {
  kind: typeof topicKind;
  createdAt: string;
  backupDir: string;
  status: "reconciled";
  ok: true;
  release: ReleaseSequenceIdentity;
  vectorizeReadinessCreatedAt: string;
  topic: {
    seedSha256: string;
    verifiedTopics: number;
    verifiedArchivedTopics: number;
  };
};

export type TranslationReconciliationMethod = "read-only-drift" | "atomic-repair";

export type TranslationReconciliationAttestation = {
  kind: typeof translationKind;
  createdAt: string;
  backupDir: string;
  status: "checking" | "reconciled";
  ok: boolean;
  release: ReleaseSequenceIdentity;
  vectorizeReadinessCreatedAt: string;
  topicReconciliationCreatedAt: string;
  method: TranslationReconciliationMethod;
  verification: null | {
    remoteQueries: number;
    billedRowsRead: number;
    repairApplied: boolean;
  };
};

export function releaseSequenceIdentityFromCurrentRelease(
  current: VectorizeReadinessCurrentRelease,
): ReleaseSequenceIdentity {
  return parseReleaseIdentity({
    candidateVersionId: current.candidateVersionId,
    activeVersionId: current.activeVersionId,
    git: current.git,
    artifactEvidence: summarizeArtifacts(current.artifactEvidence),
  });
}

export function createTopicReconciliationAttestation(input: {
  createdAt: string;
  backupDir: string;
  release: ReleaseSequenceIdentity;
  vectorizeReadinessCreatedAt: string;
  seedSha256: string;
  verifiedTopics: number;
  verifiedArchivedTopics: number;
}) {
  return parseTopicReconciliationAttestation({
    kind: topicKind,
    createdAt: input.createdAt,
    backupDir: path.resolve(input.backupDir),
    status: "reconciled",
    ok: true,
    release: input.release,
    vectorizeReadinessCreatedAt: input.vectorizeReadinessCreatedAt,
    topic: {
      seedSha256: input.seedSha256,
      verifiedTopics: input.verifiedTopics,
      verifiedArchivedTopics: input.verifiedArchivedTopics,
    },
  });
}

export function writeTopicReconciliationAttestation(
  report: TopicReconciliationAttestation,
  backupDir: string,
) {
  return writeAttestation(topicAttestationPath(backupDir), report);
}

export function assertProductionTopicReconciliationReleaseBinding(input: {
  backupDir: string;
  currentRelease: VectorizeReadinessCurrentRelease;
}) {
  const report = parseTopicReconciliationAttestation(
    readPrivateJsonNoFollow(topicAttestationPath(input.backupDir), maximumEvidenceBytes),
  );
  assertBackupAndReleaseBinding(
    report.backupDir,
    report.release,
    input.backupDir,
    input.currentRelease,
    "Topic reconciliation",
  );
  return report;
}

export function writeTranslationReconciliationPending(input: {
  createdAt: string;
  backupDir: string;
  currentRelease: VectorizeReadinessCurrentRelease;
  vectorizeReadiness: Pick<VectorizeReadinessReport, "createdAt">;
  topicAttestation: Pick<
    TopicReconciliationAttestation,
    "createdAt" | "vectorizeReadinessCreatedAt"
  >;
  method: TranslationReconciliationMethod;
}) {
  const vectorizeReadinessCreatedAt = translationVectorPredecessorTimestamp(input);
  const report = parseTranslationReconciliationAttestation({
    kind: translationKind,
    createdAt: input.createdAt,
    backupDir: path.resolve(input.backupDir),
    status: "checking",
    ok: false,
    release: releaseSequenceIdentityFromCurrentRelease(input.currentRelease),
    vectorizeReadinessCreatedAt,
    topicReconciliationCreatedAt: input.topicAttestation.createdAt,
    method: input.method,
    verification: null,
  });
  writeAttestation(translationAttestationPath(input.backupDir), report);
  return report;
}

export function writeTranslationReconciliationSuccess(input: {
  createdAt: string;
  backupDir: string;
  currentRelease: VectorizeReadinessCurrentRelease;
  vectorizeReadiness: Pick<VectorizeReadinessReport, "createdAt">;
  topicAttestation: Pick<
    TopicReconciliationAttestation,
    "createdAt" | "vectorizeReadinessCreatedAt"
  >;
  method: TranslationReconciliationMethod;
  remoteQueries: number;
  billedRowsRead: number;
}) {
  const vectorizeReadinessCreatedAt = translationVectorPredecessorTimestamp(input);
  const report = parseTranslationReconciliationAttestation({
    kind: translationKind,
    createdAt: input.createdAt,
    backupDir: path.resolve(input.backupDir),
    status: "reconciled",
    ok: true,
    release: releaseSequenceIdentityFromCurrentRelease(input.currentRelease),
    vectorizeReadinessCreatedAt,
    topicReconciliationCreatedAt: input.topicAttestation.createdAt,
    method: input.method,
    verification: {
      remoteQueries: input.remoteQueries,
      billedRowsRead: input.billedRowsRead,
      repairApplied: input.method === "atomic-repair",
    },
  });
  writeAttestation(translationAttestationPath(input.backupDir), report);
  return report;
}

export function assertProductionTranslationReconciliationReleaseBinding(input: {
  backupDir: string;
  currentRelease: VectorizeReadinessCurrentRelease;
}) {
  const topic = assertProductionTopicReconciliationReleaseBinding(input);
  const report = parseTranslationReconciliationAttestation(
    readPrivateJsonNoFollow(translationAttestationPath(input.backupDir), maximumEvidenceBytes),
  );
  assertBackupAndReleaseBinding(
    report.backupDir,
    report.release,
    input.backupDir,
    input.currentRelease,
    "Translation reconciliation",
  );
  if (
    report.status !== "reconciled" ||
    report.ok !== true ||
    report.verification === null ||
    report.topicReconciliationCreatedAt !== topic.createdAt
  ) {
    throw new Error(
      "Translation reconciliation evidence is incomplete or does not follow the current topic reconciliation.",
    );
  }
  return report;
}

export function assertFreshProductionTranslationReconciliation(input: {
  backupDir: string;
  currentRelease: VectorizeReadinessCurrentRelease;
  now?: Date;
}) {
  const report = assertProductionTranslationReconciliationReleaseBinding(input);
  const now = validDate(input.now ?? new Date(), "translation reconciliation validation clock");
  const ageMs = now.getTime() - Date.parse(report.createdAt);
  if (ageMs < 0 || ageMs > TRANSLATION_RECONCILIATION_MAX_AGE_MS) {
    throw new Error("Translation reconciliation evidence is stale or from the future.");
  }
  return report;
}

function parseTopicReconciliationAttestation(
  value: unknown,
): TopicReconciliationAttestation {
  const report = exactRecord(
    value,
    ["backupDir", "createdAt", "kind", "ok", "release", "status", "topic", "vectorizeReadinessCreatedAt"],
    "Topic reconciliation evidence",
  );
  const topic = exactRecord(
    report.topic,
    ["seedSha256", "verifiedArchivedTopics", "verifiedTopics"],
    "Topic reconciliation result",
  );
  const createdAt = exactIsoTimestamp(report.createdAt, "topic reconciliation createdAt");
  const vectorizeReadinessCreatedAt = exactIsoTimestamp(
    report.vectorizeReadinessCreatedAt,
    "topic Vectorize readiness timestamp",
  );
  if (
    report.kind !== topicKind ||
    report.status !== "reconciled" ||
    report.ok !== true ||
    Date.parse(vectorizeReadinessCreatedAt) > Date.parse(createdAt)
  ) {
    throw new Error("Topic reconciliation evidence has the wrong successful release contract.");
  }
  return {
    kind: topicKind,
    createdAt,
    backupDir: absolutePath(report.backupDir, "topic reconciliation backup directory"),
    status: "reconciled",
    ok: true,
    release: parseReleaseIdentity(report.release),
    vectorizeReadinessCreatedAt,
    topic: {
      seedSha256: sha256(topic.seedSha256, "topic seed hash"),
      verifiedTopics: positiveSafeInteger(topic.verifiedTopics, "verified topics"),
      verifiedArchivedTopics: nonNegativeSafeInteger(
        topic.verifiedArchivedTopics,
        "verified archived topics",
      ),
    },
  };
}

function parseTranslationReconciliationAttestation(
  value: unknown,
): TranslationReconciliationAttestation {
  const report = exactRecord(
    value,
    [
      "backupDir",
      "createdAt",
      "kind",
      "method",
      "ok",
      "release",
      "status",
      "topicReconciliationCreatedAt",
      "vectorizeReadinessCreatedAt",
      "verification",
    ],
    "Translation reconciliation evidence",
  );
  const createdAt = exactIsoTimestamp(report.createdAt, "translation reconciliation createdAt");
  const vectorizeReadinessCreatedAt = exactIsoTimestamp(
    report.vectorizeReadinessCreatedAt,
    "translation Vectorize readiness timestamp",
  );
  const topicReconciliationCreatedAt = exactIsoTimestamp(
    report.topicReconciliationCreatedAt,
    "translation topic reconciliation timestamp",
  );
  const method = translationMethod(report.method);
  const status = report.status;
  let verification: TranslationReconciliationAttestation["verification"] = null;
  if (status === "checking") {
    if (report.ok !== false || report.verification !== null) {
      throw new Error("Checking translation reconciliation evidence cannot authorize a release.");
    }
  } else if (status === "reconciled") {
    if (report.ok !== true) {
      throw new Error("Reconciled translation evidence must be successful.");
    }
    const checked = exactRecord(
      report.verification,
      ["billedRowsRead", "remoteQueries", "repairApplied"],
      "Translation reconciliation verification",
    );
    verification = {
      remoteQueries: positiveSafeInteger(checked.remoteQueries, "translation remote queries"),
      billedRowsRead: nonNegativeSafeInteger(
        checked.billedRowsRead,
        "translation billed rows read",
      ),
      repairApplied: requiredBoolean(checked.repairApplied, "translation repair applied"),
    };
    if (verification.repairApplied !== (method === "atomic-repair")) {
      throw new Error("Translation reconciliation method and repair proof disagree.");
    }
  } else {
    throw new Error("Translation reconciliation evidence has an unknown status.");
  }
  if (
    report.kind !== translationKind ||
    Date.parse(vectorizeReadinessCreatedAt) > Date.parse(topicReconciliationCreatedAt) ||
    Date.parse(vectorizeReadinessCreatedAt) > Date.parse(createdAt) ||
    Date.parse(topicReconciliationCreatedAt) > Date.parse(createdAt)
  ) {
    throw new Error("Translation reconciliation evidence has the wrong release contract.");
  }
  return {
    kind: translationKind,
    createdAt,
    backupDir: absolutePath(report.backupDir, "translation reconciliation backup directory"),
    status,
    ok: status === "reconciled",
    release: parseReleaseIdentity(report.release),
    vectorizeReadinessCreatedAt,
    topicReconciliationCreatedAt,
    method,
    verification,
  };
}

export function topicAttestationPath(backupDir: string) {
  return path.join(cloudflareDir(path.resolve(backupDir)), path.basename(TOPIC_RECONCILIATION_ATTESTATION));
}

export function translationAttestationPath(backupDir: string) {
  return path.join(
    cloudflareDir(path.resolve(backupDir)),
    path.basename(TRANSLATION_RECONCILIATION_ATTESTATION),
  );
}

function writeAttestation(file: string, value: unknown) {
  return writePrivateJsonDurably(file, value, { replace: fs.existsSync(file) });
}

function translationVectorPredecessorTimestamp(input: {
  createdAt: string;
  vectorizeReadiness: Pick<VectorizeReadinessReport, "createdAt">;
  topicAttestation: Pick<
    TopicReconciliationAttestation,
    "createdAt" | "vectorizeReadinessCreatedAt"
  >;
}) {
  const createdAt = exactIsoTimestamp(input.createdAt, "translation attestation timestamp");
  const currentVectorizeCreatedAt = exactIsoTimestamp(
    input.vectorizeReadiness.createdAt,
    "current Vectorize readiness timestamp",
  );
  const predecessorVectorizeCreatedAt = exactIsoTimestamp(
    input.topicAttestation.vectorizeReadinessCreatedAt,
    "topic predecessor Vectorize readiness timestamp",
  );
  const topicCreatedAt = exactIsoTimestamp(
    input.topicAttestation.createdAt,
    "topic reconciliation timestamp",
  );
  if (
    Date.parse(predecessorVectorizeCreatedAt) > Date.parse(topicCreatedAt) ||
    Date.parse(topicCreatedAt) > Date.parse(createdAt) ||
    Date.parse(currentVectorizeCreatedAt) < Date.parse(predecessorVectorizeCreatedAt) ||
    Date.parse(currentVectorizeCreatedAt) > Date.parse(createdAt)
  ) {
    throw new Error("Translation reconciliation predecessors are not in causal order.");
  }
  return predecessorVectorizeCreatedAt;
}

function assertBackupAndReleaseBinding(
  reportBackupDir: string,
  reportRelease: ReleaseSequenceIdentity,
  backupDir: string,
  current: VectorizeReadinessCurrentRelease,
  label: string,
) {
  const expected = releaseSequenceIdentityFromCurrentRelease(current);
  if (
    path.resolve(reportBackupDir) !== path.resolve(backupDir) ||
    !sameReleaseIdentity(reportRelease, expected)
  ) {
    throw new Error(`${label} evidence does not authorize this exact candidate and source.`);
  }
}

function parseReleaseIdentity(value: unknown): ReleaseSequenceIdentity {
  const release = exactRecord(
    value,
    ["activeVersionId", "artifactEvidence", "candidateVersionId", "git"],
    "Release-sequence identity",
  );
  const git = exactRecord(release.git, ["head", "upstream", "upstreamRef"], "Release Git identity");
  const artifacts = exactRecord(
    release.artifactEvidence,
    [
      "assetManifestBytes",
      "assetManifestFileCount",
      "assetManifestSha256",
      "sourceFingerprintFileCount",
      "sourceFingerprintSha256",
      "workerSourceSha256",
      "wranglerConfigSha256",
    ],
    "Release artifact identity",
  );
  const candidateVersionId = workerVersion(release.candidateVersionId, "release candidate version");
  const activeVersionId = workerVersion(release.activeVersionId, "release active version");
  const parsedGit = {
    head: gitObject(git.head, "release Git HEAD"),
    upstream: gitObject(git.upstream, "release Git upstream"),
    upstreamRef: boundedString(git.upstreamRef, "release Git upstream ref"),
  };
  if (candidateVersionId !== activeVersionId || parsedGit.head !== parsedGit.upstream) {
    throw new Error("Release-sequence identity is not the clean pushed active candidate.");
  }
  return {
    candidateVersionId,
    activeVersionId,
    git: parsedGit,
    artifactEvidence: {
      sourceFingerprintSha256: sha256(artifacts.sourceFingerprintSha256, "source fingerprint"),
      sourceFingerprintFileCount: nonNegativeSafeInteger(
        artifacts.sourceFingerprintFileCount,
        "source file count",
      ),
      workerSourceSha256: sha256(artifacts.workerSourceSha256, "Worker source hash"),
      wranglerConfigSha256: sha256(artifacts.wranglerConfigSha256, "Wrangler config hash"),
      assetManifestSha256: sha256(artifacts.assetManifestSha256, "Static Assets hash"),
      assetManifestFileCount: nonNegativeSafeInteger(
        artifacts.assetManifestFileCount,
        "Static Assets file count",
      ),
      assetManifestBytes: nonNegativeSafeInteger(
        artifacts.assetManifestBytes,
        "Static Assets bytes",
      ),
    },
  };
}

function summarizeArtifacts(evidence: WorkerDeployArtifactEvidence): ReleaseSequenceArtifactSummary {
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

function sameReleaseIdentity(left: ReleaseSequenceIdentity, right: ReleaseSequenceIdentity) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || expected.some((entry, index) => actual[index] !== entry)) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
  return record;
}

function boundedString(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2_048 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function workerVersion(value: unknown, label: string) {
  const version = boundedString(value, label);
  if (!workerVersionPattern.test(version)) throw new Error(`${label} must be a lowercase Worker UUID.`);
  return version;
}

function gitObject(value: unknown, label: string) {
  const objectId = boundedString(value, label);
  if (!gitObjectPattern.test(objectId)) throw new Error(`${label} must be a lowercase Git object ID.`);
  return objectId;
}

function sha256(value: unknown, label: string) {
  const hash = boundedString(value, label);
  if (!sha256Pattern.test(hash)) throw new Error(`${label} must be a lowercase SHA-256 hash.`);
  return hash;
}

function exactIsoTimestamp(value: unknown, label: string) {
  const timestamp = boundedString(value, label);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw new Error(`${label} must be an exact ISO timestamp.`);
  }
  return timestamp;
}

function absolutePath(value: unknown, label: string) {
  const filePath = boundedString(value, label);
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
  if (integer === 0) throw new Error(`${label} must be positive.`);
  return integer;
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function translationMethod(value: unknown): TranslationReconciliationMethod {
  if (value !== "read-only-drift" && value !== "atomic-repair") {
    throw new Error("Translation reconciliation method is invalid.");
  }
  return value;
}

function validDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
