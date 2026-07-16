import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND,
  CURRENT_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
  STAGED_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
  afrikaansStagedReleaseProofSchema,
  afrikaansStagedReleaseProofRequestSchema,
  createStagedTranslationFallbackReleaseAttestation,
  createCurrentTranslationFallbackReleaseAttestation,
  inspectStagedTranslationFallbackInventory,
  parseStagedCuratedSitePack,
  parseStagedTranslationFallbackAttestationCliArgs,
  readAndValidateStagedTranslationFallbackReleaseAttestation,
  readAndValidateCurrentTranslationFallbackReleaseAttestation,
  runCurrentTranslationFallbackAttestationCli,
  runStagedTranslationFallbackAttestationCli,
  sha256CanonicalStagedTranslationEvidence,
  validateAfrikaansStagedReleaseProof,
  type AfrikaansStagedPromotionProofReaderInput,
  type AfrikaansStagedReleaseProof,
  type StagedTranslationFallbackInventoryEvidence,
} from "../scripts/staged-translation-fallback-release-attestation";
import {
  LONG_TAIL_TRANSLATION_CURATED_PROVENANCE_KIND,
  LONG_TAIL_TRANSLATION_PROTECTOR_VERSION,
} from "../scripts/generate-long-tail-translations";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
} from "../scripts/long-tail-nllb-execution-profile";
import {
  semanticReleaseAttestationCheck,
  type SemanticReleaseAttestationValidation,
  type StagedFallbackReleaseAttestationValidation,
} from "../scripts/cloudflare/deploy-preflight";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const TRANSACTION_ID = "e".repeat(64);

test("staged attestation defaults to the real scoped Afrikaans proof reader and fails closed", () => {
  const workspaceRoot = makeWorkspace();
  assert.throws(
    () =>
      createStagedTranslationFallbackReleaseAttestation({
        workspaceRoot,
        afrikaansProofRequest: proofRequest(),
        dependencies: { inspectInventory: () => postAfrikaansInventory() },
      }),
    /ENOENT|does not exist|promotion|transaction/i,
  );
});

test("default Afrikaans proof adapter binds safe workspace-relative roots and exact evidence", () => {
  const workspaceRoot = makeWorkspace();
  fs.mkdirSync(path.join(workspaceRoot, "tmp/afrikaans-release"), {
    recursive: true,
  });
  fs.mkdirSync(
    path.join(workspaceRoot, "tmp/long-tail-promotion-snapshots"),
    { recursive: true },
  );
  let observedInput: AfrikaansStagedPromotionProofReaderInput | undefined;
  const proof = validateAfrikaansStagedReleaseProof(
    { workspaceRoot, request: proofRequest() },
    (input) => {
      observedInput = input;
      return {
        state: "committed-finalized",
        semanticAudit: {
          manifestSha256: SHA_A,
          fields: 16_564,
          packs: 125,
          manifest: {
            results: {
              passed: true,
              counts: {
                candidatePacks: 121,
                unadjudicatedFailures: 0,
                adjudicatedFailures: 0,
              },
            },
          },
        },
        semanticEvidence: { semanticEvidenceSha256: SHA_B },
        journalBinding: { bindingSha256: SHA_C },
        transactionId: TRANSACTION_ID,
        preparedSha256: SHA_D,
        committedSha256: SHA_A,
        artifacts: 121,
        publications: { created: 117, replayed: 2, replaced: 2 },
        postSiteTree: { sha256: SHA_B },
      };
    },
  );
  assert.deepEqual(observedInput, {
    workspaceRoot,
    runRoot: path.join(workspaceRoot, "tmp/afrikaans-release"),
    transactionRoot: path.join(
      workspaceRoot,
      "tmp/long-tail-promotion-snapshots",
    ),
    transactionId: TRANSACTION_ID,
  });
  assert.equal(proof.auditManifestSha256, SHA_A);
  assert.equal(proof.semanticEvidenceSha256, SHA_B);
  assert.equal(proof.promotion.journalBindingSha256, SHA_C);
  assert.equal(proof.promotion.postSiteTreeSha256, SHA_B);
  const { proofSha256, ...material } = proof;
  assert.equal(
    proofSha256,
    sha256CanonicalStagedTranslationEvidence(material),
  );
  for (const unsafePath of ["../escape", "/absolute", "tmp\\escape"]) {
    assert.equal(
      afrikaansStagedReleaseProofRequestSchema.safeParse({
        ...proofRequest(),
        runRoot: unsafePath,
      }).success,
      false,
    );
  }
  fs.symlinkSync(
    fs.realpathSync(os.tmpdir()),
    path.join(workspaceRoot, "tmp/escaped-run"),
  );
  assert.throws(
    () =>
      validateAfrikaansStagedReleaseProof(
        {
          workspaceRoot,
          request: { ...proofRequest(), runRoot: "tmp/escaped-run" },
        },
        () => {
          throw new Error("Reader must not receive a symlink-escaped root.");
        },
      ),
    /symbolic link/,
  );
});

