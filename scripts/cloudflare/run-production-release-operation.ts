import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readPrivateJsonNoFollow, writePrivateJsonDurably } from "./d1-release-budget-ledger";
import { assertGitReleaseIdentity } from "./git-release-identity";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import {
  acquireProductionValidationExclusion,
  assertNoLiveProductionValidationLock,
  assertProductionValidationExclusionCommandWindow,
  attestProductionValidationExclusion,
  canonicalProductionValidationLockOwner,
  productionReleaseOperationNames,
  PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS,
  PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV,
  PRODUCTION_RELEASE_OPERATION_ENV,
  releaseProductionValidationExclusion,
  type ProductionReleaseOperationName,
  type ProductionValidationExclusion,
} from "./production-validation-lock";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import {
  assertReleaseSequenceCurrentReleaseBinding,
  type ReleaseSequenceCurrentRelease,
} from "./release-sequence-attestations";
import {
  buildWorkerDeployArtifactEvidence,
  readSoleActiveWorkerVersion,
  type WorkerDeployArtifactEvidence,
} from "./worker-deploy-evidence";
import { assertFreshProductionVectorizeReadiness } from "./vectorize-readiness-evidence";
import {
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

const workerName = "inspirlearning";
const heartbeatIntervalMs = 10 * 60 * 1_000;
const defaultBoundedChildOutputBytes = 128 * 1024 * 1024;
const boundedChildOuterTimeoutGraceMs = 60_000;
const rollbackMessage = "Guarded rollback failed inspir release";
const STANDALONE_SOURCE_SYNC_BLOCKED_FOR_ROLLOVER = true as const;
const operationScripts: Record<Exclude<ProductionReleaseOperationName, "rollback">, string> = {
  "apply-d1-runtime-migrations": "scripts/cloudflare/apply-d1-runtime-migrations.ts",
  "apply-d1-runtime-migration-0017": "scripts/cloudflare/apply-d1-runtime-migration-0017.ts",
  "sync-site-translation-sources": "scripts/cloudflare/sync-site-translation-sources.ts",
  "sync-topic-seeds": "scripts/cloudflare/sync-topic-seeds.ts",
};

type ProductionReleaseOperationReport = {
  kind: "production-release-operation-v1";
  createdAt: string;
  operation: ProductionReleaseOperationName;
  ok: boolean;
  childStatus: number | null;
  responseRecoveredByReadback: boolean;
  activeVersionBefore: string;
  activeVersionAfter: string | null;
  expectedActiveVersionAfter: string;
  sourceFingerprintBefore: SourceFingerprint;
  sourceFingerprintAfter: SourceFingerprint | null;
  sourceFingerprintStable: boolean;
  exclusionReleased: boolean;
  error?: string;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const entry = process.argv[2] === "--bounded-child"
    ? runBoundedChild(JSON.parse(process.argv[3] ?? "null") as unknown)
    : process.argv[2] === "--bounded-sync-bridge"
      ? runBoundedSyncBridge(JSON.parse(process.argv[3] ?? "null") as unknown)
      : main();
  void entry.catch((error) => {
    console.error(error instanceof Error ? error.message : "Guarded production release operation failed.");
    process.exitCode = 1;
  });
}

async function main() {
  const operation = requireOperation(process.argv[2]);
  const args = process.argv.slice(3);
  if (!args.includes("--confirm-production")) {
    throw new Error(`Production ${operation} requires --confirm-production.`);
  }
  const report = await runProductionReleaseOperation(operation, args);
  console.log(JSON.stringify({
    operation: report.operation,
    ok: report.ok,
    childStatus: report.childStatus,
    activeVersionBefore: report.activeVersionBefore,
    activeVersionAfter: report.activeVersionAfter,
    sourceFingerprintStable: report.sourceFingerprintStable,
    exclusionReleased: report.exclusionReleased,
    error: report.error,
  }, null, 2));
  if (!report.ok) process.exitCode = report.childStatus ?? 1;
}

export async function runProductionReleaseOperation(
  operation: ProductionReleaseOperationName,
  args: string[],
  options: {
    cwd?: string;
    backupDir?: string;
    readActiveVersion?: () => string;
  } = {},
) {
  assertProductionReleaseOperationAllowed(operation);
  if (operation === "apply-d1-runtime-migration-0017") {
    // This must happen before even a read-only remote topology query. The 0017
    // child has no supported passthrough flags, so malformed admission cannot
    // consume a D1/Workers request or reach the exclusion mutation.
    assertRuntimeMigration0017GuardedArguments(args);
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDir = path.resolve(options.backupDir ?? resolveBackupDir());
  const readActiveVersion = options.readActiveVersion ?? readSoleActiveWorkerVersion;
  const sourceFingerprintBefore = buildRepoSourceFingerprint(cwd);
  const runtimeMigration0017Release = operation === "apply-d1-runtime-migration-0017"
    ? assertRuntimeMigration0017ReleaseBeforeProductionLock({
        backupDir,
        cwd,
        sourceFingerprint: sourceFingerprintBefore,
      })
    : null;
  const activeVersionBefore = readActiveVersion();
  if (runtimeMigration0017Release) {
    assertRuntimeMigration0017LiveBaselineBeforeProductionLock({
      activeVersionId: activeVersionBefore,
      release: runtimeMigration0017Release,
    });
  }
  if (operation === "sync-topic-seeds") {
    assertTopicSequenceBeforeProductionLock({
      args,
      activeVersionId: activeVersionBefore,
      backupDir,
      cwd,
    });
  }
  const expectedActiveVersionAfter = operation === "rollback"
    ? parseRollbackArguments(args).targetVersionId
    : activeVersionBefore;
  let exclusion: ProductionValidationExclusion | null = null;
  let childStatus: number | null = null;
  let activeVersionAfter: string | null = null;
  let sourceFingerprintAfter: SourceFingerprint | null = null;
  let responseRecoveredByReadback = false;
  let operationError: unknown = null;

  try {
    assertNoLiveProductionValidationLock();
    exclusion = acquireProductionValidationExclusion({
      candidateVersionId:
        runtimeMigration0017Release?.targetCandidateVersionId ??
        activeVersionBefore,
      sourceFingerprintSha256: sourceFingerprintBefore.sha256,
    });
    exclusion = attestProductionValidationExclusion(exclusion);
    assertProductionValidationExclusionCommandWindow(exclusion);
    if (
      runtimeMigration0017Release &&
      exclusion.owner.candidateVersionId !==
        runtimeMigration0017Release.targetCandidateVersionId
    ) {
      throw new Error(
        "Production migration 0017 exclusion owner drifted from the canonical inactive candidate.",
      );
    }
    const lockedActiveVersion = readActiveVersion();
    if (lockedActiveVersion !== activeVersionBefore) {
      throw new Error(
        `Active Worker changed between ${operation} baseline and exclusion acquisition: expected ${activeVersionBefore}, received ${lockedActiveVersion}.`,
      );
    }
    assertSameSourceFingerprint(sourceFingerprintBefore, buildRepoSourceFingerprint(cwd));

    const actualCommand = productionReleaseOperationCommand(operation, args, cwd);
    const command = boundedReleaseChildCommand(actualCommand, cwd);
    const ownerAtChildStart = canonicalProductionValidationLockOwner(exclusion.owner);
    const childResult = await runChildWithExclusionHeartbeat({
      command: command.command,
      args: command.args,
      cwd,
      env: {
        ...commandEnv(),
        [PRODUCTION_RELEASE_OPERATION_ENV]: operation,
        [PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV]: ownerAtChildStart,
      },
      getExclusion: () => requireExclusion(exclusion),
      setExclusion: (value) => {
        exclusion = value;
      },
    });
    childStatus = childResult.status;
    if (childResult.error) throw childResult.error;

    exclusion = attestProductionValidationExclusion(requireExclusion(exclusion));
    activeVersionAfter = readActiveVersion();
    sourceFingerprintAfter = buildRepoSourceFingerprint(cwd);
    assertSameSourceFingerprint(sourceFingerprintBefore, sourceFingerprintAfter);
    if (activeVersionAfter !== expectedActiveVersionAfter) {
      throw new Error(
        `Production ${operation} expected active Worker ${expectedActiveVersionAfter}; received ${activeVersionAfter}.`,
      );
    }
    if (childStatus !== 0) {
      if (operation === "rollback") responseRecoveredByReadback = true;
      else throw new Error(`Production ${operation} child exited with status ${childStatus ?? "unknown"}.`);
    }
  } catch (error) {
    operationError = error;
  }

  if (!sourceFingerprintAfter) {
    try {
      sourceFingerprintAfter = buildRepoSourceFingerprint(cwd);
    } catch {
      sourceFingerprintAfter = null;
    }
  }
  if (!activeVersionAfter && exclusion) {
    try {
      exclusion = attestProductionValidationExclusion(exclusion);
      activeVersionAfter = readActiveVersion();
    } catch (error) {
      operationError = aggregateErrors(operationError, error, `Production ${operation} final active-version readback failed.`);
    }
  }

  let report = buildReport({
    operation,
    childStatus,
    responseRecoveredByReadback,
    activeVersionBefore,
    activeVersionAfter,
    expectedActiveVersionAfter,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    exclusionReleased: false,
    operationError,
  });
  let preliminaryReportError: unknown = null;
  try {
    writeReport(backupDir, report);
  } catch (error) {
    preliminaryReportError = error;
    operationError = aggregateErrors(
      operationError,
      error,
      `Production ${operation} report could not be written before exclusion release.`,
    );
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
    } catch (error) {
      releaseErrors.push(asError(error));
    }
    if (releaseErrors.length) {
      operationError = aggregateErrors(
        operationError,
        new AggregateError(releaseErrors, "Production release exclusion release failed."),
        `Production ${operation} final certification or exclusion release failed.`,
      );
    } else {
      report = { ...report, exclusionReleased: true };
    }
  }

  report = buildReport({
    operation,
    childStatus,
    responseRecoveredByReadback,
    activeVersionBefore,
    activeVersionAfter,
    expectedActiveVersionAfter,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    exclusionReleased: report.exclusionReleased,
    operationError,
  });
  try {
    writeReport(backupDir, report);
  } catch (error) {
    throw aggregateErrors(
      preliminaryReportError,
      error,
      `Production ${operation} final report could not be written; the exclusion release was still attempted.`,
    );
  }
  return report;
}

export function assertProductionReleaseOperationAllowed(
  operation: ProductionReleaseOperationName,
) {
  if (operation === "sync-site-translation-sources" && STANDALONE_SOURCE_SYNC_BLOCKED_FOR_ROLLOVER) {
    throw new Error(
      "Standalone production translation-source synchronization is blocked for the 2026-07-13 budget-rollover release; use the candidate-bound atomic translation repair.",
    );
  }
}

export function assertTopicSequenceBeforeProductionLock(
  input: {
    args: readonly string[];
    activeVersionId: string;
    backupDir: string;
    cwd: string;
  },
  dependencies: {
    readGitIdentity?: typeof assertGitReleaseIdentity;
    buildArtifactEvidence?: (cwd: string) => WorkerDeployArtifactEvidence;
    readUploadEvidence?: typeof readWorkerCandidateUploadEvidence;
    assertCurrentReleaseBinding?: (
      input: Parameters<typeof assertReleaseSequenceCurrentReleaseBinding>[0],
    ) => unknown;
    validateVectorizeReadiness?: (
      input: Parameters<typeof assertFreshProductionVectorizeReadiness>[0],
    ) => { createdAt: string };
  } = {},
) {
  const candidateVersionId = requireUniqueCandidateVersion(input.args);
  const backupDir = path.resolve(input.backupDir);
  const upload = (
    dependencies.readUploadEvidence ?? readWorkerCandidateUploadEvidence
  )(workerCandidateUploadEvidencePath(backupDir));
  if (upload.value.targetCandidateVersionId !== candidateVersionId) {
    throw new Error(
      `Topic reconciliation expected uploaded candidate ${candidateVersionId} before exclusion acquisition; canonical upload evidence names ${upload.value.targetCandidateVersionId}.`,
    );
  }
  if (upload.value.serviceBaselineVersionId !== input.activeVersionId) {
    throw new Error(
      `Topic reconciliation requires service baseline ${upload.value.serviceBaselineVersionId} alone at 100% before exclusion acquisition; received ${input.activeVersionId}.`,
    );
  }
  const readGitIdentity = dependencies.readGitIdentity ?? assertGitReleaseIdentity;
  const buildArtifactEvidence =
    dependencies.buildArtifactEvidence ?? buildWorkerDeployArtifactEvidence;
  const validateVectorizeReadiness =
    dependencies.validateVectorizeReadiness ?? assertFreshProductionVectorizeReadiness;
  const currentRelease: ReleaseSequenceCurrentRelease = {
    phase: "uploaded-inactive",
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    phaseEvidenceSha256: upload.sha256,
    phaseEvidenceCreatedAt: upload.value.createdAt,
    soleServingVersionId: upload.value.serviceBaselineVersionId,
    git: readGitIdentity({ cwd: path.resolve(input.cwd) }),
    artifactEvidence: buildArtifactEvidence(path.resolve(input.cwd)),
  };
  (
    dependencies.assertCurrentReleaseBinding ??
    assertReleaseSequenceCurrentReleaseBinding
  )({ backupDir, currentRelease });
  return validateVectorizeReadiness({
    backupDir,
    currentRelease,
    requiredPhase: "uploaded-inactive",
  });
}

export type RuntimeMigration0017ReleaseIdentity = Readonly<{
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
}>;

export function assertRuntimeMigration0017ReleaseBeforeProductionLock(
  input: Readonly<{
    backupDir: string;
    cwd: string;
    sourceFingerprint: SourceFingerprint;
  }>,
  dependencies: {
    readGitIdentity?: typeof assertGitReleaseIdentity;
    buildArtifactEvidence?: (cwd: string) => WorkerDeployArtifactEvidence;
    readUploadEvidence?: typeof readWorkerCandidateUploadEvidence;
    assertCurrentReleaseBinding?: (
      input: Parameters<typeof assertReleaseSequenceCurrentReleaseBinding>[0],
    ) => unknown;
  } = {},
): RuntimeMigration0017ReleaseIdentity {
  const backupDir = path.resolve(input.backupDir);
  const cwd = path.resolve(input.cwd);
  const upload = (
    dependencies.readUploadEvidence ?? readWorkerCandidateUploadEvidence
  )(workerCandidateUploadEvidencePath(backupDir));
  const git = (dependencies.readGitIdentity ?? assertGitReleaseIdentity)({ cwd });
  const artifactEvidence = (
    dependencies.buildArtifactEvidence ?? buildWorkerDeployArtifactEvidence
  )(cwd);
  if (
    artifactEvidence.sourceFingerprint.sha256 !== input.sourceFingerprint.sha256 ||
    artifactEvidence.sourceFingerprint.fileCount !== input.sourceFingerprint.fileCount
  ) {
    throw new Error(
      "Production migration 0017 source changed while validating its inactive upload before exclusion acquisition.",
    );
  }
  const currentRelease: ReleaseSequenceCurrentRelease = {
    phase: "uploaded-inactive",
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    phaseEvidenceSha256: upload.sha256,
    phaseEvidenceCreatedAt: upload.value.createdAt,
    soleServingVersionId: upload.value.serviceBaselineVersionId,
    git,
    artifactEvidence,
  };
  (
    dependencies.assertCurrentReleaseBinding ??
    assertReleaseSequenceCurrentReleaseBinding
  )({ backupDir, currentRelease });
  return Object.freeze({
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
  });
}

export function assertRuntimeMigration0017LiveBaselineBeforeProductionLock(
  input: Readonly<{
    activeVersionId: string;
    release: RuntimeMigration0017ReleaseIdentity;
  }>,
) {
  const activeVersionId = requireVersionId(input.activeVersionId);
  if (
    input.release.targetCandidateVersionId ===
      input.release.serviceBaselineVersionId ||
    activeVersionId !== input.release.serviceBaselineVersionId
  ) {
    throw new Error(
      `Production migration 0017 requires service baseline ${input.release.serviceBaselineVersionId} alone at 100% while canonical candidate ${input.release.targetCandidateVersionId} remains inactive; received ${activeVersionId}.`,
    );
  }
  return input.release;
}

export function productionReleaseOperationCommand(
  operation: ProductionReleaseOperationName,
  args: string[],
  cwd = process.cwd(),
) {
  if (operation === "rollback") {
    const rollback = parseRollbackArguments(args);
    return {
      command: path.resolve(cwd, "node_modules/.bin/wrangler"),
      args: [
        "rollback",
        rollback.targetVersionId,
        "--name",
        workerName,
        "--message",
        rollbackMessage,
      ],
    };
  }
  if (operation === "apply-d1-runtime-migration-0017") {
    assertRuntimeMigration0017GuardedArguments(args);
  }
  return {
    command: process.execPath,
    args: ["--import", "tsx", path.resolve(cwd, operationScripts[operation]), ...args],
  };
}

function assertRuntimeMigration0017GuardedArguments(args: readonly string[]) {
  if (args.length !== 1 || args[0] !== "--confirm-production") {
    throw new Error(
      "Production migration 0017 admission and apply are one guarded operation and accept only --confirm-production.",
    );
  }
}

export function boundedReleaseChildCommand(
  actualCommand: { command: string; args: string[] },
  cwd = process.cwd(),
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
  } = {},
) {
  const timeoutMs = requireBoundedChildTimeout(options.timeoutMs);
  const maxOutputBytes = requireBoundedChildOutputBytes(options.maxOutputBytes);
  return {
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      path.resolve(cwd, "scripts/cloudflare/run-production-release-operation.ts"),
      "--bounded-child",
      JSON.stringify(actualCommand),
      String(timeoutMs),
      String(maxOutputBytes),
    ],
  };
}

