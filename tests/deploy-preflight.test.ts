import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { supportedLanguages } from "../lib/content/languages";
import {
  getPublishedLegacySiteTranslationPairs,
  legacyTranslationAssetPath,
} from "../lib/i18n/legacy-api-compat";
import {
  FREE_PLAN_WORKER_FIRST_ROUTES,
  buildSteadyStateDeployPreflightReport as buildProductionSteadyStateDeployPreflightReport,
  hasOpenNextRequestRuntimeImport,
  parseDeployPreflightCli,
  type SemanticReleaseAttestationValidation,
} from "../scripts/cloudflare/deploy-preflight";
import {
  TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_CHECK_NAME,
} from "../scripts/translation-semantic-release-attestation";
import {
  SITE_SOURCE_MANIFEST_FRESHNESS_CHECK_NAME,
  type SiteSourceManifestFreshnessValidation,
} from "../scripts/verify-site-source-manifest";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  MEMORY_POST_TURN_DLQ_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  PROFILE_IMAGES_R2_BUCKET_NAME,
  VECTORIZE_INDEX_NAME,
} from "../scripts/cloudflare/migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "../scripts/cloudflare/source-fingerprint";
import {
  expectedLocalizedStaticAssetPaths,
  staticAssetLocalizedPathContract,
} from "../scripts/cloudflare/static-asset-release-contract";
import {
  RUNTIME_MIGRATION_EVIDENCE_KIND,
  RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
  RUNTIME_MIGRATION_FILES,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
} from "../scripts/cloudflare/verify-d1-runtime-migrations";
import {
  RUNTIME_MIGRATION_0017_CHECK_ID,
  RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
  RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH,
} from "../scripts/cloudflare/verify-d1-runtime-migration-0017";
import {
  RUNTIME_MIGRATION_0017_FILE,
} from "../scripts/cloudflare/check-d1-runtime-migration-0017-budget";
import {
  createHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ,
} from "../scripts/cloudflare/historical-data-fresh-0016-prerequisites";
import { HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET } from "../scripts/cloudflare/apply-historical-data-fresh-0016-migration";
import { HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION } from "../scripts/cloudflare/historical-data-pre-0016-snapshot";
import type {
  HistoricalFresh0016ValidatedCutoverArtifactHandle,
} from "../scripts/cloudflare/verify-historical-data-fresh-0016-cutover-chain";
import { HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT } from "../scripts/cloudflare/verify-historical-data-preservation";
import { STATIC_ASSET_RELEASE_FILE_LIMIT } from "../scripts/cloudflare/materialize-static-marketing-assets";
import { buildWorkerDeployArtifactManifest } from "../scripts/cloudflare/worker-deploy-evidence";
import {
  defaultOpenNextResourceBudget,
  inspectOpenNextResourceBudget,
} from "../scripts/cloudflare/check-opennext-resource-budget";
import {
  WORKER_DEPLOY_PREPARATION_CHECK_NAME,
  WORKER_DEPLOY_PREPARATION_MAX_AGE_MS,
  assertWorkerDeployPreparationUploadBinding,
  createWorkerDeployPreparation,
  readAndValidateWorkerDeployPreparation,
  readAndValidateWorkerDeployPreparationProvenance,
  type WorkerDeployPreparationHandle,
} from "../scripts/cloudflare/worker-deploy-preparation";
import {
  createProductionTrustBoundaryAcceptance,
} from "../scripts/cloudflare/production-trust-boundary-acceptance";
import {
  PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES,
  PREVIEW_E2E_CHECK_NAME,
  PREVIEW_E2E_EVIDENCE_KIND,
  PREVIEW_E2E_EVIDENCE_RELATIVE_PATH,
  PREVIEW_E2E_EVIDENCE_SCHEMA_VERSION,
  PREVIEW_E2E_LOCAL_GATE_ID,
  PREVIEW_E2E_REQUIRED_TEST_TITLES,
  analyzePreviewE2EPlaywrightReport,
} from "../scripts/cloudflare/preview-e2e-evidence";
import {
  LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
  promoteLongTailPromotionSnapshot,
} from "../scripts/long-tail-promotion-snapshot";

const HISTORICAL_FRESH_0016_CHECK =
  "fresh-0016 accepted historical trust boundary";
const RUNTIME_MIGRATION_0017_CHECK =
  "D1 runtime migration 0017 deferred Free-plan index";
const STATIC_ASSET_RELEASE_CHECK = "Static Asset release and legacy translation report";
const LONG_TAIL_PROMOTION_SETTLEMENT_CHECK =
  "settled long-tail translation promotion transactions";

test("deploy preflight topology phase CLI is explicit and fail closed", () => {
  assert.deepEqual(parseDeployPreflightCli([]), {
    workerTopologyPhase: "baseline-sole-active",
  });
  assert.deepEqual(
    parseDeployPreflightCli([
      "--worker-topology-phase",
      "candidate-staged",
    ]),
    { workerTopologyPhase: "candidate-staged" },
  );
  assert.deepEqual(
    parseDeployPreflightCli([
      "--worker-topology-phase",
      "candidate-active",
    ]),
    { workerTopologyPhase: "candidate-active" },
  );
  assert.throws(
    () => parseDeployPreflightCli(["--worker-topology-phase", "baseline-sole-active"]),
    /accepts only/,
  );
  assert.throws(
    () => parseDeployPreflightCli(["--worker-topology-phase", "candidate-staged", "extra"]),
    /accepts only/,
  );
});
const SITE_SOURCE_FRESHNESS_FIXTURE: SiteSourceManifestFreshnessValidation =
  Object.freeze({
    namespaceCount: 3,
    fieldCount: 7,
    routedNamespaceCount: 2,
    routedFieldCount: 4,
    manifestRootSha256: "d".repeat(64),
    extractedRootSha256: "d".repeat(64),
    routedManifestRootSha256: "e".repeat(64),
    routedExtractedRootSha256: "e".repeat(64),
    staleNamespaceCount: 0,
    staleFieldCount: 0,
  });
const PREFLIGHT_NOW_MS = Date.parse("2026-06-26T12:00:00Z");
const HISTORICAL_FIXTURE_CREATED_AT = new Date("2026-06-26T11:45:00.000Z");
const historicalFresh0016CutoverFixtures = new Map<
  string,
  HistoricalFresh0016ValidatedCutoverArtifactHandle
>();
const workerDeployPreparationFixtures = new Map<
  string,
  WorkerDeployPreparationHandle
>();
type StaticMarketingAssetFixtureReport = {
  createdAt: string;
  buildId: string;
  assetFiles: number;
  assetManifestBytes: number;
  assetManifestSha256: string;
  legacyTranslationApiAssets: number;
  legacyMainAppTranslationResponses: number;
  legacySiteTranslationResponses: number;
  legacyCompleteTranslationResponses: number;
  legacyIncompleteTranslationResponses: number;
  translationAvailabilitySha256: string;
  expectedLocalizedHtmlDocuments: number;
  expectedLocalizedHtmlPathsSha256: string;
  localizedHtmlDocuments: number;
  localizedHtmlPathsSha256: string;
  outputSha256: string;
  generatedPaths: string[];
};
type StaticAssetReleaseCountDetailKey =
  | "missingLegacyPathCount"
  | "extraLegacyPathCount"
  | "duplicateLegacyPathCount"
  | "incompleteLegacyPathCount";
const expectedLegacyMainAppTranslationPaths = supportedLanguages.map((language) =>
  legacyTranslationAssetPath({ kind: "main-app", language }),
);
const expectedLegacySiteTranslationPaths = getPublishedLegacySiteTranslationPairs().map(
  ({ language, namespace }) =>
    legacyTranslationAssetPath({ kind: "site", language, namespace }),
);
const expectedLegacyTranslationPaths = [
  ...expectedLegacyMainAppTranslationPaths,
  ...expectedLegacySiteTranslationPaths,
].sort();

function buildSteadyStateDeployPreflightReport(
  options: Parameters<typeof buildProductionSteadyStateDeployPreflightReport>[0],
) {
  const fixtureLoader = ({ backupDirectory }: {
    cwd: string;
    backupDirectory: string;
  }) => {
    const completion = historicalFresh0016CutoverFixtures.get(
      path.resolve(backupDirectory),
    );
    if (!completion) {
      throw new Error("Missing canonical fresh-0016 completion fixture.");
    }
    return structuredClone(completion);
  };
  const preparationLoader = ({ backupDirectory }: {
    cwd: string;
    backupDirectory: string;
    now: Date;
  }) => {
    const preparation = workerDeployPreparationFixtures.get(
      path.resolve(backupDirectory),
    );
    if (!preparation) {
      throw new Error("Missing sealed Worker deploy preparation fixture.");
    }
    return structuredClone(preparation);
  };
  const semanticReleaseAttestationValidator = ({ workspaceRoot }: {
    workspaceRoot: string;
  }): SemanticReleaseAttestationValidation => Object.freeze({
    path: path.join(workspaceRoot, "translations/semantic-release-attestation.json"),
    sha256: "a".repeat(64),
    curatedTreeSha256: "b".repeat(64),
    semanticEvidenceSha256: "c".repeat(64),
  });
  return buildProductionSteadyStateDeployPreflightReport({
    ...options,
    historicalFresh0016CutoverLoader:
      options.historicalFresh0016CutoverLoader ?? fixtureLoader,
    workerDeployPreparationLoader:
      options.workerDeployPreparationLoader ?? preparationLoader,
    semanticReleaseAttestationValidator:
      options.semanticReleaseAttestationValidator ??
      semanticReleaseAttestationValidator,
    siteSourceManifestFreshnessValidator:
      options.siteSourceManifestFreshnessValidator ??
      (() => SITE_SOURCE_FRESHNESS_FIXTURE),
  });
}

test("steady-state deploy preflight accepts fresh Cloudflare evidence", () => {
  const { backupDir, repoDir } = makeFixture();

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.mode, "steady-state");
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.checks.map((check) => [check.name, check.status]),
    [
      ["clean pushed Git release identity", "pass"],
      [LONG_TAIL_PROMOTION_SETTLEMENT_CHECK, "pass"],
      [SITE_SOURCE_MANIFEST_FRESHNESS_CHECK_NAME, "pass"],
      [TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_CHECK_NAME, "pass"],
      [WORKER_DEPLOY_PREPARATION_CHECK_NAME, "pass"],
      ["local build and test gates", "pass"],
      [PREVIEW_E2E_CHECK_NAME, "pass"],
      ["source secret scan", "pass"],
      ["OpenNext build artifact secret scan", "pass"],
      [STATIC_ASSET_RELEASE_CHECK, "pass"],
      ["D1 runtime migrations 0013-0016", "pass"],
      [HISTORICAL_FRESH_0016_CHECK, "pass"],
      [RUNTIME_MIGRATION_0017_CHECK, "pass"],
      ["Wrangler production config", "pass"],
      ["Free static and native account architecture", "pass"],
    ],
  );
});

