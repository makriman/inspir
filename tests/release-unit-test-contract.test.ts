import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FULL_TRANSLATION_COMPLETION_TEST_ENV,
  FULL_TRANSLATION_COMPLETION_TEST_FILE,
  FULL_TRANSLATION_COMPLETION_TEST_TITLES,
  fullTranslationCompletionTestsEnabled,
  listReleaseUnitTestFiles,
  releaseUnitTestEnvironment,
} from "../scripts/release-unit-test-contract";

const expectedFullCompletionTitles = [
  "SEO CTA repair verifies final source hashes and SQL without touching D1",
  "SEO repair requires the exact 8,625-pack promoted inventory without synthesizing gaps",
  "final pre-import payload revalidation binds the exact curated and main-app corpora",
  "large curated route payloads rebuild through sorted sub-90KB JSON patches",
  "curated repair SQL rejects duplicate, stale, and incomplete UPSERT rows",
  "curated post-write verification is byte- and hash-exact for all 8,556 site packs",
  "curated verification namespace SQL is generated and statement-size bounded",
  "curated exact verification is deterministically chunked and digested incrementally",
  "main-app exact verification is bounded and reads every deterministic chunk",
  "verify-only production drift detection is exact, structured, and mutation-free",
  "verify-only repair exits before ledger admission and never alters ledger evidence",
  "verify-only production drift detection fails closed on malformed or indeterminate reads",
  "curated UPSERT discovery allows missing exact rows but rejects extras and duplicates",
  "prewrite-abort recovery retains exact D1 verification and lock charges",
  "prewrite-abort recovery is bound to the exact preflight reservation window and UTC day",
  "prewrite-abort recovery rejects an exact reservation without prepared evidence",
  "prewrite-abort recovery fails closed when the candidate or drift proof changed",
  "prewrite-abort recovery survives a lost lock release without replaying D1 drift",
] as const;

test("full translation completion has an exact 18-title contract", () => {
  assert.equal(FULL_TRANSLATION_COMPLETION_TEST_FILE, "tests/seo-cta-translation-repair.test.ts");
  assert.equal(FULL_TRANSLATION_COMPLETION_TEST_ENV, "INSPIR_FULL_TRANSLATION_COMPLETION_TESTS");
  assert.deepEqual(FULL_TRANSLATION_COMPLETION_TEST_TITLES, expectedFullCompletionTitles);
  assert.equal(FULL_TRANSLATION_COMPLETION_TEST_TITLES.length, 18);
});

