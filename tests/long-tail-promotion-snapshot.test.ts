import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertLongTailPromotionSnapshotTransactionRootSettled,
  calculateLongTailPromotionSnapshotTransactionId,
  finalizeLongTailPromotionSnapshot,
  LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND,
  LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND,
  LongTailPromotionSnapshotError,
  longTailPromotionSnapshotFinalizeFaultPoints,
  longTailPromotionSnapshotFaultPoints,
  promoteLongTailPromotionSnapshot,
  readAndValidateLongTailPromotionJournal,
  recoverLongTailPromotionSnapshot,
  recoverLongTailPromotionSnapshotByExactArtifacts,
  type LongTailPromotionSnapshotArtifact,
  type LongTailPromotionSnapshotFinalizeFaultPoint,
  type LongTailPromotionSnapshotFaultPoint,
} from "../scripts/long-tail-promotion-snapshot";
import {
  calculateTranslationSemanticAuditTreeEvidence,
  calculateTranslationSemanticSiteSourceCatalogEvidence,
  isTranslationSemanticMainAppWorkbenchPath,
  sha256CanonicalTranslationAuditJson,
  AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  afrikaansTranslationSemanticPromotionEvidenceSchema,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_EVIDENCE_KIND,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
  TRANSLATION_SEMANTIC_AUDIT_POLICY,
  TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
  TRANSLATION_SEMANTIC_AUDIT_VERSION,
  TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  translationSemanticPromotionEvidenceSchema,
  translationSemanticPromotionEvidenceUnionSchema,
  type AfrikaansTranslationSemanticPromotionEvidence,
  type TranslationSemanticPromotionEvidence,
} from "../scripts/verify-translation-semantic-audit";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE,
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
} from "../scripts/long-tail-nllb-execution-profile";

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeExactThroughDescriptor(
  descriptor: number,
  bytes: Uint8Array,
): void {
  ftruncateSync(descriptor, 0);
  let offset = 0;
  while (offset < bytes.byteLength) {
    offset += writeSync(
      descriptor,
      bytes,
      offset,
      bytes.byteLength - offset,
      offset,
    );
  }
  fsyncSync(descriptor);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function temporaryDirectory(t: test.TestContext) {
  const directory = mkdtempSync(
    path.join(realpathSync(os.tmpdir()), "inspir-promotion-snapshot-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

type Fixture = ReturnType<typeof createFixture>;

function createFixture(root: string) {
  const curatedRoot = path.join(root, "translations", "curated");
  const transactionRoot = path.join(root, "tmp", "promotion-transactions");
  mkdirSync(path.join(curatedRoot, "es"), { recursive: true, mode: 0o700 });
  const oldReplacement = jsonBytes({
    schemaVersion: 1,
    language: "Spanish",
    namespace: "legal:privacy",
    sourceHash: sha256("old-source"),
    translations: { title: "Aviso anterior" },
  });
  const retained = jsonBytes({
    schemaVersion: 1,
    language: "Spanish",
    namespace: "route:home",
    sourceHash: sha256("retained-source"),
    translations: { title: "Aprende algo nuevo" },
  });
  const replayed = jsonBytes({
    schemaVersion: 1,
    language: "Spanish",
    namespace: "route:about",
    sourceHash: sha256("replayed-source"),
    translations: { title: "Sobre inspir" },
  });
  writeFileSync(
    path.join(curatedRoot, "es", "legal__privacy.json"),
    oldReplacement,
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(curatedRoot, "es", "route__home.json"),
    retained,
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(curatedRoot, "es", "route__about.json"),
    replayed,
    { mode: 0o600 },
  );

  const newReplacement = jsonBytes({
    schemaVersion: 1,
    language: "Spanish",
    namespace: "legal:privacy",
    sourceHash: sha256("new-source"),
    translations: { title: "Aviso de privacidad actualizado" },
  });
  const created = jsonBytes({
    schemaVersion: 1,
    language: "Spanish",
    namespace: "route:new",
    sourceHash: sha256("created-source"),
    translations: { title: "Una ruta nueva" },
  });
  const artifacts: readonly LongTailPromotionSnapshotArtifact[] = Object.freeze([
    Object.freeze({
      targetRelativePath: "es/legal__privacy.json",
      targetBytes: newReplacement,
      checkpointRelativePath: `${sha256("replace-job")}.json`,
      checkpointBytes: jsonBytes({
        schemaVersion: 1,
        jobSha256: sha256("replace-job"),
        targetSha256: sha256(newReplacement),
      }),
      replacement: Object.freeze({
        kind: LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND,
        approvedExistingSha256: sha256(oldReplacement),
        priorSourceHash: sha256("old-source"),
        newSourceHash: sha256("new-source"),
        backupRelativePath: "es/legal__privacy.json",
      }),
    }),
    Object.freeze({
      targetRelativePath: "es/route__about.json",
      targetBytes: replayed,
      checkpointRelativePath: `${sha256("replay-job")}.json`,
      checkpointBytes: jsonBytes({
        schemaVersion: 1,
        jobSha256: sha256("replay-job"),
        targetSha256: sha256(replayed),
      }),
    }),
    Object.freeze({
      targetRelativePath: "es/route__new.json",
      targetBytes: created,
      checkpointRelativePath: `${sha256("create-job")}.json`,
      checkpointBytes: jsonBytes({
        schemaVersion: 1,
        jobSha256: sha256("create-job"),
        targetSha256: sha256(created),
      }),
    }),
  ]);
  return Object.freeze({
    curatedRoot,
    transactionRoot,
    masterWorklistSha256: sha256("master-worklist"),
    artifacts,
    oldReplacement,
    newReplacement,
    retained,
    replayed,
    created,
  });
}

function semanticEvidenceForFixture(fixture: Fixture): TranslationSemanticPromotionEvidence {
  const workspaceRoot = path.dirname(path.dirname(fixture.curatedRoot));
  const siteSourceManifestPath = path.join(
    workspaceRoot,
    "lib/i18n/site-source-manifest.ts",
  );
  const siteSources = Object.fromEntries([
    [
      "marketing-site",
      {
        sourceHash: sha256("ignored\u0000Ignored source"),
        sourceStrings: { ignored: "Ignored source" },
      },
    ],
    ...Array.from({ length: 124 }, (_, index) => {
      const namespace = `route:fixture-${String(index).padStart(3, "0")}`;
      const key = `site.fixture.${index}`;
      const value = `Fixture source ${index}`;
      return [
        namespace,
        {
          sourceHash: sha256(`${key}\u0000${value}`),
          sourceStrings: { [key]: value },
        },
      ] as const;
    }),
  ]);
  mkdirSync(path.dirname(siteSourceManifestPath), { recursive: true });
  writeFileSync(
    siteSourceManifestPath,
    `// Synthetic promotion fixture.\nexport const siteSourceManifest = ${
      JSON.stringify(siteSources, null, 2)
    } as const;\n`,
  );
  const siteSourceCatalog =
    calculateTranslationSemanticSiteSourceCatalogEvidence({ workspaceRoot });
  const staticMainAppRoot = path.join(
    path.dirname(fixture.curatedRoot),
    "static-main-app",
  );
  mkdirSync(staticMainAppRoot, { recursive: true });
  writeFileSync(path.join(staticMainAppRoot, "af.json"), jsonBytes({ tracked: true }));
  const curated = calculateTranslationSemanticAuditTreeEvidence({
    root: fixture.curatedRoot,
    ignoreMainAppWorkbench: true,
  });
  const staticMainApp = calculateTranslationSemanticAuditTreeEvidence({
    root: staticMainAppRoot,
  });
  const modelLockSha256 = sha256CanonicalTranslationAuditJson({
    ...TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
    runtimeVersions: TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
  });
  const emptyAfrikaansEvidenceRoot =
    sha256CanonicalTranslationAuditJson([]);
  const material = {
    schemaVersion: 2 as const,
    kind: TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
    manifestSha256: sha256("semantic-manifest"),
    masterWorklistSha256: fixture.masterWorklistSha256,
    generatorExecutionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
    generatorExecutionProfileSha256:
      LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
    auditVersion: TRANSLATION_SEMANTIC_AUDIT_VERSION,
    auditPolicySha256: sha256CanonicalTranslationAuditJson(
      TRANSLATION_SEMANTIC_AUDIT_POLICY,
    ),
    auditImplementationSha256: sha256("audit-implementation"),
    verifierImplementationSha256: sha256("verifier-implementation"),
    modelLockSha256,
    modelDigests: TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
    runtimeVersions: TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
    scope: {
      locales: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length,
      namespaces: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
      packs: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      fields: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      candidatePacks: fixture.artifacts.length,
      curatedPacks:
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT -
        fixture.artifacts.length,
    },
    inputTrees: {
      curated,
      staticMainApp,
      candidates: {
        exists: true,
        sha256: sha256("candidate-tree"),
        files: fixture.artifacts.length,
        bytes: fixture.artifacts.length,
      },
      packWorklists: {
        exists: true,
        sha256: sha256("worklist-tree"),
        files: fixture.artifacts.length,
        bytes: fixture.artifacts.length,
      },
    },
    siteSourceCatalog,
    packIdentityRootSha256: sha256("pack-identities"),
    packEvidenceRootSha256: sha256("pack-evidence"),
    afrikaansTrackedCurated: {
      referencePacks: 0,
      referencePackIdentityRootSha256: emptyAfrikaansEvidenceRoot,
      referencePackGateEvidenceRootSha256: emptyAfrikaansEvidenceRoot,
      supportPairCount: 0,
      supportPairRootSha256: emptyAfrikaansEvidenceRoot,
      supportRecordCount: 0,
      supportRecordRootSha256: emptyAfrikaansEvidenceRoot,
      conflictSourceCount: 0,
      conflictSourceRootSha256: emptyAfrikaansEvidenceRoot,
      fieldPairRescuedFields: 0,
      trackedCuratedRescuedFields: 0,
      trackedCuratedRescueRootSha256: emptyAfrikaansEvidenceRoot,
    },
    checkpointEvidence: {
      schemaVersion: 1,
      kind: TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_EVIDENCE_KIND,
      checkpointRootPath: "tmp/translation-v10/.semantic-audit-full.json.checkpoints",
      sessionSha256: sha256("checkpoint-session"),
      sessionRecordSha256: sha256("checkpoint-session-record"),
      sessionFileSha256: sha256("checkpoint-session-file"),
      checkpointCount: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      terminalCheckpointSha256: sha256("checkpoint-terminal"),
      checkpointChainRootSha256: sha256("checkpoint-chain"),
      packRescueRecordCount: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      packRescueRecordRootSha256: sha256("checkpoint-rescues"),
      fieldPairRescuedFields: 0,
      trackedCuratedRescuedFields: 0,
    },
  };
  return translationSemanticPromotionEvidenceSchema.parse({
    ...material,
    semanticEvidenceSha256:
      sha256CanonicalTranslationAuditJson(material),
  });
}

function stagedAfrikaansSemanticEvidenceForFixture(
  fixture: Fixture,
): AfrikaansTranslationSemanticPromotionEvidence {
  const full = semanticEvidenceForFixture(fixture);
  const material = {
    ...Object.fromEntries(
      Object.entries(full).filter(
        ([key]) => key !== "semanticEvidenceSha256",
      ),
    ),
    schemaVersion: 1 as const,
    kind: AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
    scope: {
      locales: 1 as const,
      namespaces: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
      packs: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
      fields: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
      candidatePacks:
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
      curatedPacks:
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT,
    },
    checkpointEvidence: {
      ...full.checkpointEvidence,
      checkpointRootPath:
        "tmp/translation-v10/.semantic-audit-afrikaans-smoke.json.checkpoints",
      checkpointCount:
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
      packRescueRecordCount:
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
    },
  };
  return afrikaansTranslationSemanticPromotionEvidenceSchema.parse({
    ...material,
    semanticEvidenceSha256:
      sha256CanonicalTranslationAuditJson(material),
  });
}

test("promotion evidence rejects a coordinated generator profile rehash", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  {
    const current = semanticEvidenceForFixture(fixture);
    const forgedValue: unknown = JSON.parse(JSON.stringify(current));
    assert.ok(isRecord(forgedValue));
    const executionProfile = forgedValue.generatorExecutionProfile;
    assert.ok(isRecord(executionProfile));
    const environment = executionProfile.environment;
    assert.ok(isRecord(environment));
    environment.OMP_NUM_THREADS = "2";
    const profileMaterial = Object.fromEntries(
      Object.entries(executionProfile).filter(
        ([key]) => key !== "executionProfileSha256",
      ),
    );
    const forgedProfileSha256 =
      sha256CanonicalTranslationAuditJson(profileMaterial);
    executionProfile.executionProfileSha256 = forgedProfileSha256;
    forgedValue.generatorExecutionProfileSha256 = forgedProfileSha256;
    const evidenceMaterial = Object.fromEntries(
      Object.entries(forgedValue).filter(
        ([key]) => key !== "semanticEvidenceSha256",
      ),
    );
    forgedValue.semanticEvidenceSha256 =
      sha256CanonicalTranslationAuditJson(evidenceMaterial);
    assert.throws(
      () => translationSemanticPromotionEvidenceSchema.parse(forgedValue),
    );
  }
});

test("Afrikaans staged journals bind the distinct evidence kind and recovery cannot cross kinds", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const artifacts: readonly LongTailPromotionSnapshotArtifact[] =
    Object.freeze(Array.from(
      {
        length:
          TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
      },
      (_, index) => {
        const identity = String(index).padStart(3, "0");
        const targetBytes = jsonBytes({
          schemaVersion: 1,
          language: "Afrikaans",
          locale: "af",
          namespace: `route:staged-${identity}`,
          sourceHash: sha256(`staged-source-${identity}`),
          translations: { title: `Afrikaanse toets ${identity}` },
        });
        return Object.freeze({
          targetRelativePath: `af/route__staged-${identity}.json`,
          targetBytes,
          checkpointRelativePath: `${sha256(`staged-job-${identity}`)}.json`,
          checkpointBytes: jsonBytes({
            schemaVersion: 1,
            jobSha256: sha256(`staged-job-${identity}`),
            targetSha256: sha256(targetBytes),
          }),
        });
      },
    ));
  const stagedFixture = Object.freeze({ ...fixture, artifacts });
  const semanticEvidence =
    stagedAfrikaansSemanticEvidenceForFixture(stagedFixture);
  assert.equal(
    translationSemanticPromotionEvidenceUnionSchema.parse(semanticEvidence)
      .kind,
    AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  );

  const promotion = promoteLongTailPromotionSnapshot({
    ...promotionInput(stagedFixture),
    semanticEvidence,
  });
  assert.throws(
    () => recoverLongTailPromotionSnapshotByExactArtifacts({
      ...promotionInput(stagedFixture),
      expectedSemanticEvidenceKind:
        TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
    }),
    /found 0/,
  );
  const recovered = recoverLongTailPromotionSnapshotByExactArtifacts({
    ...promotionInput(stagedFixture),
    expectedSemanticEvidenceKind:
      AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  });
  assert.equal(recovered.transactionId, promotion.transactionId);
  finalizeLongTailPromotionSnapshot({
    curatedRoot: stagedFixture.curatedRoot,
    transactionRoot: stagedFixture.transactionRoot,
    transactionId: promotion.transactionId,
  });
  const binding = readAndValidateLongTailPromotionJournal({
    curatedRoot: stagedFixture.curatedRoot,
    transactionRoot: stagedFixture.transactionRoot,
    transactionId: promotion.transactionId,
    expectedSemanticEvidence: semanticEvidence,
  });
  assert.equal(
    binding.semanticEvidenceKind,
    AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  );
  assert.equal(
    binding.artifacts,
    TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
  );
  assert.equal(
    binding.publications.created + binding.publications.replayed +
      binding.publications.replaced,
    TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
  );
});

function driftSiteSourceCatalog(fixture: Fixture): Readonly<{
  path: string;
  original: Buffer;
}> {
  const manifestPath = path.join(
    path.dirname(path.dirname(fixture.curatedRoot)),
    "lib/i18n/site-source-manifest.ts",
  );
  const original = readFileSync(manifestPath);
  const priorValue = "Fixture source 0";
  const nextValue = "Changed fixture source zero";
  const priorHash = sha256(`site.fixture.0\u0000${priorValue}`);
  const nextHash = sha256(`site.fixture.0\u0000${nextValue}`);
  const drifted = original.toString("utf8")
    .replace(priorValue, nextValue)
    .replace(priorHash, nextHash);
  assert.notEqual(drifted, original.toString("utf8"));
  writeFileSync(manifestPath, drifted);
  return Object.freeze({ path: manifestPath, original });
}

function promotionInput(
  fixture: Fixture,
  crashHook?: (point: LongTailPromotionSnapshotFaultPoint) => void,
) {
  return {
    curatedRoot: fixture.curatedRoot,
    transactionRoot: fixture.transactionRoot,
    masterWorklistSha256: fixture.masterWorklistSha256,
    artifacts: fixture.artifacts,
    ...(crashHook ? { crashHook } : {}),
  } as const;
}

function transactionId(fixture: Fixture) {
  return calculateLongTailPromotionSnapshotTransactionId({
    masterWorklistSha256: fixture.masterWorklistSha256,
    artifacts: fixture.artifacts,
  });
}

function transactionDirectory(fixture: Fixture) {
  return path.join(
    fixture.transactionRoot,
    "transactions",
    transactionId(fixture),
  );
}

function finalizeInput(
  fixture: Fixture,
  crashHook?: (point: LongTailPromotionSnapshotFinalizeFaultPoint) => void,
) {
  return {
    curatedRoot: fixture.curatedRoot,
    transactionRoot: fixture.transactionRoot,
    transactionId: transactionId(fixture),
    ...(crashHook ? { crashHook } : {}),
  } as const;
}

function transactionSnapshotRoot(fixture: Fixture, kind: "next" | "old") {
  return path.join(fixture.transactionRoot, `.${kind}-${transactionId(fixture)}`);
}

function replacementBackupPath(fixture: Fixture) {
  return path.join(
    transactionDirectory(fixture),
    "backups",
    "es",
    "legal__privacy.json",
  );
}

function assertExactReplacementBackup(
  fixture: Fixture,
  result: ReturnType<typeof promoteLongTailPromotionSnapshot>,
) {
  assert.equal(result.backups.length, 1);
  const backup = result.backups[0];
  assert.ok(backup);
  assert.equal(backup.targetRelativePath, "es/legal__privacy.json");
  assert.equal(backup.relativePath, "es/legal__privacy.json");
  assert.equal(backup.sha256, sha256(fixture.oldReplacement));
  assert.equal(
    backup.approvedExistingSha256,
    sha256(fixture.oldReplacement),
  );
  assert.equal(backup.priorSourceHash, sha256("old-source"));
  assert.equal(backup.newSourceHash, sha256("new-source"));
  assert.match(backup.approvalSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Buffer.from(backup.bytes), fixture.oldReplacement);
}

function assertCorpusStateIsWhole(fixture: Fixture) {
  if (!existsSync(fixture.curatedRoot)) return "absent" as const;
  const replacementPath = path.join(
    fixture.curatedRoot,
    "es",
    "legal__privacy.json",
  );
  const createdPath = path.join(fixture.curatedRoot, "es", "route__new.json");
  const retainedPath = path.join(fixture.curatedRoot, "es", "route__home.json");
  assert.deepEqual(readFileSync(retainedPath), fixture.retained);
  const replacement = readFileSync(replacementPath);
  if (replacement.equals(fixture.oldReplacement)) {
    assert.equal(existsSync(createdPath), false);
    return "old" as const;
  }
  assert.deepEqual(replacement, fixture.newReplacement);
  assert.deepEqual(readFileSync(createdPath), fixture.created);
  return "new" as const;
}

function createQualityStaleFixture(root: string) {
  const curatedRoot = path.join(root, "translations", "curated");
  const transactionRoot = path.join(root, "tmp", "quality-transactions");
  const targetRelativePath = "es/test__quality-stale.json";
  const targetPath = path.join(curatedRoot, targetRelativePath);
  const sourceHash = sha256("quality-current-source");
  const validatorPolicySha256 = sha256("quality-validator-policy");
  const priorBytes = jsonBytes({
    schemaVersion: 1,
    language: "Spanish",
    locale: "es",
    namespace: "test:quality-stale",
    sourceHash,
    translations: {
      title: "Aprende con Build confidence with práctica.",
    },
  });
  const targetBytes = jsonBytes({
    schemaVersion: 1,
    language: "Spanish",
    locale: "es",
    namespace: "test:quality-stale",
    sourceHash,
    translations: { title: "Aprende con práctica personalizada." },
  });
  mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  writeFileSync(targetPath, priorBytes, { mode: 0o600 });
  const artifacts: readonly LongTailPromotionSnapshotArtifact[] = Object.freeze([
    Object.freeze({
      targetRelativePath,
      targetBytes,
      checkpointRelativePath: `${sha256("quality-replacement-job")}.json`,
      checkpointBytes: jsonBytes({
        schemaVersion: 1,
        jobSha256: sha256("quality-replacement-job"),
        targetSha256: sha256(targetBytes),
      }),
      replacement: Object.freeze({
        kind: LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND,
        approvedExistingSha256: sha256(priorBytes),
        priorSourceHash: sourceHash,
        newSourceHash: sourceHash,
        validatorPolicySha256,
        backupRelativePath: targetRelativePath,
      }),
    }),
  ]);
  return Object.freeze({
    artifacts,
    curatedRoot,
    masterWorklistSha256: sha256("quality-master-worklist"),
    priorBytes,
    sourceHash,
    targetBytes,
    targetPath,
    targetRelativePath,
    transactionRoot,
    validatorPolicySha256,
  });
}

test("quality-stale recovery returns exact bytes with kind and validator evidence", (t) => {
  const fixture = createQualityStaleFixture(temporaryDirectory(t));
  const transactionId = calculateLongTailPromotionSnapshotTransactionId({
    masterWorklistSha256: fixture.masterWorklistSha256,
    artifacts: fixture.artifacts,
  });
  assert.throws(
    () => promoteLongTailPromotionSnapshot({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      masterWorklistSha256: fixture.masterWorklistSha256,
      artifacts: fixture.artifacts,
      crashHook: (point) => {
        if (point === "after-next-to-active-parent-fsync") {
          throw new Error("quality-activated-crash");
        }
      },
    }),
    /quality-activated-crash/,
  );
  assert.deepEqual(readFileSync(fixture.targetPath), fixture.targetBytes);

  const recovered = recoverLongTailPromotionSnapshot({
    curatedRoot: fixture.curatedRoot,
    transactionRoot: fixture.transactionRoot,
    transactionId,
  });
  assert.equal(recovered.outcome, "committed");
  assert.deepEqual(recovered.publications, {
    created: 0,
    replayed: 0,
    replaced: 1,
  });
  assert.equal(recovered.backups.length, 1);
  const backup = recovered.backups[0];
  assert.ok(backup);
  assert.equal(backup.targetRelativePath, fixture.targetRelativePath);
  assert.equal(backup.relativePath, fixture.targetRelativePath);
  assert.equal(
    backup.kind,
    LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND,
  );
  assert.equal(backup.sha256, sha256(fixture.priorBytes));
  assert.equal(backup.approvedExistingSha256, sha256(fixture.priorBytes));
  assert.equal(backup.priorSourceHash, fixture.sourceHash);
  assert.equal(backup.newSourceHash, fixture.sourceHash);
  assert.equal(
    backup.validatorPolicySha256,
    fixture.validatorPolicySha256,
  );
  assert.match(backup.approvalSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Buffer.from(backup.bytes), fixture.priorBytes);
});

test("quality-stale promotion rejects byte, source, policy, and kind drift", async (t) => {
  await t.test("exact prior bytes", () => {
    const fixture = createQualityStaleFixture(temporaryDirectory(t));
    const changed = Buffer.concat([fixture.priorBytes, Buffer.from("\n")]);
    writeFileSync(fixture.targetPath, changed);
    assert.throws(
      () => promoteLongTailPromotionSnapshot({
        curatedRoot: fixture.curatedRoot,
        transactionRoot: fixture.transactionRoot,
        masterWorklistSha256: fixture.masterWorklistSha256,
        artifacts: fixture.artifacts,
      }),
      /Refusing unapproved target replacement/,
    );
    assert.deepEqual(readFileSync(fixture.targetPath), changed);
  });

  await t.test("same-source approval", () => {
    const fixture = createQualityStaleFixture(temporaryDirectory(t));
    const artifact = fixture.artifacts[0];
    assert.ok(artifact?.replacement);
    const driftedArtifacts: readonly LongTailPromotionSnapshotArtifact[] = [
      Object.freeze({
        ...artifact,
        replacement: Object.freeze({
          ...artifact.replacement,
          newSourceHash: sha256("drifted-quality-source"),
        }),
      }),
    ];
    assert.throws(
      () => promoteLongTailPromotionSnapshot({
        curatedRoot: fixture.curatedRoot,
        transactionRoot: fixture.transactionRoot,
        masterWorklistSha256: fixture.masterWorklistSha256,
        artifacts: driftedArtifacts,
      }),
      /Quality-stale replacement must remain bound to the same source hash/,
    );
    assert.deepEqual(readFileSync(fixture.targetPath), fixture.priorBytes);
  });

  for (const tamper of [
    {
      label: "validator policy",
      find: (fixture: ReturnType<typeof createQualityStaleFixture>) =>
        fixture.validatorPolicySha256,
      replace: sha256("drifted-quality-validator-policy"),
    },
    {
      label: "replacement kind",
      find: () => LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND,
      replace: LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND,
    },
  ] as const) {
    await t.test(`recovery ${tamper.label}`, () => {
      const fixture = createQualityStaleFixture(temporaryDirectory(t));
      const transactionId = calculateLongTailPromotionSnapshotTransactionId({
        masterWorklistSha256: fixture.masterWorklistSha256,
        artifacts: fixture.artifacts,
      });
      assert.throws(
        () => promoteLongTailPromotionSnapshot({
          curatedRoot: fixture.curatedRoot,
          transactionRoot: fixture.transactionRoot,
          masterWorklistSha256: fixture.masterWorklistSha256,
          artifacts: fixture.artifacts,
          crashHook: (point) => {
            if (point === "after-next-to-active-parent-fsync") {
              throw new Error("quality-recovery-tamper-crash");
            }
          },
        }),
        /quality-recovery-tamper-crash/,
      );
      const preparedPath = path.join(
        fixture.transactionRoot,
        "transactions",
        transactionId,
        "PREPARED.json",
      );
      const prepared = readFileSync(preparedPath, "utf8");
      const tampered = prepared.replace(tamper.find(fixture), tamper.replace);
      assert.notEqual(tampered, prepared);
      writeFileSync(preparedPath, tampered, { mode: 0o600 });
      assert.throws(
        () => recoverLongTailPromotionSnapshot({
          curatedRoot: fixture.curatedRoot,
          transactionRoot: fixture.transactionRoot,
          transactionId,
        }),
      );
      assert.deepEqual(readFileSync(fixture.targetPath), fixture.targetBytes);
      assert.equal(
        existsSync(path.join(path.dirname(preparedPath), "COMMITTED.json")),
        false,
      );
    });
  }
});

test("snapshot promotion clones the complete corpus and commits create/replay/replace together", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const oldRetainedInode = lstatSync(
    path.join(fixture.curatedRoot, "es", "route__home.json"),
  ).ino;
  const result = promoteLongTailPromotionSnapshot(promotionInput(fixture));

  assert.equal(result.outcome, "committed");
  assert.deepEqual(result.publications, {
    created: 1,
    replayed: 1,
    replaced: 1,
  });
  assert.equal(assertCorpusStateIsWhole(fixture), "new");
  assert.ok(result.priorRoot);
  assert.deepEqual(
    readFileSync(path.join(result.priorRoot, "es", "legal__privacy.json")),
    fixture.oldReplacement,
  );
  assert.notEqual(
    lstatSync(path.join(fixture.curatedRoot, "es", "route__home.json")).ino,
    oldRetainedInode,
  );
  assert.equal(
    lstatSync(path.join(fixture.curatedRoot, "es", "route__home.json")).nlink,
    1,
  );
  assert.deepEqual(
    readFileSync(path.join(
      transactionDirectory(fixture),
      "backups",
      "es",
      "legal__privacy.json",
    )),
    fixture.oldReplacement,
  );
  assert.equal(result.checkpoints.length, 3);
  assertExactReplacementBackup(fixture, result);
  assert.deepEqual(
    readdirSync(fixture.curatedRoot, { withFileTypes: true }).map((entry) =>
      entry.name
    ),
    ["es"],
  );
  assert.equal(existsSync(path.join(transactionDirectory(fixture), "PREPARED.json")), true);
  assert.equal(existsSync(path.join(transactionDirectory(fixture), "COMMITTED.json")), true);
});

test("an exact transaction replay does not rewrite the active snapshot", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const first = promoteLongTailPromotionSnapshot(promotionInput(fixture));
  const activeInode = lstatSync(fixture.curatedRoot).ino;
  const activeBytes = readFileSync(
    path.join(fixture.curatedRoot, "es", "legal__privacy.json"),
  );

  const replay = promoteLongTailPromotionSnapshot(promotionInput(fixture));
  assert.equal(first.outcome, "committed");
  assert.equal(replay.outcome, "exact-replay");
  assert.equal(replay.transactionId, first.transactionId);
  assertExactReplacementBackup(fixture, replay);
  assert.equal(lstatSync(fixture.curatedRoot).ino, activeInode);
  assert.deepEqual(
    readFileSync(path.join(fixture.curatedRoot, "es", "legal__privacy.json")),
    activeBytes,
  );
});

