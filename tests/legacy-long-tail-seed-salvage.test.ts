import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import type { SupportedLanguage } from "../lib/content/languages";
import type { TranslationSource } from "../lib/i18n/translation-types";
import {
  buildLongTailMasterWorklist,
  createLongTailGenerationOverrides,
  createLongTailSeedMemory,
  createSourceCatalogEntry,
  longTailSeedSalvageCurrentValidation,
  parseLongTailCliOptions,
  parseLongTailSeedMemory,
  type LongTailInventory,
  type LongTailMasterWorklist,
  type LongTailPipelineProvenance,
  type LongTailSeedMemory,
  type LongTailSourceCatalogEntry,
} from "../scripts/generate-long-tail-translations";
import {
  createLegacyLongTailSeedSalvageAcceptance,
  LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_BASENAME,
  LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_KIND,
  LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_STATEMENT,
  LEGACY_LONG_TAIL_SEED_SALVAGE_EVIDENCE_BASENAME,
  LEGACY_LONG_TAIL_SEED_SALVAGE_KIND,
  parseLegacyLongTailSeedSalvageAcceptance,
  parseLegacyLongTailSeedSalvageEvidence,
  publishLegacyLongTailSeedSalvageAcceptance,
  salvageLegacyLongTailSeedMemory as salvageLegacyLongTailSeedMemoryWithCurrentValidation,
  verifyAcceptedLegacyLongTailSeedSalvage as verifyAcceptedLegacyLongTailSeedSalvageWithCurrentValidation,
  type LegacyLongTailSeedSalvageAcceptance,
  type LegacyLongTailSeedSalvageResult,
} from "../scripts/legacy-long-tail-seed-salvage";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE,
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
} from "../scripts/long-tail-nllb-execution-profile";
import {
  calculateLongTailValidatorPolicySha256,
  createLongTailValidatorPolicyProvenance,
} from "../scripts/translation-validator-policy-provenance";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SHA_ZERO = "0".repeat(64);
const SHA_ONE = "1".repeat(64);
const ACCEPTANCE_NOW = new Date("2026-07-15T12:00:00.000Z");
const ACCEPTED_AT = "2026-07-15T11:59:00.000Z";
const EXPIRES_AT = "2026-07-22T11:59:00.000Z";
type TargetLanguage = Exclude<SupportedLanguage, "English">;

function salvageLegacyLongTailSeedMemory(
  input: Omit<
    Parameters<
      typeof salvageLegacyLongTailSeedMemoryWithCurrentValidation
    >[0],
    "currentValidation"
  >,
) {
  return salvageLegacyLongTailSeedMemoryWithCurrentValidation({
    ...input,
    currentValidation: longTailSeedSalvageCurrentValidation,
  });
}

function verifyAcceptedLegacyLongTailSeedSalvage(
  input: Omit<
    Parameters<
      typeof verifyAcceptedLegacyLongTailSeedSalvageWithCurrentValidation
    >[0],
    "currentValidation"
  >,
) {
  return verifyAcceptedLegacyLongTailSeedSalvageWithCurrentValidation({
    ...input,
    currentValidation: longTailSeedSalvageCurrentValidation,
  });
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Fixture is not canonical JSON.");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported fixture type: ${typeof value}.`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Canonical(value: unknown): string {
  return sha256(canonicalJson(value));
}

function sourceHash(strings: Readonly<Record<string, string>>): string {
  return sha256(
    Object.keys(strings).sort(compareCodePoints)
      .map((key) => `${key}\u0000${strings[key]}`)
      .join("\u0001"),
  );
}

function makeSource(
  namespace: string,
  sourceStrings: Readonly<Record<string, string>>,
): TranslationSource {
  return Object.freeze({
    namespace,
    sourceHash: sourceHash(sourceStrings),
    sourceStrings: Object.freeze({ ...sourceStrings }),
  });
}

function makeSeedEntry(input: Readonly<{
  language: TargetLanguage;
  locale: string;
  source: string;
  value: string;
}>): LongTailSeedMemory["entries"][number] {
  return Object.freeze({
    language: input.language,
    locale: input.locale,
    source: input.source,
    sourceSha256: sha256(input.source),
    value: input.value,
    valueSha256: sha256(input.value),
  });
}

function makeSeedMemory(input: Readonly<{
  entries?: readonly LongTailSeedMemory["entries"][number][];
  conflicts?: readonly LongTailSeedMemory["conflicts"][number][];
}> = {}): LongTailSeedMemory {
  const entries = [...(input.entries ?? [])].sort((left, right) =>
    compareCodePoints(left.locale, right.locale) ||
    compareCodePoints(left.sourceSha256, right.sourceSha256)
  );
  const conflicts = [...(input.conflicts ?? [])].sort((left, right) =>
    compareCodePoints(left.locale, right.locale) ||
    compareCodePoints(left.sourceSha256, right.sourceSha256)
  );
  const material = {
    schemaVersion: 1 as const,
    kind: "inspir-long-tail-translation-seed-memory-v1" as const,
    entries,
    conflicts,
  };
  return parseLongTailSeedMemory({
    ...material,
    seedMemorySha256: sha256Canonical(material),
  });
}

type CurrentFixture = Readonly<{
  inventory: LongTailInventory;
  baseSeed: LongTailSeedMemory;
  master: LongTailMasterWorklist;
}>;