test("release discovery includes every top-level test, including translation repair safety", (t) => {
  const allTopLevelUnitTests = fs
    .readdirSync(path.resolve("tests"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => path.posix.join("tests", entry.name))
    .sort();

  assert.deepEqual(listReleaseUnitTestFiles(), allTopLevelUnitTests);
  assert.equal(listReleaseUnitTestFiles().includes(FULL_TRANSLATION_COMPLETION_TEST_FILE), true);

  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-release-tests-"));
  const testsDirectory = path.join(workspaceRoot, "tests");
  fs.mkdirSync(testsDirectory);
  fs.writeFileSync(path.join(testsDirectory, "alpha.test.ts"), "");
  fs.writeFileSync(path.join(workspaceRoot, FULL_TRANSLATION_COMPLETION_TEST_FILE), "");
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

  fs.writeFileSync(path.join(testsDirectory, "future-release-gate.test.ts"), "");
  assert.deepEqual(listReleaseUnitTestFiles(workspaceRoot), [
    "tests/alpha.test.ts",
    "tests/future-release-gate.test.ts",
    FULL_TRANSLATION_COMPLETION_TEST_FILE,
  ]);

  fs.rmSync(path.join(workspaceRoot, FULL_TRANSLATION_COMPLETION_TEST_FILE));
  assert.throws(
    () => listReleaseUnitTestFiles(workspaceRoot),
    /translation repair safety tests are missing or are not a regular top-level test file/,
  );
});

test("completion environment is exact and release execution always clears it", () => {
  assert.equal(fullTranslationCompletionTestsEnabled({ NODE_ENV: "test" }), false);
  assert.equal(
    fullTranslationCompletionTestsEnabled({
      NODE_ENV: "test",
      [FULL_TRANSLATION_COMPLETION_TEST_ENV]: "1",
    }),
    true,
  );
  for (const value of ["", "0", "true", "yes", "2"]) {
    assert.throws(
      () =>
        fullTranslationCompletionTestsEnabled({
          NODE_ENV: "test",
          [FULL_TRANSLATION_COMPLETION_TEST_ENV]: value,
        }),
      /must be absent or exactly 1/,
    );
  }

  const releaseEnv = releaseUnitTestEnvironment({
    NODE_ENV: "test",
    KEEP_ME: "preserved",
    [FULL_TRANSLATION_COMPLETION_TEST_ENV]: "1",
  });
  assert.equal(releaseEnv.KEEP_ME, "preserved");
  assert.equal(releaseEnv[FULL_TRANSLATION_COMPLETION_TEST_ENV], undefined);
});

test("translation repair selectively registers only the exact completion titles", () => {
  const source = fs.readFileSync(path.resolve(FULL_TRANSLATION_COMPLETION_TEST_FILE), "utf8");
  const gatedTitles = Array.from(
    source.matchAll(/fullTranslationCompletionTest\(\s*"([^"]+)"/g),
    (match) => match[1],
  );

  assert.deepEqual(gatedTitles, expectedFullCompletionTitles);
  assert.equal(source.match(/^test\(/gm)?.length, 44);
  assert.equal(source.match(/assertFullTranslationCompletionTestRegistration\(\);/g)?.length, 1);
  assert.doesNotMatch(source, /(?:test|fullTranslationCompletionTest)\.(?:skip|todo|only)\(/);
});

test("package and Cloudflare runners enforce release and full-completion scopes", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const releaseRunner = fs.readFileSync(path.resolve("scripts/run-release-unit-tests.ts"), "utf8");
  const completionRunner = fs.readFileSync(
    path.resolve("scripts/run-full-translation-completion-tests.ts"),
    "utf8",
  );
  const localGateRunner = fs.readFileSync(path.resolve("scripts/cloudflare/run-local-gates.ts"), "utf8");
  const registrationHelper = fs.readFileSync(
    path.resolve("tests/helpers/full-translation-completion-test.ts"),
    "utf8",
  );

  assert.equal(packageJson.scripts?.test, "node --import tsx scripts/run-release-unit-tests.ts");
  assert.equal(
    packageJson.scripts?.["test:translations:full-completion"],
    "node --import tsx scripts/run-full-translation-completion-tests.ts",
  );
  assert.match(releaseRunner, /listReleaseUnitTestFiles\(\)/);
  assert.match(releaseRunner, /releaseUnitTestEnvironment\(process\.env\)/);
  assert.match(completionRunner, /FULL_TRANSLATION_COMPLETION_TEST_FILE/);
  assert.match(completionRunner, /\[FULL_TRANSLATION_COMPLETION_TEST_ENV\]: "1"/);
  assert.match(localGateRunner, /listReleaseUnitTestFiles\(\)/);
  assert.match(localGateRunner, /releaseUnitTestEnvironment\(commandEnv\(\)\)/);
  assert.match(localGateRunner, /\.\.\.releaseUnitTests/);
  assert.match(registrationHelper, /if \(completionTestsEnabled\) test\(title, body\)/);
  assert.doesNotMatch(releaseRunner, /seo-cta-translation-repair\.test\.ts/);
  assert.doesNotMatch(localGateRunner, /seo-cta-translation-repair\.test\.ts/);
  assert.doesNotMatch(registrationHelper, /\.skip\(|\.todo\(|\.only\(/);
});