test("deploy preflight fails closed when any site source namespace is stale", () => {
  const { backupDir, repoDir } = makeFixture();
  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
    siteSourceManifestFreshnessValidator: () => {
      throw new Error("Generated site source manifest is stale for route:non-sample.");
    },
  });
  const freshness = report.checks.find(
    (check) => check.name === SITE_SOURCE_MANIFEST_FRESHNESS_CHECK_NAME,
  );
  assert.equal(report.ok, false);
  assert.equal(freshness?.status, "fail");
  assert.match(JSON.stringify(freshness?.detail), /route:non-sample/);
});

test("deploy preflight has no legacy fallback when canonical fresh-0016 completion is absent", () => {
  const { backupDir, repoDir } = makeFixture();
  historicalFresh0016CutoverFixtures.delete(path.resolve(backupDir));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });
  const boundary = report.checks.find(
    (check) => check.name === HISTORICAL_FRESH_0016_CHECK,
  );
  assert.equal(boundary?.status, "fail");
  assert.match(
    String((boundary?.detail as { reason?: string } | undefined)?.reason),
    /Missing canonical fresh-0016 completion fixture/,
  );
});

test("deploy preflight has no build fallback when the pre-cutover seal is absent", () => {
  const { backupDir, repoDir } = makeFixture();
  workerDeployPreparationFixtures.delete(path.resolve(backupDir));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });
  const preparation = report.checks.find(
    (check) => check.name === WORKER_DEPLOY_PREPARATION_CHECK_NAME,
  );
  assert.equal(report.ok, false);
  assert.equal(preparation?.status, "fail");
  assert.match(
    JSON.stringify(preparation?.detail),
    /Missing sealed Worker deploy preparation fixture/,
  );
});

test("deploy preflight fails closed when the semantic release attestation is missing or stale", () => {
  const { backupDir, repoDir } = makeFixture();
  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
    semanticReleaseAttestationValidator: () => {
      throw new Error("Tracked semantic release attestation is stale.");
    },
  });
  const semanticGate = report.checks.find(
    (check) =>
      check.name === TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_CHECK_NAME,
  );
  assert.equal(report.ok, false);
  assert.equal(semanticGate?.status, "fail");
  assert.match(JSON.stringify(semanticGate?.detail), /attestation is stale/);
});

test("pre-cutover preparation is owner-only, append-only, and idempotent for exact bytes", () => {
  const { backupDir, repoDir } = makeFixture();
  const first = workerDeployPreparationFixtures.get(path.resolve(backupDir));
  assert.ok(first);
  const before = fs.lstatSync(first.path);

  const second = sealWorkerDeployPreparationFixture(backupDir, repoDir);
  const after = fs.lstatSync(second.path);

  assert.equal(second.path, first.path);
  assert.equal(second.sha256, first.sha256);
  assert.equal(second.bytes, first.bytes);
  assert.deepEqual(second.artifact, first.artifact);
  assert.equal(before.ino, after.ino);
  assert.equal(before.nlink, 1);
  assert.equal(after.nlink, 1);
  assert.equal(after.mode & 0o777, 0o600);
  assert.equal(fs.lstatSync(path.dirname(second.path)).mode & 0o777, 0o700);
});

test("candidate upload binds the exact preparation hash inside the inclusive 12-hour interval", () => {
  const { backupDir, repoDir } = makeFixture();
  const preparation = workerDeployPreparationFixtures.get(
    path.resolve(backupDir),
  );
  assert.ok(preparation);

  for (const createdAt of [
    preparation.artifact.createdAt,
    preparation.artifact.validUntil,
  ]) {
    assert.equal(
      assertWorkerDeployPreparationUploadBinding(preparation, {
        createdAt,
        workerDeployPreparationSha256: preparation.sha256,
      }),
      preparation,
    );
  }

  const preparedAtMs = Date.parse(preparation.artifact.createdAt);
  const validUntilMs = Date.parse(preparation.artifact.validUntil);
  assert.equal(
    validUntilMs - preparedAtMs,
    WORKER_DEPLOY_PREPARATION_MAX_AGE_MS,
  );
  const dependencies = {
    inspectResources: (cwd: string) =>
      inspectOpenNextResourceBudget(cwd, defaultOpenNextResourceBudget, {
        expectedLocalizedAssetPaths: null,
      }),
  } as const;
  assert.equal(
    readAndValidateWorkerDeployPreparation({
      cwd: repoDir,
      backupDirectory: backupDir,
      now: new Date(validUntilMs),
      dependencies,
    }).sha256,
    preparation.sha256,
  );
  assert.throws(
    () =>
      readAndValidateWorkerDeployPreparation({
        cwd: repoDir,
        backupDirectory: backupDir,
        now: new Date(validUntilMs + 1),
        dependencies,
      }),
    /preparation is stale/,
  );
  for (const createdAt of [
    new Date(preparedAtMs - 1).toISOString(),
    new Date(validUntilMs + 1).toISOString(),
  ]) {
    assert.throws(
      () =>
        assertWorkerDeployPreparationUploadBinding(preparation, {
          createdAt,
          workerDeployPreparationSha256: preparation.sha256,
        }),
      /exact deploy preparation eligibility interval/,
    );
  }
  assert.throws(
    () =>
      assertWorkerDeployPreparationUploadBinding(preparation, {
        createdAt: preparation.artifact.createdAt,
        workerDeployPreparationSha256: "f".repeat(64),
      }),
    /exact deploy preparation SHA-256/,
  );
});

test("immutable upload provenance permits later stages while retaining exact current release checks", () => {
  const { backupDir, repoDir } = makeFixture();
  const preparation = workerDeployPreparationFixtures.get(
    path.resolve(backupDir),
  );
  assert.ok(preparation);
  const uploadEvidence = {
    createdAt: preparation.artifact.validUntil,
    workerDeployPreparationSha256: preparation.sha256,
  } as const;
  const dependencies = {
    inspectResources: (cwd: string) =>
      inspectOpenNextResourceBudget(cwd, defaultOpenNextResourceBudget, {
        expectedLocalizedAssetPaths: null,
      }),
  } as const;

  const later = readAndValidateWorkerDeployPreparationProvenance({
    cwd: repoDir,
    backupDirectory: backupDir,
    now: new Date(
      Date.parse(preparation.artifact.validUntil) + 24 * 60 * 60 * 1_000,
    ),
    uploadEvidence,
    dependencies,
  });
  assert.equal(later.validation, "immutable-upload-provenance");
  assert.equal(later.sha256, preparation.sha256);

  assert.throws(
    () =>
      readAndValidateWorkerDeployPreparationProvenance({
        cwd: repoDir,
        backupDirectory: backupDir,
        now: new Date(Date.parse(uploadEvidence.createdAt) - 1),
        uploadEvidence,
        dependencies,
      }),
    /upload provenance is future-dated/,
  );

  fs.writeFileSync(path.join(repoDir, "app.ts"), "export const ok = false;\n");
  assert.throws(
    () =>
      readAndValidateWorkerDeployPreparationProvenance({
        cwd: repoDir,
        backupDirectory: backupDir,
        now: new Date(Date.parse(uploadEvidence.createdAt) + 1),
        uploadEvidence,
        dependencies,
      }),
    /ENOENT|clean Git working tree|Git release identity no longer matches|exact current source/,
  );
});

test("immutable upload provenance rejects different preparation bytes under the same release binding path", () => {
  const { backupDir, repoDir } = makeFixture();
  const preparation = workerDeployPreparationFixtures.get(
    path.resolve(backupDir),
  );
  assert.ok(preparation);
  const originalBytes = fs.readFileSync(preparation.path);
  const differentBytes = Buffer.from(
    `${JSON.stringify(preparation.artifact)}\n`,
    "utf8",
  );
  assert.notDeepEqual(differentBytes, originalBytes);
  fs.writeFileSync(preparation.path, differentBytes, { mode: 0o600 });
  fs.chmodSync(preparation.path, 0o600);

  assert.throws(
    () =>
      readAndValidateWorkerDeployPreparationProvenance({
        cwd: repoDir,
        backupDirectory: backupDir,
        now: new Date(Date.parse(preparation.artifact.validUntil) + 1),
        uploadEvidence: {
          createdAt: preparation.artifact.validUntil,
          workerDeployPreparationSha256: preparation.sha256,
        },
        dependencies: {
          inspectResources: (cwd) =>
            inspectOpenNextResourceBudget(cwd, defaultOpenNextResourceBudget, {
              expectedLocalizedAssetPaths: null,
            }),
        },
      }),
    /exact deploy preparation SHA-256/,
  );
});

test("a valid seal extends only immutable local proof, never the one-hour remote cutover proof", () => {
  const { backupDir, repoDir } = makeFixture();
  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T18:00:00.000Z"),
  });
  const statuses = new Map(
    report.checks.map((check) => [check.name, check.status]),
  );

  assert.equal(statuses.get(WORKER_DEPLOY_PREPARATION_CHECK_NAME), "pass");
  assert.equal(statuses.get("local build and test gates"), "pass");
  assert.equal(statuses.get("source secret scan"), "pass");
  assert.equal(statuses.get("OpenNext build artifact secret scan"), "pass");
  assert.equal(statuses.get(STATIC_ASSET_RELEASE_CHECK), "pass");
  assert.equal(statuses.get("D1 runtime migrations 0013-0016"), "fail");
  assert.equal(statuses.get(HISTORICAL_FRESH_0016_CHECK), "fail");
  assert.equal(report.ok, false);
});