test("staged fallback attestation CLI parser is exact and path-safe", () => {
  assert.deepEqual(
    parseStagedTranslationFallbackAttestationCliArgs([
      "--",
      "--transaction-id",
      TRANSACTION_ID,
      "--run-dir",
      "tmp/afrikaans-release",
      "--transaction-root",
      "tmp/long-tail-promotion-snapshots",
    ]),
    proofRequest(),
  );
  for (const args of [
    [],
    ["--run-dir", "tmp/run"],
    [
      "--run-dir",
      "tmp/run",
      "--run-dir",
      "tmp/other",
      "--transaction-id",
      TRANSACTION_ID,
    ],
    [
      "--unknown",
      "tmp/run",
      "--transaction-root",
      "tmp/transactions",
      "--transaction-id",
      TRANSACTION_ID,
    ],
    [
      "--run-dir",
      "../escape",
      "--transaction-root",
      "tmp/transactions",
      "--transaction-id",
      TRANSACTION_ID,
    ],
    [
      "--run-dir",
      "tmp/run",
      "--transaction-root",
      "tmp/transactions",
      "--transaction-id",
      "A".repeat(64),
    ],
  ]) {
    assert.throws(
      () => parseStagedTranslationFallbackAttestationCliArgs(args),
      /requires exactly|Duplicate|Unknown|invalid/i,
    );
  }
});

test("staged fallback attestation executable rejects unsafe arguments before release work", () => {
  const result = spawnSync(
    path.join(process.cwd(), "node_modules/.bin/tsx"),
    [
      path.join(
        process.cwd(),
        "scripts/staged-translation-fallback-release-attestation.ts",
      ),
      "--run-dir",
      "../escape",
      "--transaction-root",
      "tmp/transactions",
      "--transaction-id",
      TRANSACTION_ID,
    ],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /translations:attest-staged-fallback.*arguments are invalid/i,
  );
});

test("current fallback executable has a distinct fixed no-promotion CLI", () => {
  const result = spawnSync(
    path.join(process.cwd(), "node_modules/.bin/tsx"),
    [
      path.join(
        process.cwd(),
        "scripts/current-translation-fallback-release-attestation.ts",
      ),
    ],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
  );
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(
    output,
    /translations:attest-current-fallback.*--current-no-site-promotion/i,
  );
  assert.doesNotMatch(output, /attest-staged-fallback/);
});

