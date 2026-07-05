import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cloudflareDir } from "./migration-config";

export const WRITE_FREEZE_REPORT = "cloudflare/write-freeze-report.json";
export const WRITE_FREEZE_READINESS_REPORT = "cloudflare/write-freeze-readiness-report.json";
export const WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE = "cloudflare/write-freeze-external-evidence.txt";
const DEFAULT_WRITE_FREEZE_STATUS_URL = "https://inspirlearning.com/api/migration/write-freeze";

type EnvMap = Record<string, string | undefined>;

export type WriteFreezeProbe = {
  required: boolean;
  attempted: boolean;
  ok: boolean | null;
  url?: string;
  status?: number;
  writeFreezeActive?: boolean;
  code?: string;
  waiverConfirmed?: boolean;
  error?: string;
};

export type WriteFreezeEvidenceReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  finalBackup: boolean;
  confirmations: {
    writeFreezeConfirmed: boolean;
    finalBackupConfirmed: boolean;
    frozenSourceConfirmed: boolean;
  };
  probe: WriteFreezeProbe;
  externalFreeze: ExternalWriteFreezeEvidence;
  problems: string[];
};

export type ExternalWriteFreezeEvidence = {
  required: boolean;
  confirmed: boolean;
  ok: boolean | null;
  sourceFile?: string;
  storedFile?: string;
  bytes?: number;
  sha256?: string;
  problems: string[];
};

export type WriteFreezeReadinessReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  url?: string;
  endpointContractOk: boolean;
  writeFreezeActive: boolean | null;
  probe: WriteFreezeProbe;
  problems: string[];
};

