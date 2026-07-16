import { spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  LEGACY_MARKETING_SITE_DELTA_MANIFEST_RELATIVE_PATH,
  LEGACY_MARKETING_SITE_DELTA_ROOT,
  LEGACY_MARKETING_SITE_EXPECTED_DELTA_KEY_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT,
  buildLegacyMarketingSiteComposedCorpus,
  buildLegacyMarketingSiteDeltaCorpusManifest,
  composeLegacyMarketingSitePayload,
  legacyMarketingSiteContract,
  legacyMarketingSiteDeltaPackRelativePath,
  legacyMarketingSiteTargetLanguages,
  parseLegacyMarketingSiteDeltaPack,
  validateLegacyMarketingSiteDeltaCorpusManifest,
  type LegacyMarketingSiteContract,
  type LegacyMarketingSiteComposedCorpus,
  type LegacyMarketingSiteDeltaCorpusManifest,
  type LegacyMarketingSiteDeltaPackArtifact,
  type LegacyMarketingSiteTargetLanguage,
} from "@/lib/i18n/legacy-marketing-site-contract";
import {
  createLongTailWorkerEnvironment,
  createLongTailPackWorklist,
  createLongTailWorkerPlan,
  listPendingLongTailPackWorklists,
  parseLongTailMasterWorklist,
  validateLongTailPromotionBatch,
  validateOrQuarantineLongTailCandidate,
  type LongTailMasterWorklist,
  type LongTailPipelineProvenance,
} from "@/scripts/generate-long-tail-translations";
import {
  parseLegacyMarketingSiteDeltaPreparationOptions,
  prepareLegacyMarketingSiteDelta,
  readPromotedLegacyMarketingSiteRoutePacks,
  type LegacyMarketingSiteDeltaPreparationOptions,
} from "@/scripts/prepare-legacy-marketing-site-delta";

const defaultPython = "tmp/nllb-venv/bin/python";
const maximumMasterBytes = 64 * 1024 * 1024;
const expectedReleaseFileCount =
  LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT + 1;

export type LegacyMarketingSiteDeltaReleaseCliOptions = Readonly<{
  execute: boolean;
  promote: boolean;
  workers: number;
  python: string;
  preparation: LegacyMarketingSiteDeltaPreparationOptions;
}>;

export type LegacyMarketingSiteDeltaWorkerInvocation = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<NodeJS.ProcessEnv>;
  workerIndex: number;
  workerCount: number;
  languages: readonly string[];
  jobSha256s: readonly string[];
}>;

export type LegacyMarketingSiteDeltaReleasePlan = Readonly<{
  corpus: LegacyMarketingSiteDeltaCorpusManifest;
  repoRoot: string;
  runDirectory: string;
  targetRoot: string;
  stageRoot: string;
  artifacts: readonly LegacyMarketingSiteDeltaPackArtifact[];
  files: ReadonlyMap<string, Buffer>;
}>;

type WorkerRunner = (
  invocation: LegacyMarketingSiteDeltaWorkerInvocation,
) => Promise<void>;

export function assertLegacyMarketingSiteDeltaMaster(
  masterValue: unknown,
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
) {
  const master = parseLongTailMasterWorklist(masterValue);
  if (master.sources.length !== 1) {
    throw new Error("Legacy marketing delta master must contain exactly one source.");
  }
  const source = master.sources[0];
  if (
    !source ||
    source.namespace !== contract.namespace ||
    source.sourceHash !== contract.deltaHash ||
    source.entries.length !== Object.keys(contract.deltaSourceStrings).length ||
    source.entries.length !== LEGACY_MARKETING_SITE_EXPECTED_DELTA_KEY_COUNT
  ) {
    throw new Error("Legacy marketing delta master source contract drifted.");
  }
  const sourceEntries = new Map(
    source.entries.map((entry) => [entry.key, entry.source]),
  );
  for (const [key, sourceText] of Object.entries(contract.deltaSourceStrings)) {
    if (sourceEntries.get(key) !== sourceText) {
      throw new Error(`Legacy marketing delta master source drifted for ${key}.`);
    }
  }
  if (master.jobs.length !== legacyMarketingSiteTargetLanguages.length) {
    throw new Error(
      `Legacy marketing delta master requires ${legacyMarketingSiteTargetLanguages.length} jobs.`,
    );
  }
  const languages = new Set<string>();
  for (const job of master.jobs) {
    const fullTarget = legacyMarketingSiteDeltaPackRelativePath(job.language);
    const expectedRelativePath = fullTarget.slice(
      `${LEGACY_MARKETING_SITE_DELTA_ROOT}/`.length,
    );
    if (
      languages.has(job.language) ||
      job.namespace !== contract.namespace ||
      job.sourceHash !== contract.deltaHash ||
      job.entryCount !== source.entries.length ||
      job.worklistRelativePath !== expectedRelativePath ||
      job.candidateRelativePath !== expectedRelativePath ||
      job.targetRelativePath !== expectedRelativePath ||
      job.replacement !== undefined
    ) {
      throw new Error(
        `Legacy marketing delta job contract drifted for ${job.language}.`,
      );
    }
    languages.add(job.language);
  }
  for (const language of legacyMarketingSiteTargetLanguages) {
    if (!languages.has(language)) {
      throw new Error(`Legacy marketing delta master is missing ${language}.`);
    }
  }
  return master;
}

