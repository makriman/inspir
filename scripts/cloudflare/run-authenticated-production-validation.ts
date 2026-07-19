import { createHash, createHmac } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readPrivateJsonNoFollow,
  writePrivateJsonDurably,
} from "./d1-release-budget-ledger";
import {
  CLOUDFLARE_CLI_TIMEOUT_MS,
  cloudflareDir,
  commandEnv,
  resolveBackupDir,
  stableStringify,
} from "./migration-config";
import {
  acquireProductionValidationLock,
  assertNoUnresolvedProductionMaintenance,
  assertProductionValidationLockCommandWindow,
  createProductionValidationLockBudget,
  parseProductionValidationLockBudget,
  parseProductionValidationLockOwner,
  PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS,
  PRODUCTION_VALIDATION_LOCK_RENEWAL_FLOOR_MS,
  releaseProductionValidationLock,
  verifyProductionValidationLock,
  type ProductionValidationLockBudget,
  type ProductionValidationLockOwner,
} from "./production-validation-lock";
import {
  assertExistingSessionCleanupResponse,
  type ExistingValidationSessionPurpose,
} from "./verify-production-worker-outcomes";
import {
  assertAuthenticatedMutationResponseProof,
  authenticatedMemoryRecoveryEvidenceName,
  authenticatedOutboxDrainMaximumAttempts,
  authenticatedOutboxDrainRetryDelayMs,
  authenticatedMutationInventoryNames,
  cleanupDisposableMutationState,
  deleteAuthenticatedValidationVectorAndRequireAbsent,
  enqueueAuthenticatedMemoryVectorCleanupWake,
  exactDisposableInventory,
  readAuthenticatedMemoryRecoveryEvidence,
  removeAuthenticatedMemoryRecoveryEvidence,
  resolveAuthenticatedMemoryRecoveryVersion,
  runAuthenticatedMemoryRecoveryCleanup,
  type AuthenticatedMemoryRecoveryEvidence,
} from "./verify-authenticated-production-mutations";
import {
  buildWorkerDeployArtifactEvidence,
  readSoleActiveWorkerVersion,
} from "./worker-deploy-evidence";
import {
  assertReleaseSequenceCurrentReleaseBinding,
  assertProductionTranslationReconciliationReleaseBinding,
  type ReleaseSequenceCurrentRelease,
} from "./release-sequence-attestations";
import {
  assertFreshHistoricalFresh0016FinalPreservation,
} from "./historical-data-fresh-0016-preservation-cli-adapter";
import { assertGitReleaseIdentity } from "./git-release-identity";
import {
  assertFreshProductionVectorizeReadiness,
  assertProductionVectorizeReadinessReleaseBinding,
} from "./vectorize-readiness-evidence";
import {
  isStagedTranslationD1CleanupRunId,
  readAndValidateCandidateActiveStagedTranslationD1Cleanup,
  stagedTranslationD1CleanupProofBinding,
  type StagedTranslationD1CleanupProofBinding,
} from "./reconcile-staged-translation-fallback";
import {
  boundedReleaseChildCommand,
  runBoundedReleaseChildSync,
} from "./run-production-release-operation";
import {
  readWorkerCandidateActivationEvidence,
  readWorkerCandidateStagedEvidence,
  readWorkerCandidateUploadEvidence,
  verifyWorkerCandidateActivationEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

const workerName = "inspirlearning";
const productionBaseUrl = "https://inspirlearning.com/";
const existingUserGuardSecretName = "E2E_TEST_AUTH_REQUIRE_EXISTING";
const validationEmailSecretName = "E2E_TEST_AUTH_EMAIL";
const authCapabilitySecretName = "E2E_TEST_AUTH_SECRET";
const mutationRunSecretName = "E2E_TEST_MUTATION_RUN_ID";
const capabilityExpirySecretName = "E2E_TEST_AUTH_EXPIRES_AT";
const temporarySecretNames = [
  existingUserGuardSecretName,
  validationEmailSecretName,
  mutationRunSecretName,
  capabilityExpirySecretName,
  authCapabilitySecretName,
] as const;
const cleanupSecretOrder = [
  authCapabilitySecretName,
  capabilityExpirySecretName,
  mutationRunSecretName,
  validationEmailSecretName,
  existingUserGuardSecretName,
] as const;
const secretCleanupAttemptLimit = 3;
const hiddenAuthProbeAttemptLimit = 3;
const capabilityLifetimeMs = 90 * 60 * 1_000;
const recoveryManifestName = "authenticated-production-validation-recovery.json";
const existingSessionPurposes = [
  "production-playwright",
  "production-outcome-soak",
] as const satisfies readonly ExistingValidationSessionPurpose[];

export type ProductionValidationVersionSnapshot = {
  versionId: string;
  immutableReleaseIdentity: string;
  secretNames: string[];
  triggeredBy: string | null;
};

type ProductionValidationVersionSequence = {
  baseline: ProductionValidationVersionSnapshot;
  current: ProductionValidationVersionSnapshot;
  temporarySecretNames: Set<string>;
};

type ProductionValidationRecoveryManifest = {
  kind: "authenticated-production-validation-recovery-v1";
  createdAt: string;
  updatedAt: string;
  candidateVersionId: string;
  authenticatedVersionId: string | null;
  activeVersionId: string;
  mutationRunId: string;
  capabilityExpiresAt: string;
  existingSessionPurposes: readonly ExistingValidationSessionPurpose[];
  sourceFingerprintSha256: string;
  sourceFingerprintFileCount: number;
  translationReconciliationKind:
    | "production-translation-reconciliation-v1"
    | "production-staged-translation-reconciliation-v1";
  translationReconciliationSha256: string;
  stagedCleanupRunId: string | null;
  stagedCleanupEvidenceSha256: string | null;
  stagedCleanupPreWriteEvidenceSha256: string | null;
  stagedCleanupResolvedEvidenceSha256: string | null;
  immutableReleaseIdentity: string;
  baselineSecretNames: string[];
  installedTemporarySecrets: string[];
  capabilityInstallationAttemptedAt: string | null;
  validationLockOwner: ProductionValidationLockOwner;
  validationLockPreviousOwner: ProductionValidationLockOwner | null;
  validationLockBudget: ProductionValidationLockBudget;
  validationLockAcquisitionAttemptedAt: string | null;
  validationLockAcquiredAt: string | null;
  validationLockReleasedAt: string | null;
  residueZeroVerifiedAt: string | null;
  secretsAbsentVerifiedAt: string | null;
};

type CandidateReleaseEvidence = Readonly<{
  sourceFingerprintSha256: string;
  sourceFingerprintFileCount: number;
  translationReconciliationKind:
    | "production-translation-reconciliation-v1"
    | "production-staged-translation-reconciliation-v1";
  translationReconciliationSha256: string;
  stagedCleanupRunId: string | null;
  stagedCleanupEvidenceSha256: string | null;
  stagedCleanupPreWriteEvidenceSha256: string | null;
  stagedCleanupResolvedEvidenceSha256: string | null;
}>;

let productionSecretsTouched = false;
let activeRecoveryManifest: ProductionValidationRecoveryManifest | null = null;
let activeRecoveryManifestPath: string | null = null;
let activeValidationChild: ChildProcess | null = null;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      killActiveValidationChildProcessGroup();
      if (productionSecretsTouched) {
        console.error(
          `Authenticated production validation interrupted by ${signal}. ` +
            `Temporary secrets remain fail-closed behind their expiry; recover from the private manifest ` +
            `${activeRecoveryManifestPath ?? "(unavailable)"}.`,
        );
      }
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }

  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Authenticated production validation failed.");
    process.exitCode = 1;
  });
}

