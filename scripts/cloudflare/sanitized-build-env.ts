import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandEnv } from "./migration-config";

const NEXT_ENV_FILES_LOADED_DURING_BUILD = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
] as const;

const WRANGLER_ENV_FILES_MASKED_DURING_BUILD = [".dev.vars", ".dev.vars.local", ".dev.vars.production"] as const;

export const CURRENT_RUNTIME_SECRET_ENV_KEYS = [
  "ADMIN_EMAILS",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_SECRET",
  "CRON_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NEXTAUTH_SECRET",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "OPENAI_API_KEY",
] as const;

const ALWAYS_SAFE_ENV = {
  NEXT_TELEMETRY_DISABLED: "1",
  NEXTJS_ENV: "production",
  NODE_ENV: "production",
  SKIP_WRANGLER_CONFIG_CHECK: "yes",
} as const;

type MaskedEnvFile = {
  relativePath: string;
  originalPath: string;
  backupPath: string | null;
  wroteSanitized: boolean;
};

type SanitizedProjectEnvOptions = {
  includeLocalPreviewRuntimeSecrets?: boolean;
  overrides?: Record<string, string | number | boolean>;
};

const LOCAL_PREVIEW_RUNTIME_ENV = {
  ADMIN_EMAILS: "",
  AUTH_GOOGLE_ID: "local-preview-google-client-id",
  AUTH_GOOGLE_SECRET: "local-preview-google-client-secret",
  AUTH_SECRET: "local-preview-auth-secret",
  CRON_SECRET: "local-preview-cron-secret",
  NEXTAUTH_SECRET: "local-preview-auth-secret",
} as const;

const OPTIONAL_LOCAL_PREVIEW_RUNTIME_ENV_KEYS = ["E2E_TEST_AUTH_SECRET", "E2E_TEST_AUTH_EMAIL"] as const;

export function withSanitizedProjectEnvFiles<T>(
  callback: () => T,
  cwd = process.cwd(),
  options: SanitizedProjectEnvOptions = {},
): T {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-cf-build-env-"));
  const masked: MaskedEnvFile[] = [];

  try {
    for (const relativePath of [...NEXT_ENV_FILES_LOADED_DURING_BUILD, ...WRANGLER_ENV_FILES_MASKED_DURING_BUILD]) {
      const originalPath = path.join(cwd, relativePath);
      const backupPath = fs.existsSync(originalPath) ? path.join(tempDir, encodeURIComponent(relativePath)) : null;
      if (backupPath) fs.renameSync(originalPath, backupPath);
      masked.push({ relativePath, originalPath, backupPath, wroteSanitized: false });
    }

    for (const relativePath of [".env.local", ".env.production.local", ".dev.vars"]) {
      const entry = masked.find((item) => item.relativePath === relativePath);
      if (!entry) continue;
      fs.writeFileSync(entry.originalPath, sanitizedDotEnvContent(cwd, options), { mode: 0o600 });
      entry.wroteSanitized = true;
    }

    return callback();
  } finally {
    for (const entry of [...masked].reverse()) {
      if (entry.wroteSanitized && fs.existsSync(entry.originalPath)) fs.rmSync(entry.originalPath, { force: true });
      if (entry.backupPath && fs.existsSync(entry.backupPath)) fs.renameSync(entry.backupPath, entry.originalPath);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function buildSanitizedCloudflareBuildEnv(
  baseEnv: Record<string, string | undefined> = commandEnv(),
  cwd = process.cwd(),
  overrides: Record<string, string | number | boolean> = {},
) {
  const env = { ...baseEnv, NODE_ENV: baseEnv.NODE_ENV ?? "production" } as NodeJS.ProcessEnv;
  for (const key of Object.keys(env)) {
    if (isForbiddenBuildEnvKey(key)) delete env[key];
  }

  Object.assign(env, readWranglerVars(cwd), ALWAYS_SAFE_ENV, stringifyValues(overrides));
  return env;
}

export function sanitizedDotEnvContent(cwd = process.cwd(), options: SanitizedProjectEnvOptions = {}) {
  const values = {
    ...readWranglerVars(cwd),
    ...ALWAYS_SAFE_ENV,
    ...(options.includeLocalPreviewRuntimeSecrets ? localPreviewRuntimeEnv() : {}),
    ...stringifyValues(options.overrides ?? {}),
  };
  return `${Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${quoteDotEnvValue(String(value))}`)
    .join("\n")}\n`;
}

export function localPreviewRuntimeEnv() {
  const localPreviewUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://localhost:8787";
  const env: Record<string, string> = {
    ...LOCAL_PREVIEW_RUNTIME_ENV,
    AUTH_URL: localPreviewUrl,
    NEXTAUTH_URL: localPreviewUrl,
  };
  for (const key of OPTIONAL_LOCAL_PREVIEW_RUNTIME_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) env[key] = value;
  }
  return env;
}

function stringifyValues(values: Record<string, string | number | boolean>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
}

export function isForbiddenBuildEnvKey(key: string) {
  if (key === "SKIP_NEXT_APP_BUILD") return true;
  if ((CURRENT_RUNTIME_SECRET_ENV_KEYS as readonly string[]).includes(key)) return true;
  if (/SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_KEY/i.test(key)) return key !== "CLOUDFLARE_ACCOUNT_ID";
  return false;
}

function readWranglerVars(cwd: string) {
  const configPath = path.join(cwd, "wrangler.jsonc");
  if (!fs.existsSync(configPath)) return {};
  const parsed = JSON.parse(stripJsonComments(fs.readFileSync(configPath, "utf8"))) as { vars?: Record<string, unknown> };
  return Object.fromEntries(
    Object.entries(parsed.vars ?? {}).flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [[key, String(value)]] : [],
    ),
  );
}

function quoteDotEnvValue(value: string) {
  if (/^[A-Za-z0-9_./:@-]*$/.test(value)) return value;
  return JSON.stringify(value);
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
