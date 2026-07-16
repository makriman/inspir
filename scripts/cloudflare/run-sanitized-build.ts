import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  cloudflareDir,
  commandEnv,
  resolveBackupDir,
  runWrangler,
} from "./migration-config";
import {
  buildArtifactScanReport,
  writeBuildArtifactScanReport,
} from "./scan-build-artifacts";
import {
  buildSanitizedCloudflareBuildEnv,
  localPreviewRuntimeDotEnvContent,
  localPreviewRuntimeEnv,
  resolveLocalPreviewProviderRuntimeSecrets,
  type LocalPreviewProviderRuntimeSecrets,
  withSanitizedProjectEnvFiles,
} from "./sanitized-build-env";
import { inspectOpenNextResourceBudget } from "./check-opennext-resource-budget";
import {
  materializeStaticMarketingAssets,
  validateStaticMarketingAssetRelease,
} from "./materialize-static-marketing-assets";
import {
  acquireProductionValidationExclusion,
  assertProductionValidationExclusionCommandWindow,
  assertNoLiveProductionValidationLock,
  attestProductionValidationExclusion,
  PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS,
  releaseProductionValidationExclusion,
  type ProductionValidationExclusion,
} from "./production-validation-lock";
import {
  assertWorkerDeployArtifactEvidenceUnchanged,
  createPrivateWranglerOutputFile,
  createWorkerDeployEvidenceSession,
  readPrivateWranglerOutputFile,
  readSoleActiveWorkerVersion,
  type ActiveWorkerVersionReader,
  type WorkerDeployArtifactEvidence,
  type WorkerDeployEvidenceFinishInput,
} from "./worker-deploy-evidence";
import { runBoundedReleaseChildSync } from "./run-production-release-operation";
import {
  WORKER_DEPLOY_PREPARATION_MAX_AGE_MS,
  assertWorkerDeployPreparationUploadBinding,
  assertWorkerDeployPreparationBoundStateUnchanged,
  assertWorkerDeployPreparationMatchesArtifacts,
  readAndValidateWorkerDeployPreparation,
  readAndValidateWorkerDeployPreparationProvenance,
  type WorkerDeployPreparationHandle,
} from "./worker-deploy-preparation";
import {
  finalizeWorkerCandidateActivationEvidence,
  finalizeWorkerCandidateStagedEvidence,
  finalizeWorkerCandidateUploadEvidence,
  parseSoleBaselineTopology,
  parseStagedWorkerTopology,
  parseWorkerDeploymentStatusOutput,
  parseWorkerVersionDeployOutput,
  parseWorkerVersionUploadOutput,
  readWorkerCandidateStagedEvidence,
  readWorkerCandidateUploadEvidence,
  verifyWorkerCandidateStagedEvidence,
  workerCandidateActivationEvidencePath,
  workerReleaseMessageSha256,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
  WORKER_CANDIDATE_WORKER_NAME,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateStagedEvidence,
  type WorkerCandidateUploadEvidence,
} from "./worker-candidate-release-evidence";
import {
  readAndValidateWorkerCandidatePreActivationSeal,
  type WorkerCandidatePreActivationSealHandle,
} from "./worker-candidate-pre-activation-seal";
import { readAndValidateProductionTrustBoundaryAcceptance } from "./production-trust-boundary-acceptance";

type CommandMode =
  | "next-build"
  | "opennext-build"
  | "worker-upload-candidate"
  | "worker-stage-candidate"
  | "worker-activate-candidate"
  | "wrangler-preview";
export type DeployPreflightResult = { ok: boolean; status: number | null };
type DeployPreflightWorkerTopologyPhase =
  | "baseline-sole-active"
  | "candidate-staged"
  | "candidate-active";
type DeployPreflightRunner = (
  backupDir: string,
  workerTopologyPhase?: DeployPreflightWorkerTopologyPhase,
) => DeployPreflightResult;
type WranglerReadRunner = (args: string[]) => string;
type RunSanitizedBuildOptions = {
  deployPreflight?: DeployPreflightRunner;
  readDeployPreparation?: (
    backupDir: string,
  ) => WorkerDeployPreparationHandle;
  readDeployPreparationProvenance?: (
    backupDir: string,
    uploadEvidence: WorkerCandidateUploadEvidence,
  ) => WorkerDeployPreparationHandle;
  readActiveWorkerVersion?: ActiveWorkerVersionReader;
  runWranglerRead?: WranglerReadRunner;
  finalizeCandidateUploadEvidence?: typeof finalizeWorkerCandidateUploadEvidence;
  finalizeCandidateStagedEvidence?: typeof finalizeWorkerCandidateStagedEvidence;
  finalizeCandidateActivationEvidence?: typeof finalizeWorkerCandidateActivationEvidence;
  readCandidatePreActivationSeal?: typeof readAndValidateWorkerCandidatePreActivationSeal;
  assertValidationLockAvailable?: () => void;
  readTrustAcceptance?: (backupDir: string) => unknown;
};

type CandidateUploadContext = Readonly<{
  kind: "upload";
  baselineVersionId: string;
}>;

type CandidateActivationContext = Readonly<{
  kind: "activation";
  baselineVersionId: string;
  candidateVersionId: string;
  uploadHandle: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  stagedHandle: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  preActivationSealHandle: WorkerCandidatePreActivationSealHandle;
}>;

type CandidateStagingContext = Readonly<{
  kind: "staging";
  baselineVersionId: string;
  candidateVersionId: string;
  uploadHandle: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
}>;

type CandidateReleaseContext =
  | CandidateUploadContext
  | CandidateStagingContext
  | CandidateActivationContext;

export const WORKER_CANDIDATE_ACTIVATION_COMMAND_TIMEOUT_MS =
  10 * 60 * 1_000;
export const WORKER_CANDIDATE_ACTIVATION_SEAL_MARGIN_MS = 2 * 60 * 1_000;

const COMMANDS: Record<
  CommandMode,
  { executable: string; args: string[]; buildBefore?: boolean; scanBefore?: boolean; scanAfter?: boolean }
> = {
  "next-build": {
    executable: bin("next"),
    args: ["build", "--webpack"],
  },
  "opennext-build": {
    executable: bin("opennextjs-cloudflare"),
    args: ["build"],
    scanAfter: true,
  },
  "worker-upload-candidate": {
    executable: bin("wrangler"),
    args: ["versions", "upload", "--config", "wrangler.jsonc", "--strict"],
    scanBefore: true,
  },
  "worker-stage-candidate": {
    executable: bin("wrangler"),
    args: ["versions", "deploy"],
    scanBefore: true,
  },
  "worker-activate-candidate": {
    executable: bin("wrangler"),
    args: ["versions", "deploy"],
    scanBefore: true,
  },
  "wrangler-preview": {
    executable: bin("wrangler"),
    args: ["dev", "--show-interactive-dev-session=false"],
    buildBefore: true,
    scanBefore: true,
  },
};

const BLOCKED_OPENNEXT_SKIP_BUILD_ARGS = ["--skipNextBuild", "--skipBuild", "-s"] as const;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] as CommandMode | undefined;
  const passthroughArgs = process.argv.slice(3);
  const result = runSanitizedBuildCommand(mode, passthroughArgs);
  process.exit(result.status ?? 1);
}

