import { spawnSync } from "node:child_process";
import {
  FULL_TRANSLATION_COMPLETION_TEST_ENV,
  FULL_TRANSLATION_COMPLETION_TEST_FILE,
} from "./release-unit-test-contract";

if (process.argv.length !== 2) {
  throw new Error("The full translation completion test runner does not accept narrowing arguments.");
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", FULL_TRANSLATION_COMPLETION_TEST_FILE],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [FULL_TRANSLATION_COMPLETION_TEST_ENV]: "1",
    },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
