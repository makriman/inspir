import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  cloudflareDir,
  commandEnv,
  D1_DATABASE_NAME,
  isValidD1TimeTravelBookmark,
  resolveBackupDir,
} from "./migration-config";
import {
  readD1ReleaseBudgetLedger,
  readPrivateJsonNoFollow,
  writePrivateJsonDurably,
} from "./d1-release-budget-ledger";
import {
  acquireProductionMaintenanceRecoveryExclusion,
  acquireProductionValidationExclusion,
  assertProductionValidationLockAbsent,
  assertProductionValidationExclusionCommandWindow,
  attestProductionValidationExclusion,
  clearProductionMaintenanceState,
  readProductionMaintenanceState,
  releaseProductionValidationExclusion,
  type ProductionValidationExclusion,
} from "./production-validation-lock";
import { readSoleActiveWorkerVersion } from "./worker-deploy-evidence";
import { boundedReleaseChildCommand } from "./run-production-release-operation";
import {
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
} from "./sync-site-translation-sources";

const workerName = "inspirlearning";
const productionBaseUrl = "https://inspirlearning.com";
const reportName = "production-maintenance-resolution.json";
const unresolvedRepairMarkerName = "d1-translation-repair-unresolved.json";

type MaintenanceResolutionReport = {
  kind: "production-maintenance-resolution-v1";
  createdAt: string;
  ok: boolean;
  repairRunId: string;
  candidateVersionId: string;
  maintenanceVersionId: string;
  activeVersionBefore: string | null;
  activeVersionAfter: string | null;
  responseRecoveredByReadback: boolean;
  markerCleared: boolean;
  exclusionReleased: boolean;
  error?: string;
};

type LocalRepairResolutionReport = {
  kind: "d1-translation-repair-resolved-v2";
  createdAt: string;
  runId: string;
  repairRunId: string;
  evidencePath: string;
  productionResolutionReportPath: string;
  candidateVersionId: string;
  maintenanceVersionId: string;
  exactVerificationPassed: false;
  reviewedForwardCorrectionConfirmed: true;
  exactCandidateRestored: true;
  productionMaintenanceStateAbsent: true;
  candidateUnfrozen: true;
};

type LocalUnresolvedRepairContext = {
  runId: string;
  repairRunId: string;
  createdAt: string;
  evidencePath: string;
  candidateVersionId: string;
  maintenanceVersionId: string;
  sourceFingerprintSha256: string;
  timeTravelBookmark: string;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Production maintenance resolution failed.");
    process.exitCode = 1;
  });
}

