import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import { writeBuildArtifactScanReport } from "./scan-build-artifacts";
import {
  buildSanitizedCloudflareBuildEnv,
  localPreviewRuntimeEnv,
  sanitizedDotEnvContent,
  withSanitizedProjectEnvFiles,
} from "./sanitized-build-env";
import { inspectOpenNextResourceBudget } from "./check-opennext-resource-budget";
import { materializeStaticMarketingAssets } from "./materialize-static-marketing-assets";
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
  createWorkerDeployEvidenceSession,
  readSoleActiveWorkerVersion,
  type ActiveWorkerVersionReader,
  type WorkerDeployArtifactEvidence,
  type WorkerDeployEvidenceFinishInput,
  type WorkerDeployEvidenceReport,
} from "./worker-deploy-evidence";
import { runBoundedReleaseChildSync } from "./run-production-release-operation";

type CommandMode = "next-build" | "opennext-build" | "opennext-deploy" | "opennext-upload" | "wrangler-preview";
type DeployPreflightResult = { ok: boolean; status: number | null };
type RunSanitizedBuildOptions = {
  deployPreflight?: (backupDir: string) => DeployPreflightResult;
  readActiveWorkerVersion?: ActiveWorkerVersionReader;
  assertValidationLockAvailable?: () => void;
};

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
  "opennext-deploy": {
    executable: bin("wrangler"),
    args: ["deploy", "--config", "wrangler.jsonc"],
    buildBefore: true,
    scanBefore: true,
  },
  "opennext-upload": {
    executable: bin("wrangler"),
    args: ["versions", "upload", "--config", "wrangler.jsonc"],
    buildBefore: true,
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
  const deployEvidence = createWorkerDeployEvidenceWriter(
    mode,
    command,
    passthroughArgs,
    options.readActiveWorkerVersion,
  );
  let productionDeployPreflightResult: DeployPreflightResult | null = null;
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

  if (requiresProductionDeployPreflight(mode)) {
    const backupDir = resolveBackupDir();
    const deployPreflight = options.deployPreflight ?? runProductionDeployPreflight;
    const preflight = deployPreflight(backupDir);
    productionDeployPreflightResult = preflight;
    if (!preflight.ok) {
      console.error("Refusing OpenNext production deploy/upload because deploy preflight did not pass.");
      return deployEvidence.finish(preflight.status ?? 1, {
        commandExecuted: false,
        deployPreflightOk: false,
        deployPreflightStatus: preflight.status,
        scanBeforeOk: null,
        scanAfterOk: null,
        error: `Deploy preflight exited with status ${preflight.status ?? "unknown"}.`,
      });
    }
  }

  if (mode === "opennext-deploy") {
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
        error: `Production deployment lock absence was not proved before build: ${errorMessage(error)}`,
      });
    }
  }

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
        const report = writeBuildArtifactScanReport();
        if (!report.ok) {
          printScanFailure(report.findings.length);
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: command.buildBefore ? true : undefined,
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
        writeLocalPreviewRuntimeVars();
        Object.assign(env, localPreviewRuntimeEnv());
        localPreviewConfig = writeLocalPreviewWranglerConfig();
        commandArgs = passthroughArgs.some((arg) => arg === "--config" || arg === "-c" || arg.startsWith("--config="))
          ? passthroughArgs
          : ["--config", localPreviewConfig, ...passthroughArgs];
      }

      if (mode === "opennext-deploy") {
        try {
          (options.assertValidationLockAvailable ?? assertNoLiveProductionValidationLock)();
        } catch (error) {
          if (localPreviewConfig) fs.rmSync(localPreviewConfig, { force: true });
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: command.buildBefore ? true : undefined,
            scanBeforeOk: command.scanBefore ? true : null,
            scanAfterOk: null,
            error: `Production deployment lock absence was not proved: ${errorMessage(error)}`,
          });
        }
      }

      let commandArtifactEvidence: WorkerDeployArtifactEvidence | undefined;
      try {
        commandArtifactEvidence = deployEvidence.captureCommandArtifacts();
      } catch (error) {
        if (localPreviewConfig) fs.rmSync(localPreviewConfig, { force: true });
        return deployEvidence.finish(1, {
          commandExecuted: false,
          deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
          deployPreflightStatus: productionDeployPreflightResult?.status,
          resourceBudgetOk: command.buildBefore ? true : undefined,
          scanBeforeOk: command.scanBefore ? true : null,
          scanAfterOk: null,
          error: `Immutable Worker deploy artifact evidence failed before ${mode}: ${errorMessage(error)}`,
        });
      }

      let deploymentExclusion: ProductionValidationExclusion | null = null;
      if (mode === "opennext-deploy") {
        try {
          if (!commandArtifactEvidence) {
            throw new Error("Immutable deploy artifacts were not captured before lock acquisition.");
          }
          deploymentExclusion = acquireProductionValidationExclusion({
            candidateVersionId: (options.readActiveWorkerVersion ?? readSoleActiveWorkerVersion)(),
            sourceFingerprintSha256: commandArtifactEvidence.sourceFingerprint.sha256,
          });
        } catch (error) {
          if (localPreviewConfig) fs.rmSync(localPreviewConfig, { force: true });
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            resourceBudgetOk: command.buildBefore ? true : undefined,
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
          const lockedActiveVersion = (options.readActiveWorkerVersion ?? readSoleActiveWorkerVersion)();
          if (lockedActiveVersion !== deploymentExclusion.owner.candidateVersionId) {
            throw new Error(
              `Active Worker changed between deployment baseline and exclusion acquisition: expected ${deploymentExclusion.owner.candidateVersionId}, received ${lockedActiveVersion}.`,
            );
          }
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
              resourceBudgetOk: command.buildBefore ? true : undefined,
              scanBeforeOk: command.scanBefore ? true : null,
              scanAfterOk: null,
              error: `Locked production deployment revalidation failed: ${errorMessage(error)}`,
            },
          });
        }
      }

      const actualCommand = {
        command: command.executable,
        args: [...command.args, ...commandArgs],
      };
      const result = requiresProductionDeployPreflight(mode)
        ? runBoundedReleaseChildSync(actualCommand, {
            cwd: process.cwd(),
            env,
            stdio: "inherit",
            timeoutMs: PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS,
          })
        : spawnSync(actualCommand.command, actualCommand.args, {
            cwd: process.cwd(),
            env,
            stdio: "inherit",
          });
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
            resourceBudgetOk: command.buildBefore ? true : undefined,
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
            resourceBudgetOk: command.buildBefore || mode === "opennext-build" ? true : undefined,
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
          resourceBudgetOk: command.buildBefore || mode === "opennext-build" ? true : undefined,
          scanBeforeOk: command.scanBefore ? true : null,
          scanAfterOk: command.scanAfter ? true : null,
        },
      });
    } finally {
      fs.rmSync(localCliBinDir, { recursive: true, force: true });
    }
  }, process.cwd());
}

