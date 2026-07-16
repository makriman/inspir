import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  assertFileBackedWorkerCandidatePreActivationSealHandle,
  workerCandidatePreActivationSealPath,
  type WorkerCandidatePreActivationSealHandle,
} from "./worker-candidate-pre-activation-seal-file";

export const WORKER_CANDIDATE_WORKER_NAME = "inspirlearning" as const;
const WORKER_CANDIDATE_UPLOAD_REPORT =
  "cloudflare/worker-candidate-upload-report.json" as const;
const WORKER_CANDIDATE_STAGED_REPORT =
  "cloudflare/worker-candidate-staged-report.json" as const;
const WORKER_CANDIDATE_ACTIVATION_REPORT =
  "cloudflare/worker-candidate-activation-report.json" as const;

export const WORKER_CANDIDATE_UPLOAD_EVIDENCE_KIND =
  "inspir-worker-candidate-upload-v1" as const;
export const WORKER_CANDIDATE_STAGED_EVIDENCE_KIND =
  "inspir-worker-candidate-staged-v2" as const;
export const WORKER_CANDIDATE_ACTIVATION_EVIDENCE_KIND =
  "inspir-worker-candidate-activation-v1" as const;

const MAXIMUM_WRANGLER_OUTPUT_BYTES = 64 * 1024;
const MAXIMUM_REMOTE_JSON_BYTES = 4 * 1024 * 1024;
const MAXIMUM_EVIDENCE_BYTES = 4 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40,64}$/;
const CLOUDFLARE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const canonicalTimestampSchema = z.string().refine(
  (value) => {
    const timestamp = new Date(value);
    return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
  },
  "Expected a canonical ISO timestamp.",
);
const uuidSchema = z.string().regex(UUID_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const positiveSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const nonNegativeSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  "Expected a non-negative safe integer.",
);
const safeTextSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Text cannot contain control characters.",
  );
const releaseTagSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Worker release tags cannot contain control characters.",
  );
const releaseMessageSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Worker release messages cannot contain control characters.",
  );
const nullableSafeTextSchema = safeTextSchema.nullable();
const nullableUrlSchema = z.url().nullable();

const gitIdentitySchema = z
  .object({
    head: z.string().regex(GIT_OBJECT_PATTERN),
    upstream: z.string().regex(GIT_OBJECT_PATTERN),
    upstreamRef: safeTextSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.head !== value.upstream) {
      context.addIssue({
        code: "custom",
        message: "Worker candidate Git HEAD must equal its pushed upstream.",
      });
    }
  });

const artifactIdentitySchema = z
  .object({
    sourceFingerprintSha256: sha256Schema,
    sourceFingerprintFileCount: positiveSafeIntegerSchema,
    workerSourceSha256: sha256Schema,
    wranglerConfigSha256: sha256Schema,
    assetManifestSha256: sha256Schema,
    assetManifestFileCount: positiveSafeIntegerSchema,
    assetManifestBytes: nonNegativeSafeIntegerSchema,
  })
  .strict();

const uploadOutputEventSchema = z
  .object({
    type: z.literal("version-upload"),
    version: z.literal(1),
    workerName: z.literal(WORKER_CANDIDATE_WORKER_NAME),
    workerTag: safeTextSchema,
    versionId: uuidSchema,
    previewUrl: nullableUrlSchema,
    previewAliasUrl: nullableUrlSchema,
    wranglerEnvironment: nullableSafeTextSchema,
    workerNameOverridden: z.literal(false),
    timestamp: canonicalTimestampSchema,
  })
  .strict();

const deployOutputEventSchema = z
  .object({
    type: z.literal("version-deploy"),
    version: z.literal(1),
    workerName: z.literal(WORKER_CANDIDATE_WORKER_NAME),
    workerTag: nullableSafeTextSchema,
    deploymentId: uuidSchema,
    timestamp: canonicalTimestampSchema,
  })
  .strict();

const versionViewEvidenceSchema = z
  .object({
    versionId: uuidSchema,
    createdAt: canonicalTimestampSchema,
    source: safeTextSchema,
    releaseTag: releaseTagSchema,
    releaseMessageSha256: sha256Schema,
    resourceConfigSha256: sha256Schema,
  })
  .strict();

const soleBaselineTopologySchema = z
  .object({
    deploymentId: uuidSchema,
    serviceBaselineVersionId: uuidSchema,
    percentage: z.literal(100),
    observedVersions: z.literal(1),
  })
  .strict();

const stagedTopologySchema = z
  .object({
    deploymentId: uuidSchema,
    serviceBaselineVersionId: uuidSchema,
    targetCandidateVersionId: uuidSchema,
    baselinePercentage: z.literal(100),
    candidatePercentage: z.literal(0),
    observedVersions: z.literal(2),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.serviceBaselineVersionId === value.targetCandidateVersionId) {
      context.addIssue({
        code: "custom",
        message: "The staged baseline and candidate Worker versions must differ.",
      });
    }
  });

const activationTopologySchema = z
  .object({
    deploymentId: uuidSchema,
    targetCandidateVersionId: uuidSchema,
    percentage: z.literal(100),
    observedVersions: z.literal(1),
  })
  .strict();

const workerCandidateUploadEvidenceSchema = z
  .object({
    kind: z.literal(WORKER_CANDIDATE_UPLOAD_EVIDENCE_KIND),
    schemaVersion: z.literal(1),
    candidateState: z.literal("inactive"),
    createdAt: canonicalTimestampSchema,
    workerName: z.literal(WORKER_CANDIDATE_WORKER_NAME),
    targetCandidateVersionId: uuidSchema,
    serviceBaselineVersionId: uuidSchema,
    serviceWorkerTag: safeTextSchema,
    expectedReleaseTag: releaseTagSchema,
    expectedReleaseMessageSha256: sha256Schema,
    uploadCommandEvidenceSha256: sha256Schema,
    workerDeployPreparationSha256: sha256Schema,
    git: gitIdentitySchema,
    artifacts: artifactIdentitySchema,
    uploadOutput: uploadOutputEventSchema,
    versionView: versionViewEvidenceSchema,
    soleBaselineTopology: soleBaselineTopologySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const candidate = value.targetCandidateVersionId;
    const baseline = value.serviceBaselineVersionId;
    if (candidate === baseline) {
      context.addIssue({
        code: "custom",
        message: "The inactive candidate must differ from the service baseline.",
      });
    }
    if (
      value.uploadOutput.workerName !== value.workerName ||
      value.uploadOutput.versionId !== candidate ||
      value.uploadOutput.workerTag !== value.serviceWorkerTag ||
      value.versionView.versionId !== candidate ||
      value.versionView.releaseTag !== value.expectedReleaseTag ||
      value.versionView.releaseMessageSha256 !==
        value.expectedReleaseMessageSha256
    ) {
      context.addIssue({
        code: "custom",
        message: "Upload output and versions-view evidence must bind the exact candidate UUID.",
      });
    }
    if (value.soleBaselineTopology.serviceBaselineVersionId !== baseline) {
      context.addIssue({
        code: "custom",
        message: "Upload evidence does not preserve the exact sole-active service baseline.",
      });
    }
    if (Date.parse(value.createdAt) < Date.parse(value.uploadOutput.timestamp)) {
      context.addIssue({
        code: "custom",
        message: "Upload evidence cannot predate the Wrangler upload output event.",
      });
    }
    if (Date.parse(value.createdAt) < Date.parse(value.versionView.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Upload evidence cannot predate the uploaded Worker version.",
      });
    }
  });