test("staged fallback attestation CLI creates, rereads, and reports bounded non-authority evidence", () => {
  const workspaceRoot = makeWorkspace();
  const inventory = postAfrikaansInventory();
  const proof = afrikaansProof(inventory.curatedSiteTree.sha256);
  let inventoryReads = 0;
  let proofReads = 0;
  let output = "";
  const report = runStagedTranslationFallbackAttestationCli(
    [
      "--run-dir",
      proofRequest().runRoot,
      "--transaction-root",
      proofRequest().transactionRoot,
      "--transaction-id",
      proofRequest().transactionId,
    ],
    {
      workspaceRoot,
      createdAt: new Date("2026-07-15T19:00:00.000Z"),
      dependencies: {
        inspectInventory: () => {
          inventoryReads += 1;
          return inventory;
        },
        validateAfrikaansReleaseProof: () => {
          proofReads += 1;
          return proof;
        },
      },
      writeOutput: (value) => {
        output += value;
      },
    },
  );
  assert.equal(inventoryReads, 2);
  assert.equal(proofReads, 2);
  assert.equal(report.releaseMode, "staged-canonical-English-fallback");
  assert.equal(report.counts.pendingCandidateJobs, 7_836);
  assert.equal(report.bindings.semanticEvidenceSha256, SHA_B);
  assert.deepEqual(report.authorities, {
    satisfiesStagedTranslationGate: true,
    grantsDeploymentByItself: false,
    canDeploy: false,
    canWriteProduction: false,
    fullSemanticTranslationRelease: false,
    fullD1TranslationRepair: false,
    productionD1TranslationSync: false,
    legacyMarketingDeltaRelease: false,
    productionTranslationWrites: false,
  });
  assert.ok(Buffer.byteLength(output, "utf8") < 16 * 1024);
  const parsedOutput: unknown = JSON.parse(output);
  assert.equal(
    requireRecord(parsedOutput, "CLI report").attestationSha256,
    report.attestationSha256,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        workspaceRoot,
        STAGED_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
      ),
    ),
    true,
  );
  const packageValue: unknown = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  );
  const scripts = requireRecord(
    requireRecord(packageValue, "package.json").scripts,
    "package scripts",
  );
  assert.equal(
    scripts["translations:attest-staged-fallback"],
    "tsx scripts/staged-translation-fallback-release-attestation.ts",
  );
});

test("ignored main-app workbench artifacts do not affect staged release evidence", (t) => {
  const workspaceRoot = makeWorkspace();
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(workspaceRoot, "lib/i18n"), { recursive: true });
  fs.cpSync(
    path.join(process.cwd(), "translations/curated"),
    path.join(workspaceRoot, "translations/curated"),
    { recursive: true },
  );
  fs.cpSync(
    path.join(process.cwd(), "translations/static-main-app"),
    path.join(workspaceRoot, "translations/static-main-app"),
    { recursive: true },
  );
  for (const relativePath of [
    "lib/i18n/site-source-manifest.ts",
    "lib/i18n/site-availability-manifest.ts",
  ]) {
    fs.copyFileSync(
      path.join(process.cwd(), relativePath),
      path.join(workspaceRoot, relativePath),
    );
  }
  const before = inspectStagedTranslationFallbackInventory(workspaceRoot);
  fs.symlinkSync(
    "missing-ignored-workbench-target",
    path.join(
      workspaceRoot,
      "translations/curated/af/main-app.part-ignored.json",
    ),
  );
  const after = inspectStagedTranslationFallbackInventory(workspaceRoot);
  assert.deepEqual(after, before);
});

test("staged curated pack parsing is exact and promoted provenance is self-bound", () => {
  const legacyBytes = fs.readFileSync(
    path.join(process.cwd(), "translations/curated/af/route__home.json"),
  );
  const legacy = parseStagedCuratedSitePack(
    legacyBytes,
    "af/route__home.json",
  );
  assert.equal(legacy.language, "Afrikaans");
  const legacyValue: unknown = JSON.parse(legacyBytes.toString("utf8"));
  const legacyWithExtra = requireRecord(
    legacyValue,
    "legacy pack",
  );
  legacyWithExtra.unexpected = true;
  assert.throws(
    () =>
      parseStagedCuratedSitePack(
        Buffer.from(JSON.stringify(legacyWithExtra)),
        "af/route__home.json",
      ),
    /Unrecognized key|unrecognized_keys/i,
  );
  const secondLegacyValue: unknown = JSON.parse(legacyBytes.toString("utf8"));
  const legacyWithOversizedModel = {
    ...requireRecord(secondLegacyValue, "legacy pack"),
    model: "m".repeat(257),
  };
  assert.throws(
    () =>
      parseStagedCuratedSitePack(
        Buffer.from(JSON.stringify(legacyWithOversizedModel)),
        "af/route__home.json",
      ),
    /Too big|256|too_big/i,
  );

  const provenanceMaterial = {
    kind: LONG_TAIL_TRANSLATION_CURATED_PROVENANCE_KIND,
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfileSha256: LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
    protectorVersion: LONG_TAIL_TRANSLATION_PROTECTOR_VERSION,
    protectorSha256: SHA_A,
    masterWorklistSha256: SHA_B,
    packWorklistSha256: SHA_C,
    jobSha256: SHA_D,
    sourceEntriesSha256: SHA_A,
    modelSha256: SHA_B,
    pipelineImplementationSha256: SHA_C,
    workerImplementationSha256: SHA_D,
    validatorPolicySha256: SHA_A,
    candidateSha256: SHA_B,
  };
  const promoted = {
    schemaVersion: 1,
    language: "Afrikaans",
    locale: "af",
    namespace: "route:test",
    sourceHash: SHA_A,
    model: "fixture-model",
    provenance: {
      ...provenanceMaterial,
      provenanceSha256:
        sha256CanonicalStagedTranslationEvidence(provenanceMaterial),
    },
    translations: { key: "Vertaling" },
  };
  parseStagedCuratedSitePack(
    Buffer.from(JSON.stringify(promoted)),
    "af/route__test.json",
  );
  assert.throws(
    () =>
      parseStagedCuratedSitePack(
        Buffer.from(JSON.stringify({
          ...promoted,
          provenance: { ...promoted.provenance, provenanceSha256: SHA_D },
        })),
        "af/route__test.json",
      ),
    /provenance is self-hash invalid/,
  );
});