async function main() {
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Authenticated production validation requires --confirm-production.");
  }
  const secret = requireE2ESecret(process.env.E2E_TEST_AUTH_SECRET);
  const email = requireExactE2EEmail(process.env.E2E_TEST_AUTH_EMAIL);
  const manifestPath = recoveryManifestPath();
  const memoryRecoveryPath = authenticatedMemoryRecoveryEvidencePath();
  if (process.argv.includes("--recover")) {
    await recoverInterruptedValidation({ manifestPath, memoryRecoveryPath, secret, email });
    return;
  }
  if (process.env.REQUIRE_LIVE_AI !== "1") {
    throw new Error("Authenticated production validation requires REQUIRE_LIVE_AI=1.");
  }

  const candidateVersion = requireWorkerVersion(getArg("--candidate-version"));
  assertNoUnresolvedProductionMaintenance();
  assertRecoveryManifestAbsent(manifestPath);
  assertRecoveryManifestAbsent(memoryRecoveryPath);
  requireActiveVersion(candidateVersion);
  assertTemporarySecretsAbsent();
  const releaseEvidence = assertCandidateReleaseEvidence(candidateVersion);
  const baseline = readActiveVersionSnapshot(candidateVersion);
  const mutationRunId = crypto.randomUUID();
  const capabilityExpiresAt = String(Date.now() + capabilityLifetimeMs);
  const sequence: ProductionValidationVersionSequence = {
    baseline,
    current: baseline,
    temporarySecretNames: new Set(),
  };
  const createdAt = new Date().toISOString();
  activeRecoveryManifestPath = manifestPath;
  activeRecoveryManifest = {
    kind: "authenticated-production-validation-recovery-v1",
    createdAt,
    updatedAt: createdAt,
    candidateVersionId: candidateVersion,
    authenticatedVersionId: null,
    activeVersionId: candidateVersion,
    mutationRunId,
    capabilityExpiresAt,
    existingSessionPurposes,
    sourceFingerprintSha256: releaseEvidence.sourceFingerprintSha256,
    sourceFingerprintFileCount: releaseEvidence.sourceFingerprintFileCount,
    translationReconciliationKind:
      releaseEvidence.translationReconciliationKind,
    translationReconciliationSha256:
      releaseEvidence.translationReconciliationSha256,
    stagedCleanupRunId: releaseEvidence.stagedCleanupRunId,
    stagedCleanupEvidenceSha256:
      releaseEvidence.stagedCleanupEvidenceSha256,
    stagedCleanupPreWriteEvidenceSha256:
      releaseEvidence.stagedCleanupPreWriteEvidenceSha256,
    stagedCleanupResolvedEvidenceSha256:
      releaseEvidence.stagedCleanupResolvedEvidenceSha256,
    immutableReleaseIdentity: baseline.immutableReleaseIdentity,
    baselineSecretNames: baseline.secretNames,
    installedTemporarySecrets: [],
    capabilityInstallationAttemptedAt: null,
    validationLockOwner: {
      candidateVersionId: candidateVersion,
      leaseExpiresAt: Number(capabilityExpiresAt),
      leaseId: crypto.randomUUID(),
      runId: mutationRunId,
      sourceFingerprintSha256: releaseEvidence.sourceFingerprintSha256,
    },
    validationLockPreviousOwner: null,
    validationLockBudget: createProductionValidationLockBudget(),
    validationLockAcquisitionAttemptedAt: null,
    validationLockAcquiredAt: null,
    validationLockReleasedAt: null,
    residueZeroVerifiedAt: null,
    secretsAbsentVerifiedAt: null,
  };
  persistRecoveryManifest(false);

  let validationError: unknown = null;
  let cleanupErrors: string[] = [];
  let authenticatedVersion: string | null = null;
  let authenticatedVersionSnapshot: ProductionValidationVersionSnapshot | null = null;
  let preSecretPreparationFailed = false;
  try {
    try {
      assertNoUnresolvedProductionMaintenance();
      acquireActiveProductionValidationLock();
      assertNoUnresolvedProductionMaintenance();
      attestActiveProductionValidationLock();
      const lockedReleaseEvidence = assertCandidateReleaseEvidence(candidateVersion);
      if (
        lockedReleaseEvidence.sourceFingerprintSha256 !== releaseEvidence.sourceFingerprintSha256 ||
        lockedReleaseEvidence.sourceFingerprintFileCount !== releaseEvidence.sourceFingerprintFileCount ||
        !sameCandidateReleaseEvidence(lockedReleaseEvidence, releaseEvidence)
      ) {
        throw new Error("Authenticated-validation release evidence changed after lock acquisition.");
      }
      const lockedBaseline = readActiveVersionSnapshot(candidateVersion);
      assertProductionValidationVersionTransition({
        baseline,
        previousVersionId: baseline.versionId,
        current: lockedBaseline,
        expectedTemporarySecretNames: new Set(),
        requireNewVersion: false,
      });
      assertTemporarySecretsAbsent();
      sequence.current = lockedBaseline;
      updateRecoveryManifest({ activeVersionId: lockedBaseline.versionId });
    } catch (error) {
      preSecretPreparationFailed = true;
      let releaseError: unknown = null;
      if (
        activeRecoveryManifest?.validationLockAcquiredAt &&
        !activeRecoveryManifest.validationLockReleasedAt
      ) {
        try {
          releaseActiveProductionValidationLock();
        } catch (caught) {
          releaseError = caught;
        }
      }
      throw new AggregateError(
        [error, releaseError]
          .filter((entry): entry is NonNullable<unknown> => entry !== null && entry !== undefined)
          .map(asError),
        "Authenticated production validation failed before touching temporary secrets; exact lock release was attempted.",
      );
    }
    productionSecretsTouched = true;
    putSecret(existingUserGuardSecretName, "1", sequence);
    putSecret(validationEmailSecretName, email, sequence);
    putSecret(mutationRunSecretName, mutationRunId, sequence);
    putSecret(capabilityExpirySecretName, capabilityExpiresAt, sequence);
    // This credential enables the hidden route, so it is always installed last
    // and removed first. Persist the exposure attempt before invoking Wrangler:
    // a lost readback must never make an indeterminate enablement look unused.
    updateRecoveryManifest({ capabilityInstallationAttemptedAt: new Date().toISOString() });
    putSecret(authCapabilitySecretName, secret, sequence);

    authenticatedVersion = sequence.current.versionId;
    authenticatedVersionSnapshot = sequence.current;
    updateRecoveryManifest({ authenticatedVersionId: authenticatedVersion });
    const validationEnv = {
      E2E_TEST_AUTH_SECRET: secret,
      E2E_TEST_AUTH_EMAIL: email,
      E2E_TEST_MUTATION_RUN_ID: mutationRunId,
      E2E_TEST_AUTH_EXPIRES_AT: capabilityExpiresAt,
      E2E_TEST_GUEST_QUOTA_SCOPE: mutationRunId,
      PLAYWRIGHT_BASE_URL: productionBaseUrl,
      PRODUCTION_E2E_READ_ONLY: "1",
      REQUIRE_LIVE_AI: "1",
      REQUIRE_RESOURCE_SOAK: "1",
    };
    await runLockedPnpm(
      [
        "cf:verify:worker-outcomes",
        "--",
        "--expected-version",
        authenticatedVersion,
        "--confirm-production",
      ],
      validationEnv,
    );
    await runLockedPnpm(
      ["cf:verify:production", "--", "--expected-version", authenticatedVersion],
      validationEnv,
    );
    await runLockedPnpm(
      ["cf:test:e2e:production", "--", "--expected-version", authenticatedVersion],
      validationEnv,
    );
    await runLockedPnpm(
      [
        "exec",
        "tsx",
        "scripts/cloudflare/verify-authenticated-production-mutations.ts",
        "--expected-version",
        authenticatedVersion,
        "--candidate-version",
        candidateVersion,
        "--source-fingerprint-sha256",
        releaseEvidence.sourceFingerprintSha256,
        "--immutable-release-identity-sha256",
        createHash("sha256").update(baseline.immutableReleaseIdentity).digest("hex"),
        "--memory-recovery-evidence-path",
        memoryRecoveryPath,
        "--confirm-production",
      ],
      validationEnv,
    );
  } catch (error) {
    validationError = error;
  } finally {
    if (!preSecretPreparationFailed) try {
      const configured = listedSecretNames();
      if (configured.has(authCapabilitySecretName)) {
        const requestVersion = readAttestedActiveValidationVersion(sequence);
        const memoryEvidence = readBoundAuthenticatedMemoryRecoveryEvidence(
          memoryRecoveryPath,
          {
            releaseCandidateVersionId: candidateVersion,
            authenticatedValidationVersionId: authenticatedVersion ?? requestVersion,
            runId: mutationRunId,
            sourceFingerprintSha256: releaseEvidence.sourceFingerprintSha256,
            immutableReleaseIdentitySha256: createHash("sha256")
              .update(baseline.immutableReleaseIdentity)
              .digest("hex"),
          },
        );
        await runAuthenticatedMemoryRecoveryCleanup({
          ...(memoryEvidence
            ? {
                preD1VectorCleanup: () => runWithActiveProductionValidationLockAsync(
                  "pre-D1 authenticated memory vector recovery cleanup",
                  () => deleteAuthenticatedValidationVectorAndRequireAbsent({
                    vectorId: memoryEvidence.turnVectorId,
                  }),
                ),
                postD1VectorCleanup: () => runWithActiveProductionValidationLockAsync(
                  "post-D1 authenticated memory vector recovery cleanup",
                  async () => {
                    await deleteAuthenticatedValidationVectorAndRequireAbsent({
                      vectorId: memoryEvidence.turnVectorId,
                      minimumSettleMs: 25_000,
                    });
                    removeAuthenticatedMemoryRecoveryEvidence(memoryRecoveryPath, memoryEvidence);
                  },
                ),
              }
            : {}),
          authoritativeD1Cleanup: () => runWithActiveProductionValidationLockAsync(
            "validation residue sweep",
            () => sweepAllValidationResidue({
              requestVersion,
              identityCandidateVersion: authenticatedVersion ?? requestVersion,
              runId: mutationRunId,
              secret,
            }),
          ),
        });
      } else if (
        authenticatedVersion ||
        activeRecoveryManifest?.capabilityInstallationAttemptedAt
      ) {
        throw new Error(
          "Production validation cannot prove residue cleanup after the route capability disappeared prematurely.",
        );
      }
      updateRecoveryManifest({ residueZeroVerifiedAt: new Date().toISOString() });
      cleanupErrors = cleanupTemporarySecrets(sequence);
      if (cleanupErrors.length > 0) {
        const hardExpiryFailure = hardExpireMintCapability(sequence);
        if (hardExpiryFailure) cleanupErrors.push(hardExpiryFailure);
      }
    } catch (error) {
      const residueFailure = error instanceof Error
        ? error.message
        : "Production validation residue cleanup failed indeterminately.";
      const hardExpiryFailure = hardExpireMintCapability(sequence);
      cleanupErrors = [residueFailure, ...(hardExpiryFailure ? [hardExpiryFailure] : [])];
    }
  }

  if (preSecretPreparationFailed) {
    throw validationError instanceof Error
      ? validationError
      : new Error("Authenticated production validation failed before temporary secret installation.");
  }

  let postCleanupError: unknown = null;
  if (cleanupErrors.length === 0) {
    try {
      const finalVersion = runWithActiveProductionValidationLock(
        "final temporary-secret absence and active-version readback",
        () => {
          assertTemporarySecretsAbsent();
          const versionId = requireActiveVersion(sequence.current.versionId);
          updateRecoveryManifest({
            activeVersionId: versionId,
            secretsAbsentVerifiedAt: new Date().toISOString(),
          });
          return versionId;
        },
      );
      await runLockedPnpm(
        [
          "cf:verify:background-outcomes",
          "--",
          "--queue",
          "--expected-version",
          finalVersion,
          "--confirm-production",
        ],
        { REQUIRE_LIVE_AI: "1", REQUIRE_RESOURCE_SOAK: "1" },
      );
      await runLockedPnpm(
        [
          "cf:verify:worker-outcomes",
          "--",
          "--expected-version",
          finalVersion,
          "--confirm-production",
          "--secret-free",
        ],
        {
          E2E_TEST_AUTH_SECRET: secret,
          E2E_TEST_GUEST_QUOTA_SCOPE: mutationRunId,
          REQUIRE_LIVE_AI: "1",
          REQUIRE_RESOURCE_SOAK: "1",
        },
      );
      await runLockedPnpm(
        ["cf:verify:production", "--", "--expected-version", finalVersion],
        { REQUIRE_LIVE_AI: "1", REQUIRE_RESOURCE_SOAK: "1" },
      );
      await runWithActiveProductionValidationLockAsync(
        "hidden authentication disablement probe",
        () => assertHiddenAuthDisabled(secret, email),
      );
      if (
        !authenticatedVersion ||
        !authenticatedVersionSnapshot ||
        authenticatedVersionSnapshot.versionId !== authenticatedVersion ||
        authenticatedVersionSnapshot.immutableReleaseIdentity !== baseline.immutableReleaseIdentity ||
        sequence.current.immutableReleaseIdentity !== baseline.immutableReleaseIdentity
      ) {
        throw new Error(
          "Authenticated and secret-free validation versions do not share one immutable release identity.",
        );
      }
      releaseActiveProductionValidationLock();
      const sequenceReportPath = path.join(
        cloudflareDir(resolveBackupDir()),
        "authenticated-production-validation-sequence-report.json",
      );
      writePrivateJsonDurably(sequenceReportPath, {
        kind: "authenticated-production-validation-sequence-v1",
        createdAt: new Date().toISOString(),
        ok: true,
        candidateVersionId: candidateVersion,
        authenticatedValidationVersionId: authenticatedVersion,
        finalSecretFreeVersionId: finalVersion,
        sourceFingerprintSha256: releaseEvidence.sourceFingerprintSha256,
        sourceFingerprintFileCount: releaseEvidence.sourceFingerprintFileCount,
        immutableReleaseIdentitySha256: createHash("sha256")
          .update(baseline.immutableReleaseIdentity)
          .digest("hex"),
        immutableSourceAndArtifactIdentityShared: true,
        runtimeConfiguration: {
          authenticatedValidationVersion: "temporary validation secrets present",
          finalSecretFreeVersion: "temporary validation secrets absent",
        },
        evidenceVersions: {
          realStoredQueueAndSemanticRetrieval: authenticatedVersion,
          staleJobQueueProbe: finalVersion,
        },
      }, { replace: pathEntryExists(sequenceReportPath) });
      removeRecoveryManifest();
      console.log(
        `Authenticated production validation passed; stored Queue/semantic evidence version: ${authenticatedVersion}; ` +
          `final secret-free stale-Queue evidence version: ${finalVersion}; shared immutable source/artifact identity: yes.`,
      );
    } catch (error) {
      postCleanupError = error;
    }
  }

  const failures = [validationError, ...cleanupErrors.map((message) => new Error(message)), postCleanupError]
    .filter((value): value is NonNullable<typeof value> => value !== null);
  if (failures.length) {
    throw new AggregateError(
      failures,
      `Authenticated production validation did not complete safely:\n${failures
        .map((failure, index) =>
          `${index + 1}. ${summarizeAuthenticatedValidationFailure(failure)}`,
        )
        .join("\n")}`,
    );
  }
}

