import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateTranslationRepairCandidateDirectories,
  type TranslationCandidateQaIssue,
} from "./validate-translation-repair-candidates";
import {
  __testOnlyAfrikaansReconciliationAdapter,
  validateAfrikaansReconciliationHybridCandidateManifest,
} from "./afrikaans-reconciliation-apply-adapter";
import type { AfrikaansReconciliationFrozenPolicy } from "./afrikaans-reconciliation-frozen-policy";

const worklistRootOrder = [
  "schemaVersion",
  "kind",
  "protectorVersion",
  "protectorFingerprint",
  "language",
  "locale",
  "namespace",
  "sourceHash",
  "entries",
] as const;
const candidateRootOrder = [
  "schemaVersion",
  "kind",
  "protectorVersion",
  "protectorFingerprint",
  "language",
  "locale",
  "namespace",
  "sourceHash",
  "entries",
  "draftModel",
] as const;
const entryOrder = ["key", "source", "existingCandidate", "reasons", "value"] as const;
const legacyAuditRootOrder = [
  "schemaVersion",
  "kind",
  "worklists",
  "candidates",
  "fields",
  "flagged",
  "byReason",
  "entries",
] as const;
const deduplicatedAuditRootOrder = [
  "schemaVersion",
  "kind",
  "worklists",
  "candidates",
  "fields",
  "uniqueSources",
  "uniqueCandidates",
  "uniqueExistingCandidates",
  "flagged",
  "byReason",
  "entries",
] as const;
const auditEntryOrder = [
  "file",
  "locale",
  "language",
  "namespace",
  "key",
  "source",
  "existingCandidate",
  "value",
  "sourceWordCount",
  "candidateSimilarity",
  "existingSimilarity",
  "similarityDelta",
  "sourceNumbers",
  "valueNumbers",
  "reasons",
] as const;
const selectionManifestRootOrder = [
  "schemaVersion",
  "kind",
  "worklist",
  "primary",
  "semanticAudit",
  "subset",
  "counts",
  "identities",
  "canonicalSha256",
] as const;
const selectionIdentityOrder = [
  "relativePath",
  "entryIndex",
  "language",
  "locale",
  "namespace",
  "sourceHash",
  "key",
  "source",
  "existingCandidate",
  "primaryValue",
  "deterministicFailures",
  "semanticReasons",
] as const;
const hybridCandidateManifestRootOrder = [
  "schemaVersion",
  "kind",
  "hybridDraftModel",
  "provenance",
  "output",
  "counts",
  "identities",
  "canonicalSha256",
] as const;
const hybridCandidateProvenanceOrder = [
  "selectionManifestPath",
  "selectionManifestSha256",
  "worklist",
  "primary",
  "subset",
  "beam4",
] as const;
const hybridCandidateProvenanceV2Order = [
  ...hybridCandidateProvenanceOrder,
  "composition",
] as const;
const hybridCandidateCountsOrder = ["files", "fields", "replacedFields"] as const;
const hybridCandidateIdentityOrder = [
  ...selectionIdentityOrder,
  "primaryValueSha256",
  "beam4ValueSha256",
] as const;
const jsonManifestDescriptorOrder = [
  "path",
  "bytes",
  "byteSha256",
  "canonicalSha256",
] as const;
const byteFileDescriptorOrder = ["path", "bytes", "byteSha256"] as const;
const treeDescriptorOrder = [
  "path",
  "files",
  "fields",
  "byteTreeSha256",
  "canonicalTreeSha256",
  "fileRecords",
] as const;
const candidateTreeDescriptorOrder = [...treeDescriptorOrder, "draftModel"] as const;
const treeFileDescriptorOrder = [
  "relativePath",
  "bytes",
  "fields",
  "byteSha256",
  "canonicalSha256",
] as const;
const v3CompositionManifestRootOrder = [
  "schemaVersion",
  "kind",
  "selection",
  "base",
  "reducedWorklist",
  "corrections",
  "semanticAudit",
  "final",
  "counts",
  "decisions",
  "canonicalSha256",
] as const;
const v3CompositionBaseOrder = ["manifest", "tree"] as const;
const v3CompositionReducedWorklistOrder = ["manifest", "tree"] as const;
const v3CompositionCorrectionsOrder = ["generator", "tree"] as const;
const v3CompositionCountsOrder = [
  "selectedFields",
  "correctedFields",
  "preservedFields",
] as const;
const v3CompositionDecisionOrder = [
  "relativePath",
  "key",
  "sourceSha256",
  "baseOrigin",
  "baseValueSha256",
  "action",
  "finalValueSha256",
  "method",
  "evidence",
] as const;
const v3BaseManifestRootOrder = [
  "schemaVersion",
  "kind",
  "draftModel",
  "selection",
  "rawV2",
  "primary",
  "output",
  "counts",
  "identities",
  "canonicalSha256",
] as const;
const v3BaseSelectionOrder = ["path", "sha256", "canonicalSha256"] as const;
const v3BaseRawV2Order = [
  "path",
  "checkpointEvidencePath",
  "checkpointEvidenceSha256",
  "tree",
] as const;
const v3BaseCountsOrder = ["raw-v2-beam4", "primary-beam1-fallback", "total"] as const;
const v3BaseIdentityOrder = [
  "relativePath",
  "key",
  "sourceSha256",
  "origin",
  "valueSha256",
] as const;
const v3ReducedWorklistManifestRootOrder = [
  "schemaVersion",
  "kind",
  "sourceWorklists",
  "baseQa",
  "extras",
  "tree",
  "identities",
  "canonicalSha256",
] as const;
const pathSha256DescriptorOrder = ["path", "sha256"] as const;
const v3ReducedWorklistIdentityOrder = [
  "relativePath",
  "key",
  "sourceSha256",
  "evidence",
] as const;
const v3SemanticAcceptanceRootOrder = [
  "schemaVersion",
  "kind",
  "final",
  "evidence",
  "counts",
  "entries",
  "canonicalSha256",
] as const;
const v3SemanticEvidenceOrder = ["id", "kind", "path", "bytes", "byteSha256"] as const;
const v3SemanticCountsOrder = ["fields", "acceptedFields", "requiredTermFields"] as const;
const v3SemanticEntryOrder = [
  "relativePath",
  "key",
  "sourceSha256",
  "finalValueSha256",
  "status",
  "requiredTerms",
  "evidence",
] as const;

const coreMainAppHighQualityLanguages = new Set(["Arabic", "Spanish", "Hindi"]);
const legalHighQualityLanguages = new Set(["Arabic", "Spanish", "Hindi", "Malayalam"]);
const coreMainAppHighQualityReason = "core-main-app-high-quality-pass";
const legalHighQualityReason = "legal-high-quality-pass";
const requiredV3SemanticTerms = new Map<string, readonly string[]>([
  [
    "ar/blog__ai-art-appreciation-guide.json\u0000site.809d1e1957710315a3",
    ["AI"],
  ],
]);

type JsonRecord = Record<string, unknown>;

type RepairEntry = {
  raw: JsonRecord;
  key: string;
  source: string;
  existingCandidate: string | null;
  reasons: string[];
  value: string;
};

type WorklistDocument = {
  file: string;
  relativePath: string;
  raw: JsonRecord;
  language: string;
  locale: string;
  namespace: string;
  sourceHash: string;
  entries: RepairEntry[];
};

type CandidateDocument = WorklistDocument & {
  draftModel: string;
};

type SemanticAuditEntry = {
  relativePath: string;
  locale: string;
  language: string;
  namespace: string;
  key: string;
  source: string;
  existingCandidate: string | null;
  value: string;
  reasons: string[];
};

type SemanticAudit = {
  path: string;
  sha256: string;
  fields: number;
  flagged: number;
  entries: SemanticAuditEntry[];
};

type SelectionAccumulator = {
  worklist: WorklistDocument;
  candidate: CandidateDocument;
  entry: RepairEntry;
  entryIndex: number;
  deterministicFailures: string[];
  semanticReasons: string[];
};

export type HybridSelectionIdentity = {
  relativePath: string;
  entryIndex: number;
  language: string;
  locale: string;
  namespace: string;
  sourceHash: string;
  key: string;
  source: string;
  existingCandidate: string | null;
  primaryValue: string;
  deterministicFailures: string[];
  semanticReasons: string[];
};

type TreeFileDescriptor = {
  relativePath: string;
  bytes: number;
  fields: number;
  byteSha256: string;
  canonicalSha256: string;
};

type TreeDescriptor = {
  path: string;
  files: number;
  fields: number;
  byteTreeSha256: string;
  canonicalTreeSha256: string;
  fileRecords: TreeFileDescriptor[];
};

type CandidateTreeDescriptor = TreeDescriptor & {
  draftModel: string;
};

type JsonManifestDescriptor = {
  path: string;
  bytes: number;
  byteSha256: string;
  canonicalSha256: string;
};

type ByteFileDescriptor = {
  path: string;
  bytes: number;
  byteSha256: string;
};

type V3BaseOrigin = "raw-v2-beam4" | "primary-beam1-fallback";

type V3BaseIdentity = {
  relativePath: string;
  key: string;
  sourceSha256: string;
  origin: V3BaseOrigin;
  valueSha256: string;
};

type V3CompositionAction = "preserve" | "correct";
type V3CompositionMethod =
  | "raw-v2"
  | "primary"
  | "beam4-f16"
  | "beam4-f32"
  | "beam8-f32"
  | "reviewed-preserve";

type V3CompositionDecision = {
  relativePath: string;
  key: string;
  sourceSha256: string;
  baseOrigin: V3BaseOrigin;
  baseValueSha256: string;
  action: V3CompositionAction;
  finalValueSha256: string;
  method: V3CompositionMethod;
  evidence: string[];
};

type LoadedJsonManifest = {
  raw: JsonRecord;
  descriptor: JsonManifestDescriptor;
};

type V3CompositionContext = {
  compositionManifestPath: string;
  selectionManifest: SelectionManifest;
  primaryCandidateDir: string;
  primaryCandidates: readonly CandidateDocument[];
  primaryDraftModel: string;
  subsetWorklistDir: string;
  subsetWorklists: readonly WorklistDocument[];
  finalCandidateDir: string;
  finalCandidates: readonly CandidateDocument[];
  finalDraftModel: string;
};

type LoadedV3Composition = {
  descriptor: JsonManifestDescriptor;
  validation: V3CompositionManifestValidation;
};

type LoadedV3Base = {
  manifestDescriptor: JsonManifestDescriptor;
  candidates: CandidateDocument[];
  descriptor: CandidateTreeDescriptor;
  identities: V3BaseIdentity[];
  identityByKey: Map<string, V3BaseIdentity>;
};

export type V3CompositionManifestValidation = {
  path: string;
  byteSha256: string;
  canonicalSha256: string;
  finalTreeCanonicalSha256: string;
  decisions: number;
  corrections: number;
  preserves: number;
};

type SelectionManifest = {
  raw: JsonRecord;
  path: string;
  sha256: string;
  identities: HybridSelectionIdentity[];
};

export type ExportHybridTranslationSubsetArgs = {
  worklistDir: string;
  primaryCandidateDir: string;
  semanticAuditPath: string;
  subsetWorklistDir: string;
  selectionManifestPath: string;
};

export type ExportHybridTranslationSubsetResult = {
  subsetWorklistDir: string;
  selectionManifestPath: string;
  selectedFiles: number;
  selectedFields: number;
  deterministicFields: number;
  semanticFields: number;
  overlapFields: number;
  canonicalSha256: string;
};

export type MergeHybridTranslationCandidatesArgs = {
  worklistDir: string;
  primaryCandidateDir: string;
  subsetWorklistDir: string;
  beam4CandidateDir: string;
  selectionManifestPath: string;
  outputCandidateDir: string;
  hybridDraftModel: string;
  manifestPath: string;
  compositionManifestPath?: string;
  manifestSchemaVersion?: 1 | 2;
};

export type MergeHybridTranslationCandidatesResult = {
  outputCandidateDir: string;
  manifestPath: string;
  files: number;
  fields: number;
  replacedFields: number;
  draftModel: string;
  canonicalSha256: string;
  compositionCanonicalSha256?: string;
};

export type ValidateHybridTranslationCandidateManifestArgs = {
  worklistDir: string;
  candidateDir: string;
  manifestPath: string;
};

