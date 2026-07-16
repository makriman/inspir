import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { validateTranslationCandidateField } from "../lib/i18n/translation-candidate-quality";
import { isValidFieldTranslation } from "../lib/i18n/translation-field-validation";
import {
  afrikaansProductCopyHistoricalSource,
  inspectTranslationFieldFluency,
  isTranslationBundleCompleteAndFluent,
  isTranslationBundleFieldValid,
  isTranslationFieldLikelyFluent,
  translationEmbeddedSourcePhrases,
} from "../lib/i18n/translation-quality";
import {
  getSiteSourceHash,
  getSiteTranslationSource,
} from "../lib/i18n/site-source";
import {
  afrikaansCuratedGenerationSeedContract,
  assertLongTailExecutionSeedReadiness,
  buildLongTailMasterWorklist,
  calculateLongTailWorkload,
  classifyLongTailProductionInventoryState,
  composeLongTailEmbeddedSourcePhraseTranslations,
  createLongTailCandidate,
  createLongTailHistoricalTranslationSeedConsensus,
  createLongTailGenerationOverrides,
  createLongTailLocaleSmokeWorklist,
  createLongTailWorkerEnvironment,
  createLongTailSeedMemory,
  createLongTailSmokeWorklist,
  createLongTailPackWorklist,
  createLongTailWorkerPlan,
  createProductionLongTailInventory,
  hasExactLongTailInvariantParity,
  importExactLongTailCandidates,
  inspectLongTailCandidateRetryFailures,
  loadLongTailHistoricalTranslationSqlSeed,
  loadProductionLongTailHistoricalTranslationSqlSeedConsensus,
  LongTailPipelineError,
  LONG_TAIL_HISTORICAL_SQL_SEED_KIND,
  LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND,
  LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND,
  LONG_TAIL_WORKER_RUNTIME_PREFLIGHT_KIND,
  listPendingLongTailPackWorklists,
  materializeLongTailWorklists,
  parseLongTailCliOptions,
  parseLongTailMasterWorklist,
  PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
  publishExactLongTailFileForTest,
  promoteLongTailCandidateBatch,
  readStableBoundedLongTailJson,
  runLongTailWorkerRuntimePreflight as runBoundLongTailWorkerRuntimePreflight,
  validateLongTailCandidate,
  validateLongTailPromotionBatch,
  validateOrQuarantineLongTailCandidate,
  type LongTailInventory,
  type LongTailMasterWorklist,
  type LongTailPipelineProvenance,
  type LongTailSemanticPromotionAudit,
  type LongTailSeedMemory,
  type LongTailSourceStaleReplacementApproval,
  type LongTailTranslationJob,
} from "../scripts/generate-long-tail-translations";
import {
  assertCurrentLongTailReleaseRunRoot,
  LONG_TAIL_NLLB_EXECUTION_PROFILE,
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
  parseLongTailNllbExecutionProfile,
} from "../scripts/long-tail-nllb-execution-profile";
import {
  calculateLongTailValidatorPolicySha256,
  createLongTailValidatorPolicyProvenance,
  LONG_TAIL_VALIDATOR_POLICY_KIND,
  LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS,
} from "../scripts/translation-validator-policy-provenance";
import {
  readAndValidateLongTailPromotionJournal,
} from "../scripts/long-tail-promotion-snapshot";
import {
  calculateTranslationSemanticAuditTreeEvidence,
  calculateTranslationSemanticSiteSourceCatalogEvidence,
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
} from "../scripts/verify-translation-semantic-audit";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sha1(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("Fixture value cannot be represented as canonical JSON.");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${entries.map(([key, entry]) =>
      `${JSON.stringify(key)}:${canonicalJson(entry)}`
    ).join(",")}}`;
  }
  throw new Error(`Unsupported canonical JSON fixture type: ${typeof value}.`);
}

function sha256Canonical(value: unknown) {
  return sha256(canonicalJson(value));
}

const fixtureValidatorPolicyFiles = Object.freeze(
  LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS.map((relativePath) =>
    Object.freeze({
      relativePath,
      bytes: relativePath.length,
      sha256: sha256(relativePath),
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

const fixtureSeedMemory: LongTailSeedMemory = createLongTailSeedMemory({
  languages: Object.freeze(["Spanish" as const]),
  sources: Object.freeze([]),
  curatedRoot: path.join(os.tmpdir(), "inspir-no-curated-seed-fixture"),
});

test("local translation workers receive only an offline non-secret environment", () => {
  const environment = createLongTailWorkerEnvironment(
    LONG_TAIL_NLLB_EXECUTION_PROFILE,
    {
      HOME: "/safe/home",
      LANG: "en_GB.UTF-8",
      OMP_NUM_THREADS: "4",
      MKL_NUM_THREADS: "7",
      VECLIB_MAXIMUM_THREADS: "9",
      PYTORCH_ENABLE_MPS_FALLBACK: "1",
      PATH: "/safe/bin",
      AUTH_SECRET: "must-not-reach-model-worker",
      CLOUDFLARE_API_TOKEN: "must-not-reach-model-worker",
      HISTORICAL_DATA_PRESERVATION_HMAC_SECRET:
        "must-not-reach-model-worker",
      OPENAI_API_KEY: "must-not-reach-model-worker",
    },
  );

  assert.deepEqual(environment, {
    HOME: "/safe/home",
    LANG: "en_GB.UTF-8",
    NODE_ENV: "production",
    PATH: "/safe/bin",
    OMP_NUM_THREADS: "1",
    MKL_NUM_THREADS: "1",
    VECLIB_MAXIMUM_THREADS: "1",
    PYTORCH_ENABLE_MPS_FALLBACK: "0",
    HF_DATASETS_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    HF_HUB_OFFLINE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONHASHSEED: "0",
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    TOKENIZERS_PARALLELISM: "false",
    TRANSFORMERS_OFFLINE: "1",
  });
  assert.equal("AUTH_SECRET" in environment, false);
  assert.equal("CLOUDFLARE_API_TOKEN" in environment, false);
  assert.equal(
    "HISTORICAL_DATA_PRESERVATION_HMAC_SECRET" in environment,
    false,
  );
  assert.equal("OPENAI_API_KEY" in environment, false);
});

test("local NLLB execution profile is exact, pipeline-bound, and tamper-evident", () => {
  assert.equal(
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
    "807a3bc739832f9a199618731b007dae93a8053027b971e0715e4f9ea550db8b",
  );
  assert.equal(
    LONG_TAIL_NLLB_EXECUTION_PROFILE.pipelineVersion,
    LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
  );
  assert.equal(
    parseLongTailNllbExecutionProfile(LONG_TAIL_NLLB_EXECUTION_PROFILE),
    LONG_TAIL_NLLB_EXECUTION_PROFILE,
  );
  assert.throws(
    () => parseLongTailNllbExecutionProfile({
      ...LONG_TAIL_NLLB_EXECUTION_PROFILE,
      pipelineVersion: "inspir-long-tail-local-nllb-v3",
    }),
  );
  assert.throws(
    () => parseLongTailNllbExecutionProfile({
      ...LONG_TAIL_NLLB_EXECUTION_PROFILE,
      environment: {
        ...LONG_TAIL_NLLB_EXECUTION_PROFILE.environment,
        OMP_NUM_THREADS: "2",
      },
    }),
  );
  assert.throws(
    () => parseLongTailNllbExecutionProfile({
      ...LONG_TAIL_NLLB_EXECUTION_PROFILE,
      terminalRescue: {
        ...LONG_TAIL_NLLB_EXECUTION_PROFILE.terminalRescue,
        independentDecodes: 1,
      },
    }),
  );
  const {
    executionProfileSha256: _executionProfileSha256,
    ...missingDigest
  } = LONG_TAIL_NLLB_EXECUTION_PROFILE;
  assert.equal(
    _executionProfileSha256,
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  );
  assert.throws(() => parseLongTailNllbExecutionProfile(missingDigest));
});

test("local NLLB worker establishes thread limits before runtime-library imports", () => {
  const worker = readFileSync(
    path.join(process.cwd(), "scripts/generate-long-tail-translations-worker.py"),
    "utf8",
  );
  const preflight = readFileSync(
    path.join(process.cwd(), "scripts/generate-long-tail-translations.ts"),
    "utf8",
  );
  assert.ok(worker.indexOf("for _environment_name") < worker.indexOf("import torch"));
  assert.ok(worker.indexOf("torch.set_num_threads") < worker.indexOf("from transformers"));
  assert.ok(
    preflight.indexOf("Runtime preflight inherited environment") <
      preflight.indexOf('torch = importlib.import_module("torch")'),
  );
  assert.ok(
    preflight.indexOf("torch.set_num_interop_threads") <
      preflight.indexOf('modules[name] = importlib.import_module(name)'),
  );
});

test("pre-v10 translation run roots are never accepted as release evidence", () => {
  assert.doesNotThrow(() =>
    assertCurrentLongTailReleaseRunRoot(
      "tmp/long-tail-translation-pipeline-v10-af-smoke",
    )
  );
  assert.doesNotThrow(() =>
    assertCurrentLongTailReleaseRunRoot("tmp/translation-fresh")
  );
  for (const runRoot of [
    "tmp/translation-v9",
    "tmp/long-tail-translation-pipeline-v9",
    "tmp/long-tail-translation-pipeline-v9-af-smoke",
    "tmp/long-tail-translation-smoke-af-v8",
    "tmp/long-tail-translation-pipeline-v3-rehashed",
  ]) {
    assert.throws(
      () => assertCurrentLongTailReleaseRunRoot(runRoot),
      /pre-v10 evidence/,
    );
    assert.throws(
      () => parseLongTailCliOptions(["--run-dir", runRoot]),
      /pre-v10 evidence/,
    );
  }
});

function fixtureProvenance(
  seedMemory = fixtureSeedMemory,
): LongTailPipelineProvenance {
  const generationOverrides = createLongTailGenerationOverrides(seedMemory);
  return Object.freeze({
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
    protectorVersion: "inspir-long-tail-literal-protector-v1",
    protectorSha256: sha256("protector"),
    pipelineImplementationSha256: sha256("pipeline"),
    workerImplementationSha256: sha256("worker"),
    validatorPolicy: fixtureValidatorPolicy,
    modelLabel: "fixture-local-model",
    modelSha256: sha256("model"),
    seedMemorySha256: seedMemory.seedMemorySha256,
    seedMemoryEntries: seedMemory.entries.length,
    seedMemoryConflicts: seedMemory.conflicts.length,
    generationOverridesSha256:
      generationOverrides.generationOverridesSha256,
    generationOverrideEntries: generationOverrides.entries.length,
    generationConfig: Object.freeze({
      batchSize: 2,
      numBeams: 1,
      noRepeatNgramSize: 0,
      dtype: "float32",
      device: "cpu",
      maxSourceTokens: 512,
      maxNewTokens: 512,
      maxRetryAttempts: 2,
      deterministicAlgorithms: true,
      manualSeed: 0,
    }),
  });
}

function temporaryDirectory(t: test.TestContext) {
  const directory = mkdtempSync(
    path.join(realpathSync(os.tmpdir()), "inspir-long-tail-pipeline-"),
  );
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

const runtimePreflightModuleNames = Object.freeze([
  "numpy",
  "safetensors",
  "sentencepiece",
  "tokenizers",
  "torch",
  "transformers",
] as const);

function runtimeGenerationConfig(
  device: "auto" | "cpu" | "mps",
  dtype: "float16" | "float32",
) {
  return Object.freeze({
    device,
    dtype,
    deterministicAlgorithms: true as const,
    manualSeed: 0 as const,
  });
}

function runLongTailWorkerRuntimePreflight(
  input: Omit<
    Parameters<typeof runBoundLongTailWorkerRuntimePreflight>[0],
    "executionProfile"
  >,
) {
  return runBoundLongTailWorkerRuntimePreflight({
    ...input,
    executionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
  });
}

function runtimePreflightFixture(t: test.TestContext) {
  const root = temporaryDirectory(t);
  const virtualEnvironment = path.join(root, "venv");
  const sitePackages = path.join(
    virtualEnvironment,
    "lib/python3.9/site-packages",
  );
  const python = path.join(virtualEnvironment, "bin/python");
  const modelDirectory = path.join(root, "model");
  mkdirSync(path.dirname(python), { recursive: true });
  mkdirSync(sitePackages, { recursive: true });
  mkdirSync(modelDirectory, { recursive: true });
  const origins = Object.fromEntries(
    runtimePreflightModuleNames.map((name) => {
      const origin = path.join(sitePackages, name, "__init__.py");
      mkdirSync(path.dirname(origin), { recursive: true });
      writeFileSync(origin, "# fixture\n", "utf8");
      return [name, realpathSync(origin)];
    }),
  );
  const report = {
    schemaVersion: 2,
    kind: LONG_TAIL_WORKER_RUNTIME_PREFLIGHT_KIND,
    executionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
    observedEnvironment: LONG_TAIL_NLLB_EXECUTION_PROFILE.environment,
    torchThreads: LONG_TAIL_NLLB_EXECUTION_PROFILE.torch,
    pythonImplementation: "CPython",
    pythonVersion: "3.9.6",
    machine: "arm64",
    userSiteEnabled: false,
    sitePackages: realpathSync(sitePackages),
    versions: {
      numpy: "1.26.4",
      safetensors: "0.7.0",
      sentencepiece: "0.2.1",
      tokenizers: "0.20.3",
      torch: "2.2.2",
      transformers: "4.46.3",
    },
    origins,
    mpsBuilt: false,
    mpsAvailable: false,
    primaryDeterminism: {
      deterministicAlgorithms: true,
      warnOnly: false,
      manualSeed: 0,
    },
    modelSmoke: { performed: false },
  };
  const writeRuntime = (stdout: string, options: {
    stderr?: string;
    exitCode?: number;
    delaySeconds?: number;
  } = {}) => {
    const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
    writeFileSync(
      python,
      [
        "#!/bin/sh",
        'if [ "${AUTH_SECRET+x}" = "x" ]; then exit 97; fi',
        '[ "${OMP_NUM_THREADS-}" = "1" ] || exit 96',
        '[ "${MKL_NUM_THREADS-}" = "1" ] || exit 95',
        '[ "${VECLIB_MAXIMUM_THREADS-}" = "1" ] || exit 94',
        '[ "${PYTORCH_ENABLE_MPS_FALLBACK-}" = "0" ] || exit 93',
        ...(options.delaySeconds
          ? [`sleep ${options.delaySeconds}`]
          : []),
        ...(options.stderr
          ? [`printf '%s\\n' ${shellQuote(options.stderr)} >&2`]
          : []),
        ...(stdout
          ? [`printf '%s\\n' ${shellQuote(stdout)}`]
          : []),
        `exit ${options.exitCode ?? 0}`,
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    chmodSync(python, 0o700);
  };
  writeRuntime(JSON.stringify(report));
  return { root, python, modelDirectory, sitePackages, report, writeRuntime };
}

test("long-tail runtime preflight accepts only the sanitized pinned venv report", async (t) => {
  const fixture = runtimePreflightFixture(t);
  const result = await runLongTailWorkerRuntimePreflight({
    python: fixture.python,
    modelDirectory: fixture.modelDirectory,
    generationConfig: runtimeGenerationConfig("cpu", "float32"),
    parentEnvironment: {
      PATH: process.env.PATH,
      AUTH_SECRET: "must-not-reach-runtime-preflight",
      OMP_NUM_THREADS: "99",
      MKL_NUM_THREADS: "99",
      VECLIB_MAXIMUM_THREADS: "99",
      PYTORCH_ENABLE_MPS_FALLBACK: "1",
    },
    cwd: fixture.root,
  });
  assert.equal(result.kind, LONG_TAIL_WORKER_RUNTIME_PREFLIGHT_KIND);
  assert.deepEqual(result.executionProfile, LONG_TAIL_NLLB_EXECUTION_PROFILE);
  assert.deepEqual(
    result.observedEnvironment,
    LONG_TAIL_NLLB_EXECUTION_PROFILE.environment,
  );
  assert.deepEqual(result.torchThreads, LONG_TAIL_NLLB_EXECUTION_PROFILE.torch);
  assert.deepEqual(result.primaryDeterminism, {
    deterministicAlgorithms: true,
    warnOnly: false,
    manualSeed: 0,
  });
  assert.equal(result.versions.torch, "2.2.2");
  assert.equal(result.modelSmoke.performed, false);
});

test("long-tail runtime preflight rejects old, missing, or drifted profile evidence", async (t) => {
  const fixture = runtimePreflightFixture(t);
  const assertMalformed = async (report: unknown) => {
    fixture.writeRuntime(JSON.stringify(report));
    await assert.rejects(
      runLongTailWorkerRuntimePreflight({
        python: fixture.python,
        modelDirectory: fixture.modelDirectory,
        generationConfig: runtimeGenerationConfig("cpu", "float32"),
        cwd: fixture.root,
      }),
      /malformed attestation record/,
    );
  };

  await assertMalformed({ ...fixture.report, schemaVersion: 1 });
  const {
    observedEnvironment: _observedEnvironment,
    ...missingEnvironment
  } = fixture.report;
  assert.deepEqual(
    _observedEnvironment,
    LONG_TAIL_NLLB_EXECUTION_PROFILE.environment,
  );
  await assertMalformed(missingEnvironment);
  await assertMalformed({
    ...fixture.report,
    observedEnvironment: {
      ...fixture.report.observedEnvironment,
      OMP_NUM_THREADS: "8",
    },
  });
  await assertMalformed({
    ...fixture.report,
    torchThreads: {
      ...fixture.report.torchThreads,
      interopThreads: 2,
    },
  });
  await assertMalformed({
    ...fixture.report,
    primaryDeterminism: {
      ...fixture.report.primaryDeterminism,
      warnOnly: true,
    },
  });
  await assertMalformed({
    ...fixture.report,
    executionProfile: {
      ...fixture.report.executionProfile,
      executionProfileSha256: "f".repeat(64),
    },
  });
});

test("real runtime preflight source rejects inherited environment tamper before imports", async (t) => {
  const fixture = runtimePreflightFixture(t);
  const writeTamperingWrapper = (command: string) => {
    writeFileSync(
      fixture.python,
      `#!/bin/sh\n${command}\nexec python3 "$@"\n`,
      { mode: 0o700 },
    );
    chmodSync(fixture.python, 0o700);
  };
  for (const command of [
    "unset OMP_NUM_THREADS",
    "export OMP_NUM_THREADS=8",
  ]) {
    writeTamperingWrapper(command);
    await assert.rejects(
      runLongTailWorkerRuntimePreflight({
        python: fixture.python,
        modelDirectory: fixture.modelDirectory,
        generationConfig: runtimeGenerationConfig("cpu", "float32"),
        parentEnvironment: { PATH: process.env.PATH },
        cwd: fixture.root,
      }),
      /Runtime preflight inherited environment is missing or drifted/,
    );
  }
});

test("long-tail runtime preflight reproduces sanitized import failure and rejects malformed evidence", async (t) => {
  const fixture = runtimePreflightFixture(t);
  fixture.writeRuntime("", {
    stderr: "ModuleNotFoundError: No module named 'torch'",
    exitCode: 1,
  });
  await assert.rejects(
    runLongTailWorkerRuntimePreflight({
      python: fixture.python,
      modelDirectory: fixture.modelDirectory,
      generationConfig: runtimeGenerationConfig("cpu", "float32"),
      cwd: fixture.root,
    }),
    /No module named 'torch'/,
  );

  fixture.writeRuntime("not-json");
  await assert.rejects(
    runLongTailWorkerRuntimePreflight({
      python: fixture.python,
      modelDirectory: fixture.modelDirectory,
      generationConfig: runtimeGenerationConfig("cpu", "float32"),
      cwd: fixture.root,
    }),
    /malformed JSON/,
  );
});