export type WorkerCandidateUploadEvidence = z.infer<
  typeof workerCandidateUploadEvidenceSchema
>;

const workerCandidateStagedEvidenceSchema = z
  .object({
    kind: z.literal(WORKER_CANDIDATE_STAGED_EVIDENCE_KIND),
    schemaVersion: z.literal(2),
    candidateState: z.literal("staged-zero-traffic"),
    createdAt: canonicalTimestampSchema,
    workerName: z.literal(WORKER_CANDIDATE_WORKER_NAME),
    targetCandidateVersionId: uuidSchema,
    serviceBaselineVersionId: uuidSchema,
    uploadEvidenceSha256: sha256Schema,
    uploadEvidence: workerCandidateUploadEvidenceSchema,
    deployOutput: deployOutputEventSchema,
    topology: stagedTopologySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.workerName !== value.uploadEvidence.workerName ||
      value.targetCandidateVersionId !==
        value.uploadEvidence.targetCandidateVersionId ||
      value.serviceBaselineVersionId !==
        value.uploadEvidence.serviceBaselineVersionId ||
      value.topology.targetCandidateVersionId !==
        value.targetCandidateVersionId ||
      value.topology.serviceBaselineVersionId !==
        value.serviceBaselineVersionId
    ) {
      context.addIssue({
        code: "custom",
        message: "Staged evidence drifted from the immutable upload release identity.",
      });
    }
    if (
      value.deployOutput.workerName !== value.workerName ||
      value.deployOutput.deploymentId !== value.topology.deploymentId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Staging output deployment ID must match the authoritative staged topology.",
      });
    }
    if (
      value.uploadEvidenceSha256 !==
      workerCandidateEvidenceSha256(value.uploadEvidence)
    ) {
      context.addIssue({
        code: "custom",
        message: "Staged evidence has the wrong immutable upload evidence hash.",
      });
    }
    if (
      value.topology.deploymentId ===
      value.uploadEvidence.soleBaselineTopology.deploymentId
    ) {
      context.addIssue({
        code: "custom",
        message: "Staging must create a new authoritative deployment identity.",
      });
    }
    if (
      Date.parse(value.createdAt) < Date.parse(value.uploadEvidence.createdAt) ||
      Date.parse(value.createdAt) < Date.parse(value.deployOutput.timestamp)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Staged evidence cannot predate immutable upload or Wrangler deployment evidence.",
      });
    }
  });

export type WorkerCandidateStagedEvidence = z.infer<
  typeof workerCandidateStagedEvidenceSchema
>;

const workerCandidateActivationEvidenceSchema = z
  .object({
    kind: z.literal(WORKER_CANDIDATE_ACTIVATION_EVIDENCE_KIND),
    schemaVersion: z.literal(1),
    candidateState: z.literal("active"),
    createdAt: canonicalTimestampSchema,
    workerName: z.literal(WORKER_CANDIDATE_WORKER_NAME),
    targetCandidateVersionId: uuidSchema,
    serviceBaselineVersionId: uuidSchema,
    uploadEvidenceSha256: sha256Schema,
    stagedEvidenceSha256: sha256Schema,
    preActivationSealSha256: sha256Schema,
    stagedEvidence: workerCandidateStagedEvidenceSchema,
    deployOutput: deployOutputEventSchema,
    topology: activationTopologySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const staged = value.stagedEvidence;
    if (
      value.workerName !== staged.workerName ||
      value.targetCandidateVersionId !== staged.targetCandidateVersionId ||
      value.serviceBaselineVersionId !== staged.serviceBaselineVersionId ||
      value.uploadEvidenceSha256 !== staged.uploadEvidenceSha256 ||
      value.topology.targetCandidateVersionId !==
        value.targetCandidateVersionId
    ) {
      context.addIssue({
        code: "custom",
        message: "Activation evidence drifted from the sealed staged release identity.",
      });
    }
    if (
      value.stagedEvidenceSha256 !== workerCandidateEvidenceSha256(staged)
    ) {
      context.addIssue({
        code: "custom",
        message: "Activation evidence has the wrong immutable staged evidence hash.",
      });
    }
    if (
      value.deployOutput.workerName !== value.workerName ||
      value.deployOutput.deploymentId !== value.topology.deploymentId
    ) {
      context.addIssue({
        code: "custom",
        message: "Activation output deployment ID must match authoritative status.",
      });
    }
    if (value.topology.deploymentId === staged.topology.deploymentId) {
      context.addIssue({
        code: "custom",
        message: "Activation must create a new authoritative deployment identity.",
      });
    }
    if (
      Date.parse(value.createdAt) < Date.parse(staged.createdAt) ||
      Date.parse(value.createdAt) < Date.parse(value.deployOutput.timestamp)
    ) {
      context.addIssue({
        code: "custom",
        message: "Activation evidence cannot predate its staged or deploy evidence.",
      });
    }
  });

export type WorkerCandidateActivationEvidence = z.infer<
  typeof workerCandidateActivationEvidenceSchema
>;

export type WorkerCandidateReleaseEvidence =
  | WorkerCandidateUploadEvidence
  | WorkerCandidateStagedEvidence
  | WorkerCandidateActivationEvidence;

export type WorkerVersionUploadOutputEvent = z.infer<
  typeof uploadOutputEventSchema
>;
export type WorkerVersionDeployOutputEvent = z.infer<
  typeof deployOutputEventSchema
>;
export type WorkerVersionViewEvidence = z.infer<
  typeof versionViewEvidenceSchema
>;
export type WorkerSoleBaselineTopology = z.infer<
  typeof soleBaselineTopologySchema
>;
export type WorkerStagedTopology = z.infer<typeof stagedTopologySchema>;
export type WorkerActivationTopology = z.infer<
  typeof activationTopologySchema
>;
export type WorkerCandidateGitIdentity = z.infer<typeof gitIdentitySchema>;
export type WorkerCandidateArtifactIdentity = z.infer<
  typeof artifactIdentitySchema
>;

export type WorkerDeploymentStatus = Readonly<{
  deploymentId: string;
  versions: readonly Readonly<{
    versionId: string;
    percentage: number;
  }>[];
}>;

export type WorkerCandidateEvidenceHandle<T extends WorkerCandidateReleaseEvidence> =
  Readonly<{
    path: string;
    value: T;
    sha256: string;
  }>;

