import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES,
  HISTORICAL_FRESH_0016_STATE_STAGES,
  HistoricalFresh0016StateError,
  acquireHistoricalFresh0016ReadbackResolution,
  acquireHistoricalFresh0016ResumeLease,
  canonicalHistoricalFresh0016Json,
  classifyHistoricalFresh0016State,
  createHistoricalFresh0016RunDirectory,
  historicalFresh0016JsonSha256,
  historicalFresh0016StatePaths,
  publishHistoricalFresh0016StateStage,
  validateHistoricalFresh0016RunDirectory,
  type HistoricalFresh0016Owner,
  type HistoricalFresh0016StateErrorCode,
  type HistoricalFresh0016StatePaths,
  type HistoricalFresh0016StateStage,
} from "../scripts/cloudflare/historical-data-fresh-0016-state";
import {
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import { HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME } from "../scripts/cloudflare/historical-data-fresh-0016-migration";
import { HISTORICAL_FRESH_0016_PREDECESSOR_AUXILIARY_FILE_NAME } from "../scripts/cloudflare/historical-data-fresh-0016-predecessor";
import { HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME } from "../scripts/cloudflare/historical-data-fresh-0016-successor";

const sourceFingerprint = Object.freeze({
  sha256: "a".repeat(64),
  fileCount: 321,
});
const baseTime = Date.parse("2026-07-14T10:00:00.000Z");

test("fresh-0016 state publishes one exact canonical immutable 12-stage chain", () => {
  const fixture = createFixture();
  try {
    assert.equal(fs.statSync(fixture.paths.runDirectory).mode & 0o777, 0o700);
    assert.deepEqual(
      validateHistoricalFresh0016RunDirectory(fixture).stageFiles,
      fixture.paths.stageFiles,
    );

    const initial = classifyHistoricalFresh0016State(fixture);
    assert.equal(initial.status, "empty");
    assert.equal(initial.currentStage, null);
    assert.equal(initial.nextStage, "claim");
    assert.equal(initial.d1ExecutionMayHaveStarted, false);
    assert.equal(initial.automaticRetryAllowed, true);
    assert.equal(initial.resumeLeaseAllowed, false);

    let previousSha256: string | null = null;
    let previousStage: HistoricalFresh0016StateStage | null = null;
    for (const [index, stage] of HISTORICAL_FRESH_0016_STATE_STAGES.entries()) {
      const handle = publishStage(fixture, stage, index);
      const stat = fs.statSync(handle.path);
      const bytes = fs.readFileSync(handle.path);
      assert.equal(stat.mode & 0o777, 0o600);
      assert.equal(stat.nlink, 1);
      assert.equal(
        bytes.toString("utf8"),
        `${canonicalHistoricalFresh0016Json(handle.value)}\n`,
      );
      assert.equal(handle.sha256, sha256(bytes));
      assert.equal(handle.value.stage, stage);
      assert.equal(handle.value.runId, fixture.runId);
      assert.equal(
        handle.value.policySha256,
        HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      );
      assert.deepEqual(handle.value.database, {
        ...HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
      });
      assert.deepEqual(handle.value.sourceFingerprint, sourceFingerprint);
      assert.equal(handle.value.priorStage, previousStage);
      assert.equal(handle.value.priorSha256, previousSha256);
      assert.equal(handle.value.resumeLeaseSha256, null);
      assert.equal(handle.value.readbackResolutionSha256, null);
      assert.equal(
        handle.value.payloadSha256,
        historicalFresh0016JsonSha256(handle.value.payload),
      );
      assert.equal(Object.isFrozen(handle.value), true);
      assert.equal(Object.isFrozen(handle.value.payload), true);

      const classification = classifyHistoricalFresh0016State(fixture);
      assert.equal(classification.currentStage, stage);
      assert.equal(classification.currentStageSha256, handle.sha256);
      assert.equal(classification.stages.length, index + 1);
      if (stage === "cutover-complete") {
        assert.equal(classification.status, "complete");
        assert.equal(classification.nextStage, null);
      } else if (isAuthorizationStage(stage)) {
        assert.equal(classification.status, "d1-may-have-started");
        assert.equal(classification.d1ExecutionMayHaveStarted, true);
        assert.equal(classification.automaticRetryAllowed, false);
        assert.equal(classification.resumeLeaseAllowed, false);
      } else {
        assert.equal(classification.status, "in-progress");
        assert.equal(classification.d1ExecutionMayHaveStarted, false);
        assert.equal(classification.automaticRetryAllowed, true);
        assert.equal(classification.resumeLeaseAllowed, true);
      }
      previousSha256 = handle.sha256;
      previousStage = stage;
    }

    const complete = classifyHistoricalFresh0016State(fixture);
    assert.equal(complete.status, "complete");
    assert.equal(complete.stages.length, HISTORICAL_FRESH_0016_STATE_STAGES.length);
    assert.equal(complete.resumeLeases.length, 0);
    assert.equal(complete.readbackResolutions.length, 0);
    assert.equal(complete.auxiliaryFiles.length, 1);
    assert.deepEqual(complete.issues, []);
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 dead authorization owners transfer only through immutable readback resolution", () => {
  const cases = [
    {
      authorization: "predecessor-authorized",
      resolved: "predecessor-prepared",
    },
    {
      authorization: "migration-authorized",
      resolved: "migration-complete",
    },
    {
      authorization: "successor-authorized",
      resolved: "successor-prepared",
    },
  ] as const;

  for (const [caseIndex, recoveryCase] of cases.entries()) {
    const fixture = createFixture();
    const abandonedOwner = {
      hostname: os.hostname(),
      pid: 50_000 + caseIndex * 100,
    } as const;
    const recoveryOwner = {
      hostname: os.hostname(),
      pid: abandonedOwner.pid + 1,
    } as const;
    try {
      const authorizationIndex = HISTORICAL_FRESH_0016_STATE_STAGES.indexOf(
        recoveryCase.authorization,
      );
      for (let index = 0; index <= authorizationIndex; index += 1) {
        const stage = HISTORICAL_FRESH_0016_STATE_STAGES[index];
        assert.ok(stage);
        if (stage === "manifest") ensurePreparedBudgetFixture(fixture);
        publishHistoricalFresh0016StateStage({
          ...fixture,
          stage,
          sourceFingerprint,
          payload: { ordinal: index, stage },
          now: new Date(baseTime + index * 1_000),
          owner: abandonedOwner,
        });
      }

      const unresolved = classifyHistoricalFresh0016State(fixture);
      assert.equal(unresolved.status, "d1-may-have-started");
      assert.equal(unresolved.automaticRetryAllowed, false);
      assert.equal(unresolved.resumeLeaseAllowed, false);
      assert.equal(unresolved.readbackResolutionAllowed, true);
      assertStateError(
        () =>
          acquireHistoricalFresh0016ResumeLease({
            ...fixture,
            owner: recoveryOwner,
            ownerExitProbe: () => true,
          }),
        "STATE_RESUME_FORBIDDEN",
      );
      assertStateError(
        () =>
          publishHistoricalFresh0016StateStage({
            ...fixture,
            stage: recoveryCase.resolved,
            sourceFingerprint,
            payload: { resolution: "readback" },
            now: new Date(baseTime + (authorizationIndex + 1) * 1_000),
            owner: recoveryOwner,
          }),
        "STATE_OWNER_ACTIVE",
      );
      assertStateError(
        () =>
          acquireHistoricalFresh0016ReadbackResolution({
            ...fixture,
            evidence: { resultSha256: "b".repeat(64) },
            now: new Date(baseTime + authorizationIndex * 1_000 + 100),
            owner: recoveryOwner,
            ownerExitProbe: () => false,
          }),
        "STATE_OWNER_ACTIVE",
      );

      const resolution = acquireHistoricalFresh0016ReadbackResolution({
        ...fixture,
        evidence: {
          operation: recoveryCase.authorization,
          resultSha256: "b".repeat(64),
          exactReadback: true,
        },
        now: new Date(baseTime + authorizationIndex * 1_000 + 100),
        owner: recoveryOwner,
        ownerExitProbe: (owner) => owner.pid === abandonedOwner.pid,
      });
      assert.equal(resolution.value.stage, recoveryCase.authorization);
      assert.equal(resolution.value.nextStage, recoveryCase.resolved);
      assert.equal(resolution.value.readbackOnly, true);
      assert.equal(resolution.value.d1RetryAuthorized, false);
      assert.deepEqual(resolution.value.previousOwner, abandonedOwner);
      assert.deepEqual(resolution.value.owner, recoveryOwner);
      assert.equal(
        resolution.value.evidenceSha256,
        historicalFresh0016JsonSha256(resolution.value.evidence),
      );

      const transferred = classifyHistoricalFresh0016State(fixture);
      assert.equal(transferred.status, "d1-may-have-started");
      assert.equal(transferred.automaticRetryAllowed, false);
      assert.equal(transferred.resumeLeaseAllowed, false);
      assert.equal(transferred.readbackResolutionAllowed, true);
      assert.equal(transferred.readbackResolutions.length, 1);
      assertStateError(
        () =>
          publishHistoricalFresh0016StateStage({
            ...fixture,
            stage: recoveryCase.resolved,
            sourceFingerprint,
            payload: { resolution: "readback" },
            now: new Date(baseTime + (authorizationIndex + 1) * 1_000),
            owner: abandonedOwner,
          }),
        "STATE_OWNER_ACTIVE",
      );

      const resolved = publishHistoricalFresh0016StateStage({
        ...fixture,
        stage: recoveryCase.resolved,
        sourceFingerprint,
        payload: {
          resolution: "exact-readback",
          resolutionEvidenceSha256: resolution.value.evidenceSha256,
        },
        now: new Date(baseTime + (authorizationIndex + 1) * 1_000),
        owner: recoveryOwner,
      });
      assert.equal(
        resolved.value.readbackResolutionSha256,
        resolution.sha256,
      );
      assert.equal(classifyHistoricalFresh0016State(fixture).status, "in-progress");
    } finally {
      fixture.cleanup();
    }
  }
});

test("fresh-0016 state enforces registered order, monotonic time, and authorization tails", () => {
  const fixture = createFixture();
  try {
    assertStateError(
      () => publishStage(fixture, "predecessor-authorized", 1),
      "STATE_CONFLICT",
    );
    publishStage(fixture, "claim", 0);
    assertStateError(
      () =>
        publishHistoricalFresh0016StateStage({
          ...fixture,
          stage: "predecessor-authorized",
          sourceFingerprint,
          payload: { ordinal: 1 },
          now: new Date(baseTime - 1),
        }),
      "STATE_CHAIN_BROKEN",
    );
    publishStage(fixture, "predecessor-authorized", 1);

    const tail = classifyHistoricalFresh0016State(fixture);
    assert.equal(tail.status, "d1-may-have-started");
    assert.equal(tail.nextStage, "predecessor-prepared");
    assert.equal(tail.d1ExecutionMayHaveStarted, true);
    assert.equal(tail.automaticRetryAllowed, false);
    assert.equal(tail.resumeLeaseAllowed, false);
    assert.equal(tail.canAdvanceWithoutD1Retry, true);
    assertStateError(
      () =>
        acquireHistoricalFresh0016ResumeLease({
          ...fixture,
          ownerExitProbe: () => true,
        }),
      "STATE_RESUME_FORBIDDEN",
    );

    assertStateError(
      () =>
        publishHistoricalFresh0016StateStage({
          ...fixture,
          stage: "predecessor-prepared",
          sourceFingerprint,
          payload: { ordinal: 2 },
          now: new Date(baseTime + 2_000),
          owner: { hostname: os.hostname(), pid: process.pid + 10_000 },
        }),
      "STATE_OWNER_ACTIVE",
    );
    publishStage(fixture, "predecessor-prepared", 2);
    assert.equal(classifyHistoricalFresh0016State(fixture).status, "in-progress");
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 classifier fails closed for unexpected entries, gaps, and broken payload hashes", () => {
  const unexpected = createFixture();
  try {
    writeOwnerOnlyFile(path.join(unexpected.paths.runDirectory, "surprise.txt"), "x");
    const classification = classifyHistoricalFresh0016State(unexpected);
    assert.equal(classification.status, "conflict");
    assert.equal(classification.d1ExecutionMayHaveStarted, true);
    assert.equal(classification.automaticRetryAllowed, false);
    assert.equal(classification.resumeLeaseAllowed, false);
    assert.ok(classification.issues.some((issue) => issue.code === "UNEXPECTED_ENTRY"));
  } finally {
    unexpected.cleanup();
  }

  const gap = createFixture();
  try {
    writeOwnerOnlyFile(
      gap.paths.stageFiles["predecessor-authorized"],
      "{}\n",
    );
    const classification = classifyHistoricalFresh0016State(gap);
    assert.equal(classification.status, "conflict");
    assert.equal(classification.d1ExecutionMayHaveStarted, true);
    assert.ok(classification.issues.some((issue) => issue.code === "STAGE_GAP"));
  } finally {
    gap.cleanup();
  }

  const brokenHash = createFixture();
  try {
    const claim = publishStage(brokenHash, "claim", 0);
    const tampered = {
      ...claim.value,
      payload: { tampered: true },
    };
    fs.writeFileSync(
      claim.path,
      `${canonicalHistoricalFresh0016Json(tampered)}\n`,
    );
    const classification = classifyHistoricalFresh0016State(brokenHash);
    assert.equal(classification.status, "broken");
    assert.equal(classification.d1ExecutionMayHaveStarted, true);
    assert.equal(classification.automaticRetryAllowed, false);
    assert.ok(classification.issues.some((issue) => issue.code === "BROKEN_STAGE"));
  } finally {
    brokenHash.cleanup();
  }
});

test("fresh-0016 state rejects path escape, symlinks, hardlinks, and non-private directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-fresh-state-path-"));
  fs.chmodSync(root, 0o700);
  const backupDirectory = path.join(root, "backup");
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  try {
    assertStateError(
      () => historicalFresh0016StatePaths(backupDirectory, "../escape"),
      "STATE_PATH_UNSAFE",
    );
    const linkedTarget = path.join(root, "linked-target");
    fs.mkdirSync(linkedTarget, { mode: 0o700 });
    fs.symlinkSync(linkedTarget, path.join(backupDirectory, "cloudflare"));
    assertStateError(
      () => createHistoricalFresh0016RunDirectory({ backupDirectory }),
      "STATE_DIRECTORY_UNSAFE",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const symlink = createFixture();
  try {
    const target = path.join(symlink.root, "target.json");
    writeOwnerOnlyFile(target, "{}\n");
    fs.symlinkSync(target, symlink.paths.stageFiles.claim);
    const classification = classifyHistoricalFresh0016State(symlink);
    assert.equal(classification.status, "broken");
    assert.ok(classification.issues.some((issue) => issue.code === "BROKEN_STAGE"));
  } finally {
    symlink.cleanup();
  }

  const hardlink = createFixture();
  try {
    const claim = publishStage(hardlink, "claim", 0);
    fs.linkSync(claim.path, path.join(hardlink.paths.runDirectory, "claim-alias.json"));
    const classification = classifyHistoricalFresh0016State(hardlink);
    assert.equal(classification.status, "broken");
    assert.ok(classification.issues.some((issue) => issue.code === "BROKEN_STAGE"));
  } finally {
    hardlink.cleanup();
  }

  const broad = createFixture();
  try {
    fs.chmodSync(broad.paths.runDirectory, 0o755);
    assertStateError(
      () => validateHistoricalFresh0016RunDirectory(broad),
      "STATE_DIRECTORY_UNSAFE",
    );
  } finally {
    broad.cleanup();
  }
});

test("fresh-0016 state reserves the exact immutable rendered migration only after manifest", () => {
  assert.equal(
    HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.renderedMigration,
    HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
  );

  const early = createFixture();
  try {
    writeOwnerOnlyFile(
      early.paths.auxiliaryFiles.renderedMigration,
      "SELECT 1;\n",
    );
    const classification = classifyHistoricalFresh0016State(early);
    assert.equal(classification.status, "conflict");
    assert.ok(classification.issues.some((issue) => issue.code === "UNEXPECTED_ENTRY"));
  } finally {
    early.cleanup();
  }

  const admitted = createFixture();
  try {
    publishThrough(admitted, "manifest");
    const renderedBytes = Buffer.from("SELECT 1;\n", "utf8");
    writeOwnerOnlyFile(
      admitted.paths.auxiliaryFiles.renderedMigration,
      renderedBytes,
    );
    const classification = classifyHistoricalFresh0016State(admitted);
    assert.equal(classification.status, "in-progress");
    assert.equal(classification.auxiliaryFiles.length, 2);
    const rendered = classification.auxiliaryFiles.find(
      (file) =>
        file.name === HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
    );
    assert.equal(
      rendered?.name,
      HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
    );
    assert.equal(rendered?.bytes, renderedBytes.byteLength);
    assert.equal(rendered?.sha256, sha256(renderedBytes));
    fs.chmodSync(admitted.paths.auxiliaryFiles.renderedMigration, 0o644);
    const broken = classifyHistoricalFresh0016State(admitted);
    assert.equal(broken.status, "broken");
    assert.ok(broken.issues.some((issue) => issue.code === "BROKEN_AUXILIARY"));
  } finally {
    admitted.cleanup();
  }
});

test("fresh-0016 manifest is impossible before immutable prepared budget admission", () => {
  const fixture = createFixture();
  try {
    publishThrough(fixture, "predecessor-complete");
    assertStateError(
      () =>
        publishHistoricalFresh0016StateStage({
          ...fixture,
          stage: "manifest",
          sourceFingerprint,
          payload: { fixture: true },
          now: new Date(baseTime + 4_000),
        }),
      "STATE_CONFLICT",
    );
    assert.equal(
      classifyHistoricalFresh0016State(fixture).currentStage,
      "predecessor-complete",
    );
    ensurePreparedBudgetFixture(fixture);
    const manifest = publishHistoricalFresh0016StateStage({
      ...fixture,
      stage: "manifest",
      sourceFingerprint,
      payload: { fixture: true },
      now: new Date(baseTime + 4_000),
    });
    assert.equal(manifest.value.stage, "manifest");
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 state reserves the exact immutable predecessor report only after predecessor preparation", () => {
  assert.equal(
    HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.predecessorReport,
    HISTORICAL_FRESH_0016_PREDECESSOR_AUXILIARY_FILE_NAME,
  );

  const early = createFixture();
  try {
    publishThrough(early, "predecessor-authorized");
    writeOwnerOnlyFile(
      early.paths.auxiliaryFiles.predecessorReport,
      "{}\n",
    );
    const classification = classifyHistoricalFresh0016State(early);
    assert.equal(classification.status, "conflict");
    assert.ok(classification.issues.some((issue) => issue.code === "UNEXPECTED_ENTRY"));
  } finally {
    early.cleanup();
  }

  const admitted = createFixture();
  try {
    publishThrough(admitted, "predecessor-prepared");
    const reportBytes = Buffer.from("{}\n", "utf8");
    writeOwnerOnlyFile(
      admitted.paths.auxiliaryFiles.predecessorReport,
      reportBytes,
    );
    const classification = classifyHistoricalFresh0016State(admitted);
    assert.equal(classification.status, "in-progress");
    assert.equal(classification.auxiliaryFiles.length, 1);
    assert.equal(
      classification.auxiliaryFiles[0]?.name,
      HISTORICAL_FRESH_0016_PREDECESSOR_AUXILIARY_FILE_NAME,
    );
    assert.equal(classification.auxiliaryFiles[0]?.bytes, reportBytes.byteLength);
    assert.equal(classification.auxiliaryFiles[0]?.sha256, sha256(reportBytes));
    fs.linkSync(
      admitted.paths.auxiliaryFiles.predecessorReport,
      path.join(admitted.paths.runDirectory, "predecessor-report-alias.json"),
    );
    const broken = classifyHistoricalFresh0016State(admitted);
    assert.equal(broken.status, "broken");
    assert.ok(broken.issues.some((issue) => issue.code === "BROKEN_AUXILIARY"));
  } finally {
    admitted.cleanup();
  }
});

test("fresh-0016 state reserves the exact immutable successor report only after successor preparation", () => {
  assert.equal(
    HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.successorReport,
    HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME,
  );

  const early = createFixture();
  try {
    publishThrough(early, "successor-authorized");
    writeOwnerOnlyFile(
      early.paths.auxiliaryFiles.successorReport,
      "{}\n",
    );
    const classification = classifyHistoricalFresh0016State(early);
    assert.equal(classification.status, "conflict");
    assert.ok(classification.issues.some((issue) => issue.code === "UNEXPECTED_ENTRY"));
  } finally {
    early.cleanup();
  }

  const admitted = createFixture();
  try {
    publishThrough(admitted, "successor-prepared");
    const reportBytes = Buffer.from("{}\n", "utf8");
    writeOwnerOnlyFile(
      admitted.paths.auxiliaryFiles.successorReport,
      reportBytes,
    );
    const classification = classifyHistoricalFresh0016State(admitted);
    assert.equal(classification.status, "in-progress");
    assert.equal(classification.auxiliaryFiles.length, 2);
    const successor = classification.auxiliaryFiles.find(
      (file) =>
        file.name === HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME,
    );
    assert.equal(
      successor?.name,
      HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME,
    );
    assert.equal(successor?.bytes, reportBytes.byteLength);
    assert.equal(successor?.sha256, sha256(reportBytes));
    fs.chmodSync(admitted.paths.auxiliaryFiles.successorReport, 0o644);
    const broken = classifyHistoricalFresh0016State(admitted);
    assert.equal(broken.status, "broken");
    assert.ok(broken.issues.some((issue) => issue.code === "BROKEN_AUXILIARY"));
  } finally {
    admitted.cleanup();
  }
});

test("fresh-0016 resume transfers ownership only after exit proof and binds the next stage", () => {
  const fixture = createFixture();
  const abandonedOwner = { hostname: os.hostname(), pid: 30_000 } as const;
  const resumedOwner = { hostname: os.hostname(), pid: 30_001 } as const;
  try {
    const claim = publishHistoricalFresh0016StateStage({
      ...fixture,
      stage: "claim",
      sourceFingerprint,
      payload: { ordinal: 0 },
      now: new Date(baseTime),
      owner: abandonedOwner,
    });
    assert.equal(classifyHistoricalFresh0016State(fixture).resumeLeaseAllowed, true);
    assertStateError(
      () =>
        acquireHistoricalFresh0016ResumeLease({
          ...fixture,
          now: new Date(baseTime + 100),
          owner: resumedOwner,
          ownerExitProbe: () => false,
        }),
      "STATE_OWNER_ACTIVE",
    );
    assertStateError(
      () =>
        acquireHistoricalFresh0016ResumeLease({
          ...fixture,
          now: new Date(baseTime + 100),
          owner: resumedOwner,
          ownerExitProbe: () => {
            throw new Error("probe unavailable");
          },
        }),
      "STATE_OWNER_ACTIVE",
    );
    const lease = acquireHistoricalFresh0016ResumeLease({
      ...fixture,
      now: new Date(baseTime + 100),
      owner: resumedOwner,
      ownerExitProbe: (owner) => owner.pid === abandonedOwner.pid,
    });
    assert.equal(fs.statSync(lease.path).mode & 0o777, 0o600);
    assert.equal(fs.statSync(lease.path).nlink, 1);
    assert.equal(lease.value.stage, "claim");
    assert.equal(lease.value.stageSha256, claim.sha256);
    assert.equal(lease.value.attempt, 1);
    assert.equal(lease.value.previousLeaseSha256, null);
    assert.deepEqual(lease.value.owner, resumedOwner);

    assertStateError(
      () =>
        publishHistoricalFresh0016StateStage({
          ...fixture,
          stage: "predecessor-authorized",
          sourceFingerprint,
          payload: { ordinal: 1 },
          now: new Date(baseTime + 1_000),
          owner: abandonedOwner,
        }),
      "STATE_OWNER_ACTIVE",
    );
    const next = publishHistoricalFresh0016StateStage({
      ...fixture,
      stage: "predecessor-authorized",
      sourceFingerprint,
      payload: { ordinal: 1 },
      now: new Date(baseTime + 1_000),
      owner: resumedOwner,
    });
    assert.equal(next.value.resumeLeaseSha256, lease.sha256);
    assert.deepEqual(next.value.owner, resumedOwner);
    const classification = classifyHistoricalFresh0016State(fixture);
    assert.equal(classification.status, "d1-may-have-started");
    assert.equal(classification.resumeLeases.length, 1);
    assert.deepEqual(classification.issues, []);
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 resume leases are exact append-only chains bounded to eight slots", () => {
  const fixture = createFixture();
  let owner: HistoricalFresh0016Owner = {
    hostname: os.hostname(),
    pid: 40_000,
  };
  try {
    publishHistoricalFresh0016StateStage({
      ...fixture,
      stage: "claim",
      sourceFingerprint,
      payload: { ordinal: 0 },
      now: new Date(baseTime),
      owner,
    });
    let previousSha256: string | null = null;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      owner = { hostname: os.hostname(), pid: 40_000 + attempt };
      const lease = acquireHistoricalFresh0016ResumeLease({
        ...fixture,
        now: new Date(baseTime + attempt * 100),
        owner,
        ownerExitProbe: () => true,
      });
      assert.equal(lease.value.attempt, attempt);
      assert.equal(lease.value.previousLeaseSha256, previousSha256);
      previousSha256 = lease.sha256;
    }
    const classification = classifyHistoricalFresh0016State(fixture);
    assert.equal(classification.status, "in-progress");
    assert.equal(classification.resumeLeases.length, 8);
    assert.deepEqual(
      classification.resumeLeases.map((lease) => lease.value.attempt),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assertStateError(
      () =>
        acquireHistoricalFresh0016ResumeLease({
          ...fixture,
          now: new Date(baseTime + 900),
          owner: { hostname: os.hostname(), pid: 40_009 },
          ownerExitProbe: () => true,
        }),
      "STATE_RESUME_FORBIDDEN",
    );
  } finally {
    fixture.cleanup();
  }
});

type Fixture = Readonly<{
  root: string;
  backupDirectory: string;
  runId: string;
  paths: HistoricalFresh0016StatePaths;
  cleanup: () => void;
}>;

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-fresh-state-"));
  fs.chmodSync(root, 0o700);
  const backupDirectory = path.join(root, "backup");
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  fs.chmodSync(backupDirectory, 0o700);
  const runId = randomUUID();
  const paths = createHistoricalFresh0016RunDirectory({
    backupDirectory,
    runId,
  });
  return Object.freeze({
    root,
    backupDirectory,
    runId,
    paths,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  });
}

function publishStage(
  fixture: Fixture,
  stage: HistoricalFresh0016StateStage,
  ordinal: number,
) {
  if (stage === "manifest") ensurePreparedBudgetFixture(fixture);
  return publishHistoricalFresh0016StateStage({
    ...fixture,
    stage,
    sourceFingerprint,
    payload: { ordinal, stage },
    now: new Date(baseTime + ordinal * 1_000),
  });
}

function ensurePreparedBudgetFixture(fixture: Fixture) {
  const file = fixture.paths.auxiliaryFiles.migrationBudgetPrepared;
  if (!fs.existsSync(file)) {
    writeOwnerOnlyFile(file, '{"kind":"fixture-prepared-budget"}\n');
  }
}

function publishThrough(
  fixture: Fixture,
  finalStage: HistoricalFresh0016StateStage,
) {
  const finalIndex = HISTORICAL_FRESH_0016_STATE_STAGES.indexOf(finalStage);
  for (let index = 0; index <= finalIndex; index += 1) {
    const stage = HISTORICAL_FRESH_0016_STATE_STAGES[index];
    assert.ok(stage);
    publishStage(fixture, stage, index);
  }
}

function writeOwnerOnlyFile(file: string, bytes: string | Buffer) {
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function isAuthorizationStage(stage: HistoricalFresh0016StateStage) {
  return stage === "predecessor-authorized" ||
    stage === "migration-authorized" ||
    stage === "successor-authorized";
}

function assertStateError(
  operation: () => unknown,
  code: HistoricalFresh0016StateErrorCode,
) {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof HistoricalFresh0016StateError);
    assert.equal(error.code, code);
    return true;
  });
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
