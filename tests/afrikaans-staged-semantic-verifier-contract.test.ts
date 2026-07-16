import assert from "node:assert/strict";
import test from "node:test";
import {
  AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  afrikaansTranslationSemanticAuditManifestSchema,
  afrikaansTranslationSemanticPromotionEvidenceSchema,
  canonicalTranslationAuditJson,
  sha256CanonicalTranslationAuditJson,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_CHECKPOINT_ROOT_BASENAME,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_EVIDENCE_KIND,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
  TRANSLATION_SEMANTIC_AUDIT_RELEASE_WARNINGS,
  TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
  TRANSLATION_SEMANTIC_AUDIT_VERSION,
  translationSemanticAuditManifestSchema,
  translationSemanticPromotionEvidenceUnionSchema,
} from "../scripts/verify-translation-semantic-audit";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE,
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
} from "../scripts/long-tail-nllb-execution-profile";

const SHA256 = "a".repeat(64);
const EMPTY_ROOT = sha256CanonicalTranslationAuditJson([]);

function checkpointEvidence() {
  return {
    schemaVersion: 1,
    kind: TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_EVIDENCE_KIND,
    checkpointRootPath:
      `tmp/translation-v10/${TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_CHECKPOINT_ROOT_BASENAME}`,
    sessionSha256: SHA256,
    sessionRecordSha256: SHA256,
    sessionFileSha256: SHA256,
    checkpointCount:
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
    terminalCheckpointSha256: SHA256,
    checkpointChainRootSha256: SHA256,
    packRescueRecordCount:
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
    packRescueRecordRootSha256: EMPTY_ROOT,
    fieldPairRescuedFields: 0,
    trackedCuratedRescuedFields: 0,
  };
}

function trackedAfrikaansEvidence() {
  return {
    referencePacks:
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT,
    referencePackIdentityRootSha256: EMPTY_ROOT,
    referencePackGateEvidenceRootSha256: EMPTY_ROOT,
    supportPairCount: 0,
    supportPairRootSha256: EMPTY_ROOT,
    supportRecordCount: 0,
    supportRecordRootSha256: EMPTY_ROOT,
    conflictSourceCount: 0,
    conflictSourceRootSha256: EMPTY_ROOT,
    fieldPairRescuedFields: 0,
    trackedCuratedRescuedFields: 0,
    trackedCuratedRescueRootSha256: EMPTY_ROOT,
  };
}

function treeEvidence(path: string) {
  return { path, exists: true, sha256: SHA256, files: 1, bytes: 1 };
}

function afrikaansManifestFixture() {
  const packBindings = Array.from(
    { length: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT },
    (_, index) => ({
      locale: "af",
      language: "Afrikaans",
      namespace: `route:fixture-${String(index).padStart(3, "0")}`,
      sourceHash: SHA256,
      sourceEntriesSha256: SHA256,
      origin: index <
          TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT
        ? "candidate"
        : "curated",
      packFileSha256: SHA256,
      fields: 1,
      fieldIdentityRootSha256: SHA256,
      fieldEvidenceRootSha256: SHA256,
      afrikaansPackContext: null,
      unadjudicatedFields: 0,
      adjudicatedFields: 0,
    }),
  );
  const evidence = checkpointEvidence();
  return {
    schemaVersion: 3,
    kind: "inspir-translation-semantic-audit-manifest-v3",
    auditVersion: TRANSLATION_SEMANTIC_AUDIT_VERSION,
    createdAt: "2026-07-15T10:00:00Z",
    scope: {
      name: "afrikaans-smoke",
      locales: ["af"],
      namespaces: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
      packs: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
      fields: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
    },
    policy: { sha256: SHA256, implementationSha256: SHA256, value: {} },
    models: {
      modelLockSha256: SHA256,
      fasttext: {
        label: "fastText lid.176",
        sha256: TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.fasttextSha256,
      },
      labse: {
        label: "sentence-transformers/LaBSE",
        treeSha256: TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.labseTreeSha256,
      },
      madlad: {
        label: "MADLAD400 3B CTranslate2 int8",
        treeSha256: TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.madladTreeSha256,
      },
      runtimeVersions: TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
    },
    inputs: {
      masterWorklist: {
        path: "tmp/translation-v10/worklist.json",
        fileSha256: SHA256,
        worklistSha256: SHA256,
        generatorExecutionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
        generatorExecutionProfileSha256:
          LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
      },
      curatedTree: treeEvidence("translations/curated"),
      staticMainAppTree: treeEvidence("translations/static-main-app"),
      candidateTree: treeEvidence("tmp/translation-v10/candidates"),
      packWorklistTree: treeEvidence("tmp/translation-v10/worklists"),
      adjudicationSha256: null,
    },
    results: {
      passed: true,
      counts: {
        packs: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
        fields: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
        candidatePacks:
          TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
        curatedPacks:
          TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT,
        legalFields: 0,
        languageEvidenceFields: 0,
        backtranslatedFields: 0,
        unadjudicatedFields: 0,
        unadjudicatedFailures: 0,
        adjudicatedFields: 0,
        adjudicatedFailures: 0,
      },
      packIdentityRootSha256: SHA256,
      packEvidenceRootSha256: SHA256,
      packBindings,
      afrikaansTrackedCurated: trackedAfrikaansEvidence(),
      checkpointEvidence: {
        ...evidence,
        packRescueRecords: packBindings.map((binding, index) => ({
          ordinal: index + 1,
          locale: "af",
          namespace: binding.namespace,
          rescueRecordCount: 0,
          rescueRecordRootSha256: EMPTY_ROOT,
          rescueRecords: [],
        })),
      },
      failureRecords: {
        count: 0,
        sha256: EMPTY_ROOT,
        codeCounts: {},
        adjudicatedCodeCounts: {},
        samples: [],
        omittedSamples: 0,
      },
    },
    releaseWarnings: [...TRANSLATION_SEMANTIC_AUDIT_RELEASE_WARNINGS],
    manifestSha256: SHA256,
  };
}