export function buildLegacyMarketingSiteDeltaWorkerInvocations(input: {
  master: LongTailMasterWorklist;
  pendingJobs?: readonly LongTailMasterWorklist["jobs"][number][];
  repoRoot: string;
  runDirectory: string;
  modelDirectory: string;
  workerScript: string;
  python: string;
  requestedWorkers: number;
  contract?: LegacyMarketingSiteContract;
}) {
  const master = assertLegacyMarketingSiteDeltaMaster(
    input.master,
    input.contract,
  );
  const canonicalByHash = new Map(
    master.jobs.map((job) => [job.jobSha256, job]),
  );
  const pendingHashes = new Set<string>();
  const pendingJobs = (input.pendingJobs ?? master.jobs).map((job) => {
    const canonical = canonicalByHash.get(job.jobSha256);
    if (!canonical || pendingHashes.has(job.jobSha256)) {
      throw new Error(
        "A pending delta job is duplicate or not bound to the master worklist.",
      );
    }
    pendingHashes.add(job.jobSha256);
    return canonical;
  });
  if (pendingJobs.length > master.jobs.length) {
    throw new Error("Pending delta jobs exceed the exact master worklist.");
  }
  const plan = createLongTailWorkerPlan({
    jobs: pendingJobs,
    requestedWorkers: input.requestedWorkers,
  });
  if (plan.length > 1 && master.provenance.generationConfig.device !== "cpu") {
    throw new Error("Multiple legacy marketing delta workers require CPU provenance.");
  }
  const repoRoot = path.resolve(input.repoRoot);
  const runDirectory = assertRunDirectory(repoRoot, input.runDirectory);
  const modelDirectory = assertUnlinkedDirectory(input.modelDirectory, "model");
  const workerScript = assertUnlinkedFile(input.workerScript, "worker", false);
  const pipelineScript = assertUnlinkedFile(
    path.join(repoRoot, "scripts/generate-long-tail-translations.ts"),
    "TypeScript validation policy",
    false,
  );
  const python = assertResolvingExecutableFile(
    input.python,
    "Python runtime",
  );
  const node = assertUnlinkedFile(process.execPath, "Node runtime", true);
  if (
    sha256File(workerScript) !== master.provenance.workerImplementationSha256 ||
    sha256File(pipelineScript) !== master.provenance.pipelineImplementationSha256
  ) {
    throw new Error(
      "Delta worker or TypeScript validation policy bytes differ from master provenance.",
    );
  }
  const masterPath = path.join(runDirectory, "worklist.json");
  const worklistRoot = path.join(runDirectory, "worklists");
  const candidateRoot = path.join(runDirectory, "candidates");
  return Object.freeze(plan.map((worker) => Object.freeze({
    command: python,
    args: Object.freeze(buildWorkerArgs({
      workerScript,
      pipelineScript,
      node,
      modelDirectory,
      masterPath,
      worklistRoot,
      candidateRoot,
      workerIndex: worker.workerIndex,
      workerCount: worker.workerCount,
      provenance: master.provenance,
    })),
    cwd: repoRoot,
    env: Object.freeze(
      createLongTailWorkerEnvironment(master.provenance.executionProfile),
    ),
    workerIndex: worker.workerIndex,
    workerCount: worker.workerCount,
    languages: worker.languages,
    jobSha256s: worker.jobSha256s,
  })));
}

export async function executeLegacyMarketingSiteDeltaWorkers(input: {
  master: LongTailMasterWorklist;
  repoRoot: string;
  runDirectory: string;
  modelDirectory: string;
  workerScript: string;
  python: string;
  requestedWorkers: number;
  contract?: LegacyMarketingSiteContract;
  runner?: WorkerRunner;
}) {
  const master = assertLegacyMarketingSiteDeltaMaster(
    input.master,
    input.contract,
  );
  const runDirectory = assertRunDirectory(input.repoRoot, input.runDirectory);
  const candidateRoot = path.join(runDirectory, "candidates");
  const quarantineRoot = path.join(runDirectory, "quarantine");
  for (const job of master.jobs) {
    const candidatePath = resolveContainedPath(
      candidateRoot,
      job.candidateRelativePath,
      "candidate",
    );
    if (!existsSync(candidatePath)) continue;
    try {
      validateOrQuarantineLongTailCandidate({
        pack: createLongTailPackWorklist({ master, job }),
        candidatePath,
        candidateRoot,
        quarantineRoot,
      });
    } catch {
      // The generic validator quarantines invalid candidates. The worker then
      // regenerates only the now-missing exact job.
    }
  }
  const pendingBefore = listPendingLongTailPackWorklists({
    master,
    runDirectory,
  });
  const invocations = buildLegacyMarketingSiteDeltaWorkerInvocations({
    ...input,
    master,
    pendingJobs: pendingBefore,
  });
  const runner = input.runner ?? runWorkerProcess;
  const outcomes = await Promise.allSettled(
    invocations.map((invocation) => runner(invocation)),
  );
  const failures = outcomes.filter((outcome) => outcome.status === "rejected");
  if (failures.length) {
    throw new Error(
      `${failures.length} of ${invocations.length} legacy marketing delta workers failed; exact completed candidates remain resumable.`,
    );
  }
  const pendingAfter = listPendingLongTailPackWorklists({
    master,
    runDirectory,
  });
  if (pendingAfter.length) {
    throw new Error(
      `Legacy marketing delta execution ended with ${pendingAfter.length} missing or invalid candidates.`,
    );
  }
  return Object.freeze({
    pendingBefore: pendingBefore.length,
    workerStarts: invocations.length,
    candidatesValidated: master.jobs.length,
    pendingAfter: 0,
  });
}

