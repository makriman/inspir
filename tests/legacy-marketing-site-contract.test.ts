import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LEGACY_MARKETING_SITE_D1_MAX_STATEMENT_BYTES,
  LEGACY_MARKETING_SITE_EXPECTED_CURATED_SITE_ROW_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_DELTA_HASH,
  LEGACY_MARKETING_SITE_EXPECTED_DELTA_KEY_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_OWNER_MAP_HASH,
  LEGACY_MARKETING_SITE_EXPECTED_PAYLOAD_KEY_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_ROUTE_KEY_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_ROUTE_NAMESPACE_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_ROUTE_UNION_HASH,
  LEGACY_MARKETING_SITE_EXPECTED_SITE_ROW_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_SOURCE_HASH,
  LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT,
  assertLegacyMarketingSiteD1StatementBounds,
  assertProductionLegacyMarketingSiteContract,
  buildLegacyMarketingSiteComposedCorpus,
  buildLegacyMarketingSiteDeltaCorpusManifest,
  composeLegacyMarketingSitePayload,
  createLegacyMarketingSiteD1WriteBatches,
  deriveLegacyMarketingSiteContract,
  hashLegacyMarketingSiteRecord,
  hashLegacyMarketingSiteSourceEntries,
  legacyMarketingSiteContract,
  legacyMarketingSiteDeltaPackRelativePath,
  legacyMarketingSiteTargetLanguages,
  parseLegacyMarketingSiteDeltaPack,
  validateLegacyMarketingSiteDatabaseRows,
  validateLegacyMarketingSiteDeltaCorpusManifest,
  validateLegacyMarketingSitePayload,
  type LegacyMarketingSiteContract,
  type LegacyMarketingSiteDeltaPackArtifact,
  type LegacyMarketingSiteSourceManifest,
} from "../lib/i18n/legacy-marketing-site-contract";
import { languageConfigs, type SupportedLanguage } from "../lib/content/languages";
import { siteSourceManifest } from "../lib/i18n/site-source-manifest";
import {
  inspectPromotedLegacyMarketingSiteRouteCorpus,
  parseLegacyMarketingSiteDeltaPreparationOptions,
} from "../scripts/prepare-legacy-marketing-site-delta";
import {
  assertLegacyMarketingSiteDeltaMaster,
  buildLegacyMarketingSiteComposedCorpusFromReleasePlan,
  buildLegacyMarketingSiteComposedCorpusFromRepository,
  buildLegacyMarketingSiteDeltaReleasePlan,
  buildLegacyMarketingSiteDeltaWorkerInvocations,
  executeLegacyMarketingSiteDeltaWorkers,
  parseLegacyMarketingSiteDeltaReleaseCliOptions,
  publishLegacyMarketingSiteDeltaRelease,
} from "../scripts/run-legacy-marketing-site-delta-release";
import {
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
  LONG_TAIL_TRANSLATION_PROTECTOR_VERSION,
  buildLongTailMasterWorklist,
  createLongTailCandidate,
  createLongTailGenerationOverrides,
  createLongTailPackWorklist,
  createLongTailSeedMemory,
  materializeLongTailWorklists,
  type LongTailInventory,
  type LongTailMasterWorklist,
  type LongTailPipelineProvenance,
} from "../scripts/generate-long-tail-translations";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE,
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
} from "../scripts/long-tail-nllb-execution-profile";
import {
  calculateLongTailValidatorPolicySha256,
  LONG_TAIL_VALIDATOR_POLICY_KIND,
  LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS,
} from "../scripts/translation-validator-policy-provenance";

type JsonObject = Readonly<{ [key: string]: JsonValue }>;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | JsonObject;

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const hashD = "d".repeat(64);
const hashE = "e".repeat(64);
const hashF = "f".repeat(64);
const fixtureValidatorPolicyFiles = Object.freeze(
  LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS.map((relativePath) =>
    Object.freeze({
      relativePath,
      bytes: relativePath.length,
      sha256: sha256Text(relativePath),
    })
  ),
);
const fixtureValidatorPolicy = Object.freeze({
  kind: LONG_TAIL_VALIDATOR_POLICY_KIND,
  files: fixtureValidatorPolicyFiles,
  validatorPolicySha256: calculateLongTailValidatorPolicySha256(
    fixtureValidatorPolicyFiles,
  ),
});

function sourceEntry(sourceStrings: Readonly<Record<string, string>>) {
  return Object.freeze({
    sourceHash: hashLegacyMarketingSiteRecord(sourceStrings),
    sourceStrings: Object.freeze({ ...sourceStrings }),
  });
}

function syntheticContract() {
  const marketing = {
    "site.a": "Start learning now with guided practice.",
    "site.b": "Open inspir at https://inspirlearning.com.",
    "site.c": "Save 2 study notes.",
    "site.delta": "{value1} | Free AI learning for everyone",
  };
  const manifest: LegacyMarketingSiteSourceManifest = {
    "marketing-site": sourceEntry(marketing),
    "route:first": sourceEntry({
      "site.a": marketing["site.a"],
      "site.b": marketing["site.b"],
    }),
    "route:second": sourceEntry({
      "site.b": marketing["site.b"],
      "site.c": marketing["site.c"],
    }),
  };
  return Object.freeze({ manifest, contract: deriveLegacyMarketingSiteContract(manifest) });
}

