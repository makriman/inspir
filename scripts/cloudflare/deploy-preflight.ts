import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { supportedLanguages } from "../../lib/content/languages";
import {
  getPublishedLegacySiteTranslationPairs,
  legacyTranslationAssetPath,
} from "../../lib/i18n/legacy-api-compat";
import { parseConfiguredGlobalDailyCallLimit } from "../../lib/free-runtime/global-ai-budget";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  MEMORY_POST_TURN_DLQ_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  PROFILE_IMAGES_R2_BUCKET_NAME,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  commandEnv,
  resolveBackupDir,
} from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import { freshBackupScopedReportBlockers } from "./fresh-report-gate";
import { assertGitReleaseIdentity } from "./git-release-identity";
import {
  RUNTIME_MIGRATION_EVIDENCE_KIND,
  RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
  RUNTIME_MIGRATION_FILES,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
} from "./verify-d1-runtime-migrations";
import {
  RUNTIME_MIGRATION_0017_CHECK_ID,
  RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
  RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH,
} from "./verify-d1-runtime-migration-0017";
import { RUNTIME_MIGRATION_0017_FILE } from "./check-d1-runtime-migration-0017-budget";
import {
  readAndValidateHistoricalFresh0016CutoverComplete,
  type HistoricalFresh0016ValidatedCutoverArtifactHandle,
} from "./verify-historical-data-fresh-0016-cutover-chain";
import {
  STATIC_ASSET_RELEASE_FILE_LIMIT,
  validateStaticMarketingAssetRelease,
} from "./materialize-static-marketing-assets";
import {
  LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
  assertLongTailPromotionSnapshotTransactionRootSettled,
} from "../long-tail-promotion-snapshot";
import {
  TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_CHECK_NAME,
  readAndValidateTranslationSemanticReleaseAttestation,
} from "../translation-semantic-release-attestation";
import {
  readAndValidateCurrentTranslationFallbackReleaseAttestation,
  type CurrentTranslationFallbackReleaseAttestationHandle,
} from "../staged-translation-fallback-release-attestation";
import {
  SITE_SOURCE_MANIFEST_FRESHNESS_CHECK_NAME,
  assertCurrentSiteSourceManifestFreshness,
  type SiteSourceManifestFreshnessValidation,
} from "../verify-site-source-manifest";
import {
  WORKER_DEPLOY_PREPARATION_CHECK_NAME,
  WORKER_DEPLOY_PREPARATION_MAX_AGE_MS,
  assertWorkerDeployPreparationBoundStateUnchanged,
  readAndValidateWorkerDeployPreparation,
  readAndValidateWorkerDeployPreparationProvenance,
  type WorkerDeployPreparationHandle,
} from "./worker-deploy-preparation";
import {
  PREVIEW_E2E_CHECK_NAME,
  readAndValidatePreviewE2EEvidence,
} from "./preview-e2e-evidence";
import {
  parseWorkerDeploymentStatusOutput,
  parseWorkerVersionViewOutput,
  readWorkerCandidateUploadEvidence,
  readWorkerCandidateStagedEvidence,
  workerCandidateUploadEvidencePath,
  workerCandidateStagedEvidencePath,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateStagedEvidence,
} from "./worker-candidate-release-evidence";

type CheckStatus = "pass" | "fail";

export type DeployPreflightCheck = {
  name: string;
  status: CheckStatus;
  detail?: unknown;
};

type LocalGatesReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  sourceFingerprintAfter?: SourceFingerprint;
  sourceFingerprintStable?: boolean;
  results?: Array<{ id?: string; ok?: boolean }>;
};

type SourceSecretScanReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  sourceFingerprint?: {
    sha256?: string;
    fileCount?: number;
  };
  findings?: unknown[];
};

type BuildArtifactScanReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  sourceFingerprint?: SourceFingerprint;
  artifactRoot?: string;
  nextEnvFile?: string | null;
  scannedFiles?: number;
  findings?: unknown[];
};

type RuntimeMigrationEvidenceReport = {
  kind?: string;
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  database?: string;
  migrations?: string[];
  sourceFingerprintBefore?: SourceFingerprint;
  sourceFingerprint?: SourceFingerprint;
  sourceFingerprintStable?: boolean;
  rowsWritten?: number;
  totalAttempts?: number | null;
  checks?: Array<{ id?: string; ok?: boolean }>;
};

type RuntimeMigration0017EvidenceReport = {
  kind?: string;
  schemaVersion?: number;
  ok?: boolean;
  state?: string;
  createdAt?: string;
  backupDir?: string;
  database?: string;
  migration?: string;
  sourceFingerprintBefore?: SourceFingerprint;
  sourceFingerprint?: SourceFingerprint;
  sourceFingerprintStable?: boolean;
  rowsWritten?: number;
  totalAttempts?: number | null;
  checks?: Array<{
    id?: string;
    ok?: boolean;
    detail?: { state?: string };
  }>;
};

export type DeployPreflightReport = {
  createdAt: string;
  backupDir: string;
  mode: "steady-state";
  workerTopologyPhase: DeployPreflightWorkerTopologyPhase;
  ok: boolean;
  checks: DeployPreflightCheck[];
};

export type DeployPreflightWorkerTopologyPhase =
  | "baseline-sole-active"
  | "candidate-staged"
  | "candidate-active";

type RemoteWranglerReadResult = Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
}>;

export type SemanticReleaseAttestationValidation = Readonly<{
  path: string;
  sha256: string;
  curatedTreeSha256: string;
  semanticEvidenceSha256: string;
}>;

export type StagedFallbackReleaseAttestationValidation = Readonly<{
  path: string;
  sha256: string;
  attestationKind: string;
  sitePromotionMode: "none-current-availability";
  curatedTreeSha256: string;
  staticMainAppTreeSha256: string;
  availabilityManifestSha256: string;
  localizedHtmlPathsSha256: string;
  pendingLedgerSha256: string;
}>;

const REQUIRED_SECRET_KEYS = [
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "ADMIN_EMAILS",
  "CRON_SECRET",
];

const REQUIRED_WRANGLER_VARS = [
  "APP_URL",
  "AUTH_URL",
  "BETTER_AUTH_URL",
  "CLOUDFLARE_AI_GATEWAY_BASE_URL",
  "CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS",
  "OPENAI_MODEL",
  "OPENAI_FAST_MODEL",
  "OPENAI_REASONING_MODEL",
  "OPENAI_STRUCTURED_MODEL",
  "OPENAI_EMBEDDING_MODEL",
  "RATE_LIMIT_USER_CHAT_DAILY",
  "RATE_LIMIT_GUEST_SESSION_DAILY",
  "RATE_LIMIT_GUEST_FINGERPRINT_DAILY",
  "RATE_LIMIT_GUEST_IP_DAILY",
  "RATE_LIMIT_ACTIVITY_DAILY",
  "RATE_LIMIT_MEMORY_DAILY",
  "LLM_GLOBAL_DAILY_CALL_LIMIT",
  "MEMORY_POST_TURN_SYNTHESIS_THRESHOLD",
  "MEMORY_PROFILE_COMPILE_LIMIT",
  "OBSERVABILITY_INCIDENT_MODE",
  "APP_WRITE_FREEZE",
  "APP_WRITE_FREEZE_RETRY_AFTER_SECONDS",
];

const SECRET_KEYS_THAT_MUST_NOT_BE_VARS = [
  "OPENAI_API_KEY",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "AUTH_SECRET",
  "AUTH_GOOGLE_SECRET",
  "CRON_SECRET",
];
const STEADY_STATE_REPORT_MAX_AGE_MS = 60 * 60 * 1000;
const FRESH_0016_CUTOVER_COMPLETION_MAX_AGE_MS = 60 * 60 * 1000;
const STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH =
  ".open-next/static-marketing-assets-report.json";
const EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS = {
  total: 280,
  mainApp: 70,
  site: 210,
  complete: 280,
  incomplete: 0,
} as const;
const EXPECTED_LEGACY_MAIN_APP_TRANSLATION_PATHS = supportedLanguages.map((language) =>
  legacyTranslationAssetPath({ kind: "main-app", language }),
);
const EXPECTED_LEGACY_SITE_TRANSLATION_PATHS = getPublishedLegacySiteTranslationPairs().map(
  ({ language, namespace }) =>
    legacyTranslationAssetPath({ kind: "site", language, namespace }),
);
const EXPECTED_LEGACY_TRANSLATION_PATHS = [
  ...EXPECTED_LEGACY_MAIN_APP_TRANSLATION_PATHS,
  ...EXPECTED_LEGACY_SITE_TRANSLATION_PATHS,
].sort();
const EXPECTED_LEGACY_TRANSLATION_PATH_SET = new Set(
  EXPECTED_LEGACY_TRANSLATION_PATHS,
);

export const FREE_PLAN_WORKER_FIRST_ROUTES = [
  "!/_next/static/*",
  "/api/account/topics",
  "/api/activities/flashcards",
  "/api/activities/flashcards/*",
  "/api/activities/quiz",
  "/api/activities/quiz/*",
  "/api/admin/dashboard",
  "/api/admin/topics",
  "/api/admin/users",
  "/api/analytics/events",
  "/api/auth",
  "/api/auth/*",
  "/api/chat",
  "/api/chat/finalize",
  "/api/chats",
  "/api/chats/*",
  "/api/cron/memory-dreaming",
  "/api/guest-chat",
  "/api/health",
  "/api/language-preference",
  "/api/logout",
  "/api/main-app-translations",
  "/api/migration/e2e-auth",
  "/api/migration/write-freeze",
  "/api/me",
  "/api/me/photo",
  "/api/memory",
  "/api/memory/*",
  "/api/site-translations",
  "/chat/*",
  "/*/chat/*",
] as const;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cli = parseDeployPreflightCli(process.argv.slice(2));
  const backupDir = resolveBackupDir();
  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    workerTopologyPhase: cli.workerTopologyPhase,
  });
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function parseDeployPreflightCli(args: readonly string[]) {
  if (args.length === 0) {
    return Object.freeze({
      workerTopologyPhase: "baseline-sole-active" as const,
    });
  }
  if (
    args.length !== 2 ||
    args[0] !== "--worker-topology-phase" ||
    (args[1] !== "candidate-staged" && args[1] !== "candidate-active")
  ) {
    throw new Error(
      "Deploy preflight accepts only --worker-topology-phase candidate-staged|candidate-active.",
    );
  }
  return Object.freeze({ workerTopologyPhase: args[1] });
}

export function buildSteadyStateDeployPreflightReport(options: {
  backupDir: string;
  cwd?: string;
  nowMs?: number;
  runWranglerDryRun?: boolean;
  workerTopologyPhase?: DeployPreflightWorkerTopologyPhase;
  remoteWranglerReader?: (args: readonly string[]) => RemoteWranglerReadResult;
  workerCandidateStagedEvidenceLoader?: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  historicalFresh0016CutoverLoader?: (input: {
    cwd: string;
    backupDirectory: string;
  }) => HistoricalFresh0016ValidatedCutoverArtifactHandle;
  workerDeployPreparationLoader?: (input: {
    cwd: string;
    backupDirectory: string;
    now: Date;
  }) => WorkerDeployPreparationHandle;
  semanticReleaseAttestationValidator?: (input: {
    workspaceRoot: string;
  }) => SemanticReleaseAttestationValidation;
  stagedFallbackReleaseAttestationValidator?: (input: {
    workspaceRoot: string;
  }) => StagedFallbackReleaseAttestationValidation;
  siteSourceManifestFreshnessValidator?: (input: {
    workspaceRoot: string;
  }) => SiteSourceManifestFreshnessValidation;
}): DeployPreflightReport {
  const cwd = options.cwd ?? process.cwd();
  const checks: DeployPreflightCheck[] = [];
  const currentSourceFingerprint = buildRepoSourceFingerprint(cwd);

  checks.push(gitReleaseIdentityCheck(cwd));
  checks.push(longTailPromotionSettlementCheck(cwd));
  checks.push(siteSourceManifestFreshnessCheck(
    cwd,
    options.siteSourceManifestFreshnessValidator,
  ));
  checks.push(semanticReleaseAttestationCheck(
    cwd,
    options.semanticReleaseAttestationValidator,
    options.stagedFallbackReleaseAttestationValidator,
  ));
  const preparation = workerDeployPreparationCheck({
    cwd,
    backupDir: options.backupDir,
    currentSourceFingerprint,
    nowMs: options.nowMs,
    workerTopologyPhase:
      options.workerTopologyPhase ?? "baseline-sole-active",
    loader: options.workerDeployPreparationLoader,
  });
  checks.push(preparation.check);
  const provenancePreparation =
    preparation.handle?.validation === "immutable-upload-provenance"
      ? preparation.handle
      : null;
  const preparationIsUploadProvenance = provenancePreparation !== null;
  const localEvidenceNowMs = provenancePreparation
    ? Date.parse(provenancePreparation.artifact.createdAt)
    : options.nowMs;
  const localEvidenceMaxAgeMs = preparation.handle
    ? preparationIsUploadProvenance
      ? STEADY_STATE_REPORT_MAX_AGE_MS
      : WORKER_DEPLOY_PREPARATION_MAX_AGE_MS
    : STEADY_STATE_REPORT_MAX_AGE_MS;
  checks.push(
    localGatesCheck(
      options.backupDir,
      currentSourceFingerprint,
      localEvidenceNowMs,
      localEvidenceMaxAgeMs,
    ),
  );
  checks.push(
    previewE2ECheck(
      cwd,
      options.backupDir,
      currentSourceFingerprint,
      localEvidenceNowMs,
      localEvidenceMaxAgeMs,
    ),
  );
  checks.push(
    sourceSecretScanCheck(
      options.backupDir,
      currentSourceFingerprint,
      localEvidenceNowMs,
      localEvidenceMaxAgeMs,
    ),
  );
  checks.push(
    buildArtifactScanCheck(
      options.backupDir,
      currentSourceFingerprint,
      localEvidenceNowMs,
      localEvidenceMaxAgeMs,
    ),
  );
  checks.push(
    staticMarketingAssetReleaseCheck(
      cwd,
      localEvidenceNowMs,
      localEvidenceMaxAgeMs,
    ),
  );
  checks.push(runtimeMigrationEvidenceCheck(options.backupDir, currentSourceFingerprint, options.nowMs));
  checks.push(historicalFresh0016CutoverCheck(
    cwd,
    currentSourceFingerprint,
    options.backupDir,
    options.nowMs,
    options.historicalFresh0016CutoverLoader,
  ));
  checks.push(runtimeMigration0017EvidenceCheck(
    options.backupDir,
    currentSourceFingerprint,
    options.nowMs,
  ));
  checks.push(wranglerConfigCheck(cwd));
  checks.push(leanWorkerArchitectureCheck(cwd));

  if (options.runWranglerDryRun !== false) {
    checks.push(remoteDurableObjectInfrastructureCheck({
      backupDir: options.backupDir,
      phase: options.workerTopologyPhase ?? "baseline-sole-active",
      runner: options.remoteWranglerReader,
      stagedEvidenceLoader: options.workerCandidateStagedEvidenceLoader,
    }));
    checks.push(wranglerDeployDryRunCheck());
  }

  return {
    createdAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    backupDir: options.backupDir,
    mode: "steady-state",
    workerTopologyPhase:
      options.workerTopologyPhase ?? "baseline-sole-active",
    ok: checks.every((check) => check.status === "pass"),
    checks,
  };
}

