import fs from "node:fs";
import path from "node:path";
import { CLOUDFLARE_ACCOUNT_ID } from "./migration-config";
import { freshBackupScopedReportBlockers, type BackupScopedGateReport } from "./fresh-report-gate";

const DOMAIN = "inspirlearning.com";
const HOSTNAMES = [DOMAIN, `www.${DOMAIN}`] as const;
const DNS_GATE_VERSION = 2;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const HTTP_DNS_TYPES = new Set(["A", "AAAA", "CNAME"]);

export const DNS_CUTOVER_DRY_RUN_REPORT = "cloudflare/dns-cutover-dry-run-plan.json";
export const DNS_CUTOVER_LEGACY_PLAN_REPORT = "cloudflare/dns-cutover-plan.json";
export const DNS_CUTOVER_APPLY_REPORT = "cloudflare/dns-cutover-apply-report.json";
export const DNS_CUTOVER_VERIFY_REPORT = "cloudflare/dns-cutover-report.json";
export const DNS_PUBLIC_CUTOVER_REPORT = "cloudflare/dns-public-cutover-report.json";

export type DnsCutoverCheck = {
  name?: string;
  status?: string;
  detail?: unknown;
};

export type DnsCutoverPlanReport = BackupScopedGateReport & {
  domain?: string;
  apply?: boolean;
  gateVersion?: number;
  planFingerprint?: string;
  zone?: {
    name?: string;
    status?: string;
    accountId?: string;
  } | null;
  plannedActions?: Array<{
    action?: string;
    reason?: string;
    fingerprint?: string;
    record?: { id?: string; name?: string; type?: string; content?: string };
  }>;
  error?: string;
};

export type DnsCutoverApplyReport = DnsCutoverPlanReport & {
  reviewedPlanFingerprint?: string;
  preApplyFingerprint?: string;
  appliedActions?: Array<{
    record?: { id?: string; name?: string };
    reviewedFingerprint?: string;
    currentFingerprint?: string;
    beforeDeleteFingerprint?: string;
  }>;
};

export type DnsCutoverVerifyReport = BackupScopedGateReport & {
  domain?: string;
  failedChecks?: number;
  checks?: DnsCutoverCheck[];
};

export type DnsPublicCutoverReport = DnsCutoverVerifyReport & {
  mode?: string;
};

export function validateDnsPlanAndApplyEvidence(
  backupDir: string,
  options: { maxAgeMs: number; nowMs?: number; requireApply?: boolean },
) {
  const blockers: string[] = [];
  const preferredPlan = readJson<DnsCutoverPlanReport>(backupDir, DNS_CUTOVER_DRY_RUN_REPORT);
  const legacyPlan = readJson<DnsCutoverPlanReport>(backupDir, DNS_CUTOVER_LEGACY_PLAN_REPORT);
  const plan = preferredPlan ?? legacyPlan;
  const planPath = preferredPlan ? DNS_CUTOVER_DRY_RUN_REPORT : DNS_CUTOVER_LEGACY_PLAN_REPORT;

  if (!plan) {
    blockers.push(`${DNS_CUTOVER_DRY_RUN_REPORT} is missing or unreadable`);
    return {
      ok: false,
      blockers,
      plan: null,
      apply: null,
      planPath: DNS_CUTOVER_DRY_RUN_REPORT,
      planFingerprint: null,
    };
  }

  blockers.push(
    ...freshBackupScopedReportBlockers({
      relativePath: planPath,
      report: plan,
      backupDir,
      maxAgeMs: options.maxAgeMs,
      nowMs: options.nowMs,
      requireOk: true,
    }),
    ...dnsDryRunReportProblems(plan),
    ...dnsDryRunActionProblems(plan).map((problem) => `${planPath}: ${problem.problem} at action ${problem.index}`),
    ...dnsDryRunConsistencyProblems(backupDir, preferredPlan, legacyPlan),
  );

  if (options.requireApply === false) {
    return {
      ok: blockers.length === 0,
      blockers,
      plan,
      apply: null,
      planPath,
      planFingerprint: plan.planFingerprint ?? null,
    };
  }

  const apply = readJson<DnsCutoverApplyReport>(backupDir, DNS_CUTOVER_APPLY_REPORT);
  if (!apply) {
    blockers.push(`${DNS_CUTOVER_APPLY_REPORT} is missing or unreadable`);
    return {
      ok: false,
      blockers,
      plan,
      apply: null,
      planPath,
      planFingerprint: plan.planFingerprint ?? null,
    };
  }

  blockers.push(
    ...freshBackupScopedReportBlockers({
      relativePath: DNS_CUTOVER_APPLY_REPORT,
      report: apply,
      backupDir,
      maxAgeMs: options.maxAgeMs,
      nowMs: options.nowMs,
      requireOk: true,
    }),
    ...dnsApplyReportProblems(plan, apply),
  );

  return {
    ok: blockers.length === 0,
    blockers,
    plan,
    apply,
    planPath,
    planFingerprint: plan.planFingerprint ?? null,
  };
}