test("long-tail runtime preflight rejects version, origin, MPS, and timeout drift", async (t) => {
  const fixture = runtimePreflightFixture(t);
  fixture.writeRuntime(JSON.stringify({
    ...fixture.report,
    versions: { ...fixture.report.versions, torch: "2.2.3" },
  }));
  await assert.rejects(
    runLongTailWorkerRuntimePreflight({
      python: fixture.python,
      modelDirectory: fixture.modelDirectory,
      generationConfig: runtimeGenerationConfig("cpu", "float32"),
      cwd: fixture.root,
    }),
    /torch version drifted/,
  );

  const outsideOrigin = path.join(fixture.root, "ambient-torch.py");
  writeFileSync(outsideOrigin, "# ambient fixture\n", "utf8");
  fixture.writeRuntime(JSON.stringify({
    ...fixture.report,
    origins: {
      ...fixture.report.origins,
      torch: realpathSync(outsideOrigin),
    },
  }));
  await assert.rejects(
    runLongTailWorkerRuntimePreflight({
      python: fixture.python,
      modelDirectory: fixture.modelDirectory,
      generationConfig: runtimeGenerationConfig("cpu", "float32"),
      cwd: fixture.root,
    }),
    /torch origin is not a regular file inside the pinned venv/,
  );

  fixture.writeRuntime(JSON.stringify(fixture.report));
  await assert.rejects(
    runLongTailWorkerRuntimePreflight({
      python: fixture.python,
      modelDirectory: fixture.modelDirectory,
      generationConfig: runtimeGenerationConfig("mps", "float16"),
      cwd: fixture.root,
    }),
    /MPS was requested but is unavailable/,
  );

  fixture.writeRuntime("", { delaySeconds: 2 });
  await assert.rejects(
    runLongTailWorkerRuntimePreflight({
      python: fixture.python,
      modelDirectory: fixture.modelDirectory,
      generationConfig: runtimeGenerationConfig("cpu", "float32"),
      timeoutMilliseconds: 20,
      cwd: fixture.root,
    }),
    /timed out after 20ms/,
  );
});

test("long-tail runtime preflight binds model-smoke evidence to the requested device and dtype", async (t) => {
  const fixture = runtimePreflightFixture(t);
  const performedModelSmoke = {
    performed: true,
    device: "cpu",
    dtype: "float32",
    deterministicAlgorithms: true,
    manualSeed: 0,
    eosObserved: true,
    generatedTokens: 4,
    outputSha256: "a".repeat(64),
  } as const;
  fixture.writeRuntime(JSON.stringify({
    ...fixture.report,
    mpsBuilt: true,
    mpsAvailable: true,
    modelSmoke: performedModelSmoke,
  }));
  await assert.rejects(
    runLongTailWorkerRuntimePreflight({
      python: fixture.python,
      modelDirectory: fixture.modelDirectory,
      generationConfig: runtimeGenerationConfig("mps", "float16"),
      modelSmoke: true,
      cwd: fixture.root,
    }),
    /device or dtype evidence does not match the requested runtime/,
  );

  fixture.writeRuntime(JSON.stringify({
    ...fixture.report,
    mpsBuilt: true,
    mpsAvailable: true,
    modelSmoke: {
      ...performedModelSmoke,
      device: "mps",
      dtype: "float16",
    },
  }));
  const report = await runLongTailWorkerRuntimePreflight({
    python: fixture.python,
    modelDirectory: fixture.modelDirectory,
    generationConfig: runtimeGenerationConfig("auto", "float16"),
    modelSmoke: true,
    cwd: fixture.root,
  });
  assert.equal(report.modelSmoke.performed, true);
  if (report.modelSmoke.performed) {
    assert.equal(report.modelSmoke.device, "mps");
    assert.equal(report.modelSmoke.dtype, "float16");
  }
});

test("long-tail runtime preflight kills probes that exceed the output bound", async (t) => {
  const fixture = runtimePreflightFixture(t);
  fixture.writeRuntime("x".repeat(70 * 1_024));
  await assert.rejects(
    runLongTailWorkerRuntimePreflight({
      python: fixture.python,
      modelDirectory: fixture.modelDirectory,
      generationConfig: runtimeGenerationConfig("cpu", "float32"),
      cwd: fixture.root,
    }),
    /exceeded its bounded output limit/,
  );
});

test("bounded long-tail JSON reads reject FIFO, growth, replacement, and duplicate keys", (t) => {
  const root = temporaryDirectory(t);
  const jsonPath = path.join(root, "input.json");
  writeFileSync(jsonPath, '{"value":"stable"}\n');
  assert.deepEqual(
    readStableBoundedLongTailJson({ file: jsonPath }),
    { value: "stable" },
  );

  assert.throws(
    () => readStableBoundedLongTailJson({
      file: jsonPath,
      raceHook: (point) => {
        if (point === "after-open-before-read") {
          writeFileSync(jsonPath, " ", { flag: "a" });
        }
      },
    }),
    /grew while it was read|changed while it was read/,
  );

  writeFileSync(jsonPath, '{"value":"stable"}\n');
  const priorPath = `${jsonPath}.prior`;
  assert.throws(
    () => readStableBoundedLongTailJson({
      file: jsonPath,
      raceHook: (point) => {
        if (point === "after-open-before-read") {
          renameSync(jsonPath, priorPath);
          writeFileSync(jsonPath, '{"value":"replacement"}\n');
        }
      },
    }),
    /changed while it was read/,
  );

  writeFileSync(jsonPath, '{"value":1,"value":2}\n');
  assert.throws(
    () => readStableBoundedLongTailJson({ file: jsonPath }),
    /duplicate JSON key/i,
  );

  const realParent = path.join(root, "real-parent");
  mkdirSync(realParent);
  writeFileSync(path.join(realParent, "linked.json"), '{"safe":true}\n');
  const linkedParent = path.join(root, "linked-parent");
  symlinkSync(realParent, linkedParent, "dir");
  assert.throws(
    () => readStableBoundedLongTailJson({
      file: path.join(linkedParent, "linked.json"),
    }),
    /symbolic-link component/,
  );

  if (process.platform !== "win32") {
    const fifoPath = path.join(root, "input.fifo");
    execFileSync("mkfifo", [fifoPath]);
    assert.throws(
      () => readStableBoundedLongTailJson({ file: fifoPath }),
      /bounded single-link regular file/,
    );
  }
});

test("exact publication gives only the master worklist the 160 MiB replay bound", (t) => {
  const root = temporaryDirectory(t);
  const largeMasterPath = path.join(root, "worklist.json");
  const largeMasterBytes = Buffer.alloc(68 * 1024 * 1024, 0x20);
  writeFileSync(largeMasterPath, largeMasterBytes);
  assert.equal(
    publishExactLongTailFileForTest({
      file: largeMasterPath,
      bytes: largeMasterBytes,
      maximumExistingBytes: 160 * 1024 * 1024,
    }),
    "exact-replay",
  );

  const ordinaryPath = path.join(root, "ordinary.json");
  writeFileSync(ordinaryPath, "{}");
  truncateSync(ordinaryPath, 64 * 1024 * 1024 + 1);
  assert.throws(
    () => publishExactLongTailFileForTest({
      file: ordinaryPath,
      bytes: Buffer.from("{}"),
    }),
    /bounded single-link regular file/,
  );

  assert.throws(
    () => publishExactLongTailFileForTest({
      file: path.join(root, "invalid-bound.json"),
      bytes: Buffer.from("{}"),
      maximumExistingBytes: 160 * 1024 * 1024 + 1,
    }),
    /Publication target byte bound is invalid/,
  );
});

function fixtureInventory(root: string): LongTailInventory {
  return Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot: path.join(root, "curated"),
    sources: Object.freeze([
      Object.freeze({
        namespace: "test:one",
        sourceHash: sha256("test-source-one"),
        sourceStrings: Object.freeze({
          first:
            "Start learning with {count} lessons at https://example.com in 2026.",
        }),
      }),
      Object.freeze({
        namespace: "test:two",
        sourceHash: sha256("test-source-two"),
        sourceStrings: Object.freeze({
          second: "Save your progress in <strong>inspir</strong>.",
        }),
      }),
    ]),
  });
}

function fixtureValues(job: LongTailTranslationJob) {
  if (job.namespace === "test:one") {
    return Object.freeze({
      first:
        "Empieza a aprender con {count} lecciones en https://example.com en 2026.",
    });
  }
  return Object.freeze({
    second: "Guarda tu progreso en <strong>inspir</strong>.",
  });
}

