import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TopicSeed } from "../lib/content/topics";
import {
  readD1ReleaseBudgetLedger,
  reserveD1ReleaseBudget,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import {
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
  assertSourceSyncReadBudget,
  buildSiteTranslationSourceSyncPlan,
  syncSiteTranslationSources,
  verifySiteTranslationSourceSnapshot,
  type SiteTranslationSourceSnapshot,
  type SourceManifestEntry,
} from "../scripts/cloudflare/sync-site-translation-sources";
import {
  MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS,
  assertRemoteTopicSeedReleaseGate,
  assertTopicSeedD1Budget,
  syncTopicSeeds,
  topicSeedHash,
  type TopicSeedReleaseGate,
  type TopicSeedReleaseIdentity,
  type TopicSeedSnapshotRow,
} from "../scripts/cloudflare/sync-topic-seeds";
import {
  parseD1TimeTravelBookmark,
  stableStringify,
  type WranglerRunner,
} from "../scripts/cloudflare/migration-config";
import type { WorkerDeployArtifactEvidence } from "../scripts/cloudflare/worker-deploy-evidence";

const now = 1_720_000_000_000;
const bookmark = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";
const candidateVersionId = "22222222-2222-4222-8222-222222222222";
const sourceSyncFingerprint = { sha256: "c".repeat(64), fileCount: 12 };
const sourceSyncFingerprintProvider = () => sourceSyncFingerprint;
const emptyDailyUsage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 0,
  rowsWritten: 0,
  executions: 0,
  windowMinutes: 1,
};

const testSeed: TopicSeed = {
  slug: "safe-topic",
  name: "Safe Topic",
  subText: "A bounded learning topic",
  description: "Learn without changing durable user data.",
  inputboxText: "What should we study?",
  systemPrompt: "Teach carefully.",
  sortOrder: 7,
  metadata: {
    category: "Test",
    uiMode: "chat",
    modelProfile: "fast",
    starters: ["Start here"],
  },
};

