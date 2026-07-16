import fs from "node:fs";
import path from "node:path";

export const FULL_TRANSLATION_COMPLETION_TEST_FILE =
  "tests/seo-cta-translation-repair.test.ts" as const;
export const FULL_TRANSLATION_COMPLETION_TEST_ENV =
  "INSPIR_FULL_TRANSLATION_COMPLETION_TESTS" as const;

export const FULL_TRANSLATION_COMPLETION_TEST_TITLES = [
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

export type FullTranslationCompletionTestTitle =
  (typeof FULL_TRANSLATION_COMPLETION_TEST_TITLES)[number];

export function listReleaseUnitTestFiles(workspaceRoot = process.cwd()): string[] {
  const testsDirectory = path.resolve(workspaceRoot, "tests");
  const topLevelUnitTests = fs
    .readdirSync(testsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => path.posix.join("tests", entry.name))
    .sort();

  if (!topLevelUnitTests.includes(FULL_TRANSLATION_COMPLETION_TEST_FILE)) {
    throw new Error(
      `The translation repair safety tests are missing or are not a regular top-level test file: ${FULL_TRANSLATION_COMPLETION_TEST_FILE}`,
    );
  }

  return topLevelUnitTests;
}

export function fullTranslationCompletionTestsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[FULL_TRANSLATION_COMPLETION_TEST_ENV];
  if (value === undefined) return false;
  if (value === "1") return true;
  throw new Error(`${FULL_TRANSLATION_COMPLETION_TEST_ENV} must be absent or exactly 1.`);
}

export function releaseUnitTestEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const releaseEnv = { ...env };
  delete releaseEnv[FULL_TRANSLATION_COMPLETION_TEST_ENV];
  return releaseEnv;
}