export function validateDnsCutoverEvidence(
  backupDir: string,
  options: { maxAgeMs: number; nowMs?: number },
) {
  const planApply = validateDnsPlanAndApplyEvidence(backupDir, options);
  const report = readJson<DnsCutoverVerifyReport>(backupDir, DNS_CUTOVER_VERIFY_REPORT);
  const publicDns = validatePublicDnsCutoverEvidence(backupDir, options);
  const blockers = [...planApply.blockers];

  if (!report) {
    blockers.push(`${DNS_CUTOVER_VERIFY_REPORT} is missing or unreadable`);
    if (publicDns.ok) return { ok: true, blockers: [], planApply, report: null, publicDns, mode: "manual-public-dns" as const };
    blockers.push(...publicDns.blockers);
    return { ok: false, blockers, planApply, report: null, publicDns, mode: "api-dns" as const };
  }

  blockers.push(
    ...freshBackupScopedReportBlockers({
      relativePath: DNS_CUTOVER_VERIFY_REPORT,
      report,
      backupDir,
      maxAgeMs: options.maxAgeMs,
      nowMs: options.nowMs,
      requireOk: true,
    }),
    ...dnsVerifyReportProblems(report),
  );

  if (blockers.length === 0) return { ok: true, blockers, planApply, report, publicDns, mode: "api-dns" as const };
  if (publicDns.ok) return { ok: true, blockers: [], planApply, report, publicDns, mode: "manual-public-dns" as const };
  blockers.push(...publicDns.blockers);
  return { ok: false, blockers, planApply, report, publicDns, mode: "api-dns" as const };
}

export function validatePublicDnsCutoverEvidence(
  backupDir: string,
  options: { maxAgeMs: number; nowMs?: number },
) {
  const report = readJson<DnsPublicCutoverReport>(backupDir, DNS_PUBLIC_CUTOVER_REPORT);
  const blockers = [
    ...freshBackupScopedReportBlockers({
      relativePath: DNS_PUBLIC_CUTOVER_REPORT,
      report,
      backupDir,
      maxAgeMs: options.maxAgeMs,
      nowMs: options.nowMs,
      requireOk: true,
    }),
    ...(report ? dnsPublicCutoverReportProblems(report) : []),
  ];
  return { ok: blockers.length === 0, blockers, report };
}

export function dnsDryRunReportProblems(report: DnsCutoverPlanReport) {
  const problems: string[] = [];
  if (report.apply !== false) problems.push("dry-run report apply flag is not false");
  if (report.domain !== DOMAIN) problems.push("domain does not match inspirlearning.com");
  if (report.gateVersion !== DNS_GATE_VERSION) problems.push("unexpected DNS gate version");
  if (report.zone?.name !== DOMAIN) problems.push("zone name does not match inspirlearning.com");
  if (report.zone?.status !== "active") problems.push("zone is not active");
  if (report.zone?.accountId !== CLOUDFLARE_ACCOUNT_ID) problems.push("zone account does not match configured Cloudflare account");
  if (!SHA256_HEX.test(report.planFingerprint ?? "")) problems.push("missing or malformed plan fingerprint");
  if (!Array.isArray(report.plannedActions)) problems.push("plannedActions is not an array");
  return problems;
}