function stagedEvidenceFixture() {
  const manifest = afrikaansTranslationSemanticAuditManifestSchema.parse(
    afrikaansManifestFixture(),
  );
  const withoutPath = (value: ReturnType<typeof treeEvidence>) => ({
    exists: value.exists,
    sha256: value.sha256,
    files: value.files,
    bytes: value.bytes,
  });
  const material = {
    schemaVersion: 1,
    kind: AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
    manifestSha256: manifest.manifestSha256,
    masterWorklistSha256: manifest.inputs.masterWorklist.worklistSha256,
    generatorExecutionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
    generatorExecutionProfileSha256:
      LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
    auditVersion: manifest.auditVersion,
    auditPolicySha256: manifest.policy.sha256,
    auditImplementationSha256: manifest.policy.implementationSha256,
    verifierImplementationSha256: SHA256,
    modelLockSha256: manifest.models.modelLockSha256,
    modelDigests: TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
    runtimeVersions: TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
    scope: {
      locales: 1,
      namespaces: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
      packs: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
      fields: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
      candidatePacks:
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
      curatedPacks:
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT,
    },
    inputTrees: {
      curated: withoutPath(manifest.inputs.curatedTree),
      staticMainApp: withoutPath(manifest.inputs.staticMainAppTree),
      candidates: withoutPath(manifest.inputs.candidateTree),
      packWorklists: withoutPath(manifest.inputs.packWorklistTree),
    },
    siteSourceCatalog: {
      path: "lib/i18n/site-source-manifest.ts",
      fileSha256: SHA256,
      catalogRootSha256: SHA256,
      namespaces: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT - 1,
      fields: 1,
    },
    packIdentityRootSha256: SHA256,
    packEvidenceRootSha256: SHA256,
    afrikaansTrackedCurated: trackedAfrikaansEvidence(),
    checkpointEvidence: checkpointEvidence(),
  };
  return {
    ...material,
    semanticEvidenceSha256: sha256CanonicalTranslationAuditJson(material),
  };
}

test("Afrikaans semantic schemas are a strict exact release scope distinct from full release", () => {
  const manifest = afrikaansTranslationSemanticAuditManifestSchema.parse(
    afrikaansManifestFixture(),
  );
  assert.equal(manifest.results.packBindings.length, 125);
  assert.equal(manifest.results.counts.fields, 16_564);
  assert.equal(
    manifest.results.checkpointEvidence.packRescueRecords.length,
    125,
  );
  assert.throws(() => translationSemanticAuditManifestSchema.parse(manifest));

  const evidence = afrikaansTranslationSemanticPromotionEvidenceSchema.parse(
    stagedEvidenceFixture(),
  );
  assert.equal(
    translationSemanticPromotionEvidenceUnionSchema.parse(evidence).kind,
    AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  );
  assert.equal(
    evidence.semanticEvidenceSha256,
    sha256CanonicalTranslationAuditJson(
      Object.fromEntries(
        Object.entries(evidence).filter(
          ([key]) => key !== "semanticEvidenceSha256",
        ),
      ),
    ),
  );
  assert.equal(canonicalTranslationAuditJson(evidence.scope), canonicalTranslationAuditJson({
    locales: 1,
    namespaces: 125,
    packs: 125,
    fields: 16_564,
    candidatePacks: 121,
    curatedPacks: 4,
  }));

  const partial = {
    ...stagedEvidenceFixture(),
    scope: {
      ...stagedEvidenceFixture().scope,
      candidatePacks: 120,
    },
  };
  assert.throws(() =>
    afrikaansTranslationSemanticPromotionEvidenceSchema.parse(partial)
  );
  const widened = afrikaansManifestFixture();
  widened.scope.locales.push("nl");
  assert.throws(() =>
    afrikaansTranslationSemanticAuditManifestSchema.parse(widened)
  );
  assert.throws(() =>
    afrikaansTranslationSemanticPromotionEvidenceSchema.parse({
      ...stagedEvidenceFixture(),
      unexpected: true,
    })
  );
});