async function main() {
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Production maintenance resolution requires --confirm-production.");
  }
  const repairRunId = requireRunId(getArg("--repair-run-id"));
  const backupDir = resolveBackupDir();
  const reviewedForwardCorrectionConfirmed = process.argv.includes(
    "--confirm-reviewed-forward-correction",
  );
  if (!reviewedForwardCorrectionConfirmed) {
    throw new Error(
      "Production maintenance resolution requires --confirm-reviewed-forward-correction after the imported state has been reviewed.",
    );
  }
  if (process.argv.includes("--finalize-local-resolution")) {
    if (readProductionMaintenanceState() !== null) {
      throw new Error("Local resolution cannot be finalized while production maintenance remains active.");
    }
    const markerPath = path.join(cloudflareDir(backupDir), unresolvedRepairMarkerName);
    let resolution: MaintenanceResolutionReport;
    if (pathEntryExistsNoFollow(markerPath)) {
      const context = readLocalUnresolvedRepairContext(backupDir, repairRunId);
      try {
        resolution = readSuccessfulResolutionReport(backupDir, repairRunId);
        assertProductionValidationLockAbsent();
      } catch {
        const preliminary = readPreliminaryResolutionReport(backupDir, context);
        let recoveryExclusion: ProductionValidationExclusion | null = null;
        let recoveryError: unknown = null;
        try {
          recoveryExclusion = acquireProductionValidationExclusion({
            candidateVersionId: context.candidateVersionId,
            sourceFingerprintSha256: context.sourceFingerprintSha256,
          });
          recoveryExclusion = attestProductionValidationExclusion(recoveryExclusion);
          assertProductionValidationExclusionCommandWindow(recoveryExclusion);
          const activeVersionId = readSoleActiveWorkerVersion();
          if (activeVersionId !== context.candidateVersionId) {
            throw new Error("Cleared-maintenance recovery candidate is not the sole active Worker.");
          }
          await assertCandidateIsUnfrozen(context.candidateVersionId);
          recoveryExclusion = attestProductionValidationExclusion(recoveryExclusion);
        } catch (error) {
          recoveryError = error;
        }
        if (recoveryExclusion) {
          try {
            releaseProductionValidationExclusion(recoveryExclusion);
          } catch (error) {
            recoveryError = new AggregateError(
              [recoveryError, error]
                .filter((entry): entry is NonNullable<unknown> => entry !== null && entry !== undefined)
                .map(asError),
              "Cleared-maintenance recovery exclusion release failed.",
            );
          }
        }
        if (recoveryError) throw recoveryError;
        assertProductionValidationLockAbsent();
        const recovered = report({
          ok: true,
          repairRunId,
          candidateVersionId: context.candidateVersionId,
          maintenanceVersionId: context.maintenanceVersionId,
          activeVersionBefore: preliminary.activeVersionBefore,
          activeVersionAfter: context.candidateVersionId,
          responseRecoveredByReadback: true,
          markerCleared: true,
          exclusionReleased: true,
        });
        writeReport(backupDir, recovered);
        resolution = readSuccessfulResolutionReport(backupDir, repairRunId);
      }
    } else {
      resolution = readSuccessfulResolutionReport(backupDir, repairRunId);
      assertProductionValidationLockAbsent();
    }
    const activeVersionId = readSoleActiveWorkerVersion();
    if (activeVersionId !== resolution.candidateVersionId) {
      throw new Error("Local resolution candidate is not the sole active production Worker.");
    }
    await assertCandidateIsUnfrozen(resolution.candidateVersionId);
    const localResolution = finalizeLocalTranslationRepairResolution({
      backupDir,
      repairRunId,
      activeVersionId,
      productionMaintenanceStateAbsent: true,
      candidateUnfrozen: true,
      reviewedForwardCorrectionConfirmed,
    });
    console.log(JSON.stringify(localResolution, null, 2));
    return;
  }
  const stored = readProductionMaintenanceState();
  if (!stored || stored.state.repairRunId !== repairRunId) {
    throw new Error("The exact requested production maintenance state is not active.");
  }
  const unresolved = readLocalUnresolvedRepairContext(backupDir, repairRunId);
  if (
    unresolved.candidateVersionId !== stored.state.candidateVersionId ||
    unresolved.maintenanceVersionId !== stored.state.maintenanceVersionId ||
    unresolved.sourceFingerprintSha256 !== stored.state.sourceFingerprintSha256
  ) {
    throw new Error("Local unresolved translation evidence does not match production maintenance state.");
  }

  let exclusion: ProductionValidationExclusion | null = null;
  let activeVersionBefore: string | null = null;
  let activeVersionAfter: string | null = null;
  let responseRecoveredByReadback = false;
  let markerCleared = false;
  let exclusionReleased = false;
  let operationError: unknown = null;
  let preliminaryWritten = false;

  try {
    exclusion = acquireProductionMaintenanceRecoveryExclusion({ state: stored.state });
    exclusion = attestProductionValidationExclusion(exclusion);
    assertProductionValidationExclusionCommandWindow(exclusion);
    activeVersionBefore = readSoleActiveWorkerVersion();
    if (
      activeVersionBefore !== stored.state.candidateVersionId &&
      activeVersionBefore !== stored.state.maintenanceVersionId
    ) {
      throw new Error("Active Worker is neither the recorded candidate nor maintenance version.");
    }

    let deployError: unknown = null;
    try {
      await runBoundedWrangler([
        "versions",
        "deploy",
        `${stored.state.candidateVersionId}@100`,
        "--name",
        workerName,
        "--yes",
        "--message",
        `Resolve translation maintenance ${repairRunId}`,
      ]);
    } catch (error) {
      deployError = error;
    }
    exclusion = attestProductionValidationExclusion(exclusion);
    activeVersionAfter = readSoleActiveWorkerVersion();
    if (activeVersionAfter !== stored.state.candidateVersionId) {
      throw new AggregateError(
        [deployError, new Error("Recorded candidate did not become the sole active Worker.")]
          .filter((error): error is NonNullable<unknown> => error !== null && error !== undefined),
        "Production maintenance candidate restore failed.",
      );
    }
    responseRecoveredByReadback = deployError !== null;
    await assertCandidateIsUnfrozen(stored.state.candidateVersionId);

    const preliminary = report({
      ok: false,
      repairRunId,
      candidateVersionId: stored.state.candidateVersionId,
      maintenanceVersionId: stored.state.maintenanceVersionId,
      activeVersionBefore,
      activeVersionAfter,
      responseRecoveredByReadback,
      markerCleared: false,
      exclusionReleased: false,
      error: "Pending exact marker clear and exclusion release.",
    });
    writeReport(backupDir, preliminary);
    preliminaryWritten = true;

    const cleared = clearProductionMaintenanceState({ exclusion, state: stored.state });
    exclusion = cleared.exclusion;
    markerCleared = true;
  } catch (error) {
    operationError = error;
  }

  if (exclusion) {
    const releaseErrors: Error[] = [];
    try {
      exclusion = attestProductionValidationExclusion(exclusion);
    } catch (error) {
      releaseErrors.push(asError(error));
    }
    try {
      releaseProductionValidationExclusion(exclusion);
      exclusionReleased = true;
    } catch (error) {
      releaseErrors.push(asError(error));
    }
    if (releaseErrors.length) {
      operationError = new AggregateError(
        [operationError, ...releaseErrors]
          .filter((error): error is NonNullable<unknown> => error !== null && error !== undefined),
        "Production maintenance resolution or exclusion release failed.",
      );
    }
  }

  if (preliminaryWritten && markerCleared && exclusionReleased && !operationError) {
    try {
      activeVersionAfter = readSoleActiveWorkerVersion();
      if (
        activeVersionAfter !== stored.state.candidateVersionId ||
        readProductionMaintenanceState() !== null
      ) {
        throw new Error("Production maintenance resolution changed before final evidence promotion.");
      }
      await assertCandidateIsUnfrozen(stored.state.candidateVersionId);
    } catch (error) {
      operationError = error;
    }
  }

  const finalReport = report({
    ok: preliminaryWritten && markerCleared && exclusionReleased && !operationError,
    repairRunId,
    candidateVersionId: stored.state.candidateVersionId,
    maintenanceVersionId: stored.state.maintenanceVersionId,
    activeVersionBefore,
    activeVersionAfter,
    responseRecoveredByReadback,
    markerCleared,
    exclusionReleased,
    ...(operationError ? { error: safeErrorMessage(operationError) } : {}),
  });
  if (finalReport.ok || !preliminaryWritten) {
    writeReport(backupDir, finalReport);
  }
  console.log(JSON.stringify(finalReport, null, 2));
  if (!finalReport.ok) throw new Error(finalReport.error ?? "Production maintenance resolution failed.");
  const localResolution = finalizeLocalTranslationRepairResolution({
    backupDir,
    repairRunId,
    activeVersionId: finalReport.activeVersionAfter ?? "",
    productionMaintenanceStateAbsent: true,
    candidateUnfrozen: true,
    reviewedForwardCorrectionConfirmed,
  });
  console.log(JSON.stringify(localResolution, null, 2));
}

