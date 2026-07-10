import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  R2_BUCKET_NAME,
  cloudflareDir,
  createHash,
  resolveBackupDir,
  runWrangler,
} from "./migration-config";

const retentionDays = 90;
const productionBaseUrl = "https://inspirlearning.com";
const safeBuildIdPattern = /^[A-Za-z0-9._-]{8,120}$/;

if (isMainModule()) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main() {
  const buildId = getArg("--build-id");
  const expectedActiveVersion = getArg("--expected-active-version");
  const expectedActiveBuild = getArg("--expected-active-build");
  if (!buildId || !expectedActiveVersion || !expectedActiveBuild) {
    throw new Error(
      "Usage: retire-next-cache-build.ts --build-id <retired-build> --expected-active-version <100%-version> --expected-active-build <active-build>",
    );
  }
  const prefix = retiredCachePrefix(buildId);
  retiredCachePrefix(expectedActiveBuild);
  const deploymentVersion = readSingleActiveDeploymentVersion();
  if (deploymentVersion !== expectedActiveVersion) {
    throw new Error(`Active deployment version ${deploymentVersion} did not match the operator-confirmed version.`);
  }
  const activeIdentity = await readActiveIdentity();
  if (
    activeIdentity.versionId !== expectedActiveVersion ||
    activeIdentity.buildId !== expectedActiveBuild
  ) {
    throw new Error("Production health did not match the operator-confirmed 100% version and build.");
  }
  if (activeIdentity.buildId === buildId) {
    throw new Error(`Refusing to expire the active OpenNext cache build ${buildId}.`);
  }

  const ruleName = retiredBuildRuleName(buildId);
  const before = listLifecycleRules();
  const retirementTime = new Date();
  const requestedExpirationDate = expirationDateForRetirement(retirementTime);
  const reportPath = path.join(cloudflareDir(resolveBackupDir()), `retired-cache-build-${buildId}.json`);
  const recordedExpirationDate = readRecordedExpirationDate(reportPath);
  const expectedExpirationDate = before.includes(ruleName)
    ? recordedExpirationDate ?? requestedExpirationDate
    : requestedExpirationDate;
  let operation: "unchanged" | "created" = "unchanged";
  if (!before.includes(ruleName)) {
    runWrangler([
      "r2",
      "bucket",
      "lifecycle",
      "add",
      R2_BUCKET_NAME,
      ruleName,
      prefix,
      "--expire-date",
      requestedExpirationDate,
      "--force",
    ]);
    operation = "created";
  }

  const after = listLifecycleRules();
  const ruleBlock = lifecycleRuleBlock(after, ruleName);
  const expirationDate = ruleBlock.match(/Expire objects on (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const ok =
    ruleBlock.includes(ruleName) &&
    ruleBlock.includes(prefix) &&
    expirationDate === expectedExpirationDate &&
    expirationDateIsFuture(expirationDate, retirementTime);
  const report = {
    createdAt: new Date().toISOString(),
    ok,
    bucket: R2_BUCKET_NAME,
    retiredBuildId: buildId,
    activeBuildId: activeIdentity.buildId,
    activeVersionId: activeIdentity.versionId,
    prefix,
    lifecycleRuleName: ruleName,
    retentionDays,
    retiredAt: retirementTime.toISOString(),
    requestedExpirationDate,
    expectedExpirationDate,
    expirationDate,
    operation,
  };
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

function readRecordedExpirationDate(reportPath: string) {
  if (!fs.existsSync(reportPath)) return null;
  try {
    const value: unknown = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const record = objectRecord(value);
    return record?.ok === true && typeof record.expectedExpirationDate === "string"
      ? record.expectedExpirationDate
      : null;
  } catch {
    return null;
  }
}

function expirationDateIsFuture(expirationDate: string | null, now: Date) {
  if (!expirationDate) return false;
  const timestamp = Date.parse(`${expirationDate}T23:59:59.999Z`);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export function retiredCachePrefix(buildId: string) {
  if (!safeBuildIdPattern.test(buildId) || buildId === "no-build-id" || buildId === "unknown-build") {
    throw new Error("OpenNext build ID contains unsupported characters or is not specific.");
  }
  return `incremental-cache/${buildId}/`;
}

export function retiredBuildRuleName(buildId: string) {
  const digest = createHash().update(buildId).digest("hex").slice(0, 16);
  return `inspir-opennext-retired-${digest}`;
}

export function expirationDateForRetirement(retiredAt: Date) {
  const timestamp = retiredAt.getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Retirement time is invalid.");
  const expiration = new Date(timestamp);
  expiration.setUTCDate(expiration.getUTCDate() + retentionDays);
  return expiration.toISOString().slice(0, 10);
}

async function readActiveIdentity() {
  const baseUrl = process.env.RETIRE_CACHE_BASE_URL?.trim() || productionBaseUrl;
  const response = await fetch(new URL("/api/health", baseUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Could not verify the active OpenNext build (${response.status}).`);
  const payload: unknown = await response.json();
  const record = objectRecord(payload);
  const build = objectRecord(record?.build);
  const version = objectRecord(record?.version);
  const buildId = build?.id;
  const versionId = version?.id;
  if (
    typeof buildId !== "string" ||
    !safeBuildIdPattern.test(buildId) ||
    buildId === "no-build-id" ||
    buildId === "unknown-build"
  ) {
    throw new Error("Production health did not expose a valid active OpenNext build ID.");
  }
  if (typeof versionId !== "string" || !/^[a-f0-9-]{16,80}$/i.test(versionId)) {
    throw new Error("Production health did not expose a valid active Worker version ID.");
  }
  return { buildId, versionId };
}

function readSingleActiveDeploymentVersion() {
  const output = runWrangler(["deployments", "status", "--json"]);
  const deployment = parseJsonObjectFromOutput(output);
  const versions = deployment && Array.isArray(deployment.versions) ? deployment.versions : [];
  if (versions.length !== 1) {
    throw new Error("Cache retirement requires exactly one active Worker version; finish the split rollout first.");
  }
  const active = objectRecord(versions[0]);
  if (active?.percentage !== 100 || typeof active.version_id !== "string") {
    throw new Error("Cache retirement requires a single Worker version at exactly 100% traffic.");
  }
  return active.version_id;
}

function listLifecycleRules() {
  return runWrangler(["r2", "bucket", "lifecycle", "list", R2_BUCKET_NAME]);
}

function lifecycleRuleBlock(output: string, ruleName: string) {
  const marker = new RegExp(`^name:\\s+${escapeRegExp(ruleName)}\\s*$`, "m").exec(output);
  if (!marker || marker.index === undefined) return "";
  const tail = output.slice(marker.index + marker[0].length);
  const next = /\nname:\s+/m.exec(tail);
  return output.slice(marker.index, next ? marker.index + marker[0].length + next.index : undefined);
}

function parseJsonObjectFromOutput(output: string) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(output.slice(start, end + 1));
    return objectRecord(value);
  } catch {
    return null;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