test("deploy preflight rejects malformed, stale, future, and wrong-source fresh-0016 completion", async (t) => {
  const scenarios: ReadonlyArray<{
    name: string;
    mutate: (
      completion: HistoricalFresh0016ValidatedCutoverArtifactHandle,
    ) => HistoricalFresh0016ValidatedCutoverArtifactHandle;
  }> = [
    {
      name: "stale completion",
      mutate: (completion) => ({
        ...completion,
        artifact: {
          ...completion.artifact,
          createdAt: "2026-06-26T10:00:00.000Z",
        },
      }),
    },
    {
      name: "future completion",
      mutate: (completion) => ({
        ...completion,
        artifact: {
          ...completion.artifact,
          createdAt: "2026-06-26T12:00:00.001Z",
        },
      }),
    },
    {
      name: "wrong source completion",
      mutate: (completion) => ({
        ...completion,
        artifact: {
          ...completion.artifact,
          sourceFingerprint: {
            ...completion.artifact.sourceFingerprint,
            sha256: "f".repeat(64),
          },
        },
      }),
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const { backupDir, repoDir } = makeFixture();
      const original = historicalFresh0016CutoverFixtures.get(
        path.resolve(backupDir),
      );
      assert.ok(original);
      historicalFresh0016CutoverFixtures.set(
        path.resolve(backupDir),
        scenario.mutate(original),
      );
      const report = buildSteadyStateDeployPreflightReport({
        backupDir,
        cwd: repoDir,
        runWranglerDryRun: false,
        nowMs: PREFLIGHT_NOW_MS,
      });
      const boundary = report.checks.find(
        (check) => check.name === HISTORICAL_FRESH_0016_CHECK,
      );
      assert.equal(boundary?.status, "fail");
      assert.match(
        String((boundary?.detail as { reason?: string } | undefined)?.reason),
        /stale, from the future, or not bound/,
      );
    });
  }
});

test("deploy preflight rejects a fresh-0016 loader that cannot fully validate canonical evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
    historicalFresh0016CutoverLoader: () => {
      throw new Error("Canonical fresh-0016 artifact is malformed.");
    },
  });
  const boundary = report.checks.find(
    (check) => check.name === HISTORICAL_FRESH_0016_CHECK,
  );
  assert.equal(boundary?.status, "fail");
  assert.match(
    String((boundary?.detail as { reason?: string } | undefined)?.reason),
    /malformed/,
  );
});

test("steady-state deploy preflight rejects an unresolved translation promotion", () => {
  const { backupDir, repoDir } = makeFixture();
  const curatedParent = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "inspir-preflight-curated-"),
  );
  const curatedRoot = path.join(curatedParent, "curated");
  fs.mkdirSync(curatedRoot);
  const transactionRoot = path.join(
    repoDir,
    LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
  );
  assert.throws(
    () => promoteLongTailPromotionSnapshot({
      curatedRoot,
      transactionRoot,
      masterWorklistSha256: "a".repeat(64),
      artifacts: [{
        targetRelativePath: "es/test.json",
        targetBytes: Buffer.from('{"translated":true}\n', "utf8"),
        checkpointRelativePath: "test.json",
        checkpointBytes: Buffer.from('{"checkpoint":true}\n', "utf8"),
      }],
      crashHook: (point) => {
        if (point === "after-prepared-parent-fsync") {
          throw new Error("simulated interruption");
        }
      },
    }),
    /simulated interruption/,
  );

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });
  const settlement = report.checks.find(
    (check) => check.name === LONG_TAIL_PROMOTION_SETTLEMENT_CHECK,
  );
  assert.equal(settlement?.status, "fail");
  assert.match(
    String((settlement?.detail as { reason?: string } | undefined)?.reason),
    /PREPARED without COMMITTED/,
  );
});

test("legacy translation release paths derive the exact 70 + 210 = 280 contract", () => {
  assert.equal(supportedLanguages.length, 70);
  assert.equal(expectedLegacyMainAppTranslationPaths.length, 70);
  assert.equal(expectedLegacySiteTranslationPaths.length, 210);
  assert.equal(expectedLegacyTranslationPaths.length, 280);
  assert.equal(new Set(expectedLegacyTranslationPaths).size, 280);
});

test("steady-state deploy preflight rejects every incorrect legacy translation report count", () => {
  const { backupDir, repoDir } = makeFixture();
  const pristine = readStaticMarketingAssetFixtureReport(repoDir);
  const scenarios = [
    {
      name: "total",
      mutate(report: StaticMarketingAssetFixtureReport) {
        report.legacyTranslationApiAssets = 279;
      },
    },
    {
      name: "main-app",
      mutate(report: StaticMarketingAssetFixtureReport) {
        report.legacyMainAppTranslationResponses = 69;
      },
    },
    {
      name: "site",
      mutate(report: StaticMarketingAssetFixtureReport) {
        report.legacySiteTranslationResponses = 209;
      },
    },
    {
      name: "complete",
      mutate(report: StaticMarketingAssetFixtureReport) {
        report.legacyCompleteTranslationResponses = 279;
      },
    },
    {
      name: "incomplete",
      mutate(report: StaticMarketingAssetFixtureReport) {
        report.legacyIncompleteTranslationResponses = 1;
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    mutate: (report: StaticMarketingAssetFixtureReport) => void;
  }>;

  for (const scenario of scenarios) {
    const candidate = structuredClone(pristine);
    scenario.mutate(candidate);
    writeStaticMarketingAssetFixtureReport(repoDir, candidate);

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: PREFLIGHT_NOW_MS,
    });

    assert.equal(report.ok, false, scenario.name);
    const check = report.checks.find((entry) => entry.name === STATIC_ASSET_RELEASE_CHECK);
    assert.equal(check?.status, "fail", scenario.name);
    assert.equal(staticAssetReleaseDetail(check).reportCountsOk, false, scenario.name);
  }
});

test("steady-state deploy preflight rejects missing, extra, duplicate, and incomplete legacy paths", () => {
  const { backupDir, repoDir } = makeFixture();
  const pristine = readStaticMarketingAssetFixtureReport(repoDir);
  const firstPath = expectedLegacyTranslationPaths[0];
  assert.ok(firstPath);
  const scenarios = [
    {
      name: "missing",
      expectedDetail: "missingLegacyPathCount",
      mutate(report: StaticMarketingAssetFixtureReport) {
        report.generatedPaths = report.generatedPaths.filter((entry) => entry !== firstPath);
      },
    },
    {
      name: "extra",
      expectedDetail: "extraLegacyPathCount",
      mutate(report: StaticMarketingAssetFixtureReport) {
        report.generatedPaths.push(
          "i18n/legacy-api/site/hi/route~about.complete.json",
        );
      },
    },
    {
      name: "duplicate",
      expectedDetail: "duplicateLegacyPathCount",
      mutate(report: StaticMarketingAssetFixtureReport) {
        report.generatedPaths.push(firstPath);
      },
    },
    {
      name: "incomplete",
      expectedDetail: "incompleteLegacyPathCount",
      mutate(report: StaticMarketingAssetFixtureReport) {
        report.generatedPaths = report.generatedPaths.map((entry) =>
          entry === firstPath ? entry.replace(".complete.json", ".incomplete.json") : entry,
        );
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    expectedDetail: StaticAssetReleaseCountDetailKey;
    mutate: (report: StaticMarketingAssetFixtureReport) => void;
  }>;

  for (const scenario of scenarios) {
    const candidate = structuredClone(pristine);
    scenario.mutate(candidate);
    writeStaticMarketingAssetFixtureReport(repoDir, candidate);

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: PREFLIGHT_NOW_MS,
    });

    assert.equal(report.ok, false, scenario.name);
    const check = report.checks.find((entry) => entry.name === STATIC_ASSET_RELEASE_CHECK);
    assert.equal(check?.status, "fail", scenario.name);
    assert.ok(Number(staticAssetReleaseDetail(check)[scenario.expectedDetail]) > 0, scenario.name);
  }
});

test("steady-state deploy preflight rejects a report above the internal 5,000-file ceiling", () => {
  const { backupDir, repoDir } = makeFixture();
  const reportFixture = readStaticMarketingAssetFixtureReport(repoDir);
  reportFixture.assetFiles = STATIC_ASSET_RELEASE_FILE_LIMIT + 1;
  writeStaticMarketingAssetFixtureReport(repoDir, reportFixture);

  const overLimitReport = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });
  assert.equal(overLimitReport.ok, false);
  const check = overLimitReport.checks.find(
    (entry) => entry.name === STATIC_ASSET_RELEASE_CHECK,
  );
  assert.equal(check?.status, "fail");
  assert.equal(staticAssetReleaseDetail(check).assetFileCountOk, false);
});

test("steady-state deploy preflight fails closed without a materialization report", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.rmSync(staticMarketingAssetFixtureReportPath(repoDir));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });

  assert.equal(report.ok, false);
  const check = report.checks.find((entry) => entry.name === STATIC_ASSET_RELEASE_CHECK);
  assert.equal(check?.status, "fail");
  assert.match(JSON.stringify(check?.detail), /static-marketing-assets-report\.json/);
});

test("steady-state deploy preflight rejects a report without its Static Asset tree", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.rmSync(staticMarketingAssetFixtureRoot(repoDir), { recursive: true, force: true });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });

  assert.equal(report.ok, false);
  const check = report.checks.find((entry) => entry.name === STATIC_ASSET_RELEASE_CHECK);
  assert.equal(check?.status, "fail");
  assert.match(staticAssetReleaseError(check), /release tree is missing or unreadable/);
});

test("steady-state deploy preflight rejects an underreported real asset count", () => {
  const { backupDir, repoDir } = makeFixture();
  const reportFixture = readStaticMarketingAssetFixtureReport(repoDir);
  const actualAssetFiles = reportFixture.assetFiles;
  reportFixture.assetFiles -= 1;
  writeStaticMarketingAssetFixtureReport(repoDir, reportFixture);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });

  assert.equal(report.ok, false);
  const check = report.checks.find((entry) => entry.name === STATIC_ASSET_RELEASE_CHECK);
  assert.equal(check?.status, "fail");
  assert.match(
    staticAssetReleaseError(check),
    new RegExp(
      `declares ${actualAssetFiles - 1} asset files.*contains ${actualAssetFiles}`,
    ),
  );
});

test("steady-state deploy preflight rejects a materialized legacy path tamper", () => {
  const { backupDir, repoDir } = makeFixture();
  const firstPath = expectedLegacyTranslationPaths[0];
  assert.ok(firstPath);
  const sourcePath = path.join(staticMarketingAssetFixtureRoot(repoDir), firstPath);
  const tamperedPath = path.join(
    staticMarketingAssetFixtureRoot(repoDir),
    "i18n/legacy-api/main-app/unexpected.complete.json",
  );
  fs.renameSync(sourcePath, tamperedPath);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });

  assert.equal(report.ok, false);
  const check = report.checks.find((entry) => entry.name === STATIC_ASSET_RELEASE_CHECK);
  assert.equal(check?.status, "fail");
  assert.match(staticAssetReleaseError(check), /materialized legacy translation paths.*missing=1, extra=1/);
});