function assertCandidateReleaseEvidence(
  candidateVersionId: string,
  options: { recovery?: boolean } = {},
) {
  const backupDir = resolveBackupDir();
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDir),
  );
  if (upload.value.targetCandidateVersionId !== candidateVersionId) {
    throw new Error(
      `Authenticated production validation expected candidate ${candidateVersionId}; canonical upload evidence names ${upload.value.targetCandidateVersionId}.`,
    );
  }
  const staged = readWorkerCandidateStagedEvidence(
    workerCandidateStagedEvidencePath(backupDir),
  );
  const activation = readWorkerCandidateActivationEvidence(
    workerCandidateActivationEvidencePath(backupDir),
  );
  verifyWorkerCandidateActivationEvidence({
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidence: staged.value,
    stagedEvidenceSha256: staged.sha256,
    activationEvidence: activation.value,
    activationEvidenceSha256: activation.sha256,
  });
  const currentArtifactEvidence = buildWorkerDeployArtifactEvidence(process.cwd());
  const git = assertGitReleaseIdentity({ cwd: process.cwd() });
  const currentRelease: ReleaseSequenceCurrentRelease = {
    phase: "candidate-active",
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    phaseEvidenceSha256: activation.sha256,
    phaseEvidenceCreatedAt: activation.value.createdAt,
    soleServingVersionId: upload.value.targetCandidateVersionId,
    git,
    artifactEvidence: currentArtifactEvidence,
  };
  assertReleaseSequenceCurrentReleaseBinding({ backupDir, currentRelease });
  const sourceEvidence = {
    sourceFingerprintSha256:
      currentArtifactEvidence.sourceFingerprint.sha256,
    sourceFingerprintFileCount:
      currentArtifactEvidence.sourceFingerprint.fileCount,
  } as const;
  if (options.recovery) {
    assertProductionVectorizeReadinessReleaseBinding({
      backupDir,
      currentRelease,
      requiredPhase: "candidate-active",
    });
    const translation = assertProductionTranslationReconciliationReleaseBinding({
      backupDir,
      currentRelease,
    });
    let cleanupProof: StagedTranslationD1CleanupProofBinding | null = null;
    if (translation.kind === "production-staged-translation-reconciliation-v1") {
      const cleanup = readAndValidateCandidateActiveStagedTranslationD1Cleanup({
        backupDir,
        candidateVersionId,
        recovery: true,
      });
      cleanupProof = stagedTranslationD1CleanupProofBinding({
        backupDir,
        evidence: cleanup,
      });
    }
    return bindCandidateReleaseEvidence({
      sourceEvidence,
      translation,
      cleanupProof,
    });
  }
  const activeVersionId = readSoleActiveWorkerVersion();
  if (activeVersionId !== candidateVersionId) {
    throw new Error(
      `Authenticated production validation expected candidate ${candidateVersionId} alone at 100%; received ${activeVersionId}.`,
    );
  }
  assertFreshProductionVectorizeReadiness({
    backupDir,
    currentRelease,
    requiredPhase: "candidate-active",
  });
  assertFreshHistoricalFresh0016FinalPreservation({
    backupDirectory: backupDir,
    cwd: process.cwd(),
    targetCandidateVersionId: currentRelease.targetCandidateVersionId,
    serviceBaselineVersionId: currentRelease.serviceBaselineVersionId,
    uploadEvidenceSha256: currentRelease.uploadEvidenceSha256,
    activationEvidenceSha256: activation.sha256,
  });
  // The final-preservation reader revalidates the canonical cutover and its
  // hash-bound translation prerequisite. Keep that immutable reconciliation
  // release-bound here. A staged release additionally requires the completed
  // candidate-active exact-cleanup attestation; this reader revalidates its
  // immutable plan and byte proof without spending Day-2 D1 budget again.
  const translation = assertProductionTranslationReconciliationReleaseBinding({
    backupDir,
    currentRelease,
  });
  let cleanupProof: StagedTranslationD1CleanupProofBinding | null = null;
  if (translation.kind === "production-staged-translation-reconciliation-v1") {
    const cleanup = readAndValidateCandidateActiveStagedTranslationD1Cleanup({
      backupDir,
      candidateVersionId,
      recovery: true,
    });
    cleanupProof = stagedTranslationD1CleanupProofBinding({
      backupDir,
      evidence: cleanup,
    });
  }
  return bindCandidateReleaseEvidence({
    sourceEvidence,
    translation,
    cleanupProof,
  });
}

function bindCandidateReleaseEvidence(input: {
  sourceEvidence: Readonly<{
    sourceFingerprintSha256: string;
    sourceFingerprintFileCount: number;
  }>;
  translation: ReturnType<
    typeof assertProductionTranslationReconciliationReleaseBinding
  >;
  cleanupProof: StagedTranslationD1CleanupProofBinding | null;
}): CandidateReleaseEvidence {
  const staged =
    input.translation.kind ===
    "production-staged-translation-reconciliation-v1";
  if (staged !== (input.cleanupProof !== null)) {
    throw new Error(
      "Candidate release evidence has an inconsistent staged-cleanup proof.",
    );
  }
  return Object.freeze({
    ...input.sourceEvidence,
    translationReconciliationKind: input.translation.kind,
    translationReconciliationSha256: createHash("sha256")
      .update(stableStringify(input.translation))
      .digest("hex"),
    stagedCleanupRunId: input.cleanupProof?.runId ?? null,
    stagedCleanupEvidenceSha256:
      input.cleanupProof?.cleanupEvidenceSha256 ?? null,
    stagedCleanupPreWriteEvidenceSha256:
      input.cleanupProof?.preWriteEvidenceSha256 ?? null,
    stagedCleanupResolvedEvidenceSha256:
      input.cleanupProof?.resolvedEvidenceSha256 ?? null,
  });
}

function candidateReleaseEvidenceFromManifest(
  manifest: ProductionValidationRecoveryManifest,
): CandidateReleaseEvidence {
  return Object.freeze({
    sourceFingerprintSha256: manifest.sourceFingerprintSha256,
    sourceFingerprintFileCount: manifest.sourceFingerprintFileCount,
    translationReconciliationKind: manifest.translationReconciliationKind,
    translationReconciliationSha256: manifest.translationReconciliationSha256,
    stagedCleanupRunId: nullableStagedCleanupRunId(
      manifest.stagedCleanupRunId,
    ),
    stagedCleanupEvidenceSha256: nullableSha256(
      manifest.stagedCleanupEvidenceSha256,
      "staged cleanup evidence SHA-256",
    ),
    stagedCleanupPreWriteEvidenceSha256:
      nullableSha256(
        manifest.stagedCleanupPreWriteEvidenceSha256,
        "staged cleanup pre-write evidence SHA-256",
      ),
    stagedCleanupResolvedEvidenceSha256:
      nullableSha256(
        manifest.stagedCleanupResolvedEvidenceSha256,
        "staged cleanup resolved evidence SHA-256",
      ),
  });
}

