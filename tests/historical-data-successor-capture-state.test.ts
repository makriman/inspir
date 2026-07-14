import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HistoricalSuccessorCaptureStateError,
  acquireHistoricalSuccessorCaptureClaim,
  acquireHistoricalSuccessorCaptureResumeLease,
  authorizeHistoricalSuccessorCaptureScan,
  canonicalSuccessorCaptureJson,
  classifyHistoricalSuccessorCaptureState,
  completeHistoricalSuccessorCapture,
  finalizeHistoricalSuccessorScanAuthorizationPublication,
  historicalSuccessorCaptureStatePaths,
  prepareHistoricalSuccessorCapture,
  readHistoricalSuccessorCaptureClaim,
  readHistoricalSuccessorCaptureResumeLeases,
  successorCaptureStateFileSha256,
  type HistoricalSuccessorCaptureExpectedIdentity,
} from "../scripts/cloudflare/historical-data-successor-capture-state";

const secret = "unit-test-hmac-secret-that-must-never-be-persisted";
const captureDay = "2026-07-14";
const claimAt = new Date("2026-07-14T00:01:00.000Z");
const authorizedAt = new Date("2026-07-14T00:02:00.000Z");
const preparedAt = new Date("2026-07-14T00:03:00.000Z");
const completedAt = new Date("2026-07-14T00:31:00.000Z");
const windowEndsAt = "2026-07-14T00:30:00.000Z";
const runId = "123e4567-e89b-42d3-a456-426614174000";
const hashes = {
  policy: "a".repeat(64),
  archive: "b".repeat(64),
  predecessor: "c".repeat(64),
  key: "d".repeat(64),
  source: "e".repeat(64),
  plan: "f".repeat(64),
  sentinel: createHash("sha256").update("sentinel").digest("hex"),
};

test("exclusive lifecycle is canonical, hash-chained, replayable, and owner-only", () => {
  const fixture = createFixture();
  try {
    assert.deepEqual(classifyHistoricalSuccessorCaptureState({
      stateDirectory: fixture.stateDirectory,
      expected: fixture.expected,
    }), {
      status: "empty",
      d1ScanMayHaveStarted: false,
      automaticRescanAllowed: true,
    });

    const claim = acquireClaim(fixture);
    assert.equal(fileMode(claim.path), 0o600);
    assert.equal(
      fs.readFileSync(claim.path, "utf8"),
      `${canonicalSuccessorCaptureJson(claim.value)}\n`,
    );
    assert.equal(claim.sha256, successorCaptureStateFileSha256(claim.value));
    assert.equal(
      classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
        expected: fixture.expected,
      }).status,
      "claimed-pre-scan",
    );

    assertStateError(
      () => acquireClaim(fixture),
      "STATE_CONFLICT",
    );

    const authorization = authorizeHistoricalSuccessorCaptureScan({
      stateDirectory: fixture.stateDirectory,
      claim,
      snapshotPlanSha256: hashes.plan,
      maximumRowsRead: 750_000,
      now: authorizedAt,
    });
    assert.equal(authorization.value.lockSha256, claim.sha256);
    assert.equal(fileMode(authorization.path), 0o600);
    assert.equal(
      classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
        expected: fixture.expected,
      }).status,
      "scan-authorized-unresolved",
    );

    const report = successorReport(fixture);
    const prepared = prepareHistoricalSuccessorCapture({
      stateDirectory: fixture.stateDirectory,
      claim,
      scanAuthorized: authorization,
      report,
      forbiddenPlaintextValues: [secret],
      now: preparedAt,
    });
    assert.equal(prepared.value.lockSha256, claim.sha256);
    assert.equal(prepared.value.scanAuthorizedSha256, authorization.sha256);
    assert.equal(fileMode(prepared.path), 0o600);
    assert.equal(
      classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
        expected: fixture.expected,
      }).status,
      "prepared",
    );

    writePrivateJson(fixture.baselinePath, report);
    assert.ok(completedAt.getTime() > Date.parse(windowEndsAt));
    const complete = completeHistoricalSuccessorCapture({
      stateDirectory: fixture.stateDirectory,
      claim,
      scanAuthorized: authorization,
      prepared,
      canonicalBaselinePath: fixture.baselinePath,
      now: completedAt,
    });
    assert.equal(complete.value.lockSha256, claim.sha256);
    assert.equal(complete.value.scanAuthorizedSha256, authorization.sha256);
    assert.equal(complete.value.preparedSha256, prepared.sha256);
    assert.equal(
      complete.value.canonicalBaselineSha256,
      createHash("sha256").update(fs.readFileSync(fixture.baselinePath)).digest("hex"),
    );
    assert.equal(
      classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
        expected: fixture.expected,
      }).status,
      "complete-retained-claim",
    );
    assert.equal(fs.existsSync(claim.path), true);
    for (const marker of [authorization.path, prepared.path, complete.path]) {
      assert.equal(fileMode(marker), 0o600);
    }
    const persisted = [authorization.path, prepared.path, complete.path]
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    assert.equal(persisted.includes(secret), false);
    assertStateError(() => acquireClaim(fixture), "STATE_CONFLICT");
  } finally {
    fixture.cleanup();
  }
});