function writeSyntheticCuratedPack(input: {
  curatedRoot: string;
  locale: string;
  namespace: string;
  value: unknown;
}) {
  const file = path.join(
    input.curatedRoot,
    input.locale,
    `${input.namespace.replace(/[^a-z0-9.-]+/gi, "__")}.json`,
  );
  const bytes = Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`, "utf8");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes, { mode: 0o600 });
  return Object.freeze({ file, bytes, sha256: sha256(bytes.toString("utf8")) });
}

function historicalSqlFixtureDirectory(t: test.TestContext) {
  const fixtureRoot = path.join(
    process.cwd(),
    "tmp/cloudflare-reports/cloudflare",
  );
  mkdirSync(fixtureRoot, { recursive: true });
  const directory = mkdtempSync(
    path.join(fixtureRoot, "long-tail-seed-test-"),
  );
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function quoteSqliteString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function historicalAppTranslationInsert(input: {
  namespace: string;
  language?: string;
  sourceHash: string;
  payloadJson: string;
  model?: string;
  createdAt?: number | null;
  updatedAt?: number | null;
}) {
  const timestamp = (value: number | null | undefined) =>
    value === null ? "NULL" : String(value ?? 1_781_386_350_783);
  return [
    'INSERT INTO "app_translations" ("namespace","language","source_hash","payload","model","created_at","updated_at") VALUES(',
    quoteSqliteString(input.namespace),
    ",",
    quoteSqliteString(input.language ?? "Spanish"),
    ",",
    quoteSqliteString(input.sourceHash),
    ",",
    quoteSqliteString(input.payloadJson),
    ",",
    quoteSqliteString(input.model ?? "curated-codex-v1"),
    ",",
    timestamp(input.createdAt),
    ",",
    timestamp(input.updatedAt),
    ");",
  ].join("");
}

function historicalSourceInsert(input: {
  namespace: string;
  sourceHash: string;
}) {
  return [
    'INSERT INTO "app_translation_sources" ("namespace","source_hash","updated_at") VALUES(',
    quoteSqliteString(input.namespace),
    ",",
    quoteSqliteString(input.sourceHash),
    ",1781386350783);",
  ].join("");
}

function historicalSourceStringInsert(input: {
  namespace: string;
  key: string;
  source: string;
}) {
  return [
    'INSERT INTO "app_translation_source_strings" ("namespace","source_key","source_text") VALUES(',
    quoteSqliteString(input.namespace),
    ",",
    quoteSqliteString(input.key),
    ",",
    quoteSqliteString(input.source),
    ");",
  ].join("");
}

function writeHistoricalSqlFixture(input: {
  directory: string;
  filename: string;
  lines: readonly string[];
  mode?: number;
}) {
  const sqlPath = path.join(input.directory, input.filename);
  const bytes = Buffer.from(`${input.lines.join("\n")}\n`, "utf8");
  writeFileSync(sqlPath, bytes, { mode: input.mode ?? 0o600 });
  chmodSync(sqlPath, input.mode ?? 0o600);
  return Object.freeze({
    bytes,
    sqlPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function sourceStaleApproval(input: {
  namespace: string;
  priorSourceHash: string;
  newSourceHash: string;
}): LongTailSourceStaleReplacementApproval {
  return Object.freeze({
    language: "Spanish",
    namespace: input.namespace,
    priorSourceHash: input.priorSourceHash,
    newSourceHash: input.newSourceHash,
  });
}

function writeCandidate(input: {
  master: LongTailMasterWorklist;
  job: LongTailTranslationJob;
  candidateRoot: string;
  values?: Readonly<Record<string, string>>;
}) {
  const pack = createLongTailPackWorklist({
    master: input.master,
    job: input.job,
  });
  const candidate = createLongTailCandidate({
    pack,
    values: input.values ?? fixtureValues(input.job),
  });
  const candidatePath = path.join(
    input.candidateRoot,
    input.job.candidateRelativePath,
  );
  mkdirSync(path.dirname(candidatePath), { recursive: true });
  writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { candidate, candidatePath, pack };
}

function semanticPromotionAuditFixture(input: {
  master: LongTailMasterWorklist;
  runDirectory: string;
  curatedRoot: string;
}): LongTailSemanticPromotionAudit {
  mkdirSync(input.curatedRoot, { recursive: true });
  const candidateRoot = path.join(input.runDirectory, "candidates");
  const worklistRoot = path.join(input.runDirectory, "worklists");
  const curated = calculateTranslationSemanticAuditTreeEvidence({
    root: input.curatedRoot,
    ignoreMainAppWorkbench: true,
  });
  const staticMainAppRoot = path.join(
    path.dirname(input.curatedRoot),
    "static-main-app",
  );
  mkdirSync(staticMainAppRoot, { recursive: true });
  writeJson(path.join(staticMainAppRoot, "af.json"), { tracked: true });
  const staticMainApp = calculateTranslationSemanticAuditTreeEvidence({
    root: staticMainAppRoot,
  });
  const candidates = calculateTranslationSemanticAuditTreeEvidence({
    root: candidateRoot,
  });
  const packWorklists = calculateTranslationSemanticAuditTreeEvidence({
    root: worklistRoot,
  });
  const workspaceRoot = path.dirname(path.dirname(input.curatedRoot));
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
    `// Synthetic pipeline fixture.\nexport const siteSourceManifest = ${
      JSON.stringify(siteSources, null, 2)
    } as const;\n`,
  );
  const siteSourceCatalog =
    calculateTranslationSemanticSiteSourceCatalogEvidence({ workspaceRoot });
  const modelLockSha256 = sha256CanonicalTranslationAuditJson({
    ...TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
    runtimeVersions: TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
  });
  const emptyAfrikaansEvidenceRoot =
    sha256CanonicalTranslationAuditJson([]);
  const material = {
    schemaVersion: 2 as const,
    kind: TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
    manifestSha256: sha256("fixture-semantic-manifest"),
    masterWorklistSha256: input.master.worklistSha256,
    generatorExecutionProfile: input.master.provenance.executionProfile,
    generatorExecutionProfileSha256:
      input.master.provenance.executionProfile.executionProfileSha256,
    auditVersion: TRANSLATION_SEMANTIC_AUDIT_VERSION,
    auditPolicySha256: sha256CanonicalTranslationAuditJson(
      TRANSLATION_SEMANTIC_AUDIT_POLICY,
    ),
    auditImplementationSha256: sha256("fixture-auditor"),
    verifierImplementationSha256: sha256("fixture-verifier"),
    modelLockSha256,
    modelDigests: TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
    runtimeVersions: TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
    scope: {
      locales: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length,
      namespaces: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
      packs: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      fields: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      candidatePacks: input.master.jobs.length,
      curatedPacks:
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT - input.master.jobs.length,
    },
    inputTrees: { curated, staticMainApp, candidates, packWorklists },
    siteSourceCatalog,
    packIdentityRootSha256: sha256("fixture-pack-identities"),
    packEvidenceRootSha256: sha256("fixture-pack-evidence"),
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
      checkpointRootPath:
        "tmp/translation-v10/.semantic-audit-full.json.checkpoints",
      sessionSha256: sha256("fixture-checkpoint-session"),
      sessionRecordSha256: sha256("fixture-checkpoint-session-record"),
      sessionFileSha256: sha256("fixture-checkpoint-session-file"),
      checkpointCount: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      terminalCheckpointSha256: sha256("fixture-checkpoint-terminal"),
      checkpointChainRootSha256: sha256("fixture-checkpoint-chain"),
      packRescueRecordCount: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
      packRescueRecordRootSha256: sha256("fixture-checkpoint-rescues"),
      fieldPairRescuedFields: 0,
      trackedCuratedRescuedFields: 0,
    },
  };
  const promotionEvidence = translationSemanticPromotionEvidenceSchema.parse({
    ...material,
    semanticEvidenceSha256:
      sha256CanonicalTranslationAuditJson(material),
  });
  return Object.freeze({
    masterWorklistSha256: input.master.worklistSha256,
    promotionEvidence,
    manifest: Object.freeze({
      results: Object.freeze({
        packBindings: Object.freeze(input.master.jobs.map((job) => {
          const candidatePath = path.join(candidateRoot, job.candidateRelativePath);
          return Object.freeze({
            locale: job.locale,
            namespace: job.namespace,
            origin: "candidate" as const,
            packFileSha256: createHash("sha256")
              .update(readFileSync(candidatePath))
              .digest("hex"),
          });
        })),
      }),
    }),
  });
}

function stagedAfrikaansPromotionAuditFixture(input: {
  master: LongTailMasterWorklist;
  runDirectory: string;
  curatedRoot: string;
}): LongTailSemanticPromotionAudit {
  const full = semanticPromotionAuditFixture(input);
  const fullEvidence = full.promotionEvidence;
  assert.equal(
    fullEvidence.kind,
    TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  );
  const material = {
    ...Object.fromEntries(
      Object.entries(fullEvidence).filter(
        ([key]) => key !== "semanticEvidenceSha256",
      ),
    ),
    schemaVersion: 1,
    kind: AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
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
    checkpointEvidence: {
      ...fullEvidence.checkpointEvidence,
      checkpointRootPath:
        "tmp/translation-v10/.semantic-audit-afrikaans-smoke.json.checkpoints",
      checkpointCount:
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
      packRescueRecordCount:
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
    },
  };
  const promotionEvidence =
    afrikaansTranslationSemanticPromotionEvidenceSchema.parse({
      ...material,
      semanticEvidenceSha256:
        sha256CanonicalTranslationAuditJson(material),
    });
  return Object.freeze({
    ...full,
    promotionEvidence,
  });
}

test("historical SQL seed loader accepts only a trusted strict translation snapshot", (t) => {
  const directory = historicalSqlFixtureDirectory(t);
  const namespace = "route:learner's-guide";
  const sourceHash = sha256("historical-source");
  const payload = {
    headline: "¿Qué te da curiosidad hoy?",
  };
  const fixture = writeHistoricalSqlFixture({
    directory,
    filename: "trusted-seed.sql",
    lines: [
      "PRAGMA foreign_keys=OFF;",
      "BEGIN TRANSACTION;",
      "-- Non-INSERT dump boilerplate is intentionally ignored.",
      'CREATE TABLE "app_translations" ("namespace" TEXT);',
      historicalSourceInsert({ namespace, sourceHash }),
      historicalSourceStringInsert({
        namespace,
        key: "headline",
        source: "What's next?",
      }),
      historicalAppTranslationInsert({
        namespace,
        sourceHash,
        payloadJson: JSON.stringify(payload),
        createdAt: null,
      }),
      "COMMIT;",
    ],
  });

  const seed = loadLongTailHistoricalTranslationSqlSeed({
    repoRoot: process.cwd(),
    sqlPath: fixture.sqlPath,
    trustedSha256s: [fixture.sha256],
    expectedAppTranslationRows: 1,
    expectedSourceRows: 1,
    expectedSourceStringRows: 1,
  });
  assert.deepEqual(seed.evidence, {
    kind: LONG_TAIL_HISTORICAL_SQL_SEED_KIND,
    selectionPolicy: "single-snapshot",
    bytes: fixture.bytes.length,
    sha256: fixture.sha256,
    supportingSnapshotSha256s: [],
    excludedNonConsensusPayloadFields: 0,
    excludedNonConsensusSourceStrings: 0,
    appTranslationRows: 1,
    appTranslationSourceRows: 1,
    appTranslationSourceStringRows: 1,
    languages: 1,
    namespaces: 1,
  });
  assert.deepEqual(seed.rows.get(`Spanish\u0000${namespace}`), {
    namespace,
    language: "Spanish",
    sourceHash,
    payload,
    model: "curated-codex-v1",
  });
  assert.deepEqual(seed.sources.get(namespace), { namespace, sourceHash });
  assert.deepEqual(
    Object.fromEntries(seed.sourceStrings.get(namespace) ?? []),
    { headline: "What's next?" },
  );
  assert.throws(
    () => loadLongTailHistoricalTranslationSqlSeed({
      repoRoot: process.cwd(),
      sqlPath: fixture.sqlPath,
      trustedSha256s: ["0".repeat(64)],
      expectedAppTranslationRows: 1,
    }),
    /does not match the extractor-audited digest allowlist/,
  );
  assert.throws(
    () => loadProductionLongTailHistoricalTranslationSqlSeedConsensus({
      repoRoot: process.cwd(),
      primarySqlPath: fixture.sqlPath,
    }),
    /does not match the extractor-audited digest allowlist/,
  );
});

test("historical snapshot consensus retains only exact payload and source-string values", (t) => {
  const directory = historicalSqlFixtureDirectory(t);
  const namespace = "route:consensus";
  const sourceHash = sha256("consensus-source");
  const loadSnapshot = (input: {
    filename: string;
    sourceStrings: Readonly<Record<string, string>>;
    payload: Readonly<Record<string, string>>;
  }) => {
    const fixture = writeHistoricalSqlFixture({
      directory,
      filename: input.filename,
      lines: [
        historicalSourceInsert({ namespace, sourceHash }),
        ...Object.entries(input.sourceStrings).map(([key, source]) =>
          historicalSourceStringInsert({ namespace, key, source })
        ),
        historicalAppTranslationInsert({
          namespace,
          sourceHash,
          payloadJson: JSON.stringify(input.payload),
        }),
      ],
    });
    return loadLongTailHistoricalTranslationSqlSeed({
      repoRoot: process.cwd(),
      sqlPath: fixture.sqlPath,
      trustedSha256s: [fixture.sha256],
      expectedAppTranslationRows: 1,
      expectedSourceRows: 1,
      expectedSourceStringRows: Object.keys(input.sourceStrings).length,
    });
  };
  const primary = loadSnapshot({
    filename: "consensus-primary.sql",
    sourceStrings: {
      exact: "Exact source text.",
      payloadDiffers: "The payload differs.",
      sourceDiffers: "Primary source text.",
    },
    payload: {
      exact: "Texto exacto.",
      payloadDiffers: "Valor primario.",
      sourceDiffers: "Traducción compartida.",
    },
  });
  const supporting = loadSnapshot({
    filename: "consensus-supporting.sql",
    sourceStrings: {
      exact: "Exact source text.",
      payloadDiffers: "The payload differs.",
      sourceDiffers: "Supporting source text.",
    },
    payload: {
      exact: "Texto exacto.",
      payloadDiffers: "Valor secundario.",
      sourceDiffers: "Traducción compartida.",
    },
  });

  const consensus = createLongTailHistoricalTranslationSeedConsensus({
    primary,
    supporting: [supporting],
  });
  assert.deepEqual(consensus.evidence, {
    ...primary.evidence,
    selectionPolicy: "all-snapshots-exact",
    supportingSnapshotSha256s: [supporting.evidence.sha256],
    excludedNonConsensusPayloadFields: 1,
    excludedNonConsensusSourceStrings: 1,
  });
  assert.deepEqual(
    consensus.rows.get(`Spanish\u0000${namespace}`)?.payload,
    {
      exact: "Texto exacto.",
      sourceDiffers: "Traducción compartida.",
    },
  );
  assert.deepEqual(
    Object.fromEntries(consensus.sourceStrings.get(namespace) ?? []),
    {
      exact: "Exact source text.",
      payloadDiffers: "The payload differs.",
    },
  );
  assert.equal(
    primary.rows.get(`Spanish\u0000${namespace}`)?.payload.payloadDiffers,
    "Valor primario.",
  );
  assert.throws(
    () => createLongTailHistoricalTranslationSeedConsensus({
      primary,
      supporting: [primary],
    }),
    /cannot reuse the same snapshot digest/,
  );

  const shapeMismatch = loadSnapshot({
    filename: "consensus-shape-mismatch.sql",
    sourceStrings: {
      exact: "Exact source text.",
      payloadDiffers: "The payload differs.",
    },
    payload: {
      exact: "Texto exacto.",
      payloadDiffers: "Valor primario.",
    },
  });
  assert.throws(
    () => createLongTailHistoricalTranslationSeedConsensus({
      primary,
      supporting: [shapeMismatch],
    }),
    /snapshots have different aggregate shapes/,
  );
});

test("historical SQL seed loader rejects unexpected or malformed rows", (t) => {
  const directory = historicalSqlFixtureDirectory(t);
  const sourceHash = sha256("strict-historical-source");
  const valid = historicalAppTranslationInsert({
    namespace: "route:strict",
    sourceHash,
    payloadJson: JSON.stringify({ title: "Título de aprendizaje" }),
  });
  const cases = [
    {
      filename: "unexpected-table.sql",
      lines: [valid, 'INSERT INTO "users" ("id") VALUES(\'private\');'],
      expected: /contains an unexpected table INSERT/,
      expectedRows: 1,
    },
    {
      filename: "malformed-sql.sql",
      lines: [historicalAppTranslationInsert({
        namespace: "route:strict",
        sourceHash,
        payloadJson: JSON.stringify({ title: "Título de aprendizaje" }),
        createdAt: -1,
      })],
      expected: /has a noncanonical integer timestamp/,
      expectedRows: 1,
    },
    {
      filename: "malformed-payload.sql",
      lines: [historicalAppTranslationInsert({
        namespace: "route:strict",
        sourceHash,
        payloadJson: "{not-json}",
      })],
      expected: /has malformed payload JSON/,
      expectedRows: 1,
    },
    {
      filename: "duplicate-pair.sql",
      lines: [valid, valid],
      expected: /contains a duplicate language and namespace/,
      expectedRows: 2,
    },
    {
      filename: "row-count-mismatch.sql",
      lines: [valid],
      expected: /does not contain the expected app_translations row count/,
      expectedRows: 2,
    },
  ] as const;

  for (const fixtureCase of cases) {
    const fixture = writeHistoricalSqlFixture({
      directory,
      filename: fixtureCase.filename,
      lines: fixtureCase.lines,
    });
    assert.throws(
      () => loadLongTailHistoricalTranslationSqlSeed({
        repoRoot: process.cwd(),
        sqlPath: fixture.sqlPath,
        trustedSha256s: [fixture.sha256],
        expectedAppTranslationRows: fixtureCase.expectedRows,
      }),
      fixtureCase.expected,
    );
  }
});

test("historical SQL seed loader rejects linked and overly permissive files", (t) => {
  const directory = historicalSqlFixtureDirectory(t);
  const sourceHash = sha256("historical-file-contract");
  const lines = [historicalAppTranslationInsert({
    namespace: "route:file-contract",
    sourceHash,
    payloadJson: JSON.stringify({ title: "Contrato de archivo" }),
  })];

  const symlinkTarget = writeHistoricalSqlFixture({
    directory,
    filename: "symlink-target.sql",
    lines,
  });
  const symlinkPath = path.join(directory, "symlink.sql");
  symlinkSync(path.basename(symlinkTarget.sqlPath), symlinkPath);
  assert.throws(
    () => loadLongTailHistoricalTranslationSqlSeed({
      repoRoot: process.cwd(),
      sqlPath: symlinkPath,
      trustedSha256s: [symlinkTarget.sha256],
      expectedAppTranslationRows: 1,
    }),
    /symbolic link/,
  );

  const hardlinkTarget = writeHistoricalSqlFixture({
    directory,
    filename: "hardlink-target.sql",
    lines,
  });
  const hardlinkPath = path.join(directory, "hardlink.sql");
  linkSync(hardlinkTarget.sqlPath, hardlinkPath);
  assert.throws(
    () => loadLongTailHistoricalTranslationSqlSeed({
      repoRoot: process.cwd(),
      sqlPath: hardlinkPath,
      trustedSha256s: [hardlinkTarget.sha256],
      expectedAppTranslationRows: 1,
    }),
    /regular non-linked file/,
  );

  const permissive = writeHistoricalSqlFixture({
    directory,
    filename: "permissive.sql",
    lines,
    mode: 0o644,
  });
  assert.throws(
    () => loadLongTailHistoricalTranslationSqlSeed({
      repoRoot: process.cwd(),
      sqlPath: permissive.sqlPath,
      trustedSha256s: [permissive.sha256],
      expectedAppTranslationRows: 1,
    }),
    /current-owner 0600 regular non-linked file/,
  );
});

test("historical and ignored curated main-app packs cannot replace the tracked static corpus", (t) => {
  const root = temporaryDirectory(t);
  const directory = historicalSqlFixtureDirectory(t);
  const source = "What are you curious about today?";
  const value = "¿Qué te da curiosidad hoy?";
  const namespace = "main-app";
  const sourceHash = sha256("current-main-app-source");
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot: path.join(root, "curated"),
    sources: Object.freeze([Object.freeze({
      namespace,
      sourceHash,
      sourceStrings: Object.freeze({ prompt: source }),
    })]),
  });
  const loadSeed = (input: {
    filename: string;
    row: string;
    historicalSourceHash: string;
  }) => {
    const fixture = writeHistoricalSqlFixture({
      directory,
      filename: input.filename,
      lines: [
        historicalSourceInsert({
          namespace,
          sourceHash: input.historicalSourceHash,
        }),
        historicalSourceStringInsert({ namespace, key: "prompt", source }),
        input.row,
      ],
    });
    return loadLongTailHistoricalTranslationSqlSeed({
      repoRoot: process.cwd(),
      sqlPath: fixture.sqlPath,
      trustedSha256s: [fixture.sha256],
      expectedAppTranslationRows: 1,
      expectedSourceRows: 1,
      expectedSourceStringRows: 1,
    });
  };

  const exactSeed = loadSeed({
    filename: "main-exact.sql",
    historicalSourceHash: sourceHash,
    row: historicalAppTranslationInsert({
      namespace,
      sourceHash,
      payloadJson: JSON.stringify({ prompt: value }),
    }),
  });
  writeSyntheticCuratedPack({
    curatedRoot: inventory.curatedRoot,
    locale: "es",
    namespace,
    value: {
      schemaVersion: 1,
      language: "Spanish",
      locale: "es",
      namespace,
      sourceHash,
      entries: [{ key: "prompt", source, value }],
    },
  });
  const exactMemory = createLongTailSeedMemory(inventory, [], exactSeed);
  assert.equal(exactMemory.entries.length, 0);
  assert.throws(
    () => buildLongTailMasterWorklist({
      inventory,
      provenance: fixtureProvenance(exactMemory),
      seedMemory: exactMemory,
    }),
    /Existing curated pack for Spanish\/main-app is malformed or invalid/,
  );

  const staleSourceHash = sha256("stale-main-app-source");
  const staleSeed = loadSeed({
    filename: "main-stale.sql",
    historicalSourceHash: staleSourceHash,
    row: historicalAppTranslationInsert({
      namespace,
      sourceHash: staleSourceHash,
      payloadJson: JSON.stringify({ prompt: value }),
    }),
  });
  assert.equal(createLongTailSeedMemory(inventory, [], staleSeed).entries.length, 0);

  const mismatchedKeys = loadSeed({
    filename: "main-keyset-mismatch.sql",
    historicalSourceHash: sourceHash,
    row: historicalAppTranslationInsert({
      namespace,
      sourceHash,
      payloadJson: JSON.stringify({ prompt: value, extra: "Texto adicional" }),
    }),
  });
  assert.equal(
    createLongTailSeedMemory(inventory, [], mismatchedKeys).entries.length,
    0,
  );
});

test("generator inventory uses only the tracked static main-app pack and fails on drift or deletion", (t) => {
  const root = temporaryDirectory(t);
  const source = "Start learning now.";
  const sourceHash = sha256("tracked-main-app-source");
  const staticMainAppRoot = path.join(root, "static-main-app");
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot: path.join(root, "curated"),
    staticMainAppRoot,
    sources: Object.freeze([Object.freeze({
      namespace: "main-app",
      sourceHash,
      sourceStrings: Object.freeze({ prompt: source }),
    })]),
  });
  const staticFile = path.join(staticMainAppRoot, "es.json");
  writeJson(staticFile, {
    schemaVersion: 1,
    kind: "static-main-app-values",
    language: "Spanish",
    locale: "es",
    sourceHash,
    keyCount: 1,
    strings: ["Empieza a aprender ahora."],
  });
  writeSyntheticCuratedPack({
    curatedRoot: inventory.curatedRoot,
    locale: "es",
    namespace: "main-app",
    value: { ignoredWorkbench: true },
  });
  const seedMemory = createLongTailSeedMemory(inventory);
  const complete = buildLongTailMasterWorklist({
    inventory,
    provenance: fixtureProvenance(seedMemory),
    seedMemory,
  });
  assert.equal(complete.completedPacks, 1);
  assert.equal(complete.worklist.jobs.length, 0);

  writeJson(staticFile, {
    schemaVersion: 1,
    kind: "static-main-app-values",
    language: "Spanish",
    locale: "es",
    sourceHash: sha256("drifted-main-app-source"),
    keyCount: 1,
    strings: ["Empieza a aprender ahora."],
  });
  const driftedMemory = createLongTailSeedMemory(inventory);
  assert.throws(
    () => buildLongTailMasterWorklist({
      inventory,
      provenance: fixtureProvenance(driftedMemory),
      seedMemory: driftedMemory,
    }),
    /malformed or invalid for its current source hash/,
  );

  rmSync(staticFile);
  const deletedMemory = createLongTailSeedMemory(inventory);
  assert.throws(
    () => buildLongTailMasterWorklist({
      inventory,
      provenance: fixtureProvenance(deletedMemory),
      seedMemory: deletedMemory,
    }),
    /malformed or invalid for its current source hash/,
  );
});

function controlledAfrikaansCuratedRescueInventory(
  t: test.TestContext,
): LongTailInventory {
  const production = createProductionLongTailInventory(process.cwd());
  const curatedRoot = path.join(
    temporaryDirectory(t),
    "controlled-afrikaans-curated",
  );
  const relativeRouteHomePack = path.join("af", "route__home.json");
  const productionRouteHomePack = path.join(
    production.curatedRoot,
    relativeRouteHomePack,
  );
  const controlledRouteHomePack = path.join(
    curatedRoot,
    relativeRouteHomePack,
  );
  mkdirSync(path.dirname(controlledRouteHomePack), { recursive: true });
  writeFileSync(
    controlledRouteHomePack,
    readFileSync(productionRouteHomePack),
    { mode: 0o600 },
  );
  return Object.freeze({
    ...production,
    languages: Object.freeze(["Afrikaans" as const]),
    curatedRoot,
  });
}

test("Afrikaans curated generation rescue is exact, validated, and bound to the production inventory", (t) => {
  const production = createProductionLongTailInventory(process.cwd());
  assert.equal(afrikaansCuratedGenerationSeedContract.length, 10);
  const habitCoachBinding = afrikaansCuratedGenerationSeedContract.find(
    (binding) => binding.sourceSha256 ===
      "fc6bff84341dbb08437a1ec23f662a8064b07d38c23097a29216b1b2883bee79",
  );
  assert.ok(habitCoachBinding);
  assert.equal(
    inspectTranslationFieldFluency(
      habitCoachBinding.source,
      "Habit Coach AI Learning Mode is 'n gefokusde manier om KI vir leer te gebruik in plaas van passiewe antwoordversameling. Die modus is rondom 'n spesifieke taak gebou: verander voornemens in klein herhaalbare leergewoontes met snellers, belonings en herstelplanne.",
      "Afrikaans",
    ).reason,
    "source-trigram-leakage",
  );
  const conceptMapBinding = afrikaansCuratedGenerationSeedContract.find(
    (binding) => binding.sourceSha256 ===
      "fbb48c0f62b2d0866c8618a1a2eef5b6f11d7999518bacf20abe638c0ade274f",
  );
  assert.ok(conceptMapBinding);
  assert.equal(
    inspectTranslationFieldFluency(
      conceptMapBinding.source,
      "Concept Map Builder AI Learning Mode is 'n gefokusde manier om KI vir leer te gebruik in plaas van passiewe antwoordversameling. Die modus is rondom 'n spesifieke taak gebou: karteer hoe idees verband hou, van oorsake en gevolge tot kategorieë, voorbeelde en teenstrydighede.",
      "Afrikaans",
    ).reason,
    "source-trigram-leakage",
  );
  const roleplayScenarioBinding = afrikaansCuratedGenerationSeedContract.find(
    (binding) => binding.sourceSha256 ===
      "fb14c9272c033b45dbc06016367bf68d312a4d0f8de61b5991f383c26084aaf7",
  );
  assert.ok(roleplayScenarioBinding);
  const debateAnyTopicBinding = afrikaansCuratedGenerationSeedContract.find(
    (binding) => binding.sourceSha256 ===
      "f6cea7a517ad59034fc3154fe4d97f83a1923390b1ead3fd12414f5b20618645",
  );
  assert.ok(debateAnyTopicBinding);
  const flashcardProgressionBinding = afrikaansCuratedGenerationSeedContract.find(
    (binding) => binding.sourceSha256 ===
      "8e227ba67e984856c878dc5209abe51751c834ad4f5742239e4f482175aef2a3",
  );
  assert.ok(flashcardProgressionBinding);
  const caseStudyGuideBinding = afrikaansCuratedGenerationSeedContract.find(
    (binding) => binding.sourceSha256 ===
      "f5ba6c92e3394f99029e39962d75cd0f6c29beb36ee00ad7391548a9a912d847",
  );
  assert.ok(caseStudyGuideBinding);
  const caseStudyRelatedPathBinding = afrikaansCuratedGenerationSeedContract.find(
    (binding) => binding.sourceSha256 ===
      "f29c6dd11a9cb5a2e3134f68923ee2bf46dfb03233002dc2eee1a05088a51396",
  );
  assert.ok(caseStudyRelatedPathBinding);
  assert.equal(
    caseStudyRelatedPathBinding.value,
    "Gebruik Gevallestudiesimulator wanneer dit die regte modus vir die taak is. As jy ’n verwante leerpad wil volg, probeer Feynman Tutor. Jy kan ook deur die KI-leerblog blaai vir studiemetodes, Sokratiese leer, flitskaarte, rolspel en aktiewe herroeping.",
  );
  assert.deepEqual(caseStudyRelatedPathBinding.requiredOccurrences, [
    {
      namespace: "blog:case-study-simulator-prompts-and-study-loop",
      sourceHash:
        "ae93e71916cb8c96898b54aa328a39f08ef1ee6f799425b2baa6637a1e583287",
      key: "site.d835e997c12945b8ec",
    },
    {
      namespace: "route:blog",
      sourceHash:
        "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
      key: "site.d835e997c12945b8ec",
    },
  ]);
  const civicsCoachBinding = afrikaansCuratedGenerationSeedContract.find(
    (binding) => binding.sourceSha256 ===
      "f20e1ae1b0659633731779b7e2a20b3f586d09b582c1f57160905cd6618e0e17",
  );
  assert.ok(civicsCoachBinding);
  assert.equal(
    civicsCoachBinding.value,
    "Civics Coach se KI-leermodus is ’n doelgerigte manier om KI vir leer te gebruik eerder as om passief antwoorde in te samel. Die modus is rondom ’n spesifieke taak gebou: Leer oor grondwette, demokrasie, verkiesings, howe, regte, pligte en openbare beleid.",
  );
  assert.notEqual(
    civicsCoachBinding.value,
    "Sivics Trainer AI Leermodus is 'n gefokusde manier om AI te gebruik vir leer in plaas van passiewe antwoordversameling. Die modus is gebou rondom ' n spesifieke werk: Leer grondwette, demokrasie, verkiesings, howe, regte, pligte, en openbare beleid.",
  );
  assert.deepEqual(civicsCoachBinding.requiredOccurrences, [
    {
      namespace: "blog:ai-civics-coach-guide",
      sourceHash:
        "441d65898f6c21bdcf5b68d5c2f695c45a5df7254ed028af7ea8411f697aa0cd",
      key: "site.d3623627f25eddf8fa",
    },
    {
      namespace: "route:blog",
      sourceHash:
        "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
      key: "site.d3623627f25eddf8fa",
    },
  ]);
  for (const binding of afrikaansCuratedGenerationSeedContract) {
    assert.equal(sha256(binding.source), binding.sourceSha256);
    assert.equal(sha256(binding.value), binding.valueSha256);
    assert.equal(
      `site.${sha1(binding.source).slice(0, 18)}`,
      binding.requiredOccurrences[0]?.key,
    );
    assert.equal(validateTranslationCandidateField({
      language: "Afrikaans",
      source: binding.source,
      value: binding.value,
    }).failures.length, 0);
    assert.equal(
      hasExactLongTailInvariantParity(binding.source, binding.value),
      true,
    );
    assert.equal(
      inspectTranslationFieldFluency(
        binding.source,
        binding.value,
        "Afrikaans",
      ).reason,
      null,
    );

    const actualOccurrences = production.sources.flatMap((source) =>
      Object.entries(source.sourceStrings)
        .filter(([, value]) => sha256(value) === binding.sourceSha256)
        .map(([key, value]) => ({
          namespace: source.namespace,
          sourceHash: source.sourceHash,
          key,
          source: value,
        }))
    ).sort((left, right) =>
      compareCodePoints(left.namespace, right.namespace) ||
      compareCodePoints(left.sourceHash, right.sourceHash) ||
      compareCodePoints(left.key, right.key)
    );
    const expectedOccurrences = binding.requiredOccurrences.map((occurrence) => ({
      ...occurrence,
      source: binding.source,
    })).sort((left, right) =>
      compareCodePoints(left.namespace, right.namespace) ||
      compareCodePoints(left.sourceHash, right.sourceHash) ||
      compareCodePoints(left.key, right.key)
    );
    assert.deepEqual(actualOccurrences, expectedOccurrences);

    for (const occurrence of actualOccurrences) {
      assert.equal(
        getSiteSourceHash(
          production.sources.find(
            (source) => source.namespace === occurrence.namespace,
          )?.sourceStrings ?? {},
        ),
        occurrence.sourceHash,
      );
      assert.equal(
        isValidFieldTranslation(
          binding.source,
          binding.value,
          "Afrikaans",
          occurrence.key,
        ),
        true,
      );
      assert.equal(
        isTranslationFieldLikelyFluent(
          binding.source,
          binding.value,
          "Afrikaans",
          occurrence,
        ),
        true,
      );
      const source = {
        namespace: occurrence.namespace,
        sourceHash: occurrence.sourceHash,
        sourceStrings: { [occurrence.key]: binding.source },
      };
      const bundle = {
        namespace: occurrence.namespace,
        language: "Afrikaans" as const,
        sourceHash: occurrence.sourceHash,
        sourceStrings: source.sourceStrings,
        strings: { [occurrence.key]: binding.value },
      };
      assert.equal(
        isTranslationBundleFieldValid(source, bundle, "Afrikaans"),
        true,
      );
      assert.equal(
        isTranslationBundleCompleteAndFluent(source, bundle, "Afrikaans"),
        true,
      );
    }
  }

  const inventory = controlledAfrikaansCuratedRescueInventory(t);
  const memory = createLongTailSeedMemory(inventory);
  for (const binding of afrikaansCuratedGenerationSeedContract) {
    assert.equal(
      memory.conflicts.some(
        (conflict) => conflict.sourceSha256 === binding.sourceSha256,
      ),
      false,
    );
    assert.deepEqual(
      memory.entries
        .filter((entry) => entry.sourceSha256 === binding.sourceSha256)
        .map((entry) => ({
          language: entry.language,
          source: entry.source,
          sourceSha256: entry.sourceSha256,
          value: entry.value,
          valueSha256: entry.valueSha256,
        })),
      [{
        language: "Afrikaans",
        source: binding.source,
        sourceSha256: binding.sourceSha256,
        value: binding.value,
        valueSha256: binding.valueSha256,
      }],
    );
  }
  const master = buildLongTailMasterWorklist({
    inventory,
    provenance: fixtureProvenance(memory),
    seedMemory: memory,
  }).worklist;
  assert.equal(master.generationOverrides.entries.length, 10);
  assert.deepEqual(
    master.generationOverrides.entries.map((entry) => entry.sourceSha256),
    [...master.generationOverrides.entries]
      .map((entry) => entry.sourceSha256)
      .sort(compareCodePoints),
  );
  assert.doesNotThrow(() => parseLongTailMasterWorklist(master));

  const forgedMaster = (entries: unknown[]) => {
    const value = structuredClone(master) as Record<string, unknown>;
    const overrides = structuredClone(master.generationOverrides) as
      Record<string, unknown>;
    const overrideMaterial = {
      schemaVersion: overrides.schemaVersion,
      kind: overrides.kind,
      entries,
    };
    value.generationOverrides = {
      ...overrideMaterial,
      generationOverridesSha256: sha256Canonical(overrideMaterial),
    };
    const { worklistSha256: _priorHash, ...masterMaterial } = value;
    assert.equal(_priorHash, master.worklistSha256);
    return {
      ...masterMaterial,
      worklistSha256: sha256Canonical(masterMaterial),
    };
  };
  const overrideEntries = structuredClone(master.generationOverrides.entries);
  const firstOverride = overrideEntries[0];
  assert.ok(firstOverride);
  for (const entries of [
    overrideEntries.slice(1),
    [firstOverride, ...overrideEntries],
    [...overrideEntries].reverse(),
    [{
      ...firstOverride,
      value: `${firstOverride.value} Tampered`,
      valueSha256: sha256(`${firstOverride.value} Tampered`),
    }, ...overrideEntries.slice(1)],
  ]) {
    assert.throws(
      () => parseLongTailMasterWorklist(forgedMaster(entries)),
      /generation overrides/i,
    );
  }
});

test("Afrikaans curated generation rescue rejects namespace and occurrence drift", (t) => {
  const binding = afrikaansCuratedGenerationSeedContract[0];
  assert.ok(binding);
  const inventory = controlledAfrikaansCuratedRescueInventory(t);
  const production = createProductionLongTailInventory(process.cwd());

  const [first, second] = binding.requiredOccurrences;
  assert.ok(first);
  assert.ok(second);
  const firstSource = production.sources.find(
    (source) => source.namespace === first.namespace,
  );
  assert.ok(firstSource);

  const missingOccurrence = Object.freeze({
    ...inventory,
    sources: Object.freeze(production.sources.filter(
      (source) => source.namespace !== first.namespace,
    )),
  });
  const extraSourceStrings = Object.freeze({ [first.key]: binding.source });
  const extraOccurrence = Object.freeze({
    ...inventory,
    sources: Object.freeze([
      ...production.sources,
      Object.freeze({
        namespace: "route:curated-rescue-extra",
        sourceHash: getSiteSourceHash(extraSourceStrings),
        sourceStrings: extraSourceStrings,
      }),
    ]),
  });
  const duplicateOccurrence = Object.freeze({
    ...inventory,
    sources: Object.freeze([...production.sources, firstSource]),
  });
  const tamperedSourceStrings = Object.freeze({
    ...firstSource.sourceStrings,
    "test.tampered": "Tampered namespace inventory",
  });
  const staleNamespaceHash = Object.freeze({
    ...inventory,
    sources: Object.freeze(production.sources.map((source) =>
      source.namespace === first.namespace
        ? Object.freeze({
          ...source,
          sourceStrings: tamperedSourceStrings,
        })
        : source
    )),
  });

  for (const [driftedInventory, expected] of [
    [missingOccurrence, /occurrence identities drifted/],
    [extraOccurrence, /occurrence identities drifted/],
    [duplicateOccurrence, /occurrence identities drifted/],
    [staleNamespaceHash, /namespace hash drifted/],
  ] as const) {
    assert.throws(
      () => createLongTailSeedMemory(driftedInventory),
      (error: unknown) =>
        error instanceof LongTailPipelineError &&
        error.code === "LONG_TAIL_SOURCE_DRIFT" &&
        expected.test(error.message),
    );
  }
});

test("Afrikaans curated generation rescue rejects conflicting validated historical evidence", (t) => {
  const binding = afrikaansCuratedGenerationSeedContract[0];
  assert.ok(binding);
  const occurrence = binding.requiredOccurrences[0];
  assert.ok(occurrence);
  const conflictingValue = `${binding.value} Inderdaad.`;
  assert.equal(validateTranslationCandidateField({
    language: "Afrikaans",
    source: binding.source,
    value: conflictingValue,
  }).failures.length, 0);
  assert.equal(
    isTranslationFieldLikelyFluent(
      binding.source,
      conflictingValue,
      "Afrikaans",
      occurrence,
    ),
    true,
  );
  const directory = historicalSqlFixtureDirectory(t);
  const fixture = writeHistoricalSqlFixture({
    directory,
    filename: "afrikaans-curated-rescue-conflict.sql",
    lines: [
      historicalSourceInsert(occurrence),
      historicalSourceStringInsert({
        namespace: occurrence.namespace,
        key: occurrence.key,
        source: binding.source,
      }),
      historicalAppTranslationInsert({
        namespace: occurrence.namespace,
        language: "Afrikaans",
        sourceHash: occurrence.sourceHash,
        payloadJson: JSON.stringify({
          [occurrence.key]: conflictingValue,
        }),
      }),
    ],
  });
  const historicalSeed = loadLongTailHistoricalTranslationSqlSeed({
    repoRoot: process.cwd(),
    sqlPath: fixture.sqlPath,
    trustedSha256s: [fixture.sha256],
    expectedAppTranslationRows: 1,
    expectedSourceRows: 1,
    expectedSourceStringRows: 1,
  });
  const inventory = controlledAfrikaansCuratedRescueInventory(t);
  assert.throws(
    () => createLongTailSeedMemory(
      inventory,
      [],
      historicalSeed,
    ),
    (error: unknown) =>
      error instanceof LongTailPipelineError &&
      error.code === "LONG_TAIL_CONFLICT" &&
      /conflicts with validated tracked or historical evidence/.test(
        error.message,
      ),
  );
});

test("historical site seeds use only valid content-addressed current keys", (t) => {
  const root = temporaryDirectory(t);
  const directory = historicalSqlFixtureDirectory(t);
  const acceptedSource = "What are you curious about today?";
  const acceptedValue = "¿Qué te da curiosidad hoy?";
  const acceptedKey = `site.${sha1(acceptedSource).slice(0, 18)}`;
  const wrongKeySource = "Save your progress in <strong>inspir</strong>.";
  const invalidSource = "Create a private study plan.";
  const invalidKey = `site.${sha1(invalidSource).slice(0, 18)}`;
  const historicalRows = [
    {
      namespace: "route:accepted",
      sourceHash: sha256("stale-site-namespace-source"),
      sourceStrings: { [acceptedKey]: acceptedSource },
      payload: { [acceptedKey]: acceptedValue },
    },
    {
      namespace: "route:wrong-key",
      sourceHash: sha256("wrong-key-namespace-source"),
      sourceStrings: { "legacy.title": wrongKeySource },
      payload: {
        "legacy.title": "Guarda tu progreso en <strong>inspir</strong>.",
      },
    },
    {
      namespace: "route:invalid-value",
      sourceHash: sha256("invalid-value-namespace-source"),
      sourceStrings: { [invalidKey]: invalidSource },
      payload: { [invalidKey]: invalidSource },
    },
  ];
  const rows = historicalRows.flatMap((row) => [
    historicalSourceInsert(row),
    ...Object.entries(row.sourceStrings).map(([key, source]) =>
      historicalSourceStringInsert({ namespace: row.namespace, key, source })
    ),
    historicalAppTranslationInsert({
      namespace: row.namespace,
      sourceHash: row.sourceHash,
      payloadJson: JSON.stringify(row.payload),
    }),
  ]);
  const fixture = writeHistoricalSqlFixture({
    directory,
    filename: "site-seeds.sql",
    lines: rows,
  });
  const seed = loadLongTailHistoricalTranslationSqlSeed({
    repoRoot: process.cwd(),
    sqlPath: fixture.sqlPath,
    trustedSha256s: [fixture.sha256],
    expectedAppTranslationRows: historicalRows.length,
    expectedSourceRows: historicalRows.length,
    expectedSourceStringRows: historicalRows.length,
  });
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot: path.join(root, "curated"),
    sources: Object.freeze([
      Object.freeze({
        namespace: "route:accepted",
        sourceHash: sha256("current-site-namespace-source"),
        sourceStrings: Object.freeze({ [acceptedKey]: acceptedSource }),
      }),
      Object.freeze({
        namespace: "route:wrong-key",
        sourceHash: sha256("current-wrong-key-source"),
        sourceStrings: Object.freeze({
          "legacy.title": wrongKeySource,
        }),
      }),
      Object.freeze({
        namespace: "route:invalid-value",
        sourceHash: sha256("current-invalid-value-source"),
        sourceStrings: Object.freeze({ [invalidKey]: invalidSource }),
      }),
    ]),
  });
  const memory = createLongTailSeedMemory(inventory, [], seed);
  assert.deepEqual(
    memory.entries.map((entry) => ({
      source: entry.source,
      value: entry.value,
    })),
    [{ source: acceptedSource, value: acceptedValue }],
  );
  assert.equal(memory.conflicts.length, 0);
});

test("embedded source phrase composition is literal and single-pass", () => {
  const source = "Use Homework Coach, then Explain My Answer.";
  const value = "Use Homework Coach, then Explain My Answer.";
  const replacements = new Map<string, string>([
    ["Homework Coach", "Tutor $& $` $'"],
    ["Explain My Answer", "Homework Coach localized"],
  ]);

  assert.equal(
    composeLongTailEmbeddedSourcePhraseTranslations({
      source,
      value,
      replacements,
    }),
    "Use Tutor $& $` $', then Homework Coach localized.",
  );
});