export type HybridTranslationCandidateManifestValidation = {
  manifestPath: string;
  worklistDir: string;
  candidateDir: string;
  files: number;
  fields: number;
  replacedFields: number;
  draftModel: string;
  canonicalSha256: string;
  composition?: V3CompositionManifestValidation;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = parseCommandLine(process.argv.slice(2));
    const result =
      command.mode === "export-subset"
        ? exportHybridTranslationRepairSubset(command.args)
        : mergeHybridTranslationRepairCandidates(command.args);
    console.log(
      JSON.stringify({ event: `translation_hybrid_${command.mode}_complete`, ...result }),
    );
  } catch (error: unknown) {
    console.error(
      JSON.stringify(
        {
          event: "translation_hybrid_composition_failed",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

export function exportHybridTranslationRepairSubset(
  args: ExportHybridTranslationSubsetArgs,
): ExportHybridTranslationSubsetResult {
  const worklistDir = resolve(args.worklistDir);
  const primaryCandidateDir = resolve(args.primaryCandidateDir);
  const semanticAuditPath = resolve(args.semanticAuditPath);
  const subsetWorklistDir = resolve(args.subsetWorklistDir);
  const selectionManifestPath = resolve(args.selectionManifestPath);
  assertDifferentPaths(
    [worklistDir, primaryCandidateDir, subsetWorklistDir, selectionManifestPath],
    "Hybrid subset inputs and outputs",
  );
  assertDirectoriesDisjoint(
    [worklistDir, primaryCandidateDir, subsetWorklistDir],
    "Hybrid subset tree paths",
  );
  assertIgnoredNewTmpDirectory(subsetWorklistDir, "Subset worklist directory");
  assertIgnoredNewTmpFile(selectionManifestPath, "Selection manifest");
  assertPathOutsideDirectory(selectionManifestPath, subsetWorklistDir, "Selection manifest");
  assertPathOutsideDirectory(selectionManifestPath, worklistDir, "Selection manifest");
  assertPathOutsideDirectory(selectionManifestPath, primaryCandidateDir, "Selection manifest");
  assertRegularInputFile(semanticAuditPath, "LaBSE audit");

  const primaryQa = validateTranslationRepairCandidateDirectories({
    worklistDir,
    candidateDir: primaryCandidateDir,
  });
  const structuralIssues = primaryQa.issues.filter(
    (issue) => issue.code !== "candidate-field",
  );
  if (structuralIssues.length || primaryQa.draftModel === null) {
    throw new Error(
      `Primary candidates are not a complete, single-model exact tree: ${JSON.stringify(
        structuralIssues.slice(0, 20),
      )}.`,
    );
  }

  const worklists = loadWorklistTree(worklistDir);
  const candidates = loadCandidateTree(primaryCandidateDir);
  assertTreePathsEqual(worklists, candidates, "Primary candidate tree");
  const worklistByPath = indexByRelativePath(worklists);
  const candidateByPath = indexByRelativePath(candidates);
  const selections = new Map<string, SelectionAccumulator>();

  for (const issue of primaryQa.issues) {
    if (issue.code !== "candidate-field") continue;
    const selection = selectionForQaIssue(issue, worklistByPath, candidateByPath);
    const identity = fieldIdentity(issue.relativePath, issue.key);
    if (selections.has(identity)) {
      throw new Error(`Duplicate deterministic QA identity ${displayIdentity(identity)}.`);
    }
    selections.set(identity, {
      ...selection,
      deterministicFailures: [...issue.failures],
      semanticReasons: [],
    });
  }

  const semanticAudit = loadSemanticAudit({
    semanticAuditPath,
    worklistDir,
    candidateDir: primaryCandidateDir,
    expectedFields: primaryQa.checkedFields,
    worklistByPath,
    candidateByPath,
  });
  assertRequiredHighQualityRoutingCoverage(worklists, semanticAudit);
  for (const auditEntry of semanticAudit.entries) {
    const identity = fieldIdentity(auditEntry.relativePath, auditEntry.key);
    const existing = selections.get(identity);
    if (existing) {
      existing.semanticReasons = [...auditEntry.reasons];
      continue;
    }
    const worklist = requireMapEntry(
      worklistByPath,
      auditEntry.relativePath,
      "semantic audit worklist",
    );
    const candidate = requireMapEntry(
      candidateByPath,
      auditEntry.relativePath,
      "semantic audit candidate",
    );
    const entryIndex = worklist.entries.findIndex((entry) => entry.key === auditEntry.key);
    if (entryIndex < 0) {
      throw new Error(`Semantic audit identity is stale: ${auditEntry.relativePath}/${auditEntry.key}.`);
    }
    const entry = candidate.entries[entryIndex];
    if (!entry) {
      throw new Error(`Semantic audit candidate entry is missing: ${auditEntry.relativePath}/${auditEntry.key}.`);
    }
    selections.set(identity, {
      worklist,
      candidate,
      entry,
      entryIndex,
      deterministicFailures: [],
      semanticReasons: [...auditEntry.reasons],
    });
  }

  if (!selections.size) {
    throw new Error("Hybrid selection is empty; refusing to create an unusable subset tree.");
  }
  const orderedSelections = orderSelections(worklists, selections);
  const subsetPayloads = buildSubsetWorklistPayloads(worklists, selections);
  writeJsonTreeAtomically(subsetWorklistDir, subsetPayloads);

  try {
    const subsetWorklists = loadWorklistTree(subsetWorklistDir);
    assertSubsetExactlySelected(worklists, subsetWorklists, orderedSelections);
    const identities = orderedSelections.map(selectionIdentity);
    const deterministicFields = identities.filter(
      (identity) => identity.deterministicFailures.length > 0,
    ).length;
    const semanticFields = identities.filter(
      (identity) => identity.semanticReasons.length > 0,
    ).length;
    const overlapFields = identities.filter(
      (identity) =>
        identity.deterministicFailures.length > 0 && identity.semanticReasons.length > 0,
    ).length;
    const worklistDescriptor = describeTree(worklistDir, worklists);
    const primaryDescriptor = describeTree(primaryCandidateDir, candidates);
    const subsetDescriptor = describeTree(subsetWorklistDir, subsetWorklists);
    const manifestCore = {
      schemaVersion: 1,
      kind: "translation-hybrid-selection-manifest",
      worklist: worklistDescriptor,
      primary: {
        ...primaryDescriptor,
        draftModel: primaryQa.draftModel,
      },
      semanticAudit: {
        path: semanticAudit.path,
        sha256: semanticAudit.sha256,
        fields: semanticAudit.fields,
        flagged: semanticAudit.flagged,
      },
      subset: subsetDescriptor,
      counts: {
        deterministicFields,
        deterministicFailureCodes: identities.reduce(
          (sum, identity) => sum + identity.deterministicFailures.length,
          0,
        ),
        semanticFields,
        overlapFields,
        selectedFields: identities.length,
      },
      identities,
    };
    const canonicalSha256 = canonicalJsonSha256(manifestCore);
    writeRestrictedJsonAtomically(selectionManifestPath, {
      ...manifestCore,
      canonicalSha256,
    });
    return {
      subsetWorklistDir,
      selectionManifestPath,
      selectedFiles: subsetWorklists.length,
      selectedFields: identities.length,
      deterministicFields,
      semanticFields,
      overlapFields,
      canonicalSha256,
    };
  } catch (error: unknown) {
    rmSync(subsetWorklistDir, { recursive: true, force: true });
    rmSync(selectionManifestPath, { force: true });
    throw error;
  }
}

export function mergeHybridTranslationRepairCandidates(
  args: MergeHybridTranslationCandidatesArgs,
): MergeHybridTranslationCandidatesResult {
  const worklistDir = resolve(args.worklistDir);
  const primaryCandidateDir = resolve(args.primaryCandidateDir);
  const subsetWorklistDir = resolve(args.subsetWorklistDir);
  const beam4CandidateDir = resolve(args.beam4CandidateDir);
  const selectionManifestPath = resolve(args.selectionManifestPath);
  const outputCandidateDir = resolve(args.outputCandidateDir);
  const manifestPath = resolve(args.manifestPath);
  const compositionManifestPath = args.compositionManifestPath
    ? resolve(args.compositionManifestPath)
    : null;
  const manifestSchemaVersion =
    args.manifestSchemaVersion ?? (compositionManifestPath ? 2 : 1);
  if (manifestSchemaVersion === 2 && !compositionManifestPath) {
    throw new Error("Hybrid manifest schemaVersion 2 requires --composition-manifest.");
  }
  if (manifestSchemaVersion === 1 && compositionManifestPath) {
    throw new Error("--composition-manifest requires hybrid manifest schemaVersion 2.");
  }
  const hybridDraftModel = requireNonEmptyString(args.hybridDraftModel, "Hybrid draft model");
  assertDifferentPaths(
    [
      worklistDir,
      primaryCandidateDir,
      subsetWorklistDir,
      beam4CandidateDir,
      selectionManifestPath,
      outputCandidateDir,
      manifestPath,
      ...(compositionManifestPath ? [compositionManifestPath] : []),
    ],
    "Hybrid merge inputs and outputs",
  );
  assertDirectoriesDisjoint(
    [
      worklistDir,
      primaryCandidateDir,
      subsetWorklistDir,
      beam4CandidateDir,
      outputCandidateDir,
    ],
    "Hybrid merge tree paths",
  );
  assertIgnoredNewTmpDirectory(outputCandidateDir, "Hybrid candidate output directory");
  assertIgnoredNewTmpFile(manifestPath, "Hybrid candidate manifest");
  assertPathOutsideDirectory(manifestPath, outputCandidateDir, "Hybrid candidate manifest");
  for (const inputDirectory of [
    worklistDir,
    primaryCandidateDir,
    subsetWorklistDir,
    beam4CandidateDir,
  ]) {
    assertPathOutsideDirectory(manifestPath, inputDirectory, "Hybrid candidate manifest");
  }
  assertRegularInputFile(selectionManifestPath, "Selection manifest");
  if (compositionManifestPath) {
    assertIgnoredTmpPath(compositionManifestPath, "V3 composition manifest");
    assertNoSymlinkAncestors(dirname(compositionManifestPath), "V3 composition manifest");
    assertRegularInputFile(compositionManifestPath, "V3 composition manifest");
    assertPathOutsideDirectory(
      compositionManifestPath,
      outputCandidateDir,
      "V3 composition manifest",
    );
    assertTruthfulMixedV3HybridDraftModel(hybridDraftModel);
  }

  const primaryQa = validateTranslationRepairCandidateDirectories({
    worklistDir,
    candidateDir: primaryCandidateDir,
  });
  const primaryStructuralIssues = primaryQa.issues.filter(
    (issue) => issue.code !== "candidate-field",
  );
  if (primaryStructuralIssues.length || primaryQa.draftModel === null) {
    throw new Error(
      `Primary candidates are not a complete, single-model exact tree: ${JSON.stringify(
        primaryStructuralIssues.slice(0, 20),
      )}.`,
    );
  }
  const beam4Qa = validateTranslationRepairCandidateDirectories({
    worklistDir: subsetWorklistDir,
    candidateDir: beam4CandidateDir,
  });
  if (!beam4Qa.ok || beam4Qa.draftModel === null) {
    throw new Error(
      `Beam-4 subset candidates failed exact structural and field QA: ${JSON.stringify(
        beam4Qa.issues.slice(0, 20),
      )}.`,
    );
  }

  const worklists = loadWorklistTree(worklistDir);
  const primaryCandidates = loadCandidateTree(primaryCandidateDir);
  const subsetWorklists = loadWorklistTree(subsetWorklistDir);
  const beam4Candidates = loadCandidateTree(beam4CandidateDir);
  assertTreePathsEqual(worklists, primaryCandidates, "Primary candidate tree");
  assertTreePathsEqual(subsetWorklists, beam4Candidates, "Beam-4 candidate tree");

  const selectionManifest = loadSelectionManifest(selectionManifestPath);
  assertManifestInput(
    selectionManifest.raw.worklist,
    describeTree(worklistDir, worklists),
    "full worklist tree",
  );
  assertManifestInput(
    selectionManifest.raw.primary,
    { ...describeTree(primaryCandidateDir, primaryCandidates), draftModel: primaryQa.draftModel },
    "primary candidate tree",
  );
  assertManifestInput(
    selectionManifest.raw.subset,
    describeTree(subsetWorklistDir, subsetWorklists),
    "subset worklist tree",
  );
  const worklistByPath = indexByRelativePath(worklists);
  const primaryByPath = indexByRelativePath(primaryCandidates);
  assertSelectionIdentitiesExact(
    worklistByPath,
    primaryByPath,
    selectionManifest.identities,
  );
  const semanticAuditProvenance = parseSemanticAuditProvenance(
    selectionManifest.raw.semanticAudit,
  );
  assertRegularInputFile(semanticAuditProvenance.path, "Selection LaBSE audit");
  const semanticAudit = loadSemanticAudit({
    semanticAuditPath: semanticAuditProvenance.path,
    worklistDir,
    candidateDir: primaryCandidateDir,
    expectedFields: primaryQa.checkedFields,
    worklistByPath,
    candidateByPath: primaryByPath,
  });
  assertRequiredHighQualityRoutingCoverage(worklists, semanticAudit);
  if (
    semanticAudit.sha256 !== semanticAuditProvenance.sha256 ||
    semanticAudit.fields !== semanticAuditProvenance.fields ||
    semanticAudit.flagged !== semanticAuditProvenance.flagged
  ) {
    throw new Error("Selection LaBSE audit provenance is stale.");
  }
  assertSemanticAuditMatchesManifest(semanticAudit, selectionManifest.identities);
  assertDeterministicQaMatchesManifest(primaryQa.issues, selectionManifest.identities);
  assertSubsetExactlySelected(worklists, subsetWorklists, selectionManifest.identities);

  const composition = compositionManifestPath
    ? validateV3CompositionManifest({
        compositionManifestPath,
        selectionManifest,
        primaryCandidateDir,
        primaryCandidates,
        primaryDraftModel: primaryQa.draftModel,
        subsetWorklistDir,
        subsetWorklists,
        finalCandidateDir: beam4CandidateDir,
        finalCandidates: beam4Candidates,
        finalDraftModel: beam4Qa.draftModel,
      })
    : null;

  const beam4ByPath = indexByRelativePath(beam4Candidates);
  const selectedByIdentity = new Map(
    selectionManifest.identities.map((identity) => [
      fieldIdentity(identity.relativePath, identity.key),
      identity,
    ]),
  );
  const outputPayloads = primaryCandidates.map((candidate) => {
    const beam4 = beam4ByPath.get(candidate.relativePath);
    const entries = candidate.entries.map((entry) => {
      const identity = selectedByIdentity.get(fieldIdentity(candidate.relativePath, entry.key));
      if (!identity) return entry.raw;
      if (!beam4) {
        throw new Error(`Beam-4 candidate file missing for selected field ${candidate.relativePath}.`);
      }
      const replacement = beam4.entries.find((candidateEntry) => candidateEntry.key === entry.key);
      if (!replacement) {
        throw new Error(`Beam-4 replacement missing for ${candidate.relativePath}/${entry.key}.`);
      }
      assertEntryIdentity(entry, replacement, `${candidate.relativePath}/${entry.key}`);
      return replaceOrderedProperty(entry.raw, "value", replacement.value);
    });
    return {
      relativePath: candidate.relativePath,
      raw: replaceOrderedProperties(candidate.raw, {
        entries,
        draftModel: hybridDraftModel,
      }),
    };
  });

  const stagingDir = stagingPathFor(outputCandidateDir);
  writeJsonTree(stagingDir, outputPayloads);
  try {
    const finalQa = validateTranslationRepairCandidateDirectories({
      worklistDir,
      candidateDir: stagingDir,
    });
    if (!finalQa.ok || finalQa.draftModel !== hybridDraftModel) {
      throw new Error(
        `Final hybrid candidates failed exact structural and field QA: ${JSON.stringify(
          finalQa.issues.slice(0, 20),
        )}.`,
      );
    }
    const stagedCandidates = loadCandidateTree(stagingDir);
    assertOnlySelectedValuesChanged(
      primaryCandidates,
      stagedCandidates,
      beam4Candidates,
      selectedByIdentity,
      hybridDraftModel,
    );
    renameSync(stagingDir, outputCandidateDir);
  } catch (error: unknown) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  try {
    const outputCandidates = loadCandidateTree(outputCandidateDir);
    const outputDescriptor = describeTree(outputCandidateDir, outputCandidates);
    const beam4Descriptor = describeTree(beam4CandidateDir, beam4Candidates);
    const replacementIdentities = selectionManifest.identities.map((identity) => {
      const primary = requireMapEntry(
        primaryByPath,
        identity.relativePath,
        "primary candidate manifest provenance",
      );
      const beam4 = requireMapEntry(
        beam4ByPath,
        identity.relativePath,
        "beam-4 candidate manifest provenance",
      );
      const primaryEntry = primary.entries[identity.entryIndex];
      const beam4Entry = beam4.entries.find((entry) => entry.key === identity.key);
      if (!primaryEntry || !beam4Entry) {
        throw new Error(`Replacement provenance is incomplete for ${identity.relativePath}/${identity.key}.`);
      }
      return {
        ...identity,
        primaryValueSha256: sha256(primaryEntry.value),
        beam4ValueSha256: sha256(beam4Entry.value),
      };
    });
    const provenance = {
      selectionManifestPath,
      selectionManifestSha256: selectionManifest.sha256,
      worklist: describeTree(worklistDir, worklists),
      primary: {
        ...describeTree(primaryCandidateDir, primaryCandidates),
        draftModel: primaryQa.draftModel,
      },
      subset: describeTree(subsetWorklistDir, subsetWorklists),
      beam4: {
        ...beam4Descriptor,
        draftModel: beam4Qa.draftModel,
      },
      ...(composition ? { composition: composition.descriptor } : {}),
    };
    const manifestCore = {
      schemaVersion: manifestSchemaVersion,
      kind: "translation-hybrid-candidate-manifest",
      hybridDraftModel,
      provenance,
      output: {
        ...outputDescriptor,
        draftModel: hybridDraftModel,
      },
      counts: {
        files: outputDescriptor.files,
        fields: outputDescriptor.fields,
        replacedFields: replacementIdentities.length,
      },
      identities: replacementIdentities,
    };
    const canonicalSha256 = canonicalJsonSha256(manifestCore);
    writeRestrictedJsonAtomically(manifestPath, { ...manifestCore, canonicalSha256 });
    return {
      outputCandidateDir,
      manifestPath,
      files: outputDescriptor.files,
      fields: outputDescriptor.fields,
      replacedFields: replacementIdentities.length,
      draftModel: hybridDraftModel,
      canonicalSha256,
      ...(composition
        ? { compositionCanonicalSha256: composition.validation.canonicalSha256 }
        : {}),
    };
  } catch (error: unknown) {
    rmSync(outputCandidateDir, { recursive: true, force: true });
    rmSync(manifestPath, { force: true });
    throw error;
  }
}

export function validateHybridTranslationCandidateManifest(
  args: ValidateHybridTranslationCandidateManifestArgs,
): HybridTranslationCandidateManifestValidation {
  return validateHybridTranslationCandidateManifestInternal(
    args,
    validateAfrikaansReconciliationHybridCandidateManifest,
  );
}

/** Synthetic-policy seam used only by isolated fixtures; production consumers never call it. */
export function __testOnlyValidateHybridTranslationCandidateManifest(
  args: ValidateHybridTranslationCandidateManifestArgs & {
    reconciliationPolicy: AfrikaansReconciliationFrozenPolicy;
    reconciliationNowEpochMs?: number;
  },
): HybridTranslationCandidateManifestValidation {
  return validateHybridTranslationCandidateManifestInternal(args, (input) =>
    __testOnlyAfrikaansReconciliationAdapter.validateManifest({
      ...input,
      policy: args.reconciliationPolicy,
      nowEpochMs: args.reconciliationNowEpochMs,
    }),
  );
}

function validateHybridTranslationCandidateManifestInternal(
  args: ValidateHybridTranslationCandidateManifestArgs,
  reconciliationValidator: typeof validateAfrikaansReconciliationHybridCandidateManifest,
): HybridTranslationCandidateManifestValidation {
  const worklistDir = resolve(args.worklistDir);
  const candidateDir = resolve(args.candidateDir);
  const manifestPath = resolve(args.manifestPath);
  assertDifferentPaths(
    [worklistDir, candidateDir, manifestPath],
    "Hybrid manifest validation paths",
  );
  assertDirectoriesDisjoint(
    [worklistDir, candidateDir],
    "Hybrid manifest worklist and candidate trees",
  );
  assertPathOutsideDirectory(manifestPath, worklistDir, "Hybrid candidate manifest");
  assertPathOutsideDirectory(manifestPath, candidateDir, "Hybrid candidate manifest");
  assertNoSymlinkAncestors(dirname(worklistDir), "Hybrid manifest worklist directory");
  assertNoSymlinkAncestors(dirname(candidateDir), "Hybrid manifest candidate directory");
  assertNoSymlinkAncestors(dirname(manifestPath), "Hybrid candidate manifest");
  assertRegularInputFile(manifestPath, "Hybrid candidate manifest");

  const manifestText = readFileSync(manifestPath, "utf8");
  const manifest = parseJsonRecord(manifestText, manifestPath);
  assertExactKeyOrder(
    manifest,
    hybridCandidateManifestRootOrder,
    `hybrid candidate manifest ${manifestPath}`,
  );
  const schemaVersion = manifest.schemaVersion;
  if (schemaVersion === 3) {
    return reconciliationValidator({
      worklistDir,
      candidateDir,
      manifestPath,
    });
  }
  if (
    (schemaVersion !== 1 && schemaVersion !== 2) ||
    manifest.kind !== "translation-hybrid-candidate-manifest" ||
    !isRecord(manifest.provenance) ||
    !isRecord(manifest.output) ||
    !isRecord(manifest.counts) ||
    !Array.isArray(manifest.identities)
  ) {
    throw new Error(`Invalid hybrid candidate manifest metadata in ${manifestPath}.`);
  }
  const hybridDraftModel = requireNonEmptyString(
    manifest.hybridDraftModel,
    "Hybrid candidate manifest draft model",
  );
  if (schemaVersion === 2) assertTruthfulMixedV3HybridDraftModel(hybridDraftModel);
  const canonicalSha256 = requireSha256(
    manifest.canonicalSha256,
    "Hybrid candidate manifest canonical SHA-256",
  );
  const manifestCore = replaceOrderedProperties(
    manifest,
    {},
    new Set(["canonicalSha256"]),
  );
  if (canonicalJsonSha256(manifestCore) !== canonicalSha256) {
    throw new Error(`Hybrid candidate manifest fingerprint mismatch in ${manifestPath}.`);
  }
  assertExactKeyOrder(
    manifest.provenance,
    schemaVersion === 2
      ? hybridCandidateProvenanceV2Order
      : hybridCandidateProvenanceOrder,
    "hybrid candidate manifest provenance",
  );
  assertExactKeyOrder(
    manifest.counts,
    hybridCandidateCountsOrder,
    "hybrid candidate manifest counts",
  );

  const worklists = loadWorklistTree(worklistDir);
  const outputCandidates = loadCandidateTree(candidateDir);
  const finalQa = validateTranslationRepairCandidateDirectories({
    worklistDir,
    candidateDir,
  });
  if (!finalQa.ok || finalQa.draftModel !== hybridDraftModel) {
    throw new Error(
      `Hybrid candidate manifest output failed exact candidate QA: ${JSON.stringify(
        finalQa.issues.slice(0, 20),
      )}.`,
    );
  }
  assertTreePathsEqual(worklists, outputCandidates, "Hybrid manifest output candidate tree");

  const provenance = manifest.provenance;
  const selectionManifestPath = requireCanonicalAbsolutePath(
    provenance.selectionManifestPath,
    "Hybrid selection manifest path",
  );
  const selectionManifestSha256 = requireSha256(
    provenance.selectionManifestSha256,
    "Hybrid selection manifest SHA-256",
  );
  assertNoSymlinkAncestors(dirname(selectionManifestPath), "Hybrid selection manifest");
  assertRegularInputFile(selectionManifestPath, "Hybrid selection manifest");
  const selectionManifest = loadSelectionManifest(selectionManifestPath);
  if (selectionManifest.sha256 !== selectionManifestSha256) {
    throw new Error("Hybrid candidate selection manifest SHA-256 is stale.");
  }

  const primaryCandidateDir = requireTreeDescriptorPath(
    provenance.primary,
    "Hybrid primary candidate tree",
  );
  const subsetWorklistDir = requireTreeDescriptorPath(
    provenance.subset,
    "Hybrid subset worklist tree",
  );
  const beam4CandidateDir = requireTreeDescriptorPath(
    provenance.beam4,
    "Hybrid beam-4 candidate tree",
  );
  assertDirectoriesDisjoint(
    [
      worklistDir,
      candidateDir,
      primaryCandidateDir,
      subsetWorklistDir,
      beam4CandidateDir,
    ],
    "Hybrid manifest provenance trees",
  );
  assertNoSymlinkAncestors(dirname(primaryCandidateDir), "Hybrid primary candidate tree");
  assertNoSymlinkAncestors(dirname(subsetWorklistDir), "Hybrid subset worklist tree");
  assertNoSymlinkAncestors(dirname(beam4CandidateDir), "Hybrid beam-4 candidate tree");

  const primaryQa = validateTranslationRepairCandidateDirectories({
    worklistDir,
    candidateDir: primaryCandidateDir,
  });
  const primaryStructuralIssues = primaryQa.issues.filter(
    (issue) => issue.code !== "candidate-field",
  );
  if (primaryStructuralIssues.length || primaryQa.draftModel === null) {
    throw new Error(
      `Hybrid manifest primary candidates are not an exact single-model tree: ${JSON.stringify(
        primaryStructuralIssues.slice(0, 20),
      )}.`,
    );
  }
  const beam4Qa = validateTranslationRepairCandidateDirectories({
    worklistDir: subsetWorklistDir,
    candidateDir: beam4CandidateDir,
  });
  if (!beam4Qa.ok || beam4Qa.draftModel === null) {
    throw new Error(
      `Hybrid manifest beam-4 candidates failed exact QA: ${JSON.stringify(
        beam4Qa.issues.slice(0, 20),
      )}.`,
    );
  }

  const primaryCandidates = loadCandidateTree(primaryCandidateDir);
  const subsetWorklists = loadWorklistTree(subsetWorklistDir);
  const beam4Candidates = loadCandidateTree(beam4CandidateDir);
  assertTreePathsEqual(worklists, primaryCandidates, "Hybrid manifest primary candidate tree");
  assertTreePathsEqual(subsetWorklists, beam4Candidates, "Hybrid manifest beam-4 tree");

  const worklistDescriptor = describeTree(worklistDir, worklists);
  const primaryDescriptor = {
    ...describeTree(primaryCandidateDir, primaryCandidates),
    draftModel: primaryQa.draftModel,
  };
  const subsetDescriptor = describeTree(subsetWorklistDir, subsetWorklists);
  const beam4Descriptor = {
    ...describeTree(beam4CandidateDir, beam4Candidates),
    draftModel: beam4Qa.draftModel,
  };
  const outputDescriptor = {
    ...describeTree(candidateDir, outputCandidates),
    draftModel: hybridDraftModel,
  };
  const composition =
    schemaVersion === 2
      ? validateV3CompositionFromHybridProvenance({
          provenance,
          worklistDir,
          candidateDir,
          manifestPath,
          selectionManifest,
          primaryCandidateDir,
          primaryCandidates,
          primaryDraftModel: primaryQa.draftModel,
          subsetWorklistDir,
          subsetWorklists,
          finalCandidateDir: beam4CandidateDir,
          finalCandidates: beam4Candidates,
          finalDraftModel: beam4Qa.draftModel,
        })
      : null;
  const expectedProvenance = {
    selectionManifestPath,
    selectionManifestSha256,
    worklist: worklistDescriptor,
    primary: primaryDescriptor,
    subset: subsetDescriptor,
    beam4: beam4Descriptor,
    ...(composition ? { composition: composition.descriptor } : {}),
  };
  assertHybridManifestInput(provenance, expectedProvenance, "provenance");
  assertHybridManifestInput(manifest.output, outputDescriptor, "output candidate tree");
  assertManifestInput(selectionManifest.raw.worklist, worklistDescriptor, "full worklist tree");
  assertManifestInput(selectionManifest.raw.primary, primaryDescriptor, "primary candidate tree");
  assertManifestInput(selectionManifest.raw.subset, subsetDescriptor, "subset worklist tree");

  const worklistByPath = indexByRelativePath(worklists);
  const primaryByPath = indexByRelativePath(primaryCandidates);
  assertSelectionIdentitiesExact(
    worklistByPath,
    primaryByPath,
    selectionManifest.identities,
  );
  const semanticAuditProvenance = parseSemanticAuditProvenance(
    selectionManifest.raw.semanticAudit,
  );
  assertNoSymlinkAncestors(dirname(semanticAuditProvenance.path), "Selection LaBSE audit");
  assertRegularInputFile(semanticAuditProvenance.path, "Selection LaBSE audit");
  const semanticAudit = loadSemanticAudit({
    semanticAuditPath: semanticAuditProvenance.path,
    worklistDir,
    candidateDir: primaryCandidateDir,
    expectedFields: primaryQa.checkedFields,
    worklistByPath,
    candidateByPath: primaryByPath,
  });
  if (
    semanticAudit.sha256 !== semanticAuditProvenance.sha256 ||
    semanticAudit.fields !== semanticAuditProvenance.fields ||
    semanticAudit.flagged !== semanticAuditProvenance.flagged
  ) {
    throw new Error("Hybrid candidate selection LaBSE audit provenance is stale.");
  }
  assertRequiredHighQualityRoutingCoverage(worklists, semanticAudit);
  assertSemanticAuditMatchesManifest(semanticAudit, selectionManifest.identities);
  assertDeterministicQaMatchesManifest(primaryQa.issues, selectionManifest.identities);
  assertSubsetExactlySelected(worklists, subsetWorklists, selectionManifest.identities);

  const beam4ByPath = indexByRelativePath(beam4Candidates);
  const selectedByIdentity = new Map(
    selectionManifest.identities.map((identity) => [
      fieldIdentity(identity.relativePath, identity.key),
      identity,
    ]),
  );
  assertOnlySelectedValuesChanged(
    primaryCandidates,
    outputCandidates,
    beam4Candidates,
    selectedByIdentity,
    hybridDraftModel,
  );
  const expectedIdentities = selectionManifest.identities.map((identity) => {
    const primary = requireMapEntry(
      primaryByPath,
      identity.relativePath,
      "hybrid manifest primary identity",
    );
    const beam4 = requireMapEntry(
      beam4ByPath,
      identity.relativePath,
      "hybrid manifest beam-4 identity",
    );
    const primaryEntry = primary.entries[identity.entryIndex];
    const beam4Entry = beam4.entries.find((entry) => entry.key === identity.key);
    if (!primaryEntry || !beam4Entry) {
      throw new Error(
        `Hybrid manifest replacement provenance is incomplete for ${identity.relativePath}/${identity.key}.`,
      );
    }
    return {
      ...identity,
      primaryValueSha256: sha256(primaryEntry.value),
      beam4ValueSha256: sha256(beam4Entry.value),
    };
  });
  for (const [index, identity] of manifest.identities.entries()) {
    if (!isRecord(identity)) throw new Error(`Invalid hybrid candidate identity ${index}.`);
    assertExactKeyOrder(identity, hybridCandidateIdentityOrder, `hybrid candidate identity ${index}`);
    requireSha256(identity.primaryValueSha256, `hybrid candidate identity ${index} primary hash`);
    requireSha256(identity.beam4ValueSha256, `hybrid candidate identity ${index} beam-4 hash`);
  }
  assertHybridManifestInput(manifest.identities, expectedIdentities, "replacement identities");
  const expectedCounts = {
    files: outputDescriptor.files,
    fields: outputDescriptor.fields,
    replacedFields: expectedIdentities.length,
  };
  assertHybridManifestInput(manifest.counts, expectedCounts, "counts");

  return {
    manifestPath,
    worklistDir,
    candidateDir,
    files: outputDescriptor.files,
    fields: outputDescriptor.fields,
    replacedFields: expectedIdentities.length,
    draftModel: hybridDraftModel,
    canonicalSha256,
    ...(composition ? { composition: composition.validation } : {}),
  };
}

function validateV3CompositionFromHybridProvenance(input: {
  provenance: JsonRecord;
  worklistDir: string;
  candidateDir: string;
  manifestPath: string;
  selectionManifest: SelectionManifest;
  primaryCandidateDir: string;
  primaryCandidates: readonly CandidateDocument[];
  primaryDraftModel: string;
  subsetWorklistDir: string;
  subsetWorklists: readonly WorklistDocument[];
  finalCandidateDir: string;
  finalCandidates: readonly CandidateDocument[];
  finalDraftModel: string;
}): LoadedV3Composition {
  const claimed = parseJsonManifestDescriptor(
    input.provenance.composition,
    "Hybrid v3 composition manifest descriptor",
  );
  assertIgnoredTmpPath(claimed.path, "Hybrid v3 composition manifest");
  assertNoSymlinkAncestors(dirname(claimed.path), "Hybrid v3 composition manifest");
  assertRegularInputFile(claimed.path, "Hybrid v3 composition manifest");
  assertDifferentPaths(
    [
      input.worklistDir,
      input.candidateDir,
      input.manifestPath,
      input.selectionManifest.path,
      input.primaryCandidateDir,
      input.subsetWorklistDir,
      input.finalCandidateDir,
      claimed.path,
    ],
    "Hybrid v3 composition provenance paths",
  );
  for (const directory of [
    input.worklistDir,
    input.candidateDir,
    input.primaryCandidateDir,
    input.subsetWorklistDir,
    input.finalCandidateDir,
  ]) {
    assertPathOutsideDirectory(claimed.path, directory, "Hybrid v3 composition manifest");
  }
  const loaded = validateV3CompositionManifest({
    compositionManifestPath: claimed.path,
    selectionManifest: input.selectionManifest,
    primaryCandidateDir: input.primaryCandidateDir,
    primaryCandidates: input.primaryCandidates,
    primaryDraftModel: input.primaryDraftModel,
    subsetWorklistDir: input.subsetWorklistDir,
    subsetWorklists: input.subsetWorklists,
    finalCandidateDir: input.finalCandidateDir,
    finalCandidates: input.finalCandidates,
    finalDraftModel: input.finalDraftModel,
  });
  assertHybridManifestInput(
    input.provenance.composition,
    loaded.descriptor,
    "v3 composition manifest descriptor",
  );
  return loaded;
}

function validateV3CompositionManifest(
  context: V3CompositionContext,
): LoadedV3Composition {
  const loaded = loadSelfFingerprintedJsonManifest({
    path: context.compositionManifestPath,
    label: "V3 composition manifest",
    rootOrder: v3CompositionManifestRootOrder,
    kind: "translation-v3-composition-manifest",
  });
  const manifest = loaded.raw;
  if (
    !isRecord(manifest.selection) ||
    !isRecord(manifest.base) ||
    !isRecord(manifest.reducedWorklist) ||
    !isRecord(manifest.corrections) ||
    !isRecord(manifest.semanticAudit) ||
    !isRecord(manifest.final) ||
    !isRecord(manifest.counts) ||
    !Array.isArray(manifest.decisions)
  ) {
    throw new Error("V3 composition manifest metadata is incomplete.");
  }
  assertExactKeyOrder(manifest.base, v3CompositionBaseOrder, "V3 composition base");
  assertExactKeyOrder(
    manifest.reducedWorklist,
    v3CompositionReducedWorklistOrder,
    "V3 composition reduced worklist",
  );
  assertExactKeyOrder(
    manifest.corrections,
    v3CompositionCorrectionsOrder,
    "V3 composition corrections",
  );
  assertExactKeyOrder(manifest.counts, v3CompositionCountsOrder, "V3 composition counts");

  const expectedSelectionDescriptor = describeLoadedJsonManifest(
    context.selectionManifest.path,
    context.selectionManifest.raw,
  );
  parseAndAssertJsonManifestDescriptor(
    manifest.selection,
    expectedSelectionDescriptor,
    "V3 composition immutable selection",
  );

  const baseManifestClaim = parseJsonManifestDescriptor(
    manifest.base.manifest,
    "V3 composition base manifest descriptor",
  );
  const base = loadAndValidateV3BaseManifest({
    manifestPath: baseManifestClaim.path,
    context,
  });
  parseAndAssertJsonManifestDescriptor(
    manifest.base.manifest,
    base.manifestDescriptor,
    "V3 composition base manifest",
  );
  assertExactTreeDescriptor(
    manifest.base.tree,
    base.descriptor,
    true,
    "V3 composition base tree",
  );

  const reducedManifestClaim = parseJsonManifestDescriptor(
    manifest.reducedWorklist.manifest,
    "V3 composition reduced-worklist manifest descriptor",
  );
  assertIgnoredTmpPath(reducedManifestClaim.path, "V3 reduced-worklist manifest");
  assertNoSymlinkAncestors(dirname(reducedManifestClaim.path), "V3 reduced-worklist manifest");
  const reducedManifest = loadSelfFingerprintedJsonManifest({
    path: reducedManifestClaim.path,
    label: "V3 reduced-worklist manifest",
    rootOrder: v3ReducedWorklistManifestRootOrder,
    kind: "translation-v3-correction-worklist-manifest",
  });
  parseAndAssertJsonManifestDescriptor(
    manifest.reducedWorklist.manifest,
    reducedManifest.descriptor,
    "V3 composition reduced-worklist manifest",
  );
  const reducedWorklistDir = requireTreeDescriptorPath(
    manifest.reducedWorklist.tree,
    "V3 composition reduced-worklist tree",
  );
  assertIgnoredTmpPath(reducedWorklistDir, "V3 reduced-worklist tree");
  assertNoSymlinkAncestors(dirname(reducedWorklistDir), "V3 reduced-worklist tree");
  const reducedWorklists = loadWorklistTree(reducedWorklistDir);
  assertWorklistTreeIsExactSubset(
    context.subsetWorklists,
    reducedWorklists,
    "V3 reduced-worklist tree",
  );
  const reducedDescriptor = describeTree(reducedWorklistDir, reducedWorklists);
  assertExactTreeDescriptor(
    manifest.reducedWorklist.tree,
    reducedDescriptor,
    false,
    "V3 composition reduced-worklist tree",
  );
  validateV3ReducedWorklistManifest({
    manifest: reducedManifest.raw,
    subsetWorklistDir: context.subsetWorklistDir,
    reducedWorklists,
    reducedDescriptor,
  });

  const generatorClaim = parseByteFileDescriptor(
    manifest.corrections.generator,
    "V3 correction generator descriptor",
  );
  assertIgnoredTmpPath(generatorClaim.path, "V3 correction generator");
  assertNoSymlinkAncestors(dirname(generatorClaim.path), "V3 correction generator");
  assertRegularInputFile(generatorClaim.path, "V3 correction generator");
  assertHybridManifestInput(
    manifest.corrections.generator,
    describeByteFile(generatorClaim.path),
    "v3 correction generator descriptor",
  );

  const correctionCandidateDir = requireTreeDescriptorPath(
    manifest.corrections.tree,
    "V3 correction candidate tree",
  );
  assertIgnoredTmpPath(correctionCandidateDir, "V3 correction candidate tree");
  assertNoSymlinkAncestors(dirname(correctionCandidateDir), "V3 correction candidate tree");
  const correctionQa = validateTranslationRepairCandidateDirectories({
    worklistDir: reducedWorklistDir,
    candidateDir: correctionCandidateDir,
  });
  if (!correctionQa.ok || correctionQa.draftModel === null) {
    throw new Error(
      `V3 correction candidates failed exact structural and field QA: ${JSON.stringify(
        correctionQa.issues.slice(0, 20),
      )}.`,
    );
  }
  const correctionCandidates = loadCandidateTree(correctionCandidateDir);
  assertTreePathsEqual(reducedWorklists, correctionCandidates, "V3 correction candidate tree");
  const correctionDescriptor: CandidateTreeDescriptor = {
    ...describeTree(correctionCandidateDir, correctionCandidates),
    draftModel: correctionQa.draftModel,
  };
  assertExactTreeDescriptor(
    manifest.corrections.tree,
    correctionDescriptor,
    true,
    "V3 composition correction candidate tree",
  );

  const expectedFinalDescriptor: CandidateTreeDescriptor = {
    ...describeTree(context.finalCandidateDir, context.finalCandidates),
    draftModel: context.finalDraftModel,
  };
  assertTruthfulMixedV3SelectedDraftModel(context.finalDraftModel);
  assertExactTreeDescriptor(
    manifest.final,
    expectedFinalDescriptor,
    true,
    "V3 composition final selected tree",
  );

  const decisions = validateV3CompositionDecisions({
    rawDecisions: manifest.decisions,
    selectionIdentities: context.selectionManifest.identities,
    base,
    finalCandidates: context.finalCandidates,
    correctionCandidates,
  });
  validateV3CompositionCounts(manifest.counts, decisions);
  validateV3SemanticAcceptanceManifest({
    descriptor: manifest.semanticAudit,
    compositionManifestPath: context.compositionManifestPath,
    finalDescriptor: expectedFinalDescriptor,
    finalCandidates: context.finalCandidates,
    selectionIdentities: context.selectionManifest.identities,
    decisions,
  });

  const corrections = decisions.filter((decision) => decision.action === "correct").length;
  const preserves = decisions.length - corrections;
  return {
    descriptor: loaded.descriptor,
    validation: {
      path: loaded.descriptor.path,
      byteSha256: loaded.descriptor.byteSha256,
      canonicalSha256: loaded.descriptor.canonicalSha256,
      finalTreeCanonicalSha256: expectedFinalDescriptor.canonicalTreeSha256,
      decisions: decisions.length,
      corrections,
      preserves,
    },
  };
}

function loadAndValidateV3BaseManifest(input: {
  manifestPath: string;
  context: V3CompositionContext;
}): LoadedV3Base {
  const manifestPath = requireCanonicalAbsolutePath(
    input.manifestPath,
    "V3 base candidate manifest path",
  );
  assertIgnoredTmpPath(manifestPath, "V3 base candidate manifest");
  assertNoSymlinkAncestors(dirname(manifestPath), "V3 base candidate manifest");
  const loaded = loadSelfFingerprintedJsonManifest({
    path: manifestPath,
    label: "V3 base candidate manifest",
    rootOrder: v3BaseManifestRootOrder,
    kind: "translation-v3-base-candidate-manifest",
  });
  const manifest = loaded.raw;
  if (
    !isRecord(manifest.selection) ||
    !isRecord(manifest.rawV2) ||
    !isRecord(manifest.primary) ||
    !isRecord(manifest.output) ||
    !isRecord(manifest.counts) ||
    !Array.isArray(manifest.identities)
  ) {
    throw new Error("V3 base candidate manifest metadata is incomplete.");
  }
  assertExactKeyOrder(manifest.selection, v3BaseSelectionOrder, "V3 base selection provenance");
  assertExactKeyOrder(manifest.rawV2, v3BaseRawV2Order, "V3 base raw-v2 provenance");
  assertExactKeyOrder(manifest.counts, v3BaseCountsOrder, "V3 base counts");
  const draftModel = requireNonEmptyString(manifest.draftModel, "V3 base draft model");
  if (draftModel.includes("high-sim-fallback")) {
    throw new Error("V3 base draftModel falsely claims that all primary fallbacks are high-similarity.");
  }
  const expectedSelection = {
    path: input.context.selectionManifest.path,
    sha256: input.context.selectionManifest.sha256,
    canonicalSha256: requireSha256(
      input.context.selectionManifest.raw.canonicalSha256,
      "Immutable selection canonical SHA-256",
    ),
  };
  assertHybridManifestInput(manifest.selection, expectedSelection, "v3 base immutable selection");

  const expectedPrimary: CandidateTreeDescriptor = {
    ...describeTree(input.context.primaryCandidateDir, input.context.primaryCandidates),
    draftModel: input.context.primaryDraftModel,
  };
  assertExactTreeDescriptor(
    manifest.primary,
    expectedPrimary,
    true,
    "V3 base primary candidate tree",
  );

  const rawV2Dir = requireCanonicalAbsolutePath(
    manifest.rawV2.path,
    "V3 base raw-v2 candidate path",
  );
  assertIgnoredTmpPath(rawV2Dir, "V3 base raw-v2 candidates");
  assertNoSymlinkAncestors(dirname(rawV2Dir), "V3 base raw-v2 candidates");
  const rawCandidates = loadCandidateTree(rawV2Dir);
  const rawDescriptor = describeTree(rawV2Dir, rawCandidates);
  assertExactTreeDescriptor(
    manifest.rawV2.tree,
    rawDescriptor,
    false,
    "V3 base raw-v2 candidate tree",
  );
  const rawTreePath = requireTreeDescriptorPath(
    manifest.rawV2.tree,
    "V3 base raw-v2 candidate tree",
  );
  if (rawTreePath !== rawV2Dir) {
    throw new Error("V3 base raw-v2 path and tree descriptor disagree.");
  }
  const checkpointEvidencePath = requireCanonicalAbsolutePath(
    manifest.rawV2.checkpointEvidencePath,
    "V3 raw-v2 checkpoint evidence path",
  );
  assertIgnoredTmpPath(checkpointEvidencePath, "V3 raw-v2 checkpoint evidence");
  assertNoSymlinkAncestors(dirname(checkpointEvidencePath), "V3 raw-v2 checkpoint evidence");
  assertRegularInputFile(checkpointEvidencePath, "V3 raw-v2 checkpoint evidence");
  const checkpointEvidenceSha256 = requireSha256(
    manifest.rawV2.checkpointEvidenceSha256,
    "V3 raw-v2 checkpoint evidence SHA-256",
  );
  if (sha256(readFileSync(checkpointEvidencePath)) !== checkpointEvidenceSha256) {
    throw new Error("V3 raw-v2 checkpoint evidence SHA-256 is stale.");
  }

  const baseCandidateDir = requireTreeDescriptorPath(
    manifest.output,
    "V3 base output candidate tree",
  );
  assertIgnoredTmpPath(baseCandidateDir, "V3 base output candidate tree");
  assertNoSymlinkAncestors(dirname(baseCandidateDir), "V3 base output candidate tree");
  const baseQa = validateTranslationRepairCandidateDirectories({
    worklistDir: input.context.subsetWorklistDir,
    candidateDir: baseCandidateDir,
  });
  const structuralIssues = baseQa.issues.filter((issue) => issue.code !== "candidate-field");
  if (structuralIssues.length || baseQa.draftModel !== draftModel) {
    throw new Error(
      `V3 base candidates are not a complete exact single-model subset tree: ${JSON.stringify(
        structuralIssues.slice(0, 20),
      )}.`,
    );
  }
  const baseCandidates = loadCandidateTree(baseCandidateDir);
  assertTreePathsEqual(input.context.subsetWorklists, baseCandidates, "V3 base candidate tree");
  const baseTreeDescriptor = describeTree(baseCandidateDir, baseCandidates);
  assertExactTreeDescriptor(
    manifest.output,
    baseTreeDescriptor,
    false,
    "V3 base output candidate tree",
  );
  const descriptor: CandidateTreeDescriptor = {
    ...baseTreeDescriptor,
    draftModel,
  };

  const baseByPath = indexByRelativePath(baseCandidates);
  const rawByPath = indexByRelativePath(rawCandidates);
  const identities: V3BaseIdentity[] = [];
  const identityByKey = new Map<string, V3BaseIdentity>();
  let rawCount = 0;
  let primaryCount = 0;
  if (manifest.identities.length !== input.context.selectionManifest.identities.length) {
    throw new Error("V3 base identities do not cover the immutable selection exactly.");
  }
  for (let index = 0; index < manifest.identities.length; index += 1) {
    const rawIdentity = manifest.identities[index];
    const selected = input.context.selectionManifest.identities[index];
    if (!isRecord(rawIdentity) || !selected) {
      throw new Error(`Invalid V3 base identity ${index}.`);
    }
    assertExactKeyOrder(rawIdentity, v3BaseIdentityOrder, `V3 base identity ${index}`);
    const relativePath = requireNonEmptyString(
      rawIdentity.relativePath,
      `V3 base identity ${index} path`,
    );
    const key = requireNonEmptyString(rawIdentity.key, `V3 base identity ${index} key`);
    const sourceSha256 = requireSha256(
      rawIdentity.sourceSha256,
      `V3 base identity ${index} source SHA-256`,
    );
    const origin = parseV3BaseOrigin(rawIdentity.origin, `V3 base identity ${index} origin`);
    const valueSha256 = requireSha256(
      rawIdentity.valueSha256,
      `V3 base identity ${index} value SHA-256`,
    );
    if (
      relativePath !== selected.relativePath ||
      key !== selected.key ||
      sourceSha256 !== sha256(selected.source)
    ) {
      throw new Error(`V3 base identity ${index} drifted from the immutable selection.`);
    }
    const baseDocument = requireMapEntry(baseByPath, relativePath, "V3 base identity document");
    const baseEntry = baseDocument.entries.find((entry) => entry.key === key);
    if (!baseEntry || sha256(baseEntry.value) !== valueSha256) {
      throw new Error(`V3 base value hash is stale for ${relativePath}/${key}.`);
    }
    if (origin === "primary-beam1-fallback") {
      if (baseEntry.value !== selected.primaryValue) {
        throw new Error(`V3 primary fallback value is stale for ${relativePath}/${key}.`);
      }
      primaryCount += 1;
    } else {
      const rawDocument = requireMapEntry(rawByPath, relativePath, "V3 raw-v2 identity document");
      const rawEntry = rawDocument.entries.find((entry) => entry.key === key);
      if (
        !rawEntry ||
        !rawEntry.value.trim() ||
        rawEntry.source !== selected.source ||
        rawEntry.existingCandidate !== selected.existingCandidate ||
        rawEntry.value !== baseEntry.value
      ) {
        throw new Error(`V3 raw-v2 origin is stale for ${relativePath}/${key}.`);
      }
      rawCount += 1;
    }
    const identity: V3BaseIdentity = {
      relativePath,
      key,
      sourceSha256,
      origin,
      valueSha256,
    };
    const identityKey = fieldIdentity(relativePath, key);
    if (identityByKey.has(identityKey)) {
      throw new Error(`Duplicate V3 base identity ${relativePath}/${key}.`);
    }
    identityByKey.set(identityKey, identity);
    identities.push(identity);
  }
  const expectedCounts = {
    "raw-v2-beam4": rawCount,
    "primary-beam1-fallback": primaryCount,
    total: identities.length,
  };
  assertHybridManifestInput(manifest.counts, expectedCounts, "v3 base counts");
  return {
    manifestDescriptor: loaded.descriptor,
    candidates: baseCandidates,
    descriptor,
    identities,
    identityByKey,
  };
}

function validateV3ReducedWorklistManifest(input: {
  manifest: JsonRecord;
  subsetWorklistDir: string;
  reducedWorklists: readonly WorklistDocument[];
  reducedDescriptor: TreeDescriptor;
}) {
  const manifest = input.manifest;
  const sourceWorklists = requireCanonicalAbsolutePath(
    manifest.sourceWorklists,
    "V3 reduced-worklist source tree path",
  );
  if (sourceWorklists !== input.subsetWorklistDir) {
    throw new Error("V3 reduced-worklist manifest does not bind the original selected subset.");
  }
  validatePathSha256Descriptor(manifest.baseQa, "V3 reduced-worklist base QA evidence");
  validatePathSha256Descriptor(manifest.extras, "V3 reduced-worklist extra identities evidence");
  assertExactTreeDescriptor(
    manifest.tree,
    input.reducedDescriptor,
    false,
    "V3 reduced-worklist manifest tree",
  );
  if (!Array.isArray(manifest.identities)) {
    throw new Error("V3 reduced-worklist manifest identities are missing.");
  }
  const expected = input.reducedWorklists.flatMap((worklist) =>
    worklist.entries.map((entry) => ({
      relativePath: worklist.relativePath,
      key: entry.key,
      sourceSha256: sha256(entry.source),
    })),
  );
  if (manifest.identities.length !== expected.length) {
    throw new Error("V3 reduced-worklist manifest identities do not cover its exact tree.");
  }
  for (let index = 0; index < manifest.identities.length; index += 1) {
    const identity = manifest.identities[index];
    const expectedIdentity = expected[index];
    if (!isRecord(identity) || !expectedIdentity) {
      throw new Error(`Invalid V3 reduced-worklist identity ${index}.`);
    }
    assertExactKeyOrder(
      identity,
      v3ReducedWorklistIdentityOrder,
      `V3 reduced-worklist identity ${index}`,
    );
    if (
      identity.relativePath !== expectedIdentity.relativePath ||
      identity.key !== expectedIdentity.key ||
      identity.sourceSha256 !== expectedIdentity.sourceSha256 ||
      !Array.isArray(identity.evidence) ||
      !identity.evidence.length ||
      identity.evidence.some((entry) => !isRecord(entry))
    ) {
      throw new Error(`V3 reduced-worklist identity ${index} is stale or lacks evidence.`);
    }
  }
}

function validatePathSha256Descriptor(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label} descriptor is invalid.`);
  assertExactKeyOrder(value, pathSha256DescriptorOrder, label);
  const path = requireCanonicalAbsolutePath(value.path, `${label} path`);
  const expectedSha256 = requireSha256(value.sha256, `${label} SHA-256`);
  assertIgnoredTmpPath(path, label);
  assertNoSymlinkAncestors(dirname(path), label);
  assertRegularInputFile(path, label);
  if (sha256(readFileSync(path)) !== expectedSha256) {
    throw new Error(`${label} SHA-256 is stale.`);
  }
}

function assertWorklistTreeIsExactSubset(
  full: readonly WorklistDocument[],
  subset: readonly WorklistDocument[],
  label: string,
) {
  const fullByPath = indexByRelativePath(full);
  const seen = new Set<string>();
  let fields = 0;
  for (const subsetDocument of subset) {
    const fullDocument = requireMapEntry(fullByPath, subsetDocument.relativePath, label);
    assertRootIdentity(fullDocument, subsetDocument, subsetDocument.relativePath);
    let priorIndex = -1;
    for (const entry of subsetDocument.entries) {
      const fullIndex = fullDocument.entries.findIndex((candidate) => candidate.key === entry.key);
      const identity = fieldIdentity(subsetDocument.relativePath, entry.key);
      if (
        fullIndex <= priorIndex ||
        fullIndex < 0 ||
        canonicalJson(fullDocument.entries[fullIndex]?.raw) !== canonicalJson(entry.raw) ||
        seen.has(identity)
      ) {
        throw new Error(`${label} is not an exact ordered subset at ${displayIdentity(identity)}.`);
      }
      priorIndex = fullIndex;
      seen.add(identity);
      fields += 1;
    }
  }
  if (!fields) throw new Error(`${label} is empty.`);
}

function validateV3CompositionDecisions(input: {
  rawDecisions: unknown[];
  selectionIdentities: readonly HybridSelectionIdentity[];
  base: LoadedV3Base;
  finalCandidates: readonly CandidateDocument[];
  correctionCandidates: readonly CandidateDocument[];
}) {
  if (input.rawDecisions.length !== input.selectionIdentities.length) {
    throw new Error("V3 composition decisions do not cover the immutable selection exactly.");
  }
  const baseByPath = indexByRelativePath(input.base.candidates);
  const finalByPath = indexByRelativePath(input.finalCandidates);
  const correctionByPath = indexByRelativePath(input.correctionCandidates);
  const decisions: V3CompositionDecision[] = [];
  for (let index = 0; index < input.rawDecisions.length; index += 1) {
    const rawDecision = input.rawDecisions[index];
    const selected = input.selectionIdentities[index];
    if (!isRecord(rawDecision) || !selected) {
      throw new Error(`Invalid V3 composition decision ${index}.`);
    }
    assertExactKeyOrder(
      rawDecision,
      v3CompositionDecisionOrder,
      `V3 composition decision ${index}`,
    );
    const relativePath = requireNonEmptyString(
      rawDecision.relativePath,
      `V3 composition decision ${index} path`,
    );
    const key = requireNonEmptyString(rawDecision.key, `V3 composition decision ${index} key`);
    const sourceSha256 = requireSha256(
      rawDecision.sourceSha256,
      `V3 composition decision ${index} source SHA-256`,
    );
    const baseOrigin = parseV3BaseOrigin(
      rawDecision.baseOrigin,
      `V3 composition decision ${index} base origin`,
    );
    const baseValueSha256 = requireSha256(
      rawDecision.baseValueSha256,
      `V3 composition decision ${index} base value SHA-256`,
    );
    const action = parseV3CompositionAction(
      rawDecision.action,
      `V3 composition decision ${index} action`,
    );
    const finalValueSha256 = requireSha256(
      rawDecision.finalValueSha256,
      `V3 composition decision ${index} final value SHA-256`,
    );
    const method = parseV3CompositionMethod(
      rawDecision.method,
      `V3 composition decision ${index} method`,
    );
    const evidence = requireSortedUniqueStrings(
      rawDecision.evidence,
      `V3 composition decision ${index} evidence`,
    );
    if (!evidence.length) {
      throw new Error(`V3 composition decision ${index} has no acceptance evidence.`);
    }
    if (
      relativePath !== selected.relativePath ||
      key !== selected.key ||
      sourceSha256 !== sha256(selected.source)
    ) {
      throw new Error(`V3 composition decision ${index} drifted from immutable selection order.`);
    }
    const identity = fieldIdentity(relativePath, key);
    const baseIdentity = requireMapEntry(
      input.base.identityByKey,
      identity,
      "V3 composition base identity",
    );
    const baseDocument = requireMapEntry(baseByPath, relativePath, "V3 composition base document");
    const finalDocument = requireMapEntry(finalByPath, relativePath, "V3 composition final document");
    const baseEntry = baseDocument.entries.find((entry) => entry.key === key);
    const finalEntry = finalDocument.entries.find((entry) => entry.key === key);
    if (
      !baseEntry ||
      !finalEntry ||
      baseOrigin !== baseIdentity.origin ||
      baseValueSha256 !== sha256(baseEntry.value) ||
      finalValueSha256 !== sha256(finalEntry.value)
    ) {
      throw new Error(`V3 composition value provenance is stale for ${relativePath}/${key}.`);
    }
    if (action === "preserve") {
      if (finalEntry.value !== baseEntry.value) {
        throw new Error(`V3 preserve decision changed ${relativePath}/${key}.`);
      }
      if (method === "raw-v2" && baseOrigin !== "raw-v2-beam4") {
        throw new Error(`V3 raw-v2 method contradicts the base origin for ${relativePath}/${key}.`);
      }
      if (method === "primary" && baseOrigin !== "primary-beam1-fallback") {
        throw new Error(`V3 primary method contradicts the base origin for ${relativePath}/${key}.`);
      }
      if (isV3CorrectionMethod(method)) {
        throw new Error(`V3 preserve decision claims a correction method for ${relativePath}/${key}.`);
      }
    } else {
      if (!isV3CorrectionMethod(method) && method !== "reviewed-preserve") {
        throw new Error(`V3 correction decision lacks a correction method for ${relativePath}/${key}.`);
      }
      const correctionDocument = requireMapEntry(
        correctionByPath,
        relativePath,
        "V3 correction decision document",
      );
      const correctionEntry = correctionDocument.entries.find((entry) => entry.key === key);
      if (!correctionEntry || correctionEntry.value !== finalEntry.value) {
        throw new Error(
          `V3 correction decision is not the exact bound correction for ${relativePath}/${key}.`,
        );
      }
    }
    decisions.push({
      relativePath,
      key,
      sourceSha256,
      baseOrigin,
      baseValueSha256,
      action,
      finalValueSha256,
      method,
      evidence,
    });
  }
  return decisions;
}

function validateV3CompositionCounts(
  counts: JsonRecord,
  decisions: readonly V3CompositionDecision[],
) {
  const correctedFields = decisions.filter((decision) => decision.action === "correct").length;
  const expected = {
    selectedFields: decisions.length,
    correctedFields,
    preservedFields: decisions.length - correctedFields,
  };
  assertHybridManifestInput(counts, expected, "v3 composition counts");
}

function parseV3BaseOrigin(value: unknown, label: string): V3BaseOrigin {
  if (value !== "raw-v2-beam4" && value !== "primary-beam1-fallback") {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function parseV3CompositionAction(value: unknown, label: string): V3CompositionAction {
  if (value !== "preserve" && value !== "correct") {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function parseV3CompositionMethod(value: unknown, label: string): V3CompositionMethod {
  if (
    value !== "raw-v2" &&
    value !== "primary" &&
    value !== "beam4-f16" &&
    value !== "beam4-f32" &&
    value !== "beam8-f32" &&
    value !== "reviewed-preserve"
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function isV3CorrectionMethod(method: V3CompositionMethod) {
  return method === "beam4-f16" || method === "beam4-f32" || method === "beam8-f32";
}

function validateV3SemanticAcceptanceManifest(input: {
  descriptor: unknown;
  compositionManifestPath: string;
  finalDescriptor: CandidateTreeDescriptor;
  finalCandidates: readonly CandidateDocument[];
  selectionIdentities: readonly HybridSelectionIdentity[];
  decisions: readonly V3CompositionDecision[];
}) {
  const claimed = parseJsonManifestDescriptor(
    input.descriptor,
    "V3 semantic acceptance manifest descriptor",
  );
  assertIgnoredTmpPath(claimed.path, "V3 semantic acceptance manifest");
  assertNoSymlinkAncestors(dirname(claimed.path), "V3 semantic acceptance manifest");
  assertDifferentPaths(
    [claimed.path, input.compositionManifestPath, input.finalDescriptor.path],
    "V3 semantic acceptance paths",
  );
  assertPathOutsideDirectory(
    claimed.path,
    input.finalDescriptor.path,
    "V3 semantic acceptance manifest",
  );
  const loaded = loadSelfFingerprintedJsonManifest({
    path: claimed.path,
    label: "V3 semantic acceptance manifest",
    rootOrder: v3SemanticAcceptanceRootOrder,
    kind: "translation-v3-semantic-acceptance-manifest",
  });
  parseAndAssertJsonManifestDescriptor(
    input.descriptor,
    loaded.descriptor,
    "V3 semantic acceptance manifest",
  );
  const manifest = loaded.raw;
  if (
    !isRecord(manifest.final) ||
    !Array.isArray(manifest.evidence) ||
    !isRecord(manifest.counts) ||
    !Array.isArray(manifest.entries)
  ) {
    throw new Error("V3 semantic acceptance manifest metadata is incomplete.");
  }
  assertExactTreeDescriptor(
    manifest.final,
    input.finalDescriptor,
    true,
    "V3 semantic acceptance final tree",
  );
  assertExactKeyOrder(
    manifest.counts,
    v3SemanticCountsOrder,
    "V3 semantic acceptance counts",
  );

  const evidenceIds = new Set<string>();
  let priorEvidenceId: string | null = null;
  for (let index = 0; index < manifest.evidence.length; index += 1) {
    const rawEvidence = manifest.evidence[index];
    if (!isRecord(rawEvidence)) {
      throw new Error(`Invalid V3 semantic evidence descriptor ${index}.`);
    }
    assertExactKeyOrder(
      rawEvidence,
      v3SemanticEvidenceOrder,
      `V3 semantic evidence descriptor ${index}`,
    );
    const id = requireNonEmptyString(rawEvidence.id, `V3 semantic evidence ${index} id`);
    requireNonEmptyString(rawEvidence.kind, `V3 semantic evidence ${index} kind`);
    if (
      evidenceIds.has(id) ||
      (priorEvidenceId !== null && compareUnicodeCodePoints(priorEvidenceId, id) >= 0)
    ) {
      throw new Error("V3 semantic evidence descriptors must have sorted unique IDs.");
    }
    const descriptor = parseByteFileDescriptor(
      {
        path: rawEvidence.path,
        bytes: rawEvidence.bytes,
        byteSha256: rawEvidence.byteSha256,
      },
      `V3 semantic evidence ${id}`,
    );
    assertIgnoredTmpPath(descriptor.path, `V3 semantic evidence ${id}`);
    assertNoSymlinkAncestors(dirname(descriptor.path), `V3 semantic evidence ${id}`);
    assertRegularInputFile(descriptor.path, `V3 semantic evidence ${id}`);
    if (
      descriptor.path === claimed.path ||
      descriptor.path === input.compositionManifestPath ||
      isInsideDirectory(descriptor.path, input.finalDescriptor.path)
    ) {
      throw new Error(`V3 semantic evidence ${id} has an unsafe recursive path.`);
    }
    const actualDescriptor = describeByteFile(descriptor.path);
    if (
      descriptor.bytes !== actualDescriptor.bytes ||
      descriptor.byteSha256 !== actualDescriptor.byteSha256
    ) {
      throw new Error(`V3 semantic evidence ${id} descriptor is stale.`);
    }
    evidenceIds.add(id);
    priorEvidenceId = id;
  }
  if (!evidenceIds.size) throw new Error("V3 semantic acceptance manifest has no bound evidence.");

  if (
    manifest.entries.length !== input.selectionIdentities.length ||
    input.decisions.length !== input.selectionIdentities.length
  ) {
    throw new Error("V3 semantic acceptance entries do not cover every selected value.");
  }
  const finalByPath = indexByRelativePath(input.finalCandidates);
  let requiredTermFields = 0;
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const rawEntry = manifest.entries[index];
    const selected = input.selectionIdentities[index];
    const decision = input.decisions[index];
    if (!isRecord(rawEntry) || !selected || !decision) {
      throw new Error(`Invalid V3 semantic acceptance entry ${index}.`);
    }
    assertExactKeyOrder(
      rawEntry,
      v3SemanticEntryOrder,
      `V3 semantic acceptance entry ${index}`,
    );
    const relativePath = requireNonEmptyString(
      rawEntry.relativePath,
      `V3 semantic acceptance entry ${index} path`,
    );
    const key = requireNonEmptyString(rawEntry.key, `V3 semantic acceptance entry ${index} key`);
    const sourceSha256 = requireSha256(
      rawEntry.sourceSha256,
      `V3 semantic acceptance entry ${index} source SHA-256`,
    );
    const finalValueSha256 = requireSha256(
      rawEntry.finalValueSha256,
      `V3 semantic acceptance entry ${index} value SHA-256`,
    );
    if (rawEntry.status !== "accepted") {
      throw new Error(`V3 semantic acceptance entry ${index} is not explicitly accepted.`);
    }
    const requiredTerms = requireSortedUniqueStrings(
      rawEntry.requiredTerms,
      `V3 semantic acceptance entry ${index} required terms`,
    );
    const evidence = requireSortedUniqueStrings(
      rawEntry.evidence,
      `V3 semantic acceptance entry ${index} evidence`,
    );
    if (!evidence.length || evidence.some((id) => !evidenceIds.has(id))) {
      throw new Error(`V3 semantic acceptance entry ${index} cites unbound evidence.`);
    }
    const expectedRequiredTerms = [
      ...(requiredV3SemanticTerms.get(fieldIdentity(selected.relativePath, selected.key)) ?? []),
    ];
    if (!sameStrings(requiredTerms, expectedRequiredTerms)) {
      throw new Error(
        `V3 semantic acceptance required-term gate drifted for ${selected.relativePath}/${selected.key}.`,
      );
    }
    const finalDocument = requireMapEntry(
      finalByPath,
      selected.relativePath,
      "V3 semantic acceptance final document",
    );
    const finalEntry = finalDocument.entries.find((entry) => entry.key === selected.key);
    if (
      !finalEntry ||
      relativePath !== selected.relativePath ||
      key !== selected.key ||
      sourceSha256 !== sha256(selected.source) ||
      finalValueSha256 !== sha256(finalEntry.value) ||
      !sameStrings(evidence, decision.evidence)
    ) {
      throw new Error(
        `V3 semantic acceptance entry ${index} is stale for ${selected.relativePath}/${selected.key}.`,
      );
    }
    for (const term of requiredTerms) {
      if (!finalEntry.value.includes(term)) {
        throw new Error(
          `V3 semantic acceptance value for ${selected.relativePath}/${selected.key} omits required term ${term}.`,
        );
      }
    }
    if (requiredTerms.length) requiredTermFields += 1;
  }
  const expectedCounts = {
    fields: input.selectionIdentities.length,
    acceptedFields: input.selectionIdentities.length,
    requiredTermFields,
  };
  assertHybridManifestInput(manifest.counts, expectedCounts, "v3 semantic acceptance counts");
}

export function requiredHighQualityRoutingReason(language: string, namespace: string) {
  if (namespace === "main-app" && coreMainAppHighQualityLanguages.has(language)) {
    return coreMainAppHighQualityReason;
  }
  if (namespace.startsWith("legal:") && legalHighQualityLanguages.has(language)) {
    return legalHighQualityReason;
  }
  return null;
}

function assertRequiredHighQualityRoutingCoverage(
  worklists: readonly WorklistDocument[],
  audit: SemanticAudit,
) {
  const auditByIdentity = new Map(
    audit.entries.map((entry) => [fieldIdentity(entry.relativePath, entry.key), entry]),
  );
  const missing: string[] = [];
  for (const worklist of worklists) {
    const requiredReason = requiredHighQualityRoutingReason(
      worklist.language,
      worklist.namespace,
    );
    if (!requiredReason) continue;
    for (const entry of worklist.entries) {
      const identity = fieldIdentity(worklist.relativePath, entry.key);
      const audited = auditByIdentity.get(identity);
      if (!audited?.reasons.includes(requiredReason)) {
        missing.push(`${displayIdentity(identity)} [${requiredReason}]`);
      }
    }
  }
  if (missing.length) {
    throw new Error(
      `LaBSE audit omitted ${missing.length} required high-quality beam-4 route(s): ` +
        `${missing.slice(0, 20).join(", ")}${missing.length > 20 ? `, +${missing.length - 20} more` : ""}.`,
    );
  }
}

function selectionForQaIssue(
  issue: Extract<TranslationCandidateQaIssue, { code: "candidate-field" }>,
  worklistByPath: Map<string, WorklistDocument>,
  candidateByPath: Map<string, CandidateDocument>,
) {
  const worklist = requireMapEntry(worklistByPath, issue.relativePath, "QA worklist");
  const candidate = requireMapEntry(candidateByPath, issue.relativePath, "QA candidate");
  const entryIndex = worklist.entries.findIndex((entry) => entry.key === issue.key);
  const entry = candidate.entries[entryIndex];
  if (
    entryIndex < 0 ||
    !entry ||
    worklist.namespace !== issue.namespace ||
    worklist.language !== issue.language
  ) {
    throw new Error(`Deterministic QA issue identity is stale: ${issue.relativePath}/${issue.key}.`);
  }
  return { worklist, candidate, entry, entryIndex };
}

function loadSemanticAudit(input: {
  semanticAuditPath: string;
  worklistDir: string;
  candidateDir: string;
  expectedFields: number;
  worklistByPath: Map<string, WorklistDocument>;
  candidateByPath: Map<string, CandidateDocument>;
}): SemanticAudit {
  const rawText = readFileSync(input.semanticAuditPath, "utf8");
  const raw = parseJsonRecord(rawText, input.semanticAuditPath);
  const auditRootKeys = Object.keys(raw);
  const legacySchema = sameStrings(auditRootKeys, legacyAuditRootOrder);
  const deduplicatedSchema = sameStrings(auditRootKeys, deduplicatedAuditRootOrder);
  if (!legacySchema && !deduplicatedSchema) {
    throw new Error(
      `Invalid LaBSE audit root ${input.semanticAuditPath} key order: got ${auditRootKeys.join(",")}.`,
    );
  }
  if (
    deduplicatedSchema &&
    (!isNonNegativeInteger(raw.uniqueSources) ||
      !isNonNegativeInteger(raw.uniqueCandidates) ||
      !isNonNegativeInteger(raw.uniqueExistingCandidates) ||
      (isNonNegativeInteger(raw.fields) &&
        (raw.uniqueSources > raw.fields ||
          raw.uniqueCandidates > raw.fields ||
          raw.uniqueExistingCandidates > raw.fields)))
  ) {
    throw new Error("LaBSE deduplicated encoding counts are invalid.");
  }
  if (
    raw.schemaVersion !== 1 ||
    raw.kind !== "translation-labse-audit" ||
    typeof raw.worklists !== "string" ||
    resolve(raw.worklists) !== input.worklistDir ||
    typeof raw.candidates !== "string" ||
    resolve(raw.candidates) !== input.candidateDir ||
    !isNonNegativeInteger(raw.fields) ||
    raw.fields !== input.expectedFields ||
    !isNonNegativeInteger(raw.flagged) ||
    !isRecord(raw.byReason) ||
    !Array.isArray(raw.entries) ||
    raw.flagged !== raw.entries.length
  ) {
    throw new Error("LaBSE audit metadata is stale or incomplete for the supplied exact trees.");
  }
  const identities = new Set<string>();
  const reasonCounts = new Map<string, number>();
  const entries = raw.entries.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Invalid LaBSE audit entry ${index}.`);
    assertExactKeyOrder(value, auditEntryOrder, `LaBSE audit entry ${index}`);
    const relativePath = requireNonEmptyString(value.file, `LaBSE audit entry ${index} file`);
    const locale = requireNonEmptyString(value.locale, `LaBSE audit entry ${index} locale`);
    const language = requireNonEmptyString(value.language, `LaBSE audit entry ${index} language`);
    const namespace = requireNonEmptyString(value.namespace, `LaBSE audit entry ${index} namespace`);
    const key = requireNonEmptyString(value.key, `LaBSE audit entry ${index} key`);
    const source = requireNonEmptyString(value.source, `LaBSE audit entry ${index} source`);
    const existingCandidate = requireNullableString(
      value.existingCandidate,
      `LaBSE audit entry ${index} existingCandidate`,
    );
    const candidateValue = requireNonEmptyString(value.value, `LaBSE audit entry ${index} value`);
    const reasons = requireSortedUniqueStrings(value.reasons, `LaBSE audit entry ${index} reasons`);
    if (!reasons.length) throw new Error(`LaBSE audit entry ${index} is not flagged.`);
    if (
      !isNonNegativeInteger(value.sourceWordCount) ||
      !isFiniteNumber(value.candidateSimilarity) ||
      !isFiniteNumber(value.existingSimilarity) ||
      !isFiniteNumber(value.similarityDelta) ||
      !isNumberCounter(value.sourceNumbers) ||
      !isNumberCounter(value.valueNumbers)
    ) {
      throw new Error(`Invalid LaBSE scores or number counters at entry ${index}.`);
    }
    const identity = fieldIdentity(relativePath, key);
    if (identities.has(identity)) {
      throw new Error(`Duplicate LaBSE audit identity ${relativePath}/${key}.`);
    }
    identities.add(identity);
    const worklist = input.worklistByPath.get(relativePath);
    const candidate = input.candidateByPath.get(relativePath);
    const entryIndex = worklist?.entries.findIndex((entry) => entry.key === key) ?? -1;
    const worklistEntry = entryIndex >= 0 ? worklist?.entries[entryIndex] : undefined;
    const candidateEntry = entryIndex >= 0 ? candidate?.entries[entryIndex] : undefined;
    if (
      !worklist ||
      !candidate ||
      !worklistEntry ||
      !candidateEntry ||
      worklist.locale !== locale ||
      worklist.language !== language ||
      worklist.namespace !== namespace ||
      worklistEntry.source !== source ||
      worklistEntry.existingCandidate !== existingCandidate ||
      candidateEntry.value !== candidateValue
    ) {
      throw new Error(`LaBSE audit identity is stale: ${relativePath}/${key}.`);
    }
    for (const reason of reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    return {
      relativePath,
      locale,
      language,
      namespace,
      key,
      source,
      existingCandidate,
      value: candidateValue,
      reasons,
    };
  });
  const expectedOrder = [...entries].sort(compareSemanticEntries);
  if (entries.some((entry, index) => entry !== expectedOrder[index])) {
    throw new Error("LaBSE audit entries are not in canonical file/key order.");
  }
  const byReasonEntries = Object.entries(raw.byReason);
  const expectedReasons = [...reasonCounts.entries()].sort(([left], [right]) =>
    compareUnicodeCodePoints(left, right),
  );
  const actualReasons = byReasonEntries.sort(([left], [right]) =>
    compareUnicodeCodePoints(left, right),
  );
  if (
    actualReasons.length !== expectedReasons.length ||
    actualReasons.some(
      ([reason, count], index) =>
        reason !== expectedReasons[index]?.[0] || count !== expectedReasons[index]?.[1],
    )
  ) {
    throw new Error("LaBSE audit reason totals do not match its exact flagged entries.");
  }
  return {
    path: input.semanticAuditPath,
    sha256: sha256(rawText),
    fields: raw.fields,
    flagged: raw.flagged,
    entries,
  };
}

function loadSelectionManifest(file: string): SelectionManifest {
  const text = readFileSync(file, "utf8");
  const raw = parseJsonRecord(text, file);
  assertExactKeyOrder(raw, selectionManifestRootOrder, `selection manifest ${file}`);
  if (
    raw.schemaVersion !== 1 ||
    raw.kind !== "translation-hybrid-selection-manifest" ||
    !isRecord(raw.worklist) ||
    !isRecord(raw.primary) ||
    !isRecord(raw.semanticAudit) ||
    !isRecord(raw.subset) ||
    !isRecord(raw.counts) ||
    !Array.isArray(raw.identities) ||
    typeof raw.canonicalSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.canonicalSha256)
  ) {
    throw new Error(`Invalid hybrid selection manifest metadata in ${file}.`);
  }
  const withoutFingerprint = replaceOrderedProperties(raw, {}, new Set(["canonicalSha256"]));
  const actualFingerprint = canonicalJsonSha256(withoutFingerprint);
  if (actualFingerprint !== raw.canonicalSha256) {
    throw new Error(`Hybrid selection manifest fingerprint mismatch in ${file}.`);
  }
  const identityKeys = new Set<string>();
  const identities = raw.identities.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Invalid selection identity ${index}.`);
    assertExactKeyOrder(value, selectionIdentityOrder, `selection identity ${index}`);
    const relativePath = requireNonEmptyString(value.relativePath, `selection identity ${index} path`);
    const entryIndex = value.entryIndex;
    if (!isNonNegativeInteger(entryIndex)) {
      throw new Error(`Invalid selection identity ${index} entry index.`);
    }
    const identity: HybridSelectionIdentity = {
      relativePath,
      entryIndex,
      language: requireNonEmptyString(value.language, `selection identity ${index} language`),
      locale: requireNonEmptyString(value.locale, `selection identity ${index} locale`),
      namespace: requireNonEmptyString(value.namespace, `selection identity ${index} namespace`),
      sourceHash: requireSha256(value.sourceHash, `selection identity ${index} sourceHash`),
      key: requireNonEmptyString(value.key, `selection identity ${index} key`),
      source: requireNonEmptyString(value.source, `selection identity ${index} source`),
      existingCandidate: requireNullableString(
        value.existingCandidate,
        `selection identity ${index} existingCandidate`,
      ),
      primaryValue: requireNonEmptyString(
        value.primaryValue,
        `selection identity ${index} primaryValue`,
      ),
      deterministicFailures: requireSortedUniqueStrings(
        value.deterministicFailures,
        `selection identity ${index} deterministicFailures`,
      ),
      semanticReasons: requireSortedUniqueStrings(
        value.semanticReasons,
        `selection identity ${index} semanticReasons`,
      ),
    };
    if (!identity.deterministicFailures.length && !identity.semanticReasons.length) {
      throw new Error(`Selection identity ${index} has no provenance reason.`);
    }
    const key = fieldIdentity(identity.relativePath, identity.key);
    if (identityKeys.has(key)) throw new Error(`Duplicate selection identity ${displayIdentity(key)}.`);
    identityKeys.add(key);
    return identity;
  });
  const sorted = [...identities].sort(compareSelectionIdentities);
  if (identities.some((entry, index) => entry !== sorted[index])) {
    throw new Error("Selection identities are not in canonical file/entry order.");
  }
  assertSelectionCounts(raw.counts, identities);
  return { raw, path: file, sha256: sha256(text), identities };
}

function loadWorklistTree(root: string) {
  return collectStrictJsonFiles(root, "Worklist directory").map((file) =>
    parseRepairDocument(file, root, false),
  );
}

function loadCandidateTree(root: string) {
  return collectStrictJsonFiles(root, "Candidate directory").map((file) => {
    const document = parseRepairDocument(file, root, true);
    const draftModel = requireNonEmptyString(
      document.raw.draftModel,
      `candidate draftModel in ${document.relativePath}`,
    );
    return { ...document, draftModel };
  });
}

function parseRepairDocument(file: string, root: string, candidate: false): WorklistDocument;
function parseRepairDocument(file: string, root: string, candidate: true): WorklistDocument;
function parseRepairDocument(
  file: string,
  root: string,
  candidate: boolean,
): WorklistDocument {
  const relativePath = relativeJsonPath(root, file);
  const raw = parseJsonRecord(readFileSync(file, "utf8"), file);
  assertExactKeyOrder(
    raw,
    candidate ? candidateRootOrder : worklistRootOrder,
    `${candidate ? "candidate" : "worklist"} root ${relativePath}`,
  );
  const expectedKind = candidate
    ? "translation-repair-candidate"
    : "translation-repair-worklist";
  if (raw.schemaVersion !== 1 || raw.kind !== expectedKind || !Array.isArray(raw.entries)) {
    throw new Error(`Invalid repair document metadata in ${relativePath}.`);
  }
  const language = requireNonEmptyString(raw.language, `language in ${relativePath}`);
  const locale = requireNonEmptyString(raw.locale, `locale in ${relativePath}`);
  const namespace = requireNonEmptyString(raw.namespace, `namespace in ${relativePath}`);
  const sourceHash = requireSha256(raw.sourceHash, `sourceHash in ${relativePath}`);
  const entries = raw.entries.map((value, index) => parseRepairEntry(value, relativePath, index));
  return { file, relativePath, raw, language, locale, namespace, sourceHash, entries };
}

function parseRepairEntry(value: unknown, relativePath: string, index: number): RepairEntry {
  if (!isRecord(value)) throw new Error(`Invalid repair entry ${relativePath} at ${index}.`);
  assertExactKeyOrder(value, entryOrder, `repair entry ${relativePath} at ${index}`);
  return {
    raw: value,
    key: requireNonEmptyString(value.key, `key in ${relativePath} at ${index}`),
    source: requireNonEmptyString(value.source, `source in ${relativePath} at ${index}`),
    existingCandidate: requireNullableString(
      value.existingCandidate,
      `existingCandidate in ${relativePath} at ${index}`,
    ),
    reasons: requireSortedUniqueStrings(value.reasons, `reasons in ${relativePath} at ${index}`),
    value: requireString(value.value, `value in ${relativePath} at ${index}`),
  };
}

function buildSubsetWorklistPayloads(
  worklists: readonly WorklistDocument[],
  selections: Map<string, SelectionAccumulator>,
) {
  const payloads: { relativePath: string; raw: JsonRecord }[] = [];
  for (const worklist of worklists) {
    const entries = worklist.entries
      .filter((entry) => selections.has(fieldIdentity(worklist.relativePath, entry.key)))
      .map((entry) => entry.raw);
    if (!entries.length) continue;
    payloads.push({
      relativePath: worklist.relativePath,
      raw: replaceOrderedProperty(worklist.raw, "entries", entries),
    });
  }
  return payloads;
}

function assertSubsetExactlySelected(
  fullWorklists: readonly WorklistDocument[],
  subsetWorklists: readonly WorklistDocument[],
  selected: readonly HybridSelectionIdentity[] | readonly SelectionAccumulator[],
) {
  const fullByPath = indexByRelativePath(fullWorklists);
  const selectedIdentities = new Set(
    selected.map((selection) => {
      if ("relativePath" in selection) return fieldIdentity(selection.relativePath, selection.key);
      return fieldIdentity(selection.worklist.relativePath, selection.entry.key);
    }),
  );
  const seen = new Set<string>();
  for (const subset of subsetWorklists) {
    const full = requireMapEntry(fullByPath, subset.relativePath, "full worklist subset comparison");
    assertRootIdentity(full, subset, subset.relativePath);
    let priorIndex = -1;
    for (const entry of subset.entries) {
      const fullIndex = full.entries.findIndex((candidate) => candidate.key === entry.key);
      const identity = fieldIdentity(subset.relativePath, entry.key);
      if (
        fullIndex <= priorIndex ||
        !selectedIdentities.has(identity) ||
        canonicalJson(full.entries[fullIndex]?.raw) !== canonicalJson(entry.raw)
      ) {
        throw new Error(`Subset worklist entry is not an exact ordered selection: ${displayIdentity(identity)}.`);
      }
      priorIndex = fullIndex;
      seen.add(identity);
    }
  }
  if (seen.size !== selectedIdentities.size || [...selectedIdentities].some((key) => !seen.has(key))) {
    throw new Error("Subset worklist tree omits or adds selected identities.");
  }
}

function assertOnlySelectedValuesChanged(
  primary: readonly CandidateDocument[],
  output: readonly CandidateDocument[],
  beam4: readonly CandidateDocument[],
  selected: Map<string, HybridSelectionIdentity>,
  hybridDraftModel: string,
) {
  assertTreePathsEqual(primary, output, "Final hybrid candidate tree");
  const outputByPath = indexByRelativePath(output);
  const beamByPath = indexByRelativePath(beam4);
  let replacements = 0;
  for (const primaryDocument of primary) {
    const outputDocument = requireMapEntry(
      outputByPath,
      primaryDocument.relativePath,
      "final hybrid candidate",
    );
    if (outputDocument.draftModel !== hybridDraftModel) {
      throw new Error(`Hybrid draftModel was not applied to ${primaryDocument.relativePath}.`);
    }
    const expectedRoot = replaceOrderedProperties(primaryDocument.raw, {
      entries: outputDocument.raw.entries,
      draftModel: hybridDraftModel,
    });
    if (canonicalJson(expectedRoot) !== canonicalJson(outputDocument.raw)) {
      throw new Error(`Hybrid output changed candidate root metadata in ${primaryDocument.relativePath}.`);
    }
    for (let index = 0; index < primaryDocument.entries.length; index += 1) {
      const primaryEntry = primaryDocument.entries[index];
      const outputEntry = outputDocument.entries[index];
      if (!primaryEntry || !outputEntry) {
        throw new Error(`Hybrid output entry cardinality drift in ${primaryDocument.relativePath}.`);
      }
      const identity = fieldIdentity(primaryDocument.relativePath, primaryEntry.key);
      const selectedIdentity = selected.get(identity);
      if (!selectedIdentity) {
        if (canonicalJson(primaryEntry.raw) !== canonicalJson(outputEntry.raw)) {
          throw new Error(`Hybrid output changed unselected entry ${displayIdentity(identity)}.`);
        }
        continue;
      }
      const beamDocument = requireMapEntry(
        beamByPath,
        primaryDocument.relativePath,
        "beam-4 replacement comparison",
      );
      const beamEntry = beamDocument.entries.find((entry) => entry.key === primaryEntry.key);
      if (!beamEntry) throw new Error(`Beam-4 replacement missing for ${displayIdentity(identity)}.`);
      const expectedEntry = replaceOrderedProperty(primaryEntry.raw, "value", beamEntry.value);
      if (canonicalJson(expectedEntry) !== canonicalJson(outputEntry.raw)) {
        throw new Error(`Hybrid output did not make the exact selected replacement ${displayIdentity(identity)}.`);
      }
      replacements += 1;
    }
  }
  if (replacements !== selected.size) {
    throw new Error(`Hybrid output replaced ${replacements} fields; expected ${selected.size}.`);
  }
}

function assertDeterministicQaMatchesManifest(
  issues: readonly TranslationCandidateQaIssue[],
  identities: readonly HybridSelectionIdentity[],
) {
  const expected = new Map(
    identities
      .filter((identity) => identity.deterministicFailures.length > 0)
      .map((identity) => [
        fieldIdentity(identity.relativePath, identity.key),
        identity.deterministicFailures,
      ]),
  );
  const actualIssues = issues.filter(
    (issue): issue is Extract<TranslationCandidateQaIssue, { code: "candidate-field" }> =>
      issue.code === "candidate-field",
  );
  if (actualIssues.length !== expected.size) {
    throw new Error("Primary deterministic QA failures no longer match the exact selection manifest.");
  }
  for (const issue of actualIssues) {
    const failures = expected.get(fieldIdentity(issue.relativePath, issue.key));
    if (
      !failures ||
      !sameStrings(failures, [...issue.failures].sort(compareUnicodeCodePoints))
    ) {
      throw new Error(`Primary deterministic QA failure drifted for ${issue.relativePath}/${issue.key}.`);
    }
  }
}

function assertSemanticAuditMatchesManifest(
  audit: SemanticAudit,
  identities: readonly HybridSelectionIdentity[],
) {
  const expected = new Map(
    identities
      .filter((identity) => identity.semanticReasons.length > 0)
      .map((identity) => [fieldIdentity(identity.relativePath, identity.key), identity.semanticReasons]),
  );
  if (audit.entries.length !== expected.size) {
    throw new Error("LaBSE audit flags no longer match the exact selection manifest.");
  }
  for (const entry of audit.entries) {
    const reasons = expected.get(fieldIdentity(entry.relativePath, entry.key));
    if (!reasons || !sameStrings(reasons, entry.reasons)) {
      throw new Error(`LaBSE audit flag drifted for ${entry.relativePath}/${entry.key}.`);
    }
  }
}

function assertSelectionIdentitiesExact(
  worklistByPath: Map<string, WorklistDocument>,
  candidateByPath: Map<string, CandidateDocument>,
  identities: readonly HybridSelectionIdentity[],
) {
  for (const identity of identities) {
    const worklist = requireMapEntry(
      worklistByPath,
      identity.relativePath,
      "selection worklist identity",
    );
    const candidate = requireMapEntry(
      candidateByPath,
      identity.relativePath,
      "selection candidate identity",
    );
    const worklistEntry = worklist.entries[identity.entryIndex];
    const candidateEntry = candidate.entries[identity.entryIndex];
    if (
      !worklistEntry ||
      !candidateEntry ||
      worklist.language !== identity.language ||
      worklist.locale !== identity.locale ||
      worklist.namespace !== identity.namespace ||
      worklist.sourceHash !== identity.sourceHash ||
      worklistEntry.key !== identity.key ||
      worklistEntry.source !== identity.source ||
      worklistEntry.existingCandidate !== identity.existingCandidate ||
      candidateEntry.key !== identity.key ||
      candidateEntry.source !== identity.source ||
      candidateEntry.existingCandidate !== identity.existingCandidate ||
      candidateEntry.value !== identity.primaryValue
    ) {
      throw new Error(
        `Selection manifest identity is stale: ${identity.relativePath}/${identity.key}.`,
      );
    }
  }
}

function parseSemanticAuditProvenance(value: unknown) {
  if (!isRecord(value)) throw new Error("Selection semantic-audit provenance is invalid.");
  assertExactKeyOrder(
    value,
    ["path", "sha256", "fields", "flagged"],
    "selection semantic-audit provenance",
  );
  const path = resolve(requireNonEmptyString(value.path, "Selection semantic-audit path"));
  const sha256 = requireSha256(value.sha256, "Selection semantic-audit SHA-256");
  if (!isNonNegativeInteger(value.fields) || !isNonNegativeInteger(value.flagged)) {
    throw new Error("Selection semantic-audit counts are invalid.");
  }
  return { path, sha256, fields: value.fields, flagged: value.flagged };
}

function selectionIdentity(selection: SelectionAccumulator): HybridSelectionIdentity {
  return {
    relativePath: selection.worklist.relativePath,
    entryIndex: selection.entryIndex,
    language: selection.worklist.language,
    locale: selection.worklist.locale,
    namespace: selection.worklist.namespace,
    sourceHash: selection.worklist.sourceHash,
    key: selection.entry.key,
    source: selection.entry.source,
    existingCandidate: selection.entry.existingCandidate,
    primaryValue: selection.entry.value,
    deterministicFailures: [...selection.deterministicFailures].sort(
      compareUnicodeCodePoints,
    ),
    semanticReasons: [...selection.semanticReasons].sort(compareUnicodeCodePoints),
  };
}

function orderSelections(
  worklists: readonly WorklistDocument[],
  selections: Map<string, SelectionAccumulator>,
) {
  const ordered: SelectionAccumulator[] = [];
  for (const worklist of worklists) {
    for (const entry of worklist.entries) {
      const selection = selections.get(fieldIdentity(worklist.relativePath, entry.key));
      if (selection) ordered.push(selection);
    }
  }
  if (ordered.length !== selections.size) {
    throw new Error("Selected field identities do not form an exact subset of the full worklists.");
  }
  return ordered;
}

function describeTree(
  root: string,
  documents: readonly WorklistDocument[] | readonly CandidateDocument[],
): TreeDescriptor {
  const fileRecords = documents.map((document) => {
    const bytes = readFileSync(document.file);
    return {
      relativePath: document.relativePath,
      bytes: bytes.byteLength,
      fields: document.entries.length,
      byteSha256: sha256(bytes),
      canonicalSha256: canonicalJsonSha256(document.raw),
    };
  });
  return {
    path: root,
    files: fileRecords.length,
    fields: fileRecords.reduce((sum, entry) => sum + entry.fields, 0),
    byteTreeSha256: canonicalJsonSha256(
      fileRecords.map(({ relativePath, bytes, byteSha256 }) => ({
        relativePath,
        bytes,
        byteSha256,
      })),
    ),
    canonicalTreeSha256: canonicalJsonSha256(
      fileRecords.map(({ relativePath, fields, canonicalSha256 }) => ({
        relativePath,
        fields,
        canonicalSha256,
      })),
    ),
    fileRecords,
  };
}

function loadSelfFingerprintedJsonManifest(input: {
  path: string;
  label: string;
  rootOrder: readonly string[];
  kind: string;
}): LoadedJsonManifest {
  const path = requireCanonicalAbsolutePath(input.path, `${input.label} path`);
  assertNoSymlinkAncestors(dirname(path), input.label);
  assertRegularInputFile(path, input.label);
  const bytes = readFileSync(path);
  const raw = parseJsonRecord(bytes.toString("utf8"), path);
  assertExactKeyOrder(raw, input.rootOrder, input.label);
  if (raw.schemaVersion !== 1 || raw.kind !== input.kind) {
    throw new Error(`${input.label} metadata is invalid.`);
  }
  const canonicalSha256 = requireSha256(
    raw.canonicalSha256,
    `${input.label} canonical SHA-256`,
  );
  const core = replaceOrderedProperties(raw, {}, new Set(["canonicalSha256"]));
  if (canonicalJsonSha256(core) !== canonicalSha256) {
    throw new Error(`${input.label} canonical fingerprint is stale or tampered.`);
  }
  return {
    raw,
    descriptor: {
      path,
      bytes: bytes.byteLength,
      byteSha256: sha256(bytes),
      canonicalSha256,
    },
  };
}

function describeLoadedJsonManifest(path: string, expectedRaw: JsonRecord) {
  const canonicalPath = requireCanonicalAbsolutePath(path, "JSON manifest path");
  assertNoSymlinkAncestors(dirname(canonicalPath), "JSON manifest");
  assertRegularInputFile(canonicalPath, "JSON manifest");
  const bytes = readFileSync(canonicalPath);
  const current = parseJsonRecord(bytes.toString("utf8"), canonicalPath);
  if (canonicalJson(current) !== canonicalJson(expectedRaw)) {
    throw new Error(`JSON manifest drifted while it was being validated: ${canonicalPath}.`);
  }
  const canonicalSha256 = requireSha256(
    current.canonicalSha256,
    `JSON manifest canonical SHA-256 in ${canonicalPath}`,
  );
  const core = replaceOrderedProperties(current, {}, new Set(["canonicalSha256"]));
  if (canonicalJsonSha256(core) !== canonicalSha256) {
    throw new Error(`JSON manifest canonical fingerprint is stale: ${canonicalPath}.`);
  }
  return {
    path: canonicalPath,
    bytes: bytes.byteLength,
    byteSha256: sha256(bytes),
    canonicalSha256,
  } satisfies JsonManifestDescriptor;
}

function parseJsonManifestDescriptor(value: unknown, label: string): JsonManifestDescriptor {
  if (!isRecord(value)) throw new Error(`${label} is invalid.`);
  assertExactKeyOrder(value, jsonManifestDescriptorOrder, label);
  const path = requireCanonicalAbsolutePath(value.path, `${label} path`);
  if (!isNonNegativeInteger(value.bytes) || value.bytes === 0) {
    throw new Error(`${label} byte count is invalid.`);
  }
  return {
    path,
    bytes: value.bytes,
    byteSha256: requireSha256(value.byteSha256, `${label} byte SHA-256`),
    canonicalSha256: requireSha256(value.canonicalSha256, `${label} canonical SHA-256`),
  };
}

function parseAndAssertJsonManifestDescriptor(
  actual: unknown,
  expected: JsonManifestDescriptor,
  label: string,
) {
  const parsed = parseJsonManifestDescriptor(actual, label);
  if (canonicalJson(parsed) !== canonicalJson(expected)) {
    throw new Error(`${label} descriptor is stale or tampered.`);
  }
}

function parseByteFileDescriptor(value: unknown, label: string): ByteFileDescriptor {
  if (!isRecord(value)) throw new Error(`${label} is invalid.`);
  assertExactKeyOrder(value, byteFileDescriptorOrder, label);
  const path = requireCanonicalAbsolutePath(value.path, `${label} path`);
  if (!isNonNegativeInteger(value.bytes) || value.bytes === 0) {
    throw new Error(`${label} byte count is invalid.`);
  }
  return {
    path,
    bytes: value.bytes,
    byteSha256: requireSha256(value.byteSha256, `${label} byte SHA-256`),
  };
}

function describeByteFile(path: string): ByteFileDescriptor {
  const bytes = readFileSync(path);
  return {
    path,
    bytes: bytes.byteLength,
    byteSha256: sha256(bytes),
  };
}

function assertExactTreeDescriptor(
  actual: unknown,
  expected: TreeDescriptor | CandidateTreeDescriptor,
  candidate: boolean,
  label: string,
) {
  if (!isRecord(actual)) throw new Error(`${label} descriptor is invalid.`);
  assertExactKeyOrder(
    actual,
    candidate ? candidateTreeDescriptorOrder : treeDescriptorOrder,
    label,
  );
  if (!Array.isArray(actual.fileRecords)) {
    throw new Error(`${label} file records are invalid.`);
  }
  for (let index = 0; index < actual.fileRecords.length; index += 1) {
    const record = actual.fileRecords[index];
    if (!isRecord(record)) throw new Error(`${label} file record ${index} is invalid.`);
    assertExactKeyOrder(record, treeFileDescriptorOrder, `${label} file record ${index}`);
  }
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} descriptor is stale or tampered.`);
  }
}