export function runBoundedReleaseChildSync(
  actualCommand: { command: string; args: string[] },
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    maxOutputBytes?: number;
    stdio?: "inherit" | "pipe";
    timeoutMs?: number;
  } = {},
) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const timeoutMs = requireBoundedChildTimeout(options.timeoutMs);
  const maxOutputBytes = requireBoundedChildOutputBytes(options.maxOutputBytes);
  const bounded = boundedReleaseChildCommand(actualCommand, cwd, {
    timeoutMs,
    maxOutputBytes,
  });
  const bridge = {
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      path.resolve(cwd, "scripts/cloudflare/run-production-release-operation.ts"),
      "--bounded-sync-bridge",
      JSON.stringify(bounded),
    ],
  };
  const result = spawnSync(bridge.command, bridge.args, {
    cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: maxOutputBytes + 1024 * 1024,
    stdio: options.stdio === "inherit" ? "inherit" : undefined,
    // The bridge creates the wrapper as a detached process-group leader. If
    // this synchronous parent is SIGKILLed, the bridge and bounded group keep
    // running only until the independent watchdog deadline. The outer timeout
    // is deliberately later so this caller cannot resume and release its lock
    // while the real mutation might still be alive.
    timeout: timeoutMs + boundedChildOuterTimeoutGraceMs,
    killSignal: "SIGKILL",
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

export function parseRollbackArguments(args: string[]) {
  const remaining = [...args];
  const confirmIndex = remaining.indexOf("--confirm-production");
  if (confirmIndex < 0) throw new Error("Guarded rollback requires --confirm-production.");
  remaining.splice(confirmIndex, 1);
  const targetIndex = remaining.indexOf("--target-version");
  if (targetIndex < 0 || targetIndex + 1 >= remaining.length) {
    throw new Error("Guarded rollback requires --target-version <version UUID>.");
  }
  const targetVersionId = requireVersionId(remaining[targetIndex + 1]);
  remaining.splice(targetIndex, 2);
  if (remaining.length) {
    throw new Error(`Guarded rollback received unsupported argument(s): ${remaining.join(", ")}.`);
  }
  return { targetVersionId };
}

function runChildWithExclusionHeartbeat(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  getExclusion: () => ProductionValidationExclusion;
  setExclusion: (value: ProductionValidationExclusion) => void;
}) {
  return new Promise<{ status: number | null; error: Error | null }>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: "inherit",
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolve({ status: null, error: asError(error) });
      return;
    }

    let heartbeatError: Error | null = null;
    const heartbeat = setInterval(() => {
      if (heartbeatError) return;
      try {
        const exclusion = attestProductionValidationExclusion(input.getExclusion());
        assertProductionValidationExclusionCommandWindow(exclusion);
        input.setExclusion(exclusion);
      } catch (error) {
        heartbeatError = asError(error);
        killChildProcessGroup(child);
      }
    }, heartbeatIntervalMs);
    heartbeat.unref();

    let interruptionError: Error | null = null;
    const onSignal = (signal: NodeJS.Signals) => {
      interruptionError = new Error(`Production release operation interrupted by ${signal}.`);
      killChildProcessGroup(child);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    let spawnError: Error | null = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (status) => {
      clearInterval(heartbeat);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve({
        status,
        error: heartbeatError ?? interruptionError ?? spawnError,
      });
    });
  });
}

