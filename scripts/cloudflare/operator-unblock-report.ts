import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  resolveBackupDir,
} from "./migration-config";
import { writeEvidenceManifest } from "./evidence-manifest";
import {
  CLOUDFLARE_TOKEN_REQUIRED_PERMISSIONS,
} from "./cloudflare-api-token";

type MigrationStage = {
  id?: string;
  name?: string;
  status?: string;
  detail?: unknown;
};

type MigrationStatusReport = {
  createdAt?: string;
  backupDir?: string;
  readyForDeploy?: boolean;
  readyForDnsCutover?: boolean;
  readyForProviderRetirement?: boolean;
  providersRetired?: boolean;
  blockedStages?: number;
  stages?: MigrationStage[];
};

type WriteFreezeReadinessReport = {
  url?: string;
  endpointContractOk?: boolean;
  writeFreezeActive?: boolean | null;
  probe?: unknown;
  problems?: string[];
};

type TokenCapabilityReport = {
  credentialSource?: string | null;
  requiredPermissions?: unknown;
  failedChecks?: number;
  checks?: Array<{ name?: string; status?: string; detail?: unknown }>;
};

export type OperatorUnblockItem = {
  id: string;
  title: string;
  blockedStages: string[];
  currentEvidence: unknown;
  requiredAction: string[];
  rerunCommands: string[];
};

export type OperatorUnblockReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  migrationStatusCreatedAt?: string;
  readyForDeploy: boolean;
  readyForDnsCutover: boolean;
  readyForProviderRetirement: boolean;
  providersRetired: boolean;
  blockedStages: number;
  items: OperatorUnblockItem[];
  safetyNote: string;
};

const WRITE_FREEZE_STATUS_URL = "https://inspirlearning.com/api/migration/write-freeze";

if (isMainModule()) void main();

