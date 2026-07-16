import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  legacyMarketingSiteTargetLanguages,
  legacyMarketingSiteContract,
  LEGACY_MARKETING_SITE_DELTA_ROOT,
  LEGACY_MARKETING_SITE_DELTA_RUN_DIRECTORY,
  LEGACY_MARKETING_SITE_EXPECTED_ROUTE_KEY_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_ROUTE_NAMESPACE_COUNT,
  composeLegacyMarketingSiteRouteUnion,
  hashLegacyMarketingSiteRecord,
  type LegacyMarketingSiteContract,
} from "@/lib/i18n/legacy-marketing-site-contract";
import { languageConfigs, type SupportedLanguage } from "@/lib/content/languages";
import {
  buildLongTailMasterWorklist,
  createLongTailPipelineProvenance,
  createLongTailSeedMemory,
  materializeLongTailWorklists,
  type LongTailGenerationConfig,
  type LongTailInventory,
} from "@/scripts/generate-long-tail-translations";

const maximumPackBytes = 16 * 1024 * 1024;
const defaultModelDirectory = path.join(
  os.homedir(),
  ".cache/inspirlearning/nllb-200-distilled-1.3B",
);
const defaultWorkerScript = "scripts/generate-long-tail-translations-worker.py";
const defaultModelLabel = "nllb-200-distilled-1.3B-local";

export type LegacyMarketingSiteDeltaPreparationOptions = Readonly<{
  materialize: boolean;
  repoRoot: string;
  runDirectory: string;
  modelDirectory: string;
  workerScript: string;
  modelLabel: string;
  generationConfig: LongTailGenerationConfig;
}>;

function createLegacyMarketingSiteDeltaInventory(
  repoRoot = process.cwd(),
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
): LongTailInventory {
  return Object.freeze({
    languages: legacyMarketingSiteTargetLanguages,
    sources: Object.freeze([
      Object.freeze({
        namespace: contract.namespace,
        sourceHash: contract.deltaHash,
        sourceStrings: { ...contract.deltaSourceStrings },
      }),
    ]),
    curatedRoot: path.join(
      path.resolve(repoRoot),
      LEGACY_MARKETING_SITE_DELTA_ROOT,
    ),
  });
}

export function inspectPromotedLegacyMarketingSiteRouteCorpus(input: {
  repoRoot?: string;
  contract?: LegacyMarketingSiteContract;
  languages?: readonly SupportedLanguage[];
}) {
  const repoRoot = path.resolve(input.repoRoot ?? process.cwd());
  const contract = input.contract ?? legacyMarketingSiteContract;
  const languages = input.languages ?? legacyMarketingSiteTargetLanguages;
  if (!languages.length) {
    throw new Error("Route-corpus inspection requires at least one target language.");
  }
  const failures: string[] = [];
  const unionHashes = new Map<SupportedLanguage, string>();
  let packs = 0;
  for (const language of languages) {
    try {
      const routePacks = readPromotedLegacyMarketingSiteRoutePacks({
        repoRoot,
        contract,
        language,
      });
      packs += routePacks.length;
      const union = composeLegacyMarketingSiteRouteUnion({
        contract,
        language,
        routePacks,
      });
      unionHashes.set(language, hashLegacyMarketingSiteRecord(union));
    } catch (error) {
      failures.push(`${language}:validation:${boundedError(error)}`);
    }
  }
  if (failures.length) {
    throw new Error(
      `Legacy marketing delta preparation is blocked until the promoted route corpus is exact. ${failures.length} failures; first failures: ${failures.slice(0, 10).join(" | ")}`,
    );
  }
  const expectedPacks = languages.length * contract.routeNamespaces.length;
  if (packs !== expectedPacks || unionHashes.size !== languages.length) {
    throw new Error(
      `Route-corpus inspection expected ${expectedPacks} packs and ${languages.length} complete unions; received ${packs}/${unionHashes.size}.`,
    );
  }
  return Object.freeze({
    languages: languages.length,
    namespaces: contract.routeNamespaces.length,
    packs,
    unionKeys: Object.keys(contract.routeUnionSourceStrings).length,
    unionHashes: Object.freeze(unionHashes),
  });
}