test("historical composition repairs the exact two-phrase Afrikaans source", (t) => {
  const root = temporaryDirectory(t);
  const directory = historicalSqlFixtureDirectory(t);
  const homeworkPhrase = translationEmbeddedSourcePhrases.find(
    (phrase) => phrase === "Homework Coach",
  );
  const explainPhrase = translationEmbeddedSourcePhrases.find(
    (phrase) => phrase === "Explain My Answer",
  );
  assert.equal(homeworkPhrase, "Homework Coach");
  assert.equal(explainPhrase, "Explain My Answer");
  const homeworkValue = "Huiswerkafrigter";
  const explainValue = "Verduidelik My Antwoord";
  const proseSource =
    "Use Homework Coach when this is the right mode for the job. If you want a related path, try Explain My Answer. You can also browse the AI learning blog for study methods, Socratic learning, flashcards, roleplay, and active recall.";
  const unchangedProseValue =
    "Gebruik Homework Coach wanneer dit die regte modus vir die taak is. As jy 'n verwante pad wil hê, probeer Explain My Answer. Jy kan ook deur die KI-leerblog blaai vir studiemetodes, Sokratiese leer, flitskaarte, rolspel en aktiewe herroeping.";
  const composedProseValue =
    "Gebruik Huiswerkafrigter wanneer dit die regte modus vir die taak is. As jy 'n verwante pad wil hê, probeer Verduidelik My Antwoord. Jy kan ook deur die KI-leerblog blaai vir studiemetodes, Sokratiese leer, flitskaarte, rolspel en aktiewe herroeping.";
  assert.equal(
    sha256(proseSource),
    "9ba833aa28cab2c2fe0a321d99c4a7625b8bd4a4c81e13223a29b6a2643fe287",
  );
  assert.equal(
    `site.${sha1(proseSource).slice(0, 18)}`,
    "site.7289c50293ffe86821",
  );
  assert.equal(
    sha256(composedProseValue),
    "ebc74aca7c2d0cb84ed5ec22d86a3183851dd1290cf86e2a0900b7b4d69e3e99",
  );
  const proseNamespace = "route:a-composition-prose";
  const homeworkNamespace = "route:y-composition-homework-phrase";
  const explainNamespace = "route:z-composition-explain-phrase";
  assert.ok(proseNamespace < homeworkNamespace);
  assert.ok(proseNamespace < explainNamespace);

  type HistoricalPhraseFixture = Readonly<{
    namespace: string;
    source: string;
    value: string;
  }>;
  const sourceHashFor = (namespace: string) =>
    sha256(`composition-source:${namespace}`);
  const sourceKeyFor = (source: string) =>
    `site.${sha1(source).slice(0, 18)}`;
  const loadSeed = (
    filename: string,
    rows: readonly HistoricalPhraseFixture[],
  ) => {
    const fixture = writeHistoricalSqlFixture({
      directory,
      filename,
      lines: rows.flatMap((row) => {
        const sourceHash = sourceHashFor(row.namespace);
        const key = sourceKeyFor(row.source);
        return [
          historicalSourceInsert({ namespace: row.namespace, sourceHash }),
          historicalSourceStringInsert({
            namespace: row.namespace,
            key,
            source: row.source,
          }),
          historicalAppTranslationInsert({
            namespace: row.namespace,
            language: "Afrikaans",
            sourceHash,
            payloadJson: JSON.stringify({ [key]: row.value }),
          }),
        ];
      }),
    });
    return loadLongTailHistoricalTranslationSqlSeed({
      repoRoot: process.cwd(),
      sqlPath: fixture.sqlPath,
      trustedSha256s: [fixture.sha256],
      expectedAppTranslationRows: rows.length,
      expectedSourceRows: rows.length,
      expectedSourceStringRows: rows.length,
    });
  };
  const createInventory = (
    label: string,
    sources: readonly Readonly<{ namespace: string; source: string }>[],
  ): LongTailInventory => Object.freeze({
    languages: Object.freeze(["Afrikaans" as const]),
    curatedRoot: path.join(root, `curated-${label}`),
    sources: Object.freeze(sources.map((source) => Object.freeze({
      namespace: source.namespace,
      sourceHash: sourceHashFor(source.namespace),
      sourceStrings: Object.freeze({
        [sourceKeyFor(source.source)]: source.source,
      }),
    }))),
  });
  const exactSources = [
    { namespace: proseNamespace, source: proseSource },
    { namespace: homeworkNamespace, source: homeworkPhrase },
    { namespace: explainNamespace, source: explainPhrase },
  ] as const;
  const exactSeed = loadSeed("embedded-phrase-exact.sql", [
    {
      namespace: proseNamespace,
      source: proseSource,
      value: unchangedProseValue,
    },
    {
      namespace: homeworkNamespace,
      source: homeworkPhrase,
      value: homeworkValue,
    },
    {
      namespace: explainNamespace,
      source: explainPhrase,
      value: explainValue,
    },
  ]);
  const exactMemory = createLongTailSeedMemory(
    createInventory("exact", exactSources),
    [],
    exactSeed,
  );
  const exactValues = new Map(
    exactMemory.entries.map((entry) => [entry.source, entry.value]),
  );
  assert.equal(exactValues.get(homeworkPhrase), homeworkValue);
  assert.equal(exactValues.get(explainPhrase), explainValue);
  assert.equal(exactValues.get(proseSource), composedProseValue);
  assert.equal([...exactValues.values()].includes(unchangedProseValue), false);
  assert.equal(exactMemory.conflicts.length, 0);

  const missingPhraseSeed = loadSeed("embedded-phrase-missing.sql", [
    {
      namespace: proseNamespace,
      source: proseSource,
      value: unchangedProseValue,
    },
    {
      namespace: homeworkNamespace,
      source: homeworkPhrase,
      value: homeworkValue,
    },
  ]);
  const missingPhraseMemory = createLongTailSeedMemory(
    createInventory("missing", exactSources),
    [],
    missingPhraseSeed,
  );
  const missingValues = new Map(
    missingPhraseMemory.entries.map((entry) => [entry.source, entry.value]),
  );
  assert.equal(missingValues.get(homeworkPhrase), homeworkValue);
  assert.equal(missingValues.has(explainPhrase), false);
  assert.equal(missingValues.has(proseSource), false);
  assert.equal(missingPhraseMemory.conflicts.length, 0);

  const secondPhraseNamespace = "route:zz-composition-explain-conflict";
  const conflictingSources = [
    ...exactSources,
    { namespace: secondPhraseNamespace, source: explainPhrase },
  ] as const;
  const conflictingSeed = loadSeed("embedded-phrase-conflict.sql", [
    {
      namespace: proseNamespace,
      source: proseSource,
      value: unchangedProseValue,
    },
    {
      namespace: homeworkNamespace,
      source: homeworkPhrase,
      value: homeworkValue,
    },
    {
      namespace: explainNamespace,
      source: explainPhrase,
      value: explainValue,
    },
    {
      namespace: secondPhraseNamespace,
      source: explainPhrase,
      value: "Verklaar My Antwoord",
    },
  ]);
  const conflictingMemory = createLongTailSeedMemory(
    createInventory("conflicting", conflictingSources),
    [],
    conflictingSeed,
  );
  const conflictingValues = new Map(
    conflictingMemory.entries.map((entry) => [entry.source, entry.value]),
  );
  assert.equal(conflictingValues.get(homeworkPhrase), homeworkValue);
  assert.equal(conflictingValues.has(explainPhrase), false);
  assert.equal(conflictingValues.has(proseSource), false);
  assert.deepEqual(conflictingMemory.conflicts, [{
    language: "Afrikaans",
    locale: "af",
    sourceSha256: sha256(explainPhrase),
  }]);
});