function makeCurrentFixture(input: Readonly<{
  tempRoot: string;
  language?: TargetLanguage;
  source?: TranslationSource;
  baseSeed?: LongTailSeedMemory;
}>): CurrentFixture {
  const language = input.language ?? "Spanish";
  const source = input.source ?? makeSource("route:test", {
    title: "Start learning",
  });
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze([language]),
    sources: Object.freeze([source]),
    curatedRoot: path.join(input.tempRoot, "curated"),
  });
  mkdirSync(inventory.curatedRoot, { recursive: true });
  const baseSeed = input.baseSeed ?? createLongTailSeedMemory(inventory);
  const generationOverrides = createLongTailGenerationOverrides(baseSeed);
  const validatorPolicy = createLongTailValidatorPolicyProvenance(REPO_ROOT);
  const pipelineImplementationSha256 = sha256(
    readFileSync(
      path.join(REPO_ROOT, "scripts/generate-long-tail-translations.ts"),
      "utf8",
    ),
  );
  const provenance: LongTailPipelineProvenance = Object.freeze({
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
    protectorVersion: "inspir-long-tail-literal-protector-v1",
    protectorSha256: SHA_ZERO,
    pipelineImplementationSha256,
    workerImplementationSha256: SHA_ZERO,
    validatorPolicy,
    modelLabel: "synthetic-offline-test-model",
    modelSha256: SHA_ZERO,
    seedMemorySha256: baseSeed.seedMemorySha256,
    seedMemoryEntries: baseSeed.entries.length,
    seedMemoryConflicts: baseSeed.conflicts.length,
    generationOverridesSha256:
      generationOverrides.generationOverridesSha256,
    generationOverrideEntries: generationOverrides.entries.length,
    generationConfig: Object.freeze({
      batchSize: 1,
      numBeams: 1,
      noRepeatNgramSize: 4,
      dtype: "float16",
      device: "mps",
      maxSourceTokens: 64,
      maxNewTokens: 64,
      maxRetryAttempts: 1,
      deterministicAlgorithms: true,
      manualSeed: 0,
    }),
  });
  const built = buildLongTailMasterWorklist({
    inventory,
    provenance,
    seedMemory: baseSeed,
  });
  return Object.freeze({ inventory, baseSeed, master: built.worklist });
}

type ObsoleteSeedEntry = LongTailSeedMemory["entries"][number];
type ObsoleteSeedConflict = LongTailSeedMemory["conflicts"][number];

function obsoleteWorklist(input: Readonly<{
  sources: readonly LongTailSourceCatalogEntry[];
  language: TargetLanguage;
  locale: string;
  entries?: readonly ObsoleteSeedEntry[];
  conflicts?: readonly ObsoleteSeedConflict[];
}>) {
  const entries = [...(input.entries ?? [])].sort((left, right) =>
    compareCodePoints(left.locale, right.locale) ||
    compareCodePoints(left.sourceSha256, right.sourceSha256)
  );
  const conflicts = [...(input.conflicts ?? [])].sort((left, right) =>
    compareCodePoints(left.locale, right.locale) ||
    compareCodePoints(left.sourceSha256, right.sourceSha256)
  );
  const seedMaterial = {
    schemaVersion: 1 as const,
    kind: "inspir-long-tail-translation-seed-memory-v1" as const,
    entries,
    conflicts,
  };
  const seedMemory = {
    ...seedMaterial,
    seedMemorySha256: sha256Canonical(seedMaterial),
  };
  const validatorPolicy = createLongTailValidatorPolicyProvenance(REPO_ROOT);
  const provenance = {
    pipelineVersion: "inspir-long-tail-local-nllb-v2" as const,
    protectorVersion: "inspir-long-tail-literal-protector-v1" as const,
    protectorSha256: SHA_ZERO,
    pipelineImplementationSha256: SHA_ZERO,
    workerImplementationSha256: SHA_ZERO,
    validatorPolicy,
    modelLabel: "obsolete-untrusted-test-model",
    modelSha256: SHA_ZERO,
    seedMemorySha256: seedMemory.seedMemorySha256,
    seedMemoryEntries: entries.length,
    seedMemoryConflicts: conflicts.length,
    generationConfig: {
      batchSize: 1,
      numBeams: 1,
      noRepeatNgramSize: 4,
      dtype: "float16" as const,
      device: "mps" as const,
      maxSourceTokens: 64,
      maxNewTokens: 64,
      maxRetryAttempts: 1,
    },
  };
  const jobs = input.sources.map((source) => {
    const relativePath = `${input.locale}/${source.namespace.replace(/[^a-z0-9.-]+/gi, "__")}.json`;
    const material = {
      language: input.language,
      locale: input.locale,
      nllbCode: input.locale === "nl" ? "nld_Latn" : "spa_Latn",
      namespace: source.namespace,
      sourceHash: source.sourceHash,
      sourceEntriesSha256: source.sourceEntriesSha256,
      entryCount: source.entries.length,
      worklistRelativePath: relativePath,
      candidateRelativePath: relativePath,
      targetRelativePath: relativePath,
    };
    return { ...material, jobSha256: sha256Canonical(material) };
  }).sort((left, right) =>
    compareCodePoints(left.candidateRelativePath, right.candidateRelativePath)
  );
  const material = {
    schemaVersion: 1 as const,
    kind: "inspir-long-tail-translation-worklist-v1" as const,
    provenance,
    seedMemory,
    sources: [...input.sources].sort((left, right) =>
      compareCodePoints(left.namespace, right.namespace)
    ),
    jobs,
  };
  return { ...material, worklistSha256: sha256Canonical(material) };
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(file), 0o700);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(file, 0o600);
}

