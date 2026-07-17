import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_FRESH_0016_APPLY_READBACK_RESOLUTION_KIND,
  HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET,
  HISTORICAL_FRESH_0016_APPLY_GENERIC_STATIC_ROWS_READ_PROJECTION,
  HISTORICAL_FRESH_0016_APPLY_STATE_MAX_ROWS_READ,
  HISTORICAL_FRESH_0016_APPLY_STATE_SQL,
  HistoricalFresh0016ApplyError,
  applyHistoricalDataFresh0016Migration,
  historicalFresh0016ApplyOutcomeSchema,
  type ApplyHistoricalFresh0016MigrationOptions,
  type HistoricalFresh0016ApplyErrorCode,
} from "../scripts/cloudflare/apply-historical-data-fresh-0016-migration";
import {
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
  canonicalHistoricalFresh0016DatabaseMarkerValue,
  createHistoricalFresh0016DatabaseMarker,
  publishHistoricalFresh0016RenderedMigration,
  type HistoricalFresh0016MigrationBinding,
} from "../scripts/cloudflare/historical-data-fresh-0016-migration";
import {
  HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES,
  acquireHistoricalFresh0016ResumeLease,
  classifyHistoricalFresh0016State,
  createHistoricalFresh0016RunDirectory,
  historicalFresh0016JsonSha256,
  publishHistoricalFresh0016StateStage,
  type HistoricalFresh0016Owner,
} from "../scripts/cloudflare/historical-data-fresh-0016-state";
import type { WranglerRunner } from "../scripts/cloudflare/migration-config";
import { buildRepoSourceFingerprint } from "../scripts/cloudflare/source-fingerprint";
import {
  HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ,
  HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
} from "../scripts/cloudflare/verify-historical-data-fresh-0016-migration";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
  RUNTIME_MIGRATION_VERIFICATION_SQL,
} from "../scripts/cloudflare/verify-d1-runtime-migrations";

const runId = "123e4567-e89b-42d3-a456-426614174000";
const activeWorkerVersion = "223e4567-e89b-42d3-a456-426614174000";
const fixedUpdatedAt = 1_752_000_000_000;
const freshUpdatedAt = fixedUpdatedAt + 1;
const privateRunnerFailure =
  "private-user-id-and-message-that-must-never-enter-apply-evidence";

test("confirmed apply executes only the immutable rendered file and publishes verified completion", () => {
  const fixture = createFixture();
  const database = createDatabaseRunner(fixture, "pre", ["commit-confirmed"]);
  try {
    const outcome = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      runner: database.runner,
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, "verified");
    assert.equal(outcome.lastDatabaseState, "verified-committed");
    assert.equal(outcome.attempts.length, 1);
    assert.equal(outcome.attempts[0]?.responseConfirmed, true);
    assert.equal(outcome.attempts[0]?.readback, "verified-committed");
    assert.equal(outcome.readbackResolutionSha256, null);
    assert.equal(outcome.stateAdvanceRequired, false);
    assert.equal(historicalFresh0016ApplyOutcomeSchema.safeParse(outcome).success, true);
    assert.equal(Object.isFrozen(outcome), true);
    assert.equal(Object.isFrozen(outcome.binding), true);
    assert.equal(Object.isFrozen(outcome.attempts), true);
    assert.equal(Object.isFrozen(outcome.runtimeVerificationReport), true);
    assert.equal(
      Reflect.set(outcome.retry, "furtherRetryAllowed", true),
      false,
    );

    assert.equal(database.fileCalls.length, 1);
    assert.equal(
      database.calls.length,
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
        .totalRunnerCalls - 3,
    );
    assert.equal(
      fileArgument(database.fileCalls[0] ?? []),
      path.join(
        fixture.runDirectory,
        HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
      ),
    );
    assert.equal(database.stageObservedAtFile, "migration-authorized");
    const state = classifyHistoricalFresh0016State({
      backupDirectory: fixture.backupDirectory,
      runId,
    });
    assert.equal(state.currentStage, "migration-complete");
    assert.equal(state.readbackResolutions.length, 0);
    assert.equal(
      state.stages.filter((stage) => stage.value.stage === "migration-authorized")
        .length,
      1,
    );
  } finally {
    fixture.cleanup();
  }
});