export function runSanitizedBuildCommand(
  mode: CommandMode | undefined,
  passthroughArgs: string[] = [],
  options: RunSanitizedBuildOptions = {},
) {
  if (!mode || !COMMANDS[mode]) {
    console.error(`Usage: tsx scripts/cloudflare/run-sanitized-build.ts ${Object.keys(COMMANDS).join("|")} [...args]`);
    return { status: 2 };
  }

  const command = COMMANDS[mode];
  const resourceBudgetRequiredBeforeCommand =
    command.buildBefore === true || requiresSealedProductionArtifacts(mode);
  const deployEvidence = createWorkerDeployEvidenceWriter(
    mode,
    command,
    passthroughArgs,
    options.readActiveWorkerVersion ??
      (options.runWranglerRead
        ? () => readSoleActiveWorkerVersion(options.runWranglerRead)
        : undefined),
  );
  let candidateReleaseContext: CandidateReleaseContext | null = null;
  let wranglerOutputPath: string | null = null;
  let productionDeployPreflightResult: DeployPreflightResult | null = null;
  const productionDeployBackupDir = requiresSealedProductionArtifacts(mode)
    ? resolveBackupDir()
    : null;
  const deployPreflight = options.deployPreflight ?? runProductionDeployPreflight;
  const readFreshDeployPreparation =
    options.readDeployPreparation ??
    ((backupDir: string) =>
      readAndValidateWorkerDeployPreparation({
        cwd: process.cwd(),
        backupDirectory: backupDir,
      }));
  const readDeployPreparationProvenance =
    options.readDeployPreparationProvenance ??
    ((backupDir: string, uploadEvidence: WorkerCandidateUploadEvidence) =>
      readAndValidateWorkerDeployPreparationProvenance({
        cwd: process.cwd(),
        backupDirectory: backupDir,
        uploadEvidence,
      }));
  const readDeployPreparation = (backupDir: string) => {
    if (mode === "worker-upload-candidate") {
      return readFreshDeployPreparation(backupDir);
    }
    const upload = readWorkerCandidateUploadEvidence(
      workerCandidateUploadEvidencePath(backupDir),
    );
    return readDeployPreparationProvenance(backupDir, upload.value);
  };
  let deployPreparation: WorkerDeployPreparationHandle | null = null;
  const immutableDeployArgs = blockedImmutableWorkerDeployArgs(mode, passthroughArgs);
  const blockedArgs = immutableDeployArgs.length
    ? immutableDeployArgs
    : blockedOpenNextSkipBuildArgs(mode, passthroughArgs);
  if (blockedArgs.length) {
    const reason = immutableDeployArgs.length
      ? "Production Worker deploy/upload passthrough arguments can change the evidenced entry point, assets, config, or target"
      : "OpenNext skip-build arguments bypass the sanitized build";
    console.error(`Refusing argument(s) in sanitized Cloudflare build path: ${blockedArgs.join(", ")}. ${reason}.`);
    return deployEvidence.finish(2, {
      commandExecuted: false,
      scanBeforeOk: null,
      scanAfterOk: null,
      blockedArgs,
      error: `${reason}: ${blockedArgs.join(", ")}`,
    });
  }

  if (requiresRemotePreviewTrustAcceptance(mode, passthroughArgs)) {
    try {
      (options.readTrustAcceptance ??
        ((backupDir: string) =>
          readAndValidateProductionTrustBoundaryAcceptance({
            cwd: process.cwd(),
            backupDirectory: backupDir,
          })))(resolveBackupDir());
    } catch (error) {
      return deployEvidence.finish(1, {
        commandExecuted: false,
        scanBeforeOk: null,
        scanAfterOk: null,
        error: `Remote Wrangler preview requires the exact current production trust acceptance: ${errorMessage(error)}`,
      });
    }
  }

  if (requiresSealedProductionArtifacts(mode)) {
    if (!productionDeployBackupDir) {
      throw new Error("Production deploy preflight omitted its backup directory.");
    }
    try {
      deployPreparation = readDeployPreparation(productionDeployBackupDir);
      deployEvidence.bindPreparation(deployPreparation);
      assertWorkerDeployPreparationBoundStateUnchanged({
        handle: deployPreparation,
        cwd: process.cwd(),
        backupDirectory: productionDeployBackupDir,
      });
    } catch (error) {
      return deployEvidence.finish(1, {
        commandExecuted: false,
        deployPreflightOk: false,
        deployPreflightStatus: null,
        resourceBudgetOk: null,
        scanBeforeOk: null,
        scanAfterOk: null,
        error: `Sealed pre-cutover Worker deploy preparation is missing or invalid: ${errorMessage(error)}`,
      });
    }
    if (requiresProductionDeployPreflight(mode)) {
      const initialPreflight = deployPreflight(
        productionDeployBackupDir,
        "candidate-staged",
      );
      productionDeployPreflightResult = initialPreflight;
      if (!initialPreflight.ok) {
        console.error("Refusing candidate activation because final deploy preflight did not pass.");
        return deployEvidence.finish(initialPreflight.status ?? 1, {
          commandExecuted: false,
          deployPreflightOk: false,
          deployPreflightStatus: initialPreflight.status,
          scanBeforeOk: null,
          scanAfterOk: null,
          error: `Deploy preflight exited with status ${initialPreflight.status ?? "unknown"}.`,
        });
      }
    }
  }

  if (isCandidateWorkerOperation(mode)) {
    try {
      (options.assertValidationLockAvailable ?? assertNoLiveProductionValidationLock)();
    } catch (error) {
      return deployEvidence.finish(1, {
        commandExecuted: false,
        deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
        deployPreflightStatus: productionDeployPreflightResult?.status,
        resourceBudgetOk: null,
        scanBeforeOk: null,
        scanAfterOk: null,
        error: `Production deployment lock absence was not proved before sealed activation: ${errorMessage(error)}`,
      });
    }
  }

  const localPreviewProviderSecrets =
    mode === "wrangler-preview"
      ? resolveLocalPreviewProviderRuntimeSecrets(commandEnv())
      : Object.freeze({});
  const localCliBinDir = createLocalCliWrappers();
  return withSanitizedProjectEnvFiles(() => {
    try {
      const env = buildSanitizedCloudflareBuildEnv();
      applyNativeWranglerDeployEnvironment(mode, env);
      env.PATH = [localCliBinDir, env.PATH].filter(Boolean).join(path.delimiter);

      if (command.buildBefore) {
        const buildCommand = COMMANDS["opennext-build"];
        const buildResult = spawnSync(buildCommand.executable, buildCommand.args, {
          cwd: process.cwd(),
          env,
          stdio: "inherit",
        });
        if (buildResult.status !== 0) {
          return deployEvidence.finish(buildResult.status ?? 1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: null,
            scanBeforeOk: null,
            scanAfterOk: null,
            error: `OpenNext build before ${mode} exited with status ${buildResult.status ?? "unknown"}.`,
          });
        }

        try {
          materializeStaticMarketingAssets(process.cwd());
          pruneUnusedOpenNextServerRuntime(process.cwd());
        } catch (error) {
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: null,
            scanBeforeOk: null,
            scanAfterOk: null,
            error: `Static marketing asset materialization failed before ${mode}: ${errorMessage(error)}`,
          });
        }

      }

      if (resourceBudgetRequiredBeforeCommand) {
        const resourceBudget = inspectOpenNextResourceBudget(process.cwd());
        if (!resourceBudget.ok) {
          console.error(`OpenNext resource budget failed before ${mode}: ${JSON.stringify(resourceBudget)}`);
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: false,
            scanBeforeOk: null,
            scanAfterOk: null,
            error: `OpenNext resource budget failed before ${mode}.`,
          });
        }
      }

      if (command.scanBefore) {
        const report = requiresSealedProductionArtifacts(mode)
          ? buildArtifactScanReport(
              process.cwd(),
              requireProductionDeployBackupDir(productionDeployBackupDir),
            )
          : writeBuildArtifactScanReport();
        if (!report.ok) {
          printScanFailure(report.findings.length);
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: resourceBudgetRequiredBeforeCommand
              ? true
              : undefined,
            scanBeforeOk: false,
            scanAfterOk: null,
            error: `OpenNext artifact scan failed with ${report.findings.length} finding(s).`,
          });
        }
      }

      let localPreviewConfig: string | null = null;
      let commandArgs = passthroughArgs;
      if (mode === "wrangler-preview") {
        clearLocalPreviewCacheApiState();
        writeLocalPreviewRuntimeVars(localPreviewProviderSecrets);
        Object.assign(env, localPreviewRuntimeEnv());
        localPreviewConfig = writeLocalPreviewWranglerConfig();
        commandArgs = passthroughArgs.some((arg) => arg === "--config" || arg === "-c" || arg.startsWith("--config="))
          ? passthroughArgs
          : ["--config", localPreviewConfig, ...passthroughArgs];
      }

      if (isCandidateWorkerOperation(mode)) {
        try {
          (options.assertValidationLockAvailable ?? assertNoLiveProductionValidationLock)();
        } catch (error) {
          if (localPreviewConfig) fs.rmSync(localPreviewConfig, { force: true });
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: resourceBudgetRequiredBeforeCommand
              ? true
              : undefined,
            scanBeforeOk: command.scanBefore ? true : null,
            scanAfterOk: null,
            error: `Production deployment lock absence was not proved: ${errorMessage(error)}`,
          });
        }
      }

      let freshStaticAssetRelease: ReturnType<
        typeof validateStaticMarketingAssetRelease
      > | null = null;
      let commandArtifactEvidence: WorkerDeployArtifactEvidence | undefined;
      try {
        if (requiresSealedProductionArtifacts(mode)) {
          const staticValidationNowMs =
            deployPreparation?.validation === "immutable-upload-provenance"
              ? Date.parse(deployPreparation.artifact.createdAt)
              : undefined;
          freshStaticAssetRelease = validateStaticMarketingAssetRelease(
            process.cwd(),
            {
              nowMs: staticValidationNowMs,
              maxAgeMs: WORKER_DEPLOY_PREPARATION_MAX_AGE_MS,
            },
          );
        }
        commandArtifactEvidence = deployEvidence.captureCommandArtifacts();
        if (requiresSealedProductionArtifacts(mode)) {
          if (!deployPreparation || !commandArtifactEvidence) {
            throw new Error(
              "Production activation omitted its sealed deploy preparation or command artifacts.",
            );
          }
          assertWorkerDeployPreparationMatchesArtifacts(
            deployPreparation,
            commandArtifactEvidence,
          );
          assertWorkerDeployPreparationBoundStateUnchanged({
            handle: deployPreparation,
            cwd: process.cwd(),
            backupDirectory: requireProductionDeployBackupDir(
              productionDeployBackupDir,
            ),
          });
        }
        if (freshStaticAssetRelease && commandArtifactEvidence) {
          const validatedManifest = freshStaticAssetRelease.assetManifest;
          const capturedManifest = commandArtifactEvidence.assetManifest;
          if (
            validatedManifest.root !== capturedManifest.root ||
            validatedManifest.fileCount !== capturedManifest.fileCount ||
            validatedManifest.bytes !== capturedManifest.bytes ||
            validatedManifest.sha256 !== capturedManifest.sha256
          ) {
            throw new Error(
              "Static Assets changed between fresh release validation and deploy artifact capture.",
            );
          }
        }
      } catch (error) {
        if (localPreviewConfig) fs.rmSync(localPreviewConfig, { force: true });
        return deployEvidence.finish(1, {
          commandExecuted: false,
          deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
          deployPreflightStatus: productionDeployPreflightResult?.status,
          resourceBudgetOk: resourceBudgetRequiredBeforeCommand
            ? true
            : undefined,
          scanBeforeOk: command.scanBefore ? true : null,
          scanAfterOk: null,
          error: `Fresh Static Asset release or immutable Worker deploy artifact evidence failed before ${mode}: ${errorMessage(error)}`,
        });
      }

      if (isCandidateWorkerOperation(mode)) {
        try {
          if (!deployPreparation || !commandArtifactEvidence) {
            throw new Error(
              "Candidate release identity resolution omitted its sealed preparation or artifacts.",
            );
          }
          candidateReleaseContext = resolveCandidateReleaseContext({
            mode,
            backupDir: requireProductionDeployBackupDir(
              productionDeployBackupDir,
            ),
            runWranglerRead:
              options.runWranglerRead ?? ((args) => runWrangler(args)),
            deployPreparation,
            artifacts: commandArtifactEvidence,
            readCandidatePreActivationSeal:
              options.readCandidatePreActivationSeal ??
              readAndValidateWorkerCandidatePreActivationSeal,
          });
          deployEvidence.bindTargetCandidate(
            candidateReleaseContext.kind === "upload"
              ? undefined
              : candidateReleaseContext.candidateVersionId,
          );
          deployEvidence.bindPreActivationSeal(
            candidateReleaseContext.kind === "activation"
              ? candidateReleaseContext.preActivationSealHandle.sha256
              : undefined,
          );
        } catch (error) {
          if (localPreviewConfig) fs.rmSync(localPreviewConfig, { force: true });
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk:
              productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: resourceBudgetRequiredBeforeCommand
              ? true
              : undefined,
            scanBeforeOk: command.scanBefore ? true : null,
            scanAfterOk: null,
            error: `Worker candidate release identity or starting topology is invalid: ${errorMessage(error)}`,
          });
        }
      }

      let deploymentExclusion: ProductionValidationExclusion | null = null;
      if (isCandidateWorkerOperation(mode)) {
        try {
          if (!commandArtifactEvidence || !candidateReleaseContext) {
            throw new Error(
              "Immutable deploy artifacts or candidate release identity were not captured before lock acquisition.",
            );
          }
          deploymentExclusion = acquireProductionValidationExclusion({
            candidateVersionId:
              candidateReleaseContext.kind === "upload"
                ? candidateReleaseContext.baselineVersionId
                : candidateReleaseContext.candidateVersionId,
            sourceFingerprintSha256: commandArtifactEvidence.sourceFingerprint.sha256,
          });
        } catch (error) {
          if (localPreviewConfig) fs.rmSync(localPreviewConfig, { force: true });
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: resourceBudgetRequiredBeforeCommand
              ? true
              : undefined,
            scanBeforeOk: command.scanBefore ? true : null,
            scanAfterOk: null,
            error: `Production deployment exclusion could not be acquired: ${errorMessage(error)}`,
          });
        }
      }

      if (deploymentExclusion && commandArtifactEvidence) {
        try {
          deploymentExclusion = attestProductionValidationExclusion(deploymentExclusion);
          assertProductionValidationExclusionCommandWindow(deploymentExclusion);
          if (!candidateReleaseContext || !deployPreparation) {
            throw new Error(
              "Locked Worker candidate revalidation omitted its release identity or sealed preparation.",
            );
          }
          assertCandidateEvidenceTargetsAbsent(
            candidateReleaseContext,
            requireProductionDeployBackupDir(productionDeployBackupDir),
          );
          assertCandidateStartingTopology({
            context: candidateReleaseContext,
            output: (options.runWranglerRead ?? ((args) => runWrangler(args)))(
              workerDeploymentStatusArgs(),
            ),
          });
          assertExactDeployPreparationUnchanged({
            initial: deployPreparation,
            current: readDeployPreparation(
              requireProductionDeployBackupDir(productionDeployBackupDir),
            ),
            backupDir: requireProductionDeployBackupDir(
              productionDeployBackupDir,
            ),
            artifacts: commandArtifactEvidence,
          });
          assertCandidatePreActivationSealUnchanged({
            context: candidateReleaseContext,
            backupDir: requireProductionDeployBackupDir(
              productionDeployBackupDir,
            ),
            deployPreparation,
            artifacts: commandArtifactEvidence,
            readSeal:
              options.readCandidatePreActivationSeal ??
              readAndValidateWorkerCandidatePreActivationSeal,
          });
          assertWorkerDeployArtifactEvidenceUnchanged(commandArtifactEvidence);
        } catch (error) {
          if (localPreviewConfig) fs.rmSync(localPreviewConfig, { force: true });
          return finishWorkerCommandWithExclusion({
            exclusion: deploymentExclusion,
            finish: deployEvidence.finish,
            status: 1,
            extra: {
              commandExecuted: false,
              deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
              deployPreflightStatus: productionDeployPreflightResult?.status,
              resourceBudgetOk: resourceBudgetRequiredBeforeCommand
                ? true
                : undefined,
              scanBeforeOk: command.scanBefore ? true : null,
              scanAfterOk: null,
              error: `Locked production deployment revalidation failed: ${errorMessage(error)}`,
            },
          });
        }
      }

      const actualCommand = {
        command: command.executable,
        args:
          mode === "worker-activate-candidate"
            ? buildCandidateActivationVersionCommand(
                requireActivationContext(candidateReleaseContext)
                  .candidateVersionId,
              )
            : mode === "worker-stage-candidate"
              ? buildCandidateStagingVersionCommand(
                  requireStagingContext(candidateReleaseContext)
                    .baselineVersionId,
                  requireStagingContext(candidateReleaseContext)
                    .candidateVersionId,
                )
            : mode === "worker-upload-candidate"
              ? buildCandidateUploadVersionCommand(
                  requireWorkerReleaseIdentity(deployPreparation),
                ).args
            : [...command.args, ...commandArgs],
      };
      deployEvidence.bindCommand([
        actualCommand.command,
        ...actualCommand.args,
      ]);
      const commandBoundary = requiresProductionDeployPreflight(mode)
        ? runAfterFinalProductionDeployPreflight({
            backupDir: requireProductionDeployBackupDir(
              productionDeployBackupDir,
            ),
            deployPreflight,
            workerTopologyPhase: "candidate-staged",
            onRejected: (finalPreflight, preflightError) => {
              productionDeployPreflightResult = finalPreflight;
              return {
                kind: "blocked" as const,
                result: finishWorkerCommandWithExclusion({
                  exclusion: deploymentExclusion,
                  finish: deployEvidence.finish,
                  status: finalPreflight.status ?? 1,
                  extra: {
                    commandExecuted: false,
                    deployPreflightOk: false,
                    deployPreflightStatus: finalPreflight.status,
                    resourceBudgetOk: resourceBudgetRequiredBeforeCommand
                      ? true
                      : undefined,
                    scanBeforeOk: command.scanBefore ? true : null,
                    scanAfterOk: null,
                    error: preflightError
                      ? `Final deploy preflight failed before the external command: ${errorMessage(preflightError)}`
                      : `Final deploy preflight exited with status ${finalPreflight.status ?? "unknown"} before the external command.`,
                  },
                }),
              };
            },
            runCommand: (finalPreflight) => {
              productionDeployPreflightResult = finalPreflight;
              try {
                if (!deployPreparation || !commandArtifactEvidence) {
                  throw new Error(
                    "Final activation omitted its sealed deploy preparation or command artifacts.",
                  );
                }
                const finalBackupDir = requireProductionDeployBackupDir(
                  productionDeployBackupDir,
                );
                assertExactDeployPreparationUnchanged({
                  initial: deployPreparation,
                  current: readDeployPreparation(finalBackupDir),
                  backupDir: finalBackupDir,
                  artifacts: commandArtifactEvidence,
                });
                assertWorkerDeployArtifactEvidenceUnchanged(
                  commandArtifactEvidence,
                );
                if (deploymentExclusion) {
                  // The full preflight may consume time while the exclusion is
                  // held. Renew and revalidate the exact locked boundary after
                  // it passes, leaving only bounded checks before Wrangler.
                  deploymentExclusion = attestProductionValidationExclusion(
                    deploymentExclusion,
                  );
                  assertProductionValidationExclusionCommandWindow(
                    deploymentExclusion,
                  );
                  assertCandidateEvidenceTargetsAbsent(
                    requireCandidateReleaseContext(
                      candidateReleaseContext,
                    ),
                    finalBackupDir,
                  );
                  assertCandidateStartingTopology({
                    context: requireCandidateReleaseContext(
                      candidateReleaseContext,
                    ),
                    output: (
                      options.runWranglerRead ?? ((args) => runWrangler(args))
                    )(workerDeploymentStatusArgs()),
                  });
                }
                assertCandidatePreActivationSealUnchanged({
                  context: requireCandidateReleaseContext(
                    candidateReleaseContext,
                  ),
                  backupDir: finalBackupDir,
                  deployPreparation,
                  artifacts: commandArtifactEvidence,
                  readSeal:
                    options.readCandidatePreActivationSeal ??
                    readAndValidateWorkerCandidatePreActivationSeal,
                  minimumRemainingValidityMs:
                    WORKER_CANDIDATE_ACTIVATION_COMMAND_TIMEOUT_MS +
                    WORKER_CANDIDATE_ACTIVATION_SEAL_MARGIN_MS,
                });
              } catch (error) {
                return {
                  kind: "blocked" as const,
                  result: finishWorkerCommandWithExclusion({
                    exclusion: deploymentExclusion,
                    finish: deployEvidence.finish,
                    status: 1,
                    extra: {
                      commandExecuted: false,
                      deployPreflightOk: true,
                      deployPreflightStatus: finalPreflight.status,
                      resourceBudgetOk: resourceBudgetRequiredBeforeCommand
                        ? true
                        : undefined,
                      scanBeforeOk: command.scanBefore ? true : null,
                      scanAfterOk: null,
                      error: `Final sealed production deployment revalidation failed: ${errorMessage(error)}`,
                    },
                  }),
                };
              }
              wranglerOutputPath = createPrivateWranglerOutputFile(
                requireProductionDeployBackupDir(productionDeployBackupDir),
                "worker-candidate-activation",
              );
              env.WRANGLER_OUTPUT_FILE_PATH = wranglerOutputPath;
              deployEvidence.bindWranglerOutput(wranglerOutputPath);
              return {
                kind: "executed" as const,
                result: runBoundedReleaseChildSync(actualCommand, {
                  cwd: process.cwd(),
                  env,
                  stdio: "inherit",
                  timeoutMs:
                    WORKER_CANDIDATE_ACTIVATION_COMMAND_TIMEOUT_MS,
                }),
              };
            },
          })
        : isCandidateWorkerOperation(mode)
          ? (() => {
              try {
                if (
                  !deployPreparation ||
                  !commandArtifactEvidence ||
                  !deploymentExclusion
                ) {
                  throw new Error(
                    "Candidate upload or staging omitted its sealed preparation, artifacts, or production exclusion.",
                  );
                }
                const finalBackupDir = requireProductionDeployBackupDir(
                  productionDeployBackupDir,
                );
                assertExactDeployPreparationUnchanged({
                  initial: deployPreparation,
                  current: readDeployPreparation(finalBackupDir),
                  backupDir: finalBackupDir,
                  artifacts: commandArtifactEvidence,
                });
                assertWorkerDeployArtifactEvidenceUnchanged(
                  commandArtifactEvidence,
                );
                deploymentExclusion = attestProductionValidationExclusion(
                  deploymentExclusion,
                );
                assertProductionValidationExclusionCommandWindow(
                  deploymentExclusion,
                );
                assertCandidateEvidenceTargetsAbsent(
                  requireCandidateReleaseContext(
                    candidateReleaseContext,
                  ),
                  finalBackupDir,
                );
                assertCandidateStartingTopology({
                  context: requireCandidateReleaseContext(
                    candidateReleaseContext,
                  ),
                  output: (
                    options.runWranglerRead ?? ((args) => runWrangler(args))
                  )(workerDeploymentStatusArgs()),
                });
                wranglerOutputPath = createPrivateWranglerOutputFile(
                  finalBackupDir,
                  mode === "worker-stage-candidate"
                    ? "worker-candidate-staging"
                    : "worker-candidate-upload",
                );
                env.WRANGLER_OUTPUT_FILE_PATH = wranglerOutputPath;
                deployEvidence.bindWranglerOutput(wranglerOutputPath);
              } catch (error) {
                return {
                  kind: "blocked" as const,
                  result: finishWorkerCommandWithExclusion({
                    exclusion: deploymentExclusion,
                    finish: deployEvidence.finish,
                    status: 1,
                    extra: {
                      commandExecuted: false,
                      resourceBudgetOk: true,
                      scanBeforeOk: true,
                      scanAfterOk: null,
                      error: `Final sealed candidate upload or staging revalidation failed: ${errorMessage(error)}`,
                    },
                  }),
                };
              }
              return {
                kind: "executed" as const,
                result: runBoundedReleaseChildSync(actualCommand, {
                  cwd: process.cwd(),
                  env,
                  stdio: "inherit",
                  timeoutMs:
                    PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS,
                }),
              };
            })()
          : {
              kind: "executed" as const,
              result: spawnSync(actualCommand.command, actualCommand.args, {
                cwd: process.cwd(),
                env,
                stdio: "inherit",
              }),
            };
      if (commandBoundary.kind === "blocked") return commandBoundary.result;
      const result = commandBoundary.result;
      if (localPreviewConfig) fs.rmSync(localPreviewConfig, { force: true });
      if (result.status !== 0) {
        return finishWorkerCommandWithExclusion({
          exclusion: deploymentExclusion,
          finish: deployEvidence.finish,
          status: result.status ?? 1,
          extra: {
            commandExecuted: true,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: resourceBudgetRequiredBeforeCommand
              ? true
              : undefined,
            scanBeforeOk: command.scanBefore ? true : null,
            scanAfterOk: null,
            error: `${mode} exited with status ${result.status ?? "unknown"}.`,
          },
        });
      }

      if (mode === "opennext-build") {
        try {
          materializeStaticMarketingAssets(process.cwd());
          pruneUnusedOpenNextServerRuntime(process.cwd());
        } catch (error) {
          return finishWorkerCommandWithExclusion({
            exclusion: deploymentExclusion,
            finish: deployEvidence.finish,
            status: 1,
            extra: {
            commandExecuted: true,
            resourceBudgetOk: null,
            scanBeforeOk: null,
            scanAfterOk: null,
            error: `Static marketing asset materialization failed after ${mode}: ${errorMessage(error)}`,
            },
          });
        }

        const resourceBudget = inspectOpenNextResourceBudget(process.cwd());
        if (!resourceBudget.ok) {
          console.error(`OpenNext resource budget failed after ${mode}: ${JSON.stringify(resourceBudget)}`);
          return finishWorkerCommandWithExclusion({
            exclusion: deploymentExclusion,
            finish: deployEvidence.finish,
            status: 1,
            extra: {
            commandExecuted: true,
            resourceBudgetOk: false,
            scanBeforeOk: null,
            scanAfterOk: null,
            error: `OpenNext resource budget failed after ${mode}.`,
            },
          });
        }
      }

      if (command.scanAfter) {
        const report = writeBuildArtifactScanReport();
        if (!report.ok) {
          printScanFailure(report.findings.length);
          return finishWorkerCommandWithExclusion({
            exclusion: deploymentExclusion,
            finish: deployEvidence.finish,
            status: 1,
            extra: {
            commandExecuted: true,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: resourceBudgetRequiredBeforeCommand
              ? true
              : undefined,
            scanBeforeOk: command.scanBefore ? true : null,
            scanAfterOk: false,
            error: `OpenNext artifact scan failed with ${report.findings.length} finding(s).`,
            },
          });
        }
      }

      return finishWorkerCommandWithExclusion({
        exclusion: deploymentExclusion,
        finish: deployEvidence.finish,
        status: 0,
        extra: {
          commandExecuted: true,
          deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
          deployPreflightStatus: productionDeployPreflightResult?.status,
          resourceBudgetOk: resourceBudgetRequiredBeforeCommand
            ? true
            : undefined,
          scanBeforeOk: command.scanBefore ? true : null,
          scanAfterOk: command.scanAfter ? true : null,
        },
        finalize:
          isCandidateWorkerOperation(mode)
            ? (commandEvidence) => {
                if (
                  !candidateReleaseContext ||
                  !deployPreparation ||
                  !commandArtifactEvidence ||
                  !wranglerOutputPath
                ) {
                  throw new Error(
                    "Candidate release finalization omitted its identity, preparation, artifacts, or structured output.",
                  );
                }
                finalizeCandidateReleaseEvidence({
                  context: candidateReleaseContext,
                  backupDir: requireProductionDeployBackupDir(
                    productionDeployBackupDir,
                  ),
                  commandEvidenceSha256: commandEvidence.reportSha256,
                  deployPreparation,
                  artifacts: commandArtifactEvidence,
                  wranglerOutputPath,
                  runWranglerRead:
                    options.runWranglerRead ?? ((args) => runWrangler(args)),
                  finalizeUpload:
                    options.finalizeCandidateUploadEvidence ??
                    finalizeWorkerCandidateUploadEvidence,
                  finalizeStaged:
                    options.finalizeCandidateStagedEvidence ??
                    finalizeWorkerCandidateStagedEvidence,
                  finalizeActivation:
                    options.finalizeCandidateActivationEvidence ??
                    finalizeWorkerCandidateActivationEvidence,
                  readPreActivationSeal:
                    options.readCandidatePreActivationSeal ??
                    readAndValidateWorkerCandidatePreActivationSeal,
                });
              }
            : undefined,
      });
    } finally {
      fs.rmSync(localCliBinDir, { recursive: true, force: true });
    }
  }, process.cwd());
}