export function finalizeLocalTranslationRepairResolution(input: {
  backupDir: string;
  repairRunId: string;
  activeVersionId: string;
  productionMaintenanceStateAbsent: boolean;
  candidateUnfrozen: boolean;
  reviewedForwardCorrectionConfirmed: boolean;
  now?: Date;
}): LocalRepairResolutionReport {
  const repairRunId = requireRunId(input.repairRunId);
  if (
    !input.reviewedForwardCorrectionConfirmed ||
    !input.productionMaintenanceStateAbsent ||
    !input.candidateUnfrozen
  ) {
    throw new Error(
      "Local translation repair resolution requires reviewed correction, absent maintenance, and an unfrozen candidate.",
    );
  }
  const directory = cloudflareDir(path.resolve(input.backupDir));
  const resolutionReportPath = path.join(directory, reportName);
  const productionResolution = readSuccessfulResolutionReport(input.backupDir, repairRunId);
  if (input.activeVersionId !== productionResolution.candidateVersionId) {
    throw new Error("Local translation repair resolution does not match the active candidate.");
  }

  const markerPath = path.join(directory, unresolvedRepairMarkerName);
  if (!pathEntryExistsNoFollow(markerPath)) {
    return readExistingLocalTranslationResolution({
      directory,
      repairRunId,
      productionResolution,
    });
  }
  const unresolved = readLocalUnresolvedRepairContext(input.backupDir, repairRunId);
  const { runId, evidencePath } = unresolved;
  if (
    unresolved.candidateVersionId !== productionResolution.candidateVersionId ||
    unresolved.maintenanceVersionId !== productionResolution.maintenanceVersionId
  ) {
    throw new Error("The local unresolved translation repair marker does not match production resolution evidence.");
  }

  const resolvedPath = path.join(directory, `d1-translation-repair-resolved-${runId}.json`);
  const localResolution: LocalRepairResolutionReport = {
    kind: "d1-translation-repair-resolved-v2",
    createdAt: (input.now ?? new Date()).toISOString(),
    runId,
    repairRunId,
    evidencePath,
    productionResolutionReportPath: resolutionReportPath,
    candidateVersionId: productionResolution.candidateVersionId,
    maintenanceVersionId: productionResolution.maintenanceVersionId,
    exactVerificationPassed: false,
    reviewedForwardCorrectionConfirmed: true,
    exactCandidateRestored: true,
    productionMaintenanceStateAbsent: true,
    candidateUnfrozen: true,
  };
  const resolvedExists = pathEntryExistsNoFollow(resolvedPath);
  const durableResolution = resolvedExists
    ? readAndValidateLocalTranslationResolution({
        file: resolvedPath,
        runId,
        repairRunId,
        productionResolution,
      })
    : localResolution;
  if (!resolvedExists) {
    writePrivateJsonDurably(resolvedPath, durableResolution, { replace: false });
  }
  fs.rmSync(markerPath);
  fsyncDirectory(directory);
  return durableResolution;
}