export function dnsDryRunActionProblems(report: DnsCutoverPlanReport) {
  if (!Array.isArray(report.plannedActions)) return [];
  return report.plannedActions.flatMap((action, index) => {
    const problems: string[] = [];
    if (action.action !== "delete") problems.push("unsupported action");
    if (!action.reason) problems.push("missing reason");
    if (!SHA256_HEX.test(action.fingerprint ?? "")) problems.push("missing or malformed fingerprint");
    if (!action.record?.id) problems.push("missing record id");
    if (!action.record?.name || !HOSTNAMES.includes(action.record.name as (typeof HOSTNAMES)[number])) {
      problems.push("record name is not apex or www");
    }
    if (!action.record?.type || !HTTP_DNS_TYPES.has(action.record.type)) problems.push("record type is not HTTP-affecting");
    if (!action.record?.content) problems.push("missing record content");
    return problems.map((problem) => ({ index, record: action.record, problem }));
  });
}

export function dnsApplyReportProblems(plan: DnsCutoverPlanReport, apply: DnsCutoverApplyReport) {
  const problems: string[] = [];
  if (apply.apply !== true) problems.push("apply report apply flag is not true");
  if (apply.domain !== DOMAIN) problems.push("apply report domain does not match inspirlearning.com");
  if (apply.gateVersion !== DNS_GATE_VERSION) problems.push("apply report has unexpected DNS gate version");
  if (apply.reviewedPlanFingerprint !== plan.planFingerprint) problems.push("reviewed plan fingerprint does not match dry run");
  if (apply.preApplyFingerprint !== plan.planFingerprint) problems.push("pre-apply fingerprint does not match dry run");
  if (apply.planFingerprint !== plan.planFingerprint) problems.push("apply fingerprint does not match dry run");
  if (!Array.isArray(apply.appliedActions)) problems.push("appliedActions is not an array");

  const plannedById = new Map((plan.plannedActions ?? []).map((action) => [action.record?.id, action]));
  const appliedById = new Map((apply.appliedActions ?? []).map((action) => [action.record?.id, action]));
  const plannedIds = [...plannedById.keys()].filter((id): id is string => Boolean(id)).sort();
  const appliedIds = [...appliedById.keys()].filter((id): id is string => Boolean(id)).sort();
  const missingApplied = plannedIds.filter((id) => !appliedById.has(id));
  const unexpectedApplied = appliedIds.filter((id) => !plannedById.has(id));
  if (missingApplied.length) problems.push(`apply report is missing planned record ids: ${missingApplied.join(", ")}`);
  if (unexpectedApplied.length) problems.push(`apply report has unexpected record ids: ${unexpectedApplied.join(", ")}`);

  for (const id of plannedIds) {
    const planned = plannedById.get(id);
    const applied = appliedById.get(id);
    if (
      !planned?.fingerprint ||
      applied?.reviewedFingerprint !== planned.fingerprint ||
      applied?.currentFingerprint !== planned.fingerprint ||
      applied?.beforeDeleteFingerprint !== planned.fingerprint
    ) {
      problems.push(`apply report fingerprint mismatch for record id ${id}`);
    }
  }

  return problems;
}

export function dnsVerifyReportProblems(report: DnsCutoverVerifyReport) {
  const problems: string[] = [];
  if (report.domain !== DOMAIN) problems.push("verification report domain does not match inspirlearning.com");
  if (report.failedChecks !== 0) problems.push(`verification report has failed checks: ${report.failedChecks ?? "missing"}`);
  const passed = new Set(
    (report.checks ?? [])
      .filter((check) => check.status === "pass" && typeof check.name === "string")
      .map((check) => check.name as string),
  );
  const failedRequired = new Set(
    (report.checks ?? [])
      .filter((check) => check.status === "fail" && typeof check.name === "string")
      .map((check) => check.name as string),
  );
  for (const check of requiredDnsVerificationChecks()) {
    if (!passed.has(check)) problems.push(`verification report is missing passing check: ${check}`);
    if (failedRequired.has(check)) problems.push(`verification report has failing required check: ${check}`);
  }
  return problems;
}