test("confirmed apply accepts static verifier multi-result read-only D1 output", () => {
  const fixture = createFixture();
  const database = createDatabaseRunner(
    fixture,
    "pre",
    ["commit-confirmed"],
    { splitStaticResultSets: true },
  );
  try {
    const outcome = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      runner: database.runner,
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, "verified");
    assert.equal(outcome.lastDatabaseState, "verified-committed");
    assert.equal(database.fileCalls.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("ambiguous response succeeds only from exact same-run marker and privacy-safe readback", () => {
  const fixture = createFixture();
  const database = createDatabaseRunner(fixture, "pre", ["commit-ambiguous"]);
  try {
    const outcome = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      runner: database.runner,
    });

    assert.equal(outcome.status, "verified-after-ambiguous-response");
    assert.equal(outcome.attempts.length, 1);
    assert.equal(outcome.attempts[0]?.responseConfirmed, false);
    assert.equal(outcome.attempts[0]?.runnerOutcome, "runner-failed");
    assert.equal(JSON.stringify(outcome).includes(privateRunnerFailure), false);
    assert.equal(JSON.stringify(outcome).includes(fixture.freshMarkerValue), false);
    assert.equal(database.fileCalls.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("one explicitly pre-authorized retry is confined to the same live invocation after exact absence", () => {
  const fixture = createFixture({ explicitSameInvocationRetry: true });
  const database = createDatabaseRunner(
    fixture,
    "pre",
    ["absent-ambiguous", "commit-confirmed"],
  );
  try {
    const outcome = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      runner: database.runner,
    });

    assert.equal(outcome.status, "verified-after-explicit-retry");
    assert.deepEqual(
      outcome.attempts.map((attempt) => attempt.readback),
      ["verified-absent", "verified-committed"],
    );
    assert.equal(outcome.retry.maximumAttempts, 2);
    assert.equal(outcome.retry.attemptsUsed, 2);
    assert.equal(outcome.retry.retryConsumed, true);
    assert.equal(outcome.retry.furtherRetryAllowed, false);
    assert.equal(database.fileCalls.length, 2);
    assert.equal(
      database.calls.length,
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
        .totalRunnerCalls,
    );
    assert.ok(
      database.fileCalls.every(
        (args) =>
          fileArgument(args) ===
          path.join(
            fixture.runDirectory,
            HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
          ),
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

test("later exact-absent readback is review-required and can never retry or re-authorize", () => {
  const fixture = createFixture();
  const first = createDatabaseRunner(fixture, "pre", ["absent-ambiguous"]);
  try {
    const unresolved = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      runner: first.runner,
    });
    assert.equal(unresolved.status, "verified-absent");
    assert.equal(unresolved.stateAdvanceRequired, true);
    assert.equal(first.fileCalls.length, 1);

    const recoveryOwner = nextOwner(fixture.owner, 1);
    const later = createDatabaseRunner(fixture, "pre", ["commit-confirmed"]);
    const reviewed = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      stateOwner: recoveryOwner,
      runner: later.runner,
      ownerExitProbe: () => true,
    });
    assert.equal(
      reviewed.status,
      "verified-absent-readback-review-required",
    );
    assert.equal(reviewed.ok, false);
    assert.equal(reviewed.attempts.length, 0);
    assert.equal(reviewed.stateAdvanceRequired, true);
    assert.equal(later.fileCalls.length, 0);
    assert.equal(
      later.calls.length,
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.laterInvocation
        .exactAbsentReadOnlyCalls,
    );
    assertOnlyReadOnlyCalls(later.calls);
    const state = classifyHistoricalFresh0016State({
      backupDirectory: fixture.backupDirectory,
      runId,
    });
    assert.equal(state.currentStage, "migration-authorized");
    assert.equal(state.readbackResolutions.length, 0);
    assert.equal(
      state.stages.filter((stage) => stage.value.stage === "migration-authorized")
        .length,
      1,
    );
  } finally {
    fixture.cleanup();
  }
});

test("manifest resume lease transfers apply ownership before the D1 write boundary", () => {
  const fixture = createFixture();
  const recoveryOwner = nextOwner(fixture.owner, 6);
  const database = createDatabaseRunner(fixture, "pre", ["commit-confirmed"]);
  try {
    const lease = acquireHistoricalFresh0016ResumeLease({
      backupDirectory: fixture.backupDirectory,
      runId,
      now: new Date("2026-07-14T10:00:10.000Z"),
      owner: recoveryOwner,
      ownerExitProbe: (owner) =>
        owner.hostname === fixture.owner.hostname &&
        owner.pid === fixture.owner.pid,
    });
    assert.equal(lease.value.stage, "manifest");
    const outcome = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      stateOwner: recoveryOwner,
      runner: database.runner,
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, "verified");
    assert.equal(database.fileCalls.length, 1);
    const state = classifyHistoricalFresh0016State({
      backupDirectory: fixture.backupDirectory,
      runId,
    });
    assert.equal(state.currentStage, "migration-complete");
    assert.equal(state.resumeLeases.length, 1);
    assert.equal(state.resumeLeases[0]?.sha256, lease.sha256);
    assert.equal(state.stages.at(-1)?.value.owner.pid, recoveryOwner.pid);
    const authorization = state.stages.find(
      (stage) => stage.value.stage === "migration-authorized",
    );
    assert.equal(authorization?.value.owner.pid, recoveryOwner.pid);
    assert.equal(authorization?.value.resumeLeaseSha256, lease.sha256);
  } finally {
    fixture.cleanup();
  }
});

test("later exact-committed readback transfers dead-owner resolution without invoking D1 migration", () => {
  const fixture = createFixture();
  const first = createDatabaseRunner(fixture, "pre", ["absent-ambiguous"]);
  try {
    const unresolved = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      runner: first.runner,
    });
    assert.equal(unresolved.status, "verified-absent");
    const authorizationSha256 = unresolved.migrationAuthorizedStageSha256;

    const recoveryOwner = nextOwner(fixture.owner, 2);
    const later = createDatabaseRunner(fixture, "committed", ["commit-confirmed"]);
    const recovered = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      stateOwner: recoveryOwner,
      runner: later.runner,
      ownerExitProbe: (owner) =>
        owner.hostname === fixture.owner.hostname &&
        owner.pid === fixture.owner.pid,
    });

    assert.equal(recovered.status, "verified-after-unresolved-authorization");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.attempts.length, 0);
    assert.match(recovered.readbackResolutionSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(later.fileCalls.length, 0);
    assert.equal(
      later.calls.length,
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.laterInvocation
        .exactCommittedReadOnlyCalls,
    );
    assertOnlyReadOnlyCalls(later.calls);
    const state = classifyHistoricalFresh0016State({
      backupDirectory: fixture.backupDirectory,
      runId,
    });
    assert.equal(state.currentStage, "migration-complete");
    assert.equal(state.readbackResolutions.length, 1);
    const resolution = state.readbackResolutions[0];
    assert.ok(resolution);
    assert.equal(resolution.sha256, recovered.readbackResolutionSha256);
    assert.equal(resolution.value.stageSha256, authorizationSha256);
    assert.equal(
      resolution.value.evidence.kind,
      HISTORICAL_FRESH_0016_APPLY_READBACK_RESOLUTION_KIND,
    );
    assert.equal(
      resolution.value.evidence.authorizationStageSha256,
      authorizationSha256,
    );
    assert.equal(
      resolution.value.evidence.runtimeVerificationReportSha256,
      recovered.runtimeVerificationReportSha256,
    );
    assert.equal(
      resolution.value.evidence.bindingSha256,
      historicalFresh0016JsonSha256(fixture.binding),
    );
    assert.equal(
      resolution.value.evidenceSha256,
      historicalFresh0016JsonSha256(resolution.value.evidence),
    );
    assert.equal(resolution.value.readbackOnly, true);
    assert.equal(resolution.value.d1RetryAuthorized, false);
    assert.deepEqual(resolution.value.previousOwner, fixture.owner);
    assert.deepEqual(resolution.value.owner, recoveryOwner);
    const completion = state.stages.at(-1);
    assert.equal(completion?.value.owner.pid, recoveryOwner.pid);
    assert.equal(completion?.value.priorSha256, authorizationSha256);
    assert.equal(
      completion?.value.readbackResolutionSha256,
      resolution.sha256,
    );
    assert.equal(
      state.stages.filter((stage) => stage.value.stage === "migration-authorized")
        .length,
      1,
    );
  } finally {
    fixture.cleanup();
  }
});