function literalContract() {
  const manifest: LegacyMarketingSiteSourceManifest = {
    "marketing-site": sourceEntry({ "site.route": "1", "site.delta": "2" }),
    "route:literal": sourceEntry({ "site.route": "1" }),
  };
  return deriveLegacyMarketingSiteContract(manifest);
}

function provenance(overrides: Readonly<Record<string, string>> = {}) {
  const material = {
    kind: "inspir-long-tail-curated-provenance-v1",
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfileSha256: LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
    protectorVersion: "inspir-long-tail-literal-protector-v1",
    protectorSha256: overrides.protectorSha256 ?? hashA,
    masterWorklistSha256: overrides.masterWorklistSha256 ?? hashB,
    packWorklistSha256: overrides.packWorklistSha256 ?? hashC,
    jobSha256: overrides.jobSha256 ?? hashD,
    sourceEntriesSha256: overrides.sourceEntriesSha256 ?? hashE,
    modelSha256: overrides.modelSha256 ?? hashF,
    pipelineImplementationSha256:
      overrides.pipelineImplementationSha256 ?? hashA,
    workerImplementationSha256:
      overrides.workerImplementationSha256 ?? hashB,
    validatorPolicySha256:
      overrides.validatorPolicySha256 ?? hashD,
    candidateSha256: overrides.candidateSha256 ?? hashC,
  } as const;
  return Object.freeze({
    ...material,
    provenanceSha256: canonicalSha256(material),
  });
}

function deltaPack(input: {
  contract: LegacyMarketingSiteContract;
  language?: Exclude<SupportedLanguage, "English">;
  translations: Readonly<Record<string, string>>;
}) {
  const language = input.language ?? "Spanish";
  return Object.freeze({
    schemaVersion: 1,
    language,
    locale: languageConfigs[language].prefix || languageConfigs[language].locale,
    namespace: "marketing-site",
    sourceHash: input.contract.deltaHash,
    model: "fixture-local-model",
    provenance: provenance({
      sourceEntriesSha256: hashLegacyMarketingSiteSourceEntries(
        input.contract.deltaSourceStrings,
      ),
    }),
    translations: Object.freeze({ ...input.translations }),
  });
}

function spanishRoutePacks(contract: LegacyMarketingSiteContract) {
  const firstSource = contract.routeSourcesByNamespace["route:first"];
  const secondSource = contract.routeSourcesByNamespace["route:second"];
  assert.ok(firstSource);
  assert.ok(secondSource);
  return Object.freeze([
    Object.freeze({
      schemaVersion: 1,
      language: "Spanish",
      locale: "es",
      namespace: "route:first",
      sourceHash: firstSource.sourceHash,
      model: "curated-quality-repair-v3",
      entries: Object.freeze([
        Object.freeze({
          key: "site.a",
          source: "Start learning now with guided practice.",
          value: "Empieza a aprender ahora con práctica guiada.",
        }),
        Object.freeze({
          key: "site.b",
          source: "Open inspir at https://inspirlearning.com.",
          value: "Abre inspir en https://inspirlearning.com.",
        }),
      ]),
    }),
    Object.freeze({
      schemaVersion: 1,
      language: "Spanish",
      locale: "es",
      namespace: "route:second",
      sourceHash: secondSource.sourceHash,
      model: "fixture-local-model",
      provenance: provenance({
        sourceEntriesSha256: hashLegacyMarketingSiteSourceEntries(
          secondSource.sourceStrings,
        ),
      }),
      translations: Object.freeze({
        "site.b": "Visita inspir en https://inspirlearning.com.",
        "site.c": "Guarda 2 notas de estudio.",
      }),
    }),
  ]);
}

function literalDeltaArtifacts(contract: LegacyMarketingSiteContract) {
  return legacyMarketingSiteTargetLanguages.map((language, index) => {
    const pack = deltaPack({
      contract,
      language,
      translations: { "site.delta": "2" },
    });
    const withUniquePackProvenance = {
      ...pack,
      provenance: provenance({
        packWorklistSha256: sha256Text(`pack-${index}`),
        jobSha256: sha256Text(`job-${index}`),
        candidateSha256: sha256Text(`candidate-${index}`),
        sourceEntriesSha256: hashLegacyMarketingSiteSourceEntries(
          contract.deltaSourceStrings,
        ),
      }),
    };
    return Object.freeze({
      relativePath: legacyMarketingSiteDeltaPackRelativePath(language),
      bytes: Buffer.from(`${JSON.stringify(withUniquePackProvenance, null, 2)}\n`, "utf8"),
    });
  });
}