export function requiresProductionDeployPreflight(mode: CommandMode) {
  return mode === "worker-activate-candidate";
}

export function requiresSealedProductionArtifacts(mode: CommandMode) {
  return isCandidateWorkerOperation(mode);
}

function requiresRemotePreviewTrustAcceptance(
  mode: CommandMode,
  passthroughArgs: readonly string[],
) {
  return (
    mode === "wrangler-preview" &&
    passthroughArgs.some(
      (argument) =>
        argument === "--remote" || argument.startsWith("--remote="),
    )
  );
}

function isCandidateWorkerOperation(mode: CommandMode) {
  return (
    mode === "worker-upload-candidate" ||
    mode === "worker-stage-candidate" ||
    mode === "worker-activate-candidate"
  );
}

export function runAfterFinalProductionDeployPreflight<TRejected, TExecuted>(
  input: Readonly<{
    backupDir: string;
    deployPreflight: DeployPreflightRunner;
    workerTopologyPhase?: DeployPreflightWorkerTopologyPhase;
    onRejected: (
      result: DeployPreflightResult,
      error?: unknown,
    ) => TRejected;
    runCommand: (result: DeployPreflightResult) => TExecuted;
  }>,
): TRejected | TExecuted {
  let finalPreflight: DeployPreflightResult;
  try {
    finalPreflight = input.deployPreflight(
      input.backupDir,
      input.workerTopologyPhase,
    );
  } catch (error) {
    return input.onRejected({ ok: false, status: null }, error);
  }
  if (!finalPreflight.ok) return input.onRejected(finalPreflight);
  return input.runCommand(finalPreflight);
}

