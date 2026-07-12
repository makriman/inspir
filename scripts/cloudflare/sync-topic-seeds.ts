import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { topicSeeds, type TopicSeed } from "@/lib/content/topics";
import {
  assertD1FreeDailyBudget,
  loadAccountD1DailyUsage,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  reserveD1ReleaseBudget,
  type D1ReleaseBudgetReservationResult,
} from "./d1-release-budget-ledger";
import {
  assertGitReleaseIdentity,
  type GitReleaseIdentity,
} from "./git-release-identity";
import {
  cloudflareDir,
  createHash,
  D1_DATABASE_NAME,
  parseD1TimeTravelBookmark,
  resolveBackupDir,
  runWrangler,
  stableStringify,
  type WranglerRunner,
} from "./migration-config";
import {
  readPrivateWorkerDeployEvidence,
  validateWorkerDeployEvidenceForRepair,
  type WorkerDeployRepairEvidence,
} from "./repair-seo-cta-translations";
import {
  WORKER_DEPLOY_REPORT,
  buildWorkerDeployArtifactEvidence,
  readSoleActiveWorkerVersion,
  type WorkerDeployArtifactEvidence,
} from "./worker-deploy-evidence";
import { assertProductionReleaseChildExclusion } from "./production-validation-lock";

type SyncMode = "local" | "remote";

export type TopicSeedSnapshotRow = {
  id: string;
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
  systemPrompt: string;
  iconUrl: string | null;
  sortOrder: number;
  status: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
};

export type TopicSeedSnapshot = {
  topics: Record<string, TopicSeedSnapshotRow>;
  metadata: Record<string, { value: string; updatedAt: number | null }>;
  billedRowReads: number;
};

export type TopicSeedD1Projection = {
  logicalRowWrites: number;
  projectedBilledRowWrites: number;
  projectedBilledRowReads: number;
  archiveSlugs: readonly string[];
};

export type TopicSeedReleaseGatePhase =
  | "before-first-d1-query"
  | "immediately-before-import";

export type TopicSeedReleaseIdentity = {
  candidateVersionId: string;
  activeVersionId: string;
  gitHead: string;
  gitUpstream: string;
  gitUpstreamRef: string;
  sourceFingerprintSha256: string;
  sourceFingerprintFileCount: number;
  topicSeedSha256: string;
  workerSourceSha256: string;
  wranglerConfigSha256: string;
  assetManifestSha256: string;
  assetManifestFileCount: number;
  assetManifestBytes: number;
  workerDeployReportPath: string;
  workerDeployEvidenceCreatedAt: string;
};

export type TopicSeedReleaseGateInput = {
  phase: TopicSeedReleaseGatePhase;
  backupDir: string;
  candidateVersionId: string;
  topicSeedSha256: string;
  cwd: string;
  runner: WranglerRunner;
};

export type TopicSeedReleaseGate = (
  input: TopicSeedReleaseGateInput,
) => TopicSeedReleaseIdentity;

export type TopicSeedReleaseGateDependencies = {
  readGitIdentity?: (cwd: string) => GitReleaseIdentity;
  buildArtifactEvidence?: (cwd: string) => WorkerDeployArtifactEvidence;
  readDeployReport?: (reportPath: string) => unknown;
  validateDeployEvidence?: typeof validateWorkerDeployEvidenceForRepair;
  readActiveVersion?: (runner: WranglerRunner) => string;
};

export type TopicSeedSyncReport = {
  createdAt: string;
  mode: SyncMode;
  database: string;
  topics: number;
  sha256: string;
  managedSlugs: number;
  retiredManagedSlugs: readonly string[];
  batches: 1;
  atomicFileBytes: number;
  atomicSqlSha256: string;
  atomicSqlStatements: number;
  logicalRowWrites: number;
  projectedBilledRowWrites: number;
  projectedBilledRowWriteLimit: number;
  projectedBilledRowReads: number;
  projectedBilledRowReadLimit: number;
  timeTravelVerified: boolean;
  timeTravelBookmark?: string;
  preWriteEvidencePath?: string;
  importAttempted: boolean;
  importResponseConfirmed: boolean;
  importVerification: "verified";
  responseRecoveredByVerification: boolean;
  verifiedTopics: number;
  verifiedArchivedTopics: number;
  accountDailyUsage?: D1DailyUsage;
  releaseIdentity?: TopicSeedReleaseIdentity;
  releaseBudgetReservation?: D1ReleaseBudgetReservationResult;
  ok: boolean;
};

export type TopicSeedSyncOptions = {
  confirmed?: boolean;
  now?: number;
  runner?: WranglerRunner;
  seeds?: readonly TopicSeed[];
  dailyUsage?: D1DailyUsage;
  candidateVersion?: string;
  cwd?: string;
  releaseGate?: TopicSeedReleaseGate;
  clock?: () => Date;
};

const managedSlugsMetadataKey = "topic_seed_slugs";
const seedHashMetadataKey = "topic_seed_hash";
const retiredManagedTopicSlugs = ["ai-game-arena"] as const;
const topicSeedBatchSize = 12;
const maximumD1SqlStatementBytes = 100_000;
const projectedBilledWritesPerLogicalRow = 3;
const topicSnapshotKeys = [
  "id",
  "slug",
  "name",
  "subText",
  "description",
  "inputboxText",
  "systemPrompt",
  "iconUrl",
  "sortOrder",
  "status",
  "metadata",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof TopicSeedSnapshotRow)[];

// Reserve half of each Workers Free daily allowance for live application traffic
// and unrelated release work. The read projection includes snapshots,
// reconciliation, indexed UPSERT lookups, and exact verification headroom.
const MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_WRITES = 50_000;
export const MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS = 2_500_000;