export function buildLegacyMarketingSiteDeltaReleasePlan(input: {
  master: LongTailMasterWorklist;
  repoRoot: string;
  runDirectory: string;
  contract?: LegacyMarketingSiteContract;
}) {
  const contract = input.contract ?? legacyMarketingSiteContract;
  const master = assertLegacyMarketingSiteDeltaMaster(input.master, contract);
  const repoRoot = path.resolve(input.repoRoot);
  const runDirectory = assertRunDirectory(repoRoot, input.runDirectory);
  const targetRoot = path.join(repoRoot, LEGACY_MARKETING_SITE_DELTA_ROOT);
  const validated = validateLongTailPromotionBatch({
    master,
    runDirectory,
    curatedRoot: targetRoot,
  });
  if (validated.length !== legacyMarketingSiteTargetLanguages.length) {
    throw new Error(
      `Atomic delta release requires ${legacyMarketingSiteTargetLanguages.length} validated candidates.`,
    );
  }
  const artifacts = validated.map((item) => {
    const fullRelativePath = `${LEGACY_MARKETING_SITE_DELTA_ROOT}/${item.job.targetRelativePath}`;
    const bytes = prettyJsonBytes(item.result.curatedPack);
    const parsed = parseLegacyMarketingSiteDeltaPack(
      item.result.curatedPack,
      contract,
    );
    if (
      parsed.language !== item.job.language ||
      fullRelativePath !== legacyMarketingSiteDeltaPackRelativePath(parsed.language)
    ) {
      throw new Error(`Validated delta candidate path drifted for ${item.job.language}.`);
    }
    return Object.freeze({ relativePath: fullRelativePath, bytes });
  }).sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
  const corpus = buildLegacyMarketingSiteDeltaCorpusManifest({
    contract,
    artifacts,
  });
  const files = buildReleaseFileMap(artifacts, corpus);
  if (files.size !== expectedReleaseFileCount) {
    throw new Error(
      `Atomic delta release requires ${expectedReleaseFileCount} exact files.`,
    );
  }
  const stageRoot = path.join(
    runDirectory,
    "release-staging",
    corpus.corpusSha256,
  );
  return Object.freeze({
    corpus,
    repoRoot,
    runDirectory,
    targetRoot,
    stageRoot,
    artifacts: Object.freeze(artifacts),
    files: freezeBufferMap(files),
  });
}