function assertTruthfulMixedV3SelectedDraftModel(draftModel: string) {
  if (!draftModel.includes("mixed-v3") || draftModel.includes("high-sim-fallback")) {
    throw new Error(
      "V3 selected candidate draftModel must truthfully identify mixed-v3 composition without claiming all fallbacks are high-similarity.",
    );
  }
}

function assertTruthfulMixedV3HybridDraftModel(draftModel: string) {
  if (
    !draftModel.includes("mixed-v3-selected-subset") ||
    draftModel.includes("high-sim-fallback")
  ) {
    throw new Error(
      "Hybrid v2 draftModel must truthfully identify the mixed-v3 selected-subset overlay.",
    );
  }
}

function assertManifestInput(actual: unknown, expected: unknown, label: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`Selection manifest ${label} provenance is stale.`);
  }
}

function assertHybridManifestInput(actual: unknown, expected: unknown, label: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`Hybrid candidate manifest ${label} is stale or tampered.`);
  }
}

function requireCanonicalAbsolutePath(value: unknown, label: string) {
  const path = requireNonEmptyString(value, label);
  const absolute = resolve(path);
  if (path !== absolute) throw new Error(`${label} must be an absolute canonical path.`);
  return absolute;
}

function requireTreeDescriptorPath(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label} descriptor is invalid.`);
  return requireCanonicalAbsolutePath(value.path, `${label} path`);
}

function assertSelectionCounts(counts: JsonRecord, identities: readonly HybridSelectionIdentity[]) {
  const expected = {
    deterministicFields: identities.filter((entry) => entry.deterministicFailures.length > 0).length,
    deterministicFailureCodes: identities.reduce(
      (sum, entry) => sum + entry.deterministicFailures.length,
      0,
    ),
    semanticFields: identities.filter((entry) => entry.semanticReasons.length > 0).length,
    overlapFields: identities.filter(
      (entry) => entry.deterministicFailures.length > 0 && entry.semanticReasons.length > 0,
    ).length,
    selectedFields: identities.length,
  };
  if (canonicalJson(counts) !== canonicalJson(expected)) {
    throw new Error("Selection manifest counts do not match its exact identities.");
  }
}

function assertRootIdentity(
  full: WorklistDocument,
  subset: WorklistDocument,
  relativePath: string,
) {
  if (
    full.language !== subset.language ||
    full.locale !== subset.locale ||
    full.namespace !== subset.namespace ||
    full.sourceHash !== subset.sourceHash
  ) {
    throw new Error(`Subset root identity drift in ${relativePath}.`);
  }
  const expected = replaceOrderedProperty(full.raw, "entries", subset.raw.entries);
  if (canonicalJson(expected) !== canonicalJson(subset.raw)) {
    throw new Error(`Subset root metadata drift in ${relativePath}.`);
  }
}

function assertEntryIdentity(left: RepairEntry, right: RepairEntry, label: string) {
  const expected = replaceOrderedProperty(left.raw, "value", right.value);
  if (canonicalJson(expected) !== canonicalJson(right.raw)) {
    throw new Error(`Beam-4 candidate entry identity drift at ${label}.`);
  }
}

function assertTreePathsEqual(
  left: readonly WorklistDocument[],
  right: readonly WorklistDocument[],
  label: string,
) {
  const leftPaths = left.map((entry) => entry.relativePath);
  const rightPaths = right.map((entry) => entry.relativePath);
  if (!sameStrings(leftPaths, rightPaths)) {
    throw new Error(`${label} paths do not exactly match their worklists.`);
  }
}

function indexByRelativePath<T extends WorklistDocument>(documents: readonly T[]) {
  return new Map(documents.map((document) => [document.relativePath, document]));
}

function requireMapEntry<T>(map: Map<string, T>, key: string, label: string): T {
  const value = map.get(key);
  if (!value) throw new Error(`Missing ${label}: ${key}.`);
  return value;
}

function collectStrictJsonFiles(root: string, label: string) {
  const stats = lstatSync(root, { throwIfNoEntry: false });
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${root}.`);
  }
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${file}.`);
      if (entry.isDirectory()) {
        visit(file);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(file);
      } else {
        throw new Error(`${label} contains an unexpected file: ${file}.`);
      }
    }
  };
  visit(root);
  if (!files.length) throw new Error(`${label} is empty: ${root}.`);
  return files.sort(compareUnicodeCodePoints);
}

function writeJsonTreeAtomically(
  outputDir: string,
  payloads: readonly { relativePath: string; raw: JsonRecord }[],
) {
  const stagingDir = stagingPathFor(outputDir);
  writeJsonTree(stagingDir, payloads);
  try {
    renameSync(stagingDir, outputDir);
  } catch (error: unknown) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function writeJsonTree(
  outputDir: string,
  payloads: readonly { relativePath: string; raw: JsonRecord }[],
) {
  if (!payloads.length) throw new Error("Refusing to write an empty JSON tree.");
  mkdirSync(outputDir, { recursive: false, mode: 0o700 });
  try {
    for (const payload of payloads) {
      const file = resolve(outputDir, payload.relativePath);
      if (!isInsideDirectory(file, outputDir)) {
        throw new Error(`Unsafe JSON tree path ${payload.relativePath}.`);
      }
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeNewFile(file, `${JSON.stringify(payload.raw, null, 2)}\n`, 0o600);
    }
  } catch (error: unknown) {
    rmSync(outputDir, { recursive: true, force: true });
    throw error;
  }
}

function writeRestrictedJsonAtomically(file: string, payload: unknown) {
  const temporary = `${file}.staging-${process.pid}-${randomUUID()}`;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeNewFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 0o600);
    renameSync(temporary, file);
    chmodSync(file, 0o600);
  } catch (error: unknown) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function writeNewFile(file: string, contents: string, mode: number) {
  const descriptor = openSync(file, "wx", mode);
  try {
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    fchmodSync(descriptor, mode);
  } finally {
    closeSync(descriptor);
  }
}

function stagingPathFor(outputDir: string) {
  mkdirSync(dirname(outputDir), { recursive: true, mode: 0o700 });
  return resolve(
    dirname(outputDir),
    `.${basename(outputDir)}.staging-${process.pid}-${randomUUID()}`,
  );
}

function assertIgnoredNewTmpDirectory(path: string, label: string) {
  assertIgnoredTmpPath(path, label);
  if (existsSync(path)) throw new Error(`${label} already exists: ${path}.`);
  assertNoSymlinkAncestors(dirname(path), label);
}

function assertIgnoredNewTmpFile(path: string, label: string) {
  assertIgnoredTmpPath(path, label);
  if (existsSync(path)) throw new Error(`${label} already exists: ${path}.`);
  assertNoSymlinkAncestors(dirname(path), label);
}

function assertIgnoredTmpPath(path: string, label: string) {
  const tmpRoot = resolve("tmp");
  if (!isInsideDirectory(path, tmpRoot)) {
    throw new Error(`${label} must be a distinct ignored path below ${tmpRoot}.`);
  }
}

function assertNoSymlinkAncestors(path: string, label: string) {
  const root = resolve(".");
  const target = resolve(path);
  if (target !== root && !isInsideDirectory(target, root)) {
    throw new Error(`${label} parent is outside the repository.`);
  }
  let cursor = root;
  const suffix = relative(root, target).split(sep).filter(Boolean);
  for (const part of suffix) {
    cursor = resolve(cursor, part);
    const stats = lstatSync(cursor, { throwIfNoEntry: false });
    if (!stats) break;
    if (stats.isSymbolicLink()) throw new Error(`${label} parent contains a symbolic link: ${cursor}.`);
    if (!stats.isDirectory()) throw new Error(`${label} parent is not a directory: ${cursor}.`);
  }
}

function assertRegularInputFile(file: string, label: string) {
  const stats = lstatSync(file, { throwIfNoEntry: false });
  if (!stats?.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real file: ${file}.`);
  }
}