test("Afrikaans product copy composes only from the exact tracked glossary", (t) => {
  const root = temporaryDirectory(t);
  const directory = historicalSqlFixtureDirectory(t);
  const proseNamespace = "blog:afrikaans-product-copy-regression";
  const proseSourceHash = sha256("afrikaans-product-copy-regression-source");
  const proseKey = `site.${sha1(afrikaansProductCopyHistoricalSource).slice(0, 18)}`;
  const historicalValue =
    "Daardie kringloop verskyn regoor die platform. Math Step Coach breek 'n probleem in stappe op. Flashcard Builder verander notas in herroepingspraktyk. Quiz Me On Trivia voeg drukgetoetste herroeping by. Writing Coach help om 'n konsep te verbeter sonder om die skrywer te vervang.";
  const expectedValue =
    "Daardie kringloop verskyn regoor die platform. Wiskunde-stap-afrigter breek 'n probleem in stappe op. Flitskaartbouer verander notas in herroepingspraktyk. Vasvra my oor trivia voeg drukgetoetste herroeping by. Skryfafrigter help om 'n konsep te verbeter sonder om die skrywer te vervang.";
  const recallSource =
    "Recall later. Turn the weak spot into a card in Flashcard Builder or a short quiz in Quiz Me On Trivia.";
  const recallKey = `site.${sha1(recallSource).slice(0, 18)}`;
  const recallHistoricalValue =
    "Herroep later. Verander die swak plek in 'n kaart in Flashcard Builder of 'n kort vasvra in Quiz Me On Trivia.";
  const recallExpectedValue =
    "Herroep later. Verander die swak plek in 'n kaart in Flitskaartbouer of 'n kort vasvra in Vasvra my oor trivia.";
  const mainAppSourceHash =
    "fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0";
  const routeHomeSourceHash =
    "fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce";
  const productEntries = Object.freeze([
    Object.freeze({
      mainKey: "topic.flashcard-builder.name",
      routeKey: "site.8d3383856ae937dbc8",
      source: "Flashcard Builder",
      value: "Flitskaartbouer",
    }),
    Object.freeze({
      mainKey: "topic.math-step-coach.name",
      routeKey: "site.accca8c4b44c698f11",
      source: "Math Step Coach",
      value: "Wiskunde-stap-afrigter",
    }),
    Object.freeze({
      mainKey: "topic.quiz-me-on-trivia.name",
      routeKey: "site.5728bdb5f3eb838312",
      source: "Quiz me on Trivia",
      value: "Vasvra my oor trivia",
    }),
    Object.freeze({
      mainKey: "topic.writing-coach.name",
      routeKey: "site.031857a0f03861e726",
      source: "Writing Coach",
      value: "Skryfafrigter",
    }),
  ] as const);
  type FixtureOptions = Readonly<{
    completeProse?: boolean;
    omitRouteWritingCoach?: boolean;
    routeMathValue?: string;
    routeSourceHash?: string;
  }>;
  const createFixture = (label: string, options: FixtureOptions = {}) => {
    const fixtureRoot = path.join(root, label);
    const curatedRoot = path.join(fixtureRoot, "curated");
    const staticMainAppRoot = path.join(fixtureRoot, "static-main-app");
    const routeEntries = productEntries
      .filter(
        (entry) =>
          !options.omitRouteWritingCoach || entry.source !== "Writing Coach",
      )
      .map((entry) => Object.freeze({
        key: entry.routeKey,
        source: entry.source,
        value: entry.source === "Math Step Coach"
          ? options.routeMathValue ?? entry.value
          : entry.value,
      }));
    const routeSourceStrings = Object.freeze(Object.fromEntries(
      routeEntries.map((entry) => [entry.key, entry.source]),
    ));
    const mainAppSourceStrings = Object.freeze(Object.fromEntries(
      productEntries.map((entry) => [entry.mainKey, entry.source]),
    ));
    const inventory: LongTailInventory = Object.freeze({
      languages: Object.freeze(["Afrikaans" as const]),
      curatedRoot,
      staticMainAppRoot,
      sources: Object.freeze([
        Object.freeze({
          namespace: "main-app",
          sourceHash: mainAppSourceHash,
          sourceStrings: mainAppSourceStrings,
        }),
        Object.freeze({
          namespace: "route:home",
          sourceHash: options.routeSourceHash ?? routeHomeSourceHash,
          sourceStrings: routeSourceStrings,
        }),
        Object.freeze({
          namespace: proseNamespace,
          sourceHash: proseSourceHash,
          sourceStrings: Object.freeze({
            [proseKey]: afrikaansProductCopyHistoricalSource,
            [recallKey]: recallSource,
          }),
        }),
      ]),
    });
    writeJson(path.join(staticMainAppRoot, "af.json"), {
      schemaVersion: 1,
      kind: "static-main-app-values",
      language: "Afrikaans",
      locale: "af",
      sourceHash: mainAppSourceHash,
      keyCount: productEntries.length,
      strings: [...productEntries]
        .sort((left, right) => left.mainKey.localeCompare(right.mainKey))
        .map((entry) => entry.value),
    });
    writeSyntheticCuratedPack({
      curatedRoot,
      locale: "af",
      namespace: "route:home",
      value: {
        schemaVersion: 1,
        language: "Afrikaans",
        locale: "af",
        namespace: "route:home",
        sourceHash: options.routeSourceHash ?? routeHomeSourceHash,
        entries: routeEntries,
      },
    });
    if (options.completeProse) {
      writeSyntheticCuratedPack({
        curatedRoot,
        locale: "af",
        namespace: proseNamespace,
        value: {
          schemaVersion: 1,
          language: "Afrikaans",
          locale: "af",
          namespace: proseNamespace,
          sourceHash: proseSourceHash,
          entries: [{
            key: proseKey,
            source: afrikaansProductCopyHistoricalSource,
            value: expectedValue,
          }, {
            key: recallKey,
            source: recallSource,
            value: recallExpectedValue,
          }],
        },
      });
    }
    const fixture = writeHistoricalSqlFixture({
      directory,
      filename: `${label}.sql`,
      lines: [
        historicalSourceInsert({
          namespace: proseNamespace,
          sourceHash: proseSourceHash,
        }),
        historicalSourceStringInsert({
          namespace: proseNamespace,
          key: proseKey,
          source: afrikaansProductCopyHistoricalSource,
        }),
        historicalSourceStringInsert({
          namespace: proseNamespace,
          key: recallKey,
          source: recallSource,
        }),
        historicalAppTranslationInsert({
          namespace: proseNamespace,
          language: "Afrikaans",
          sourceHash: proseSourceHash,
          payloadJson: JSON.stringify({
            [proseKey]: historicalValue,
            [recallKey]: recallHistoricalValue,
          }),
        }),
      ],
    });
    const seed = loadLongTailHistoricalTranslationSqlSeed({
      repoRoot: process.cwd(),
      sqlPath: fixture.sqlPath,
      trustedSha256s: [fixture.sha256],
      expectedAppTranslationRows: 1,
      expectedSourceRows: 1,
      expectedSourceStringRows: 2,
    });
    return Object.freeze({ inventory, seed });
  };

  const exact = createFixture("exact");
  const memory = createLongTailSeedMemory(exact.inventory, [], exact.seed);
  assert.deepEqual(
    new Map(memory.entries.map((entry) => [entry.source, entry.value])),
    new Map([
      [afrikaansProductCopyHistoricalSource, expectedValue],
      [recallSource, recallExpectedValue],
    ]),
  );
  assert.equal(memory.conflicts.length, 0);
  const exactMaster = buildLongTailMasterWorklist({
    inventory: exact.inventory,
    provenance: fixtureProvenance(memory),
    seedMemory: memory,
  }).worklist;
  assert.doesNotThrow(() => assertLongTailExecutionSeedReadiness(exactMaster));

  const unseededMemory = createLongTailSeedMemory(exact.inventory);
  const unseededMaster = buildLongTailMasterWorklist({
    inventory: exact.inventory,
    provenance: fixtureProvenance(unseededMemory),
    seedMemory: unseededMemory,
  }).worklist;
  assert.throws(
    () => assertLongTailExecutionSeedReadiness(unseededMaster),
    /requires its exact validated seed.*--historical-seed-sql/,
  );

  const missing = createFixture("missing", { omitRouteWritingCoach: true });
  assert.throws(
    () => createLongTailSeedMemory(missing.inventory, [], missing.seed),
    (error: unknown) =>
      error instanceof LongTailPipelineError &&
      error.code === "LONG_TAIL_CONTRACT_INVALID" &&
      /missing route:home\/site\.031857a0f03861e726/.test(error.message),
  );

  const conflicting = createFixture("conflicting", {
    routeMathValue: "Wiskunde-stapafrigter",
  });
  assert.throws(
    () => createLongTailSeedMemory(
      conflicting.inventory,
      [],
      conflicting.seed,
    ),
    (error: unknown) =>
      error instanceof LongTailPipelineError &&
      error.code === "LONG_TAIL_CONFLICT" &&
      /conflicts for Math Step Coach/.test(error.message),
  );

  const completedButConflicting = createFixture("completed-conflicting", {
    completeProse: true,
    routeMathValue: "Wiskunde-stapafrigter",
  });
  assert.throws(
    () => createLongTailSeedMemory(
      completedButConflicting.inventory,
      [],
      completedButConflicting.seed,
    ),
    (error: unknown) =>
      error instanceof LongTailPipelineError &&
      error.code === "LONG_TAIL_CONFLICT" &&
      /conflicts for Math Step Coach/.test(error.message),
  );

  const drifted = createFixture("drifted", {
    routeSourceHash: sha256("drifted-route-home-source"),
  });
  assert.throws(
    () => createLongTailSeedMemory(drifted.inventory, [], drifted.seed),
    (error: unknown) =>
      error instanceof LongTailPipelineError &&
      error.code === "LONG_TAIL_SOURCE_DRIFT" &&
      /source drifted/.test(error.message),
  );

  assert.equal(
    composeLongTailEmbeddedSourcePhraseTranslations({
      source: afrikaansProductCopyHistoricalSource,
      value: "Math Step Coach, then Writing Coach.",
      replacements: new Map<string, string>([
        ["Math Step Coach", "Writing Coach"],
        ["Writing Coach", "Skryfafrigter"],
      ]),
    }),
    "Writing Coach, then Skryfafrigter.",
  );

  const canonicalAliasLeak = expectedValue.replace(
    "Vasvra my oor trivia",
    "Quiz me on Trivia",
  );
  assert.equal(
    inspectTranslationFieldFluency(
      afrikaansProductCopyHistoricalSource,
      canonicalAliasLeak,
      "Afrikaans",
    ).reason,
    "embedded-source-phrase",
  );
  assert.equal(
    inspectTranslationFieldFluency(
      afrikaansProductCopyHistoricalSource,
      historicalValue,
      "Afrikaans",
    ).reason,
    "embedded-source-phrase",
  );
});

test("tracked long-tail leakage repairs are exact and bundle-valid", () => {
  const trackedPackSchema = z.object({
    schemaVersion: z.literal(1),
    language: z.string().min(1),
    locale: z.string().min(1),
    namespace: z.string().min(1),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z.array(z.object({
      key: z.string().min(1),
      source: z.string(),
      value: z.string().min(1),
    }).strict()),
  }).passthrough();
  const exactRepairs = Object.freeze([
    Object.freeze({
      locale: "am",
      language: "Amharic" as const,
      namespace: "route:mission",
      key: "site.cd89221492c4621057",
      source: "AI can make one-to-one learning dramatically more available.",
      value:
        "AI አንድ-ለአንድ መማርን በእጅጉ የበለጠ ተደራሽ ማድረግ ይችላል።",
    }),
    Object.freeze({
      locale: "as",
      language: "Assamese" as const,
      namespace: "route:mission",
      key: "site.cd89221492c4621057",
      source: "AI can make one-to-one learning dramatically more available.",
      value: "AI-এ ব্যক্তিগত শিক্ষণক বহুত বেছি সহজলভ্য কৰি তুলিব পাৰে।",
    }),
    Object.freeze({
      locale: "de",
      language: "German" as const,
      namespace: "route:mission",
      key: "site.cd89221492c4621057",
      source: "AI can make one-to-one learning dramatically more available.",
      value: "KI kann Eins-zu-eins-Lernen wesentlich zugänglicher machen.",
    }),
    Object.freeze({
      locale: "fil",
      language: "Filipino" as const,
      namespace: "route:mission",
      key: "site.cd89221492c4621057",
      source: "AI can make one-to-one learning dramatically more available.",
      value:
        "Maaaring gawing lubhang mas abot-kamay ng AI ang isa-sa-isang pagkatuto.",
    }),
    Object.freeze({
      locale: "fa",
      language: "Persian" as const,
      namespace: "route:mission",
      key: "site.1cdc13506ff7254ed7",
      source:
        "Learners, parents, teachers, schools, and self-taught builders",
      value: "یادگیرندگان، والدین، معلمان، مدارس و سازندگان خودآموخته",
    }),
    Object.freeze({
      locale: "fa",
      language: "Persian" as const,
      namespace: "route:mission",
      key: "site.b763eb4401f65f0001",
      source: "Mission FAQ",
      value: "پرسش‌های متداول درباره مأموریت",
    }),
    Object.freeze({
      locale: "fa",
      language: "Persian" as const,
      namespace: "route:mission",
      key: "site.cd89221492c4621057",
      source: "AI can make one-to-one learning dramatically more available.",
      value:
        "هوش مصنوعی می‌تواند یادگیری یک‌به‌یک را به‌طور چشمگیری دسترس‌پذیرتر کند.",
    }),
    Object.freeze({
      locale: "mr",
      language: "Marathi" as const,
      namespace: "route:mission",
      key: "site.1cdc13506ff7254ed7",
      source:
        "Learners, parents, teachers, schools, and self-taught builders",
      value: "शिकणारे, पालक, शिक्षक, शाळा आणि स्वशिक्षित निर्माते",
    }),
    Object.freeze({
      locale: "ta",
      language: "Tamil" as const,
      namespace: "route:mission",
      key: "site.1cdc13506ff7254ed7",
      source:
        "Learners, parents, teachers, schools, and self-taught builders",
      value:
        "கற்றவர்கள், பெற்றோர், ஆசிரியர்கள், பள்ளிகள் மற்றும் சுயமாகக் கற்ற உருவாக்குநர்கள்",
    }),
    Object.freeze({
      locale: "ta",
      language: "Tamil" as const,
      namespace: "route:mission",
      key: "site.790d6791323a475c39",
      source: "White-labelled AI chat",
      value: "தனிப்பயன் பிராண்டுடன் கூடிய AI அரட்டை",
    }),
    Object.freeze({
      locale: "ta",
      language: "Tamil" as const,
      namespace: "route:mission",
      key: "site.b763eb4401f65f0001",
      source: "Mission FAQ",
      value: "நோக்கம் குறித்த அடிக்கடி கேட்கப்படும் கேள்விகள்",
    }),
    Object.freeze({
      locale: "fa",
      language: "Persian" as const,
      namespace: "route:home",
      key: "site.031857a0f03861e726",
      source: "Writing Coach",
      value: "مربی نوشتن",
    }),
  ] as const);
  const packs = new Map<string, z.infer<typeof trackedPackSchema>>();
  for (const repair of exactRepairs) {
    const identity = `${repair.locale}\u0000${repair.namespace}`;
    let pack = packs.get(identity);
    if (!pack) {
      pack = trackedPackSchema.parse(JSON.parse(readFileSync(path.join(
        process.cwd(),
        "translations/curated",
        repair.locale,
        `${repair.namespace.replace(/[^a-z0-9.-]+/gi, "__")}.json`,
      ), "utf8")));
      packs.set(identity, pack);
    }
    assert.equal(pack.language, repair.language);
    assert.equal(pack.locale, repair.locale);
    assert.equal(pack.namespace, repair.namespace);
    const entry = pack.entries.find((candidate) => candidate.key === repair.key);
    assert.deepEqual(entry, {
      key: repair.key,
      source: repair.source,
      value: repair.value,
    });
    assert.deepEqual(validateTranslationCandidateField({
      language: repair.language,
      source: repair.source,
      value: repair.value,
    }).failures, []);
    assert.equal(
      isValidFieldTranslation(
        repair.source,
        repair.value,
        repair.language,
        repair.key,
      ),
      true,
    );
    assert.equal(hasExactLongTailInvariantParity(repair.source, repair.value), true);
    assert.equal(inspectTranslationFieldFluency(
      repair.source,
      repair.value,
      repair.language,
      {
        namespace: repair.namespace,
        sourceHash: pack.sourceHash,
        key: repair.key,
      },
    ).reason, null);
  }

  for (const [identity, pack] of packs) {
    const repair = exactRepairs.find(
      (candidate) =>
        identity === `${candidate.locale}\u0000${candidate.namespace}`,
    );
    assert.ok(repair);
    const source = getSiteTranslationSource(repair.namespace);
    assert.equal(pack.sourceHash, source.sourceHash);
    const bundle = {
      namespace: repair.namespace,
      language: repair.language,
      sourceHash: pack.sourceHash,
      sourceStrings: source.sourceStrings,
      strings: Object.fromEntries(
        pack.entries.map((entry) => [entry.key, entry.value]),
      ),
    };
    assert.equal(
      isTranslationBundleFieldValid(source, bundle, repair.language),
      true,
    );
    assert.equal(
      isTranslationBundleCompleteAndFluent(source, bundle, repair.language),
      true,
    );
  }
});