test("production marketing-site contract is the exact 124 + 40 partition", () => {
  assert.equal(legacyMarketingSiteContract.marketingSourceHash, LEGACY_MARKETING_SITE_EXPECTED_SOURCE_HASH);
  assert.equal(legacyMarketingSiteContract.routeUnionHash, LEGACY_MARKETING_SITE_EXPECTED_ROUTE_UNION_HASH);
  assert.equal(legacyMarketingSiteContract.deltaHash, LEGACY_MARKETING_SITE_EXPECTED_DELTA_HASH);
  assert.equal(legacyMarketingSiteContract.ownerMapHash, LEGACY_MARKETING_SITE_EXPECTED_OWNER_MAP_HASH);
  assert.equal(legacyMarketingSiteContract.routeNamespaces.length, LEGACY_MARKETING_SITE_EXPECTED_ROUTE_NAMESPACE_COUNT);
  assert.equal(Object.keys(legacyMarketingSiteContract.routeUnionSourceStrings).length, LEGACY_MARKETING_SITE_EXPECTED_ROUTE_KEY_COUNT);
  assert.equal(Object.keys(legacyMarketingSiteContract.deltaSourceStrings).length, LEGACY_MARKETING_SITE_EXPECTED_DELTA_KEY_COUNT);
  assert.equal(Object.keys(legacyMarketingSiteContract.marketingSourceStrings).length, LEGACY_MARKETING_SITE_EXPECTED_PAYLOAD_KEY_COUNT);
  assert.equal(legacyMarketingSiteTargetLanguages.length, LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT);
  assert.equal(124 * 69, LEGACY_MARKETING_SITE_EXPECTED_CURATED_SITE_ROW_COUNT);
  assert.equal(125 * 69, LEGACY_MARKETING_SITE_EXPECTED_SITE_ROW_COUNT);
  assert.equal(125 * 69 + 69, LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT);
});

test("manifest insertion order owns duplicate route keys and is hash-bound", () => {
  const fixture = syntheticContract();
  assert.equal(fixture.contract.ownerByKey["site.b"], "route:first");
  const reorderedManifest: LegacyMarketingSiteSourceManifest = {
    "marketing-site": fixture.manifest["marketing-site"],
    "route:second": fixture.manifest["route:second"],
    "route:first": fixture.manifest["route:first"],
  };
  const reordered = deriveLegacyMarketingSiteContract(reorderedManifest);
  assert.equal(reordered.ownerByKey["site.b"], "route:second");
  assert.equal(reordered.routeUnionHash, fixture.contract.routeUnionHash);
  assert.equal(reordered.deltaHash, fixture.contract.deltaHash);
  assert.notEqual(reordered.ownerMapHash, fixture.contract.ownerMapHash);

  const productionReordered = deriveLegacyMarketingSiteContract(
    Object.fromEntries([
      ["marketing-site", siteSourceManifest["marketing-site"]],
      ...Object.entries(siteSourceManifest)
        .filter(([namespace]) => namespace !== "marketing-site")
        .reverse(),
    ]),
  );
  assert.throws(
    () => assertProductionLegacyMarketingSiteContract(productionReordered),
    /owner-map hash drifted/,
  );
});

test("composition uses the owner pack and preserves the 40-key delta sentinel", () => {
  const { contract } = syntheticContract();
  const payload = composeLegacyMarketingSitePayload({
    contract,
    language: "Spanish",
    routePacks: spanishRoutePacks(contract),
    deltaPack: deltaPack({
      contract,
      translations: {
        "site.delta": "{value1} | Aprendizaje gratuito con IA para todos",
      },
    }),
  });
  assert.deepEqual(payload, {
    "site.a": "Empieza a aprender ahora con práctica guiada.",
    "site.b": "Abre inspir en https://inspirlearning.com.",
    "site.c": "Guarda 2 notas de estudio.",
    "site.delta": "{value1} | Aprendizaje gratuito con IA para todos",
  });
});