function requireProductionDeployBackupDir(value: string | null) {
  if (!value) {
    throw new Error("Production deploy preflight omitted its backup directory.");
  }
  return value;
}

function workerDeploymentStatusArgs() {
  return [
    "deployments",
    "status",
    "--name",
    WORKER_CANDIDATE_WORKER_NAME,
    "--json",
  ];
}

function workerVersionViewArgs(candidateVersionId: string) {
  return [
    "versions",
    "view",
    candidateVersionId,
    "--name",
    WORKER_CANDIDATE_WORKER_NAME,
    "--json",
  ];
}

function resolveCandidateReleaseContext(input: {
  mode:
    | "worker-upload-candidate"
    | "worker-stage-candidate"
    | "worker-activate-candidate";
  backupDir: string;
  runWranglerRead: WranglerReadRunner;
  deployPreparation: WorkerDeployPreparationHandle;
  artifacts: WorkerDeployArtifactEvidence;
  readCandidatePreActivationSeal: typeof readAndValidateWorkerCandidatePreActivationSeal;
}): CandidateReleaseContext {
  if (input.mode === "worker-upload-candidate") {
    for (const [file, label] of [
      [workerCandidateUploadEvidencePath(input.backupDir), "upload"],
      [workerCandidateStagedEvidencePath(input.backupDir), "staged"],
      [workerCandidateActivationEvidencePath(input.backupDir), "activation"],
    ] as const) {
      assertCandidateEvidenceTargetAbsent(file, label);
    }
    const statusOutput = input.runWranglerRead(workerDeploymentStatusArgs());
    const status = parseWorkerDeploymentStatusOutput(statusOutput);
    const baseline = status.versions[0];
    if (
      status.versions.length !== 1 ||
      !baseline ||
      baseline.percentage !== 100
    ) {
      throw new Error(
        "Candidate upload requires one exact service baseline at 100% traffic.",
      );
    }
    parseSoleBaselineTopology(statusOutput, baseline.versionId);
    return {
      kind: "upload",
      baselineVersionId: baseline.versionId,
    };
  }

  if (input.mode === "worker-stage-candidate") {
    assertCandidateEvidenceTargetAbsent(
      workerCandidateStagedEvidencePath(input.backupDir),
      "staged",
    );
    assertCandidateEvidenceTargetAbsent(
      workerCandidateActivationEvidencePath(input.backupDir),
      "activation",
    );
    const uploadHandle = readWorkerCandidateUploadEvidence(
      workerCandidateUploadEvidencePath(input.backupDir),
    );
    assertUploadEvidenceMatchesCurrentRelease({
      upload: uploadHandle.value,
      deployPreparation: input.deployPreparation,
      artifacts: input.artifacts,
    });
    parseSoleBaselineTopology(
      input.runWranglerRead(workerDeploymentStatusArgs()),
      uploadHandle.value.serviceBaselineVersionId,
    );
    return {
      kind: "staging",
      baselineVersionId: uploadHandle.value.serviceBaselineVersionId,
      candidateVersionId: uploadHandle.value.targetCandidateVersionId,
      uploadHandle,
    };
  }

  assertCandidateEvidenceTargetAbsent(
    workerCandidateActivationEvidencePath(input.backupDir),
    "activation",
  );
  const uploadHandle = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(input.backupDir),
  );
  const stagedHandle = readWorkerCandidateStagedEvidence(
    workerCandidateStagedEvidencePath(input.backupDir),
  );
  verifyWorkerCandidateStagedEvidence({
    uploadEvidence: uploadHandle.value,
    uploadEvidenceSha256: uploadHandle.sha256,
    stagedEvidence: stagedHandle.value,
    stagedEvidenceSha256: stagedHandle.sha256,
  });
  assertUploadEvidenceMatchesCurrentRelease({
    upload: uploadHandle.value,
    deployPreparation: input.deployPreparation,
    artifacts: input.artifacts,
  });
  const preActivationSealHandle = input.readCandidatePreActivationSeal({
    cwd: process.cwd(),
    backupDirectory: input.backupDir,
    uploadHandle,
    stagedHandle,
    workerDeployPreparationHandle: input.deployPreparation,
    artifacts: input.artifacts,
  });
  const context: CandidateActivationContext = {
    kind: "activation",
    baselineVersionId: uploadHandle.value.serviceBaselineVersionId,
    candidateVersionId: uploadHandle.value.targetCandidateVersionId,
    uploadHandle,
    stagedHandle,
    preActivationSealHandle,
  };
  assertCandidateStartingTopology({
    context,
    output: input.runWranglerRead(workerDeploymentStatusArgs()),
  });
  return context;
}