test("steady-state deploy preflight rejects Static Asset content tampering", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.writeFileSync(
    path.join(staticMarketingAssetFixtureRoot(repoDir), "_next/static/release-fixture.js"),
    "tampered non-generated chunk\n",
  );

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });

  assert.equal(report.ok, false);
  const check = report.checks.find((entry) => entry.name === STATIC_ASSET_RELEASE_CHECK);
  assert.equal(check?.status, "fail");
  assert.match(staticAssetReleaseError(check), /release tree manifest does not match/);
});

test("steady-state deploy preflight rejects a stale Static Asset report", () => {
  const { backupDir, repoDir } = makeFixture();
  const reportFixture = readStaticMarketingAssetFixtureReport(repoDir);
  reportFixture.createdAt = "2026-06-26T10:59:59.000Z";
  writeStaticMarketingAssetFixtureReport(repoDir, reportFixture);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });

  assert.equal(report.ok, false);
  const check = report.checks.find((entry) => entry.name === STATIC_ASSET_RELEASE_CHECK);
  assert.equal(check?.status, "fail");
  assert.match(staticAssetReleaseError(check), /report is stale or from the future/);
});

test("steady-state deploy preflight rejects dirty and unpushed release identities", () => {
  for (const state of ["dirty", "unpushed"] as const) {
    const { backupDir, repoDir } = makeFixture();
    fs.writeFileSync(path.join(repoDir, `${state}.txt`), `${state}\n`);
    if (state === "unpushed") {
      runGit(repoDir, ["add", "."]);
      runGit(repoDir, ["commit", "-m", "unpushed release"]);
    }
    writeLocalEvidence(backupDir, repoDir, buildRepoSourceFingerprint(repoDir));

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false);
    const identity = report.checks.find(
      (check) => check.name === "clean pushed Git release identity",
    );
    assert.equal(identity?.status, "fail");
    assert.match(
      JSON.stringify(identity?.detail),
      state === "dirty" ? /clean Git working tree/ : /pushed upstream/,
    );
  }
});

test("production Static Assets routes only exact native account surfaces through the Worker", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8")) as {
    main?: string;
    assets?: { not_found_handling?: string; run_worker_first?: string[] };
    vectorize?: unknown[];
    r2_buckets?: unknown[];
    queues?: { producers?: unknown[]; consumers?: unknown[] };
    triggers?: { crons?: string[] };
    services?: Array<{ binding?: string; service?: string }>;
    durable_objects?: { bindings?: Array<{ name?: string; class_name?: string }> };
    migrations?: Array<{ new_sqlite_classes?: string[] }>;
  };
  const routes = [...(config.assets?.run_worker_first ?? [])] as string[];
  assert.equal(config.main, "./cloudflare-worker.ts");
  assert.equal(config.assets?.not_found_handling, "404-page");
  assert.equal(routes.includes("/api/*"), false);
  assert.equal(routes.includes("/*"), false);
  assert.deepEqual(routes.filter((route) => route.startsWith("!")), ["!/_next/static/*"]);
  assert.deepEqual(routes, [...FREE_PLAN_WORKER_FIRST_ROUTES]);
  assert.equal(config.vectorize?.length, 1);
  assert.equal(config.r2_buckets?.length, 1);
  assert.equal(config.queues?.producers?.length, 1);
  assert.equal(config.queues?.consumers?.length, 1);
  assert.deepEqual(config.triggers?.crons, ["0 3 * * *"]);
  assert.ok(
    config.services?.some(
      (binding) => binding.binding === "WORKER_SELF_REFERENCE" && binding.service === "inspirlearning",
    ),
  );
  assert.ok(
    config.durable_objects?.bindings?.some(
      (binding) => binding.name === "NEXT_CACHE_DO_QUEUE" && binding.class_name === "DOQueueHandler",
    ),
  );
  assert.ok(config.migrations?.some((migration) => migration.new_sqlite_classes?.includes("DOQueueHandler")));
});

test("steady-state deploy preflight rejects stale local-gate source evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.writeFileSync(path.join(repoDir, "changed.txt"), "new source\n");

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const localGates = report.checks.find((check) => check.name === "local build and test gates");
  assert.equal(localGates?.status, "fail");
});

test("steady-state deploy preflight rejects missing React Doctor gate evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateLocalGatesReport(backupDir, (report) => {
    report.results = report.results.filter((result) => result.id !== "react-doctor");
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const localGates = report.checks.find((check) => check.name === "local build and test gates");
  assert.equal(localGates?.status, "fail");
  assert.ok(localGateDetail(localGates).missingGateIds?.includes("react-doctor"));
});

test("steady-state deploy preflight rejects failed React Doctor gate evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateLocalGatesReport(backupDir, (report) => {
    report.ok = false;
    report.results = report.results.map((result) => (result.id === "react-doctor" ? { ...result, ok: false } : result));
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const localGates = report.checks.find((check) => check.name === "local build and test gates");
  assert.equal(localGates?.status, "fail");
  assert.ok(localGateDetail(localGates).failedGateIds?.includes("react-doctor"));
});

test("steady-state deploy preflight rejects missing live-preview local-gate evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateLocalGatesReport(backupDir, (report) => {
    report.results = report.results.filter(
      (result) => result.id !== PREVIEW_E2E_LOCAL_GATE_ID,
    );
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });
  const localGates = report.checks.find(
    (check) => check.name === "local build and test gates",
  );
  assert.equal(report.ok, false);
  assert.equal(localGates?.status, "fail");
  assert.ok(
    localGateDetail(localGates).missingGateIds?.includes(
      PREVIEW_E2E_LOCAL_GATE_ID,
    ),
  );
});

test("steady-state deploy preflight rejects missing, stale, or critically skipped preview evidence", async (t) => {
  for (const scenario of ["missing", "stale", "quiz-skipped"] as const) {
    await t.test(scenario, () => {
      const { backupDir, repoDir } = makeFixture();
      const evidencePath = path.join(
        backupDir,
        PREVIEW_E2E_EVIDENCE_RELATIVE_PATH,
      );
      if (scenario === "missing") {
        fs.rmSync(evidencePath);
      } else {
        const evidence = readPreviewE2EFixture(evidencePath);
        if (scenario === "stale") {
          evidence.createdAt = "2026-06-26T10:59:59.000Z";
        } else {
          markPreviewE2ETestSkipped(
            evidence,
            "configured native quiz reaches a complete, answer-revealing result",
          );
        }
        fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      }

      const report = buildSteadyStateDeployPreflightReport({
        backupDir,
        cwd: repoDir,
        runWranglerDryRun: false,
        nowMs: PREFLIGHT_NOW_MS,
      });
      const preview = report.checks.find(
        (check) => check.name === PREVIEW_E2E_CHECK_NAME,
      );
      assert.equal(report.ok, false);
      assert.equal(preview?.status, "fail");
      if (scenario === "stale") {
        assert.match(JSON.stringify(preview?.detail), /stale/i);
      }
      if (scenario === "quiz-skipped") {
        assert.match(
          JSON.stringify(preview?.detail),
          /wrong exact skipped-test set|required live preview test/i,
        );
      }
    });
  }
});

test("sealed deploy preparation binds the exact live-preview evidence bytes", () => {
  const { backupDir, repoDir } = makeFixture();
  const evidencePath = path.join(
    backupDir,
    PREVIEW_E2E_EVIDENCE_RELATIVE_PATH,
  );
  const evidence = readPreviewE2EFixture(evidencePath);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });
  assert.equal(
    report.checks.find((check) => check.name === PREVIEW_E2E_CHECK_NAME)?.status,
    "pass",
  );
  assert.equal(
    report.checks.find(
      (check) => check.name === WORKER_DEPLOY_PREPARATION_CHECK_NAME,
    )?.status,
    "fail",
  );
  assert.equal(report.ok, false);
});

test("steady-state deploy preflight rejects stale build artifact scan evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  const artifactReportPath = path.join(backupDir, "cloudflare/build-artifact-scan-report.json");
  const artifactReport = JSON.parse(fs.readFileSync(artifactReportPath, "utf8")) as Record<string, unknown>;
  artifactReport.createdAt = "2026-06-26T10:45:00Z";
  fs.writeFileSync(artifactReportPath, `${JSON.stringify(artifactReport, null, 2)}\n`);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const artifactScan = report.checks.find((check) => check.name === "OpenNext build artifact secret scan");
  assert.equal(artifactScan?.status, "fail");
});

test("steady-state deploy preflight rejects build artifact scan from a different source fingerprint", () => {
  const { backupDir, repoDir } = makeFixture();
  const artifactReportPath = path.join(backupDir, "cloudflare/build-artifact-scan-report.json");
  const artifactReport = JSON.parse(fs.readFileSync(artifactReportPath, "utf8")) as Record<string, unknown>;
  artifactReport.sourceFingerprint = { sha256: "0".repeat(64), fileCount: 1, files: [] };
  fs.writeFileSync(artifactReportPath, `${JSON.stringify(artifactReport, null, 2)}\n`);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const artifactScan = report.checks.find((check) => check.name === "OpenNext build artifact secret scan");
  assert.equal(artifactScan?.status, "fail");
  assert.equal((artifactScan?.detail as { sourceFingerprintOk?: boolean } | undefined)?.sourceFingerprintOk, false);
});

test("steady-state deploy preflight rejects absent D1 0013-0016 verification evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.rmSync(path.join(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0016");
  assert.equal(migration?.status, "fail");
});

test("steady-state deploy preflight rejects missing or partial deferred D1 0017 evidence", () => {
  for (const mutation of ["absent-file", "partial-state"] as const) {
    const { backupDir, repoDir } = makeFixture();
    const reportPath = path.join(
      backupDir,
      RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH,
    );
    if (mutation === "absent-file") {
      fs.rmSync(reportPath);
    } else {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
        ok: boolean;
        state: string;
        checks: Array<{ ok: boolean; detail: { state: string } }>;
      };
      report.ok = false;
      report.state = "partial";
      report.checks[0]!.ok = false;
      report.checks[0]!.detail.state = "partial";
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: PREFLIGHT_NOW_MS,
    });
    assert.equal(report.ok, false);
    assert.equal(
      report.checks.find((check) => check.name === RUNTIME_MIGRATION_0017_CHECK)
        ?.status,
      "fail",
    );
  }
});