test("semantic promotion rejects a curated-tree race before PREPARED can authorize it", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const semanticEvidence = semanticEvidenceForFixture(fixture);
  writeFileSync(
    path.join(fixture.curatedRoot, "es", "route__home.json"),
    jsonBytes({ changed: "after-audit" }),
  );
  assert.throws(
    () => promoteLongTailPromotionSnapshot({
      ...promotionInput(fixture),
      semanticEvidence,
    }),
    /changed after semantic verification and before promotion/,
  );
  assert.equal(
    existsSync(path.join(fixture.curatedRoot, "es", "route__new.json")),
    false,
  );
});

test("semantic promotion rejects same-size non-target drift in the staged tree before PREPARED", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const semanticEvidence = semanticEvidenceForFixture(fixture);
  const semanticTransactionId = calculateLongTailPromotionSnapshotTransactionId({
    masterWorklistSha256: fixture.masterWorklistSha256,
    artifacts: fixture.artifacts,
    semanticEvidence,
  });
  const nextNonTarget = path.join(
    fixture.transactionRoot,
    `.next-${semanticTransactionId}`,
    "es",
    "route__home.json",
  );
  const drifted = Buffer.from(fixture.retained);
  const changedOffset = drifted.indexOf("Aprende");
  assert.notEqual(changedOffset, -1);
  drifted[changedOffset] = "B".charCodeAt(0);
  assert.equal(drifted.length, fixture.retained.length);

  assert.throws(
    () => promoteLongTailPromotionSnapshot({
      ...promotionInput(fixture),
      semanticEvidence,
      crashHook: (point) => {
        if (point === "after-artifacts-before-next-validation") {
          writeFileSync(nextNonTarget, drifted);
        }
      },
    }),
    /changes outside the exact authorized artifact set/,
  );
  assert.deepEqual(
    readFileSync(path.join(fixture.curatedRoot, "es", "route__home.json")),
    fixture.retained,
  );
  assert.equal(
    existsSync(path.join(
      fixture.transactionRoot,
      "transactions",
      semanticTransactionId,
      "PREPARED.json",
    )),
    false,
  );
  assert.equal(
    existsSync(path.join(fixture.curatedRoot, "es", "route__new.json")),
    false,
  );
});