export type FinalWriteFreezeEvidenceValidation = {
  ok: boolean;
  blockers: string[];
  detail: {
    reportOk: boolean;
    finalBackup: boolean;
    backupDirOk: boolean;
    fresh: boolean;
    confirmationsOk: boolean;
    probeOk: boolean;
    probeWaived: boolean;
    externalFreezeOk: boolean;
    externalEvidenceFileOk: boolean;
    reportProblems: string[];
    ageMs: number | null;
  };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function writeWriteFreezeEvidenceReport(
  backupDir: string,
  options: { finalBackup: boolean; env?: EnvMap; fetchImpl?: FetchLike } = { finalBackup: false },
) {
  const report = await buildWriteFreezeEvidenceReport(backupDir, options);
  fs.writeFileSync(path.join(cloudflareDir(backupDir), "write-freeze-report.json"), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  return report;
}

export async function buildWriteFreezeEvidenceReport(
  backupDir: string,
  options: { finalBackup: boolean; env?: EnvMap; fetchImpl?: FetchLike },
): Promise<WriteFreezeEvidenceReport> {
  const env = options.env ?? process.env;
  const finalBackup = options.finalBackup;
  const confirmations = {
    writeFreezeConfirmed: env.CONFIRM_WRITE_FREEZE === "1",
    finalBackupConfirmed: env.CONFIRM_FINAL_BACKUP === "1",
    frozenSourceConfirmed: env.CONFIRM_BACKUP_SOURCE_WRITES_FROZEN === "1",
  };
  const problems: string[] = [];
  if (finalBackup) {
    if (!confirmations.writeFreezeConfirmed) problems.push("CONFIRM_WRITE_FREEZE must be 1 for a final backup");
    if (!confirmations.finalBackupConfirmed) problems.push("CONFIRM_FINAL_BACKUP must be 1 for a final backup");
    if (!confirmations.frozenSourceConfirmed) {
      problems.push("CONFIRM_BACKUP_SOURCE_WRITES_FROZEN must be 1 for a final backup");
    }
  }

  const probe = finalBackup ? await buildProbe(env, options.fetchImpl ?? fetch) : skippedProbe();
  if (finalBackup && probe.required && probe.ok !== true) {
    problems.push("write-freeze status probe did not prove the serving app is frozen");
  }
  const externalFreeze = buildExternalFreezeEvidence(backupDir, env, finalBackup && probe.waiverConfirmed === true);
  problems.push(...externalFreeze.problems);

  return {
    createdAt: new Date().toISOString(),
    backupDir: path.resolve(backupDir),
    ok: finalBackup ? problems.length === 0 : true,
    finalBackup,
    confirmations,
    probe,
    externalFreeze,
    problems,
  };
}

export async function buildWriteFreezeReadinessReport(
  backupDir: string,
  options: { env?: EnvMap; fetchImpl?: FetchLike } = {},
): Promise<WriteFreezeReadinessReport> {
  const env = options.env ?? process.env;
  const probe = await probeWriteFreezeStatus(env, options.fetchImpl ?? fetch);
  const endpointContractOk =
    probe.required === true &&
    probe.attempted === true &&
    (probe.status === 200 || probe.status === 409) &&
    typeof probe.writeFreezeActive === "boolean" &&
    (probe.code === "write_freeze_active" || probe.code === "write_freeze_inactive");
  const problems: string[] = [];
  if (!endpointContractOk) {
    problems.push(
      "write-freeze status endpoint is not reachable with the expected JSON contract; deploy it or use the final-backup probe waiver with documented operational freeze evidence",
    );
  }

  return {
    createdAt: new Date().toISOString(),
    backupDir: path.resolve(backupDir),
    ok: endpointContractOk,
    url: probe.url,
    endpointContractOk,
    writeFreezeActive: typeof probe.writeFreezeActive === "boolean" ? probe.writeFreezeActive : null,
    probe,
    problems,
  };
}

export function validateFinalWriteFreezeEvidenceReport(
  report: WriteFreezeEvidenceReport | null | undefined,
  options: { backupDir: string; maxAgeMs: number; nowMs?: number },
): FinalWriteFreezeEvidenceValidation {
  const nowMs = options.nowMs ?? Date.now();
  const blockers: string[] = [];
  if (!report) {
    return {
      ok: false,
      blockers: [`${WRITE_FREEZE_REPORT} is missing or invalid`],
      detail: emptyValidationDetail(),
    };
  }

  const createdAtMs = Date.parse(report.createdAt);
  const ageMs = Number.isFinite(createdAtMs) ? nowMs - createdAtMs : null;
  const fresh = ageMs !== null && ageMs >= 0 && ageMs <= options.maxAgeMs;
  const backupDirOk = typeof report.backupDir === "string" && path.resolve(report.backupDir) === path.resolve(options.backupDir);
  const confirmationsOk =
    report.confirmations?.writeFreezeConfirmed === true &&
    report.confirmations?.finalBackupConfirmed === true &&
    report.confirmations?.frozenSourceConfirmed === true;
  const probeWaived = report.probe?.waiverConfirmed === true;
  const externalFreezeOk = probeWaived
    ? report.externalFreeze?.required === true &&
      report.externalFreeze.confirmed === true &&
      report.externalFreeze.ok === true &&
      Boolean(report.externalFreeze.storedFile)
    : report.externalFreeze?.required !== true;
  const externalEvidenceFileOk = validateExternalEvidenceFile(options.backupDir, report);
  const probeOk = probeWaived
    ? externalFreezeOk && externalEvidenceFileOk
    : report.probe?.required === true &&
      report.probe.attempted === true &&
      report.probe.ok === true &&
      report.probe.writeFreezeActive === true;
  const reportProblems = Array.isArray(report.problems) ? report.problems : [];

  if (report.ok !== true) blockers.push(`${WRITE_FREEZE_REPORT} is not clean`);
  if (report.finalBackup !== true) blockers.push(`${WRITE_FREEZE_REPORT} is not marked as a final backup`);
  if (!backupDirOk) blockers.push(`${WRITE_FREEZE_REPORT} was generated for a different backup directory`);
  if (!fresh) blockers.push(`${WRITE_FREEZE_REPORT} is older than one hour or has an invalid createdAt`);
  if (!confirmationsOk) blockers.push(`${WRITE_FREEZE_REPORT} is missing final write-freeze confirmations`);
  if (!probeOk) blockers.push(`${WRITE_FREEZE_REPORT} did not prove the application write-freeze state`);
  if (reportProblems.length > 0) blockers.push(`${WRITE_FREEZE_REPORT} recorded problems: ${reportProblems.join("; ")}`);
  if (probeWaived && !externalEvidenceFileOk) {
    blockers.push(`${WRITE_FREEZE_REPORT} waived the probe without a valid stored external freeze evidence file`);
  }

  return {
    ok: blockers.length === 0,
    blockers,
    detail: {
      reportOk: report.ok === true,
      finalBackup: report.finalBackup === true,
      backupDirOk,
      fresh,
      confirmationsOk,
      probeOk,
      probeWaived,
      externalFreezeOk,
      externalEvidenceFileOk,
      reportProblems,
      ageMs,
    },
  };
}

export function requiredWriteFreezeEvidenceFiles(backupDir: string, report?: WriteFreezeEvidenceReport | null) {
  const files = [WRITE_FREEZE_REPORT];
  const externalEvidenceFile = writeFreezeExternalEvidenceFileForManifest(backupDir, report);
  if (externalEvidenceFile) files.push(externalEvidenceFile);
  return files;
}

function writeFreezeExternalEvidenceFileForManifest(
  backupDir: string,
  report: WriteFreezeEvidenceReport | null | undefined = readWriteFreezeEvidenceReport(backupDir),
) {
  const storedFile = report?.externalFreeze?.storedFile;
  if (report?.probe?.waiverConfirmed !== true || typeof storedFile !== "string" || !storedFile.trim()) return null;
  return resolveBackupRelativeFile(backupDir, storedFile) ? storedFile : null;
}

function skippedProbe(): WriteFreezeProbe {
  return { required: false, attempted: false, ok: null };
}

function emptyValidationDetail(): FinalWriteFreezeEvidenceValidation["detail"] {
  return {
    reportOk: false,
    finalBackup: false,
    backupDirOk: false,
    fresh: false,
    confirmationsOk: false,
    probeOk: false,
    probeWaived: false,
    externalFreezeOk: false,
    externalEvidenceFileOk: false,
    reportProblems: [],
    ageMs: null,
  };
}

function validateExternalEvidenceFile(backupDir: string, report: WriteFreezeEvidenceReport) {
  if (report.probe?.waiverConfirmed !== true) return report.externalFreeze?.required !== true;
  const storedFile = report.externalFreeze?.storedFile;
  if (!storedFile) return false;
  const absolutePath = resolveBackupRelativeFile(backupDir, storedFile);
  if (!absolutePath) return false;
  let content: Buffer;
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size === 0) return false;
    content = fs.readFileSync(absolutePath);
  } catch {
    return false;
  }
  if (!report.externalFreeze.sha256) return false;
  const actualSha256 = crypto.createHash("sha256").update(content).digest("hex");
  return actualSha256 === report.externalFreeze.sha256;
}