test("steady-state deploy preflight rejects stale D1 0013-0016 verification evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateRuntimeMigrationEvidence(backupDir, (report) => {
    report.createdAt = "2026-06-26T10:45:00Z";
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0016");
  assert.equal(migration?.status, "fail");
});

test("steady-state deploy preflight rejects D1 migration evidence from the wrong source", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateRuntimeMigrationEvidence(backupDir, (report) => {
    report.sourceFingerprint.sha256 = "0".repeat(64);
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0016");
  assert.equal(migration?.status, "fail");
  assert.equal(
    (migration?.detail as { sourceFingerprintOk?: boolean } | undefined)?.sourceFingerprintOk,
    false,
  );
});

test("steady-state deploy preflight rejects non-ok or incomplete D1 migration evidence", () => {
  for (const mutate of [
    (report: RuntimeMigrationFixtureReport) => {
      report.ok = false;
    },
    (report: RuntimeMigrationFixtureReport) => {
      report.checks[0]!.ok = false;
    },
    (report: RuntimeMigrationFixtureReport) => {
      report.migrations = report.migrations.slice(0, 2);
    },
  ]) {
    const { backupDir, repoDir } = makeFixture();
    mutateRuntimeMigrationEvidence(backupDir, mutate);

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false);
    const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0016");
    assert.equal(migration?.status, "fail");
  }
});

test("steady-state deploy preflight requires regular non-symlink mode-0600 D1 migration evidence", () => {
  for (const mutateFile of [
    (reportPath: string) => fs.chmodSync(reportPath, 0o644),
    (reportPath: string) => {
      const targetPath = `${reportPath}.target`;
      fs.copyFileSync(reportPath, targetPath);
      fs.chmodSync(targetPath, 0o600);
      fs.rmSync(reportPath);
      fs.symlinkSync(targetPath, reportPath);
    },
  ]) {
    const { backupDir, repoDir } = makeFixture();
    const reportPath = path.join(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH);
    mutateFile(reportPath);

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false);
    const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0016");
    assert.equal(migration?.status, "fail");
    assert.equal(
      (migration?.detail as { fileSecurity?: { ok?: boolean } } | undefined)?.fileSecurity?.ok,
      false,
    );
  }
});

test("steady-state deploy preflight rejects high observability sampling outside incident mode", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    config.observability.head_sampling_rate = 1;
    config.observability.logs.head_sampling_rate = 1;
    config.observability.traces.head_sampling_rate = 1;
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
});

test("steady-state deploy preflight allows high observability sampling in incident mode", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    config.vars.OBSERVABILITY_INCIDENT_MODE = "1";
    config.observability.head_sampling_rate = 1;
    config.observability.logs.head_sampling_rate = 1;
    config.observability.traces.head_sampling_rate = 1;
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, true);
});

test("steady-state deploy preflight rejects missing guest quota runtime vars", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    delete (config.vars as Record<string, string | undefined>).RATE_LIMIT_GUEST_SESSION_DAILY;
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
  assert.ok(
    (wrangler?.detail as { missingVars?: string[] } | undefined)?.missingVars?.includes(
      "RATE_LIMIT_GUEST_SESSION_DAILY",
    ),
  );
});

test("steady-state deploy preflight rejects malformed global AI budget limits", () => {
  const { backupDir, repoDir } = makeFixture();
  const invalidLimits = ["invalid", "-1", "1.5", "1e3", "9007199254740992"];

  for (const limit of invalidLimits) {
    replaceWranglerConfig(repoDir, backupDir, (config) => {
      config.vars.LLM_GLOBAL_DAILY_CALL_LIMIT = limit;
    });

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false, limit);
    const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
    assert.equal(wrangler?.status, "fail", limit);
    assert.ok(wrangler?.detail && typeof wrangler.detail === "object", limit);
    assert.equal(Reflect.get(wrangler.detail, "globalDailyCallLimitOk"), false, limit);
  }
});

test("steady-state deploy preflight pins the 512-dimensional embedding model", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    config.vars.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
  assert.ok(wrangler?.detail && typeof wrangler.detail === "object");
  assert.equal(Reflect.get(wrangler.detail, "embeddingModelCompatible"), false);
});

test("steady-state deploy preflight rejects a direct OpenAI secret in Gateway BYOK production", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    config.secrets.required.push("OPENAI_API_KEY");
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
  assert.equal((wrangler?.detail as { requiredSecretsOk?: boolean }).requiredSecretsOk, false);
});

test("steady-state deploy preflight rejects missing or retired native memory bindings", () => {
  const mutations: Array<(config: ReturnType<typeof wranglerConfig>) => void> = [
    (config) => {
      Object.assign(config, { vectorize: [{ binding: "MEMORY_VECTORIZE", index_name: "retired" }] });
    },
    (config) => {
      Object.assign(config, { r2_buckets: [{ binding: "NEXT_INC_CACHE_R2_BUCKET", bucket_name: "retired" }] });
    },
    (config) => {
      Object.assign(config, { queues: { producers: [{ binding: "RETIRED", queue: "retired" }] } });
    },
    (config) => {
      Object.assign(config, { triggers: { crons: [] } });
    },
    (config) => {
      if (config.queues?.consumers?.[0]) config.queues.consumers[0].max_batch_size = 5;
    },
    (config) => {
      Object.assign(config, { triggers: { crons: ["0 3 * * *", "* * * * *"] } });
    },
  ];

  for (const mutate of mutations) {
    const { backupDir, repoDir } = makeFixture();
    replaceWranglerConfig(repoDir, backupDir, mutate);

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false);
    const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
    assert.equal(wrangler?.status, "fail");
    assert.equal((wrangler?.detail as { memoryBindingsOk?: boolean }).memoryBindingsOk, false);
  }
});

test("steady-state deploy preflight rejects Worker-wide response caching", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    Object.assign(config, { cache: { enabled: true } });
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
  assert.equal((wrangler?.detail as { workerGlobalCacheOk?: boolean }).workerGlobalCacheOk, false);
});

test("steady-state deploy preflight rejects paid-only CPU limits on the Free deployment", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    Object.assign(config, { limits: { cpu_ms: 5_000 } });
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
  assert.equal((wrangler?.detail as { freePlanCpuConfigOk?: boolean }).freePlanCpuConfigOk, false);
});

test("steady-state deploy preflight rejects a missing Static Asset 404 boundary", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    delete (config.assets as { not_found_handling?: string }).not_found_handling;
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
  assert.equal((wrangler?.detail as { staticAssetsOk?: boolean }).staticAssetsOk, false);
});

test("steady-state deploy preflight rejects broad or incomplete Worker-first routing", () => {
  for (const mutate of [
    (routes: string[]) => routes.push("/*"),
    (routes: string[]) => routes.push("/api/topics"),
    (routes: string[]) => routes.splice(routes.indexOf("/api/health"), 1),
    (routes: string[]) => routes.splice(routes.indexOf("!/_next/static/*"), 1),
  ]) {
    const { backupDir, repoDir } = makeFixture();
    replaceWranglerConfig(repoDir, backupDir, (config) => {
      mutate(config.assets.run_worker_first);
    });

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false);
    const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
    assert.equal(wrangler?.status, "fail");
    assert.equal((wrangler?.detail as { staticAssetsOk?: boolean }).staticAssetsOk, false);
  }
});

test("steady-state deploy preflight rejects a missing zero-CPU legal redirect", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.rmSync(path.join(repoDir, "public/_redirects"));
  writeLocalEvidence(backupDir, repoDir, buildRepoSourceFingerprint(repoDir));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
  assert.equal((wrangler?.detail as { staticLegalRedirectOk?: boolean }).staticLegalRedirectOk, false);
});

test("steady-state deploy preflight rejects a missing legacy Durable Object rollback binding", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    config.durable_objects.bindings = [];
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
  assert.equal((wrangler?.detail as { cacheRevalidationDoOk?: boolean }).cacheRevalidationDoOk, false);
});

test("deploy preflight requires a post-migration Durable Object rollback target", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/deploy-preflight.ts"), "utf8");

  assert.match(source, /remoteDurableObjectInfrastructureCheck/);
  assert.match(source, /"deployments"\s*,\s*"status"\s*,\s*"--json"/);
  assert.match(source, /"versions"\s*,\s*"view"/);
  assert.match(source, /NEXT_CACHE_DO_QUEUE/);
  assert.match(source, /durable_object_namespace/);
  assert.match(source, /DOQueueHandler/);
});

test("steady-state deploy preflight rejects an OpenNext main Worker", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.writeFileSync(
    path.join(repoDir, "cloudflare-worker.ts"),
    'import handler from "./.open-next/worker.js";\nexport default handler;\n',
  );
  writeLocalEvidence(backupDir, repoDir, buildRepoSourceFingerprint(repoDir));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const architecture = report.checks.find((check) => check.name === "Free static and native account architecture");
  assert.equal(architecture?.status, "fail");
  assert.equal(
    (architecture?.detail as { noOpenNextRuntimeImport?: boolean } | undefined)?.noOpenNextRuntimeImport,
    false,
  );
});

test("OpenNext runtime import detection rejects every OpenNext module import", () => {
  assert.equal(
    hasOpenNextRequestRuntimeImport(
      'export { DOQueueHandler } from "./.open-next/.build/durable-objects/queue.js";',
    ),
    true,
  );
  assert.equal(
    hasOpenNextRequestRuntimeImport('import handler from "./.open-next/worker.js";'),
    true,
  );
  assert.equal(
    hasOpenNextRequestRuntimeImport(
      'import handler from "./.open-next/server-functions/default/handler.mjs";',
    ),
    true,
  );
  assert.equal(
    hasOpenNextRequestRuntimeImport('const handler = require("./.open-next/worker.js");'),
    true,
  );
  assert.equal(hasOpenNextRequestRuntimeImport('import { getCloudflareContext } from "@opennextjs/cloudflare";'), true);
  assert.equal(hasOpenNextRequestRuntimeImport('import { NextResponse } from "next/server";'), true);
});