export function publishLegacyMarketingSiteDeltaRelease(
  plan: LegacyMarketingSiteDeltaReleasePlan,
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
) {
  assertReleasePlanIntegrity(plan, contract);
  if (pathEntryExists(plan.targetRoot)) {
    assertPublishedReleaseMatchesPlan(plan, contract);
    return Object.freeze({
      publication: "exact-replay" as const,
      targetRoot: plan.targetRoot,
      packs: plan.artifacts.length,
      corpusSha256: plan.corpus.corpusSha256,
      renameOperations: 0,
      durability: null,
    });
  }
  const targetParent = path.dirname(plan.targetRoot);
  mkdirSync(targetParent, { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(targetParent);
  const stageDurability = materializeReleaseStage(plan, contract);
  // The tracked root is never assembled in place. A target that appeared
  // while staging is validated as an exact replay or rejected; it is not
  // renamed out of the way and no partial visibility window is introduced.
  if (pathEntryExists(plan.targetRoot)) {
    assertPublishedReleaseMatchesPlan(plan, contract);
    return Object.freeze({
      publication: "exact-replay" as const,
      targetRoot: plan.targetRoot,
      packs: plan.artifacts.length,
      corpusSha256: plan.corpus.corpusSha256,
      renameOperations: 0,
      durability: null,
    });
  }
  if (statSync(plan.stageRoot).dev !== statSync(targetParent).dev) {
    throw new Error("Atomic delta release stage and target are on different filesystems.");
  }
  try {
    renameSync(plan.stageRoot, plan.targetRoot);
    fsyncDirectory(targetParent);
  } catch (error) {
    if (!pathEntryExists(plan.targetRoot)) throw error;
    assertPublishedReleaseMatchesPlan(plan, contract);
    return Object.freeze({
      publication: "exact-replay" as const,
      targetRoot: plan.targetRoot,
      packs: plan.artifacts.length,
      corpusSha256: plan.corpus.corpusSha256,
      renameOperations: 0,
      durability: null,
    });
  }
  assertPublishedReleaseMatchesPlan(plan, contract);
  return Object.freeze({
    publication: "created" as const,
    targetRoot: plan.targetRoot,
    packs: plan.artifacts.length,
    corpusSha256: plan.corpus.corpusSha256,
    renameOperations: 1,
    durability: Object.freeze({
      ...stageDurability,
      targetParentFsynced: true as const,
    }),
  });
}

export function promoteLegacyMarketingSiteDeltaRelease(input: {
  master: LongTailMasterWorklist;
  repoRoot: string;
  runDirectory: string;
  contract?: LegacyMarketingSiteContract;
}) {
  const contract = input.contract ?? legacyMarketingSiteContract;
  const plan = buildLegacyMarketingSiteDeltaReleasePlan(input);
  const expectedCorpus = buildLegacyMarketingSiteComposedCorpusFromReleasePlan({
    plan,
    repoRoot: input.repoRoot,
    contract,
  });
  const publication = publishLegacyMarketingSiteDeltaRelease(plan, contract);
  const publishedCorpus = buildLegacyMarketingSiteComposedCorpusFromRepository({
    repoRoot: input.repoRoot,
    contract,
  });
  if (
    !prettyJsonBytes(expectedCorpus.identity).equals(
      prettyJsonBytes(publishedCorpus.identity),
    )
  ) {
    throw new Error(
      "Published composed marketing corpus differs from the prepublication corpus.",
    );
  }
  return Object.freeze({
    ...publication,
    composedCorpus: publishedCorpus.identity,
  });
}

export function buildLegacyMarketingSiteComposedCorpusFromReleasePlan(input: {
  plan: LegacyMarketingSiteDeltaReleasePlan;
  repoRoot: string;
  contract?: LegacyMarketingSiteContract;
}): LegacyMarketingSiteComposedCorpus {
  const contract = input.contract ?? legacyMarketingSiteContract;
  assertReleasePlanIntegrity(input.plan, contract);
  return composeLegacyMarketingSiteCorpus({
    repoRoot: input.repoRoot,
    contract,
    deltaCorpusSha256: input.plan.corpus.corpusSha256,
    deltaPacks: input.plan.artifacts.map((artifact) => {
      const pack = parseCanonicalJson(
        Buffer.from(artifact.bytes),
        `delta pack ${artifact.relativePath}`,
      );
      return Object.freeze({
        language: parseLegacyMarketingSiteDeltaPack(pack, contract).language,
        pack,
      });
    }),
  });
}

export function buildLegacyMarketingSiteComposedCorpusFromRepository(input: {
  repoRoot: string;
  contract?: LegacyMarketingSiteContract;
}): LegacyMarketingSiteComposedCorpus {
  const contract = input.contract ?? legacyMarketingSiteContract;
  const repoRoot = path.resolve(input.repoRoot);
  const targetRoot = path.join(repoRoot, LEGACY_MARKETING_SITE_DELTA_ROOT);
  assertNoSymlinkComponents(targetRoot);
  const actualFiles = listReleaseFiles(targetRoot);
  const expectedFiles = new Set([
    stripDeltaRoot(LEGACY_MARKETING_SITE_DELTA_MANIFEST_RELATIVE_PATH),
    ...legacyMarketingSiteTargetLanguages.map((language) =>
      stripDeltaRoot(legacyMarketingSiteDeltaPackRelativePath(language))
    ),
  ]);
  if (
    actualFiles.length !== expectedFiles.size ||
    actualFiles.some((relativePath) => !expectedFiles.has(relativePath))
  ) {
    throw new Error(
      "Published delta corpus must contain the exact 69 packs and manifest.",
    );
  }
  const artifacts = legacyMarketingSiteTargetLanguages.map((language) => {
    const relativePath = legacyMarketingSiteDeltaPackRelativePath(language);
    return Object.freeze({
      relativePath,
      bytes: readFileSync(path.join(targetRoot, stripDeltaRoot(relativePath))),
    });
  });
  const manifest = parseCanonicalJson(
    readFileSync(
      path.join(
        targetRoot,
        stripDeltaRoot(LEGACY_MARKETING_SITE_DELTA_MANIFEST_RELATIVE_PATH),
      ),
    ),
    "delta corpus manifest",
  );
  const corpus = validateLegacyMarketingSiteDeltaCorpusManifest({
    contract,
    manifest,
    artifacts,
  });
  return composeLegacyMarketingSiteCorpus({
    repoRoot,
    contract,
    deltaCorpusSha256: corpus.corpusSha256,
    deltaPacks: artifacts.map((artifact) => {
      const pack = parseCanonicalJson(
        Buffer.from(artifact.bytes),
        `delta pack ${artifact.relativePath}`,
      );
      return Object.freeze({
        language: parseLegacyMarketingSiteDeltaPack(pack, contract).language,
        pack,
      });
    }),
  });
}

export async function runLegacyMarketingSiteDeltaRelease(
  options: LegacyMarketingSiteDeltaReleaseCliOptions,
) {
  const preparation = await prepareLegacyMarketingSiteDelta({
    ...options.preparation,
    materialize: options.execute,
  });
  if (!options.execute) {
    return Object.freeze({
      ...preparation,
      execution: null,
      promotion: null,
      writes: 0,
    });
  }
  const repoRoot = path.resolve(options.preparation.repoRoot);
  const runDirectory = assertRunDirectory(
    repoRoot,
    options.preparation.runDirectory,
  );
  const master = readMasterWorklist(path.join(runDirectory, "worklist.json"));
  const execution = await executeLegacyMarketingSiteDeltaWorkers({
    master,
    repoRoot,
    runDirectory,
    modelDirectory: options.preparation.modelDirectory,
    workerScript: path.resolve(repoRoot, options.preparation.workerScript),
    python: path.resolve(repoRoot, options.python),
    requestedWorkers: options.workers,
  });
  const promotion = options.promote
    ? promoteLegacyMarketingSiteDeltaRelease({
        master,
        repoRoot,
        runDirectory,
      })
    : null;
  return Object.freeze({
    ...preparation,
    execution,
    promotion,
  });
}

export function parseLegacyMarketingSiteDeltaReleaseCliOptions(
  argv: readonly string[],
  repoRoot = process.cwd(),
): LegacyMarketingSiteDeltaReleaseCliOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const flagOptions = new Set(["--execute", "--promote"]);
  const valueOptions = new Set([
    "--run-dir",
    "--model",
    "--worker",
    "--model-label",
    "--python",
    "--workers",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (flagOptions.has(argument)) {
      if (flags.has(argument)) throw new Error(`${argument} cannot be repeated.`);
      flags.add(argument);
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new Error(`Unknown legacy marketing delta release option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    if (values.has(argument)) throw new Error(`${argument} cannot be repeated.`);
    values.set(argument, value);
    index += 1;
  }
  const execute = flags.has("--execute");
  const promote = flags.has("--promote");
  if (promote && !execute) {
    throw new Error("--promote requires --execute.");
  }
  const workersRaw = values.get("--workers") ?? "1";
  if (!/^[1-4]$/.test(workersRaw)) {
    throw new Error("--workers must be between 1 and 4.");
  }
  const workers = Number(workersRaw);
  if (workers !== 1) {
    throw new Error(
      "The current delta preparation is MPS-bound and permits exactly one worker.",
    );
  }
  const preparationArgs = [
    ...(values.has("--run-dir") ? ["--run-dir", values.get("--run-dir") ?? ""] : []),
    ...(values.has("--model") ? ["--model", values.get("--model") ?? ""] : []),
    ...(values.has("--worker") ? ["--worker", values.get("--worker") ?? ""] : []),
    ...(values.has("--model-label")
      ? ["--model-label", values.get("--model-label") ?? ""]
      : []),
  ];
  const preparation = parseLegacyMarketingSiteDeltaPreparationOptions(
    preparationArgs,
    repoRoot,
  );
  return Object.freeze({
    execute,
    promote,
    workers,
    python: values.get("--python") ?? defaultPython,
    preparation: Object.freeze({ ...preparation, materialize: execute }),
  });
}

function composeLegacyMarketingSiteCorpus(input: {
  repoRoot: string;
  contract: LegacyMarketingSiteContract;
  deltaCorpusSha256: string;
  deltaPacks: readonly Readonly<{
    language: LegacyMarketingSiteTargetLanguage;
    pack: unknown;
  }>[];
}) {
  if (input.deltaPacks.length !== legacyMarketingSiteTargetLanguages.length) {
    throw new Error(
      `Composed marketing corpus requires ${legacyMarketingSiteTargetLanguages.length} delta packs.`,
    );
  }
  const deltaByLanguage = new Map<LegacyMarketingSiteTargetLanguage, unknown>();
  for (const delta of input.deltaPacks) {
    if (deltaByLanguage.has(delta.language)) {
      throw new Error(`Composed marketing corpus duplicates ${delta.language}.`);
    }
    deltaByLanguage.set(delta.language, delta.pack);
  }
  const payloads = legacyMarketingSiteTargetLanguages.map((language) => {
    const deltaPack = deltaByLanguage.get(language);
    if (!deltaPack) {
      throw new Error(`Composed marketing corpus is missing ${language}.`);
    }
    const routePacks = readPromotedLegacyMarketingSiteRoutePacks({
      repoRoot: input.repoRoot,
      contract: input.contract,
      language,
    });
    return Object.freeze({
      language,
      payload: composeLegacyMarketingSitePayload({
        contract: input.contract,
        language,
        routePacks,
        deltaPack,
      }),
    });
  });
  return buildLegacyMarketingSiteComposedCorpus({
    contract: input.contract,
    deltaCorpusSha256: input.deltaCorpusSha256,
    payloads,
  });
}

function buildWorkerArgs(input: {
  workerScript: string;
  pipelineScript: string;
  node: string;
  modelDirectory: string;
  masterPath: string;
  worklistRoot: string;
  candidateRoot: string;
  workerIndex: number;
  workerCount: number;
  provenance: LongTailPipelineProvenance;
}) {
  const config = input.provenance.generationConfig;
  return [
    input.workerScript,
    "--master-worklist",
    input.masterPath,
    "--worklist-root",
    input.worklistRoot,
    "--candidate-root",
    input.candidateRoot,
    "--model",
    input.modelDirectory,
    "--model-sha256",
    input.provenance.modelSha256,
    "--worker-implementation-sha256",
    input.provenance.workerImplementationSha256,
    "--pipeline-script",
    input.pipelineScript,
    "--pipeline-implementation-sha256",
    input.provenance.pipelineImplementationSha256,
    "--validator-policy-sha256",
    input.provenance.validatorPolicy.validatorPolicySha256,
    "--execution-profile-json",
    JSON.stringify(input.provenance.executionProfile),
    "--execution-profile-sha256",
    input.provenance.executionProfile.executionProfileSha256,
    "--node",
    input.node,
    "--worker-index",
    String(input.workerIndex),
    "--worker-count",
    String(input.workerCount),
    "--batch-size",
    String(config.batchSize),
    "--num-beams",
    String(config.numBeams),
    "--no-repeat-ngram-size",
    String(config.noRepeatNgramSize),
    "--dtype",
    config.dtype,
    "--device",
    config.device,
    "--max-source-tokens",
    String(config.maxSourceTokens),
    "--max-new-tokens",
    String(config.maxNewTokens),
    "--max-retry-attempts",
    String(config.maxRetryAttempts),
  ];
}

function materializeReleaseStage(
  plan: LegacyMarketingSiteDeltaReleasePlan,
  contract: LegacyMarketingSiteContract,
) {
  mkdirSync(plan.stageRoot, { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(plan.stageRoot);
  const existingFiles = listReleaseFiles(plan.stageRoot);
  for (const relativePath of existingFiles) {
    const expected = plan.files.get(relativePath);
    if (!expected) {
      throw new Error(`Release stage contains unexpected file ${relativePath}.`);
    }
    if (!readFileSync(path.join(plan.stageRoot, relativePath)).equals(expected)) {
      throw new Error(`Release stage contains conflicting file ${relativePath}.`);
    }
  }
  const temporaryRoot = path.join(
    path.dirname(path.dirname(plan.stageRoot)),
    "release-write-tmp",
  );
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(temporaryRoot);
  for (const [relativePath, bytes] of plan.files) {
    writeExactFileViaLink({
      target: resolveContainedPath(plan.stageRoot, relativePath, "release stage"),
      bytes,
      temporaryRoot,
    });
  }
  const finalFiles = listReleaseFiles(plan.stageRoot);
  if (
    finalFiles.length !== plan.files.size ||
    finalFiles.some((relativePath) => !plan.files.has(relativePath))
  ) {
    throw new Error("Release stage file set is not exact.");
  }
  assertReleaseRootMatchesPlan(plan.stageRoot, plan, contract);
  for (const relativePath of plan.files.keys()) {
    fsyncFile(path.join(plan.stageRoot, relativePath));
  }
  fsyncDirectory(plan.stageRoot);
  return Object.freeze({
    stagedFilesFsynced: plan.files.size,
    stageDirectoryFsynced: true as const,
  });
}

function assertReleasePlanIntegrity(
  plan: LegacyMarketingSiteDeltaReleasePlan,
  contract: LegacyMarketingSiteContract,
) {
  const rebuiltCorpus = buildLegacyMarketingSiteDeltaCorpusManifest({
    contract,
    artifacts: plan.artifacts,
  });
  if (
    !prettyJsonBytes(rebuiltCorpus).equals(prettyJsonBytes(plan.corpus)) ||
    rebuiltCorpus.corpusSha256 !== plan.corpus.corpusSha256
  ) {
    throw new Error("Delta release plan corpus is not self-consistent.");
  }
  const rebuiltFiles = buildReleaseFileMap(plan.artifacts, rebuiltCorpus);
  if (
    rebuiltFiles.size !== plan.files.size ||
    [...rebuiltFiles.entries()].some(([relativePath, bytes]) =>
      !plan.files.get(relativePath)?.equals(bytes)
    )
  ) {
    throw new Error("Delta release plan files are not self-consistent.");
  }
  if (
    !path.isAbsolute(plan.targetRoot) ||
    !path.isAbsolute(plan.stageRoot) ||
    plan.repoRoot !== path.resolve(plan.repoRoot) ||
    plan.runDirectory !== assertRunDirectory(plan.repoRoot, plan.runDirectory) ||
    plan.targetRoot !==
      path.join(plan.repoRoot, LEGACY_MARKETING_SITE_DELTA_ROOT) ||
    plan.stageRoot !== path.join(
      plan.runDirectory,
      "release-staging",
      plan.corpus.corpusSha256,
    ) ||
    plan.stageRoot === plan.targetRoot
  ) {
    throw new Error("Delta release plan paths are not corpus-bound.");
  }
}

function assertPublishedReleaseMatchesPlan(
  plan: LegacyMarketingSiteDeltaReleasePlan,
  contract: LegacyMarketingSiteContract,
) {
  assertReleaseRootMatchesPlan(plan.targetRoot, plan, contract);
}

function assertReleaseRootMatchesPlan(
  root: string,
  plan: LegacyMarketingSiteDeltaReleasePlan,
  contract: LegacyMarketingSiteContract,
) {
  const files = listReleaseFiles(root);
  if (
    files.length !== plan.files.size ||
    files.some((relativePath) => !plan.files.has(relativePath))
  ) {
    throw new Error("Published delta release contains a partial or unexpected file set.");
  }
  for (const [relativePath, expected] of plan.files) {
    const actual = readFileSync(path.join(root, relativePath));
    if (!actual.equals(expected)) {
      throw new Error(`Published delta release differs at ${relativePath}.`);
    }
  }
  const manifestRelativePath = stripDeltaRoot(
    LEGACY_MARKETING_SITE_DELTA_MANIFEST_RELATIVE_PATH,
  );
  const manifestBytes = readFileSync(path.join(root, manifestRelativePath));
  const manifest = parseCanonicalJson(manifestBytes, "delta corpus manifest");
  const artifacts = legacyMarketingSiteTargetLanguages.map((language) => {
    const fullRelativePath = legacyMarketingSiteDeltaPackRelativePath(language);
    return Object.freeze({
      relativePath: fullRelativePath,
      bytes: readFileSync(path.join(root, stripDeltaRoot(fullRelativePath))),
    });
  });
  const validated = validateLegacyMarketingSiteDeltaCorpusManifest({
    contract,
    manifest,
    artifacts,
  });
  if (validated.corpusSha256 !== plan.corpus.corpusSha256) {
    throw new Error("Published delta corpus hash differs from the release plan.");
  }
}

function listReleaseFiles(root: string) {
  const files: string[] = [];
  const visit = (directory: string) => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareCodePoints(left.name, right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Release tree contains symbolic link ${target}.`);
      }
      if (entry.isDirectory()) {
        visit(target);
      } else if (entry.isFile()) {
        if (lstatSync(target).nlink !== 1) {
          throw new Error(`Release tree contains hard-linked file ${target}.`);
        }
        files.push(path.relative(root, target));
      } else {
        throw new Error(`Release tree contains non-regular entry ${target}.`);
      }
    }
  };
  const metadata = lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Release root must be an unlinked directory.");
  }
  visit(root);
  return files.sort(compareCodePoints);
}