function resolveBackupRelativeFile(backupDir: string, storedFile: string) {
  if (path.isAbsolute(storedFile)) return null;
  const backupRootPath = path.resolve(backupDir);
  const absolutePath = path.resolve(backupRootPath, storedFile);
  const backupRoot = `${backupRootPath}${path.sep}`;
  if (!absolutePath.startsWith(backupRoot)) return null;
  return absolutePath;
}

function readWriteFreezeEvidenceReport(backupDir: string) {
  const filePath = path.join(backupDir, WRITE_FREEZE_REPORT);
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as WriteFreezeEvidenceReport;
  } catch {
    return null;
  }
}

function buildExternalFreezeEvidence(
  backupDir: string,
  env: EnvMap,
  required: boolean,
): ExternalWriteFreezeEvidence {
  if (!required) return { required: false, confirmed: false, ok: null, problems: [] };

  const problems: string[] = [];
  const confirmed = env.CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED === "1";
  if (!confirmed) problems.push("CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED must be 1 when the freeze-status probe is waived");

  const sourceFile = env.WRITE_FREEZE_OPERATOR_EVIDENCE_FILE?.trim();
  if (!sourceFile) {
    problems.push("WRITE_FREEZE_OPERATOR_EVIDENCE_FILE must point at a local evidence file when the freeze-status probe is waived");
    return { required, confirmed, ok: false, problems };
  }

  const resolvedSourceFile = path.resolve(sourceFile);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(resolvedSourceFile);
  } catch {
    problems.push(`WRITE_FREEZE_OPERATOR_EVIDENCE_FILE does not exist: ${resolvedSourceFile}`);
  }

  if (stat && !stat.isFile()) problems.push(`WRITE_FREEZE_OPERATOR_EVIDENCE_FILE is not a file: ${resolvedSourceFile}`);
  if (stat && stat.size === 0) problems.push(`WRITE_FREEZE_OPERATOR_EVIDENCE_FILE is empty: ${resolvedSourceFile}`);

  if (problems.length) {
    return { required, confirmed, ok: false, sourceFile: resolvedSourceFile, problems };
  }

  const storedPath = path.join(backupDir, WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE);
  fs.mkdirSync(path.dirname(storedPath), { recursive: true });
  if (path.resolve(storedPath) !== resolvedSourceFile) fs.copyFileSync(resolvedSourceFile, storedPath);
  fs.chmodSync(storedPath, 0o600);
  const content = fs.readFileSync(storedPath);

  return {
    required,
    confirmed,
    ok: true,
    sourceFile: resolvedSourceFile,
    storedFile: WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE,
    bytes: content.byteLength,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    problems: [],
  };
}

async function buildProbe(env: EnvMap, fetchImpl: FetchLike): Promise<WriteFreezeProbe> {
  if (env.CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE === "1") {
    return {
      required: false,
      attempted: false,
      ok: null,
      waiverConfirmed: true,
    };
  }

  return probeWriteFreezeStatus(env, fetchImpl);
}

export async function probeWriteFreezeStatus(env: EnvMap, fetchImpl: FetchLike): Promise<WriteFreezeProbe> {
  const url = (env.MIGRATION_WRITE_FREEZE_STATUS_URL ?? DEFAULT_WRITE_FREEZE_STATUS_URL).trim();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", "cache-control": "no-store" },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    const parsed = parseJson(text);
    const writeFreezeActive = parsed.writeFreezeActive === true;
    const code = typeof parsed.code === "string" ? parsed.code : undefined;
    return {
      required: true,
      attempted: true,
      ok: response.ok && writeFreezeActive,
      url,
      status: response.status,
      writeFreezeActive,
      code,
    };
  } catch (error) {
    return {
      required: true,
      attempted: true,
      ok: false,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
