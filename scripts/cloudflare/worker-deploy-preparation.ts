import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  LOCAL_GATE_IDS,
  cloudflareDir,
  resolveBackupDir,
  stableStringify,
} from "./migration-config";
import {
  type GitReleaseIdentity,
  assertGitReleaseIdentity,
} from "./git-release-identity";
import { buildReleaseArtifactSafetyChecks } from "./release-artifact-safety";
import {
  type OpenNextResourceMetrics,
  inspectOpenNextResourceBudget,
} from "./check-opennext-resource-budget";
import {
  type StaticMarketingAssetReleaseValidation,
  validateStaticMarketingAssetRelease,
} from "./materialize-static-marketing-assets";
import {
  type WorkerDeployArtifactEvidence,
  buildWorkerDeployArtifactEvidence,
} from "./worker-deploy-evidence";
import {
  PREVIEW_E2E_EVIDENCE_RELATIVE_PATH,
  PREVIEW_E2E_EVIDENCE_MAX_AGE_MS,
  validatePreviewE2EEvidence,
} from "./preview-e2e-evidence";
import {
  PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_KIND,
  PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_SCHEMA_VERSION,
  PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT_SHA256,
  PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE_SHA256,
  assertProductionTrustBoundaryAcceptanceBinding,
  productionTrustBoundaryAcceptanceBinding,
  readAndValidateProductionTrustBoundaryAcceptance,
  type ProductionTrustBoundaryAcceptanceHandle,
} from "./production-trust-boundary-acceptance";

const WORKER_DEPLOY_PREPARATION_KIND =
  "inspir-worker-deploy-preparation-v2" as const;
export const WORKER_DEPLOY_PREPARATION_MAX_AGE_MS =
  12 * 60 * 60 * 1_000;
export const WORKER_DEPLOY_PREPARATION_DIRECTORY_RELATIVE_PATH =
  "cloudflare/worker-deploy-preparations" as const;
export const WORKER_DEPLOY_PREPARATION_CHECK_NAME =
  "sealed pre-cutover Worker deploy preparation" as const;

const PREPARATION_EVIDENCE_FILES = [
  {
    scope: "backup",
    relativePath: "cloudflare/local-gates-report.json",
    private: true,
  },
  {
    scope: "backup",
    relativePath: PREVIEW_E2E_EVIDENCE_RELATIVE_PATH,
    private: true,
  },
  {
    scope: "backup",
    relativePath: "cloudflare/source-secret-scan-report.json",
    private: true,
  },
  {
    scope: "backup",
    relativePath: "cloudflare/build-artifact-scan-report.json",
    private: true,
  },
  {
    scope: "workspace",
    relativePath: ".open-next/static-marketing-assets-report.json",
    private: false,
  },
] as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_OBJECT_PATTERN = /^[a-f0-9]{40,64}$/;
const MAX_PREPARATION_ARTIFACT_BYTES = 512 * 1_024;
const MAX_BOUND_EVIDENCE_FILE_BYTES = 64 * 1_024 * 1_024;
const unknownRecordSchema = z.record(z.string(), z.unknown());

const sha256Schema = z.string().regex(SHA256_PATTERN);
const deployArtifactManifestSchema = z
  .object({
    root: z.string().min(1),
    fileCount: z.number().int().positive(),
    bytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
  })
  .strict();

const boundEvidenceFileSchema = z
  .object({
    scope: z.enum(["backup", "workspace"]),
    relativePath: z.string().min(1),
    private: z.boolean(),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
  })
  .strict();

export const workerDeployPreparationArtifactSchema = z
  .object({
    kind: z.literal(WORKER_DEPLOY_PREPARATION_KIND),
    schemaVersion: z.literal(2),
    createdAt: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }),
    localEvidenceMaximumAgeMs: z.literal(
      WORKER_DEPLOY_PREPARATION_MAX_AGE_MS,
    ),
    backupDirectory: z.string().min(1),
    git: z
      .object({
        head: z.string().regex(GIT_OBJECT_PATTERN),
        upstream: z.string().regex(GIT_OBJECT_PATTERN),
        upstreamRef: z.string().min(1),
      })
      .strict(),
    sourceFingerprint: z
      .object({
        sha256: sha256Schema,
        fileCount: z.number().int().positive(),
      })
      .strict(),
    trustBoundaryAcceptance: z
      .object({
        kind: z.literal(PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_KIND),
        schemaVersion: z.literal(
          PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_SCHEMA_VERSION,
        ),
        acceptanceId: z.string().uuid(),
        acceptedAt: z.string().datetime({ offset: true }),
        artifactSha256: sha256Schema,
        backupDirectorySha256: sha256Schema,
        exactStatementSha256: z.literal(
          PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT_SHA256,
        ),
        releaseScopeSha256: z.literal(
          PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE_SHA256,
        ),
        gitHead: z.string().regex(GIT_OBJECT_PATTERN),
        sourceFingerprintSha256: sha256Schema,
        sourceFingerprintFileCount: z.number().int().positive(),
      })
      .strict(),
    deployArtifacts: z
      .object({
        workerSourceSha256: sha256Schema,
        wranglerConfigSha256: sha256Schema,
        assetManifest: deployArtifactManifestSchema,
      })
      .strict(),
    resourceInspection: z
      .object({
        ok: z.literal(true),
        canonicalSha256: sha256Schema,
      })
      .strict(),
    translationAssets: z
      .object({
        materializationCreatedAt: z.string().datetime({ offset: true }),
        buildId: z.string().min(1),
        outputSha256: sha256Schema,
        generatedPaths: z.number().int().positive(),
        legacyTranslationPaths: z.number().int().positive(),
        mainAppTranslationPaths: z.number().int().positive(),
        siteTranslationPaths: z.number().int().positive(),
        incompleteTranslationPaths: z.literal(0),
        translationAvailabilitySha256: sha256Schema,
        localizedHtmlDocuments: z.number().int().positive(),
        localizedHtmlPathsSha256: sha256Schema,
        assetManifest: deployArtifactManifestSchema,
      })
      .strict(),
    evidenceFiles: z.array(boundEvidenceFileSchema).length(
      PREPARATION_EVIDENCE_FILES.length,
    ),
    evidenceFilesSha256: sha256Schema,
  })
  .strict();