export function workerCandidateUploadEvidencePath(backupDir: string) {
  return evidencePath(backupDir, WORKER_CANDIDATE_UPLOAD_REPORT);
}

export function workerCandidateStagedEvidencePath(backupDir: string) {
  return evidencePath(backupDir, WORKER_CANDIDATE_STAGED_REPORT);
}

export function workerCandidateActivationEvidencePath(backupDir: string) {
  return evidencePath(backupDir, WORKER_CANDIDATE_ACTIVATION_REPORT);
}

export function parseWorkerVersionUploadOutput(
  output: string,
  expectedWorkerName = WORKER_CANDIDATE_WORKER_NAME,
): WorkerVersionUploadOutputEvent {
  requireExpectedWorkerName(expectedWorkerName);
  const event = singleWranglerOutputEvent(output, "version upload");
  assertExactKeys(
    event,
    [
      "timestamp",
      "type",
      "version",
      "version_id",
      "worker_name",
      "worker_name_overridden",
      "worker_tag",
    ],
    [
      "preview_alias_url",
      "preview_url",
      "wrangler_environment",
    ],
    "Wrangler version-upload output event",
  );
  const wire = parseSchema(
    z
      .object({
        type: z.literal("version-upload"),
        version: z.literal(1),
        worker_name: safeTextSchema,
        worker_tag: safeTextSchema,
        version_id: uuidSchema,
        preview_url: nullableUrlSchema.optional(),
        preview_alias_url: nullableUrlSchema.optional(),
        wrangler_environment: nullableSafeTextSchema.optional(),
        worker_name_overridden: z.literal(false),
        timestamp: canonicalTimestampSchema,
      })
      .strict(),
    event,
    "Wrangler version-upload output event",
  );
  if (wire.worker_name !== expectedWorkerName) {
    throw new Error("Wrangler version-upload output targeted the wrong Worker.");
  }
  return parseSchema(
    uploadOutputEventSchema,
    {
      type: wire.type,
      version: wire.version,
      workerName: wire.worker_name,
      workerTag: wire.worker_tag,
      versionId: wire.version_id,
      previewUrl: wire.preview_url ?? null,
      previewAliasUrl: wire.preview_alias_url ?? null,
      wranglerEnvironment: wire.wrangler_environment ?? null,
      workerNameOverridden: wire.worker_name_overridden,
      timestamp: wire.timestamp,
    },
    "normalized Wrangler version-upload output event",
  );
}

export function parseWorkerVersionDeployOutput(
  output: string,
  expectedWorkerName = WORKER_CANDIDATE_WORKER_NAME,
): WorkerVersionDeployOutputEvent {
  requireExpectedWorkerName(expectedWorkerName);
  const event = singleWranglerOutputEvent(output, "version deploy");
  assertExactKeys(
    event,
    [
      "deployment_id",
      "timestamp",
      "type",
      "version",
      "version_traffic",
      "worker_name",
    ],
    ["worker_tag"],
    "Wrangler version-deploy output event",
  );
  const wire = parseSchema(
    z
      .object({
        type: z.literal("version-deploy"),
        version: z.literal(1),
        worker_name: safeTextSchema,
        worker_tag: nullableSafeTextSchema.optional(),
        deployment_id: uuidSchema,
        // Wrangler serializes this field, but it is deliberately opaque here.
        // Only deployments-status readback below is authoritative for traffic.
        version_traffic: z.unknown(),
        timestamp: canonicalTimestampSchema,
      })
      .strict(),
    event,
    "Wrangler version-deploy output event",
  );
  if (wire.worker_name !== expectedWorkerName) {
    throw new Error("Wrangler version-deploy output targeted the wrong Worker.");
  }
  return parseSchema(
    deployOutputEventSchema,
    {
      type: wire.type,
      version: wire.version,
      workerName: wire.worker_name,
      workerTag: wire.worker_tag ?? null,
      deploymentId: wire.deployment_id,
      timestamp: wire.timestamp,
    },
    "normalized Wrangler version-deploy output event",
  );
}

export function parseWorkerVersionViewOutput(
  output: string,
  expectedCandidateVersionId: string,
  expected: Readonly<{
    releaseTag: string;
    releaseMessageSha256: string;
  }>,
): WorkerVersionViewEvidence {
  const candidate = requireUuid(
    expectedCandidateVersionId,
    "expected candidate Worker version ID",
  );
  const view = requireRecord(
    parseBoundedJson(output, MAXIMUM_REMOTE_JSON_BYTES, "Worker versions-view"),
    "Worker versions-view",
  );
  assertRequiredKeys(
    view,
    ["id", "metadata", "resources"],
    "Worker versions-view",
  );
  if (view.id !== candidate) {
    throw new Error("Worker versions-view returned the wrong candidate UUID.");
  }
  const metadata = requireRecord(view.metadata, "Worker versions-view metadata");
  const createdAt = requireCloudflareTimestamp(
    metadata.created_on,
    "Worker versions-view creation timestamp",
  );
  const source = requireSafeText(
    metadata.source,
    "Worker versions-view source",
  );
  const annotations = requireRecord(
    view.annotations,
    "Worker versions-view annotations",
  );
  assertRequiredKeys(
    annotations,
    ["workers/message", "workers/tag"],
    "Worker versions-view annotations",
  );
  const releaseTag = parseSchema(
    releaseTagSchema,
    annotations["workers/tag"],
    "Worker versions-view release tag",
  );
  const releaseMessage = parseSchema(
    releaseMessageSchema,
    annotations["workers/message"],
    "Worker versions-view release message",
  );
  const expectedReleaseTag = parseSchema(
    releaseTagSchema,
    expected.releaseTag,
    "expected Worker release tag",
  );
  const expectedReleaseMessageSha256 = requireSha256(
    expected.releaseMessageSha256,
    "expected Worker release message SHA-256",
  );
  const releaseMessageSha256 = workerReleaseMessageSha256(releaseMessage);
  if (
    releaseTag !== expectedReleaseTag ||
    releaseMessageSha256 !== expectedReleaseMessageSha256
  ) {
    throw new Error(
      "Worker versions-view tag or message does not match the exact requested release annotations.",
    );
  }
  const resources = requireRecord(
    view.resources,
    "Worker versions-view resource configuration",
  );
  if (Object.keys(resources).length === 0) {
    throw new Error("Worker versions-view resource configuration is empty.");
  }
  assertJsonValue(resources, "Worker versions-view resource configuration");
  return parseSchema(
    versionViewEvidenceSchema,
    {
      versionId: candidate,
      createdAt,
      source,
      releaseTag,
      releaseMessageSha256,
      resourceConfigSha256: canonicalJsonSha256(resources),
    },
    "Worker versions-view evidence",
  );
}