function assertCandidateStartingTopology(input: {
  context: CandidateReleaseContext;
  output: string;
}) {
  if (input.context.kind !== "activation") {
    return parseSoleBaselineTopology(
      input.output,
      input.context.baselineVersionId,
    );
  }
  return parseStagedWorkerTopology(
    input.output,
    input.context.baselineVersionId,
    input.context.candidateVersionId,
  );
}

function assertCandidateEvidenceTargetAbsent(file: string, operation: string) {
  if (fs.existsSync(file)) {
    throw new Error(
      `Immutable Worker candidate ${operation} evidence already exists; refusing a second remote mutation.`,
    );
  }
}

function assertCandidateEvidenceTargetsAbsent(
  context: CandidateReleaseContext,
  backupDir: string,
) {
  if (context.kind === "upload") {
    assertCandidateEvidenceTargetAbsent(
      workerCandidateUploadEvidencePath(backupDir),
      "upload",
    );
  }
  if (context.kind !== "activation") {
    assertCandidateEvidenceTargetAbsent(
      workerCandidateStagedEvidencePath(backupDir),
      "staged",
    );
  }
  assertCandidateEvidenceTargetAbsent(
    workerCandidateActivationEvidencePath(backupDir),
    "activation",
  );
}

function assertExactDeployPreparationUnchanged(input: {
  initial: WorkerDeployPreparationHandle;
  current: WorkerDeployPreparationHandle;
  backupDir: string;
  artifacts: WorkerDeployArtifactEvidence;
}) {
  if (
    input.current.path !== input.initial.path ||
    input.current.sha256 !== input.initial.sha256
  ) {
    throw new Error("Sealed Worker deploy preparation changed during release.");
  }
  assertWorkerDeployPreparationBoundStateUnchanged({
    handle: input.current,
    cwd: process.cwd(),
    backupDirectory: input.backupDir,
  });
  assertWorkerDeployPreparationMatchesArtifacts(
    input.current,
    input.artifacts,
  );
}