function acceptedSalvageArtifact(
  result: LegacyLongTailSeedSalvageResult,
): LegacyLongTailSeedSalvageAcceptance {
  return createLegacyLongTailSeedSalvageAcceptance({
    evidence: result.evidence,
    acceptanceStatement: LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_STATEMENT,
    acceptedAt: ACCEPTED_AT,
    expiresAt: EXPIRES_AT,
    now: ACCEPTANCE_NOW,
  });
}

function rehashAcceptance(
  input: LegacyLongTailSeedSalvageAcceptance,
): LegacyLongTailSeedSalvageAcceptance {
  const material = {
    schemaVersion: input.schemaVersion,
    kind: input.kind,
    authority: input.authority,
    acceptanceStatement: input.acceptanceStatement,
    acceptedAt: input.acceptedAt,
    expiresAt: input.expiresAt,
    bindings: input.bindings,
  };
  return {
    ...material,
    acceptanceSha256: sha256Canonical(material),
  };
}

function listFixturePaths(root: string): readonly string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split(path.sep).join("/"))
    .sort(compareCodePoints);
}

function createTempRoot(): string {
  mkdirSync(path.join(REPO_ROOT, "tmp"), { recursive: true });
  return mkdtempSync(path.join(REPO_ROOT, "tmp/legacy-seed-salvage-test-"));
}

function withTempRoot(run: (tempRoot: string) => void): void {
  const tempRoot = createTempRoot();
  try {
    run(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeObsoleteFixture(input: Readonly<{
  tempRoot: string;
  current: CurrentFixture;
  entries?: readonly ObsoleteSeedEntry[];
  conflicts?: readonly ObsoleteSeedConflict[];
  sources?: readonly LongTailSourceCatalogEntry[];
  language?: TargetLanguage;
  locale?: string;
}>): string {
  const file = path.join(input.tempRoot, "obsolete/worklist.json");
  writeJson(file, obsoleteWorklist({
    sources: input.sources ?? input.current.master.sources,
    language: input.language ?? "Spanish",
    locale: input.locale ?? "es",
    entries: input.entries,
    conflicts: input.conflicts,
  }));
  return file;
}

test("obsolete values are revalidated in every current context and unioned deterministically without authority", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const file = writeObsoleteFixture({ tempRoot, current, entries: [entry] });
    const first = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: file,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    const second = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: file,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });

    assert.equal(first.seedMemory.entries.length, 1);
    assert.equal(first.seedMemory.entries[0]?.value, "Empieza a aprender");
    assert.equal(first.evidence.kind, LEGACY_LONG_TAIL_SEED_SALVAGE_KIND);
    assert.equal(first.evidence.authority.inputStatus, "obsolete-self-attested-candidate-seed-only");
    assert.equal(first.evidence.authority.authentication, "none");
    assert.equal(first.evidence.authority.grantsReleaseEvidence, false);
    assert.equal(first.evidence.authority.canApply, false);
    assert.equal(first.evidence.authority.canPromote, false);
    assert.equal(first.evidence.authority.canDeploy, false);
    assert.equal(first.evidence.authority.canWriteProduction, false);
    assert.equal(first.evidence.decisions.revalidatedAgainstAllCurrentContexts, 1);
    assert.equal(first.evidence.decisions.addedEntries, 1);
    assert.equal(first.evidence.result.seedMemorySha256, first.seedMemory.seedMemorySha256);
    assert.equal(first.evidence.current.implementations.length, 3);
    assert.deepEqual(first.evidence.current.implementations[2], {
      relativePath: "scripts/verify-translation-semantic-audit.ts",
      bytes: readFileSync(
        path.join(REPO_ROOT, "scripts/verify-translation-semantic-audit.ts"),
      ).byteLength,
      sha256: sha256(
        readFileSync(
          path.join(REPO_ROOT, "scripts/verify-translation-semantic-audit.ts"),
          "utf8",
        ),
      ),
    });
    assert.equal(first.evidence.evidenceSha256, second.evidence.evidenceSha256);
    assert.deepEqual(parseLegacyLongTailSeedSalvageEvidence(first.evidence), first.evidence);
  });
});

test("current seed wins exact overlaps and value conflicts", () => {
  withTempRoot((tempRoot) => {
    const currentEntry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Comienza a aprender",
    });
    const baseSeed = makeSeedMemory({ entries: [currentEntry] });
    const current = makeCurrentFixture({ tempRoot, baseSeed });
    const obsoleteEntry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const file = writeObsoleteFixture({
      tempRoot,
      current,
      entries: [obsoleteEntry],
    });
    const result = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: file,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    assert.equal(result.seedMemory.entries.length, 1);
    assert.equal(result.seedMemory.entries[0]?.value, "Comienza a aprender");
    assert.equal(result.evidence.decisions.addedEntries, 0);
    assert.equal(result.evidence.decisions.currentSeedValueConflicts, 1);
    assert.equal(
      result.evidence.decisions.rejectionCounts["current-seed-value-conflict"],
      1,
    );

    const exactOverlapFile = path.join(
      tempRoot,
      "obsolete/exact-overlap-worklist.json",
    );
    writeJson(
      exactOverlapFile,
      obsoleteWorklist({
        sources: current.master.sources,
        language: "Spanish",
        locale: "es",
        entries: [currentEntry],
      }),
    );
    const exactOverlap = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: exactOverlapFile,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    assert.equal(exactOverlap.evidence.decisions.overlapWithCurrentSeed, 1);
    assert.equal(exactOverlap.evidence.decisions.currentSeedValueConflicts, 0);
    assert.equal(exactOverlap.evidence.decisions.addedEntries, 0);
    assert.deepEqual(exactOverlap.seedMemory, current.baseSeed);
  });
});