test("composition rejects partial, stale, equality, and hash-stamped-only packs", () => {
  const { contract } = syntheticContract();
  const routePacks = spanishRoutePacks(contract);
  const validDelta = deltaPack({
    contract,
    translations: {
      "site.delta": "{value1} | Aprendizaje gratuito con IA para todos",
    },
  });
  assert.throws(
    () => composeLegacyMarketingSitePayload({
      contract,
      language: "Spanish",
      routePacks: routePacks.slice(0, 1),
      deltaPack: validDelta,
    }),
    /Expected 2 route packs/,
  );
  assert.throws(
    () => composeLegacyMarketingSitePayload({
      contract,
      language: "Spanish",
      routePacks: [
        { ...routePacks[0], sourceHash: hashA },
        routePacks[1],
      ],
      deltaPack: validDelta,
    }),
    /identity is stale/,
  );
  assert.throws(
    () => parseLegacyMarketingSiteDeltaPack({
      ...validDelta,
      translations: {},
    }, contract),
    /exact source key set/,
  );
  assert.throws(
    () => parseLegacyMarketingSiteDeltaPack({
      ...validDelta,
      translations: {
        "site.delta": contract.deltaSourceStrings["site.delta"],
      },
    }, contract),
    /not a valid translation/,
  );
  assert.throws(
    () => parseLegacyMarketingSiteDeltaPack({
      ...validDelta,
      provenance: { ...validDelta.provenance, provenanceSha256: hashA },
    }, contract),
    /provenance hash is invalid/,
  );
  const {
    provenanceSha256: _validProvenanceSha256,
    ...staleExecutionProfileMaterial
  } = validDelta.provenance;
  assert.match(_validProvenanceSha256, /^[a-f0-9]{64}$/);
  const staleExecutionProfileProvenance = {
    ...staleExecutionProfileMaterial,
    executionProfileSha256: hashA,
  };
  assert.throws(
    () => parseLegacyMarketingSiteDeltaPack({
      ...validDelta,
      provenance: {
        ...staleExecutionProfileProvenance,
        provenanceSha256: canonicalSha256(staleExecutionProfileProvenance),
      },
    }, contract),
    /pipeline\/protector version is unsupported/,
  );
  const firstRoutePack = routePacks[0];
  assert.ok(firstRoutePack && "entries" in firstRoutePack);
  const literalDrift = {
    ...firstRoutePack,
    entries: firstRoutePack.entries.map((entry) =>
      entry.key === "site.b"
        ? { ...entry, value: "Abre inspir en https://example.com." }
        : entry
    ),
  };
  assert.throws(
    () => composeLegacyMarketingSitePayload({
      contract,
      language: "Spanish",
      routePacks: [literalDrift, routePacks[1]],
      deltaPack: validDelta,
    }),
    /not a valid translation/,
  );
  const englishLeakage = {
    ...firstRoutePack,
    entries: firstRoutePack.entries.map((entry) =>
      entry.key === "site.a"
        ? {
            ...entry,
            value:
              "Start learning now with guided practice for every learner.",
          }
        : entry
    ),
  };
  assert.throws(
    () => composeLegacyMarketingSitePayload({
      contract,
      language: "Spanish",
      routePacks: [englishLeakage, routePacks[1]],
      deltaPack: validDelta,
    }),
    /complete fluent bundle validation/,
  );
  const compactRoutePack = routePacks[1];
  assert.ok(compactRoutePack && "provenance" in compactRoutePack);
  assert.throws(
    () => composeLegacyMarketingSitePayload({
      contract,
      language: "Spanish",
      routePacks: [
        routePacks[0],
        {
          ...compactRoutePack,
          provenance: provenance({ sourceEntriesSha256: hashA }),
        },
      ],
      deltaPack: validDelta,
    }),
    /source-entry provenance drifted/,
  );
  assert.throws(
    () => composeLegacyMarketingSitePayload({
      contract,
      language: "Spanish",
      routePacks: [
        { ...firstRoutePack, model: "unreviewed-entry-model" },
        routePacks[1],
      ],
      deltaPack: validDelta,
    }),
    /not explicitly grandfathered/,
  );
  assert.throws(
    () => parseLegacyMarketingSiteDeltaPack({
      ...validDelta,
      locale: "es-MX",
    }, contract),
    /identity is stale/,
  );
  assert.equal(
    legacyMarketingSiteDeltaPackRelativePath("Filipino"),
    "translations/legacy-marketing-site-delta/fil/marketing-site.json",
  );
});

test("delta corpus manifest binds all 69 canonical pack bytes and provenance", () => {
  const contract = literalContract();
  const artifacts = literalDeltaArtifacts(contract);
  const manifest = buildLegacyMarketingSiteDeltaCorpusManifest({ contract, artifacts });
  assert.equal(manifest.packs.length, 69);
  assert.equal(manifest.targetLanguageCount, 69);
  assert.equal(manifest.deltaKeyCount, 1);
  assert.equal(manifest.payloadKeyCount, 2);
  assert.equal(
    manifest.executionProfileSha256,
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  );
  assert.match(manifest.provenanceSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.corpusSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    validateLegacyMarketingSiteDeltaCorpusManifest({
      contract,
      manifest,
      artifacts,
    }),
    manifest,
  );
  assert.throws(
    () => buildLegacyMarketingSiteDeltaCorpusManifest({
      contract,
      artifacts: artifacts.slice(1),
    }),
    /requires 69 packs/,
  );
  assert.throws(
    () => validateLegacyMarketingSiteDeltaCorpusManifest({
      contract,
      manifest: { ...manifest, marketingSourceHash: hashA },
      artifacts,
    }),
    /does not exactly match/,
  );
  const corrupted: LegacyMarketingSiteDeltaPackArtifact[] = [
    { ...artifacts[0], bytes: Buffer.from("{}\n", "utf8") },
    ...artifacts.slice(1),
  ];
  assert.throws(
    () => validateLegacyMarketingSiteDeltaCorpusManifest({
      contract,
      manifest,
      artifacts: corrupted,
    }),
    /unexpected field set/,
  );
});