test("staged attestation binds the exact inventory, proof, fallback, and non-authority flags", () => {
  const workspaceRoot = makeWorkspace();
  const inventory = postAfrikaansInventory();
  const proof = afrikaansProof(inventory.curatedSiteTree.sha256);
  const dependencies = {
    inspectInventory: () => inventory,
    validateAfrikaansReleaseProof: () => proof,
  };
  const handle = createStagedTranslationFallbackReleaseAttestation({
    workspaceRoot,
    createdAt: new Date("2026-07-15T19:00:00.000Z"),
    afrikaansProofRequest: proofRequest(),
    dependencies,
  });
  const reread = readAndValidateStagedTranslationFallbackReleaseAttestation({
    workspaceRoot,
    dependencies,
  });

  assert.equal(handle.sha256, reread.sha256);
  assert.equal(handle.artifact.inventory.counts.physicalSitePacks, 812);
  assert.equal(handle.artifact.inventory.counts.cleanPhysicalSitePacks, 720);
  assert.equal(handle.artifact.inventory.counts.stalePhysicalSitePacks, 92);
  assert.equal(handle.artifact.inventory.pendingLedger.entries.length, 7_836);
  assert.deepEqual(handle.artifact.authorities, {
    satisfiesStagedTranslationGate: true,
    grantsDeploymentByItself: false,
    canDeploy: false,
    canWriteProduction: false,
    fullSemanticTranslationRelease: false,
    fullD1TranslationRepair: false,
    productionD1TranslationSync: false,
    legacyMarketingDeltaRelease: false,
    productionTranslationWrites: false,
  });
  assert.equal(handle.artifact.fallbackPolicy.mixedLanguageLocalizedPages, false);
});

test("current fallback attestation binds the exact tracked availability with no site promotion authority", () => {
  const workspaceRoot = makeWorkspace();
  const inventory = currentNoPromotionInventory();
  const dependencies = { inspectInventory: () => inventory };
  const handle = createCurrentTranslationFallbackReleaseAttestation({
    workspaceRoot,
    createdAt: new Date("2026-07-15T19:30:00.000Z"),
    dependencies,
  });
  const reread =
    readAndValidateCurrentTranslationFallbackReleaseAttestation({
      workspaceRoot,
      dependencies,
    });
  assert.equal(handle.sha256, reread.sha256);
  assert.equal(handle.artifact.kind, CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND);
  assert.equal(handle.artifact.inventory.counts.cleanPhysicalSitePacks, 599);
  assert.equal(handle.artifact.inventory.counts.staticMainAppPacks, 69);
  assert.equal(handle.artifact.inventory.counts.pendingCandidateJobs, 7_957);
  assert.equal(handle.artifact.inventory.counts.advertisedLocalizedHtmlPaths, 245);
  assert.deepEqual(handle.artifact.promotionScope, {
    sitePromotion: "none-for-this-release",
    candidateWorkbenches: "excluded-from-release-authority",
    admittedSiteRows: "tracked-source-current-clean-availability-only",
  });
  assert.equal("afrikaansProof" in handle.artifact, false);

  let output = "";
  const report = runCurrentTranslationFallbackAttestationCli(
    ["--current-no-site-promotion"],
    {
      workspaceRoot,
      createdAt: new Date("2026-07-15T19:31:00.000Z"),
      dependencies,
      writeOutput: (value) => {
        output += value;
      },
    },
  );
  assert.equal(report.counts.cleanPhysicalSitePacks, 599);
  assert.match(output, /none-for-this-release/);
  assert.ok(
    fs.existsSync(
      path.join(
        workspaceRoot,
        CURRENT_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
      ),
    ),
  );
  assert.throws(
    () => runCurrentTranslationFallbackAttestationCli([], {
      workspaceRoot,
      dependencies,
    }),
    /exactly --current-no-site-promotion/,
  );
});