export function requiresProductionDeployPreflight(mode: CommandMode) {
  return mode === "opennext-deploy" || mode === "opennext-upload";
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

function runProductionDeployPreflight(backupDir: string): DeployPreflightResult {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/cloudflare/deploy-preflight.ts", "--backup", backupDir], {
    cwd: process.cwd(),
    env: commandEnv(),
    stdio: "inherit",
  });
  return { ok: result.status === 0, status: result.status };
}

export function blockedOpenNextSkipBuildArgs(mode: CommandMode, passthroughArgs: string[]) {
  if (!mode.startsWith("opennext-")) return [];
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
  return requiresProductionDeployPreflight(mode) ? [...passthroughArgs] : [];
}

export function applyNativeWranglerDeployEnvironment(
  mode: CommandMode,
  env: Record<string, string | undefined>,
) {
  if (mode === "opennext-deploy") {
    // Wrangler auto-detects open-next.config.ts and otherwise delegates back to
    // `opennextjs-cloudflare deploy`, which tries to populate the retired R2
    // incremental cache. This wrapper already performed the clean OpenNext
    // build, static materialization, resource gate, and artifact scan. Mark the
    // direct Wrangler step as the delegated/native upload so it deploys
    // cloudflare-worker.ts plus Static Assets without invoking OpenNext again.
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
  ) => { status: number; report?: WorkerDeployEvidenceReport };
  status: number | null;
  extra: WorkerDeployEvidenceFinishInput;
}) {
  if (!input.exclusion) return input.finish(input.status, input.extra);

  let exclusion = input.exclusion;
  let result: { status: number; report?: WorkerDeployEvidenceReport } | null = null;
  const certificationErrors: Error[] = [];
  try {
    // Renew immediately after the external command, before final remote and
    // local certification begins on whatever lease time remains.
    exclusion = attestProductionValidationExclusion(exclusion);
    assertProductionValidationExclusionCommandWindow(exclusion);
  } catch (error) {
    certificationErrors.push(asError(error));
  }
  const promotableSuccess = input.status === 0 && !input.extra.error;
  let pendingActiveVersionId: string | null = null;
  if (certificationErrors.length === 0) {
    try {
      // A successful command is first certified into a deliberately false
      // report. Only after post-attestation and exact release is that same
      // active version eligible for promotion to ok=true.
      result = input.finish(input.status, promotableSuccess
        ? {
            ...input.extra,
            error: "Pending production exclusion post-certification and release.",
          }
        : input.extra);
      if (promotableSuccess) {
        const pendingReport = result.report;
        pendingActiveVersionId = pendingReport?.activeDeployment?.versionId ?? null;
        if (
          !pendingActiveVersionId ||
          !pendingReport?.sourceFingerprintStable ||
          pendingReport.artifactEvidenceStable !== true
        ) {
          certificationErrors.push(
            new Error("Pending deploy evidence did not complete its active-version and artifact certification."),
          );
        }
      }
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
    try {
      return input.finish(1, {
        ...input.extra,
        error: `${input.extra.error ? `${input.extra.error} ` : ""}${failure.message}`,
      });
    } catch (reportError) {
      throw new AggregateError(
        [...certificationErrors, asError(reportError)],
        "Production deployment failed and its false evidence report could not be written.",
      );
    }
  }
  if (promotableSuccess) {
    if (!pendingActiveVersionId) {
      throw new Error("Production deployment promotion omitted its pending active version.");
    }
    return input.finish(0, {
      ...input.extra,
      expectedActiveVersionId: pendingActiveVersionId,
    });
  }
  if (!result) throw new Error("Production deployment certification did not return a result.");
  return result;
}

function bin(name: string) {
  return path.resolve(process.cwd(), "node_modules", ".bin", name);
}

function writeLocalPreviewRuntimeVars() {
  fs.writeFileSync(
    path.join(process.cwd(), ".dev.vars"),
    sanitizedDotEnvContent(process.cwd(), { includeLocalPreviewRuntimeSecrets: true }),
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
  if (mode !== "opennext-deploy" && mode !== "opennext-upload") {
    return {
      captureCommandArtifacts: () => undefined,
      finish: (status: number | null, extra: WorkerDeployEvidenceFinishInput) => {
        void extra;
        return { status: status ?? 1 };
      },
    };
  }

  const backupDir = resolveBackupDir();
  const session = createWorkerDeployEvidenceSession({
    backupDir,
    mode,
    command: [command.executable, ...command.args, ...passthroughArgs],
    passthroughArgs,
    ...(readActiveWorkerVersion ? { readActiveWorkerVersion } : {}),
  });

  return {
    captureCommandArtifacts: session.captureCommandArtifacts,
    finish(status: number | null, extra: WorkerDeployEvidenceFinishInput) {
      const result = session.finish(status, extra);
      const { report } = result;
      console.log(
        JSON.stringify(
          {
            deployEvidence: path.join(cloudflareDir(backupDir), "worker-deploy-report.json"),
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
