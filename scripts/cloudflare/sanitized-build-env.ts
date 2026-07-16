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
  "BETTER_AUTH_SECRET",
  "CRON_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "OPENAI_API_KEY",
  "E2E_TEST_MUTATION_RUN_ID",
  "E2E_TEST_AUTH_EXPIRES_AT",
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
} as const;

const OPTIONAL_LOCAL_PREVIEW_RUNTIME_ENV_KEYS = [
  "E2E_TEST_AUTH_SECRET",
  "E2E_TEST_AUTH_EMAIL",
] as const;

const LOCAL_PREVIEW_PROVIDER_SECRET_ENV_KEYS = [
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
] as const;

type LocalPreviewProviderSecretKey =
  (typeof LOCAL_PREVIEW_PROVIDER_SECRET_ENV_KEYS)[number];

export type LocalPreviewProviderRuntimeSecrets = Readonly<
  Partial<Record<LocalPreviewProviderSecretKey, string>>
>;

export type LocalPreviewE2EAuth = Readonly<{
  email: string | undefined;
  secret: string | undefined;
  configured: boolean;
}>;

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

  Object.assign(
    env,
    buildSafePublicEnvValues(readWranglerVars(cwd)),
    ALWAYS_SAFE_ENV,
    buildSafePublicEnvValues(stringifyValues(overrides)),
  );
  return env;
}

export function sanitizedDotEnvContent(cwd = process.cwd(), options: SanitizedProjectEnvOptions = {}) {
  const values = {
    ...buildSafePublicEnvValues(readWranglerVars(cwd)),
    ...ALWAYS_SAFE_ENV,
    ...(options.includeLocalPreviewRuntimeSecrets ? localPreviewRuntimeEnv() : {}),
    ...buildSafePublicEnvValues(stringifyValues(options.overrides ?? {})),
  };
  return renderDotEnvContent(values);
}

export function resolveLocalPreviewProviderRuntimeSecrets(
  baseEnv: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): LocalPreviewProviderRuntimeSecrets {
  const localDotEnv = readPrivateLocalPreviewDotEnv(cwd);
  const resolved: Partial<Record<LocalPreviewProviderSecretKey, string>> = {};
  for (const key of LOCAL_PREVIEW_PROVIDER_SECRET_ENV_KEYS) {
    const explicit = baseEnv[key];
    const candidate =
      explicit === undefined
        ? readExactDotEnvAssignment(localDotEnv, key)
        : explicit;
    if (isExactLocalPreviewProviderSecret(candidate)) resolved[key] = candidate;
  }
  return Object.freeze(resolved);
}

export function resolveLocalPreviewE2EAuth(
  baseEnv: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): LocalPreviewE2EAuth {
  const localDotEnv = readPrivateLocalPreviewDotEnv(cwd);
  const email = exactLocalE2EEmail(
    resolveLocalPreviewEnvValue(baseEnv, localDotEnv, "E2E_TEST_AUTH_EMAIL"),
  );
  const secret = exactLocalE2ESecret(
    resolveLocalPreviewEnvValue(baseEnv, localDotEnv, "E2E_TEST_AUTH_SECRET"),
  );
  return Object.freeze({
    email,
    secret,
    configured: Boolean(email && secret),
  });
}

export function localPreviewProviderSecretValues(
  secrets: LocalPreviewProviderRuntimeSecrets,
): readonly string[] {
  return Object.freeze(
    LOCAL_PREVIEW_PROVIDER_SECRET_ENV_KEYS.flatMap((key) => {
      const value = secrets[key];
      return isExactLocalPreviewProviderSecret(value) ? [value] : [];
    }),
  );
}

export function localPreviewRuntimeDotEnvContent(
  cwd = process.cwd(),
  providerSecrets: LocalPreviewProviderRuntimeSecrets = {},
) {
  const runtimeProviderSecrets: Partial<
    Record<LocalPreviewProviderSecretKey, string>
  > = {};
  for (const key of LOCAL_PREVIEW_PROVIDER_SECRET_ENV_KEYS) {
    const value = providerSecrets[key];
    if (value === undefined) continue;
    if (!isExactLocalPreviewProviderSecret(value)) {
      throw new Error(`Local preview provider secret ${key} is invalid.`);
    }
    runtimeProviderSecrets[key] = value;
  }
  return renderDotEnvContent({
    ...buildSafePublicEnvValues(readWranglerVars(cwd)),
    ...ALWAYS_SAFE_ENV,
    ...localPreviewRuntimeEnv(),
    ...runtimeProviderSecrets,
  });
}