test("staged attestation rejects schema, manifest, tree, count, and proof drift", async (t) => {
  await t.test("authority schema tamper", () => {
    const fixture = createFixture();
    const value = readArtifact(fixture.workspaceRoot);
    const authorities = requireRecord(value.authorities, "attestation authorities");
    value.authorities = { ...authorities, canDeploy: true };
    rewriteArtifact(fixture.workspaceRoot, value);
    assert.throws(
      () => fixture.read(),
      /expected false|invalid_type|Invalid input/,
    );
  });

  await t.test("manifest binding drift", () => {
    const fixture = createFixture();
    const drifted = structuredClone(fixture.inventory);
    drifted.availabilityManifest.fileSha256 = SHA_D;
    assert.throws(
      () => fixture.read({ inspectInventory: () => drifted }),
      /stale for the exact manifests or translation trees/,
    );
  });

  await t.test("tree binding drift", () => {
    const fixture = createFixture();
    const drifted = structuredClone(fixture.inventory);
    drifted.curatedSiteTree.sha256 = SHA_D;
    assert.throws(
      () => fixture.read({ inspectInventory: () => drifted }),
      /stale for the exact manifests or translation trees/,
    );
  });

  await t.test("count drift", () => {
    const workspaceRoot = makeWorkspace();
    const drifted = structuredClone(postAfrikaansInventory());
    drifted.counts.physicalSitePacks = 811;
    assert.throws(
      () =>
        createStagedTranslationFallbackReleaseAttestation({
          workspaceRoot,
          afrikaansProofRequest: proofRequest(),
          dependencies: {
            inspectInventory: () => drifted,
            validateAfrikaansReleaseProof: () =>
              afrikaansProof(drifted.curatedSiteTree.sha256),
          },
        }),
      /inventory accounting is inconsistent|exact audited post-Afrikaans inventory/,
    );
  });

  await t.test("Afrikaans proof drift", () => {
    const fixture = createFixture();
    const driftedMaterial = {
      ...fixture.proof,
      auditManifestSha256: SHA_D,
    };
    const { proofSha256: priorProofSha256, ...material } = driftedMaterial;
    assert.match(priorProofSha256, /^[a-f0-9]{64}$/);
    const drifted = afrikaansStagedReleaseProofSchema.parse({
      ...material,
      proofSha256: sha256CanonicalStagedTranslationEvidence(material),
    });
    assert.throws(
      () => fixture.read({ validateAfrikaansReleaseProof: () => drifted }),
      /stale for the Afrikaans audit or promotion proof/,
    );
  });
});