function main() {
  const backupDir = resolveBackupDir();
  const report = buildOperatorUnblockReport(backupDir);
  const cfDir = cloudflareDir(backupDir);
  const jsonPath = path.join(cfDir, "operator-unblock-report.json");
  const markdownPath = path.join(cfDir, "operator-unblock-report.md");
  fs.mkdirSync(cfDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(markdownPath, renderMarkdown(report), { mode: 0o600 });
  const manifest = writeEvidenceManifest(backupDir);
  console.log(`Operator unblock report written:`);
  console.log(jsonPath);
  console.log(markdownPath);
  console.log(`Evidence manifest: ${manifest.manifestPath} (${manifest.files} files)`);
  console.log(`Open items: ${report.items.length}`);
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

export function buildOperatorUnblockReport(backupDir: string, options: { now?: Date } = {}): OperatorUnblockReport {
  const migration = readJson<MigrationStatusReport>(backupDir, "cloudflare/migration-status-report.json") ?? {};
  const stages = migration.stages ?? [];
  const blocked = stages.filter((stage) => stage.status !== "pass");
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const items: OperatorUnblockItem[] = [];

  const writeFreezeStages = stageIds(stageById, ["write-freeze-readiness", "final-write-freeze-backup"]);
  if (writeFreezeStages.length) {
    const readiness = readJson<WriteFreezeReadinessReport>(backupDir, "cloudflare/write-freeze-readiness-report.json");
    items.push({
      id: "prove-write-freeze",
      title: "Prove the currently serving production app is write-frozen",
      blockedStages: writeFreezeStages,
      currentEvidence: readiness
        ? sanitizeEvidence({
            url: readiness.url ?? WRITE_FREEZE_STATUS_URL,
            endpointContractOk: readiness.endpointContractOk === true,
            writeFreezeActive: readiness.writeFreezeActive ?? null,
            probe: readiness.probe,
            problems: readiness.problems ?? [],
          })
        : { report: "cloudflare/write-freeze-readiness-report.json", missing: true },
      requiredAction: [
        "Preferred: make the currently serving production app expose /api/migration/write-freeze, set APP_WRITE_FREEZE=1 there, and prove the endpoint reports write_freeze_active.",
        "Waiver path: if that app cannot expose the endpoint, externally enforce a write freeze and create a local no-secret operator evidence file before the final provider backup.",
      ],
      rerunCommands: [
        `MIGRATION_WRITE_FREEZE_STATUS_URL=${WRITE_FREEZE_STATUS_URL} pnpm cf:check:write-freeze`,
        "CONFIRM_WRITE_FREEZE=1 CONFIRM_FINAL_BACKUP=1 CONFIRM_BACKUP_SOURCE_WRITES_FROZEN=1 MIGRATION_WRITE_FREEZE_STATUS_URL=https://inspirlearning.com/api/migration/write-freeze pnpm cf:migration:backup -- --final",
        "CONFIRM_WRITE_FREEZE=1 CONFIRM_FINAL_BACKUP=1 CONFIRM_BACKUP_SOURCE_WRITES_FROZEN=1 CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE=1 CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED=1 WRITE_FREEZE_OPERATOR_EVIDENCE_FILE=<local-no-secret-evidence-file> pnpm cf:migration:backup -- --final",
      ],
    });
  }

  const dnsCutoverPassed = stageById.get("dns-cutover")?.status === "pass";
  const tokenStages = dnsCutoverPassed ? [] : stageIds(stageById, ["cloudflare-token-capability", "dns-dry-run"]);
  if (tokenStages.length) {
    const token = readJson<TokenCapabilityReport>(backupDir, "cloudflare/cloudflare-api-token-capability-report.json");
    items.push({
      id: "fix-cloudflare-dns-token",
      title: "Use a Cloudflare token that can read and edit DNS records",
      blockedStages: tokenStages,
      currentEvidence: sanitizeEvidence({
        credentialSource: token?.credentialSource ?? null,
        failedChecks: token?.failedChecks ?? null,
        failingChecks: (token?.checks ?? []).filter((check) => check.status === "fail"),
        requiredPermissions: token?.requiredPermissions ?? CLOUDFLARE_TOKEN_REQUIRED_PERMISSIONS,
      }),
      requiredAction: [
        "Create or switch to a 0600 Cloudflare API token scoped to the target account and inspirlearning.com zone.",
        "The token must satisfy Zone:Read, DNS:Read, and DNS:Edit, and must pass the temporary TXT create/read/delete proof before DNS cutover.",
      ],
      rerunCommands: [
        "CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1 CLOUDFLARE_API_TOKEN_FILE=<path-to-0600-token-file> pnpm cf:verify:cloudflare-token",
        "CLOUDFLARE_API_TOKEN_FILE=<path-to-0600-token-file> pnpm cf:dns:prepare-cutover",
      ],
    });
  }

  const operatorEnv = stageById.get("operator-env");
  if (operatorEnv?.status !== undefined && operatorEnv.status !== "pass") {
    items.push({
      id: "provide-live-test-env",
      title: "Provide live production test confirmations and admin test credentials",
      blockedStages: ["operator-env", "production-playwright", "production-smoke"],
      currentEvidence: sanitizeEvidence(operatorEnv.detail ?? {}),
      requiredAction: [
        "Set the live-test confirmations only during final write-freeze/cutover.",
        "Provide the dedicated Google test account email/password, or use the temporary migration-session E2E secret when Google blocks browser automation.",
        "Confirm the test account has admin access before treating admin Playwright as a release gate.",
      ],
      rerunCommands: [
        "CONFIRM_WRITE_FREEZE=1 REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 E2E_GOOGLE_EMAIL=<test-account> E2E_GOOGLE_PASSWORD=<password> pnpm cf:preflight:production",
        "CONFIRM_WRITE_FREEZE=1 REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 E2E_GOOGLE_EMAIL=<test-account> E2E_TEST_AUTH_SECRET=<temporary-secret> pnpm cf:preflight:production",
        "REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 PLAYWRIGHT_BASE_URL=https://inspirlearning.com pnpm cf:test:e2e:production",
      ],
    });
  }

  const finalDataStages = stageIds(stageById, [
    "d1-import",
    "vectorize-import",
    "production-preflight",
    "worker-deploy",
    "dns-cutover",
    "production-smoke",
    "production-playwright",
    "post-cutover-d1",
    "post-cutover-vectorize",
    "provider-retirement",
    "provider-retirement-run",
    "credential-rotation",
  ]);
  if (finalDataStages.length) {
    items.push({
      id: "run-final-cutover-sequence",
      title: "Run the final import, deploy, validation, and retirement sequence only after prerequisites pass",
      blockedStages: finalDataStages,
      currentEvidence: {
        readyForDeploy: migration.readyForDeploy === true,
        readyForDnsCutover: migration.readyForDnsCutover === true,
        readyForProviderRetirement: migration.readyForProviderRetirement === true,
        providersRetired: migration.providersRetired === true,
      },
      requiredAction: [
        "After write-freeze and DNS proof pass, run the final D1 import and Vectorize reset/import from the frozen backup.",
        "Deploy the Worker, validate production smoke and Playwright, then hard-delete Vercel/Supabase only after provider-retirement preflight is clean.",
      ],
      rerunCommands: [
        `CONFIRM_WRITE_FREEZE=1 CONFIRM_D1_IMPORT=1 CONFIRM_D1_DATABASE_NAME=${D1_DATABASE_NAME} CONFIRM_D1_DATABASE_ID=${D1_DATABASE_ID} CONFIRM_BACKUP_DIR=<final-backup-dir> pnpm cf:migration:import:d1`,
        `CONFIRM_WRITE_FREEZE=1 CONFIRM_VECTORIZE_IMPORT=1 CONFIRM_VECTORIZE_RESET=1 CONFIRM_VECTORIZE_INDEX=${VECTORIZE_INDEX_NAME} CONFIRM_BACKUP_DIR=<final-backup-dir> pnpm cf:migration:import:vectorize -- --reset`,
        "pnpm cf:migration:validate:d1 && pnpm cf:preflight:production && pnpm cf:cutover:checklist",
      ],
    });
  }

  return {
    createdAt: (options.now ?? new Date()).toISOString(),
    backupDir,
    ok: migration.providersRetired === true && items.length === 0,
    migrationStatusCreatedAt: migration.createdAt,
    readyForDeploy: migration.readyForDeploy === true,
    readyForDnsCutover: migration.readyForDnsCutover === true,
    readyForProviderRetirement: migration.readyForProviderRetirement === true,
    providersRetired: migration.providersRetired === true,
    blockedStages: typeof migration.blockedStages === "number" ? migration.blockedStages : blocked.length,
    items,
    safetyNote:
      "This report is advisory and non-mutating. It does not replace final-cutover-checklist.md, production preflight, evidence manifest verification, or destructive CONFIRM_* gates.",
  };
}

function stageIds(stageById: Map<string | undefined, MigrationStage>, ids: string[]) {
  return ids.filter((id) => {
    const stage = stageById.get(id);
    return stage && stage.status !== "pass";
  });
}

function readJson<T>(backupDir: string, relativePath: string): T | null {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) return null;
  return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
}

function sanitizeEvidence(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      secretLikeKey(key) ? "[REDACTED]" : sanitizeEvidence(nested),
    ]),
  );
}

