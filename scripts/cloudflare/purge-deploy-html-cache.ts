import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { languageUrlPrefixes, supportedLanguages } from "@/lib/content/languages";
import {
  CLOUDFLARE_TOKEN_DOMAIN,
  cloudflareApiTokenSourceLabel,
  readCloudflareApiToken,
} from "./cloudflare-api-token";
import {
  CLOUDFLARE_ACCOUNT_ID,
  cloudflareDir,
  hasFlag,
  resolveBackupDir,
} from "./migration-config";

const cloudflareApiBase = "https://api.cloudflare.com/client/v4";
const filePurgeBatchSize = 100;
const prefixPurgeBatchSize = 30;
const cloudflareRetryLimit = 3;
const productionHosts = [CLOUDFLARE_TOKEN_DOMAIN, `www.${CLOUDFLARE_TOKEN_DOMAIN}`] as const;
const marketingExactPaths = [
  "/",
  "/about",
  "/ai-learning-map",
  "/blog",
  "/compare",
  "/for",
  "/learn",
  "/loading",
  "/media",
  "/mission",
  "/privacy",
  "/prompts",
  "/schools",
  "/subjects",
  "/terms",
  "/topics",
  "/trust",
] as const;
const marketingPathPrefixes = ["/blog/", "/compare/", "/for/", "/learn/", "/subjects/"] as const;

if (isMainModule()) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    writeReport(path.join(cloudflareDir(resolveBackupDir()), "deploy-html-cache-purge.json"), {
      ok: false,
      error: message,
    });
    console.error(message);
    process.exitCode = 1;
  });
}

async function main() {
  const targets = buildDeployHtmlPurgeTargets();
  const backupDir = resolveBackupDir();
  const reportPath = path.join(cloudflareDir(backupDir), "deploy-html-cache-purge.json");
  const dryRun = hasFlag("--dry-run");
  if (!dryRun && !hasFlag("--confirm-production")) {
    throw new Error("Production cache purge requires --confirm-production.");
  }

  if (dryRun) {
    writeReport(reportPath, {
      ok: true,
      dryRun: true,
      files: targets.files,
      prefixes: targets.prefixes,
    });
    console.log(JSON.stringify({ ok: true, dryRun: true, ...targetCounts(targets), reportPath }, null, 2));
    return;
  }

  const credential = readCloudflareApiToken();
  if (!credential.token) throw new Error(credential.error ?? "Cloudflare API token is unavailable.");
  const zoneId = await resolveZoneId(credential.token);
  let requests = 0;
  for (const files of chunks(targets.files, filePurgeBatchSize)) {
    await purge(zoneId, credential.token, { files });
    requests += 1;
  }
  for (const prefixes of chunks(targets.prefixes, prefixPurgeBatchSize)) {
    await purge(zoneId, credential.token, { prefixes });
    requests += 1;
  }

  const report = {
    ok: true,
    dryRun: false,
    zone: CLOUDFLARE_TOKEN_DOMAIN,
    tokenSource: cloudflareApiTokenSourceLabel(credential.source),
    requests,
    ...targetCounts(targets),
    files: targets.files,
    prefixes: targets.prefixes,
  };
  writeReport(reportPath, report);
  console.log(JSON.stringify({ ...report, files: undefined, prefixes: undefined, reportPath }, null, 2));
}

export function buildDeployHtmlPurgeTargets() {
  const localePrefixes = supportedLanguages
    .map((language) => languageUrlPrefixes[language])
    .filter((prefix) => prefix.length > 0);
  const files = new Set<string>();
  const prefixes = new Set<string>();

  for (const host of productionHosts) {
    const origin = `https://${host}`;
    for (const pathname of marketingExactPaths) files.add(new URL(pathname, origin).toString());
    for (const locale of localePrefixes) {
      files.add(new URL(`/${locale}`, origin).toString());
      prefixes.add(`${host}/${locale}/`);
    }
    for (const pathname of marketingPathPrefixes) prefixes.add(`${host}${pathname}`);
    prefixes.add(`${host}/api/`);
  }

  return {
    files: Array.from(files).sort(),
    prefixes: Array.from(prefixes).sort(),
  };
}

async function resolveZoneId(token: string) {
  const url = new URL(`${cloudflareApiBase}/zones`);
  url.searchParams.set("name", CLOUDFLARE_TOKEN_DOMAIN);
  url.searchParams.set("account.id", CLOUDFLARE_ACCOUNT_ID);
  url.searchParams.set("per_page", "50");
  const payload = await cloudflareRequest(url, token);
  const result = payload.result;
  if (!Array.isArray(result)) throw new Error("Cloudflare zone lookup returned no result list.");
  for (const item of result) {
    const zone = objectRecord(item);
    if (zone?.name === CLOUDFLARE_TOKEN_DOMAIN && typeof zone.id === "string") return zone.id;
  }
  throw new Error(`Could not resolve Cloudflare zone ${CLOUDFLARE_TOKEN_DOMAIN}.`);
}

async function purge(
  zoneId: string,
  token: string,
  body: Readonly<{ files: string[] } | { prefixes: string[] }>,
) {
  const payload = await cloudflareRequest(
    new URL(`${cloudflareApiBase}/zones/${zoneId}/purge_cache`),
    token,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (payload.success !== true) throw new Error("Cloudflare rejected a targeted deploy cache purge batch.");
}

async function cloudflareRequest(url: URL, token: string, init: RequestInit = {}) {
  for (let attempt = 0; attempt <= cloudflareRetryLimit; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const value: unknown = await response.json().catch(() => null);
    const payload = objectRecord(value);
    if (response.ok && payload) return payload;
    if (response.status !== 429 || attempt === cloudflareRetryLimit) {
      throw new Error(`Cloudflare API request failed with status ${response.status}.`);
    }
    await delay(retryDelayMs(response.headers.get("retry-after"), attempt));
  }
  throw new Error("Cloudflare API retry loop ended unexpectedly.");
}

function retryDelayMs(retryAfter: string | null, attempt: number) {
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 2 ** attempt;
  return Math.min(15_000, Math.max(1_000, seconds * 1_000));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function chunks<T>(values: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function targetCounts(targets: ReturnType<typeof buildDeployHtmlPurgeTargets>) {
  return { fileTargets: targets.files.length, prefixTargets: targets.prefixes.length };
}

function writeReport(filePath: string, value: Record<string, unknown>) {
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ createdAt: new Date().toISOString(), ...value }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