test("deploy preflight translation gate is a strict full-or-staged union", () => {
  const full = (): SemanticReleaseAttestationValidation => ({
    path: "/full.json",
    sha256: SHA_A,
    curatedTreeSha256: SHA_B,
    semanticEvidenceSha256: SHA_C,
  });
  const staged = (): StagedFallbackReleaseAttestationValidation => ({
    path: "/staged.json",
    sha256: SHA_A,
    attestationKind:
      "inspir-current-translation-fallback-no-site-promotion-attestation-v1",
    sitePromotionMode: "none-current-availability",
    curatedTreeSha256: SHA_B,
    staticMainAppTreeSha256: SHA_C,
    availabilityManifestSha256: SHA_D,
    localizedHtmlPathsSha256: SHA_A,
    pendingLedgerSha256: SHA_B,
  });
  const fullPass = semanticReleaseAttestationCheck(
    process.cwd(),
    full,
    () => {
      throw new Error("staged must not be evaluated after a full pass");
    },
  );
  assert.equal(fullPass.status, "pass");
  assert.equal(
    releaseMode(fullPass.detail),
    "full-semantic",
  );

  const stagedPass = semanticReleaseAttestationCheck(
    process.cwd(),
    () => {
      throw new Error("full missing");
    },
    staged,
  );
  assert.equal(stagedPass.status, "pass");
  assert.equal(
    releaseMode(stagedPass.detail),
    "staged-canonical-English-fallback",
  );

  const bothFail = semanticReleaseAttestationCheck(
    process.cwd(),
    () => {
      throw new Error("full tampered");
    },
    () => {
      throw new Error("staged tampered");
    },
  );
  assert.equal(bothFail.status, "fail");
  assert.match(JSON.stringify(bothFail.detail), /full tampered/);
  assert.match(JSON.stringify(bothFail.detail), /staged tampered/);
});

function createFixture() {
  const workspaceRoot = makeWorkspace();
  const inventory = postAfrikaansInventory();
  const proof = afrikaansProof(inventory.curatedSiteTree.sha256);
  const dependencies = {
    inspectInventory: () => inventory,
    validateAfrikaansReleaseProof: () => proof,
  };
  createStagedTranslationFallbackReleaseAttestation({
    workspaceRoot,
    createdAt: new Date("2026-07-15T19:00:00.000Z"),
    afrikaansProofRequest: proofRequest(),
    dependencies,
  });
  return {
    workspaceRoot,
    inventory,
    proof,
    read: (
      overrides: Partial<typeof dependencies> = {},
    ) =>
      readAndValidateStagedTranslationFallbackReleaseAttestation({
        workspaceRoot,
        dependencies: { ...dependencies, ...overrides },
      }),
  };
}

function postAfrikaansInventory(): StagedTranslationFallbackInventoryEvidence {
  const entries: StagedTranslationFallbackInventoryEvidence["pendingLedger"]["entries"] =
    Array.from({ length: 7_836 }, (_, index) => {
      const identity = index.toString().padStart(4, "0");
      return [
        `x${identity}`,
        "route:test",
        index < 7_744 ? "missing" : "stale",
        SHA_A,
        index < 7_744 ? null : SHA_B,
      ];
    });
  return {
    sourceManifest: {
      relativePath: "lib/i18n/site-source-manifest.ts",
      fileSha256: SHA_A,
      catalogRootSha256: SHA_B,
      namespaces: 125,
      targetNamespaces: 124,
    },
    availabilityManifest: {
      relativePath: "lib/i18n/site-availability-manifest.ts",
      fileSha256: SHA_C,
      logicalSha256: SHA_D,
      namespaceEntries: 259,
      localizedHtmlPaths: 259,
      localizedHtmlPathsSha256: SHA_A,
    },
    curatedSiteTree: {
      relativePath: "translations/curated",
      files: 812,
      bytes: 123_456,
      sha256: SHA_B,
    },
    staticMainAppTree: {
      relativePath: "translations/static-main-app",
      files: 69,
      bytes: 65_432,
      sha256: SHA_C,
    },
    counts: {
      targetLanguages: 69,
      targetSiteNamespaces: 124,
      fullSitePackTarget: 8_556,
      physicalSitePacks: 812,
      cleanPhysicalSitePacks: 720,
      stalePhysicalSitePacks: 92,
      missingSitePacks: 7_744,
      pendingCandidateJobs: 7_836,
      staticMainAppPacks: 69,
      availabilityNamespaceEntries: 259,
      advertisedLocalizedHtmlPaths: 259,
    },
    targetSetSha256: SHA_D,
    cleanTargetSetSha256: SHA_A,
    pendingLedger: {
      missing: 7_744,
      stale: 92,
      entries,
      sha256: sha256CanonicalStagedTranslationEvidence(entries),
    },
  };
}

