import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cloudflareDir, runWrangler } from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import type {
  WorkerCandidateGitIdentity,
  WorkerVersionDeployOutputEvent,
  WorkerVersionUploadOutputEvent,
} from "./worker-candidate-release-evidence";

export const WORKER_CANDIDATE_UPLOAD_COMMAND_REPORT =
  "cloudflare/worker-candidate-upload-command-report.json";
export const WORKER_CANDIDATE_STAGING_COMMAND_REPORT =
  "cloudflare/worker-candidate-staging-command-report.json";
export const WORKER_CANDIDATE_ACTIVATION_COMMAND_REPORT =
  "cloudflare/worker-candidate-activation-command-report.json";
// Keep legacy consumers fail-closed on the activation command evidence path
// while they migrate to the stronger immutable activation evidence contract.
export const WORKER_DEPLOY_REPORT =
  WORKER_CANDIDATE_ACTIVATION_COMMAND_REPORT;
const WORKER_DEPLOY_NAME = "inspirlearning";
const WORKER_SOURCE_FILE = "cloudflare-worker.ts";
const WORKER_WRANGLER_CONFIG_FILE = "wrangler.jsonc";
const WORKER_STATIC_ASSET_ROOT = ".open-next/assets";

export type WorkerDeployMode =
  | "worker-candidate-upload"
  | "worker-candidate-staging"
  | "worker-candidate-activation";

export type WorkerDeployArtifactManifest = {
  root: string;
  fileCount: number;
  bytes: number;
  sha256: string;
};

export type WorkerDeployArtifactEvidence = {
  sourceFingerprint: SourceFingerprint;
  workerSourceSha256: string;
  wranglerConfigSha256: string;
  assetManifest: WorkerDeployArtifactManifest;
};

export type WorkerDeployArtifactEvidenceSummary = {
  sourceFingerprintSha256: string;
  workerSourceSha256: string;
  wranglerConfigSha256: string;
  assetManifest: WorkerDeployArtifactManifest;
};

export type ActiveWorkerDeploymentEvidence = {
  workerName: typeof WORKER_DEPLOY_NAME;
  versionId: string;
  percentage: 100;
  observedVersions: 1;
  readAt: string;
};

export type WorkerCommandOutputEvidence = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  event: WorkerVersionUploadOutputEvent | WorkerVersionDeployOutputEvent;
}>;

export type WorkerDeployEvidenceReport = {
  createdAt: string;
  startedAt: string;
  completedAt: string;
  backupDir: string;
  mode: WorkerDeployMode;
  command: string[];
  passthroughArgs: string[];
  ok: boolean;
  status: number | null;
  commandExecuted: boolean;
  deployPreflightOk?: boolean;
  deployPreflightStatus?: number | null;
  resourceBudgetOk?: boolean | null;
  scanBeforeOk: boolean | null;
  scanAfterOk: boolean | null;
  sourceFingerprintBefore: SourceFingerprint;
  sourceFingerprint?: SourceFingerprint;
  sourceFingerprintAfter: SourceFingerprint;
  sourceFingerprintStable: boolean;
  workerSourceSha256?: string;
  wranglerConfigSha256?: string;
  assetManifest?: WorkerDeployArtifactManifest;
  artifactEvidenceAfter?: WorkerDeployArtifactEvidenceSummary;
  artifactEvidenceStable: boolean | null;
  wranglerOutput?: WorkerCommandOutputEvidence;
  targetCandidateVersionId?: string;
  workerDeployPreparationSha256?: string;
  preActivationSealSha256?: string;
  git?: WorkerCandidateGitIdentity;
  activeDeployment?: ActiveWorkerDeploymentEvidence;
  expectedActiveVersionId?: string;
  activeDeploymentReadbackError?: string;
  wranglerOutputReadbackError?: string;
  artifactEvidenceError?: string;
  sourceFingerprintReadbackError?: string;
  blockedArgs?: string[];
  error?: string;
};

export type WorkerDeployEvidenceFinishInput = Pick<
  WorkerDeployEvidenceReport,
  | "commandExecuted"
  | "deployPreflightOk"
  | "deployPreflightStatus"
  | "resourceBudgetOk"
  | "scanBeforeOk"
  | "scanAfterOk"
  | "blockedArgs"
  | "expectedActiveVersionId"
  | "error"
>;

export type ActiveWorkerVersionReader = () => string;

