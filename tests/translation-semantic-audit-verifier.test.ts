import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import {
  calculateTranslationSemanticAuditRawObjectDigestWithoutMember,
  canonicalTranslationAuditJson,
  assertCurrentTranslationSemanticGenerationOverrides,
  assertCurrentTranslationSemanticGeneratorProvenance,
  isTranslationSemanticAuditPackBasename,
  sha256CanonicalTranslationAuditJson,
  TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_EVIDENCE_KIND,
  TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_KIND,
  TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_ROOT_BASENAME,
  TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_SITE_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_FULL_MANIFEST_BASENAME,
  TRANSLATION_SEMANTIC_AUDIT_KIND,
  TRANSLATION_SEMANTIC_AUDIT_LANGUAGE_BY_LOCALE,
  TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
  TRANSLATION_SEMANTIC_AUDIT_POLICY,
  TRANSLATION_SEMANTIC_AUDIT_RELEASE_WARNINGS,
  TRANSLATION_SEMANTIC_AUDIT_SESSION_KIND,
  TRANSLATION_SEMANTIC_AUDIT_SESSION_RECORD_KIND,
  TRANSLATION_SEMANTIC_AUDIT_VERSION,
  deriveTranslationSemanticAuditProtectedSourceText,
  roundTranslationSemanticAuditScoreToSixDecimals,
  translationSemanticAuditManifestSchema,
  verifyTranslationSemanticAuditManifest,
  type TranslationSemanticAuditManifest,
} from "../scripts/verify-translation-semantic-audit";
import {
  createTranslationSemanticReleaseAttestation,
  readAndValidateTranslationSemanticReleaseAttestation,
  TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_RELATIVE_PATH,
} from "../scripts/translation-semantic-release-attestation";
import {
  finalizeLongTailPromotionSnapshot,
  LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND,
  LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
  promoteLongTailPromotionSnapshot,
  type LongTailPromotionSnapshotArtifact,
} from "../scripts/long-tail-promotion-snapshot";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
} from "../lib/i18n/main-app-source";
import { protectLongTailSourceText } from "../scripts/generate-long-tail-translations";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE,
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
} from "../scripts/long-tail-nllb-execution-profile";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
} from "../lib/i18n/site-source";

test("semantic score rounding exactly matches pinned Python half-even binary64 behavior", () => {
  const cases: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 1],
    [-0, -0],
    [1e-7, 0],
    [1e-6, 1e-6],
    [1.62008946062997e-5, 1.6e-5],
    [1e20, 1e20],
    [1e21, 1e21],
    [0.0000005, 0],
    [0.0000015, 0.000002],
    [0.0000025, 0.000003],
    [-0.0000005, -0],
    [-0.0000015, -0.000002],
    [-0.0000025, -0.000003],
    [0.1234565, 0.123456],
    [0.1234575, 0.123457],
  ];
  for (const [raw, expected] of cases) {
    assert.ok(
      Object.is(
        roundTranslationSemanticAuditScoreToSixDecimals(raw),
        expected,
      ),
      `round(${String(raw)}, 6) drifted`,
    );
  }
});

test("raw audit digests bind genuine CPython numeric lexemes byte for byte", () => {
  const withoutDigest =
    '{"eMinusSeven":1e-07,"eMinusSix":1e-06,"ePlusTwenty":1e+20,"ePlusTwentyOne":1e+21,"negativeZero":-0.0,"one":1.0,"ratio":1.62008946062997e-05,"zero":0.0}';
  const expected = sha256(withoutDigest);
  const genuinePythonBytes =
    `{"digest":"${expected}",${withoutDigest.slice(1)}\n`;

  assert.equal(
    calculateTranslationSemanticAuditRawObjectDigestWithoutMember(
      genuinePythonBytes,
      "digest",
    ),
    expected,
  );

  const substitutedBytes = genuinePythonBytes.replace("1e-07", "1e-7");
  assert.notEqual(
    calculateTranslationSemanticAuditRawObjectDigestWithoutMember(
      substitutedBytes,
      "digest",
    ),
    expected,
  );
});

test("final verifier protected-source derivation matches the independent generator contract", () => {
  const productionSources = [
    ...Object.values(getMainAppSourceStrings()),
    ...getAllSiteTranslationNamespaces().flatMap((namespace) =>
      Object.values(getSiteTranslationSource(namespace).sourceStrings)
    ),
  ];
  assert.ok(productionSources.length > 16_000);
  const adversarialSources = [
    "+/protected/path",
    "-/protected/path",
    "é/protected/path",
    "١/protected/path",
    "😀 https://example.com/path?x=12",
    "éuser@example.com",
    "user@éxample.com",
    "ſuser@example.com",
    "user@Kexample.com",
    "éexample.com",
    "example.comé",
    "ſexample.com",
    "example.comK",
    "OpenAI ChatGPT {learner} 12.50% /account/delete",
    "<strong>inspir</strong><!-- fixed --> &nbsp; `code`",
    "mailto:user@example.com",
    "tel:+441234567890",
    "Use %1$s and ${account.id} at https://example.com/29",
    "\u0000 astral 😀 prefix example.com",
  ];
  for (const source of [...productionSources, ...adversarialSources]) {
    assert.equal(
      canonicalTranslationAuditJson(
        deriveTranslationSemanticAuditProtectedSourceText(source),
      ),
      canonicalTranslationAuditJson(protectLongTailSourceText(source)),
      `protected-source contract drifted for ${JSON.stringify(source)}`,
    );
  }
});

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function generatorProvenanceFixture() {
  const seedMemoryMaterial = {
    schemaVersion: 1,
    kind: "inspir-long-tail-translation-seed-memory-v1",
    entries: [],
    conflicts: [],
  };
  const generationOverrideMaterial = {
    schemaVersion: 1,
    kind: "inspir-long-tail-generation-overrides-v1",
    entries: [],
  };
  return {
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfile: structuredClone(LONG_TAIL_NLLB_EXECUTION_PROFILE),
    protectorVersion: "inspir-long-tail-literal-protector-v1" as const,
    protectorSha256: sha256("synthetic-protector"),
    pipelineImplementationSha256: sha256("synthetic-pipeline"),
    workerImplementationSha256: sha256("synthetic-worker"),
    validatorPolicy: {
      kind: "inspir-long-tail-validator-policy-v1" as const,
      files: Array.from({ length: 7 }, (_, index) => ({
        relativePath: `lib/validator/${String(index)}.ts`,
        bytes: index + 1,
        sha256: sha256(`synthetic-validator-${String(index)}`),
      })),
      validatorPolicySha256: sha256("synthetic-validator-policy"),
    },
    modelLabel: "synthetic-model",
    modelSha256: sha256("synthetic-model"),
    seedMemorySha256:
      sha256CanonicalTranslationAuditJson(seedMemoryMaterial),
    seedMemoryEntries: 0,
    seedMemoryConflicts: 0,
    generationOverridesSha256:
      sha256CanonicalTranslationAuditJson(generationOverrideMaterial),
    generationOverrideEntries: 0,
    generationConfig: {
      batchSize: 1,
      numBeams: 1,
      noRepeatNgramSize: 0,
      dtype: "float32" as const,
      device: "cpu" as const,
      maxSourceTokens: 128,
      maxNewTokens: 128,
      maxRetryAttempts: 1,
      deterministicAlgorithms: true as const,
      manualSeed: 0 as const,
    },
  };
}

const reviewedAfrikaansSource =
  "Use Case Study Simulator when this is the right mode for the job. If you want a related path, try Feynman Tutor. You can also browse the AI learning blog for study methods, Socratic learning, flashcards, roleplay, and active recall.";
const reviewedAfrikaansSourceSha256 =
  "f29c6dd11a9cb5a2e3134f68923ee2bf46dfb03233002dc2eee1a05088a51396";
const reviewedAfrikaansValue =
  "Gebruik Gevallestudiesimulator wanneer dit die regte modus vir die taak is. As jy ’n verwante leerpad wil volg, probeer Feynman Tutor. Jy kan ook deur die KI-leerblog blaai vir studiemetodes, Sokratiese leer, flitskaarte, rolspel en aktiewe herroeping.";
const reviewedAfrikaansValueSha256 =
  "3b0c87fb7a637bbbfb48341a5b5935e4191bfebec04f145e6bab130134be89d0";

function reviewedAfrikaansGenerationOverrideProjection() {
  assert.equal(sha256(reviewedAfrikaansSource), reviewedAfrikaansSourceSha256);
  assert.equal(sha256(reviewedAfrikaansValue), reviewedAfrikaansValueSha256);
  const protectedSource = protectLongTailSourceText(reviewedAfrikaansSource);
  const sourceEntry = {
    key: "site.d835e997c12945b8ec",
    source: reviewedAfrikaansSource,
    sourceSha256: reviewedAfrikaansSourceSha256,
    invariantSha256: protectedSource.invariantSha256,
    segments: protectedSource.segments,
  };
  const sourceEntries = [sourceEntry];
  const sourceHash = sha256("synthetic reviewed Afrikaans source pack");
  const sourceEntriesSha256 =
    sha256CanonicalTranslationAuditJson(sourceEntries);
  const seedEntry = {
    language: "Afrikaans",
    locale: "af",
    source: reviewedAfrikaansSource,
    sourceSha256: reviewedAfrikaansSourceSha256,
    value: reviewedAfrikaansValue,
    valueSha256: reviewedAfrikaansValueSha256,
  };
  const seedMaterial = {
    schemaVersion: 1,
    kind: "inspir-long-tail-translation-seed-memory-v1",
    entries: [seedEntry],
    conflicts: [],
  };
  const seedMemorySha256 = sha256CanonicalTranslationAuditJson(seedMaterial);
  const generationOverrideEntry = {
    ...seedEntry,
    requiredOccurrences: [{
      namespace: "route:test",
      sourceHash,
      key: sourceEntry.key,
    }],
  };
  const generationOverrideMaterial = {
    schemaVersion: 1,
    kind: "inspir-long-tail-generation-overrides-v1",
    entries: [generationOverrideEntry],
  };
  const generationOverridesSha256 =
    sha256CanonicalTranslationAuditJson(generationOverrideMaterial);
  const jobMaterial = {
    language: "Afrikaans",
    locale: "af",
    nllbCode: "afr_Latn",
    namespace: "route:test",
    sourceHash,
    sourceEntriesSha256,
    entryCount: 1,
    worklistRelativePath: "af/route__test.json",
    candidateRelativePath: "af/route__test.json",
    targetRelativePath: "af/route__test.json",
  };
  return {
    provenance: {
      ...generatorProvenanceFixture(),
      seedMemorySha256,
      seedMemoryEntries: 1,
      generationOverridesSha256,
      generationOverrideEntries: 1,
    },
    seedMemory: {
      ...seedMaterial,
      seedMemorySha256,
    },
    generationOverrides: {
      ...generationOverrideMaterial,
      generationOverridesSha256,
    },
    sources: [{
      namespace: "route:test",
      sourceHash,
      sourceEntriesSha256,
      entries: sourceEntries,
    }],
    jobs: [{
      ...jobMaterial,
      jobSha256: sha256CanonicalTranslationAuditJson(jobMaterial),
    }],
  };
}

test(
  "semantic verifier accepts the exact non-empty reviewed override intersection and rejects coordinated tampering",
  () => {
    const projection = reviewedAfrikaansGenerationOverrideProjection();
    assert.doesNotThrow(() =>
      assertCurrentTranslationSemanticGenerationOverrides(projection)
    );

    const removed = structuredClone(projection);
    removed.generationOverrides.entries = [];
    removed.generationOverrides.generationOverridesSha256 =
      sha256CanonicalTranslationAuditJson({
        schemaVersion: removed.generationOverrides.schemaVersion,
        kind: removed.generationOverrides.kind,
        entries: removed.generationOverrides.entries,
      });
    removed.provenance.generationOverridesSha256 =
      removed.generationOverrides.generationOverridesSha256;
    removed.provenance.generationOverrideEntries = 0;
    assert.throws(
      () => assertCurrentTranslationSemanticGenerationOverrides(removed),
      /exact required reviewed set/,
    );

    const missingGenerationOverrides = structuredClone(projection);
    Reflect.deleteProperty(missingGenerationOverrides, "generationOverrides");
    assert.throws(
      () =>
        assertCurrentTranslationSemanticGenerationOverrides(
          missingGenerationOverrides,
        ),
      /generationOverrides/,
    );

    const coordinatedValueTamper = structuredClone(projection);
    const tamperedValue = `${reviewedAfrikaansValue} Onbeoordeel.`;
    const tamperedValueSha256 = sha256(tamperedValue);
    const tamperedSeed = coordinatedValueTamper.seedMemory.entries[0];
    const tamperedOverride =
      coordinatedValueTamper.generationOverrides.entries[0];
    assert.ok(tamperedSeed);
    assert.ok(tamperedOverride);
    tamperedSeed.value = tamperedValue;
    tamperedSeed.valueSha256 = tamperedValueSha256;
    tamperedOverride.value = tamperedValue;
    tamperedOverride.valueSha256 = tamperedValueSha256;
    coordinatedValueTamper.seedMemory.seedMemorySha256 =
      sha256CanonicalTranslationAuditJson({
        schemaVersion: coordinatedValueTamper.seedMemory.schemaVersion,
        kind: coordinatedValueTamper.seedMemory.kind,
        entries: coordinatedValueTamper.seedMemory.entries,
        conflicts: coordinatedValueTamper.seedMemory.conflicts,
      });
    coordinatedValueTamper.generationOverrides.generationOverridesSha256 =
      sha256CanonicalTranslationAuditJson({
        schemaVersion:
          coordinatedValueTamper.generationOverrides.schemaVersion,
        kind: coordinatedValueTamper.generationOverrides.kind,
        entries: coordinatedValueTamper.generationOverrides.entries,
      });
    coordinatedValueTamper.provenance.seedMemorySha256 =
      coordinatedValueTamper.seedMemory.seedMemorySha256;
    coordinatedValueTamper.provenance.generationOverridesSha256 =
      coordinatedValueTamper.generationOverrides.generationOverridesSha256;
    assert.throws(
      () =>
        assertCurrentTranslationSemanticGenerationOverrides(
          coordinatedValueTamper,
        ),
      /exact required reviewed set/,
    );
  },
);

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJson(file: string, value: unknown): Buffer {
  mkdirSync(path.dirname(file), { recursive: true });
  const bytes = jsonBytes(value);
  writeFileSync(file, bytes);
  return bytes;
}