function assertPathOutsideDirectory(path: string, directory: string, label: string) {
  if (isInsideDirectory(path, directory)) {
    throw new Error(`${label} must be outside ${directory} so the JSON tree remains exact.`);
  }
}

function assertDifferentPaths(paths: readonly string[], label: string) {
  const unique = new Set(paths);
  if (unique.size !== paths.length) throw new Error(`${label} must all be distinct paths.`);
}

function assertDirectoriesDisjoint(paths: readonly string[], label: string) {
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      const left = paths[leftIndex];
      const right = paths[rightIndex];
      if (!left || !right) continue;
      if (isInsideDirectory(left, right) || isInsideDirectory(right, left)) {
        throw new Error(`${label} must be disjoint: ${left} and ${right}.`);
      }
    }
  }
}

function isInsideDirectory(path: string, directory: string) {
  const suffix = relative(directory, path);
  return Boolean(suffix) && !suffix.startsWith(`..${sep}`) && suffix !== ".." && !suffix.includes(`${sep}..${sep}`);
}

function parseJsonRecord(text: string, label: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error: unknown) {
    throw new Error(
      `Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (!isRecord(value)) throw new Error(`Expected a JSON object in ${label}.`);
  return value;
}

function assertExactKeyOrder(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
) {
  const actual = Object.keys(value);
  if (!sameStrings(actual, expected)) {
    throw new Error(
      `Invalid ${label} key order: expected ${expected.join(",")}; got ${actual.join(",")}.`,
    );
  }
}

function replaceOrderedProperty(record: JsonRecord, key: string, value: unknown) {
  return replaceOrderedProperties(record, { [key]: value });
}

function replaceOrderedProperties(
  record: JsonRecord,
  replacements: JsonRecord,
  omissions: ReadonlySet<string> = new Set(),
) {
  const output: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (omissions.has(key)) continue;
    output[key] = Object.prototype.hasOwnProperty.call(replacements, key)
      ? replacements[key]
      : value;
  }
  return output;
}

export function canonicalJsonSha256(value: unknown) {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareUnicodeCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Canonical JSON cannot encode ${typeof value}.`);
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function fieldIdentity(relativePath: string, key: string) {
  return `${relativePath}\u0000${key}`;
}

function displayIdentity(identity: string) {
  return identity.replace("\u0000", "/");
}

function compareSemanticEntries(left: SemanticAuditEntry, right: SemanticAuditEntry) {
  return (
    compareUnicodeCodePoints(left.relativePath, right.relativePath) ||
    compareUnicodeCodePoints(left.key, right.key)
  );
}

function compareSelectionIdentities(
  left: HybridSelectionIdentity,
  right: HybridSelectionIdentity,
) {
  return (
    compareUnicodeCodePoints(left.relativePath, right.relativePath) ||
    left.entryIndex - right.entryIndex ||
    compareUnicodeCodePoints(left.key, right.key)
  );
}

function compareUnicodeCodePoints(left: string, right: string) {
  if (left === right) return 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCodePoint = left.codePointAt(leftIndex);
    const rightCodePoint = right.codePointAt(rightIndex);
    if (leftCodePoint === undefined || rightCodePoint === undefined) {
      throw new Error("Could not read a Unicode code point during canonical comparison.");
    }
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint < rightCodePoint ? -1 : 1;
    }
    leftIndex += leftCodePoint > 0xffff ? 2 : 1;
    rightIndex += rightCodePoint > 0xffff ? 2 : 1;
  }
  return leftIndex === left.length ? -1 : 1;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function relativeJsonPath(root: string, file: string) {
  return relative(root, file).split(sep).join("/");
}