test("conflicting historical values are excluded from seed memory", (t) => {
  const root = temporaryDirectory(t);
  const directory = historicalSqlFixtureDirectory(t);
  const source = "Save your progress in <strong>inspir</strong>.";
  const key = `site.${sha1(source).slice(0, 18)}`;
  const namespaces = ["route:conflict-one", "route:conflict-two"] as const;
  const values = [
    "Guarda tu progreso en <strong>inspir</strong>.",
    "Conserva tu progreso en <strong>inspir</strong>.",
  ] as const;
  const rows = namespaces.flatMap((namespace, index) => {
    const sourceHash = sha256(`historical-${namespace}`);
    return [
      historicalSourceInsert({ namespace, sourceHash }),
      historicalSourceStringInsert({ namespace, key, source }),
      historicalAppTranslationInsert({
        namespace,
        sourceHash,
        payloadJson: JSON.stringify({ [key]: values[index] }),
      }),
    ];
  });
  const fixture = writeHistoricalSqlFixture({
    directory,
    filename: "conflicting-seeds.sql",
    lines: rows,
  });
  const seed = loadLongTailHistoricalTranslationSqlSeed({
    repoRoot: process.cwd(),
    sqlPath: fixture.sqlPath,
    trustedSha256s: [fixture.sha256],
    expectedAppTranslationRows: namespaces.length,
    expectedSourceRows: namespaces.length,
    expectedSourceStringRows: namespaces.length,
  });
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot: path.join(root, "curated"),
    sources: Object.freeze(namespaces.map((namespace) => Object.freeze({
      namespace,
      sourceHash: sha256(`current-${namespace}`),
      sourceStrings: Object.freeze({ [key]: source }),
    }))),
  });
  const memory = createLongTailSeedMemory(inventory, [], seed);
  assert.equal(memory.entries.length, 0);
  assert.deepEqual(memory.conflicts, [{
    language: "Spanish",
    locale: "es",
    sourceSha256: sha256(source),
  }]);
});

test("production worklist enumerates the exact deterministic 65 × 121 gap", () => {
  const inventory = createProductionLongTailInventory(process.cwd());
  const seedMemory = createLongTailSeedMemory(
    inventory,
    PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
  );
  const provenance = fixtureProvenance(seedMemory);
  const first = buildLongTailMasterWorklist({
    inventory,
    provenance,
    seedMemory,
    replaceSourceStale: true,
    replaceQualityStale: true,
    sourceStaleReplacementApprovals:
      PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
  });
  const reversed = buildLongTailMasterWorklist({
    inventory: Object.freeze({
      ...inventory,
      languages: Object.freeze([...inventory.languages].reverse()),
      sources: Object.freeze([...inventory.sources].reverse()),
    }),
    provenance,
    seedMemory,
    replaceSourceStale: true,
    replaceQualityStale: true,
    sourceStaleReplacementApprovals:
      PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
  });

  assert.equal(first.missingPacks, 7_865);
  assert.equal(first.sourceStalePacks, 12);
  assert.equal(first.qualityStalePacks, 80);
  assert.equal(first.completedPacks, 668);
  assert.equal(first.totalPacks, 8_625);
  assert.equal(first.worklist.jobs.filter((job) => !job.replacement).length, 7_865);
  assert.equal(first.worklist.jobs.filter((job) => job.replacement).length, 92);
  assert.deepEqual(
    first.worklist.jobs.flatMap((job) =>
      job.replacement?.kind === LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND
        ? [
          `${job.language}\u0000${job.namespace}\u0000${job.replacement.priorSourceHash}\u0000${job.sourceHash}`,
        ]
        : []
    )
      .sort(),
    PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS
      .map((approval) =>
        `${approval.language}\u0000${approval.namespace}\u0000${approval.priorSourceHash}\u0000${approval.newSourceHash}`
      )
      .sort(),
  );
  assert.equal(first.missingTargetLanguages.length, 65);
  assert.equal(first.missingTargetNamespaces.length, 121);
  assert.equal(first.sourceStaleTargetLanguages.length, 4);
  assert.equal(first.sourceStaleTargetNamespaces.length, 3);
  assert.deepEqual(first.qualityStaleTargetLanguages, [
    "Arabic",
    "Hindi",
    "Spanish",
  ]);
  assert.equal(first.qualityStaleTargetNamespaces.length, 55);
  assert.equal(first.targetLanguages.length, 69);
  assert.equal(first.targetNamespaces.length, 121);
  assert.equal(first.worklist.jobs.length, 65 * 121 + 12 + 80);
  assert.equal(seedMemory.entries.length, 75_884);
  assert.equal(seedMemory.conflicts.length, 1_675);
  assert.deepEqual(calculateLongTailWorkload(first.worklist), {
    packFields: 922_743,
    uniqueSourceLanguagePairs: 284_204,
    seededUniqueSourceLanguagePairs: 75_874,
    modelSourceLanguagePairs: 208_330,
    rejectedSeedConflicts: 1_675,
  });
  const smoke = createLongTailSmokeWorklist(first.worklist, 1);
  const smokeWorkload = calculateLongTailWorkload(smoke);
  assert.equal(smoke.jobs.length, 1);
  assert.equal(smoke.jobs.some((job) => job.replacement), false);
  assert.ok(smokeWorkload.modelSourceLanguagePairs > 0);
  const afrikaansSmoke = createLongTailLocaleSmokeWorklist(
    first.worklist,
    "af",
  );
  assert.equal(afrikaansSmoke.sources.length, 125);
  assert.equal(afrikaansSmoke.jobs.length, 121);
  assert.ok(afrikaansSmoke.jobs.every((job) => job.locale === "af"));
  assert.equal(
    afrikaansSmoke.jobs.filter(
      (job) =>
        job.replacement?.kind ===
          LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND,
    ).length,
    0,
  );
  assert.equal(
    first.worklist.worklistSha256,
    reversed.worklist.worklistSha256,
  );
  assert.deepEqual(first.worklist.jobs, reversed.worklist.jobs);

  const workerPlan = createLongTailWorkerPlan({
    jobs: first.worklist.jobs,
    requestedWorkers: 4,
  });
  assert.equal(workerPlan.length, 4);
  const assigned = workerPlan.flatMap((worker) => worker.jobSha256s);
  assert.equal(assigned.length, 7_957);
  assert.equal(new Set(assigned).size, 7_957);
  assert.deepEqual(
    new Set(assigned),
    new Set(first.worklist.jobs.map((job) => job.jobSha256)),
  );
});

test("production inventory state accepts exact original, repair, and complete shapes", () => {
  assert.equal(classifyLongTailProductionInventoryState({
    missingPacks: 7_865,
    sourceStalePacks: 0,
    qualityStalePacks: 0,
    completedPacks: 760,
    totalPacks: 8_625,
    missingTargetLanguages: 65,
    missingTargetNamespaces: 121,
  }), "original-gap");
  assert.equal(classifyLongTailProductionInventoryState({
    missingPacks: 7_865,
    sourceStalePacks: 3,
    qualityStalePacks: 0,
    completedPacks: 757,
    totalPacks: 8_625,
    missingTargetLanguages: 65,
    missingTargetNamespaces: 121,
  }), "source-stale-gap");
  assert.equal(classifyLongTailProductionInventoryState({
    missingPacks: 7_865,
    sourceStalePacks: 12,
    qualityStalePacks: 80,
    completedPacks: 668,
    totalPacks: 8_625,
    missingTargetLanguages: 65,
    missingTargetNamespaces: 121,
  }), "repair-gap");
  assert.equal(classifyLongTailProductionInventoryState({
    missingPacks: 0,
    sourceStalePacks: 0,
    qualityStalePacks: 0,
    completedPacks: 8_625,
    totalPacks: 8_625,
    missingTargetLanguages: 0,
    missingTargetNamespaces: 0,
  }), "fully-complete");
  assert.equal(classifyLongTailProductionInventoryState({
    missingPacks: 7_864,
    sourceStalePacks: 0,
    qualityStalePacks: 0,
    completedPacks: 761,
    totalPacks: 8_625,
    missingTargetLanguages: 65,
    missingTargetNamespaces: 121,
  }), "unexpected");
});

test("source-stale approval is available to dry-run and candidate-only smoke", () => {
  assert.throws(
    () => parseLongTailCliOptions(["--allow-overwrite-existing"]),
    /Unknown long-tail pipeline option/,
  );
  const dryRun = parseLongTailCliOptions(["--replace-source-stale"]);
  assert.equal(dryRun.execute, false);
  assert.equal(dryRun.promote, false);
  assert.equal(dryRun.replaceSourceStale, true);
  assert.equal(dryRun.replaceQualityStale, false);
  const historicalSeedSql =
    "tmp/cloudflare-reports/cloudflare/trusted-translation-seed.sql";
  assert.equal(
    parseLongTailCliOptions([
      "--historical-seed-sql",
      historicalSeedSql,
    ]).historicalSeedSql,
    historicalSeedSql,
  );
  const smoke = parseLongTailCliOptions([
    "--execute",
    "--replace-source-stale",
    "--smoke-packs=1",
  ]);
  assert.equal(smoke.execute, true);
  assert.equal(smoke.promote, false);
  assert.equal(smoke.replaceSourceStale, true);
  assert.equal(smoke.smokePacks, 1);
  assert.equal(
    smoke.runDirectory,
    "tmp/long-tail-translation-smoke-source-stale-v10",
  );
  const promotion = parseLongTailCliOptions([
    "--execute",
    "--promote",
    "--replace-source-stale",
    "--replace-quality-stale",
  ]);
  assert.equal(promotion.execute, true);
  assert.equal(promotion.promote, true);
  assert.equal(promotion.replaceSourceStale, true);
  assert.equal(promotion.replaceQualityStale, true);
  const localeSmoke = parseLongTailCliOptions([
    "--execute",
    "--replace-source-stale",
    "--replace-quality-stale",
    "--smoke-locale=af",
  ]);
  assert.equal(localeSmoke.smokeLocale, "af");
  assert.equal(
    localeSmoke.runDirectory,
    "tmp/long-tail-translation-smoke-af-v10",
  );
  assert.equal(localeSmoke.promote, false);
  const stagedAfrikaans = parseLongTailCliOptions([
    "--execute",
    "--promote-smoke-locale=af",
    "--staged-english-fallback-release",
    "--replace-source-stale",
    "--replace-quality-stale",
  ]);
  assert.equal(stagedAfrikaans.promote, true);
  assert.equal(stagedAfrikaans.promoteSmokeLocale, "af");
  assert.equal(stagedAfrikaans.stagedEnglishFallbackRelease, true);
  assert.equal(
    stagedAfrikaans.runDirectory,
    "tmp/long-tail-translation-smoke-af-v10",
  );
  assert.throws(
    () => parseLongTailCliOptions([
      "--execute",
      "--promote-smoke-locale=af",
    ]),
    /must be supplied together/,
  );
  assert.throws(
    () => parseLongTailCliOptions([
      "--execute",
      "--promote-smoke-locale=nl",
      "--staged-english-fallback-release",
    ]),
    /requires --execute --promote-smoke-locale af/,
  );
  assert.throws(
    () => parseLongTailCliOptions([
      "--execute",
      "--promote-smoke-locale=af",
      "--staged-english-fallback-release",
      "--promote",
    ]),
    /cannot be combined with --promote/,
  );
  for (const forbidden of [
    ["--expected-packs=1"],
    ["--workers=2", "--device=cpu", "--dtype=float32"],
  ]) {
    assert.throws(
      () => parseLongTailCliOptions([
        "--execute",
        "--promote-smoke-locale=af",
        "--staged-english-fallback-release",
        ...forbidden,
      ]),
      /exactly one worker.*--expected-packs override/,
    );
  }
  assert.throws(
    () => parseLongTailCliOptions([
      "--execute",
      "--smoke-locale=af",
      "--staged-english-fallback-release",
      "--promote-smoke-locale=af",
    ]),
    /mutually exclusive/,
  );
  const runtimeSmoke = parseLongTailCliOptions([
    "--runtime-smoke",
    "--device=mps",
    "--dtype=float16",
  ]);
  assert.equal(runtimeSmoke.runtimeSmoke, true);
  assert.equal(runtimeSmoke.execute, false);
  assert.throws(
    () => parseLongTailCliOptions(["--runtime-smoke", "--execute"]),
    /read-only standalone gate/,
  );
  assert.throws(
    () => parseLongTailCliOptions([
      "--execute",
      "--smoke-locale=af",
      "--smoke-packs=1",
    ]),
    /mutually exclusive/,
  );
  assert.throws(
    () => parseLongTailCliOptions(["--execute", "--smoke-locale=en"]),
    /supported non-English locale/,
  );
});

test("quality-stale mode is orthogonal to the exact source-stale allowlist", () => {
  const options = parseLongTailCliOptions(["--replace-quality-stale"]);
  assert.equal(options.replaceQualityStale, true);
  assert.equal(options.replaceSourceStale, false);
  assert.equal(PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS.length, 12);
  assert.deepEqual(
    [...new Set(PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS.map(
      (approval) => approval.language,
    ))].sort(),
    ["Arabic", "Hindi", "Malayalam", "Spanish"],
  );
  assert.deepEqual(
    [...new Set(PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS.map(
      (approval) =>
        `${approval.namespace}\u0000${approval.priorSourceHash}\u0000${approval.newSourceHash}`,
    ))].sort(),
    [
      "legal:privacy\u000091c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a\u000028716f737f9e79719469e06bfbbca5084c1e533315b1b9ef5fa6f270503e67bb",
      "legal:terms\u0000fff6b8bcbcaa4ebe5be2eda02d0d4b3f54f7383acb7837245ca73c16b84f01e8\u0000f8f20182b03b4c9fa33c4c90dd7f765e65b61206e43ee1ec15f7e88c3c30dc0b",
      "legal:tnc\u0000330fd5f27bd9bdf95efc483b3f61dfc02a61cee56aa3ca8688715973d14d151b\u0000f8f20182b03b4c9fa33c4c90dd7f765e65b61206e43ee1ec15f7e88c3c30dc0b",
    ],
  );
});

test("source-stale jobs require an exact approval and seed only validated source text", (t) => {
  const root = temporaryDirectory(t);
  const curatedRoot = path.join(root, "curated");
  const namespace = "legal:privacy";
  const priorSourceHash = sha256("prior-privacy-source");
  const newSourceHash = sha256("new-privacy-source");
  const sharedSource = "Keep your account secure.";
  const sharedValue = "Mantén tu cuenta segura.";
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot,
    sources: Object.freeze([Object.freeze({
      namespace,
      sourceHash: newSourceHash,
      sourceStrings: Object.freeze({
        shared: sharedSource,
        added: "Review the updated privacy notice.",
      }),
    })]),
  });
  const stale = writeSyntheticCuratedPack({
    curatedRoot,
    locale: "es",
    namespace,
    value: {
      schemaVersion: 1,
      language: "Spanish",
      locale: "es",
      namespace,
      sourceHash: priorSourceHash,
      entries: [
        { key: "untrusted.old.key", source: sharedSource, value: sharedValue },
        {
          key: "removed.key",
          source: "This sentence existed only in the prior source.",
          value: "Esta frase solo existía en la fuente anterior.",
        },
        {
          key: "invalid.copy",
          source: "Delete your account.",
          value: "Delete your account.",
        },
      ],
    },
  });
  const approval = sourceStaleApproval({
    namespace,
    priorSourceHash,
    newSourceHash,
  });
  const seedMemory = createLongTailSeedMemory(inventory, [approval]);
  assert.deepEqual(
    seedMemory.entries.map((entry) => ({
      source: entry.source,
      value: entry.value,
    })),
    [{ source: sharedSource, value: sharedValue }],
  );
  assert.equal(seedMemory.conflicts.length, 0);
  const provenance = fixtureProvenance(seedMemory);
  assert.throws(
    () => buildLongTailMasterWorklist({
      inventory,
      provenance,
      seedMemory,
      sourceStaleReplacementApprovals: [approval],
    }),
    /requires explicit replacement mode/,
  );
  assert.throws(
    () => buildLongTailMasterWorklist({
      inventory,
      provenance,
      seedMemory,
      replaceSourceStale: true,
      sourceStaleReplacementApprovals: [],
    }),
    /not bound to an exact approved prior\/new source-hash pair/,
  );
  const build = buildLongTailMasterWorklist({
    inventory,
    provenance,
    seedMemory,
    replaceSourceStale: true,
    sourceStaleReplacementApprovals: [approval],
  });
  assert.equal(build.missingPacks, 0);
  assert.equal(build.sourceStalePacks, 1);
  assert.equal(build.completedPacks, 0);
  assert.equal(build.totalPacks, 1);
  const job = build.worklist.jobs[0];
  assert.ok(job?.replacement);
  assert.deepEqual(job.replacement, {
    kind: LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND,
    existingFileSha256: stale.sha256,
    priorSourceHash,
  });
  assert.deepEqual(Object.keys(job.replacement).sort(), [
    "existingFileSha256",
    "kind",
    "priorSourceHash",
  ]);
});