export type WorkerDeployPreparationArtifact = z.infer<
  typeof workerDeployPreparationArtifactSchema
>;

export type WorkerDeployPreparationHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  validation:
    | "existing-sealed-preparation"
    | "immutable-upload-provenance";
  artifact: WorkerDeployPreparationArtifact;
}>;

export type WorkerDeployPreparationUploadBinding = Readonly<{
  createdAt: string;
  workerDeployPreparationSha256: string;
}>;

type ReleaseSafetyCheck = ReturnType<
  typeof buildReleaseArtifactSafetyChecks
>[number];

export type WorkerDeployPreparationDependencies = Readonly<{
  readTrustAcceptance: (
    cwd: string,
    backupDirectory: string,
  ) => ProductionTrustBoundaryAcceptanceHandle;
  readGitIdentity: (cwd: string) => GitReleaseIdentity;
  buildSafetyChecks: (input: {
    backupDir: string;
    cwd: string;
    nowMs?: number;
  }) => ReleaseSafetyCheck[];
  buildDeployArtifacts: (cwd: string) => WorkerDeployArtifactEvidence;
  inspectResources: (cwd: string) => OpenNextResourceMetrics;
  validateStaticRelease: (
    cwd: string,
    options: { nowMs?: number; maxAgeMs?: number },
  ) => StaticMarketingAssetReleaseValidation;
}>;

export type WorkerDeployPreparationOptions = Readonly<{
  cwd?: string;
  backupDirectory?: string;
  now?: Date;
  dependencies?: Partial<WorkerDeployPreparationDependencies>;
}>;

export type WorkerDeployPreparationProvenanceOptions =
  WorkerDeployPreparationOptions &
    Readonly<{
      uploadEvidence: WorkerDeployPreparationUploadBinding;
    }>;