test("semantic promotion rechecks the site-source catalog at both activation rename boundaries", async (t) => {
  for (const boundary of [
    "before-active-to-old-rename",
    "before-next-to-active-rename",
  ] as const) {
    await t.test(boundary, () => {
      const fixture = createFixture(temporaryDirectory(t));
      const semanticEvidence = semanticEvidenceForFixture(fixture);
      const siteSourceManifestPath = path.join(
        path.dirname(path.dirname(fixture.curatedRoot)),
        "lib/i18n/site-source-manifest.ts",
      );
      const originalCatalog = readFileSync(siteSourceManifestPath);
      assert.throws(
        () => promoteLongTailPromotionSnapshot({
          ...promotionInput(fixture),
          semanticEvidence,
          crashHook: (point) => {
            if (point === boundary) {
              const priorValue = "Fixture source 0";
              const nextValue = "Changed fixture source zero";
              const priorHash = sha256(`site.fixture.0\u0000${priorValue}`);
              const nextHash = sha256(`site.fixture.0\u0000${nextValue}`);
              const driftedCatalog = originalCatalog.toString("utf8")
                .replace(priorValue, nextValue)
                .replace(priorHash, nextHash);
              writeFileSync(
                siteSourceManifestPath,
                driftedCatalog,
              );
            }
          },
        }),
        /site source catalog changed/i,
      );
      if (boundary === "before-active-to-old-rename") {
        assert.equal(assertCorpusStateIsWhole(fixture), "old");
      } else {
        assert.equal(assertCorpusStateIsWhole(fixture), "absent");
        const transactionEntries = readdirSync(fixture.transactionRoot);
        assert.equal(
          transactionEntries.some((entry) => entry.startsWith(".old-")),
          true,
        );
        assert.equal(
          transactionEntries.some((entry) => entry.startsWith(".next-")),
          true,
        );
      }
      writeFileSync(siteSourceManifestPath, originalCatalog);
      const recovered = promoteLongTailPromotionSnapshot({
        ...promotionInput(fixture),
        semanticEvidence,
      });
      assert.equal(recovered.outcome, "committed");
      assert.equal(assertCorpusStateIsWhole(fixture), "new");
    });
  }
});

