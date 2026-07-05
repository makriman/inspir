import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { CLOUDFLARE_ACCOUNT_ID, cloudflareDir, resolveBackupDir } from "./migration-config";
import { validateDnsPlanAndApplyEvidence } from "./dns-cutover-evidence";
import {
  cloudflareApiTokenInstructions,
  cloudflareApiTokenSourceLabel,
  readCloudflareApiToken,
} from "./cloudflare-api-token";

type Check = {
  name: string;
  status: "pass" | "fail";
  detail?: unknown;
};

type CloudflareListResponse<T> = {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T[];
  result_info?: {
    page?: number;
    per_page?: number;
    total_pages?: number;
  };
};

type Zone = {
  id: string;
  name: string;
  status?: string;
  account?: { id?: string; name?: string };
  name_servers?: string[];
  original_name_servers?: string[];
};

type DnsRecord = {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
};

type ReviewedDnsAction = {
  fingerprint?: string;
  record?: {
    id?: string;
    name?: string;
    type?: string;
    content?: string;
  };
};

type DnsCutoverPlanReport = {
  apply?: boolean;
  ok?: boolean;
  planFingerprint?: string;
  plannedActions?: ReviewedDnsAction[];
};

type DnsCutoverApplyReport = {
  apply?: boolean;
  ok?: boolean;
  reviewedPlanFingerprint?: string;
  preApplyFingerprint?: string;
  planFingerprint?: string;
  appliedActions?: Array<{
    record?: { id?: string; name?: string };
    reviewedFingerprint?: string;
    currentFingerprint?: string;
    beforeDeleteFingerprint?: string;
  }>;
};

const DOMAIN = "inspirlearning.com";
const HOSTNAMES = [DOMAIN, `www.${DOMAIN}`];
const MAX_REPORT_AGE_MS = 60 * 60 * 1000;
const backupDir = resolveBackupDir();
const outputPath = path.join(cloudflareDir(backupDir), "dns-cutover-report.json");
const apiTokenCredential = readCloudflareApiToken();
const apiToken = apiTokenCredential.token;
const checks: Check[] = [];

void main().catch((error) => {
  fail("DNS cutover verifier runtime", error instanceof Error ? error.message : String(error));
  writeReport();
  process.exitCode = 1;
});

async function main() {
  checkReviewedApplyEvidence();
  await checkPublicNameservers();
  await checkPublicHostnames();
  await checkCloudflareZoneInventory();

  const ok = writeReport();
  if (!ok) process.exitCode = 1;
}

async function checkPublicNameservers() {
  try {
    const nameservers = await dns.resolveNs(DOMAIN);
    const cloudflareNameservers = nameservers.filter((name) => name.toLowerCase().endsWith(".ns.cloudflare.com"));
    if (cloudflareNameservers.length >= 2) {
      pass("public nameservers use Cloudflare", { nameservers });
    } else {
      fail("public nameservers use Cloudflare", { nameservers });
    }
  } catch (error) {
    fail("public nameservers use Cloudflare", error instanceof Error ? error.message : String(error));
  }
}

async function checkPublicHostnames() {
  for (const hostname of HOSTNAMES) {
    await checkDnsResolution(hostname);
    await checkHttpEdge(hostname);
  }
}

async function checkDnsResolution(hostname: string) {
  const result: { a?: string[]; aaaa?: string[]; cname?: string[] } = {};
  try {
    result.a = await dns.resolve4(hostname);
  } catch {
    result.a = [];
  }
  try {
    result.aaaa = await dns.resolve6(hostname);
  } catch {
    result.aaaa = [];
  }
  try {
    result.cname = await dns.resolveCname(hostname);
  } catch {
    result.cname = [];
  }

  const flattened = [...(result.a ?? []), ...(result.aaaa ?? []), ...(result.cname ?? [])];
  if (flattened.length) pass(`public DNS resolves ${hostname}`, result);
  else fail(`public DNS resolves ${hostname}`, result);

  const vercelTargets = flattened.filter((value) => value.toLowerCase().includes("vercel"));
  if (vercelTargets.length) fail(`public DNS target is not Vercel for ${hostname}`, { vercelTargets, result });
  else pass(`public DNS target is not Vercel for ${hostname}`, result);
}