export function parseWorkerDeploymentStatusOutput(
  output: string,
): WorkerDeploymentStatus {
  const status = requireRecord(
    parseBoundedJson(
      output,
      MAXIMUM_REMOTE_JSON_BYTES,
      "Worker deployments-status",
    ),
    "Worker deployments-status",
  );
  assertRequiredKeys(
    status,
    ["id", "versions"],
    "Worker deployments-status",
  );
  const deploymentId = requireUuid(
    status.id,
    "Worker deployments-status deployment ID",
  );
  if (!Array.isArray(status.versions) || status.versions.length === 0) {
    throw new Error(
      "Worker deployments-status must contain at least one traffic version.",
    );
  }
  const versions = status.versions.map((entry, index) => {
    const version = requireRecord(
      entry,
      `Worker deployments-status version ${index + 1}`,
    );
    assertExactKeys(
      version,
      ["percentage", "version_id"],
      [],
      `Worker deployments-status version ${index + 1}`,
    );
    return Object.freeze({
      versionId: requireUuid(
        version.version_id,
        `Worker deployments-status version ${index + 1} UUID`,
      ),
      percentage: requireTrafficPercentage(
        version.percentage,
        `Worker deployments-status version ${index + 1} percentage`,
      ),
    });
  });
  if (new Set(versions.map((entry) => entry.versionId)).size !== versions.length) {
    throw new Error("Worker deployments-status contains duplicate version UUIDs.");
  }
  const trafficTotal = versions.reduce(
    (total, entry) => total + entry.percentage,
    0,
  );
  if (trafficTotal !== 100) {
    throw new Error(
      "Worker deployments-status traffic percentages must total exactly 100.",
    );
  }
  return Object.freeze({
    deploymentId,
    versions: Object.freeze(versions),
  });
}

export function parseSoleBaselineTopology(
  output: string,
  expectedBaselineVersionId: string,
): WorkerSoleBaselineTopology {
  const baseline = requireUuid(
    expectedBaselineVersionId,
    "expected service baseline Worker version ID",
  );
  const status = parseWorkerDeploymentStatusOutput(output);
  if (
    status.versions.length !== 1 ||
    status.versions[0]?.versionId !== baseline ||
    status.versions[0]?.percentage !== 100
  ) {
    throw new Error(
      "Worker upload readback must retain only the exact service baseline at 100% traffic.",
    );
  }
  return parseSchema(
    soleBaselineTopologySchema,
    {
      deploymentId: status.deploymentId,
      serviceBaselineVersionId: baseline,
      percentage: 100,
      observedVersions: 1,
    },
    "sole-baseline Worker topology",
  );
}

export function parseStagedWorkerTopology(
  output: string,
  expectedBaselineVersionId: string,
  expectedCandidateVersionId: string,
): WorkerStagedTopology {
  const baseline = requireUuid(
    expectedBaselineVersionId,
    "expected staged baseline Worker version ID",
  );
  const candidate = requireUuid(
    expectedCandidateVersionId,
    "expected staged candidate Worker version ID",
  );
  if (baseline === candidate) {
    throw new Error("Staged Worker baseline and candidate UUIDs must differ.");
  }
  const status = parseWorkerDeploymentStatusOutput(output);
  const byVersion = new Map(
    status.versions.map((entry) => [entry.versionId, entry.percentage]),
  );
  if (
    status.versions.length !== 2 ||
    byVersion.get(baseline) !== 100 ||
    byVersion.get(candidate) !== 0
  ) {
    throw new Error(
      "Staged Worker topology must be exactly baseline 100% plus candidate 0%, with no extra versions.",
    );
  }
  return parseSchema(
    stagedTopologySchema,
    {
      deploymentId: status.deploymentId,
      serviceBaselineVersionId: baseline,
      targetCandidateVersionId: candidate,
      baselinePercentage: 100,
      candidatePercentage: 0,
      observedVersions: 2,
    },
    "staged Worker topology",
  );
}

export function parseActivatedWorkerTopology(
  output: string,
  expectedCandidateVersionId: string,
  expectedDeploymentId: string,
): WorkerActivationTopology {
  const candidate = requireUuid(
    expectedCandidateVersionId,
    "expected activated candidate Worker version ID",
  );
  const deploymentId = requireUuid(
    expectedDeploymentId,
    "expected activation deployment ID",
  );
  const status = parseWorkerDeploymentStatusOutput(output);
  if (
    status.deploymentId !== deploymentId ||
    status.versions.length !== 1 ||
    status.versions[0]?.versionId !== candidate ||
    status.versions[0]?.percentage !== 100
  ) {
    throw new Error(
      "Activated Worker topology must be the exact uploaded candidate alone at 100%, under the output deployment ID.",
    );
  }
  return parseSchema(
    activationTopologySchema,
    {
      deploymentId,
      targetCandidateVersionId: candidate,
      percentage: 100,
      observedVersions: 1,
    },
    "activated Worker topology",
  );
}

export function buildWorkerCandidateUploadEvidence(input: {
  createdAt: string;
  workerName?: typeof WORKER_CANDIDATE_WORKER_NAME;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  expectedReleaseTag: string;
  expectedReleaseMessageSha256: string;
  uploadCommandEvidenceSha256: string;
  workerDeployPreparationSha256: string;
  git: WorkerCandidateGitIdentity;
  artifacts: WorkerCandidateArtifactIdentity;
  uploadOutput: WorkerVersionUploadOutputEvent;
  versionView: WorkerVersionViewEvidence;
  soleBaselineTopology: WorkerSoleBaselineTopology;
  expectedResourceConfigSha256?: string;
}): WorkerCandidateUploadEvidence {
  if (
    input.expectedResourceConfigSha256 !== undefined &&
    requireSha256(
      input.expectedResourceConfigSha256,
      "expected Worker resource/config signature",
    ) !== input.versionView.resourceConfigSha256
  ) {
    throw new Error(
      "Worker versions-view resource/config signature differs from the expected release signature.",
    );
  }
  return parseWorkerCandidateUploadEvidence({
    kind: WORKER_CANDIDATE_UPLOAD_EVIDENCE_KIND,
    schemaVersion: 1,
    candidateState: "inactive",
    createdAt: input.createdAt,
    workerName: input.workerName ?? WORKER_CANDIDATE_WORKER_NAME,
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    serviceWorkerTag: input.uploadOutput.workerTag,
    expectedReleaseTag: input.expectedReleaseTag,
    expectedReleaseMessageSha256: input.expectedReleaseMessageSha256,
    uploadCommandEvidenceSha256: input.uploadCommandEvidenceSha256,
    workerDeployPreparationSha256: input.workerDeployPreparationSha256,
    git: input.git,
    artifacts: input.artifacts,
    uploadOutput: input.uploadOutput,
    versionView: input.versionView,
    soleBaselineTopology: input.soleBaselineTopology,
  });
}