function readLocalUnresolvedRepairContext(
  backupDir: string,
  repairRunId: string,
): LocalUnresolvedRepairContext {
  const directory = cloudflareDir(path.resolve(backupDir));
  const markerPath = path.join(directory, unresolvedRepairMarkerName);
  const marker = objectRecord(readPrivateJsonNoFollow(markerPath));
  const runId = typeof marker?.runId === "string" ? marker.runId : "";
  const evidencePath = typeof marker?.evidencePath === "string" ? marker.evidencePath : "";
  const candidateVersionId = typeof marker?.candidateVersionId === "string"
    ? marker.candidateVersionId
    : "";
  const maintenanceVersionId = typeof marker?.maintenanceVersionId === "string"
    ? marker.maintenanceVersionId
    : "";
  const createdAt = typeof marker?.createdAt === "string" ? marker.createdAt : "";
  const timeTravelBookmark = typeof marker?.timeTravelBookmark === "string"
    ? marker.timeTravelBookmark
    : "";
  const expectedEvidencePath = path.join(
    directory,
    `d1-translation-repair-prewrite-${runId}.json`,
  );
  if (
    !hasExactKeys(marker, [
      "automaticRestoreAllowed",
      "candidateVersionId",
      "createdAt",
      "evidencePath",
      "kind",
      "maintenanceVersionId",
      "runId",
      "timeTravelBookmark",
    ]) ||
    marker?.kind !== "d1-translation-repair-unresolved" ||
    marker.automaticRestoreAllowed !== false ||
    !isTranslationRepairRunId(runId) ||
    !runId.endsWith(`-${repairRunId}`) ||
    !isCanonicalIsoTimestamp(createdAt) ||
    evidencePath !== expectedEvidencePath ||
    !isLowercaseGenericUuid(candidateVersionId) ||
    !isLowercaseGenericUuid(maintenanceVersionId) ||
    candidateVersionId === maintenanceVersionId ||
    !isValidD1TimeTravelBookmark(timeTravelBookmark)
  ) {
    throw new Error("The local unresolved translation repair marker is invalid.");
  }

  const prewrite = objectRecord(readPrivateJsonNoFollow(evidencePath));
  const budget = objectRecord(prewrite?.d1ReleaseBudget);
  const maintenance = objectRecord(prewrite?.maintenance);
  const releasePreflightPath = path.join(
    directory,
    `d1-translation-repair-release-preflight-${runId}.json`,
  );
  if (
    !hasExactKeys(prewrite, [
      "atomicSqlBytes",
      "atomicSqlSha256",
      "atomicSqlStatements",
      "automaticRestoreAllowed",
      "candidateVersionId",
      "createdAt",
      "d1ReleaseBudget",
      "database",
      "destructiveRestoreSupported",
      "exportPerformed",
      "exportReason",
      "kind",
      "largestStatementBytes",
      "maintenance",
      "maintenanceVersionId",
      "projectedBilledRowReads",
      "projectedBilledRowWrites",
      "recoveryPreference",
      "releasePreflightEvidencePath",
      "runId",
      "timeTravelBookmark",
    ]) ||
    prewrite?.kind !== "d1-translation-repair-prewrite-evidence" ||
    prewrite.runId !== runId ||
    prewrite.createdAt !== createdAt ||
    prewrite.database !== D1_DATABASE_NAME ||
    prewrite.candidateVersionId !== candidateVersionId ||
    prewrite.maintenanceVersionId !== maintenanceVersionId ||
    prewrite.releasePreflightEvidencePath !== releasePreflightPath ||
    prewrite.timeTravelBookmark !== timeTravelBookmark ||
    prewrite.automaticRestoreAllowed !== false ||
    prewrite.recoveryPreference !== "reviewed-forward-correction" ||
    prewrite.destructiveRestoreSupported !== false ||
    prewrite.exportPerformed !== false ||
    prewrite.exportReason !== "Cloudflare documents that D1 export blocks database requests." ||
    !isSha256(prewrite.atomicSqlSha256) ||
    !isPositiveSafeInteger(prewrite.atomicSqlBytes) ||
    !isPositiveSafeInteger(prewrite.atomicSqlStatements) ||
    !isPositiveSafeInteger(prewrite.largestStatementBytes) ||
    prewrite.largestStatementBytes > 100_000 ||
    !isNonnegativeSafeInteger(prewrite.projectedBilledRowReads) ||
    !isNonnegativeSafeInteger(prewrite.projectedBilledRowWrites) ||
    !hasExactKeys(budget, [
      "ledgerPath",
      "operationId",
      "phase",
      "revision",
      "rowsRead",
      "rowsWritten",
      "utcDay",
    ]) ||
    typeof budget?.ledgerPath !== "string" ||
    !isCanonicalUtcDay(budget.utcDay) ||
    path.dirname(path.resolve(budget.ledgerPath)) !== directory ||
    path.basename(budget.ledgerPath) !== `d1-release-budget-ledger-${budget.utcDay}.json` ||
    !isSameOrImmediateNextUtcDay(budget.utcDay, createdAt.slice(0, 10)) ||
    typeof budget.operationId !== "string" ||
    !/^seo-cta-translation-repair:[a-f0-9]{64}$/.test(budget.operationId) ||
    budget.phase !== "maximum" ||
    !isPositiveSafeInteger(budget.revision) ||
    budget.rowsRead !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS ||
    budget.rowsWritten !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES ||
    !hasExactKeys(maintenance, [
      "active",
      "delivery",
      "healthStatus",
      "maintenance",
      "mutationCode",
      "mutationStatus",
      "openNext",
      "runtime",
      "versionId",
    ]) ||
    maintenance?.active !== true ||
    maintenance.healthStatus !== 200 ||
    maintenance.mutationStatus !== 503 ||
    maintenance.mutationCode !== "write_freeze_active" ||
    maintenance.delivery !== "native-maintenance-worker" ||
    maintenance.runtime !== "cloudflare-workers" ||
    maintenance.openNext !== false ||
    maintenance.maintenance !== true ||
    maintenance.versionId !== maintenanceVersionId
  ) {
    throw new Error("The translation repair prewrite evidence is incomplete or invalid.");
  }
  const releasePreflight = objectRecord(readPrivateJsonNoFollow(releasePreflightPath));
  const sourceFingerprint = objectRecord(releasePreflight?.sourceFingerprint);
  const candidateProbe = objectRecord(releasePreflight?.candidateProbe);
  if (
    !hasExactKeys(releasePreflight, [
      "activeVersionId",
      "assetManifest",
      "candidateProbe",
      "candidateVersionId",
      "createdAt",
      "gitHead",
      "gitUpstream",
      "kind",
      "runId",
      "safetyChecks",
      "sourceFingerprint",
      "workerDeployEvidence",
      "workerDeployReportPath",
      "workerSourceSha256",
      "wranglerConfigSha256",
    ]) ||
    releasePreflight?.kind !== "d1-translation-repair-release-preflight" ||
    releasePreflight.runId !== runId ||
    !isCanonicalIsoTimestamp(releasePreflight.createdAt) ||
    releasePreflight.candidateVersionId !== candidateVersionId ||
    releasePreflight.activeVersionId !== candidateVersionId ||
    !isGitSha1(releasePreflight.gitHead) ||
    releasePreflight.gitUpstream !== releasePreflight.gitHead ||
    !isSha256(releasePreflight.workerSourceSha256) ||
    !isSha256(releasePreflight.wranglerConfigSha256) ||
    !hasExactKeys(sourceFingerprint, ["fileCount", "files", "sha256"]) ||
    !isSha256(sourceFingerprint?.sha256) ||
    !isPositiveSafeInteger(sourceFingerprint.fileCount) ||
    !Array.isArray(sourceFingerprint.files) ||
    sourceFingerprint.files.length !== sourceFingerprint.fileCount ||
    candidateProbe?.versionId !== candidateVersionId ||
    candidateProbe.maintenance !== false ||
    candidateProbe.openNext !== false ||
    typeof releasePreflight.workerDeployReportPath !== "string" ||
    path.dirname(path.resolve(releasePreflight.workerDeployReportPath)) !== directory ||
    objectRecord(releasePreflight.assetManifest) === null ||
    objectRecord(releasePreflight.safetyChecks) === null ||
    objectRecord(releasePreflight.workerDeployEvidence) === null
  ) {
    throw new Error("The translation repair release-preflight evidence is invalid.");
  }
  assertExactTranslationRepairBudgetLedger({
    ledgerPath: budget.ledgerPath,
    utcDay: budget.utcDay,
    minimumRevision: budget.revision,
    operationId: budget.operationId,
    candidateVersionId,
    sourceFingerprintSha256: sourceFingerprint.sha256,
    sourceFingerprintFileCount: sourceFingerprint.fileCount,
    prewriteCreatedAt: createdAt,
  });
  return {
    runId,
    repairRunId,
    createdAt,
    evidencePath,
    candidateVersionId,
    maintenanceVersionId,
    sourceFingerprintSha256: sourceFingerprint.sha256,
    timeTravelBookmark,
  };
}