test("quality-stale packs require an explicit mode and bind source, validator, and exact bytes", (t) => {
  const root = temporaryDirectory(t);
  const curatedRoot = path.join(root, "curated");
  const runDirectory = path.join(root, "run");
  const namespace = "test:quality-stale";
  const sourceHash = sha256("quality-stale-current-source");
  const source = "Build confidence with personalized practice.";
  const fluentValue = "Gana confianza con práctica personalizada.";
  const qualityStale = writeSyntheticCuratedPack({
    curatedRoot,
    locale: "es",
    namespace,
    value: {
      schemaVersion: 1,
      language: "Spanish",
      locale: "es",
      namespace,
      sourceHash,
      translations: {
        current:
          "Gana confianza con Build confidence with práctica personalizada.",
      },
    },
  });
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot,
    sources: Object.freeze([Object.freeze({
      namespace,
      sourceHash,
      sourceStrings: Object.freeze({ current: source }),
    })]),
  });
  const seedMemory = createLongTailSeedMemory(inventory);
  const provenance = fixtureProvenance(seedMemory);

  assert.throws(
    () => buildLongTailMasterWorklist({
      inventory,
      provenance,
      seedMemory,
    }),
    /Quality-stale curated pack.*requires explicit replacement mode/,
  );
  assert.throws(
    () => buildLongTailMasterWorklist({
      inventory,
      provenance,
      seedMemory,
      replaceSourceStale: true,
    }),
    /Quality-stale curated pack.*requires explicit replacement mode/,
  );

  const build = buildLongTailMasterWorklist({
    inventory,
    provenance,
    seedMemory,
    replaceQualityStale: true,
  });
  assert.deepEqual({
    completed: build.completedPacks,
    missing: build.missingPacks,
    qualityStale: build.qualityStalePacks,
    sourceStale: build.sourceStalePacks,
    total: build.totalPacks,
  }, {
    completed: 0,
    missing: 0,
    qualityStale: 1,
    sourceStale: 0,
    total: 1,
  });
  const job = build.worklist.jobs[0];
  assert.ok(job);
  if (job.replacement?.kind !== LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND) {
    assert.fail("Expected an exact quality-stale replacement binding.");
  }
  assert.deepEqual(job.replacement, {
    kind: LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND,
    existingFileSha256: qualityStale.sha256,
    sourceHash,
    validatorPolicySha256: provenance.validatorPolicy.validatorPolicySha256,
  });
  assert.deepEqual(Object.keys(job.replacement).sort(), [
    "existingFileSha256",
    "kind",
    "sourceHash",
    "validatorPolicySha256",
  ]);

  const rebindMaster = (
    replacement: typeof job.replacement,
  ) => {
    const { jobSha256: _priorJobSha256, ...priorJobMaterial } = job;
    assert.match(_priorJobSha256, /^[a-f0-9]{64}$/);
    const nextJobMaterial = { ...priorJobMaterial, replacement };
    const nextJob = {
      ...nextJobMaterial,
      jobSha256: sha256Canonical(nextJobMaterial),
    };
    const { worklistSha256: _priorWorklistSha256, ...priorMasterMaterial } =
      build.worklist;
    assert.match(_priorWorklistSha256, /^[a-f0-9]{64}$/);
    const nextMasterMaterial = { ...priorMasterMaterial, jobs: [nextJob] };
    return Object.freeze({
      master: Object.freeze({
        ...nextMasterMaterial,
        worklistSha256: sha256Canonical(nextMasterMaterial),
      }),
      job: Object.freeze(nextJob),
    });
  };
  for (const replacement of [
    { ...job.replacement, sourceHash: sha256("drifted-current-source") },
    {
      ...job.replacement,
      validatorPolicySha256: sha256("drifted-validator-policy"),
    },
  ]) {
    const rebound = rebindMaster(replacement);
    assert.throws(
      () => createLongTailPackWorklist(rebound),
      /Long-tail job contract is invalid/,
    );
  }

  materializeLongTailWorklists({ master: build.worklist, runDirectory });
  writeCandidate({
    master: build.worklist,
    job,
    candidateRoot: path.join(runDirectory, "candidates"),
    values: { current: fluentValue },
  });
  writeFileSync(
    qualityStale.file,
    Buffer.concat([qualityStale.bytes, Buffer.from("\n", "utf8")]),
  );
  assert.throws(
    () => validateLongTailPromotionBatch({
      master: build.worklist,
      runDirectory,
      curatedRoot,
    }),
    /Curated target changed before promotion/,
  );
  writeFileSync(qualityStale.file, qualityStale.bytes);

  const promotion = promoteLongTailCandidateBatch({
    master: build.worklist,
    runDirectory,
    curatedRoot,
    transactionRoot: path.join(runDirectory, "promotion-snapshot"),
  });
  assert.deepEqual(promotion.publications, {
    created: 0,
    replayed: 0,
    replaced: 1,
  });
  assert.equal(promotion.backups.length, 1);
  const backup = promotion.backups[0];
  assert.ok(backup);
  assert.equal(backup.targetRelativePath, job.targetRelativePath);
  assert.equal(
    backup.relativePath,
    `es/test__quality-stale.overwritten-${qualityStale.sha256}.json`,
  );
  assert.equal(backup.sha256, qualityStale.sha256);
  assert.equal(
    backup.kind,
    "inspir-long-tail-quality-stale-replacement-approval-v1",
  );
  assert.equal(backup.approvedExistingSha256, qualityStale.sha256);
  assert.equal(backup.priorSourceHash, sourceHash);
  assert.equal(backup.newSourceHash, sourceHash);
  assert.equal(
    backup.validatorPolicySha256,
    provenance.validatorPolicy.validatorPolicySha256,
  );
  assert.match(backup.approvalSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Buffer.from(backup.bytes), qualityStale.bytes);
  assert.deepEqual(
    readFileSync(path.join(
      runDirectory,
      "quarantine/overwritten",
      `es/test__quality-stale.overwritten-${qualityStale.sha256}.json`,
    )),
    qualityStale.bytes,
  );
  const promoted: unknown = JSON.parse(
    readFileSync(qualityStale.file, "utf8"),
  );
  assert.ok(promoted && typeof promoted === "object");
  assert.equal(Reflect.get(promoted, "sourceHash"), sourceHash);
  const translations: unknown = Reflect.get(promoted, "translations");
  assert.ok(translations && typeof translations === "object");
  assert.equal(Reflect.get(translations, "current"), fluentValue);
});

test("legacy conflicts are excluded and compact stale packs cannot seed", (t) => {
  const root = temporaryDirectory(t);
  const curatedRoot = path.join(root, "curated");
  const sharedSource = "Always keep your account secure.";
  const definitions = [
    {
      namespace: "legal:privacy",
      priorSourceHash: sha256("privacy-prior"),
      newSourceHash: sha256("privacy-new"),
      value: "Protege siempre tu cuenta.",
    },
    {
      namespace: "legal:terms",
      priorSourceHash: sha256("terms-prior"),
      newSourceHash: sha256("terms-new"),
      value: "Mantén siempre segura tu cuenta.",
    },
  ];
  for (const definition of definitions) {
    writeSyntheticCuratedPack({
      curatedRoot,
      locale: "es",
      namespace: definition.namespace,
      value: {
        schemaVersion: 1,
        language: "Spanish",
        locale: "es",
        namespace: definition.namespace,
        sourceHash: definition.priorSourceHash,
        entries: [{ key: "legacy.key", source: sharedSource, value: definition.value }],
      },
    });
  }
  const compactNamespace = "legal:tnc";
  const compactPriorHash = sha256("tnc-prior");
  const compactNewHash = sha256("tnc-new");
  writeSyntheticCuratedPack({
    curatedRoot,
    locale: "es",
    namespace: compactNamespace,
    value: {
      schemaVersion: 1,
      language: "Spanish",
      locale: "es",
      namespace: compactNamespace,
      sourceHash: compactPriorHash,
      translations: { "untrusted.old.key": "Lee atentamente este acuerdo." },
    },
  });
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot,
    sources: Object.freeze([
      ...definitions.map((definition) => Object.freeze({
        namespace: definition.namespace,
        sourceHash: definition.newSourceHash,
        sourceStrings: Object.freeze({ shared: sharedSource }),
      })),
      Object.freeze({
        namespace: compactNamespace,
        sourceHash: compactNewHash,
        sourceStrings: Object.freeze({ current: "Read this agreement carefully." }),
      }),
    ]),
  });
  const approvals = [
    ...definitions.map((definition) => sourceStaleApproval(definition)),
    sourceStaleApproval({
      namespace: compactNamespace,
      priorSourceHash: compactPriorHash,
      newSourceHash: compactNewHash,
    }),
  ];
  const memory = createLongTailSeedMemory(inventory, approvals);
  assert.equal(memory.entries.length, 0);
  assert.deepEqual(memory.conflicts, [{
    language: "Spanish",
    locale: "es",
    sourceSha256: sha256(sharedSource),
  }]);
});

test("promotion preflights every target and replaces only exact approved stale bytes", (t) => {
  const root = temporaryDirectory(t);
  const curatedRoot = path.join(root, "curated");
  const runDirectory = path.join(root, "run");
  const namespace = "legal:privacy";
  const priorSourceHash = sha256("promotion-prior-source");
  const newSourceHash = sha256("promotion-new-source");
  const stale = writeSyntheticCuratedPack({
    curatedRoot,
    locale: "es",
    namespace,
    value: {
      schemaVersion: 1,
      language: "Spanish",
      locale: "es",
      namespace,
      sourceHash: priorSourceHash,
      entries: [{
        key: "old.key",
        source: "Keep your account secure.",
        value: "Mantén tu cuenta segura.",
      }],
    },
  });
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot,
    sources: Object.freeze([
      Object.freeze({
        namespace,
        sourceHash: newSourceHash,
        sourceStrings: Object.freeze({
          current: "Review the updated privacy notice.",
        }),
      }),
      Object.freeze({
        namespace: "test:new",
        sourceHash: sha256("new-pack-source"),
        sourceStrings: Object.freeze({
          current: "Create a private study plan.",
        }),
      }),
    ]),
  });
  const approval = sourceStaleApproval({
    namespace,
    priorSourceHash,
    newSourceHash,
  });
  const seedMemory = createLongTailSeedMemory(inventory, [approval]);
  const build = buildLongTailMasterWorklist({
    inventory,
    provenance: fixtureProvenance(seedMemory),
    seedMemory,
    replaceSourceStale: true,
    sourceStaleReplacementApprovals: [approval],
  });
  assert.equal(build.missingPacks, 1);
  assert.equal(build.sourceStalePacks, 1);
  const smokeWorklist = createLongTailSmokeWorklist(build.worklist, 1);
  assert.equal(smokeWorklist.jobs[0]?.namespace, "test:new");
  assert.equal(smokeWorklist.jobs[0]?.replacement, undefined);
  materializeLongTailWorklists({ master: build.worklist, runDirectory });
  const candidateRoot = path.join(runDirectory, "candidates");
  for (const job of build.worklist.jobs) {
    writeCandidate({
      master: build.worklist,
      job,
      candidateRoot,
      values: job.namespace === namespace
        ? { current: "Revisa el aviso de privacidad actualizado." }
        : { current: "Crea un plan de estudio privado." },
    });
  }
  assert.throws(
    () => validateLongTailPromotionBatch({
      master: build.worklist,
      runDirectory,
      curatedRoot,
    }),
    /not present in the exact approval set/,
  );
  writeFileSync(stale.file, Buffer.concat([stale.bytes, Buffer.from("\n")]));
  assert.throws(
    () => validateLongTailPromotionBatch({
      master: build.worklist,
      runDirectory,
      curatedRoot,
      sourceStaleReplacementApprovals: [approval],
    }),
    /changed before promotion/,
  );
  assert.equal(
    existsSync(path.join(curatedRoot, "es", "test__new.json")),
    false,
  );
  writeFileSync(stale.file, stale.bytes);
  validateLongTailPromotionBatch({
    master: build.worklist,
    runDirectory,
    curatedRoot,
    sourceStaleReplacementApprovals: [approval],
  });
  const quarantineRoot = path.join(runDirectory, "quarantine");
  const transactionRoot = path.join(runDirectory, "promotion-snapshot");
  assert.throws(
    () => promoteLongTailCandidateBatch({
      master: build.worklist,
      runDirectory,
      curatedRoot,
      transactionRoot,
      sourceStaleReplacementApprovals: [approval],
      promotionCrashHook: (point) => {
        if (point === "after-committed-parent-fsync") {
          throw new Error("simulated post-commit caller interruption");
        }
      },
    }),
    /simulated post-commit caller interruption/,
  );
  const promotion = promoteLongTailCandidateBatch({
    master: build.worklist,
    runDirectory,
    curatedRoot,
    transactionRoot,
    sourceStaleReplacementApprovals: [approval],
  });
  assert.equal(promotion.outcome, "exact-replay");
  assert.deepEqual(promotion.publications, {
    created: 1,
    replayed: 0,
    replaced: 1,
  });
  const backup = path.join(
    quarantineRoot,
    "overwritten",
    "es",
    `legal__privacy.overwritten-${stale.sha256}.json`,
  );
  assert.deepEqual(readFileSync(backup), stale.bytes);

  const completedSeed = createLongTailSeedMemory(inventory, [approval]);
  const completed = buildLongTailMasterWorklist({
    inventory,
    provenance: fixtureProvenance(completedSeed),
    seedMemory: completedSeed,
    replaceSourceStale: true,
    sourceStaleReplacementApprovals: [approval],
  });
  assert.equal(completed.worklist.jobs.length, 0);
  assert.equal(completed.completedPacks, 2);
  const alreadyComplete = promoteLongTailCandidateBatch({
    master: completed.worklist,
    runDirectory,
    curatedRoot,
    transactionRoot: path.join(runDirectory, "unused-complete-snapshot"),
    sourceStaleReplacementApprovals: [approval],
  });
  assert.deepEqual(alreadyComplete, {
    transactionId: null,
    outcome: "already-complete",
    activeTreeSha256: null,
    activeRoot: path.resolve(curatedRoot),
    priorRoot: null,
    publications: { created: 0, replayed: 0, replaced: 0 },
    checkpoints: [],
    backups: [],
    finalized: null,
    candidatesValidated: 0,
  });
  assert.equal(
    existsSync(path.join(runDirectory, "unused-complete-snapshot")),
    false,
  );
});

test("current-hash structural invalidity remains non-replaceable in every stale mode", (t) => {
  const root = temporaryDirectory(t);
  const curatedRoot = path.join(root, "curated");
  const namespace = "legal:privacy";
  const currentSourceHash = sha256("current-invalid-source");
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot,
    sources: Object.freeze([Object.freeze({
      namespace,
      sourceHash: currentSourceHash,
      sourceStrings: Object.freeze({ current: "Use a strong password." }),
    })]),
  });
  writeSyntheticCuratedPack({
    curatedRoot,
    locale: "es",
    namespace,
    value: {
      schemaVersion: 1,
      language: "Spanish",
      locale: "es",
      namespace,
      sourceHash: currentSourceHash,
      translations: { wrong: "Usa una contraseña segura." },
    },
  });
  const seedMemory = createLongTailSeedMemory(inventory);
  assert.throws(
    () => buildLongTailMasterWorklist({
      inventory,
      provenance: fixtureProvenance(seedMemory),
      seedMemory,
      replaceSourceStale: true,
      replaceQualityStale: true,
      sourceStaleReplacementApprovals: [sourceStaleApproval({
        namespace,
        priorSourceHash: sha256("some-prior-source"),
        newSourceHash: currentSourceHash,
      })],
    }),
    /malformed or invalid for its current source hash/,
  );
});

test("literal invariants preserve original order, duplicates, tags, URLs, and numbers", () => {
  const source =
    "Open <strong>{first}</strong> before <em>{second}</em> at https://example.com in 2026, then {first}.";
  assert.equal(
    hasExactLongTailInvariantParity(
      source,
      "Abre <strong>{first}</strong> antes de <em>{second}</em> en https://example.com en 2026, luego {first}.",
    ),
    true,
  );
  assert.equal(
    hasExactLongTailInvariantParity(
      source,
      "Abre <strong>{second}</strong> antes de <em>{first}</em> en https://example.com en 2026, luego {first}.",
    ),
    false,
  );
  assert.equal(
    hasExactLongTailInvariantParity(
      source,
      "Abre </strong>{first}<strong> antes de <em>{second}</em> en https://example.com en 2026, luego {first}.",
    ),
    false,
  );
  assert.equal(
    hasExactLongTailInvariantParity(
      source,
      "Abre <strong>{first}</strong> antes de <em>{second}</em> en https://example.org en 2026, luego {first}.",
    ),
    false,
  );
  assert.equal(
    hasExactLongTailInvariantParity(
      source,
      "Abre <strong>{first}</strong> antes de <em>{second}</em> en https://example.com en 2027, luego {first}.",
    ),
    false,
  );
});

test("worker preflight reports exact retry reasons and accepts a fluent replacement", (t) => {
  const root = temporaryDirectory(t);
  const build = buildLongTailMasterWorklist({
    inventory: fixtureInventory(root),
    provenance: fixtureProvenance(),
    seedMemory: fixtureSeedMemory,
  });
  const job = build.worklist.jobs.find(
    (candidate) => candidate.namespace === "test:one",
  );
  assert.ok(job);
  const pack = createLongTailPackWorklist({ master: build.worklist, job });
  const source = pack.source.entries[0]?.source;
  assert.ok(source);

  const failures = inspectLongTailCandidateRetryFailures({
    pack,
    values: { first: source },
  });
  assert.deepEqual(failures.map((failure) => failure.key), ["first"]);
  assert.ok(failures[0]?.reasons.includes("source-equality"));
  assert.ok(failures[0]?.reasons.includes("field-fluency"));

  assert.deepEqual(
    inspectLongTailCandidateRetryFailures({
      pack,
      values: fixtureValues(job),
    }),
    [],
  );
});

test("worker validation sidecar exposes the exact retry preflight over NDJSON", async (t) => {
  const root = temporaryDirectory(t);
  const build = buildLongTailMasterWorklist({
    inventory: fixtureInventory(root),
    provenance: fixtureProvenance(),
    seedMemory: fixtureSeedMemory,
  });
  const job = build.worklist.jobs.find(
    (candidate) => candidate.namespace === "test:one",
  );
  assert.ok(job);
  const pack = createLongTailPackWorklist({ master: build.worklist, job });
  const source = pack.source.entries[0]?.source;
  assert.ok(source);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("scripts/generate-long-tail-translations.ts"),
      "--worker-validator-stdio",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INSPIR_LONG_TAIL_VALIDATOR_POLICY_SHA256:
          createLongTailValidatorPolicyProvenance(process.cwd())
            .validatorPolicySha256,
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(`${JSON.stringify({
    pack,
    values: { first: source },
  })}\n`);
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(status, 0, stderr);
  const response = JSON.parse(stdout) as unknown;
  assert.ok(response && typeof response === "object");
  assert.deepEqual(response, {
    ok: true,
    failures: inspectLongTailCandidateRetryFailures({
      pack,
      values: { first: source },
    }),
  });
});

