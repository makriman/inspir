import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareDir, resolveBackupDir } from "./migration-config";
import { freshBackupScopedReportBlockers, type BackupScopedGateReport } from "./fresh-report-gate";
import {
  providerRetirementRunEvidenceBlockers,
  type ProviderRetirementRunEvidence,
} from "./provider-retirement-safety";
import { FORBIDDEN_ENV_AFTER_ROTATION } from "./retired-provider-env";

type RotationConfirmation = {
  id: string;
  env: string;
  description: string;
};

export type CredentialRotationReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  confirmations: Array<RotationConfirmation & { confirmed: boolean }>;
  rotationEvidence: RotationEvidence;
  forbiddenEnvPresent: string[];
  blockers: string[];
};

export type RotationEvidence = {
  required: boolean;
  ok: boolean | null;
  sourceFile?: string;
  storedFile?: string;
  bytes?: number;
  sha256?: string;
  problems: string[];
};

type EnvMap = Record<string, string | undefined>;

type ProviderRetirementRunReport = BackupScopedGateReport & ProviderRetirementRunEvidence;

const MAX_REPORT_AGE_MS = 60 * 60 * 1000;

const REQUIRED_CONFIRMATIONS: RotationConfirmation[] = [
  {
    id: "cloudflare-api-token",
    env: "CONFIRM_CLOUDFLARE_MIGRATION_API_TOKEN_REVOKED",
    description: "The temporary Cloudflare API token used for DNS/migration work has been revoked or rotated.",
  },
  {
    id: "r2-s3-key",
    env: "CONFIRM_R2_MIGRATION_S3_KEY_REVOKED",
    description: "The temporary R2 S3 access key and secret have been revoked or rotated.",
  },
  {
    id: "vercel-access",
    env: "CONFIRM_VERCEL_ACCESS_REVOKED",
    description: "Any Vercel CLI/API access used for deletion has been revoked, rotated, or removed from the operator shell.",
  },
  {
    id: "supabase-access",
    env: "CONFIRM_SUPABASE_ACCESS_REVOKED",
    description: "Any Supabase CLI/API/database access used for deletion has been revoked, rotated, or removed from the operator shell.",
  },
  {
    id: "retired-provider-env",
    env: "CONFIRM_RETIRED_PROVIDER_ENV_UNSET",
    description: "Retired Vercel/Supabase/R2 migration credentials are unset from the operator environment.",
  },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const backupDir = resolveBackupDir();
  const report = buildCredentialRotationReport(backupDir);
  const reportPath = path.join(cloudflareDir(backupDir), "credential-rotation-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function buildCredentialRotationReport(
  backupDir: string,
  options: { env?: EnvMap; nowMs?: number } = {},
): CredentialRotationReport {
  const env = options.env ?? process.env;
  const providerRun = readJson<ProviderRetirementRunReport>(backupDir, "cloudflare/provider-retirement-run.json");
  const rotationEvidence = copyRotationEvidence(backupDir, env);
  const confirmations = REQUIRED_CONFIRMATIONS.map((confirmation) => ({
    ...confirmation,
    confirmed: env[confirmation.env] === "1",
  }));
  const forbiddenEnvPresent = FORBIDDEN_ENV_AFTER_ROTATION.filter((key) => Boolean(env[key]?.trim()));
  const blockers = [
    ...freshBackupScopedReportBlockers({
      relativePath: "cloudflare/provider-retirement-run.json",
      report: providerRun,
      backupDir,
      maxAgeMs: MAX_REPORT_AGE_MS,
      nowMs: options.nowMs,
      requireOk: true,
    }),
    ...providerRetirementRunEvidenceBlockers(providerRun),
    ...rotationEvidence.problems,
    ...confirmations.filter((confirmation) => !confirmation.confirmed).map((confirmation) => `Missing ${confirmation.env}=1`),
    ...forbiddenEnvPresent.map((key) => `${key} is still present in the operator environment`),
  ];

  return {
    createdAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    backupDir,
    ok: blockers.length === 0,
    confirmations,
    rotationEvidence,
    forbiddenEnvPresent,
    blockers,
  };
}

export function credentialRotationEvidenceBlockers(
  report: Partial<CredentialRotationReport> | null | undefined,
  relativePath = "cloudflare/credential-rotation-report.json",
) {
  if (!report) return [];

  const blockers: string[] = [];

  if (!Array.isArray(report.blockers)) {
    blockers.push(`${relativePath} has no blocker list`);
  } else {
    blockers.push(...report.blockers.map((blocker) => `${relativePath}: ${blocker}`));
  }

  if (!Array.isArray(report.forbiddenEnvPresent)) {
    blockers.push(`${relativePath} has no forbiddenEnvPresent list`);
  } else {
    blockers.push(...report.forbiddenEnvPresent.map((key) => `${relativePath}: ${key} was still present during rotation`));
  }

  if (report.rotationEvidence?.ok !== true) {
    blockers.push(`${relativePath} has no clean credential rotation evidence file`);
  }

  const confirmations = Array.isArray(report.confirmations) ? report.confirmations : [];
  if (confirmations.length !== REQUIRED_CONFIRMATIONS.length) {
    blockers.push(`${relativePath} has incomplete rotation confirmations`);
  }

  for (const required of REQUIRED_CONFIRMATIONS) {
    const confirmation = confirmations.find((entry) => entry.id === required.id && entry.env === required.env);
    if (!confirmation) {
      blockers.push(`${relativePath} is missing ${required.env} confirmation`);
    } else if (confirmation.confirmed !== true) {
      blockers.push(`${relativePath} did not confirm ${required.env}`);
    }
  }

  return blockers;
}

function copyRotationEvidence(backupDir: string, env: EnvMap): RotationEvidence {
  const problems: string[] = [];
  const sourceFile = env.CREDENTIAL_ROTATION_EVIDENCE_FILE?.trim();
  const storedRelative = "cloudflare/credential-rotation-evidence.txt";
  const storedPath = path.join(backupDir, storedRelative);
  if (!sourceFile) {
    return {
      required: true,
      ok: false,
      problems: ["Missing CREDENTIAL_ROTATION_EVIDENCE_FILE"],
    };
  }

  const resolvedSource = path.resolve(sourceFile);
  if (!fs.existsSync(resolvedSource) || fs.statSync(resolvedSource).size === 0) {
    problems.push("CREDENTIAL_ROTATION_EVIDENCE_FILE is missing or empty");
  }

  if (problems.length) {
    return {
      required: true,
      ok: false,
      sourceFile: resolvedSource,
      storedFile: storedRelative,
      problems,
    };
  }

  const content = fs.readFileSync(resolvedSource);
  fs.writeFileSync(storedPath, content, { mode: 0o600 });
  fs.chmodSync(storedPath, 0o600);
  return {
    required: true,
    ok: true,
    sourceFile: resolvedSource,
    storedFile: storedRelative,
    bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    problems: [],
  };
}

function readJson<T>(backupDir: string, relativePath: string): T | null {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
  } catch {
    return null;
  }
}