test("database state must exactly equal the locally composed 69-payload corpus", () => {
  const contract = literalContract();
  const expectedCorpus = buildLegacyMarketingSiteComposedCorpus({
    contract,
    deltaCorpusSha256: hashA,
    payloads: legacyMarketingSiteTargetLanguages.map((language) => ({
      language,
      payload: { "site.route": "1", "site.delta": "2" },
    })),
  });
  const rows = expectedCorpus.payloads.map((expected) => ({
    namespace: "marketing-site",
    language: expected.language,
    source_hash: contract.marketingSourceHash,
    payload: expected.payloadJson,
    model: expectedCorpus.identity.model,
  }));
  const validated = validateLegacyMarketingSiteDatabaseRows({
    contract,
    rows,
    expectedCorpus,
  });
  assert.equal(validated.rows, 69);
  assert.equal(validated.payloadKeys, 138);
  assert.equal(validated.corpusSha256, expectedCorpus.identity.corpusSha256);
  assert.equal(validated.model, expectedCorpus.identity.model);
  assert.equal(
    expectedCorpus.identity.model,
    `legacy-marketing-site-composed-v1:${expectedCorpus.identity.corpusSha256}`,
  );
  assert.throws(
    () => validateLegacyMarketingSiteDatabaseRows({
      contract,
      rows: [],
      expectedCorpus,
    }),
    /Expected 69/,
  );
  assert.throws(
    () => validateLegacyMarketingSiteDatabaseRows({
      contract,
      rows: rows.map((row) => ({ ...row, payload: "{}" })),
      expectedCorpus,
    }),
    /payload bytes differ/,
  );
  assert.throws(
    () => validateLegacyMarketingSiteDatabaseRows({
      contract,
      rows: rows.map((row, index) => index === 0
        ? { ...row, source_hash: hashA }
        : row),
      expectedCorpus,
    }),
    /metadata is stale/,
  );

  const language = expectedCorpus.payloads[0]?.language;
  assert.ok(language);
  const genericallyValidButDifferent = {
    "site.delta": "2.",
    "site.route": "1",
  };
  assert.deepEqual(
    validateLegacyMarketingSitePayload({
      contract,
      language,
      payload: genericallyValidButDifferent,
    }),
    genericallyValidButDifferent,
  );
  assert.throws(
    () => validateLegacyMarketingSiteDatabaseRows({
      contract,
      expectedCorpus,
      rows: rows.map((row, index) => index === 0
        ? { ...row, payload: canonicalJson(genericallyValidButDifferent) }
        : row),
    }),
    /payload bytes differ/,
  );
  assert.throws(
    () => validateLegacyMarketingSiteDatabaseRows({
      contract,
      expectedCorpus,
      rows: rows.map((row, index) => index === 0
        ? { ...row, model: "different-but-nonempty-model" }
        : row),
    }),
    /metadata is stale/,
  );
  assert.throws(
    () => validateLegacyMarketingSiteDatabaseRows({
      contract,
      rows,
      expectedCorpus: {
        ...expectedCorpus,
        identity: {
          ...expectedCorpus.identity,
          model: "caller-supplied-model",
        },
      },
    }),
    /identity does not match its exact payload bytes/,
  );
});

test("D1 plans remain below 100 KB and writes stay in bounded batches", () => {
  assert.deepEqual(
    assertLegacyMarketingSiteD1StatementBounds([
      "x".repeat(LEGACY_MARKETING_SITE_D1_MAX_STATEMENT_BYTES),
    ]),
    [LEGACY_MARKETING_SITE_D1_MAX_STATEMENT_BYTES],
  );
  assert.throws(
    () => assertLegacyMarketingSiteD1StatementBounds(["x".repeat(100_000)]),
    /exceeds 99999/,
  );
  const batches = createLegacyMarketingSiteD1WriteBatches(
    Array.from({ length: 69 }, (_, index) => index),
  );
  assert.deepEqual(batches.map((batch) => batch.length), [25, 25, 19]);
  assert.throws(
    () => createLegacyMarketingSiteD1WriteBatches([1], 26),
    /1-25 rows/,
  );
});