const defaultDependencies: WorkerDeployPreparationDependencies = {
  readTrustAcceptance: (cwd, backupDirectory) =>
    readAndValidateProductionTrustBoundaryAcceptance({
      cwd,
      backupDirectory,
    }),
  readGitIdentity: (cwd) => assertGitReleaseIdentity({ cwd }),
  buildSafetyChecks: (input) => buildReleaseArtifactSafetyChecks(input),
  buildDeployArtifacts: (cwd) => buildWorkerDeployArtifactEvidence(cwd),
  inspectResources: (cwd) => inspectOpenNextResourceBudget(cwd),
  validateStaticRelease: (cwd, options) =>
    validateStaticMarketingAssetRelease(cwd, options),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const handle = createWorkerDeployPreparation({
      cwd: process.cwd(),
      backupDirectory: resolveBackupDir(),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          path: handle.path,
          sha256: handle.sha256,
          createdAt: handle.artifact.createdAt,
          validUntil: handle.artifact.validUntil,
          sourceFingerprint: handle.artifact.sourceFingerprint,
          trustBoundaryAcceptance:
            handle.artifact.trustBoundaryAcceptance,
          deployArtifacts: handle.artifact.deployArtifacts,
          translationAssets: handle.artifact.translationAssets,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function createWorkerDeployPreparation(
  options: WorkerDeployPreparationOptions = {},
): WorkerDeployPreparationHandle {
  const context = preparationContext(options);
  const createdAt = canonicalNow(context.now, "preparation creation");
  const createdAtMs = Date.parse(createdAt);
  const trustAcceptance = context.dependencies.readTrustAcceptance(
    context.cwd,
    context.backupDirectory,
  );
  const git = context.dependencies.readGitIdentity(context.cwd);
  const safetyChecks = context.dependencies.buildSafetyChecks({
    backupDir: context.backupDirectory,
    cwd: context.cwd,
    nowMs: createdAtMs,
  });
  const failedSafetyChecks = safetyChecks
    .filter((check) => check.status !== "pass")
    .map((check) => check.name);
  if (failedSafetyChecks.length) {
    throw new Error(
      `Worker deploy preparation requires fresh passing local release evidence: ${failedSafetyChecks.join(", ")}.`,
    );
  }

  const deployArtifacts = context.dependencies.buildDeployArtifacts(context.cwd);
  const resources = context.dependencies.inspectResources(context.cwd);
  if (!resources.ok) {
    throw new Error(
      "Worker deploy preparation requires the exact current Static Assets tree to pass the resource contract.",
    );
  }
  const staticRelease = context.dependencies.validateStaticRelease(context.cwd, {
    nowMs: createdAtMs,
  });
  assertStaticReleaseMatchesDeployArtifacts(staticRelease, deployArtifacts);

  const evidenceFiles = fingerprintPreparationEvidenceFiles({
    cwd: context.cwd,
    backupDirectory: context.backupDirectory,
  });
  const artifact = validatePreparationArtifact({
    kind: WORKER_DEPLOY_PREPARATION_KIND,
    schemaVersion: 2,
    createdAt,
    validUntil: new Date(
      createdAtMs + WORKER_DEPLOY_PREPARATION_MAX_AGE_MS,
    ).toISOString(),
    localEvidenceMaximumAgeMs: WORKER_DEPLOY_PREPARATION_MAX_AGE_MS,
    backupDirectory: context.backupDirectory,
    git,
    sourceFingerprint: {
      sha256: deployArtifacts.sourceFingerprint.sha256,
      fileCount: deployArtifacts.sourceFingerprint.fileCount,
    },
    trustBoundaryAcceptance:
      productionTrustBoundaryAcceptanceBinding(trustAcceptance),
    deployArtifacts: {
      workerSourceSha256: deployArtifacts.workerSourceSha256,
      wranglerConfigSha256: deployArtifacts.wranglerConfigSha256,
      assetManifest: deployArtifacts.assetManifest,
    },
    resourceInspection: {
      ok: true,
      canonicalSha256: sha256(stableStringify(resources)),
    },
    translationAssets: translationAssetBinding(staticRelease),
    evidenceFiles,
    evidenceFilesSha256: evidenceFilesSha256(evidenceFiles),
  });

  assertPreparationArtifactInvariants({
    artifact,
    cwd: context.cwd,
    backupDirectory: context.backupDirectory,
    nowMs: createdAtMs,
  });
  assertPreparationAcceptanceMatchesRelease(
    artifact,
    trustAcceptance,
  );
  validateBoundEvidenceReportContents(artifact, context.cwd);

  const artifactPath = preparationArtifactPath(
    context.backupDirectory,
    artifact,
  );
  const payload = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  if (payload.byteLength > MAX_PREPARATION_ARTIFACT_BYTES) {
    throw new Error("Worker deploy preparation artifact exceeds its byte limit.");
  }
  publishPreparationArtifact(artifactPath, payload);

  return readAndValidateWorkerDeployPreparation({
    ...options,
    cwd: context.cwd,
    backupDirectory: context.backupDirectory,
    now: context.now,
  });
}

export function readAndValidateWorkerDeployPreparation(
  options: WorkerDeployPreparationOptions = {},
): WorkerDeployPreparationHandle {
  const context = preparationContext(options);
  const nowMs = Date.parse(canonicalNow(context.now, "preparation validation"));
  const current = readCurrentWorkerDeployPreparation(
    context,
    "existing-sealed-preparation",
  );
  assertPreparationArtifactInvariants({
    artifact: current.handle.artifact,
    cwd: context.cwd,
    backupDirectory: context.backupDirectory,
    nowMs,
  });
  assertCurrentWorkerDeployPreparationState({
    context,
    handle: current.handle,
    deployArtifacts: current.deployArtifacts,
    staticValidationNowMs: Date.parse(current.handle.artifact.createdAt),
  });
  return current.handle;
}

export function readAndValidateWorkerDeployPreparationProvenance(
  options: WorkerDeployPreparationProvenanceOptions,
): WorkerDeployPreparationHandle {
  const context = preparationContext(options);
  const nowMs = Date.parse(canonicalNow(context.now, "provenance validation"));
  const current = readCurrentWorkerDeployPreparation(
    context,
    "immutable-upload-provenance",
  );
  assertPreparationArtifactStructuralInvariants({
    artifact: current.handle.artifact,
    cwd: context.cwd,
    backupDirectory: context.backupDirectory,
  });
  assertWorkerDeployPreparationUploadBinding(
    current.handle,
    options.uploadEvidence,
  );
  const uploadCreatedAtMs = canonicalTimestampMs(
    options.uploadEvidence.createdAt,
    "upload evidence createdAt",
  );
  if (nowMs < uploadCreatedAtMs) {
    throw new Error(
      "Worker deploy preparation upload provenance is future-dated.",
    );
  }
  assertCurrentWorkerDeployPreparationState({
    context,
    handle: current.handle,
    deployArtifacts: current.deployArtifacts,
    staticValidationNowMs: Date.parse(current.handle.artifact.createdAt),
  });
  return current.handle;
}

export function assertWorkerDeployPreparationUploadBinding(
  handle: WorkerDeployPreparationHandle,
  uploadEvidence: WorkerDeployPreparationUploadBinding,
): WorkerDeployPreparationHandle {
  if (
    !SHA256_PATTERN.test(uploadEvidence.workerDeployPreparationSha256) ||
    uploadEvidence.workerDeployPreparationSha256 !== handle.sha256
  ) {
    throw new Error(
      "Worker candidate upload does not bind the exact deploy preparation SHA-256.",
    );
  }
  const preparedAtMs = canonicalTimestampMs(
    handle.artifact.createdAt,
    "preparation createdAt",
  );
  const validUntilMs = canonicalTimestampMs(
    handle.artifact.validUntil,
    "preparation validUntil",
  );
  const uploadCreatedAtMs = canonicalTimestampMs(
    uploadEvidence.createdAt,
    "upload evidence createdAt",
  );
  if (
    validUntilMs !== preparedAtMs + WORKER_DEPLOY_PREPARATION_MAX_AGE_MS ||
    uploadCreatedAtMs < preparedAtMs ||
    uploadCreatedAtMs > validUntilMs
  ) {
    throw new Error(
      "Worker candidate upload was not created inside the exact deploy preparation eligibility interval.",
    );
  }
  return handle;
}

function readCurrentWorkerDeployPreparation(
  context: ReturnType<typeof preparationContext>,
  validation: WorkerDeployPreparationHandle["validation"],
) {
  const trustAcceptance = context.dependencies.readTrustAcceptance(
    context.cwd,
    context.backupDirectory,
  );
  const deployArtifacts = context.dependencies.buildDeployArtifacts(context.cwd);
  const evidenceFiles = fingerprintPreparationEvidenceFiles({
    cwd: context.cwd,
    backupDirectory: context.backupDirectory,
  });
  const expectedPath = preparationArtifactPathFromBindings({
    backupDirectory: context.backupDirectory,
    sourceFingerprintSha256: deployArtifacts.sourceFingerprint.sha256,
    assetManifestSha256: deployArtifacts.assetManifest.sha256,
    evidenceFilesSha256: evidenceFilesSha256(evidenceFiles),
  });
  const payload = readPrivatePreparationArtifact(expectedPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch (error) {
    throw new Error("Worker deploy preparation artifact is not valid JSON.", {
      cause: error,
    });
  }
  const artifact = validatePreparationArtifact(parsed);
  if (
    preparationArtifactPath(context.backupDirectory, artifact) !== expectedPath
  ) {
    throw new Error(
      "Worker deploy preparation artifact is stored under the wrong exact binding path.",
    );
  }
  const handle: WorkerDeployPreparationHandle = {
    path: expectedPath,
    bytes: payload.byteLength,
    sha256: sha256(payload),
    validation,
    artifact,
  };
  assertPreparationAcceptanceMatchesRelease(artifact, trustAcceptance);

  return { handle, deployArtifacts } as const;
}

function assertCurrentWorkerDeployPreparationState(input: {
  context: ReturnType<typeof preparationContext>;
  handle: WorkerDeployPreparationHandle;
  deployArtifacts: WorkerDeployArtifactEvidence;
  staticValidationNowMs: number;
}) {
  const { context, handle, deployArtifacts } = input;
  const artifact = handle.artifact;
  assertWorkerDeployPreparationBoundStateUnchanged({
    handle,
    cwd: context.cwd,
    backupDirectory: context.backupDirectory,
    dependencies: context.dependencies,
  });
  const resources = context.dependencies.inspectResources(context.cwd);
  if (
    !resources.ok ||
    sha256(stableStringify(resources)) !==
      artifact.resourceInspection.canonicalSha256
  ) {
    throw new Error(
      "Worker deploy preparation resource inspection no longer matches the sealed release.",
    );
  }
  const staticRelease = context.dependencies.validateStaticRelease(context.cwd, {
    nowMs: input.staticValidationNowMs,
    maxAgeMs: WORKER_DEPLOY_PREPARATION_MAX_AGE_MS,
  });
  assertStaticReleaseMatchesDeployArtifacts(staticRelease, deployArtifacts);
  if (
    stableStringify(translationAssetBinding(staticRelease)) !==
    stableStringify(artifact.translationAssets)
  ) {
    throw new Error(
      "Worker deploy preparation translation/static release binding changed.",
    );
  }
  return handle;
}

export function assertWorkerDeployPreparationBoundStateUnchanged(input: {
  handle: WorkerDeployPreparationHandle;
  cwd?: string;
  backupDirectory?: string;
  dependencies?: Partial<WorkerDeployPreparationDependencies>;
}): WorkerDeployPreparationHandle {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const backupDirectory = path.resolve(
    input.backupDirectory ?? resolveBackupDir(),
  );
  const dependencies = resolveDependencies(input.dependencies);
  const artifact = input.handle.artifact;
  if (artifact.backupDirectory !== backupDirectory) {
    throw new Error(
      "Worker deploy preparation is bound to a different backup directory.",
    );
  }
  const git = dependencies.readGitIdentity(cwd);
  if (stableStringify(git) !== stableStringify(artifact.git)) {
    throw new Error(
      "Worker deploy preparation Git release identity no longer matches.",
    );
  }
  const trustAcceptance = dependencies.readTrustAcceptance(
    cwd,
    backupDirectory,
  );
  assertPreparationAcceptanceMatchesRelease(artifact, trustAcceptance);
  const deployArtifacts = dependencies.buildDeployArtifacts(cwd);
  assertWorkerDeployPreparationMatchesArtifacts(input.handle, deployArtifacts);
  const evidenceFiles = fingerprintPreparationEvidenceFiles({
    cwd,
    backupDirectory,
  });
  if (
    stableStringify(evidenceFiles) !== stableStringify(artifact.evidenceFiles) ||
    evidenceFilesSha256(evidenceFiles) !== artifact.evidenceFilesSha256
  ) {
    throw new Error(
      "Worker deploy preparation bound local evidence files changed.",
    );
  }
  validateBoundEvidenceReportContents(artifact, cwd);
  return input.handle;
}

export function assertWorkerDeployPreparationMatchesArtifacts(
  handle: WorkerDeployPreparationHandle,
  actual: WorkerDeployArtifactEvidence,
): WorkerDeployPreparationHandle {
  const expected = handle.artifact;
  const matches =
    expected.sourceFingerprint.sha256 ===
      actual.sourceFingerprint.sha256 &&
    expected.sourceFingerprint.fileCount ===
      actual.sourceFingerprint.fileCount &&
    expected.deployArtifacts.workerSourceSha256 ===
      actual.workerSourceSha256 &&
    expected.deployArtifacts.wranglerConfigSha256 ===
      actual.wranglerConfigSha256 &&
    sameAssetManifest(
      expected.deployArtifacts.assetManifest,
      actual.assetManifest,
    );
  if (!matches) {
    throw new Error(
      "Worker deploy preparation does not match the exact current source, Worker, configuration, and Static Assets.",
    );
  }
  return handle;
}

function preparationContext(options: WorkerDeployPreparationOptions) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDirectory = path.resolve(
    options.backupDirectory ?? resolveBackupDir(),
  );
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Worker deploy preparation clock is invalid.");
  }
  return {
    cwd,
    backupDirectory,
    now,
    dependencies: resolveDependencies(options.dependencies),
  };
}

function resolveDependencies(
  overrides?: Partial<WorkerDeployPreparationDependencies>,
): WorkerDeployPreparationDependencies {
  return { ...defaultDependencies, ...overrides };
}

function translationAssetBinding(
  release: StaticMarketingAssetReleaseValidation,
): WorkerDeployPreparationArtifact["translationAssets"] {
  return {
    materializationCreatedAt: release.createdAt,
    buildId: release.buildId,
    outputSha256: release.outputSha256,
    generatedPaths: release.generatedPaths,
    legacyTranslationPaths: release.legacyTranslationPaths,
    mainAppTranslationPaths: release.mainAppTranslationPaths,
    siteTranslationPaths: release.siteTranslationPaths,
    incompleteTranslationPaths: 0,
    translationAvailabilitySha256: release.translationAvailabilitySha256,
    localizedHtmlDocuments: release.localizedHtmlDocuments,
    localizedHtmlPathsSha256: release.localizedHtmlPathsSha256,
    assetManifest: release.assetManifest,
  };
}

function assertStaticReleaseMatchesDeployArtifacts(
  release: StaticMarketingAssetReleaseValidation,
  deployArtifacts: WorkerDeployArtifactEvidence,
) {
  if (!sameAssetManifest(release.assetManifest, deployArtifacts.assetManifest)) {
    throw new Error(
      "Worker deploy preparation Static Asset release and deploy manifest differ.",
    );
  }
}

function sameAssetManifest(
  left: WorkerDeployArtifactEvidence["assetManifest"],
  right: WorkerDeployArtifactEvidence["assetManifest"],
) {
  return (
    left.root === right.root &&
    left.fileCount === right.fileCount &&
    left.bytes === right.bytes &&
    left.sha256 === right.sha256
  );
}

function validatePreparationArtifact(
  value: unknown,
): WorkerDeployPreparationArtifact {
  const parsed = workerDeployPreparationArtifactSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Worker deploy preparation artifact has an invalid schema: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function assertPreparationArtifactInvariants(input: {
  artifact: WorkerDeployPreparationArtifact;
  cwd: string;
  backupDirectory: string;
  nowMs: number;
}) {
  assertPreparationArtifactStructuralInvariants(input);
  const artifact = input.artifact;
  const createdAtMs = canonicalTimestampMs(
    artifact.createdAt,
    "preparation createdAt",
  );
  const validUntilMs = canonicalTimestampMs(
    artifact.validUntil,
    "preparation validUntil",
  );
  const ageMs = input.nowMs - createdAtMs;
  if (
    ageMs < 0 ||
    input.nowMs > validUntilMs ||
    ageMs > WORKER_DEPLOY_PREPARATION_MAX_AGE_MS
  ) {
    throw new Error(
      "Worker deploy preparation is stale, from the future, or not bound to the exact workspace, backup, and validity interval.",
    );
  }
}

function assertPreparationArtifactStructuralInvariants(input: {
  artifact: WorkerDeployPreparationArtifact;
  cwd: string;
  backupDirectory: string;
}) {
  const artifact = input.artifact;
  const createdAtMs = canonicalTimestampMs(
    artifact.createdAt,
    "preparation createdAt",
  );
  const validUntilMs = canonicalTimestampMs(
    artifact.validUntil,
    "preparation validUntil",
  );
  const acceptedAtMs = canonicalTimestampMs(
    artifact.trustBoundaryAcceptance.acceptedAt,
    "trust acceptance acceptedAt",
  );
  if (
    artifact.backupDirectory !== input.backupDirectory ||
    artifact.deployArtifacts.assetManifest.root !==
      path.join(input.cwd, ".open-next/assets") ||
    validUntilMs !== createdAtMs + WORKER_DEPLOY_PREPARATION_MAX_AGE_MS ||
    acceptedAtMs > createdAtMs
  ) {
    throw new Error(
      "Worker deploy preparation is not bound to the exact prior trust acceptance, workspace, backup, and validity interval.",
    );
  }
  if (
    artifact.trustBoundaryAcceptance.gitHead !== artifact.git.head ||
    artifact.trustBoundaryAcceptance.backupDirectorySha256 !==
      sha256(artifact.backupDirectory) ||
    artifact.trustBoundaryAcceptance.sourceFingerprintSha256 !==
      artifact.sourceFingerprint.sha256 ||
    artifact.trustBoundaryAcceptance.sourceFingerprintFileCount !==
      artifact.sourceFingerprint.fileCount
  ) {
    throw new Error(
      "Worker deploy preparation trust acceptance is not bound to its exact Git and source identity.",
    );
  }
  assertEvidenceFileSequence(artifact.evidenceFiles);
  if (
    evidenceFilesSha256(artifact.evidenceFiles) !==
    artifact.evidenceFilesSha256
  ) {
    throw new Error(
      "Worker deploy preparation evidence-file aggregate is invalid.",
    );
  }
  const expectedPath = preparationArtifactPath(
    input.backupDirectory,
    artifact,
  );
  assertPathInside(
    path.join(
      input.backupDirectory,
      WORKER_DEPLOY_PREPARATION_DIRECTORY_RELATIVE_PATH,
    ),
    expectedPath,
    "preparation artifact",
  );
}

function assertPreparationAcceptanceMatchesRelease(
  artifact: WorkerDeployPreparationArtifact,
  acceptance: ProductionTrustBoundaryAcceptanceHandle,
) {
  assertProductionTrustBoundaryAcceptanceBinding(
    artifact.trustBoundaryAcceptance,
    acceptance,
  );
  if (
    artifact.trustBoundaryAcceptance.gitHead !== artifact.git.head ||
    artifact.trustBoundaryAcceptance.sourceFingerprintSha256 !==
      artifact.sourceFingerprint.sha256 ||
    artifact.trustBoundaryAcceptance.sourceFingerprintFileCount !==
      artifact.sourceFingerprint.fileCount
  ) {
    throw new Error(
      "Worker deploy preparation trust acceptance does not match the exact release source.",
    );
  }
}

function validateBoundEvidenceReportContents(
  artifact: WorkerDeployPreparationArtifact,
  cwd: string,
) {
  const reports = new Map(
    artifact.evidenceFiles.map((entry) => [
      entry.relativePath,
      readBoundJson(entry, artifact.backupDirectory, cwd),
    ]),
  );
  const local = requireRecord(
    reports.get("cloudflare/local-gates-report.json"),
    "local gates report",
  );
  const preview = requireRecord(
    reports.get(PREVIEW_E2E_EVIDENCE_RELATIVE_PATH),
    "live preview E2E report",
  );
  const source = requireRecord(
    reports.get("cloudflare/source-secret-scan-report.json"),
    "source secret report",
  );
  const build = requireRecord(
    reports.get("cloudflare/build-artifact-scan-report.json"),
    "build artifact report",
  );
  const preparedAtMs = Date.parse(artifact.createdAt);
  for (const [label, report] of [
    ["local gates", local],
    ["live preview E2E", preview],
    ["source secret scan", source],
    ["build artifact scan", build],
  ] as const) {
    const reportCreatedAt = requireString(report.createdAt, `${label} createdAt`);
    const reportCreatedAtMs = canonicalTimestampMs(
      reportCreatedAt,
      `${label} createdAt`,
    );
    if (
      report.ok !== true ||
      path.resolve(requireString(report.backupDir, `${label} backupDir`)) !==
        artifact.backupDirectory ||
      preparedAtMs - reportCreatedAtMs < 0 ||
      preparedAtMs - reportCreatedAtMs > 60 * 60 * 1_000
    ) {
      throw new Error(
        `Worker deploy preparation ${label} was not a fresh passing report at seal time.`,
      );
    }
  }

  validatePreviewE2EEvidence({
    value: preview,
    backupDirectory: artifact.backupDirectory,
    sourceFingerprint: artifact.sourceFingerprint,
    nowMs: preparedAtMs,
    maxAgeMs: PREVIEW_E2E_EVIDENCE_MAX_AGE_MS,
  });

  const localFingerprint = requireRecord(
    local.sourceFingerprintAfter,
    "local gates source fingerprint",
  );
  const sourceFingerprint = requireRecord(
    source.sourceFingerprint,
    "source secret source fingerprint",
  );
  const buildFingerprint = requireRecord(
    build.sourceFingerprint,
    "build artifact source fingerprint",
  );
  for (const [label, fingerprint] of [
    ["local gates", localFingerprint],
    ["source secret scan", sourceFingerprint],
    ["build artifact scan", buildFingerprint],
  ] as const) {
    if (
      fingerprint.sha256 !== artifact.sourceFingerprint.sha256 ||
      fingerprint.fileCount !== artifact.sourceFingerprint.fileCount
    ) {
      throw new Error(
        `Worker deploy preparation ${label} has the wrong source fingerprint.`,
      );
    }
  }
  if (local.sourceFingerprintStable !== true) {
    throw new Error(
      "Worker deploy preparation local gates did not prove a stable source fingerprint.",
    );
  }
  const results = Array.isArray(local.results) ? local.results : [];
  const resultRecords = results.map((result) =>
    requireRecord(result, "local gate result"),
  );
  const resultsById = new Map(
    resultRecords.map((result) => [result.id, result.ok]),
  );
  if (
    resultRecords.length !== LOCAL_GATE_IDS.length ||
    resultsById.size !== LOCAL_GATE_IDS.length ||
    !LOCAL_GATE_IDS.every((id) => resultsById.get(id) === true)
  ) {
    throw new Error(
      "Worker deploy preparation local gate report is incomplete or failed.",
    );
  }
  if (!Array.isArray(source.findings) || source.findings.length !== 0) {
    throw new Error(
      "Worker deploy preparation source secret scan contains findings.",
    );
  }
  if (
    build.artifactRoot !== ".open-next" ||
    build.nextEnvFile !== ".open-next/cloudflare/next-env.mjs" ||
    typeof build.scannedFiles !== "number" ||
    !Number.isSafeInteger(build.scannedFiles) ||
    build.scannedFiles <= 0 ||
    !Array.isArray(build.findings) ||
    build.findings.length !== 0
  ) {
    throw new Error(
      "Worker deploy preparation build artifact scan is incomplete or contains findings.",
    );
  }
}

function fingerprintPreparationEvidenceFiles(input: {
  cwd: string;
  backupDirectory: string;
}): WorkerDeployPreparationArtifact["evidenceFiles"] {
  return PREPARATION_EVIDENCE_FILES.map((definition) => {
    const root =
      definition.scope === "backup" ? input.backupDirectory : input.cwd;
    const absolutePath = path.join(root, definition.relativePath);
    const body = readBoundEvidenceFile(
      absolutePath,
      definition.private,
      root,
    );
    return {
      ...definition,
      bytes: body.byteLength,
      sha256: sha256(body),
    };
  });
}

function evidenceFilesSha256(
  files: WorkerDeployPreparationArtifact["evidenceFiles"],
) {
  return sha256(stableStringify(files));
}

function assertEvidenceFileSequence(
  files: WorkerDeployPreparationArtifact["evidenceFiles"],
) {
  for (const [index, expected] of PREPARATION_EVIDENCE_FILES.entries()) {
    const actual = files[index];
    if (
      !actual ||
      actual.scope !== expected.scope ||
      actual.relativePath !== expected.relativePath ||
      actual.private !== expected.private
    ) {
      throw new Error(
        "Worker deploy preparation has the wrong evidence-file sequence.",
      );
    }
  }
}

function preparationArtifactPath(
  backupDirectory: string,
  artifact: WorkerDeployPreparationArtifact,
) {
  return preparationArtifactPathFromBindings({
    backupDirectory,
    sourceFingerprintSha256: artifact.sourceFingerprint.sha256,
    assetManifestSha256: artifact.deployArtifacts.assetManifest.sha256,
    evidenceFilesSha256: artifact.evidenceFilesSha256,
  });
}

function preparationArtifactPathFromBindings(input: {
  backupDirectory: string;
  sourceFingerprintSha256: string;
  assetManifestSha256: string;
  evidenceFilesSha256: string;
}) {
  const directory = path.join(
    input.backupDirectory,
    WORKER_DEPLOY_PREPARATION_DIRECTORY_RELATIVE_PATH,
  );
  return path.join(
    directory,
    `worker-deploy-preparation-${input.sourceFingerprintSha256}-${input.assetManifestSha256}-${input.evidenceFilesSha256}.json`,
  );
}

function publishPreparationArtifact(filePath: string, payload: Buffer) {
  const directory = path.dirname(filePath);
  const backupCloudflareDirectory = path.dirname(directory);
  const backupDirectory = path.dirname(backupCloudflareDirectory);
  assertRealDirectory(backupDirectory, "backup directory");
  cloudflareDir(backupDirectory);
  assertRealDirectory(backupCloudflareDirectory, "backup Cloudflare directory");
  try {
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }
  const directoryStat = assertRealDirectory(
    directory,
    "deploy preparation directory",
  );
  if ((directoryStat.mode & 0o777) !== 0o700) {
    throw new Error(
      "Worker deploy preparation directory must be owner-only mode 0700.",
    );
  }

  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeFileSync(fileDescriptor, payload);
    fs.fsyncSync(fileDescriptor);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  } finally {
    if (fileDescriptor !== null) fs.closeSync(fileDescriptor);
  }
  fsyncDirectory(directory);
}

function readPrivatePreparationArtifact(filePath: string) {
  return readStableRegularFile({
    filePath,
    root: path.dirname(filePath),
    private: true,
    maximumBytes: MAX_PREPARATION_ARTIFACT_BYTES,
    label: "Worker deploy preparation artifact",
  });
}

function readBoundEvidenceFile(
  filePath: string,
  privateFile: boolean,
  root: string,
) {
  return readStableRegularFile({
    filePath,
    root,
    private: privateFile,
    maximumBytes: MAX_BOUND_EVIDENCE_FILE_BYTES,
    label: "Worker deploy preparation bound evidence",
  });
}

function readStableRegularFile(input: {
  filePath: string;
  root: string;
  private: boolean;
  maximumBytes: number;
  label: string;
}) {
  const resolvedRoot = path.resolve(input.root);
  const resolvedPath = path.resolve(input.filePath);
  assertPathInside(resolvedRoot, resolvedPath, input.label);
  const named = fs.lstatSync(resolvedPath);
  assertSafeFileMetadata(named, input);
  const descriptor = fs.openSync(
    resolvedPath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const before = fs.fstatSync(descriptor);
    assertSafeFileMetadata(before, input);
    if (named.dev !== before.dev || named.ino !== before.ino) {
      throw new Error(`${input.label} changed during nofollow open.`);
    }
    const body = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      body.byteLength !== before.size
    ) {
      throw new Error(`${input.label} changed during read.`);
    }
    return body;
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSafeFileMetadata(
  stat: fs.Stats,
  input: {
    private: boolean;
    maximumBytes: number;
    label: string;
  },
) {
  const ownerOk =
    typeof process.getuid !== "function" || stat.uid === process.getuid();
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    !ownerOk ||
    !Number.isSafeInteger(stat.size) ||
    stat.size <= 0 ||
    stat.size > input.maximumBytes ||
    (input.private && (stat.mode & 0o777) !== 0o600)
  ) {
    throw new Error(
      `${input.label} has unsafe type, ownership, mode, link count, or size.`,
    );
  }
}

function readBoundJson(
  entry: WorkerDeployPreparationArtifact["evidenceFiles"][number],
  backupDirectory: string,
  cwd: string,
) {
  const root = entry.scope === "backup" ? backupDirectory : cwd;
  const body = readBoundEvidenceFile(
    path.join(root, entry.relativePath),
    entry.private,
    root,
  );
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Worker deploy preparation bound evidence is invalid JSON: ${entry.relativePath}.`,
      { cause: error },
    );
  }
}

function assertRealDirectory(directory: string, label: string) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Worker deploy preparation ${label} must be a real directory.`);
  }
  return stat;
}

function assertPathInside(root: string, candidate: string, label: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Worker deploy preparation ${label} escaped its root.`);
  }
}

function canonicalNow(value: Date, label: string) {
  const time = value.getTime();
  if (!Number.isFinite(time)) {
    throw new Error(`Worker deploy ${label} clock is invalid.`);
  }
  return new Date(time).toISOString();
}

function canonicalTimestampMs(value: string, label: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new Error(`Worker deploy ${label} must be a canonical ISO timestamp.`);
  }
  return time;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const parsed = unknownRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Worker deploy preparation ${label} must be an object.`);
  }
  return parsed.data;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) {
    throw new Error(`Worker deploy preparation ${label} must be a string.`);
  }
  return value;
}

function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "EEXIST"
  );
}