function sameCandidateReleaseEvidence(
  left: CandidateReleaseEvidence,
  right: CandidateReleaseEvidence,
) {
  return stableStringify(left) === stableStringify(right);
}

function recoveryManifestPath() {
  return path.join(cloudflareDir(resolveBackupDir()), recoveryManifestName);
}

function authenticatedMemoryRecoveryEvidencePath() {
  return path.join(
    cloudflareDir(resolveBackupDir()),
    authenticatedMemoryRecoveryEvidenceName,
  );
}

function readBoundAuthenticatedMemoryRecoveryEvidence(
  filePath: string,
  expected: {
    releaseCandidateVersionId: string;
    authenticatedValidationVersionId: string;
    runId: string;
    sourceFingerprintSha256: string;
    immutableReleaseIdentitySha256: string;
  },
): AuthenticatedMemoryRecoveryEvidence | null {
  try {
    fs.lstatSync(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  const evidence = readAuthenticatedMemoryRecoveryEvidence(filePath);
  if (
    evidence.releaseCandidateVersionId !== expected.releaseCandidateVersionId ||
    evidence.authenticatedValidationVersionId !== expected.authenticatedValidationVersionId ||
    evidence.runId !== expected.runId ||
    evidence.sourceFingerprintSha256 !== expected.sourceFingerprintSha256 ||
    evidence.immutableReleaseIdentitySha256 !== expected.immutableReleaseIdentitySha256
  ) {
    throw new Error(
      "Authenticated memory recovery evidence is not bound to the active candidate/run/source identity.",
    );
  }
  return evidence;
}

function assertRecoveryManifestAbsent(file: string) {
  try {
    fs.lstatSync(file);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `An unresolved authenticated-validation recovery manifest already exists: ${file}. ` +
      `Run this command with --recover before starting another validation.`,
  );
}

function persistRecoveryManifest(replace: boolean) {
  if (!activeRecoveryManifest || !activeRecoveryManifestPath) {
    throw new Error("Authenticated-validation recovery manifest is not initialized.");
  }
  writePrivateJsonDurably(activeRecoveryManifestPath, activeRecoveryManifest, { replace });
}

function updateRecoveryManifest(
  update: Partial<Pick<
    ProductionValidationRecoveryManifest,
    | "activeVersionId"
    | "authenticatedVersionId"
    | "capabilityInstallationAttemptedAt"
    | "capabilityExpiresAt"
    | "installedTemporarySecrets"
    | "residueZeroVerifiedAt"
    | "secretsAbsentVerifiedAt"
    | "validationLockOwner"
    | "validationLockPreviousOwner"
    | "validationLockBudget"
    | "validationLockAcquisitionAttemptedAt"
    | "validationLockAcquiredAt"
    | "validationLockReleasedAt"
  >>,
) {
  if (!activeRecoveryManifest) {
    throw new Error("Authenticated-validation recovery manifest is not initialized.");
  }
  activeRecoveryManifest = {
    ...activeRecoveryManifest,
    ...update,
    updatedAt: new Date().toISOString(),
  };
  persistRecoveryManifest(true);
}

function acquireActiveProductionValidationLock() {
  const manifest = requireActiveRecoveryManifest();
  updateRecoveryManifest({
    validationLockAcquisitionAttemptedAt:
      manifest.validationLockAcquisitionAttemptedAt ?? new Date().toISOString(),
  });
  completeActiveProductionValidationLockAcquisition();
}

function completeActiveProductionValidationLockAcquisition() {
  const current = requireActiveRecoveryManifest();
  const acquired = acquireProductionValidationLock({
    owner: current.validationLockOwner,
    previousOwner: current.validationLockPreviousOwner,
    budget: current.validationLockBudget,
    onReserved: persistProductionValidationLockReservation,
  });
  updateRecoveryManifest({
    validationLockOwner: acquired.owner,
    validationLockPreviousOwner: null,
    validationLockBudget: acquired.budget,
    validationLockAcquiredAt:
      current.validationLockAcquiredAt ?? new Date().toISOString(),
    validationLockReleasedAt: null,
  });
}

function attestActiveProductionValidationLock() {
  const manifest = requireActiveRecoveryManifest();
  if (!manifest.validationLockAcquisitionAttemptedAt || manifest.validationLockReleasedAt) {
    throw new Error("Production validation lock is not active for this release run.");
  }
  if (manifest.validationLockPreviousOwner) {
    completeActiveProductionValidationLockAcquisition();
    return attestActiveProductionValidationLock();
  }
  const verified = verifyProductionValidationLock({
    owner: manifest.validationLockOwner,
    budget: manifest.validationLockBudget,
    onReserved: persistProductionValidationLockReservation,
  });
  updateRecoveryManifest({ validationLockBudget: verified.budget });
  if (
    verified.owner.leaseExpiresAt - verified.serverNowMs <=
      PRODUCTION_VALIDATION_LOCK_RENEWAL_FLOOR_MS
  ) {
    const current = requireActiveRecoveryManifest();
    const renewedOwner: ProductionValidationLockOwner = {
      ...current.validationLockOwner,
      leaseExpiresAt: verified.serverNowMs + capabilityLifetimeMs,
      leaseId: crypto.randomUUID(),
    };
    updateRecoveryManifest({
      validationLockOwner: renewedOwner,
      validationLockPreviousOwner: current.validationLockOwner,
    });
    completeActiveProductionValidationLockAcquisition();
    return attestActiveProductionValidationLock();
  }
  assertProductionValidationLockCommandWindow(
    verified.owner,
    verified.serverNowMs,
  );
  return verified.serverNowMs;
}

function releaseActiveProductionValidationLock() {
  const beforeAttestation = requireActiveRecoveryManifest();
  if (!beforeAttestation.validationLockAcquisitionAttemptedAt) {
    throw new Error("Production validation lock was never acquired for this release run.");
  }
  if (beforeAttestation.validationLockReleasedAt) return;
  attestActiveProductionValidationLock();
  const manifest = requireActiveRecoveryManifest();
  if (manifest.validationLockPreviousOwner) {
    throw new Error("Production validation lock renewal is unresolved and cannot be released.");
  }
  const released = releaseProductionValidationLock({
    owner: manifest.validationLockOwner,
    budget: manifest.validationLockBudget,
    onReserved: persistProductionValidationLockReservation,
  });
  updateRecoveryManifest({
    validationLockBudget: released.budget,
    validationLockPreviousOwner: null,
    validationLockReleasedAt: new Date().toISOString(),
  });
}

function persistProductionValidationLockReservation(
  budget: ProductionValidationLockBudget,
) {
  updateRecoveryManifest({ validationLockBudget: budget });
}

function requireActiveRecoveryManifest() {
  if (!activeRecoveryManifest) {
    throw new Error("Authenticated-validation recovery manifest is not initialized.");
  }
  return activeRecoveryManifest;
}

function hardExpireMintCapability(sequence: ProductionValidationVersionSequence) {
  try {
    if (!listedSecretNames().has(authCapabilitySecretName)) return null;
    putSecret(capabilityExpirySecretName, "1", sequence);
    updateRecoveryManifest({ capabilityExpiresAt: "1" });
    return null;
  } catch (error) {
    return `Could not rotate the validation capability to an immediately expired state: ${
      error instanceof Error ? error.message : "unknown failure"
    }`;
  }
}

function removeRecoveryManifest() {
  if (!activeRecoveryManifest || !activeRecoveryManifestPath) {
    throw new Error("Authenticated-validation recovery manifest is not initialized.");
  }
  if (
    !activeRecoveryManifest.residueZeroVerifiedAt ||
    !activeRecoveryManifest.secretsAbsentVerifiedAt ||
    !activeRecoveryManifest.validationLockReleasedAt
  ) {
    throw new Error(
      "Recovery manifest cannot be removed before residue, secret absence, and lock release are proven.",
    );
  }
  readPrivateJsonNoFollow(activeRecoveryManifestPath);
  fs.rmSync(activeRecoveryManifestPath);
  fsyncDirectory(path.dirname(activeRecoveryManifestPath));
  activeRecoveryManifest = null;
  activeRecoveryManifestPath = null;
}

async function recoverInterruptedValidation(input: {
  manifestPath: string;
  memoryRecoveryPath: string;
  secret: string;
  email: string;
}) {
  const manifest = parseRecoveryManifest(readPrivateJsonNoFollow(input.manifestPath));
  activeRecoveryManifest = manifest;
  activeRecoveryManifestPath = input.manifestPath;
  const releaseEvidence = assertCandidateReleaseEvidence(manifest.candidateVersionId, {
    recovery: true,
  });
  if (
    releaseEvidence.sourceFingerprintSha256 !== manifest.sourceFingerprintSha256 ||
    releaseEvidence.sourceFingerprintFileCount !== manifest.sourceFingerprintFileCount ||
    !sameCandidateReleaseEvidence(
      releaseEvidence,
      candidateReleaseEvidenceFromManifest(manifest),
    )
  ) {
    throw new Error(
      "Authenticated-validation recovery source no longer matches the candidate deploy evidence.",
    );
  }
  if (releaseAlreadyCleanInterruptedValidationLock(manifest)) return;
  const baseline: ProductionValidationVersionSnapshot = {
    versionId: manifest.candidateVersionId,
    immutableReleaseIdentity: manifest.immutableReleaseIdentity,
    secretNames: manifest.baselineSecretNames,
    triggeredBy: null,
  };
  // Recovery cannot safely steal a copied, still-live generation: an external
  // child already in flight cannot be fenced by changing only this D1 row.
  // Clear previousOwner so acquisition can insert an absent row or replace a
  // strict expired row, but can never exact-CAS over the live original.
  updateRecoveryManifest({
    validationLockOwner: {
      ...manifest.validationLockOwner,
      leaseExpiresAt: Date.now() + capabilityLifetimeMs,
      leaseId: crypto.randomUUID(),
    },
    validationLockPreviousOwner: null,
    validationLockReleasedAt: null,
  });
  assertNoUnresolvedProductionMaintenance();
  acquireActiveProductionValidationLock();
  try {
    assertNoUnresolvedProductionMaintenance();
  } catch (error) {
    let releaseError: unknown = null;
    try {
      releaseActiveProductionValidationLock();
    } catch (caught) {
      releaseError = caught;
    }
    throw new AggregateError(
      [error, releaseError]
        .filter((entry): entry is NonNullable<unknown> => entry !== null && entry !== undefined)
        .map(asError),
      "Authenticated-validation recovery found unresolved maintenance after lock acquisition.",
    );
  }
  attestActiveProductionValidationLock();
  const lockedReleaseEvidence = assertCandidateReleaseEvidence(manifest.candidateVersionId, {
    recovery: true,
  });
  if (
    lockedReleaseEvidence.sourceFingerprintSha256 !== manifest.sourceFingerprintSha256 ||
    lockedReleaseEvidence.sourceFingerprintFileCount !== manifest.sourceFingerprintFileCount ||
    !sameCandidateReleaseEvidence(
      lockedReleaseEvidence,
      candidateReleaseEvidenceFromManifest(manifest),
    )
  ) {
    throw new Error("Authenticated-validation recovery evidence changed after lock acquisition.");
  }
  const configured = listedSecretNames();
  const installedTemporarySecrets = new Set(
    temporarySecretNames.filter((name) => configured.has(name)),
  );
  productionSecretsTouched = installedTemporarySecrets.size > 0;
  const current = readActiveVersionSnapshot();
  assertProductionValidationVersionTransition({
    baseline,
    previousVersionId: manifest.activeVersionId,
    current,
    expectedTemporarySecretNames: installedTemporarySecrets,
    requireNewVersion: false,
  });
  const sequence: ProductionValidationVersionSequence = {
    baseline,
    current,
    temporarySecretNames: installedTemporarySecrets,
  };
  updateRecoveryManifest({
    activeVersionId: current.versionId,
    installedTemporarySecrets: [...installedTemporarySecrets].sort(),
  });

  try {
    if (!manifest.residueZeroVerifiedAt) {
      if (configured.has(authCapabilitySecretName)) {
        if (!temporarySecretNames.every((name) => configured.has(name))) {
          throw new Error(
            "Recovery found the route capability without the complete bound secret set; refusing ambiguous cleanup.",
          );
        }
        const memoryRecoveryExists = pathEntryExists(input.memoryRecoveryPath);
        const memoryRecoveryVersionId = resolveAuthenticatedMemoryRecoveryVersion({
          manifestAuthenticatedVersionId: manifest.authenticatedVersionId,
          currentVersionId: current.versionId,
          memoryRecoveryEvidenceExists: memoryRecoveryExists,
        });
        const memoryEvidence = memoryRecoveryExists
          ? readBoundAuthenticatedMemoryRecoveryEvidence(
              input.memoryRecoveryPath,
              {
                releaseCandidateVersionId: manifest.candidateVersionId,
                authenticatedValidationVersionId: memoryRecoveryVersionId,
                runId: manifest.mutationRunId,
                sourceFingerprintSha256: manifest.sourceFingerprintSha256,
                immutableReleaseIdentitySha256: createHash("sha256")
                  .update(manifest.immutableReleaseIdentity)
                  .digest("hex"),
              },
            )
          : null;
        await runAuthenticatedMemoryRecoveryCleanup({
          ...(memoryEvidence
            ? {
                preD1VectorCleanup: () => runWithActiveProductionValidationLockAsync(
                  "recovery pre-D1 authenticated memory vector cleanup",
                  () => deleteAuthenticatedValidationVectorAndRequireAbsent({
                    vectorId: memoryEvidence.turnVectorId,
                  }),
                ),
                postD1VectorCleanup: () => runWithActiveProductionValidationLockAsync(
                  "recovery post-D1 authenticated memory vector cleanup",
                  async () => {
                    await deleteAuthenticatedValidationVectorAndRequireAbsent({
                      vectorId: memoryEvidence.turnVectorId,
                      minimumSettleMs: 25_000,
                    });
                    removeAuthenticatedMemoryRecoveryEvidence(
                      input.memoryRecoveryPath,
                      memoryEvidence,
                    );
                  },
                ),
              }
            : {}),
          authoritativeD1Cleanup: () => runWithActiveProductionValidationLockAsync(
            "recovery validation residue sweep",
            () => sweepAllValidationResidue({
              requestVersion: current.versionId,
              identityCandidateVersion: manifest.authenticatedVersionId ?? current.versionId,
              runId: manifest.mutationRunId,
              secret: input.secret,
            }),
          ),
        });
      } else if (
        manifest.authenticatedVersionId ||
        manifest.capabilityInstallationAttemptedAt
      ) {
        throw new Error(
          "Recovery cannot prove validation residue after the route capability was removed prematurely.",
        );
      }
      updateRecoveryManifest({ residueZeroVerifiedAt: new Date().toISOString() });
    }

    const cleanupErrors = cleanupTemporarySecrets(sequence);
    if (cleanupErrors.length) {
      throw new AggregateError(
        cleanupErrors.map((message) => new Error(message)),
        "Interrupted validation secret cleanup failed.",
      );
    }
  } catch (error) {
    const hardExpiryFailure = hardExpireMintCapability(sequence);
    throw new AggregateError(
      [
        error instanceof Error
          ? error
          : new Error("Interrupted validation cleanup failed indeterminately."),
        ...(hardExpiryFailure ? [new Error(hardExpiryFailure)] : []),
      ],
      "Interrupted validation cleanup did not complete safely.",
    );
  }
  const finalVersion = runWithActiveProductionValidationLock(
    "recovery final temporary-secret absence and active-version readback",
    () => {
      assertTemporarySecretsAbsent();
      const versionId = requireActiveVersion(sequence.current.versionId);
      updateRecoveryManifest({
        activeVersionId: versionId,
        secretsAbsentVerifiedAt: new Date().toISOString(),
      });
      return versionId;
    },
  );
  await runWithActiveProductionValidationLockAsync(
    "recovery hidden authentication disablement probe",
    () => assertHiddenAuthDisabled(input.secret, input.email),
  );
  releaseActiveProductionValidationLock();
  removeRecoveryManifest();
  console.log(
    `Interrupted authenticated validation cleanup completed; secret-free version: ${finalVersion}. ` +
      "Rerun the full production validation before accepting the release.",
  );
}

function releaseAlreadyCleanInterruptedValidationLock(
  manifest: ProductionValidationRecoveryManifest,
) {
  if (
    !manifest.validationLockAcquisitionAttemptedAt ||
    !manifest.validationLockAcquiredAt ||
    manifest.validationLockReleasedAt ||
    manifest.validationLockPreviousOwner !== null ||
    !manifest.residueZeroVerifiedAt ||
    !manifest.secretsAbsentVerifiedAt ||
    manifest.installedTemporarySecrets.length !== 0
  ) {
    return false;
  }

  const baseline: ProductionValidationVersionSnapshot = {
    versionId: manifest.candidateVersionId,
    immutableReleaseIdentity: manifest.immutableReleaseIdentity,
    secretNames: manifest.baselineSecretNames,
    triggeredBy: null,
  };
  const current = readActiveVersionSnapshot(manifest.activeVersionId);
  assertProductionValidationVersionTransition({
    baseline,
    previousVersionId: manifest.activeVersionId,
    current,
    expectedTemporarySecretNames: new Set<string>(),
    requireNewVersion: false,
  });
  assertTemporarySecretsAbsent();
  const released = releaseProductionValidationLock({
    owner: manifest.validationLockOwner,
    budget: manifest.validationLockBudget,
    onReserved: persistProductionValidationLockReservation,
  });
  updateRecoveryManifest({
    validationLockBudget: released.budget,
    validationLockPreviousOwner: null,
    validationLockReleasedAt: new Date().toISOString(),
  });
  removeRecoveryManifest();
  console.log(
    `Already-clean interrupted authenticated validation lock released; secret-free version: ${current.versionId}. ` +
      "Rerun the full production validation before accepting the release.",
  );
  return true;
}

export function parseRecoveryManifest(value: unknown): ProductionValidationRecoveryManifest {
  const manifest = objectRecord(value);
  if (
    !manifest ||
    !hasExactRecordKeys(manifest, [
      "activeVersionId",
      "authenticatedVersionId",
      "baselineSecretNames",
      "candidateVersionId",
      "capabilityInstallationAttemptedAt",
      "capabilityExpiresAt",
      "createdAt",
      "existingSessionPurposes",
      "immutableReleaseIdentity",
      "installedTemporarySecrets",
      "kind",
      "mutationRunId",
      "residueZeroVerifiedAt",
      "secretsAbsentVerifiedAt",
      "sourceFingerprintFileCount",
      "sourceFingerprintSha256",
      "stagedCleanupEvidenceSha256",
      "stagedCleanupPreWriteEvidenceSha256",
      "stagedCleanupResolvedEvidenceSha256",
      "stagedCleanupRunId",
      "translationReconciliationKind",
      "translationReconciliationSha256",
      "updatedAt",
      "validationLockAcquiredAt",
      "validationLockAcquisitionAttemptedAt",
      "validationLockBudget",
      "validationLockOwner",
      "validationLockPreviousOwner",
      "validationLockReleasedAt",
    ]) ||
    manifest.kind !== "authenticated-production-validation-recovery-v1" ||
    !isIsoTimestamp(manifest.createdAt) ||
    !isIsoTimestamp(manifest.updatedAt) ||
    typeof manifest.candidateVersionId !== "string" ||
    !isWorkerVersionId(manifest.candidateVersionId) ||
    (
      manifest.authenticatedVersionId !== null &&
      (
        typeof manifest.authenticatedVersionId !== "string" ||
        !isWorkerVersionId(manifest.authenticatedVersionId)
      )
    ) ||
    typeof manifest.activeVersionId !== "string" ||
    !isWorkerVersionId(manifest.activeVersionId) ||
    typeof manifest.mutationRunId !== "string" ||
    !isWorkerVersionId(manifest.mutationRunId) ||
    typeof manifest.capabilityExpiresAt !== "string" ||
    !/^[1-9][0-9]{0,15}$/.test(manifest.capabilityExpiresAt) ||
    !Number.isSafeInteger(Number(manifest.capabilityExpiresAt)) ||
    !optionalIsoTimestamp(manifest.capabilityInstallationAttemptedAt) ||
    !Array.isArray(manifest.existingSessionPurposes) ||
    stableStringify(manifest.existingSessionPurposes) !== stableStringify(existingSessionPurposes) ||
    typeof manifest.sourceFingerprintSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceFingerprintSha256) ||
    typeof manifest.sourceFingerprintFileCount !== "number" ||
    !Number.isSafeInteger(manifest.sourceFingerprintFileCount) ||
    manifest.sourceFingerprintFileCount < 1 ||
    (
      manifest.translationReconciliationKind !==
        "production-translation-reconciliation-v1" &&
      manifest.translationReconciliationKind !==
        "production-staged-translation-reconciliation-v1"
    ) ||
    typeof manifest.translationReconciliationSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.translationReconciliationSha256) ||
    (
      manifest.translationReconciliationKind ===
      "production-staged-translation-reconciliation-v1"
        ? (
            !isStagedTranslationD1CleanupRunId(
              manifest.stagedCleanupRunId,
            ) ||
            typeof manifest.stagedCleanupEvidenceSha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(manifest.stagedCleanupEvidenceSha256) ||
            typeof manifest.stagedCleanupPreWriteEvidenceSha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(
              manifest.stagedCleanupPreWriteEvidenceSha256,
            ) ||
            typeof manifest.stagedCleanupResolvedEvidenceSha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(
              manifest.stagedCleanupResolvedEvidenceSha256,
            )
          )
        : (
            manifest.stagedCleanupRunId !== null ||
            manifest.stagedCleanupEvidenceSha256 !== null ||
            manifest.stagedCleanupPreWriteEvidenceSha256 !== null ||
            manifest.stagedCleanupResolvedEvidenceSha256 !== null
          )
    ) ||
    typeof manifest.immutableReleaseIdentity !== "string" ||
    !manifest.immutableReleaseIdentity ||
    !isStringArray(manifest.baselineSecretNames) ||
    !isStringArray(manifest.installedTemporarySecrets) ||
    !optionalIsoTimestamp(manifest.residueZeroVerifiedAt) ||
    !optionalIsoTimestamp(manifest.secretsAbsentVerifiedAt) ||
    !optionalIsoTimestamp(manifest.validationLockAcquisitionAttemptedAt) ||
    !optionalIsoTimestamp(manifest.validationLockAcquiredAt) ||
    !optionalIsoTimestamp(manifest.validationLockReleasedAt)
  ) {
    throw new Error("Authenticated-validation recovery manifest is malformed.");
  }
  const installed = new Set(manifest.installedTemporarySecrets);
  const allowedTemporarySecrets = new Set<string>(temporarySecretNames);
  const baselineSecrets = new Set(manifest.baselineSecretNames);
  if (
    installed.size !== manifest.installedTemporarySecrets.length ||
    [...installed].some((name) => !allowedTemporarySecrets.has(name)) ||
    baselineSecrets.size !== manifest.baselineSecretNames.length ||
    [...baselineSecrets].some((name) => allowedTemporarySecrets.has(name))
  ) {
    throw new Error("Authenticated-validation recovery manifest has invalid temporary secrets.");
  }
  let validationLockOwner: ProductionValidationLockOwner;
  let validationLockPreviousOwner: ProductionValidationLockOwner | null;
  let validationLockBudget: ProductionValidationLockBudget;
  try {
    validationLockOwner = parseProductionValidationLockOwner(manifest.validationLockOwner);
    validationLockPreviousOwner = manifest.validationLockPreviousOwner === null
      ? null
      : parseProductionValidationLockOwner(manifest.validationLockPreviousOwner);
    validationLockBudget = parseProductionValidationLockBudget(manifest.validationLockBudget);
  } catch {
    throw new Error("Authenticated-validation recovery manifest has invalid lock evidence.");
  }
  if (
    validationLockOwner.candidateVersionId !== manifest.candidateVersionId ||
    validationLockOwner.runId !== manifest.mutationRunId ||
    validationLockOwner.sourceFingerprintSha256 !== manifest.sourceFingerprintSha256 ||
    (
      validationLockPreviousOwner !== null &&
      (
        validationLockPreviousOwner.candidateVersionId !== validationLockOwner.candidateVersionId ||
        validationLockPreviousOwner.runId !== validationLockOwner.runId ||
        validationLockPreviousOwner.sourceFingerprintSha256 !==
          validationLockOwner.sourceFingerprintSha256 ||
        validationLockPreviousOwner.leaseId === validationLockOwner.leaseId ||
        validationLockPreviousOwner.leaseExpiresAt >= validationLockOwner.leaseExpiresAt
      )
    ) ||
    (manifest.validationLockAcquiredAt && !manifest.validationLockAcquisitionAttemptedAt) ||
    (manifest.validationLockReleasedAt && !manifest.validationLockAcquiredAt) ||
    (manifest.validationLockReleasedAt && validationLockPreviousOwner !== null)
  ) {
    throw new Error("Authenticated-validation recovery manifest lock identity is inconsistent.");
  }
  return {
    kind: "authenticated-production-validation-recovery-v1",
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    candidateVersionId: manifest.candidateVersionId,
    authenticatedVersionId: manifest.authenticatedVersionId,
    activeVersionId: manifest.activeVersionId,
    mutationRunId: manifest.mutationRunId,
    capabilityExpiresAt: manifest.capabilityExpiresAt,
    existingSessionPurposes,
    sourceFingerprintSha256: manifest.sourceFingerprintSha256,
    sourceFingerprintFileCount: manifest.sourceFingerprintFileCount,
    translationReconciliationKind: manifest.translationReconciliationKind,
    translationReconciliationSha256: manifest.translationReconciliationSha256,
    stagedCleanupRunId: nullableStagedCleanupRunId(
      manifest.stagedCleanupRunId,
    ),
    stagedCleanupEvidenceSha256: nullableSha256(
      manifest.stagedCleanupEvidenceSha256,
      "staged cleanup evidence SHA-256",
    ),
    stagedCleanupPreWriteEvidenceSha256:
      nullableSha256(
        manifest.stagedCleanupPreWriteEvidenceSha256,
        "staged cleanup pre-write evidence SHA-256",
      ),
    stagedCleanupResolvedEvidenceSha256:
      nullableSha256(
        manifest.stagedCleanupResolvedEvidenceSha256,
        "staged cleanup resolved evidence SHA-256",
      ),
    immutableReleaseIdentity: manifest.immutableReleaseIdentity,
    baselineSecretNames: [...manifest.baselineSecretNames].sort(),
    installedTemporarySecrets: [...manifest.installedTemporarySecrets].sort(),
    capabilityInstallationAttemptedAt: manifest.capabilityInstallationAttemptedAt,
    validationLockOwner,
    validationLockPreviousOwner,
    validationLockBudget,
    validationLockAcquisitionAttemptedAt: manifest.validationLockAcquisitionAttemptedAt,
    validationLockAcquiredAt: manifest.validationLockAcquiredAt,
    validationLockReleasedAt: manifest.validationLockReleasedAt,
    residueZeroVerifiedAt: manifest.residueZeroVerifiedAt,
    secretsAbsentVerifiedAt: manifest.secretsAbsentVerifiedAt,
  };
}