function requiredDnsVerificationChecks() {
  return [
    "reviewed DNS dry-run plan evidence",
    "DNS apply report matches reviewed plan",
    "public nameservers use Cloudflare",
    "Cloudflare zone active",
    "reviewed DNS records were removed",
    ...HOSTNAMES.flatMap((hostname) => [
      `public DNS resolves ${hostname}`,
      `public DNS target is not Vercel for ${hostname}`,
      `HTTP status ${hostname}`,
      `HTTP served through Cloudflare ${hostname}`,
      `HTTP not served by Vercel ${hostname}`,
      `Cloudflare DNS records exist for ${hostname}`,
      `Cloudflare DNS records are proxied for ${hostname}`,
      `Cloudflare DNS records do not target Vercel for ${hostname}`,
    ]),
  ];
}

export function dnsPublicCutoverReportProblems(report: DnsPublicCutoverReport) {
  const problems: string[] = [];
  if (report.domain !== DOMAIN) problems.push("public DNS report domain does not match inspirlearning.com");
  if (report.mode !== "manual-public-dns") problems.push("public DNS report mode is not manual-public-dns");
  if (report.failedChecks !== 0) problems.push(`public DNS report has failed checks: ${report.failedChecks ?? "missing"}`);
  const passed = new Set(
    (report.checks ?? [])
      .filter((check) => check.status === "pass" && typeof check.name === "string")
      .map((check) => check.name as string),
  );
  const failedRequired = new Set(
    (report.checks ?? [])
      .filter((check) => check.status === "fail" && typeof check.name === "string")
      .map((check) => check.name as string),
  );
  for (const check of requiredPublicDnsVerificationChecks()) {
    if (!passed.has(check)) problems.push(`public DNS report is missing passing check: ${check}`);
    if (failedRequired.has(check)) problems.push(`public DNS report has failing required check: ${check}`);
  }
  return problems;
}

function requiredPublicDnsVerificationChecks() {
  return [
    "manual DNS cutover confirmed",
    "public nameservers use Cloudflare",
    ...HOSTNAMES.flatMap((hostname) => [
      `public DNS resolves ${hostname}`,
      `public DNS target is not Vercel for ${hostname}`,
      `HTTP status ${hostname}`,
      `HTTP served through Cloudflare ${hostname}`,
      `HTTP not served by Vercel ${hostname}`,
    ]),
  ];
}

function dnsDryRunConsistencyProblems(
  backupDir: string,
  preferred: DnsCutoverPlanReport | null,
  legacy: DnsCutoverPlanReport | null,
) {
  if (!preferred || !legacy) return [];
  const problems: string[] = [];
  const comparedFields = ["apply", "ok", "backupDir", "domain", "gateVersion", "planFingerprint"] as const;
  for (const field of comparedFields) {
    if (preferred[field] !== legacy[field]) {
      problems.push(`${DNS_CUTOVER_DRY_RUN_REPORT} and ${DNS_CUTOVER_LEGACY_PLAN_REPORT} disagree on ${field}`);
    }
  }
  if ((preferred.plannedActions?.length ?? -1) !== (legacy.plannedActions?.length ?? -1)) {
    problems.push(`${DNS_CUTOVER_DRY_RUN_REPORT} and ${DNS_CUTOVER_LEGACY_PLAN_REPORT} disagree on planned action count`);
  }
  if (path.resolve(preferred.backupDir ?? "") !== path.resolve(backupDir)) {
    problems.push(`${DNS_CUTOVER_DRY_RUN_REPORT} was generated for a different backup directory`);
  }
  if (path.resolve(legacy.backupDir ?? "") !== path.resolve(backupDir)) {
    problems.push(`${DNS_CUTOVER_LEGACY_PLAN_REPORT} was generated for a different backup directory`);
  }
  return problems;
}

function readJson<T>(backupDir: string, relativePath: string): T | null {
  const filePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