function assertCandidatePreActivationSealUnchanged(input: {
  context: CandidateReleaseContext;
  backupDir: string;
  deployPreparation: WorkerDeployPreparationHandle;
  artifacts: WorkerDeployArtifactEvidence;
  readSeal: typeof readAndValidateWorkerCandidatePreActivationSeal;
  minimumRemainingValidityMs?: number;
  now?: Date;
}) {
  if (input.context.kind !== "activation") return;
  const current = input.readSeal({
    cwd: process.cwd(),
    backupDirectory: input.backupDir,
    uploadHandle: input.context.uploadHandle,
    stagedHandle: input.context.stagedHandle,
    workerDeployPreparationHandle: input.deployPreparation,
    artifacts: input.artifacts,
  });
  if (
    current.path !== input.context.preActivationSealHandle.path ||
    current.sha256 !== input.context.preActivationSealHandle.sha256
  ) {
    throw new Error(
      "Worker candidate pre-activation authorization seal changed during activation.",
    );
  }
  if (input.minimumRemainingValidityMs !== undefined) {
    assertWorkerCandidatePreActivationSealValidityWindow(
      current.value.validUntil,
      input.minimumRemainingValidityMs,
      input.now,
    );
  }
}

export function assertWorkerCandidatePreActivationSealValidityWindow(
  validUntil: string,
  minimumRemainingValidityMs: number,
  now = new Date(),
) {
  if (
    !Number.isSafeInteger(minimumRemainingValidityMs) ||
    minimumRemainingValidityMs < 0
  ) {
    throw new Error(
      "Worker candidate pre-activation seal minimum validity must be a non-negative safe integer.",
    );
  }
  const validUntilMs = Date.parse(validUntil);
  const nowMs = now.getTime();
  if (
    !Number.isFinite(validUntilMs) ||
    !Number.isFinite(nowMs) ||
    validUntilMs - nowMs < minimumRemainingValidityMs
  ) {
    throw new Error(
      "Worker candidate pre-activation authorization seal does not have enough validity remaining for the protected activation command and safety margin.",
    );
  }
}

function requireCandidateReleaseContext(
  value: CandidateReleaseContext | null,
): CandidateReleaseContext {
  if (!value) throw new Error("Worker candidate release context is missing.");
  return value;
}

function requireActivationContext(
  value: CandidateReleaseContext | null,
): CandidateActivationContext {
  const context = requireCandidateReleaseContext(value);
  if (context.kind !== "activation") {
    throw new Error("Worker candidate activation context is missing.");
  }
  return context;
}

function requireStagingContext(
  value: CandidateReleaseContext | null,
): CandidateStagingContext {
  const context = requireCandidateReleaseContext(value);
  if (context.kind !== "staging") {
    throw new Error("Worker candidate staging context is missing.");
  }
  return context;
}

function requireWorkerReleaseAnnotations(
  preparation: WorkerDeployPreparationHandle | null,
) {
  return buildCandidateUploadVersionCommand(
    requireWorkerReleaseIdentity(preparation),
  ).annotations;
}

function requireWorkerReleaseIdentity(
  preparation: WorkerDeployPreparationHandle | null,
) {
  if (!preparation) {
    throw new Error(
      "Worker candidate upload omitted its sealed deploy preparation.",
    );
  }
  return {
    gitHead: preparation.artifact.git.head,
    preparationSha256: preparation.sha256,
  } as const;
}

export function buildCandidateUploadVersionCommand(input: {
  gitHead: string;
  preparationSha256: string;
}) {
  if (!/^[a-f0-9]{40,64}$/.test(input.gitHead)) {
    throw new Error("Worker candidate upload Git HEAD is malformed.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.preparationSha256)) {
    throw new Error(
      "Worker candidate upload preparation SHA-256 is malformed.",
    );
  }
  const tag =
    `inspir-${input.gitHead.slice(0, 16)}-` +
    input.preparationSha256.slice(0, 16);
  const message =
    `inspirlearning candidate git ${input.gitHead} ` +
    `sealed preparation ${input.preparationSha256}`;
  const annotations = {
    tag,
    message,
    messageSha256: workerReleaseMessageSha256(message),
  } as const;
  return {
    args: [
      "versions",
      "upload",
      "--config",
      "wrangler.jsonc",
      "--strict",
      "--tag",
      annotations.tag,
      "--message",
      annotations.message,
    ] as string[],
    annotations,
  };
}

export function buildCandidateActivationVersionCommand(
  candidateVersionId: string,
) {
  requireWorkerVersionUuid(candidateVersionId, "activation");
  return [
    "versions",
    "deploy",
    `${candidateVersionId}@100%`,
    "--config",
    "wrangler.jsonc",
    "--yes",
  ];
}

export function buildCandidateStagingVersionCommand(
  baselineVersionId: string,
  candidateVersionId: string,
) {
  requireWorkerVersionUuid(baselineVersionId, "staging baseline");
  requireWorkerVersionUuid(candidateVersionId, "staging candidate");
  if (baselineVersionId === candidateVersionId) {
    throw new Error(
      "Worker candidate staging baseline and candidate UUIDs must differ.",
    );
  }
  return [
    "versions",
    "deploy",
    `${baselineVersionId}@100%`,
    `${candidateVersionId}@0%`,
    "--config",
    "wrangler.jsonc",
    "--yes",
  ];
}

function requireWorkerVersionUuid(value: string, operation: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      value,
    )
  ) {
    throw new Error(`Worker candidate ${operation} UUID is malformed.`);
  }
}

function candidateArtifactIdentity(artifacts: WorkerDeployArtifactEvidence) {
  return {
    sourceFingerprintSha256: artifacts.sourceFingerprint.sha256,
    sourceFingerprintFileCount: artifacts.sourceFingerprint.fileCount,
    workerSourceSha256: artifacts.workerSourceSha256,
    wranglerConfigSha256: artifacts.wranglerConfigSha256,
    assetManifestSha256: artifacts.assetManifest.sha256,
    assetManifestFileCount: artifacts.assetManifest.fileCount,
    assetManifestBytes: artifacts.assetManifest.bytes,
  } as const;
}

function assertUploadEvidenceMatchesCurrentRelease(input: {
  upload: WorkerCandidateUploadEvidence;
  deployPreparation: WorkerDeployPreparationHandle;
  artifacts: WorkerDeployArtifactEvidence;
}) {
  assertWorkerDeployPreparationUploadBinding(
    input.deployPreparation,
    input.upload,
  );
  const currentArtifacts = candidateArtifactIdentity(input.artifacts);
  if (
    input.upload.git.head !== input.deployPreparation.artifact.git.head ||
    input.upload.git.upstream !==
      input.deployPreparation.artifact.git.upstream ||
    input.upload.git.upstreamRef !==
      input.deployPreparation.artifact.git.upstreamRef ||
    input.upload.artifacts.sourceFingerprintSha256 !==
      currentArtifacts.sourceFingerprintSha256 ||
    input.upload.artifacts.sourceFingerprintFileCount !==
      currentArtifacts.sourceFingerprintFileCount ||
    input.upload.artifacts.workerSourceSha256 !==
      currentArtifacts.workerSourceSha256 ||
    input.upload.artifacts.wranglerConfigSha256 !==
      currentArtifacts.wranglerConfigSha256 ||
    input.upload.artifacts.assetManifestSha256 !==
      currentArtifacts.assetManifestSha256 ||
    input.upload.artifacts.assetManifestFileCount !==
      currentArtifacts.assetManifestFileCount ||
    input.upload.artifacts.assetManifestBytes !==
      currentArtifacts.assetManifestBytes
  ) {
    throw new Error(
      "Immutable Worker candidate upload evidence does not match the current sealed release.",
    );
  }
}