function makeFixture() {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const repoDir = fs.mkdtempSync(path.join(temporaryRoot, "inspir-deploy-preflight-repo-"));
  const backupDir = fs.mkdtempSync(path.join(temporaryRoot, "inspir-deploy-preflight-backup-"));
  fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
  fs.chmodSync(path.join(backupDir, "cloudflare"), 0o700);
  runGit(repoDir, ["init"]);
  fs.writeFileSync(path.join(repoDir, ".gitignore"), ".open-next/\n");
  fs.writeFileSync(path.join(repoDir, "app.ts"), "export const ok = true;\n");
  fs.writeFileSync(path.join(repoDir, "wrangler.jsonc"), `${JSON.stringify(wranglerConfig(), null, 2)}\n`);
  fs.writeFileSync(path.join(repoDir, "cloudflare-worker.ts"), leanWorkerSource());
  fs.mkdirSync(path.join(repoDir, "scripts/cloudflare"), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, "scripts/cloudflare/materialize-static-marketing-assets.ts"),
    leanMaterializerSource(),
  );
  fs.mkdirSync(path.join(repoDir, "public"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "public/_redirects"), "/tnc /terms 308\n");

  configurePushedFixtureRepository(repoDir);
  createStaticMarketingAssetFixture(repoDir);

  const fingerprint = buildRepoSourceFingerprint(repoDir);
  writeLocalEvidence(backupDir, repoDir, fingerprint);
  sealWorkerDeployPreparationFixture(backupDir, repoDir);

  return { repoDir, backupDir };
}

function replaceWranglerConfig(
  repoDir: string,
  backupDir: string,
  mutate: (config: ReturnType<typeof wranglerConfig>) => void,
) {
  const config = wranglerConfig();
  mutate(config);
  fs.writeFileSync(path.join(repoDir, "wrangler.jsonc"), `${JSON.stringify(config, null, 2)}\n`);
  commitAndPushFixture(repoDir, "update Wrangler fixture");
  writeLocalEvidence(backupDir, repoDir, buildRepoSourceFingerprint(repoDir));
  sealWorkerDeployPreparationFixture(backupDir, repoDir);
}

function configurePushedFixtureRepository(repoDir: string) {
  runGit(repoDir, ["config", "user.email", "codex-tests@inspirlearning.invalid"]);
  runGit(repoDir, ["config", "user.name", "Codex Tests"]);
  runGit(repoDir, ["add", "."]);
  runGit(repoDir, ["commit", "-m", "fixture"]);
  const remoteDir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "inspir-deploy-preflight-remote-"),
  );
  runGit(remoteDir, ["init", "--bare"]);
  runGit(repoDir, ["remote", "add", "origin", remoteDir]);
  runGit(repoDir, ["push", "--set-upstream", "origin", "HEAD"]);
}

function commitAndPushFixture(repoDir: string, message: string) {
  runGit(repoDir, ["add", "."]);
  runGit(repoDir, ["commit", "-m", message]);
  runGit(repoDir, ["push"]);
}

function writeLocalEvidence(
  backupDir: string,
  repoDir: string,
  fingerprint: SourceFingerprint,
) {
  const createdAt = "2026-06-26T11:45:00.000Z";
  writeJson(backupDir, "cloudflare/local-gates-report.json", {
    ok: true,
    createdAt,
    backupDir,
    sourceFingerprintStable: true,
    sourceFingerprintAfter: fingerprint,
    results: LOCAL_GATE_IDS.map((id) => ({ id, ok: true })),
  });
  writePreviewE2EEvidence(backupDir, fingerprint, createdAt);
  writeJson(backupDir, "cloudflare/source-secret-scan-report.json", {
    ok: true,
    createdAt,
    backupDir,
    sourceFingerprint: {
      sha256: fingerprint.sha256,
      fileCount: fingerprint.fileCount,
    },
    findings: [],
  });
  writeJson(backupDir, "cloudflare/build-artifact-scan-report.json", {
    ok: true,
    createdAt,
    backupDir,
    sourceFingerprint: fingerprint,
    artifactRoot: ".open-next",
    nextEnvFile: ".open-next/cloudflare/next-env.mjs",
    scannedFiles: 42,
    findings: [],
  });
  writeJson(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH, {
    kind: RUNTIME_MIGRATION_EVIDENCE_KIND,
    ok: true,
    createdAt,
    backupDir,
    database: D1_DATABASE_NAME,
    migrations: [...RUNTIME_MIGRATION_FILES],
    sourceFingerprintBefore: fingerprint,
    sourceFingerprint: fingerprint,
    sourceFingerprintStable: true,
    rowsRead: 31,
    rowsWritten: 0,
    totalAttempts: 1,
    checks: RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.map((id) => ({ id, ok: true })),
  });
  fs.chmodSync(path.join(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH), 0o600);
  writeJson(backupDir, RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH, {
    kind: RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
    schemaVersion: 1,
    ok: false,
    state: "absent",
    createdAt,
    backupDir,
    database: D1_DATABASE_NAME,
    migration: RUNTIME_MIGRATION_0017_FILE,
    sourceFingerprintBefore: fingerprint,
    sourceFingerprint: fingerprint,
    sourceFingerprintStable: true,
    rowsRead: 3,
    rowsWritten: 0,
    totalAttempts: 1,
    checks: [
      {
        id: RUNTIME_MIGRATION_0017_CHECK_ID,
        ok: false,
        detail: {
          state: "absent",
          schemaRows: 0,
          catalogRows: 0,
          keyRows: 0,
          tableMatches: false,
          sqlMatches: false,
          catalogMatches: false,
          keySequenceMatches: false,
        },
      },
    ],
  });
  fs.chmodSync(
    path.join(backupDir, RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH),
    0o600,
  );
  historicalFresh0016CutoverFixtures.set(
    path.resolve(backupDir),
    historicalFresh0016CutoverFixture(backupDir, fingerprint),
  );
}

function sealWorkerDeployPreparationFixture(
  backupDir: string,
  repoDir: string,
) {
  createProductionTrustBoundaryAcceptance({
    cwd: repoDir,
    backupDirectory: backupDir,
    now: new Date("2026-06-26T11:49:00.000Z"),
  });
  const handle = createWorkerDeployPreparation({
    cwd: repoDir,
    backupDirectory: backupDir,
    now: new Date("2026-06-26T11:50:00.000Z"),
    dependencies: {
      inspectResources: (cwd) =>
        inspectOpenNextResourceBudget(
          cwd,
          defaultOpenNextResourceBudget,
          { expectedLocalizedAssetPaths: null },
        ),
    },
  });
  workerDeployPreparationFixtures.set(path.resolve(backupDir), handle);
  return handle;
}

function writePreviewE2EEvidence(
  backupDir: string,
  fingerprint: SourceFingerprint,
  createdAt: string,
) {
  const passingTitles = [
    ...PREVIEW_E2E_REQUIRED_TEST_TITLES,
    "ordinary preview contract",
  ];
  const playwright = {
    config: {
      projects: [{ name: "chromium", retries: 0, repeatEach: 1 }],
    },
    suites: [
      {
        title: "preview",
        specs: [
          ...passingTitles.map((title) => previewE2ESpec(title, "passed")),
          ...PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES.map((title) =>
            previewE2ESpec(title, "skipped"),
          ),
        ],
      },
    ],
    errors: [],
    stats: {
      startTime: createdAt,
      duration: 1_000,
      expected: passingTitles.length,
      unexpected: 0,
      flaky: 0,
      skipped: PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES.length,
    },
  };
  const coverage = analyzePreviewE2EPlaywrightReport(playwright);
  assert.equal(coverage.ok, true, coverage.blockers.join("; "));
  writeJson(backupDir, PREVIEW_E2E_EVIDENCE_RELATIVE_PATH, {
    kind: PREVIEW_E2E_EVIDENCE_KIND,
    schemaVersion: PREVIEW_E2E_EVIDENCE_SCHEMA_VERSION,
    createdAt,
    backupDir,
    baseUrl: "http://localhost:8787",
    ok: true,
    exitCode: 0,
    sourceFingerprintBefore: fingerprint,
    sourceFingerprintAfter: fingerprint,
    sourceFingerprintStable: true,
    stats: playwright.stats,
    liveEnvironment: {
      requireLiveAi: true,
      providerRuntimeCredentialConfigured: true,
      authenticatedE2eRequired: true,
      migrationE2eAuth: true,
      productionE2eReadOnly: false,
      productScope: "multilingual-static-native-accounts-memory-admin-and-activities",
    },
    coverage,
    requirementBlockers: [],
    playwright,
  });
}

function previewE2ESpec(title: string, status: "passed" | "skipped") {
  const skipped = status === "skipped";
  return {
    title,
    ok: true,
    tests: [
      {
        projectName: "chromium",
        expectedStatus: skipped ? "skipped" : "passed",
        status: skipped ? "skipped" : "expected",
        results: [{ status }],
      },
    ],
  };
}