function siteSourceManifestFreshnessCheck(
  cwd: string,
  validator?: (input: {
    workspaceRoot: string;
  }) => SiteSourceManifestFreshnessValidation,
): DeployPreflightCheck {
  try {
    const validate = validator ?? assertCurrentSiteSourceManifestFreshness;
    return {
      name: SITE_SOURCE_MANIFEST_FRESHNESS_CHECK_NAME,
      status: "pass",
      detail: validate({ workspaceRoot: cwd }),
    };
  } catch (error) {
    return {
      name: SITE_SOURCE_MANIFEST_FRESHNESS_CHECK_NAME,
      status: "fail",
      detail: { reason: error instanceof Error ? error.message : String(error) },
    };
  }
}

export function semanticReleaseAttestationCheck(
  cwd: string,
  semanticValidator?: (input: {
    workspaceRoot: string;
  }) => SemanticReleaseAttestationValidation,
  stagedValidator?: (input: {
    workspaceRoot: string;
  }) => StagedFallbackReleaseAttestationValidation,
): DeployPreflightCheck {
  let fullSemanticFailure: string | null = null;
  try {
    const validate = semanticValidator ?? ((input: { workspaceRoot: string }) => {
      const handle = readAndValidateTranslationSemanticReleaseAttestation(input);
      return Object.freeze({
        path: handle.path,
        sha256: handle.sha256,
        curatedTreeSha256: handle.artifact.curatedTree.sha256,
        semanticEvidenceSha256:
          handle.artifact.semanticEvidence.semanticEvidenceSha256,
      });
    });
    return {
      name: TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_CHECK_NAME,
      status: "pass",
      detail: {
        releaseMode: "full-semantic",
        ...validate({ workspaceRoot: cwd }),
      },
    };
  } catch (error) {
    fullSemanticFailure = error instanceof Error ? error.message : String(error);
  }

  try {
    const validate = stagedValidator ?? ((input: { workspaceRoot: string }) =>
      stagedFallbackValidationDetail(
        readAndValidateCurrentTranslationFallbackReleaseAttestation(input),
      ));
    return {
      name: TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_CHECK_NAME,
      status: "pass",
      detail: {
        releaseMode: "staged-canonical-English-fallback",
        ...validate({ workspaceRoot: cwd }),
      },
    };
  } catch (error) {
    return {
      name: TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_CHECK_NAME,
      status: "fail",
      detail: {
        reason: "Neither the full semantic nor staged fallback translation release attestation is valid.",
        fullSemanticFailure,
        stagedFallbackFailure:
          error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function stagedFallbackValidationDetail(
  handle: CurrentTranslationFallbackReleaseAttestationHandle,
): StagedFallbackReleaseAttestationValidation {
  return Object.freeze({
    path: handle.path,
    sha256: handle.sha256,
    attestationKind: handle.artifact.kind,
    sitePromotionMode: "none-current-availability",
    curatedTreeSha256: handle.artifact.inventory.curatedSiteTree.sha256,
    staticMainAppTreeSha256:
      handle.artifact.inventory.staticMainAppTree.sha256,
    availabilityManifestSha256:
      handle.artifact.inventory.availabilityManifest.fileSha256,
    localizedHtmlPathsSha256:
      handle.artifact.inventory.availabilityManifest.localizedHtmlPathsSha256,
    pendingLedgerSha256: handle.artifact.inventory.pendingLedger.sha256,
  });
}

function workerDeployPreparationCheck(input: {
  cwd: string;
  backupDir: string;
  currentSourceFingerprint: SourceFingerprint;
  nowMs?: number;
  workerTopologyPhase: DeployPreflightWorkerTopologyPhase;
  loader?: (input: {
    cwd: string;
    backupDirectory: string;
    now: Date;
  }) => WorkerDeployPreparationHandle;
}): {
  check: DeployPreflightCheck;
  handle: WorkerDeployPreparationHandle | null;
} {
  try {
    const backupDirectory = path.resolve(input.backupDir);
    const now = new Date(input.nowMs ?? Date.now());
    const loader =
      input.loader ??
      ((options: {
        cwd: string;
        backupDirectory: string;
        now: Date;
      }) => {
        if (input.workerTopologyPhase !== "candidate-staged") {
          return readAndValidateWorkerDeployPreparation(options);
        }
        const upload = readWorkerCandidateUploadEvidence(
          workerCandidateUploadEvidencePath(options.backupDirectory),
        );
        return readAndValidateWorkerDeployPreparationProvenance({
          ...options,
          uploadEvidence: upload.value,
        });
      });
    const handle = loader({
      cwd: input.cwd,
      backupDirectory,
      now,
    });
    assertWorkerDeployPreparationBoundStateUnchanged({
      handle,
      cwd: input.cwd,
      backupDirectory,
    });
    const createdAtMs = Date.parse(handle.artifact.createdAt);
    const ageMs = now.getTime() - createdAtMs;
    if (
      (handle.validation !== "existing-sealed-preparation" &&
        handle.validation !== "immutable-upload-provenance") ||
      handle.artifact.backupDirectory !== backupDirectory ||
      handle.artifact.sourceFingerprint.sha256 !==
        input.currentSourceFingerprint.sha256 ||
      handle.artifact.sourceFingerprint.fileCount !==
        input.currentSourceFingerprint.fileCount ||
      !Number.isFinite(createdAtMs) ||
      (handle.validation === "existing-sealed-preparation" &&
        (ageMs < 0 || ageMs > WORKER_DEPLOY_PREPARATION_MAX_AGE_MS)) ||
      (handle.validation === "immutable-upload-provenance" &&
        input.workerTopologyPhase !== "candidate-staged")
    ) {
      throw new Error(
        "Worker deploy preparation is stale, from the future, or not bound to the exact source and backup.",
      );
    }
    return {
      check: {
        name: WORKER_DEPLOY_PREPARATION_CHECK_NAME,
        status: "pass",
        detail: {
          path: handle.path,
          sha256: handle.sha256,
          createdAt: handle.artifact.createdAt,
          validUntil: handle.artifact.validUntil,
          sourceFingerprint: handle.artifact.sourceFingerprint.sha256,
          workerSourceSha256:
            handle.artifact.deployArtifacts.workerSourceSha256,
          wranglerConfigSha256:
            handle.artifact.deployArtifacts.wranglerConfigSha256,
          assetManifestSha256:
            handle.artifact.deployArtifacts.assetManifest.sha256,
          translationOutputSha256:
            handle.artifact.translationAssets.outputSha256,
        },
      },
      handle,
    };
  } catch (error) {
    return {
      check: {
        name: WORKER_DEPLOY_PREPARATION_CHECK_NAME,
        status: "fail",
        detail: {
          reason: error instanceof Error ? error.message : String(error),
        },
      },
      handle: null,
    };
  }
}

function longTailPromotionSettlementCheck(cwd: string): DeployPreflightCheck {
  const transactionRoot = path.join(
    cwd,
    LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
  );
  try {
    const metadata = fs.lstatSync(transactionRoot, { throwIfNoEntry: false });
    if (!metadata) {
      return {
        name: "settled long-tail translation promotion transactions",
        status: "pass",
        detail: { state: "absent", transactionRoot },
      };
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(
        "The long-tail promotion transaction root must be a real directory.",
      );
    }
    assertLongTailPromotionSnapshotTransactionRootSettled({ transactionRoot });
    return {
      name: "settled long-tail translation promotion transactions",
      status: "pass",
      detail: { state: "settled", transactionRoot },
    };
  } catch (error) {
    return {
      name: "settled long-tail translation promotion transactions",
      status: "fail",
      detail: {
        transactionRoot,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function gitReleaseIdentityCheck(cwd: string): DeployPreflightCheck {
  try {
    const identity = assertGitReleaseIdentity({ cwd });
    return {
      name: "clean pushed Git release identity",
      status: "pass",
      detail: identity,
    };
  } catch (error) {
    return {
      name: "clean pushed Git release identity",
      status: "fail",
      detail: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function remoteDurableObjectInfrastructureCheck(options: {
  backupDir: string;
  phase: DeployPreflightWorkerTopologyPhase;
  runner?: (args: readonly string[]) => RemoteWranglerReadResult;
  stagedEvidenceLoader?: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
}): DeployPreflightCheck {
  const runner = options.runner ?? runRemoteWranglerRead;
  try {
    const status = runner([
      "deployments",
      "status",
      "--json",
      "--name",
      "inspirlearning",
    ]);
    if (status.status !== 0) {
      throw new Error(
        `Worker deployment status failed with ${status.status ?? "no exit status"}: ${boundedOutputTail(status)}`,
      );
    }
    const deployment = parseWorkerDeploymentStatusOutput(status.stdout);
    let inspectedVersionId: string;
    let expectedResourceConfigSha256: string | undefined;
    let candidateViewExpectation: Readonly<{
      releaseTag: string;
      releaseMessageSha256: string;
    }> | undefined;
    let releaseIdentity: Readonly<{
      serviceBaselineVersionId: string;
      targetCandidateVersionId: string;
      stagedDeploymentId: string;
      stagedEvidenceSha256: string;
    }> | undefined;

    if (options.phase === "baseline-sole-active") {
      const sole = deployment.versions[0];
      if (
        deployment.versions.length !== 1 ||
        sole?.percentage !== 100
      ) {
        throw new Error(
          "Baseline preflight requires exactly one Worker version at 100% traffic.",
        );
      }
      inspectedVersionId = sole.versionId;
    } else {
      const staged = (
        options.stagedEvidenceLoader ?? readWorkerCandidateStagedEvidence
      )(workerCandidateStagedEvidencePath(options.backupDir));
      const stagedValue = staged.value;
      releaseIdentity = {
        serviceBaselineVersionId: stagedValue.serviceBaselineVersionId,
        targetCandidateVersionId: stagedValue.targetCandidateVersionId,
        stagedDeploymentId: stagedValue.topology.deploymentId,
        stagedEvidenceSha256: staged.sha256,
      };
      expectedResourceConfigSha256 =
        stagedValue.uploadEvidence.versionView.resourceConfigSha256;
      candidateViewExpectation = {
        releaseTag: stagedValue.uploadEvidence.expectedReleaseTag,
        releaseMessageSha256:
          stagedValue.uploadEvidence.expectedReleaseMessageSha256,
      };
      inspectedVersionId = stagedValue.targetCandidateVersionId;

      if (options.phase === "candidate-staged") {
        const percentages = new Map(
          deployment.versions.map((entry) => [
            entry.versionId,
            entry.percentage,
          ]),
        );
        if (
          deployment.deploymentId !== stagedValue.topology.deploymentId ||
          deployment.versions.length !== 2 ||
          percentages.get(stagedValue.serviceBaselineVersionId) !== 100 ||
          percentages.get(stagedValue.targetCandidateVersionId) !== 0
        ) {
          throw new Error(
            "Candidate-staged preflight requires the exact immutable baseline@100 + candidate@0 deployment.",
          );
        }
      } else {
        const sole = deployment.versions[0];
        if (
          deployment.versions.length !== 1 ||
          sole?.versionId !== stagedValue.targetCandidateVersionId ||
          sole.percentage !== 100
        ) {
          throw new Error(
            "Candidate-active preflight requires the exact uploaded candidate alone at 100% traffic.",
          );
        }
      }
    }

    const viewed = runner([
      "versions",
      "view",
      inspectedVersionId,
      "--name",
      "inspirlearning",
      "--json",
    ]);
    if (viewed.status !== 0) {
      throw new Error(
        `Worker version view failed with ${viewed.status ?? "no exit status"}: ${boundedOutputTail(viewed)}`,
      );
    }
    const viewedIdentity = candidateViewExpectation
      ? parseWorkerVersionViewOutput(
        viewed.stdout,
        inspectedVersionId,
        candidateViewExpectation,
      )
      : undefined;
    if (
      expectedResourceConfigSha256 !== undefined &&
      viewedIdentity?.resourceConfigSha256 !== expectedResourceConfigSha256
    ) {
      throw new Error(
        "Candidate Worker resources drifted from immutable upload evidence.",
      );
    }
    const version = parseJsonFromOutput<Record<string, unknown>>(
      viewed.stdout,
      {},
    );
    const resources = objectValue(version.resources);
    const bindings = Array.isArray(resources.bindings)
      ? resources.bindings.filter(
          (binding): binding is Record<string, unknown> =>
            binding !== null &&
            typeof binding === "object" &&
            !Array.isArray(binding),
        )
      : [];
    const queueBinding = bindings.find(
      (binding) => binding.name === "NEXT_CACHE_DO_QUEUE",
    );
    if (
      queueBinding?.type !== "durable_object_namespace" ||
      queueBinding.class_name !== "DOQueueHandler"
    ) {
      throw new Error(
        "Inspected Worker version is missing the exact NEXT_CACHE_DO_QUEUE/DOQueueHandler binding.",
      );
    }
    return {
      name: "post-migration Durable Object infrastructure",
      status: "pass",
      detail: {
        phase: options.phase,
        deploymentId: deployment.deploymentId,
        inspectedVersionId,
        resourceConfigSha256: viewedIdentity?.resourceConfigSha256 ?? null,
        binding: "NEXT_CACHE_DO_QUEUE",
        className: "DOQueueHandler",
        releaseIdentity: releaseIdentity ?? null,
      },
    };
  } catch (error) {
    return {
      name: "post-migration Durable Object infrastructure",
      status: "fail",
      detail: {
        phase: options.phase,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function runRemoteWranglerRead(args: readonly string[]): RemoteWranglerReadResult {
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  const result = spawnSync(wrangler, [...args], {
    cwd: process.cwd(),
    env: commandEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function boundedOutputTail(result: RemoteWranglerReadResult) {
  return `${result.stdout}${result.stderr}`.slice(-2_000);
}

function localGatesCheck(
  backupDir: string,
  currentSourceFingerprint: SourceFingerprint,
  nowMs?: number,
  maxAgeMs = STEADY_STATE_REPORT_MAX_AGE_MS,
): DeployPreflightCheck {
  const report = readBackupJson<LocalGatesReport>(backupDir, "cloudflare/local-gates-report.json");
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/local-gates-report.json",
    report,
    backupDir,
    maxAgeMs,
    nowMs,
    requireOk: true,
  });
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const resultsById = new Map((report?.results ?? []).map((result) => [result.id, result]));
  const missingGateIds = LOCAL_GATE_IDS.filter((id) => !resultsById.has(id));
  const failedGateIds = LOCAL_GATE_IDS.filter((id) => resultsById.get(id)?.ok !== true);
  const sourceFingerprintOk =
    report?.sourceFingerprintStable === true &&
    report.sourceFingerprintAfter?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprintAfter?.fileCount === currentSourceFingerprint.fileCount;
  const ok =
    report?.ok === true &&
    !freshnessBlockers.length &&
    backupDirOk &&
    sourceFingerprintOk &&
    !missingGateIds.length &&
    !failedGateIds.length;
  return {
    name: "local build and test gates",
    status: ok ? "pass" : "fail",
    detail: ok
      ? {
          sourceFingerprint: currentSourceFingerprint.sha256,
          gates: LOCAL_GATE_IDS,
        }
      : {
          reportOk: report?.ok,
          freshnessBlockers,
          backupDirOk,
          sourceFingerprintOk,
          missingGateIds,
          failedGateIds,
          expectedSourceFingerprint: report?.sourceFingerprintAfter?.sha256,
          actualSourceFingerprint: currentSourceFingerprint.sha256,
        },
  };
}

function sourceSecretScanCheck(
  backupDir: string,
  currentSourceFingerprint: SourceFingerprint,
  nowMs?: number,
  maxAgeMs = STEADY_STATE_REPORT_MAX_AGE_MS,
): DeployPreflightCheck {
  const report = readBackupJson<SourceSecretScanReport>(backupDir, "cloudflare/source-secret-scan-report.json");
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/source-secret-scan-report.json",
    report,
    backupDir,
    maxAgeMs,
    nowMs,
    requireOk: true,
  });
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const sourceFingerprintOk =
    report?.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const findings = report?.findings?.length ?? 0;
  const ok = report?.ok === true && !freshnessBlockers.length && backupDirOk && sourceFingerprintOk && findings === 0;
  return {
    name: "source secret scan",
    status: ok ? "pass" : "fail",
    detail: ok
      ? { sourceFingerprint: currentSourceFingerprint.sha256 }
      : {
          reportOk: report?.ok,
          freshnessBlockers,
          backupDirOk,
          sourceFingerprintOk,
          findings,
        },
  };
}

function previewE2ECheck(
  cwd: string,
  backupDir: string,
  currentSourceFingerprint: SourceFingerprint,
  nowMs?: number,
  maxAgeMs = STEADY_STATE_REPORT_MAX_AGE_MS,
): DeployPreflightCheck {
  try {
    const handle = readAndValidatePreviewE2EEvidence({
      cwd,
      backupDirectory: backupDir,
      sourceFingerprint: currentSourceFingerprint,
      nowMs,
      maxAgeMs,
    });
    return {
      name: PREVIEW_E2E_CHECK_NAME,
      status: "pass",
      detail: {
        path: handle.path,
        sha256: handle.sha256,
        createdAt: handle.validation.createdAt,
        sourceFingerprint: handle.validation.sourceFingerprint.sha256,
        totalTests: handle.validation.totalTests,
        requiredPassedTitles: handle.validation.requiredPassedTitles,
        skippedTitles: handle.validation.skippedTitles,
      },
    };
  } catch (error) {
    return {
      name: PREVIEW_E2E_CHECK_NAME,
      status: "fail",
      detail: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function buildArtifactScanCheck(
  backupDir: string,
  currentSourceFingerprint: SourceFingerprint,
  nowMs?: number,
  maxAgeMs = STEADY_STATE_REPORT_MAX_AGE_MS,
): DeployPreflightCheck {
  const report = readBackupJson<BuildArtifactScanReport>(backupDir, "cloudflare/build-artifact-scan-report.json");
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/build-artifact-scan-report.json",
    report,
    backupDir,
    maxAgeMs,
    nowMs,
    requireOk: true,
  });
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const findings = report?.findings?.length ?? 0;
  const scannedFilesOk = typeof report?.scannedFiles === "number" && report.scannedFiles > 0;
  const sourceFingerprintOk =
    report?.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const ok =
    report?.ok === true &&
    !freshnessBlockers.length &&
    backupDirOk &&
    sourceFingerprintOk &&
    report.artifactRoot === ".open-next" &&
    report.nextEnvFile === ".open-next/cloudflare/next-env.mjs" &&
    scannedFilesOk &&
    findings === 0;
  return {
    name: "OpenNext build artifact secret scan",
    status: ok ? "pass" : "fail",
    detail: ok
      ? { nextEnvFile: report?.nextEnvFile, sourceFingerprint: currentSourceFingerprint.sha256 }
      : {
          reportOk: report?.ok,
          freshnessBlockers,
          backupDirOk,
          sourceFingerprintOk,
          expectedSourceFingerprint: report?.sourceFingerprint?.sha256,
          actualSourceFingerprint: currentSourceFingerprint.sha256,
          artifactRoot: report?.artifactRoot,
          nextEnvFile: report?.nextEnvFile,
          scannedFiles: report?.scannedFiles,
          findings,
        },
  };
}

function staticMarketingAssetReleaseCheck(
  cwd: string,
  nowMs?: number,
  maxAgeMs = STEADY_STATE_REPORT_MAX_AGE_MS,
): DeployPreflightCheck {
  const reportPath = path.join(cwd, STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    return {
      name: "Static Asset release and legacy translation report",
      status: "fail",
      detail: {
        reportPath: STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (!isRecord(parsed)) {
    return {
      name: "Static Asset release and legacy translation report",
      status: "fail",
      detail: {
        reportPath: STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH,
        reason: "The materialization report must be a JSON object.",
      },
    };
  }

  const generatedPaths = stringArrayValue(parsed.generatedPaths);
  const safeGeneratedPaths = generatedPaths ?? [];
  const legacyPaths = safeGeneratedPaths.filter((entry) =>
    entry.startsWith("i18n/legacy-api/"),
  );
  const actualLegacyPathSet = new Set(legacyPaths);
  const missingLegacyPaths = EXPECTED_LEGACY_TRANSLATION_PATHS.filter(
    (entry) => !actualLegacyPathSet.has(entry),
  );
  const extraLegacyPaths = [...actualLegacyPathSet]
    .filter((entry) => !EXPECTED_LEGACY_TRANSLATION_PATH_SET.has(entry))
    .sort();
  const duplicateLegacyPaths = duplicateStrings(legacyPaths);
  const incompleteLegacyPaths = [...actualLegacyPathSet]
    .filter((entry) => entry.includes(".incomplete"))
    .sort();
  const manifestCounts = {
    mainApp: EXPECTED_LEGACY_MAIN_APP_TRANSLATION_PATHS.length,
    site: EXPECTED_LEGACY_SITE_TRANSLATION_PATHS.length,
    total: EXPECTED_LEGACY_TRANSLATION_PATHS.length,
    unique: EXPECTED_LEGACY_TRANSLATION_PATH_SET.size,
  };
  const manifestCountsOk =
    manifestCounts.mainApp === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.mainApp &&
    manifestCounts.site === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.site &&
    manifestCounts.total === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.total &&
    manifestCounts.unique === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.total;
  const reportCounts = {
    total: parsed.legacyTranslationApiAssets,
    mainApp: parsed.legacyMainAppTranslationResponses,
    site: parsed.legacySiteTranslationResponses,
    complete: parsed.legacyCompleteTranslationResponses,
    incomplete: parsed.legacyIncompleteTranslationResponses,
  };
  const reportCountsOk =
    reportCounts.total === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.total &&
    reportCounts.mainApp === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.mainApp &&
    reportCounts.site === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.site &&
    reportCounts.complete === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.complete &&
    reportCounts.incomplete === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.incomplete;
  const assetFiles = parsed.assetFiles;
  const assetFileCountOk =
    typeof assetFiles === "number" &&
    Number.isSafeInteger(assetFiles) &&
    assetFiles >= safeGeneratedPaths.length &&
    assetFiles <= STATIC_ASSET_RELEASE_FILE_LIMIT;
  const legacyPathsOk =
    generatedPaths !== null &&
    sameStringSet(legacyPaths, EXPECTED_LEGACY_TRANSLATION_PATHS) &&
    incompleteLegacyPaths.length === 0;
  let releaseValidation: ReturnType<typeof validateStaticMarketingAssetRelease> | null = null;
  let releaseValidationError: string | null = null;
  try {
    releaseValidation = validateStaticMarketingAssetRelease(cwd, {
      nowMs,
      maxAgeMs,
    });
  } catch (error) {
    releaseValidationError = error instanceof Error ? error.message : String(error);
  }
  const actualReleaseTreeOk = releaseValidation !== null;
  const ok =
    manifestCountsOk &&
    reportCountsOk &&
    assetFileCountOk &&
    legacyPathsOk &&
    actualReleaseTreeOk;

  return {
    name: "Static Asset release and legacy translation report",
    status: ok ? "pass" : "fail",
    detail: ok
      ? {
          assetFiles,
          assetFileLimit: STATIC_ASSET_RELEASE_FILE_LIMIT,
          legacyTranslationPaths: legacyPaths.length,
          mainAppTranslationPaths: manifestCounts.mainApp,
          siteTranslationPaths: manifestCounts.site,
          incompleteTranslationPaths: 0,
          translationAvailabilitySha256:
            releaseValidation?.translationAvailabilitySha256,
          localizedHtmlDocuments:
            releaseValidation?.localizedHtmlDocuments,
          localizedHtmlPathsSha256:
            releaseValidation?.localizedHtmlPathsSha256,
          assetManifestBytes: releaseValidation?.assetManifest.bytes,
          assetManifestSha256: releaseValidation?.assetManifest.sha256,
        }
      : {
          reportPath: STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH,
          manifestCounts,
          manifestCountsOk,
          expectedReportCounts: EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS,
          reportCounts,
          reportCountsOk,
          assetFiles,
          assetFileLimit: STATIC_ASSET_RELEASE_FILE_LIMIT,
          assetFileCountOk,
          generatedPathsOk: generatedPaths !== null,
          generatedPathCount: safeGeneratedPaths.length,
          legacyPathCount: legacyPaths.length,
          legacyPathsOk,
          missingLegacyPathCount: missingLegacyPaths.length,
          missingLegacyPaths: missingLegacyPaths.slice(0, 20),
          extraLegacyPathCount: extraLegacyPaths.length,
          extraLegacyPaths: extraLegacyPaths.slice(0, 20),
          duplicateLegacyPathCount: duplicateLegacyPaths.length,
          duplicateLegacyPaths: duplicateLegacyPaths.slice(0, 20),
          incompleteLegacyPathCount: incompleteLegacyPaths.length,
          incompleteLegacyPaths: incompleteLegacyPaths.slice(0, 20),
          actualReleaseTreeOk,
          releaseValidationError,
        },
  };
}

function runtimeMigrationEvidenceCheck(
  backupDir: string,
  currentSourceFingerprint: SourceFingerprint,
  nowMs?: number,
): DeployPreflightCheck {
  const fileSecurity = backupEvidenceFileSecurity(
    backupDir,
    RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
  );
  const report = fileSecurity.ok
    ? readBackupJson<RuntimeMigrationEvidenceReport>(
        backupDir,
        RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
      )
    : null;
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
    report,
    backupDir,
    maxAgeMs: STEADY_STATE_REPORT_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const sourceFingerprintOk =
    report?.sourceFingerprintStable === true &&
    report.sourceFingerprintBefore?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprintBefore?.fileCount === currentSourceFingerprint.fileCount &&
    report.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const migrationsOk = sameStringSequence(report?.migrations ?? [], RUNTIME_MIGRATION_FILES);
  const checksById = new Map((report?.checks ?? []).map((check) => [check.id, check]));
  const requiredChecksOk =
    report?.checks?.length === RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length &&
    checksById.size === RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length &&
    RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.every((id) => checksById.get(id)?.ok === true);
  const reportShapeOk =
    report?.kind === RUNTIME_MIGRATION_EVIDENCE_KIND &&
    report.database === D1_DATABASE_NAME &&
    report.rowsWritten === 0 &&
    report.totalAttempts === 1 &&
    migrationsOk &&
    requiredChecksOk;
  const ok =
    report?.ok === true &&
    freshnessBlockers.length === 0 &&
    fileSecurity.ok &&
    backupDirOk &&
    sourceFingerprintOk &&
    reportShapeOk;
  return {
    name: "D1 runtime migrations 0013-0016",
    status: ok ? "pass" : "fail",
    detail: ok
      ? {
          sourceFingerprint: currentSourceFingerprint.sha256,
          migrations: RUNTIME_MIGRATION_FILES,
          checks: RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
        }
      : {
          reportOk: report?.ok,
          freshnessBlockers,
          fileSecurity,
          backupDirOk,
          sourceFingerprintOk,
          reportShapeOk,
          migrationsOk,
          requiredChecksOk,
          expectedSourceFingerprint: currentSourceFingerprint.sha256,
          actualSourceFingerprint: report?.sourceFingerprint?.sha256,
        },
  };
}

function runtimeMigration0017EvidenceCheck(
  backupDir: string,
  currentSourceFingerprint: SourceFingerprint,
  nowMs?: number,
): DeployPreflightCheck {
  const fileSecurity = backupEvidenceFileSecurity(
    backupDir,
    RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH,
  );
  const report = fileSecurity.ok
    ? readBackupJson<RuntimeMigration0017EvidenceReport>(
        backupDir,
        RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH,
      )
    : null;
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH,
    report,
    backupDir,
    maxAgeMs: STEADY_STATE_REPORT_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const sourceFingerprintOk =
    report?.sourceFingerprintStable === true &&
    report.sourceFingerprintBefore?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprintBefore?.fileCount === currentSourceFingerprint.fileCount &&
    report.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const checks = report?.checks ?? [];
  const check = checks[0];
  const reportShapeOk =
    report?.kind === RUNTIME_MIGRATION_0017_EVIDENCE_KIND &&
    report.schemaVersion === 1 &&
    report.database === D1_DATABASE_NAME &&
    report.migration === RUNTIME_MIGRATION_0017_FILE &&
    report.state === "applied" &&
    report.rowsWritten === 0 &&
    report.totalAttempts === 1 &&
    checks.length === 1 &&
    check?.id === RUNTIME_MIGRATION_0017_CHECK_ID &&
    check.ok === true &&
    check.detail?.state === "applied";
  const ok =
    report?.ok === true &&
    freshnessBlockers.length === 0 &&
    fileSecurity.ok &&
    backupDirOk &&
    sourceFingerprintOk &&
    reportShapeOk;
  return {
    name: "D1 runtime migration 0017 normalized-email index",
    status: ok ? "pass" : "fail",
    detail: ok
      ? {
          sourceFingerprint: currentSourceFingerprint.sha256,
          migration: RUNTIME_MIGRATION_0017_FILE,
          check: RUNTIME_MIGRATION_0017_CHECK_ID,
        }
      : {
          reportOk: report?.ok,
          freshnessBlockers,
          fileSecurity,
          backupDirOk,
          sourceFingerprintOk,
          reportShapeOk,
          expectedSourceFingerprint: currentSourceFingerprint.sha256,
          actualSourceFingerprint: report?.sourceFingerprint?.sha256,
        },
  };
}

function historicalFresh0016CutoverCheck(
  cwd: string,
  currentSourceFingerprint: SourceFingerprint,
  backupDir: string,
  nowMs?: number,
  loader: (input: {
    cwd: string;
    backupDirectory: string;
  }) => HistoricalFresh0016ValidatedCutoverArtifactHandle =
    readAndValidateHistoricalFresh0016CutoverComplete,
): DeployPreflightCheck {
  try {
    const resolvedBackupDir = path.resolve(backupDir);
    const completion = loader({
      cwd,
      backupDirectory: resolvedBackupDir,
    });
    const artifact = completion.artifact;
    const currentTime = nowMs ?? Date.now();
    const createdAtMs = Date.parse(artifact.createdAt);
    const ageMs = currentTime - createdAtMs;
    if (
      completion.validation !== "existing-full-chain" ||
      artifact.paths.backupDirectory !== resolvedBackupDir ||
      artifact.paths.canonicalCompletePath !== completion.path ||
      artifact.sourceFingerprint.sha256 !== currentSourceFingerprint.sha256 ||
      artifact.sourceFingerprint.fileCount !== currentSourceFingerprint.fileCount ||
      artifact.policy.legacyIntervalContinuityProven !== false ||
      artifact.policy.retroactiveContinuityClaimed !== false ||
      artifact.continuity.ok !== true ||
      artifact.continuity.outboxSchemaPresent !== true ||
      artifact.continuity.outboxRowsBeforeActivation !== 0 ||
      !Number.isFinite(createdAtMs) ||
      ageMs < 0 ||
      ageMs > FRESH_0016_CUTOVER_COMPLETION_MAX_AGE_MS
    ) {
      throw new Error(
        "Fresh-0016 canonical completion is stale, from the future, or not bound to the exact accepted source, backup, continuity, and empty-outbox boundary.",
      );
    }
    return {
      name: "fresh-0016 accepted historical trust boundary",
      status: "pass",
      detail: {
        policyId: artifact.policy.id,
        createdAt: artifact.createdAt,
        cutoverRunId: artifact.cutoverRunId,
        sourceFingerprint: artifact.sourceFingerprint.sha256,
        canonicalArtifactSha256: completion.sha256,
        legacyIntervalContinuityProven: false,
        retroactiveContinuityClaimed: false,
        predecessorToSuccessorGapMs:
          artifact.continuity.predecessorToSuccessorGapMs,
      },
    };
  } catch (error) {
    return {
      name: "fresh-0016 accepted historical trust boundary",
      status: "fail",
      detail: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function backupEvidenceFileSecurity(backupDir: string, relativePath: string) {
  const filePath = path.join(backupDir, relativePath);
  try {
    const stat = fs.lstatSync(filePath);
    const mode = stat.mode & 0o777;
    const regularFile = stat.isFile();
    const symlink = stat.isSymbolicLink();
    return {
      ok: regularFile && !symlink && mode === 0o600,
      regularFile,
      symlink,
      mode,
    };
  } catch {
    return { ok: false, regularFile: false, symlink: false, mode: null };
  }
}

function wranglerConfigCheck(cwd: string): DeployPreflightCheck {
  const config = readRepoJson<Record<string, unknown>>(cwd, "wrangler.jsonc");
  const staticRedirectsPath = path.resolve(cwd, "public/_redirects");
  const staticRedirects = fs.existsSync(staticRedirectsPath)
    ? fs.readFileSync(staticRedirectsPath, "utf8")
    : "";
  const vars = objectValue(config.vars);
  const secrets = objectValue(config.secrets);
  const requiredSecrets = Array.isArray(secrets.required) ? secrets.required.filter(isString) : [];
  const d1 = arrayValue(config.d1_databases).find((binding) => binding.binding === "DB");
  const vectorize = arrayValue(config.vectorize).find((binding) => binding.binding === "MEMORY_VECTORIZE");
  const profileImagesR2 = arrayValue(config.r2_buckets).find(
    (binding) => binding.binding === "PROFILE_IMAGES_R2_BUCKET",
  );
  const nextCacheR2 = arrayValue(config.r2_buckets).find(
    (binding) => binding.binding === "NEXT_INC_CACHE_R2_BUCKET",
  );
  const queueProducer = arrayValue(objectValue(config.queues).producers).find(
    (binding) => binding.binding === "MEMORY_POST_TURN_QUEUE",
  );
  const queueConsumer = arrayValue(objectValue(config.queues).consumers).find(
    (binding) => binding.queue === MEMORY_POST_TURN_QUEUE_NAME,
  );
  const services = arrayValue(config.services).find((binding) => binding.binding === "WORKER_SELF_REFERENCE");
  const versionMetadata = objectValue(config.version_metadata);
  const cacheQueueDo = arrayValue(objectValue(config.durable_objects).bindings).find(
    (binding) => binding.name === "NEXT_CACHE_DO_QUEUE",
  );
  const cacheQueueMigration = arrayValue(config.migrations).find((migration) =>
    Array.isArray(migration.new_sqlite_classes) && migration.new_sqlite_classes.includes("DOQueueHandler"),
  );
  const routes = arrayValue(config.routes).map((route) => route.pattern);
  const observability = objectValue(config.observability);
  const configuredCrons = objectValue(config.triggers).crons;
  const assets = objectValue(config.assets);
  const workerFirstRoutes = Array.isArray(assets.run_worker_first)
    ? assets.run_worker_first.filter(isString)
    : [];
  const observabilityLogs = objectValue(observability.logs);
  const observabilityTraces = objectValue(observability.traces);
  const observabilityIncidentMode = vars.OBSERVABILITY_INCIDENT_MODE === "1";
  const observabilitySamplingOk = observabilityIncidentMode
    ? samplingRateAtMost(observability.head_sampling_rate, 1) &&
      samplingRateAtMost(observabilityLogs.head_sampling_rate, 1) &&
      samplingRateAtMost(observabilityTraces.head_sampling_rate, 1)
    : samplingRateAtMost(observability.head_sampling_rate, 0.05) &&
      samplingRateAtMost(observabilityLogs.head_sampling_rate, 0.1) &&
      samplingRateAtMost(observabilityTraces.head_sampling_rate, 0.05);

  const problems = {
    missingVars: REQUIRED_WRANGLER_VARS.filter((key) => vars[key] === undefined || vars[key] === ""),
    globalDailyCallLimitOk:
      parseConfiguredGlobalDailyCallLimit(vars.LLM_GLOBAL_DAILY_CALL_LIMIT) !== null,
    embeddingModelCompatible: vars.OPENAI_EMBEDDING_MODEL === "text-embedding-3-small",
    leakedSecretVars: SECRET_KEYS_THAT_MUST_NOT_BE_VARS.filter((key) => vars[key] !== undefined),
    requiredSecretsOk: sameStringSet(requiredSecrets, REQUIRED_SECRET_KEYS),
    d1Ok: d1?.database_name === D1_DATABASE_NAME && d1?.database_id === D1_DATABASE_ID,
    memoryBindingsOk:
      vectorize?.index_name === VECTORIZE_INDEX_NAME &&
      profileImagesR2?.bucket_name === PROFILE_IMAGES_R2_BUCKET_NAME &&
      nextCacheR2 === undefined &&
      arrayValue(config.r2_buckets).length === 1 &&
      queueProducer?.queue === MEMORY_POST_TURN_QUEUE_NAME &&
      queueConsumer?.queue === MEMORY_POST_TURN_QUEUE_NAME &&
      queueConsumer.dead_letter_queue === MEMORY_POST_TURN_DLQ_NAME &&
      Number(queueConsumer.max_batch_size) === 1 &&
      Number(queueConsumer.max_batch_timeout) <= 10 &&
      Number(queueConsumer.max_retries) >= 1 &&
      Array.isArray(configuredCrons) &&
      sameStringSet(configuredCrons.filter(isString), ["0 3 * * *"]),
    serviceOk: services?.service === "inspirlearning",
    versionMetadataOk: versionMetadata.binding === "CF_VERSION_METADATA",
    cacheRevalidationDoOk: cacheQueueDo?.class_name === "DOQueueHandler",
    cacheRevalidationMigrationOk: cacheQueueMigration !== undefined,
    routesOk: routes.includes("inspirlearning.com") && routes.includes("www.inspirlearning.com"),
    appUrlOk:
      vars.APP_URL === "https://inspirlearning.com" &&
      vars.AUTH_URL === "https://inspirlearning.com" &&
      vars.BETTER_AUTH_URL === "https://inspirlearning.com",
    mainEntryOk: config.main === "./cloudflare-worker.ts",
    workersDevOk: config.workers_dev === false,
    previewUrlsOk: config.preview_urls === false,
    workerGlobalCacheOk: config.cache === undefined || objectValue(config.cache).enabled === false,
    freePlanCpuConfigOk: config.limits === undefined,
    staticAssetsOk:
      assets.directory === ".open-next/assets" &&
      assets.binding === "ASSETS" &&
      assets.html_handling === "drop-trailing-slash" &&
      assets.not_found_handling === "404-page" &&
      sameStringSet(workerFirstRoutes, FREE_PLAN_WORKER_FIRST_ROUTES),
    staticLegalRedirectOk: /^\/tnc\s+\/terms\s+308\s*$/m.test(staticRedirects),
    observabilityOk:
      observability.enabled === true &&
      observabilityLogs.enabled === true &&
      observabilityTraces.enabled === true &&
      observabilitySamplingOk,
    observabilitySampling: {
      incidentMode: observabilityIncidentMode,
      worker: observability.head_sampling_rate,
      logs: observabilityLogs.head_sampling_rate,
      traces: observabilityTraces.head_sampling_rate,
    },
  };
  const ok =
    !problems.missingVars.length &&
    problems.globalDailyCallLimitOk &&
    problems.embeddingModelCompatible &&
    !problems.leakedSecretVars.length &&
    problems.requiredSecretsOk &&
    problems.d1Ok &&
    problems.memoryBindingsOk &&
    problems.serviceOk &&
    problems.versionMetadataOk &&
    problems.cacheRevalidationDoOk &&
    problems.cacheRevalidationMigrationOk &&
    problems.routesOk &&
    problems.appUrlOk &&
    problems.mainEntryOk &&
    problems.workersDevOk &&
    problems.previewUrlsOk &&
    problems.workerGlobalCacheOk &&
    problems.freePlanCpuConfigOk &&
    problems.staticAssetsOk &&
    problems.staticLegalRedirectOk &&
    problems.observabilityOk;
  return {
    name: "Wrangler production config",
    status: ok ? "pass" : "fail",
    detail: ok ? { worker: "inspirlearning", deploymentMode: "free-static-native-accounts" } : problems,
  };
}

function leanWorkerArchitectureCheck(cwd: string): DeployPreflightCheck {
  const filePath = path.join(cwd, "cloudflare-worker.ts");
  const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const materializerPath = path.join(cwd, "scripts/cloudflare/materialize-static-marketing-assets.ts");
  const materializer = fs.existsSync(materializerPath) ? fs.readFileSync(materializerPath, "utf8") : "";
  const translationAssetPath = path.join(cwd, "lib/i18n/main-app-static-asset.ts");
  const translationAsset = fs.existsSync(translationAssetPath) ? fs.readFileSync(translationAssetPath, "utf8") : "";
  const architecture = {
    noOpenNextRuntimeImport: !hasOpenNextRequestRuntimeImport(source),
    nativeGuestHandler: /handleFreeGuestChat/.test(source),
    nativeLegacyI18nHandler: /handleLegacyI18nApiRequest/.test(source),
    nativeAccountHandler: /handleAccountApiRequest/.test(source),
    nativeAccountPrewarm:
      /prewarmAccountApi/.test(source) && /env as workerEnv/.test(source),
    nativeStateHandler: /handleStateApiRequest/.test(source),
    nativeProtectedAiHandler: /handleProtectedAiApiRequest/.test(source),
    nativeMemoryBackgroundHandlers: /handleMemoryScheduled/.test(source) && /handleMemoryQueue/.test(source),
    nativeHealthHandler: /CF_VERSION_METADATA/.test(source),
    legacyDoExportRetained: /DOQueueHandler/.test(source),
    staticChatDocuments: /staticChatCacheKeys/.test(materializer),
    exactStaticChatRedirects:
      /Exact public topic redirects/.test(materializer) &&
      /\/chat\?topic=/.test(materializer) &&
      / 308/.test(materializer),
    staticTopicsDocument: /api\/topics/.test(materializer),
    staticAdminDocument: /admin\/index\.html/.test(materializer),
    staticMainAppBundles:
      /writeStaticMainAppBundles/.test(materializer) && /i18n\/main-app/.test(materializer),
    staticLegacyTranslationResponses:
      /materializeLegacyTranslationApiAssets/.test(materializer) && /legacyTranslationApiAssets/.test(materializer),
    accountTranslationsIncluded: !/retiredStaticGuestAuthTranslationKeys/.test(translationAsset),
  };
  const ok = Object.values(architecture).every(Boolean);
  return {
    name: "Free static and native account architecture",
    status: ok ? "pass" : "fail",
    detail: ok
      ? { workerRuntime: "native-auth-state-ai", publicRuntime: "static-assets", openNextRuntime: false }
      : architecture,
  };
}

export function hasOpenNextRequestRuntimeImport(source: string): boolean {
  const importSpecifiers = [
    ...source.matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+)["']/g),
  ]
    .map((match) => match[1])
    .filter((specifier): specifier is string => typeof specifier === "string");

  return importSpecifiers.some(
    (specifier) =>
      specifier.includes(".open-next/") ||
      specifier === "@opennextjs/cloudflare" ||
      specifier.startsWith("@opennextjs/cloudflare/") ||
      specifier === "next" ||
      specifier.startsWith("next/"),
  );
}

function wranglerDeployDryRunCheck(): DeployPreflightCheck {
  const result = spawnSync(path.resolve(process.cwd(), "node_modules/.bin/wrangler"), ["deploy", "--dry-run"], {
    cwd: process.cwd(),
    env: commandEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    name: "Wrangler deploy dry run",
    status: result.status === 0 ? "pass" : "fail",
    detail:
      result.status === 0
        ? { status: result.status }
        : {
            status: result.status,
            outputTail: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000),
          },
  };
}

function writeReport(report: DeployPreflightReport) {
  fs.writeFileSync(path.join(cloudflareDir(report.backupDir), "deploy-preflight-report.json"), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
}

function readBackupJson<T>(backupDir: string, relativePath: string): T | null {
  const filePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function readRepoJson<T>(cwd: string, relativePath: string): T {
  return JSON.parse(stripJsonComments(fs.readFileSync(path.join(cwd, relativePath), "utf8"))) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): Array<Record<string, string>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, string> => Boolean(item && typeof item === "object")) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function stringArrayValue(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isString) ? value : null;
}

function duplicateStrings(values: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates].sort();
}

function samplingRateAtMost(value: unknown, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= max;
}

function sameStringSet(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && new Set(actual).size === actual.length && expected.every((value) => actual.includes(value));
}

function sameStringSequence(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && expected.every((value, index) => actual[index] === value);
}

function parseJsonFromOutput<T>(output: string, fallback: T): T {
  const trimmed = output.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstObject = trimmed.indexOf("{");
    const firstArray = trimmed.indexOf("[");
    const first =
      firstObject === -1 ? firstArray : firstArray === -1 ? firstObject : Math.min(firstObject, firstArray);
    const last = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (first === -1 || last === -1 || last <= first) return fallback;
    return JSON.parse(trimmed.slice(first, last + 1)) as T;
  }
}

function stripJsonComments(input: string) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}