function writeExactFileViaLink(input: {
  target: string;
  bytes: Buffer;
  temporaryRoot: string;
}) {
  mkdirSync(path.dirname(input.target), { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(path.dirname(input.target));
  if (existsSync(input.target)) {
    const metadata = lstatSync(input.target);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      !readFileSync(input.target).equals(input.bytes)
    ) {
      throw new Error(`Refusing conflicting release file ${input.target}.`);
    }
    return;
  }
  const temporary = path.join(
    input.temporaryRoot,
    `${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    writeFileSync(descriptor, input.bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      linkSync(temporary, input.target);
    } catch (error) {
      if (!existsSync(input.target) || !readFileSync(input.target).equals(input.bytes)) {
        throw error;
      }
    }
    fsyncDirectory(path.dirname(input.target));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function freezeBufferMap(values: ReadonlyMap<string, Buffer>) {
  return new Map(
    [...values.entries()]
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, value]) => [key, Buffer.from(value)]),
  );
}

function buildReleaseFileMap(
  artifacts: readonly LegacyMarketingSiteDeltaPackArtifact[],
  corpus: LegacyMarketingSiteDeltaCorpusManifest,
) {
  const files = new Map<string, Buffer>();
  for (const artifact of artifacts) {
    const relativePath = stripDeltaRoot(artifact.relativePath);
    if (files.has(relativePath)) {
      throw new Error(`Delta release duplicates ${relativePath}.`);
    }
    files.set(relativePath, Buffer.from(artifact.bytes));
  }
  files.set(
    stripDeltaRoot(LEGACY_MARKETING_SITE_DELTA_MANIFEST_RELATIVE_PATH),
    prettyJsonBytes(corpus),
  );
  return files;
}

function readMasterWorklist(file: string) {
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 2 ||
    metadata.size > maximumMasterBytes
  ) {
    throw new Error("Persisted delta master worklist is missing or unsafe.");
  }
  return assertLegacyMarketingSiteDeltaMaster(
    parseJson(readFileSync(file, "utf8"), "delta master worklist"),
  );
}

function runWorkerProcess(invocation: LegacyMarketingSiteDeltaWorkerInvocation) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...invocation.env },
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(
        new Error(
          `Legacy marketing delta worker ${invocation.workerIndex} exited with ${code ?? signal ?? "unknown status"}.`,
        ),
      );
    });
  });
}

function assertRunDirectory(repoRoot: string, runDirectory: string) {
  const resolvedRepo = path.resolve(repoRoot);
  const temporaryRoot = path.join(resolvedRepo, "tmp");
  const resolved = path.resolve(resolvedRepo, runDirectory);
  const relative = path.relative(temporaryRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Delta release run directory must be below repo/tmp.");
  }
  assertNoSymlinkComponents(resolved);
  return resolved;
}

function assertUnlinkedDirectory(value: string, label: string) {
  const requested = path.resolve(value);
  const metadata = lstatSync(requested);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be an unlinked directory.`);
  }
  return realpathSync(requested);
}