function finalizeCandidateReleaseEvidence(input: {
  context: CandidateReleaseContext;
  backupDir: string;
  commandEvidenceSha256: string;
  deployPreparation: WorkerDeployPreparationHandle;
  artifacts: WorkerDeployArtifactEvidence;
  wranglerOutputPath: string;
  runWranglerRead: WranglerReadRunner;
  finalizeUpload: typeof finalizeWorkerCandidateUploadEvidence;
  finalizeStaged: typeof finalizeWorkerCandidateStagedEvidence;
  finalizeActivation: typeof finalizeWorkerCandidateActivationEvidence;
  readPreActivationSeal: typeof readAndValidateWorkerCandidatePreActivationSeal;
}) {
  const privateOutput = readPrivateWranglerOutputFile(
    input.wranglerOutputPath,
  );
  if (input.context.kind === "upload") {
    const outputEvent = parseWorkerVersionUploadOutput(privateOutput.output);
    const annotations = requireWorkerReleaseAnnotations(
      input.deployPreparation,
    );
    const createdAt = new Date().toISOString();
    assertWorkerDeployPreparationUploadBinding(input.deployPreparation, {
      createdAt,
      workerDeployPreparationSha256: input.deployPreparation.sha256,
    });
    return input.finalizeUpload({
      file: workerCandidateUploadEvidencePath(input.backupDir),
      createdAt,
      targetCandidateVersionId: outputEvent.versionId,
      serviceBaselineVersionId: input.context.baselineVersionId,
      expectedReleaseTag: annotations.tag,
      expectedReleaseMessageSha256: annotations.messageSha256,
      uploadCommandEvidenceSha256: input.commandEvidenceSha256,
      workerDeployPreparationSha256: input.deployPreparation.sha256,
      git: input.deployPreparation.artifact.git,
      artifacts: candidateArtifactIdentity(input.artifacts),
      uploadOutput: privateOutput.output,
      versionsViewOutput: input.runWranglerRead(
        workerVersionViewArgs(outputEvent.versionId),
      ),
      baselineStatusOutput: input.runWranglerRead(
        workerDeploymentStatusArgs(),
      ),
    });
  }

  assertUploadEvidenceMatchesCurrentRelease({
    upload: input.context.uploadHandle.value,
    deployPreparation: input.deployPreparation,
    artifacts: input.artifacts,
  });
  if (input.context.kind === "staging") {
    parseWorkerVersionDeployOutput(privateOutput.output);
    return input.finalizeStaged({
      file: workerCandidateStagedEvidencePath(input.backupDir),
      createdAt: new Date().toISOString(),
      uploadHandle: input.context.uploadHandle,
      deployOutput: privateOutput.output,
      stagedStatusOutput: input.runWranglerRead(
        workerDeploymentStatusArgs(),
      ),
    });
  }
  assertCandidatePreActivationSealUnchanged({
    context: input.context,
    backupDir: input.backupDir,
    deployPreparation: input.deployPreparation,
    artifacts: input.artifacts,
    readSeal: input.readPreActivationSeal,
  });
  parseWorkerVersionDeployOutput(privateOutput.output);
  return input.finalizeActivation({
    file: workerCandidateActivationEvidencePath(input.backupDir),
    createdAt: new Date().toISOString(),
    uploadHandle: input.context.uploadHandle,
    stagedHandle: input.context.stagedHandle,
    preActivationSealHandle: input.context.preActivationSealHandle,
    deployOutput: privateOutput.output,
    activationStatusOutput: input.runWranglerRead(
      workerDeploymentStatusArgs(),
    ),
  });
}

export function clearLocalPreviewCacheApiState(cwd = process.cwd()) {
  const cacheApiDir = path.join(cwd, ".wrangler", "state", "v3", "cache");
  fs.rmSync(cacheApiDir, { recursive: true, force: true });
  return cacheApiDir;
}

export function pruneUnusedOpenNextServerRuntime(cwd = process.cwd()) {
  const serverFunctionsDir = path.join(cwd, ".open-next", "server-functions");
  const removed = fs.existsSync(serverFunctionsDir);
  // Production routes only native handlers and static assets. Generated Next
  // server functions remain outside the deploy graph and only consume budget.
  fs.rmSync(serverFunctionsDir, { recursive: true, force: true });
  return { path: serverFunctionsDir, removed };
}

function runProductionDeployPreflight(
  backupDir: string,
  workerTopologyPhase: DeployPreflightWorkerTopologyPhase =
    "baseline-sole-active",
): DeployPreflightResult {
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "scripts/cloudflare/deploy-preflight.ts",
    "--backup",
    backupDir,
    "--worker-topology-phase",
    workerTopologyPhase,
  ], {
    cwd: process.cwd(),
    env: commandEnv(),
    stdio: "inherit",
  });
  return { ok: result.status === 0, status: result.status };
}

export function blockedOpenNextSkipBuildArgs(mode: CommandMode, passthroughArgs: string[]) {
  if (!mode.startsWith("opennext-") && !isCandidateWorkerOperation(mode)) {
    return [];
  }
  return passthroughArgs.filter((arg) =>
    BLOCKED_OPENNEXT_SKIP_BUILD_ARGS.some((blocked) => arg === blocked || arg.startsWith(`${blocked}=`)),
  );
}

export function blockedImmutableWorkerDeployArgs(mode: CommandMode, passthroughArgs: string[]) {
  // The report fingerprints the fixed native entry point, wrangler.jsonc, and
  // .open-next/assets. Wrangler passthrough flags (including --dry-run,
  // --config, --name, --assets, --env, or a positional entry point) could make
  // the executed command differ from that evidence, so production wrappers do
  // not accept any. Metadata-only version workflows use dedicated scripts.
  return requiresSealedProductionArtifacts(mode) ? [...passthroughArgs] : [];
}

export function applyNativeWranglerDeployEnvironment(
  mode: CommandMode,
  env: Record<string, string | undefined>,
) {
  if (mode === "worker-upload-candidate") {
    // Keep Wrangler on the native Worker path. The upload is version-only and
    // must never delegate to an OpenNext command that could rebuild or deploy.
    env.OPEN_NEXT_DEPLOY = "true";
  }
  return env;
}