test("delta preparation is read-only by default and fails closed before route promotion", (t) => {
  const options = parseLegacyMarketingSiteDeltaPreparationOptions([]);
  assert.equal(options.materialize, false);
  assert.equal(options.runDirectory, "tmp/legacy-marketing-site-delta-v1");
  assert.throws(
    () => parseLegacyMarketingSiteDeltaPreparationOptions(["--materialize", "--unknown"]),
    /Unknown/,
  );

  const root = mkdtempSync(path.join(os.tmpdir(), "inspir-legacy-marketing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { contract } = syntheticContract();
  const packs = spanishRoutePacks(contract);
  writeRoutePack(root, "Spanish", "route:first", packs[0]);
  assert.throws(
    () => inspectPromotedLegacyMarketingSiteRouteCorpus({
      repoRoot: root,
      contract,
      languages: ["Spanish"],
    }),
    /blocked until the promoted route corpus is exact/,
  );
  writeRoutePack(root, "Spanish", "route:second", packs[1]);
  const inspected = inspectPromotedLegacyMarketingSiteRouteCorpus({
    repoRoot: root,
    contract,
    languages: ["Spanish"],
  });
  assert.equal(inspected.languages, 1);
  assert.equal(inspected.namespaces, 2);
  assert.equal(inspected.packs, 2);
  assert.equal(inspected.unionKeys, 3);
});

test("delta runner uses the generic protocol, resumes one quarantined candidate, and pins executable bytes", async (t) => {
  const fixture = createReleaseFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const invocations = buildLegacyMarketingSiteDeltaWorkerInvocations({
    master: fixture.master,
    repoRoot: fixture.root,
    runDirectory: fixture.runDirectory,
    modelDirectory: fixture.modelDirectory,
    workerScript: fixture.workerScript,
    python: fixture.python,
    requestedWorkers: 1,
    contract: fixture.contract,
  });
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]?.command, fixture.python);
  assert.notEqual(invocations[0]?.command, realpathSync(fixture.python));
  assert.equal(invocations[0]?.jobSha256s.length, 69);
  assert.equal(invocations[0]?.env.TRANSFORMERS_OFFLINE, "1");
  assert.equal(invocations[0]?.env.OMP_NUM_THREADS, "1");
  assert.equal(invocations[0]?.env.MKL_NUM_THREADS, "1");
  assert.equal(invocations[0]?.env.VECLIB_MAXIMUM_THREADS, "1");
  assert.equal(invocations[0]?.env.PYTORCH_ENABLE_MPS_FALLBACK, "0");
  assert.equal(invocations[0]?.env.AUTH_SECRET, undefined);
  assert.equal(invocations[0]?.env.OPENAI_API_KEY, undefined);
  assert.equal(invocations[0]?.env.CLOUDFLARE_API_TOKEN, undefined);
  assert.ok(invocations[0]?.args.includes("--master-worklist"));
  assert.ok(invocations[0]?.args.includes(
    path.join(fixture.runDirectory, "worklist.json"),
  ));
  assert.ok(invocations[0]?.args.includes(fixture.master.provenance.modelSha256));
  const validatorPolicyArgument = invocations[0]?.args.indexOf(
    "--validator-policy-sha256",
  );
  assert.ok(
    validatorPolicyArgument !== undefined && validatorPolicyArgument >= 0,
  );
  assert.equal(
    invocations[0]?.args[validatorPolicyArgument + 1],
    fixture.master.provenance.validatorPolicy.validatorPolicySha256,
  );
  const executionProfileArgument = invocations[0]?.args.indexOf(
    "--execution-profile-json",
  );
  assert.ok(
    executionProfileArgument !== undefined && executionProfileArgument >= 0,
  );
  assert.deepEqual(
    JSON.parse(invocations[0]?.args[executionProfileArgument + 1] ?? "null"),
    LONG_TAIL_NLLB_EXECUTION_PROFILE,
  );
  const executionProfileShaArgument = invocations[0]?.args.indexOf(
    "--execution-profile-sha256",
  );
  assert.ok(
    executionProfileShaArgument !== undefined && executionProfileShaArgument >= 0,
  );
  assert.equal(
    invocations[0]?.args[executionProfileShaArgument + 1],
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  );

  writeFixtureCandidates(fixture);
  const damagedJob = fixture.master.jobs[0];
  assert.ok(damagedJob);
  const damagedPath = fixtureCandidatePath(fixture, damagedJob);
  writeFileSync(damagedPath, "{}\n", { mode: 0o600 });
  const execution = await executeLegacyMarketingSiteDeltaWorkers({
    master: fixture.master,
    repoRoot: fixture.root,
    runDirectory: fixture.runDirectory,
    modelDirectory: fixture.modelDirectory,
    workerScript: fixture.workerScript,
    python: fixture.python,
    requestedWorkers: 1,
    contract: fixture.contract,
    runner: async (invocation) => {
      writeFixtureCandidates(
        fixture,
        new Set(invocation.jobSha256s),
      );
    },
  });
  assert.deepEqual(execution, {
    pendingBefore: 1,
    workerStarts: 1,
    candidatesValidated: 69,
    pendingAfter: 0,
  });
  assert.ok(listTreeFiles(path.join(fixture.runDirectory, "quarantine")).length > 0);

  writeFileSync(fixture.workerScript, "# changed worker bytes\n", { mode: 0o700 });
  assert.throws(
    () => buildLegacyMarketingSiteDeltaWorkerInvocations({
      master: fixture.master,
      repoRoot: fixture.root,
      runDirectory: fixture.runDirectory,
      modelDirectory: fixture.modelDirectory,
      workerScript: fixture.workerScript,
      python: fixture.python,
      requestedWorkers: 1,
      contract: fixture.contract,
    }),
    /bytes differ from master provenance/,
  );
});

