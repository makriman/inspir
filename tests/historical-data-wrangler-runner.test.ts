import assert from "node:assert/strict";
import test from "node:test";
import {
  captureHistoricalPre0016Snapshot,
} from "../scripts/cloudflare/historical-data-pre-0016-snapshot";
import {
  HISTORICAL_DATA_WRANGLER_FAILURE_MESSAGE,
  createHistoricalDataWranglerRunner,
} from "../scripts/cloudflare/historical-data-wrangler-runner";
import {
  captureHistoricalDataV2SnapshotEvidence,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import type {
  RunCommandOptions,
  WranglerRunner,
} from "../scripts/cloudflare/migration-config";

const secret = "historical-runner-test-secret-with-at-least-32-bytes";
const privateFailure = [
  "stdout=private-user-id",
  "stderr=private-game-payload",
  "sql=select * from users",
  "args=--command-private",
  `secret=${secret}`,
].join(";");

test("historical Wrangler runner strips secrets, disables logs, and preserves safe options", () => {
  let observedArgs: string[] | undefined;
  let observedOptions: RunCommandOptions | undefined;
  const runner: WranglerRunner = (args, options) => {
    observedArgs = args;
    observedOptions = options;
    return "safe-success";
  };
  const wrapped = createHistoricalDataWranglerRunner(runner);
  const originalOptions: RunCommandOptions = {
    input: "safe-input",
    maxBuffer: 1_024,
    timeoutMs: 2_000,
    env: {
      HISTORICAL_DATA_PRESERVATION_HMAC_SECRET: secret,
      WRANGLER_LOG_SANITIZE: "false",
      WRANGLER_WRITE_LOGS: "true",
      SAFE_FIXTURE_ENV: "retained",
    },
  };

  assert.equal(
    wrapped(["d1", "execute", "fixture", "--command", "private SQL"], originalOptions),
    "safe-success",
  );
  assert.deepEqual(observedArgs, [
    "d1",
    "execute",
    "fixture",
    "--command",
    "private SQL",
  ]);
  assert.deepEqual(observedOptions, {
    input: "safe-input",
    maxBuffer: 1_024,
    timeoutMs: 2_000,
    env: {
      HISTORICAL_DATA_PRESERVATION_HMAC_SECRET: undefined,
      WRANGLER_LOG_SANITIZE: "true",
      WRANGLER_WRITE_LOGS: "false",
      SAFE_FIXTURE_ENV: "retained",
    },
  });
  assert.equal(
    originalOptions.env?.HISTORICAL_DATA_PRESERVATION_HMAC_SECRET,
    secret,
  );
  assert.equal(originalOptions.env?.WRANGLER_WRITE_LOGS, "true");
});

test("historical Wrangler runner collapses synchronous failures without cause or raw data", () => {
  for (const thrown of [
    new Error(privateFailure, { cause: new Error("private nested cause") }),
    privateFailure,
    { stdout: privateFailure, stderr: privateFailure },
  ]) {
    const error = captureThrown(() =>
      createHistoricalDataWranglerRunner(() => {
        throw thrown;
      })(["--command", privateFailure], { input: privateFailure })
    );

    assert.equal(error.message, HISTORICAL_DATA_WRANGLER_FAILURE_MESSAGE);
    assert.equal(Object.hasOwn(error, "cause"), false);
    const publicFailure = `${error.name}\n${error.message}\n${error.stack ?? ""}`;
    assert.equal(publicFailure.includes(privateFailure), false);
    assert.equal(publicFailure.includes("private nested cause"), false);
    assert.equal(publicFailure.includes(secret), false);
  }
});

test("both historical snapshot entry points enforce the fixed failure boundary", () => {
  const failingRunner: WranglerRunner = () => {
    throw new Error(privateFailure, { cause: new Error("private cause") });
  };
  const errors = [
    captureThrown(() =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity: { sha256: "a".repeat(64), fileCount: 1 },
        hmacSecret: secret,
        runner: failingRunner,
      })
    ),
    captureThrown(() =>
      captureHistoricalDataV2SnapshotEvidence({
        hmacSecret: secret,
        runner: failingRunner,
      })
    ),
  ];

  for (const error of errors) {
    assert.equal(error.message, HISTORICAL_DATA_WRANGLER_FAILURE_MESSAGE);
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.equal(`${error.message}\n${error.stack ?? ""}`.includes(privateFailure), false);
  }
});

test("malformed Wrangler fallback JSON cannot echo sentinel secrets", () => {
  const sentinelSecret = "sentinel-secret-private-learner-payload";
  const malformedOutput =
    `wrangler banner\n[{"private":"${sentinelSecret}"} BROKEN]\ntrailer`;
  const malformedRunner: WranglerRunner = () => malformedOutput;
  const errors = [
    captureThrown(() =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity: { sha256: "a".repeat(64), fileCount: 1 },
        hmacSecret: secret,
        runner: malformedRunner,
      })
    ),
    captureThrown(() =>
      captureHistoricalDataV2SnapshotEvidence({
        hmacSecret: secret,
        runner: malformedRunner,
      })
    ),
  ];

  assert.equal(
    errors[0]?.message,
    "Pre-0016 historical snapshot could not parse Wrangler JSON.",
  );
  assert.equal(
    errors[1]?.message,
    "Historical preservation could not parse Wrangler JSON.",
  );
  for (const error of errors) {
    assert.equal(Object.hasOwn(error, "cause"), false);
    const publicFailure = `${error.name}\n${error.message}\n${error.stack ?? ""}`;
    assert.equal(publicFailure.includes(sentinelSecret), false);
    assert.equal(publicFailure.includes(malformedOutput), false);
  }
});

function captureThrown(run: () => unknown) {
  let captured: unknown;
  try {
    run();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error);
  return captured;
}