function printScanFailure(findings: number) {
  console.error(
    `OpenNext artifact scan failed with ${findings} finding(s). See cloudflare/build-artifact-scan-report.json in the active backup directory.`,
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error("Unknown deployment exclusion failure.");
}

function finishWorkerCommandWithExclusion(input: {
  exclusion: ProductionValidationExclusion | null;
  finish: (
    status: number | null,
    extra: WorkerDeployEvidenceFinishInput,
  ) => {
    status: number;
    reportPath?: string;
    reportSha256?: string;
  };
  status: number | null;
  extra: WorkerDeployEvidenceFinishInput;
  finalize?: (commandEvidence: {
    reportPath: string;
    reportSha256: string;
  }) => void;
}) {
  if (!input.exclusion) {
    const result = input.finish(input.status, input.extra);
    if (result.status === 0 && input.finalize) {
      if (!result.reportPath || !result.reportSha256) {
        throw new Error(
          "Successful Worker command evidence omitted its path or SHA-256.",
        );
      }
      input.finalize({
        reportPath: result.reportPath,
        reportSha256: result.reportSha256,
      });
    }
    return result;
  }

  let exclusion = input.exclusion;
  const certificationErrors: Error[] = [];
  try {
    // Renew immediately after the external command, before final remote and
    // local certification begins on whatever lease time remains.
    exclusion = attestProductionValidationExclusion(exclusion);
    assertProductionValidationExclusionCommandWindow(exclusion);
  } catch (error) {
    certificationErrors.push(asError(error));
  }
  const finishInput = certificationErrors.length
    ? {
        ...input.extra,
        error: `${input.extra.error ? `${input.extra.error} ` : ""}Production exclusion post-command attestation failed.`,
      }
    : input.extra;
  let result: ReturnType<typeof input.finish>;
  try {
    result = input.finish(
      certificationErrors.length ? 1 : input.status,
      finishInput,
    );
  } catch (error) {
    certificationErrors.push(asError(error));
    result = { status: 1 };
  }

  if (
    certificationErrors.length === 0 &&
    result.status === 0 &&
    input.finalize
  ) {
    try {
      exclusion = attestProductionValidationExclusion(exclusion);
      assertProductionValidationExclusionCommandWindow(exclusion);
      if (!result.reportPath || !result.reportSha256) {
        throw new Error(
          "Successful Worker command evidence omitted its path or SHA-256.",
        );
      }
      input.finalize({
        reportPath: result.reportPath,
        reportSha256: result.reportSha256,
      });
    } catch (error) {
      certificationErrors.push(asError(error));
    }
  }

  try {
    exclusion = attestProductionValidationExclusion(exclusion);
  } catch (error) {
    certificationErrors.push(asError(error));
  }

  try {
    releaseProductionValidationExclusion(exclusion);
  } catch (error) {
    certificationErrors.push(asError(error));
  }

  if (certificationErrors.length) {
    const failure = new AggregateError(
      certificationErrors,
      "Production deployment final certification or exclusion release failed.",
    );
    console.error(failure.message);
    return { ...result, status: 1 };
  }
  return result;
}

function bin(name: string) {
  return path.resolve(process.cwd(), "node_modules", ".bin", name);
}

function writeLocalPreviewRuntimeVars(
  providerSecrets: LocalPreviewProviderRuntimeSecrets,
) {
  fs.writeFileSync(
    path.join(process.cwd(), ".dev.vars"),
    localPreviewRuntimeDotEnvContent(process.cwd(), providerSecrets),
    { mode: 0o600 },
  );
}

function writeLocalPreviewWranglerConfig() {
  const cwd = process.cwd();
  const configPath = path.join(process.cwd(), "wrangler.jsonc");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    main?: string;
    assets?: { directory?: string };
    secrets?: { required?: string[] };
    vars?: Record<string, unknown>;
    routes?: unknown;
  };
  if (typeof config.main === "string") config.main = path.resolve(cwd, config.main);
  if (typeof config.assets?.directory === "string") {
    config.assets = {
      ...config.assets,
      directory: path.resolve(cwd, config.assets.directory),
    };
  }
  const requiredSecrets = new Set(config.secrets?.required ?? []);
  requiredSecrets.add("CLOUDFLARE_AI_GATEWAY_TOKEN");
  requiredSecrets.add("E2E_TEST_AUTH_EMAIL");
  requiredSecrets.add("E2E_TEST_AUTH_SECRET");
  config.secrets = {
    ...config.secrets,
    required: [...requiredSecrets],
  };
  const localPreviewUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://localhost:8787";
  config.vars = {
    ...config.vars,
    APP_URL: localPreviewUrl,
    AUTH_URL: localPreviewUrl,
    BETTER_AUTH_URL: localPreviewUrl,
  };
  // Production custom domains are not part of the localhost Wrangler preview.
  delete config.routes;
  const previewConfigPath = ".wrangler.preview.local.jsonc";
  fs.writeFileSync(path.join(cwd, previewConfigPath), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return previewConfigPath;
}

function createWorkerDeployEvidenceWriter(
  mode: CommandMode,
  command: (typeof COMMANDS)[CommandMode],
  passthroughArgs: string[],
  readActiveWorkerVersion?: ActiveWorkerVersionReader,
) {
  if (!isCandidateWorkerOperation(mode)) {
    return {
      bindCommand(commandInput: string[]) {
        void commandInput;
      },
      bindPreparation(preparation: WorkerDeployPreparationHandle) {
        void preparation;
      },
      bindPreActivationSeal(sealSha256: string | undefined) {
        void sealSha256;
      },
      bindTargetCandidate(candidateVersionId: string | undefined) {
        void candidateVersionId;
      },
      bindWranglerOutput(file: string) {
        void file;
      },
      captureCommandArtifacts: () => undefined,
      finish: (status: number | null, extra: WorkerDeployEvidenceFinishInput) => {
        void extra;
        return { status: status ?? 1 };
      },
    };
  }

  const backupDir = resolveBackupDir();
  let boundCommand = [
    command.executable,
    ...command.args,
    ...passthroughArgs,
  ];
  let boundPreparation:
    | Readonly<{
        sha256: string;
        git: WorkerDeployPreparationHandle["artifact"]["git"];
      }>
    | undefined;
  let boundTargetCandidateVersionId: string | undefined;
  let boundPreActivationSealSha256: string | undefined;
  let boundWranglerOutputPath: string | undefined;
  const session = createWorkerDeployEvidenceSession({
    backupDir,
    mode:
      mode === "worker-upload-candidate"
        ? "worker-candidate-upload"
        : mode === "worker-stage-candidate"
          ? "worker-candidate-staging"
          : "worker-candidate-activation",
    command: boundCommand,
    passthroughArgs,
    ...(readActiveWorkerVersion ? { readActiveWorkerVersion } : {}),
    getWranglerOutputPath: () => boundWranglerOutputPath,
    parseWranglerOutput:
      mode === "worker-upload-candidate"
        ? parseWorkerVersionUploadOutput
        : parseWorkerVersionDeployOutput,
    getTargetCandidateVersionId: () => boundTargetCandidateVersionId,
    getPreActivationSealSha256: () => boundPreActivationSealSha256,
    getWorkerDeployPreparation: () => boundPreparation,
    readCommand: () => [...boundCommand],
  });

  return {
    bindCommand(nextCommand: string[]) {
      boundCommand = [...nextCommand];
    },
    bindPreparation(preparation: WorkerDeployPreparationHandle) {
      boundPreparation = {
        sha256: preparation.sha256,
        git: preparation.artifact.git,
      };
    },
    bindPreActivationSeal(sealSha256: string | undefined) {
      boundPreActivationSealSha256 = sealSha256;
    },
    bindTargetCandidate(candidateVersionId: string | undefined) {
      boundTargetCandidateVersionId = candidateVersionId;
    },
    bindWranglerOutput(file: string) {
      boundWranglerOutputPath = file;
    },
    captureCommandArtifacts: session.captureCommandArtifacts,
    finish(status: number | null, extra: WorkerDeployEvidenceFinishInput) {
      const result = session.finish(status, extra);
      const { report } = result;
      console.log(
        JSON.stringify(
          {
            deployEvidence: path.join(
              cloudflareDir(backupDir),
              mode === "worker-upload-candidate"
                ? "worker-candidate-upload-command-report.json"
                : mode === "worker-stage-candidate"
                  ? "worker-candidate-staging-command-report.json"
                  : "worker-candidate-activation-command-report.json",
            ),
            ok: report.ok,
            mode: report.mode,
            status: report.status,
            sourceFingerprint: {
              sha256: report.sourceFingerprint?.sha256,
              before: report.sourceFingerprintBefore.sha256,
              after: report.sourceFingerprintAfter.sha256,
              stable: report.sourceFingerprintStable,
            },
            workerSourceSha256: report.workerSourceSha256,
            wranglerConfigSha256: report.wranglerConfigSha256,
            assetManifest: report.assetManifest,
            artifactEvidenceStable: report.artifactEvidenceStable,
            activeDeployment: report.activeDeployment,
          },
          null,
          2,
        ),
      );
      return result;
    },
  };
}

function createLocalCliWrappers() {
  const localCliBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-cf-build-bin-"));
  const wrapper = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = ${JSON.stringify(process.cwd())};
const args = process.argv.slice(2);

function pathEntries() {
  return (process.env.PATH || "")
    .split(path.delimiter)
    .filter((entry) => entry && path.resolve(entry) !== __dirname);
}

function executableNames(name) {
  return process.platform === "win32" ? [name + ".cmd", name + ".exe", name] : [name];
}

function findOnPath(name) {
  for (const entry of pathEntries()) {
    for (const executable of executableNames(name)) {
      const candidate = path.join(entry, executable);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function packageManagerInvocation() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    if (/\\.(?:cjs|mjs|js)$/.test(npmExecPath)) return { command: process.execPath, argsPrefix: [npmExecPath] };
    return { command: npmExecPath, argsPrefix: [] };
  }
  const pnpm = findOnPath("pnpm");
  return { command: pnpm || "pnpm", argsPrefix: [] };
}

const packageManager = packageManagerInvocation();
let command = packageManager.command;
let finalArgs = [...packageManager.argsPrefix, ...args];

if (args[0] === "build") {
  command = path.join(repo, "node_modules", ".bin", "next");
  finalArgs = ["build", "--webpack", ...args.slice(1)];
} else if (args[0] === "exec" && args[1]) {
  command = path.join(repo, "node_modules", ".bin", args[1]);
  finalArgs = args.slice(2);
}

const result = spawnSync(command, finalArgs, { cwd: repo, env: process.env, stdio: "inherit" });
process.exit(result.status ?? 1);
`;
  const wrapperPath = path.join(localCliBinDir, "pnpm");
  fs.writeFileSync(wrapperPath, wrapper, { mode: 0o700 });
  fs.chmodSync(wrapperPath, 0o700);
  return localCliBinDir;
}