function assertExactTranslationRepairBudgetLedger(input: {
  ledgerPath: string;
  utcDay: string;
  minimumRevision: number;
  operationId: string;
  candidateVersionId: string;
  sourceFingerprintSha256: string;
  sourceFingerprintFileCount: number;
  prewriteCreatedAt: string;
}) {
  const ledger = readD1ReleaseBudgetLedger(input.ledgerPath);
  if (ledger.utcDay !== input.utcDay || ledger.revision < input.minimumRevision) {
    throw new Error("The translation repair budget ledger identity or revision is invalid.");
  }
  const reservations = ledger.reservations.filter(
    (reservation) =>
      reservation.operationId === input.operationId &&
      reservation.sourceFingerprint.sha256 === input.sourceFingerprintSha256 &&
      reservation.sourceFingerprint.fileCount === input.sourceFingerprintFileCount,
  );
  if (
    reservations.length !== 1 ||
    reservations[0]?.operation !== "Remote SEO translation repair" ||
    reservations[0].candidateVersionId !== input.candidateVersionId ||
    reservations[0].phase !== "maximum" ||
    reservations[0].rowsRead !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS ||
    reservations[0].rowsWritten !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES ||
    reservations[0].maximumRowsRead !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS ||
    reservations[0].maximumRowsWritten !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES ||
    Date.parse(reservations[0].createdAt) > Date.parse(input.prewriteCreatedAt)
  ) {
    throw new Error("The translation repair budget ledger does not contain the exact prewrite reservation.");
  }
}

