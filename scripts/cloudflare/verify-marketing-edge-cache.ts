import fs from "node:fs";
import path from "node:path";
import { cloudflareDir, hasFlag, resolveBackupDir } from "./migration-config";
import { CLOUDFLARE_TOKEN_DOMAIN } from "./cloudflare-api-token";

type ProbeResult = {
  label: string;
  url: string;
  status: number;
  ok: boolean;
  cfCacheStatus: string | null;
  age: string | null;
  cacheControl: string | null;
  vary: string | null;
  setCookie: string | null;
  contentType: string | null;
};

type TargetReport = {
  label: string;
  path: string;
  probes: ProbeResult[];
  passed: boolean;
  reason?: string;
};

const productionOrigin = process.env.MARKETING_EDGE_CACHE_ORIGIN?.trim() || `https://${CLOUDFLARE_TOKEN_DOMAIN}`;
const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const outputPath = path.join(cfDir, "marketing-edge-cache-report.json");
const cacheEligibleStatuses = new Set(["HIT", "MISS", "EXPIRED", "REVALIDATED", "STALE", "UPDATING"]);
const strict = hasFlag("--strict");

const targets = [
  { label: "homepage", path: "/" },
  { label: "localized homepage", path: "/hi" },
  { label: "blog post", path: "/blog/ai-learn-anything-guide" },
] as const;

void main().catch((error) => {
  writeReport({
    ok: false,
    strict,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

async function main() {
  const targetReports = await Promise.all(targets.map((target) => verifyTarget(target.label, target.path)));
  const resetPasswordProbe = await probe("reset password no-store boundary", "/reset_pw");
  const cookieProbe = await probe("cookie bypass homepage", "/", { cookie: "better-auth.session_token=edge-cache-probe" });
  const resetPasswordPassed = resetPasswordProbe.cacheControl?.includes("no-store") === true;
  const cookieBypassPassed = !isCacheEligible(cookieProbe.cfCacheStatus);
  const ok = targetReports.every((report) => report.passed) && resetPasswordPassed && cookieBypassPassed;

  writeReport({
    ok,
    strict,
    origin: productionOrigin,
    targets: targetReports,
    resetPasswordProbe,
    resetPasswordPassed,
    cookieProbe,
    cookieBypassPassed,
  });

  console.log(
    JSON.stringify(
      {
        ok,
        strict,
        outputPath,
        targets: targetReports.map((report) => ({
          label: report.label,
          passed: report.passed,
          statuses: report.probes.map((probeResult) => probeResult.cfCacheStatus),
          ages: report.probes.map((probeResult) => probeResult.age),
          reason: report.reason ?? null,
        })),
        resetPasswordPassed,
        cookieBypassPassed,
      },
      null,
      2,
    ),
  );

  if (!ok) process.exitCode = 1;
}

async function verifyTarget(label: string, pathname: string): Promise<TargetReport> {
  const query = `utm_source=codex-edge-cache-probe-${Date.now()}`;
  const probes = [
    await probe(`${label} warm`, pathname),
    await probe(`${label} repeat`, pathname),
    await probe(`${label} query warm`, `${pathname}?${query}`),
    await probe(`${label} query repeat`, `${pathname}?${query}`),
  ];
  const repeatProbes = [probes[1], probes[3]];
  const repeatedStatusesEligible = repeatProbes.every((probeResult) => isCacheEligible(probeResult.cfCacheStatus));
  const repeatedHits = repeatProbes.filter((probeResult) => probeResult.cfCacheStatus === "HIT");
  const hitsHaveAge = repeatedHits.every((probeResult) => typeof probeResult.age === "string" && probeResult.age.length > 0);
  const passed = repeatedStatusesEligible && (!strict || (repeatedHits.length > 0 && hitsHaveAge));

  return {
    label,
    path: pathname,
    probes,
    passed,
    reason: passed
      ? undefined
      : strict
        ? "Repeat probes must expose cache statuses and at least one repeat HIT with Age."
        : "Repeat probes must expose Cloudflare cache statuses; missing status means the Cache Rule is not active.",
  };
}

async function probe(label: string, pathOrUrl: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : new URL(pathOrUrl, productionOrigin).toString();
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "inspir-marketing-edge-cache-probe/1.0",
      ...headers,
    },
    signal: AbortSignal.timeout(20_000),
  });

  return {
    label,
    url,
    status: response.status,
    ok: response.ok,
    cfCacheStatus: normalizeHeader(response.headers.get("cf-cache-status")),
    age: normalizeHeader(response.headers.get("age")),
    cacheControl: normalizeHeader(response.headers.get("cache-control")),
    vary: normalizeHeader(response.headers.get("vary")),
    setCookie: normalizeHeader(response.headers.get("set-cookie")),
    contentType: normalizeHeader(response.headers.get("content-type")),
  };
}

function isCacheEligible(value: string | null) {
  return value ? cacheEligibleStatuses.has(value.toUpperCase()) : false;
}

function normalizeHeader(value: string | null) {
  return value && value.length > 0 ? value : null;
}

function writeReport(report: Record<string, unknown>) {
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        ...report,
      },
      null,
      2,
    )}\n`,
  );
}