function nullableStagedCleanupRunId(value: unknown): string | null {
  if (value === null) return null;
  if (!isStagedTranslationD1CleanupRunId(value)) {
    throw new Error("Authenticated-validation staged cleanup run ID is malformed.");
  }
  return value;
}

function nullableSha256(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Authenticated-validation ${label} is malformed.`);
  }
  return value;
}

function hasExactRecordKeys(record: Record<string, unknown>, names: readonly string[]) {
  const actual = Object.keys(record).sort();
  const expected = [...names].sort();
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function cleanupTemporarySecrets(sequence: ProductionValidationVersionSequence) {
  if (!productionSecretsTouched) return [];
  const errors: string[] = [];

  const capabilityError = deleteSecretUntilVerifiedAbsent(authCapabilitySecretName, sequence);
  if (capabilityError) {
    // Keep the existing-user guard installed whenever capability removal cannot
    // be proved. A later signal/finally invocation can safely retry cleanup.
    return [capabilityError];
  }

  for (const name of cleanupSecretOrder.slice(1)) {
    const error = deleteSecretUntilVerifiedAbsent(name, sequence);
    if (error) errors.push(error);
  }
  if (errors.length === 0) productionSecretsTouched = false;
  return errors;
}

async function sweepAllValidationResidue(input: {
  requestVersion: string;
  identityCandidateVersion: string;
  runId: string;
  secret: string;
}) {
  for (const purpose of existingSessionPurposes) {
    const cleanup = await postValidationCapabilityAction({
      requestVersion: input.requestVersion,
      secret: input.secret,
      body: {
        action: "cleanup-existing-session",
        runId: input.runId,
        candidateVersionId: input.identityCandidateVersion,
        sessionPurpose: purpose,
      },
    });
    const cleanupIdentity = assertExistingSessionCleanupResponse(cleanup, {
      expectedVersion: input.identityCandidateVersion,
      expectedRuntimeVersion: input.requestVersion,
      runId: input.runId,
      purpose,
    });
    const verify = await postValidationCapabilityAction({
      requestVersion: input.requestVersion,
      secret: input.secret,
      body: {
        action: "verify-existing-session-cleanup",
        runId: input.runId,
        candidateVersionId: input.identityCandidateVersion,
        sessionPurpose: purpose,
      },
    });
    const verifyIdentity = assertExistingSessionCleanupResponse(verify, {
      expectedVersion: input.identityCandidateVersion,
      expectedRuntimeVersion: input.requestVersion,
      runId: input.runId,
      purpose,
    });
    if (
      cleanupIdentity.sessionRef !== verifyIdentity.sessionRef ||
      cleanupIdentity.userRef !== verifyIdentity.userRef
    ) {
      throw new Error(`Existing-session ${purpose} cleanup identity changed during readback.`);
    }
  }

  const userId = disposableUserId(input.identityCandidateVersion, input.runId);
  await cleanupDisposableMutationState({
    cleanup: async () => {
      const source = await postValidationCapabilityAction({
        requestVersion: input.requestVersion,
        secret: input.secret,
        cleanupProof: disposableCleanupProof(
          input.secret,
          input.identityCandidateVersion,
          input.runId,
          userId,
        ),
        body: {
          action: "cleanup-disposable",
          runId: input.runId,
          candidateVersionId: input.identityCandidateVersion,
          userId,
        },
      });
      assertAuthenticatedMutationResponseProof(
        parseJsonOutput(source),
        {
          candidateVersionId: input.identityCandidateVersion,
          runId: input.runId,
          runtimeVersionId: input.requestVersion,
        },
        "Disposable cleanup response",
      );
    },
    inspect: async () => {
      const source = await postValidationCapabilityAction({
        requestVersion: input.requestVersion,
        secret: input.secret,
        body: {
          action: "verify-disposable-cleanup",
          runId: input.runId,
          candidateVersionId: input.identityCandidateVersion,
          userId,
        },
      });
      const { payload } = assertAuthenticatedMutationResponseProof(
        parseJsonOutput(source),
        {
          candidateVersionId: input.identityCandidateVersion,
          runId: input.runId,
          runtimeVersionId: input.requestVersion,
        },
        "Disposable cleanup readback",
      );
      const inventory = exactDisposableInventory(payload.inventory);
      return {
        ok:
          payload.ok === true &&
          authenticatedMutationInventoryNames.every((name) => inventory[name] === 0),
        inventory,
      };
    },
    outboxDrain: {
      wake: () => enqueueAuthenticatedMemoryVectorCleanupWake(
        "authenticated-production-recovery",
      ),
      maximumAttempts: authenticatedOutboxDrainMaximumAttempts,
      retryDelayMs: authenticatedOutboxDrainRetryDelayMs,
    },
  });
}

async function postValidationCapabilityAction(input: {
  requestVersion: string;
  secret: string;
  body: Record<string, string>;
  cleanupProof?: string;
}) {
  const headers = new Headers({
    "cache-control": "no-cache",
    "content-type": "application/json",
    "Cloudflare-Workers-Version-Overrides": `${workerName}="${input.requestVersion}"`,
    "x-migration-e2e-auth-secret": input.secret,
    origin: new URL(productionBaseUrl).origin,
    "sec-fetch-site": "same-origin",
  });
  if (input.cleanupProof) headers.set("x-migration-e2e-cleanup-proof", input.cleanupProof);
  const response = await fetch(new URL("/api/migration/e2e-auth", productionBaseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(input.body),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const source = await readBoundedResponse(response, 512 * 1_024);
  if (response.status !== 200) {
    throw new Error(`Validation residue action returned HTTP ${response.status}.`);
  }
  return source;
}

async function readBoundedResponse(response: Response, maximumBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Validation residue response exceeded its byte limit.");
    }
    chunks.push(result.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function disposableCleanupProof(
  secret: string,
  candidateVersionId: string,
  runId: string,
  userId: string,
) {
  return createHmac("sha256", secret)
    .update(`disposable-cleanup-v1\0${candidateVersionId}\0${runId}\0${userId}`)
    .digest("hex");
}

function disposableUserId(candidateVersionId: string, runId: string) {
  const bytes = createHash("sha256")
    .update(`inspir-disposable-mutation-v1\0${candidateVersionId}\0${runId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deleteSecretUntilVerifiedAbsent(
  name: (typeof temporarySecretNames)[number],
  sequence: ProductionValidationVersionSequence,
) {
  let verificationFailure = `${name} absence was not verified.`;
  for (let attempt = 1; attempt <= secretCleanupAttemptLimit; attempt += 1) {
    try {
      runWithActiveProductionValidationLock(
        `temporary Worker secret delete ${name} attempt ${attempt}`,
        () => {
          const requiredTransition = sequence.temporarySecretNames.has(name);
          runBoundedWranglerMutation(["secret", "delete", name, "--name", workerName], {
            allowFailure: true,
          });
          if (listedSecretNames().has(name)) {
            throw new Error(`${name} is still configured after cleanup attempt ${attempt}.`);
          }
          const expectedTemporarySecretNames = new Set(sequence.temporarySecretNames);
          expectedTemporarySecretNames.delete(name);
          const current = readActiveVersionSnapshot();
          assertProductionValidationVersionTransition({
            baseline: sequence.baseline,
            previousVersionId: sequence.current.versionId,
            current,
            expectedTemporarySecretNames,
            requireNewVersion: requiredTransition,
          });
          sequence.temporarySecretNames.delete(name);
          sequence.current = current;
          updateRecoveryManifest({
            activeVersionId: current.versionId,
            installedTemporarySecrets: [...sequence.temporarySecretNames].sort(),
          });
        },
      );
      return null;
    } catch {
      verificationFailure = `${name} absence could not be verified after cleanup attempt ${attempt}.`;
    }
  }
  return verificationFailure;
}

function putSecret(
  name: (typeof temporarySecretNames)[number],
  value: string,
  sequence: ProductionValidationVersionSequence,
) {
  runWithActiveProductionValidationLock(`temporary Worker secret put ${name}`, () => {
    const previousVersionId = sequence.current.versionId;
    const result = runBoundedWranglerMutation(["secret", "put", name, "--name", workerName], {
      input: value,
      allowFailure: true,
    });
    const current = readActiveVersionSnapshot();
    const expectedTemporarySecretNames = new Set(sequence.temporarySecretNames);
    expectedTemporarySecretNames.add(name);
    assertProductionValidationVersionTransition({
      baseline: sequence.baseline,
      previousVersionId,
      current,
      expectedTemporarySecretNames,
      requireNewVersion: true,
    });
    sequence.temporarySecretNames.add(name);
    sequence.current = current;
    updateRecoveryManifest({
      activeVersionId: current.versionId,
      installedTemporarySecrets: [...sequence.temporarySecretNames].sort(),
    });
    if (!result.ok && current.versionId === previousVersionId) {
      throw new Error(`Could not configure temporary Worker secret ${name}.`);
    }
  });
}

function assertTemporarySecretsAbsent() {
  const existing = listedSecretNames();
  const configured = temporarySecretNames.filter((name) => existing.has(name));
  if (configured.length) {
    throw new Error(
      `Refusing to start while temporary production secrets already exist: ${configured.join(", ")}. Remove them and retry.`,
    );
  }
}

function readAttestedActiveValidationVersion(
  sequence: ProductionValidationVersionSequence,
) {
  const current = readActiveVersionSnapshot();
  assertProductionValidationVersionTransition({
    baseline: sequence.baseline,
    previousVersionId: sequence.current.versionId,
    current,
    expectedTemporarySecretNames: sequence.temporarySecretNames,
    requireNewVersion: false,
  });
  sequence.current = current;
  updateRecoveryManifest({ activeVersionId: current.versionId });
  return current.versionId;
}

function listedSecretNames() {
  const result = runWrangler([
    "secret",
    "list",
    "--name",
    workerName,
    "--format",
    "json",
  ]);
  const value = parseJsonOutput(result.stdout);
  if (!Array.isArray(value)) throw new Error("Wrangler returned an invalid Worker secret list.");
  return new Set(
    value.flatMap((entry) => {
      const record = objectRecord(entry);
      return typeof record?.name === "string" ? [record.name] : [];
    }),
  );
}

function requireActiveVersion(expectedVersion?: string) {
  const result = runWrangler(["deployments", "status", "--name", workerName, "--json"]);
  const deployment = objectRecord(parseJsonOutput(result.stdout));
  const rawVersions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  const versions = rawVersions.flatMap((entry) => {
    const record = objectRecord(entry);
    const versionId = typeof record?.version_id === "string" ? record.version_id : null;
    const percentage = typeof record?.percentage === "number" ? record.percentage : null;
    return versionId && percentage !== null ? [{ versionId, percentage }] : [];
  });
  const active = versions.length === 1 && versions[0]?.percentage === 100 ? versions[0] : null;
  if (!active) throw new Error(`Expected one ${workerName} version at 100% traffic.`);
  if (expectedVersion && active.versionId !== expectedVersion) {
    throw new Error(`Expected candidate version ${expectedVersion}, received ${active.versionId}.`);
  }
  return active.versionId;
}

function readActiveVersionSnapshot(expectedVersion?: string) {
  const versionId = requireActiveVersion(expectedVersion);
  const result = runWrangler([
    "versions",
    "view",
    versionId,
    "--name",
    workerName,
    "--json",
  ]);
  return parseProductionValidationVersionSnapshot(parseJsonOutput(result.stdout), versionId);
}

export function parseProductionValidationVersionSnapshot(
  value: unknown,
  expectedVersionId: string,
): ProductionValidationVersionSnapshot {
  const version = objectRecord(value);
  const resources = objectRecord(version?.resources);
  const script = objectRecord(resources?.script);
  const bindings = Array.isArray(resources?.bindings)
    ? resources.bindings.map(objectRecord)
    : [];
  if (
    !version ||
    version.id !== expectedVersionId ||
    !resources ||
    !script ||
    typeof script.etag !== "string" ||
    !script.etag.trim() ||
    bindings.some((binding) => binding === null)
  ) {
    throw new Error("Worker version metadata omitted its immutable release identity.");
  }
  const exactBindings = bindings.filter(
    (binding): binding is Record<string, unknown> => binding !== null,
  );
  const secretNames = exactBindings.flatMap((binding) =>
    binding.type === "secret_text" && typeof binding.name === "string"
      ? [binding.name]
      : []
  ).sort();
  const nonSecretBindings = exactBindings
    .filter((binding) => binding.type !== "secret_text")
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  const immutableResources = {
    ...resources,
    bindings: nonSecretBindings,
  };
  const annotations = objectRecord(version.annotations);
  return {
    versionId: expectedVersionId,
    immutableReleaseIdentity: stableStringify(immutableResources),
    secretNames,
    triggeredBy:
      typeof annotations?.["workers/triggered_by"] === "string"
        ? annotations["workers/triggered_by"]
        : null,
  };
}

export function assertProductionValidationVersionTransition(input: {
  baseline: ProductionValidationVersionSnapshot;
  previousVersionId: string;
  current: ProductionValidationVersionSnapshot;
  expectedTemporarySecretNames: ReadonlySet<string>;
  requireNewVersion: boolean;
}) {
  if (
    input.current.immutableReleaseIdentity !== input.baseline.immutableReleaseIdentity
  ) {
    throw new Error("Temporary validation secret operation changed the immutable Worker release.");
  }
  const expectedSecrets = new Set([
    ...input.baseline.secretNames,
    ...input.expectedTemporarySecretNames,
  ]);
  if (!sameStringSet(expectedSecrets, new Set(input.current.secretNames))) {
    throw new Error("Temporary validation secret operation produced an unexpected secret set.");
  }
  if (input.requireNewVersion) {
    if (input.current.versionId === input.previousVersionId) {
      throw new Error("Temporary validation secret operation did not activate a new Worker version.");
    }
    if (input.current.triggeredBy !== "secret") {
      throw new Error("Temporary validation version was not created by an exact secret operation.");
    }
  }
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

async function assertHiddenAuthDisabled(secret: string, email: string) {
  let lastFailure = "no response";
  for (let attempt = 1; attempt <= hiddenAuthProbeAttemptLimit; attempt += 1) {
    try {
      const response = await fetch(new URL("/api/migration/e2e-auth", productionBaseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-migration-e2e-auth-secret": secret,
          origin: new URL(productionBaseUrl).origin,
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ email }),
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "request failed";
    }
    if (attempt < hiddenAuthProbeAttemptLimit) await delay(1_000);
  }
  throw new Error(
    `Hidden migration authentication did not prove disabled after cleanup (${lastFailure}).`,
  );
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function runWithActiveProductionValidationLock<T>(
  label: string,
  operation: () => T,
) {
  attestActiveProductionValidationLock();
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: operation() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  let postAttestationError: unknown = null;
  try {
    attestActiveProductionValidationLock();
  } catch (error) {
    postAttestationError = error;
  }
  return resolveLockedOperationOutcome(label, outcome, postAttestationError);
}

async function runWithActiveProductionValidationLockAsync<T>(
  label: string,
  operation: () => Promise<T>,
) {
  attestActiveProductionValidationLock();
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  let postAttestationError: unknown = null;
  try {
    attestActiveProductionValidationLock();
  } catch (error) {
    postAttestationError = error;
  }
  return resolveLockedOperationOutcome(label, outcome, postAttestationError);
}

function resolveLockedOperationOutcome<T>(
  label: string,
  outcome: { ok: true; value: T } | { ok: false; error: unknown },
  postAttestationError: unknown,
) {
  if (!outcome.ok && postAttestationError) {
    throw new AggregateError(
      [asError(outcome.error), asError(postAttestationError)],
      `${label} failed and post-operation lock ownership could not be proved.`,
    );
  }
  if (!outcome.ok) throw outcome.error;
  if (postAttestationError) throw postAttestationError;
  return outcome.value;
}

function productionValidationPnpmArgs(args: readonly string[]) {
  if (
    args[0]?.startsWith("cf:") &&
    !args.includes("--backup")
  ) {
    return [args[0], "--backup", resolveBackupDir(), ...args.slice(1)];
  }
  return [...args];
}

function runPnpm(args: string[], extraEnv: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const commandArgs = productionValidationPnpmArgs(args);
    const boundedCommand = boundedReleaseChildCommand(
      { command: "pnpm", args: commandArgs },
      process.cwd(),
    );
    const child = spawn(boundedCommand.command, boundedCommand.args, {
      cwd: process.cwd(),
      env: { ...commandEnv(), ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    activeValidationChild = child;
    let outputBytes = 0;
    let outputOverflow = false;
    let timeoutExpired = false;
    const maximumOutputBytes = 128 * 1024 * 1024;
    const writeOutput = (target: NodeJS.WriteStream, chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximumOutputBytes) {
        outputOverflow = true;
        killValidationChildProcessGroup(child);
        return;
      }
      target.write(chunk);
    };
    child.stdout?.on("data", (chunk: Buffer) => writeOutput(process.stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => writeOutput(process.stderr, chunk));
    const timeout = setTimeout(() => {
      timeoutExpired = true;
      killValidationChildProcessGroup(child);
    }, PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS);
    timeout.unref();

    let spawnError: Error | null = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      if (activeValidationChild === child) activeValidationChild = null;
      if (spawnError) reject(spawnError);
      else if (timeoutExpired) {
        reject(new Error(`Production validation command exceeded its protected runtime: pnpm ${commandArgs.join(" ")}`));
      } else if (outputOverflow) {
        reject(new Error(`Production validation command exceeded its bounded output: pnpm ${commandArgs.join(" ")}`));
      } else if (status !== 0) {
        reject(new Error(`Production validation command failed: pnpm ${commandArgs.join(" ")}`));
      } else resolve();
    });
  });
}

function runLockedPnpm(args: string[], extraEnv: Record<string, string>) {
  const commandArgs = productionValidationPnpmArgs(args);
  return runWithActiveProductionValidationLockAsync(
    `Production validation command pnpm ${commandArgs.join(" ")}`,
    () => runPnpm(commandArgs, extraEnv),
  );
}

function killActiveValidationChildProcessGroup() {
  if (activeValidationChild) killValidationChildProcessGroup(activeValidationChild);
}

function killValidationChildProcessGroup(child: ChildProcess) {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function runWrangler(
  args: string[],
  options: { input?: string; allowFailure?: boolean } = {},
) {
  const executable = path.resolve(process.cwd(), "node_modules", ".bin", "wrangler");
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: commandEnv(),
    encoding: "utf8",
    input: options.input,
    maxBuffer: 32 * 1024 * 1024,
    timeout: CLOUDFLARE_CLI_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`Wrangler command failed: ${args.slice(0, 3).join(" ")}\n${output.slice(-2_000)}`);
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
  };
}

function runBoundedWranglerMutation(
  args: string[],
  options: { input?: string; allowFailure?: boolean } = {},
) {
  const executable = path.resolve(process.cwd(), "node_modules", ".bin", "wrangler");
  const result = runBoundedReleaseChildSync(
    { command: executable, args },
    {
      cwd: process.cwd(),
      env: commandEnv(),
      input: options.input,
      maxOutputBytes: 32 * 1024 * 1024,
      timeoutMs: CLOUDFLARE_CLI_TIMEOUT_MS,
    },
  );
  const output = `${result.stdout}${result.stderr}${result.error ? String(result.error) : ""}`;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`Wrangler mutation failed: ${args.slice(0, 3).join(" ")}\n${output.slice(-2_000)}`);
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout,
  };
}

