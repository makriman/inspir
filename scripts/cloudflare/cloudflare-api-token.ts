import fs from "node:fs";
import { CLOUDFLARE_ACCOUNT_ID } from "./migration-config";

export type CloudflareApiTokenSource = {
  kind: "env" | "file";
  name: string;
};

export type CloudflareApiTokenResolution = {
  token: string;
  source: CloudflareApiTokenSource | null;
  error?: string;
};

type EnvMap = Record<string, string | undefined>;

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

export function readCloudflareApiToken(env: EnvMap = process.env): CloudflareApiTokenResolution {
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

  return {
    token: "",
    source: null,
    error:
      "Set CLOUDFLARE_API_TOKEN_FILE or CF_API_TOKEN_FILE to a 0600 token file, or set CLOUDFLARE_API_TOKEN/CF_API_TOKEN.",
  };
}

export function hasCloudflareApiToken(env: EnvMap = process.env) {
  return Boolean(readCloudflareApiToken(env).token);
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