export function localPreviewRuntimeEnv() {
  const localPreviewUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://localhost:8787";
  const previewAdminEmail = exactLocalE2EEmail(process.env.E2E_TEST_AUTH_EMAIL);
  const previewE2ESecret = exactLocalE2ESecret(process.env.E2E_TEST_AUTH_SECRET);
  const env: Record<string, string> = {
    ...LOCAL_PREVIEW_RUNTIME_ENV,
    ...(previewAdminEmail && previewE2ESecret
      ? {
          ADMIN_EMAILS: previewAdminEmail,
          E2E_TEST_AUTH_ALLOW_LOCAL_CREATE: "1",
          E2E_TEST_AUTH_REQUIRE_EXISTING: "0",
        }
      : {}),
    APP_URL: localPreviewUrl,
    AUTH_URL: localPreviewUrl,
    BETTER_AUTH_URL: localPreviewUrl,
  };
  for (const key of OPTIONAL_LOCAL_PREVIEW_RUNTIME_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) env[key] = value;
  }
  return env;
}

function exactLocalE2EEmail(value: string | undefined) {
  if (!value || value !== value.trim() || value !== value.toLowerCase()) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
}

function exactLocalE2ESecret(value: string | undefined) {
  if (!value || !/^[\x21-\x7e]+$/.test(value)) return undefined;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= 32 && bytes <= 512 ? value : undefined;
}

function stringifyValues(values: Record<string, string | number | boolean>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
}

function buildSafePublicEnvValues(
  values: Readonly<Record<string, string>>,
) {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !isForbiddenBuildEnvKey(key)),
  );
}

function renderDotEnvContent(values: Readonly<Record<string, string>>) {
  return `${Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${quoteDotEnvValue(value)}`)
    .join("\n")}\n`;
}

function readPrivateLocalPreviewDotEnv(cwd: string) {
  const filePath = path.join(cwd, ".dev.vars");
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    const stat = fs.fstatSync(descriptor);
    const currentUid =
      typeof process.getuid === "function" ? process.getuid() : null;
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size < 0 ||
      stat.size > 1_024 * 1_024 ||
      (stat.mode & 0o077) !== 0 ||
      (currentUid !== null && stat.uid !== currentUid)
    ) {
      return "";
    }
    return fs.readFileSync(descriptor, "utf8");
  } catch {
    return "";
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function readExactDotEnvAssignment(source: string, expectedKey: string) {
  let matched: string | undefined;
  for (const line of source.split(/\r?\n/)) {
    const assignment = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
    );
    if (!assignment || assignment[1] !== expectedKey) continue;
    if (matched !== undefined) return undefined;
    matched = parseDotEnvScalar(assignment[2] ?? "");
    if (matched === undefined) return undefined;
  }
  return matched;
}

function resolveLocalPreviewEnvValue(
  baseEnv: Readonly<Record<string, string | undefined>>,
  localDotEnv: string,
  key: string,
) {
  const explicit = baseEnv[key];
  return explicit === undefined
    ? readExactDotEnvAssignment(localDotEnv, key)
    : explicit;
}

function parseDotEnvScalar(source: string) {
  const value = source.trim();
  if (!value) return "";
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) return undefined;
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'")) {
    return value.endsWith("'") ? value.slice(1, -1) : undefined;
  }
  const commentIndex = value.indexOf("#");
  return (commentIndex === -1 ? value : value.slice(0, commentIndex)).trim();
}

function isExactLocalPreviewProviderSecret(
  value: string | undefined,
): value is string {
  return Boolean(
    value &&
      value === value.trim() &&
      value.length <= 8_192 &&
      /^[\x21-\x7e]+$/.test(value),
  );
}

export function isForbiddenBuildEnvKey(key: string) {
  if (key === "SKIP_NEXT_APP_BUILD") return true;
  if (key === "E2E_TEST_AUTH_ALLOW_LOCAL_CREATE") return true;
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
