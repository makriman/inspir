import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  assertFullTranslationCompletionTestRegistration,
  fullTranslationCompletionTest,
} from "./helpers/full-translation-completion-test";
import {
  defaultLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "../lib/content/languages";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "../lib/i18n/main-app-source";
import { siteSourceManifest } from "../lib/i18n/site-source-manifest";
import { getSiteTranslationSource } from "../lib/i18n/site-source";
import { isValidFieldTranslation } from "../lib/i18n/translation-field-validation";
import { isTranslationFieldLikelyFluent } from "../lib/i18n/translation-quality";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
} from "../scripts/long-tail-nllb-execution-profile";
import {
  LEGACY_MARKETING_SITE_EXPECTED_SOURCE_HASH,
  LEGACY_MARKETING_SITE_NAMESPACE,
  buildLegacyMarketingSiteComposedCorpus,
  type LegacyMarketingSiteContract,
} from "../lib/i18n/legacy-marketing-site-contract";
import {
  assertReadOnlyRemoteTranslationVerificationArgs,
  assertTranslationReconciliationCliPhase,
  assertRepairReadBudget,
  assertRepairWriteBudget,
  assertD1SqlStatementSize,
  assertD1TranslationPayloadSize,
  assertRepairArtifactEvidenceUnchanged,
  assertTranslationRepairPayloadInputsUnchanged,
  assertRemoteRepairBillingWithinMaximum,
  assertRemoteTranslationSequenceGate,
  assertExactProductionD1StorageIdentity,
  buildAtomicSeoCtaRepairSql,
  buildCanonicalLegacyMarketingCleanupSql,
  buildExactCuratedPackPayload,
  buildExactD1StorageAdmission,
  buildExactTranslationPartitionGuardSql,
  buildExactTranslationStorageRows,
  buildExpectedCuratedCte,
  buildRepairArtifactManifest,
  buildNativeMaintenanceUploadArgs,
  buildPinnedWorkerVersionDeployArgs,
  buildCuratedNamespaceRepairPlan,
  buildCuratedNamespaceRepairSql,
  buildCuratedRepairVerificationChunks,
  buildCuratedRepairVerificationSql,
  buildMainAppRepairPlan,
  buildMainAppRepairVerificationChunks,
  buildMarketingSiteRepairPlan,
  buildMarketingSiteRepairVerificationChunks,
  buildRemoteRepairVerificationSql,
  buildSiteSourceStorageEntries,
  decideImportRecovery,
  confirmPinnedWorkerVersion,
  curatedRepairVerificationQueryCount,
  getExactCuratedPackIdentifiers,
  getGrandfatheredEntryCuratedPackIdentifiers,
  isGrandfatheredEntryCuratedPackIdentifier,
  isMainAppWorkbenchPackFile,
  largestSqlStatementBytes,
  loadAndValidateTranslationSeed,
  loadCuratedNamespaceRepairRows,
  loadMainAppRepairRows,
  loadReleasedMarketingSiteRepairCorpus,
  mainAppRepairVerificationQueryCount,
  marketingSiteRepairVerificationQueryCount,
  nativeD1MaintenanceWorkerSource,
  nativeWranglerDeployEnv,
  parseD1Billing,
  parseCuratedPack,
  projectRepairBilledRowReads,
  projectRepairBilledRowWrites,
  productionMaintenanceRepairRunId,
  refineAbortedPrewriteTranslationRepairReservation,
  revalidateExactD1StorageAdmission,
  repairSeoCtaTranslations,
  readPrivateWorkerDeployEvidence,
  splitSqlStatements,
  translationRepairBudgetOperationId,
  translationRepairBudgetPlanSha256,
  validateExistingCuratedTargetIdentifiers,
  validateExistingMainAppTargetIdentifiers,
  validateNativeMaintenanceProbe,
  validateRepairSql,
  validateStaticRepairTargetIdentifiers,
  validateSiteSourceManifestFreshness,
  validateWorkerDeployEvidenceForRepair,
  verifyCuratedRepairResultRows,
  verifyCuratedRepairResultChunks,
  verifyMainAppRepairResultRows,
  verifyMainAppRepairResultChunks,
  verifyMarketingSiteRepairResultRows,
  verifyMarketingSiteRepairResultChunks,
  verifyRemoteTranslationDrift,
  writePreWriteDiagnosticEvidence,
  type CuratedNamespaceRepairRow,
  type MainAppRepairRow,
  type MarketingSiteRepairCorpus,
  type RemoteTranslationDriftReport,
} from "../scripts/cloudflare/repair-seo-cta-translations";
import type { WorkerDeployArtifactEvidence } from "../scripts/cloudflare/worker-deploy-evidence";
import {
  buildWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
  workerCandidateEvidenceSha256,
  writeWorkerCandidateEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";
import { protectLongTailSourceText } from "../scripts/generate-long-tail-translations";
import {
  readD1ReleaseBudgetLedger,
  reserveD1ReleaseBudget,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  type WranglerRunner,
} from "../scripts/cloudflare/migration-config";
import {
  PRODUCTION_VALIDATION_LOCK_KEY,
  PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ,
  PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN,
  type ProductionValidationLockRunner,
} from "../scripts/cloudflare/production-validation-lock";
import {
  assertSourceSyncWriteBudget,
  buildSiteTranslationSourceSyncPlan,
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
  parseD1SourceSnapshotBilledRowReads,
  parseD1SourceSnapshotResultSets,
  syncSiteTranslationSources,
} from "../scripts/cloudflare/sync-site-translation-sources";

const repairCandidateVersionId = "22222222-2222-4222-8222-222222222222";
const repairServiceBaselineVersionId = "11111111-1111-4111-8111-111111111111";
let cachedMarketingSiteRepairCorpus: MarketingSiteRepairCorpus | undefined;
let cachedSyntheticMarketingSiteFixture:
  | Readonly<{
      contract: LegacyMarketingSiteContract;
      release: MarketingSiteRepairCorpus;
    }>
  | undefined;

test("translation release gate requires canonical uploaded-inactive identity and sole-active baseline", () => {
  const backupDir = path.resolve("/tmp/inspir-translation-sequence");
  const cwd = path.resolve("/tmp/inspir-translation-source");
  const git = {
    head: "a".repeat(40),
    upstream: "a".repeat(40),
    upstreamRef: "origin/codex/release",
  };
  const artifacts: WorkerDeployArtifactEvidence = {
    sourceFingerprint: {
      sha256: "b".repeat(64),
      fileCount: 1,
      files: [{ file: "package.json", sha256: "c".repeat(64), bytes: 1 }],
    },
    workerSourceSha256: "d".repeat(64),
    wranglerConfigSha256: "e".repeat(64),
    assetManifest: {
      root: path.join(cwd, ".open-next/assets"),
      sha256: "f".repeat(64),
      fileCount: 1,
      bytes: 1,
    },
  };
  const upload = translationUploadEvidence(backupDir, git, artifacts);
  let bindingChecks = 0;
  const result = assertRemoteTranslationSequenceGate(
    {
      backupDir,
      candidateVersionId: repairCandidateVersionId,
      cwd,
    },
    {
      readUploadEvidence: () => upload,
      readGitIdentity: () => git,
      buildArtifactEvidence: () => artifacts,
      readActiveVersion: () => repairServiceBaselineVersionId,
      assertCurrentReleaseBinding: ({ currentRelease }) => {
        bindingChecks += 1;
        assert.equal(currentRelease.phase, "uploaded-inactive");
        assert.equal(currentRelease.uploadEvidenceSha256, upload.sha256);
      },
      validateVectorizeReadiness: (input) => {
        assert.equal(input.requiredPhase, "uploaded-inactive");
        assert.equal(
          input.currentRelease.soleServingVersionId,
          repairServiceBaselineVersionId,
        );
        return { createdAt: "2026-07-15T10:01:00.000Z" };
      },
      validateTopicReconciliation: ({ currentRelease }) => {
        assert.equal(
          currentRelease.targetCandidateVersionId,
          repairCandidateVersionId,
        );
        return {
          createdAt: "2026-07-15T10:02:00.000Z",
          vectorizeReadinessCreatedAt: "2026-07-15T10:01:00.000Z",
        };
      },
    },
  );
  assert.equal(bindingChecks, 1);
  assert.equal(result.currentRelease.phase, "uploaded-inactive");
  assert.equal(
    result.currentRelease.targetCandidateVersionId,
    repairCandidateVersionId,
  );
  assert.equal(
    result.currentRelease.serviceBaselineVersionId,
    repairServiceBaselineVersionId,
  );

  assert.throws(
    () =>
      assertRemoteTranslationSequenceGate(
        { backupDir, candidateVersionId: repairCandidateVersionId, cwd },
        {
          readUploadEvidence: () => upload,
          readGitIdentity: () => git,
          buildArtifactEvidence: () => artifacts,
          readActiveVersion: () => repairCandidateVersionId,
        },
      ),
    /service baseline.*candidate.*remains inactive/,
  );
});

function releasedMarketingSiteRepairCorpus() {
  cachedMarketingSiteRepairCorpus ??= loadReleasedMarketingSiteRepairCorpus();
  return cachedMarketingSiteRepairCorpus;
}

function syntheticMarketingSiteRepairFixture() {
  if (cachedSyntheticMarketingSiteFixture) {
    return cachedSyntheticMarketingSiteFixture;
  }
  const source = getSiteTranslationSource("marketing-shell");
  const sourceKey = "site.d0d9118568f5027bc1";
  const sourceText = source.sourceStrings[sourceKey];
  assert.ok(sourceText);
  const syntheticSourceStrings = Object.freeze({ [sourceKey]: sourceText });
  const identifiers = getExactCuratedPackIdentifiers().filter(
    (identifier) => identifier.namespace === "marketing-shell",
  );
  assert.equal(identifiers.length, 69);
  const payloads = identifiers.map((identifier) => {
    const completePayload = buildExactCuratedPackPayload(
      parseCuratedPack(identifier.file),
      source.sourceStrings,
      identifier,
    );
    const value = completePayload[sourceKey];
    assert.ok(value);
    return { language: identifier.language, payload: { [sourceKey]: value } };
  });
  const ownerByKey = Object.fromEntries(
    Object.keys(syntheticSourceStrings).map((key) => [key, "marketing-shell"]),
  );
  const contract: LegacyMarketingSiteContract = Object.freeze({
    namespace: LEGACY_MARKETING_SITE_NAMESPACE,
    marketingSourceHash: source.sourceHash,
    marketingSourceStrings: syntheticSourceStrings,
    routeNamespaces: Object.freeze(["marketing-shell"]),
    routeSourcesByNamespace: Object.freeze({
      "marketing-shell": Object.freeze({
        sourceHash: source.sourceHash,
        sourceStrings: syntheticSourceStrings,
      }),
    }),
    routeUnionSourceStrings: syntheticSourceStrings,
    routeUnionHash: "a".repeat(64),
    deltaSourceStrings: Object.freeze({}),
    deltaHash: "b".repeat(64),
    ownerByKey: Object.freeze(ownerByKey),
    ownerMapHash: "c".repeat(64),
  });
  const corpus = buildLegacyMarketingSiteComposedCorpus({
    contract,
    deltaCorpusSha256: "d".repeat(64),
    payloads,
  });
  const rows = Object.freeze(
    corpus.payloads.map((payload) =>
      Object.freeze({
        namespace: LEGACY_MARKETING_SITE_NAMESPACE,
        language: payload.language,
        source_hash: contract.marketingSourceHash,
        payload: payload.payloadJson,
        model: corpus.identity.model,
      }),
    ),
  );
  cachedSyntheticMarketingSiteFixture = Object.freeze({
    contract,
    release: Object.freeze({ corpus, rows }),
  });
  return cachedSyntheticMarketingSiteFixture;
}

test("SEO CTA repair seed covers and validates every target language", () => {
  const translations = loadAndValidateTranslationSeed();
  assert.equal(translations.size, 69);
  assert.equal(translations.get("Arabic"), "جرّب الأوضاع العامة");
  assert.equal(translations.get("Danish"), "Prøv de læringsformer, der er åbne for alle");
  assert.equal(
    translations.get("Greek"),
    "Δοκιμάστε τους τρόπους μάθησης που είναι διαθέσιμοι σε όλους",
  );
  assert.equal(translations.get("Gujarati"), "સાર્વજનિક મોડ્સ અજમાવી જુઓ");
  assert.equal(translations.get("Hindi"), "सार्वजनिक मोड आज़माएं");
  assert.equal(translations.get("Malayalam"), "പൊതു മോഡുകൾ പരീക്ഷിക്കുക");
  assert.equal(translations.get("Spanish"), "Prueba los modos públicos");
  assert.equal(
    translations.get("Swahili"),
    "Jaribu njia za kujifunza zinazopatikana kwa wote",
  );
  assert.equal(translations.get("Yoruba"), "Gbìyànjú àwọn ipò tó ṣí sí gbogbo ènìyàn");
  assert.equal(translations.get("Zulu"), "Zama izimodi ezivulekele wonke umuntu");
});

fullTranslationCompletionTest("SEO CTA repair verifies final source hashes and SQL without touching D1", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-seo-cta-verify-"));
  try {
    const report = repairSeoCtaTranslations({
      remote: false,
      confirmed: false,
      backupDir,
    });
    assert.equal(report.ok, true);
    assert.equal(report.mode, "verify");
    assert.equal(report.translationCount, 69);
    assert.equal(report.curatedTranslationRows, 8_556);
    assert.equal(report.curatedRepairLogicalRowWrites, report.curatedRepairStatements);
    assert.ok(report.curatedRepairStatements > report.curatedTranslationRows * 2);
    assert.ok(report.curatedPayloadBytes > 10_000_000);
    assert.ok(report.largestCuratedPayloadBytes > 100_000);
    assert.ok(report.largestCuratedPayloadBytes <= 2_000_000);
    assert.match(report.curatedCorpusSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.marketingSiteTranslationRows, 69);
    assert.equal(
      report.marketingSiteRepairLogicalRowWrites,
      report.marketingSiteRepairStatements,
    );
    assert.ok(report.marketingSiteRepairStatements >= 138);
    assert.ok(report.marketingSitePayloadBytes > 0);
    assert.ok(report.largestMarketingSitePayloadBytes < 2_000_000);
    assert.match(report.marketingSiteComposedCorpusSha256, /^[a-f0-9]{64}$/);
    assert.match(report.marketingSiteDeltaCorpusSha256, /^[a-f0-9]{64}$/);
    assert.match(
      report.marketingSiteModel,
      /^legacy-marketing-site-composed-v1:[a-f0-9]{64}$/,
    );
    assert.ok(report.largestMarketingSiteRepairStatementBytes <= 90_000);
    assert.equal(report.mainAppTranslationRows, 69);
    assert.equal(report.mainAppRepairLogicalRowWrites, report.mainAppRepairStatements);
    assert.ok(report.mainAppRepairStatements > 138);
    assert.ok(report.largestMainAppRepairStatementBytes <= 90_000);
    assert.ok(report.largestMainAppPayloadBytes <= 2_000_000);
    assert.ok(report.largestCuratedRepairStatementBytes > 0);
    assert.ok(report.largestCuratedRepairStatementBytes <= 90_000);
    assert.ok(report.repairSqlBytes > report.curatedPayloadBytes);
    assert.ok(report.repairSqlStatements > report.curatedRepairStatements);
    assert.ok(report.atomicSqlBytes >= report.repairSqlBytes);
    assert.ok(report.atomicSqlStatements >= report.repairSqlStatements);
    assert.ok(report.largestAtomicSqlStatementBytes <= 100_000);
    assert.equal(report.d1FileImportByteLimit, 5_000_000_000);
    assert.ok(report.atomicSqlBytes < report.d1FileImportByteLimit);
    assert.equal(report.executionMode, "single-transaction-wrangler-import");
    assert.deepEqual(report.exactTranslationPartitions, {
      curatedSiteRows: 8_556,
      marketingSiteRows: 69,
      siteRows: 8_625,
      mainAppRows: 69,
      finalRows: 8_694,
    });
    assert.equal(report.projectionBasis, "local-static-proof");
    assert.ok(
      (report.projectedBilledRowWrites ?? Number.POSITIVE_INFINITY) <=
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    );
    assert.ok(
      (report.coldCombinedProjectedBilledRowWrites ?? 0) >
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    );
    assert.equal(report.coldCombinedWriteBudgetAdmissible, false);
    assert.equal(
      report.projectedBilledRowWriteLimit,
      MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    );
    assert.equal(report.manifestNamespacesVerified, 125);
    assert.equal(
      report.sourceHashes["marketing-site"],
      LEGACY_MARKETING_SITE_EXPECTED_SOURCE_HASH,
    );
    assert.equal(report.sourceHashes["route:chat-public"], "f5ef074ab3712ef9b40cb5fcbc794e9b7d42efd2089fc22400aeb280abce8689");
    assert.equal(report.sourceHashes["route:about"], "6aa44ee2349a660b840519a4fc03037976d4e26ee4ceb55d7d94e2959b211a99");
    assert.match(report.repairSqlSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      fs.existsSync(path.join(backupDir, "cloudflare/seo-cta-translation-repair-verify.json")),
      true,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

fullTranslationCompletionTest("SEO repair requires the exact 8,625-pack promoted inventory without synthesizing gaps", () => {
  const identifiers = getExactCuratedPackIdentifiers();
  assert.equal(identifiers.length, 8_625);
  assert.equal(
    identifiers.filter((identifier) => identifier.namespace === "main-app").length,
    69,
  );
  const rows = loadCuratedNamespaceRepairRows();
  assert.equal(rows.length, 8_556);
  assert.equal(rows.filter((row) => row.namespace === "marketing-shell").length, 69);
  assert.equal(rows.filter((row) => row.namespace === "route:home").length, 69);
  assert.equal(rows.filter((row) => row.namespace === "route:mission").length, 69);
  assert.equal(rows.filter((row) => row.namespace === "route:about").length, 69);
  assert.equal(
    rows.find((row) => row.namespace === "marketing-shell" && row.language === "Arabic")?.payload[
      "site.d0d9118568f5027bc1"
    ],
    "اختر اللغة لهذه الزيارة.",
  );

  const plan = buildCuratedNamespaceRepairPlan(rows);
  const sql = buildCuratedNamespaceRepairSql(rows);
  assert.equal(sql, plan.sql);
  assert.equal(plan.rows, 8_556);
  assert.equal(plan.resetStatements, 8_556);
  assert.ok(plan.patchStatements > plan.resetStatements);
  assert.equal(plan.logicalRowWrites, plan.resetStatements + plan.patchStatements);
  assert.match(plan.legacyPrerequisiteSql, /'route:home'/);
  assert.doesNotMatch(plan.legacyPrerequisiteSql, /VALUES\n  \('route:about'/);
  assert.doesNotMatch(plan.postLegacyCanonicalSql, /VALUES\n  \('route:home'/);
  assert.match(plan.postLegacyCanonicalSql, /'route:about'|'route:schools'/);
  assert.equal(sql.match(/^INSERT INTO app_translations$/gm)?.length, 8_556);
  assert.match(sql, /codex-curated-free-static-no-games-v7/);
  assert.match(sql, /'route:mission'/);
  assert.match(sql, /'blog:ai-art-appreciation-guide'/);
  assert.match(sql, /json_patch\(payload, json\(/);
  assert.ok(largestSqlStatementBytes(sql) <= 90_000);
  assert.ok(plan.payloadBytes > 10_000_000);
  assert.match(plan.corpusSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(sql, /DROP TABLE|CREATE TABLE|DELETE FROM/);
  assert.doesNotMatch(sql, /created_at = excluded\.created_at/);
});

test("SEO repair accepts provenance-bound compact packs and rejects tampering or ambiguous shapes", () => {
  const identifier = getExactCuratedPackIdentifiers().find(
    (candidate) =>
      candidate.namespace === "marketing-shell" && candidate.language === "Arabic",
  );
  assert.ok(identifier);
  const source = getSiteTranslationSource("marketing-shell");
  const original = parseCuratedPack(identifier.file);
  const expectedPayload = buildExactCuratedPackPayload(
    original,
    source.sourceStrings,
    identifier,
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-compact-curated-pack-"));
  const compactFile = path.join(directory, "marketing-shell.json");
  const tamperedFile = path.join(directory, "tampered.json");
  const missingProvenanceFile = path.join(directory, "missing-provenance.json");
  const ambiguousFile = path.join(directory, "ambiguous.json");
  const invalidFile = path.join(directory, "invalid.json");
  const staleProfileFile = path.join(directory, "stale-profile.json");

  try {
    const metadata = {
      schemaVersion: 1,
      language: identifier.language,
      locale: original.locale,
      namespace: identifier.namespace,
      sourceHash: source.sourceHash,
    } as const;
    const promotedPack = buildTestPromotedCompactPack(
      metadata,
      expectedPayload,
      source.sourceStrings,
    );
    fs.writeFileSync(
      compactFile,
      `${JSON.stringify(promotedPack, null, 2)}\n`,
      "utf8",
    );
    const compact = parseCuratedPack(compactFile);
    assert.equal(compact.entries, undefined);
    assert.deepEqual(
      buildExactCuratedPackPayload(compact, source.sourceStrings, identifier),
      expectedPayload,
    );

    fs.writeFileSync(
      staleProfileFile,
      `${JSON.stringify(
        buildTestPromotedCompactPack(
          metadata,
          expectedPayload,
          source.sourceStrings,
          "0".repeat(64),
        ),
        null,
        2,
      )}\n`,
      "utf8",
    );
    assert.throws(
      () => parseCuratedPack(staleProfileFile),
      /provenance contract is invalid/,
    );

    fs.writeFileSync(
      missingProvenanceFile,
      `${JSON.stringify({ ...metadata, translations: expectedPayload }, null, 2)}\n`,
      "utf8",
    );
    const missingProvenance = parseCuratedPack(missingProvenanceFile);
    assert.throws(
      () => buildExactCuratedPackPayload(
        missingProvenance,
        source.sourceStrings,
        identifier,
      ),
      /missing immutable provenance/,
    );

    const tamperKey = "site.d0d9118568f5027bc1";
    const originalValue = expectedPayload[tamperKey];
    assert.ok(originalValue);
    fs.writeFileSync(
      tamperedFile,
      `${JSON.stringify({
        ...promotedPack,
        translations: {
          ...expectedPayload,
          [tamperKey]: `${originalValue} الآن`,
        },
      }, null, 2)}\n`,
      "utf8",
    );
    const tampered = parseCuratedPack(tamperedFile);
    assert.throws(
      () => buildExactCuratedPackPayload(tampered, source.sourceStrings, identifier),
      /strict candidate preservation|candidate provenance drifted/,
    );

    fs.writeFileSync(
      ambiguousFile,
      `${JSON.stringify({
        ...metadata,
        entries: [],
        translations: expectedPayload,
      })}\n`,
      "utf8",
    );
    assert.throws(
      () => parseCuratedPack(ambiguousFile),
      /exactly one translation representation/,
    );

    fs.writeFileSync(
      invalidFile,
      `${JSON.stringify({ ...metadata, translations: { invalid: 42 } })}\n`,
      "utf8",
    );
    assert.throws(() => parseCuratedPack(invalidFile), /compact value is invalid/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("entry-form curated packs are restricted to the exact 691-identifier grandfather allowlist", () => {
  const grandfathered = getGrandfatheredEntryCuratedPackIdentifiers();
  assert.equal(grandfathered.length, 691);
  assert.equal(
    new Set(
      grandfathered.map(
        (identifier) => `${identifier.namespace}\u0000${identifier.language}`,
      ),
    ).size,
    691,
  );
  assert.ok(
    grandfathered.every((identifier) =>
      isGrandfatheredEntryCuratedPackIdentifier(identifier),
    ),
  );
  assert.equal(
    grandfathered.filter((identifier) => identifier.namespace === "marketing-shell")
      .length,
    69,
  );
  assert.equal(
    grandfathered.filter((identifier) => identifier.namespace === "route:home")
      .length,
    69,
  );
  assert.equal(
    grandfathered.filter((identifier) => identifier.namespace === "route:mission")
      .length,
    69,
  );
  for (const language of ["Arabic", "Spanish", "Hindi", "Malayalam"] as const) {
    assert.equal(
      grandfathered.filter((identifier) => identifier.language === language).length,
      124,
    );
  }

  const forbiddenEntryIdentifier = getExactCuratedPackIdentifiers().find(
    (identifier) =>
      identifier.namespace === "route:about" && identifier.language === "French",
  );
  assert.ok(forbiddenEntryIdentifier);
  const source = getSiteTranslationSource("route:about");
  assert.throws(
    () =>
      buildExactCuratedPackPayload(
        {
          schemaVersion: 1,
          language: forbiddenEntryIdentifier.language,
          locale: "fr",
          namespace: forbiddenEntryIdentifier.namespace,
          sourceHash: source.sourceHash,
          model: "curated-quality-repair-v3",
          entries: [],
        },
        source.sourceStrings,
        forbiddenEntryIdentifier,
      ),
    /representation downgrade is forbidden|immutable compact provenance is required/,
  );

  const allowedEntryIdentifier = grandfathered.find(
    (identifier) =>
      identifier.namespace === "marketing-shell" && identifier.language === "Arabic",
  );
  assert.ok(allowedEntryIdentifier);
  const allowedSource = getSiteTranslationSource("marketing-shell");
  const allowedPack = parseCuratedPack(allowedEntryIdentifier.file);
  assert.throws(
    () =>
      buildExactCuratedPackPayload(
        { ...allowedPack, model: "unreviewed-entry-model" },
        allowedSource.sourceStrings,
        allowedEntryIdentifier,
      ),
    /model is not explicitly grandfathered/,
  );
});

test("exact curated identifier contract is 124 site namespaces by 69 target languages", () => {
  const identifiers = getExactCuratedPackIdentifiers();
  const siteIdentifiers = identifiers.filter(
    (identifier) => identifier.namespace !== mainAppTranslationNamespace,
  );
  assert.equal(identifiers.length, 8_625);
  assert.equal(siteIdentifiers.length, 8_556);
  assert.equal(
    new Set(siteIdentifiers.map((identifier) => identifier.namespace)).size,
    124,
  );
  assert.equal(
    new Set(siteIdentifiers.map((identifier) => identifier.language)).size,
    69,
  );
  assert.equal(
    identifiers.filter((identifier) => identifier.namespace === mainAppTranslationNamespace)
      .length,
    69,
  );
  assert.equal(
    siteIdentifiers.some((identifier) => identifier.namespace === "marketing-site"),
    false,
  );
});

test("full curated Cartesian identifiers compress below the D1 statement ceiling", () => {
  const targetLanguages = supportedLanguages.filter(
    (language) => language !== defaultLanguage,
  );
  const namespaces = Array.from(
    { length: 124 },
    (_, index) => `synthetic:namespace-${String(index).padStart(3, "0")}`,
  );
  const cartesian = namespaces.flatMap((namespace) =>
    targetLanguages.map((language) => ({ namespace, language })),
  );
  const cte = buildExpectedCuratedCte(cartesian);
  assert.match(cte, /CROSS JOIN expected_curated_languages/);
  assert.ok(Buffer.byteLength(cte, "utf8") < 10_000);
  assert.equal(cte.match(/synthetic:namespace-000/g)?.length, 1);

  const sparse = buildExpectedCuratedCte([
    { namespace: "route:a", language: "Arabic" },
    { namespace: "route:b", language: "Spanish" },
  ]);
  assert.doesNotMatch(sparse, /CROSS JOIN/);
  assert.match(sparse, /\('route:a', 'Arabic'\)/);
  assert.match(sparse, /\('route:b', 'Spanish'\)/);
});

fullTranslationCompletionTest("final pre-import payload revalidation binds the exact curated and main-app corpora", () => {
  const synthetic = buildSyntheticRemoteTranslationExpectations();
  const marketingSite = synthetic.marketingSite;
  const mainAppRows = loadMainAppRepairRows();
  const expectedCuratedCorpusSha256 = testCuratedCorpusSha256(synthetic.curatedRows);
  const expectedMarketingSiteCorpusSha256 =
    marketingSite.corpus.identity.corpusSha256;
  const expectedMainAppRepairSqlSha256 = testSha256(buildMainAppRepairPlan(mainAppRows).sql);
  const evidence = assertTranslationRepairPayloadInputsUnchanged({
    expectedCuratedCorpusSha256,
    expectedMarketingSiteCorpusSha256,
    expectedMainAppRepairSqlSha256,
    loadCuratedRows: () => synthetic.curatedRows,
    loadMarketingSite: () => marketingSite,
    loadMainAppRows: () => mainAppRows,
  });
  assert.equal(evidence.curatedCorpusSha256, expectedCuratedCorpusSha256);
  assert.equal(
    evidence.marketingSiteCorpusSha256,
    expectedMarketingSiteCorpusSha256,
  );
  assert.equal(evidence.mainAppRepairSqlSha256, expectedMainAppRepairSqlSha256);

  const firstCurated = synthetic.curatedRows[0];
  assert.ok(firstCurated);
  const driftedCurated = [
    { ...firstCurated, payload: { synthetic: "changed-after-initial-load" } },
    ...synthetic.curatedRows.slice(1),
  ];
  assert.throws(
    () => assertTranslationRepairPayloadInputsUnchanged({
      expectedCuratedCorpusSha256,
      expectedMarketingSiteCorpusSha256,
      expectedMainAppRepairSqlSha256,
      loadCuratedRows: () => driftedCurated,
      loadMarketingSite: () => marketingSite,
      loadMainAppRows: () => mainAppRows,
    }),
    /Curated translation corpus drifted before its D1 write/,
  );
  assert.throws(
    () => assertTranslationRepairPayloadInputsUnchanged({
      expectedCuratedCorpusSha256,
      expectedMarketingSiteCorpusSha256,
      expectedMainAppRepairSqlSha256,
      loadCuratedRows: () => synthetic.curatedRows,
      loadMarketingSite: () => marketingSite,
      loadMainAppRows: () => [...mainAppRows].reverse(),
    }),
    /Main-app translation corpus drifted before its D1 write/,
  );
});

fullTranslationCompletionTest("large curated route payloads rebuild through sorted sub-90KB JSON patches", () => {
  const rows = loadCuratedNamespaceRepairRows();
  const plan = buildCuratedNamespaceRepairPlan(rows);
  const row = rows.find(
    (candidate) => candidate.namespace === "route:blog" && candidate.language === "Malayalam",
  );
  assert.ok(row);
  assert.ok(Buffer.byteLength(JSON.stringify(row.payload), "utf8") > 100_000);

  const statements = splitSqlStatements(plan.sql);
  const reset = statements.find(
    (statement) =>
      statement.startsWith("INSERT INTO app_translations") &&
      statement.includes(`('route:blog', 'Malayalam', '${row.sourceHash}',`),
  );
  assert.ok(reset);
  assert.match(reset, /ON CONFLICT\(namespace, language\) DO UPDATE SET/);
  assert.doesNotMatch(reset, /created_at = excluded\.created_at/);

  const patches = statements.filter(
    (statement) =>
      statement.includes("json_patch(payload") &&
      statement.includes("WHERE namespace = 'route:blog'") &&
      statement.endsWith("AND language = 'Malayalam';"),
  );
  assert.ok(patches.length >= 2);
  assert.ok(patches.every((statement) => Buffer.byteLength(statement, "utf8") <= 90_000));

  const reconstructed: Record<string, string> = {};
  for (const statement of patches) {
    const prefix = "SET payload = json_patch(payload, json(";
    const start = statement.indexOf(prefix);
    const end = statement.lastIndexOf("))\nWHERE");
    assert.ok(start >= 0 && end > start);
    const literal = statement.slice(start + prefix.length, end);
    assert.ok(literal.startsWith("'") && literal.endsWith("'"));
    const chunk: unknown = JSON.parse(literal.slice(1, -1).replaceAll("''", "'"));
    assert.ok(chunk && typeof chunk === "object" && !Array.isArray(chunk));
    for (const [key, value] of Object.entries(chunk)) {
      assert.equal(typeof value, "string");
      reconstructed[key] = value;
    }
  }
  assert.deepEqual(Object.keys(reconstructed), Object.keys(row.payload).sort());
  assert.equal(JSON.stringify(reconstructed), JSON.stringify(row.payload));
});

test("marketing-site corpus plans and verifies all 69 exact composed rows", () => {
  const { contract, release } = syntheticMarketingSiteRepairFixture();
  const plan = buildMarketingSiteRepairPlan(release, contract);
  assert.equal(release.rows.length, 69);
  assert.equal(plan.rows, 69);
  assert.equal(plan.resetStatements, 69);
  assert.equal(plan.logicalRowWrites, plan.resetStatements + plan.patchStatements);
  assert.ok(plan.patchStatements >= 69);
  assert.ok(plan.payloadBytes > 0);
  assert.ok(plan.largestPayloadBytes > 0 && plan.largestPayloadBytes < 2_000_000);
  assert.ok(plan.largestStatementBytes <= 90_000);
  assert.equal(plan.corpusSha256, release.corpus.identity.corpusSha256);
  assert.equal(plan.deltaCorpusSha256, release.corpus.identity.deltaCorpusSha256);
  assert.equal(plan.model, release.corpus.identity.model);
  assert.match(plan.sql, /marketing-site-cardinality-guard/);
  assert.equal(plan.sql.match(/^INSERT INTO app_translations$/gm)?.length, 69);

  const chunks = buildMarketingSiteRepairVerificationChunks(release, contract);
  assert.equal(
    chunks.reduce((total, chunk) => total + chunk.rows, 0),
    69,
  );
  assert.equal(
    chunks.length,
    marketingSiteRepairVerificationQueryCount(release, contract),
  );
  assert.ok(chunks.every((chunk) => chunk.rows >= 1 && chunk.rows <= 16));
  assert.ok(chunks.every((chunk) => chunk.sqlBytes <= 100_000));
  assert.ok(chunks.every((chunk) => chunk.maxBufferBytes <= 16 * 1024 * 1024));

  const databaseRows = release.rows.map(marketingSiteDatabaseResultRow);
  const verified = verifyMarketingSiteRepairResultRows(
    databaseRows,
    release,
    contract,
  );
  assert.equal(verified.rowsMatched, 69);
  assert.equal(verified.corpusSha256, release.corpus.identity.corpusSha256);
  assert.equal(verified.model, release.corpus.identity.model);
  assert.equal(
    verified.payloadBytesMatched,
    release.rows.reduce(
      (total, row) => total + Buffer.byteLength(row.payload, "utf8"),
      0,
    ),
  );
  const chunked = verifyMarketingSiteRepairResultChunks(
    release,
    (chunk) => chunk.expectedRows.map(marketingSiteDatabaseResultRow),
    contract,
  );
  assert.equal(chunked.rowsMatched, 69);
  assert.equal(chunked.queryCount, chunks.length);

  const first = databaseRows[0];
  assert.ok(first);
  assert.throws(
    () => verifyMarketingSiteRepairResultRows([], release, contract),
    /row cardinality failed: 0\/69/,
  );
  assert.throws(
    () =>
      verifyMarketingSiteRepairResultRows(
        [...databaseRows, first],
        release,
        contract,
      ),
    /row cardinality failed: 70\/69/,
  );
  assert.throws(
    () =>
      verifyMarketingSiteRepairResultRows(
        [{ ...first, source_hash: "stale-source-hash" }, ...databaseRows.slice(1)],
        release,
        contract,
      ),
    /metadata is stale|source hash|database row|differs|identity/i,
  );
  assert.throws(
    () =>
      verifyMarketingSiteRepairResultRows(
        [{ ...first, payload: "{}" }, ...databaseRows.slice(1)],
        release,
        contract,
      ),
    /payload|database row|differs|identity/i,
  );
  assert.throws(
    () =>
      verifyMarketingSiteRepairResultRows(
        [{ ...first, model: "tampered-model" }, ...databaseRows.slice(1)],
        release,
        contract,
      ),
    /metadata is stale|model|database row|differs|identity/i,
  );
});

test("exact D1 translation storage projection contains only 8,556 curated, 69 marketing, and 69 main rows", () => {
  const expected = buildSyntheticTranslationRows();
  const marketingSite = syntheticMarketingSiteRepairFixture();
  const rows = buildExactTranslationStorageRows({
    curatedRows: expected.curatedRows,
    marketingSite: marketingSite.release,
    mainAppRows: expected.mainAppRows,
    marketingContract: marketingSite.contract,
  });
  assert.equal(rows.length, 8_694);
  assert.equal(rows.filter((row) => row.namespace === "marketing-site").length, 69);
  assert.equal(rows.filter((row) => row.namespace === "main-app").length, 69);
  assert.equal(
    rows.filter(
      (row) => row.namespace !== "marketing-site" && row.namespace !== "main-app",
    ).length,
    8_556,
  );
  assert.equal(
    new Set(rows.map((row) => `${row.namespace}\u0000${row.language}`)).size,
    8_694,
  );
  const guardSql = buildExactTranslationPartitionGuardSql();
  assert.match(guardSql, /COUNT\(\*\).*8694/);
  assert.match(guardSql, /namespace = 'marketing-site'\) = 69/);
  assert.match(guardSql, /namespace = 'main-app'\) = 69/);
  assert.match(guardSql, /exact-translation-partition-guard-failed/);
  assert.ok(largestSqlStatementBytes(guardSql) <= 100_000);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      "CREATE TABLE app_translations (" +
        "namespace TEXT NOT NULL, language TEXT NOT NULL, " +
        "PRIMARY KEY(namespace, language))",
    );
    const insert = database.prepare(
      "INSERT INTO app_translations(namespace, language) VALUES (?1, ?2)",
    );
    database.exec("BEGIN");
    for (const row of rows) insert.run(row.namespace, row.language);
    database.exec("COMMIT");
    assert.doesNotThrow(() => database.exec(guardSql));

    insert.run("unexpected:namespace", "English");
    assert.throws(
      () => database.exec(guardSql),
      /malformed JSON|exact-translation-partition-guard-failed/,
    );
    database
      .prepare(
        "DELETE FROM app_translations WHERE namespace = ?1 AND language = ?2",
      )
      .run("unexpected:namespace", "English");
    const missing = rows[0];
    assert.ok(missing);
    database
      .prepare(
        "DELETE FROM app_translations WHERE namespace = ?1 AND language = ?2",
      )
      .run(missing.namespace, missing.language);
    assert.throws(
      () => database.exec(guardSql),
      /malformed JSON|exact-translation-partition-guard-failed/,
    );
  } finally {
    database.close();
  }
});

test("exact 8,694-row storage admission is formula-exact and rejects second-read database or capacity drift", () => {
  const expected = buildSyntheticTranslationRows();
  const marketingSite = syntheticMarketingSiteRepairFixture();
  const translationRows = buildExactTranslationStorageRows({
    curatedRows: expected.curatedRows,
    marketingSite: marketingSite.release,
    mainAppRows: expected.mainAppRows,
    marketingContract: marketingSite.contract,
  });
  const sourceEntries = buildSiteSourceStorageEntries();
  const database = {
    databaseName: D1_DATABASE_NAME,
    databaseUuid: D1_DATABASE_ID,
    databaseSizeBytes: 1_000_000,
    tableCount: 24,
  } as const;
  assert.equal(assertExactProductionD1StorageIdentity(database), database);

  const admission = buildExactD1StorageAdmission({
    database,
    translationRows,
    sourceEntries,
  });
  assert.equal(admission.databaseName, D1_DATABASE_NAME);
  assert.equal(admission.databaseUuid, D1_DATABASE_ID);
  assert.equal(admission.currentTableCount, database.tableCount);
  assert.equal(admission.plannedTranslationRows, 8_694);
  assert.equal(
    admission.plannedSourceRows,
    sourceEntries.length +
      sourceEntries.reduce(
        (count, entry) => count + Object.keys(entry.sourceStrings).length,
        0,
      ),
  );
  assert.equal(
    admission.plannedPersistentBytes,
    admission.plannedTranslationRowBytes +
      admission.plannedTranslationIndexBytes +
      admission.plannedSourceRowAndIndexBytes,
  );
  assert.equal(
    admission.projectedGrowthBytes,
    Math.ceil((admission.plannedPersistentBytes * 3) / 2) +
      admission.fixedImportReserveBytes,
  );
  assert.equal(
    admission.projectedFinalDatabaseBytes,
    database.databaseSizeBytes + admission.projectedGrowthBytes,
  );
  assert.ok(admission.plannedSourceMaximumRowBytes <= 2_000_000);
  assert.equal(admission.admissible, true);

  const secondRead = {
    ...database,
    databaseSizeBytes: database.databaseSizeBytes + 4_096,
  };
  const revalidated = revalidateExactD1StorageAdmission({
    initialDatabase: database,
    currentDatabase: secondRead,
    translationRows,
    sourceEntries,
  });
  assert.equal(revalidated.currentDatabaseBytes, secondRead.databaseSizeBytes);
  assert.equal(
    revalidated.projectedFinalDatabaseBytes,
    secondRead.databaseSizeBytes + revalidated.projectedGrowthBytes,
  );

  assert.throws(
    () =>
      revalidateExactD1StorageAdmission({
        initialDatabase: database,
        currentDatabase: {
          ...secondRead,
          databaseUuid: "11111111-2222-4333-8444-555555555555",
        },
        translationRows,
        sourceEntries,
      }),
    /database identity changed before import/,
  );
  assert.throws(
    () =>
      revalidateExactD1StorageAdmission({
        initialDatabase: database,
        currentDatabase: {
          ...secondRead,
          databaseSizeBytes: admission.admissionCeilingBytes,
        },
        translationRows,
        sourceEntries,
      }),
    /exceeds the Workers Free storage safety ceiling/,
  );
});

test("remote repair orders free-storage admission and exact SQL attestation around the sole D1 import", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
    "utf8",
  );
  const freeze = source.indexOf(
    "deployPinnedWorkerVersion(\n      maintenanceVersionId,",
  );
  const targetValidation = source.indexOf(
    "staticRepairRows = validateRemoteRepairTargets(",
  );
  const remotePlan = source.indexOf(
    "remoteAtomicSql = buildAtomicSeoCtaRepairSql(sourceSync.sql, completeRepairSql);",
  );
  const exactRows = source.indexOf(
    "const exactTranslationStorageRows = buildExactTranslationStorageRows({",
  );
  const sourceEntries = source.indexOf(
    "const exactSourceStorageEntries = buildSiteSourceStorageEntries();",
    exactRows,
  );
  const initialStorageRead = source.indexOf(
    "const initialD1DatabaseStorageInfo = assertExactProductionD1StorageIdentity(",
    sourceEntries,
  );
  const storageAdmission = source.indexOf(
    "d1StorageAdmission = buildExactD1StorageAdmission({",
    initialStorageRead,
  );
  const timeTravel = source.indexOf(
    "timeTravelBookmark = parseD1TimeTravelBookmark(",
  );
  const prewrite = source.indexOf(
    "preWriteEvidencePath = writePreWriteDiagnosticEvidence({",
  );
  const temporaryWrite = source.indexOf(
    "const atomicSqlPath = writeTemporarySqlFile(",
  );
  const initialAttestation = source.indexOf(
    "const initialAtomicSqlAttestation = attestTemporarySqlFile(",
    temporaryWrite,
  );
  const storageRevalidation = source.indexOf(
    "d1StorageAdmission = revalidateExactD1StorageAdmission({",
    initialAttestation,
  );
  const immediateStorageRead = source.indexOf(
    "currentDatabase: readD1DatabaseStorageInfo(runWrangler),",
    storageRevalidation,
  );
  const immediatelyBefore = source.indexOf(
    "const immediatelyBeforeImport = attestTemporarySqlFile(",
    storageRevalidation,
  );
  const importCall = source.indexOf(
    "importOutput = runBoundedMutationWrangler(",
    immediatelyBefore,
  );
  const immediatelyAfter = source.indexOf(
    "immediatelyAfterImport = attestTemporarySqlFile(",
    importCall,
  );
  const exactCleanup = source.indexOf(
    "removeAttestedTemporarySqlFile(\n          immediatelyAfterImport,",
    immediatelyAfter,
  );
  for (const offset of [
    freeze,
    targetValidation,
    remotePlan,
    storageAdmission,
    exactRows,
    sourceEntries,
    initialStorageRead,
    timeTravel,
    prewrite,
    temporaryWrite,
    initialAttestation,
    storageRevalidation,
    immediateStorageRead,
    immediatelyBefore,
    importCall,
    immediatelyAfter,
    exactCleanup,
  ]) {
    assert.ok(offset >= 0);
  }
  assert.ok(freeze < targetValidation);
  assert.ok(targetValidation < remotePlan);
  assert.ok(remotePlan < exactRows && exactRows < sourceEntries);
  assert.ok(sourceEntries < initialStorageRead && initialStorageRead < storageAdmission);
  assert.ok(storageAdmission < timeTravel && timeTravel < prewrite);
  assert.ok(prewrite < temporaryWrite && temporaryWrite < initialAttestation);
  assert.ok(initialAttestation < storageRevalidation);
  assert.ok(
    storageRevalidation < immediateStorageRead &&
      immediateStorageRead < immediatelyBefore,
  );
  assert.ok(immediatelyBefore < importCall && importCall < immediatelyAfter);
  assert.ok(immediatelyAfter < exactCleanup);
  assert.doesNotMatch(
    source.slice(temporaryWrite, source.indexOf("  } catch (error) {", exactCleanup)),
    /fs\.rmSync\(path\.dirname\(atomicSqlPath\)/,
  );
});

fullTranslationCompletionTest("curated repair SQL rejects duplicate, stale, and incomplete UPSERT rows", () => {
  const rows = loadCuratedNamespaceRepairRows();
  const first = rows[0];
  assert.ok(first);

  const duplicateRows = [...rows];
  duplicateRows[1] = first;
  assert.throws(
    () => buildCuratedNamespaceRepairSql(duplicateRows),
    /Duplicate curated translation row/,
  );

  const staleRows = [...rows];
  staleRows[0] = { ...first, sourceHash: "stale" };
  assert.throws(
    () => buildCuratedNamespaceRepairSql(staleRows),
    /Stale curated translation source hash/,
  );

  const omittedKey = Object.keys(first.payload)[0];
  assert.ok(omittedKey);
  const incompleteRows = [...rows];
  incompleteRows[0] = {
    ...first,
    payload: Object.fromEntries(
      Object.entries(first.payload).filter(([key]) => key !== omittedKey),
    ),
  };
  assert.throws(
    () => buildCuratedNamespaceRepairSql(incompleteRows),
    /Incomplete curated translation payload/,
  );
});

fullTranslationCompletionTest("curated post-write verification is byte- and hash-exact for all 8,556 site packs", () => {
  const expectedRows = loadCuratedNamespaceRepairRows();
  const actualRows: Array<Record<string, unknown>> = expectedRows.map((row) => ({
    namespace: row.namespace,
    language: row.language,
    payload: JSON.stringify(row.payload),
    source_hash: row.sourceHash,
    model: "codex-curated-free-static-no-games-v7",
  }));

  const verified = verifyCuratedRepairResultRows(actualRows, expectedRows);
  assert.equal(verified.rowsMatched, 8_556);
  assert.ok(verified.payloadBytesMatched > 10_000_000);
  assert.match(verified.corpusSha256, /^[a-f0-9]{64}$/);
  assert.throws(
    () => verifyCuratedRepairResultRows(actualRows.slice(0, -1), expectedRows),
    /row cardinality failed: 8555\/8556/,
  );

  const missionIndex = expectedRows.findIndex((row) => row.namespace === "route:mission");
  assert.ok(missionIndex >= 0);
  const wrongHash = actualRows.map((row, index) =>
    index === missionIndex ? { ...row, source_hash: "stale" } : row,
  );
  assert.throws(
    () => verifyCuratedRepairResultRows(wrongHash, expectedRows),
    /metadata verification failed for route:mission/,
  );

  const wrongModel = actualRows.map((row, index) =>
    index === missionIndex ? { ...row, model: "unvetted" } : row,
  );
  assert.throws(
    () => verifyCuratedRepairResultRows(wrongModel, expectedRows),
    /metadata verification failed for route:mission/,
  );

  const missionPayload = expectedRows[missionIndex]?.payload;
  assert.ok(missionPayload);
  const payloadKey = Object.keys(missionPayload)[0];
  assert.ok(payloadKey);
  const wrongPayload = actualRows.map((row, index) =>
    index === missionIndex
      ? {
          ...row,
          payload: JSON.stringify({ ...missionPayload, [payloadKey]: "tampered" }),
        }
      : row,
  );
  assert.throws(
    () => verifyCuratedRepairResultRows(wrongPayload, expectedRows),
    /payload byte verification failed for route:mission/,
  );

  const duplicate = [...actualRows];
  duplicate[duplicate.length - 1] = actualRows[0]!;
  assert.throws(
    () => verifyCuratedRepairResultRows(duplicate, expectedRows),
    /unexpected or duplicate namespace\/language/,
  );
});

fullTranslationCompletionTest("curated verification namespace SQL is generated and statement-size bounded", () => {
  const rows = loadCuratedNamespaceRepairRows();
  const sql = buildCuratedRepairVerificationSql(rows);
  assert.equal(splitSqlStatements(sql).length, 1);
  assert.match(sql, /WITH expected_curated_namespaces\(namespace\) AS/);
  assert.match(sql, /CROSS JOIN expected_curated_languages/);
  assert.match(sql, /\('marketing-shell'\)/);
  assert.match(sql, /\('Arabic'\)/);
  assert.match(sql, /\('blog:ai-art-appreciation-guide'\)/);
  assert.match(sql, /\('Spanish'\)/);
  assert.ok(Buffer.byteLength(sql, "utf8") < 100_000);
  assert.match(sql, /route:about|route:media|route:schools/);
});

fullTranslationCompletionTest("curated exact verification is deterministically chunked and digested incrementally", () => {
  const expectedRows = buildSyntheticRemoteTranslationExpectations().curatedRows;
  const chunks = buildCuratedRepairVerificationChunks(expectedRows);
  assert.equal(chunks.length, curatedRepairVerificationQueryCount(expectedRows));
  assert.ok(chunks.length > 1);
  assert.equal(
    chunks.reduce((total, chunk) => total + chunk.rows, 0),
    8_556,
  );
  assert.ok(chunks.every((chunk) => chunk.rows <= 256));
  assert.ok(chunks.every((chunk) => chunk.sqlBytes < 100_000));
  assert.ok(chunks.every((chunk) => chunk.maxBufferBytes <= 16 * 1024 * 1024));

  let reads = 0;
  const verified = verifyCuratedRepairResultChunks(expectedRows, (chunk) => {
    reads += 1;
    return [...chunk.expectedRows]
      .reverse()
      .map((row) => ({
        namespace: row.namespace,
        language: row.language,
        payload: canonicalTestPayloadJson(row.payload),
        source_hash: row.sourceHash,
        model: "codex-curated-free-static-no-games-v7",
      }));
  });
  assert.equal(reads, chunks.length);
  assert.equal(verified.queryCount, chunks.length);
  assert.equal(verified.rowsMatched, 8_556);
  assert.match(verified.corpusSha256, /^[a-f0-9]{64}$/);

  let mismatchReads = 0;
  assert.throws(
    () =>
      verifyCuratedRepairResultChunks(expectedRows, (chunk) => {
        mismatchReads += 1;
        return chunk.expectedRows.map((row, index) => ({
          namespace: row.namespace,
          language: row.language,
          payload:
            chunk.index === 0 && index === 0
              ? "{}"
              : canonicalTestPayloadJson(row.payload),
          source_hash: row.sourceHash,
          model: "codex-curated-free-static-no-games-v7",
        }));
      }),
    /payload byte verification failed/,
  );
  assert.equal(mismatchReads, chunks.length);
});

fullTranslationCompletionTest("main-app exact verification is bounded and reads every deterministic chunk", () => {
  const expectedRows = buildSyntheticRemoteTranslationExpectations().mainAppRows;
  const chunks = buildMainAppRepairVerificationChunks(expectedRows);
  assert.equal(chunks.length, mainAppRepairVerificationQueryCount(expectedRows));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.rows <= 64));
  assert.ok(chunks.every((chunk) => chunk.sqlBytes < 100_000));
  assert.ok(chunks.every((chunk) => chunk.maxBufferBytes <= 16 * 1024 * 1024));

  let reads = 0;
  const verified = verifyMainAppRepairResultChunks(expectedRows, (chunk) => {
    reads += 1;
    return chunk.expectedRows.map((row) => ({
      namespace: row.namespace,
      language: row.language,
      payload: JSON.stringify(row.payload),
      source_hash: row.sourceHash,
      model: "codex-curated-free-static-no-games-main-app-v1",
    }));
  });
  assert.equal(reads, chunks.length);
  assert.equal(verified.rowsMatched, 69);
  assert.equal(verified.queryCount, chunks.length);
});

test("main-app repair upserts and rebuilds all 69 payloads exactly with bounded JSON patches", () => {
  const rows = loadMainAppRepairRows();
  const plan = buildMainAppRepairPlan(rows);
  assert.equal(rows.length, 69);
  assert.equal(plan.rows, 69);
  assert.equal(plan.resetStatements, 69);
  assert.ok(plan.patchStatements > plan.resetStatements);
  assert.equal(plan.logicalRowWrites, plan.resetStatements + plan.patchStatements);
  assert.ok(plan.largestStatementBytes > 0);
  assert.ok(plan.largestStatementBytes <= 90_000);
  assert.equal(
    splitSqlStatements(plan.sql).length,
    1 + plan.resetStatements + plan.patchStatements,
  );
  assert.match(plan.sql, /main_app_cardinality_guard/);
  assert.match(plan.sql, /COUNT\(\*\) <= 69/);
  assert.match(plan.sql, /COALESCE\(SUM\(CASE WHEN language IN/);
  assert.match(plan.sql, /INSERT INTO app_translations/);
  assert.match(plan.sql, /json\('\{\}'\)/);
  assert.match(plan.sql, /ON CONFLICT\(namespace, language\) DO UPDATE SET/);
  assert.match(plan.sql, /json_patch\(payload, json\(/);
  assert.match(plan.sql, /codex-curated-free-static-no-games-main-app-v1/);
  assert.doesNotMatch(plan.sql, /DELETE FROM|DROP TABLE|CREATE TABLE/);
  assert.ok(rows.every((row) => Buffer.byteLength(JSON.stringify(row.payload), "utf8") > 100_000));

  const sqlStatements = splitSqlStatements(plan.sql);
  const resetStatements = sqlStatements.filter((statement) =>
    statement.startsWith("INSERT INTO app_translations"),
  );
  assert.equal(resetStatements.length, rows.length);
  assert.ok(
    rows.every((row) =>
      resetStatements.some((statement) =>
        statement.includes(`('main-app', '${row.language}', '${row.sourceHash}',`),
      ),
    ),
  );
  assert.ok(
    resetStatements.every((statement) =>
      statement.includes("ON CONFLICT(namespace, language) DO UPDATE SET"),
    ),
  );
  assert.ok(resetStatements.every((statement) => !statement.includes("created_at = excluded.created_at")));
  const reconstructedRows: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const languagePredicate = `AND language = '${row.language}';`;
    const patchStatements = sqlStatements.filter(
      (statement) => statement.includes("json_patch(payload") && statement.endsWith(languagePredicate),
    );
    assert.ok(patchStatements.length >= 2);

    const reconstructed: Record<string, string> = {};
    for (const statement of patchStatements) {
      const prefix = "SET payload = json_patch(payload, json(";
      const start = statement.indexOf(prefix);
      const end = statement.lastIndexOf("))\nWHERE");
      assert.ok(start >= 0 && end > start);
      const sqlLiteral = statement.slice(start + prefix.length, end);
      assert.ok(sqlLiteral.startsWith("'") && sqlLiteral.endsWith("'"));
      const chunk: unknown = JSON.parse(sqlLiteral.slice(1, -1).replaceAll("''", "'"));
      assert.equal(typeof chunk, "object");
      assert.ok(chunk && !Array.isArray(chunk));
      for (const [key, value] of Object.entries(chunk)) {
        assert.equal(typeof value, "string");
        reconstructed[key] = value;
      }
    }
    assert.equal(JSON.stringify(reconstructed), JSON.stringify(row.payload));
    reconstructedRows.push({
      namespace: row.namespace,
      language: row.language,
      payload: JSON.stringify(reconstructed),
      source_hash: row.sourceHash,
      model: "codex-curated-free-static-no-games-main-app-v1",
    });
  }
  assert.equal(verifyMainAppRepairResultRows(reconstructedRows, rows), 69);

  const firstActual = reconstructedRows[0];
  const firstExpected = rows[0];
  assert.ok(firstActual);
  assert.ok(firstExpected);
  const reorderedPayload = Object.fromEntries(Object.entries(firstExpected.payload).reverse());
  assert.notEqual(JSON.stringify(reorderedPayload), firstActual.payload);
  const reorderedRows = reconstructedRows.map((row, index) =>
    index === 0
      ? { ...row, payload: JSON.stringify(reorderedPayload) }
      : row,
  );
  assert.throws(
    () =>
      verifyMainAppRepairResultRows(reorderedRows, rows),
    /byte equality/,
  );
});

test("main-app repair rejects duplicate, stale, and incomplete tracked rows", () => {
  const rows = loadMainAppRepairRows();
  const first = rows[0];
  assert.ok(first);

  const duplicateRows = [...rows];
  duplicateRows[1] = first;
  assert.throws(() => buildMainAppRepairPlan(duplicateRows), /Duplicate main-app translation row/);

  const staleRows = [...rows];
  staleRows[0] = { ...first, sourceHash: "stale" };
  assert.throws(() => buildMainAppRepairPlan(staleRows), /Unexpected main-app translation row/);

  const omittedKey = Object.keys(first.payload)[0];
  assert.ok(omittedKey);
  const incompleteRows = [...rows];
  incompleteRows[0] = {
    ...first,
    payload: Object.fromEntries(
      Object.entries(first.payload).filter(([key]) => key !== omittedKey),
    ),
  };
  assert.throws(() => buildMainAppRepairPlan(incompleteRows), /Incomplete main-app translation payload/);

  const sourceStrings = getMainAppSourceStrings();
  const spanishIndex = rows.findIndex((row) => row.language === "Spanish");
  assert.ok(spanishIndex >= 0);
  const hybridEntry = Object.entries(sourceStrings).find(([, sourceText]) => {
    const hybridValue = `Texto ${sourceText}`;
    return (
      isValidFieldTranslation(sourceText, hybridValue, "Spanish") &&
      !isTranslationFieldLikelyFluent(sourceText, hybridValue, "Spanish")
    );
  });
  assert.ok(hybridEntry);
  const [hybridKey, sourceText] = hybridEntry;
  const nonFluentRows = [...rows];
  const spanishRow = nonFluentRows[spanishIndex];
  assert.ok(spanishRow);
  nonFluentRows[spanishIndex] = {
    ...spanishRow,
    payload: { ...spanishRow.payload, [hybridKey]: `Texto ${sourceText}` },
  };
  assert.throws(
    () => buildMainAppRepairPlan(nonFluentRows),
    /Main-app translation payload is not fluent for Spanish/,
  );
});

test("D1 statement sizing parses SQL literals and enforces the 100000-byte limit", () => {
  const statements = splitSqlStatements(
    "SELECT 'literal;value'; -- comment;\nSELECT \"identifier;value\"; /* block;comment */ SELECT [key;value];",
  );
  assert.equal(statements.length, 3);
  assert.match(statements[0] ?? "", /literal;value/);
  assert.match(statements[1] ?? "", /identifier;value/);
  assert.match(statements[2] ?? "", /key;value/);

  const exactLimit = `SELECT '${"x".repeat(99_990)}';`;
  const aboveLimit = `SELECT '${"x".repeat(99_991)}';`;
  assert.equal(Buffer.byteLength(exactLimit, "utf8"), 100_000);
  assert.equal(assertD1SqlStatementSize(exactLimit), 100_000);
  assert.throws(() => assertD1SqlStatementSize(aboveLimit), /100000-byte statement limit/);
  assert.throws(
    () => buildAtomicSeoCtaRepairSql("-- D1 owns rollback\nBEGIN TRANSACTION;", "SELECT 1;"),
    /Wrangler file rollback/,
  );
  assert.throws(() => splitSqlStatements("SELECT 'unterminated;"), /unterminated/);
  assert.equal(assertD1TranslationPayloadSize(2_000_000, "route:test/Spanish"), 2_000_000);
  assert.throws(
    () => assertD1TranslationPayloadSize(2_000_001, "route:test/Spanish"),
    /2000000-byte row limit/,
  );
  assert.throws(
    () => assertD1TranslationPayloadSize(Number.NaN, "route:test/Spanish"),
    /size is invalid/,
  );
});

test("SEO CTA repair verifies every extracted namespace against the generated manifest", () => {
  assert.equal(
    validateSiteSourceManifestFreshness(),
    Object.keys(siteSourceManifest).length,
  );
});

test("remote verification separates exact source freshness from audited payload coverage", () => {
  const sql = buildRemoteRepairVerificationSql(loadAndValidateTranslationSeed());
  assert.match(sql, /WITH expected_sources\(namespace, source_hash\) AS \(VALUES/);
  assert.ok(sql.includes(siteSourceManifest["route:home"].sourceHash));
  assert.match(sql, /AS fresh_source_namespaces/);
  assert.match(sql, /AS observed_translation_rows/);
  assert.match(sql, /AS observed_site_translation_rows/);
  assert.match(sql, /AS observed_curated_site_rows/);
  assert.match(sql, /AS observed_marketing_site_rows/);
  assert.match(sql, /AS observed_main_app_rows/);
  assert.match(sql, /AS observed_fresh_translation_rows/);
  assert.match(sql, /AS unexpected_translation_namespaces/);
  assert.match(sql, /AS unsupported_languages/);
  assert.doesNotMatch(sql, /AS site_rows|AS site_namespaces/);
});

test("legacy SQL only removes retired marketing keys without stamping routes or provenance", () => {
  const legacySql = fs.readFileSync(
    path.resolve("scripts/cloudflare/seo-cta-translation-repair.sql"),
    "utf8",
  );
  const canonicalLegacySql = buildCanonicalLegacyMarketingCleanupSql();
  assert.equal(legacySql, canonicalLegacySql);
  assert.equal(validateRepairSql(legacySql), canonicalLegacySql);
  for (const mutated of [
    `${legacySql}SELECT 1;\n`,
    legacySql.replace("site.97d1bd7fe820bd7b27", "site.unrelated"),
    legacySql.replace("WHERE namespace = 'marketing-site'", "WHERE namespace = 'route:home'"),
    legacySql.replace("  updated_at =", "  model = 'tampered',\n  updated_at ="),
  ]) {
    assert.throws(
      () => validateRepairSql(mutated),
      /byte-match the canonical 10-key allowlist/,
    );
  }
  assert.match(legacySql, /WHERE namespace = 'marketing-site'/);
  assert.doesNotMatch(legacySql, /route:(?:chat-public|about|media|schools)/);
  assert.doesNotMatch(legacySql, /\b(?:source_hash|model)\s*=/i);
  const verificationSql = buildRemoteRepairVerificationSql(
    loadAndValidateTranslationSeed(),
  );
  assert.doesNotMatch(
    verificationSql,
    /mismatches|school_values_matched|complete_rows/,
  );
  for (const key of [
    "site.ee30b035ee17c34450",
    "site.5121f7306ecc75edb5",
    "site.df499d7c6f44a88703",
  ]) {
    assert.ok(verificationSql.includes(key));
  }
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`CREATE TABLE app_translations (
      namespace TEXT NOT NULL,
      language TEXT NOT NULL,
      payload TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (namespace, language)
    )`);
    const insert = database.prepare(
      "INSERT INTO app_translations(namespace, language, payload, source_hash, model, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, 1)",
    );
    const retiredPayload = {
      "site.ee30b035ee17c34450": "retired one",
      "site.5121f7306ecc75edb5": "retired two",
      "site.df499d7c6f44a88703": "retired three",
      retained: "keep me",
    };
    insert.run(
      "marketing-site",
      "Spanish",
      JSON.stringify(retiredPayload),
      "marketing-source-before-delta",
      "marketing-model-before-delta",
    );
    insert.run(
      "route:about",
      "Spanish",
      JSON.stringify(retiredPayload),
      "route-source",
      "codex-curated-free-static-no-games-v7",
    );
    database.exec(legacySql);
    const rows = database.prepare(
      "SELECT namespace, payload, source_hash, model FROM app_translations ORDER BY namespace",
    ).all().map((row) => ({
      namespace: row.namespace,
      payload: row.payload,
      source_hash: row.source_hash,
      model: row.model,
    }));
    assert.deepEqual(rows, [
      {
        namespace: "marketing-site",
        payload: JSON.stringify({ retained: "keep me" }),
        source_hash: "marketing-source-before-delta",
        model: "marketing-model-before-delta",
      },
      {
        namespace: "route:about",
        payload: JSON.stringify(retiredPayload),
        source_hash: "route-source",
        model: "codex-curated-free-static-no-games-v7",
      },
    ]);
  } finally {
    database.close();
  }
});

fullTranslationCompletionTest("verify-only production drift detection is exact, structured, and mutation-free", () => {
  const expected = buildSyntheticRemoteTranslationExpectations();
  const reconciled = buildRemoteTranslationVerificationRunner(expected);
  const report = verifyRemoteTranslationDrift({
    translations: expected.translations,
    curatedRepairRows: expected.curatedRows,
    marketingSite: expected.marketingSite,
    mainAppRepairRows: expected.mainAppRows,
    runner: reconciled.runner,
    now: Date.UTC(2026, 6, 12, 0, 0, 0),
  });

  assert.equal(report.mode, "remote-verify-only");
  assert.equal(report.status, "reconciled");
  assert.equal(report.ok, true);
  assert.equal(report.repairRequired, false);
  assert.deepEqual(report.issues, []);
  assert.equal(report.expected.sourceNamespaces, 125);
  assert.equal(report.expected.curatedRows, 8_556);
  assert.equal(report.expected.marketingSiteRows, 69);
  assert.equal(report.expected.mainAppRows, 69);
  const expectedRemoteQueries =
    curatedRepairVerificationQueryCount(expected.curatedRows) +
    marketingSiteRepairVerificationQueryCount(expected.marketingSite) +
    mainAppRepairVerificationQueryCount(expected.mainAppRows) +
    2;
  assert.equal(report.expected.remoteQueries, expectedRemoteQueries);
  assert.equal(report.sourceSnapshot.status, "reconciled");
  assert.equal(report.sourceSnapshot.reconciliationStatements, 0);
  assert.equal(report.payloadSnapshot.status, "reconciled");
  assert.equal(report.payloadSnapshot.verification?.curatedRowsMatched, 8_556);
  assert.equal(report.payloadSnapshot.verification?.marketingSiteRowsMatched, 69);
  assert.equal(report.payloadSnapshot.verification?.mainAppRowsMatched, 69);
  assert.equal(report.payloadSnapshot.verification?.exactFinalRows, 8_694);
  assert.equal(report.readOnly.remoteQueries, expectedRemoteQueries);
  assert.equal(
    reconciled.curatedMaxBuffers.length,
    curatedRepairVerificationQueryCount(expected.curatedRows),
  );
  assert.ok(
    reconciled.curatedMaxBuffers.every(
      (maxBuffer) => maxBuffer > 0 && maxBuffer <= 16 * 1024 * 1024,
    ),
  );
  assert.equal(
    reconciled.marketingSiteMaxBuffers.length,
    marketingSiteRepairVerificationQueryCount(expected.marketingSite),
  );
  assert.ok(
    reconciled.marketingSiteMaxBuffers.every(
      (maxBuffer) => maxBuffer > 0 && maxBuffer <= 16 * 1024 * 1024,
    ),
  );
  assert.equal(
    reconciled.mainAppMaxBuffers.length,
    mainAppRepairVerificationQueryCount(expected.mainAppRows),
  );
  assert.ok(
    reconciled.mainAppMaxBuffers.every(
      (maxBuffer) => maxBuffer > 0 && maxBuffer <= 16 * 1024 * 1024,
    ),
  );
  assert.ok(report.readOnly.billedRowsRead > 0);
  assert.deepEqual(
    report.readOnly,
    {
      remoteQueries: expectedRemoteQueries,
      billedRowsRead: report.readOnly.billedRowsRead,
      workerUploads: 0,
      workerDeployments: 0,
      maintenanceActivations: 0,
      timeTravelReads: 0,
      sqlImports: 0,
      databaseWrites: 0,
      unresolvedMarkersCreated: 0,
      preWriteEvidenceCreated: 0,
      reportsWritten: 0,
    },
  );
  for (const args of reconciled.calls) {
    const sql = assertReadOnlyRemoteTranslationVerificationArgs(args);
    assert.match(sql, /^(?:SELECT|WITH)/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA)\b/i);
    assert.equal(args.includes("--file"), false);
    assert.equal(args.includes("--yes"), false);
    assert.equal(args.includes("time-travel"), false);
  }

  const drifted = buildRemoteTranslationVerificationRunner(expected, {
    staleSource: true,
    tamperCuratedPayload: true,
    tamperMarketingPayload: true,
  });
  const driftReport = verifyRemoteTranslationDrift({
    translations: expected.translations,
    curatedRepairRows: expected.curatedRows,
    marketingSite: expected.marketingSite,
    mainAppRepairRows: expected.mainAppRows,
    runner: drifted.runner,
  });
  assert.equal(driftReport.status, "repair-required");
  assert.equal(driftReport.ok, false);
  assert.equal(driftReport.repairRequired, true);
  assert.equal(driftReport.sourceSnapshot.status, "repair-required");
  assert.ok(driftReport.sourceSnapshot.reconciliationStatements > 0);
  assert.equal(driftReport.payloadSnapshot.status, "repair-required");
  assert.ok(
    driftReport.issues.some((issue) => issue.code === "exact-source-snapshot-drift"),
  );
  assert.ok(
    driftReport.issues.some((issue) => issue.code === "exact-curated-payload-drift"),
  );
  assert.ok(
    driftReport.issues.some(
      (issue) => issue.code === "exact-marketing-site-payload-drift",
    ),
  );
  assert.equal(driftReport.readOnly.remoteQueries, expectedRemoteQueries);
});

fullTranslationCompletionTest("verify-only repair exits before ledger admission and never alters ledger evidence", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-verify-only-no-ledger-"));
  const ledgerDir = path.join(backupDir, "cloudflare");
  const ledgerPath = path.join(ledgerDir, "d1-release-budget-ledger-2026-07-12.json");
  fs.mkdirSync(ledgerDir);
  fs.writeFileSync(ledgerPath, '{"sentinel":"unchanged"}\n', { mode: 0o600 });
  const ledgerBefore = fs.readFileSync(ledgerPath);
  const expected = buildSyntheticRemoteTranslationExpectations();
  const verification = buildRemoteTranslationVerificationRunner(expected);
  try {
    const report = verifyRemoteTranslationDrift({
      translations: expected.translations,
      curatedRepairRows: expected.curatedRows,
      marketingSite: expected.marketingSite,
      mainAppRepairRows: expected.mainAppRows,
      runner: verification.runner,
      now: Date.UTC(2026, 6, 12, 12, 0, 0),
    });
    assert.equal(report.mode, "remote-verify-only");
    assert.equal(report.ok, true);
    assert.deepEqual(fs.readFileSync(ledgerPath), ledgerBefore);

    const source = fs.readFileSync(
      path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
      "utf8",
    );
    const verifyOnlyExit = source.indexOf("if (options.verifyOnly) {");
    const ledgerAdmission = source.indexOf(
      "let budgetReservation: D1ReleaseBudgetReservationResult = reserveD1ReleaseBudget({",
    );
    assert.ok(verifyOnlyExit >= 0 && verifyOnlyExit < ledgerAdmission);
    const verifyOnlyBranch = source.slice(verifyOnlyExit, ledgerAdmission);
    assert.match(verifyOnlyBranch, /writeTranslationReconciliationPending\(/);
    assert.match(verifyOnlyBranch, /const drift = verifyRemoteTranslationDrift\(/);
    assert.match(verifyOnlyBranch, /writeTranslationReconciliationSuccess\(/);
    assert.match(verifyOnlyBranch, /return drift;/);
    assert.ok(
      verifyOnlyBranch.indexOf("writeTranslationReconciliationPending(") <
        verifyOnlyBranch.indexOf("verifyRemoteTranslationDrift("),
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

fullTranslationCompletionTest("verify-only production drift detection fails closed on malformed or indeterminate reads", () => {
  const expected = buildSyntheticRemoteTranslationExpectations();
  const malformed = buildRemoteTranslationVerificationRunner(expected, {
    malformedSummary: true,
  });
  assert.throws(
    () =>
      verifyRemoteTranslationDrift({
        translations: expected.translations,
        curatedRepairRows: expected.curatedRows,
        marketingSite: expected.marketingSite,
        mainAppRepairRows: expected.mainAppRows,
        runner: malformed.runner,
      }),
    /did not return a deterministic result|billing metadata/,
  );
  assert.equal(malformed.calls.length, 2);

  const transport = buildRemoteTranslationVerificationRunner(expected, {
    failSummaryTransport: true,
  });
  assert.throws(
    () =>
      verifyRemoteTranslationDrift({
        translations: expected.translations,
        curatedRepairRows: expected.curatedRows,
        marketingSite: expected.marketingSite,
        mainAppRepairRows: expected.mainAppRows,
        runner: transport.runner,
      }),
    /did not return a deterministic result/,
  );
  assert.equal(transport.calls.length, 2);

  const finalChunkTransport = buildRemoteTranslationVerificationRunner(expected, {
    failFinalVerificationTransport: true,
  });
  assert.throws(
    () =>
      verifyRemoteTranslationDrift({
        translations: expected.translations,
        curatedRepairRows: expected.curatedRows,
        marketingSite: expected.marketingSite,
        mainAppRepairRows: expected.mainAppRows,
        runner: finalChunkTransport.runner,
      }),
    /did not return a deterministic result/,
  );
  assert.equal(
    finalChunkTransport.calls.length,
    curatedRepairVerificationQueryCount(expected.curatedRows) +
      marketingSiteRepairVerificationQueryCount(expected.marketingSite) +
      mainAppRepairVerificationQueryCount(expected.mainAppRows) +
      2,
  );

  assert.throws(
    () =>
      assertReadOnlyRemoteTranslationVerificationArgs([
        "d1",
        "execute",
        "inspirlearning-prod",
        "--remote",
        "--json",
        "--command",
        "UPDATE app_translations SET payload = '{}';",
      ]),
    /rejected mutating/,
  );
});

test("verify-only CLI contract requires explicit remote production confirmation", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-translation-drift-confirm-"));
  try {
    assert.throws(
      () =>
        repairSeoCtaTranslations({
          remote: false,
          confirmed: true,
          verifyOnly: true,
          backupDir,
        }),
      /requires --remote/,
    );
    assert.throws(
      () =>
        repairSeoCtaTranslations({
          remote: true,
          confirmed: false,
          verifyOnly: true,
          backupDir,
        }),
      /requires --confirm-production/,
    );
    assert.throws(
      () =>
        repairSeoCtaTranslations({
          remote: true,
          confirmed: true,
          verifyOnly: true,
          backupDir,
        }),
      /requires --candidate-version/,
    );
    assert.deepEqual(fs.readdirSync(backupDir), []);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("translation verification CLI phase is explicit and uploaded-inactive only", () => {
  assert.equal(
    assertTranslationReconciliationCliPhase({
      argv: ["--remote", "--verify-only", "--phase", "uploaded-inactive"],
      refinementRequested: false,
      remote: true,
      verifyOnly: true,
    }),
    "uploaded-inactive",
  );
  for (const argv of [
    ["--remote", "--verify-only"],
    ["--remote", "--verify-only", "--phase"],
    ["--remote", "--verify-only", "--phase", "candidate-active"],
    [
      "--remote",
      "--verify-only",
      "--phase",
      "uploaded-inactive",
      "--phase",
      "uploaded-inactive",
    ],
  ]) {
    assert.throws(
      () =>
        assertTranslationReconciliationCliPhase({
          argv,
          refinementRequested: false,
          remote: true,
          verifyOnly: true,
        }),
      /--phase|candidate-active/,
    );
  }
  assert.throws(
    () =>
      assertTranslationReconciliationCliPhase({
        argv: ["--remote", "--phase", "uploaded-inactive"],
        refinementRequested: false,
        remote: true,
        verifyOnly: false,
      }),
    /Only read-only production translation verification/,
  );
  assert.throws(
    () =>
      assertTranslationReconciliationCliPhase({
        argv: ["--phase", "uploaded-inactive"],
        refinementRequested: true,
        remote: false,
        verifyOnly: false,
      }),
    /refinement does not accept --phase/,
  );
});

test("candidate-active translation verification fails at the CLI boundary before corpus or D1 work", () => {
  const backupDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-translation-active-phase-reject-"),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
        "--remote",
        "--verify-only",
        "--confirm-production",
        "--phase",
        "candidate-active",
        "--candidate-version",
        repairCandidateVersionId,
        "--backup",
        backupDir,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /requires --phase uploaded-inactive; candidate-active verification is forbidden/,
    );
    assert.deepEqual(fs.readdirSync(backupDir), []);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("production translation repair validates exact namespace/language identifiers", () => {
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);
  const valid = targetLanguages.map((language) => ({ namespace: "marketing-site", language }));
  assert.equal(validateStaticRepairTargetIdentifiers([], targetLanguages), 0);
  assert.equal(validateStaticRepairTargetIdentifiers(valid, targetLanguages), 69);
  assert.throws(
    () =>
      validateStaticRepairTargetIdentifiers(
        valid.filter(
          (row) => row.language !== "Spanish",
        ),
        targetLanguages,
      ),
    /marketing-site: 68\/69/,
  );
  assert.throws(
    () =>
      validateStaticRepairTargetIdentifiers(
        [...valid, { namespace: "marketing-site", language: "Klingon" }],
        targetLanguages,
      ),
    /Unexpected production translation language/,
  );
  assert.throws(
    () => validateStaticRepairTargetIdentifiers([...valid, valid[0]!], targetLanguages),
    /Duplicate production translation identifier/,
  );
  assert.throws(
    () =>
      validateStaticRepairTargetIdentifiers(
        [...valid, { namespace: "route:about", language: "Spanish" }],
        targetLanguages,
      ),
    /Unexpected production translation namespace/,
  );
});

fullTranslationCompletionTest("curated UPSERT discovery allows missing exact rows but rejects extras and duplicates", () => {
  const expectedRows = loadCuratedNamespaceRepairRows();
  const existing = expectedRows.slice(0, 68).map((row) => ({
    namespace: row.namespace,
    language: row.language,
  }));
  assert.equal(
    validateExistingCuratedTargetIdentifiers(existing, expectedRows),
    68,
  );
  assert.throws(
    () =>
      validateExistingCuratedTargetIdentifiers(
        [...existing, { namespace: "route:about", language: "French" }],
        expectedRows,
      ),
    /Unexpected curated production translation identifier/,
  );
  assert.throws(
    () =>
      validateExistingCuratedTargetIdentifiers(
        [...existing, existing[0]!],
        expectedRows,
      ),
    /Duplicate curated production translation identifier/,
  );
});

test("main-app repair discovery allows missing supported rows but rejects exact-ID violations", () => {
  const expectedRows = loadMainAppRepairRows();
  assert.equal(validateExistingMainAppTargetIdentifiers([], expectedRows), 0);
  const existing = expectedRows.slice(0, 68).map((row) => ({
    namespace: row.namespace,
    language: row.language,
  }));
  assert.equal(
    validateExistingMainAppTargetIdentifiers(existing, expectedRows),
    68,
  );
  assert.equal(
    validateExistingMainAppTargetIdentifiers(
      expectedRows.map((row) => ({ namespace: row.namespace, language: row.language })),
      expectedRows,
    ),
    69,
  );
  assert.throws(
    () =>
      validateExistingMainAppTargetIdentifiers(
        [...existing, { namespace: "main-app", language: "English" }],
        expectedRows,
      ),
    /Unexpected main-app translation identifier/,
  );
  assert.throws(
    () =>
      validateExistingMainAppTargetIdentifiers(
        [...existing, existing[0]!],
        expectedRows,
      ),
    /Duplicate main-app translation identifier/,
  );
});

test("projected repair writes include static, curated, marketing-site, and chunked main-app writes", () => {
  assert.equal(projectRepairBilledRowWrites(1_000, 0, 1_500, 0, 300), 4_604);
  assert.equal(projectRepairBilledRowWrites(1_000, 69, 1_500, 69, 300), 4_880);
  const coldSourcePlan = buildSiteTranslationSourceSyncPlan();
  const minimumCuratedLogicalWrites = 8_556 * 2;
  const minimumMarketingSiteLogicalWrites = 69 * 2;
  const minimumMainAppLogicalWrites = 69 * 2;
  const translationOnlyMinimum = projectRepairBilledRowWrites(
    0,
    69,
    minimumCuratedLogicalWrites,
    minimumMarketingSiteLogicalWrites,
    minimumMainAppLogicalWrites,
  );
  const coldCombinedMinimum = projectRepairBilledRowWrites(
    coldSourcePlan.projectedBilledRowWrites,
    69,
    minimumCuratedLogicalWrites,
    minimumMarketingSiteLogicalWrites,
    minimumMainAppLogicalWrites,
  );
  assert.ok(translationOnlyMinimum <= MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES);
  assert.ok(coldCombinedMinimum > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES);
  assert.throws(
    () => projectRepairBilledRowWrites(0, -1, 1_500, 69, 300),
    /non-negative safe integers/,
  );
  assert.equal(
    assertRepairWriteBudget(MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES),
    MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
  );
  assert.throws(
    () => assertRepairWriteBudget(MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES + 1),
    /Workers Free safety budget/,
  );
  assert.throws(() => assertRepairWriteBudget(Number.NaN), /non-negative safe integer/);

  assert.equal(projectRepairBilledRowReads(10_000, 69, 8_556, 69, 69), 46_180);
  assert.throws(
    () => projectRepairBilledRowReads(0, 0, -1, 69, 0),
    /non-negative safe integers/,
  );
  assert.equal(assertRepairReadBudget(2_500_000), 2_500_000);
  assert.throws(
    () => assertRepairReadBudget(2_500_001),
    /Workers Free safety budget/,
  );
});

test("remote repair budget identities bind candidate, source, and immutable plan hashes", () => {
  const sourceFingerprint = { sha256: "a".repeat(64), fileCount: 42 };
  const input = {
    candidateVersionId: repairCandidateVersionId,
    sourceFingerprint,
    repairSqlSha256: "b".repeat(64),
    sourceSyncSha256: "c".repeat(64),
    curatedCorpusSha256: "d".repeat(64),
    marketingSiteCorpusSha256: "e".repeat(64),
  };
  const planSha256 = translationRepairBudgetPlanSha256(input);
  const operationId = translationRepairBudgetOperationId({
    candidateVersionId: input.candidateVersionId,
    sourceFingerprint,
    planSha256,
  });
  assert.match(planSha256, /^[a-f0-9]{64}$/);
  assert.match(operationId, /^seo-cta-translation-repair:[a-f0-9]{64}$/);
  assert.equal(translationRepairBudgetPlanSha256(input), planSha256);
  assert.equal(
    translationRepairBudgetOperationId({
      candidateVersionId: input.candidateVersionId,
      sourceFingerprint,
      planSha256,
    }),
    operationId,
  );
  const runBoundOperationId = translationRepairBudgetOperationId({
    candidateVersionId: input.candidateVersionId,
    sourceFingerprint,
    planSha256,
    releasePreflightRunId: recoveryReleasePreflightRunId,
  });
  assert.match(runBoundOperationId, /^seo-cta-translation-repair:[a-f0-9]{64}$/);
  assert.notEqual(runBoundOperationId, operationId);
  assert.notEqual(
    translationRepairBudgetOperationId({
      candidateVersionId: input.candidateVersionId,
      sourceFingerprint,
      planSha256,
      releasePreflightRunId:
        "2026-07-12T09-10-50-779Z-f9f19c85-9499-4c0f-a9fb-7e4c0fffe141",
    }),
    runBoundOperationId,
  );
  assert.notEqual(
    translationRepairBudgetPlanSha256({
      ...input,
      repairSqlSha256: "f".repeat(64),
    }),
    planSha256,
  );
  assert.notEqual(
    translationRepairBudgetPlanSha256({
      ...input,
      marketingSiteCorpusSha256: "0".repeat(64),
    }),
    planSha256,
  );
  assert.notEqual(
    translationRepairBudgetOperationId({
      candidateVersionId: "33333333-3333-4333-8333-333333333333",
      sourceFingerprint,
      planSha256,
    }),
    operationId,
  );
  assert.notEqual(
    translationRepairBudgetOperationId({
      candidateVersionId: input.candidateVersionId,
      sourceFingerprint: { ...sourceFingerprint, sha256: "f".repeat(64) },
      planSha256,
    }),
    operationId,
  );
});

test("remote repair retains and revalidates its maximum ledger reservation through D1 verification", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
    "utf8",
  );
  const maximumReservation = source.indexOf(
    "let budgetReservation: D1ReleaseBudgetReservationResult = reserveD1ReleaseBudget({",
  );
  const maximumPhase = source.indexOf('phase: "maximum"', maximumReservation);
  const firstD1Read = source.indexOf("staticRepairRows = validateRemoteRepairTargets(");
  const liveValidation = source.indexOf(
    "budgetReservation = assertD1ReleaseBudgetReservation({",
  );
  const retainedMaximumPhase = source.indexOf('phase: "maximum"', liveValidation);
  const importAttempt = source.indexOf("importAttempted = true;", liveValidation);
  const postImportVerification = source.indexOf(
    "productionVerification = verifyRemoteRepair(",
    importAttempt,
  );
  const reportDisposition = source.indexOf(
    '? "maximum-retained-metered"',
    postImportVerification,
  );
  assert.ok(
    maximumReservation >= 0 &&
      maximumReservation < maximumPhase &&
      maximumPhase < firstD1Read,
  );
  assert.ok(firstD1Read < liveValidation);
  assert.ok(liveValidation < retainedMaximumPhase && retainedMaximumPhase < importAttempt);
  assert.ok(importAttempt < postImportVerification && postImportVerification < reportDisposition);
  assert.equal(
    source.slice(maximumReservation, reportDisposition).includes('phase: "exact"'),
    false,
  );
  const remoteFlow = source.slice(maximumReservation, reportDisposition);
  assert.match(
    remoteFlow,
    /validateRemoteRepairTargets\([\s\S]*?meteredReadOnlyRunner[\s\S]*?planSiteTranslationSourceSync\("remote", meteredReadOnlyRunner\)/,
  );
  assert.match(
    remoteFlow,
    /"--file",[\s\S]*?"--yes",[\s\S]*?"--json",[\s\S]*?parseD1Billing\(importOutput/,
  );
  assert.match(
    remoteFlow,
    /verifyRemoteRepair\([\s\S]*?meteredReadOnlyRunner[\s\S]*?readOnlyCommands: readOnlyBilling\.queries/,
  );
});

test("D1 billing metadata is exact, overflow-safe, and read-only aware", () => {
  const billing = parseD1Billing(
    JSON.stringify([
      { success: true, results: [], meta: { rows_read: 706_246, rows_written: 0 } },
      { success: true, results: [], meta: { rows_read: 12_345, rows_written: 42_532 } },
    ]),
    { label: "test billing", expectedResultSets: 2 },
  );
  assert.deepEqual(billing, { rowsRead: 718_591, rowsWritten: 42_532 });
  assert.deepEqual(
    assertRemoteRepairBillingWithinMaximum({
      readOnlyRowsRead: 706_246,
      importBilling: { rowsRead: 12_345, rowsWritten: 42_532 },
    }),
    { rowsRead: 719_719, rowsWritten: 42_604 },
  );
  assert.throws(
    () =>
      parseD1Billing(
        JSON.stringify([
          { success: true, results: [], meta: { rows_read: 1, rows_written: 1 } },
        ]),
        { label: "read-only test", readOnly: true },
      ),
    /unexpectedly mutating billing metadata/,
  );
  assert.throws(
    () =>
      parseD1Billing(
        JSON.stringify([{ success: false, meta: { rows_read: 1, rows_written: 0 } }]),
        { label: "failed test" },
      ),
    /malformed or unexpectedly mutating billing metadata/,
  );
  assert.throws(
    () =>
      parseD1Billing(
        JSON.stringify([
          {
            success: true,
            results: [],
            meta: { rows_read: Number.MAX_SAFE_INTEGER, rows_written: 0 },
          },
          { success: true, results: [], meta: { rows_read: 1, rows_written: 0 } },
        ]),
        { label: "overflow test" },
      ),
    /accounting overflowed/,
  );
  assert.throws(
    () =>
      assertRemoteRepairBillingWithinMaximum({
        readOnlyRowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
        importBilling: null,
      }),
    /exceeded its retained maximum reservation/,
  );
});

test("main-app editing packs cannot alter the tracked repair corpus", () => {
  assert.equal(isMainAppWorkbenchPackFile("main-app.json"), true);
  assert.equal(isMainAppWorkbenchPackFile("main-app.part-001.json"), true);
  assert.equal(isMainAppWorkbenchPackFile("main-app.part-final.json"), true);
  assert.equal(isMainAppWorkbenchPackFile("main-app.part-001.txt"), false);
  assert.equal(isMainAppWorkbenchPackFile("route__home.json"), false);
});

test("SEO CTA repair refuses an unconfirmed production mutation", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-seo-cta-confirm-"));
  try {
    assert.throws(
      () => repairSeoCtaTranslations({ remote: true, confirmed: false, backupDir }),
      /requires --confirm-production/,
    );
    assert.throws(
      () => repairSeoCtaTranslations({ remote: true, confirmed: true, backupDir }),
      /requires --confirm-native-write-freeze/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("remote repair maintenance uses the native Worker and proves both freeze states", () => {
  const candidateVersion = "11111111-1111-4111-8111-111111111111";
  const freezeArgs = buildNativeMaintenanceUploadArgs(
    "tmp/native-d1-maintenance-worker.mjs",
    "d1-maint-test",
  );
  const releaseArgs = buildPinnedWorkerVersionDeployArgs(candidateVersion, "restore candidate");
  const exclusionSource = fs.readFileSync(
    path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
    "utf8",
  );
  const exclusionAcquireIndex = exclusionSource.indexOf("maintenanceExclusion = acquireProductionValidationExclusion");
  const maintenanceUploadIndex = exclusionSource.indexOf("uploadNativeMaintenanceVersion", exclusionAcquireIndex);
  const exclusionReleaseIndex = exclusionSource.indexOf("releaseProductionValidationExclusion", maintenanceUploadIndex);
  assert.ok(exclusionAcquireIndex >= 0);
  assert.ok(maintenanceUploadIndex > exclusionAcquireIndex);
  assert.ok(exclusionReleaseIndex > maintenanceUploadIndex);
  assert.deepEqual(freezeArgs.slice(0, 3), ["versions", "upload", "tmp/native-d1-maintenance-worker.mjs"]);
  assert.deepEqual(releaseArgs.slice(0, 3), ["versions", "deploy", `${candidateVersion}@100`]);
  assert.ok(freezeArgs.includes("APP_WRITE_FREEZE:1"));
  assert.ok(freezeArgs.includes("--strict"));
  assert.ok(freezeArgs.includes(".open-next/assets"));
  assert.doesNotMatch([...freezeArgs, ...releaseArgs].join(" "), /opennext/i);
  assert.deepEqual(nativeWranglerDeployEnv, { OPEN_NEXT_DEPLOY: "true" });

  assert.equal(
    productionMaintenanceRepairRunId(
      "2026-07-12T09-10-50-778Z-e9f19c85-9499-4c0f-a9fb-7e4c0fffe141",
    ),
    "e9f19c85-9499-4c0f-a9fb-7e4c0fffe141",
  );
  assert.throws(
    () => productionMaintenanceRepairRunId("e9f19c85-9499-4c0f-a9fb-7e4c0fffe141"),
    /exact UTC timestamp followed by a lowercase RFC UUID/,
  );
  assert.throws(
    () =>
      productionMaintenanceRepairRunId(
        "2026-07-12T09-10-50-778Z-E9F19C85-9499-4C0F-A9FB-7E4C0FFFE141",
      ),
    /exact UTC timestamp followed by a lowercase RFC UUID/,
  );
  assert.throws(
    () =>
      productionMaintenanceRepairRunId(
        "2026-02-30T09-10-50-778Z-e9f19c85-9499-4c0f-a9fb-7e4c0fffe141",
      ),
    /run timestamp is malformed/,
  );

  let readbackAttempts = 0;
  assert.equal(
    confirmPinnedWorkerVersion(
      candidateVersion,
      () => {
        readbackAttempts += 1;
        if (readbackAttempts === 1) throw new Error("lost status response");
        return readbackAttempts === 2
          ? "22222222-2222-4222-8222-222222222222"
          : candidateVersion;
      },
      3,
    ),
    candidateVersion,
  );
  assert.equal(readbackAttempts, 3);
  assert.throws(
    () =>
      confirmPinnedWorkerVersion(
        candidateVersion,
        () => "22222222-2222-4222-8222-222222222222",
        3,
      ),
    /not confirmed after 3 readbacks/,
  );

  const baseProbe = {
    healthStatus: 200,
    runtime: "cloudflare-workers",
    openNext: false,
    versionId: "native-version-id",
  };
  const active = validateNativeMaintenanceProbe(
    {
      ...baseProbe,
      delivery: "native-maintenance-worker",
      maintenance: true,
      mutationStatus: 503,
      mutationCode: "write_freeze_active",
    },
    true,
  );
  assert.equal(active.active, true);
  const inactive = validateNativeMaintenanceProbe(
    { ...baseProbe, delivery: "lean-api-worker", maintenance: false, mutationStatus: 400 },
    false,
  );
  assert.equal(inactive.active, false);
  assert.throws(
    () =>
      validateNativeMaintenanceProbe(
        { ...baseProbe, delivery: "lean-api-worker", mutationStatus: 400 },
        true,
      ),
    /probe failed/,
  );
  assert.throws(
    () =>
      validateNativeMaintenanceProbe(
        { ...baseProbe, delivery: "opennext", maintenance: true, mutationStatus: 503, mutationCode: "write_freeze_active" },
        true,
      ),
    /probe failed/,
  );
  const maintenanceSource = nativeD1MaintenanceWorkerSource();
  assert.match(maintenanceSource, /native-d1-maintenance/);
  assert.match(maintenanceSource, /url\.pathname\.startsWith\("\/api\/"\).*maintenanceResponse/);
  assert.match(maintenanceSource, /batch\.retryAll/);
  assert.doesNotMatch(maintenanceSource, /@opennext|\.open-next|next\/server/i);
  const repairSource = fs.readFileSync(
    path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
    "utf8",
  );
  const verificationIndex = repairSource.indexOf("productionVerification = verifyRemoteRepair(");
  const releaseIndex = repairSource.indexOf("deployPinnedWorkerVersion(", verificationIndex);
  assert.ok(verificationIndex >= 0 && releaseIndex > verificationIndex);
  assert.match(
    repairSource.slice(verificationIndex, releaseIndex + 180),
    /if \(recovery\.releaseAllowed && exclusionOwned\)[\s\S]*releasePreflight\.serviceBaselineVersionId/,
  );
  assert.doesNotMatch(
    repairSource,
    /runWrangler\(\s*\[\s*"d1",\s*"time-travel",\s*"restore"/,
  );
});

test("maintenance assets are bound to a deterministic symlink-free manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-repair-assets-"));
  try {
    fs.mkdirSync(path.join(root, "nested"));
    fs.writeFileSync(path.join(root, "index.html"), "home");
    fs.writeFileSync(path.join(root, "nested", "asset.js"), "asset");
    const first = buildRepairArtifactManifest(root);
    const second = buildRepairArtifactManifest(root);
    assert.deepEqual(second, first);
    assert.equal(first.fileCount, 2);
    assert.equal(first.bytes, 9);
    assert.match(first.sha256, /^[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(root, "nested", "asset.js"), "changed");
    assert.notEqual(buildRepairArtifactManifest(root).sha256, first.sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("maintenance upload refuses artifact changes after release preflight", () => {
  const expected = {
    sourceFingerprint: { sha256: "a".repeat(64), fileCount: 2, files: [] },
    workerSourceSha256: "b".repeat(64),
    wranglerConfigSha256: "c".repeat(64),
    assetManifest: {
      root: path.resolve(".open-next/assets"),
      fileCount: 3,
      bytes: 123,
      sha256: "d".repeat(64),
    },
  };
  assert.deepEqual(assertRepairArtifactEvidenceUnchanged(expected, expected), expected);
  assert.throws(
    () =>
      assertRepairArtifactEvidenceUnchanged(expected, {
        ...expected,
        assetManifest: { ...expected.assetManifest, sha256: "e".repeat(64) },
      }),
    /Static Assets manifest/,
  );
  assert.throws(
    () =>
      assertRepairArtifactEvidenceUnchanged(expected, {
        ...expected,
        sourceFingerprint: { ...expected.sourceFingerprint, sha256: "f".repeat(64) },
      }),
    /source fingerprint/,
  );
});

test("Worker deploy evidence is read from one owner-only non-symlink descriptor", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-private-deploy-evidence-"));
  const reportPath = path.join(directory, "worker-deploy-report.json");
  const symlinkPath = path.join(directory, "worker-deploy-report-link.json");
  try {
    fs.writeFileSync(reportPath, '{"ok":true}\n', { mode: 0o600 });
    fs.chmodSync(reportPath, 0o600);
    assert.deepEqual(readPrivateWorkerDeployEvidence(reportPath), { ok: true });
    fs.chmodSync(reportPath, 0o640);
    assert.throws(() => readPrivateWorkerDeployEvidence(reportPath), /mode-0600/);
    fs.chmodSync(reportPath, 0o600);
    fs.symlinkSync(reportPath, symlinkPath);
    assert.throws(() => readPrivateWorkerDeployEvidence(symlinkPath), /mode-0600/);
    fs.rmSync(symlinkPath);
    fs.writeFileSync(reportPath, "", { mode: 0o600 });
    assert.throws(() => readPrivateWorkerDeployEvidence(reportPath), /non-empty/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("remote repair accepts only exact immutable deploy evidence for its candidate", () => {
  const backupDir = path.resolve("/tmp/inspir-worker-deploy-evidence");
  const now = new Date().toISOString();
  const sourceFingerprint = {
    sha256: "a".repeat(64),
    fileCount: 2,
    files: [],
  };
  const assetManifest = {
    root: path.resolve(".open-next/assets"),
    fileCount: 3,
    bytes: 123,
    sha256: "b".repeat(64),
  };
  const currentArtifactEvidence = {
    sourceFingerprint,
    workerSourceSha256: "c".repeat(64),
    wranglerConfigSha256: "d".repeat(64),
    assetManifest,
  };
  const report = {
    createdAt: now,
    backupDir,
    mode: "opennext-deploy",
    ok: true,
    status: 0,
    commandExecuted: true,
    deployPreflightOk: true,
    deployPreflightStatus: 0,
    resourceBudgetOk: true,
    scanBeforeOk: true,
    scanAfterOk: null,
    command: [path.resolve("node_modules/.bin/wrangler"), "deploy", "--config", "wrangler.jsonc"],
    passthroughArgs: [],
    sourceFingerprint,
    sourceFingerprintBefore: sourceFingerprint,
    sourceFingerprintAfter: sourceFingerprint,
    sourceFingerprintStable: true,
    workerSourceSha256: currentArtifactEvidence.workerSourceSha256,
    wranglerConfigSha256: currentArtifactEvidence.wranglerConfigSha256,
    assetManifest,
    artifactEvidenceAfter: {
      sourceFingerprintSha256: sourceFingerprint.sha256,
      workerSourceSha256: currentArtifactEvidence.workerSourceSha256,
      wranglerConfigSha256: currentArtifactEvidence.wranglerConfigSha256,
      assetManifest,
    },
    artifactEvidenceStable: true,
    activeDeployment: {
      workerName: "inspirlearning",
      versionId: repairCandidateVersionId,
      percentage: 100,
      observedVersions: 1,
      readAt: now,
    },
  };

  const evidence = validateWorkerDeployEvidenceForRepair({
    report,
    backupDir,
    candidateVersionId: repairCandidateVersionId,
    currentArtifactEvidence,
  });
  assert.equal(evidence.candidateVersionId, repairCandidateVersionId);
  assert.equal(evidence.sourceFingerprintSha256, sourceFingerprint.sha256);
  assert.deepEqual(evidence.assetManifest, assetManifest);

  assert.throws(
    () =>
      validateWorkerDeployEvidenceForRepair({
        report: { ...report, mode: "opennext-upload" },
        backupDir,
        candidateVersionId: repairCandidateVersionId,
        currentArtifactEvidence,
      }),
    /not an immutable deploy/,
  );
  assert.throws(
    () =>
      validateWorkerDeployEvidenceForRepair({
        report: {
          ...report,
          activeDeployment: {
            ...report.activeDeployment,
            versionId: "33333333-3333-4333-8333-333333333333",
          },
        },
        backupDir,
        candidateVersionId: repairCandidateVersionId,
        currentArtifactEvidence,
      }),
    /version differs/,
  );
  assert.throws(
    () =>
      validateWorkerDeployEvidenceForRepair({
        report: {
          ...report,
          assetManifest: { ...assetManifest, sha256: "e".repeat(64) },
        },
        backupDir,
        candidateVersionId: repairCandidateVersionId,
        currentArtifactEvidence,
      }),
    /Static Assets manifest differs/,
  );
  assert.throws(
    () =>
      validateWorkerDeployEvidenceForRepair({
        report: { ...report, deployPreflightOk: false },
        backupDir,
        candidateVersionId: repairCandidateVersionId,
        currentArtifactEvidence,
      }),
    /safety gates/,
  );
  assert.throws(
    () =>
      validateWorkerDeployEvidenceForRepair({
        report: { ...report, passthroughArgs: ["--dry-run"] },
        backupDir,
        candidateVersionId: repairCandidateVersionId,
        currentArtifactEvidence,
      }),
    /exact immutable OpenNext deploy command/,
  );
});

test("commit followed by a lost Wrangler response releases only after exact verification", () => {
  assert.deepEqual(
    decideImportRecovery({
      importAttempted: true,
      importResponseConfirmed: false,
      verification: "verified",
    }),
    {
      success: true,
      restoreRequired: false,
      releaseAllowed: true,
      responseRecoveredByVerification: true,
    },
  );
  assert.deepEqual(
    decideImportRecovery({
      importAttempted: true,
      importResponseConfirmed: false,
      verification: "mismatch",
    }),
    { success: false, restoreRequired: false, releaseAllowed: false },
  );
  assert.deepEqual(
    decideImportRecovery({
      importAttempted: true,
      importResponseConfirmed: false,
      verification: "indeterminate",
    }),
    { success: false, restoreRequired: false, releaseAllowed: false },
  );
  const repairSource = fs.readFileSync(
    path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
    "utf8",
  );
  assert.ok(
    repairSource.indexOf("importAttempted = true") <
      repairSource.indexOf('"d1",\n            "execute"'),
  );
  assert.match(
    repairSource,
    /importTransportError[\s\S]*productionVerification = verifyRemoteRepair[\s\S]*importVerification = "verified"/,
  );
});

test("Time Travel diagnostic evidence is fsynced at 0600 before import and serializes no restore recipe", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-translation-prewrite-"));
  try {
    const maximumReservation = reserveD1ReleaseBudget({
      backupDir,
      operationId: "translation-prewrite-maximum-test",
      operation: "Remote SEO translation repair",
      candidateVersionId: "11111111-1111-4111-8111-111111111111",
      sourceFingerprint: { sha256: "a".repeat(64), fileCount: 1 },
      phase: "maximum",
      rowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
      rowsWritten: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
      observedUsage: {
        databaseCount: 1,
        queryGroups: 0,
        rowsRead: 0,
        rowsWritten: 0,
        executions: 0,
        windowMinutes: 1,
      },
      now: new Date("2026-07-11T19:00:00.000Z"),
    });
    const evidencePath = writePreWriteDiagnosticEvidence({
      backupDir,
      runId: "2026-07-11T19-00-00-000Z-11111111-1111-4111-8111-111111111111",
      candidateVersionId: "11111111-1111-4111-8111-111111111111",
      maintenanceVersionId: "22222222-2222-4222-8222-222222222222",
      releasePreflightEvidencePath: path.resolve(
        backupDir,
        "cloudflare",
        "release-preflight.json",
      ),
      bookmark: "00000085-0000024c-00004c6d-prewrite",
      atomicSql: "UPDATE app_translations SET updated_at = updated_at;\n",
      activeProbe: {
        active: true,
        healthStatus: 200,
        mutationStatus: 503,
        mutationCode: "write_freeze_active",
        delivery: "native-maintenance-worker",
        runtime: "cloudflare-workers",
        openNext: false,
        maintenance: true,
        versionId: "22222222-2222-4222-8222-222222222222",
      },
      projectedBilledRowReads: 100,
      projectedBilledRowWrites: 10,
      d1ReleaseBudget: maximumReservation,
    });
    const stat = fs.statSync(evidencePath);
    assert.equal(stat.mode & 0o777, 0o600);
    assert.match(path.basename(evidencePath), /d1-translation-repair-prewrite-2026-07-11/);
    const unresolvedMarker = path.join(
      backupDir,
      "cloudflare",
      "d1-translation-repair-unresolved.json",
    );
    assert.equal(fs.statSync(unresolvedMarker).mode & 0o777, 0o600);
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
    assert.equal(evidence.kind, "d1-translation-repair-prewrite-evidence");
    assert.equal(evidence.exportPerformed, false);
    assert.equal(evidence.automaticRestoreAllowed, false);
    assert.equal(evidence.recoveryPreference, "reviewed-forward-correction");
    assert.equal(evidence.destructiveRestoreSupported, false);
    assert.equal(evidence.timeTravelBookmark, "00000085-0000024c-00004c6d-prewrite");
    assert.deepEqual(evidence.d1ReleaseBudget, {
      ledgerPath: maximumReservation.ledgerPath,
      utcDay: "2026-07-11",
      operationId: "translation-prewrite-maximum-test",
      revision: maximumReservation.revision,
      phase: "maximum",
      rowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
      rowsWritten: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    });
    assert.equal(Object.hasOwn(evidence, "restoreCommand"), false);
    assert.equal(Object.hasOwn(evidence, "restoreCommandStdin"), false);
    assert.equal(Object.hasOwn(evidence, "restoreRequiresSeparateApproval"), false);
    const source = fs.readFileSync(
      path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /exportRemoteD1TablesBackup|\"d1\",\s*\"export\"/);
    assert.throws(
      () =>
        writePreWriteDiagnosticEvidence({
          backupDir,
          runId: "2026-07-11T19-01-00-000Z-33333333-3333-4333-8333-333333333333",
          candidateVersionId: "11111111-1111-4111-8111-111111111111",
          maintenanceVersionId: "22222222-2222-4222-8222-222222222222",
          releasePreflightEvidencePath: path.resolve(
            backupDir,
            "cloudflare",
            "release-preflight-2.json",
          ),
          bookmark: "00000085-0000024c-00004c6d-second",
          atomicSql: "UPDATE app_translations SET updated_at = updated_at;\n",
          activeProbe: {
            active: true,
            healthStatus: 200,
            mutationStatus: 503,
            mutationCode: "write_freeze_active",
            delivery: "native-maintenance-worker",
            runtime: "cloudflare-workers",
            openNext: false,
            maintenance: true,
            versionId: "22222222-2222-4222-8222-222222222222",
          },
          projectedBilledRowReads: 100,
          projectedBilledRowWrites: 10,
        }),
      /unresolved D1 translation repair already exists/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("site translation source sync plans only changed rows without rebuilding tables", () => {
  const desired = [
    [
      "alpha",
      { sourceHash: "alpha-new", sourceStrings: { keep: "new", added: "added" } },
    ],
    ["beta", { sourceHash: "beta", sourceStrings: { first: "value" } }],
  ] satisfies Parameters<typeof buildSiteTranslationSourceSyncPlan>[0];
  const current = {
    sources: { alpha: "alpha-old", obsolete: "obsolete" },
    sourceStrings: {
      alpha: { keep: "old", removed: "remove me" },
      obsolete: { old: "value" },
    },
  };

  const plan = buildSiteTranslationSourceSyncPlan(desired, current, 123);
  assert.equal(plan.statements, 7);
  assert.equal(plan.logicalRowWrites, 8);
  assert.equal(plan.projectedBilledRowWrites, 16);
  assert.doesNotMatch(plan.sql, /DROP TABLE|CREATE TABLE/);
  assert.match(plan.sql, /ON CONFLICT\(namespace\) DO UPDATE/);
  assert.match(plan.sql, /ON CONFLICT\(namespace, source_key\) DO UPDATE/);
  assert.match(
    plan.sql,
    /DELETE FROM app_translation_source_strings WHERE namespace = 'alpha' AND source_key = 'removed';/,
  );
  assert.match(plan.sql, /DELETE FROM app_translation_sources WHERE namespace = 'obsolete';/);

  const currentAfter = {
    sources: { alpha: "alpha-new", beta: "beta" },
    sourceStrings: {
      alpha: { keep: "new", added: "added" },
      beta: { first: "value" },
    },
  };
  const noOp = buildSiteTranslationSourceSyncPlan(desired, currentAfter, 456);
  assert.equal(noOp.statements, 0);
  assert.equal(noOp.logicalRowWrites, 0);
  assert.equal(noOp.projectedBilledRowWrites, 0);
  assert.equal(noOp.sql, "");
});

test("site translation source sync fails closed above its Workers Free write budget", () => {
  const plan = buildSiteTranslationSourceSyncPlan([]);
  assert.throws(
    () =>
      assertSourceSyncWriteBudget({
        ...plan,
        projectedBilledRowWrites: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES + 1,
      }),
    /Workers Free safety budget/,
  );
});

test("a cold source-manifest sync fits the reserved Workers Free write budget", () => {
  const plan = buildSiteTranslationSourceSyncPlan();
  assert.ok(plan.rows > 0);
  assert.ok(plan.sourceStringCount > 0);
  assert.equal(plan.statements, plan.rows + plan.sourceStringCount);
  assert.equal(plan.logicalRowWrites, plan.statements);
  assert.equal(plan.projectedBilledRowWrites, plan.logicalRowWrites * 2);
  assert.ok(plan.projectedBilledRowWrites < MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES);
  assert.ok(assertD1SqlStatementSize(plan.sql) < 100_000);
  assert.doesNotMatch(plan.sql, /DROP TABLE|CREATE TABLE/);
});

test("standalone remote source synchronization requires explicit production confirmation", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-source-sync-confirm-"));
  try {
    assert.throws(
      () => syncSiteTranslationSources("remote", backupDir),
      /requires --confirm-production/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("source synchronization fails closed on partial or malformed D1 snapshots", () => {
  const good = JSON.stringify([
    { success: true, results: [{ namespace: "marketing-site", source_hash: "hash" }] },
    {
      success: true,
      results: [{ namespace: "marketing-site", source_key: "site.key", source_text: "Source" }],
    },
    { success: true, results: [{ translation_rows: 69 }] },
  ]);
  assert.equal(parseD1SourceSnapshotResultSets(good).length, 3);

  for (const invalid of [
    JSON.stringify([{ success: true, results: [] }]),
    JSON.stringify([
      { success: true, results: [] },
      { success: false, results: [] },
      { success: true, results: [] },
    ]),
    JSON.stringify([
      { success: true, results: [] },
      { success: true },
      { success: true, results: [] },
    ]),
    JSON.stringify([
      { success: true, results: [] },
      { success: true, results: [null] },
      { success: true, results: [] },
    ]),
  ]) {
    assert.throws(
      () => parseD1SourceSnapshotResultSets(invalid),
      /expected 3|unsuccessful|no row array|malformed/,
    );
  }
});

test("release source snapshots require exactly one billed D1 attempt", () => {
  const output = (totalAttempts: number | null, rowsWritten = 0) =>
    JSON.stringify(
      Array.from({ length: 3 }, () => ({
        success: true,
        results: [],
        meta: {
          rows_read: 1,
          rows_written: rowsWritten,
          ...(totalAttempts === null
            ? {}
            : { total_attempts: totalAttempts }),
        },
      })),
    );
  assert.equal(
    parseD1SourceSnapshotBilledRowReads(output(1), {
      required: true,
      readOnly: true,
      requireSingleAttempt: true,
    }),
    3,
  );
  for (const attempts of [null, 2] as const) {
    assert.throws(
      () =>
        parseD1SourceSnapshotBilledRowReads(output(attempts), {
          required: true,
          readOnly: true,
          requireSingleAttempt: true,
        }),
      /exactly one billed attempt/,
    );
  }
  assert.throws(
    () =>
      parseD1SourceSnapshotBilledRowReads(
        output(1, 1),
        { required: true, readOnly: true, requireSingleAttempt: true },
      ),
    /zero billed writes/,
  );
});

test("SEO source synchronization and payload repair compose into one SQL file", () => {
  const sql = buildAtomicSeoCtaRepairSql(
    "PRAGMA foreign_keys = ON;\nSELECT 1;",
    "UPDATE example SET value = 1;",
  );
  assert.equal(
    sql,
    "PRAGMA foreign_keys = ON;\nSELECT 1;\nUPDATE example SET value = 1;\n",
  );
  assert.throws(() => buildAtomicSeoCtaRepairSql("", ""), /must not be empty/);
});

function buildSyntheticTranslationRows() {
  const translations = new Map(
    supportedLanguages
      .filter((language) => language !== defaultLanguage)
      .map((language) => [language, `verified-${language}`] as const),
  );
  const curatedRows: CuratedNamespaceRepairRow[] = getExactCuratedPackIdentifiers()
    .filter((identifier) => identifier.namespace !== mainAppTranslationNamespace)
    .map((identifier) => {
      if (!isTestPublishedNamespace(identifier.namespace)) {
        throw new Error(`Synthetic curated namespace is not published: ${identifier.namespace}.`);
      }
      const source = getSiteTranslationSource(identifier.namespace);
      return {
        namespace: identifier.namespace,
        language: identifier.language,
        sourceHash: source.sourceHash,
        payload: { synthetic: `verified-${identifier.namespace}-${identifier.language}` },
      };
    });
  const mainAppSource = getMainAppSourceStrings();
  const mainAppSourceHash = getMainAppSourceHash(mainAppSource);
  const mainAppRows: MainAppRepairRow[] = supportedLanguages
    .filter((language) => language !== defaultLanguage)
    .map((language) => ({
      namespace: mainAppTranslationNamespace,
      language,
      sourceHash: mainAppSourceHash,
      payload: { synthetic: `verified-main-app-${language}` },
    }));
  return { translations, curatedRows, mainAppRows };
}

function buildSyntheticRemoteTranslationExpectations() {
  return {
    ...buildSyntheticTranslationRows(),
    marketingSite: releasedMarketingSiteRepairCorpus(),
  };
}

function marketingSiteDatabaseResultRow(
  row: MarketingSiteRepairCorpus["rows"][number],
): Record<string, unknown> {
  return {
    namespace: row.namespace,
    language: row.language,
    source_hash: row.source_hash,
    payload: row.payload,
    model: row.model,
  };
}

function buildRemoteTranslationVerificationRunner(
  expected: ReturnType<typeof buildSyntheticRemoteTranslationExpectations>,
  options: {
    staleSource?: boolean;
    tamperCuratedPayload?: boolean;
    tamperMarketingPayload?: boolean;
    malformedSummary?: boolean;
    failSummaryTransport?: boolean;
    failFinalVerificationTransport?: boolean;
  } = {},
) {
  const calls: string[][] = [];
  const curatedMaxBuffers: number[] = [];
  const marketingSiteMaxBuffers: number[] = [];
  const mainAppMaxBuffers: number[] = [];
  const sourceRows: Array<{ namespace: string; source_hash: string }> = Object.entries(
    siteSourceManifest,
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, source]) => ({ namespace, source_hash: source.sourceHash }));
  if (options.staleSource && sourceRows[0]) {
    sourceRows[0] = { ...sourceRows[0], source_hash: "stale-source-hash" };
  }
  const sourceStringRows = Object.entries(siteSourceManifest)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([namespace, source]) =>
      Object.entries(source.sourceStrings)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sourceKey, sourceText]) => ({
          namespace,
          source_key: sourceKey,
          source_text: sourceText,
        })),
    );
  const sourceSnapshot = d1TestResultSets([
    sourceRows,
    sourceStringRows,
    [
      {
        namespace: mainAppTranslationNamespace,
        source_hash: expected.mainAppRows[0]?.sourceHash ?? "missing",
        translation_rows:
          expected.curatedRows.length +
          expected.marketingSite.rows.length +
          expected.mainAppRows.length,
      },
    ],
  ]);
  const expectedSourceNamespaces = Object.keys(siteSourceManifest).length;
  const summary = d1TestResultSets([
    [
      {
        expected_source_namespaces: expectedSourceNamespaces,
        source_namespaces: expectedSourceNamespaces,
        fresh_source_namespaces: expectedSourceNamespaces,
        total_source_namespaces: expectedSourceNamespaces,
        unexpected_source_namespaces: 0,
      },
    ],
    [
      {
        observed_translation_rows:
          expected.curatedRows.length +
          expected.marketingSite.rows.length +
          expected.mainAppRows.length,
        observed_site_translation_rows:
          expected.curatedRows.length + expected.marketingSite.rows.length,
        observed_curated_site_rows: expected.curatedRows.length,
        observed_marketing_site_rows: expected.marketingSite.rows.length,
        observed_main_app_rows: expected.mainAppRows.length,
        observed_fresh_translation_rows:
          expected.curatedRows.length + expected.marketingSite.rows.length,
        unexpected_translation_namespaces: 0,
        unsupported_languages: 0,
      },
    ],
    [{ retired_game_payloads: 0 }],
  ]);
  const curatedResponses = new Map(
    buildCuratedRepairVerificationChunks(expected.curatedRows).map((chunk) => [
      chunk.sql,
      d1TestResultSets([
        chunk.expectedRows.map((row, index) => ({
          namespace: row.namespace,
          language: row.language,
          payload:
            options.tamperCuratedPayload && chunk.index === 0 && index === 0
              ? "{}"
              : canonicalTestPayloadJson(row.payload),
          source_hash: row.sourceHash,
          model: "codex-curated-free-static-no-games-v7",
        })),
      ]),
    ]),
  );
  const marketingSiteResponses = new Map(
    buildMarketingSiteRepairVerificationChunks(expected.marketingSite).map(
      (chunk) => [
        chunk.sql,
        d1TestResultSets([
          chunk.expectedRows.map((row, index) => ({
            ...marketingSiteDatabaseResultRow(row),
            payload:
              options.tamperMarketingPayload && chunk.index === 0 && index === 0
                ? "{}"
                : row.payload,
          })),
        ]),
      ],
    ),
  );
  const mainAppResponses = new Map(
    buildMainAppRepairVerificationChunks(expected.mainAppRows).map((chunk) => [
      chunk.sql,
      d1TestResultSets([
        chunk.expectedRows.map((row) => ({
          namespace: row.namespace,
          language: row.language,
          payload: JSON.stringify(row.payload),
          source_hash: row.sourceHash,
          model: "codex-curated-free-static-no-games-main-app-v1",
        })),
      ]),
    ]),
  );
  const finalMainAppVerificationSql = [...mainAppResponses.keys()].at(-1);

  const runner: WranglerRunner = (args, runnerOptions = {}) => {
    calls.push([...args]);
    const commandIndex = args.indexOf("--command");
    const sql = commandIndex >= 0 ? args[commandIndex + 1] : undefined;
    if (!sql) throw new Error("Synthetic verification runner received no SQL command.");
    if (sql.includes("SELECT namespace, source_hash FROM app_translation_sources")) {
      return sourceSnapshot;
    }
    if (sql.includes("expected_source_namespaces")) {
      if (options.failSummaryTransport) throw new Error("synthetic transport loss");
      if (options.malformedSummary) {
        return JSON.stringify([{ success: false, results: [] }]);
      }
      return summary;
    }
    const curatedResponse = curatedResponses.get(sql);
    if (curatedResponse) {
      if (typeof runnerOptions.maxBuffer !== "number") {
        throw new Error("Synthetic curated verification received no maxBuffer.");
      }
      curatedMaxBuffers.push(runnerOptions.maxBuffer);
      return curatedResponse;
    }
    const marketingSiteResponse = marketingSiteResponses.get(sql);
    if (marketingSiteResponse) {
      if (typeof runnerOptions.maxBuffer !== "number") {
        throw new Error("Synthetic marketing-site verification received no maxBuffer.");
      }
      marketingSiteMaxBuffers.push(runnerOptions.maxBuffer);
      return marketingSiteResponse;
    }
    const mainAppResponse = mainAppResponses.get(sql);
    if (mainAppResponse) {
      if (
        options.failFinalVerificationTransport &&
        sql === finalMainAppVerificationSql
      ) {
        throw new Error("synthetic final verification transport loss");
      }
      if (typeof runnerOptions.maxBuffer !== "number") {
        throw new Error("Synthetic main-app verification received no maxBuffer.");
      }
      mainAppMaxBuffers.push(runnerOptions.maxBuffer);
      return mainAppResponse;
    }
    throw new Error(`Synthetic verification runner received an unexpected query: ${sql.slice(0, 80)}.`);
  };
  return {
    runner,
    calls,
    curatedMaxBuffers,
    marketingSiteMaxBuffers,
    mainAppMaxBuffers,
  };
}

function d1TestResultSets(resultSets: readonly (readonly Record<string, unknown>[])[]) {
  return JSON.stringify(
    resultSets.map((results) => ({
      success: true,
      results,
      meta: { rows_read: results.length, rows_written: 0 },
    })),
  );
}

function canonicalTestPayloadJson(payload: Readonly<Record<string, string>>) {
  return JSON.stringify(
    Object.fromEntries(Object.keys(payload).sort().map((key) => [key, payload[key]])),
  );
}

function testCuratedCorpusSha256(rows: readonly CuratedNamespaceRepairRow[]) {
  const digest = crypto.createHash("sha256");
  const sortedRows = [...rows].sort(
    (left, right) =>
      left.namespace.localeCompare(right.namespace) ||
      left.language.localeCompare(right.language),
  );
  for (const [index, row] of sortedRows.entries()) {
    if (index > 0) digest.update("\n");
    digest.update(
      JSON.stringify([
        row.namespace,
        row.language,
        row.sourceHash,
        canonicalTestPayloadJson(row.payload),
      ]),
      "utf8",
    );
  }
  return digest.digest("hex");
}

function buildTestPromotedCompactPack(
  metadata: Readonly<{
    schemaVersion: 1;
    language: SupportedLanguage;
    locale: string;
    namespace: string;
    sourceHash: string;
  }>,
  translations: Readonly<Record<string, string>>,
  sourceStrings: Readonly<Record<string, string>>,
  executionProfileSha256 = LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
) {
  const sourceEntries = Object.keys(sourceStrings)
    .sort()
    .map((key) => {
      const source = sourceStrings[key];
      if (source === undefined) throw new Error(`Missing test source ${key}.`);
      const protectedText = protectLongTailSourceText(source);
      return {
        key,
        source,
        sourceSha256: testSha256(source),
        invariantSha256: protectedText.invariantSha256,
        segments: protectedText.segments,
      };
    });
  const sourceEntriesSha256 = testCanonicalSha256(sourceEntries);
  const model = "nllb-test-model";
  const immutableHashes = {
    masterWorklistSha256: "1".repeat(64),
    packWorklistSha256: "2".repeat(64),
    jobSha256: "3".repeat(64),
    modelSha256: "4".repeat(64),
    pipelineImplementationSha256: "5".repeat(64),
    workerImplementationSha256: "6".repeat(64),
    protectorSha256: "7".repeat(64),
    validatorPolicySha256: "8".repeat(64),
  } as const;
  const candidate = {
    schemaVersion: 1,
    kind: "inspir-long-tail-translation-candidate-v1",
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfileSha256,
    masterWorklistSha256: immutableHashes.masterWorklistSha256,
    packWorklistSha256: immutableHashes.packWorklistSha256,
    jobSha256: immutableHashes.jobSha256,
    language: metadata.language,
    locale: metadata.locale,
    namespace: metadata.namespace,
    sourceHash: metadata.sourceHash,
    sourceEntriesSha256,
    modelLabel: model,
    modelSha256: immutableHashes.modelSha256,
    workerImplementationSha256: immutableHashes.workerImplementationSha256,
    validatorPolicySha256: immutableHashes.validatorPolicySha256,
    entries: sourceEntries.map((entry) => {
      const value = translations[entry.key];
      if (value === undefined) throw new Error(`Missing test translation ${entry.key}.`);
      return {
        key: entry.key,
        source: entry.source,
        sourceSha256: entry.sourceSha256,
        value,
      };
    }),
  } as const;
  const provenanceMaterial = {
    kind: "inspir-long-tail-curated-provenance-v1",
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfileSha256,
    protectorVersion: "inspir-long-tail-literal-protector-v1",
    protectorSha256: immutableHashes.protectorSha256,
    masterWorklistSha256: immutableHashes.masterWorklistSha256,
    packWorklistSha256: immutableHashes.packWorklistSha256,
    jobSha256: immutableHashes.jobSha256,
    sourceEntriesSha256,
    modelSha256: immutableHashes.modelSha256,
    pipelineImplementationSha256: immutableHashes.pipelineImplementationSha256,
    workerImplementationSha256: immutableHashes.workerImplementationSha256,
    validatorPolicySha256: immutableHashes.validatorPolicySha256,
    candidateSha256: testCanonicalSha256(candidate),
  } as const;
  return {
    ...metadata,
    model,
    provenance: {
      ...provenanceMaterial,
      provenanceSha256: testCanonicalSha256(provenanceMaterial),
    },
    translations,
  } as const;
}

function testCanonicalSha256(value: unknown) {
  return testSha256(testCanonicalJson(value));
}

function testSha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function testCanonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Test canonical JSON encoding failed.");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(testCanonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${testCanonicalJson(Reflect.get(value, key))}`)
      .join(",")}}`;
  }
  throw new Error(`Test canonical JSON cannot encode ${typeof value}.`);
}

function isTestPublishedNamespace(
  value: string,
): value is keyof typeof siteSourceManifest {
  return Object.prototype.hasOwnProperty.call(siteSourceManifest, value);
}

const recoveryReleasePreflightRunId =
  "2026-07-12T09-10-50-778Z-e9f19c85-9499-4c0f-a9fb-7e4c0fffe141";
const recoveryReleasePreflightCreatedAt = "2026-07-12T09:10:50.778Z";
const recoveryReservationCreatedAt = "2026-07-12T09:10:50.783Z";
const recoveryClock = new Date("2026-07-12T09:11:00.000Z");
const recoveryCandidateVersionId = "42986870-cd08-4a64-9276-8495400783dd";
const recoveryServiceBaselineVersionId = "52986870-cd08-4a64-9276-8495400783dd";
const recoveryDriftBilledRowsRead = 36_502;
const recoveryDailyUsage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 0,
  rowsWritten: 0,
  executions: 0,
  windowMinutes: 552,
};
fullTranslationCompletionTest("prewrite-abort recovery retains exact D1 verification and lock charges", () => {
  const fixture = createPrewriteAbortRecoveryFixture();
  let sourceAssertions = 0;
  let activeReads = 0;
  let candidateProbes = 0;
  let driftReads = 0;
  try {
    const report = refineAbortedPrewriteTranslationRepairReservation({
      backupDir: fixture.backupDir,
      releasePreflightRunId: fixture.runId,
      confirmed: true,
      prewriteAbortConfirmed: true,
      dailyUsage: recoveryDailyUsage,
      now: recoveryClock,
      lockRunner: fixture.runner,
      assertRecoverySource: () => {
        sourceAssertions += 1;
      },
      buildRecoveryPlan: fixture.buildRecoveryPlan,
      readActiveWorkerVersion: () => {
        activeReads += 1;
        return fixture.serviceBaselineVersionId;
      },
      probeCandidate: (candidateVersionId) => {
        candidateProbes += 1;
        return inactiveRecoveryCandidateProbe(candidateVersionId);
      },
      verifyDrift: () => {
        driftReads += 1;
        return recoveryRepairRequiredDriftReport();
      },
    });

    const expectedRowsRead =
      recoveryDriftBilledRowsRead + PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ;
    assert.equal(report.status, "complete");
    assert.equal(report.proof.driftBilledRowsRead, recoveryDriftBilledRowsRead);
    assert.equal(report.proof.validationLockRowsReadReserved, 1_024);
    assert.equal(report.proof.validationLockRowsWrittenReserved, 64);
    assert.equal(report.ledger.exactRowsRead, expectedRowsRead);
    assert.equal(
      report.ledger.exactRowsWritten,
      PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN,
    );
    assert.equal(sourceAssertions, 1);
    assert.equal(activeReads, 2);
    assert.equal(candidateProbes, 2);
    assert.equal(driftReads, 1);

    const ledger = readD1ReleaseBudgetLedger(fixture.ledgerPath);
    const reservation = ledger.reservations.find(
      (entry) => entry.operationId === fixture.operationId,
    );
    assert.ok(reservation);
    assert.equal(reservation.phase, "exact");
    assert.equal(reservation.rowsRead, expectedRowsRead);
    assert.equal(reservation.rowsWritten, 64);
    assert.equal(readRecoveryMetadataValue(fixture.database, PRODUCTION_VALIDATION_LOCK_KEY), null);
    const evidence = readTestJsonRecord(fixture.refinementEvidencePath);
    assert.equal(evidence.status, "complete");
    assert.equal(fs.statSync(fixture.refinementEvidencePath).mode & 0o777, 0o600);
  } finally {
    fixture.close();
  }
});

test("prewrite-abort recovery requires both explicit confirmations before any proof work", () => {
  const fixture = createPrewriteAbortRecoveryFixture();
  let runnerCalls = 0;
  const countingRunner: ProductionValidationLockRunner = (args) => {
    runnerCalls += 1;
    return fixture.runner(args);
  };
  const common = {
    backupDir: fixture.backupDir,
    releasePreflightRunId: fixture.runId,
    dailyUsage: recoveryDailyUsage,
    now: recoveryClock,
    lockRunner: countingRunner,
    assertRecoverySource: () => {
      throw new Error("confirmation gate leaked into source proof");
    },
    buildRecoveryPlan: fixture.buildRecoveryPlan,
    readActiveWorkerVersion: () => fixture.candidateVersionId,
    probeCandidate: inactiveRecoveryCandidateProbe,
    verifyDrift: recoveryRepairRequiredDriftReport,
  };
  try {
    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation({
          ...common,
          confirmed: false,
          prewriteAbortConfirmed: true,
        }),
      /requires --confirm-production/,
    );
    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation({
          ...common,
          confirmed: true,
          prewriteAbortConfirmed: false,
        }),
      /requires --confirm-prewrite-abort/,
    );
    assert.equal(runnerCalls, 0);
    assert.equal(fs.existsSync(fixture.refinementEvidencePath), false);
    assert.equal(readD1ReleaseBudgetLedger(fixture.ledgerPath).revision, 1);
  } finally {
    fixture.close();
  }
});

test("prewrite-abort recovery treats dangling safety markers as present", () => {
  const fixture = createPrewriteAbortRecoveryFixture();
  const unresolvedMarker = path.join(
    fixture.backupDir,
    "cloudflare/d1-translation-repair-unresolved.json",
  );
  let runnerCalls = 0;
  try {
    fs.symlinkSync("missing-unresolved-marker-target", unresolvedMarker);
    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation({
          ...recoveryInvocation(fixture),
          lockRunner: (args) => {
            runnerCalls += 1;
            return fixture.runner(args);
          },
        }),
      /unresolved D1 translation repair already exists/,
    );
    assert.equal(runnerCalls, 0);
    assert.equal(readD1ReleaseBudgetLedger(fixture.ledgerPath).revision, 1);
  } finally {
    fixture.close();
  }
});

test("prewrite-abort recovery rejects a tampered source inventory before lock work", () => {
  const fixture = createPrewriteAbortRecoveryFixture();
  let runnerCalls = 0;
  try {
    const preflight = readTestJsonRecord(fixture.preflightPath);
    assert.ok(isTestRecord(preflight.sourceFingerprint));
    preflight.sourceFingerprint.sha256 = "f".repeat(64);
    writeTestPrivateJson(fixture.preflightPath, preflight);
    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation({
          ...recoveryInvocation(fixture),
          lockRunner: (args) => {
            runnerCalls += 1;
            return fixture.runner(args);
          },
        }),
      /digest does not match its file inventory/,
    );
    assert.equal(runnerCalls, 0);
    assert.equal(readD1ReleaseBudgetLedger(fixture.ledgerPath).revision, 1);
  } finally {
    fixture.close();
  }
});

fullTranslationCompletionTest("prewrite-abort recovery is bound to the exact preflight reservation window and UTC day", () => {
  const lateFixture = createPrewriteAbortRecoveryFixture({
    reservationCreatedAt: "2026-07-12T09:10:55.779Z",
  });
  const rolloverFixture = createPrewriteAbortRecoveryFixture();
  const runBoundFixture = createPrewriteAbortRecoveryFixture({
    reservationCreatedAt: "2026-07-12T09:11:50.778Z",
    useRunBoundOperationId: true,
  });
  let runnerCalls = 0;
  try {
    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation({
          ...recoveryInvocation(lateFixture),
          lockRunner: (args) => {
            runnerCalls += 1;
            return lateFixture.runner(args);
          },
        }),
      /tightly bound to the selected release preflight/,
    );
    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation({
          ...recoveryInvocation(rolloverFixture),
          now: new Date("2026-07-13T00:00:00.000Z"),
          lockRunner: (args) => {
            runnerCalls += 1;
            return rolloverFixture.runner(args);
          },
        }),
      /crossed the UTC billing-day boundary/,
    );
    assert.equal(runnerCalls, 0);
    assert.equal(readD1ReleaseBudgetLedger(lateFixture.ledgerPath).revision, 1);
    assert.equal(readD1ReleaseBudgetLedger(rolloverFixture.ledgerPath).revision, 1);
    assert.equal(
      refineAbortedPrewriteTranslationRepairReservation(
        {
          ...recoveryInvocation(runBoundFixture),
          now: new Date("2026-07-12T09:12:00.000Z"),
        },
      ).status,
      "complete",
    );
  } finally {
    lateFixture.close();
    rolloverFixture.close();
    runBoundFixture.close();
  }
});

fullTranslationCompletionTest("prewrite-abort recovery rejects an exact reservation without prepared evidence", () => {
  const fixture = createPrewriteAbortRecoveryFixture();
  const exactRowsRead =
    recoveryDriftBilledRowsRead + PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ;
  try {
    reserveD1ReleaseBudget({
      backupDir: fixture.backupDir,
      operationId: fixture.operationId,
      operation: "Remote SEO translation repair",
      candidateVersionId: fixture.candidateVersionId,
      sourceFingerprint: fixture.sourceIdentity,
      phase: "exact",
      rowsRead: exactRowsRead,
      rowsWritten: PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN,
      observedUsage: recoveryDailyUsage,
      now: recoveryClock,
      expectedUtcDay: "2026-07-12",
    });
    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation(recoveryInvocation(fixture)),
      /requires its matching preliminary recovery evidence/,
    );
    assert.equal(fs.existsSync(fixture.refinementEvidencePath), false);
  } finally {
    fixture.close();
  }
});

fullTranslationCompletionTest("prewrite-abort recovery fails closed when the candidate or drift proof changed", () => {
  const candidateFixture = createPrewriteAbortRecoveryFixture();
  const driftFixture = createPrewriteAbortRecoveryFixture();
  const otherCandidate = "33333333-3333-4333-8333-333333333333";
  try {
    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation({
          ...recoveryInvocation(candidateFixture),
          readActiveWorkerVersion: () => otherCandidate,
        }),
      (error) => {
        assert.match(errorTreeText(error), /no longer the sole active Worker/);
        return true;
      },
    );
    assert.equal(readD1ReleaseBudgetLedger(candidateFixture.ledgerPath).revision, 1);
    assert.equal(
      readRecoveryMetadataValue(candidateFixture.database, PRODUCTION_VALIDATION_LOCK_KEY),
      null,
    );

    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation({
          ...recoveryInvocation(driftFixture),
          verifyDrift: recoveryReconciledDriftReport,
        }),
      (error) => {
        assert.match(errorTreeText(error), /requires deterministic read-only proof/);
        return true;
      },
    );
    assert.equal(readD1ReleaseBudgetLedger(driftFixture.ledgerPath).revision, 1);
    assert.equal(fs.existsSync(driftFixture.refinementEvidencePath), false);
  } finally {
    candidateFixture.close();
    driftFixture.close();
  }
});

fullTranslationCompletionTest("prewrite-abort recovery survives a lost lock release without replaying D1 drift", () => {
  const fixture = createPrewriteAbortRecoveryFixture();
  let failRelease = true;
  const lostReleaseRunner: ProductionValidationLockRunner = (args) => {
    const sql = args[6] ?? "";
    if (
      failRelease &&
      /^delete from app_metadata\b/i.test(sql.trim()) &&
      sql.includes(PRODUCTION_VALIDATION_LOCK_KEY)
    ) {
      failRelease = false;
      throw new Error("synthetic lost lock release");
    }
    return fixture.runner(args);
  };
  try {
    assert.throws(
      () =>
        refineAbortedPrewriteTranslationRepairReservation({
          ...recoveryInvocation(fixture),
          lockRunner: lostReleaseRunner,
        }),
      (error) => {
        assert.match(errorTreeText(error), /failed closed/);
        assert.match(errorTreeText(error), /synthetic lost lock release|did not exact-release/);
        return true;
      },
    );
    const exactLedger = readD1ReleaseBudgetLedger(fixture.ledgerPath);
    assert.equal(exactLedger.reservations[0]?.phase, "exact");
    assert.equal(readTestJsonRecord(fixture.refinementEvidencePath).status, "prepared");
    assert.notEqual(
      readRecoveryMetadataValue(fixture.database, PRODUCTION_VALIDATION_LOCK_KEY),
      null,
    );

    fixture.database
      .prepare('delete from app_metadata where "key" = ?1')
      .run(PRODUCTION_VALIDATION_LOCK_KEY);
    let replayCalls = 0;
    let replayMutations = 0;
    const replayRunner: ProductionValidationLockRunner = (args) => {
      replayCalls += 1;
      if (/^(?:insert|delete|update)\b/i.test((args[6] ?? "").trim())) {
        replayMutations += 1;
      }
      return fixture.runner(args);
    };
    const replayed = refineAbortedPrewriteTranslationRepairReservation({
      ...recoveryInvocation(fixture),
      lockRunner: replayRunner,
      verifyDrift: () => {
        throw new Error("prepared replay must not rerun D1 drift");
      },
    });
    assert.equal(replayed.status, "complete");
    assert.equal(replayCalls, 2);
    assert.equal(replayMutations, 0);
    assert.equal(readTestJsonRecord(fixture.refinementEvidencePath).status, "complete");

    let completeReplayCalls = 0;
    const completeReplay = refineAbortedPrewriteTranslationRepairReservation({
      ...recoveryInvocation(fixture),
      now: new Date("2026-07-13T12:00:00.000Z"),
      lockRunner: () => {
        completeReplayCalls += 1;
        throw new Error("complete replay must be local-only");
      },
      readActiveWorkerVersion: () => {
        throw new Error("complete replay must not probe production");
      },
      probeCandidate: () => {
        throw new Error("complete replay must not probe production");
      },
      verifyDrift: () => {
        throw new Error("complete replay must not rerun D1 drift");
      },
    });
    assert.deepEqual(completeReplay, replayed);
    assert.equal(completeReplayCalls, 0);
  } finally {
    fixture.close();
  }
});

assertFullTranslationCompletionTestRegistration();

function createPrewriteAbortRecoveryFixture(
  options: {
    reservationCreatedAt?: string;
    useRunBoundOperationId?: boolean;
  } = {},
) {
  const fixtureRoot = path.resolve("tmp");
  fs.mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
  const backupDir = fs.mkdtempSync(
    path.join(fixtureRoot, "inspir-prewrite-recovery-"),
  );
  const cloudflareDirectory = path.join(backupDir, "cloudflare");
  fs.mkdirSync(cloudflareDirectory, { recursive: true });
  fs.chmodSync(cloudflareDirectory, 0o700);
  const sourceFile = {
    file: "fixture.txt",
    bytes: 7,
    sha256: "a".repeat(64),
  };
  const sourceSha256 = crypto
    .createHash("sha256")
    .update(`${sourceFile.file}\0${sourceFile.bytes}\0${sourceFile.sha256}\n`)
    .digest("hex");
  const sourceIdentity = { sha256: sourceSha256, fileCount: 1 };
  const legacyOperationId = translationRepairBudgetOperationId({
    candidateVersionId: recoveryCandidateVersionId,
    sourceFingerprint: sourceIdentity,
    planSha256: "8".repeat(64),
  });
  const operationId = options.useRunBoundOperationId
    ? `seo-cta-translation-repair:${"9".repeat(64)}`
    : legacyOperationId;
  const assetManifest = {
    root: path.resolve(process.cwd(), ".open-next/assets"),
    fileCount: 1,
    bytes: 1,
    sha256: "b".repeat(64),
  };
  const uploadValue = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-12T09:10:49.000Z",
    targetCandidateVersionId: recoveryCandidateVersionId,
    serviceBaselineVersionId: recoveryServiceBaselineVersionId,
    expectedReleaseTag: "release-recovery-candidate",
    expectedReleaseMessageSha256: "1".repeat(64),
    uploadCommandEvidenceSha256: "2".repeat(64),
    workerDeployPreparationSha256: "3".repeat(64),
    git: {
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/codex/release",
    },
    artifacts: {
      sourceFingerprintSha256: sourceSha256,
      sourceFingerprintFileCount: 1,
      workerSourceSha256: "d".repeat(64),
      wranglerConfigSha256: "e".repeat(64),
      assetManifestSha256: assetManifest.sha256,
      assetManifestFileCount: assetManifest.fileCount,
      assetManifestBytes: assetManifest.bytes,
    },
    uploadOutput: {
      type: "version-upload",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "inspirlearning",
      versionId: recoveryCandidateVersionId,
      previewUrl: null,
      previewAliasUrl: null,
      wranglerEnvironment: null,
      workerNameOverridden: false,
      timestamp: "2026-07-12T09:10:47.000Z",
    },
    versionView: {
      versionId: recoveryCandidateVersionId,
      createdAt: "2026-07-12T09:10:48.000Z",
      source: "wrangler",
      releaseTag: "release-recovery-candidate",
      releaseMessageSha256: "1".repeat(64),
      resourceConfigSha256: "4".repeat(64),
    },
    soleBaselineTopology: {
      deploymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      serviceBaselineVersionId: recoveryServiceBaselineVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  const upload = writeWorkerCandidateEvidence(
    workerCandidateUploadEvidencePath(backupDir),
    uploadValue,
  );
  const preflightPath = path.join(
    cloudflareDirectory,
    `d1-translation-repair-release-preflight-${recoveryReleasePreflightRunId}.json`,
  );
  writeTestPrivateJson(preflightPath, {
    kind: "d1-translation-repair-release-preflight",
    runId: recoveryReleasePreflightRunId,
    createdAt: recoveryReleasePreflightCreatedAt,
    candidateVersionId: recoveryCandidateVersionId,
    serviceBaselineVersionId: recoveryServiceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    activeVersionId: recoveryServiceBaselineVersionId,
    gitHead: "c".repeat(40),
    gitUpstream: "c".repeat(40),
    sourceFingerprint: {
      sha256: sourceSha256,
      fileCount: 1,
      files: [sourceFile],
    },
    workerSourceSha256: "d".repeat(64),
    wranglerConfigSha256: "e".repeat(64),
    assetManifest,
    safetyChecks: [
      {
        name: "local build and test gates",
        status: "pass",
        detail: {
          report: "cloudflare/local-gates-report.json",
          sourceFingerprint: sourceSha256,
        },
      },
      {
        name: "source secret scan",
        status: "pass",
        detail: {
          report: "cloudflare/source-secret-scan-report.json",
          sourceFingerprint: sourceSha256,
        },
      },
      {
        name: "OpenNext build artifact secret scan",
        status: "pass",
        detail: {
          report: "cloudflare/build-artifact-scan-report.json",
          sourceFingerprint: sourceSha256,
        },
      },
    ],
    candidateProbe: inactiveRecoveryCandidateProbe(
      recoveryServiceBaselineVersionId,
    ),
    workerDeployReportPath: workerCandidateUploadEvidencePath(backupDir),
    workerDeployEvidence: {
      createdAt: upload.value.createdAt,
      backupDir: path.resolve(backupDir),
      candidateVersionId: recoveryCandidateVersionId,
      sourceFingerprintSha256: sourceSha256,
      sourceFingerprintFileCount: 1,
      workerSourceSha256: "d".repeat(64),
      wranglerConfigSha256: "e".repeat(64),
      assetManifest,
      activeDeploymentReadAt: upload.value.createdAt,
    },
  });
  reserveD1ReleaseBudget({
    backupDir,
    operationId,
    operation: "Remote SEO translation repair",
    candidateVersionId: recoveryCandidateVersionId,
    sourceFingerprint: sourceIdentity,
    phase: "maximum",
    rowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
    rowsWritten: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    observedUsage: recoveryDailyUsage,
    now: new Date(options.reservationCreatedAt ?? recoveryReservationCreatedAt),
  });
  const database = recoveryLockDatabase();
  const runner = recoverySqliteWranglerRunner(database);
  const ledgerPath = path.join(
    cloudflareDirectory,
    "d1-release-budget-ledger-2026-07-12.json",
  );
  const refinementEvidencePath = path.join(
    cloudflareDirectory,
    `d1-translation-repair-prewrite-abort-refinement-${recoveryReleasePreflightRunId}.json`,
  );
  return {
    backupDir,
    buildRecoveryPlan: () => ({
      translations: new Map<SupportedLanguage, string>(),
      curatedRepairRows: [],
      marketingSite: releasedMarketingSiteRepairCorpus(),
      mainAppRepairRows: [],
      operationId,
      legacyOperationId,
    }),
    candidateVersionId: recoveryCandidateVersionId,
    serviceBaselineVersionId: recoveryServiceBaselineVersionId,
    database,
    ledgerPath,
    operationId,
    preflightPath,
    refinementEvidencePath,
    runId: recoveryReleasePreflightRunId,
    runner,
    sourceIdentity,
    close() {
      database.close();
      fs.rmSync(backupDir, { recursive: true, force: true });
    },
  };
}

function recoveryInvocation(fixture: ReturnType<typeof createPrewriteAbortRecoveryFixture>) {
  return {
    backupDir: fixture.backupDir,
    releasePreflightRunId: fixture.runId,
    confirmed: true,
    prewriteAbortConfirmed: true,
    dailyUsage: recoveryDailyUsage,
    now: recoveryClock,
    lockRunner: fixture.runner,
    assertRecoverySource: () => {},
    buildRecoveryPlan: fixture.buildRecoveryPlan,
    readActiveWorkerVersion: () => fixture.serviceBaselineVersionId,
    probeCandidate: inactiveRecoveryCandidateProbe,
    verifyDrift: recoveryRepairRequiredDriftReport,
  };
}

function recoveryRepairRequiredDriftReport(): RemoteTranslationDriftReport {
  const issue = {
    scope: "source-snapshot" as const,
    code: "exact-source-snapshot-drift",
    message: "fixture drift remains",
  };
  return {
    createdAt: recoveryClock.toISOString(),
    mode: "remote-verify-only",
    database: "inspirlearning-prod",
    ok: false,
    status: "repair-required",
    repairRequired: true,
    issues: [issue],
    expected: {
      sourceNamespaces: 125,
      curatedRows: 8_556,
      marketingSiteRows: 69,
      mainAppRows: 69,
      supportedTargetLanguages: 69,
      remoteQueries: 4,
    },
    sourceSnapshot: {
      status: "repair-required",
      expectedSourceNamespaces: 125,
      expectedSourceStrings: 1_000,
      reconciliationStatements: 6,
      reconciliationLogicalRowWrites: 6,
      snapshotBilledRowReads: recoveryDriftBilledRowsRead,
      projectedBilledRowReads: 151_024,
    },
    payloadSnapshot: { status: "repair-required", issues: [issue] },
    readOnly: {
      remoteQueries: 4,
      billedRowsRead: recoveryDriftBilledRowsRead,
      workerUploads: 0,
      workerDeployments: 0,
      maintenanceActivations: 0,
      timeTravelReads: 0,
      sqlImports: 0,
      databaseWrites: 0,
      unresolvedMarkersCreated: 0,
      preWriteEvidenceCreated: 0,
      reportsWritten: 0,
    },
  };
}

function recoveryReconciledDriftReport(): RemoteTranslationDriftReport {
  const report = recoveryRepairRequiredDriftReport();
  return {
    ...report,
    ok: true,
    status: "reconciled",
    repairRequired: false,
    issues: [],
    sourceSnapshot: {
      ...report.sourceSnapshot,
      status: "reconciled",
      reconciliationStatements: 0,
      reconciliationLogicalRowWrites: 0,
    },
    payloadSnapshot: { status: "reconciled", issues: [] },
  };
}

function translationUploadEvidence(
  backupDir: string,
  git: { head: string; upstream: string; upstreamRef: string },
  artifacts: WorkerDeployArtifactEvidence,
) {
  const value = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-15T10:00:00.000Z",
    targetCandidateVersionId: repairCandidateVersionId,
    serviceBaselineVersionId: repairServiceBaselineVersionId,
    expectedReleaseTag: "release-translation-candidate",
    expectedReleaseMessageSha256: "1".repeat(64),
    uploadCommandEvidenceSha256: "2".repeat(64),
    workerDeployPreparationSha256: "3".repeat(64),
    git,
    artifacts: {
      sourceFingerprintSha256: artifacts.sourceFingerprint.sha256,
      sourceFingerprintFileCount: artifacts.sourceFingerprint.fileCount,
      workerSourceSha256: artifacts.workerSourceSha256,
      wranglerConfigSha256: artifacts.wranglerConfigSha256,
      assetManifestSha256: artifacts.assetManifest.sha256,
      assetManifestFileCount: artifacts.assetManifest.fileCount,
      assetManifestBytes: artifacts.assetManifest.bytes,
    },
    uploadOutput: {
      type: "version-upload",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "inspirlearning",
      versionId: repairCandidateVersionId,
      previewUrl: null,
      previewAliasUrl: null,
      wranglerEnvironment: null,
      workerNameOverridden: false,
      timestamp: "2026-07-15T09:58:00.000Z",
    },
    versionView: {
      versionId: repairCandidateVersionId,
      createdAt: "2026-07-15T09:59:00.000Z",
      source: "wrangler",
      releaseTag: "release-translation-candidate",
      releaseMessageSha256: "1".repeat(64),
      resourceConfigSha256: "4".repeat(64),
    },
    soleBaselineTopology: {
      deploymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      serviceBaselineVersionId: repairServiceBaselineVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  return {
    path: path.resolve(backupDir, "cloudflare/worker-candidate-upload.json"),
    value,
    sha256: workerCandidateEvidenceSha256(value),
  };
}

function inactiveRecoveryCandidateProbe(candidateVersionId: string) {
  return {
    active: false,
    healthStatus: 200,
    mutationStatus: 403,
    delivery: "lean-api-worker",
    runtime: "cloudflare-workers",
    openNext: false,
    maintenance: false,
    versionId: candidateVersionId,
  };
}

function recoveryLockDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`create table app_metadata (
    "key" text primary key not null,
    value text not null,
    updated_at integer not null
  )`);
  return database;
}

function recoverySqliteWranglerRunner(
  database: DatabaseSync,
): ProductionValidationLockRunner {
  return (args) => {
    assert.deepEqual(args.slice(0, 5), [
      "d1",
      "execute",
      "inspirlearning-prod",
      "--remote",
      "--json",
    ]);
    assert.equal(args[5], "--command");
    const sql = args[6] ?? "";
    const rows = database.prepare(sql).all();
    const mutating = /^(?:insert|delete)\b/i.test(sql.trim());
    const changes = database.prepare("select changes() as changes").get()?.changes;
    if (typeof changes !== "number") throw new Error("SQLite changes() fixture is invalid.");
    return JSON.stringify([
      {
        success: true,
        results: rows,
        meta: {
          rows_read: Math.min(4, rows.length + 1),
          rows_written: mutating ? changes * 2 : 0,
        },
      },
    ]);
  };
}

function readRecoveryMetadataValue(database: DatabaseSync, key: string) {
  const value = database
    .prepare('select value from app_metadata where "key" = ?1')
    .get(key)?.value;
  assert.ok(value === undefined || typeof value === "string");
  return value ?? null;
}

function writeTestPrivateJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function readTestJsonRecord(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(isTestRecord(value));
  return value;
}

function isTestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorTreeText(error: unknown): string {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map(errorTreeText)].join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}
