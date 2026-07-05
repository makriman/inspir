import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import { writeBuildArtifactScanReport } from "./scan-build-artifacts";
import { buildSanitizedCloudflareBuildEnv, withSanitizedProjectEnvFiles } from "./sanitized-build-env";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import { writeWorkerDeployEvidenceReport, type WorkerDeployEvidenceReport } from "./worker-deploy-evidence";

type CommandMode = "next-build" | "opennext-build" | "opennext-deploy" | "opennext-upload" | "opennext-preview";
type DeployPreflightResult = { ok: boolean; status: number | null };
type RunSanitizedBuildOptions = {
  deployPreflight?: (backupDir: string) => DeployPreflightResult;
};

const COMMANDS: Record<CommandMode, { executable: string; args: string[]; scanBefore?: boolean; scanAfter?: boolean }> = {
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
    executable: bin("opennextjs-cloudflare"),
    args: ["deploy"],
    scanBefore: true,
  },
  "opennext-upload": {
    executable: bin("opennextjs-cloudflare"),
    args: ["upload"],
    scanBefore: true,
  },
  "opennext-preview": {
    executable: bin("opennextjs-cloudflare"),
    args: ["preview"],
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
  const deployEvidence = createWorkerDeployEvidenceWriter(mode, command, passthroughArgs);
  let productionDeployPreflightResult: DeployPreflightResult | null = null;
  const blockedArgs = blockedOpenNextSkipBuildArgs(mode, passthroughArgs);
  if (blockedArgs.length) {
    console.error(`Refusing OpenNext skip-build argument(s) in sanitized Cloudflare build path: ${blockedArgs.join(", ")}`);
    return deployEvidence.finish(2, {
      commandExecuted: false,
      scanBeforeOk: null,
      scanAfterOk: null,
      blockedArgs,
      error: `Refusing OpenNext skip-build argument(s): ${blockedArgs.join(", ")}`,
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

  const localCliBinDir = createLocalCliWrappers();
  return withSanitizedProjectEnvFiles(() => {
    try {
      if (command.scanBefore) {
        const report = writeBuildArtifactScanReport();
        if (!report.ok) {
          printScanFailure(report.findings.length);
          return deployEvidence.finish(1, {
            commandExecuted: false,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            scanBeforeOk: false,
            scanAfterOk: null,
            error: `OpenNext artifact scan failed with ${report.findings.length} finding(s).`,
          });
        }
      }

      const env = buildSanitizedCloudflareBuildEnv();
      env.PATH = [localCliBinDir, env.PATH].filter(Boolean).join(path.delimiter);
      const result = spawnSync(command.executable, [...command.args, ...passthroughArgs], {
        cwd: process.cwd(),
        env,
        stdio: "inherit",
      });
      if (result.status !== 0) {
        return deployEvidence.finish(result.status ?? 1, {
          commandExecuted: true,
          deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
          deployPreflightStatus: productionDeployPreflightResult?.status,
          scanBeforeOk: command.scanBefore ? true : null,
          scanAfterOk: null,
          error: `OpenNext ${mode} exited with status ${result.status ?? "unknown"}.`,
        });
      }

      if (command.scanAfter) {
        const report = writeBuildArtifactScanReport();
        if (!report.ok) {
          printScanFailure(report.findings.length);
          return deployEvidence.finish(1, {
            commandExecuted: true,
            deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
            deployPreflightStatus: productionDeployPreflightResult?.status,
            scanBeforeOk: command.scanBefore ? true : null,
            scanAfterOk: false,
            error: `OpenNext artifact scan failed with ${report.findings.length} finding(s).`,
          });
        }
      }

      return deployEvidence.finish(0, {
        commandExecuted: true,
        deployPreflightOk: productionDeployPreflightResult?.ok ?? undefined,
        deployPreflightStatus: productionDeployPreflightResult?.status,
        scanBeforeOk: command.scanBefore ? true : null,
        scanAfterOk: command.scanAfter ? true : null,
      });
    } finally {
      fs.rmSync(localCliBinDir, { recursive: true, force: true });
    }
  }, process.cwd(), { includeLocalPreviewRuntimeSecrets: mode === "opennext-preview" });
}

export function requiresProductionDeployPreflight(mode: CommandMode) {
  return mode === "opennext-deploy" || mode === "opennext-upload";
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

function printScanFailure(findings: number) {
  console.error(
    `OpenNext artifact scan failed with ${findings} finding(s). See cloudflare/build-artifact-scan-report.json in the active backup directory.`,
  );
}

function bin(name: string) {
  return path.resolve(process.cwd(), "node_modules", ".bin", name);
}

function createWorkerDeployEvidenceWriter(
  mode: CommandMode,
  command: (typeof COMMANDS)[CommandMode],
  passthroughArgs: string[],
) {
  if (mode !== "opennext-deploy" && mode !== "opennext-upload") {
    return { finish: (status: number | null) => ({ status }) };
  }

  const backupDir = resolveBackupDir();
  const startedAt = new Date().toISOString();
  const sourceFingerprintBefore = buildRepoSourceFingerprint();

  return {
    finish(
      status: number | null,
      extra: Pick<
        WorkerDeployEvidenceReport,
        | "commandExecuted"
        | "deployPreflightOk"
        | "deployPreflightStatus"
        | "scanBeforeOk"
        | "scanAfterOk"
        | "blockedArgs"
        | "error"
      >,
    ) {
      const completedAt = new Date().toISOString();
      const sourceFingerprintAfter = buildRepoSourceFingerprint();
      const sourceFingerprintStable = sourceFingerprintBefore.sha256 === sourceFingerprintAfter.sha256;
      const report: WorkerDeployEvidenceReport = {
        createdAt: completedAt,
        startedAt,
        completedAt,
        backupDir,
        mode,
        command: [command.executable, ...command.args, ...passthroughArgs],
        passthroughArgs,
        ok: status === 0 && extra.commandExecuted === true && sourceFingerprintStable,
        status,
        sourceFingerprintBefore,
        sourceFingerprintAfter,
        sourceFingerprintStable,
        ...extra,
      };
      writeWorkerDeployEvidenceReport(report);
      console.log(
        JSON.stringify(
          {
            deployEvidence: path.join(cloudflareDir(backupDir), "worker-deploy-report.json"),
            ok: report.ok,
            mode: report.mode,
            status: report.status,
            sourceFingerprint: {
              before: sourceFingerprintSummary(sourceFingerprintBefore),
              after: sourceFingerprintSummary(sourceFingerprintAfter),
              stable: sourceFingerprintStable,
            },
          },
          null,
          2,
        ),
      );
      return { status };
    },
  };
}

function sourceFingerprintSummary(fingerprint: SourceFingerprint) {
  return { sha256: fingerprint.sha256, fileCount: fingerprint.fileCount };
}

function createLocalCliWrappers() {
  const localCliBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-cf-build-bin-"));
  const realPnpm = "/Users/makriman/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm";
  const wrapper = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repo = ${JSON.stringify(process.cwd())};
const realPnpm = ${JSON.stringify(realPnpm)};
const args = process.argv.slice(2);

let command = realPnpm;
let finalArgs = args;

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