test("semantic promotion rechecks the site-source catalog across COMMITTED durability", async (t) => {
  for (const boundary of [
    "before-committed-rename",
    "after-committed-parent-fsync",
  ] as const) {
    await t.test(boundary, () => {
      const fixture = createFixture(temporaryDirectory(t));
      const semanticEvidence = semanticEvidenceForFixture(fixture);
      let drift: ReturnType<typeof driftSiteSourceCatalog> | undefined;
      assert.throws(
        () => promoteLongTailPromotionSnapshot({
          ...promotionInput(fixture),
          semanticEvidence,
          crashHook: (point) => {
            if (point === boundary && !drift) {
              drift = driftSiteSourceCatalog(fixture);
            }
          },
        }),
        /site source catalog changed/i,
      );
      assert.ok(drift);
      writeFileSync(drift.path, drift.original);

      const recovered = promoteLongTailPromotionSnapshot({
        ...promotionInput(fixture),
        semanticEvidence,
      });
      assert.ok(
        recovered.outcome === "committed" ||
          recovered.outcome === "exact-replay",
      );
      assert.equal(assertCorpusStateIsWhole(fixture), "new");
    });
  }
});

test("semantic finalization rechecks the site-source catalog across prior retention", async (t) => {
  for (const boundary of [
    "before-finalize-prior-retain",
    "after-finalize-prior-retain-parent-fsync",
  ] as const) {
    await t.test(boundary, () => {
      const fixture = createFixture(temporaryDirectory(t));
      const semanticEvidence = semanticEvidenceForFixture(fixture);
      const promoted = promoteLongTailPromotionSnapshot({
        ...promotionInput(fixture),
        semanticEvidence,
      });
      let drift: ReturnType<typeof driftSiteSourceCatalog> | undefined;
      assert.throws(
        () => finalizeLongTailPromotionSnapshot({
          curatedRoot: fixture.curatedRoot,
          transactionRoot: fixture.transactionRoot,
          transactionId: promoted.transactionId,
          crashHook: (point) => {
            if (point === boundary && !drift) {
              drift = driftSiteSourceCatalog(fixture);
            }
          },
        }),
        /site source catalog changed/i,
      );
      assert.ok(drift);
      writeFileSync(drift.path, drift.original);

      const recovered = finalizeLongTailPromotionSnapshot({
        curatedRoot: fixture.curatedRoot,
        transactionRoot: fixture.transactionRoot,
        transactionId: promoted.transactionId,
      });
      assert.ok(
        recovered.outcome === "finalized" ||
          recovered.outcome === "exact-replay",
      );
      assert.equal(assertCorpusStateIsWhole(fixture), "new");
    });
  }
});