function parseJsonOutput(output: string): unknown {
  try {
    return JSON.parse(output.trim()) as unknown;
  } catch {
    for (const [opening, closing] of [["[", "]"], ["{", "}"]] as const) {
      const first = output.indexOf(opening);
      const last = output.lastIndexOf(closing);
      if (first < 0 || last <= first) continue;
      try {
        return JSON.parse(output.slice(first, last + 1)) as unknown;
      } catch {
        // Try the next supported JSON container.
      }
    }
    return null;
  }
}

function objectRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireE2ESecret(value: string | undefined) {
  if (!value || Buffer.byteLength(value, "utf8") < 32 || Buffer.byteLength(value, "utf8") > 512) {
    throw new Error("E2E_TEST_AUTH_SECRET must contain 32 to 512 UTF-8 bytes.");
  }
  return value;
}

function requireExactE2EEmail(value: string | undefined) {
  if (
    !value ||
    value.length > 320 ||
    value !== value.trim() ||
    value !== value.toLowerCase() ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  ) {
    throw new Error("E2E_TEST_AUTH_EMAIL must be the exact lowercase configured admin email.");
  }
  return value;
}

function requireWorkerVersion(value: string | undefined) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Pass --candidate-version with the exact active Worker version UUID.");
  }
  return value;
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isWorkerVersionId(value: unknown): value is string {
  return typeof value === "string" &&
    value === value.toLowerCase() &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function optionalIsoTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function pathEntryExists(filePath: string) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error("Unknown production validation failure.");
}