function historicalFresh0016CutoverFixture(
  backupDir: string,
  fingerprint: SourceFingerprint,
): HistoricalFresh0016ValidatedCutoverArtifactHandle {
  const resolvedBackupDir = path.resolve(backupDir);
  const runId = "11111111-1111-4111-8111-111111111111";
  const canonicalPath = path.join(
    resolvedBackupDir,
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage.canonicalCompleteRelativePath,
  );
  const runDirectory = path.join(
    resolvedBackupDir,
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage.runsRelativeDirectory,
    runId,
  );
  const hash = "a".repeat(64);
  const sourceFingerprint = {
    sha256: fingerprint.sha256,
    fileCount: fingerprint.fileCount,
  };
  const workerRelease = {
    phase: "uploaded-inactive",
    targetCandidateVersionId: "22222222-2222-4222-8222-222222222222",
    serviceBaselineVersionId: "99999999-9999-4999-8999-999999999999",
    uploadEvidenceSha256: hash,
  } as const;
  const topologyStatusOutput = (deploymentId: string) => JSON.stringify({
    id: deploymentId,
    versions: [{
      version_id: workerRelease.serviceBaselineVersionId,
      percentage: 100,
    }],
  });
  const predecessorLiveTopology =
    createHistoricalFresh0016LiveTopologyEvidence({
      observedAt: new Date("2026-06-25T23:49:00.000Z"),
      statusOutput: topologyStatusOutput(
        "77777777-7777-4777-8777-777777777777",
      ),
      ...workerRelease,
    });
  const finalizationLiveTopology =
    createHistoricalFresh0016LiveTopologyEvidence({
      observedAt: new Date("2026-06-26T00:10:30.000Z"),
      statusOutput: topologyStatusOutput(
        "88888888-8888-4888-8888-888888888888",
      ),
      ...workerRelease,
    });
  const liveRuntimeState = {
    kind: "inspir-historical-data-fresh-0016-predecessor-runtime-gate-v2",
    schemaVersion: 2,
    timing: "live-before-hmac-run-predecessor-ledger-and-snapshot",
    predecessorUtcDay: "2026-06-25",
    operationId:
      `historical-fresh-0016-predecessor-runtime-gate:${hash}`,
    sourceFingerprint,
    workerRelease,
    liveTopology: predecessorLiveTopology,
    maximum: {
      rowsRead:
        HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ,
      rowsWritten: 0,
    },
    exactState: {
      migrations0013To0015: "applied",
      migration0016: "absent",
      migration0017: "absent-deferred-free-plan",
      appliedStaticCheckCount: 8,
      absent0016StaticCheckCount: 5,
    },
    accounting:
      "dedicated-top-level-maximum-reserved-before-live-read-only-queries",
  } as const;
  const predecessorPrerequisites = {
    kind: "inspir-historical-data-fresh-0016-predecessor-prerequisites-v3",
    schemaVersion: 3,
    timing: "completed-on-earlier-utc-day-before-predecessor",
    predecessorUtcDay: "2026-06-25",
    sourceFingerprint,
    workerRelease,
    releaseIdentitySha256: hash,
    topic: {
      createdAt: "2026-06-24T20:00:00.000Z",
      evidenceSha256: hash,
      seedSha256: hash,
      verifiedTopics: 12,
      verifiedArchivedTopics: 1,
    },
    translation: {
      createdAt: "2026-06-24T21:00:00.000Z",
      evidenceSha256: hash,
      method: "read-only-drift",
      remoteQueries: 3,
      billedRowsRead: 100,
      repairApplied: false,
    },
    runtimeMigration0017: {
      verifiedAt: "2026-06-25T18:01:00.000Z",
      verificationEvidenceSha256: hash,
      operationId: "d1-runtime-migration-0017",
      reservedRowsRead: 768,
      reservedRowsWritten: 0,
      state: "absent-deferred-free-plan",
      reason:
        "cloudflare-free-plan-verified-production-users-exceed-0017-index-write-envelope",
      runtimePath:
        "users-email-unique-exact-lookup-with-bounded-casefold-fallback",
    },
    liveRuntimeState,
    mutationRule:
      "no-topic-translation-or-deferred-0017-apply-from-predecessor-through-final-verifier",
    privacy: "release-identities-and-aggregate-counts-only",
  } as const;
  const artifact = {
    kind: "inspir-historical-data-fresh-0016-cutover-complete-v2",
    schemaVersion: 2,
    createdAt: HISTORICAL_FIXTURE_CREATED_AT.toISOString(),
    cutoverRunId: runId,
    paths: {
      backupDirectory: resolvedBackupDir,
      runDirectory,
      canonicalCompletePath: canonicalPath,
    },
    policy: {
      id: HISTORICAL_FRESH_0016_CUTOVER_POLICY.policyId,
      sha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      lostKeyStatus:
        HISTORICAL_FRESH_0016_CUTOVER_POLICY.legacyInterval.status,
      legacyIntervalContinuityProven: false,
      retroactiveContinuityClaimed: false,
    },
    database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
    sourceFingerprint,
    workerRelease,
    finalizationLiveTopology,
    hmacKeyId: hash,
    state: {
      verifiedStageCount: 12,
      boundStageHashCount: 11,
      stages: {
        claim: hash,
        "predecessor-authorized": hash,
        "predecessor-prepared": hash,
        "predecessor-complete": hash,
        manifest: hash,
        "migration-authorized": hash,
        "migration-complete": hash,
        "runtime-verification": hash,
        "successor-authorized": hash,
        "successor-prepared": hash,
        "successor-complete": hash,
      },
      successorCompleteStageSha256: hash,
      completionIntentMaterialSha256: hash,
    },
    evidence: {
      predecessorPrerequisitesSha256: hash,
      predecessorPrerequisites,
      predecessorReportFileSha256: hash,
      migrationBudgetPreparedArtifactFileSha256: hash,
      manifestPayloadSha256: hash,
      bindingSha256: hash,
      renderedMigrationSha256: hash,
      migrationAuthorizationStageSha256: hash,
      migrationCompleteStageSha256: hash,
      runtimeVerificationCanonicalValueSha256: hash,
      runtimeVerificationCanonicalFileSha256: hash,
      successorReportFileSha256: hash,
      productionExclusionOwnerSha256: hash,
      preWriteEvidenceSha256: hash,
    },
    migration: {
      status: "verified" as const,
      attempts: 1,
      readbackResolutionUsed: false,
      runtimeRowsRead: 1,
      runtimeRowsWritten: 0 as const,
    },
    continuity: {
      ok: true as const,
      protectedDatasetCount:
        HISTORICAL_FRESH_0016_CUTOVER_POLICY.proof.protectedDatasetCount,
      decisionsSha256: hash,
      predecessorToSuccessorGapMs: 20 * 60 * 1_000,
      outboxSchemaPresent: true as const,
      outboxRowsBeforeActivation: 0 as const,
    },
    timing: {
      predecessorUtcDay: "2026-06-25",
      successorUtcDay: "2026-06-26",
      predecessorCreatedAt: "2026-06-25T23:50:00.000Z",
      runtimeVerifiedAt: "2026-06-26T00:05:00.000Z",
      successorCreatedAt: "2026-06-26T00:10:00.000Z",
      productionExclusionLeaseExpiresAt: Date.parse("2026-06-26T01:00:00.000Z"),
    },
    budget: {
      predecessorOperationId: `historical-fresh-0016-predecessor:${hash}`,
      predecessorMaximumRowsRead:
        HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      predecessorExactRowsRead: 1,
      runtimeMigrationReportSha256: hash,
      runtimeMigrationProjectedRowsRead: 1,
      runtimeMigrationProjectedRowsWritten: 1,
      applyEnvelopeRowsRead:
        HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
          .projectedRowsRead,
      applyMaximumWriteCapableCalls:
        HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
          .writeCapableCalls,
      successorOperationId: `historical-fresh-0016-successor:${hash}`,
      successorMaximumRowsRead:
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      successorExactRowsRead: 1,
    },
    privacy: "hashes-counts-and-hmac-identities-only" as const,
  } as const;
  return {
    path: canonicalPath,
    bytes: 1,
    sha256: hash,
    validation: "existing-full-chain",
    artifact,
  };
}

function requireJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type RuntimeMigrationFixtureReport = {
  ok: boolean;
  createdAt: string;
  migrations: string[];
  sourceFingerprint: { sha256: string; fileCount: number };
  checks: Array<{ id: string; ok: boolean }>;
};

