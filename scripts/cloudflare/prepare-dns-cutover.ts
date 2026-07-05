import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CLOUDFLARE_ACCOUNT_ID, cloudflareDir, hasFlag, resolveBackupDir, stableStringify } from "./migration-config";
import { assertFreshBackupScopedReport, type BackupScopedGateReport } from "./fresh-report-gate";
import { backupDirConfirmationBlocker } from "./destructive-confirmations";
import {
  cloudflareApiTokenInstructions,
  cloudflareApiTokenSourceLabel,
  readCloudflareApiToken,
} from "./cloudflare-api-token";

type CloudflareListResponse<T> = {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T[];
  result_info?: { total_pages?: number };
};

type CloudflareSingleResponse<T> = {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T;
};

type Zone = {
  id: string;
  name: string;
  status?: string;
  account?: { id?: string; name?: string };
  name_servers?: string[];
};

type DnsRecord = {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
  modified_on?: string;
  comment?: string | null;
  tags?: string[];
  settings?: Record<string, unknown>;
};

type PlannedAction = {
  action: "delete";
  reason: string;
  record: DnsRecord;
};

type ReviewedPlanAction = {
  fingerprint?: string;
  record?: { id?: string };
};

type DnsCutoverPlanReport = {
  apply?: boolean;
  ok?: boolean;
  planFingerprint?: string;
  plannedActions?: ReviewedPlanAction[];
};

const DOMAIN = "inspirlearning.com";
const GATE_VERSION = 2;
const MAX_REPORT_AGE_MS = 60 * 60 * 1000;
const HOSTNAMES = [DOMAIN, `www.${DOMAIN}`];
const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const apiTokenCredential = readCloudflareApiToken();
const apiToken = apiTokenCredential.token;
const apply = hasFlag("--apply");

void main().catch((error) => {
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    domain: DOMAIN,
    gateVersion: GATE_VERSION,
    apply,
    ok: false,
    zone: null,
    planFingerprint: null,
    plannedActions: [],
    error: error instanceof Error ? error.message : String(error),
    credentialSource: cloudflareApiTokenSourceLabel(apiTokenCredential.source),
    confirmationsRequiredForApply: apply ? undefined : { cloudflareApiToken: cloudflareApiTokenInstructions() },
  };
  if (apply) writeDnsReport("dns-cutover-apply-report.json", report);
  else {
    writeDnsReport("dns-cutover-dry-run-plan.json", report);
    writeDnsReport("dns-cutover-plan.json", report);
  }
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});