export function buildWorkerCandidateStagedEvidence(input: {
  createdAt: string;
  uploadEvidence: WorkerCandidateUploadEvidence;
  uploadEvidenceSha256: string;
  deployOutput: WorkerVersionDeployOutputEvent;
  topology: WorkerStagedTopology;
}): WorkerCandidateStagedEvidence {
  const uploadEvidence = parseWorkerCandidateUploadEvidence(
    input.uploadEvidence,
  );
  return parseWorkerCandidateStagedEvidence({
    kind: WORKER_CANDIDATE_STAGED_EVIDENCE_KIND,
    schemaVersion: 2,
    candidateState: "staged-zero-traffic",
    createdAt: input.createdAt,
    workerName: uploadEvidence.workerName,
    targetCandidateVersionId: uploadEvidence.targetCandidateVersionId,
    serviceBaselineVersionId: uploadEvidence.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
    uploadEvidence,
    deployOutput: input.deployOutput,
    topology: input.topology,
  });
}

export function buildWorkerCandidateActivationEvidence(input: {
  createdAt: string;
  uploadEvidence: WorkerCandidateUploadEvidence;
  uploadEvidenceSha256: string;
  stagedEvidence: WorkerCandidateStagedEvidence;
  stagedEvidenceSha256: string;
  preActivationSealSha256: string;
  deployOutput: WorkerVersionDeployOutputEvent;
  topology: WorkerActivationTopology;
}): WorkerCandidateActivationEvidence {
  const uploadEvidence = parseWorkerCandidateUploadEvidence(
    input.uploadEvidence,
  );
  const stagedEvidence = verifyWorkerCandidateStagedEvidence({
    uploadEvidence,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
    stagedEvidence: input.stagedEvidence,
    stagedEvidenceSha256: input.stagedEvidenceSha256,
  });
  return parseWorkerCandidateActivationEvidence({
    kind: WORKER_CANDIDATE_ACTIVATION_EVIDENCE_KIND,
    schemaVersion: 1,
    candidateState: "active",
    createdAt: input.createdAt,
    workerName: uploadEvidence.workerName,
    targetCandidateVersionId: uploadEvidence.targetCandidateVersionId,
    serviceBaselineVersionId: uploadEvidence.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
    stagedEvidenceSha256: input.stagedEvidenceSha256,
    preActivationSealSha256: input.preActivationSealSha256,
    stagedEvidence,
    deployOutput: input.deployOutput,
    topology: input.topology,
  });
}

export function parseWorkerCandidateUploadEvidence(
  value: unknown,
): WorkerCandidateUploadEvidence {
  return parseSchema(
    workerCandidateUploadEvidenceSchema,
    value,
    "Worker candidate upload evidence",
  );
}

export function parseWorkerCandidateStagedEvidence(
  value: unknown,
): WorkerCandidateStagedEvidence {
  return parseSchema(
    workerCandidateStagedEvidenceSchema,
    value,
    "Worker candidate staged evidence",
  );
}

export function parseWorkerCandidateActivationEvidence(
  value: unknown,
): WorkerCandidateActivationEvidence {
  return parseSchema(
    workerCandidateActivationEvidenceSchema,
    value,
    "Worker candidate activation evidence",
  );
}

export function verifyWorkerCandidateStagedEvidence(input: {
  uploadEvidence: WorkerCandidateUploadEvidence;
  uploadEvidenceSha256: string;
  stagedEvidence: WorkerCandidateStagedEvidence;
  stagedEvidenceSha256?: string;
}): WorkerCandidateStagedEvidence {
  const upload = parseWorkerCandidateUploadEvidence(input.uploadEvidence);
  const staged = parseWorkerCandidateStagedEvidence(input.stagedEvidence);
  const expectedUploadSha256 = requireSha256(
    input.uploadEvidenceSha256,
    "expected upload evidence SHA-256",
  );
  if (
    expectedUploadSha256 !== workerCandidateEvidenceSha256(upload) ||
    staged.uploadEvidenceSha256 !== expectedUploadSha256 ||
    workerCandidateEvidenceSha256(staged.uploadEvidence) !==
      expectedUploadSha256
  ) {
    throw new Error(
      "Staged Worker evidence is not bound to the exact immutable upload evidence.",
    );
  }
  if (
    input.stagedEvidenceSha256 !== undefined &&
    requireSha256(
      input.stagedEvidenceSha256,
      "expected staged evidence SHA-256",
    ) !== workerCandidateEvidenceSha256(staged)
  ) {
    throw new Error("Staged Worker evidence has the wrong canonical SHA-256.");
  }
  return staged;
}

export function verifyWorkerCandidateActivationEvidence(input: {
  uploadEvidence: WorkerCandidateUploadEvidence;
  uploadEvidenceSha256: string;
  stagedEvidence: WorkerCandidateStagedEvidence;
  stagedEvidenceSha256: string;
  preActivationSealSha256?: string;
  activationEvidence: WorkerCandidateActivationEvidence;
  activationEvidenceSha256?: string;
}): WorkerCandidateActivationEvidence {
  const staged = verifyWorkerCandidateStagedEvidence({
    uploadEvidence: input.uploadEvidence,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
    stagedEvidence: input.stagedEvidence,
    stagedEvidenceSha256: input.stagedEvidenceSha256,
  });
  const activation = parseWorkerCandidateActivationEvidence(
    input.activationEvidence,
  );
  const stagedSha256 = workerCandidateEvidenceSha256(staged);
  if (
    activation.stagedEvidenceSha256 !== stagedSha256 ||
    workerCandidateEvidenceSha256(activation.stagedEvidence) !== stagedSha256 ||
    activation.uploadEvidenceSha256 !== input.uploadEvidenceSha256
  ) {
    throw new Error(
      "Activation evidence is not bound to the exact immutable upload and staged evidence.",
    );
  }
  if (
    input.preActivationSealSha256 !== undefined &&
    activation.preActivationSealSha256 !==
      requireSha256(
        input.preActivationSealSha256,
        "expected pre-activation seal SHA-256",
      )
  ) {
    throw new Error(
      "Activation evidence is not bound to the exact pre-activation authorization seal.",
    );
  }
  if (
    input.activationEvidenceSha256 !== undefined &&
    requireSha256(
      input.activationEvidenceSha256,
      "expected activation evidence SHA-256",
    ) !== workerCandidateEvidenceSha256(activation)
  ) {
    throw new Error("Activation evidence has the wrong canonical SHA-256.");
  }
  return activation;
}