test("semantic journal validation rejects a changed site-source catalog", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const semanticEvidence = semanticEvidenceForFixture(fixture);
  const promoted = promoteLongTailPromotionSnapshot({
    ...promotionInput(fixture),
    semanticEvidence,
  });
  finalizeLongTailPromotionSnapshot({
    curatedRoot: fixture.curatedRoot,
    transactionRoot: fixture.transactionRoot,
    transactionId: promoted.transactionId,
  });

  const drift = driftSiteSourceCatalog(fixture);
  assert.throws(
    () => readAndValidateLongTailPromotionJournal({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: promoted.transactionId,
      expectedSemanticEvidence: semanticEvidence,
    }),
    /site source catalog changed/i,
  );
  writeFileSync(drift.path, drift.original);
  assert.equal(
    readAndValidateLongTailPromotionJournal({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: promoted.transactionId,
      expectedSemanticEvidence: semanticEvidence,
    }).transactionId,
    promoted.transactionId,
  );
});

test("finalized semantic promotion recovers exactly by artifacts and rejects a forged journal", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const workbenchFile = path.join(
    fixture.curatedRoot,
    "es",
    "main-app.part-001.json",
  );
  const workbenchBytes = jsonBytes({ optional: "preserve me" });
  writeFileSync(workbenchFile, workbenchBytes);
  const semanticEvidence = semanticEvidenceForFixture(fixture);
  const promoted = promoteLongTailPromotionSnapshot({
    ...promotionInput(fixture),
    semanticEvidence,
  });
  assert.deepEqual(readFileSync(workbenchFile), workbenchBytes);
  finalizeLongTailPromotionSnapshot({
    curatedRoot: fixture.curatedRoot,
    transactionRoot: fixture.transactionRoot,
    transactionId: promoted.transactionId,
  });
  const recovered = recoverLongTailPromotionSnapshotByExactArtifacts({
    ...promotionInput(fixture),
    expectedSemanticEvidenceKind:
      TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  });
  assert.equal(recovered.outcome, "exact-replay");
  assert.equal(
    recovered.semanticEvidence?.semanticEvidenceSha256,
    semanticEvidence.semanticEvidenceSha256,
  );

  const preparedPath = path.join(
    fixture.transactionRoot,
    "transactions",
    promoted.transactionId,
    "PREPARED.json",
  );
  const forgedValue: unknown = JSON.parse(readFileSync(preparedPath, "utf8"));
  assert.ok(isRecord(forgedValue));
  const forgedEvidence = forgedValue.semanticEvidence;
  assert.ok(isRecord(forgedEvidence));
  forgedEvidence.manifestSha256 = sha256("forged-manifest");
  forgedEvidence.semanticEvidenceSha256 =
    sha256CanonicalTranslationAuditJson(
      Object.fromEntries(
        Object.entries(forgedEvidence).filter(
          ([key]) => key !== "semanticEvidenceSha256",
        ),
      ),
    );
  forgedValue.preparedSha256 = sha256CanonicalTranslationAuditJson(
    Object.fromEntries(
      Object.entries(forgedValue).filter(([key]) => key !== "preparedSha256"),
    ),
  );
  writeFileSync(preparedPath, jsonBytes(forgedValue));
  assert.throws(
    () => recoverLongTailPromotionSnapshotByExactArtifacts({
      ...promotionInput(fixture),
      expectedSemanticEvidenceKind:
        TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
    }),
    /transaction identity is invalid|forged transaction identity/,
  );
});

test("finalized journal validation rejects a recomputed post tree outside the artifact contract", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const semanticEvidence = semanticEvidenceForFixture(fixture);
  const promoted = promoteLongTailPromotionSnapshot({
    ...promotionInput(fixture),
    semanticEvidence,
  });
  finalizeLongTailPromotionSnapshot({
    curatedRoot: fixture.curatedRoot,
    transactionRoot: fixture.transactionRoot,
    transactionId: promoted.transactionId,
  });

  const nonTarget = path.join(
    fixture.curatedRoot,
    "es",
    "route__home.json",
  );
  const drifted = Buffer.from(readFileSync(nonTarget));
  const changedOffset = drifted.indexOf("Aprende");
  assert.notEqual(changedOffset, -1);
  drifted[changedOffset] = "B".charCodeAt(0);
  writeFileSync(nonTarget, drifted);
  const forgedPostTree = calculateTranslationSemanticAuditTreeEvidence({
    root: fixture.curatedRoot,
    ignoreMainAppWorkbench: true,
  });

  const journalRoot = path.join(
    fixture.transactionRoot,
    "transactions",
    promoted.transactionId,
  );
  const preparedPath = path.join(journalRoot, "PREPARED.json");
  const committedPath = path.join(journalRoot, "COMMITTED.json");
  const preparedValue = JSON.parse(readFileSync(preparedPath, "utf8")) as unknown;
  assert.ok(isRecord(preparedValue));
  preparedValue.nextSiteTree = forgedPostTree;
  preparedValue.preparedSha256 = sha256CanonicalTranslationAuditJson(
    Object.fromEntries(
      Object.entries(preparedValue).filter(
        ([key]) => key !== "preparedSha256",
      ),
    ),
  );
  writeFileSync(preparedPath, jsonBytes(preparedValue));

  const committedValue = JSON.parse(
    readFileSync(committedPath, "utf8"),
  ) as unknown;
  assert.ok(isRecord(committedValue));
  committedValue.preparedSha256 = preparedValue.preparedSha256;
  committedValue.activeSiteTree = forgedPostTree;
  committedValue.committedSha256 = sha256CanonicalTranslationAuditJson(
    Object.fromEntries(
      Object.entries(committedValue).filter(
        ([key]) => key !== "committedSha256",
      ),
    ),
  );
  writeFileSync(committedPath, jsonBytes(committedValue));

  assert.throws(
    () => readAndValidateLongTailPromotionJournal({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: promoted.transactionId,
      expectedSemanticEvidence: semanticEvidence,
    }),
    /do not derive the PREPARED post tree/,
  );
  assert.throws(
    () => assertLongTailPromotionSnapshotTransactionRootSettled({
      transactionRoot: fixture.transactionRoot,
    }),
    /do not derive the PREPARED post tree/,
  );
});