test("69-pack release resumes an interrupted stage and publishes with one exact directory transition", (t) => {
  const fixture = createReleaseFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFixtureRoutePacks(fixture);
  writeFixtureCandidates(fixture);
  const plan = buildLegacyMarketingSiteDeltaReleasePlan({
    master: fixture.master,
    repoRoot: fixture.root,
    runDirectory: fixture.runDirectory,
    contract: fixture.contract,
  });
  assert.equal(plan.artifacts.length, 69);
  assert.equal(plan.files.size, 70);
  const prepublication = buildLegacyMarketingSiteComposedCorpusFromReleasePlan({
    plan,
    repoRoot: fixture.root,
    contract: fixture.contract,
  });
  assert.equal(prepublication.payloads.length, 69);
  assert.equal(prepublication.identity.payloadKeyCount, 41);

  const staged = plan.files.entries().next().value;
  assert.ok(staged);
  const [stagedRelativePath, stagedBytes] = staged;
  const stagedFile = path.join(plan.stageRoot, stagedRelativePath);
  mkdirSync(path.dirname(stagedFile), { recursive: true });
  writeFileSync(stagedFile, stagedBytes, { mode: 0o600 });
  assert.equal(existsSync(plan.targetRoot), false);

  mkdirSync(path.dirname(plan.targetRoot), { recursive: true });
  writeFileSync(plan.targetRoot, "do-not-replace\n", { mode: 0o600 });
  assert.throws(
    () => publishLegacyMarketingSiteDeltaRelease(plan, fixture.contract),
    /Release root must be an unlinked directory/,
  );
  assert.equal(readFileSync(plan.targetRoot, "utf8"), "do-not-replace\n");
  unlinkSync(plan.targetRoot);

  const symlinkDestination = path.join(fixture.root, "outside-delta-release");
  mkdirSync(symlinkDestination);
  symlinkSync(symlinkDestination, plan.targetRoot);
  assert.throws(
    () => publishLegacyMarketingSiteDeltaRelease(plan, fixture.contract),
    /Release root must be an unlinked directory/,
  );
  assert.deepEqual(readdirSync(symlinkDestination), []);
  unlinkSync(plan.targetRoot);

  mkdirSync(plan.targetRoot);
  writeFileSync(path.join(plan.targetRoot, "partial.json"), "{}\n");
  assert.throws(
    () => publishLegacyMarketingSiteDeltaRelease(plan, fixture.contract),
    /partial or unexpected file set/,
  );
  assert.deepEqual(listTreeFiles(plan.targetRoot).map((file) =>
    path.relative(plan.targetRoot, file)
  ), ["partial.json"]);
  rmSync(plan.targetRoot, { recursive: true });

  for (const [relativePath, bytes] of plan.files) {
    const target = path.join(plan.targetRoot, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes, { mode: 0o600 });
  }
  const staleRelativePath = plan.files.keys().next().value;
  assert.ok(staleRelativePath);
  const staleTarget = path.join(plan.targetRoot, staleRelativePath);
  writeFileSync(staleTarget, "stale\n", { mode: 0o600 });
  assert.throws(
    () => publishLegacyMarketingSiteDeltaRelease(plan, fixture.contract),
    /differs at/,
  );
  assert.equal(readFileSync(staleTarget, "utf8"), "stale\n");
  rmSync(plan.targetRoot, { recursive: true });
  assert.equal(existsSync(plan.targetRoot), false);

  const publication = publishLegacyMarketingSiteDeltaRelease(
    plan,
    fixture.contract,
  );
  assert.equal(publication.publication, "created");
  assert.equal(publication.renameOperations, 1);
  assert.deepEqual(publication.durability, {
    stagedFilesFsynced: 70,
    stageDirectoryFsynced: true,
    targetParentFsynced: true,
  });
  assert.equal(listTreeFiles(plan.targetRoot).length, 70);
  assert.equal(existsSync(plan.stageRoot), false);
  assert.equal(
    buildLegacyMarketingSiteComposedCorpusFromRepository({
      repoRoot: fixture.root,
      contract: fixture.contract,
    }).identity.corpusSha256,
    prepublication.identity.corpusSha256,
  );
  const replay = publishLegacyMarketingSiteDeltaRelease(plan, fixture.contract);
  assert.equal(replay.publication, "exact-replay");
  assert.equal(replay.renameOperations, 0);
  assert.equal(replay.durability, null);
  assert.equal(existsSync(plan.stageRoot), false);

  const removedArtifact = plan.artifacts[0];
  assert.ok(removedArtifact);
  unlinkSync(path.join(
    plan.targetRoot,
    path.relative(
      "translations/legacy-marketing-site-delta",
      removedArtifact.relativePath,
    ),
  ));
  assert.throws(
    () => publishLegacyMarketingSiteDeltaRelease(plan, fixture.contract),
    /partial or unexpected file set/,
  );
});

test("one invalid candidate prevents every tracked delta release write", (t) => {
  const fixture = createReleaseFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFixtureCandidates(fixture);
  const damagedJob = fixture.master.jobs.at(-1);
  assert.ok(damagedJob);
  writeFileSync(fixtureCandidatePath(fixture, damagedJob), "{}\n", {
    mode: 0o600,
  });
  assert.throws(
    () => buildLegacyMarketingSiteDeltaReleasePlan({
      master: fixture.master,
      repoRoot: fixture.root,
      runDirectory: fixture.runDirectory,
      contract: fixture.contract,
    }),
    /candidate|Candidate|schema/i,
  );
  assert.equal(
    existsSync(path.join(
      fixture.root,
      "translations/legacy-marketing-site-delta",
    )),
    false,
  );
});

test("release CLI is inert by default and requires explicit execution for promotion", () => {
  const defaults = parseLegacyMarketingSiteDeltaReleaseCliOptions([]);
  assert.equal(defaults.execute, false);
  assert.equal(defaults.promote, false);
  assert.equal(defaults.workers, 1);
  assert.throws(
    () => parseLegacyMarketingSiteDeltaReleaseCliOptions(["--promote"]),
    /requires --execute/,
  );
  assert.throws(
    () => parseLegacyMarketingSiteDeltaReleaseCliOptions([
      "--execute",
      "--workers",
      "2",
    ]),
    /permits exactly one worker/,
  );
  assert.throws(
    () => parseLegacyMarketingSiteDeltaReleaseCliOptions([
      "--execute",
      "--execute",
    ]),
    /cannot be repeated/,
  );
});

function createReleaseContract() {
  const delta = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `site.delta.${String(index).padStart(2, "0")}`,
      String(index + 10),
    ]),
  );
  const manifest: LegacyMarketingSiteSourceManifest = {
    "marketing-site": sourceEntry({ "site.route": "1", ...delta }),
    "route:release": sourceEntry({ "site.route": "1" }),
  };
  return deriveLegacyMarketingSiteContract(manifest);
}