test("a value must pass key-sensitive validation in every current occurrence context", () => {
  withTempRoot((tempRoot) => {
    const source = makeSource("route:key-sensitive-test", {
      "component.7929b59ace63": "2 September 1666",
      other: "2 September 1666",
    });
    const current = makeCurrentFixture({
      tempRoot,
      language: "Dutch",
      source,
    });
    const entry = makeSeedEntry({
      language: "Dutch",
      locale: "nl",
      source: "2 September 1666",
      value: "2 september 1666",
    });
    const file = writeObsoleteFixture({
      tempRoot,
      current,
      entries: [entry],
      language: "Dutch",
      locale: "nl",
    });
    const result = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: file,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    assert.equal(result.seedMemory.entries.length, 0);
    assert.equal(result.evidence.decisions.rejectedEntries, 1);
    assert.equal(
      result.evidence.decisions.rejectionCounts["field-policy-context-failure"],
      1,
    );
    assert.equal(
      result.evidence.decisions.rejectionCounts["fluency-context-failure"],
      1,
    );
  });
});

test("internally valid obsolete values for stale sources are recorded but never unioned", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const staleSource = makeSource("route:obsolete", { title: "Old source" });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Old source",
      value: "Fuente antigua",
    });
    const file = writeObsoleteFixture({
      tempRoot,
      current,
      entries: [entry],
      sources: [createSourceCatalogEntry(staleSource)],
    });
    const result = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: file,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    assert.equal(result.seedMemory.entries.length, 0);
    assert.equal(result.evidence.decisions.rejectionCounts["source-not-current"], 1);
  });
});

test("declared obsolete conflicts remain conflicts and cannot become values", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const conflict = Object.freeze({
      language: "Spanish" as const,
      locale: "es",
      sourceSha256: sha256("Start learning"),
    });
    const file = writeObsoleteFixture({
      tempRoot,
      current,
      conflicts: [conflict],
    });
    const result = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: file,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    assert.equal(result.seedMemory.entries.length, 0);
    assert.equal(result.seedMemory.conflicts.length, 1);
    assert.equal(result.evidence.decisions.eligibleObsoleteDeclaredConflicts, 1);
    assert.equal(result.evidence.decisions.addedConflictRecords, 1);
  });
});

test("tampered obsolete value, source, seed, job, and worklist hashes fail closed", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const fixture = obsoleteWorklist({
      sources: current.master.sources,
      language: "Spanish",
      locale: "es",
      entries: [entry],
    });
    const cases: readonly Readonly<{
      label: string;
      mutate: (value: typeof fixture) => void;
    }>[] = [
      {
        label: "value",
        mutate: (value) => {
          const firstEntry = value.seedMemory.entries[0];
          assert.ok(firstEntry);
          firstEntry.value = "Contenido manipulado";
        },
      },
      {
        label: "source",
        mutate: (value) => {
          const firstSourceEntry = value.sources[0]?.entries[0];
          assert.ok(firstSourceEntry);
          firstSourceEntry.source = "Tampered source";
        },
      },
      {
        label: "seed",
        mutate: (value) => {
          value.seedMemory.seedMemorySha256 = SHA_ONE;
        },
      },
      {
        label: "job",
        mutate: (value) => {
          const firstJob = value.jobs[0];
          assert.ok(firstJob);
          firstJob.jobSha256 = SHA_ONE;
        },
      },
      {
        label: "worklist",
        mutate: (value) => {
          value.worklistSha256 = SHA_ONE;
        },
      },
    ];
    for (const [index, item] of cases.entries()) {
      const tampered = structuredClone(fixture);
      item.mutate(tampered);
      const file = path.join(
        tempRoot,
        `obsolete/tampered-${index}-${item.label}.json`,
      );
      writeJson(file, tampered);
      assert.throws(
        () => salvageLegacyLongTailSeedMemory({
          repoRoot: REPO_ROOT,
          obsoleteWorklistPath: file,
          currentPlanningMaster: current.master,
          baseSeedMemory: current.baseSeed,
        }),
        /hash is stale|internally stale|tampered/,
        item.label,
      );
    }
  });
});

test("duplicate obsolete identities fail even when all declared hashes are recomputed", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const file = writeObsoleteFixture({
      tempRoot,
      current,
      entries: [entry, entry],
    });
    assert.throws(
      () => salvageLegacyLongTailSeedMemory({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: file,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
      }),
      /duplicate or noncanonical/,
    );
  });
});

test("strict JSON rejects ambiguous bytes, trailing data, and excessive depth", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const cases: readonly Readonly<{
      name: string;
      bytes: string | Buffer;
      expected: RegExp;
    }>[] = [
      {
        name: "duplicate-key",
        bytes: '{"schemaVersion":1,"schemaVersion":1}\n',
        expected: /duplicate JSON key/,
      },
      {
        name: "invalid-utf8",
        bytes: Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]),
        expected: /valid UTF-8/,
      },
      {
        name: "trailing-data",
        bytes: "{}{}",
        expected: /trailing JSON data/,
      },
      {
        name: "excessive-depth",
        bytes: `${"[".repeat(258)}0${"]".repeat(258)}`,
        expected: /nesting bound/,
      },
    ];
    for (const item of cases) {
      const file = path.join(tempRoot, `obsolete/${item.name}.json`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, item.bytes);
      assert.throws(
        () => salvageLegacyLongTailSeedMemory({
          repoRoot: REPO_ROOT,
          obsoleteWorklistPath: file,
          currentPlanningMaster: current.master,
          baseSeedMemory: current.baseSeed,
        }),
        item.expected,
        item.name,
      );
    }
  });
});