if (isMainModule()) void main();

function main() {
  const mode: SyncMode = process.argv.includes("--remote") ? "remote" : "local";
  const confirmed = process.argv.includes("--confirm-production");
  if (mode === "remote") {
    if (!confirmed) {
      throw new Error("Remote topic seed synchronization requires --confirm-production.");
    }
    assertProductionReleaseChildExclusion("sync-topic-seeds");
  }
  const report = syncTopicSeeds(mode, resolveBackupDir(), {
    confirmed,
    candidateVersion: getArg("--candidate-version"),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

/**
 * Synchronize curated topics from an explicit setup/deploy command. Runtime
 * requests only read D1 and never perform this write-heavy initialization.
 */
export function syncTopicSeeds(
  mode: SyncMode = "local",
  backupDir = resolveBackupDir(),
  options: TopicSeedSyncOptions = {},
) {
  if (mode === "remote" && !options.confirmed) {
    throw new Error("Remote topic seed synchronization requires --confirm-production.");
  }

  const runner = options.runner ?? runWrangler;
  const seeds = options.seeds ?? topicSeeds;
  const now = options.now ?? Date.now();
  const clock =
    options.clock ??
    (options.now === undefined ? () => new Date() : () => new Date(now));
  const sha256 = topicSeedHash(seeds);
  const sql = buildTopicSeedSql(seeds, now, sha256);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const candidateVersionId =
    mode === "remote" ? requireWorkerVersion(options.candidateVersion) : undefined;
  const releaseGate = options.releaseGate ?? assertRemoteTopicSeedReleaseGate;
  const releaseIdentity = candidateVersionId
    ? validateTopicSeedReleaseIdentity(
        releaseGate({
          phase: "before-first-d1-query",
          backupDir,
          candidateVersionId,
          topicSeedSha256: sha256,
          cwd,
          runner,
        }),
        candidateVersionId,
        sha256,
      )
    : undefined;
  const accountDailyUsage =
    mode === "remote"
      ? options.dailyUsage ?? loadAccountD1DailyUsage(new Date(now), runner, clock)
      : undefined;
  const releaseOperationId = candidateVersionId
    ? topicSeedReleaseOperationId(candidateVersionId, sha256)
    : undefined;
  let releaseBudgetReservation: D1ReleaseBudgetReservationResult | undefined;
  if (accountDailyUsage) {
    // The first gate runs before any D1 SQL. Unknown production cardinality is
    // represented by the operation's full reserved cap; the exact projection
    // is checked again after the read-only snapshot.
    assertD1FreeDailyBudget(accountDailyUsage, {
      operation: "Remote topic seed synchronization preflight",
      rowsRead: MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS,
      rowsWritten: MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_WRITES,
    });
    const identity = requireTopicSeedReleaseIdentity(releaseIdentity);
    releaseBudgetReservation = reserveD1ReleaseBudget({
      backupDir,
      operationId: requireTopicSeedReleaseOperationId(releaseOperationId),
      operation: "Remote topic seed synchronization",
      sourceFingerprint: topicSeedSourceIdentity(identity),
      candidateVersionId: identity.candidateVersionId,
      phase: "maximum",
      rowsRead: MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS,
      rowsWritten: MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_WRITES,
      observedUsage: accountDailyUsage,
      now: clock(),
    });
  }
  const before = readTopicSeedSnapshot(mode, runner);
  const projection = projectTopicSeedD1Usage(seeds, before);
  assertTopicSeedD1Budget(projection);
  if (accountDailyUsage) {
    assertD1FreeDailyBudget(accountDailyUsage, {
      operation: "Remote topic seed synchronization",
      rowsRead: projection.projectedBilledRowReads,
      rowsWritten: projection.projectedBilledRowWrites,
    });
    const identity = requireTopicSeedReleaseIdentity(releaseIdentity);
    releaseBudgetReservation = reserveD1ReleaseBudget({
      backupDir,
      operationId: requireTopicSeedReleaseOperationId(releaseOperationId),
      operation: "Remote topic seed synchronization",
      sourceFingerprint: topicSeedSourceIdentity(identity),
      candidateVersionId: identity.candidateVersionId,
      phase: "exact",
      rowsRead: projection.projectedBilledRowReads,
      rowsWritten: projection.projectedBilledRowWrites,
      observedUsage: accountDailyUsage,
      now: clock(),
      expectedUtcDay: requireTopicSeedBudgetReservation(releaseBudgetReservation).utcDay,
    });
  }

  let timeTravelBookmark: string | undefined;
  let preWriteEvidencePath: string | undefined;
  if (mode === "remote") {
    timeTravelBookmark = parseD1TimeTravelBookmark(
      runner(["d1", "time-travel", "info", D1_DATABASE_NAME, "--json"]),
    );
    preWriteEvidencePath = writeTopicSeedPreWriteDiagnosticEvidence({
      backupDir,
      bookmark: timeTravelBookmark,
      sql,
      projection,
      topics: seeds.length,
      seedSha256: sha256,
      releaseIdentity: requireTopicSeedReleaseIdentity(releaseIdentity),
      releaseBudgetReservation: requireTopicSeedBudgetReservation(
        releaseBudgetReservation,
      ),
      now,
    });
  }

  let importAttempted = false;
  let importResponseConfirmed = false;
  let importTransportError: unknown;
  const sqlPath = writeTemporaryTopicSeedSql(sql);
  try {
    if (candidateVersionId) {
      const beforeImportIdentity = validateTopicSeedReleaseIdentity(
        releaseGate({
          phase: "immediately-before-import",
          backupDir,
          candidateVersionId,
          topicSeedSha256: sha256,
          cwd,
          runner,
        }),
        candidateVersionId,
        sha256,
      );
      assertStableTopicSeedReleaseIdentity(
        requireTopicSeedReleaseIdentity(releaseIdentity),
        beforeImportIdentity,
      );
      const exactBudget = requireTopicSeedBudgetReservation(releaseBudgetReservation);
      releaseBudgetReservation = assertD1ReleaseBudgetReservation({
        ledgerPath: exactBudget.ledgerPath,
        utcDay: exactBudget.utcDay,
        operationId: requireTopicSeedReleaseOperationId(releaseOperationId),
        sourceFingerprint: topicSeedSourceIdentity(beforeImportIdentity),
        candidateVersionId: beforeImportIdentity.candidateVersionId,
        phase: "exact",
        rowsRead: projection.projectedBilledRowReads,
        rowsWritten: projection.projectedBilledRowWrites,
        now: clock(),
      });
      assertD1ReleaseBudgetUtcDay(exactBudget.utcDay, clock());
    }
    // Wrangler uploads this one file as one D1-owned transaction. The file may
    // exceed 100 KB; D1's 100 KB limit applies to each statement, not the file.
    importAttempted = true;
    try {
      runner([
        "d1",
        "execute",
        D1_DATABASE_NAME,
        mode === "remote" ? "--remote" : "--local",
        "--file",
        sqlPath,
        "--yes",
      ]);
      importResponseConfirmed = true;
    } catch (error) {
      // A lost Wrangler poll response does not prove that D1 rejected the
      // transaction. Exact verification below is authoritative.
      importTransportError = error;
    }
  } finally {
    fs.rmSync(path.dirname(sqlPath), { force: true, recursive: true });
  }

  let after: TopicSeedSnapshot;
  try {
    after = readTopicSeedSnapshot(mode, runner);
  } catch (verificationError) {
    throw new AggregateError(
      [importTransportError, verificationError].filter(
        (error): error is NonNullable<unknown> => error !== undefined,
      ),
      "Topic seed synchronization outcome is indeterminate; no success report was written. Use the fsynced Time Travel diagnostic evidence to prepare a reviewed forward correction.",
    );
  }

  let verification: ReturnType<typeof verifyTopicSeedSnapshot>;
  try {
    verification = verifyTopicSeedSnapshot(after, before, seeds, now, sha256);
  } catch (verificationError) {
    throw new AggregateError(
      [importTransportError, verificationError].filter(
        (error): error is NonNullable<unknown> => error !== undefined,
      ),
      "Topic seed synchronization failed exact verification. Destructive whole-database restore is unsupported on Free; use a reviewed forward correction.",
    );
  }

  const report: TopicSeedSyncReport = {
    createdAt: new Date(now).toISOString(),
    mode,
    database: D1_DATABASE_NAME,
    topics: seeds.length,
    sha256,
    managedSlugs: seeds.length,
    retiredManagedSlugs: retiredManagedTopicSlugs,
    batches: 1,
    atomicFileBytes: Buffer.byteLength(sql, "utf8"),
    atomicSqlSha256: createHash().update(sql).digest("hex"),
    atomicSqlStatements: countTopicSeedSqlStatements(sql),
    logicalRowWrites: projection.logicalRowWrites,
    projectedBilledRowWrites: projection.projectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_WRITES,
    projectedBilledRowReads: projection.projectedBilledRowReads,
    projectedBilledRowReadLimit: MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS,
    timeTravelVerified: Boolean(timeTravelBookmark),
    timeTravelBookmark,
    preWriteEvidencePath,
    importAttempted,
    importResponseConfirmed,
    importVerification: "verified",
    responseRecoveredByVerification: importAttempted && !importResponseConfirmed,
    verifiedTopics: verification.verifiedTopics,
    verifiedArchivedTopics: verification.verifiedArchivedTopics,
    accountDailyUsage,
    releaseIdentity,
    releaseBudgetReservation,
    ok: seeds.length > 0,
  };
  fs.writeFileSync(
    path.join(cloudflareDir(backupDir), `topic-seeds-${mode}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  return report;
}

export function assertRemoteTopicSeedReleaseGate(
  input: TopicSeedReleaseGateInput,
  dependencies: TopicSeedReleaseGateDependencies = {},
): TopicSeedReleaseIdentity {
  const candidateVersionId = requireWorkerVersion(input.candidateVersionId);
  if (!/^[a-f0-9]{64}$/.test(input.topicSeedSha256)) {
    throw new Error("Remote topic synchronization requires a valid topic seed hash.");
  }
  const cwd = path.resolve(input.cwd);
  const backupDir = path.resolve(input.backupDir);
  const readGitIdentity =
    dependencies.readGitIdentity ?? ((gitCwd: string) => assertGitReleaseIdentity({ cwd: gitCwd }));
  const buildArtifactEvidence =
    dependencies.buildArtifactEvidence ?? buildWorkerDeployArtifactEvidence;
  const readDeployReport = dependencies.readDeployReport ?? readPrivateWorkerDeployEvidence;
  const validateDeployEvidence =
    dependencies.validateDeployEvidence ?? validateWorkerDeployEvidenceForRepair;
  const readActiveVersion =
    dependencies.readActiveVersion ??
    ((runner: WranglerRunner) => readSoleActiveWorkerVersion((args) => runner(args)));

  const gitBefore = readGitIdentity(cwd);
  const artifactBefore = buildArtifactEvidence(cwd);
  const workerDeployReportPath = path.resolve(backupDir, WORKER_DEPLOY_REPORT);
  const workerDeployReport = readDeployReport(workerDeployReportPath);
  const deployEvidenceBefore = validateDeployEvidence({
    report: workerDeployReport,
    backupDir,
    candidateVersionId,
    currentArtifactEvidence: artifactBefore,
  });
  const firstActiveVersion = readActiveVersion(input.runner);
  if (firstActiveVersion !== candidateVersionId) {
    throw new Error(
      `Remote topic synchronization expected candidate ${candidateVersionId} at 100% traffic; received ${firstActiveVersion}.`,
    );
  }

  const gitAfter = readGitIdentity(cwd);
  const artifactAfter = buildArtifactEvidence(cwd);
  const deployEvidenceAfter = validateDeployEvidence({
    report: workerDeployReport,
    backupDir,
    candidateVersionId,
    currentArtifactEvidence: artifactAfter,
  });
  assertStableGitReleaseIdentity(gitBefore, gitAfter);
  assertStableWorkerArtifactEvidence(artifactBefore, artifactAfter);
  assertStableWorkerDeployRepairEvidence(deployEvidenceBefore, deployEvidenceAfter);

  const activeVersionId = readActiveVersion(input.runner);
  if (activeVersionId !== candidateVersionId) {
    throw new Error(
      `Remote topic synchronization candidate changed during ${input.phase}: expected ${candidateVersionId}, received ${activeVersionId}.`,
    );
  }
  return {
    candidateVersionId,
    activeVersionId,
    gitHead: gitAfter.head,
    gitUpstream: gitAfter.upstream,
    gitUpstreamRef: gitAfter.upstreamRef,
    sourceFingerprintSha256: artifactAfter.sourceFingerprint.sha256,
    sourceFingerprintFileCount: artifactAfter.sourceFingerprint.fileCount,
    topicSeedSha256: input.topicSeedSha256,
    workerSourceSha256: artifactAfter.workerSourceSha256,
    wranglerConfigSha256: artifactAfter.wranglerConfigSha256,
    assetManifestSha256: artifactAfter.assetManifest.sha256,
    assetManifestFileCount: artifactAfter.assetManifest.fileCount,
    assetManifestBytes: artifactAfter.assetManifest.bytes,
    workerDeployReportPath,
    workerDeployEvidenceCreatedAt: deployEvidenceAfter.createdAt,
  };
}

function assertStableTopicSeedReleaseIdentity(
  expected: TopicSeedReleaseIdentity,
  current: TopicSeedReleaseIdentity,
) {
  for (const field of Object.keys(expected) as Array<keyof TopicSeedReleaseIdentity>) {
    if (expected[field] !== current[field]) {
      throw new Error(`Remote topic synchronization release identity changed at ${field}.`);
    }
  }
  return current;
}

function validateTopicSeedReleaseIdentity(
  identity: TopicSeedReleaseIdentity,
  candidateVersionId: string,
  seedSha256: string,
) {
  if (
    identity.candidateVersionId !== candidateVersionId ||
    identity.activeVersionId !== candidateVersionId
  ) {
    throw new Error("Remote topic synchronization release gate returned the wrong candidate.");
  }
  if (identity.topicSeedSha256 !== seedSha256) {
    throw new Error("Remote topic synchronization release gate returned the wrong topic hash.");
  }
  for (const [label, value] of [
    ["Git HEAD", identity.gitHead],
    ["Git upstream", identity.gitUpstream],
  ] as const) {
    if (!/^[a-f0-9]{40,64}$/i.test(value)) {
      throw new Error(`Remote topic synchronization release gate returned an invalid ${label}.`);
    }
  }
  if (identity.gitHead !== identity.gitUpstream || !identity.gitUpstreamRef) {
    throw new Error("Remote topic synchronization requires HEAD to equal a configured upstream.");
  }
  for (const [label, value] of [
    ["source fingerprint", identity.sourceFingerprintSha256],
    ["Worker source hash", identity.workerSourceSha256],
    ["Wrangler config hash", identity.wranglerConfigSha256],
    ["Static Assets hash", identity.assetManifestSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`Remote topic synchronization release gate returned an invalid ${label}.`);
    }
  }
  for (const [label, value] of [
    ["source file count", identity.sourceFingerprintFileCount],
    ["Static Assets file count", identity.assetManifestFileCount],
    ["Static Assets bytes", identity.assetManifestBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Remote topic synchronization release gate returned invalid ${label}.`);
    }
  }
  if (
    !path.isAbsolute(identity.workerDeployReportPath) ||
    !Number.isFinite(Date.parse(identity.workerDeployEvidenceCreatedAt))
  ) {
    throw new Error("Remote topic synchronization release gate returned invalid deploy evidence.");
  }
  return identity;
}

function requireTopicSeedReleaseIdentity(
  identity: TopicSeedReleaseIdentity | undefined,
): TopicSeedReleaseIdentity {
  if (!identity) {
    throw new Error("Remote topic synchronization is missing its release identity.");
  }
  return identity;
}

function assertStableGitReleaseIdentity(
  expected: GitReleaseIdentity,
  current: GitReleaseIdentity,
) {
  if (
    expected.head !== current.head ||
    expected.upstream !== current.upstream ||
    expected.upstreamRef !== current.upstreamRef
  ) {
    throw new Error("Remote topic synchronization Git identity changed during a release gate.");
  }
}

function assertStableWorkerArtifactEvidence(
  expected: WorkerDeployArtifactEvidence,
  current: WorkerDeployArtifactEvidence,
) {
  if (
    expected.sourceFingerprint.sha256 !== current.sourceFingerprint.sha256 ||
    expected.sourceFingerprint.fileCount !== current.sourceFingerprint.fileCount ||
    expected.workerSourceSha256 !== current.workerSourceSha256 ||
    expected.wranglerConfigSha256 !== current.wranglerConfigSha256 ||
    path.resolve(expected.assetManifest.root) !== path.resolve(current.assetManifest.root) ||
    expected.assetManifest.fileCount !== current.assetManifest.fileCount ||
    expected.assetManifest.bytes !== current.assetManifest.bytes ||
    expected.assetManifest.sha256 !== current.assetManifest.sha256
  ) {
    throw new Error("Remote topic synchronization source or Worker artifacts changed during a release gate.");
  }
}

function assertStableWorkerDeployRepairEvidence(
  expected: WorkerDeployRepairEvidence,
  current: WorkerDeployRepairEvidence,
) {
  if (
    expected.createdAt !== current.createdAt ||
    expected.backupDir !== current.backupDir ||
    expected.candidateVersionId !== current.candidateVersionId ||
    expected.sourceFingerprintSha256 !== current.sourceFingerprintSha256 ||
    expected.sourceFingerprintFileCount !== current.sourceFingerprintFileCount ||
    expected.workerSourceSha256 !== current.workerSourceSha256 ||
    expected.wranglerConfigSha256 !== current.wranglerConfigSha256 ||
    expected.assetManifest.sha256 !== current.assetManifest.sha256 ||
    expected.activeDeploymentReadAt !== current.activeDeploymentReadAt
  ) {
    throw new Error("Remote topic synchronization deploy evidence changed during a release gate.");
  }
}

export function buildTopicSeedSql(
  seeds: readonly TopicSeed[] = topicSeeds,
  now = Date.now(),
  seedHash = topicSeedHash(seeds),
) {
  const fragments = buildTopicSeedSqlBatches(seeds, now, seedHash);
  for (const fragment of fragments) {
    if (Buffer.byteLength(fragment, "utf8") >= maximumD1SqlStatementBytes) {
      throw new Error("Topic seed SQL contains a fragment at or above D1's 100,000-byte statement limit.");
    }
  }
  return fragments.join("");
}

/**
 * Build statement-size-bounded fragments for validation, then upload their
 * concatenation as one atomic file. These fragments must never be executed as
 * separate production mutations.
 */
export function buildTopicSeedSqlBatches(
  seeds: readonly TopicSeed[] = topicSeeds,
  now = Date.now(),
  seedHash = topicSeedHash(seeds),
) {
  const managedSlugs = seeds.map((seed) => seed.slug);
  const managedSlugSql = managedSlugs.length ? managedSlugs.map(sqlValue).join(", ") : "NULL";
  const retiredSlugSql = retiredManagedTopicSlugs.map(sqlValue).join(", ");
  const reconciliationStatements = [
    "PRAGMA foreign_keys = ON;",
    [
      "UPDATE topics SET status = 'archived', updated_at = ",
      String(now),
      " WHERE slug NOT IN (",
      managedSlugSql,
      ") AND (slug IN (",
      retiredSlugSql,
      ") OR slug IN (SELECT value FROM json_each(COALESCE((SELECT value FROM app_metadata WHERE key = '",
      managedSlugsMetadataKey,
      "'), '[]'))));",
    ].join(""),
  ];
  const upsertStatements = seeds.map((seed) => buildTopicUpsertSql(seed, now));
  const completionStatements = [
    buildMetadataUpsertSql(seedHashMetadataKey, seedHash, now),
    buildMetadataUpsertSql(managedSlugsMetadataKey, stableStringify(managedSlugs), now),
  ];

  const batches = [sqlBatch(reconciliationStatements)];
  for (let index = 0; index < upsertStatements.length; index += topicSeedBatchSize) {
    batches.push(sqlBatch(["PRAGMA foreign_keys = ON;", ...upsertStatements.slice(index, index + topicSeedBatchSize)]));
  }
  batches.push(sqlBatch(["PRAGMA foreign_keys = ON;", ...completionStatements]));
  return batches;
}

function projectTopicSeedD1Usage(
  seeds: readonly TopicSeed[],
  snapshot: TopicSeedSnapshot,
): TopicSeedD1Projection {
  const currentSlugs = new Set(seeds.map((seed) => seed.slug));
  const archiveSlugs = Array.from(
    new Set([...retiredManagedTopicSlugs, ...readPreviouslyManagedSlugs(snapshot)]),
  )
    .filter((slug) => !currentSlugs.has(slug) && Boolean(snapshot.topics[slug]))
    .sort();
  const logicalRowWrites = seeds.length + archiveSlugs.length + 2;
  const snapshotRows = Object.keys(snapshot.topics).length + Object.keys(snapshot.metadata).length;
  const projectedBilledRowWrites = logicalRowWrites * projectedBilledWritesPerLogicalRow;
  const projectedBilledRowReads =
    snapshot.billedRowReads + snapshotRows * 3 + logicalRowWrites * 10 + 1_000;
  return {
    logicalRowWrites,
    projectedBilledRowWrites,
    projectedBilledRowReads,
    archiveSlugs,
  };
}

export function assertTopicSeedD1Budget(projection: TopicSeedD1Projection) {
  for (const [label, value] of [
    ["logical writes", projection.logicalRowWrites],
    ["projected billed writes", projection.projectedBilledRowWrites],
    ["projected billed reads", projection.projectedBilledRowReads],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Topic seed ${label} must be a non-negative safe integer.`);
    }
  }
  if (projection.projectedBilledRowWrites > MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_WRITES) {
    throw new Error(
      `Projected D1 topic-seed writes exceed the Workers Free safety budget: ${projection.projectedBilledRowWrites} > ${MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_WRITES}.`,
    );
  }
  if (projection.projectedBilledRowReads > MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS) {
    throw new Error(
      `Projected D1 topic-seed reads exceed the Workers Free safety budget: ${projection.projectedBilledRowReads} > ${MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS}.`,
    );
  }
  return projection;
}

function readTopicSeedSnapshot(mode: SyncMode, runner: WranglerRunner = runWrangler) {
  const sql = [
    "SELECT id, slug, name, sub_text, description, inputbox_text, system_prompt, icon_url, sort_order, status, metadata, created_at, updated_at FROM topics ORDER BY slug;",
    "SELECT key, value, updated_at FROM app_metadata ORDER BY key;",
  ].join("\n");
  const output = runner(
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      mode === "remote" ? "--remote" : "--local",
      "--json",
      "--command",
      sql,
    ],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  return parseTopicSeedSnapshotOutput(output, { requireBilledRows: mode === "remote" });
}

function parseTopicSeedSnapshotOutput(
  output: string,
  options: { requireBilledRows?: boolean } = {},
): TopicSeedSnapshot {
  const resultSets = parseD1ResultSets(output, 2, options.requireBilledRows === true);
  const topics: Record<string, TopicSeedSnapshotRow> = {};
  for (const [index, raw] of resultSets[0].rows.entries()) {
    const row = parseTopicRow(raw, index);
    if (topics[row.slug]) throw new Error(`D1 topic snapshot contains duplicate slug ${row.slug}.`);
    topics[row.slug] = row;
  }
  const metadata: TopicSeedSnapshot["metadata"] = {};
  for (const [index, raw] of resultSets[1].rows.entries()) {
    const key = requiredString(raw, "key", `app_metadata row ${index + 1}`);
    if (metadata[key]) throw new Error(`D1 app_metadata snapshot contains duplicate key ${key}.`);
    metadata[key] = {
      value: requiredString(raw, "value", `app_metadata row ${index + 1}`),
      updatedAt: optionalInteger(raw, "updated_at", `app_metadata row ${index + 1}`),
    };
  }
  return {
    topics,
    metadata,
    billedRowReads: resultSets.reduce((sum, resultSet) => sum + resultSet.rowsRead, 0),
  };
}

function verifyTopicSeedSnapshot(
  after: TopicSeedSnapshot,
  before: TopicSeedSnapshot,
  seeds: readonly TopicSeed[],
  now: number,
  seedHash = topicSeedHash(seeds),
) {
  const currentSlugs = new Set(seeds.map((seed) => seed.slug));
  const archiveSlugs = new Set(
    [...retiredManagedTopicSlugs, ...readPreviouslyManagedSlugs(before)].filter(
      (slug) => !currentSlugs.has(slug),
    ),
  );
  const touchedSlugs = new Set([...currentSlugs, ...archiveSlugs]);

  for (const seed of seeds) {
    const prior = before.topics[seed.slug];
    const actual = after.topics[seed.slug];
    if (!actual) throw new Error(`Topic seed verification is missing ${seed.slug}.`);
    const expected: TopicSeedSnapshotRow = {
      id: prior?.id ?? seed.slug,
      slug: seed.slug,
      name: seed.name,
      subText: seed.subText,
      description: seed.description,
      inputboxText: seed.inputboxText,
      systemPrompt: seed.systemPrompt,
      iconUrl: prior?.iconUrl ?? null,
      sortOrder: seed.sortOrder,
      status: prior?.status ?? "active",
      metadata: stableStringify(seed.metadata),
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    assertSameTopicRow(actual, expected, `managed topic ${seed.slug}`);
  }

  let verifiedArchivedTopics = 0;
  for (const slug of archiveSlugs) {
    const prior = before.topics[slug];
    const actual = after.topics[slug];
    if (!prior) {
      if (actual) throw new Error(`Topic seed verification unexpectedly created retired topic ${slug}.`);
      continue;
    }
    if (!actual) throw new Error(`Topic seed verification lost retired topic ${slug}.`);
    assertSameTopicRow(
      actual,
      { ...prior, status: "archived", updatedAt: now },
      `retired managed topic ${slug}`,
    );
    verifiedArchivedTopics += 1;
  }

  for (const [slug, prior] of Object.entries(before.topics)) {
    if (touchedSlugs.has(slug)) continue;
    const actual = after.topics[slug];
    if (!actual) throw new Error(`Topic seed verification lost unmanaged topic ${slug}.`);
    assertSameTopicRow(actual, prior, `unmanaged topic ${slug}`);
  }
  for (const slug of Object.keys(after.topics)) {
    if (!before.topics[slug] && !currentSlugs.has(slug)) {
      throw new Error(`Topic seed verification found unexpected topic ${slug}.`);
    }
  }

  assertMetadataValue(after, seedHashMetadataKey, seedHash, now);
  assertMetadataValue(
    after,
    managedSlugsMetadataKey,
    stableStringify(seeds.map((seed) => seed.slug)),
    now,
  );
  return { verifiedTopics: seeds.length, verifiedArchivedTopics };
}

function buildTopicUpsertSql(seed: TopicSeed, now: number) {
  const values = [
    seed.slug,
    seed.slug,
    seed.name,
    seed.subText,
    seed.description,
    seed.inputboxText,
    seed.systemPrompt,
    seed.sortOrder,
    "active",
    stableStringify(seed.metadata),
    now,
    now,
  ];
  return [
    "INSERT INTO topics (id, slug, name, sub_text, description, inputbox_text, system_prompt, sort_order, status, metadata, created_at, updated_at) VALUES (",
    values.map(sqlValue).join(", "),
    ") ON CONFLICT(slug) DO UPDATE SET ",
    "name = excluded.name, ",
    "sub_text = excluded.sub_text, ",
    "description = excluded.description, ",
    "inputbox_text = excluded.inputbox_text, ",
    "system_prompt = excluded.system_prompt, ",
    "sort_order = excluded.sort_order, ",
    "metadata = excluded.metadata, ",
    "updated_at = excluded.updated_at;",
  ].join("");
}

function buildMetadataUpsertSql(key: string, value: string, now: number) {
  return [
    "INSERT INTO app_metadata (key, value, updated_at) VALUES (",
    sqlValue(key),
    ", ",
    sqlValue(value),
    ", ",
    String(now),
    ") ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;",
  ].join("");
}

function writeTemporaryTopicSeedSql(sql: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-topic-seeds-"));
  fs.chmodSync(tmpDir, 0o700);
  const sqlPath = path.join(tmpDir, "atomic-topic-seeds.sql");
  fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
  return sqlPath;
}

function writeTopicSeedPreWriteDiagnosticEvidence(input: {
  backupDir: string;
  bookmark: string;
  sql: string;
  projection: TopicSeedD1Projection;
  topics: number;
  seedSha256: string;
  releaseIdentity: TopicSeedReleaseIdentity;
  releaseBudgetReservation: D1ReleaseBudgetReservationResult;
  now?: number;
}) {
  if (!/^\S{8,}$/.test(input.bookmark)) {
    throw new Error("Topic seed diagnostic evidence requires a valid Time Travel bookmark.");
  }
  if (!input.sql) throw new Error("Topic seed diagnostic evidence requires non-empty mutation SQL.");
  if (!Number.isSafeInteger(input.topics) || input.topics < 0) {
    throw new Error("Topic seed diagnostic evidence requires a non-negative topic count.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.seedSha256)) {
    throw new Error("Topic seed diagnostic evidence requires a valid seed hash.");
  }
  assertTopicSeedD1Budget(input.projection);
  assertOperatorLocalEvidenceDirectory(input.backupDir);

  const now = input.now ?? Date.now();
  const createdAt = new Date(now).toISOString();
  const evidence = {
    kind: "d1-topic-seed-sync-prewrite-evidence",
    createdAt,
    database: D1_DATABASE_NAME,
    timeTravelBookmark: input.bookmark,
    timeTravelVerifiedAt: createdAt,
    recoveryPreference: "reviewed-forward-correction",
    destructiveRestoreSupported: false,
    exportPerformed: false,
    exportReason: "Cloudflare documents that D1 export blocks database requests.",
    atomicSqlSha256: createHash().update(input.sql).digest("hex"),
    atomicSqlBytes: Buffer.byteLength(input.sql, "utf8"),
    atomicSqlStatements: countTopicSeedSqlStatements(input.sql),
    topicSeedSha256: input.seedSha256,
    releaseIdentity: input.releaseIdentity,
    releaseBudgetReservation: input.releaseBudgetReservation,
    topics: input.topics,
    archiveSlugs: input.projection.archiveSlugs,
    logicalRowWrites: input.projection.logicalRowWrites,
    projectedBilledRowReads: input.projection.projectedBilledRowReads,
    projectedBilledRowReadLimit: MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS,
    projectedBilledRowWrites: input.projection.projectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_WRITES,
  } as const;
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(
    cloudflareDir(input.backupDir),
    `topic-seed-sync-prewrite-${timestamp}.json`,
  );
  writeFsyncedPrivateJson(evidencePath, evidence);
  return evidencePath;
}

function countTopicSeedSqlStatements(sql: string) {
  return countSqlStatements(sql, "topic seed");
}

function assertOperatorLocalEvidenceDirectory(backupDir: string) {
  const relative = path.relative(process.cwd(), path.resolve(backupDir));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
  const root = relative.split(path.sep)[0];
  if (!root || !new Set(["tmp", "backups", "inspirlearning-local-backups"]).has(root)) {
    throw new Error("D1 diagnostic evidence must be written outside the repository or under a gitignored report directory.");
  }
}

function writeFsyncedPrivateJson(file: string, value: unknown) {
  const descriptor = fs.openSync(file, "w", 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function countSqlStatements(sql: string, label: string) {
  let quote: "'" | '"' | "`" | "]" | undefined;
  let statementHasContent = false;
  let statements = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote || (quote === "]" && character === "]")) {
        const next = sql[index + 1];
        if (quote !== "]" && next === quote) {
          index += 1;
        } else if (quote === "]" && next === "]") {
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      statementHasContent = true;
      continue;
    }
    if (character === "[") {
      quote = "]";
      statementHasContent = true;
      continue;
    }
    if (character === ";") {
      if (statementHasContent) statements += 1;
      statementHasContent = false;
      continue;
    }
    if (!/\s/.test(character)) statementHasContent = true;
  }
  if (quote) throw new Error(`The ${label} SQL contains an unterminated quoted value.`);
  if (statementHasContent) statements += 1;
  return statements;
}

function readPreviouslyManagedSlugs(snapshot: TopicSeedSnapshot) {
  const value = snapshot.metadata[managedSlugsMetadataKey]?.value;
  if (value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Existing topic_seed_slugs metadata is not valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Existing topic_seed_slugs metadata must be a unique string array.");
  }
  const entries: unknown[] = parsed;
  const slugs: string[] = [];
  for (const slug of entries) {
    if (typeof slug !== "string" || !slug.trim()) {
      throw new Error("Existing topic_seed_slugs metadata must contain only non-empty strings.");
    }
    slugs.push(slug);
  }
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("Existing topic_seed_slugs metadata must not contain duplicates.");
  }
  return slugs;
}

function parseD1ResultSets(output: string, expected: number, requireBilledRows: boolean) {
  const parsed = parseJsonFromOutput(output);
  if (!Array.isArray(parsed) || parsed.length !== expected) {
    throw new Error(`Wrangler D1 topic snapshot returned ${Array.isArray(parsed) ? parsed.length : 0} result sets; expected ${expected}.`);
  }
  return parsed.map((entry, index) => {
    if (!isRecord(entry) || entry.success !== true || !Array.isArray(entry.results)) {
      throw new Error(`Wrangler D1 topic snapshot result set ${index + 1} is malformed or unsuccessful.`);
    }
    const rows = entry.results.map((row, rowIndex) => {
      if (!isRecord(row)) {
        throw new Error(`Wrangler D1 topic snapshot result set ${index + 1} row ${rowIndex + 1} is malformed.`);
      }
      return row;
    });
    const rowsRead = isRecord(entry.meta) ? entry.meta.rows_read : undefined;
    if (requireBilledRows && (!Number.isSafeInteger(rowsRead) || Number(rowsRead) < 0)) {
      throw new Error(`Wrangler D1 topic snapshot result set ${index + 1} is missing billed rows_read metadata.`);
    }
    return {
      rows,
      rowsRead: Number.isSafeInteger(rowsRead) && Number(rowsRead) >= 0 ? Number(rowsRead) : rows.length,
    };
  });
}

function parseTopicRow(row: Record<string, unknown>, index: number): TopicSeedSnapshotRow {
  const label = `topic row ${index + 1}`;
  return {
    id: requiredString(row, "id", label),
    slug: requiredString(row, "slug", label),
    name: requiredString(row, "name", label),
    subText: requiredString(row, "sub_text", label),
    description: requiredString(row, "description", label),
    inputboxText: requiredString(row, "inputbox_text", label),
    systemPrompt: requiredString(row, "system_prompt", label),
    iconUrl: optionalString(row, "icon_url", label),
    sortOrder: requiredInteger(row, "sort_order", label),
    status: requiredString(row, "status", label),
    metadata: requiredString(row, "metadata", label),
    createdAt: requiredInteger(row, "created_at", label),
    updatedAt: requiredInteger(row, "updated_at", label),
  };
}

function requiredString(row: Record<string, unknown>, field: string, label: string) {
  const value = row[field];
  if (typeof value !== "string") throw new Error(`D1 ${label} has invalid ${field}.`);
  return value;
}

function optionalString(row: Record<string, unknown>, field: string, label: string) {
  const value = row[field];
  if (value !== null && typeof value !== "string") {
    throw new Error(`D1 ${label} has invalid ${field}.`);
  }
  return value;
}

function requiredInteger(row: Record<string, unknown>, field: string, label: string) {
  const value = row[field];
  if (!Number.isSafeInteger(value)) throw new Error(`D1 ${label} has invalid ${field}.`);
  return Number(value);
}

function optionalInteger(row: Record<string, unknown>, field: string, label: string) {
  const value = row[field];
  if (value === null) return null;
  return requiredInteger(row, field, label);
}

function assertSameTopicRow(
  actual: TopicSeedSnapshotRow,
  expected: TopicSeedSnapshotRow,
  label: string,
) {
  for (const key of topicSnapshotKeys) {
    if (actual[key] !== expected[key]) {
      throw new Error(`Topic seed verification failed for ${label}/${key}.`);
    }
  }
}

function assertMetadataValue(
  snapshot: TopicSeedSnapshot,
  key: string,
  expectedValue: string,
  expectedUpdatedAt: number,
) {
  const actual = snapshot.metadata[key];
  if (!actual || actual.value !== expectedValue || actual.updatedAt !== expectedUpdatedAt) {
    throw new Error(`Topic seed metadata verification failed for ${key}.`);
  }
}

function parseJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) {
      throw new Error("Could not parse Wrangler D1 topic snapshot JSON.");
    }
    return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function topicSeedHash(seeds: readonly TopicSeed[] = topicSeeds) {
  return createHash().update(stableStringify(seeds)).digest("hex");
}

function topicSeedReleaseOperationId(candidateVersionId: string, seedSha256: string) {
  const candidate = requireWorkerVersion(candidateVersionId).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(seedSha256)) {
    throw new Error("Topic seed release operation ID requires a valid seed hash.");
  }
  return `topic-seed-sync:${candidate}:${seedSha256}`;
}

function sqlValue(value: string | number) {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  return assertNever(value);
}

function sqlBatch(statements: string[]) {
  return `${statements.join("\n")}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireWorkerVersion(value: string | undefined) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error(
      "Remote topic seed synchronization requires --candidate-version with the exact active Worker version UUID.",
    );
  }
  return value;
}

function topicSeedSourceIdentity(identity: TopicSeedReleaseIdentity) {
  return {
    sha256: identity.sourceFingerprintSha256,
    fileCount: identity.sourceFingerprintFileCount,
  };
}

function requireTopicSeedReleaseOperationId(value: string | undefined) {
  if (!value) throw new Error("Remote topic synchronization is missing its release operation ID.");
  return value;
}

function requireTopicSeedBudgetReservation(
  value: D1ReleaseBudgetReservationResult | undefined,
) {
  if (!value) throw new Error("Remote topic synchronization is missing its D1 budget reservation.");
  return value;
}