async function runBoundedSyncBridge(value: unknown) {
  const command = parseBoundedChildCommand(value);
  const status = await new Promise<number>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command.command, command.args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
        detached: process.platform !== "win32",
      });
    } catch {
      resolve(1);
      return;
    }
    let spawnFailed = false;
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (code) => resolve(spawnFailed ? 1 : code ?? 1));
  });
  process.exitCode = status;
}

async function runBoundedChild(value: unknown) {
  const command = parseBoundedChildCommand(value);
  const timeoutMs = requireBoundedChildTimeout(parseIntegerArgument(process.argv[4]));
  const maxOutputBytes = requireBoundedChildOutputBytes(parseIntegerArgument(process.argv[5]));
  const groupPid = process.pid;
  const watchdogSource = String.raw`
import { spawnSync } from "node:child_process";
const [groupValue, timeoutValue] = process.argv.slice(1);
const groupPid = Number(groupValue);
const timeoutMs = Number(timeoutValue);
if (!Number.isSafeInteger(groupPid) || groupPid < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) process.exit(2);
setTimeout(() => {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(groupPid), "/t", "/f"], { stdio: "ignore" });
    } else process.kill(-groupPid, "SIGKILL");
  } catch {}
  process.exit(0);
}, timeoutMs);
`;
  const watchdog = await spawnReadyChild(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      watchdogSource,
      String(groupPid),
      String(timeoutMs),
    ],
    // Stay in the bounded child's process group. An intentional early group
    // kill must also remove the watchdog, avoiding a later reused-PGID kill;
    // if only the outer orchestrator dies, this group survives and the
    // watchdog still terminates it at the deadline.
    { detached: false, stdio: "ignore" },
    () => killOwnProcessGroup(groupPid),
  );
  watchdog.unref();

  let commandFinished = false;
  watchdog.once("exit", () => {
    if (!commandFinished) killOwnProcessGroup(groupPid);
  });
  if (watchdog.exitCode !== null || watchdog.signalCode !== null) {
    killOwnProcessGroup(groupPid);
  }
  const onRelayError = () => killOwnProcessGroup(groupPid);
  process.stdout.once("error", onRelayError);
  process.stderr.once("error", onRelayError);
  const status = await new Promise<number>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command.command, command.args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["inherit", "pipe", "pipe"],
        detached: false,
      });
    } catch {
      resolve(1);
      return;
    }
    let spawnFailed = false;
    let outputBytes = 0;
    let outputOverflow = false;
    const relay = (target: NodeJS.WriteStream, chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        outputOverflow = true;
        killOwnProcessGroup(groupPid);
        return;
      }
      try {
        target.write(chunk);
      } catch {
        killOwnProcessGroup(groupPid);
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => relay(process.stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => relay(process.stderr, chunk));
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (code) => resolve(spawnFailed || outputOverflow ? 1 : code ?? 1));
  });
  commandFinished = true;
  watchdog.kill("SIGKILL");
  process.stdout.off("error", onRelayError);
  process.stderr.off("error", onRelayError);
  process.exitCode = status;
}