function currentNoPromotionInventory(): StagedTranslationFallbackInventoryEvidence {
  const entries: StagedTranslationFallbackInventoryEvidence["pendingLedger"]["entries"] =
    Array.from({ length: 7_957 }, (_, index) => {
      const identity = index.toString().padStart(4, "0");
      return [
        `x${identity}`,
        "route:test",
        index < 7_865 ? "missing" : "stale",
        SHA_A,
        index < 7_865 ? null : SHA_B,
      ];
    });
  return {
    sourceManifest: {
      relativePath: "lib/i18n/site-source-manifest.ts",
      fileSha256: SHA_A,
      catalogRootSha256: SHA_B,
      namespaces: 125,
      targetNamespaces: 124,
    },
    availabilityManifest: {
      relativePath: "lib/i18n/site-availability-manifest.ts",
      fileSha256: SHA_C,
      logicalSha256: SHA_D,
      namespaceEntries: 245,
      localizedHtmlPaths: 245,
      localizedHtmlPathsSha256: SHA_A,
    },
    curatedSiteTree: {
      relativePath: "translations/curated",
      files: 691,
      bytes: 123_456,
      sha256: SHA_B,
    },
    staticMainAppTree: {
      relativePath: "translations/static-main-app",
      files: 69,
      bytes: 65_432,
      sha256: SHA_C,
    },
    counts: {
      targetLanguages: 69,
      targetSiteNamespaces: 124,
      fullSitePackTarget: 8_556,
      physicalSitePacks: 691,
      cleanPhysicalSitePacks: 599,
      stalePhysicalSitePacks: 92,
      missingSitePacks: 7_865,
      pendingCandidateJobs: 7_957,
      staticMainAppPacks: 69,
      availabilityNamespaceEntries: 245,
      advertisedLocalizedHtmlPaths: 245,
    },
    targetSetSha256: SHA_D,
    cleanTargetSetSha256: SHA_A,
    pendingLedger: {
      missing: 7_865,
      stale: 92,
      entries,
      sha256: sha256CanonicalStagedTranslationEvidence(entries),
    },
  };
}

function afrikaansProof(postSiteTreeSha256: string): AfrikaansStagedReleaseProof {
  const material = {
    schemaVersion: 1 as const,
    kind: "inspir-afrikaans-scoped-release-proof-v1" as const,
    language: "Afrikaans" as const,
    locale: "af" as const,
    candidatePacks: 121 as const,
    auditedPacks: 125 as const,
    auditedFields: 16_564 as const,
    passed: true as const,
    unadjudicatedFailures: 0 as const,
    adjudicatedFailures: 0 as const,
    auditManifestSha256: SHA_A,
    semanticEvidenceSha256: SHA_B,
    promotion: {
      state: "committed-finalized" as const,
      transactionId: TRANSACTION_ID,
      journalBindingSha256: SHA_C,
      preparedSha256: SHA_D,
      committedSha256: SHA_A,
      artifacts: 121 as const,
      publications: { created: 121, replayed: 0, replaced: 0 },
      postSiteTreeSha256,
    },
  };
  return {
    ...material,
    proofSha256: sha256CanonicalStagedTranslationEvidence(material),
  };
}

function proofRequest() {
  return {
    runRoot: "tmp/afrikaans-release",
    transactionId: TRANSACTION_ID,
    transactionRoot: "tmp/long-tail-promotion-snapshots",
  };
}

function makeWorkspace() {
  const workspaceRoot = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "inspir-staged-translation-attestation-"),
  );
  fs.mkdirSync(path.join(workspaceRoot, "translations"), { recursive: true });
  return workspaceRoot;
}

function readArtifact(workspaceRoot: string) {
  const value: unknown = JSON.parse(
    fs.readFileSync(
      path.join(workspaceRoot, STAGED_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH),
      "utf8",
    ),
  );
  const record = requireRecord(value, "staged attestation");
  requireRecord(record.authorities, "staged attestation authorities");
  return record;
}

function rewriteArtifact(workspaceRoot: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceRoot, STAGED_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function releaseMode(value: unknown) {
  const record = requireRecord(value, "translation release preflight detail");
  return record.releaseMode;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return Object.fromEntries(
    Object.keys(value).map((key) => [key, Reflect.get(value, key)]),
  );
}
