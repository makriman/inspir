import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createTranslationSemanticAuditInvocation,
  readStableBoundedTranslationSemanticAuditFile,
  TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE_SHA256,
  TRANSLATION_SEMANTIC_AUDIT_FULL_OUTPUT_BASENAME,
} from "../scripts/run-translation-semantic-audit";
import {
  TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
} from "../scripts/verify-translation-semantic-audit";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
} from "../scripts/long-tail-nllb-execution-profile";

function makeFixture() {
  const workspaceRoot = mkdtempSync(
    path.join(process.cwd(), "tmp/semantic-audit-runner-test-"),
  );
  const runRoot = path.join(workspaceRoot, "tmp/run");
  const homeDirectory = path.join(workspaceRoot, "home");
  const venvBin = path.join(workspaceRoot, "tmp/nllb-venv/bin");
  mkdirSync(runRoot, { recursive: true });
  mkdirSync(venvBin, { recursive: true });
  mkdirSync(path.join(workspaceRoot, "scripts"), { recursive: true });
  mkdirSync(
    path.join(
      homeDirectory,
      ".cache/inspirlearning/sentence-transformers/models--sentence-transformers--LaBSE/snapshots/836121a0533e5664b21c7aacc5d22951f2b8b25b",
    ),
    { recursive: true },
  );
  mkdirSync(
    path.join(homeDirectory, ".cache/inspirlearning/madlad400-3b-mt-ct2-int8"),
    { recursive: true },
  );
  mkdirSync(
    path.join(homeDirectory, ".cache/inspirlearning/fasttext"),
    { recursive: true },
  );
  writeFileSync(
    path.join(workspaceRoot, "tmp/nllb-venv/pyvenv.cfg"),
    readFileSync(path.join(process.cwd(), "tmp/nllb-venv/pyvenv.cfg")),
  );
  symlinkSync("python3", path.join(venvBin, "python"));
  symlinkSync(
    "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9",
    path.join(venvBin, "python3"),
  );
  writeFileSync(
    path.join(workspaceRoot, "scripts/audit-translation-semantics.py"),
    "# fixture\n",
  );
  writeFileSync(
    path.join(
      homeDirectory,
      ".cache/inspirlearning/fasttext/lid.176.bin",
    ),
    "fixture",
  );
  return Object.freeze({
    workspaceRoot,
    runRoot,
    homeDirectory,
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
  });
}