function mutateRuntimeMigrationEvidence(
  backupDir: string,
  mutate: (report: RuntimeMigrationFixtureReport) => void,
) {
  const reportPath = path.join(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as RuntimeMigrationFixtureReport;
  mutate(report);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function mutateLocalGatesReport(
  backupDir: string,
  mutate: (report: { ok: boolean; results: Array<{ id: string; ok: boolean }> }) => void,
) {
  const reportPath = path.join(backupDir, "cloudflare/local-gates-report.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    ok: boolean;
    results: Array<{ id: string; ok: boolean }>;
  };
  mutate(report);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function readPreviewE2EFixture(filePath: string) {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return requireJsonObject(parsed, "preview E2E fixture");
}

function markPreviewE2ETestSkipped(
  evidence: Record<string, unknown>,
  title: string,
) {
  const playwright = requireJsonObject(
    evidence.playwright,
    "preview Playwright report",
  );
  const suites = playwright.suites;
  if (!Array.isArray(suites) || suites.length !== 1) {
    throw new TypeError("Preview Playwright fixture must contain one suite.");
  }
  const suite = requireJsonObject(suites[0], "preview Playwright suite");
  const specs = suite.specs;
  if (!Array.isArray(specs)) {
    throw new TypeError("Preview Playwright fixture specs must be an array.");
  }
  const spec = specs
    .map((value) => requireJsonObject(value, "preview Playwright spec"))
    .find((value) => value.title === title);
  if (!spec) throw new TypeError(`Missing preview Playwright spec: ${title}.`);
  const tests = spec.tests;
  if (!Array.isArray(tests) || tests.length !== 1) {
    throw new TypeError("Preview Playwright spec must contain one project test.");
  }
  const projectTest = requireJsonObject(tests[0], "preview Playwright project test");
  projectTest.expectedStatus = "skipped";
  projectTest.status = "skipped";
  projectTest.results = [{ status: "skipped" }];

  const stats = requireJsonObject(playwright.stats, "preview Playwright stats");
  stats.expected = requireFixtureNumber(stats.expected, "preview expected") - 1;
  stats.skipped = requireFixtureNumber(stats.skipped, "preview skipped") + 1;
  evidence.stats = stats;
  const analysis = analyzePreviewE2EPlaywrightReport(playwright);
  evidence.coverage = {
    ok: true,
    blockers: [],
    totalTests: analysis.totalTests,
    requiredPassedTitles: [...PREVIEW_E2E_REQUIRED_TEST_TITLES],
    skippedTitles: analysis.skippedTitles,
  };
  evidence.ok = true;
}

function staticMarketingAssetFixtureReportPath(repoDir: string) {
  return path.join(repoDir, ".open-next/static-marketing-assets-report.json");
}

function staticMarketingAssetFixtureRoot(repoDir: string) {
  return path.join(repoDir, ".open-next/assets");
}

function createStaticMarketingAssetFixture(repoDir: string) {
  const assetsRoot = staticMarketingAssetFixtureRoot(repoDir);
  fs.mkdirSync(path.join(repoDir, ".open-next/cache/build-test"), { recursive: true });
  for (const relativePath of expectedLegacyTranslationPaths) {
    const filePath = path.join(assetsRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `fixture:${relativePath}\n`);
  }
  for (const relativePath of expectedLocalizedStaticAssetPaths) {
    const filePath = path.join(assetsRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `localized:${relativePath}\n`);
  }
  const staticChunkPath = path.join(assetsRoot, "_next/static/release-fixture.js");
  fs.mkdirSync(path.dirname(staticChunkPath), { recursive: true });
  fs.writeFileSync(staticChunkPath, "untouched non-generated chunk\n");
  const assetManifest = buildWorkerDeployArtifactManifest(assetsRoot);
  writeStaticMarketingAssetFixtureReport(repoDir, {
    createdAt: HISTORICAL_FIXTURE_CREATED_AT.toISOString(),
    buildId: "build-test",
    assetFiles: assetManifest.fileCount,
    assetManifestBytes: assetManifest.bytes,
    assetManifestSha256: assetManifest.sha256,
    legacyTranslationApiAssets: 280,
    legacyMainAppTranslationResponses: 70,
    legacySiteTranslationResponses: 210,
    legacyCompleteTranslationResponses: 280,
    legacyIncompleteTranslationResponses: 0,
    translationAvailabilitySha256:
      staticAssetLocalizedPathContract.availabilitySha256,
    expectedLocalizedHtmlDocuments: expectedLocalizedStaticAssetPaths.length,
    expectedLocalizedHtmlPathsSha256:
      staticAssetLocalizedPathContract.localizedPathsSha256,
    localizedHtmlDocuments: expectedLocalizedStaticAssetPaths.length,
    localizedHtmlPathsSha256:
      staticAssetLocalizedPathContract.localizedPathsSha256,
    outputSha256: hashStaticFixtureGeneratedOutput(assetsRoot),
    generatedPaths: [...expectedLegacyTranslationPaths],
  });
}

function hashStaticFixtureGeneratedOutput(assetsRoot: string) {
  const hash = createHash("sha256");
  for (const relativePath of expectedLegacyTranslationPaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(assetsRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function writeStaticMarketingAssetFixtureReport(
  repoDir: string,
  report: StaticMarketingAssetFixtureReport,
) {
  const reportPath = staticMarketingAssetFixtureReportPath(repoDir);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function readStaticMarketingAssetFixtureReport(
  repoDir: string,
): StaticMarketingAssetFixtureReport {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(staticMarketingAssetFixtureReportPath(repoDir), "utf8"),
  );
  const report = requireJsonObject(parsed, "static marketing asset fixture report");
  const generatedPaths = report.generatedPaths;
  if (
    !Array.isArray(generatedPaths) ||
    !generatedPaths.every((entry): entry is string => typeof entry === "string")
  ) {
    throw new TypeError("Static marketing asset fixture paths must be strings.");
  }
  return {
    createdAt: requireFixtureString(report.createdAt, "createdAt"),
    buildId: requireFixtureString(report.buildId, "buildId"),
    assetFiles: requireFixtureNumber(report.assetFiles, "assetFiles"),
    assetManifestBytes: requireFixtureNumber(
      report.assetManifestBytes,
      "assetManifestBytes",
    ),
    assetManifestSha256: requireFixtureString(
      report.assetManifestSha256,
      "assetManifestSha256",
    ),
    legacyTranslationApiAssets: requireFixtureNumber(
      report.legacyTranslationApiAssets,
      "legacyTranslationApiAssets",
    ),
    legacyMainAppTranslationResponses: requireFixtureNumber(
      report.legacyMainAppTranslationResponses,
      "legacyMainAppTranslationResponses",
    ),
    legacySiteTranslationResponses: requireFixtureNumber(
      report.legacySiteTranslationResponses,
      "legacySiteTranslationResponses",
    ),
    legacyCompleteTranslationResponses: requireFixtureNumber(
      report.legacyCompleteTranslationResponses,
      "legacyCompleteTranslationResponses",
    ),
    legacyIncompleteTranslationResponses: requireFixtureNumber(
      report.legacyIncompleteTranslationResponses,
      "legacyIncompleteTranslationResponses",
    ),
    translationAvailabilitySha256: requireFixtureString(
      report.translationAvailabilitySha256,
      "translationAvailabilitySha256",
    ),
    expectedLocalizedHtmlDocuments: requireFixtureNumber(
      report.expectedLocalizedHtmlDocuments,
      "expectedLocalizedHtmlDocuments",
    ),
    expectedLocalizedHtmlPathsSha256: requireFixtureString(
      report.expectedLocalizedHtmlPathsSha256,
      "expectedLocalizedHtmlPathsSha256",
    ),
    localizedHtmlDocuments: requireFixtureNumber(
      report.localizedHtmlDocuments,
      "localizedHtmlDocuments",
    ),
    localizedHtmlPathsSha256: requireFixtureString(
      report.localizedHtmlPathsSha256,
      "localizedHtmlPathsSha256",
    ),
    outputSha256: requireFixtureString(report.outputSha256, "outputSha256"),
    generatedPaths: [...generatedPaths],
  };
}

function requireFixtureNumber(value: unknown, label: string) {
  if (typeof value !== "number") {
    throw new TypeError(`Static marketing asset fixture ${label} must be a number.`);
  }
  return value;
}

function requireFixtureString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new TypeError(`Static marketing asset fixture ${label} must be a string.`);
  }
  return value;
}

function staticAssetReleaseDetail(check: { detail?: unknown } | undefined) {
  return requireJsonObject(check?.detail, "static asset release check detail");
}

function staticAssetReleaseError(check: { detail?: unknown } | undefined) {
  const error = staticAssetReleaseDetail(check).releaseValidationError;
  if (typeof error !== "string") {
    throw new TypeError("Static Asset release failure did not contain a validation error.");
  }
  return error;
}

function localGateDetail(check: { detail?: unknown } | undefined) {
  assert.ok(check?.detail && typeof check.detail === "object");
  return check.detail as { missingGateIds?: string[]; failedGateIds?: string[] };
}

function wranglerConfig() {
  return {
    name: "inspirlearning",
    main: "./cloudflare-worker.ts",
    compatibility_date: "2026-07-10",
    workers_dev: false,
    preview_urls: false,
    assets: {
      directory: ".open-next/assets",
      binding: "ASSETS",
      html_handling: "drop-trailing-slash",
      not_found_handling: "404-page",
      run_worker_first: [...FREE_PLAN_WORKER_FIRST_ROUTES],
    },
    d1_databases: [{ binding: "DB", database_name: D1_DATABASE_NAME, database_id: D1_DATABASE_ID }],
    vectorize: [{ binding: "MEMORY_VECTORIZE", index_name: VECTORIZE_INDEX_NAME }],
    r2_buckets: [{ binding: "PROFILE_IMAGES_R2_BUCKET", bucket_name: PROFILE_IMAGES_R2_BUCKET_NAME }],
    queues: {
      producers: [{ binding: "MEMORY_POST_TURN_QUEUE", queue: MEMORY_POST_TURN_QUEUE_NAME }],
      consumers: [{
        queue: MEMORY_POST_TURN_QUEUE_NAME,
        max_batch_size: 1,
        max_batch_timeout: 10,
        max_retries: 5,
        retry_delay: 60,
        dead_letter_queue: MEMORY_POST_TURN_DLQ_NAME,
      }],
    },
    triggers: { crons: ["0 3 * * *"] },
    services: [{ binding: "WORKER_SELF_REFERENCE", service: "inspirlearning" }],
    version_metadata: { binding: "CF_VERSION_METADATA" },
    durable_objects: {
      bindings: [{ name: "NEXT_CACHE_DO_QUEUE", class_name: "DOQueueHandler" }],
    },
    migrations: [{ tag: "opennext-cache-queue-v1", new_sqlite_classes: ["DOQueueHandler"] }],
    routes: [{ pattern: "inspirlearning.com" }, { pattern: "www.inspirlearning.com" }],
    observability: {
      enabled: true,
      head_sampling_rate: 0.02,
      logs: { enabled: true, head_sampling_rate: 0.05 },
      traces: { enabled: true, head_sampling_rate: 0.02 },
    },
    secrets: {
      required: [
        "CLOUDFLARE_AI_GATEWAY_TOKEN",
        "AUTH_SECRET",
        "AUTH_GOOGLE_ID",
        "AUTH_GOOGLE_SECRET",
        "ADMIN_EMAILS",
        "CRON_SECRET",
      ],
    },
    vars: {
      APP_URL: "https://inspirlearning.com",
      AUTH_URL: "https://inspirlearning.com",
      BETTER_AUTH_URL: "https://inspirlearning.com",
      CLOUDFLARE_AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/account/inspir/openai",
      CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS: "inspir",
      OPENAI_MODEL: "gpt-5-mini",
      OPENAI_FAST_MODEL: "gpt-5-mini",
      OPENAI_REASONING_MODEL: "gpt-5-mini",
      OPENAI_STRUCTURED_MODEL: "gpt-5-mini",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      RATE_LIMIT_USER_CHAT_DAILY: "20",
      RATE_LIMIT_GUEST_SESSION_DAILY: "10",
      RATE_LIMIT_GUEST_FINGERPRINT_DAILY: "10",
      RATE_LIMIT_GUEST_IP_DAILY: "150",
      RATE_LIMIT_ACTIVITY_DAILY: "10",
      RATE_LIMIT_MEMORY_DAILY: "20",
      LLM_GLOBAL_DAILY_CALL_LIMIT: "1000",
      MEMORY_POST_TURN_SYNTHESIS_THRESHOLD: "2",
      MEMORY_PROFILE_COMPILE_LIMIT: "20",
      OBSERVABILITY_INCIDENT_MODE: "0",
      APP_WRITE_FREEZE: "0",
      APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: "300",
    },
  };
}

function leanWorkerSource() {
  return `import { handleFreeGuestChat } from "./lib/free-runtime/guest-chat";
import { handleLegacyI18nApiRequest } from "./lib/free-runtime/legacy-i18n-api";
import { handleAccountApiRequest, prewarmAccountApi } from "./lib/free-runtime/account-api";
import { handleStateApiRequest, handleMemoryScheduled, handleMemoryQueue } from "./lib/free-runtime/state-api";
import { handleProtectedAiApiRequest } from "./lib/free-runtime/protected-ai-api";
import { env as workerEnv } from "cloudflare:workers";
type Env = { CF_VERSION_METADATA: { id: string } };
prewarmAccountApi(workerEnv);
export class DOQueueHandler {}
export default {
  fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname === "/api/guest-chat") return handleFreeGuestChat(request, env);
    return Response.json({ version: env.CF_VERSION_METADATA.id });
  },
};
`;
}

function leanMaterializerSource() {
  return `const staticChatCacheKeys = new Set(["chat"]);
const staticTopicsDocument = "api/topics";
const staticMainAppBundleRoot = "i18n/main-app";
const legacyTranslationApiAssets = materializeLegacyTranslationApiAssets();
const staticAdminDocument = "admin/index.html";
const staticTopicRedirect = "/chat/example /chat?topic=example 308";
function writeStaticMainAppBundles() { return staticMainAppBundleRoot; }
function materializeLegacyTranslationApiAssets() { return []; }
// Exact public topic redirects preserve static 404s for unknown and private chat paths.
export { legacyTranslationApiAssets, staticChatCacheKeys, staticTopicRedirect, staticTopicsDocument, writeStaticMainAppBundles };
`;
}

function writeJson(root: string, relativePath: string, value: unknown) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return (result.stdout ?? "").trim();
}