export function readPromotedLegacyMarketingSiteRoutePacks(input: {
  repoRoot?: string;
  contract?: LegacyMarketingSiteContract;
  language: SupportedLanguage;
}) {
  const repoRoot = path.resolve(input.repoRoot ?? process.cwd());
  const contract = input.contract ?? legacyMarketingSiteContract;
  return Object.freeze(contract.routeNamespaces.map((namespace) =>
    readBoundedPack(curatedPackPath(repoRoot, input.language, namespace))
  ));
}

export async function prepareLegacyMarketingSiteDelta(
  options: LegacyMarketingSiteDeltaPreparationOptions,
) {
  const repoRoot = path.resolve(options.repoRoot);
  const routeCorpus = inspectPromotedLegacyMarketingSiteRouteCorpus({ repoRoot });
  if (
    routeCorpus.languages !== legacyMarketingSiteTargetLanguages.length ||
    routeCorpus.namespaces !== LEGACY_MARKETING_SITE_EXPECTED_ROUTE_NAMESPACE_COUNT ||
    routeCorpus.unionKeys !== LEGACY_MARKETING_SITE_EXPECTED_ROUTE_KEY_COUNT
  ) {
    throw new Error(
      "Legacy marketing delta preparation requires the complete production route corpus.",
    );
  }
  const inventory = createLegacyMarketingSiteDeltaInventory(repoRoot);
  const summary = {
    mode: options.materialize ? "materialize-worklists" : "read-only-check",
    routeCorpus: {
      languages: routeCorpus.languages,
      namespaces: routeCorpus.namespaces,
      packs: routeCorpus.packs,
      unionKeys: routeCorpus.unionKeys,
    },
    delta: {
      namespace: legacyMarketingSiteContract.namespace,
      sourceHash: legacyMarketingSiteContract.deltaHash,
      keys: Object.keys(legacyMarketingSiteContract.deltaSourceStrings).length,
      targetLanguages: legacyMarketingSiteTargetLanguages.length,
      targetRoot: inventory.curatedRoot,
    },
    runDirectory: path.resolve(repoRoot, options.runDirectory),
  };
  if (!options.materialize) return Object.freeze(summary);

  const runDirectory = assertSafeRunDirectory(repoRoot, options.runDirectory);
  const modelDirectory = assertRegularDirectory(options.modelDirectory, "model");
  const workerScript = assertRegularFile(
    path.resolve(repoRoot, options.workerScript),
    "translation worker",
  );
  const seedMemory = createLongTailSeedMemory(inventory);
  const provenance = await createLongTailPipelineProvenance({
    repoRoot,
    modelDirectory,
    modelLabel: options.modelLabel,
    workerScript,
    seedMemory,
    generationConfig: options.generationConfig,
  });
  const worklist = buildLongTailMasterWorklist({
    inventory,
    provenance,
    seedMemory,
  });
  if (
    worklist.totalPacks !== legacyMarketingSiteTargetLanguages.length ||
    worklist.sourceStalePacks !== 0 ||
    worklist.completedPacks + worklist.missingPacks !== worklist.totalPacks ||
    worklist.worklist.sources.length !== 1 ||
    worklist.worklist.sources[0]?.sourceHash !== legacyMarketingSiteContract.deltaHash
  ) {
    throw new Error(
      "Legacy marketing delta worklist does not match the exact 69-language delta contract.",
    );
  }
  const materialized = materializeLongTailWorklists({
    master: worklist.worklist,
    runDirectory,
  });
  return Object.freeze({
    ...summary,
    runDirectory,
    masterWorklistSha256: worklist.worklist.worklistSha256,
    completedPacks: worklist.completedPacks,
    missingPacks: worklist.missingPacks,
    writes: materialized,
  });
}