function requireNonEmptyString(value: unknown, label: string) {
  const result = requireString(value, label);
  if (!result.trim()) throw new Error(`${label} must not be empty.`);
  return result;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function requireNullableString(value: unknown, label: string) {
  if (value === null) return null;
  return requireString(value, label);
}

function requireSha256(value: unknown, label: string) {
  const result = requireString(value, label);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label} must be a SHA-256 digest.`);
  return result;
}

function requireSortedUniqueStrings(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  const strings = value.map((entry) => requireNonEmptyString(entry, label));
  const sorted = [...new Set(strings)].sort(compareUnicodeCodePoints);
  if (!sameStrings(strings, sorted)) throw new Error(`${label} must be sorted and unique.`);
  return strings;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumberCounter(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every((count) => isNonNegativeInteger(count) && count > 0)
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ParsedCommand =
  | { mode: "export-subset"; args: ExportHybridTranslationSubsetArgs }
  | { mode: "merge"; args: MergeHybridTranslationCandidatesArgs };

function parseCommandLine(rawArgs: string[]): ParsedCommand {
  const mode = rawArgs[0];
  if (mode !== "export-subset" && mode !== "merge") {
    throw new Error("First argument must be export-subset or merge.");
  }
  const values = new Map<string, string>();
  for (let index = 1; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (!argument.startsWith("--")) throw new Error(`Invalid argument ${argument}.`);
    const equals = argument.indexOf("=");
    const name = equals >= 0 ? argument.slice(2, equals) : argument.slice(2);
    const value = equals >= 0 ? argument.slice(equals + 1) : rawArgs[index + 1];
    if (equals < 0) index += 1;
    if (!name || !value || value.startsWith("--") || values.has(name)) {
      throw new Error(`Invalid or duplicate argument --${name}.`);
    }
    values.set(name, value);
  }
  const allowed =
    mode === "export-subset"
      ? new Set([
          "worklist-dir",
          "primary-candidate-dir",
          "semantic-audit",
          "subset-worklist-dir",
          "selection-manifest",
        ])
      : new Set([
          "worklist-dir",
          "primary-candidate-dir",
          "subset-worklist-dir",
          "beam4-candidate-dir",
          "selection-manifest",
          "output-candidate-dir",
          "hybrid-draft-model",
          "manifest",
          "composition-manifest",
          "manifest-schema-version",
        ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`Unknown ${mode} argument --${key}.`);
  }
  const required = (key: string) => {
    const value = values.get(key);
    if (!value) throw new Error(`Missing required ${mode} argument --${key}.`);
    return value;
  };
  if (mode === "export-subset") {
    return {
      mode,
      args: {
        worklistDir: required("worklist-dir"),
        primaryCandidateDir: required("primary-candidate-dir"),
        semanticAuditPath: required("semantic-audit"),
        subsetWorklistDir: required("subset-worklist-dir"),
        selectionManifestPath: required("selection-manifest"),
      },
    };
  }
  const manifestSchemaVersionValue = values.get("manifest-schema-version");
  if (
    manifestSchemaVersionValue !== undefined &&
    manifestSchemaVersionValue !== "1" &&
    manifestSchemaVersionValue !== "2"
  ) {
    throw new Error("--manifest-schema-version must be 1 or 2.");
  }
  return {
    mode,
    args: {
      worklistDir: required("worklist-dir"),
      primaryCandidateDir: required("primary-candidate-dir"),
      subsetWorklistDir: required("subset-worklist-dir"),
      beam4CandidateDir: required("beam4-candidate-dir"),
      selectionManifestPath: required("selection-manifest"),
      outputCandidateDir: required("output-candidate-dir"),
      hybridDraftModel: required("hybrid-draft-model"),
      manifestPath: required("manifest"),
      ...(values.has("composition-manifest")
        ? { compositionManifestPath: required("composition-manifest") }
        : {}),
      ...(manifestSchemaVersionValue
        ? { manifestSchemaVersion: manifestSchemaVersionValue === "2" ? 2 : 1 }
        : {}),
    },
  };
}