test("remote topic synchronization records diagnostic evidence and exact-verifies", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-topic-remote-safety-"));
  const priorManaged = priorTopic({
    id: "stable-topic-id",
    slug: testSeed.slug,
    name: "Old topic name",
    iconUrl: "profiles/topic.png",
    createdAt: 100,
    updatedAt: 200,
  });
  const retired = priorTopic({
    id: "retired-topic-id",
    slug: "ai-game-arena",
    name: "Retired arena",
    createdAt: 300,
    updatedAt: 400,
  });
  const unmanaged = priorTopic({
    id: "unmanaged-id",
    slug: "operator-owned",
    name: "Operator-owned topic",
    createdAt: 500,
    updatedAt: 600,
  });
  const seedHash = topicSeedHash([testSeed]);
  const before = topicSnapshotOutput(
    [priorManaged, retired, unmanaged],
    [
      { key: "topic_seed_slugs", value: '["safe-topic","ai-game-arena"]', updated_at: 11 },
      { key: "unrelated", value: "keep", updated_at: 12 },
    ],
  );
  const after = topicSnapshotOutput(
    [
      {
        ...priorManaged,
        name: testSeed.name,
        subText: testSeed.subText,
        description: testSeed.description,
        inputboxText: testSeed.inputboxText,
        systemPrompt: testSeed.systemPrompt,
        sortOrder: testSeed.sortOrder,
        metadata: stableStringify(testSeed.metadata),
        updatedAt: now,
      },
      { ...retired, status: "archived", updatedAt: now },
      unmanaged,
    ],
    [
      { key: "topic_seed_hash", value: seedHash, updated_at: now },
      { key: "topic_seed_slugs", value: '["safe-topic"]', updated_at: now },
      { key: "unrelated", value: "keep", updated_at: 12 },
    ],
  );
  const calls: string[][] = [];
  const releasePhases: string[] = [];
  const events: string[] = [];
  let applied = false;
  let appliedSql = "";
  const expectedEvidencePath = diagnosticEvidencePath(
    backupDir,
    "topic-seed-sync-prewrite",
  );
  const runner: WranglerRunner = (args) => {
    calls.push([...args]);
    events.push(args.includes("--file") ? "d1-import" : `wrangler-${args[1] ?? "unknown"}`);
    if (args[1] === "time-travel") return JSON.stringify({ bookmark });
    if (args[1] === "execute" && args.includes("--file")) {
      const sql = fs.readFileSync(requiredArgValue(args, "--file"), "utf8");
      assert.match(sql, /slug IN \('ai-game-arena'\)/);
      assert.match(sql, /INSERT INTO topics/);
      assert.equal(fs.existsSync(expectedEvidencePath), true);
      appliedSql = sql;
      applied = true;
      throw new Error("simulated lost Wrangler response after topic commit");
    }
    if (args[1] === "execute" && args.includes("--command")) return applied ? after : before;
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    const releaseGate: TopicSeedReleaseGate = (input) => {
      releasePhases.push(input.phase);
      events.push(`release-${input.phase}`);
      return topicReleaseIdentity(input.backupDir, input.topicSeedSha256);
    };
    const report = syncTopicSeeds("remote", backupDir, {
      confirmed: true,
      now,
      runner,
      seeds: [testSeed],
      dailyUsage: emptyDailyUsage,
      candidateVersion: candidateVersionId,
      releaseGate,
    });
    assert.equal(report.ok, true);
    assert.equal(report.batches, 1);
    assert.equal(report.timeTravelBookmark, bookmark);
    assert.equal(report.verifiedTopics, 1);
    assert.equal(report.verifiedArchivedTopics, 1);
    assert.equal(report.importResponseConfirmed, false);
    assert.equal(report.responseRecoveredByVerification, true);
    assert.ok(report.projectedBilledRowReads < MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS);
    assert.equal(calls.filter((args) => args.includes("--file")).length, 1);
    assert.equal(calls.some((args) => args[1] === "export"), false);
    assert.equal(report.preWriteEvidencePath, expectedEvidencePath);
    assert.deepEqual(releasePhases, [
      "before-first-d1-query",
      "immediately-before-import",
    ]);
    assert.ok(
      events.indexOf("release-before-first-d1-query") < events.indexOf("wrangler-execute"),
    );
    assert.equal(
      events[events.indexOf("release-immediately-before-import") + 1],
      "d1-import",
    );
    assert.equal(report.releaseIdentity?.candidateVersionId, candidateVersionId);
    assert.equal(report.releaseBudgetReservation?.reservation.phase, "exact");
    assert.equal(
      report.releaseBudgetReservation?.reservation.candidateVersionId,
      candidateVersionId,
    );
    assert.equal(fs.statSync(expectedEvidencePath).mode & 0o777, 0o600);
    const evidence = readJsonRecord(expectedEvidencePath);
    assert.equal(evidence.exportPerformed, false);
    assert.equal(evidence.timeTravelBookmark, bookmark);
    assert.equal(evidence.atomicSqlSha256, sha256(appliedSql));
    assert.equal(evidence.atomicSqlBytes, Buffer.byteLength(appliedSql, "utf8"));
    assert.equal(evidence.atomicSqlStatements, report.atomicSqlStatements);
    assert.equal(evidence.projectedBilledRowReads, report.projectedBilledRowReads);
    assert.equal(evidence.projectedBilledRowWrites, report.projectedBilledRowWrites);
    assert.ok(isRecord(evidence.releaseIdentity));
    assert.equal(evidence.releaseIdentity.candidateVersionId, candidateVersionId);
    assert.ok(isRecord(evidence.releaseBudgetReservation));
    assert.ok(isRecord(evidence.releaseBudgetReservation.reservation));
    assert.equal(evidence.releaseBudgetReservation.reservation.phase, "exact");
    assert.equal(
      evidence.releaseBudgetReservation.reservation.candidateVersionId,
      candidateVersionId,
    );
    assertForwardCorrectionEvidence(evidence);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("remote topic synchronization rejects missing confirmation and oversized read projections", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-topic-confirm-"));
  try {
    assert.throws(
      () => syncTopicSeeds("remote", backupDir),
      /requires --confirm-production/,
    );
    let runnerCalls = 0;
    assert.throws(
      () =>
        syncTopicSeeds("remote", backupDir, {
          confirmed: true,
          runner: () => {
            runnerCalls += 1;
            return "";
          },
          seeds: [testSeed],
          dailyUsage: emptyDailyUsage,
        }),
      /requires --candidate-version/,
    );
    assert.equal(runnerCalls, 0);
    assert.throws(
      () =>
        assertTopicSeedD1Budget({
          logicalRowWrites: 1,
          projectedBilledRowWrites: 3,
          projectedBilledRowReads: MAX_PROJECTED_TOPIC_SEED_BILLED_ROW_READS + 1,
          archiveSlugs: [],
        }),
      /topic-seed reads exceed the Workers Free safety budget/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("remote topic release gate binds stable Git, deploy evidence, artifacts, and active candidate", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-topic-release-gate-"));
  const topicHash = topicSeedHash([testSeed]);
  const gitIdentity = {
    head: "a".repeat(40),
    upstream: "a".repeat(40),
    upstreamRef: "origin/codex/release",
  };
  const artifactEvidence = {
    sourceFingerprint: { sha256: "b".repeat(64), fileCount: 3, files: [] },
    workerSourceSha256: "c".repeat(64),
    wranglerConfigSha256: "d".repeat(64),
    assetManifest: {
      root: path.resolve(".open-next/assets"),
      fileCount: 4,
      bytes: 123,
      sha256: "e".repeat(64),
    },
  };
  const reportPath = path.join(backupDir, "cloudflare/worker-deploy-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(workerDeployReportFixture(backupDir, artifactEvidence), null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.chmodSync(reportPath, 0o600);
  try {
    let activeReads = 0;
    const identity = assertRemoteTopicSeedReleaseGate(
      {
        phase: "before-first-d1-query",
        backupDir,
        candidateVersionId,
        topicSeedSha256: topicHash,
        cwd: process.cwd(),
        runner: () => "",
      },
      {
        readGitIdentity: () => gitIdentity,
        buildArtifactEvidence: () => artifactEvidence,
        validateVectorizeReadiness: () => ({
          createdAt: "2026-07-12T00:02:00.000Z",
        }),
        readActiveVersion: () => {
          activeReads += 1;
          return candidateVersionId;
        },
      },
    );
    assert.equal(activeReads, 2);
    assert.equal(identity.candidateVersionId, candidateVersionId);
    assert.equal(identity.gitHead, gitIdentity.head);
    assert.equal(identity.sourceFingerprintSha256, artifactEvidence.sourceFingerprint.sha256);
    assert.equal(identity.assetManifestSha256, artifactEvidence.assetManifest.sha256);

    fs.chmodSync(reportPath, 0o640);
    assert.throws(
      () =>
        assertRemoteTopicSeedReleaseGate(
          {
            phase: "before-first-d1-query",
            backupDir,
            candidateVersionId,
            topicSeedSha256: topicHash,
            cwd: process.cwd(),
            runner: () => "",
          },
          {
            readGitIdentity: () => gitIdentity,
            buildArtifactEvidence: () => artifactEvidence,
            validateVectorizeReadiness: () => ({
              createdAt: "2026-07-12T00:02:00.000Z",
            }),
            readActiveVersion: () => candidateVersionId,
          },
        ),
      /mode-0600/,
    );
    fs.chmodSync(reportPath, 0o600);

    let changedActiveReads = 0;
    assert.throws(
      () =>
        assertRemoteTopicSeedReleaseGate(
          {
            phase: "immediately-before-import",
            backupDir,
            candidateVersionId,
            topicSeedSha256: topicHash,
            cwd: process.cwd(),
            runner: () => "",
          },
          {
            readGitIdentity: () => gitIdentity,
            buildArtifactEvidence: () => artifactEvidence,
            validateVectorizeReadiness: () => ({
              createdAt: "2026-07-12T00:02:00.000Z",
            }),
            readActiveVersion: () => {
              changedActiveReads += 1;
              return changedActiveReads === 1
                ? candidateVersionId
                : "33333333-3333-4333-8333-333333333333";
            },
          },
        ),
      /candidate changed/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("remote topic synchronization refuses changed release identity before import", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-topic-release-race-"));
  const before = topicSnapshotOutput([], []);
  let importCalls = 0;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel") return JSON.stringify({ bookmark });
    if (args[1] === "execute" && args.includes("--command")) return before;
    if (args[1] === "execute" && args.includes("--file")) {
      importCalls += 1;
      return "unexpected";
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };
  let gateCalls = 0;
  try {
    assert.throws(
      () =>
        syncTopicSeeds("remote", backupDir, {
          confirmed: true,
          now,
          runner,
          seeds: [testSeed],
          dailyUsage: emptyDailyUsage,
          candidateVersion: candidateVersionId,
          releaseGate: (input) => {
            gateCalls += 1;
            const identity = topicReleaseIdentity(input.backupDir, input.topicSeedSha256);
            return gateCalls === 1
              ? identity
              : { ...identity, sourceFingerprintSha256: "f".repeat(64) };
          },
        }),
      /release identity changed at sourceFingerprintSha256/,
    );
    assert.equal(gateCalls, 2);
    assert.equal(importCalls, 0);
    assert.equal(
      fs.existsSync(diagnosticEvidencePath(backupDir, "topic-seed-sync-prewrite")),
      true,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("remote topic synchronization rejects a UTC rollover at the final pre-import clock check", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-topic-rollover-"));
  const before = topicSnapshotOutput([], []);
  let importCalls = 0;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel") return JSON.stringify({ bookmark });
    if (args[1] === "execute" && args.includes("--command")) return before;
    if (args[1] === "execute" && args.includes("--file")) {
      importCalls += 1;
      return "unexpected";
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };
  const clockValues = [
    new Date("2026-07-12T23:59:59.900Z"),
    new Date("2026-07-12T23:59:59.950Z"),
    new Date("2026-07-12T23:59:59.990Z"),
    new Date("2026-07-13T00:00:00.000Z"),
  ];
  try {
    assert.throws(
      () =>
        syncTopicSeeds("remote", backupDir, {
          confirmed: true,
          now: Date.parse("2026-07-12T23:59:59.000Z"),
          runner,
          seeds: [testSeed],
          dailyUsage: emptyDailyUsage,
          candidateVersion: candidateVersionId,
          releaseGate: passingTopicReleaseGate,
          clock: () =>
            clockValues.shift() ?? new Date("2026-07-13T00:00:00.000Z"),
        }),
      /crossed the UTC billing-day boundary/,
    );
    assert.equal(importCalls, 0);
    assert.equal(
      fs
        .readdirSync(path.join(backupDir, "cloudflare"))
        .filter((file) => file.startsWith("topic-seed-sync-prewrite-")).length,
      1,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("Time Travel evidence requires the structured Wrangler bookmark contract", () => {
  assert.equal(parseD1TimeTravelBookmark(JSON.stringify({ bookmark })), bookmark);
  assert.throws(
    () => parseD1TimeTravelBookmark(JSON.stringify({ database: "inspirlearning-prod" })),
    /valid bookmark/,
  );
  assert.throws(() => parseD1TimeTravelBookmark("not-json"), /valid JSON/);
});

test("account-wide daily usage rejects remote mutation before its first D1 SQL", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-account-budget-"));
  let runnerCalls = 0;
  const runner: WranglerRunner = () => {
    runnerCalls += 1;
    throw new Error("D1 runner must not be reached when the account budget is exhausted.");
  };
  const exhaustedUsage = { ...emptyDailyUsage, rowsRead: 4_000_000 };
  const sources = [
    ["alpha", { sourceHash: "hash", sourceStrings: { key: "Value" } }],
  ] satisfies Array<[string, SourceManifestEntry]>;

  try {
    assert.throws(
      () =>
        syncTopicSeeds("remote", backupDir, {
          confirmed: true,
          now,
          runner,
          seeds: [testSeed],
          dailyUsage: exhaustedUsage,
          candidateVersion: candidateVersionId,
          releaseGate: passingTopicReleaseGate,
        }),
      /exceeds the reserved Workers Free D1 daily budget/,
    );
    assert.throws(
      () =>
        syncSiteTranslationSources("remote", backupDir, {
          confirmed: true,
          now,
          runner,
          sources,
          dailyUsage: exhaustedUsage,
        }),
      /exceeds the reserved Workers Free D1 daily budget/,
    );
    assert.equal(runnerCalls, 0);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("standalone source sync rejects cumulative ledger overflow before its first D1 SQL", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-source-ledger-overflow-"));
  let runnerCalls = 0;
  const runner: WranglerRunner = () => {
    runnerCalls += 1;
    throw new Error("D1 SQL must not run after cumulative budget rejection.");
  };
  const sources = [
    ["alpha", { sourceHash: "hash", sourceStrings: { key: "Value" } }],
  ] satisfies Array<[string, SourceManifestEntry]>;

  try {
    reserveD1ReleaseBudget({
      backupDir,
      operationId: "prior-release-operation",
      operation: "Prior release operation",
      sourceFingerprint: sourceSyncFingerprint,
      phase: "exact",
      rowsRead: 1_500_001,
      rowsWritten: 0,
      observedUsage: emptyDailyUsage,
      now: new Date(now),
    });
    assert.throws(
      () =>
        syncSiteTranslationSources("remote", backupDir, {
          confirmed: true,
          now,
          runner,
          sources,
          dailyUsage: emptyDailyUsage,
          sourceFingerprintProvider: sourceSyncFingerprintProvider,
        }),
      /cumulative lag-safe Workers Free D1 daily budget/,
    );
    assert.equal(runnerCalls, 0);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("standalone source sync rejects UTC rollover and source or plan drift before D1 write", () => {
  const desired = [
    ["alpha", { sourceHash: "alpha-new", sourceStrings: { key: "New" } }],
  ] satisfies Array<[string, SourceManifestEntry]>;
  const before = sourceSnapshotOutput(
    [{ namespace: "alpha", source_hash: "alpha-old" }],
    [{ namespace: "alpha", source_key: "key", source_text: "Old" }],
  );

  const runFailure = (input: {
    label: string;
    clock?: () => Date;
    fingerprintProvider?: () => typeof sourceSyncFingerprint;
    mutatePlanAtBookmark?: boolean;
    tamperLedgerAtBookmark?: boolean;
    expected: RegExp;
  }) => {
    const backupDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `inspir-source-ledger-${input.label}-`),
    );
    const caseDesired = structuredClone(desired);
    let writeCalls = 0;
    const runner: WranglerRunner = (args) => {
      if (args[1] === "execute" && args.includes("--command")) return before;
      if (args[1] === "time-travel") {
        if (input.mutatePlanAtBookmark) caseDesired[0][1].sourceHash = "drifted-plan";
        if (input.tamperLedgerAtBookmark) {
          const ledgerFile = fs
            .readdirSync(path.join(backupDir, "cloudflare"))
            .find((file) => file.startsWith("d1-release-budget-ledger-"));
          if (!ledgerFile) throw new Error("Expected a D1 release ledger fixture.");
          fs.writeFileSync(
            path.join(backupDir, "cloudflare", ledgerFile),
            '{"tampered":true}\n',
            { mode: 0o600 },
          );
        }
        return JSON.stringify({ bookmark });
      }
      if (args[1] === "execute" && args.includes("--file")) {
        writeCalls += 1;
        return "unexpected write";
      }
      throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
    };
    try {
      assert.throws(
        () =>
          syncSiteTranslationSources("remote", backupDir, {
            confirmed: true,
            runner,
            sources: caseDesired,
            dailyUsage: emptyDailyUsage,
            sourceFingerprintProvider:
              input.fingerprintProvider ?? sourceSyncFingerprintProvider,
            clock: input.clock ?? (() => new Date("2026-07-12T12:00:00.000Z")),
          }),
        input.expected,
      );
      assert.equal(writeCalls, 0);
    } finally {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  };

  const rolloverTimes = [
    new Date("2026-07-12T23:59:58.000Z"),
    new Date("2026-07-12T23:59:59.000Z"),
    new Date("2026-07-13T00:00:00.000Z"),
  ];
  let rolloverIndex = 0;
  runFailure({
    label: "rollover",
    clock: () => rolloverTimes[Math.min(rolloverIndex++, rolloverTimes.length - 1)],
    expected: /crossed the UTC billing-day boundary/,
  });

  let fingerprintReads = 0;
  runFailure({
    label: "source-drift",
    fingerprintProvider: () =>
      fingerprintReads++ === 0
        ? sourceSyncFingerprint
        : { ...sourceSyncFingerprint, sha256: "d".repeat(64) },
    expected: /source fingerprint drifted before its D1 write/,
  });

  runFailure({
    label: "plan-drift",
    mutatePlanAtBookmark: true,
    expected: /plan drifted before its D1 write/,
  });

  runFailure({
    label: "ledger-tamper",
    tamperLedgerAtBookmark: true,
    expected: /D1 release budget ledger has an unsupported schema/,
  });
});

test("standalone remote source synchronization bookmarks without export and exact-verifies", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-source-remote-safety-"));
  const desired = [
    ["alpha", { sourceHash: "alpha-new", sourceStrings: { keep: "new", added: "added" } }],
  ] satisfies Array<[string, SourceManifestEntry]>;
  const before = sourceSnapshotOutput(
    [
      { namespace: "alpha", source_hash: "alpha-old" },
      { namespace: "obsolete", source_hash: "obsolete" },
    ],
    [
      { namespace: "alpha", source_key: "keep", source_text: "old" },
      { namespace: "obsolete", source_key: "old", source_text: "value" },
    ],
  );
  const after = sourceSnapshotOutput(
    [{ namespace: "alpha", source_hash: "alpha-new" }],
    [
      { namespace: "alpha", source_key: "added", source_text: "added" },
      { namespace: "alpha", source_key: "keep", source_text: "new" },
    ],
  );
  const calls: string[][] = [];
  let applied = false;
  let appliedSql = "";
  const expectedEvidencePath = diagnosticEvidencePath(
    backupDir,
    "site-translation-source-sync-prewrite",
  );
  const runner: WranglerRunner = (args) => {
    calls.push([...args]);
    if (args[1] === "time-travel") return JSON.stringify({ bookmark });
    if (args[1] === "execute" && args.includes("--file")) {
      const sql = fs.readFileSync(requiredArgValue(args, "--file"), "utf8");
      assert.match(sql, /DELETE FROM app_translation_sources WHERE namespace = 'obsolete'/);
      assert.equal(fs.existsSync(expectedEvidencePath), true);
      appliedSql = sql;
      applied = true;
      throw new Error("simulated lost Wrangler response after source commit");
    }
    if (args[1] === "execute" && args.includes("--command")) return applied ? after : before;
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    const report = syncSiteTranslationSources("remote", backupDir, {
      confirmed: true,
      now,
      runner,
      sources: desired,
      dailyUsage: emptyDailyUsage,
      sourceFingerprintProvider: sourceSyncFingerprintProvider,
    });
    assert.equal(report.ok, true);
    assert.equal(report.timeTravelBookmark, bookmark);
    assert.equal(report.verifiedRows, 1);
    assert.equal(report.verifiedSourceStringCount, 2);
    assert.equal(report.importResponseConfirmed, false);
    assert.equal(report.responseRecoveredByVerification, true);
    assert.ok(report.projectedBilledRowReads < MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS);
    assert.equal(calls.filter((args) => args.includes("--file")).length, 1);
    assert.equal(calls.some((args) => args[1] === "export"), false);
    assert.equal(report.preWriteEvidencePath, expectedEvidencePath);
    assert.equal(fs.statSync(expectedEvidencePath).mode & 0o777, 0o600);
    const evidence = readJsonRecord(expectedEvidencePath);
    assert.equal(evidence.exportPerformed, false);
    assert.equal(evidence.sourceReconciliationIncludedInMainRepair, true);
    assert.equal(evidence.atomicSqlSha256, sha256(appliedSql));
    assert.equal(evidence.atomicSqlBytes, Buffer.byteLength(appliedSql, "utf8"));
    assert.equal(evidence.atomicSqlStatements, report.statements + 1);
    assert.equal(evidence.projectedBilledRowReads, report.projectedBilledRowReads);
    assert.equal(evidence.projectedBilledRowWrites, report.projectedBilledRowWrites);
    const budgetEvidence = evidence.d1ReleaseBudget;
    assert.ok(isRecord(budgetEvidence));
    assert.equal(budgetEvidence.operationId, report.d1ReleaseBudget?.operationId);
    assert.equal(budgetEvidence.rowsRead, report.projectedBilledRowReads);
    assert.equal(budgetEvidence.rowsWritten, report.projectedBilledRowWrites);
    assertForwardCorrectionEvidence(evidence);

    const ledgerBeforeReplay = readD1ReleaseBudgetLedger(
      report.d1ReleaseBudget?.ledgerPath ?? "",
    );
    const replay = syncSiteTranslationSources("remote", backupDir, {
      confirmed: true,
      now,
      runner,
      sources: desired,
      dailyUsage: emptyDailyUsage,
      sourceFingerprintProvider: sourceSyncFingerprintProvider,
    });
    const ledgerAfterReplay = readD1ReleaseBudgetLedger(
      replay.d1ReleaseBudget?.ledgerPath ?? "",
    );
    assert.equal(replay.applied, false);
    assert.equal(replay.d1ReleaseBudget?.operationId, report.d1ReleaseBudget?.operationId);
    assert.equal(ledgerAfterReplay.revision, ledgerBeforeReplay.revision);
    assert.deepEqual(ledgerAfterReplay.totals, ledgerBeforeReplay.totals);
    assert.equal(calls.filter((args) => args.includes("--file")).length, 1);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("definite post-import mismatches fail closed without whole-database restore", () => {
  const topicBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-topic-rollback-"));
  const sourceBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-source-rollback-"));
  let topicSnapshotReads = 0;
  let topicRestoreCalls = 0;
  const topicBefore = topicSnapshotOutput([], []);
  const topicRunner: WranglerRunner = (args) => {
    if (args[1] === "time-travel" && args[2] === "info") {
      return JSON.stringify({ bookmark });
    }
    if (args[1] === "time-travel" && args[2] === "restore") {
      topicRestoreCalls += 1;
      assert.equal(requiredArgValue(args, "--bookmark"), bookmark);
      return JSON.stringify({ success: true });
    }
    if (args[1] === "execute" && args.includes("--file")) return "applied";
    if (args[1] === "execute" && args.includes("--command")) {
      topicSnapshotReads += 1;
      return topicBefore;
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  const desired = [
    ["alpha", { sourceHash: "alpha-new", sourceStrings: { key: "new" } }],
  ] satisfies Array<[string, SourceManifestEntry]>;
  const sourceBefore = sourceSnapshotOutput(
    [{ namespace: "alpha", source_hash: "alpha-old" }],
    [{ namespace: "alpha", source_key: "key", source_text: "old" }],
  );
  let sourceSnapshotReads = 0;
  let sourceRestoreCalls = 0;
  const sourceRunner: WranglerRunner = (args) => {
    if (args[1] === "time-travel" && args[2] === "info") {
      return JSON.stringify({ bookmark });
    }
    if (args[1] === "time-travel" && args[2] === "restore") {
      sourceRestoreCalls += 1;
      assert.equal(requiredArgValue(args, "--bookmark"), bookmark);
      return JSON.stringify({ success: true });
    }
    if (args[1] === "execute" && args.includes("--file")) return "applied";
    if (args[1] === "execute" && args.includes("--command")) {
      sourceSnapshotReads += 1;
      return sourceBefore;
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    assert.throws(
      () =>
        syncTopicSeeds("remote", topicBackupDir, {
          confirmed: true,
          now,
          runner: topicRunner,
          seeds: [testSeed],
          dailyUsage: emptyDailyUsage,
          candidateVersion: candidateVersionId,
          releaseGate: passingTopicReleaseGate,
        }),
      /Destructive whole-database restore is unsupported on Free; use a reviewed forward correction/,
    );
    assert.equal(topicSnapshotReads, 2);
    assert.equal(topicRestoreCalls, 0);

    assert.throws(
      () =>
        syncSiteTranslationSources("remote", sourceBackupDir, {
          confirmed: true,
          now,
          runner: sourceRunner,
          sources: desired,
          dailyUsage: emptyDailyUsage,
        }),
      /Destructive whole-database restore is unsupported on Free; use a reviewed forward correction/,
    );
    assert.equal(sourceSnapshotReads, 2);
    assert.equal(sourceRestoreCalls, 0);
  } finally {
    fs.rmSync(topicBackupDir, { recursive: true, force: true });
    fs.rmSync(sourceBackupDir, { recursive: true, force: true });
  }
});

test("indeterminate post-import reads fail closed without an automatic restore or success report", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-topic-indeterminate-"));
  const before = topicSnapshotOutput([], []);
  let snapshotReads = 0;
  let restoreCalls = 0;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel" && args[2] === "info") {
      return JSON.stringify({ bookmark });
    }
    if (args[1] === "time-travel" && args[2] === "restore") {
      restoreCalls += 1;
      return "restored";
    }
    if (args[1] === "execute" && args.includes("--file")) return "applied";
    if (args[1] === "execute" && args.includes("--command")) {
      snapshotReads += 1;
      if (snapshotReads === 1) return before;
      throw new Error("verification transport unavailable");
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    assert.throws(
      () =>
        syncTopicSeeds("remote", backupDir, {
          confirmed: true,
          now,
          runner,
          seeds: [testSeed],
          dailyUsage: emptyDailyUsage,
          candidateVersion: candidateVersionId,
          releaseGate: passingTopicReleaseGate,
        }),
      /outcome is indeterminate; no success report was written/,
    );
    assert.equal(restoreCalls, 0);
    assert.equal(
      fs.existsSync(path.join(backupDir, "cloudflare", "topic-seeds-remote.json")),
      false,
    );
    assert.equal(
      fs.existsSync(diagnosticEvidencePath(backupDir, "topic-seed-sync-prewrite")),
      true,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("indeterminate source verification also fails closed without an automatic restore", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-source-indeterminate-"));
  const desired = [
    ["alpha", { sourceHash: "alpha-new", sourceStrings: { key: "New" } }],
  ] satisfies Array<[string, SourceManifestEntry]>;
  const before = sourceSnapshotOutput(
    [{ namespace: "alpha", source_hash: "alpha-old" }],
    [{ namespace: "alpha", source_key: "key", source_text: "Old" }],
  );
  let snapshotReads = 0;
  let restoreCalls = 0;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel" && args[2] === "info") {
      return JSON.stringify({ bookmark });
    }
    if (args[1] === "time-travel" && args[2] === "restore") {
      restoreCalls += 1;
      return "restored";
    }
    if (args[1] === "execute" && args.includes("--file")) return "applied";
    if (args[1] === "execute" && args.includes("--command")) {
      snapshotReads += 1;
      if (snapshotReads === 1) return before;
      throw new Error("verification transport unavailable");
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    assert.throws(
      () =>
        syncSiteTranslationSources("remote", backupDir, {
          confirmed: true,
          now,
          runner,
          sources: desired,
          dailyUsage: emptyDailyUsage,
        }),
      /outcome is indeterminate; no success report was written/,
    );
    assert.equal(restoreCalls, 0);
    assert.equal(
      fs.existsSync(path.join(backupDir, "cloudflare", "site-translation-sources-remote.json")),
      false,
    );
    assert.equal(
      fs.existsSync(
        diagnosticEvidencePath(backupDir, "site-translation-source-sync-prewrite"),
      ),
      true,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("already-reconciled standalone sources avoid a bookmark, evidence file, and import", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-source-noop-"));
  const desired = [
    ["alpha", { sourceHash: "alpha-current", sourceStrings: { key: "Current" } }],
  ] satisfies Array<[string, SourceManifestEntry]>;
  const current = sourceSnapshotOutput(
    [{ namespace: "alpha", source_hash: "alpha-current" }],
    [{ namespace: "alpha", source_key: "key", source_text: "Current" }],
  );
  const calls: string[][] = [];
  const runner: WranglerRunner = (args) => {
    calls.push([...args]);
    if (args[1] === "execute" && args.includes("--command")) return current;
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    const report = syncSiteTranslationSources("remote", backupDir, {
      confirmed: true,
      now,
      runner,
      sources: desired,
      dailyUsage: emptyDailyUsage,
      sourceFingerprintProvider: sourceSyncFingerprintProvider,
    });
    assert.equal(report.ok, true);
    assert.equal(report.applied, false);
    assert.equal(report.diagnosticEvidenceRequired, false);
    assert.equal(report.timeTravelVerified, false);
    assert.equal(report.importAttempted, false);
    assert.equal(report.importVerification, "not-required");
    assert.equal(report.sourceReconciliationIncludedInMainRepair, true);
    assert.equal(report.d1ReleaseBudget?.phase, "exact");
    assert.equal(report.d1ReleaseBudget?.rowsWritten, 0);
    assert.equal(
      report.d1ReleaseBudget?.operationId.startsWith("site-translation-source-sync:"),
      true,
    );
    const ledger = readD1ReleaseBudgetLedger(report.d1ReleaseBudget?.ledgerPath ?? "");
    assert.equal(ledger.reservations.length, 1);
    assert.equal(ledger.reservations[0]?.phase, "exact");
    assert.equal(ledger.reservations[0]?.rowsWritten, 0);
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("standalone source sync delegates stale payload changes to the atomic main repair", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-source-delegate-"));
  const desired = [
    ["alpha", { sourceHash: "alpha-new", sourceStrings: { key: "New" } }],
  ] satisfies Array<[string, SourceManifestEntry]>;
  const current = sourceSnapshotOutput(
    [{ namespace: "alpha", source_hash: "alpha-old" }],
    [{ namespace: "alpha", source_key: "key", source_text: "Old" }],
    [{ namespace: "alpha", source_hash: "alpha-old", translation_rows: 4 }],
  );
  const calls: string[][] = [];
  const runner: WranglerRunner = (args) => {
    calls.push([...args]);
    if (args[1] === "execute" && args.includes("--command")) return current;
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    assert.throws(
      () =>
        syncSiteTranslationSources("remote", backupDir, {
          confirmed: true,
          now,
          runner,
          sources: desired,
          dailyUsage: emptyDailyUsage,
        }),
      /main repair already reconciles source rows atomically with payloads/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls.some((args) => args[1] === "time-travel"), false);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("source synchronization fails closed on read budget and post-write drift", () => {
  const plan = buildSiteTranslationSourceSyncPlan([]);
  assert.throws(
    () =>
      assertSourceSyncReadBudget({
        ...plan,
        projectedBilledRowReads: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS + 1,
      }),
    /source-sync reads exceed the Workers Free safety budget/,
  );

  const desired = [
    ["alpha", { sourceHash: "expected", sourceStrings: { key: "Expected" } }],
  ] satisfies Array<[string, SourceManifestEntry]>;
  const drifted: SiteTranslationSourceSnapshot = {
    sources: { alpha: "stale" },
    sourceStrings: { alpha: { key: "Expected" } },
  };
  assert.throws(
    () => verifySiteTranslationSourceSnapshot(drifted, desired),
    /source hash verification failed/,
  );
});

test("standalone D1 sync sources cannot regress to blocking export recovery", () => {
  for (const file of [
    "scripts/cloudflare/sync-site-translation-sources.ts",
    "scripts/cloudflare/sync-topic-seeds.ts",
  ]) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.doesNotMatch(source, /exportRemoteD1TablesBackup|\[\s*"d1",\s*"export"/);
    assert.match(source, /fs\.fsyncSync\(descriptor\)/);
    assert.match(source, /mode[^\n]*0o600|openSync\([^\n]*0o600/);
  }
});

test("package-reachable Cloudflare production scripts cannot invoke blocking D1 export", () => {
  const scripts = fs
    .readdirSync(path.resolve("scripts", "cloudflare"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.resolve("scripts", "cloudflare", entry.name));
  for (const file of scripts) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /(?:runWrangler|spawnSync)\s*\(\s*\[\s*["']d1["']\s*,\s*["']export["']/,
      path.relative(process.cwd(), file),
    );
  }
  assert.equal(fs.existsSync(path.resolve("scripts/cloudflare/backup-frozen-cloudflare-production.ts")), false);
  assert.equal(fs.existsSync(path.resolve("scripts/cloudflare/activate-write-freeze.ts")), false);
});

const passingTopicReleaseGate: TopicSeedReleaseGate = (input) =>
  topicReleaseIdentity(input.backupDir, input.topicSeedSha256);

function topicReleaseIdentity(
  backupDir: string,
  seedSha256: string,
): TopicSeedReleaseIdentity {
  return {
    candidateVersionId,
    activeVersionId: candidateVersionId,
    gitHead: "a".repeat(40),
    gitUpstream: "a".repeat(40),
    gitUpstreamRef: "origin/codex/release",
    sourceFingerprintSha256: "b".repeat(64),
    sourceFingerprintFileCount: 10,
    topicSeedSha256: seedSha256,
    workerSourceSha256: "c".repeat(64),
    wranglerConfigSha256: "d".repeat(64),
    assetManifestSha256: "e".repeat(64),
    assetManifestFileCount: 20,
    assetManifestBytes: 1_000,
    workerDeployReportPath: path.resolve(
      backupDir,
      "cloudflare/worker-deploy-report.json",
    ),
    workerDeployEvidenceCreatedAt: "2026-07-12T00:01:00.000Z",
    vectorizeReadinessCreatedAt: "2026-07-12T00:02:00.000Z",
  };
}

function workerDeployReportFixture(
  backupDir: string,
  artifactEvidence: WorkerDeployArtifactEvidence,
) {
  const createdAt = "2026-07-12T00:01:00.000Z";
  const sourceFingerprint = artifactEvidence.sourceFingerprint;
  const assetManifest = artifactEvidence.assetManifest;
  return {
    createdAt,
    backupDir,
    mode: "opennext-deploy",
    ok: true,
    status: 0,
    commandExecuted: true,
    deployPreflightOk: true,
    deployPreflightStatus: 0,
    resourceBudgetOk: true,
    scanBeforeOk: true,
    scanAfterOk: null,
    command: [
      path.resolve("node_modules/.bin/wrangler"),
      "deploy",
      "--config",
      "wrangler.jsonc",
    ],
    passthroughArgs: [],
    sourceFingerprint,
    sourceFingerprintBefore: sourceFingerprint,
    sourceFingerprintAfter: sourceFingerprint,
    sourceFingerprintStable: true,
    workerSourceSha256: artifactEvidence.workerSourceSha256,
    wranglerConfigSha256: artifactEvidence.wranglerConfigSha256,
    assetManifest,
    artifactEvidenceAfter: {
      sourceFingerprintSha256: sourceFingerprint.sha256,
      workerSourceSha256: artifactEvidence.workerSourceSha256,
      wranglerConfigSha256: artifactEvidence.wranglerConfigSha256,
      assetManifest,
    },
    artifactEvidenceStable: true,
    activeDeployment: {
      workerName: "inspirlearning",
      versionId: candidateVersionId,
      percentage: 100,
      observedVersions: 1,
      readAt: "2026-07-12T00:00:59.000Z",
    },
  };
}

function priorTopic(input: {
  id: string;
  slug: string;
  name: string;
  iconUrl?: string | null;
  createdAt: number;
  updatedAt: number;
}): TopicSeedSnapshotRow {
  return {
    id: input.id,
    slug: input.slug,
    name: input.name,
    subText: "Prior subtext",
    description: "Prior description",
    inputboxText: "Prior input",
    systemPrompt: "Prior prompt",
    iconUrl: input.iconUrl ?? null,
    sortOrder: 99,
    status: "active",
    metadata: '{"source":"prior"}',
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function topicSnapshotOutput(
  topics: readonly TopicSeedSnapshotRow[],
  metadata: ReadonlyArray<{ key: string; value: string; updated_at: number | null }>,
) {
  return d1Output([
    topics.map((topic) => ({
      id: topic.id,
      slug: topic.slug,
      name: topic.name,
      sub_text: topic.subText,
      description: topic.description,
      inputbox_text: topic.inputboxText,
      system_prompt: topic.systemPrompt,
      icon_url: topic.iconUrl,
      sort_order: topic.sortOrder,
      status: topic.status,
      metadata: topic.metadata,
      created_at: topic.createdAt,
      updated_at: topic.updatedAt,
    })),
    metadata,
  ]);
}

function sourceSnapshotOutput(
  sources: ReadonlyArray<{ namespace: string; source_hash: string }>,
  strings: ReadonlyArray<{
    namespace: string;
    source_key: string;
    source_text: string;
  }>,
  translationHashGroups: ReadonlyArray<{
    namespace: string;
    source_hash: string;
    translation_rows: number;
  }> = [{ namespace: "main-app", source_hash: "main-app-current", translation_rows: 69 }],
) {
  return d1Output([sources, strings, translationHashGroups]);
}

function d1Output(resultSets: ReadonlyArray<readonly Record<string, unknown>[]>) {
  return JSON.stringify(
    resultSets.map((results) => ({
      success: true,
      results,
      meta: { rows_read: results.length, rows_written: 0 },
    })),
  );
}

function requiredArgValue(args: readonly string[], flag: string) {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value) throw new Error(`Missing ${flag} in fake Wrangler command.`);
  return value;
}

function diagnosticEvidencePath(backupDir: string, prefix: string) {
  return path.join(
    backupDir,
    "cloudflare",
    `${prefix}-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`,
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function readJsonRecord(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Expected a JSON object in ${file}.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertForwardCorrectionEvidence(value: Record<string, unknown>) {
  assert.equal(value.recoveryPreference, "reviewed-forward-correction");
  assert.equal(value.destructiveRestoreSupported, false);
  assert.equal(Object.hasOwn(value, "restoreCommand"), false);
  assert.equal(Object.hasOwn(value, "restoreCommandStdin"), false);
}