test("forbidden sensitive plaintext fails before a prepared marker is written", () => {
  const fixture = createFixture();
  try {
    const claim = acquireClaim(fixture);
    const authorization = authorizeHistoricalSuccessorCaptureScan({
      stateDirectory: fixture.stateDirectory,
      claim,
      snapshotPlanSha256: hashes.plan,
      maximumRowsRead: 750_000,
      now: authorizedAt,
    });
    assertStateError(
      () =>
        prepareHistoricalSuccessorCapture({
          stateDirectory: fixture.stateDirectory,
          claim,
          scanAuthorized: authorization,
          report: { ...successorReport(fixture), accidentalNote: `prefix:${secret}:suffix` },
          forbiddenPlaintextValues: [secret],
          now: preparedAt,
        }),
      "STATE_SCHEMA_INVALID",
    );
    const paths = historicalSuccessorCaptureStatePaths(fixture.stateDirectory);
    assert.equal(fs.existsSync(paths.prepared), false);
    assert.equal(
      classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
      }).status,
      "scan-authorized-unresolved",
    );
  } finally {
    fixture.cleanup();
  }
});

test("noncanonical, extra-key, broad-mode, and symlink claims fail closed", async (t) => {
  await t.test("noncanonical JSON", () => {
    const fixture = createFixture();
    try {
      const claim = acquireClaim(fixture);
      fs.writeFileSync(claim.path, `${JSON.stringify(claim.value, null, 2)}\n`, {
        mode: 0o600,
      });
      assertStateError(
        () => readHistoricalSuccessorCaptureClaim(fixture.stateDirectory),
        "STATE_SCHEMA_INVALID",
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("extra schema key", () => {
    const fixture = createFixture();
    try {
      const claim = acquireClaim(fixture);
      const changed = { ...claim.value, unexpected: true };
      fs.writeFileSync(
        claim.path,
        `${canonicalSuccessorCaptureJson(changed)}\n`,
        { mode: 0o600 },
      );
      assertStateError(
        () => readHistoricalSuccessorCaptureClaim(fixture.stateDirectory),
        "STATE_SCHEMA_INVALID",
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("broad file mode", () => {
    const fixture = createFixture();
    try {
      const claim = acquireClaim(fixture);
      fs.chmodSync(claim.path, 0o644);
      assertStateError(
        () => classifyHistoricalSuccessorCaptureState({
          stateDirectory: fixture.stateDirectory,
        }),
        "STATE_FILE_UNSAFE",
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("symlink file", () => {
    const fixture = createFixture();
    try {
      const paths = historicalSuccessorCaptureStatePaths(fixture.stateDirectory);
      const target = path.join(fixture.root, "target.json");
      fs.writeFileSync(target, "{}\n", { mode: 0o600 });
      fs.symlinkSync(target, paths.lock);
      assertStateError(
        () => classifyHistoricalSuccessorCaptureState({
          stateDirectory: fixture.stateDirectory,
        }),
        "STATE_FILE_UNSAFE",
      );
    } finally {
      fixture.cleanup();
    }
  });
});

test("unsafe state directories are rejected before claim creation", () => {
  const fixture = createFixture();
  try {
    fs.chmodSync(fixture.stateDirectory, 0o755);
    assertStateError(() => acquireClaim(fixture), "STATE_DIRECTORY_UNSAFE");
    const paths = historicalSuccessorCaptureStatePaths(fixture.stateDirectory);
    assert.equal(fs.existsSync(paths.lock), false);
  } finally {
    fixture.cleanup();
  }
});

test("resume leases have one atomic slot winner and only the latest may authorize", () => {
  const fixture = createFixture();
  try {
    const claim = acquireClaim(fixture);
    const first = acquireHistoricalSuccessorCaptureResumeLease({
      stateDirectory: fixture.stateDirectory,
      claim,
      now: authorizedAt,
    });
    assert.equal(first.value.attempt, 1);
    assert.equal(first.value.previousLeaseSha256, null);
    assertStateError(
      () =>
        acquireHistoricalSuccessorCaptureResumeLease({
          stateDirectory: fixture.stateDirectory,
          claim,
          now: preparedAt,
        }),
      "STATE_CONFLICT",
    );

    const second = acquireHistoricalSuccessorCaptureResumeLease({
      stateDirectory: fixture.stateDirectory,
      claim,
      expectedLatestLease: first,
      now: preparedAt,
    });
    assert.equal(second.value.attempt, 2);
    assert.equal(second.value.previousLeaseSha256, first.sha256);
    assert.deepEqual(
      readHistoricalSuccessorCaptureResumeLeases(fixture.stateDirectory).map(
        (lease) => lease.sha256,
      ),
      [first.sha256, second.sha256],
    );
    assertStateError(
      () =>
        authorizeHistoricalSuccessorCaptureScan({
          stateDirectory: fixture.stateDirectory,
          claim,
          resumeLease: first,
          snapshotPlanSha256: hashes.plan,
          maximumRowsRead: 750_000,
          now: preparedAt,
        }),
      "STATE_HANDLE_CHANGED",
    );
    const authorization = authorizeHistoricalSuccessorCaptureScan({
      stateDirectory: fixture.stateDirectory,
      claim,
      resumeLease: second,
      snapshotPlanSha256: hashes.plan,
      maximumRowsRead: 750_000,
      now: preparedAt,
    });
    assert.equal(authorization.value.resumeLeaseSha256, second.sha256);
  } finally {
    fixture.cleanup();
  }
});

test("a concurrent reader may recover the publication alias without failing the scan-authorized writer", (t) => {
  const fixture = createFixture();
  try {
    const claim = acquireClaim(fixture);
    const paths = historicalSuccessorCaptureStatePaths(fixture.stateDirectory);
    const nativeLinkSync = fs.linkSync;
    let readerStatus: string | undefined;
    t.mock.method(
      fs,
      "linkSync",
      (
        existingPath: Parameters<typeof fs.linkSync>[0],
        newPath: Parameters<typeof fs.linkSync>[1],
      ) => {
        nativeLinkSync(existingPath, newPath);
        if (newPath === paths.scanAuthorized) {
          readerStatus = classifyHistoricalSuccessorCaptureState({
            stateDirectory: fixture.stateDirectory,
            expected: fixture.expected,
          }).status;
        }
      },
    );

    const authorization = authorizeHistoricalSuccessorCaptureScan({
      stateDirectory: fixture.stateDirectory,
      claim,
      snapshotPlanSha256: hashes.plan,
      maximumRowsRead: 750_000,
      now: authorizedAt,
    });

    assert.equal(
      readerStatus,
      "scan-authorization-publication-interrupted",
    );
    assert.equal(authorization.path, paths.scanAuthorized);
    assert.equal(fs.statSync(authorization.path).nlink, 1);
  } finally {
    fixture.cleanup();
  }
});

test("late staging-alias directory sync failure cannot negate durable scan authorization", (t) => {
  const fixture = createFixture();
  try {
    const claim = acquireClaim(fixture);
    const nativeFsyncSync = fs.fsyncSync;
    let fsyncCalls = 0;
    t.mock.method(
      fs,
      "fsyncSync",
      (descriptor: Parameters<typeof fs.fsyncSync>[0]) => {
        fsyncCalls += 1;
        if (fsyncCalls === 3) {
          const error: NodeJS.ErrnoException = new Error("simulated late EIO");
          error.code = "EIO";
          throw error;
        }
        nativeFsyncSync(descriptor);
      },
    );

    const authorization = authorizeHistoricalSuccessorCaptureScan({
      stateDirectory: fixture.stateDirectory,
      claim,
      snapshotPlanSha256: hashes.plan,
      maximumRowsRead: 750_000,
      now: authorizedAt,
    });

    assert.equal(fsyncCalls, 3);
    assert.equal(fs.statSync(authorization.path).nlink, 1);
    assert.equal(
      classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
        expected: fixture.expected,
      }).status,
      "scan-authorized-unresolved",
    );
  } finally {
    fixture.cleanup();
  }
});

test("first publication sync failure remains definitely pre-D1 and exact-resumable", (t) => {
  const fixture = createFixture();
  try {
    const claim = acquireClaim(fixture);
    const nativeFsyncSync = fs.fsyncSync;
    let fsyncCalls = 0;
    t.mock.method(
      fs,
      "fsyncSync",
      (descriptor: Parameters<typeof fs.fsyncSync>[0]) => {
        fsyncCalls += 1;
        if (fsyncCalls === 2) {
          const error: NodeJS.ErrnoException = new Error("simulated first-sync EIO");
          error.code = "EIO";
          throw error;
        }
        nativeFsyncSync(descriptor);
      },
    );

    assertStateError(
      () =>
        authorizeHistoricalSuccessorCaptureScan({
          stateDirectory: fixture.stateDirectory,
          claim,
          snapshotPlanSha256: hashes.plan,
          maximumRowsRead: 750_000,
          now: authorizedAt,
        }),
      "STATE_FILE_UNSAFE",
    );
    const interrupted = classifyHistoricalSuccessorCaptureState({
      stateDirectory: fixture.stateDirectory,
      expected: fixture.expected,
    });
    assert.equal(
      interrupted.status,
      "scan-authorization-publication-interrupted",
    );
    if (interrupted.status !== "scan-authorization-publication-interrupted") {
      throw new Error("Expected exact interrupted scan authorization evidence.");
    }
    assert.equal(interrupted.d1ScanMayHaveStarted, false);
    assert.equal(fs.statSync(interrupted.scanAuthorized.path).nlink, 2);

    t.mock.restoreAll();
    const resumeLease = acquireHistoricalSuccessorCaptureResumeLease({
      stateDirectory: fixture.stateDirectory,
      claim: interrupted.claim,
      now: preparedAt,
    });
    const finalized = finalizeHistoricalSuccessorScanAuthorizationPublication({
      stateDirectory: fixture.stateDirectory,
      claim: interrupted.claim,
      resumeLease,
      scanAuthorized: interrupted.scanAuthorized,
    });
    assert.equal(fs.statSync(finalized.path).nlink, 1);
    assert.equal(
      classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
        expected: fixture.expected,
      }).status,
      "scan-authorized-unresolved",
    );
  } finally {
    fixture.cleanup();
  }
});

test("an interrupted staging write leaves no public or hidden state and remains retryable", (t) => {
  const fixture = createFixture();
  try {
    const paths = historicalSuccessorCaptureStatePaths(fixture.stateDirectory);
    t.mock.method(
      fs,
      "writeFileSync",
      (
        file: Parameters<typeof fs.writeFileSync>[0],
        data: Parameters<typeof fs.writeFileSync>[1],
      ) => {
        if (typeof file !== "number" || !Buffer.isBuffer(data)) {
          throw new Error("unexpected state-writer test call");
        }
        fs.writeSync(file, data.subarray(0, Math.min(12, data.byteLength)));
        const error: NodeJS.ErrnoException = new Error("simulated ENOSPC");
        error.code = "ENOSPC";
        throw error;
      },
    );

    assertStateError(() => acquireClaim(fixture), "STATE_FILE_UNSAFE");
    assert.equal(fs.existsSync(paths.lock), false);
    assert.deepEqual(
      classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
        expected: fixture.expected,
      }),
      {
        status: "empty",
        d1ScanMayHaveStarted: false,
        automaticRescanAllowed: true,
      },
    );
    assert.deepEqual(
      fs.readdirSync(fixture.stateDirectory).filter((entry) => entry.endsWith(".tmp")),
      [],
    );

    t.mock.restoreAll();
    const retry = acquireClaim(fixture);
    assert.equal(retry.path, paths.lock);
  } finally {
    fixture.cleanup();
  }
});

test("tampered authorization hash chains remain unresolved with their immutable claim", () => {
  const fixture = createFixture();
  try {
    const claim = acquireClaim(fixture);
    const authorization = authorizeHistoricalSuccessorCaptureScan({
      stateDirectory: fixture.stateDirectory,
      claim,
      snapshotPlanSha256: hashes.plan,
      maximumRowsRead: 750_000,
      now: authorizedAt,
    });
    const tampered = { ...authorization.value, lockSha256: "0".repeat(64) };
    fs.writeFileSync(
      authorization.path,
      `${canonicalSuccessorCaptureJson(tampered)}\n`,
      { mode: 0o600 },
    );
    assertStateError(
      () => classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
      }),
      "STATE_CHAIN_BROKEN",
    );
    assert.equal(fs.existsSync(claim.path), true);
  } finally {
    fixture.cleanup();
  }
});

test("authorization without its claim is indeterminate and never classified as empty", () => {
  const fixture = createFixture();
  try {
    const claim = acquireClaim(fixture);
    authorizeHistoricalSuccessorCaptureScan({
      stateDirectory: fixture.stateDirectory,
      claim,
      snapshotPlanSha256: hashes.plan,
      maximumRowsRead: 750_000,
      now: authorizedAt,
    });
    fs.unlinkSync(claim.path);
    assertStateError(
      () => classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
      }),
      "STATE_INCONSISTENT",
    );
  } finally {
    fixture.cleanup();
  }
});

test("completion and replay fail closed if canonical baseline bytes change", () => {
  const fixture = createFixture();
  try {
    const claim = acquireClaim(fixture);
    const authorization = authorizeHistoricalSuccessorCaptureScan({
      stateDirectory: fixture.stateDirectory,
      claim,
      snapshotPlanSha256: hashes.plan,
      maximumRowsRead: 750_000,
      now: authorizedAt,
    });
    const report = successorReport(fixture);
    const prepared = prepareHistoricalSuccessorCapture({
      stateDirectory: fixture.stateDirectory,
      claim,
      scanAuthorized: authorization,
      report,
      forbiddenPlaintextValues: [secret],
      now: preparedAt,
    });

    writePrivateJson(fixture.baselinePath, { ...report, ok: false });
    assertStateError(
      () =>
        completeHistoricalSuccessorCapture({
          stateDirectory: fixture.stateDirectory,
          claim,
          scanAuthorized: authorization,
          prepared,
          canonicalBaselinePath: fixture.baselinePath,
          now: completedAt,
        }),
      "STATE_CHAIN_BROKEN",
    );
    assert.equal(
      fs.existsSync(
        historicalSuccessorCaptureStatePaths(fixture.stateDirectory).complete,
      ),
      false,
    );

    fs.unlinkSync(fixture.baselinePath);
    writePrivateJson(fixture.baselinePath, report);
    completeHistoricalSuccessorCapture({
      stateDirectory: fixture.stateDirectory,
      claim,
      scanAuthorized: authorization,
      prepared,
      canonicalBaselinePath: fixture.baselinePath,
      now: completedAt,
    });
    fs.writeFileSync(
      fixture.baselinePath,
      `${JSON.stringify({ ...report, rowsRead: report.rowsRead + 1 }, null, 2)}\n`,
      { mode: 0o600 },
    );
    assertStateError(
      () => classifyHistoricalSuccessorCaptureState({
        stateDirectory: fixture.stateDirectory,
      }),
      "STATE_CHAIN_BROKEN",
    );
    assert.equal(fs.existsSync(claim.path), true);
  } finally {
    fixture.cleanup();
  }
});

test("policy, source, and operation replay identity must match exactly", () => {
  const fixture = createFixture();
  try {
    const claim = acquireClaim(fixture);
    assertStateError(
      () =>
        classifyHistoricalSuccessorCaptureState({
          stateDirectory: fixture.stateDirectory,
          expected: {
            ...fixture.expected,
            source: { ...fixture.expected.source, sha256: "0".repeat(64) },
          },
        }),
      "STATE_CHAIN_BROKEN",
    );
    authorizeHistoricalSuccessorCaptureScan({
      stateDirectory: fixture.stateDirectory,
      claim,
      snapshotPlanSha256: hashes.plan,
      maximumRowsRead: 750_000,
      now: authorizedAt,
    });
    assertStateError(
      () =>
        classifyHistoricalSuccessorCaptureState({
          stateDirectory: fixture.stateDirectory,
          expected: {
            ...fixture.expected,
            snapshotPlanSha256: "9".repeat(64),
          },
        }),
      "STATE_CHAIN_BROKEN",
    );
    assertStateError(
      () =>
        classifyHistoricalSuccessorCaptureState({
          stateDirectory: fixture.stateDirectory,
          expected: {
            ...fixture.expected,
            maximumRowsRead: 749_999,
          },
        }),
      "STATE_CHAIN_BROKEN",
    );
  } finally {
    fixture.cleanup();
  }
});

type Fixture = ReturnType<typeof createFixture>;

function createFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-successor-capture-state-"),
  );
  const stateDirectory = path.join(root, "archive");
  const backupDir = path.join(root, "backup");
  fs.mkdirSync(stateDirectory, { mode: 0o700 });
  fs.mkdirSync(backupDir, { mode: 0o700 });
  const baselinePath = path.join(backupDir, "historical-baseline.json");
  const operationId = `historical-data-preservation-baseline:${"1".repeat(64)}`;
  const expected: HistoricalSuccessorCaptureExpectedIdentity = {
    backupDir,
    policyId: "seo-translation-repair-rollover-2026-07-13",
    policySha256: hashes.policy,
    archiveManifestSha256: hashes.archive,
    predecessorBaselineSha256: hashes.predecessor,
    predecessorHmacKeyId: hashes.key,
    source: { sha256: hashes.source, fileCount: 42 },
    operationId,
    utcDay: captureDay,
    windowEndsAt,
    snapshotPlanSha256: hashes.plan,
    maximumRowsRead: 750_000,
  };
  return {
    root,
    stateDirectory,
    backupDir,
    baselinePath,
    expected,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function acquireClaim(fixture: Fixture) {
  return acquireHistoricalSuccessorCaptureClaim({
    stateDirectory: fixture.stateDirectory,
    ...fixture.expected,
    now: claimAt,
    runId,
    hostname: os.hostname(),
    pid: process.pid,
  });
}

function successorReport(fixture: Fixture) {
  return {
    kind: "inspir-historical-data-preservation-v2",
    schemaVersion: 2,
    phase: "baseline",
    createdAt: preparedAt.toISOString(),
    utcDay: captureDay,
    operationId: fixture.expected.operationId,
    backupDir: fixture.backupDir,
    ok: true,
    privacy: "hmac-sha256-no-raw-identifiers",
    hmacKeyId: hashes.key,
    sourceFingerprint: fixture.expected.source,
    rowsRead: 690_209,
    rowsWritten: 0,
    datasets: {
      users: {
        rowCount: 10,
        sentinels: [hashes.sentinel],
      },
    },
  };
}

function writePrivateJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

function fileMode(file: string) {
  return fs.statSync(file).mode & 0o777;
}

function assertStateError(
  action: () => unknown,
  code: HistoricalSuccessorCaptureStateError["code"],
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof HistoricalSuccessorCaptureStateError);
    assert.equal(error.code, code);
    return true;
  });
}