test("stale current source/context and validator bindings fail closed", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const file = writeObsoleteFixture({ tempRoot, current, entries: [entry] });

    const sourceTamper = structuredClone(current.master);
    const source = sourceTamper.sources[0];
    assert.ok(source);
    source.sourceHash = SHA_ONE;
    assert.throws(
      () => salvageLegacyLongTailSeedMemory({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: file,
        currentPlanningMaster: sourceTamper,
        baseSeedMemory: current.baseSeed,
      }),
      /hash is stale|source|worklist/i,
    );

    const policyTamper = structuredClone(current.master);
    const policyFile = policyTamper.provenance.validatorPolicy.files[0];
    assert.ok(policyFile);
    Reflect.set(policyFile, "sha256", SHA_ONE);
    Reflect.set(
      policyTamper.provenance.validatorPolicy,
      "validatorPolicySha256",
      calculateLongTailValidatorPolicySha256(
        policyTamper.provenance.validatorPolicy.files,
      ),
    );
    const { worklistSha256: ignored, ...material } = policyTamper;
    void ignored;
    policyTamper.worklistSha256 = sha256Canonical(material);
    assert.throws(
      () => salvageLegacyLongTailSeedMemory({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: file,
        currentPlanningMaster: policyTamper,
        baseSeedMemory: current.baseSeed,
      }),
      /validator policy|drift/i,
    );

    const implementationTamper = structuredClone(current.master);
    Reflect.set(
      implementationTamper.provenance,
      "pipelineImplementationSha256",
      SHA_ONE,
    );
    const {
      worklistSha256: ignoredImplementationHash,
      ...implementationMaterial
    } = implementationTamper;
    void ignoredImplementationHash;
    Reflect.set(
      implementationTamper,
      "worklistSha256",
      sha256Canonical(implementationMaterial),
    );
    assert.throws(
      () => salvageLegacyLongTailSeedMemory({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: file,
        currentPlanningMaster: implementationTamper,
        baseSeedMemory: current.baseSeed,
      }),
      /executing pipeline implementation/,
    );
  });
});

test("paths outside repository tmp and symlinked or hardlinked inputs fail closed", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const file = writeObsoleteFixture({ tempRoot, current, entries: [entry] });
    assert.throws(
      () => salvageLegacyLongTailSeedMemory({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: path.join(REPO_ROOT, "package.json"),
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
      }),
      /below repository tmp/,
    );

    const symlinkDirectory = path.join(tempRoot, "symlinked");
    symlinkSync(path.dirname(file), symlinkDirectory, "dir");
    assert.throws(
      () => salvageLegacyLongTailSeedMemory({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: path.join(symlinkDirectory, path.basename(file)),
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
      }),
      /symbolic-link|symlink/,
    );

    const hardlink = path.join(tempRoot, "obsolete/hardlinked.json");
    linkSync(file, hardlink);
    assert.throws(
      () => salvageLegacyLongTailSeedMemory({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: hardlink,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
      }),
      /single-link/,
    );
  });
});

test("same-descriptor identity checks detect path replacement during read", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const file = writeObsoleteFixture({ tempRoot, current, entries: [entry] });
    const bytes = readFileSync(file);
    let replaced = false;
    assert.throws(
      () => salvageLegacyLongTailSeedMemory({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: file,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        raceHook: (point) => {
          if (point !== "after-open-before-read" || replaced) return;
          replaced = true;
          renameSync(file, `${file}.opened`);
          writeFileSync(file, bytes);
        },
      }),
      /changed while it was read/,
    );
    assert.equal(replaced, true);
  });
});