test("unresolved authorization keeps exclusion-owner and pre-write evidence hashes immutable", () => {
  const fixture = createFixture();
  const first = createDatabaseRunner(fixture, "pre", ["absent-ambiguous"]);
  try {
    applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      runner: first.runner,
    });
    let laterRunnerCalled = false;
    assertApplyError(
      () =>
        applyHistoricalDataFresh0016Migration({
          ...fixture.options,
          productionExclusionOwnerSha256: "7".repeat(64),
          stateOwner: nextOwner(fixture.owner, 4),
          runner: () => {
            laterRunnerCalled = true;
            throw new Error("unreachable");
          },
        }),
      "STATE_INVALID",
    );
    assert.equal(laterRunnerCalled, false);
    assertApplyError(
      () =>
        applyHistoricalDataFresh0016Migration({
          ...fixture.options,
          preWriteEvidenceSha256: "8".repeat(64),
          stateOwner: nextOwner(fixture.owner, 5),
          runner: () => {
            laterRunnerCalled = true;
            throw new Error("unreachable");
          },
        }),
      "STATE_INVALID",
    );
    assert.equal(laterRunnerCalled, false);
  } finally {
    fixture.cleanup();
  }
});

test("unproven owner exit leaves exact committed readback review-required without state mutation", () => {
  const fixture = createFixture();
  const first = createDatabaseRunner(fixture, "pre", ["absent-ambiguous"]);
  try {
    applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      runner: first.runner,
    });
    const later = createDatabaseRunner(fixture, "committed", ["commit-confirmed"]);
    const reviewed = applyHistoricalDataFresh0016Migration({
      ...fixture.options,
      stateOwner: nextOwner(fixture.owner, 3),
      runner: later.runner,
      ownerExitProbe: () => false,
    });

    assert.equal(reviewed.status, "verified-readback-state-advance-required");
    assert.equal(reviewed.ok, false);
    assert.equal(reviewed.stateAdvanceRequired, true);
    assert.equal(reviewed.runtimeVerificationReport?.ok, true);
    assert.equal(reviewed.readbackResolutionSha256, null);
    assert.equal(later.fileCalls.length, 0);
    assert.equal(
      later.calls.length,
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.laterInvocation
        .exactCommittedReadOnlyCalls,
    );
    assertOnlyReadOnlyCalls(later.calls);
    const state = classifyHistoricalFresh0016State({
      backupDirectory: fixture.backupDirectory,
      runId,
    });
    assert.equal(state.currentStage, "migration-authorized");
    assert.equal(state.readbackResolutions.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("generic already-applied, partial execution, and wrong same-run marker are rejected terminally", async (t) => {
  await t.test("generic already-applied at manifest", () => {
    const fixture = createFixture();
    const database = createDatabaseRunner(fixture, "committed", []);
    try {
      assertApplyError(
        () =>
          applyHistoricalDataFresh0016Migration({
            ...fixture.options,
            runner: database.runner,
          }),
        "ALREADY_APPLIED_FORBIDDEN",
      );
      assert.equal(database.fileCalls.length, 0);
      assert.equal(
        classifyHistoricalFresh0016State({
          backupDirectory: fixture.backupDirectory,
          runId,
        }).currentStage,
        "manifest",
      );
    } finally {
      fixture.cleanup();
    }
  });

  for (const behavior of ["partial-confirmed", "wrong-confirmed"] as const) {
    await t.test(behavior, () => {
      const fixture = createFixture({ explicitSameInvocationRetry: true });
      const database = createDatabaseRunner(fixture, "pre", [behavior]);
      try {
        assertApplyError(
          () =>
            applyHistoricalDataFresh0016Migration({
              ...fixture.options,
              runner: database.runner,
            }),
          "TERMINAL_PARTIAL_STATE",
        );
        assert.equal(database.fileCalls.length, 1);
        assert.equal(
          classifyHistoricalFresh0016State({
            backupDirectory: fixture.backupDirectory,
            runId,
          }).currentStage,
          "migration-authorized",
        );
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("prestate and artifact gates fail closed before authorization or file execution", async (t) => {
  const cases: Array<{
    name: string;
    mode: DatabaseMode;
    metadata?: RunnerMetadataMutation;
    expected: HistoricalFresh0016ApplyErrorCode;
  }> = [
    { name: "partial prestate", mode: "partial", expected: "PRESTATE_INVALID" },
    { name: "wrong marker", mode: "wrong", expected: "PRESTATE_INVALID" },
    {
      name: "retried static read",
      mode: "pre",
      metadata: { staticTotalAttempts: 2 },
      expected: "D1_STATE_INDETERMINATE",
    },
    {
      name: "probe wrote rows",
      mode: "pre",
      metadata: { probeRowsWritten: 1 },
      expected: "D1_STATE_INDETERMINATE",
    },
    {
      name: "probe retried",
      mode: "pre",
      metadata: { probeTotalAttempts: 2 },
      expected: "D1_STATE_INDETERMINATE",
    },
  ];
  for (const currentCase of cases) {
    await t.test(currentCase.name, () => {
      const fixture = createFixture();
      const database = createDatabaseRunner(
        fixture,
        currentCase.mode,
        [],
        currentCase.metadata,
      );
      try {
        assertApplyError(
          () =>
            applyHistoricalDataFresh0016Migration({
              ...fixture.options,
              runner: database.runner,
            }),
          currentCase.expected,
        );
        assert.equal(database.fileCalls.length, 0);
        assert.equal(
          classifyHistoricalFresh0016State({
            backupDirectory: fixture.backupDirectory,
            runId,
          }).currentStage,
          "manifest",
        );
      } finally {
        fixture.cleanup();
      }
    });
  }

  await t.test("rendered hash mismatch", () => {
    const fixture = createFixture();
    let runnerCalled = false;
    try {
      assertApplyError(
        () =>
          applyHistoricalDataFresh0016Migration({
            ...fixture.options,
            renderedMigrationSha256: "9".repeat(64),
            runner: () => {
              runnerCalled = true;
              throw new Error("unreachable");
            },
          }),
        "INPUT_INVALID",
      );
      assert.equal(runnerCalled, false);
    } finally {
      fixture.cleanup();
    }
  });
});

test("source is re-hashed around every runner call and drift prevents a same-live retry", () => {
  const fixture = createFixture({ explicitSameInvocationRetry: true });
  const database = createDatabaseRunner(
    fixture,
    "pre",
    ["absent-source-drift", "commit-confirmed"],
  );
  try {
    assertApplyError(
      () =>
        applyHistoricalDataFresh0016Migration({
          ...fixture.options,
          runner: database.runner,
        }),
      "INPUT_INVALID",
    );
    assert.equal(database.fileCalls.length, 1);
    assert.equal(
      classifyHistoricalFresh0016State({
        backupDirectory: fixture.backupDirectory,
        runId,
      }).currentStage,
      "migration-authorized",
    );
  } finally {
    fixture.cleanup();
  }
});

test("apply state SQL is one bounded read-only schema-and-marker probe", () => {
  assert.equal(HISTORICAL_FRESH_0016_APPLY_STATE_MAX_ROWS_READ, 512);
  assert.match(HISTORICAL_FRESH_0016_APPLY_STATE_SQL, /^SELECT/);
  assert.match(
    HISTORICAL_FRESH_0016_APPLY_STATE_SQL,
    new RegExp(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY),
  );
  assert.match(
    HISTORICAL_FRESH_0016_APPLY_STATE_SQL,
    new RegExp(
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
        .freshCutoverMarkerKey,
    ),
  );
  assert.ok(
    (HISTORICAL_FRESH_0016_APPLY_STATE_SQL.match(/LIMIT 1/g) ?? []).length >=
      7,
  );
  assert.equal(
    (HISTORICAL_FRESH_0016_APPLY_STATE_SQL.match(/;/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(
    HISTORICAL_FRESH_0016_APPLY_STATE_SQL,
    /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH|BEGIN|COMMIT|ROLLBACK)\b/i,
  );
});

test("call-budget projection exposes prestate, two attempts, readbacks, and final exact verification", () => {
  assert.deepEqual(HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.prestate, {
    staticReadOnlyCalls: 1,
    boundedProbeReadOnlyCalls: 1,
  });
  assert.deepEqual(HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.perAttempt, {
    writeCapableCalls: 1,
    staticReadbackCalls: 1,
    boundedProbeReadbackCalls: 1,
  });
  assert.equal(
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocationAttempts,
    2,
  );
  assert.deepEqual(
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.finalExactVerification,
    { staticReadOnlyCalls: 1, boundedPostReadOnlyCalls: 1 },
  );
  assert.equal(
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
      .readOnlyCalls,
    8,
  );
  assert.equal(
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
      .writeCapableCalls,
    2,
  );
  assert.equal(
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
      .projectedRowsRead,
    4 * HISTORICAL_FRESH_0016_APPLY_GENERIC_STATIC_ROWS_READ_PROJECTION +
      3 * HISTORICAL_FRESH_0016_APPLY_STATE_MAX_ROWS_READ +
      HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ,
  );
  assert.equal(Object.isFrozen(HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET), true);
  assert.equal(
    Object.isFrozen(
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation,
    ),
    true,
  );
});

type Fixture = ReturnType<typeof createFixture>;
type DatabaseMode = "pre" | "committed" | "partial" | "wrong";
type ExecutionBehavior =
  | "commit-confirmed"
  | "commit-ambiguous"
  | "absent-ambiguous"
  | "absent-source-drift"
  | "partial-confirmed"
  | "wrong-confirmed";
type RunnerMetadataMutation = Readonly<{
  staticTotalAttempts?: number;
  staticRowsWritten?: number;
  splitStaticResultSets?: boolean;
  probeTotalAttempts?: number;
  probeRowsWritten?: number;
}>;

function createFixture(
  input: { explicitSameInvocationRetry?: boolean } = {},
) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "inspir-fresh-0016-apply-")),
  );
  fs.chmodSync(root, 0o700);
  const repoDirectory = path.join(root, "repo");
  const backupDirectory = path.join(root, "backup");
  fs.mkdirSync(repoDirectory, { mode: 0o700 });
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  runGit(repoDirectory, ["init"]);
  fs.writeFileSync(
    path.join(repoDirectory, "source.ts"),
    "export const freshApplyFixture = true;\n",
  );
  const migrationPath = path.join(
    repoDirectory,
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
  );
  fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
  fs.copyFileSync(
    path.resolve(
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
    ),
    migrationPath,
  );
  const source = buildRepoSourceFingerprint(repoDirectory);
  const sourceFingerprint = {
    sha256: source.sha256,
    fileCount: source.fileCount,
  };
  const owner = { hostname: os.hostname(), pid: 51_000 } as const;
  const paths = createHistoricalFresh0016RunDirectory({
    backupDirectory,
    runId,
  });
  const stageTime = Date.parse("2026-07-14T10:00:00.000Z");
  const commonStage = {
    backupDirectory,
    runId,
    sourceFingerprint,
    owner,
  };
  publishHistoricalFresh0016StateStage({
    ...commonStage,
    stage: "claim",
    payload: { kind: "fixture-claim" },
    now: new Date(stageTime),
  });
  publishHistoricalFresh0016StateStage({
    ...commonStage,
    stage: "predecessor-authorized",
    payload: { kind: "fixture-predecessor-authorization" },
    now: new Date(stageTime + 1_000),
  });
  publishHistoricalFresh0016StateStage({
    ...commonStage,
    stage: "predecessor-prepared",
    payload: { kind: "fixture-predecessor-prepared" },
    now: new Date(stageTime + 2_000),
  });
  const predecessorComplete = publishHistoricalFresh0016StateStage({
    ...commonStage,
    stage: "predecessor-complete",
    payload: { kind: "fixture-predecessor-complete" },
    now: new Date(stageTime + 3_000),
  });
  const predecessorReportBytes = Buffer.from(
    '{"kind":"fixture-predecessor-report"}\n',
    "utf8",
  );
  writeOwnerOnlyFile(
    paths.auxiliaryFiles.predecessorReport,
    predecessorReportBytes,
  );
  const predecessorReportSha256 = sha256(predecessorReportBytes);
  const preparedBudgetBytes = Buffer.from(
    '{"kind":"fixture-prepared-migration-budget"}\n',
    "utf8",
  );
  writeOwnerOnlyFile(
    paths.auxiliaryFiles.migrationBudgetPrepared,
    preparedBudgetBytes,
  );
  const migrationBudgetPreparedArtifactFileSha256 = sha256(
    preparedBudgetBytes,
  );
  const manifestPayload = {
    kind: "fixture-fresh-0016-manifest",
    schemaVersion: 1,
    predecessorCompleteStageSha256: predecessorComplete.sha256,
    predecessorReportSha256,
  };
  const manifestSha256 = historicalFresh0016JsonSha256(manifestPayload);
  const binding: HistoricalFresh0016MigrationBinding = {
    cutoverRunId: runId,
    cutoverManifestSha256: manifestSha256,
    migrationBudgetPreparedArtifactFileSha256,
    predecessorReportSha256,
    predecessorCompleteSha256: predecessorComplete.sha256,
    predecessorEvidenceChainSha256: "d".repeat(64),
    predecessorHmacKeyId: "e".repeat(64),
    successorSnapshotPlanSha256:
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor.snapshotPlanSha256,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    sourceFingerprint,
    database: { ...HISTORICAL_FRESH_0016_CUTOVER_POLICY.database },
  };
  publishHistoricalFresh0016StateStage({
    ...commonStage,
    stage: "manifest",
    payload: manifestPayload,
    now: new Date(stageTime + 4_000),
  });
  const rendered = publishHistoricalFresh0016RenderedMigration({
    cwd: repoDirectory,
    backupDir: backupDirectory,
    runDirectory: paths.runDirectory,
    binding,
  });
  let clockMs = stageTime + 10_000;
  const options: Omit<ApplyHistoricalFresh0016MigrationOptions, "runner"> = {
    binding,
    predecessorCompleteSha256: predecessorComplete.sha256,
    preWriteEvidenceSha256: "f".repeat(64),
    renderedMigrationSha256: rendered.evidence.renderedMigration.sha256,
    productionExclusionOwnerSha256: "1".repeat(64),
    activeWorkerVersion,
    sourceFingerprint,
    cwd: repoDirectory,
    backupDirectory,
    runDirectory: paths.runDirectory,
    explicitSameInvocationRetry: input.explicitSameInvocationRetry ?? false,
    stateOwner: owner,
    clock: () => {
      const value = new Date(clockMs);
      clockMs += 1_000;
      return value;
    },
  };
  return {
    root,
    repoDirectory,
    backupDirectory,
    runDirectory: paths.runDirectory,
    binding,
    owner,
    options,
    freshMarkerValue: canonicalHistoricalFresh0016DatabaseMarkerValue(
      createHistoricalFresh0016DatabaseMarker(binding),
    ),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function createDatabaseRunner(
  fixture: Fixture,
  initialMode: DatabaseMode,
  behaviors: ExecutionBehavior[],
  metadata: RunnerMetadataMutation = {},
) {
  let mode = initialMode;
  let behaviorIndex = 0;
  let stageObservedAtFile: string | null = null;
  const calls: string[][] = [];
  const fileCalls: string[][] = [];
  const runner: WranglerRunner = (args) => {
    calls.push([...args]);
    const command = args.at(-1);
    if (command === RUNTIME_MIGRATION_VERIFICATION_SQL) {
      const rows = mode === "committed" || mode === "wrong"
        ? committedStaticRows()
        : pre0016StaticRows();
      const rowsWritten = metadata.staticRowsWritten ?? 0;
      const totalAttempts = metadata.staticTotalAttempts ?? 1;
      return JSON.stringify(
        metadata.splitStaticResultSets
          ? rows.map((row) => staticResult([row], rowsWritten, totalAttempts))
          : [staticResult(rows, rowsWritten, totalAttempts)],
      );
    }
    if (command === HISTORICAL_FRESH_0016_APPLY_STATE_SQL) {
      return JSON.stringify([
        applyProbeResult(
          fixture,
          mode,
          metadata.probeRowsWritten ?? 0,
          metadata.probeTotalAttempts ?? 1,
        ),
      ]);
    }
    if (command === HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL) {
      return JSON.stringify([postVerificationResult(fixture)]);
    }
    if (args.includes("--file")) {
      fileCalls.push([...args]);
      stageObservedAtFile = classifyHistoricalFresh0016State({
        backupDirectory: fixture.backupDirectory,
        runId,
      }).currentStage;
      const behavior = behaviors[behaviorIndex];
      behaviorIndex += 1;
      if (!behavior) throw new Error("Unexpected fresh-0016 file execution.");
      if (behavior === "commit-confirmed") mode = "committed";
      if (behavior === "commit-ambiguous") {
        mode = "committed";
        throw new Error(privateRunnerFailure);
      }
      if (behavior === "absent-ambiguous") {
        mode = "pre";
        throw new Error(privateRunnerFailure);
      }
      if (behavior === "absent-source-drift") {
        mode = "pre";
        fs.writeFileSync(
          path.join(fixture.repoDirectory, "source.ts"),
          "export const freshApplyFixtureSourceDrifted = true;\n",
        );
      }
      if (behavior === "partial-confirmed") mode = "partial";
      if (behavior === "wrong-confirmed") mode = "wrong";
      return JSON.stringify([
        {
          success: true,
          results: [],
          meta: { rows_read: 0, rows_written: 1, total_attempts: 1 },
        },
      ]);
    }
    throw new Error(`Unexpected Wrangler call: ${args.join(" ")}`);
  };
  return {
    runner,
    calls,
    fileCalls,
    get stageObservedAtFile() {
      return stageObservedAtFile;
    },
  };
}

function staticResult(
  rows: Array<Record<string, unknown>>,
  rowsWritten: number,
  totalAttempts: number,
) {
  return {
    success: true,
    results: rows,
    meta: {
      rows_read: rows.length,
      rows_written: rowsWritten,
      total_attempts: totalAttempts,
    },
  };
}

function applyProbeResult(
  fixture: Fixture,
  mode: DatabaseMode,
  rowsWritten: number,
  totalAttempts: number,
) {
  const absent = mode === "pre";
  const committed = mode === "committed";
  const wrong = mode === "wrong";
  return {
    success: true,
    results: [
      {
        summary_mask_column_exists: absent ? 0 : 1,
        outbox_table_exists: absent ? 0 : 1,
        outbox_index_exists: absent ? 0 : mode === "partial" ? 0 : 1,
        fixed_marker_exists: committed || wrong ? 1 : 0,
        fixed_marker_value:
          committed || wrong
            ? RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE
            : null,
        fixed_marker_updated_at: committed || wrong ? fixedUpdatedAt : null,
        fresh_marker_exists: committed || wrong ? 1 : 0,
        fresh_marker_value: committed
          ? fixture.freshMarkerValue
          : wrong
            ? canonicalHistoricalFresh0016DatabaseMarkerValue({
                ...createHistoricalFresh0016DatabaseMarker(fixture.binding),
                cutoverManifestSha256: "9".repeat(64),
              })
            : null,
        fresh_marker_updated_at:
          committed || wrong ? freshUpdatedAt : null,
      },
    ],
    meta: { rows_read: 9, rows_written: rowsWritten, total_attempts: totalAttempts },
  };
}

function postVerificationResult(fixture: Fixture) {
  return {
    success: true,
    results: [
      {
        fixed_value: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
        fixed_updated_at: fixedUpdatedAt,
        fresh_value: fixture.freshMarkerValue,
        fresh_updated_at: freshUpdatedAt,
        outbox_has_rows: 0,
      },
    ],
    meta: { rows_read: 5, rows_written: 0, total_attempts: 1 },
  };
}

function pre0016StaticRows(): Array<Record<string, unknown>> {
  return [
    columnRow("completion_token"),
    columnRow("completion_message_id"),
    indexRow({
      name: "rate_limit_windows_reset_at_idx",
      tableName: "rate_limit_windows",
      columnName: "reset_at",
      sql: "CREATE INDEX rate_limit_windows_reset_at_idx ON rate_limit_windows (reset_at)",
      unique: 0,
      partial: 0,
    }),
    indexRow({
      name: "ai_runs_created_idx",
      tableName: "ai_runs",
      columnName: "created_at",
      sql: "CREATE INDEX ai_runs_created_idx ON ai_runs (created_at)",
      unique: 0,
      partial: 0,
    }),
    indexRow({
      name: "ops_events_user_id_idx",
      tableName: "ops_events",
      columnName: "user_id",
      sql: "CREATE INDEX ops_events_user_id_idx ON ops_events (user_id)",
      unique: 0,
      partial: 0,
    }),
    indexRow({
      name: "activity_runs_completion_token_uidx",
      tableName: "activity_runs",
      columnName: "completion_token",
      sql: "CREATE UNIQUE INDEX activity_runs_completion_token_uidx ON activity_runs (completion_token) WHERE completion_token IS NOT NULL",
      unique: 1,
      partial: 1,
    }),
    indexRow({
      name: "activity_runs_completion_message_id_uidx",
      tableName: "activity_runs",
      columnName: "completion_message_id",
      sql: "CREATE UNIQUE INDEX activity_runs_completion_message_id_uidx ON activity_runs (completion_message_id) WHERE completion_message_id IS NOT NULL",
      unique: 1,
      partial: 1,
    }),
    adminSnapshotRow(),
  ];
}

function committedStaticRows(): Array<Record<string, unknown>> {
  return [
    ...pre0016StaticRows(),
    {
      kind: "memory-settings-column",
      name: "summary_suppression_mask",
      table_name: "user_memory_settings",
      column_type: "INTEGER",
      column_not_null: 1,
      column_default: "0",
      column_primary_key: 0,
      table_sql: `CREATE TABLE user_memory_settings (
        user_id text PRIMARY KEY NOT NULL,
        summary_suppression_mask integer DEFAULT 0 NOT NULL
          CONSTRAINT user_memory_settings_summary_suppression_mask_check
          CHECK (summary_suppression_mask BETWEEN 0 AND 511)
      )`,
    },
    {
      kind: "migration-marker",
      name: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
      table_name: "app_metadata",
      table_sql: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
      snapshot_updated_at: fixedUpdatedAt,
    },
    ...outboxRows(),
  ];
}

function outboxRows(): Array<Record<string, unknown>> {
  const columnSpecs = [
    ["vector_id", "TEXT", 1, null, 1],
    ["owner_user_id", "TEXT", 0, null, 0],
    ["source_namespace", "TEXT", 0, null, 0],
    ["source_row_id", "TEXT", 0, null, 0],
    ["source_row_revision", "INTEGER", 0, null, 0],
    ["write_token", "TEXT", 0, null, 0],
    ["reason", "TEXT", 1, null, 0],
    ["state", "TEXT", 1, "'cleanup_ready'", 0],
    ["write_fence_expires_at", "INTEGER", 0, null, 0],
    ["absence_count", "INTEGER", 1, "0", 0],
    ["attempt_count", "INTEGER", 1, "0", 0],
    ["lease_token", "TEXT", 0, null, 0],
    ["lease_until", "INTEGER", 1, "0", 0],
    ["next_attempt_at", "INTEGER", 1, null, 0],
    ["last_attempt_at", "INTEGER", 0, null, 0],
    ["last_error", "TEXT", 0, null, 0],
    ["created_at", "INTEGER", 1, null, 0],
    ["updated_at", "INTEGER", 1, null, 0],
  ] as const;
  const tableSql = `CREATE TABLE memory_vector_cleanup_outbox (
    vector_id text PRIMARY KEY NOT NULL CHECK (length(vector_id) BETWEEN 1 AND 64 AND vector_id NOT GLOB '*[^A-Za-z0-9:._-]*'),
    owner_user_id text CHECK (owner_user_id IS NULL OR length(owner_user_id) BETWEEN 1 AND 120),
    source_namespace text CHECK (source_namespace IS NULL OR source_namespace IN ('user_memories', 'chat_memory_turns')),
    source_row_id text CHECK (source_row_id IS NULL OR length(source_row_id) BETWEEN 1 AND 120),
    source_row_revision integer CHECK (source_row_revision IS NULL OR source_row_revision BETWEEN 1 AND 9007199254740991),
    write_token text CHECK (write_token IS NULL OR length(write_token) BETWEEN 1 AND 120),
    reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 80),
    state text DEFAULT 'cleanup_ready' NOT NULL CHECK (state IN ('write_pending', 'cleanup_fenced', 'cleanup_ready', 'verifying_absence')),
    write_fence_expires_at integer CHECK (write_fence_expires_at IS NULL OR write_fence_expires_at >= 0),
    absence_count integer DEFAULT 0 NOT NULL CHECK (absence_count >= 0 AND absence_count <= 2),
    attempt_count integer DEFAULT 0 NOT NULL CHECK (attempt_count >= 0),
    lease_token text CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 1 AND 120),
    lease_until integer DEFAULT 0 NOT NULL CHECK (lease_until >= 0),
    next_attempt_at integer NOT NULL CHECK (next_attempt_at >= 0),
    last_attempt_at integer CHECK (last_attempt_at IS NULL OR last_attempt_at >= 0),
    last_error text CHECK (last_error IS NULL OR length(last_error) <= 160),
    created_at integer NOT NULL CHECK (created_at >= 0),
    updated_at integer NOT NULL CHECK (updated_at >= 0)
  )`;
  const indexSql =
    "CREATE INDEX memory_vector_cleanup_outbox_due_idx ON memory_vector_cleanup_outbox (next_attempt_at, created_at, vector_id)";
  return [
    ...columnSpecs.map(([name, type, notNull, defaultValue, primaryKey]) => ({
      kind: "outbox-column",
      name,
      table_name: "memory_vector_cleanup_outbox",
      column_type: type,
      column_not_null: notNull,
      column_default: defaultValue,
      column_primary_key: primaryKey,
    })),
    {
      kind: "outbox-table",
      name: "memory_vector_cleanup_outbox",
      table_name: "memory_vector_cleanup_outbox",
      table_sql: tableSql,
      custom_index_count: 1,
    },
    ...["next_attempt_at", "created_at", "vector_id"].map(
      (columnName, index) => ({
        kind: "index",
        name: "memory_vector_cleanup_outbox_due_idx",
        table_name: "memory_vector_cleanup_outbox",
        index_sql: indexSql,
        index_unique: 0,
        index_origin: "c",
        index_partial: 0,
        index_seqno: index,
        index_column: columnName,
      }),
    ),
  ];
}

function adminSnapshotRow(): Record<string, unknown> {
  return {
    kind: "admin-snapshot",
    name: "native-admin-totals-v1",
    table_name: "app_metadata",
    snapshot_json_valid: 1,
    snapshot_users_type: "integer",
    snapshot_users: 40_467,
    snapshot_chats_type: "integer",
    snapshot_chats: 1_240,
    snapshot_messages_type: "integer",
    snapshot_messages: 4_550,
    snapshot_ai_runs_type: "integer",
    snapshot_ai_runs: 500,
    snapshot_updated_at: fixedUpdatedAt,
  };
}

function columnRow(name: string): Record<string, unknown> {
  return {
    kind: "activity-column",
    name,
    table_name: "activity_runs",
    column_type: "TEXT",
    column_not_null: 0,
    column_default: null,
    column_primary_key: 0,
  };
}

function indexRow(input: {
  name: string;
  tableName: string;
  columnName: string;
  sql: string;
  unique: 0 | 1;
  partial: 0 | 1;
}): Record<string, unknown> {
  return {
    kind: "index",
    name: input.name,
    table_name: input.tableName,
    index_sql: input.sql,
    index_unique: input.unique,
    index_origin: "c",
    index_partial: input.partial,
    index_seqno: 0,
    index_column: input.columnName,
  };
}

function fileArgument(args: string[]) {
  const fileIndex = args.indexOf("--file");
  return fileIndex === -1 ? null : args[fileIndex + 1] ?? null;
}

function assertOnlyReadOnlyCalls(calls: string[][]) {
  const allowedCommands = new Set([
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    HISTORICAL_FRESH_0016_APPLY_STATE_SQL,
    HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
  ]);
  for (const args of calls) {
    assert.equal(args.includes("--file"), false);
    assert.equal(args.includes("--command"), true);
    assert.equal(args.includes("--remote"), true);
    assert.equal(args.includes("--json"), true);
    assert.equal(allowedCommands.has(args.at(-1) ?? ""), true);
  }
}

function nextOwner(owner: HistoricalFresh0016Owner, offset: number) {
  return { hostname: owner.hostname, pid: owner.pid + offset };
}

function writeOwnerOnlyFile(file: string, bytes: Buffer) {
  assert.equal(
    new Set<string>([
      HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.predecessorReport,
      HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
        .migrationBudgetPrepared,
    ]).has(path.basename(file)),
    true,
  );
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertApplyError(
  operation: () => unknown,
  code: HistoricalFresh0016ApplyErrorCode,
) {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof HistoricalFresh0016ApplyError);
    assert.equal(error.code, code);
    return true;
  });
}
