import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { TRANSLATION_SEMANTIC_AUDIT_POLICY } from
  "../scripts/verify-translation-semantic-audit";

test("Afrikaans pack-context calibration policy is exact", () => {
  assert.deepEqual(
    TRANSLATION_SEMANTIC_AUDIT_POLICY.language.afrikaansPackContext,
    {
      locale: "af",
      targetLabel: "af",
      relatedLabel: "nl",
      normalization:
        "NFKC-casefold-whitespace-collapse-distinct-lexical-space-join-v1",
      minimumDistinctMaskedValues: 20,
      minimumMaskedLetters: 1_000,
      minimumPackTargetProbability: 0.55,
      minimumPackPairProbability: 0.75,
      minimumFieldPairProbability: 0.7,
      trackedCuratedRescue: {
        candidateOriginOnly: true,
        referenceLocale: "af",
        referencePackGateRequired: true,
        conflictPolicy:
          "exclude-source-hash-with-distinct-exact-values-v1",
        supportPairIdentity:
          "locale-source-bytes-source-sha256-value-bytes-value-sha256-v1",
        requiredFailures: ["language-target-low-confidence"],
      },
    },
  );
  assert.equal(
    TRANSLATION_SEMANTIC_AUDIT_POLICY.language.maximumEnglishProbability,
    0.3,
  );
});

test("offline translation semantic audit is fail-closed and provenance-bound", () => {
  const result = spawnSync(
    path.resolve("tmp/nllb-venv/bin/python"),
    [path.resolve("tests/translation-semantic-audit.test.py"), "--verbose"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      shell: false,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const countMatch = /Ran (\d+) tests/.exec(result.stderr);
  assert.ok(countMatch, result.stderr);
  assert.ok(Number(countMatch[1]) >= 51, result.stderr);
  assert.match(result.stderr, /OK/);
});