function readExistingLocalTranslationResolution(input: {
  directory: string;
  repairRunId: string;
  productionResolution: MaintenanceResolutionReport;
}) {
  const suffix = `-${input.repairRunId}.json`;
  const candidates = fs.readdirSync(input.directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.name.startsWith("d1-translation-repair-resolved-") &&
        entry.name.endsWith(suffix),
    );
  if (candidates.length !== 1) {
    throw new Error("Local translation repair resolution requires exactly one matching resolved record.");
  }
  const file = path.join(input.directory, candidates[0]!.name);
  const runId = candidates[0]!.name.slice(
    "d1-translation-repair-resolved-".length,
    -".json".length,
  );
  if (!isTranslationRepairRunId(runId)) {
    throw new Error("Local translation repair resolution has an invalid run identity.");
  }
  return readAndValidateLocalTranslationResolution({
    file,
    runId,
    repairRunId: input.repairRunId,
    productionResolution: input.productionResolution,
  });
}

function readAndValidateLocalTranslationResolution(input: {
  file: string;
  runId: string;
  repairRunId: string;
  productionResolution: MaintenanceResolutionReport;
}): LocalRepairResolutionReport {
  const value = objectRecord(readPrivateJsonNoFollow(input.file));
  const directory = path.dirname(input.file);
  const expectedEvidencePath = path.join(
    directory,
    `d1-translation-repair-prewrite-${input.runId}.json`,
  );
  const expectedProductionResolutionPath = path.join(directory, reportName);
  if (
    !hasExactKeys(value, [
      "candidateUnfrozen",
      "candidateVersionId",
      "createdAt",
      "evidencePath",
      "exactCandidateRestored",
      "exactVerificationPassed",
      "kind",
      "maintenanceVersionId",
      "productionMaintenanceStateAbsent",
      "productionResolutionReportPath",
      "repairRunId",
      "reviewedForwardCorrectionConfirmed",
      "runId",
    ]) ||
    value?.kind !== "d1-translation-repair-resolved-v2" ||
    !isCanonicalIsoTimestamp(value.createdAt) ||
    value.runId !== input.runId ||
    value.repairRunId !== input.repairRunId ||
    value.evidencePath !== expectedEvidencePath ||
    value.productionResolutionReportPath !== expectedProductionResolutionPath ||
    value.candidateVersionId !== input.productionResolution.candidateVersionId ||
    value.maintenanceVersionId !== input.productionResolution.maintenanceVersionId ||
    value.exactVerificationPassed !== false ||
    value.reviewedForwardCorrectionConfirmed !== true ||
    value.exactCandidateRestored !== true ||
    value.productionMaintenanceStateAbsent !== true ||
    value.candidateUnfrozen !== true
  ) {
    throw new Error("Existing local translation repair resolution evidence is invalid.");
  }
  return {
    kind: "d1-translation-repair-resolved-v2",
    createdAt: value.createdAt,
    runId: input.runId,
    repairRunId: input.repairRunId,
    evidencePath: value.evidencePath,
    productionResolutionReportPath: value.productionResolutionReportPath,
    candidateVersionId: input.productionResolution.candidateVersionId,
    maintenanceVersionId: input.productionResolution.maintenanceVersionId,
    exactVerificationPassed: false,
    reviewedForwardCorrectionConfirmed: true,
    exactCandidateRestored: true,
    productionMaintenanceStateAbsent: true,
    candidateUnfrozen: true,
  };
}