test("evidence tampering and the opt-in CLI boundary fail closed", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const file = writeObsoleteFixture({ tempRoot, current, entries: [entry] });
    const result = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: file,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    const tamperedEvidence = structuredClone(result.evidence);
    tamperedEvidence.result.entries += 1;
    assert.throws(
      () => parseLegacyLongTailSeedSalvageEvidence(tamperedEvidence),
      /hash is stale or tampered/,
    );

    const parsed = parseLongTailCliOptions([
      "--legacy-seed-salvage",
      "tmp/obsolete/worklist.json",
    ]);
    assert.equal(
      parsed.legacySeedSalvagePath,
      "tmp/obsolete/worklist.json",
    );
    for (const incompatible of [
      ["--execute"],
      ["--execute", "--promote"],
      ["--execute", "--smoke-packs", "1"],
      ["--execute", "--smoke-locale", "es"],
      ["--import-candidate-root", "tmp/import-candidates"],
    ] as const) {
      assert.throws(
        () => parseLongTailCliOptions([
          "--legacy-seed-salvage",
          "tmp/obsolete/worklist.json",
          ...incompatible,
        ]),
        /diagnostic-only dry-run input/,
      );
    }
    assert.throws(
      () => parseLongTailCliOptions([
        "--runtime-smoke",
        "--legacy-seed-salvage",
        "tmp/obsolete/worklist.json",
      ]),
      /diagnostic-only dry-run input/,
    );
    assert.throws(
      () => parseLongTailCliOptions([
        "--legacy-seed-salvage",
        "tmp/a.json",
        "--legacy-seed-salvage",
        "tmp/b.json",
      ]),
      /only appear once/,
    );

    const accepted = parseLongTailCliOptions([
      "--execute",
      "--accepted-legacy-seed-salvage",
      "tmp/obsolete/worklist.json",
      "--legacy-seed-salvage-acceptance",
      "tmp/obsolete/acceptance.json",
    ]);
    assert.equal(
      accepted.acceptedLegacySeedSalvagePath,
      "tmp/obsolete/worklist.json",
    );
    assert.equal(
      accepted.legacySeedSalvageAcceptancePath,
      "tmp/obsolete/acceptance.json",
    );
    const acceptedPromotion = parseLongTailCliOptions([
      "--execute",
      "--promote",
      "--accepted-legacy-seed-salvage",
      "tmp/obsolete/worklist.json",
      "--legacy-seed-salvage-acceptance",
      "tmp/obsolete/acceptance.json",
    ]);
    assert.equal(acceptedPromotion.promote, true);
    for (const missingAcceptance of [
      [
        "--execute",
        "--accepted-legacy-seed-salvage",
        "tmp/obsolete/worklist.json",
      ],
      [
        "--execute",
        "--promote",
        "--accepted-legacy-seed-salvage",
        "tmp/obsolete/worklist.json",
      ],
      [
        "--execute",
        "--legacy-seed-salvage-acceptance",
        "tmp/obsolete/acceptance.json",
      ],
    ] as const) {
      assert.throws(
        () => parseLongTailCliOptions(missingAcceptance),
        /must be supplied together/,
      );
    }
    assert.throws(
      () => parseLongTailCliOptions([
        "--accepted-legacy-seed-salvage",
        "tmp/obsolete/worklist.json",
        "--legacy-seed-salvage-acceptance",
        "tmp/obsolete/acceptance.json",
      ]),
      /requires --execute/,
    );
    assert.throws(
      () => parseLongTailCliOptions([
        "--execute",
        "--runtime-smoke",
        "--accepted-legacy-seed-salvage",
        "tmp/obsolete/worklist.json",
        "--legacy-seed-salvage-acceptance",
        "tmp/obsolete/acceptance.json",
      ]),
      /forbids --runtime-smoke/,
    );
    assert.throws(
      () => parseLongTailCliOptions([
        "--legacy-seed-salvage",
        "tmp/obsolete/worklist.json",
        "--accepted-legacy-seed-salvage",
        "tmp/obsolete/worklist.json",
        "--legacy-seed-salvage-acceptance",
        "tmp/obsolete/acceptance.json",
      ]),
      /diagnostic-only dry-run input/,
    );
  });
});

test("an exact, current trusted-local acceptance unlocks only the recomputed in-memory seed", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const obsoletePath = writeObsoleteFixture({
      tempRoot,
      current,
      entries: [entry],
    });
    const diagnostic = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: obsoletePath,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    const acceptance = acceptedSalvageArtifact(diagnostic);
    const acceptancePath = path.join(tempRoot, "acceptance/accepted.json");
    writeJson(acceptancePath, acceptance);
    const pathsBefore = listFixturePaths(tempRoot);

    const verified = verifyAcceptedLegacyLongTailSeedSalvage({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: obsoletePath,
      acceptancePath,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
      now: ACCEPTANCE_NOW,
    });

    assert.equal(
      verified.acceptance.kind,
      LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_KIND,
    );
    assert.equal(verified.acceptance.authority.authentication, "none");
    assert.equal(
      verified.acceptance.authority.identityClaimsVerified,
      false,
    );
    assert.equal(verified.acceptance.authority.grantsReleaseEvidence, false);
    assert.equal(
      verified.acceptance.authority.substitutesCandidateValidation,
      false,
    );
    assert.equal(verified.acceptance.authority.substitutesSemanticAudit, false);
    assert.equal(verified.acceptance.authority.substitutesReleaseGates, false);
    assert.equal(verified.acceptance.authority.canPromoteByItself, false);
    assert.equal(verified.acceptance.authority.canDeploy, false);
    assert.equal(verified.acceptance.authority.canWriteProduction, false);
    assert.equal(
      verified.evidence.evidenceSha256,
      diagnostic.evidence.evidenceSha256,
    );
    assert.equal(
      verified.seedMemory.seedMemorySha256,
      diagnostic.seedMemory.seedMemorySha256,
    );
    assert.equal(
      verified.acceptance.bindings.current.implementations[2]?.relativePath,
      "scripts/verify-translation-semantic-audit.ts",
    );
    assert.deepEqual(listFixturePaths(tempRoot), pathsBefore);
    assert.deepEqual(
      parseLegacyLongTailSeedSalvageAcceptance(acceptance, ACCEPTANCE_NOW),
      acceptance,
    );
  });
});