function summarizeAuthenticatedValidationFailure(value: unknown, depth = 0): string {
  const error = asError(value);
  const message = sanitizeAuthenticatedValidationFailureMessage(error.message);
  if (depth >= 2) return message;
  const nested = objectRecord(value);
  const nestedErrors = Array.isArray(nested?.errors) ? nested.errors : [];
  const nestedSummary = nestedErrors
    .slice(0, 5)
    .map((entry, index) =>
      `${index + 1}) ${summarizeAuthenticatedValidationFailure(entry, depth + 1)}`,
    );
  const cause = "cause" in error ? error.cause : undefined;
  if (cause !== undefined) {
    nestedSummary.push(
      `cause) ${summarizeAuthenticatedValidationFailure(cause, depth + 1)}`,
    );
  }
  return nestedSummary.length
    ? `${message} [${nestedSummary.join("; ")}]`
    : message;
}

function sanitizeAuthenticatedValidationFailureMessage(message: string) {
  return message
    .replace(/E2E_TEST_AUTH_SECRET=\\S+/gu, "E2E_TEST_AUTH_SECRET=<redacted>")
    .replace(/E2E_TEST_AUTH_EMAIL=\\S+/gu, "E2E_TEST_AUTH_EMAIL=<redacted>")
    .replace(/E2E_TEST_MUTATION_RUN_ID=\\S+/gu, "E2E_TEST_MUTATION_RUN_ID=<redacted>")
    .slice(0, 2_000);
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
