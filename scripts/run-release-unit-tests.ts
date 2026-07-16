import { spawnSync } from "node:child_process";
import {
  listReleaseUnitTestFiles,
  releaseUnitTestEnvironment,
} from "./release-unit-test-contract";

if (process.argv.length !== 2) {
  throw new Error("The release unit-test runner does not accept arguments that could narrow the test contract.");
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...listReleaseUnitTestFiles()],
  {
    cwd: process.cwd(),
    env: releaseUnitTestEnvironment(process.env),
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