async function checkHttpEdge(hostname: string) {
  const url = `https://${hostname}/`;
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const headers = Object.fromEntries([...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    const server = headers.server ?? "";
    const vercelHeaders = Object.keys(headers).filter((header) => header.startsWith("x-vercel"));
    const cloudflareEdge = server.toLowerCase().includes("cloudflare") || Boolean(headers["cf-ray"]);

    if (response.status >= 200 && response.status < 400) pass(`HTTP status ${hostname}`, { status: response.status, url });
    else fail(`HTTP status ${hostname}`, { status: response.status, url });

    if (cloudflareEdge) pass(`HTTP served through Cloudflare ${hostname}`, { server, cfRay: headers["cf-ray"] ?? null });
    else fail(`HTTP served through Cloudflare ${hostname}`, { server, cfRay: headers["cf-ray"] ?? null });

    if (!vercelHeaders.length) pass(`HTTP not served by Vercel ${hostname}`, { server });
    else fail(`HTTP not served by Vercel ${hostname}`, { server, vercelHeaders });
  } catch (error) {
    fail(`HTTP served through Cloudflare ${hostname}`, error instanceof Error ? error.message : String(error));
  }
}

async function checkCloudflareZoneInventory() {
  if (!apiToken) {
    fail("Cloudflare API DNS inventory", {
      error: apiTokenCredential.error,
      instructions: cloudflareApiTokenInstructions(),
    });
    return;
  }

  const zones = await cloudflareList<Zone>("/zones", {
    name: DOMAIN,
    "account.id": CLOUDFLARE_ACCOUNT_ID,
    per_page: "50",
  });
  const zone = zones.find((candidate) => candidate.name === DOMAIN);
  if (!zone) {
    fail("Cloudflare zone inventory", { expectedZone: DOMAIN, zones: redactZones(zones) });
    return;
  }

  if (zone.status === "active") pass("Cloudflare zone active", redactZone(zone));
  else fail("Cloudflare zone active", redactZone(zone));

  const records = await cloudflareList<DnsRecord>(`/zones/${zone.id}/dns_records`, { per_page: "100" });
  const hostnameRecords = records.filter((record) => HOSTNAMES.includes(record.name));
  checkReviewedRecordsRemoved(hostnameRecords);
  fs.writeFileSync(
    path.join(cloudflareDir(backupDir), "cloudflare-dns-records-inventory.json"),
    `${JSON.stringify({ createdAt: new Date().toISOString(), zone: redactZone(zone), records: hostnameRecords }, null, 2)}\n`,
    { mode: 0o600 },
  );

  for (const hostname of HOSTNAMES) {
    const matches = hostnameRecords.filter((record) => record.name === hostname);
    if (matches.length) pass(`Cloudflare DNS records exist for ${hostname}`, redactRecords(matches));
    else fail(`Cloudflare DNS records exist for ${hostname}`, { hostname });

    const unproxied = matches.filter((record) => record.proxied === false && ["A", "AAAA", "CNAME"].includes(record.type));
    if (!unproxied.length) pass(`Cloudflare DNS records are proxied for ${hostname}`, redactRecords(matches));
    else fail(`Cloudflare DNS records are proxied for ${hostname}`, redactRecords(unproxied));

    const vercelRecords = matches.filter((record) => record.content.toLowerCase().includes("vercel"));
    if (!vercelRecords.length) pass(`Cloudflare DNS records do not target Vercel for ${hostname}`);
    else fail(`Cloudflare DNS records do not target Vercel for ${hostname}`, redactRecords(vercelRecords));
  }
}

function checkReviewedApplyEvidence() {
  const provenance = validateDnsPlanAndApplyEvidence(backupDir, { maxAgeMs: MAX_REPORT_AGE_MS });
  if (!provenance.ok) {
    fail("DNS plan/apply evidence provenance", { blockers: provenance.blockers });
    return;
  }

  const plan = readReviewedPlan();
  const applyReport = readJsonIfExists<DnsCutoverApplyReport>("dns-cutover-apply-report.json");
  if (!plan) {
    fail("reviewed DNS dry-run plan evidence", {
      missing: ["cloudflare/dns-cutover-dry-run-plan.json", "cloudflare/dns-cutover-plan.json"],
    });
    return;
  }
  if (plan.apply !== false || plan.ok !== true || !plan.planFingerprint) {
    fail("reviewed DNS dry-run plan evidence", { apply: plan.apply, ok: plan.ok, planFingerprint: plan.planFingerprint });
    return;
  }
  pass("reviewed DNS dry-run plan evidence", { planFingerprint: plan.planFingerprint });

  if (!applyReport) {
    fail("DNS apply report evidence", { missing: "cloudflare/dns-cutover-apply-report.json" });
    return;
  }

  const plannedById = new Map((plan.plannedActions ?? []).map((action) => [action.record?.id, action]));
  const appliedById = new Map((applyReport.appliedActions ?? []).map((action) => [action.record?.id, action]));
  const plannedIds = [...plannedById.keys()].filter((id): id is string => Boolean(id)).sort();
  const appliedIds = [...appliedById.keys()].filter((id): id is string => Boolean(id)).sort();
  const missingApplied = plannedIds.filter((id) => !appliedById.has(id));
  const unexpectedApplied = appliedIds.filter((id) => !plannedById.has(id));
  const fingerprintMismatches = plannedIds.filter((id) => {
    const planned = plannedById.get(id);
    const applied = appliedById.get(id);
    return (
      !planned?.fingerprint ||
      applied?.reviewedFingerprint !== planned.fingerprint ||
      applied?.currentFingerprint !== planned.fingerprint ||
      applied?.beforeDeleteFingerprint !== planned.fingerprint
    );
  });

  if (
    applyReport.apply === true &&
    applyReport.ok === true &&
    applyReport.reviewedPlanFingerprint === plan.planFingerprint &&
    applyReport.preApplyFingerprint === plan.planFingerprint &&
    applyReport.planFingerprint === plan.planFingerprint &&
    !missingApplied.length &&
    !unexpectedApplied.length &&
    !fingerprintMismatches.length
  ) {
    pass("DNS apply report matches reviewed plan", { planFingerprint: plan.planFingerprint, deletedRecordIds: plannedIds });
  } else {
    fail("DNS apply report matches reviewed plan", {
      apply: applyReport.apply,
      ok: applyReport.ok,
      expectedFingerprint: plan.planFingerprint,
      reviewedPlanFingerprint: applyReport.reviewedPlanFingerprint,
      preApplyFingerprint: applyReport.preApplyFingerprint,
      applyFingerprint: applyReport.planFingerprint,
      missingApplied,
      unexpectedApplied,
      fingerprintMismatches,
    });
  }
}

function checkReviewedRecordsRemoved(hostnameRecords: DnsRecord[]) {
  const plan = readReviewedPlan();
  if (!plan?.plannedActions?.length) {
    pass("reviewed DNS records were removed", { removedRecordIds: [] });
    return;
  }
  const liveIds = new Set(hostnameRecords.map((record) => record.id));
  const stillPresent = plan.plannedActions
    .map((action) => action.record?.id)
    .filter((id): id is string => typeof id === "string" && liveIds.has(id));
  if (stillPresent.length) {
    fail("reviewed DNS records were removed", { stillPresent });
  } else {
    pass("reviewed DNS records were removed", {
      removedRecordIds: plan.plannedActions.map((action) => action.record?.id).filter((id): id is string => typeof id === "string"),
    });
  }
}

function readReviewedPlan() {
  return (
    readJsonIfExists<DnsCutoverPlanReport>("dns-cutover-dry-run-plan.json") ??
    readJsonIfExists<DnsCutoverPlanReport>("dns-cutover-plan.json")
  );
}

function readJsonIfExists<T>(fileName: string) {
  const filePath = path.join(cloudflareDir(backupDir), fileName);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

async function cloudflareList<T>(pathName: string, params: Record<string, string>) {
  const results: T[] = [];
  let page = 1;
  for (;;) {
    const search = new URLSearchParams({ ...params, page: String(page) });
    const response = await fetch(`https://api.cloudflare.com/client/v4${pathName}?${search}`, {
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json()) as CloudflareListResponse<T>;
    if (!response.ok || !payload.success) {
      throw new Error(
        `Cloudflare API request failed for ${pathName}: ${JSON.stringify({
          status: response.status,
          errors: payload.errors ?? [],
        })}`,
      );
    }
    results.push(...payload.result);
    const totalPages = payload.result_info?.total_pages ?? 1;
    if (page >= totalPages) return results;
    page += 1;
  }
}

function redactZone(zone: Zone) {
  return {
    id: zone.id,
    name: zone.name,
    status: zone.status,
    accountId: zone.account?.id,
    accountName: zone.account?.name,
    nameServers: zone.name_servers,
    originalNameServers: zone.original_name_servers,
  };
}

function redactZones(zones: Zone[]) {
  return zones.map(redactZone);
}

function redactRecords(records: DnsRecord[]) {
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    type: record.type,
    content: record.content,
    proxied: record.proxied,
    ttl: record.ttl,
  }));
}

function writeReport() {
  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    domain: DOMAIN,
    credentialSource: cloudflareApiTokenSourceLabel(apiTokenCredential.source),
    ok: failed.length === 0,
    failedChecks: failed.length,
    checks,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  return report.ok;
}

function pass(name: string, detail?: unknown) {
  checks.push({ name, status: "pass", detail });
}

function fail(name: string, detail?: unknown) {
  checks.push({ name, status: "fail", detail });
}
