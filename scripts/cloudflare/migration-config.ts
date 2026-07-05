import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CLOUDFLARE_ACCOUNT_ID = "a1e5e542dc1d5fe5a5c6b2a10d755a81";
export const D1_DATABASE_NAME = "inspirlearning-prod";
export const D1_DATABASE_ID = "7cb2ddf7-ca3d-4f46-a022-cc8b3a25b7b9";
export const VECTORIZE_INDEX_NAME = "inspirlearning-memory-prod";
export const R2_BUCKET_NAME = "inspirlearning-next-cache-prod";
export const MEMORY_POST_TURN_QUEUE_NAME = "inspirlearning-memory-post-turn-prod";
export const MEMORY_POST_TURN_DLQ_NAME = "inspirlearning-memory-post-turn-dlq";

export const LOCAL_GATE_IDS = [
  "typecheck",
  "cloudflare-worker-typecheck",
  "lint",
  "unit-tests",
  "source-secret-scan",
  "next-build",
  "opennext-build",
  "opennext-artifact-secret-scan",
  "wrangler-deploy-dry-run",
  "wrangler-check-startup",
] as const;

export const RUNTIME_MUTABLE_TABLES = ["llm_usage_daily", "rate_limit_windows"] as const;

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

export function hasFlag(name: string) {
  return process.argv.includes(name);
}

export type RunCommandOptions = {
  input?: string;
  allowFailure?: boolean;
  maxBuffer?: number;
};

export type RunCommandResult = {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  output: string;
};

export function runWrangler(args: string[], options: RunCommandOptions = {}) {
  return runWranglerResult(args, options).output;
}

function runWranglerResult(args: string[], options: RunCommandOptions = {}): RunCommandResult {
  const attempts: RunCommandResult[] = [];
  for (const { command, argsPrefix } of wranglerCommandCandidates()) {
    const result = runCommand(command, [...argsPrefix, ...args], { ...options, allowFailure: true });
    attempts.push(result);
    if (result.ok || result.status !== 127) {
      if (!result.ok && !options.allowFailure) throw new Error(result.output);
      return result;
    }
  }

  const usable = attempts.at(-1);
  if (!usable) throw new Error("No Wrangler command candidates were available");
  if (!usable.ok && !options.allowFailure) throw new Error(usable.output);
  return usable;
}

export function commandEnv() {
  return {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID,
    PNPM_CONFIG_CONFIRM_MODULES_PURGE: "false",
    npm_config_confirm_modules_purge: "false",
    PATH: commandPath(),
    PAGER: "cat",
    NO_COLOR: "1",
  };
}

function runCommand(command: string, args: string[], options: RunCommandOptions = {}): RunCommandResult {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input: options.input,
    env: commandEnv(),
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? (result.error ? String(result.error) : "");
  const output = `${stdout}${stderr}`;
  if (result.status !== 0 && !options.allowFailure) throw new Error(output);
  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr,
    output,
  };
}

function wranglerCommandCandidates() {
  const candidates: Array<{ command: string; argsPrefix: string[] }> = [];
  const localWrangler = path.resolve(process.cwd(), "node_modules", ".bin", "wrangler");
  if (fs.existsSync(localWrangler)) candidates.push({ command: localWrangler, argsPrefix: [] });

  const pathWrangler = commandExistsWithoutWranglerRecursion("wrangler") ? "wrangler" : "";
  if (pathWrangler) candidates.push({ command: pathWrangler, argsPrefix: [] });

  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    if (/\.(?:cjs|mjs|js)$/.test(npmExecPath)) {
      candidates.push({ command: process.execPath, argsPrefix: [npmExecPath, "exec", "wrangler"] });
    } else {
      candidates.push({ command: npmExecPath, argsPrefix: ["exec", "wrangler"] });
    }
  }

  candidates.push({ command: "pnpm", argsPrefix: ["exec", "wrangler"] });
  return candidates;
}

function commandExistsWithoutWranglerRecursion(command: string) {
  const result = spawnSync(command, ["--version"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: commandPath(),
      PAGER: "cat",
      NO_COLOR: "1",
    },
    maxBuffer: 1024 * 1024,
  });
  return result.status === 0;
}

function commandPath() {
  const entries = [
    path.dirname(process.execPath),
    path.resolve(process.cwd(), "node_modules", ".bin"),
    process.env.PATH ?? "",
  ];
  return entries.filter(Boolean).join(path.delimiter);
}

export function resolveBackupDir() {
  const explicit = getArg("--backup");
  if (explicit) return path.resolve(explicit);

  return path.resolve(process.cwd(), "tmp", "cloudflare-reports");
}

export function cloudflareDir(backupDir: string) {
  const dir = path.join(backupDir, "cloudflare");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function createHash() {
  return crypto.createHash("sha256");
}