test("semantic runner binds exact offline pins and safely accepts the real venv symlink shape", () => {
  const fixture = makeFixture();
  try {
    const invocation = createTranslationSemanticAuditInvocation({
      workspaceRoot: fixture.workspaceRoot,
      runRoot: fixture.runRoot,
      homeDirectory: fixture.homeDirectory,
      scope: "full",
      parentEnvironment: {
        HOME: fixture.homeDirectory,
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
        OPENAI_API_KEY: "must-not-leak",
        CLOUDFLARE_API_TOKEN: "must-not-leak",
        PYTHONPATH: "/tmp/must-not-inject",
        DYLD_LIBRARY_PATH: "/tmp/must-not-inject",
        NODE_OPTIONS: "--require=/tmp/must-not-inject",
        OMP_NUM_THREADS: "99",
        MKL_NUM_THREADS: "88",
        VECLIB_MAXIMUM_THREADS: "77",
        PYTORCH_ENABLE_MPS_FALLBACK: "1",
      },
    });
    assert.equal(
      invocation.command,
      path.join(fixture.workspaceRoot, "tmp/nllb-venv/bin/python"),
    );
    assert.equal(
      invocation.outputPath,
      path.join(fixture.runRoot, TRANSLATION_SEMANTIC_AUDIT_FULL_OUTPUT_BASENAME),
    );
    assert.equal(invocation.env.VIRTUAL_ENV, path.join(fixture.workspaceRoot, "tmp/nllb-venv"));
    assert.equal(invocation.env.HOME, fixture.homeDirectory);
    assert.equal(invocation.env.HF_HUB_OFFLINE, "1");
    assert.equal(invocation.env.TRANSFORMERS_OFFLINE, "1");
    assert.equal(invocation.env.OPENAI_API_KEY, undefined);
    assert.equal(invocation.env.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(invocation.env.PYTHONPATH, undefined);
    assert.equal(invocation.env.DYLD_LIBRARY_PATH, undefined);
    assert.equal(invocation.env.NODE_OPTIONS, undefined);
    assert.equal(invocation.env.OMP_NUM_THREADS, "1");
    assert.equal(invocation.env.MKL_NUM_THREADS, "1");
    assert.equal(invocation.env.VECLIB_MAXIMUM_THREADS, "1");
    assert.equal(invocation.env.PYTORCH_ENABLE_MPS_FALLBACK, "0");
    assert.equal(invocation.env.TOKENIZERS_PARALLELISM, "false");
    const joined = invocation.args.join("\u0000");
    assert.match(joined, new RegExp(TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.fasttextSha256));
    assert.match(joined, new RegExp(TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.labseTreeSha256));
    assert.match(joined, new RegExp(TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.madladTreeSha256));
    assert.match(joined, new RegExp(TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE_SHA256));
    assert.match(joined, new RegExp(LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256));
    assert.equal(
      invocation.args[invocation.args.indexOf(
        "--generator-execution-profile-sha256",
      ) + 1],
      LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
    );
    assert.equal(joined.includes("--adjudication"), false);

    writeFileSync(invocation.outputPath, "{}\n");
    assert.doesNotThrow(
      () => createTranslationSemanticAuditInvocation({
        workspaceRoot: fixture.workspaceRoot,
        runRoot: fixture.runRoot,
        homeDirectory: fixture.homeDirectory,
        scope: "full",
      }),
    );
  } finally {
    fixture.cleanup();
  }
});

test("semantic runner rejects every pre-v10 release root, including the old Afrikaans path", () => {
  const fixture = makeFixture();
  try {
    const obsoleteRunRoot = path.join(
      fixture.workspaceRoot,
      "tmp/long-tail-translation-pipeline-v9-af-smoke",
    );
    mkdirSync(obsoleteRunRoot);
    assert.throws(
      () => createTranslationSemanticAuditInvocation({
        workspaceRoot: fixture.workspaceRoot,
        runRoot: obsoleteRunRoot,
        homeDirectory: fixture.homeDirectory,
        scope: "afrikaans-smoke",
      }),
      /obsolete pre-v10 evidence/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("semantic runner CLI prints help and exits successfully", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/run-translation-semantic-audit.ts",
      "--help",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: pnpm translations:audit-semantic/);
  assert.equal(result.stderr, "");
});

test("semantic runner fails closed when the pinned Python venv marker drifts", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      path.join(fixture.workspaceRoot, "tmp/nllb-venv/pyvenv.cfg"),
      "home = /tampered/python\n",
    );
    assert.throws(
      () => createTranslationSemanticAuditInvocation({
        workspaceRoot: fixture.workspaceRoot,
        runRoot: fixture.runRoot,
        homeDirectory: fixture.homeDirectory,
        scope: "full",
      }),
      /Pinned semantic-audit pyvenv\.cfg drifted/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("semantic runner stable file reads reject bounds, growth, replacement, and FIFO", () => {
  const root = mkdtempSync(path.join(process.cwd(), "tmp/semantic-runner-read-"));
  try {
    const file = path.join(root, "pyvenv.cfg");
    writeFileSync(file, "home = /stable\n");
    assert.equal(
      readStableBoundedTranslationSemanticAuditFile({
        file,
        maximumBytes: 64,
      }).toString("utf8"),
      "home = /stable\n",
    );
    assert.throws(
      () => readStableBoundedTranslationSemanticAuditFile({
        file,
        maximumBytes: 4,
      }),
      /bounded single-link regular file/,
    );
    assert.throws(
      () => readStableBoundedTranslationSemanticAuditFile({
        file,
        maximumBytes: 64,
        raceHook: (point) => {
          if (point === "after-open-before-read") {
            writeFileSync(file, "x", { flag: "a" });
          }
        },
      }),
      /grew while it was read|changed while it was read/,
    );
    writeFileSync(file, "home = /stable\n");
    assert.throws(
      () => readStableBoundedTranslationSemanticAuditFile({
        file,
        maximumBytes: 64,
        raceHook: (point) => {
          if (point === "after-open-before-read") {
            renameSync(file, `${file}.prior`);
            writeFileSync(file, "home = /replacement\n");
          }
        },
      }),
      /changed while it was read/,
    );
    if (process.platform !== "win32") {
      const fifo = path.join(root, "pyvenv.fifo");
      execFileSync("mkfifo", [fifo]);
      assert.throws(
        () => readStableBoundedTranslationSemanticAuditFile({
          file: fifo,
          maximumBytes: 64,
        }),
        /bounded single-link regular file/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