function readSuccessfulResolutionReport(backupDir: string, repairRunId: string) {
  const reportPath = path.join(cloudflareDir(path.resolve(backupDir)), reportName);
  const value = objectRecord(readPrivateJsonNoFollow(reportPath));
  if (
    !hasExactKeys(value, [
      "activeVersionAfter",
      "activeVersionBefore",
      "candidateVersionId",
      "createdAt",
      "exclusionReleased",
      "kind",
      "maintenanceVersionId",
      "markerCleared",
      "ok",
      "repairRunId",
      "responseRecoveredByReadback",
    ]) ||
    value?.kind !== "production-maintenance-resolution-v1" ||
    !isCanonicalIsoTimestamp(value.createdAt) ||
    value.ok !== true ||
    value.repairRunId !== repairRunId ||
    typeof value.candidateVersionId !== "string" ||
    !isLowercaseGenericUuid(value.candidateVersionId) ||
    typeof value.maintenanceVersionId !== "string" ||
    !isLowercaseGenericUuid(value.maintenanceVersionId) ||
    value.candidateVersionId === value.maintenanceVersionId ||
    (value.activeVersionBefore !== value.candidateVersionId &&
      value.activeVersionBefore !== value.maintenanceVersionId) ||
    value.activeVersionAfter !== value.candidateVersionId ||
    typeof value.responseRecoveredByReadback !== "boolean" ||
    value.markerCleared !== true ||
    value.exclusionReleased !== true
  ) {
    throw new Error("Successful exact production maintenance resolution evidence is required.");
  }
  return {
    kind: "production-maintenance-resolution-v1",
    createdAt: value.createdAt,
    ok: true,
    repairRunId,
    candidateVersionId: value.candidateVersionId,
    maintenanceVersionId: value.maintenanceVersionId,
    activeVersionBefore: value.activeVersionBefore,
    activeVersionAfter: value.candidateVersionId,
    responseRecoveredByReadback: value.responseRecoveredByReadback,
    markerCleared: true,
    exclusionReleased: true,
  } satisfies MaintenanceResolutionReport;
}

function readPreliminaryResolutionReport(
  backupDir: string,
  context: LocalUnresolvedRepairContext,
): MaintenanceResolutionReport {
  const reportPath = path.join(cloudflareDir(path.resolve(backupDir)), reportName);
  const value = objectRecord(readPrivateJsonNoFollow(reportPath));
  if (
    !hasExactKeys(value, [
      "activeVersionAfter",
      "activeVersionBefore",
      "candidateVersionId",
      "createdAt",
      "error",
      "exclusionReleased",
      "kind",
      "maintenanceVersionId",
      "markerCleared",
      "ok",
      "repairRunId",
      "responseRecoveredByReadback",
    ]) ||
    value?.kind !== "production-maintenance-resolution-v1" ||
    !isCanonicalIsoTimestamp(value.createdAt) ||
    value.ok !== false ||
    value.repairRunId !== context.repairRunId ||
    value.candidateVersionId !== context.candidateVersionId ||
    value.maintenanceVersionId !== context.maintenanceVersionId ||
    (value.activeVersionBefore !== context.candidateVersionId &&
      value.activeVersionBefore !== context.maintenanceVersionId) ||
    value.activeVersionAfter !== context.candidateVersionId ||
    typeof value.responseRecoveredByReadback !== "boolean" ||
    value.markerCleared !== false ||
    value.exclusionReleased !== false ||
    value.error !== "Pending exact marker clear and exclusion release."
  ) {
    throw new Error("Exact preliminary production maintenance resolution evidence is required.");
  }
  return {
    kind: "production-maintenance-resolution-v1",
    createdAt: value.createdAt,
    ok: false,
    repairRunId: context.repairRunId,
    candidateVersionId: context.candidateVersionId,
    maintenanceVersionId: context.maintenanceVersionId,
    activeVersionBefore: value.activeVersionBefore,
    activeVersionAfter: context.candidateVersionId,
    responseRecoveredByReadback: value.responseRecoveredByReadback,
    markerCleared: false,
    exclusionReleased: false,
    error: "Pending exact marker clear and exclusion release.",
  } satisfies MaintenanceResolutionReport;
}

