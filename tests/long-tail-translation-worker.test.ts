import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("Python worker selectively retries empty NLLB rows and fails closed", () => {
  const result = spawnSync(
    path.resolve("tmp/nllb-venv/bin/python"),
    [path.resolve("tests/long-tail-translation-worker.test.py"), "--verbose"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      shell: false,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 99 tests/);
  assert.match(result.stderr, /OK/);
});