test("acceptance publisher creates one exclusive owner-private fsynced artifact set", () => {
  const tempRoot = createTempRoot();
  const outputDirectory = `${tempRoot}-published`;
  const relativeOutputDirectory = path.relative(REPO_ROOT, outputDirectory);
  try {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const obsoletePath = writeObsoleteFixture({
      tempRoot,
      current,
      entries: [entry],
    });
    const diagnostic = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: obsoletePath,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    const acceptance = acceptedSalvageArtifact(diagnostic);
    const published = publishLegacyLongTailSeedSalvageAcceptance({
      repoRoot: REPO_ROOT,
      outputDirectoryPath: relativeOutputDirectory,
      evidence: diagnostic.evidence,
      acceptance,
      now: ACCEPTANCE_NOW,
    });
    assert.equal(published.directory, outputDirectory);
    assert.equal(
      path.basename(published.evidencePath),
      LEGACY_LONG_TAIL_SEED_SALVAGE_EVIDENCE_BASENAME,
    );
    assert.equal(
      path.basename(published.acceptancePath),
      LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_BASENAME,
    );
    assert.equal(statSync(outputDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(published.evidencePath).mode & 0o777, 0o600);
    assert.equal(statSync(published.acceptancePath).mode & 0o777, 0o600);
    assert.equal(
      published.evidenceFileSha256,
      sha256(readFileSync(published.evidencePath, "utf8")),
    );
    assert.equal(
      published.acceptanceFileSha256,
      sha256(readFileSync(published.acceptancePath, "utf8")),
    );
    const parsedPublishedEvidence: unknown = JSON.parse(
      readFileSync(published.evidencePath, "utf8"),
    );
    assert.deepEqual(
      parseLegacyLongTailSeedSalvageEvidence(parsedPublishedEvidence),
      diagnostic.evidence,
    );
    assert.equal(
      verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath: published.acceptancePath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }).acceptance.acceptanceSha256,
      acceptance.acceptanceSha256,
    );
    assert.throws(
      () => publishLegacyLongTailSeedSalvageAcceptance({
        repoRoot: REPO_ROOT,
        outputDirectoryPath: relativeOutputDirectory,
        evidence: diagnostic.evidence,
        acceptance,
        now: ACCEPTANCE_NOW,
      }),
      /must not already exist/,
    );
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("accepted salvage rejects wrong hashes, changed input, source drift, policy drift, and implementation drift", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const obsoletePath = writeObsoleteFixture({
      tempRoot,
      current,
      entries: [entry],
    });
    const diagnostic = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: obsoletePath,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    const exactAcceptance = acceptedSalvageArtifact(diagnostic);
    const acceptancePath = path.join(tempRoot, "acceptance/accepted.json");

    const staleHash = structuredClone(exactAcceptance);
    staleHash.bindings.diagnostic.evidenceSha256 = SHA_ONE;
    writeJson(acceptancePath, staleHash);
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /hash is stale or tampered/,
    );

    const policyDrift = structuredClone(exactAcceptance);
    policyDrift.bindings.current.validatorPolicySha256 = SHA_ONE;
    writeJson(acceptancePath, rehashAcceptance(policyDrift));
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /does not bind the exact current recomputation/,
    );

    const implementationDrift = structuredClone(exactAcceptance);
    implementationDrift.bindings.current.implementations[1].sha256 = SHA_ONE;
    writeJson(acceptancePath, rehashAcceptance(implementationDrift));
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /does not bind the exact current recomputation/,
    );

    writeJson(acceptancePath, exactAcceptance);
    const changedCurrent = makeCurrentFixture({
      tempRoot,
      source: makeSource("route:test", {
        title: "Start learning",
        subtitle: "Keep learning",
      }),
    });
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath,
        currentPlanningMaster: changedCurrent.master,
        baseSeedMemory: changedCurrent.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /does not bind the exact current recomputation/,
    );

    writeFileSync(
      obsoletePath,
      `${readFileSync(obsoletePath, "utf8")}\n`,
      "utf8",
    );
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /does not bind the exact current recomputation/,
    );
  });
});