async function main() {
  if (!apiToken) throw new Error(apiTokenCredential.error ?? "Set a Cloudflare API token before preparing DNS cutover.");
  if (apply) checkApplyConfirmations();
  const reviewedPlan = apply ? readReviewedDryRunPlan() : null;

  const zone = await findZone();
  if (zone.status !== "active") throw new Error(`Cloudflare zone ${DOMAIN} is not active; current status: ${zone.status ?? "unknown"}`);

  const records = await cloudflareList<DnsRecord>(`/zones/${zone.id}/dns_records`, { per_page: "100" });
  const hostnameRecords = records.filter((record) => HOSTNAMES.includes(record.name));
  const plannedActions = planActions(hostnameRecords);
  const planFingerprint = fingerprintPlan(zone, plannedActions);
  if (apply) verifyReviewedPlan(reviewedPlan, planFingerprint);

  const inventory = {
    createdAt: new Date().toISOString(),
    zone: redactZone(zone),
    records: redactRecords(hostnameRecords),
  };
  fs.writeFileSync(path.join(cfDir, "dns-pre-cutover-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600 });

  const appliedActions = apply ? await applyActions(zone, plannedActions, reviewedPlan) : [];
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    domain: DOMAIN,
    gateVersion: GATE_VERSION,
    zone: redactZone(zone),
    apply,
    ok: !apply || appliedActions.length === plannedActions.length,
    credentialSource: cloudflareApiTokenSourceLabel(apiTokenCredential.source),
    planFingerprint,
    reviewedPlanFingerprint: apply ? reviewedPlan?.planFingerprint : undefined,
    preApplyFingerprint: apply ? planFingerprint : undefined,
    plannedActions: plannedActions.map((action) =>
      plannedActionSnapshot(action, { fingerprint: fingerprintAction(zone, action) }),
    ),
    appliedActions,
    confirmationsRequiredForApply: apply ? undefined : { CONFIRM_DNS_PLAN_FINGERPRINT: planFingerprint },
    nextStep: apply
      ? "Run CONFIRM_WRITE_FREEZE=1 REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 pnpm cf:deploy immediately so Worker custom-domain records can be created."
      : "Dry run only. Re-run with --apply plus confirmations after production preflight is clean and you are ready to deploy Worker custom domains immediately.",
  };
  if (apply) writeDnsReport("dns-cutover-apply-report.json", report);
  else {
    writeDnsReport("dns-cutover-dry-run-plan.json", report);
    writeDnsReport("dns-cutover-plan.json", report);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

function checkApplyConfirmations() {
  const productionPreflight = readReport("production-preflight-report.json");
  const backupDirBlocker = backupDirConfirmationBlocker(backupDir);
  const required = {
    CONFIRM_DNS_CUTOVER: "1",
    CONFIRM_WRITE_FREEZE: "1",
    CONFIRM_WORKER_CUSTOM_DOMAIN_DEPLOY: "1",
    REQUIRE_LIVE_AI: "1",
    E2E_GOOGLE_IS_ADMIN: "1",
  };
  const missing = Object.entries(required)
    .filter(([key, expected]) => process.env[key] !== expected)
    .map(([key]) => key);
  if (backupDirBlocker) missing.push(backupDirBlocker);
  if (missing.length) throw new Error(`Missing DNS cutover confirmations: ${missing.join(", ")}`);
  assertFreshBackupScopedReport({
    relativePath: "cloudflare/production-preflight-report.json",
    report: productionPreflight,
    backupDir,
    maxAgeMs: MAX_REPORT_AGE_MS,
    requireOk: true,
    action: "DNS cutover",
  });
  checkWorkerCustomDomainConfig();
}

function readReviewedDryRunPlan() {
  const filePath = fs.existsSync(path.join(cfDir, "dns-cutover-dry-run-plan.json"))
    ? path.join(cfDir, "dns-cutover-dry-run-plan.json")
    : path.join(cfDir, "dns-cutover-plan.json");
  if (!fs.existsSync(filePath)) {
    throw new Error("Missing reviewed dry-run plan: run pnpm cf:dns:prepare-cutover before --apply.");
  }
  const report = JSON.parse(fs.readFileSync(filePath, "utf8")) as DnsCutoverPlanReport;
  if (report.apply !== false || report.ok !== true || !report.planFingerprint) {
    throw new Error("Refusing DNS cutover because the reviewed dry-run plan is not clean.");
  }
  return report;
}

function verifyReviewedPlan(reviewedPlan: DnsCutoverPlanReport | null, currentFingerprint: string) {
  const expectedFingerprint = reviewedPlan?.planFingerprint;
  if (!expectedFingerprint) throw new Error("Missing reviewed DNS cutover plan fingerprint.");
  if (process.env.CONFIRM_DNS_PLAN_FINGERPRINT !== expectedFingerprint) {
    throw new Error("Missing or incorrect CONFIRM_DNS_PLAN_FINGERPRINT for reviewed DNS cutover plan.");
  }
  if (currentFingerprint !== expectedFingerprint) {
    throw new Error("Refusing DNS cutover because live DNS records drifted after the reviewed dry-run plan.");
  }
}

function readReport(fileName: string) {
  const filePath = path.join(cfDir, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`Missing required report: cloudflare/${fileName}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as BackupScopedGateReport;
}

function checkWorkerCustomDomainConfig() {
  const configPath = path.resolve(process.cwd(), "wrangler.jsonc");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    routes?: Array<{ pattern?: string; custom_domain?: boolean }>;
  };
  const routes = config.routes ?? [];
  const missing = HOSTNAMES.filter(
    (hostname) => !routes.some((route) => route.pattern === hostname && route.custom_domain === true),
  );
  if (missing.length) {
    throw new Error(`Refusing DNS cutover because wrangler.jsonc is missing Worker Custom Domain routes: ${missing.join(", ")}`);
  }
}

async function findZone() {
  const zones = await cloudflareList<Zone>("/zones", {
    name: DOMAIN,
    "account.id": CLOUDFLARE_ACCOUNT_ID,
    per_page: "50",
  });
  const zone = zones.find((candidate) => candidate.name === DOMAIN);
  if (!zone) throw new Error(`Could not find Cloudflare zone for ${DOMAIN} in account ${CLOUDFLARE_ACCOUNT_ID}`);
  return zone;
}

function planActions(records: DnsRecord[]): PlannedAction[] {
  const actions: PlannedAction[] = [];
  for (const record of records) {
    const typeCanAffectHttp = ["A", "AAAA", "CNAME"].includes(record.type);
    if (!typeCanAffectHttp) continue;

    if (record.content.toLowerCase().includes("vercel")) {
      actions.push({ action: "delete", reason: "record targets Vercel", record });
      continue;
    }

    if (record.proxied === false) {
      actions.push({ action: "delete", reason: "record is DNS-only and bypasses Cloudflare Workers", record });
      continue;
    }

    if (record.name === `www.${DOMAIN}` && record.type === "CNAME") {
      actions.push({ action: "delete", reason: "existing CNAME can block Worker Custom Domain attachment", record });
    }
  }
  return uniqueActions(actions);
}

function uniqueActions(actions: PlannedAction[]) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.record.id)) return false;
    seen.add(action.record.id);
    return true;
  });
}

function fingerprintPlan(zone: Zone, actions: PlannedAction[]) {
  return fingerprintPayload({
    gateVersion: GATE_VERSION,
    domain: DOMAIN,
    zone: zoneSnapshot(zone),
    plannedActions: actions
      .map((action) => plannedActionSnapshot(action))
      .sort((left, right) => `${left.record.id}:${left.reason}`.localeCompare(`${right.record.id}:${right.reason}`)),
  });
}

function fingerprintAction(zone: Zone, action: PlannedAction) {
  return fingerprintPayload({
    gateVersion: GATE_VERSION,
    domain: DOMAIN,
    zone: zoneSnapshot(zone),
    action: plannedActionSnapshot(action),
  });
}

function fingerprintPayload(payload: unknown) {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function plannedActionSnapshot(action: PlannedAction, options: { fingerprint?: string } = {}) {
  const snapshot = {
    action: action.action,
    reason: action.reason,
    record: redactRecord(action.record),
  };
  return options.fingerprint ? { ...snapshot, fingerprint: options.fingerprint } : snapshot;
}

function actionFingerprintFromReviewed(action: ReviewedPlanAction | undefined) {
  return typeof action?.fingerprint === "string" ? action.fingerprint : "";
}

function reviewedActionById(reviewedPlan: DnsCutoverPlanReport | null) {
  const byId = new Map<string, ReviewedPlanAction>();
  for (const action of reviewedPlan?.plannedActions ?? []) {
    const id = action.record?.id;
    if (id) byId.set(id, action);
  }
  return byId;
}

async function applyActions(zone: Zone, actions: PlannedAction[], reviewedPlan: DnsCutoverPlanReport | null) {
  const applied = [];
  const reviewedById = reviewedActionById(reviewedPlan);
  for (const action of actions) {
    const reviewed = reviewedById.get(action.record.id);
    if (!reviewed) throw new Error(`Reviewed DNS plan is missing record ${action.record.id}`);

    const liveRecord = await cloudflareRequest<DnsRecord>(`/zones/${zone.id}/dns_records/${action.record.id}`);
    const liveAction = { ...action, record: liveRecord };
    const beforeDeleteFingerprint = fingerprintAction(zone, liveAction);
    const reviewedFingerprint = actionFingerprintFromReviewed(reviewed);
    const currentFingerprint = fingerprintAction(zone, action);

    if (beforeDeleteFingerprint !== reviewedFingerprint || currentFingerprint !== reviewedFingerprint) {
      throw new Error(
        `Refusing DNS delete for ${action.record.name} (${action.record.id}) because the live record no longer matches the reviewed dry-run fingerprint.`,
      );
    }

    const response = await cloudflareRequest<unknown>(`/zones/${zone.id}/dns_records/${action.record.id}`, {
      method: "DELETE",
    });
    applied.push({
      action: action.action,
      reason: action.reason,
      record: redactRecord(liveRecord),
      reviewedFingerprint,
      currentFingerprint,
      beforeDeleteFingerprint,
      result: response,
    });
  }
  return applied;
}

function zoneSnapshot(zone: Zone) {
  return {
    id: zone.id,
    name: zone.name,
    accountId: zone.account?.id,
  };
}

function redactZone(zone: Zone) {
  return {
    id: zone.id,
    name: zone.name,
    status: zone.status,
    accountId: zone.account?.id,
    accountName: zone.account?.name,
    nameServers: zone.name_servers,
  };
}

function redactRecords(records: DnsRecord[]) {
  return records.map(redactRecord);
}

function redactRecord(record: DnsRecord) {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    content: record.content,
    proxied: record.proxied,
    ttl: record.ttl,
    modifiedOn: record.modified_on,
    comment: record.comment ?? null,
    tags: record.tags ?? [],
    settings: record.settings ?? {},
  };
}

function writeDnsReport(fileName: string, report: Record<string, unknown>) {
  fs.writeFileSync(path.join(cfDir, fileName), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
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

async function cloudflareRequest<T>(pathName: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiToken}`);
  headers.set("content-type", "application/json");
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathName}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as CloudflareSingleResponse<T> | T;
  if (!response.ok || (typeof payload === "object" && payload && "success" in payload && !payload.success)) {
    const errors = typeof payload === "object" && payload && "errors" in payload ? payload.errors : [];
    throw new Error(`Cloudflare API request failed for ${pathName}: ${JSON.stringify({ status: response.status, errors })}`);
  }
  if (typeof payload === "object" && payload && "success" in payload && "result" in payload) {
    return payload.result as T;
  }
  return payload as T;
}