export function finalizeWorkerCandidateUploadEvidence(input: {
  file: string;
  createdAt: string;
  workerName?: typeof WORKER_CANDIDATE_WORKER_NAME;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  expectedReleaseTag: string;
  expectedReleaseMessageSha256: string;
  uploadCommandEvidenceSha256: string;
  workerDeployPreparationSha256: string;
  git: WorkerCandidateGitIdentity;
  artifacts: WorkerCandidateArtifactIdentity;
  uploadOutput: string;
  versionsViewOutput: string;
  baselineStatusOutput: string;
  expectedResourceConfigSha256?: string;
}): WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence> {
  canonicalBackupDirectoryForEvidenceFile(
    input.file,
    WORKER_CANDIDATE_UPLOAD_REPORT,
  );
  const workerName = input.workerName ?? WORKER_CANDIDATE_WORKER_NAME;
  const uploadOutput = parseWorkerVersionUploadOutput(
    input.uploadOutput,
    workerName,
  );
  if (uploadOutput.versionId !== input.targetCandidateVersionId) {
    throw new Error(
      "Final upload candidate UUID differs from the captured Wrangler output.",
    );
  }
  const evidence = buildWorkerCandidateUploadEvidence({
    createdAt: input.createdAt,
    workerName,
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    expectedReleaseTag: input.expectedReleaseTag,
    expectedReleaseMessageSha256: input.expectedReleaseMessageSha256,
    uploadCommandEvidenceSha256: input.uploadCommandEvidenceSha256,
    workerDeployPreparationSha256: input.workerDeployPreparationSha256,
    git: input.git,
    artifacts: input.artifacts,
    uploadOutput,
    versionView: parseWorkerVersionViewOutput(
      input.versionsViewOutput,
      input.targetCandidateVersionId,
      {
        releaseTag: input.expectedReleaseTag,
        releaseMessageSha256: input.expectedReleaseMessageSha256,
      },
    ),
    soleBaselineTopology: parseSoleBaselineTopology(
      input.baselineStatusOutput,
      input.serviceBaselineVersionId,
    ),
    expectedResourceConfigSha256: input.expectedResourceConfigSha256,
  });
  return writeWorkerCandidateEvidence(input.file, evidence);
}

export function finalizeWorkerCandidateStagedEvidence(input: {
  file: string;
  createdAt: string;
  uploadHandle: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  deployOutput: string;
  stagedStatusOutput: string;
}): WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence> {
  const backupDirectory = canonicalBackupDirectoryForEvidenceFile(
    input.file,
    WORKER_CANDIDATE_STAGED_REPORT,
  );
  const upload = assertFileBackedEvidenceHandle(
    input.uploadHandle,
    workerCandidateUploadEvidencePath(backupDirectory),
    readWorkerCandidateUploadEvidence,
    parseWorkerCandidateUploadEvidence,
    "upload",
  );
  const evidence = buildWorkerCandidateStagedEvidence({
    createdAt: input.createdAt,
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    deployOutput: parseWorkerVersionDeployOutput(input.deployOutput),
    topology: parseStagedWorkerTopology(
      input.stagedStatusOutput,
      upload.value.serviceBaselineVersionId,
      upload.value.targetCandidateVersionId,
    ),
  });
  return writeWorkerCandidateEvidence(input.file, evidence);
}

export function finalizeWorkerCandidateActivationEvidence(input: {
  file: string;
  createdAt: string;
  uploadHandle: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  stagedHandle: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  preActivationSealHandle: WorkerCandidatePreActivationSealHandle;
  deployOutput: string;
  activationStatusOutput: string;
}): WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence> {
  const backupDirectory = canonicalBackupDirectoryForEvidenceFile(
    input.file,
    WORKER_CANDIDATE_ACTIVATION_REPORT,
  );
  const upload = assertFileBackedEvidenceHandle(
    input.uploadHandle,
    workerCandidateUploadEvidencePath(backupDirectory),
    readWorkerCandidateUploadEvidence,
    parseWorkerCandidateUploadEvidence,
    "upload",
  );
  const staged = assertFileBackedEvidenceHandle(
    input.stagedHandle,
    workerCandidateStagedEvidencePath(backupDirectory),
    readWorkerCandidateStagedEvidence,
    parseWorkerCandidateStagedEvidence,
    "staged",
  );
  verifyWorkerCandidateStagedEvidence({
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidence: staged.value,
    stagedEvidenceSha256: staged.sha256,
  });
  const preActivationSeal =
    assertFileBackedWorkerCandidatePreActivationSealHandle(
      input.preActivationSealHandle,
      workerCandidatePreActivationSealPath(backupDirectory),
    );
  if (
    preActivationSeal.value.release.targetCandidateVersionId !==
      upload.value.targetCandidateVersionId ||
    preActivationSeal.value.release.serviceBaselineVersionId !==
      upload.value.serviceBaselineVersionId ||
    preActivationSeal.value.release.uploadEvidenceSha256 !== upload.sha256 ||
    preActivationSeal.value.release.stagedEvidenceSha256 !== staged.sha256
  ) {
    throw new Error(
      "Pre-activation authorization seal does not bind the exact upload and staged candidate evidence.",
    );
  }
  const activationCreatedAt = Date.parse(input.createdAt);
  if (
    !Number.isFinite(activationCreatedAt) ||
    activationCreatedAt < Date.parse(preActivationSeal.value.createdAt) ||
    activationCreatedAt > Date.parse(preActivationSeal.value.validUntil)
  ) {
    throw new Error(
      "Worker activation evidence must be finalized inside the exact pre-activation seal validity interval.",
    );
  }
  const deployOutput = parseWorkerVersionDeployOutput(input.deployOutput);
  const evidence = buildWorkerCandidateActivationEvidence({
    createdAt: input.createdAt,
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidence: staged.value,
    stagedEvidenceSha256: staged.sha256,
    preActivationSealSha256: preActivationSeal.sha256,
    deployOutput,
    topology: parseActivatedWorkerTopology(
      input.activationStatusOutput,
      upload.value.targetCandidateVersionId,
      deployOutput.deploymentId,
    ),
  });
  return writeWorkerCandidateEvidence(input.file, evidence);
}

export function workerCandidateEvidenceSha256(value: unknown) {
  return createHash("sha256")
    .update(canonicalEvidenceBytes(value))
    .digest("hex");
}

export function workerReleaseMessageSha256(message: string) {
  const value = parseSchema(
    releaseMessageSchema,
    message,
    "Worker release message",
  );
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function writeWorkerCandidateEvidence(
  file: string,
  evidence: WorkerCandidateUploadEvidence,
): WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
export function writeWorkerCandidateEvidence(
  file: string,
  evidence: WorkerCandidateStagedEvidence,
): WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
export function writeWorkerCandidateEvidence(
  file: string,
  evidence: WorkerCandidateActivationEvidence,
): WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>;
export function writeWorkerCandidateEvidence(
  file: string,
  evidence: WorkerCandidateReleaseEvidence,
): WorkerCandidateEvidenceHandle<WorkerCandidateReleaseEvidence> {
  const parsed = parseReleaseEvidence(evidence);
  const bytes = canonicalEvidenceBytes(parsed);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_EVIDENCE_BYTES) {
    throw new Error("Worker candidate evidence exceeds its bounded size.");
  }
  const absolute = path.resolve(file);
  const directory = path.dirname(absolute);
  assertSafeEvidenceDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(absolute)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  let published = false;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const stat = fs.fstatSync(descriptor);
    assertPrivateEvidenceStat(stat, bytes.byteLength, temporary);
    fs.closeSync(descriptor);
    descriptor = undefined;

    // link(2) publishes without replacing an existing immutable report.
    // Removing the temporary name leaves one owner-only link at the target.
    fs.linkSync(temporary, absolute);
    published = true;
    fs.unlinkSync(temporary);
    fsyncDirectory(directory);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original failure.
      }
    }
    fs.rmSync(temporary, { force: true });
    if (published) {
      fs.rmSync(absolute, { force: true });
      fsyncDirectory(directory);
    }
    throw new Error(
      `Worker candidate evidence could not be published atomically without replacement: ${absolute}.`,
      { cause: error },
    );
  }
  return readWorkerCandidateEvidence(absolute);
}