function assertUnlinkedFile(
  value: string,
  label: string,
  executable: boolean,
) {
  const requested = path.resolve(value);
  const metadata = lstatSync(requested);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (executable && (metadata.mode & 0o111) === 0)
  ) {
    throw new Error(`${label} must be an unlinked${executable ? " executable" : ""} file.`);
  }
  return realpathSync(requested);
}

function assertResolvingExecutableFile(value: string, label: string) {
  const requested = path.resolve(value);
  const requestedMetadata = lstatSync(requested);
  if (!requestedMetadata.isFile() && !requestedMetadata.isSymbolicLink()) {
    throw new Error(`${label} must resolve from a file or symbolic link.`);
  }
  const resolvedBeforeAccess = realpathSync(requested);
  if (!statSync(resolvedBeforeAccess).isFile()) {
    throw new Error(`${label} must resolve to a regular file.`);
  }
  accessSync(requested, fsConstants.X_OK);
  if (realpathSync(requested) !== resolvedBeforeAccess) {
    throw new Error(`${label} changed while its executable path was validated.`);
  }
  // Keep the virtual-environment launcher path. Spawning its real target would
  // bypass pyvenv.cfg and silently use the ambient Python environment.
  return requested;
}

function assertNoSymlinkComponents(target: string) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Execution path contains symbolic link ${cursor}.`);
    }
  }
}

function resolveContainedPath(root: string, relativePath: string, label: string) {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} path is unsafe.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} path escaped its root.`);
  }
  return resolved;
}

