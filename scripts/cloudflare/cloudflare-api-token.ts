import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CLOUDFLARE_ACCOUNT_ID } from "./migration-config";

export type CloudflareApiTokenSource = {
  kind: "env" | "file" | "wrangler-oauth";
  name: string;
};

export type CloudflareApiTokenResolution = {
  token: string;
  source: CloudflareApiTokenSource | null;
  error?: string;
};

type EnvMap = Record<string, string | undefined>;
type ReadCloudflareApiTokenOptions = Readonly<{
  allowWranglerOauthFallback?: boolean;
  wranglerConfigPath?: string;
}>;

const TOKEN_ENV_KEYS = ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"] as const;
const TOKEN_FILE_ENV_KEYS = ["CLOUDFLARE_API_TOKEN_FILE", "CF_API_TOKEN_FILE"] as const;
export const CLOUDFLARE_TOKEN_DOMAIN = "inspirlearning.com";
export const CLOUDFLARE_DNS_WRITE_PROBE_HOSTNAME = `_codex-migration-token-check.${CLOUDFLARE_TOKEN_DOMAIN}`;
export const CLOUDFLARE_TOKEN_REQUIRED_PERMISSIONS = {
  accountId: CLOUDFLARE_ACCOUNT_ID,
  zone: CLOUDFLARE_TOKEN_DOMAIN,
  zonePermissions: ["Zone:Read"],
  dnsPermissions: ["DNS:Read", "DNS:Edit"],
  proof:
    "The verifier must read the zone, read DNS records for inspirlearning.com and www.inspirlearning.com, then create/read/delete a temporary TXT record.",
  temporaryProbeRecord: CLOUDFLARE_DNS_WRITE_PROBE_HOSTNAME,
};

export function readCloudflareApiToken(
  env: EnvMap = process.env,
  options: ReadCloudflareApiTokenOptions = {},
): CloudflareApiTokenResolution {
  for (const key of TOKEN_FILE_ENV_KEYS) {
    const filePath = env[key]?.trim();
    if (!filePath) continue;

    const stat = safeStat(filePath);
    if (!stat) {
      return {
        token: "",
        source: null,
        error: `${key} points at a missing or unreadable Cloudflare API token file.`,
      };
    }
    if (!stat.isFile()) {
      return {
        token: "",
        source: null,
        error: `${key} must point at a regular file containing only the Cloudflare API token.`,
      };
    }

    const mode = stat.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      return {
        token: "",
        source: null,
        error: `${key} token file mode is ${formatMode(mode)}; use 0600 or stricter so group/other users cannot read it.`,
      };
    }

    const token = fs.readFileSync(filePath, "utf8").trim();
    if (!token) {
      return {
        token: "",
        source: null,
        error: `${key} points at an empty Cloudflare API token file.`,
      };
    }
    return { token, source: { kind: "file", name: key } };
  }

  for (const key of TOKEN_ENV_KEYS) {
    const token = env[key]?.trim();
    if (token) return { token, source: { kind: "env", name: key } };
  }

  if (options.allowWranglerOauthFallback !== false) {
    const wrangler = readWranglerOauthToken(
      options.wranglerConfigPath ?? defaultWranglerConfigPath(),
    );
    if (wrangler.token) return wrangler;
    if (wrangler.error && wrangler.error !== "missing") {
      return wrangler;
    }
  }

  return {
    token: "",
    source: null,
    error:
      "Set CLOUDFLARE_API_TOKEN_FILE or CF_API_TOKEN_FILE to a 0600 token file, set CLOUDFLARE_API_TOKEN/CF_API_TOKEN, or run wrangler login for direct Cloudflare API OAuth fallback.",
  };
}

export function cloudflareApiTokenInstructions() {
  return {
    preferred: "CLOUDFLARE_API_TOKEN_FILE=<path-to-0600-token-file>",
    fallback: "CLOUDFLARE_API_TOKEN=<set-in-shell> or CF_API_TOKEN=<set-in-shell>",
    requiredPermissions: CLOUDFLARE_TOKEN_REQUIRED_PERMISSIONS,
  };
}

export function cloudflareApiTokenSourceLabel(source: CloudflareApiTokenSource | null) {
  return source ? `${source.kind}:${source.name}` : null;
}

function safeStat(filePath: string) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function formatMode(mode: number) {
  return mode.toString(8).padStart(4, "0");
}

function defaultWranglerConfigPath() {
  return path.join(
    homedir(),
    "Library",
    "Preferences",
    ".wrangler",
    "config",
    "default.toml",
  );
}

function readWranglerOauthToken(configPath: string): CloudflareApiTokenResolution & { error?: string } {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(configPath);
  } catch {
    return { token: "", source: null, error: "missing" };
  }
  const mode = stat.mode & 0o777;
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    return {
      token: "",
      source: null,
      error:
        `Wrangler OAuth config must be a single-link owner-only file: ${configPath}.`,
    };
  }
  const source = fs.readFileSync(configPath, "utf8");
  const token = source.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1]?.trim();
  if (!token) {
    return {
      token: "",
      source: null,
      error: `Wrangler OAuth config does not contain an oauth_token: ${configPath}.`,
    };
  }
  return {
    token,
    source: { kind: "wrangler-oauth", name: "default.toml" },
  };
}