export function parseLegacyMarketingSiteDeltaPreparationOptions(
  argv: readonly string[],
  repoRoot = process.cwd(),
): LegacyMarketingSiteDeltaPreparationOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const valueOptions = new Set(["--run-dir", "--model", "--worker", "--model-label"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--materialize") {
      if (flags.has(argument)) {
        throw new Error(`${argument} cannot be repeated.`);
      }
      flags.add(argument);
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new Error(`Unknown legacy marketing delta option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    if (values.has(argument)) {
      throw new Error(`${argument} cannot be repeated.`);
    }
    values.set(argument, value);
    index += 1;
  }
  return Object.freeze({
    materialize: flags.has("--materialize"),
    repoRoot: path.resolve(repoRoot),
    runDirectory: values.get("--run-dir") ??
      LEGACY_MARKETING_SITE_DELTA_RUN_DIRECTORY,
    modelDirectory: values.get("--model") ?? defaultModelDirectory,
    workerScript: values.get("--worker") ?? defaultWorkerScript,
    modelLabel: values.get("--model-label") ?? defaultModelLabel,
    generationConfig: Object.freeze({
      batchSize: 16,
      numBeams: 1,
      noRepeatNgramSize: 4,
      dtype: "float16",
      device: "mps",
      maxSourceTokens: 512,
      maxNewTokens: 512,
      maxRetryAttempts: 3,
      deterministicAlgorithms: true,
      manualSeed: 0,
    }),
  });
}

function curatedPackPath(
  repoRoot: string,
  language: SupportedLanguage,
  namespace: string,
) {
  const directory = languageConfigs[language].prefix ||
    languageConfigs[language].locale;
  return path.join(
    repoRoot,
    "translations/curated",
    directory,
    `${namespace.replace(/[^a-z0-9.-]+/gi, "__")}.json`,
  );
}

function readBoundedPack(file: string): unknown {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("not a regular unlinked file");
  }
  if (metadata.size < 2 || metadata.size > maximumPackBytes) {
    throw new Error(`pack byte size ${metadata.size} is outside the safe range`);
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    throw new Error("pack is not valid JSON");
  }
}

function assertSafeRunDirectory(repoRoot: string, runDirectory: string) {
  const temporaryRoot = path.join(repoRoot, "tmp");
  const target = path.resolve(repoRoot, runDirectory);
  const relative = path.relative(temporaryRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Legacy marketing delta run directory must be below repo/tmp.");
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error("Legacy marketing delta run directory cannot be a symbolic link.");
  }
  return target;
}

function assertRegularDirectory(value: string, label: string) {
  const requested = path.resolve(value);
  const requestedMetadata = lstatSync(requested);
  if (!requestedMetadata.isDirectory() || requestedMetadata.isSymbolicLink()) {
    throw new Error(`${label} path is not a regular unlinked directory.`);
  }
  const resolved = realpathSync(requested);
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`${label} path is not a directory.`);
  }
  return resolved;
}

function assertRegularFile(value: string, label: string) {
  const requested = path.resolve(value);
  const requestedMetadata = lstatSync(requested);
  if (!requestedMetadata.isFile() || requestedMetadata.isSymbolicLink()) {
    throw new Error(`${label} path is not a regular unlinked file.`);
  }
  const resolved = realpathSync(requested);
  if (!statSync(resolved).isFile()) {
    throw new Error(`${label} path did not resolve to a regular file.`);
  }
  return resolved;
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  if (process.argv.slice(2).includes("--help")) {
    console.log(`Usage: tsx scripts/prepare-legacy-marketing-site-delta.ts [options]

Default mode is a read-only, fail-closed check of all 124 x 69 promoted route packs.
It performs no model inference and writes nothing.

  --materialize       Hash the local model/pipeline and write 69 delta worklists under tmp only.
  --run-dir PATH      Run root below repo/tmp (default tmp/legacy-marketing-site-delta-v1).
  --model PATH        Complete local NLLB model directory.
  --worker PATH       Current local translation worker implementation.
  --model-label TEXT  Provenance label for the local model.

Candidate execution and tracked-pack promotion deliberately remain disabled here.`);
  } else {
    void prepareLegacyMarketingSiteDelta(
      parseLegacyMarketingSiteDeltaPreparationOptions(process.argv.slice(2)),
    ).then((result) => {
      console.log(JSON.stringify(result, null, 2));
    }).catch((error: unknown) => {
      console.error(`[translations:prepare-legacy-marketing-delta] ${boundedError(error)}`);
      process.exitCode = 1;
    });
  }
}