function spawnReadyChild(
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
  onPostSpawnError: (error: Error) => void,
) {
  return new Promise<ChildProcess>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, options);
    } catch (error) {
      reject(error);
      return;
    }
    const onInitialError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    const onSpawn = () => {
      child.off("error", onInitialError);
      // Install the fail-closed lifetime handler before resolving readiness so
      // no post-spawn error gap can exist before the mutation is launched.
      child.on("error", onPostSpawnError);
      resolve(child);
    };
    child.once("error", onInitialError);
    child.once("spawn", onSpawn);
  });
}

function parseIntegerArgument(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function requireBoundedChildTimeout(value: number | undefined) {
  const timeoutMs = value ?? PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > PRODUCTION_VALIDATION_LOCK_MAX_PROTECTED_COMMAND_MS
  ) {
    throw new Error("Bounded production child timeout is outside the protected command window.");
  }
  return timeoutMs;
}

function requireBoundedChildOutputBytes(value: number | undefined) {
  const maxOutputBytes = value ?? defaultBoundedChildOutputBytes;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > defaultBoundedChildOutputBytes) {
    throw new Error("Bounded production child output limit is invalid.");
  }
  return maxOutputBytes;
}

function killOwnProcessGroup(groupPid: number) {
  try {
    if (process.platform !== "win32") process.kill(-groupPid, "SIGKILL");
    else spawnSync("taskkill", ["/pid", String(groupPid), "/t", "/f"], { stdio: "ignore" });
  } catch {
    process.exit(1);
  }
}