function stripDeltaRoot(relativePath: string) {
  const prefix = `${LEGACY_MARKETING_SITE_DELTA_ROOT}/`;
  if (!relativePath.startsWith(prefix)) {
    throw new Error(`Delta artifact path is outside ${LEGACY_MARKETING_SITE_DELTA_ROOT}.`);
  }
  return relativePath.slice(prefix.length);
}

function parseCanonicalJson(bytes: Buffer, label: string) {
  const text = bytes.toString("utf8");
  const value = parseJson(text, label);
  if (`${JSON.stringify(value, null, 2)}\n` !== text) {
    throw new Error(`${label} is not canonical pretty JSON.`);
  }
  return value;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function prettyJsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256File(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fsyncDirectory(directory: string) {
  const descriptor = openSync(directory, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncFile(file: string) {
  const descriptor = openSync(file, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function pathEntryExists(target: string) {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  if (process.argv.slice(2).includes("--help")) {
    console.log(`Usage: tsx scripts/run-legacy-marketing-site-delta-release.ts [options]

Default mode is a read-only route-corpus readiness check. It performs no inference,
candidate writes, tracked-file writes, or promotion.

  --execute          Materialize/resume exact worklists and candidates.
  --promote          With --execute, atomically publish all 69 packs plus manifest.
  --run-dir PATH     Run root below repo/tmp.
  --model PATH       Complete local NLLB model directory.
  --worker PATH      Existing generic NLLB worker implementation.
  --model-label TEXT Provenance label for the local model.
  --python PATH      Existing offline Python environment.
  --workers 1        Current MPS-bound execution permits one resident worker.

Promotion first validates every candidate and builds the entire release in tmp,
fsyncs all 70 files and the staged directory, then uses one directory rename only
when the tracked root is absent. An existing exact root is replayed read-only;
partial, stale, non-directory, or symlink targets fail closed. This command does
not perform in-place replacement of a published nonempty directory.`);
  } else {
    void runLegacyMarketingSiteDeltaRelease(
      parseLegacyMarketingSiteDeltaReleaseCliOptions(process.argv.slice(2)),
    ).then((result) => {
      console.log(JSON.stringify(result, null, 2));
    }).catch((error: unknown) => {
      console.error(`[translations:legacy-marketing-delta] ${boundedError(error)}`);
      process.exitCode = 1;
    });
  }
}
