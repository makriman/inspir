import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listReleaseUnitTestFiles,
  releaseUnitTestEnvironment,
} from "../release-unit-test-contract";
import { LOCAL_GATE_IDS, cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import { buildRepoSourceFingerprint, fingerprintFile } from "./source-fingerprint";

type LocalGateId = (typeof LOCAL_GATE_IDS)[number];

type Gate = {
  id: LocalGateId;
  steps: GateStep[];
};

type GateStep = {
  command: string;
  args: string[];
};

type GateResult = Gate & {
  ok: boolean;
  status: number | null;
  durationMs: number;
  outputTail: string;
};

const OUTPUT_TAIL_CHARS = 12_000;
const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const reportPath = path.join(cfDir, "local-gates-report.json");
const startupProfilePath = path.join(cfDir, "worker-startup.cpuprofile");
const startupProfileRelativePath = "cloudflare/worker-startup.cpuprofile";
const localCliBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-local-gates-"));
process.once("exit", cleanupLocalCliWrappers);

const bin = (name: string) => path.resolve(process.cwd(), "node_modules", ".bin", name);
const releaseUnitTests = listReleaseUnitTestFiles();

const gatesById: Record<LocalGateId, Gate> = {
  typecheck: { id: "typecheck", steps: [{ command: bin("tsc"), args: ["--noEmit"] }] },
  "cloudflare-worker-typecheck": {
    id: "cloudflare-worker-typecheck",
    steps: [
      {
        command: bin("wrangler"),
        args: ["types", "cloudflare-env.generated.d.ts", "--include-runtime", "false", "--strict-vars", "false", "--env-interface", "CloudflareBindings"],
      },
      { command: bin("tsc"), args: ["--noEmit", "--project", "tsconfig.cloudflare-worker.json"] },
    ],
  },
  lint: { id: "lint", steps: [{ command: bin("eslint"), args: [] }] },
  "react-doctor": { id: "react-doctor", steps: [{ command: bin("tsx"), args: ["scripts/cloudflare/run-react-doctor-gate.ts"] }] },
  "unit-tests": { id: "unit-tests", steps: [{ command: process.execPath, args: ["--import", "tsx", "--test", ...releaseUnitTests] }] },
  "source-secret-scan": { id: "source-secret-scan", steps: [{ command: bin("tsx"), args: ["scripts/cloudflare/scan-source-secrets.ts"] }] },
  "next-build": { id: "next-build", steps: [{ command: bin("tsx"), args: ["scripts/cloudflare/run-sanitized-build.ts", "next-build"] }] },
  "opennext-build": { id: "opennext-build", steps: [{ command: bin("tsx"), args: ["scripts/cloudflare/run-sanitized-build.ts", "opennext-build"] }] },
  "opennext-resource-budget": {
    id: "opennext-resource-budget",
    steps: [{ command: bin("tsx"), args: ["scripts/cloudflare/check-opennext-resource-budget.ts"] }],
  },
  "opennext-artifact-secret-scan": {
    id: "opennext-artifact-secret-scan",
    steps: [{ command: bin("tsx"), args: ["scripts/cloudflare/scan-build-artifacts.ts"] }],
  },
  "wrangler-deploy-dry-run": { id: "wrangler-deploy-dry-run", steps: [{ command: bin("wrangler"), args: ["deploy", "--dry-run"] }] },
  "www-redirect-dry-run": {
    id: "www-redirect-dry-run",
    steps: [{ command: bin("wrangler"), args: ["deploy", "--dry-run", "--config", "wrangler.www-redirect.jsonc"] }],
  },
  "wrangler-check-startup": {
    id: "wrangler-check-startup",
    steps: [{ command: bin("wrangler"), args: ["check", "startup", "--outfile", startupProfilePath, "--args=--dry-run"] }],
  },
  "cloudflare-preview-live-e2e": {
    id: "cloudflare-preview-live-e2e",
    steps: [
      {
        command: bin("tsx"),
        args: ["scripts/cloudflare/verify-preview-e2e-evidence.ts"],
      },
    ],
  },
};

const gates = LOCAL_GATE_IDS.map((id) => gatesById[id]);

ensureLocalCliWrappers();

const sourceFingerprintBefore = buildRepoSourceFingerprint();
const results = gates.map(runGate);
const sourceFingerprintAfter = buildRepoSourceFingerprint();
const sourceFingerprintStable = sourceFingerprintBefore.sha256 === sourceFingerprintAfter.sha256;
const startupProfile = fs.existsSync(startupProfilePath) ? fingerprintFile(backupDir, startupProfilePath) : null;
const report = {
  createdAt: new Date().toISOString(),
  backupDir,
  ok: results.every((result) => result.ok) && sourceFingerprintStable && startupProfile?.file === startupProfileRelativePath,
  sourceFingerprintBefore,
  sourceFingerprintAfter,
  sourceFingerprintStable,
  startupProfile,
  results,
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(compactReport(report), null, 2));
cleanupLocalCliWrappers();
if (!report.ok) process.exitCode = 1;

function runGate(gate: Gate): GateResult {
  const start = Date.now();
  const outputChunks: string[] = [];
  let status: number | null = 0;

  for (const step of gate.steps) {
    const result = spawnSync(step.command, step.args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: localGateEnv(),
      maxBuffer: 256 * 1024 * 1024,
    });
    status = result.status;
    outputChunks.push(`${step.command} ${step.args.join(" ")}`);
    outputChunks.push(`${result.stdout ?? ""}${result.stderr ?? (result.error ? String(result.error) : "")}`);
    if (result.status !== 0) break;
  }

  const output = outputChunks.join("\n");
  return {
    ...gate,
    ok: status === 0,
    status,
    durationMs: Date.now() - start,
    outputTail: output.slice(-OUTPUT_TAIL_CHARS),
  };
}

function ensureLocalCliWrappers() {
  fs.mkdirSync(localCliBinDir, { recursive: true, mode: 0o700 });
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
}

function cleanupLocalCliWrappers() {
  fs.rmSync(localCliBinDir, { recursive: true, force: true });
}

function localGateEnv() {
  const env = releaseUnitTestEnvironment(commandEnv());
  return {
    ...env,
    PATH: [localCliBinDir, env.PATH].join(path.delimiter),
  };
}

function compactReport(fullReport: typeof report) {
  return {
    createdAt: fullReport.createdAt,
    backupDir: fullReport.backupDir,
    ok: fullReport.ok,
    sourceFingerprint: {
      before: fullReport.sourceFingerprintBefore.sha256,
      after: fullReport.sourceFingerprintAfter.sha256,
      stable: fullReport.sourceFingerprintStable,
      fileCount: fullReport.sourceFingerprintAfter.fileCount,
    },
    startupProfile: fullReport.startupProfile,
    results: fullReport.results.map((result) => ({
      id: result.id,
      ok: result.ok,
      status: result.status,
      durationMs: result.durationMs,
    })),
  };
}