function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalTranslationAuditJson(value)}\n`, "utf8");
}

function writeCanonicalJson(file: string, value: unknown): Buffer {
  mkdirSync(path.dirname(file), { recursive: true });
  const bytes = canonicalJsonBytes(value);
  writeFileSync(file, bytes);
  return bytes;
}

function withoutDigest(value: object, key: string) {
  return Object.fromEntries(Object.entries(value).filter(([entry]) => entry !== key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("final verifier independently rejects coordinated generator v3 and profile rehashes", () => {
  const current = generatorProvenanceFixture();
  assert.doesNotThrow(
    () => assertCurrentTranslationSemanticGeneratorProvenance(current),
  );

  const v3Forgery: unknown = JSON.parse(JSON.stringify(current));
  assert.ok(isRecord(v3Forgery));
  const v3Profile = v3Forgery.executionProfile;
  assert.ok(isRecord(v3Profile));
  v3Forgery.pipelineVersion = "inspir-long-tail-local-nllb-v3";
  v3Profile.pipelineVersion = "inspir-long-tail-local-nllb-v3";
  v3Profile.executionProfileSha256 = sha256CanonicalTranslationAuditJson(
    withoutDigest(v3Profile, "executionProfileSha256"),
  );
  assert.throws(
    () => assertCurrentTranslationSemanticGeneratorProvenance(v3Forgery),
  );

  const profileForgery: unknown = JSON.parse(JSON.stringify(current));
  assert.ok(isRecord(profileForgery));
  const executionProfile = profileForgery.executionProfile;
  assert.ok(isRecord(executionProfile));
  const environment = executionProfile.environment;
  assert.ok(isRecord(environment));
  environment.OMP_NUM_THREADS = "2";
  executionProfile.executionProfileSha256 =
    sha256CanonicalTranslationAuditJson(
      withoutDigest(executionProfile, "executionProfileSha256"),
    );
  assert.throws(
    () => assertCurrentTranslationSemanticGeneratorProvenance(profileForgery),
  );
});

test("final verifier rejects obsolete pre-v10 release roots before reading evidence", () => {
  const workspaceRoot = mkdtempSync(
    path.join(process.cwd(), "tmp/semantic-v9-root-test-"),
  );
  try {
    const runRoot = path.join(
      workspaceRoot,
      "tmp/long-tail-translation-pipeline-v9-af-smoke",
    );
    mkdirSync(runRoot, { recursive: true });
    assert.throws(
      () => verifyTranslationSemanticAuditManifest({ workspaceRoot, runRoot }),
      /obsolete pre-v10 evidence/,
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

type Fixture = Readonly<{
  workspaceRoot: string;
  runRoot: string;
  manifestPath: string;
  implementationPath: string;
  masterPath: string;
  curatedRoot: string;
  candidateRoot: string;
  staticMainAppRoot: string;
  siteSourceManifestPath: string;
  mutableTreeFile: string;
  manifest: TranslationSemanticAuditManifest;
  cleanup: () => void;
}>;

function driftFixtureSiteSourceCatalog(fixture: Fixture): Buffer {
  const original = readFileSync(fixture.siteSourceManifestPath);
  const priorSource = `Learn safely in section ${
    syntheticAlphaDigest("3")
  }, field ${syntheticAlphaDigest("0")}.`;
  const nextSource = `Review safely in section ${
    syntheticAlphaDigest("3")
  }, field ${syntheticAlphaDigest("0")}.`;
  const priorHash = sha256(`field\u0000${priorSource}`);
  const nextHash = sha256(`field\u0000${nextSource}`);
  const drifted = original.toString("utf8")
    .replace(priorSource, nextSource)
    .replace(priorHash, nextHash);
  assert.notEqual(drifted, original.toString("utf8"));
  writeFileSync(fixture.siteSourceManifestPath, drifted);
  return original;
}

function rebindSemanticManifest(
  value: TranslationSemanticAuditManifest,
): TranslationSemanticAuditManifest {
  const manifest = structuredClone(value);
  manifest.results.packEvidenceRootSha256 =
    sha256CanonicalTranslationAuditJson(
      {
        packBindings: manifest.results.packBindings.map((binding) => [
          binding.locale,
          binding.namespace,
          binding.fieldEvidenceRootSha256,
          binding.unadjudicatedFields,
          binding.adjudicatedFields,
        ]),
        afrikaansTrackedCurated:
          manifest.results.afrikaansTrackedCurated,
      },
    );
  const material = withoutDigest(manifest, "manifestSha256");
  return translationSemanticAuditManifestSchema.parse({
    ...material,
    manifestSha256: sha256CanonicalTranslationAuditJson(material),
  });
}

function writeReadonlyManifest(
  fixture: Fixture,
  manifest: TranslationSemanticAuditManifest,
): void {
  chmodSync(fixture.manifestPath, 0o600);
  writeFileSync(fixture.manifestPath, canonicalJsonBytes(manifest));
  chmodSync(fixture.manifestPath, 0o400);
}

const EXPECTED_SYNTHETIC_CANDIDATE_PACKS = 7_957;
const EXPECTED_SYNTHETIC_CURATED_PACKS = 668;
const EXPECTED_SYNTHETIC_STALE_CURATED_FILES = 92;

const SYNTHETIC_HIGH_RISK_SOURCE_PATTERN =
  /\b(?:account|age|child|children|consent|contract|data|delete|deletion|disclose|disclosure|law|legal|liability|liable|license|payment|personal|privacy|refund|rights?|security|terminate|termination|warrant(?:y|ies)|must|shall|may not|will not|prohibited|retention|jurisdiction)\b/iu;
const SYNTHETIC_NEGATION_PATTERN =
  /\b(?:not|no|never|without|neither|nor|none|nothing|nobody|nowhere|cannot|unable|can['’]t|don['’]t|doesn['’]t|didn['’]t|won['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|shouldn['’]t|wouldn['’]t|couldn['’]t|mustn['’]t|haven['’]t|hasn['’]t|hadn['’]t)\b/iu;
const SYNTHETIC_PLACEHOLDER_PATTERN = /\{[A-Za-z0-9_]+\}/gu;
const SYNTHETIC_NUMBER_PATTERN =
  /(?<![A-Za-z])\p{Nd}+(?:[.,:/-]\p{Nd}+)*(?![A-Za-z])/gu;

function syntheticAlphaDigest(value: string): string {
  return sha256(value).slice(0, 32).replace(/[0-9]/gu, (digit) =>
    String.fromCharCode("k".charCodeAt(0) + Number(digit))
  );
}

function syntheticMaskedTranslationValue(source: string): string {
  return [
    "Betroubare rustige kreatiewe leerreis bevorder helder vaardighede",
    "doelgerigte begrip sorgvuldige vordering onafhanklike denke",
    "praktiese ontdekking betekenisvolle oefening volhoubare nuuskierigheid",
    syntheticAlphaDigest(source),
  ].join(" ");
}

function syntheticTranslationValue(source: string): string {
  const literalCopies: string[] = [];
  let cursor = 0;
  for (const segment of protectLongTailSourceText(source).segments) {
    const start = cursor;
    const end = start + segment.value.length;
    cursor = end;
    if (segment.kind !== "literal") continue;
    const prefix = start > 0 && /[A-Za-z]/u.test(source[start - 1] ?? "")
      ? "z"
      : "";
    const suffix = end < source.length && /[A-Za-z]/u.test(source[end] ?? "")
      ? "z"
      : "";
    literalCopies.push(`${prefix}${segment.value}${suffix}`);
  }
  return [syntheticMaskedTranslationValue(source), ...literalCopies].join(" ");
}

function syntheticMaskedProducedValue(source: string): string {
  let value = syntheticTranslationValue(source);
  const literals = [...new Set(
    protectLongTailSourceText(source).segments
      .filter((segment) => segment.kind === "literal")
      .map((segment) => segment.value),
  )].sort((left, right) =>
    [...right].length - [...left].length ||
    (left < right ? -1 : left > right ? 1 : 0)
  );
  for (const literal of literals) value = value.replaceAll(literal, " ");
  return value.replace(/\s+/gu, " ").trim();
}

function syntheticNeedsBacktranslation(
  namespace: string,
  source: string,
): boolean {
  const withoutPlaceholders = source.replace(SYNTHETIC_PLACEHOLDER_PATTERN, " ");
  return /^legal(?::|$)/u.test(namespace) ||
    SYNTHETIC_HIGH_RISK_SOURCE_PATTERN.test(source) ||
    SYNTHETIC_NEGATION_PATTERN.test(source) ||
    [...source.matchAll(SYNTHETIC_PLACEHOLDER_PATTERN)].length > 0 ||
    [...withoutPlaceholders.matchAll(SYNTHETIC_NUMBER_PATTERN)].length > 0;
}

function syntheticSentences(value: string): readonly string[] {
  const sentences = value.split(/(?<=[.!?…])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return (sentences.length ? sentences : value.trim() ? [value.trim()] : [])
    .slice(0, 32);
}

function syntheticPredictions(
  target: string,
  targetProbability = 0.96,
  englishProbability = 0.02,
): Array<readonly [string, number]> {
  const rows: Array<readonly [string, number]> = [
    [target, targetProbability],
    ["en", englishProbability],
  ];
  for (const [label, probability] of [
    ["fr", 0.01],
    ["de", 0.005],
    ["es", 0.001],
    ["pt", 0.0005],
    ["ca", 0.0001],
  ] as const) {
    if (rows.length === 5) break;
    if (!rows.some(([existing]) => existing === label)) {
      rows.push([label, probability]);
    }
  }
  assert.equal(rows.length, 5);
  rows.sort((left, right) => right[1] - left[1]);
  return rows;
}

function makeFullFixture(): Fixture {
  const workspaceRoot = mkdtempSync(
    path.join(realpathSync(os.tmpdir()), "inspir-semantic-gate-"),
  );
  const runRoot = path.join(workspaceRoot, "tmp", "translation-v10");
  const curatedRoot = path.join(workspaceRoot, "translations", "curated");
  const staticMainAppRoot = path.join(
    workspaceRoot,
    "translations",
    "static-main-app",
  );
  const worklistRoot = path.join(runRoot, "worklists");
  const implementationPath = path.join(
    workspaceRoot,
    "scripts",
    "audit-translation-semantics.py",
  );
  const verifierImplementationPath = path.join(
    workspaceRoot,
    "scripts",
    "verify-translation-semantic-audit.ts",
  );
  const siteSourceManifestPath = path.join(
    workspaceRoot,
    "lib",
    "i18n",
    "site-source-manifest.ts",
  );
  const masterPath = path.join(runRoot, "worklist.json");
  const manifestPath = path.join(
    runRoot,
    TRANSLATION_SEMANTIC_AUDIT_FULL_MANIFEST_BASENAME,
  );
  mkdirSync(path.dirname(implementationPath), { recursive: true });
  mkdirSync(worklistRoot, { recursive: true });
  mkdirSync(curatedRoot, { recursive: true });
  mkdirSync(staticMainAppRoot, { recursive: true });
  const implementationBytes = Buffer.from("# synthetic pinned auditor\n", "utf8");
  writeFileSync(implementationPath, implementationBytes);
  writeFileSync(
    verifierImplementationPath,
    "// synthetic pinned verifier\n",
  );

  const namespaces = [
    "legal:terms",
    "main-app",
    ...Array.from(
      { length: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT - 2 },
      (_, index) => `route:${String(index).padStart(3, "0")}`,
    ),
  ];
  assert.deepEqual([...namespaces].sort(), namespaces);
  const currentMainAppStrings = getMainAppSourceStrings();
  const currentMainAppKeys = Object.keys(currentMainAppStrings).sort(
    (left, right) => left < right ? -1 : left > right ? 1 : 0,
  );
  const firstMainAppKey = currentMainAppKeys[0];
  assert.ok(firstMainAppKey);
  const firstMainAppSource = currentMainAppStrings[firstMainAppKey];
  assert.ok(firstMainAppSource);
  const sources = namespaces.map((namespace, index) => {
    const entries = namespace === "main-app"
      ? currentMainAppKeys.map((key) => {
        const source = currentMainAppStrings[key];
        assert.ok(source);
        const protectedSource = protectLongTailSourceText(source);
        return {
          key,
          source,
          sourceSha256: sha256(source),
          invariantSha256: protectedSource.invariantSha256,
          segments: protectedSource.segments,
        };
      })
      : Array.from(
        { length: namespace === "route:000" ? 20 : 1 },
        (_, fieldIndex) => {
          const source = namespace === "route:000" && fieldIndex === 0
            ? firstMainAppSource
            : `Learn safely in section ${syntheticAlphaDigest(String(index))}, field ${
              syntheticAlphaDigest(String(fieldIndex))
            }.`;
          const protectedSource = protectLongTailSourceText(source);
          return {
            key: namespace === "route:000"
              ? `field-${String(fieldIndex).padStart(2, "0")}`
              : "field",
            source,
            sourceSha256: sha256(source),
            invariantSha256: protectedSource.invariantSha256,
            segments: protectedSource.segments,
          };
        },
      );
    const sourceStrings = Object.fromEntries(
      entries.map((entry) => [entry.key, entry.source]),
    );
    const sourceHash = sha256(
      Object.keys(sourceStrings).sort().map((key) =>
        `${key}\u0000${sourceStrings[key] ?? ""}`
      ).join("\u0001"),
    );
    return {
      namespace,
      sourceHash: namespace === "main-app"
        ? getMainAppSourceHash(currentMainAppStrings)
        : sourceHash,
      sourceEntriesSha256: sha256CanonicalTranslationAuditJson(entries),
      entries,
    };
  });
  const siteSourceManifest = Object.fromEntries([
    [
      "marketing-site",
      {
        sourceHash: sha256("site.fixture\u0000Fixture marketing source"),
        sourceStrings: { "site.fixture": "Fixture marketing source" },
      },
    ],
    ...sources
      .filter((source) => source.namespace !== "main-app")
      .map((source) => [
        source.namespace,
        {
          sourceHash: source.sourceHash,
          sourceStrings: Object.fromEntries(
            source.entries.map((entry) => [entry.key, entry.source]),
          ),
        },
      ] as const),
  ]);
  mkdirSync(path.dirname(siteSourceManifestPath), { recursive: true });
  writeFileSync(
    siteSourceManifestPath,
    `// Synthetic semantic verifier fixture.\nexport const siteSourceManifest = ${
      JSON.stringify(siteSourceManifest, null, 2)
    } as const;\n`,
  );
  const candidateRoot = path.join(runRoot, "candidates");
  const provenance = generatorProvenanceFixture();
  const jobs: Array<Readonly<Record<string, unknown>>> = [];
  const jobByIdentity = new Map<string, Readonly<Record<string, unknown>>>();
  const plans: Array<Readonly<{
    locale: (typeof TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES)[number];
    language: string;
    source: (typeof sources)[number];
    basename: string;
    relativePath: string;
    candidate: boolean;
  }>> = [];
  const curatedRows: Array<readonly [string, number, string]> = [];
  const candidateRows: Array<readonly [string, number, string]> = [];
  const worklistRows: Array<readonly [string, number, string]> = [];
  const staticMainAppRows: Array<readonly [string, number, string]> = [];
  type SyntheticAfrikaansContext = Readonly<{
    contextSha256: string;
    distinctMaskedValues: number;
    maskedLetters: number;
    eligible: boolean;
    predictions: ReadonlyArray<readonly [string, number]>;
    gatePassed: boolean;
    rescuedFields: number;
    fieldPairRescuedFields: number;
    trackedCuratedRescuedFields: number;
    referenceMatchFields: number;
    referenceMatchRootSha256: string;
    trackedCuratedRescueRootSha256: string;
  }>;
  type SyntheticBinding = Readonly<{
    locale: (typeof TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES)[number];
    language: string;
    namespace: string;
    sourceHash: string;
    sourceEntriesSha256: string;
    origin: "candidate" | "curated";
    packFileSha256: string;
    fields: number;
    fieldIdentityRootSha256: string;
    fieldEvidenceRootSha256: string;
    afrikaansPackContext: SyntheticAfrikaansContext | null;
    unadjudicatedFields: number;
    adjudicatedFields: number;
  }>;
  const bindings: SyntheticBinding[] = [];
  const checkpointPackMaterials: Array<Readonly<{
    fieldEvidenceRows: readonly unknown[];
    derivationEvidenceRows: readonly unknown[];
    counts: Readonly<Record<string, number>>;
    fieldValueRootSha256: string;
  }>> = [];
  const mainAppSource = sources.find((source) => source.namespace === "main-app");
  assert.ok(mainAppSource);
  const syntheticMainAppValue = (_language: string, source: string) =>
    syntheticTranslationValue(source);
  const afrikaansSupportPairIdentities = new Map<string, string>();
  const afrikaansSupportPairRows = new Map<string, readonly string[]>();
  for (const entry of mainAppSource.entries) {
    const value = syntheticMainAppValue("Afrikaans", entry.source);
    const valueSha256 = sha256(value);
    const supportKey = canonicalTranslationAuditJson([
      "af",
      entry.source,
      entry.sourceSha256,
      value,
      valueSha256,
    ]);
    const pairIdentity = sha256CanonicalTranslationAuditJson([
      "af",
      entry.source,
      entry.sourceSha256,
      value,
      valueSha256,
    ]);
    afrikaansSupportPairIdentities.set(supportKey, pairIdentity);
    afrikaansSupportPairRows.set(entry.sourceSha256, [
      pairIdentity,
      "af",
      entry.source,
      entry.sourceSha256,
      value,
      valueSha256,
    ]);
  }
  let mutableTreeFile = "";
  let candidatePackIndex = 0;
  for (const locale of TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES) {
    const language = TRANSLATION_SEMANTIC_AUDIT_LANGUAGE_BY_LOCALE[locale];
    for (const source of sources) {
      const basename = `${source.namespace.replaceAll(":", "__")}.json`;
      const relativePath = `${locale}/${basename}`;
      const candidate = source.namespace !== "main-app" &&
        candidatePackIndex < EXPECTED_SYNTHETIC_CANDIDATE_PACKS;
      if (candidate) candidatePackIndex += 1;
      plans.push({
        locale,
        language,
        source,
        basename,
        relativePath,
        candidate,
      });
      if (candidate) {
        const jobMaterial = {
          language,
          locale,
          nllbCode: "aaa_Latn",
          namespace: source.namespace,
          sourceHash: source.sourceHash,
          sourceEntriesSha256: source.sourceEntriesSha256,
          entryCount: source.entries.length,
          worklistRelativePath: relativePath,
          candidateRelativePath: relativePath,
          targetRelativePath: relativePath,
        };
        const job = {
          ...jobMaterial,
          jobSha256: sha256CanonicalTranslationAuditJson(jobMaterial),
        };
        jobs.push(job);
        jobByIdentity.set(`${locale}\u0000${source.namespace}`, job);
      }
    }
  }
  assert.equal(plans.length, TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT);
  assert.equal(jobs.length, EXPECTED_SYNTHETIC_CANDIDATE_PACKS);
  const masterMaterial = {
    schemaVersion: 1,
    kind: "inspir-long-tail-translation-worklist-v1",
    provenance,
    seedMemory: {
      schemaVersion: 1,
      kind: "inspir-long-tail-translation-seed-memory-v1",
      entries: [],
      conflicts: [],
      seedMemorySha256: provenance.seedMemorySha256,
    },
    generationOverrides: {
      schemaVersion: 1,
      kind: "inspir-long-tail-generation-overrides-v1",
      entries: [],
      generationOverridesSha256: provenance.generationOverridesSha256,
    },
    sources,
    jobs,
  };
  const master = {
    ...masterMaterial,
    worklistSha256: sha256CanonicalTranslationAuditJson(masterMaterial),
  };
  const masterBytes = writeJson(masterPath, master);

  for (const plan of plans) {
    const { locale, language, source, basename, relativePath } = plan;
    const translatedEntries = source.entries.map((entry, index) => ({
      key: entry.key,
      source: entry.source,
      sourceSha256: entry.sourceSha256,
      value: source.namespace === "main-app"
        ? syntheticMainAppValue(language, entry.source)
        : source.namespace === "route:000"
          ? locale === "af" && index === 0
            ? syntheticMainAppValue(language, entry.source)
            : syntheticTranslationValue(entry.source)
          : syntheticTranslationValue(entry.source),
    }));
    const translatedValues = Object.fromEntries(
      translatedEntries.map((entry) => [entry.key, entry.value]),
    );
    let origin: "candidate" | "curated";
    let packFileSha256: string;
    if (source.namespace === "main-app") {
      origin = "curated";
      const staticBytes = writeJson(path.join(staticMainAppRoot, `${locale}.json`), {
        schemaVersion: 1,
        kind: "static-main-app-values",
        language,
        locale,
        sourceHash: source.sourceHash,
        keyCount: source.entries.length,
        strings: translatedEntries.map((entry) => entry.value),
      });
      packFileSha256 = sha256(staticBytes);
      staticMainAppRows.push([
        `${locale}.json`,
        staticBytes.byteLength,
        packFileSha256,
      ]);
    } else if (plan.candidate) {
      origin = "candidate";
      const job = jobByIdentity.get(`${locale}\u0000${source.namespace}`);
      assert.ok(job);
      const packWorklistMaterial = {
        schemaVersion: 1,
        kind: "inspir-long-tail-translation-pack-worklist-v1",
        masterWorklistSha256: master.worklistSha256,
        provenance,
        job,
        source,
      };
      const packWorklist = {
        ...packWorklistMaterial,
        packWorklistSha256: sha256CanonicalTranslationAuditJson(
          packWorklistMaterial,
        ),
      };
      const worklistFile = path.join(worklistRoot, locale, basename);
      const worklistBytes = writeJson(worklistFile, packWorklist);
      worklistRows.push([
        relativePath,
        worklistBytes.byteLength,
        sha256(worklistBytes),
      ]);
      const candidatePayload = {
        schemaVersion: 1,
        kind: "inspir-long-tail-translation-candidate-v1",
        pipelineVersion: provenance.pipelineVersion,
        executionProfileSha256: LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
        masterWorklistSha256: master.worklistSha256,
        packWorklistSha256: packWorklist.packWorklistSha256,
        jobSha256: job.jobSha256,
        language,
        locale,
        namespace: source.namespace,
        sourceHash: source.sourceHash,
        sourceEntriesSha256: source.sourceEntriesSha256,
        modelLabel: provenance.modelLabel,
        modelSha256: provenance.modelSha256,
        workerImplementationSha256: provenance.workerImplementationSha256,
        validatorPolicySha256:
          provenance.validatorPolicy.validatorPolicySha256,
        entries: translatedEntries,
      };
      const candidateFile = path.join(candidateRoot, locale, basename);
      const candidateBytes = writeJson(candidateFile, candidatePayload);
      packFileSha256 = sha256(candidateBytes);
      candidateRows.push([
        relativePath,
        candidateBytes.byteLength,
        packFileSha256,
      ]);
      if (curatedRows.length < EXPECTED_SYNTHETIC_STALE_CURATED_FILES) {
        const staleCuratedPayload = {
          schemaVersion: 1,
          language,
          locale,
          namespace: source.namespace,
          sourceHash: source.sourceHash,
          translations: Object.fromEntries(
            translatedEntries.map((entry) => [entry.key, `Stale ${entry.value}`]),
          ),
        };
        const staleCuratedFile = path.join(curatedRoot, locale, basename);
        const staleCuratedBytes = writeJson(
          staleCuratedFile,
          staleCuratedPayload,
        );
        if (!mutableTreeFile) mutableTreeFile = staleCuratedFile;
        curatedRows.push([
          relativePath,
          staleCuratedBytes.byteLength,
          sha256(staleCuratedBytes),
        ]);
      }
    } else {
      origin = "curated";
      const curatedPayload = {
        schemaVersion: 1,
        language,
        locale,
        namespace: source.namespace,
        sourceHash: source.sourceHash,
        translations: translatedValues,
      };
      const curatedFile = path.join(curatedRoot, locale, basename);
      const curatedBytes = writeJson(curatedFile, curatedPayload);
      if (!mutableTreeFile) mutableTreeFile = curatedFile;
      const curatedSha256 = sha256(curatedBytes);
      curatedRows.push([
        relativePath,
        curatedBytes.byteLength,
        curatedSha256,
      ]);
      packFileSha256 = sha256CanonicalTranslationAuditJson([
        [basename, curatedBytes.byteLength, curatedSha256],
      ]);
    }
    const fieldRows = translatedEntries.map((translated, index) => {
      const sourceEntry = source.entries[index];
      assert.ok(sourceEntry);
      const valueSha256 = sha256(translated.value);
      const fieldIdentitySha256 = sha256CanonicalTranslationAuditJson([
        locale,
        language,
        source.namespace,
        source.sourceHash,
        translated.key,
        sourceEntry.sourceSha256,
        valueSha256,
        origin,
        packFileSha256,
      ]);
      return [
        fieldIdentitySha256,
        translated.key,
        sourceEntry.sourceSha256,
        valueSha256,
      ];
    });
    const referenceMatchRows: Array<readonly [string, string]> = [];
    if (locale === "af" && origin === "candidate") {
      translatedEntries.forEach((translated, index) => {
        const sourceEntry = source.entries[index];
        const fieldRow = fieldRows[index];
        assert.ok(sourceEntry);
        assert.ok(fieldRow);
        const valueSha256 = sha256(translated.value);
        const supportPairIdentity = afrikaansSupportPairIdentities.get(
          canonicalTranslationAuditJson([
            "af",
            sourceEntry.source,
            sourceEntry.sourceSha256,
            translated.value,
            valueSha256,
          ]),
        );
        if (supportPairIdentity !== undefined) {
          const fieldIdentity = fieldRow[0];
          assert.ok(fieldIdentity);
          referenceMatchRows.push([fieldIdentity, supportPairIdentity]);
        }
      });
    }
    const normalizedContextValues = new Set(
      source.entries.map((entry) =>
        syntheticMaskedProducedValue(entry.source)
          .normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim()
      ),
    );
    const context = [...normalizedContextValues].sort().join(" ");
    const contextEligible =
      normalizedContextValues.size >= 20 &&
      [...context].filter((character) => /\p{L}/u.test(character)).length >=
        1_000;
    const trackedCuratedRescuedFields =
      locale === "af" && source.namespace === "route:000"
        ? referenceMatchRows.length
        : 0;
    const contextPredictions: Array<readonly [string, number]> =
      contextEligible
        ? [
          ["af", 0.55],
          ["nl", 0.2],
          ["en", 0.1],
          ["de", 0.05],
          ["fr", 0.01],
        ]
        : [];
    const checkpointFieldEvidenceRows: unknown[] = [];
    const checkpointDerivationEvidenceRows: unknown[] = [];
    let packLanguageEvidenceFields = 0;
    let packBacktranslatedFields = 0;
    translatedEntries.forEach((translated, index) => {
      const sourceEntry = source.entries[index];
      const fieldRow = fieldRows[index];
      assert.ok(sourceEntry);
      assert.ok(fieldRow);
      const valueSha256 = sha256(translated.value);
      const supportPairIdentity = locale === "af" && origin === "candidate"
        ? afrikaansSupportPairIdentities.get(
          canonicalTranslationAuditJson([
            "af",
            sourceEntry.source,
            sourceEntry.sourceSha256,
            translated.value,
            valueSha256,
          ]),
        ) ?? null
        : null;
      const trackedRescue = locale === "af" && contextEligible &&
        source.namespace === "route:000" &&
        supportPairIdentity !== null;
      const maskedSource = sourceEntry.segments
        .filter((segment) => segment.kind === "text")
        .map((segment) => segment.value)
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      const sourceHasNormalizedWords = /[\p{L}\p{N}]/u.test(maskedSource);
      const lidApplicable = sourceHasNormalizedWords;
      const semanticApplicable = sourceEntry.segments.some((segment) =>
        segment.kind === "text" && /\p{L}/u.test(segment.value)
      );
      const backtranslationRequired = sourceHasNormalizedWords &&
        (syntheticNeedsBacktranslation(source.namespace, sourceEntry.source) ||
          !semanticApplicable);
      if (lidApplicable) packLanguageEvidenceFields += 1;
      if (backtranslationRequired) packBacktranslatedFields += 1;
      const wholePredictions: Array<readonly [string, number]> = trackedRescue
        ? [
          ["de", 0.35],
          ["nl", 0.3],
          ["af", 0.2],
          ["fr", 0.1],
          ["en", 0.05],
        ]
        : syntheticPredictions(locale === "fil" ? "tl" : locale);
      const targetProbability = wholePredictions.find(([label]) =>
        label === (locale === "fil" ? "tl" : locale)
      )?.[1] ?? 0;
      const englishProbability = wholePredictions.find(([label]) =>
        label === "en"
      )?.[1] ?? 0;
      const backtranslation = backtranslationRequired
        ? sourceEntry.source
        : null;
      const sourceSentences = backtranslationRequired
        ? syntheticSentences(sourceEntry.source)
        : [];
      const backtranslationSentences = backtranslationRequired
        ? syntheticSentences(sourceEntry.source)
        : [];
      const alignmentScores = backtranslationRequired
        ? Array.from(
          { length: sourceSentences.length * backtranslationSentences.length },
          () => 0.96,
        )
        : [];
      checkpointFieldEvidenceRows.push([
        fieldRow[0],
        {
          targetLanguageProbability: lidApplicable
            ? targetProbability
            : null,
          englishProbability: lidApplicable ? englishProbability : null,
          semanticSimilarity: semanticApplicable ? 0.96 : null,
          lidApplicable,
          backtranslationRequired,
          afrikaansRescueKind: trackedRescue
            ? "tracked-curated"
            : "none",
          supportPairIdentity,
          ...(backtranslationRequired && backtranslation !== null
            ? {
              backtranslationSha256: sha256(backtranslation),
              backtranslationSimilarity: 0.96,
              backtranslationLengthRatio: 1,
              minimumSourceSentenceAlignment: 0.96,
              minimumBacktranslationSentenceAlignment: 0.96,
            }
            : {}),
        },
        [],
        [],
        [],
      ]);
      checkpointDerivationEvidenceRows.push([
        fieldRow[0],
        {
          wholePredictions,
          semanticSimilarityRaw: semanticApplicable ? 0.96 : null,
          mixedChunkPredictions: [wholePredictions],
          backtranslation,
          backtranslationSimilarityRaw: backtranslationRequired ? 0.96 : null,
          alignment: backtranslationRequired
            ? {
              sourceSentences,
              backtranslationSentences,
              scores: alignmentScores,
            }
            : null,
        },
      ]);
    });
    const fieldEvidenceRootSha256 =
      sha256CanonicalTranslationAuditJson(checkpointFieldEvidenceRows);
    checkpointPackMaterials.push(Object.freeze({
      fieldEvidenceRows: checkpointFieldEvidenceRows,
      derivationEvidenceRows: checkpointDerivationEvidenceRows,
      fieldValueRootSha256: sha256CanonicalTranslationAuditJson(
        translatedEntries.map((translated, index) => {
          const sourceEntry = source.entries[index];
          assert.ok(sourceEntry);
          return [
            translated.key,
            sourceEntry.sourceSha256,
            sha256(translated.value),
          ];
        }),
      ),
      counts: Object.freeze({
        packs: 1,
        fields: source.entries.length,
        candidatePacks: origin === "candidate" ? 1 : 0,
        curatedPacks: origin === "curated" ? 1 : 0,
        legalFields: /^legal(?::|$)/.test(source.namespace)
          ? source.entries.length
          : 0,
        languageEvidenceFields: packLanguageEvidenceFields,
        backtranslatedFields: packBacktranslatedFields,
        unadjudicatedFields: 0,
        unadjudicatedFailures: 0,
        adjudicatedFields: 0,
        adjudicatedFailures: 0,
      }),
    }));
    bindings.push({
      locale,
      language,
      namespace: source.namespace,
      sourceHash: source.sourceHash,
      sourceEntriesSha256: source.sourceEntriesSha256,
      origin,
      packFileSha256,
      fields: source.entries.length,
      fieldIdentityRootSha256: sha256CanonicalTranslationAuditJson(fieldRows),
      fieldEvidenceRootSha256,
      afrikaansPackContext: locale === "af"
        ? {
          contextSha256: sha256(context),
          distinctMaskedValues: normalizedContextValues.size,
          maskedLetters: [...context].filter((character) =>
            /\p{L}/u.test(character)
          ).length,
          eligible: contextEligible,
          predictions: contextPredictions,
          gatePassed: contextEligible,
          rescuedFields: trackedCuratedRescuedFields,
          fieldPairRescuedFields: 0,
          trackedCuratedRescuedFields,
          referenceMatchFields: referenceMatchRows.length,
          referenceMatchRootSha256:
            sha256CanonicalTranslationAuditJson(referenceMatchRows),
          trackedCuratedRescueRootSha256:
            sha256CanonicalTranslationAuditJson(
              trackedCuratedRescuedFields > 0 ? referenceMatchRows : [],
            ),
        }
        : null,
      unadjudicatedFields: 0,
      adjudicatedFields: 0,
    });
  }
  assert.equal(bindings.length, TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT);
  assert.equal(
    curatedRows.length,
    EXPECTED_SYNTHETIC_CURATED_PACKS -
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT +
      EXPECTED_SYNTHETIC_STALE_CURATED_FILES,
  );
  assert.equal(
    staticMainAppRows.length,
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT,
  );
  assert.equal(candidateRows.length, EXPECTED_SYNTHETIC_CANDIDATE_PACKS);
  curatedRows.sort((first, second) => first[0].localeCompare(second[0]));
  candidateRows.sort((first, second) => first[0].localeCompare(second[0]));
  worklistRows.sort((first, second) => first[0].localeCompare(second[0]));
  staticMainAppRows.sort((first, second) => first[0].localeCompare(second[0]));
  const runtimeVersions = {
    ctranslate2: "4.8.1",
    fasttext: "0.9.3",
    numpy: "1.26.4",
    safetensors: "0.7.0",
    torch: "2.2.2",
    transformers: "4.46.3",
  };
  const {
    fasttextSha256,
    labseTreeSha256,
    madladTreeSha256,
  } = TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS;
  const modelLockSha256 = sha256CanonicalTranslationAuditJson({
    fasttextSha256,
    labseTreeSha256,
    madladTreeSha256,
    runtimeVersions,
  });
  const packIdentityRootSha256 = sha256CanonicalTranslationAuditJson(
    bindings.map((binding) => [
      binding.locale,
      binding.namespace,
      binding.sourceHash,
      binding.origin,
      binding.packFileSha256,
      binding.fieldIdentityRootSha256,
    ]),
  );
  const afrikaansMainBinding = bindings.find((binding) =>
    binding.locale === "af" && binding.namespace === "main-app"
  );
  assert.ok(afrikaansMainBinding?.afrikaansPackContext);
  const afrikaansMainContext = afrikaansMainBinding.afrikaansPackContext;
  const afrikaansMainFieldValueRoot =
    sha256CanonicalTranslationAuditJson(
      mainAppSource.entries.map((entry) => {
        const value = syntheticMainAppValue("Afrikaans", entry.source);
        return [entry.key, entry.sourceSha256, sha256(value)];
      }),
    );
  const referenceIdentityRows = [[
    "af",
    "main-app",
    mainAppSource.sourceHash,
    mainAppSource.sourceEntriesSha256,
    afrikaansMainBinding.packFileSha256,
    mainAppSource.entries.length,
    afrikaansMainFieldValueRoot,
  ]];
  const referenceGateRows = [{
    locale: "af",
    namespace: "main-app",
    sourceHash: mainAppSource.sourceHash,
    sourceEntriesSha256: mainAppSource.sourceEntriesSha256,
    packFileSha256: afrikaansMainBinding.packFileSha256,
    fields: mainAppSource.entries.length,
    fieldValueRootSha256: afrikaansMainFieldValueRoot,
    contextSha256: afrikaansMainContext.contextSha256,
    distinctMaskedValues: afrikaansMainContext.distinctMaskedValues,
    maskedLetters: afrikaansMainContext.maskedLetters,
    eligible: afrikaansMainContext.eligible,
    predictions: afrikaansMainContext.predictions,
    gatePassed: afrikaansMainContext.gatePassed,
  }];
  const supportPairRows = [...afrikaansSupportPairRows.values()].sort(
    (left, right) => {
      const leftSource = left[3] ?? "";
      const rightSource = right[3] ?? "";
      if (leftSource !== rightSource) return leftSource < rightSource ? -1 : 1;
      const leftValue = left[5] ?? "";
      const rightValue = right[5] ?? "";
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    },
  );
  const supportRecordRows = mainAppSource.entries.map((entry) => {
    const value = syntheticMainAppValue("Afrikaans", entry.source);
    const valueSha256 = sha256(value);
    const supportPairIdentity = afrikaansSupportPairIdentities.get(
      canonicalTranslationAuditJson([
        "af",
        entry.source,
        entry.sourceSha256,
        value,
        valueSha256,
      ]),
    );
    assert.ok(supportPairIdentity);
    return [
      "af",
      "main-app",
      entry.key,
      afrikaansMainBinding.packFileSha256,
      entry.source,
      entry.sourceSha256,
      value,
      valueSha256,
      true,
      supportPairIdentity,
    ];
  }).sort((left, right) => {
    for (const index of [1, 2, 3]) {
      const leftValue = String(left[index]);
      const rightValue = String(right[index]);
      if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
    }
    return 0;
  });
  const trackedRescuePackRows = bindings
    .filter((binding) => binding.afrikaansPackContext !== null)
    .map((binding) => {
      const context = binding.afrikaansPackContext;
      assert.ok(context);
      return [
        binding.locale,
        binding.namespace,
        context.trackedCuratedRescuedFields,
        context.trackedCuratedRescueRootSha256,
      ];
    });
  const afrikaansTrackedCurated = {
    referencePacks: 1,
    referencePackIdentityRootSha256:
      sha256CanonicalTranslationAuditJson(referenceIdentityRows),
    referencePackGateEvidenceRootSha256:
      sha256CanonicalTranslationAuditJson(referenceGateRows),
    supportPairCount: supportPairRows.length,
    supportPairRootSha256:
      sha256CanonicalTranslationAuditJson(supportPairRows),
    supportRecordCount: supportRecordRows.length,
    supportRecordRootSha256:
      sha256CanonicalTranslationAuditJson(supportRecordRows),
    conflictSourceCount: 0,
    conflictSourceRootSha256: sha256CanonicalTranslationAuditJson([]),
    fieldPairRescuedFields: bindings.reduce(
      (total, binding) => total +
        (binding.afrikaansPackContext?.fieldPairRescuedFields ?? 0),
      0,
    ),
    trackedCuratedRescuedFields: bindings.reduce(
      (total, binding) => total +
        (binding.afrikaansPackContext?.trackedCuratedRescuedFields ?? 0),
      0,
    ),
    trackedCuratedRescueRootSha256:
      sha256CanonicalTranslationAuditJson(trackedRescuePackRows),
  };
  const packEvidenceRows = bindings.map((binding) => [
      binding.locale,
      binding.namespace,
      binding.fieldEvidenceRootSha256,
      binding.unadjudicatedFields,
      binding.adjudicatedFields,
    ]);
  const packEvidenceRootSha256 = sha256CanonicalTranslationAuditJson({
    packBindings: packEvidenceRows,
    afrikaansTrackedCurated,
  });
  const candidateTreeSha256 = sha256CanonicalTranslationAuditJson({
    exists: true,
    files: candidateRows,
  });
  const fields = sources.reduce(
    (sum, source) => sum + source.entries.length,
    0,
  ) * TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length;
  const createdAt = "2026-07-14T12:00:00.000000Z";
  const curatedTreeDigest = {
    exists: true,
    sha256: sha256CanonicalTranslationAuditJson({
      exists: true,
      files: curatedRows,
    }),
    files: curatedRows.length,
    bytes: curatedRows.reduce((sum, row) => sum + row[1], 0),
  } as const;
  const staticMainAppTreeDigest = {
    exists: true,
    sha256: sha256CanonicalTranslationAuditJson({
      exists: true,
      files: staticMainAppRows,
    }),
    files: staticMainAppRows.length,
    bytes: staticMainAppRows.reduce((sum, row) => sum + row[1], 0),
  } as const;
  const candidateTreeDigest = {
    exists: true,
    sha256: candidateTreeSha256,
    files: candidateRows.length,
    bytes: candidateRows.reduce((sum, row) => sum + row[1], 0),
  } as const;
  const packWorklistTreeDigest = {
    exists: true,
    sha256: sha256CanonicalTranslationAuditJson({
      exists: true,
      files: worklistRows,
    }),
    files: worklistRows.length,
    bytes: worklistRows.reduce((sum, row) => sum + row[1], 0),
  } as const;
  const packOrder = bindings.map((binding) => [
    binding.locale,
    binding.namespace,
  ]);
  const checkpointRoot = path.join(
    runRoot,
    TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_ROOT_BASENAME,
  );
  mkdirSync(checkpointRoot, { recursive: true, mode: 0o700 });
  chmodSync(checkpointRoot, 0o700);
  const sessionBinding = {
    schemaVersion: 1,
    kind: TRANSLATION_SEMANTIC_AUDIT_SESSION_KIND,
    auditVersion: TRANSLATION_SEMANTIC_AUDIT_VERSION,
    scope: {
      name: "full",
      locales: [...TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES],
      namespaces: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
      packs: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      fields,
      packOrderSha256: sha256CanonicalTranslationAuditJson(packOrder),
    },
    policy: {
      sha256: sha256CanonicalTranslationAuditJson(
        TRANSLATION_SEMANTIC_AUDIT_POLICY,
      ),
      implementationSha256: sha256(implementationBytes),
    },
    models: {
      modelLockSha256,
      fasttextSha256,
      labseTreeSha256,
      madladTreeSha256,
      runtimeVersions,
    },
    inputs: {
      paths: {
        masterWorklist: "tmp/translation-v10/worklist.json",
        curatedTree: "translations/curated",
        staticMainAppTree: "translations/static-main-app",
        candidateTree: "tmp/translation-v10/candidates",
        packWorklistTree: "tmp/translation-v10/worklists",
        output: `tmp/translation-v10/${TRANSLATION_SEMANTIC_AUDIT_FULL_MANIFEST_BASENAME}`,
        checkpointRoot:
          `tmp/translation-v10/${TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_ROOT_BASENAME}`,
      },
      masterWorklistSha256: master.worklistSha256,
      masterWorklistFileSha256: sha256(masterBytes),
      generatorExecutionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
      generatorExecutionProfileSha256:
        LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
      curatedTree: curatedTreeDigest,
      staticMainAppTree: staticMainAppTreeDigest,
      candidateTree: candidateTreeDigest,
      packWorklistTree: packWorklistTreeDigest,
      adjudicationSha256: null,
      trackedAfrikaansReferences: {
        locale: "af",
        packs: 1,
        packIdentityRootSha256:
          afrikaansTrackedCurated.referencePackIdentityRootSha256,
      },
    },
    executionProfile: TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE,
    executionProfileSha256: sha256CanonicalTranslationAuditJson(
      TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE,
    ),
  };
  const sessionBindingSha256 = sha256CanonicalTranslationAuditJson(
    sessionBinding,
  );
  const checkpointPlans = bindings.map((binding, index) => {
    const packMaterial = checkpointPackMaterials[index];
    assert.ok(packMaterial);
    const descriptor = {
      ordinal: index + 1,
      locale: binding.locale,
      language: binding.language,
      namespace: binding.namespace,
      sourceHash: binding.sourceHash,
      sourceEntriesSha256: binding.sourceEntriesSha256,
      origin: binding.origin,
      packFileSha256: binding.packFileSha256,
      fields: binding.fields,
      fieldValueRootSha256: packMaterial.fieldValueRootSha256,
    };
    return Object.freeze({
      binding,
      packMaterial,
      descriptor,
      packInputSha256: sha256CanonicalTranslationAuditJson({
        sessionBindingSha256,
        ...descriptor,
      }),
    });
  });
  const session = {
    ...sessionBinding,
    packInputRootSha256: sha256CanonicalTranslationAuditJson(
      checkpointPlans.map((plan) => [
        plan.descriptor.ordinal,
        plan.descriptor.locale,
        plan.descriptor.namespace,
        plan.packInputSha256,
      ]),
    ),
  };
  const sessionSha256 = sha256CanonicalTranslationAuditJson(session);
  const sessionRecordMaterial = {
    schemaVersion: 1,
    kind: TRANSLATION_SEMANTIC_AUDIT_SESSION_RECORD_KIND,
    sessionSha256,
    session,
    createdAt,
  };
  const sessionRecord = {
    ...sessionRecordMaterial,
    sessionRecordSha256:
      sha256CanonicalTranslationAuditJson(sessionRecordMaterial),
  };
  const sessionFile = path.join(checkpointRoot, "session.json");
  const sessionBytes = writeCanonicalJson(sessionFile, sessionRecord);
  chmodSync(sessionFile, 0o400);
  const trackedAfrikaansReferences = {
    schemaVersion: 1,
    kind: "inspir-afrikaans-tracked-curated-reference-evidence-v1",
    sessionSha256,
    referencePackIdentityRootSha256:
      afrikaansTrackedCurated.referencePackIdentityRootSha256,
    referencePackGateEvidenceRootSha256:
      afrikaansTrackedCurated.referencePackGateEvidenceRootSha256,
    referencePacks: referenceGateRows,
    supportPairCount: afrikaansTrackedCurated.supportPairCount,
    supportPairRootSha256: afrikaansTrackedCurated.supportPairRootSha256,
    supportRecordCount: afrikaansTrackedCurated.supportRecordCount,
    supportRecordRootSha256: afrikaansTrackedCurated.supportRecordRootSha256,
    conflictSourceCount: afrikaansTrackedCurated.conflictSourceCount,
    conflictSourceRootSha256:
      afrikaansTrackedCurated.conflictSourceRootSha256,
  };
  const checkpointChainRows: unknown[] = [];
  const packRescueRecords: Array<Readonly<{
    ordinal: number;
    locale: (typeof TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES)[number];
    namespace: string;
    rescueRecordCount: number;
    rescueRecordRootSha256: string;
    rescueRecords: readonly unknown[];
  }>> = [];
  let previousCheckpointSha256: string | null = null;
  for (const plan of checkpointPlans) {
    const rescueRecords = plan.packMaterial.fieldEvidenceRows.flatMap((row) => {
      assert.ok(Array.isArray(row));
      const identity = row[0];
      const fieldEvidence = row[1];
      assert.equal(typeof identity, "string");
      assert.ok(isRecord(fieldEvidence));
      const rescueKind = fieldEvidence.afrikaansRescueKind;
      if (rescueKind === "none") return [];
      assert.ok(
        rescueKind === "field-pair" || rescueKind === "tracked-curated",
      );
      return [[identity, rescueKind, fieldEvidence.supportPairIdentity]];
    });
    const checkpointMaterial = {
      schemaVersion: 1,
      kind: TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_KIND,
      sessionSha256,
      ordinal: plan.descriptor.ordinal,
      totalPacks: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      packInputSha256: plan.packInputSha256,
      previousCheckpointSha256,
      packBinding: plan.binding,
      trackedAfrikaansReferences,
      counts: plan.packMaterial.counts,
      fieldEvidenceRows: plan.packMaterial.fieldEvidenceRows,
      derivationEvidenceRows: plan.packMaterial.derivationEvidenceRows,
      failureRecords: {
        records: [],
        codeCounts: {},
        adjudicatedCodeCounts: {},
      },
      consumedAdjudications: [],
    };
    const checkpointSha256 =
      sha256CanonicalTranslationAuditJson(checkpointMaterial);
    const checkpoint = { ...checkpointMaterial, checkpointSha256 };
    const basename = `${String(plan.descriptor.ordinal).padStart(5, "0")}-${
      plan.packInputSha256
    }-${checkpointSha256}.json`;
    const checkpointFile = path.join(checkpointRoot, basename);
    const checkpointBytes = writeCanonicalJson(checkpointFile, checkpoint);
    chmodSync(checkpointFile, 0o400);
    checkpointChainRows.push([
      plan.descriptor.ordinal,
      plan.packInputSha256,
      previousCheckpointSha256,
      checkpointSha256,
      sha256(checkpointBytes),
      checkpointBytes.byteLength,
    ]);
    packRescueRecords.push(Object.freeze({
      ordinal: plan.descriptor.ordinal,
      locale: plan.binding.locale,
      namespace: plan.binding.namespace,
      rescueRecordCount: rescueRecords.length,
      rescueRecordRootSha256:
        sha256CanonicalTranslationAuditJson(rescueRecords),
      rescueRecords,
    }));
    previousCheckpointSha256 = checkpointSha256;
  }
  assert.ok(previousCheckpointSha256);
  const packRescueRootRows = packRescueRecords.map((record) => [
    record.ordinal,
    record.locale,
    record.namespace,
    record.rescueRecordCount,
    record.rescueRecordRootSha256,
  ]);
  const checkpointEvidence = {
    schemaVersion: 1,
    kind: TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_EVIDENCE_KIND,
    checkpointRootPath:
      `tmp/translation-v10/${TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_ROOT_BASENAME}`,
    sessionSha256,
    sessionRecordSha256: sessionRecord.sessionRecordSha256,
    sessionFileSha256: sha256(sessionBytes),
    checkpointCount: checkpointPlans.length,
    terminalCheckpointSha256: previousCheckpointSha256,
    checkpointChainRootSha256:
      sha256CanonicalTranslationAuditJson(checkpointChainRows),
    packRescueRecordCount: packRescueRecords.length,
    packRescueRecordRootSha256:
      sha256CanonicalTranslationAuditJson(packRescueRootRows),
    fieldPairRescuedFields:
      afrikaansTrackedCurated.fieldPairRescuedFields,
    trackedCuratedRescuedFields:
      afrikaansTrackedCurated.trackedCuratedRescuedFields,
    packRescueRecords,
  };
  const totalLanguageEvidenceFields = checkpointPackMaterials.reduce(
    (total, pack) => total + Number(pack.counts.languageEvidenceFields),
    0,
  );
  const totalBacktranslatedFields = checkpointPackMaterials.reduce(
    (total, pack) => total + Number(pack.counts.backtranslatedFields),
    0,
  );
  const material = {
    schemaVersion: 3,
    kind: TRANSLATION_SEMANTIC_AUDIT_KIND,
    auditVersion: TRANSLATION_SEMANTIC_AUDIT_VERSION,
    createdAt,
    scope: {
      name: "full",
      locales: [...TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES],
      namespaces: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
      packs: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      fields,
    },
    policy: {
      sha256: sha256CanonicalTranslationAuditJson(
        TRANSLATION_SEMANTIC_AUDIT_POLICY,
      ),
      implementationSha256: sha256(implementationBytes),
      value: TRANSLATION_SEMANTIC_AUDIT_POLICY,
    },
    models: {
      modelLockSha256,
      fasttext: { label: "fastText lid.176", sha256: fasttextSha256 },
      labse: {
        label: "sentence-transformers/LaBSE",
        treeSha256: labseTreeSha256,
      },
      madlad: {
        label: "MADLAD400 3B CTranslate2 int8",
        treeSha256: madladTreeSha256,
      },
      runtimeVersions,
    },
    inputs: {
      masterWorklist: {
        path: "tmp/translation-v10/worklist.json",
        fileSha256: sha256(masterBytes),
        worklistSha256: master.worklistSha256,
        generatorExecutionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
        generatorExecutionProfileSha256:
          LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
      },
      curatedTree: {
        path: "translations/curated",
        ...curatedTreeDigest,
      },
      staticMainAppTree: {
        path: "translations/static-main-app",
        ...staticMainAppTreeDigest,
      },
      candidateTree: {
        path: "tmp/translation-v10/candidates",
        ...candidateTreeDigest,
      },
      packWorklistTree: {
        path: "tmp/translation-v10/worklists",
        ...packWorklistTreeDigest,
      },
      adjudicationSha256: null,
    },
    results: {
      passed: true,
      counts: {
        packs: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
        fields,
        candidatePacks: EXPECTED_SYNTHETIC_CANDIDATE_PACKS,
        curatedPacks: EXPECTED_SYNTHETIC_CURATED_PACKS,
        legalFields: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length,
        languageEvidenceFields: totalLanguageEvidenceFields,
        backtranslatedFields: totalBacktranslatedFields,
        unadjudicatedFields: 0,
        unadjudicatedFailures: 0,
        adjudicatedFields: 0,
        adjudicatedFailures: 0,
      },
      packIdentityRootSha256,
      packEvidenceRootSha256,
      packBindings: bindings,
      afrikaansTrackedCurated,
      checkpointEvidence,
      failureRecords: {
        count: 0,
        sha256: sha256CanonicalTranslationAuditJson([]),
        codeCounts: {},
        adjudicatedCodeCounts: {},
        samples: [],
        omittedSamples: 0,
      },
    },
    releaseWarnings: [...TRANSLATION_SEMANTIC_AUDIT_RELEASE_WARNINGS],
  };
  const manifest = translationSemanticAuditManifestSchema.parse({
    ...material,
    manifestSha256: sha256CanonicalTranslationAuditJson(material),
  });
  writeCanonicalJson(manifestPath, manifest);
  chmodSync(manifestPath, 0o400);
  return Object.freeze({
    workspaceRoot,
    runRoot,
    manifestPath,
    implementationPath,
    masterPath,
    curatedRoot,
    candidateRoot,
    staticMainAppRoot,
    siteSourceManifestPath,
    mutableTreeFile,
    manifest,
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
  });
}

const promotableCandidateSchema = z.object({
  schemaVersion: z.literal(1),
  language: z.string().min(1),
  locale: z.enum(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES),
  namespace: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  entries: z.array(z.object({
    key: z.string().min(1),
    value: z.string().min(1),
  }).passthrough()).min(1),
}).passthrough();

function promoteSyntheticPostPromotionTree(
  fixture: Fixture,
  semanticEvidence: ReturnType<
    typeof verifyTranslationSemanticAuditManifest
  >["promotionEvidence"],
) {
  const artifacts: LongTailPromotionSnapshotArtifact[] = [];
  for (const locale of TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES) {
    const candidateLocaleRoot = path.join(fixture.candidateRoot, locale);
    if (!existsSync(candidateLocaleRoot)) continue;
    for (const basename of readdirSync(candidateLocaleRoot).sort()) {
      const candidate = promotableCandidateSchema.parse(
        JSON.parse(
          readFileSync(path.join(candidateLocaleRoot, basename), "utf8"),
        ),
      );
      const relativePath = `${locale}/${basename}`;
      const targetBytes = jsonBytes({
        schemaVersion: 1,
        language: candidate.language,
        locale: candidate.locale,
        namespace: candidate.namespace,
        sourceHash: candidate.sourceHash,
        translations: Object.fromEntries(
          candidate.entries.map((entry) => [entry.key, entry.value]),
        ),
      });
      const target = path.join(fixture.curatedRoot, relativePath);
      const existing = existsSync(target) ? readFileSync(target) : null;
      artifacts.push(Object.freeze({
        targetRelativePath: relativePath,
        targetBytes,
        checkpointRelativePath: relativePath,
        checkpointBytes: jsonBytes({
          schemaVersion: 1,
          relativePath,
          targetSha256: sha256(targetBytes),
        }),
        ...(existing
          ? {
            replacement: Object.freeze({
              kind:
                LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND,
              approvedExistingSha256: sha256(existing),
              priorSourceHash: candidate.sourceHash,
              newSourceHash: candidate.sourceHash,
              validatorPolicySha256: sha256("synthetic-validator-policy"),
              backupRelativePath: relativePath,
            }),
          }
          : {}),
      }));
    }
  }
  assert.equal(artifacts.length, EXPECTED_SYNTHETIC_CANDIDATE_PACKS);
  const transactionRoot = path.join(
    fixture.workspaceRoot,
    LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
  );
  const promotion = promoteLongTailPromotionSnapshot({
    curatedRoot: fixture.curatedRoot,
    transactionRoot,
    masterWorklistSha256: semanticEvidence.masterWorklistSha256,
    semanticEvidence,
    artifacts,
  });
  const finalized = finalizeLongTailPromotionSnapshot({
    curatedRoot: fixture.curatedRoot,
    transactionRoot,
    transactionId: promotion.transactionId,
  });
  return Object.freeze({ promotion, finalized, transactionRoot });
}

function makeMinimalFixture(): Readonly<{
  workspaceRoot: string;
  runRoot: string;
  curatedRoot: string;
  manifestPath: string;
  cleanup: () => void;
}> {
  const workspaceRoot = mkdtempSync(
    path.join(realpathSync(os.tmpdir()), "inspir-semantic-bad-"),
  );
  const runRoot = path.join(workspaceRoot, "tmp", "translation-v10");
  const curatedRoot = path.join(workspaceRoot, "translations", "curated");
  const manifestPath = path.join(
    runRoot,
    TRANSLATION_SEMANTIC_AUDIT_FULL_MANIFEST_BASENAME,
  );
  mkdirSync(path.join(workspaceRoot, "scripts"), { recursive: true });
  mkdirSync(path.join(runRoot, "worklists"), { recursive: true });
  mkdirSync(curatedRoot, { recursive: true });
  mkdirSync(
    path.join(workspaceRoot, "translations", "static-main-app"),
    { recursive: true },
  );
  const syntheticSiteSources = Object.fromEntries([
    [
      "marketing-site",
      {
        sourceHash: sha256("site.fixture\u0000Fixture marketing source"),
        sourceStrings: { "site.fixture": "Fixture marketing source" },
      },
    ],
    ...Array.from(
      { length: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT - 1 },
      (_, index) => {
        const key = `site.${String(index).padStart(3, "0")}`;
        const value = `Fixture source ${index}`;
        return [
          `route:fixture-${String(index).padStart(3, "0")}`,
          {
            sourceHash: sha256(`${key}\u0000${value}`),
            sourceStrings: { [key]: value },
          },
        ] as const;
      },
    ),
  ]);
  const siteSourceManifestPath = path.join(
    workspaceRoot,
    "lib",
    "i18n",
    "site-source-manifest.ts",
  );
  mkdirSync(path.dirname(siteSourceManifestPath), { recursive: true });
  writeFileSync(
    siteSourceManifestPath,
    `// Synthetic semantic verifier fixture.\nexport const siteSourceManifest = ${
      JSON.stringify(syntheticSiteSources, null, 2)
    } as const;\n`,
  );
  writeFileSync(
    path.join(workspaceRoot, "scripts", "audit-translation-semantics.py"),
    "# fixture\n",
  );
  writeFileSync(
    path.join(
      workspaceRoot,
      "scripts",
      "verify-translation-semantic-audit.ts",
    ),
    "// fixture\n",
  );
  writeJson(path.join(runRoot, "worklist.json"), {});
  writeFileSync(manifestPath, '{"schemaVersion":1,"schemaVersion":1}\n');
  chmodSync(manifestPath, 0o400);
  return Object.freeze({
    workspaceRoot,
    runRoot,
    curatedRoot,
    manifestPath,
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
  });
}

test(
  "full semantic manifest verifier binds the 7,957 site candidates plus 668 tracked curated packs",
  { timeout: 900_000 },
  () => {
    const fixture = makeFullFixture();
    try {
      const verified = verifyTranslationSemanticAuditManifest(fixture);
      assert.equal(
        verified.manifestSha256,
        fixture.manifest.manifestSha256,
      );
      assert.equal(verified.packs, TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT);
      assert.equal(verified.fields, fixture.manifest.scope.fields);
      assert.equal(verified.promotionEvidence.scope.candidatePacks, 7_957);
      assert.equal(verified.promotionEvidence.scope.curatedPacks, 668);
      assert.equal(
        verified.manifest.results.afrikaansTrackedCurated
          .trackedCuratedRescuedFields,
        1,
      );
      assert.equal(
        verified.promotionEvidence.afrikaansTrackedCurated
          .trackedCuratedRescuedFields,
        1,
      );
      const trackedCandidateBinding =
        verified.manifest.results.packBindings.find((binding) =>
          binding.locale === "af" && binding.namespace === "route:000"
        );
      assert.ok(trackedCandidateBinding?.afrikaansPackContext);
      assert.equal(trackedCandidateBinding.origin, "candidate");
      assert.equal(
        trackedCandidateBinding.afrikaansPackContext.referenceMatchFields,
        1,
      );
      assert.equal(
        trackedCandidateBinding.afrikaansPackContext
          .trackedCuratedRescuedFields,
        1,
      );
      const trackedReferenceBinding =
        verified.manifest.results.packBindings.find((binding) =>
          binding.locale === "af" && binding.namespace === "main-app"
        );
      assert.ok(trackedReferenceBinding?.afrikaansPackContext);
      assert.equal(trackedReferenceBinding.origin, "curated");
      assert.equal(
        trackedReferenceBinding.afrikaansPackContext
          .trackedCuratedRescuedFields,
        0,
      );
      for (const locale of TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES) {
        assert.equal(
          existsSync(path.join(fixture.curatedRoot, locale, "main-app.json")),
          false,
        );
      }
      assert.equal(verified.promotionEvidence.inputTrees.candidates.files, 7_957);
      assert.equal(verified.promotionEvidence.inputTrees.packWorklists.files, 7_957);
      assert.equal(
        verified.promotionEvidence.inputTrees.curated.files,
        EXPECTED_SYNTHETIC_CURATED_PACKS -
          TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT +
          EXPECTED_SYNTHETIC_STALE_CURATED_FILES,
      );
      assert.equal(
        verified.promotionEvidence.inputTrees.staticMainApp.files,
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT,
      );
      const originalManifestBytes = readFileSync(fixture.manifestPath);
      const assertAfrikaansForgeryRejected = (
        mutate: (
          context: NonNullable<
            TranslationSemanticAuditManifest["results"]["packBindings"][number]["afrikaansPackContext"]
          >,
        ) => void,
      ) => {
        const forged = structuredClone(fixture.manifest);
        const binding = forged.results.packBindings.find((candidate) =>
          candidate.locale === "af" && candidate.namespace === "route:000"
        );
        assert.ok(binding?.afrikaansPackContext);
        assert.equal(binding.afrikaansPackContext.eligible, true);
        mutate(binding.afrikaansPackContext);
        writeReadonlyManifest(fixture, rebindSemanticManifest(forged));
        try {
          assert.throws(
            () => verifyTranslationSemanticAuditManifest(fixture),
            /Afrikaans (?:pack (?:calibration evidence drifted|prediction eligibility drifted|predictions are not unique raw-ranked evidence)|tracked-curated match evidence drifted)/i,
          );
        } finally {
          chmodSync(fixture.manifestPath, 0o600);
          writeFileSync(fixture.manifestPath, originalManifestBytes);
          chmodSync(fixture.manifestPath, 0o400);
        }
      };
      assertAfrikaansForgeryRejected((context) => {
        context.contextSha256 = "a".repeat(64);
      });
      assertAfrikaansForgeryRejected((context) => {
        context.distinctMaskedValues += 1;
      });
      assertAfrikaansForgeryRejected((context) => {
        context.maskedLetters += 1;
      });
      assertAfrikaansForgeryRejected((context) => {
        context.predictions = [["af", 0.549999999999], ["nl", 0.2]];
      });
      assertAfrikaansForgeryRejected((context) => {
        context.predictions = [["af", 0.55], ["nl", 0.199999999999]];
      });
      assertAfrikaansForgeryRejected((context) => {
        context.predictions = [["nl", 0.55], ["af", 0.55]];
      });
      assertAfrikaansForgeryRejected((context) => {
        context.predictions = [["af", 0.55], ["nl", 0.56]];
      });
      assertAfrikaansForgeryRejected((context) => {
        context.referenceMatchFields += 1;
      });
      assertAfrikaansForgeryRejected((context) => {
        context.referenceMatchRootSha256 = "b".repeat(64);
      });
      assertAfrikaansForgeryRejected((context) => {
        context.trackedCuratedRescuedFields = 0;
      });

      const supportRootForgery = structuredClone(fixture.manifest);
      supportRootForgery.results.afrikaansTrackedCurated.supportPairRootSha256 =
        "c".repeat(64);
      writeReadonlyManifest(
        fixture,
        rebindSemanticManifest(supportRootForgery),
      );
      try {
        assert.throws(
          () => verifyTranslationSemanticAuditManifest(fixture),
          /tracked Afrikaans support\/conflict\/rescue evidence drifted/i,
        );
      } finally {
        chmodSync(fixture.manifestPath, 0o600);
        writeFileSync(fixture.manifestPath, originalManifestBytes);
        chmodSync(fixture.manifestPath, 0o400);
      }

      const nonAfrikaansForgery = structuredClone(fixture.manifest);
      const afContext = nonAfrikaansForgery.results.packBindings.find(
        (binding) => binding.locale === "af" && binding.namespace === "route:000",
      )?.afrikaansPackContext;
      const nonAfrikaansBinding = nonAfrikaansForgery.results.packBindings.find(
        (binding) => binding.locale === "am" && binding.namespace === "route:000",
      );
      assert.ok(afContext);
      assert.ok(nonAfrikaansBinding);
      nonAfrikaansBinding.afrikaansPackContext = structuredClone(afContext);
      writeReadonlyManifest(
        fixture,
        rebindSemanticManifest(nonAfrikaansForgery),
      );
      try {
        assert.throws(
          () => verifyTranslationSemanticAuditManifest(fixture),
          /Non-Afrikaans pack has calibration evidence/i,
        );
      } finally {
        chmodSync(fixture.manifestPath, 0o600);
        writeFileSync(fixture.manifestPath, originalManifestBytes);
        chmodSync(fixture.manifestPath, 0o400);
      }
      for (const basename of [
        "main-app.json",
        "main-app.part-001.json",
        "main-app.part-final.json",
      ]) {
        writeJson(path.join(fixture.curatedRoot, "af", basename), {
          ignoredWorkbench: basename,
        });
      }
      const withOptionalWorkbench = verifyTranslationSemanticAuditManifest(
        fixture,
      );
      assert.equal(
        withOptionalWorkbench.promotionEvidence.semanticEvidenceSha256,
        verified.promotionEvidence.semanticEvidenceSha256,
      );

      const staticAfrikaans = path.join(fixture.staticMainAppRoot, "af.json");
      const staticAfrikaansBytes = readFileSync(staticAfrikaans);
      writeFileSync(
        staticAfrikaans,
        Buffer.concat([staticAfrikaansBytes, Buffer.from("\n")]),
      );
      assert.throws(
        () => verifyTranslationSemanticAuditManifest(fixture),
        /static main-app tree evidence is stale/i,
      );
      writeFileSync(staticAfrikaans, staticAfrikaansBytes);
      unlinkSync(staticAfrikaans);
      assert.throws(
        () => verifyTranslationSemanticAuditManifest(fixture),
        /static main-app tree evidence is stale/i,
      );
      writeFileSync(staticAfrikaans, staticAfrikaansBytes);

      for (const treeRoot of [
        fixture.candidateRoot,
        path.join(fixture.runRoot, "worklists"),
      ]) {
        const priorRoot = `${treeRoot}.before-race`;
        assert.throws(
          () => verifyTranslationSemanticAuditManifest({
            ...fixture,
            raceHook: () => {
              renameSync(treeRoot, priorRoot);
              cpSync(priorRoot, treeRoot, { recursive: true });
            },
          }),
          /changed during verification/,
        );
        rmSync(treeRoot, { recursive: true, force: true });
        renameSync(priorRoot, treeRoot);
      }
      const originalManifest = readFileSync(fixture.manifestPath);
      chmodSync(fixture.manifestPath, 0o600);
      writeFileSync(
        fixture.manifestPath,
        Buffer.concat([originalManifest, Buffer.from(" \n")]),
      );
      chmodSync(fixture.manifestPath, 0o400);
      assert.throws(
        () => verifyTranslationSemanticAuditManifest(fixture),
        /trailing JSON data/,
      );
      chmodSync(fixture.manifestPath, 0o600);
      writeFileSync(fixture.manifestPath, originalManifest);
      chmodSync(fixture.manifestPath, 0o400);

      const originalImplementation = readFileSync(fixture.implementationPath);
      writeFileSync(
        fixture.implementationPath,
        Buffer.concat([originalImplementation, Buffer.from("# drift\n")]),
      );
      assert.throws(
        () => verifyTranslationSemanticAuditManifest(fixture),
        /policy or implementation binding drifted/,
      );
      writeFileSync(fixture.implementationPath, originalImplementation);

      const originalMaster = readFileSync(fixture.masterPath);
      writeFileSync(
        fixture.masterPath,
        Buffer.concat([originalMaster, Buffer.from("\n")]),
      );
      assert.throws(
        () => verifyTranslationSemanticAuditManifest(fixture),
        /master file evidence is stale/,
      );
      writeFileSync(fixture.masterPath, originalMaster);

      const forgedMasterValue: unknown = JSON.parse(
        originalMaster.toString("utf8"),
      );
      assert.ok(isRecord(forgedMasterValue));
      const forgedSources = forgedMasterValue.sources;
      assert.ok(Array.isArray(forgedSources));
      const forgedMainSource = forgedSources.find((source) =>
        isRecord(source) && source.namespace === "main-app"
      );
      assert.ok(isRecord(forgedMainSource));
      const forgedMainEntries = forgedMainSource.entries;
      assert.ok(Array.isArray(forgedMainEntries));
      const forgedMainEntry = forgedMainEntries[0];
      assert.ok(isRecord(forgedMainEntry));
      assert.equal(typeof forgedMainEntry.source, "string");
      const forgedMainText = `${forgedMainEntry.source} forged`;
      forgedMainEntry.source = forgedMainText;
      forgedMainEntry.sourceSha256 = sha256(forgedMainText);
      forgedMainEntry.segments = [{ kind: "text", value: forgedMainText }];
      forgedMainSource.sourceEntriesSha256 =
        sha256CanonicalTranslationAuditJson(forgedMainEntries);
      forgedMasterValue.worklistSha256 =
        sha256CanonicalTranslationAuditJson(
          withoutDigest(forgedMasterValue, "worklistSha256"),
        );
      const forgedMasterBytes = writeJson(
        fixture.masterPath,
        forgedMasterValue,
      );
      const forgedMasterManifest = structuredClone(fixture.manifest);
      forgedMasterManifest.inputs.masterWorklist.fileSha256 =
        sha256(forgedMasterBytes);
      forgedMasterManifest.inputs.masterWorklist.worklistSha256 =
        String(forgedMasterValue.worklistSha256);
      writeReadonlyManifest(
        fixture,
        rebindSemanticManifest(forgedMasterManifest),
      );
      try {
        assert.throws(
          () => verifyTranslationSemanticAuditManifest(fixture),
          /current tracked application catalog/i,
        );
      } finally {
        writeFileSync(fixture.masterPath, originalMaster);
        chmodSync(fixture.manifestPath, 0o600);
        writeFileSync(fixture.manifestPath, originalManifestBytes);
        chmodSync(fixture.manifestPath, 0o400);
      }

      const originalTreeFile = readFileSync(fixture.mutableTreeFile);
      writeFileSync(
        fixture.mutableTreeFile,
        Buffer.concat([originalTreeFile, Buffer.from("\n")]),
      );
      assert.throws(
        () => verifyTranslationSemanticAuditManifest(fixture),
        /Curated tree evidence is stale/,
      );
      writeFileSync(fixture.mutableTreeFile, originalTreeFile);

      const failedResult = structuredClone(fixture.manifest);
      Object.assign(failedResult.results, { passed: false });
      assert.equal(
        translationSemanticAuditManifestSchema.safeParse(failedResult).success,
        false,
      );
      const replacementSha256 = sha256("unapproved-replacement-model");
      const modelSubstitutions = [
        {
          ...fixture.manifest.models,
          fasttext: {
            ...fixture.manifest.models.fasttext,
            sha256: replacementSha256,
          },
        },
        {
          ...fixture.manifest.models,
          labse: {
            ...fixture.manifest.models.labse,
            treeSha256: replacementSha256,
          },
        },
        {
          ...fixture.manifest.models,
          madlad: {
            ...fixture.manifest.models.madlad,
            treeSha256: replacementSha256,
          },
        },
      ];
      for (const substituted of modelSubstitutions) {
        const models = {
          ...substituted,
          modelLockSha256: sha256CanonicalTranslationAuditJson({
            fasttextSha256: substituted.fasttext.sha256,
            labseTreeSha256: substituted.labse.treeSha256,
            madladTreeSha256: substituted.madlad.treeSha256,
            runtimeVersions: substituted.runtimeVersions,
          }),
        };
        const material = {
          ...withoutDigest(fixture.manifest, "manifestSha256"),
          models,
        };
        const selfConsistentSubstitution = {
          ...material,
          manifestSha256: sha256CanonicalTranslationAuditJson(material),
        };
        assert.equal(
          translationSemanticAuditManifestSchema.safeParse(
            selfConsistentSubstitution,
          ).success,
          false,
        );
      }
      const reorderedLocales = structuredClone(fixture.manifest);
      reorderedLocales.scope.locales.reverse();
      assert.throws(
        () => {
          const parsed = translationSemanticAuditManifestSchema.parse(reorderedLocales);
          const expected = TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES;
          assert.deepEqual(parsed.scope.locales, expected);
        },
      );
      assert.notEqual(
        sha256CanonicalTranslationAuditJson(
          withoutDigest(fixture.manifest, "manifestSha256"),
        ),
        sha256CanonicalTranslationAuditJson({
          ...withoutDigest(fixture.manifest, "manifestSha256"),
          scope: { ...fixture.manifest.scope, packs: 1 },
        }),
      );
      assert.equal(
        canonicalTranslationAuditJson({ b: 1, a: 2 }),
        '{"a":2,"b":1}',
      );
      assert.equal(
        isTranslationSemanticAuditPackBasename(
          "legal__terms.json",
          "legal:terms",
          true,
        ),
        true,
      );
      assert.equal(
        isTranslationSemanticAuditPackBasename(
          "legal__terms.part-1.json",
          "legal:terms",
          true,
        ),
        true,
      );
      assert.equal(
        isTranslationSemanticAuditPackBasename(
          "wrong.json",
          "legal:terms",
          true,
        ),
        false,
      );
      assert.equal(
        isTranslationSemanticAuditPackBasename(
          "legal__terms.part-1.json",
          "legal:terms",
          false,
        ),
        false,
      );

      const durablePromotion = promoteSyntheticPostPromotionTree(
        fixture,
        verified.promotionEvidence,
      );
      const recovered = verifyTranslationSemanticAuditManifest({
        workspaceRoot: fixture.workspaceRoot,
        runRoot: fixture.runRoot,
        committedPromotionEvidence: verified.promotionEvidence,
      });
      assert.equal(
        recovered.promotionEvidence.semanticEvidenceSha256,
        verified.promotionEvidence.semanticEvidenceSha256,
      );
      assert.deepEqual(
        recovered.manifest.results.afrikaansTrackedCurated,
        verified.manifest.results.afrikaansTrackedCurated,
      );
      assert.equal(
        recovered.manifest.results.afrikaansTrackedCurated.referencePacks,
        1,
      );
      const originalSiteSourceManifest = driftFixtureSiteSourceCatalog(fixture);
      assert.throws(
        () => createTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
          semanticEvidence: recovered.promotionEvidence,
          promotion: { transactionId: null },
        }),
        /stale for the tracked site source catalog/i,
      );
      assert.throws(
        () => createTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
          semanticEvidence: recovered.promotionEvidence,
          promotion: {
            transactionId: durablePromotion.promotion.transactionId,
            transactionRoot: durablePromotion.transactionRoot,
          },
        }),
        /stale for the tracked site source catalog/i,
      );
      writeFileSync(fixture.siteSourceManifestPath, originalSiteSourceManifest);
      assert.throws(
        () => createTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
          semanticEvidence: recovered.promotionEvidence,
          promotion: { transactionId: null },
        }),
        /No-op semantic release attestation does not match its exact audited trees/,
      );
      assert.throws(
        () => createTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
          semanticEvidence: recovered.promotionEvidence,
          promotion: { transactionId: "a".repeat(64) },
        }),
        /requires durable PREPARED and COMMITTED journals|journal validation/,
      );
      const committedTreeBytes = readFileSync(fixture.mutableTreeFile);
      writeFileSync(
        fixture.mutableTreeFile,
        Buffer.concat([committedTreeBytes, Buffer.from("\n")]),
      );
      assert.throws(
        () => createTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
          semanticEvidence: recovered.promotionEvidence,
          promotion: {
            transactionId: durablePromotion.promotion.transactionId,
            transactionRoot: durablePromotion.transactionRoot,
          },
        }),
        /committed snapshot|exact semantic release trees|site tree/i,
      );
      writeFileSync(fixture.mutableTreeFile, committedTreeBytes);
      const committedStatic = path.join(fixture.staticMainAppRoot, "af.json");
      const committedStaticBytes = readFileSync(committedStatic);
      writeFileSync(
        committedStatic,
        Buffer.concat([committedStaticBytes, Buffer.from("\n")]),
      );
      assert.throws(
        () => createTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
          semanticEvidence: recovered.promotionEvidence,
          promotion: {
            transactionId: durablePromotion.promotion.transactionId,
            transactionRoot: durablePromotion.transactionRoot,
          },
        }),
        /static main-app/i,
      );
      writeFileSync(committedStatic, committedStaticBytes);
      const attestation = createTranslationSemanticReleaseAttestation({
        workspaceRoot: fixture.workspaceRoot,
        semanticEvidence: recovered.promotionEvidence,
        promotion: {
          transactionId: durablePromotion.promotion.transactionId,
          transactionRoot: durablePromotion.transactionRoot,
        },
      });
      const replayedAttestation = createTranslationSemanticReleaseAttestation({
        workspaceRoot: fixture.workspaceRoot,
        semanticEvidence: recovered.promotionEvidence,
        promotion: {
          transactionId: durablePromotion.promotion.transactionId,
          transactionRoot: durablePromotion.transactionRoot,
        },
      });
      assert.equal(replayedAttestation.sha256, attestation.sha256);
      assert.equal(
        attestation.artifact.curatedTree.files,
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_SITE_PACK_COUNT,
      );
      assert.equal(
        attestation.artifact.curatedCorpus.packs,
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      );
      assert.equal(
        readAndValidateTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
        }).sha256,
        attestation.sha256,
      );
      let catalogRaceOriginal: Buffer | undefined;
      assert.throws(
        () => readAndValidateTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
          raceHook: () => {
            catalogRaceOriginal = driftFixtureSiteSourceCatalog(fixture);
          },
        }),
        /site source catalog changed during release validation/i,
      );
      assert.ok(catalogRaceOriginal);
      writeFileSync(fixture.siteSourceManifestPath, catalogRaceOriginal);

      const attestationPath = path.join(
        fixture.workspaceRoot,
        TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_RELATIVE_PATH,
      );
      const attestationBytes = readFileSync(attestationPath);
      const offlineTransactionRoot = `${durablePromotion.transactionRoot}.offline`;
      renameSync(durablePromotion.transactionRoot, offlineTransactionRoot);
      try {
        assert.equal(
          readAndValidateTranslationSemanticReleaseAttestation({
            workspaceRoot: fixture.workspaceRoot,
          }).sha256,
          attestation.sha256,
        );

        const staleBindingValue: unknown = JSON.parse(
          attestationBytes.toString("utf8"),
        );
        assert.ok(isRecord(staleBindingValue));
        const staleBindingPromotion = staleBindingValue.promotion;
        assert.ok(isRecord(staleBindingPromotion));
        const staleBindingJournal = staleBindingPromotion.journal;
        assert.ok(isRecord(staleBindingJournal));
        staleBindingJournal.entriesRootSha256 = "d".repeat(64);
        staleBindingValue.attestationSha256 =
          sha256CanonicalTranslationAuditJson(
            withoutDigest(staleBindingValue, "attestationSha256"),
          );
        writeFileSync(attestationPath, jsonBytes(staleBindingValue));
        assert.throws(
          () => readAndValidateTranslationSemanticReleaseAttestation({
            workspaceRoot: fixture.workspaceRoot,
          }),
          /journal binding is inconsistent/,
        );

        const forgedRelationValue: unknown = JSON.parse(
          attestationBytes.toString("utf8"),
        );
        assert.ok(isRecord(forgedRelationValue));
        const forgedRelationPromotion = forgedRelationValue.promotion;
        assert.ok(isRecord(forgedRelationPromotion));
        const forgedRelationJournal = forgedRelationPromotion.journal;
        assert.ok(isRecord(forgedRelationJournal));
        const forgedPriorTree = forgedRelationJournal.priorSiteTree;
        assert.ok(isRecord(forgedPriorTree));
        forgedPriorTree.sha256 = "c".repeat(64);
        forgedRelationJournal.bindingSha256 =
          sha256CanonicalTranslationAuditJson(
            withoutDigest(forgedRelationJournal, "bindingSha256"),
          );
        forgedRelationValue.attestationSha256 =
          sha256CanonicalTranslationAuditJson(
            withoutDigest(forgedRelationValue, "attestationSha256"),
          );
        writeFileSync(attestationPath, jsonBytes(forgedRelationValue));
        assert.throws(
          () => readAndValidateTranslationSemanticReleaseAttestation({
            workspaceRoot: fixture.workspaceRoot,
          }),
          /journal binding is inconsistent/,
        );

        const forgedNoopValue: unknown = JSON.parse(
          attestationBytes.toString("utf8"),
        );
        assert.ok(isRecord(forgedNoopValue));
        forgedNoopValue.promotion = {
          outcome: "already-complete",
          transactionId: null,
          transactionRoot: null,
          publications: { created: 0, replayed: 0, replaced: 0 },
          journal: null,
        };
        forgedNoopValue.attestationSha256 =
          sha256CanonicalTranslationAuditJson(
            withoutDigest(forgedNoopValue, "attestationSha256"),
          );
        writeFileSync(attestationPath, jsonBytes(forgedNoopValue));
        assert.throws(
          () => readAndValidateTranslationSemanticReleaseAttestation({
            workspaceRoot: fixture.workspaceRoot,
          }),
          /No-op semantic release attestation is not bound to its audited trees/,
        );
      } finally {
        writeFileSync(attestationPath, attestationBytes);
        renameSync(offlineTransactionRoot, durablePromotion.transactionRoot);
      }

      const promotedTreeBytes = readFileSync(fixture.mutableTreeFile);
      writeFileSync(
        fixture.mutableTreeFile,
        Buffer.concat([promotedTreeBytes, Buffer.from("\n")]),
      );
      assert.throws(
        () => readAndValidateTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
        }),
        /journal binding is inconsistent|stale for the curated tree/,
      );
      writeFileSync(fixture.mutableTreeFile, promotedTreeBytes);

      const implementationBytesAfterAudit = readFileSync(
        fixture.implementationPath,
      );
      writeFileSync(
        fixture.implementationPath,
        Buffer.concat([implementationBytesAfterAudit, Buffer.from("# stale\n")]),
      );
      assert.throws(
        () => readAndValidateTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
        }),
        /implementation drifted/,
      );
      writeFileSync(fixture.implementationPath, implementationBytesAfterAudit);

      assert.throws(
        () => readAndValidateTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
          raceHook: () => {
            const sameSizeTreeMutation = Buffer.from(promotedTreeBytes);
            sameSizeTreeMutation[0] = sameSizeTreeMutation[0] === 123 ? 91 : 123;
            writeFileSync(fixture.mutableTreeFile, sameSizeTreeMutation);
          },
        }),
        /tree changed during release validation/,
      );
      writeFileSync(fixture.mutableTreeFile, promotedTreeBytes);

      assert.throws(
        () => readAndValidateTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
          raceHook: () => {
            const sameSizeMutation = Buffer.from(implementationBytesAfterAudit);
            sameSizeMutation[0] = sameSizeMutation[0] === 35 ? 33 : 35;
            writeFileSync(fixture.implementationPath, sameSizeMutation);
          },
        }),
        /changed during semantic release validation/,
      );
      writeFileSync(fixture.implementationPath, implementationBytesAfterAudit);

      const forgedValue: unknown = JSON.parse(attestationBytes.toString("utf8"));
      assert.ok(isRecord(forgedValue));
      const semanticEvidence = forgedValue.semanticEvidence;
      assert.ok(isRecord(semanticEvidence));
      const modelDigests = semanticEvidence.modelDigests;
      assert.ok(isRecord(modelDigests));
      modelDigests.fasttextSha256 = "e".repeat(64);
      semanticEvidence.semanticEvidenceSha256 =
        sha256CanonicalTranslationAuditJson(
          withoutDigest(semanticEvidence, "semanticEvidenceSha256"),
        );
      forgedValue.attestationSha256 = sha256CanonicalTranslationAuditJson(
        withoutDigest(forgedValue, "attestationSha256"),
      );
      writeFileSync(attestationPath, jsonBytes(forgedValue));
      assert.throws(
        () => readAndValidateTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
        }),
        /violates its exact schema/,
      );
      writeFileSync(attestationPath, attestationBytes);

      const forgedProfileValue: unknown = JSON.parse(
        attestationBytes.toString("utf8"),
      );
      assert.ok(isRecord(forgedProfileValue));
      const forgedProfileEvidence = forgedProfileValue.semanticEvidence;
      assert.ok(isRecord(forgedProfileEvidence));
      const forgedProfile = forgedProfileEvidence.generatorExecutionProfile;
      assert.ok(isRecord(forgedProfile));
      const forgedEnvironment = forgedProfile.environment;
      assert.ok(isRecord(forgedEnvironment));
      forgedEnvironment.OMP_NUM_THREADS = "2";
      const forgedProfileSha256 = sha256CanonicalTranslationAuditJson(
        withoutDigest(forgedProfile, "executionProfileSha256"),
      );
      forgedProfile.executionProfileSha256 = forgedProfileSha256;
      forgedProfileEvidence.generatorExecutionProfileSha256 =
        forgedProfileSha256;
      forgedProfileEvidence.semanticEvidenceSha256 =
        sha256CanonicalTranslationAuditJson(
          withoutDigest(forgedProfileEvidence, "semanticEvidenceSha256"),
        );
      forgedProfileValue.generatorExecutionProfileSha256 =
        forgedProfileSha256;
      const forgedProfilePromotion = forgedProfileValue.promotion;
      assert.ok(isRecord(forgedProfilePromotion));
      const forgedProfileJournal = forgedProfilePromotion.journal;
      assert.ok(isRecord(forgedProfileJournal));
      forgedProfileJournal.generatorExecutionProfileSha256 =
        forgedProfileSha256;
      forgedProfileJournal.semanticEvidenceSha256 =
        forgedProfileEvidence.semanticEvidenceSha256;
      forgedProfileJournal.bindingSha256 =
        sha256CanonicalTranslationAuditJson(
          withoutDigest(forgedProfileJournal, "bindingSha256"),
        );
      forgedProfileValue.attestationSha256 =
        sha256CanonicalTranslationAuditJson(
          withoutDigest(forgedProfileValue, "attestationSha256"),
        );
      writeFileSync(attestationPath, jsonBytes(forgedProfileValue));
      assert.throws(
        () => readAndValidateTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
        }),
        /violates its exact schema|stale generator runtime evidence/,
      );
      writeFileSync(attestationPath, attestationBytes);

      unlinkSync(attestationPath);
      assert.throws(
        () => readAndValidateTranslationSemanticReleaseAttestation({
          workspaceRoot: fixture.workspaceRoot,
        }),
        /ENOENT|does not exist/,
      );
      writeFileSync(attestationPath, attestationBytes);
    } finally {
      fixture.cleanup();
    }
  },
);

test("verifier rejects duplicate JSON keys before schema validation", () => {
  const fixture = makeMinimalFixture();
  try {
    assert.throws(
      () => verifyTranslationSemanticAuditManifest(fixture),
      /duplicate JSON key "schemaVersion"/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("verifier rejects symlinked and hardlinked tree resources", () => {
  const symlinkFixture = makeMinimalFixture();
  try {
    const outside = path.join(symlinkFixture.workspaceRoot, "outside.json");
    writeJson(outside, {});
    mkdirSync(path.join(symlinkFixture.curatedRoot, "af"), { recursive: true });
    symlinkSync(outside, path.join(symlinkFixture.curatedRoot, "af", "link.json"));
    assert.throws(
      () => verifyTranslationSemanticAuditManifest(symlinkFixture),
      /contains a symbolic link/,
    );
  } finally {
    symlinkFixture.cleanup();
  }

  const hardlinkFixture = makeMinimalFixture();
  try {
    const localeRoot = path.join(hardlinkFixture.curatedRoot, "af");
    mkdirSync(localeRoot, { recursive: true });
    const first = path.join(localeRoot, "first.json");
    const second = path.join(localeRoot, "second.json");
    writeJson(first, {});
    linkSync(first, second);
    assert.throws(
      () => verifyTranslationSemanticAuditManifest(hardlinkFixture),
      /single-link regular file/,
    );
  } finally {
    hardlinkFixture.cleanup();
  }
});