function parseBoundedChildCommand(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bounded production child command is malformed.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "args,command" ||
    typeof record.command !== "string" ||
    (!path.isAbsolute(record.command) && record.command !== "pnpm") ||
    !Array.isArray(record.args) ||
    record.args.length > 32 ||
    !record.args.every((argument) => typeof argument === "string" && argument.length <= 2_048)
  ) {
    throw new Error("Bounded production child command has the wrong contract.");
  }
  return { command: record.command, args: record.args as string[] };
}

function killChildProcessGroup(child: ChildProcess) {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function buildReport(input: {
  operation: ProductionReleaseOperationName;
  childStatus: number | null;
  responseRecoveredByReadback: boolean;
  activeVersionBefore: string;
  activeVersionAfter: string | null;
  expectedActiveVersionAfter: string;
  sourceFingerprintBefore: SourceFingerprint;
  sourceFingerprintAfter: SourceFingerprint | null;
  exclusionReleased: boolean;
  operationError: unknown;
}): ProductionReleaseOperationReport {
  const sourceFingerprintStable = input.sourceFingerprintAfter !== null &&
    sameSourceFingerprint(input.sourceFingerprintBefore, input.sourceFingerprintAfter);
  const ok = !input.operationError &&
    input.exclusionReleased &&
    sourceFingerprintStable &&
    input.activeVersionAfter === input.expectedActiveVersionAfter &&
    (input.childStatus === 0 || input.responseRecoveredByReadback);
  return {
    kind: "production-release-operation-v1",
    createdAt: new Date().toISOString(),
    operation: input.operation,
    ok,
    childStatus: input.childStatus,
    responseRecoveredByReadback: input.responseRecoveredByReadback,
    activeVersionBefore: input.activeVersionBefore,
    activeVersionAfter: input.activeVersionAfter,
    expectedActiveVersionAfter: input.expectedActiveVersionAfter,
    sourceFingerprintBefore: input.sourceFingerprintBefore,
    sourceFingerprintAfter: input.sourceFingerprintAfter,
    sourceFingerprintStable,
    exclusionReleased: input.exclusionReleased,
    ...(input.operationError ? { error: safeErrorMessage(input.operationError) } : {}),
  };
}

function writeReport(backupDir: string, report: ProductionReleaseOperationReport) {
  const file = path.join(cloudflareDir(backupDir), `production-release-${report.operation}.json`);
  if (fs.existsSync(file)) readPrivateJsonNoFollow(file);
  writePrivateJsonDurably(file, report, { replace: fs.existsSync(file) });
}

function requireOperation(value: string | undefined): ProductionReleaseOperationName {
  if (!value || !productionReleaseOperationNames.includes(value as ProductionReleaseOperationName)) {
    throw new Error(`Production release operation must be one of: ${productionReleaseOperationNames.join(", ")}.`);
  }
  return value as ProductionReleaseOperationName;
}

function requireVersionId(value: string | undefined) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("Worker version must be a lowercase UUID.");
  }
  return value;
}