function secretLikeKey(key: string) {
  return /(^|_)(token|secret|password|private_key|api_key|access_key)($|_)/i.test(key);
}

function redactString(value: string) {
  return value
    .replaceAll(/cfat_[A-Za-z0-9_-]+/g, "[REDACTED_CLOUDFLARE_TOKEN]")
    .replaceAll(/(?<=token[=:]\s*)[A-Za-z0-9._~+/=-]{16,}/gi, "[REDACTED_TOKEN]")
    .replaceAll(/(?<=secret[=:]\s*)[A-Za-z0-9._~+/=-]{16,}/gi, "[REDACTED_SECRET]")
    .replaceAll(/(?<=password[=:]\s*)[^\s]+/gi, "[REDACTED_PASSWORD]");
}

export function renderMarkdown(report: OperatorUnblockReport) {
  const lines = [
    "# Operator Unblock Report",
    "",
    `Generated: ${report.createdAt}`,
    `Backup: ${report.backupDir}`,
    `Open items: ${report.items.length}`,
    "",
    report.safetyNote,
    "",
  ];

  if (!report.items.length) {
    lines.push("No open operator unblock items were detected.");
    lines.push("");
    return lines.join("\n");
  }

  for (const item of report.items) {
    lines.push(`## ${item.title}`);
    lines.push("");
    lines.push(`Blocked stages: ${item.blockedStages.join(", ")}`);
    lines.push("");
    lines.push("Required action:");
    for (const action of item.requiredAction) lines.push(`- ${action}`);
    lines.push("");
    lines.push("Current evidence:");
    lines.push("```json");
    lines.push(JSON.stringify(item.currentEvidence, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("Rerun commands:");
    lines.push("```bash");
    for (const command of item.rerunCommands) lines.push(command);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
