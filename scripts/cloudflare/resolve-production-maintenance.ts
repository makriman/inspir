import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import { writePrivateJsonDurably } from "./d1-release-budget-ledger";
import {
  acquireProductionMaintenanceRecoveryExclusion,
  assertProductionValidationExclusionCommandWindow,
  attestProductionValidationExclusion,
  clearProductionMaintenanceState,
  readProductionMaintenanceState,
  releaseProductionValidationExclusion,
  type ProductionValidationExclusion,
} from "./production-validation-lock";
import { readSoleActiveWorkerVersion } from "./worker-deploy-evidence";
import { boundedReleaseChildCommand } from "./run-production-release-operation";

const workerName = "inspirlearning";
const productionBaseUrl = "https://inspirlearning.com";
const reportName = "production-maintenance-resolution.json";

type MaintenanceResolutionReport = {
  kind: "production-maintenance-resolution-v1";
  createdAt: string;
  ok: boolean;
  repairRunId: string;
  candidateVersionId: string;
  maintenanceVersionId: string;
  activeVersionBefore: string | null;
  activeVersionAfter: string | null;
  responseRecoveredByReadback: boolean;
  markerCleared: boolean;
  exclusionReleased: boolean;
  error?: string;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Production maintenance resolution failed.");
    process.exitCode = 1;
  });
}

async function main() {
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Production maintenance resolution requires --confirm-production.");
  }
  const repairRunId = requireRunId(getArg("--repair-run-id"));
  const backupDir = resolveBackupDir();
  const stored = readProductionMaintenanceState();
  if (!stored || stored.state.repairRunId !== repairRunId) {
    throw new Error("The exact requested production maintenance state is not active.");
  }

  let exclusion: ProductionValidationExclusion | null = null;
  let activeVersionBefore: string | null = null;
  let activeVersionAfter: string | null = null;
  let responseRecoveredByReadback = false;
  let markerCleared = false;
  let exclusionReleased = false;
  let operationError: unknown = null;
  let preliminaryWritten = false;

  try {
    exclusion = acquireProductionMaintenanceRecoveryExclusion({ state: stored.state });
    exclusion = attestProductionValidationExclusion(exclusion);
    assertProductionValidationExclusionCommandWindow(exclusion);
    activeVersionBefore = readSoleActiveWorkerVersion();
    if (
      activeVersionBefore !== stored.state.candidateVersionId &&
      activeVersionBefore !== stored.state.maintenanceVersionId
    ) {
      throw new Error("Active Worker is neither the recorded candidate nor maintenance version.");
    }

    let deployError: unknown = null;
    try {
      await runBoundedWrangler([
        "versions",
        "deploy",
        `${stored.state.candidateVersionId}@100`,
        "--name",
        workerName,
        "--yes",
        "--message",
        `Resolve translation maintenance ${repairRunId}`,
      ]);
    } catch (error) {
      deployError = error;
    }
    exclusion = attestProductionValidationExclusion(exclusion);
    activeVersionAfter = readSoleActiveWorkerVersion();
    if (activeVersionAfter !== stored.state.candidateVersionId) {
      throw new AggregateError(
        [deployError, new Error("Recorded candidate did not become the sole active Worker.")]
          .filter((error): error is NonNullable<unknown> => error !== null && error !== undefined),
        "Production maintenance candidate restore failed.",
      );
    }
    responseRecoveredByReadback = deployError !== null;
    await assertCandidateIsUnfrozen(stored.state.candidateVersionId);

    const preliminary = report({
      ok: false,
      repairRunId,
      candidateVersionId: stored.state.candidateVersionId,
      maintenanceVersionId: stored.state.maintenanceVersionId,
      activeVersionBefore,
      activeVersionAfter,
      responseRecoveredByReadback,
      markerCleared: false,
      exclusionReleased: false,
      error: "Pending exact marker clear and exclusion release.",
    });
    writeReport(backupDir, preliminary);
    preliminaryWritten = true;

    const cleared = clearProductionMaintenanceState({ exclusion, state: stored.state });
    exclusion = cleared.exclusion;
    markerCleared = true;
  } catch (error) {
    operationError = error;
  }

  if (exclusion) {
    const releaseErrors: Error[] = [];
    try {
      exclusion = attestProductionValidationExclusion(exclusion);
    } catch (error) {
      releaseErrors.push(asError(error));
    }
    try {
      releaseProductionValidationExclusion(exclusion);
      exclusionReleased = true;
    } catch (error) {
      releaseErrors.push(asError(error));
    }
    if (releaseErrors.length) {
      operationError = new AggregateError(
        [operationError, ...releaseErrors]
          .filter((error): error is NonNullable<unknown> => error !== null && error !== undefined),
        "Production maintenance resolution or exclusion release failed.",
      );
    }
  }

  if (preliminaryWritten && markerCleared && exclusionReleased && !operationError) {
    activeVersionAfter = readSoleActiveWorkerVersion();
    if (activeVersionAfter !== stored.state.candidateVersionId || readProductionMaintenanceState() !== null) {
      operationError = new Error("Production maintenance resolution changed before final evidence promotion.");
    } else {
      await assertCandidateIsUnfrozen(stored.state.candidateVersionId);
    }
  }

  const finalReport = report({
    ok: preliminaryWritten && markerCleared && exclusionReleased && !operationError,
    repairRunId,
    candidateVersionId: stored.state.candidateVersionId,
    maintenanceVersionId: stored.state.maintenanceVersionId,
    activeVersionBefore,
    activeVersionAfter,
    responseRecoveredByReadback,
    markerCleared,
    exclusionReleased,
    ...(operationError ? { error: safeErrorMessage(operationError) } : {}),
  });
  writeReport(backupDir, finalReport);
  console.log(JSON.stringify(finalReport, null, 2));
  if (!finalReport.ok) throw new Error(finalReport.error ?? "Production maintenance resolution failed.");
}