test("worker validation sidecar requires its bound policy and isolates requests", async () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "inspir-worker-validator-isolation-"),
  );
  try {
    const build = buildLongTailMasterWorklist({
      inventory: fixtureInventory(root),
      provenance: fixtureProvenance(),
      seedMemory: fixtureSeedMemory,
    });
    const job = build.worklist.jobs.find(
      (candidate) => candidate.namespace === "test:one",
    );
    assert.ok(job);
    const pack = createLongTailPackWorklist({ master: build.worklist, job });
    const source = pack.source.entries[0]?.source;
    assert.ok(source);
    const pipeline = path.resolve(
      "scripts/generate-long-tail-translations.ts",
    );
    const unboundEnvironment = { ...process.env };
    delete unboundEnvironment.INSPIR_LONG_TAIL_VALIDATOR_POLICY_SHA256;
    const unbound = spawn(
      process.execPath,
      ["--import", "tsx", pipeline, "--worker-validator-stdio"],
      {
        cwd: process.cwd(),
        env: unboundEnvironment,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let unboundError = "";
    unbound.stderr.setEncoding("utf8");
    unbound.stderr.on("data", (chunk: string) => {
      unboundError += chunk;
    });
    unbound.stdin.end("{}\n");
    const unboundStatus = await new Promise<number | null>(
      (resolve, reject) => {
        unbound.once("error", reject);
        unbound.once("close", resolve);
      },
    );
    assert.notEqual(unboundStatus, 0);
    assert.match(unboundError, /requires an exact validator policy digest/);

    const policy = createLongTailValidatorPolicyProvenance(process.cwd());
    const bound = spawn(
      process.execPath,
      ["--import", "tsx", pipeline, "--worker-validator-stdio"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          INSPIR_LONG_TAIL_VALIDATOR_POLICY_SHA256:
            policy.validatorPolicySha256,
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let boundOutput = "";
    let boundError = "";
    bound.stdout.setEncoding("utf8");
    bound.stderr.setEncoding("utf8");
    bound.stdout.on("data", (chunk: string) => {
      boundOutput += chunk;
    });
    bound.stderr.on("data", (chunk: string) => {
      boundError += chunk;
    });
    bound.stdin.end(
      `${JSON.stringify({ pack, values: { first: source } })}\n` +
      `${JSON.stringify({ pack, values: fixtureValues(job) })}\n`,
    );
    const boundStatus = await new Promise<number | null>(
      (resolve, reject) => {
        bound.once("error", reject);
        bound.once("close", resolve);
      },
    );
    assert.equal(boundStatus, 0, boundError);
    const responses = boundOutput.trim().split("\n").map(
      (line) => JSON.parse(line) as unknown,
    );
    assert.equal(responses.length, 2);
    assert.deepEqual(responses[0], {
      ok: true,
      failures: inspectLongTailCandidateRetryFailures({
        pack,
        values: { first: source },
      }),
    });
    assert.deepEqual(responses[1], { ok: true, failures: [] });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("completed candidates let the Python worker resume without model inference", async (t) => {
  const root = temporaryDirectory(t);
  const runDirectory = path.join(root, "run");
  const workerScript = path.resolve(
    "scripts/generate-long-tail-translations-worker.py",
  );
  const pipelineScript = path.resolve(
    "scripts/generate-long-tail-translations.ts",
  );
  const baseProvenance = fixtureProvenance();
  const provenance: LongTailPipelineProvenance = Object.freeze({
    ...baseProvenance,
    workerImplementationSha256: sha256(readFileSync(workerScript, "utf8")),
    pipelineImplementationSha256: sha256(readFileSync(pipelineScript, "utf8")),
    validatorPolicy:
      createLongTailValidatorPolicyProvenance(process.cwd()),
  });
  const build = buildLongTailMasterWorklist({
    inventory: fixtureInventory(root),
    provenance,
    seedMemory: fixtureSeedMemory,
  });
  const materialized = materializeLongTailWorklists({
    master: build.worklist,
    runDirectory,
  });
  const candidateRoot = path.join(runDirectory, "candidates");
  for (const job of build.worklist.jobs) {
    writeCandidate({ master: build.worklist, job, candidateRoot });
  }
  const config = provenance.generationConfig;
  const child = spawn(
    path.resolve("tmp/nllb-venv/bin/python"),
    [
      workerScript,
      "--master-worklist",
      materialized.masterPath,
      "--worklist-root",
      materialized.worklistRoot,
      "--candidate-root",
      candidateRoot,
      "--model",
      path.join(root, "deliberately-absent-model"),
      "--model-sha256",
      provenance.modelSha256,
      "--worker-implementation-sha256",
      provenance.workerImplementationSha256,
      "--pipeline-script",
      pipelineScript,
      "--pipeline-implementation-sha256",
      provenance.pipelineImplementationSha256,
      "--validator-policy-sha256",
      provenance.validatorPolicy.validatorPolicySha256,
      "--execution-profile-json",
      JSON.stringify(provenance.executionProfile),
      "--execution-profile-sha256",
      provenance.executionProfile.executionProfileSha256,
      "--node",
      realpathSync(process.execPath),
      "--worker-index",
      "0",
      "--worker-count",
      "1",
      "--batch-size",
      String(config.batchSize),
      "--num-beams",
      String(config.numBeams),
      "--no-repeat-ngram-size",
      String(config.noRepeatNgramSize),
      "--max-source-tokens",
      String(config.maxSourceTokens),
      "--max-new-tokens",
      String(config.maxNewTokens),
      "--max-retry-attempts",
      String(config.maxRetryAttempts),
      "--dtype",
      config.dtype,
      "--device",
      config.device,
    ],
    {
      cwd: process.cwd(),
      env: createLongTailWorkerEnvironment(
        provenance.executionProfile,
        {
          ...process.env,
          OMP_NUM_THREADS: "64",
          MKL_NUM_THREADS: "64",
          VECLIB_MAXIMUM_THREADS: "64",
          PYTORCH_ENABLE_MPS_FALLBACK: "1",
        },
      ),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(status, 0, stderr);
  assert.match(stdout, /"pendingPacks": 0/);
  assert.match(
    stdout,
    new RegExp(provenance.executionProfile.executionProfileSha256),
  );
  assert.doesNotMatch(stdout + stderr, /deliberately-absent-model/);
});

test("worklists and candidates resume idempotently after a pack interruption", (t) => {
  const root = temporaryDirectory(t);
  const runDirectory = path.join(root, "run");
  const build = buildLongTailMasterWorklist({
    inventory: fixtureInventory(root),
    provenance: fixtureProvenance(),
    seedMemory: fixtureSeedMemory,
  });
  const initial = materializeLongTailWorklists({
    master: build.worklist,
    runDirectory,
  });
  assert.equal(initial.created, 3);
  const candidateRoot = path.join(runDirectory, "candidates");
  writeCandidate({
    master: build.worklist,
    job: build.worklist.jobs[0]!,
    candidateRoot,
  });
  assert.deepEqual(
    listPendingLongTailPackWorklists({
      master: build.worklist,
      runDirectory,
    }).map((job) => job.jobSha256),
    [build.worklist.jobs[1]!.jobSha256],
  );

  const resumed = materializeLongTailWorklists({
    master: build.worklist,
    runDirectory,
  });
  assert.equal(resumed.created, 0);
  assert.equal(resumed.replayed, 3);
  writeCandidate({
    master: build.worklist,
    job: build.worklist.jobs[1]!,
    candidateRoot,
  });
  assert.equal(
    listPendingLongTailPackWorklists({
      master: build.worklist,
      runDirectory,
    }).length,
    0,
  );
});

test("promotion swaps one complete snapshot, replays idempotently, and imports exact candidates", (t) => {
  const root = temporaryDirectory(t);
  const runDirectory = path.join(root, "run");
  const importRun = path.join(root, "import-run");
  const inventory = fixtureInventory(root);
  const build = buildLongTailMasterWorklist({
    inventory,
    provenance: fixtureProvenance(),
    seedMemory: fixtureSeedMemory,
  });
  const {
    executionProfileSha256: _currentExecutionProfileSha256,
    ...currentProfileMaterial
  } = build.worklist.provenance.executionProfile;
  assert.equal(
    _currentExecutionProfileSha256,
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  );
  const staleProfileMaterial = {
    ...currentProfileMaterial,
    pipelineVersion: "inspir-long-tail-local-nllb-v3",
  };
  const staleProfile = {
    ...staleProfileMaterial,
    executionProfileSha256: sha256Canonical(staleProfileMaterial),
  };
  const {
    worklistSha256: _currentWorklistSha256,
    provenance: _currentProvenance,
    ...currentWorklistMaterial
  } = build.worklist;
  assert.match(_currentWorklistSha256, /^[a-f0-9]{64}$/);
  assert.equal(_currentProvenance, build.worklist.provenance);
  const staleWorklistMaterial = {
    ...currentWorklistMaterial,
    provenance: {
      ...build.worklist.provenance,
      pipelineVersion: "inspir-long-tail-local-nllb-v3",
      executionProfile: staleProfile,
    },
  };
  const coordinatedStaleWorklist = {
    ...staleWorklistMaterial,
    worklistSha256: sha256Canonical(staleWorklistMaterial),
  };
  assert.throws(
    () => parseLongTailMasterWorklist(coordinatedStaleWorklist),
    /master worklist.*malformed/i,
  );
  materializeLongTailWorklists({ master: build.worklist, runDirectory });
  const candidateRoot = path.join(runDirectory, "candidates");
  writeCandidate({
    master: build.worklist,
    job: build.worklist.jobs[0]!,
    candidateRoot,
  });
  writeCandidate({
    master: build.worklist,
    job: build.worklist.jobs[1]!,
    candidateRoot,
  });
  const transactionRoot = path.join(runDirectory, "promotion-snapshot");
  const first = promoteLongTailCandidateBatch({
    master: build.worklist,
    runDirectory,
    curatedRoot: inventory.curatedRoot,
    transactionRoot,
  });
  assert.deepEqual(first.publications, {
    created: 2,
    replayed: 0,
    replaced: 0,
  });
  const firstTargetPath = path.join(
    inventory.curatedRoot,
    build.worklist.jobs[0]!.targetRelativePath,
  );
  const firstBytes = readFileSync(firstTargetPath);
  const firstText = firstBytes.toString("utf8");
  assert.match(firstText, /"translations": \{/);
  assert.doesNotMatch(firstText, /"entries": \[/);
  const readback = buildLongTailMasterWorklist({
    inventory,
    provenance: fixtureProvenance(),
    seedMemory: fixtureSeedMemory,
  });
  assert.equal(readback.completedPacks, 2);
  assert.equal(readback.missingPacks, 0);
  const firstInode = statSync(firstTargetPath).ino;
  const replay = promoteLongTailCandidateBatch({
    master: build.worklist,
    runDirectory,
    curatedRoot: inventory.curatedRoot,
    transactionRoot,
  });
  assert.equal(replay.outcome, "exact-replay");
  assert.equal(statSync(firstTargetPath).ino, firstInode);
  assert.deepEqual(readFileSync(firstTargetPath), firstBytes);

  materializeLongTailWorklists({
    master: build.worklist,
    runDirectory: importRun,
  });
  const imported = importExactLongTailCandidates({
    master: build.worklist,
    sourceRoot: candidateRoot,
    runDirectory: importRun,
  });
  assert.deepEqual(imported, { imported: 2, replayed: 0, rejected: 0 });
  assert.equal(
    listPendingLongTailPackWorklists({
      master: build.worklist,
      runDirectory: importRun,
    }).length,
    0,
  );
});

test("required-semantic CLI promotion recovers a finalized pre-attestation crash", (t) => {
  const workspaceRoot = temporaryDirectory(t);
  const runDirectory = path.join(workspaceRoot, "run");
  const inventory = Object.freeze({
    ...fixtureInventory(workspaceRoot),
    curatedRoot: path.join(workspaceRoot, "translations", "curated"),
  });
  const build = buildLongTailMasterWorklist({
    inventory,
    provenance: fixtureProvenance(),
    seedMemory: fixtureSeedMemory,
  });
  materializeLongTailWorklists({ master: build.worklist, runDirectory });
  const candidateRoot = path.join(runDirectory, "candidates");
  for (const job of build.worklist.jobs) {
    writeCandidate({ master: build.worklist, job, candidateRoot });
  }
  const semanticAudit = semanticPromotionAuditFixture({
    master: build.worklist,
    runDirectory,
    curatedRoot: inventory.curatedRoot,
  });
  const transactionRoot = path.join(runDirectory, "promotion-snapshot");
  assert.throws(
    () => promoteLongTailCandidateBatch({
      master: build.worklist,
      runDirectory,
      curatedRoot: inventory.curatedRoot,
      transactionRoot,
      workspaceRoot,
      semanticAudit,
      requireSemanticRelease: true,
      attestationCrashHook: () => {
        throw new Error("crash-after-finalize-before-attestation");
      },
    }),
    /crash-after-finalize-before-attestation/,
  );
  const transactions = readdirSync(path.join(transactionRoot, "transactions"));
  assert.equal(transactions.length, 1);
  let recoveryVerifierCalls = 0;
  let attestationWrites = 0;
  const recovered = promoteLongTailCandidateBatch({
    master: build.worklist,
    runDirectory,
    curatedRoot: inventory.curatedRoot,
    transactionRoot,
    workspaceRoot,
    requireSemanticRelease: true,
    semanticVerificationFailure: new Error("post-tree differs from pre-tree"),
    committedSemanticVerifier: (verification) => {
      recoveryVerifierCalls += 1;
      assert.equal(verification.workspaceRoot, workspaceRoot);
      assert.equal(verification.runRoot, runDirectory);
      assert.equal(
        verification.committedPromotionEvidence.semanticEvidenceSha256,
        semanticAudit.promotionEvidence.semanticEvidenceSha256,
      );
      return semanticAudit;
    },
    releaseAttestationWriter: (attestationInput) => {
      attestationWrites += 1;
      assert.equal(attestationInput.promotion.transactionId, transactions[0]);
      assert.equal(attestationInput.promotion.transactionRoot, transactionRoot);
      return Object.freeze({ sha256: "f".repeat(64) });
    },
  });
  assert.equal(recovered.outcome, "exact-replay");
  assert.equal(recovered.attestation?.sha256, "f".repeat(64));
  assert.equal(recoveryVerifierCalls, 1);
  assert.equal(attestationWrites, 1);
});

test("Afrikaans staged promotion finalizes exactly 121 candidates without invoking the full attestation writer", (t) => {
  const workspaceRoot = temporaryDirectory(t);
  const runDirectory = path.join(
    workspaceRoot,
    "tmp/translation-v10-afrikaans-staged",
  );
  const curatedRoot = path.join(
    workspaceRoot,
    "translations/curated",
  );
  const sourceText =
    "Build steady understanding through guided practice.";
  const translatedText =
    "Bou bestendige begrip deur begeleide oefening.";
  const sourceHash = sha256(`field\u0000${sourceText}`);
  const sources = Object.freeze(Array.from(
    { length: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT },
    (_, index) => Object.freeze({
      namespace: `route:staged-${String(index).padStart(3, "0")}`,
      sourceHash,
      sourceStrings: Object.freeze({ field: sourceText }),
    }),
  ));
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Afrikaans" as const]),
    curatedRoot,
    sources,
  });
  for (
    let index = 0;
    index < TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT;
    index += 1
  ) {
    const source = sources[index];
    assert.ok(source);
    writeSyntheticCuratedPack({
      curatedRoot,
      locale: "af",
      namespace: source.namespace,
      value: {
        schemaVersion: 1,
        language: "Afrikaans",
        locale: "af",
        namespace: source.namespace,
        sourceHash,
        translations: { field: translatedText },
      },
    });
  }
  const seedMemory = createLongTailSeedMemory(inventory);
  const build = buildLongTailMasterWorklist({
    inventory,
    provenance: fixtureProvenance(seedMemory),
    seedMemory,
  });
  assert.equal(
    build.worklist.jobs.length,
    TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
  );
  materializeLongTailWorklists({
    master: build.worklist,
    runDirectory,
  });
  const candidateRoot = path.join(runDirectory, "candidates");
  for (const job of build.worklist.jobs) {
    writeCandidate({
      master: build.worklist,
      job,
      candidateRoot,
      values: { field: translatedText },
    });
  }
  const semanticAudit = stagedAfrikaansPromotionAuditFixture({
    master: build.worklist,
    runDirectory,
    curatedRoot,
  });
  const transactionRoot = path.join(
    workspaceRoot,
    "tmp/staged-promotion",
  );
  let fullAttestationWrites = 0;
  let stagedProofReads = 0;
  assert.throws(
    () => promoteLongTailCandidateBatch({
      master: build.worklist,
      runDirectory,
      curatedRoot,
      workspaceRoot,
      transactionRoot,
      semanticAudit,
      requireSemanticRelease: true,
      semanticReleaseMode: "afrikaans-staged",
      releaseAttestationWriter: () => {
        fullAttestationWrites += 1;
        return Object.freeze({ sha256: "f".repeat(64) });
      },
      stagedPromotionProofReader: (proofInput) => {
        stagedProofReads += 1;
        const binding = readAndValidateLongTailPromotionJournal({
          curatedRoot,
          transactionRoot: proofInput.transactionRoot,
          transactionId: proofInput.transactionId,
          expectedSemanticEvidence: semanticAudit.promotionEvidence,
        });
        assert.equal(binding.artifacts, 121);
        assert.equal(
          binding.semanticEvidenceKind,
          AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
        );
        throw new Error("staged-proof-observed-finalized");
      },
    }),
    /staged-proof-observed-finalized/,
  );
  assert.equal(fullAttestationWrites, 0);
  assert.equal(stagedProofReads, 1);
});

test("malformed output is rejected and quarantined before any target exists", (t) => {
  const root = temporaryDirectory(t);
  const runDirectory = path.join(root, "run");
  const source =
    "Choose {first} before {second} in <strong>2026</strong> at https://example.com.";
  const inventory: LongTailInventory = Object.freeze({
    languages: Object.freeze(["Spanish" as const]),
    curatedRoot: path.join(root, "curated"),
    sources: Object.freeze([Object.freeze({
      namespace: "test:malformed",
      sourceHash: sha256("malformed-source"),
      sourceStrings: Object.freeze({ field: source }),
    })]),
  });
  const build = buildLongTailMasterWorklist({
    inventory,
    provenance: fixtureProvenance(),
    seedMemory: fixtureSeedMemory,
  });
  materializeLongTailWorklists({ master: build.worklist, runDirectory });
  const job = build.worklist.jobs[0]!;
  const pack = createLongTailPackWorklist({ master: build.worklist, job });
  const malformedValues = [
    "Elige {second} antes de {first} en <strong>2026</strong> en https://example.com.",
    "Elige {first} antes de {second} en </strong>2026<strong> en https://example.com.",
    "Elige {first} antes de {second} en <strong>2027</strong> en https://example.com.",
    "Elige {first} antes de {second} en <strong>2026</strong> en https://example.org.",
  ];
  for (const value of malformedValues) {
    assert.throws(
      () => validateLongTailCandidate(
        pack,
        createLongTailCandidate({ pack, values: { field: value } }),
      ),
      /Candidate field failed strict preservation/,
    );
  }
  const validCandidate = createLongTailCandidate({
    pack,
    values: {
      field:
        "Elige {first} antes de {second} en <strong>2026</strong> en https://example.com.",
    },
  });
  assert.equal(
    validCandidate.executionProfileSha256,
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  );
  const validatedCandidate = validateLongTailCandidate(pack, validCandidate);
  assert.equal(
    validatedCandidate.curatedPack.provenance.executionProfileSha256,
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  );
  assert.throws(
    () => validateLongTailCandidate(pack, {
      ...validCandidate,
      executionProfileSha256: "0".repeat(64),
    }),
    /candidate .*malformed/i,
  );
  assert.throws(
    () => validateLongTailCandidate(pack, {
      ...validCandidate,
      validatorPolicySha256: "0".repeat(64),
    }),
    /Candidate provenance mismatch/,
  );

  const candidateRoot = path.join(runDirectory, "candidates");
  const written = writeCandidate({
    master: build.worklist,
    job,
    candidateRoot,
    values: { field: malformedValues[0]! },
  });
  const quarantineRoot = path.join(runDirectory, "quarantine");
  assert.throws(
    () => validateOrQuarantineLongTailCandidate({
      pack,
      candidatePath: written.candidatePath,
      candidateRoot,
      quarantineRoot,
    }),
    /Candidate field failed strict preservation/,
  );
  assert.equal(existsSync(written.candidatePath), false);
  assert.equal(existsSync(path.join(inventory.curatedRoot, job.targetRelativePath)), false);
  const quarantinedDirectory = path.join(quarantineRoot, job.locale);
  const quarantined = readdirSync(quarantinedDirectory);
  assert.equal(
    quarantined.some((file) => file.includes(".rejected-") && file.endsWith(".json")),
    true,
  );
  assert.equal(
    quarantined.some((file) => file.endsWith(".reason.json")),
    true,
  );
});