test("workbench target descriptors retain their inode and remain live after finalization", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const workbenchPath = path.join(
    fixture.curatedRoot,
    "es",
    "main-app.json",
  );
  writeFileSync(workbenchPath, jsonBytes({ revision: "before-promotion" }));
  const descriptor = openSync(workbenchPath, "r+");
  try {
    const original = fstatSync(descriptor, { bigint: true });
    const promoted = promoteLongTailPromotionSnapshot(promotionInput(fixture));
    const afterPromotion = lstatSync(workbenchPath, { bigint: true });
    assert.equal(afterPromotion.dev, original.dev);
    assert.equal(afterPromotion.ino, original.ino);

    finalizeLongTailPromotionSnapshot({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: promoted.transactionId,
    });
    const afterFinalization = lstatSync(workbenchPath, { bigint: true });
    assert.equal(afterFinalization.dev, original.dev);
    assert.equal(afterFinalization.ino, original.ino);

    const lateBytes = jsonBytes({ revision: "written-after-finalization" });
    writeExactThroughDescriptor(descriptor, lateBytes);
    assert.deepEqual(readFileSync(workbenchPath), lateBytes);
    assert.equal(
      existsSync(path.join(
        transactionDirectory(fixture),
        "RETAINED_PRIOR",
        "es",
        "main-app.json",
      )),
      false,
    );
    assertLongTailPromotionSnapshotTransactionRootSettled({
      transactionRoot: fixture.transactionRoot,
    });
  } finally {
    closeSync(descriptor);
  }
});

test("atomic-save recreation at either carrier boundary preserves both versions without COMMITTED", async (t) => {
  for (const faultPoint of [
    "after-workbench-source-to-carrier-rename",
    "after-workbench-carrier-link-before-unlink",
  ] as const) {
    await t.test(faultPoint, (subtest) => {
      const fixture = createFixture(temporaryDirectory(subtest));
      const publicWorkbenchPath = path.join(
        fixture.curatedRoot,
        "es",
        "main-app.json",
      );
      const originalBytes = jsonBytes({ revision: "original-inode" });
      const replacementBytes = jsonBytes({ revision: "atomic-save" });
      writeFileSync(publicWorkbenchPath, originalBytes);
      const original = lstatSync(publicWorkbenchPath, { bigint: true });
      const oldWorkbenchPath = path.join(
        transactionSnapshotRoot(fixture, "old"),
        "es",
        "main-app.json",
      );
      const carrierPath = path.join(
        transactionDirectory(fixture),
        "WORKBENCH_CARRIER",
        "es",
        "main-app.json",
      );
      const nextWorkbenchPath = path.join(
        transactionSnapshotRoot(fixture, "next"),
        "es",
        "main-app.json",
      );
      let injected = false;

      assert.throws(
        () => promoteLongTailPromotionSnapshot(promotionInput(
          fixture,
          (point) => {
            if (point !== faultPoint) return;
            const temporary = `${oldWorkbenchPath}.atomic-save`;
            writeFileSync(temporary, replacementBytes);
            renameSync(temporary, oldWorkbenchPath);
            injected = true;
          },
        )),
        /recreated during transfer|public source reappeared/,
      );
      assert.equal(injected, true);
      assert.deepEqual(readFileSync(oldWorkbenchPath), replacementBytes);
      assert.deepEqual(readFileSync(carrierPath), originalBytes);
      const carrier = lstatSync(carrierPath, { bigint: true });
      assert.equal(carrier.dev, original.dev);
      assert.equal(carrier.ino, original.ino);
      assert.notEqual(
        lstatSync(oldWorkbenchPath, { bigint: true }).ino,
        original.ino,
      );
      if (faultPoint === "after-workbench-carrier-link-before-unlink") {
        assert.deepEqual(readFileSync(nextWorkbenchPath), originalBytes);
        const next = lstatSync(nextWorkbenchPath, { bigint: true });
        assert.equal(next.dev, original.dev);
        assert.equal(next.ino, original.ino);
      } else {
        assert.equal(existsSync(nextWorkbenchPath), false);
      }
      assert.equal(
        existsSync(path.join(transactionDirectory(fixture), "COMMITTED.json")),
        false,
      );

      assert.throws(
        () => recoverLongTailPromotionSnapshot({
          curatedRoot: fixture.curatedRoot,
          transactionRoot: fixture.transactionRoot,
          transactionId: transactionId(fixture),
        }),
        /public\/private conflict/,
      );
      assert.deepEqual(readFileSync(oldWorkbenchPath), replacementBytes);
      assert.deepEqual(readFileSync(carrierPath), originalBytes);
      assert.equal(
        existsSync(path.join(transactionDirectory(fixture), "COMMITTED.json")),
        false,
      );
    });
  }
});

test("a stale prior-directory cwd writes only into retained evidence and blocks settlement", async (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const promoted = promoteLongTailPromotionSnapshot(promotionInput(fixture));
  const oldRoot = transactionSnapshotRoot(fixture, "old");
  const oldRootIdentity = lstatSync(oldRoot, { bigint: true });
  const oldLocaleRoot = path.join(oldRoot, "es");
  const lateBytes = jsonBytes({ late: "stale-prior-cwd" });
  const childSource = String.raw`
    const fs = require("node:fs");
    const localeRoot = process.argv[1];
    const encoded = process.argv[2];
    if (!localeRoot || !encoded || !process.send) process.exit(2);
    process.chdir(localeRoot);
    process.send("ready");
    process.on("message", (message) => {
      if (message !== "write") return;
      try {
        const descriptor = fs.openSync("main-app.part-late.json", "w", 0o600);
        try {
          fs.writeFileSync(descriptor, Buffer.from(encoded, "base64"));
          fs.fsyncSync(descriptor);
        } finally {
          fs.closeSync(descriptor);
        }
        process.send("done", () => process.exit(0));
      } catch (error) {
        console.error(error);
        process.exit(3);
      }
    });
  `;
  let child: ChildProcess | undefined;
  try {
    child = spawn(
      process.execPath,
      ["-e", childSource, oldLocaleRoot, lateBytes.toString("base64")],
      { stdio: ["ignore", "ignore", "inherit", "ipc"] },
    );
    const exit = once(child, "exit");
    const [ready] = await once(child, "message");
    assert.equal(ready, "ready");

    finalizeLongTailPromotionSnapshot({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: promoted.transactionId,
    });
    const retainedRoot = path.join(
      transactionDirectory(fixture),
      "RETAINED_PRIOR",
    );
    const retainedIdentity = lstatSync(retainedRoot, { bigint: true });
    assert.equal(retainedIdentity.dev, oldRootIdentity.dev);
    assert.equal(retainedIdentity.ino, oldRootIdentity.ino);

    const done = once(child, "message");
    child.send("write");
    const [message] = await done;
    assert.equal(message, "done");
    const [exitCode, signal] = await exit;
    assert.equal(exitCode, 0, `stale cwd child exited via ${String(signal)}`);

    const retainedLatePath = path.join(
      retainedRoot,
      "es",
      "main-app.part-late.json",
    );
    assert.deepEqual(readFileSync(retainedLatePath), lateBytes);
    assert.equal(
      existsSync(path.join(
        fixture.curatedRoot,
        "es",
        "main-app.part-late.json",
      )),
      false,
    );
    assert.throws(
      () => assertLongTailPromotionSnapshotTransactionRootSettled({
        transactionRoot: fixture.transactionRoot,
      }),
      /workbench file/,
    );
    assert.deepEqual(readFileSync(retainedLatePath), lateBytes);
  } finally {
    if (child && child.exitCode === null) {
      const exit = once(child, "exit");
      child.kill();
      await exit;
    }
  }
});

test("recovery after directory activation returns the exact durable original backup", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  assert.throws(
    () => promoteLongTailPromotionSnapshot(promotionInput(
      fixture,
      (point) => {
        if (point === "after-next-to-active-parent-fsync") {
          throw new Error("crash-after-directory-commit");
        }
      },
    )),
    /crash-after-directory-commit/,
  );
  assert.equal(assertCorpusStateIsWhole(fixture), "new");
  assert.equal(
    existsSync(path.join(transactionDirectory(fixture), "COMMITTED.json")),
    false,
  );

  const recovered = recoverLongTailPromotionSnapshot({
    curatedRoot: fixture.curatedRoot,
    transactionRoot: fixture.transactionRoot,
    transactionId: transactionId(fixture),
  });
  assert.equal(recovered.outcome, "committed");
  assertExactReplacementBackup(fixture, recovered);
  assert.throws(
    () => assertLongTailPromotionSnapshotTransactionRootSettled({
      transactionRoot: fixture.transactionRoot,
    }),
    /not finalized to RETAINED_PRIOR|unfinalized promotion snapshot/,
  );
  finalizeLongTailPromotionSnapshot({
    curatedRoot: fixture.curatedRoot,
    transactionRoot: fixture.transactionRoot,
    transactionId: recovered.transactionId,
  });
  assertLongTailPromotionSnapshotTransactionRootSettled({
    transactionRoot: fixture.transactionRoot,
  });
});