test("acceptance authority, strict JSON, timestamp, and file-identity boundaries fail closed", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const obsoletePath = writeObsoleteFixture({
      tempRoot,
      current,
      entries: [entry],
    });
    const diagnostic = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: obsoletePath,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    const exactAcceptance = acceptedSalvageArtifact(diagnostic);
    const acceptancePath = path.join(tempRoot, "acceptance/accepted.json");

    const escalatedAuthority = structuredClone(exactAcceptance);
    Object.defineProperty(escalatedAuthority.authority, "canPromoteByItself", {
      configurable: true,
      enumerable: true,
      value: true,
      writable: true,
    });
    writeJson(acceptancePath, rehashAcceptance(escalatedAuthority));
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /Legacy seed salvage acceptance is malformed/,
    );

    for (const [acceptedAt, expiresAt, expected] of [
      [
        "2026-07-15T12:01:00.000Z",
        "2026-07-16T12:01:00.000Z",
        /future-dated/,
      ],
      [
        "2026-07-01T00:00:00.000Z",
        "2026-07-02T00:00:00.000Z",
        /has expired/,
      ],
      [
        "2026-07-15T11:59:00Z",
        "2026-07-16T11:59:00.000Z",
        /canonical UTC with millisecond precision/,
      ],
      [
        "2026-07-15T11:59:00.000Z",
        "2026-07-14T11:59:00.000Z",
        /expire after acceptance/,
      ],
      [
        "2026-07-15T11:59:00.000Z",
        "2026-08-16T11:59:00.000Z",
        /lifetime exceeds 31 days/,
      ],
    ] as const) {
      const timestampDrift = structuredClone(exactAcceptance);
      Object.defineProperty(timestampDrift, "acceptedAt", {
        configurable: true,
        enumerable: true,
        value: acceptedAt,
        writable: true,
      });
      Object.defineProperty(timestampDrift, "expiresAt", {
        configurable: true,
        enumerable: true,
        value: expiresAt,
        writable: true,
      });
      assert.throws(
        () => parseLegacyLongTailSeedSalvageAcceptance(
          rehashAcceptance(timestampDrift),
          ACCEPTANCE_NOW,
        ),
        expected,
      );
    }

    const exactJson = JSON.stringify(exactAcceptance, null, 2);
    const ambiguousJson = exactJson.replace(
      '"schemaVersion": 1,',
      '"schemaVersion": 1,\n  "schemaVersion": 1,',
    );
    writeFileSync(acceptancePath, `${ambiguousJson}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(acceptancePath, 0o600);
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /duplicate JSON key/i,
    );

    writeJson(acceptancePath, exactAcceptance);
    chmodSync(path.dirname(acceptancePath), 0o755);
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /current-owner mode-0700 directory/,
    );
    chmodSync(path.dirname(acceptancePath), 0o700);
    chmodSync(acceptancePath, 0o644);
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /current-owner mode 0600/,
    );
    chmodSync(acceptancePath, 0o600);
    const hardlinkPath = path.join(tempRoot, "acceptance/hardlinked.json");
    linkSync(acceptancePath, hardlinkPath);
    assert.throws(
      () => verifyAcceptedLegacyLongTailSeedSalvage({
        repoRoot: REPO_ROOT,
        obsoleteWorklistPath: obsoletePath,
        acceptancePath: hardlinkPath,
        currentPlanningMaster: current.master,
        baseSeedMemory: current.baseSeed,
        now: ACCEPTANCE_NOW,
      }),
      /single-link, regular file/,
    );
  });
});

test("the accepted-salvage barrier precedes runtime, materialization, import, and model-worker side effects", () => {
  withTempRoot((tempRoot) => {
    const current = makeCurrentFixture({ tempRoot });
    const entry = makeSeedEntry({
      language: "Spanish",
      locale: "es",
      source: "Start learning",
      value: "Empieza a aprender",
    });
    const obsoletePath = writeObsoleteFixture({
      tempRoot,
      current,
      entries: [entry],
    });
    const diagnostic = salvageLegacyLongTailSeedMemory({
      repoRoot: REPO_ROOT,
      obsoleteWorklistPath: obsoletePath,
      currentPlanningMaster: current.master,
      baseSeedMemory: current.baseSeed,
    });
    const acceptance = structuredClone(acceptedSalvageArtifact(diagnostic));
    acceptance.bindings.current.baseSeedMemorySha256 = SHA_ONE;
    const acceptancePath = path.join(tempRoot, "acceptance/invalid.json");
    writeJson(acceptancePath, rehashAcceptance(acceptance));
    const pathsBefore = listFixturePaths(tempRoot);
    let crossedExecutionBoundary = false;
    assert.throws(
      () => {
        verifyAcceptedLegacyLongTailSeedSalvage({
          repoRoot: REPO_ROOT,
          obsoleteWorklistPath: obsoletePath,
          acceptancePath,
          currentPlanningMaster: current.master,
          baseSeedMemory: current.baseSeed,
          now: ACCEPTANCE_NOW,
        });
        crossedExecutionBoundary = true;
      },
      /does not bind the exact current recomputation/,
    );
    assert.equal(crossedExecutionBoundary, false);
    assert.deepEqual(listFixturePaths(tempRoot), pathsBefore);

    const pipelineSource = readFileSync(
      path.join(REPO_ROOT, "scripts/generate-long-tail-translations.ts"),
      "utf8",
    );
    const pipelineStart = pipelineSource.indexOf(
      "async function runLongTailPipeline",
    );
    const barrier = pipelineSource.indexOf(
      "const accepted = verifyAcceptedLegacyLongTailSeedSalvage",
      pipelineStart,
    );
    assert.ok(pipelineStart >= 0 && barrier > pipelineStart);
    for (const sideEffectCall of [
      "const runtimePreflight = await runLongTailWorkerRuntimePreflight",
      "const materialized = materializeLongTailWorklists",
      "importExactLongTailCandidates({",
      "workerPlan.map((worker) => runLongTailWorker({",
    ]) {
      const sideEffect = pipelineSource.indexOf(sideEffectCall, barrier);
      assert.ok(
        sideEffect > barrier,
        `${sideEffectCall} must remain after accepted-salvage validation`,
      );
    }
    const semanticGate = pipelineSource.indexOf(
      "semanticAudit = options.stagedEnglishFallbackRelease",
      barrier,
    );
    const fullSemanticVerifier = pipelineSource.indexOf(
      "verifyTranslationSemanticAuditManifest({",
      semanticGate,
    );
    const stagedSemanticVerifier = pipelineSource.indexOf(
      "verifyAfrikaansTranslationSemanticAuditManifest({",
      semanticGate,
    );
    const promotionAcceptance = pipelineSource.indexOf(
      "const promotionAcceptance = verifyAcceptedLegacyLongTailSeedSalvage",
      semanticGate,
    );
    const promotion = pipelineSource.indexOf(
      "const promotion = promoteLongTailCandidateBatch",
      promotionAcceptance,
    );
    assert.ok(
      semanticGate > barrier &&
        fullSemanticVerifier > semanticGate &&
        stagedSemanticVerifier > semanticGate &&
        promotionAcceptance > fullSemanticVerifier &&
        promotionAcceptance > stagedSemanticVerifier &&
        promotionAcceptance > semanticGate &&
        promotion > promotionAcceptance,
      "promotion must retain both semantic verification and a fresh accepted-salvage check",
    );
  });
});