function runBoundedWrangler(args: string[]) {
  const actual = {
    command: path.resolve(process.cwd(), "node_modules/.bin/wrangler"),
    args,
  };
  const bounded = boundedReleaseChildCommand(actual, process.cwd());
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bounded.command, bounded.args, {
      cwd: process.cwd(),
      env: commandEnv(),
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    let spawnError: Error | null = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (status) => {
      if (spawnError) reject(spawnError);
      else if (status !== 0) reject(new Error(`Bounded Wrangler resolution command exited with status ${status ?? "unknown"}.`));
      else resolve();
    });
  });
}

async function assertCandidateIsUnfrozen(expectedVersionId: string) {
  const [healthResponse, freezeResponse] = await Promise.all([
    fetch(`${productionBaseUrl}/api/health`, {
      headers: { accept: "application/json", "cache-control": "no-store" },
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(`${productionBaseUrl}/api/migration/write-freeze`, {
      headers: { accept: "application/json", "cache-control": "no-store" },
      signal: AbortSignal.timeout(10_000),
    }),
  ]);
  const health: unknown = await healthResponse.json().catch(() => null);
  const freeze: unknown = await freezeResponse.json().catch(() => null);
  const healthRecord = objectRecord(health);
  const version = objectRecord(healthRecord?.version);
  const freezeRecord = objectRecord(freeze);
  if (
    !healthResponse.ok ||
    version?.id !== expectedVersionId ||
    freezeResponse.status !== 409 ||
    freezeRecord?.writeFreezeActive !== false ||
    freezeRecord?.code !== "write_freeze_inactive" ||
    freezeRecord?.versionId !== expectedVersionId
  ) {
    throw new Error("Production candidate health/write-freeze probes did not prove the exact unfrozen version.");
  }
}

function report(input: Omit<MaintenanceResolutionReport, "kind" | "createdAt">): MaintenanceResolutionReport {
  return {
    kind: "production-maintenance-resolution-v1",
    createdAt: new Date().toISOString(),
    ...input,
  };
}

function writeReport(backupDir: string, value: MaintenanceResolutionReport) {
  const file = path.join(cloudflareDir(backupDir), reportName);
  writePrivateJsonDurably(file, value, { replace: fs.existsSync(file) });
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requireRunId(value: string | undefined) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("Production maintenance repair run must be a lowercase RFC UUID.");
  }
  return value;
}

function objectRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error("Unknown production maintenance resolution failure.");
}

function safeErrorMessage(value: unknown) {
  if (value instanceof AggregateError) {
    return `${value.message}: ${value.errors.map(asError).map((error) => error.message).join("; ")}`.slice(0, 2_000);
  }
  return asError(value).message.slice(0, 2_000);
}