function requireUniqueCandidateVersion(args: readonly string[]) {
  const positions = args
    .map((argument, index) => argument === "--candidate-version" ? index : -1)
    .filter((index) => index >= 0);
  if (positions.length !== 1) {
    throw new Error(
      "Topic reconciliation requires exactly one --candidate-version before exclusion acquisition.",
    );
  }
  return requireVersionId(args[positions[0]! + 1]);
}

function requireExclusion(value: ProductionValidationExclusion | null) {
  if (!value) throw new Error("Production release operation lost its exclusion state.");
  return value;
}

function assertSameSourceFingerprint(expected: SourceFingerprint, actual: SourceFingerprint) {
  if (!sameSourceFingerprint(expected, actual)) {
    throw new Error("Production release source changed while the shared exclusion was held.");
  }
}

function sameSourceFingerprint(left: SourceFingerprint, right: SourceFingerprint) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function aggregateErrors(left: unknown, right: unknown, message: string) {
  return new AggregateError(
    [left, right].filter((value): value is NonNullable<unknown> => value !== null && value !== undefined).map(asError),
    message,
  );
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error("Unknown production release operation failure.");
}

function safeErrorMessage(value: unknown) {
  if (value instanceof AggregateError) {
    return `${value.message}: ${value.errors.map(asError).map((error) => error.message).join("; ")}`.slice(0, 2_000);
  }
  return asError(value).message.slice(0, 2_000);
}
