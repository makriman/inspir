import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  LEGACY_R5_SALVAGE_GENERATION_CONFIG,
  parsePublishLongTailSeedSalvageAcceptanceOptions,
} from "../scripts/publish-long-tail-seed-salvage-acceptance";

const exactArguments = Object.freeze([
  "--historical-seed-sql",
  "tmp/cloudflare-reports/cloudflare/historical.sql",
  "--legacy-seed-salvage",
  "tmp/long-tail-translation-pipeline-v8/worklist.json",
  "--output-dir",
  "tmp/long-tail-translation-acceptance-v10-fresh",
  "--confirm-candidate-input-only",
]);

test("legacy seed salvage acceptance publisher requires the exact local authority boundary", () => {
  assert.deepEqual(
    parsePublishLongTailSeedSalvageAcceptanceOptions(exactArguments),
    {
      historicalSeedSqlPath:
        "tmp/cloudflare-reports/cloudflare/historical.sql",
      legacySeedSalvagePath:
        "tmp/long-tail-translation-pipeline-v8/worklist.json",
      outputDirectoryPath:
        "tmp/long-tail-translation-acceptance-v10-fresh",
      confirmedCandidateInputOnly: true,
    },
  );
  assert.deepEqual(
    parsePublishLongTailSeedSalvageAcceptanceOptions(["--", ...exactArguments]),
    parsePublishLongTailSeedSalvageAcceptanceOptions(exactArguments),
  );

  assert.throws(
    () => parsePublishLongTailSeedSalvageAcceptanceOptions(
      exactArguments.filter(
        (argument) => argument !== "--confirm-candidate-input-only",
      ),
    ),
    /--confirm-candidate-input-only is required/,
  );
  assert.throws(
    () => parsePublishLongTailSeedSalvageAcceptanceOptions([
      ...exactArguments,
      "--confirm-candidate-input-only",
    ]),
    /must appear exactly once without a value/,
  );
  assert.throws(
    () => parsePublishLongTailSeedSalvageAcceptanceOptions([
      ...exactArguments.slice(0, -1),
      "--confirm-candidate-input-only=true",
    ]),
    /must appear exactly once without a value/,
  );
  assert.throws(
    () => parsePublishLongTailSeedSalvageAcceptanceOptions([
      ...exactArguments,
      "--execute",
    ]),
    /Unknown legacy seed salvage publisher option: --execute/,
  );
  assert.throws(
    () => parsePublishLongTailSeedSalvageAcceptanceOptions([
      ...exactArguments.slice(0, 2),
      "--",
      ...exactArguments.slice(2),
    ]),
    /Unknown legacy seed salvage publisher option: --/,
  );
  assert.throws(
    () => parsePublishLongTailSeedSalvageAcceptanceOptions([
      ...exactArguments.slice(0, 2),
      "--historical-seed-sql",
      "tmp/duplicate.sql",
      ...exactArguments.slice(2),
    ]),
    /--historical-seed-sql may only appear once/,
  );
  assert.throws(
    () => parsePublishLongTailSeedSalvageAcceptanceOptions([
      "--historical-seed-sql",
      "--legacy-seed-salvage",
      "tmp/worklist.json",
      "--output-dir",
      "tmp/output",
      "--confirm-candidate-input-only",
    ]),
    /--historical-seed-sql requires one non-empty local path/,
  );
});

test("legacy seed salvage acceptance publisher pins current planning provenance and a non-authoritative workflow", () => {
  assert.deepEqual(LEGACY_R5_SALVAGE_GENERATION_CONFIG, {
    batchSize: 16,
    numBeams: 1,
    noRepeatNgramSize: 4,
    dtype: "float16",
    device: "mps",
    maxSourceTokens: 512,
    maxNewTokens: 512,
    maxRetryAttempts: 3,
    deterministicAlgorithms: true,
    manualSeed: 0,
  });

  const source = fs.readFileSync(
    path.resolve("scripts/publish-long-tail-seed-salvage-acceptance.ts"),
    "utf8",
  );
  const orderedSteps = [
    "createProductionLongTailInventory(repoRoot)",
    "loadProductionLongTailHistoricalTranslationSqlSeedConsensus({",
    "createLongTailSeedMemory(",
    "createLongTailPipelineProvenance({",
    "buildLongTailMasterWorklist({",
    "salvageLegacyLongTailSeedMemory({",
    "createLegacyLongTailSeedSalvageAcceptance({",
    "publishLegacyLongTailSeedSalvageAcceptance({",
    "readStablePrivateArtifact(\n    published.evidencePath",
    "readStablePrivateArtifact(\n    published.acceptancePath",
    "verifyAcceptedLegacyLongTailSeedSalvage({",
  ];
  let priorIndex = -1;
  for (const step of orderedSteps) {
    const currentIndex = source.indexOf(step);
    assert.ok(currentIndex > priorIndex, `${step} must remain in fail-closed order`);
    priorIndex = currentIndex;
  }
  assert.match(
    source,
    /const ACCEPTANCE_LIFETIME_MS = 7 \* 24 \* 60 \* 60 \* 1_000;/,
  );
  assert.match(
    source,
    /acceptanceStatement: LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_STATEMENT/,
  );
  assert.match(source, /grantsReleaseEvidence: false/);
  assert.match(source, /canPromote: false/);
  assert.match(source, /canDeploy: false/);
  assert.match(source, /canWriteProduction: false/);
  assert.doesNotMatch(source, /from "node:child_process"/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /promoteLongTailCandidateBatch/);
  assert.doesNotMatch(source, /runLongTailWorkerRuntimePreflight/);
});

test("package exposes the supported legacy seed salvage acceptance publisher", () => {
  const packageValue: unknown = JSON.parse(
    fs.readFileSync(path.resolve("package.json"), "utf8"),
  );
  assert.ok(isUnknownRecord(packageValue));
  const scripts = packageValue["scripts"];
  assert.ok(isUnknownRecord(scripts));
  assert.equal(
    scripts["translations:publish-legacy-seed-salvage-acceptance"],
    "tsx scripts/publish-long-tail-seed-salvage-acceptance.ts",
  );
});

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