export function readWorkerCandidateUploadEvidence(
  file: string,
): WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence> {
  return readTypedEvidence(
    file,
    parseWorkerCandidateUploadEvidence,
    WORKER_CANDIDATE_UPLOAD_EVIDENCE_KIND,
  );
}

export function readWorkerCandidateStagedEvidence(
  file: string,
): WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence> {
  return readTypedEvidence(
    file,
    parseWorkerCandidateStagedEvidence,
    WORKER_CANDIDATE_STAGED_EVIDENCE_KIND,
  );
}

export function readWorkerCandidateActivationEvidence(
  file: string,
): WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence> {
  return readTypedEvidence(
    file,
    parseWorkerCandidateActivationEvidence,
    WORKER_CANDIDATE_ACTIVATION_EVIDENCE_KIND,
  );
}

function readWorkerCandidateEvidence(
  file: string,
): WorkerCandidateEvidenceHandle<WorkerCandidateReleaseEvidence> {
  const raw = readPrivateEvidence(file);
  const value = parseReleaseEvidence(raw.value);
  assertCanonicalEvidenceBytes(raw.bytes, value, file);
  return Object.freeze({
    path: raw.path,
    value,
    sha256: createHash("sha256").update(raw.bytes).digest("hex"),
  });
}

function readTypedEvidence<T extends WorkerCandidateReleaseEvidence>(
  file: string,
  parser: (value: unknown) => T,
  expectedKind:
    | typeof WORKER_CANDIDATE_UPLOAD_EVIDENCE_KIND
    | typeof WORKER_CANDIDATE_STAGED_EVIDENCE_KIND
    | typeof WORKER_CANDIDATE_ACTIVATION_EVIDENCE_KIND,
): WorkerCandidateEvidenceHandle<T> {
  const raw = readPrivateEvidence(file);
  const record = requireRecord(raw.value, "Worker candidate evidence");
  if (record.kind !== expectedKind) {
    throw new Error("Worker candidate evidence has the wrong phase kind.");
  }
  const value = parser(raw.value);
  assertCanonicalEvidenceBytes(raw.bytes, value, file);
  return Object.freeze({
    path: raw.path,
    value,
    sha256: createHash("sha256").update(raw.bytes).digest("hex"),
  });
}

function parseReleaseEvidence(value: unknown): WorkerCandidateReleaseEvidence {
  const record = requireRecord(value, "Worker candidate release evidence");
  if (record.kind === WORKER_CANDIDATE_UPLOAD_EVIDENCE_KIND) {
    return parseWorkerCandidateUploadEvidence(value);
  }
  if (record.kind === WORKER_CANDIDATE_STAGED_EVIDENCE_KIND) {
    return parseWorkerCandidateStagedEvidence(value);
  }
  if (record.kind === WORKER_CANDIDATE_ACTIVATION_EVIDENCE_KIND) {
    return parseWorkerCandidateActivationEvidence(value);
  }
  throw new Error("Worker candidate release evidence has an unsupported kind.");
}

function evidencePath(backupDir: string, relativePath: string) {
  const backup = path.resolve(backupDir);
  const absolute = path.resolve(backup, ...relativePath.split("/"));
  const relative = path.relative(backup, absolute);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Worker candidate evidence path escaped its backup directory.");
  }
  return absolute;
}

function canonicalBackupDirectoryForEvidenceFile(
  file: string,
  relativePath: string,
) {
  const absolute = path.resolve(file);
  const relativeSegments = relativePath.split("/");
  if (relativeSegments.length !== 2) {
    throw new Error("Worker candidate evidence policy path is invalid.");
  }
  const backupDirectory = path.dirname(path.dirname(absolute));
  const expected = evidencePath(backupDirectory, relativePath);
  if (absolute !== expected) {
    throw new Error(
      "Worker candidate evidence finalizer requires its canonical release path.",
    );
  }
  return backupDirectory;
}

function singleWranglerOutputEvent(output: string, label: string) {
  if (
    typeof output !== "string" ||
    output.length === 0 ||
    Buffer.byteLength(output, "utf8") > MAXIMUM_WRANGLER_OUTPUT_BYTES ||
    !output.endsWith("\n") ||
    output.includes("\r")
  ) {
    throw new Error(
      `Wrangler ${label} output must be bounded exact newline-terminated NDJSON.`,
    );
  }
  const lines = output.split("\n");
  if (
    lines.length < 2 ||
    lines.length > 3 ||
    lines[lines.length - 1] !== "" ||
    lines.slice(0, -1).some((line) => line.trim() !== line || !line)
  ) {
    throw new Error(
      `Wrangler ${label} output must contain exactly one unambiguous JSON event.`,
    );
  }
  const eventLineIndex = lines.length === 3 ? 1 : 0;
  if (eventLineIndex === 1) {
    const session = requireRecord(
      parseBoundedJson(
        lines[0] ?? "",
        MAXIMUM_WRANGLER_OUTPUT_BYTES,
        "Wrangler session metadata",
      ),
      "Wrangler session metadata",
    );
    if (session.type !== "wrangler-session") {
      throw new Error(
        `Wrangler ${label} output must contain exactly one unambiguous JSON event.`,
      );
    }
    assertExactKeys(
      session,
      [
        "command_line_args",
        "log_file_path",
        "timestamp",
        "type",
        "version",
        "wrangler_version",
      ],
      [],
      "Wrangler session metadata",
    );
    parseSchema(
      z
        .object({
          type: z.literal("wrangler-session"),
          version: z.literal(1),
          wrangler_version: safeTextSchema,
          command_line_args: z.array(safeTextSchema),
          log_file_path: safeTextSchema,
          timestamp: canonicalTimestampSchema,
        })
        .strict(),
      session,
      "Wrangler session metadata",
    );
  }
  return requireRecord(
    parseBoundedJson(
      lines[eventLineIndex] ?? "",
      MAXIMUM_WRANGLER_OUTPUT_BYTES,
      label,
    ),
    `Wrangler ${label} output event`,
  );
}