test("recovery rejects adversarial replacement backup changes", async (t) => {
  const prepareActivatedFixture = (fixture: Fixture) => {
    assert.throws(
      () => promoteLongTailPromotionSnapshot(promotionInput(
        fixture,
        (point) => {
          if (point === "after-next-to-active-parent-fsync") {
            throw new Error("activated-crash");
          }
        },
      )),
      /activated-crash/,
    );
    assert.equal(assertCorpusStateIsWhole(fixture), "new");
  };

  await t.test("changed bytes", () => {
    const fixture = createFixture(temporaryDirectory(t));
    prepareActivatedFixture(fixture);
    writeFileSync(
      replacementBackupPath(fixture),
      jsonBytes({ adversarial: "replacement" }),
    );
    assert.throws(
      () => recoverLongTailPromotionSnapshot({
        curatedRoot: fixture.curatedRoot,
        transactionRoot: fixture.transactionRoot,
        transactionId: transactionId(fixture),
      }),
      /Replacement backup or approval changed/,
    );
    assert.equal(assertCorpusStateIsWhole(fixture), "new");
    assert.equal(
      existsSync(path.join(transactionDirectory(fixture), "COMMITTED.json")),
      false,
    );
  });

  await t.test("symbolic link", () => {
    const fixture = createFixture(temporaryDirectory(t));
    prepareActivatedFixture(fixture);
    const backupPath = replacementBackupPath(fixture);
    rmSync(backupPath);
    symlinkSync(
      path.join(
        transactionSnapshotRoot(fixture, "old"),
        "es",
        "legal__privacy.json",
      ),
      backupPath,
    );
    assert.throws(
      () => recoverLongTailPromotionSnapshot({
        curatedRoot: fixture.curatedRoot,
        transactionRoot: fixture.transactionRoot,
        transactionId: transactionId(fixture),
      }),
      /ELOOP|symbolic link/,
    );
    assert.equal(assertCorpusStateIsWhole(fixture), "new");
  });

  await t.test("hard link", () => {
    const fixture = createFixture(temporaryDirectory(t));
    prepareActivatedFixture(fixture);
    const backupPath = replacementBackupPath(fixture);
    rmSync(backupPath);
    linkSync(
      path.join(
        transactionSnapshotRoot(fixture, "old"),
        "es",
        "legal__privacy.json",
      ),
      backupPath,
    );
    assert.throws(
      () => recoverLongTailPromotionSnapshot({
        curatedRoot: fixture.curatedRoot,
        transactionRoot: fixture.transactionRoot,
        transactionId: transactionId(fixture),
      }),
      /single-link/,
    );
    assert.equal(assertCorpusStateIsWhole(fixture), "new");
  });
});

test("finalization retains the prior snapshot as durable evidence and is idempotent", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  promoteLongTailPromotionSnapshot(promotionInput(fixture));
  const activeInode = lstatSync(fixture.curatedRoot).ino;
  const oldRoot = transactionSnapshotRoot(fixture, "old");
  const nextRoot = transactionSnapshotRoot(fixture, "next");
  assert.equal(existsSync(oldRoot), true);
  assert.equal(existsSync(nextRoot), false);

  const finalized = finalizeLongTailPromotionSnapshot(finalizeInput(fixture));
  assert.deepEqual(finalized, {
    transactionId: transactionId(fixture),
    outcome: "finalized",
    activeTreeSha256: finalized.activeTreeSha256,
    removedNextRoot: false,
    movedPriorRoot: true,
    retainedPriorRoot: path.join(
      transactionDirectory(fixture),
      "RETAINED_PRIOR",
    ),
  });
  assert.equal(existsSync(oldRoot), false);
  assert.equal(existsSync(nextRoot), false);
  assert.equal(lstatSync(fixture.curatedRoot).ino, activeInode);
  assert.equal(assertCorpusStateIsWhole(fixture), "new");

  const evidenceRoot = transactionDirectory(fixture);
  assert.equal(existsSync(path.join(evidenceRoot, "PREPARED.json")), true);
  assert.equal(existsSync(path.join(evidenceRoot, "COMMITTED.json")), true);
  assert.equal(existsSync(path.join(evidenceRoot, "RETAINED_PRIOR")), true);
  assert.equal(existsSync(path.join(evidenceRoot, "checkpoints")), true);
  assert.deepEqual(
    readFileSync(path.join(
      evidenceRoot,
      "backups",
      "es",
      "legal__privacy.json",
    )),
    fixture.oldReplacement,
  );

  const replay = finalizeLongTailPromotionSnapshot(finalizeInput(fixture));
  assert.equal(replay.outcome, "exact-replay");
  assert.equal(replay.removedNextRoot, false);
  assert.equal(replay.movedPriorRoot, false);
  assert.equal(lstatSync(fixture.curatedRoot).ino, activeInode);
});

test("every finalize interruption is safely retryable", async (t) => {
  for (const faultPoint of longTailPromotionSnapshotFinalizeFaultPoints) {
    await t.test(faultPoint, () => {
      const fixture = createFixture(temporaryDirectory(t));
      promoteLongTailPromotionSnapshot(promotionInput(fixture));
      assert.throws(
        () => finalizeLongTailPromotionSnapshot(finalizeInput(
          fixture,
          (point) => {
            if (point === faultPoint) throw new Error(`crash:${point}`);
          },
        )),
        new RegExp(`crash:${faultPoint}`),
      );
      assert.equal(assertCorpusStateIsWhole(fixture), "new");

      const replay = finalizeLongTailPromotionSnapshot(finalizeInput(fixture));
      assert.ok(
        replay.outcome === "finalized" || replay.outcome === "exact-replay",
      );
      assert.equal(
        existsSync(transactionSnapshotRoot(fixture, "next")),
        false,
      );
      assert.equal(
        existsSync(transactionSnapshotRoot(fixture, "old")),
        false,
      );
      assert.equal(
        existsSync(path.join(transactionDirectory(fixture), "checkpoints")),
        true,
      );
      assert.equal(
        existsSync(path.join(transactionDirectory(fixture), "backups")),
        true,
      );
    });
  }
});

test("every injected journal/root rename crash recovers without a mixed corpus", async (t) => {
  for (const faultPoint of longTailPromotionSnapshotFaultPoints) {
    await t.test(faultPoint, () => {
      const fixture = createFixture(temporaryDirectory(t));
      const workbenchFile = path.join(
        fixture.curatedRoot,
        "es",
        "main-app.json",
      );
      const workbenchBytes = jsonBytes({ faultPoint });
      writeFileSync(workbenchFile, workbenchBytes);
      assert.throws(
        () => promoteLongTailPromotionSnapshot(promotionInput(
          fixture,
          (point) => {
            if (point === faultPoint) throw new Error(`crash:${point}`);
          },
        )),
        new RegExp(`crash:${faultPoint}`),
      );
      assert.ok(["old", "absent", "new"].includes(assertCorpusStateIsWhole(fixture)));

      const preparedPath = path.join(
        transactionDirectory(fixture),
        "PREPARED.json",
      );
      const recovered = existsSync(preparedPath)
        ? recoverLongTailPromotionSnapshot({
            curatedRoot: fixture.curatedRoot,
            transactionRoot: fixture.transactionRoot,
            transactionId: transactionId(fixture),
          })
        : promoteLongTailPromotionSnapshot(promotionInput(fixture));
      assert.ok(
        recovered.outcome === "committed" ||
          recovered.outcome === "exact-replay",
      );
      assertExactReplacementBackup(fixture, recovered);
      assert.equal(assertCorpusStateIsWhole(fixture), "new");
      assert.equal(
        existsSync(path.join(transactionDirectory(fixture), "COMMITTED.json")),
        true,
      );
      assert.deepEqual(readFileSync(workbenchFile), workbenchBytes);
    });
  }
});

test("recovery rejects a changed checkpoint and leaves the old corpus active", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  assert.throws(
    () => promoteLongTailPromotionSnapshot(promotionInput(
      fixture,
      (point) => {
        if (point === "before-active-to-old-rename") {
          throw new Error("prepared-crash");
        }
      },
    )),
    /prepared-crash/,
  );
  const checkpoint = fixture.artifacts[0]?.checkpointRelativePath;
  assert.ok(checkpoint);
  writeFileSync(
    path.join(transactionDirectory(fixture), "checkpoints", checkpoint),
    jsonBytes({ corrupted: true }),
  );
  assert.throws(
    () => recoverLongTailPromotionSnapshot({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: transactionId(fixture),
    }),
    /Checkpoint receipt changed/,
  );
  assert.equal(assertCorpusStateIsWhole(fixture), "old");
});