export type WorkerDeployEvidenceSession = {
  captureCommandArtifacts: () => WorkerDeployArtifactEvidence;
  finish: (
    status: number | null,
    extra: WorkerDeployEvidenceFinishInput,
  ) => {
    status: number;
    report: WorkerDeployEvidenceReport;
    reportPath: string;
    reportSha256: string;
  };
};

export type CreateWorkerDeployEvidenceSessionOptions = {
  backupDir: string;
  mode: WorkerDeployMode;
  command: string[];
  passthroughArgs: string[];
  cwd?: string;
  readActiveWorkerVersion?: ActiveWorkerVersionReader;
  getWranglerOutputPath?: () => string | undefined;
  parseWranglerOutput?: (
    output: string,
  ) => WorkerVersionUploadOutputEvent | WorkerVersionDeployOutputEvent;
  getTargetCandidateVersionId?: () => string | undefined;
  getWorkerDeployPreparation?: () =>
    | Readonly<{
        sha256: string;
        git: WorkerCandidateGitIdentity;
      }>
    | undefined;
  getPreActivationSealSha256?: () => string | undefined;
  readCommand?: () => string[];
  now?: () => Date;
};

const MAX_WRANGLER_OUTPUT_BYTES = 64 * 1_024;

export function createPrivateWranglerOutputFile(
  backupDir: string,
  operation: WorkerDeployMode,
) {
  const directory = cloudflareDir(path.resolve(backupDir));
  const outputPath = path.join(
    directory,
    `wrangler-${operation}-${process.pid}-${crypto.randomUUID()}.jsonl`,
  );
  fs.writeFileSync(outputPath, "", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  fs.chmodSync(outputPath, 0o600);
  return outputPath;
}

export function readPrivateWranglerOutputFile(file: string) {
  const absolute = path.resolve(file);
  const before = lstatOrThrow(absolute, "Wrangler structured output");
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    (before.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Wrangler structured output must be an owner-only regular non-symlink file.",
    );
  }
  if (before.size <= 0 || before.size > MAX_WRANGLER_OUTPUT_BYTES) {
    throw new Error("Wrangler structured output has an invalid byte size.");
  }
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const descriptor = fs.openSync(
    absolute,
    fs.constants.O_RDONLY | noFollow,
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      (opened.mode & 0o077) !== 0
    ) {
      throw new Error(
        "Wrangler structured output changed while it was being opened.",
      );
    }
    const body = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size
    ) {
      throw new Error(
        "Wrangler structured output changed while it was being read.",
      );
    }
    const afterPath = lstatOrThrow(
      absolute,
      "Wrangler structured output",
    );
    if (
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      afterPath.dev !== opened.dev ||
      afterPath.ino !== opened.ino ||
      afterPath.size !== opened.size ||
      (afterPath.mode & 0o077) !== 0
    ) {
      throw new Error(
        "Wrangler structured output path changed while it was being read.",
      );
    }
    return {
      path: absolute,
      bytes: body.byteLength,
      sha256: sha256(body),
      output: body.toString("utf8"),
    } as const;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function buildWorkerDeployArtifactManifest(root: string): WorkerDeployArtifactManifest {
  const absoluteRoot = path.resolve(root);
  const rootStat = lstatOrThrow(absoluteRoot, "Worker Static Assets root");
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Worker Static Assets root must not be a symlink: ${absoluteRoot}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Worker Static Assets root is not a directory: ${absoluteRoot}`);
  }

  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const entryStat = lstatOrThrow(entryPath, "Worker Static Assets entry");
      if (entryStat.isSymbolicLink()) {
        throw new Error(`Worker Static Assets must not contain symlinks: ${entryPath}`);
      }
      if (entryStat.isDirectory()) visit(entryPath);
      else if (entryStat.isFile()) files.push(entryPath);
      else throw new Error(`Worker Static Assets contain an unsupported entry: ${entryPath}`);
    }
  };
  visit(absoluteRoot);
  files.sort(comparePortablePaths);
  if (!files.length) throw new Error("Worker Static Assets manifest must contain at least one file.");

  const aggregate = crypto.createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    const body = fs.readFileSync(file);
    const relative = portablePath(path.relative(absoluteRoot, file));
    const fileSha256 = sha256(body);
    bytes += body.byteLength;
    aggregate.update(relative);
    aggregate.update("\0");
    aggregate.update(String(body.byteLength));
    aggregate.update("\0");
    aggregate.update(fileSha256);
    aggregate.update("\n");
  }

  return {
    root: absoluteRoot,
    fileCount: files.length,
    bytes,
    sha256: aggregate.digest("hex"),
  };
}

export function buildWorkerDeployArtifactEvidence(cwd = process.cwd()): WorkerDeployArtifactEvidence {
  const absoluteCwd = path.resolve(cwd);
  const workerSource = readRequiredRegularFile(path.join(absoluteCwd, WORKER_SOURCE_FILE));
  const wranglerConfig = readRequiredRegularFile(path.join(absoluteCwd, WORKER_WRANGLER_CONFIG_FILE));
  return {
    sourceFingerprint: buildRepoSourceFingerprint(absoluteCwd),
    workerSourceSha256: sha256(workerSource),
    wranglerConfigSha256: sha256(wranglerConfig),
    assetManifest: buildWorkerDeployArtifactManifest(path.join(absoluteCwd, WORKER_STATIC_ASSET_ROOT)),
  };
}

export function assertWorkerDeployArtifactEvidenceUnchanged(
  expected: WorkerDeployArtifactEvidence,
  cwd = process.cwd(),
) {
  const current = buildWorkerDeployArtifactEvidence(cwd);
  if (!sameArtifactEvidence(expected, current)) {
    throw new Error("Worker deploy source, configuration, or Static Assets changed after lock acquisition.");
  }
  return current;
}

export function parseSoleActiveWorkerVersion(output: string) {
  const parsed = parseJsonContainer(output);
  const deployment = objectRecord(parsed);
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : null;
  if (!versions || versions.length !== 1) {
    throw new Error("Worker deployment readback did not contain exactly one active version.");
  }
  const active = objectRecord(versions[0]);
  const versionId = active?.version_id;
  if (active?.percentage !== 100 || typeof versionId !== "string" || !isWorkerVersionUuid(versionId)) {
    throw new Error("Worker deployment readback did not contain one valid version UUID at exactly 100% traffic.");
  }
  return versionId;
}

export function readSoleActiveWorkerVersion(
  runner: (args: string[]) => string = (args) => runWrangler(args),
) {
  return parseSoleActiveWorkerVersion(
    runner(["deployments", "status", "--name", WORKER_DEPLOY_NAME, "--json"]),
  );
}

export function createWorkerDeployEvidenceSession(
  options: CreateWorkerDeployEvidenceSessionOptions,
): WorkerDeployEvidenceSession {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const now = options.now ?? (() => new Date());
  const readActiveWorkerVersion = options.readActiveWorkerVersion ?? (() => readSoleActiveWorkerVersion());
  const startedAt = now().toISOString();
  const sourceFingerprintBefore = buildRepoSourceFingerprint(cwd);
  let commandArtifacts: WorkerDeployArtifactEvidence | null = null;

  return {
    captureCommandArtifacts() {
      if (commandArtifacts) throw new Error("Worker deploy artifact evidence was already captured.");
      commandArtifacts = buildWorkerDeployArtifactEvidence(cwd);
      return commandArtifacts;
    },
    finish(status, extra) {
      let wranglerOutput: WorkerCommandOutputEvidence | undefined;
      let wranglerOutputReadbackError: string | undefined;
      if (status === 0 && extra.commandExecuted) {
        try {
          const outputPath = options.getWranglerOutputPath?.();
          if (!outputPath || !options.parseWranglerOutput) {
            throw new Error(
              "Worker candidate command omitted its private Wrangler structured output contract.",
            );
          }
          const privateOutput = readPrivateWranglerOutputFile(outputPath);
          const event = options.parseWranglerOutput(privateOutput.output);
          if (
            event.workerName !== WORKER_DEPLOY_NAME ||
            (options.mode === "worker-candidate-upload" &&
              event.type !== "version-upload") ||
            (options.mode !== "worker-candidate-upload" &&
              event.type !== "version-deploy")
          ) {
            throw new Error(
              "Wrangler structured output described the wrong Worker operation.",
            );
          }
          wranglerOutput = {
            path: privateOutput.path,
            bytes: privateOutput.bytes,
            sha256: privateOutput.sha256,
            event,
          };
        } catch (error) {
          wranglerOutputReadbackError = summarizeEvidenceError(error);
        }
      }
      let activeDeployment: ActiveWorkerDeploymentEvidence | undefined;
      let activeDeploymentReadbackError: string | undefined;
      const configuredTargetCandidateVersionId =
        options.getTargetCandidateVersionId?.();
      const targetCandidateVersionId =
        configuredTargetCandidateVersionId ??
        (wranglerOutput?.event.type === "version-upload"
          ? wranglerOutput.event.versionId
          : undefined);
      const workerDeployPreparation =
        options.getWorkerDeployPreparation?.();
      const preActivationSealSha256 =
        options.getPreActivationSealSha256?.();
      if (
        options.mode === "worker-candidate-activation" &&
        status === 0 &&
        extra.commandExecuted
      ) {
        try {
          const versionId = readActiveWorkerVersion();
          if (!isWorkerVersionUuid(versionId)) {
            throw new Error("Active Worker version readback returned an invalid UUID.");
          }
          if (
            targetCandidateVersionId !== undefined &&
            (
              !isWorkerVersionUuid(targetCandidateVersionId) ||
              versionId !== targetCandidateVersionId
            )
          ) {
            throw new Error(
              "Active Worker version does not match the attested activation candidate.",
            );
          }
          if (
            extra.expectedActiveVersionId !== undefined &&
            (
              !isWorkerVersionUuid(extra.expectedActiveVersionId) ||
              versionId !== extra.expectedActiveVersionId
            )
          ) {
            throw new Error("Active Worker version changed before deploy evidence promotion.");
          }
          activeDeployment = {
            workerName: WORKER_DEPLOY_NAME,
            versionId,
            percentage: 100,
            observedVersions: 1,
            readAt: now().toISOString(),
          };
        } catch (error) {
          activeDeploymentReadbackError = summarizeEvidenceError(error);
        }
      }

      // Hash again only after the remote readback finishes, so the final local
      // evidence represents the files that still exist when the report closes.
      const sourceFingerprintAfterResult = tryBuildSourceFingerprint(cwd);
      const sourceFingerprintAfter = sourceFingerprintAfterResult.value ?? emptySourceFingerprint();
      const sourceFingerprintStable =
        sourceFingerprintAfterResult.value !== null &&
        sourceFingerprintBefore.sha256 === sourceFingerprintAfter.sha256 &&
        (commandArtifacts === null || commandArtifacts.sourceFingerprint.sha256 === sourceFingerprintAfter.sha256);
      const artifactAfterResult = commandArtifacts ? tryBuildArtifactEvidence(cwd) : null;
      const artifactEvidenceAfter = artifactAfterResult?.value
        ? summarizeArtifactEvidence(artifactAfterResult.value)
        : undefined;
      const artifactEvidenceStable = commandArtifacts
        ? artifactAfterResult !== null &&
          artifactAfterResult.value !== null &&
          sameArtifactEvidence(commandArtifacts, artifactAfterResult.value)
        : null;
      const completedAt = now().toISOString();

      const artifactEvidenceError =
        commandArtifacts === null
          ? status === 0 && extra.commandExecuted
            ? "Worker deploy artifact evidence was not captured before the command."
            : undefined
          : artifactAfterResult?.error;
      const report: WorkerDeployEvidenceReport = {
        createdAt: completedAt,
        startedAt,
        completedAt,
        backupDir: options.backupDir,
        mode: options.mode,
        command: options.readCommand?.() ?? options.command,
        passthroughArgs: options.passthroughArgs,
        ok:
          status === 0 &&
          extra.commandExecuted === true &&
          (options.mode !== "worker-candidate-activation" ||
            extra.deployPreflightOk === true) &&
          extra.resourceBudgetOk === true &&
          extra.scanBeforeOk === true &&
          sourceFingerprintStable &&
          commandArtifacts !== null &&
          artifactEvidenceStable === true &&
          wranglerOutput !== undefined &&
          targetCandidateVersionId !== undefined &&
          workerDeployPreparation !== undefined &&
          !extra.error &&
          (options.mode !== "worker-candidate-activation" ||
            (activeDeployment !== undefined &&
              preActivationSealSha256 !== undefined &&
              /^[a-f0-9]{64}$/.test(preActivationSealSha256))),
        status,
        sourceFingerprintBefore,
        ...(commandArtifacts
          ? {
              sourceFingerprint: commandArtifacts.sourceFingerprint,
              workerSourceSha256: commandArtifacts.workerSourceSha256,
              wranglerConfigSha256: commandArtifacts.wranglerConfigSha256,
              assetManifest: commandArtifacts.assetManifest,
            }
          : {}),
        sourceFingerprintAfter,
        sourceFingerprintStable,
        artifactEvidenceAfter,
        artifactEvidenceStable,
        ...(wranglerOutput ? { wranglerOutput } : {}),
        ...(targetCandidateVersionId
          ? { targetCandidateVersionId }
          : {}),
        ...(workerDeployPreparation
          ? {
              workerDeployPreparationSha256:
                workerDeployPreparation.sha256,
              git: workerDeployPreparation.git,
            }
          : {}),
        ...(preActivationSealSha256
          ? { preActivationSealSha256 }
          : {}),
        ...(activeDeployment ? { activeDeployment } : {}),
        ...(activeDeploymentReadbackError ? { activeDeploymentReadbackError } : {}),
        ...(wranglerOutputReadbackError ? { wranglerOutputReadbackError } : {}),
        ...(artifactEvidenceError ? { artifactEvidenceError } : {}),
        ...(sourceFingerprintAfterResult.error
          ? { sourceFingerprintReadbackError: sourceFingerprintAfterResult.error }
          : {}),
        ...extra,
      };
      const written = writeWorkerDeployEvidenceReport(report);
      return {
        status: report.ok ? 0 : status === 0 ? 1 : status ?? 1,
        report,
        reportPath: written.path,
        reportSha256: written.sha256,
      };
    },
  };
}

function writeWorkerDeployEvidenceReport(report: WorkerDeployEvidenceReport) {
  const reportName =
    report.mode === "worker-candidate-upload"
      ? WORKER_CANDIDATE_UPLOAD_COMMAND_REPORT
      : report.mode === "worker-candidate-staging"
        ? WORKER_CANDIDATE_STAGING_COMMAND_REPORT
        : WORKER_CANDIDATE_ACTIVATION_COMMAND_REPORT;
  const outputPath = path.join(
    cloudflareDir(report.backupDir),
    path.basename(reportName),
  );
  const temporaryPath = `${outputPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const payload = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  try {
    fs.writeFileSync(temporaryPath, payload, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, outputPath);
    fs.chmodSync(outputPath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return { path: outputPath, sha256: sha256(payload) } as const;
}

function tryBuildSourceFingerprint(cwd: string) {
  try {
    return { value: buildRepoSourceFingerprint(cwd), error: undefined };
  } catch (error) {
    return { value: null, error: summarizeEvidenceError(error) };
  }
}

function tryBuildArtifactEvidence(cwd: string) {
  try {
    return { value: buildWorkerDeployArtifactEvidence(cwd), error: undefined };
  } catch (error) {
    return { value: null, error: summarizeEvidenceError(error) };
  }
}

function summarizeArtifactEvidence(evidence: WorkerDeployArtifactEvidence): WorkerDeployArtifactEvidenceSummary {
  return {
    sourceFingerprintSha256: evidence.sourceFingerprint.sha256,
    workerSourceSha256: evidence.workerSourceSha256,
    wranglerConfigSha256: evidence.wranglerConfigSha256,
    assetManifest: evidence.assetManifest,
  };
}

function sameArtifactEvidence(left: WorkerDeployArtifactEvidence, right: WorkerDeployArtifactEvidence) {
  return (
    left.sourceFingerprint.sha256 === right.sourceFingerprint.sha256 &&
    left.workerSourceSha256 === right.workerSourceSha256 &&
    left.wranglerConfigSha256 === right.wranglerConfigSha256 &&
    left.assetManifest.root === right.assetManifest.root &&
    left.assetManifest.fileCount === right.assetManifest.fileCount &&
    left.assetManifest.bytes === right.assetManifest.bytes &&
    left.assetManifest.sha256 === right.assetManifest.sha256
  );
}

function parseJsonContainer(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start < 0 || end <= start) {
      throw new Error("Worker deployment readback was not valid JSON.");
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      throw new Error("Worker deployment readback was not valid JSON.");
    }
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isWorkerVersionUuid(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}

function lstatOrThrow(filePath: string, label: string) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${filePath}`, { cause: error });
  }
}

function readRequiredRegularFile(filePath: string) {
  const stat = lstatOrThrow(filePath, "Worker deploy source file");
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Worker deploy source must be a regular non-symlink file: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

function comparePortablePaths(left: string, right: string) {
  const portableLeft = portablePath(left);
  const portableRight = portablePath(right);
  return portableLeft < portableRight ? -1 : portableLeft > portableRight ? 1 : 0;
}

function portablePath(value: string) {
  return value.split(path.sep).join("/");
}

function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function summarizeEvidenceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, 1_000);
}

function emptySourceFingerprint(): SourceFingerprint {
  return { sha256: "", fileCount: 0, files: [] };
}