function createReleaseFixture() {
  const root = mkdtempSync(path.join(
    realpathSync(os.tmpdir()),
    "inspir-delta-release-",
  ));
  const runDirectory = path.join(root, "tmp/release-run");
  const modelDirectory = path.join(root, "model");
  const workerScript = path.join(root, "scripts/worker.py");
  const pipelineScript = path.join(
    root,
    "scripts/generate-long-tail-translations.ts",
  );
  const python = path.join(root, "python");
  const pythonTarget = path.join(root, "python-runtime");
  mkdirSync(modelDirectory, { recursive: true });
  mkdirSync(path.dirname(workerScript), { recursive: true });
  writeFileSync(workerScript, "# fixture worker\n", { mode: 0o700 });
  writeFileSync(pipelineScript, "export {};\n", { mode: 0o600 });
  writeFileSync(pythonTarget, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  symlinkSync(path.basename(pythonTarget), python);
  chmodSync(workerScript, 0o700);
  chmodSync(pythonTarget, 0o700);
  const contract = createReleaseContract();
  const inventory: LongTailInventory = Object.freeze({
    languages: legacyMarketingSiteTargetLanguages,
    sources: Object.freeze([Object.freeze({
      namespace: contract.namespace,
      sourceHash: contract.deltaHash,
      sourceStrings: contract.deltaSourceStrings,
    })]),
    curatedRoot: path.join(
      root,
      "translations/legacy-marketing-site-delta",
    ),
  });
  const seedMemory = createLongTailSeedMemory(inventory);
  const generationOverrides = createLongTailGenerationOverrides(seedMemory);
  const provenance: LongTailPipelineProvenance = Object.freeze({
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
    protectorVersion: LONG_TAIL_TRANSLATION_PROTECTOR_VERSION,
    protectorSha256: hashA,
    pipelineImplementationSha256: sha256Text(readFileSync(pipelineScript, "utf8")),
    workerImplementationSha256: sha256Text(readFileSync(workerScript, "utf8")),
    validatorPolicy: fixtureValidatorPolicy,
    modelLabel: "fixture-local-model",
    modelSha256: hashB,
    seedMemorySha256: seedMemory.seedMemorySha256,
    seedMemoryEntries: seedMemory.entries.length,
    seedMemoryConflicts: seedMemory.conflicts.length,
    generationOverridesSha256:
      generationOverrides.generationOverridesSha256,
    generationOverrideEntries: generationOverrides.entries.length,
    generationConfig: Object.freeze({
      batchSize: 1,
      numBeams: 1,
      noRepeatNgramSize: 0,
      dtype: "float32",
      device: "mps",
      maxSourceTokens: 64,
      maxNewTokens: 64,
      maxRetryAttempts: 1,
      deterministicAlgorithms: true,
      manualSeed: 0,
    }),
  });
  const master = buildLongTailMasterWorklist({
    inventory,
    provenance,
    seedMemory,
  }).worklist;
  assert.equal(master.jobs.length, 69);
  assertLegacyMarketingSiteDeltaMaster(master, contract);
  materializeLongTailWorklists({ master, runDirectory });
  return Object.freeze({
    root,
    runDirectory,
    modelDirectory,
    workerScript,
    python,
    contract,
    master,
  });
}

function writeFixtureRoutePacks(fixture: ReturnType<typeof createReleaseFixture>) {
  const source = fixture.contract.routeSourcesByNamespace["route:release"];
  assert.ok(source);
  for (const language of legacyMarketingSiteTargetLanguages) {
    writeRoutePack(fixture.root, language, "route:release", {
      schemaVersion: 1,
      language,
      locale: languageConfigs[language].prefix || languageConfigs[language].locale,
      namespace: "route:release",
      sourceHash: source.sourceHash,
      model: "curated-quality-repair-v3",
      entries: [{ key: "site.route", source: "1", value: "1" }],
    });
  }
}

function writeFixtureCandidates(
  fixture: ReturnType<typeof createReleaseFixture>,
  selectedJobHashes?: ReadonlySet<string>,
) {
  for (const job of fixture.master.jobs) {
    if (selectedJobHashes && !selectedJobHashes.has(job.jobSha256)) continue;
    const pack = createLongTailPackWorklist({
      master: fixture.master,
      job,
    });
    const candidate = createLongTailCandidate({
      pack,
      values: Object.fromEntries(
        pack.source.entries.map((entry) => [entry.key, entry.source]),
      ),
    });
    const target = fixtureCandidatePath(fixture, job);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(candidate, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}

function fixtureCandidatePath(
  fixture: ReturnType<typeof createReleaseFixture>,
  job: LongTailMasterWorklist["jobs"][number],
) {
  return path.join(
    fixture.runDirectory,
    "candidates",
    job.candidateRelativePath,
  );
}

function listTreeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? listTreeFiles(target) : [target];
  });
}

function writeRoutePack(
  root: string,
  language: SupportedLanguage,
  namespace: string,
  value: unknown,
) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const file = path.join(
    root,
    "translations/curated",
    locale,
    `${namespace.replace(/[^a-z0-9.-]+/gi, "__")}.json`,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (isJsonArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function isJsonArray(
  value: readonly JsonValue[] | JsonObject,
): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function canonicalSha256(value: JsonValue) {
  return sha256Text(canonicalJson(value));
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