function runBoundedWrangler(args: string[]) {
  const actual = {
    command: path.resolve(process.cwd(), "node_modules/.bin/wrangler"),
    args,
  };
  const bounded = boundedReleaseChildCommand(actual, process.cwd());
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bounded.command, bounded.args, {
      cwd: process.cwd(),
      env: commandEnv(),
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    let spawnError: Error | null = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (status) => {
      if (spawnError) reject(spawnError);
      else if (status !== 0) reject(new Error(`Bounded Wrangler resolution command exited with status ${status ?? "unknown"}.`));
      else resolve();
    });
  });
}

async function assertCandidateIsUnfrozen(expectedVersionId: string) {
  const [healthResponse, freezeResponse] = await Promise.all([
    fetch(`${productionBaseUrl}/api/health`, {
      headers: { accept: "application/json", "cache-control": "no-store" },
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(`${productionBaseUrl}/api/migration/write-freeze`, {
      headers: { accept: "application/json", "cache-control": "no-store" },
      signal: AbortSignal.timeout(10_000),
    }),
  ]);
  const health: unknown = await healthResponse.json().catch(() => null);
  const freeze: unknown = await freezeResponse.json().catch(() => null);
  const healthRecord = objectRecord(health);
  const version = objectRecord(healthRecord?.version);
  const freezeRecord = objectRecord(freeze);
  if (
    !healthResponse.ok ||
    version?.id !== expectedVersionId ||
    freezeResponse.status !== 409 ||
    freezeRecord?.writeFreezeActive !== false ||
    freezeRecord?.code !== "write_freeze_inactive" ||
    freezeRecord?.versionId !== expectedVersionId
  ) {
    throw new Error("Production candidate health/write-freeze probes did not prove the exact unfrozen version.");
  }
}

function report(input: Omit<MaintenanceResolutionReport, "kind" | "createdAt">): MaintenanceResolutionReport {
  return {
    kind: "production-maintenance-resolution-v1",
    createdAt: new Date().toISOString(),
    ...input,
  };
}

function writeReport(backupDir: string, value: MaintenanceResolutionReport) {
  const file = path.join(cloudflareDir(backupDir), reportName);
  writePrivateJsonDurably(file, value, { replace: fs.existsSync(file) });
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requireRunId(value: string | undefined) {
  if (!value || !isLowercaseRfcUuid(value)) {
    throw new Error("Production maintenance repair run must be a lowercase RFC UUID.");
  }
  return value;
}

function isLowercaseRfcUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isLowercaseGenericUuid(value: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

function isTranslationRepairRunId(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-([0-9a-f-]+)$/.exec(value);
  if (!match || !match[8] || !isLowercaseRfcUuid(match[8])) return false;
  const timestamp = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`;
  return isCanonicalIsoTimestamp(timestamp);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isCanonicalUtcDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString().slice(0, 10) === value;
}

function isSameOrImmediateNextUtcDay(ledgerDay: string, evidenceDay: string) {
  if (!isCanonicalUtcDay(ledgerDay) || !isCanonicalUtcDay(evidenceDay)) return false;
  const ledgerTimestamp = Date.parse(`${ledgerDay}T00:00:00.000Z`);
  const evidenceTimestamp = Date.parse(`${evidenceDay}T00:00:00.000Z`);
  return evidenceTimestamp === ledgerTimestamp || evidenceTimestamp === ledgerTimestamp + 86_400_000;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isGitSha1(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function pathEntryExistsNoFollow(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function objectRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(
  value: Record<string, unknown> | null,
  expected: readonly string[],
) {
  if (!value) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error("Unknown production maintenance resolution failure.");
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function safeErrorMessage(value: unknown) {
  if (value instanceof AggregateError) {
    return `${value.message}: ${value.errors.map(asError).map((error) => error.message).join("; ")}`.slice(0, 2_000);
  }
  return asError(value).message.slice(0, 2_000);
}