test("active symlinks and hardlinks are rejected before PREPARED", async (t) => {
  await t.test("symlink", () => {
    const fixture = createFixture(temporaryDirectory(t));
    const link = path.join(fixture.curatedRoot, "es", "linked.json");
    symlinkSync("route__home.json", link);
    assert.throws(
      () => promoteLongTailPromotionSnapshot(promotionInput(fixture)),
      /symbolic link/,
    );
    assert.equal(
      existsSync(path.join(transactionDirectory(fixture), "PREPARED.json")),
      false,
    );
  });

  await t.test("hardlink", () => {
    const fixture = createFixture(temporaryDirectory(t));
    linkSync(
      path.join(fixture.curatedRoot, "es", "route__home.json"),
      path.join(fixture.curatedRoot, "es", "route__home-hardlink.json"),
    );
    assert.throws(
      () => promoteLongTailPromotionSnapshot(promotionInput(fixture)),
      /single-link/,
    );
    assert.equal(
      existsSync(path.join(transactionDirectory(fixture), "PREPARED.json")),
      false,
    );
  });
});

test("unsafe and portable-case-colliding artifact paths are rejected", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const base = fixture.artifacts[0];
  assert.ok(base);
  assert.throws(
    () => promoteLongTailPromotionSnapshot({
      ...promotionInput(fixture),
      artifacts: [{ ...base, targetRelativePath: "../escape.json" }],
    }),
    /normalized, relative POSIX syntax/,
  );
  assert.throws(
    () => promoteLongTailPromotionSnapshot({
      ...promotionInput(fixture),
      artifacts: [
        { ...base, targetRelativePath: "es/Case.json" },
        {
          ...fixture.artifacts[1]!,
          targetRelativePath: "es/case.json",
        },
      ],
    }),
    /portable-case-colliding target path/,
  );
  for (const relativePath of [
    "es/main-app.json",
    "es/main-app.part-001.json",
    "es/main-app.part-final.json",
  ]) {
    assert.equal(isTranslationSemanticMainAppWorkbenchPath(relativePath), true);
    assert.throws(
      () => promoteLongTailPromotionSnapshot({
        ...promotionInput(fixture),
        artifacts: [{ ...base, targetRelativePath: relativePath }],
      }),
      /cannot target ignored main-app workbench paths/,
    );
  }
  assert.equal(
    isTranslationSemanticMainAppWorkbenchPath(
      "nested/es/main-app.part-001.json",
    ),
    false,
  );
});

test("an unapproved overwrite fails without touching the live corpus", (t) => {
  const fixture = createFixture(temporaryDirectory(t));
  const replacement = fixture.artifacts[0];
  assert.ok(replacement);
  const unapproved: LongTailPromotionSnapshotArtifact = {
    targetRelativePath: replacement.targetRelativePath,
    targetBytes: replacement.targetBytes,
    checkpointRelativePath: replacement.checkpointRelativePath,
    checkpointBytes: replacement.checkpointBytes,
  };
  assert.throws(
    () => promoteLongTailPromotionSnapshot({
      ...promotionInput(fixture),
      artifacts: [unapproved],
    }),
    /Refusing unapproved target replacement/,
  );
  assert.equal(assertCorpusStateIsWhole(fixture), "old");
});

test("the read-only settlement assertion rejects unresolved transaction state", async (t) => {
  await t.test("settled transaction", () => {
    const fixture = createFixture(temporaryDirectory(t));
    const promoted = promoteLongTailPromotionSnapshot(promotionInput(fixture));
    finalizeLongTailPromotionSnapshot({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: promoted.transactionId,
    });
    assertLongTailPromotionSnapshotTransactionRootSettled({
      transactionRoot: fixture.transactionRoot,
    });
  });

  await t.test("COMMITTED before caller finalization", () => {
    const fixture = createFixture(temporaryDirectory(t));
    const promoted = promoteLongTailPromotionSnapshot(promotionInput(fixture));
    assert.throws(
      () => assertLongTailPromotionSnapshotTransactionRootSettled({
        transactionRoot: fixture.transactionRoot,
      }),
      /not finalized to RETAINED_PRIOR|unfinalized promotion snapshot/,
    );
    finalizeLongTailPromotionSnapshot({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: promoted.transactionId,
    });
    assertLongTailPromotionSnapshotTransactionRootSettled({
      transactionRoot: fixture.transactionRoot,
    });
  });

  await t.test("PREPARED without COMMITTED", () => {
    const fixture = createFixture(temporaryDirectory(t));
    assert.throws(
      () => promoteLongTailPromotionSnapshot(promotionInput(
        fixture,
        (point) => {
          if (point === "before-committed-rename") {
            throw new Error("uncommitted-crash");
          }
        },
      )),
      /uncommitted-crash/,
    );
    const preparedPath = path.join(
      transactionDirectory(fixture),
      "PREPARED.json",
    );
    const preparedBefore = readFileSync(preparedPath);
    assert.throws(
      () => assertLongTailPromotionSnapshotTransactionRootSettled({
        transactionRoot: fixture.transactionRoot,
      }),
      /PREPARED without COMMITTED/,
    );
    assert.deepEqual(readFileSync(preparedPath), preparedBefore);

    const recovered = recoverLongTailPromotionSnapshot({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: transactionId(fixture),
    });
    finalizeLongTailPromotionSnapshot({
      curatedRoot: fixture.curatedRoot,
      transactionRoot: fixture.transactionRoot,
      transactionId: recovered.transactionId,
    });
    assertLongTailPromotionSnapshotTransactionRootSettled({
      transactionRoot: fixture.transactionRoot,
    });
  });

  await t.test("unresolved lock", () => {
    const fixture = createFixture(temporaryDirectory(t));
    mkdirSync(fixture.transactionRoot, { recursive: true, mode: 0o700 });
    const lockPath = path.join(fixture.transactionRoot, "PROMOTION.lock");
    const lockBytes = Buffer.from("unresolved-lock\n", "utf8");
    writeFileSync(lockPath, lockBytes, { mode: 0o600 });
    assert.throws(
      () => assertLongTailPromotionSnapshotTransactionRootSettled({
        transactionRoot: fixture.transactionRoot,
      }),
      /unresolved promotion lock/,
    );
    assert.deepEqual(readFileSync(lockPath), lockBytes);
  });

  await t.test("invalid committed journal", () => {
    const fixture = createFixture(temporaryDirectory(t));
    promoteLongTailPromotionSnapshot(promotionInput(fixture));
    const committedPath = path.join(
      transactionDirectory(fixture),
      "COMMITTED.json",
    );
    const invalid = jsonBytes({ adversarial: true });
    writeFileSync(committedPath, invalid);
    assert.throws(
      () => assertLongTailPromotionSnapshotTransactionRootSettled({
        transactionRoot: fixture.transactionRoot,
      }),
    );
    assert.deepEqual(readFileSync(committedPath), invalid);
  });
});

test("transaction and curated roots reject direct symbolic links", (t) => {
  const root = temporaryDirectory(t);
  const fixture = createFixture(root);
  const linkedTransactionRoot = path.join(root, "linked-transactions");
  symlinkSync(fixture.transactionRoot, linkedTransactionRoot);
  assert.throws(
    () => promoteLongTailPromotionSnapshot({
      ...promotionInput(fixture),
      transactionRoot: linkedTransactionRoot,
    }),
    /Transaction root cannot be a symbolic link/,
  );

  const realCurated = `${fixture.curatedRoot}-real`;
  renameSync(fixture.curatedRoot, realCurated);
  symlinkSync(realCurated, fixture.curatedRoot);
  assert.throws(
    () => promoteLongTailPromotionSnapshot(promotionInput(fixture)),
    /Curated root cannot be a symbolic link/,
  );
});

test("transaction roots reject a symbolic-link ancestor", (t) => {
  const root = temporaryDirectory(t);
  const realParent = path.join(root, "real-parent");
  mkdirSync(realParent);
  const fixture = createFixture(realParent);
  const linkedParent = path.join(root, "linked-parent");
  symlinkSync(realParent, linkedParent, "dir");
  const linkedTransactionRoot = path.join(
    linkedParent,
    path.relative(realParent, fixture.transactionRoot),
  );

  assert.throws(
    () => promoteLongTailPromotionSnapshot({
      ...promotionInput(fixture),
      transactionRoot: linkedTransactionRoot,
    }),
    /symbolic-link component/,
  );
  assert.equal(existsSync(path.join(realParent, "tmp")), false);
});

test("exported errors retain a stable transaction-specific class", () => {
  assert.equal(
    new LongTailPromotionSnapshotError("example").name,
    "LongTailPromotionSnapshotError",
  );
});