function parseBoundedJson(output: string, maximumBytes: number, label: string) {
  if (
    typeof output !== "string" ||
    Buffer.byteLength(output, "utf8") === 0 ||
    Buffer.byteLength(output, "utf8") > maximumBytes
  ) {
    throw new Error(`${label} JSON is empty or exceeds its bounded size.`);
  }
  try {
    return JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error(`${label} did not return exact valid JSON.`);
  }
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
) {
  const keys = Object.keys(record).sort();
  const allowed = [...required, ...optional].sort();
  const missing = required.filter((key) => !Object.hasOwn(record, key));
  const unexpected = keys.filter((key) => !allowed.includes(key));
  if (missing.length || unexpected.length) {
    throw new Error(
      `${label} has an inexact schema${
        missing.length ? `; missing ${missing.join(", ")}` : ""
      }${unexpected.length ? `; unexpected ${unexpected.join(", ")}` : ""}.`,
    );
  }
}

function assertRequiredKeys(
  record: Readonly<Record<string, unknown>>,
  required: readonly string[],
  label: string,
) {
  const missing = required.filter((key) => !Object.hasOwn(record, key));
  if (missing.length > 0) {
    throw new Error(`${label} omitted required key(s): ${missing.join(", ")}.`);
  }
}

function requireRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a plain JSON object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical Worker UUID.`);
  }
  return value;
}

function requireSha256(value: unknown, label: string) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256.`);
  }
  return value;
}

function requireCloudflareTimestamp(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !CLOUDFLARE_TIMESTAMP_PATTERN.test(value)
  ) {
    throw new Error(`${label} must be a bounded Cloudflare ISO timestamp.`);
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${label} must be a valid Cloudflare ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function requireSafeText(value: unknown, label: string) {
  return parseSchema(safeTextSchema, value, label);
}

function requireTrafficPercentage(value: unknown, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100 ||
    Object.is(value, -0)
  ) {
    throw new Error(`${label} must be a finite percentage from 0 through 100.`);
  }
  return value;
}

function requireExpectedWorkerName(value: string) {
  if (value !== WORKER_CANDIDATE_WORKER_NAME) {
    throw new Error(
      `Worker candidate evidence is locked to ${WORKER_CANDIDATE_WORKER_NAME}.`,
    );
  }
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const detail = issue
      ? `${issue.path.join(".") || "root"}: ${issue.message}`
      : "unknown schema failure";
    throw new Error(`${label} is invalid (${detail}).`);
  }
  return result.data;
}

function canonicalJsonSha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalEvidenceBytes(value: unknown) {
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_EVIDENCE_BYTES) {
    throw new Error("Worker candidate evidence exceeds its canonical size bound.");
  }
  return bytes;
}

function canonicalJson(value: unknown): string {
  assertJsonValue(value, "canonical JSON value");
  return serializeJsonValue(value);
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

function assertJsonValue(
  value: unknown,
  label: string,
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} contains a non-finite number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, label);
    return;
  }
  if (!isRecord(value)) {
    throw new Error(`${label} contains a non-JSON value.`);
  }
  for (const item of Object.values(value)) assertJsonValue(item, label);
}

function serializeJsonValue(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("Canonical JSON value could not be serialized.");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJsonValue(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort(compareUnicodeCodePoints)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${serializeJsonValue(value[key] ?? null)}`,
    )
    .join(",")}}`;
}

function compareUnicodeCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertFileBackedEvidenceHandle<
  T extends WorkerCandidateReleaseEvidence,
>(
  handle: WorkerCandidateEvidenceHandle<T>,
  expectedPath: string,
  reader: (file: string) => WorkerCandidateEvidenceHandle<T>,
  parser: (value: unknown) => T,
  label: string,
) {
  const absoluteExpectedPath = path.resolve(expectedPath);
  if (path.resolve(handle.path) !== absoluteExpectedPath) {
    throw new Error(
      `Worker candidate ${label} evidence handle does not use its canonical release path.`,
    );
  }
  const value = parser(handle.value);
  const sha256 = requireSha256(handle.sha256, `${label} evidence handle SHA-256`);
  const persisted = reader(absoluteExpectedPath);
  if (
    sha256 !== persisted.sha256 ||
    sha256 !== workerCandidateEvidenceSha256(value)
  ) {
    throw new Error(
      `Worker candidate ${label} evidence handle is not the exact nofollow file-backed evidence.`,
    );
  }
  return persisted;
}

function assertSafeEvidenceDirectory(directory: string) {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    throw new Error(
      `Worker candidate evidence directory is missing: ${directory}.`,
      { cause: error },
    );
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync.native(directory) !== path.resolve(directory) ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    (stat.mode & 0o022) !== 0
  ) {
    throw new Error(
      `Worker candidate evidence directory must be real, owned, and not group/world writable: ${directory}.`,
    );
  }
}

function readPrivateEvidence(file: string) {
  const absolute = path.resolve(file);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new Error(
      `Worker candidate evidence must be a readable nofollow owner-only file: ${absolute}.`,
      { cause: error },
    );
  }
  let before: fs.Stats;
  let after: fs.Stats;
  let bytes: Buffer;
  try {
    before = fs.fstatSync(descriptor);
    assertPrivateEvidenceStat(before, undefined, absolute);
    bytes = fs.readFileSync(descriptor);
    after = fs.fstatSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (
    !sameStableFile(before, after) ||
    bytes.byteLength !== before.size
  ) {
    throw new Error(
      `Worker candidate evidence changed while it was read: ${absolute}.`,
    );
  }
  let named: fs.Stats;
  try {
    named = fs.lstatSync(absolute);
  } catch (error) {
    throw new Error(
      `Worker candidate evidence path changed while it was read: ${absolute}.`,
      { cause: error },
    );
  }
  assertPrivateEvidenceStat(named, bytes.byteLength, absolute);
  if (!sameStableFile(after, named)) {
    throw new Error(
      `Worker candidate evidence path changed while it was read: ${absolute}.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`Worker candidate evidence is not valid JSON: ${absolute}.`);
  }
  return { path: absolute, bytes, value };
}

function assertPrivateEvidenceStat(
  stat: fs.Stats,
  expectedBytes: number | undefined,
  file: string,
) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    !Number.isSafeInteger(stat.size) ||
    stat.size <= 0 ||
    stat.size > MAXIMUM_EVIDENCE_BYTES ||
    (expectedBytes !== undefined && stat.size !== expectedBytes)
  ) {
    throw new Error(
      `Worker candidate evidence must be a bounded owner-only mode-0600 regular file with one link: ${file}.`,
    );
  }
}

function sameStableFile(left: fs.Stats, right: fs.Stats) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink
  );
}

function assertCanonicalEvidenceBytes(
  bytes: Buffer,
  value: WorkerCandidateReleaseEvidence,
  file: string,
) {
  const canonical = canonicalEvidenceBytes(value);
  if (!bytes.equals(canonical)) {
    throw new Error(
      `Worker candidate evidence bytes are not exact canonical JSON: ${path.resolve(file)}.`,
    );
  }
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
