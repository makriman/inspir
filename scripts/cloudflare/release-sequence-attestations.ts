import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  readPrivateJsonNoFollow,
  writePrivateJsonDurably,
} from "./d1-release-budget-ledger";
import type { GitReleaseIdentity } from "./git-release-identity";
import { cloudflareDir } from "./migration-config";
import type { WorkerDeployArtifactEvidence } from "./worker-deploy-evidence";
import {
  readWorkerCandidateActivationEvidence,
  readWorkerCandidateStagedEvidence,
  readWorkerCandidateUploadEvidence,
  verifyWorkerCandidateActivationEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";
import type {
  VectorizeReadinessReport,
} from "./vectorize-readiness-evidence";
import {
  CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND,
  STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND,
  loadStagedTranslationFallbackD1SiteCorpus,
  type TranslationFallbackReleaseAttestationHandle,
} from "../staged-translation-fallback-release-attestation";

const TOPIC_RECONCILIATION_ATTESTATION =
  "cloudflare/topic-reconciliation-attestation.json";
const TRANSLATION_RECONCILIATION_ATTESTATION =
  "cloudflare/translation-reconciliation-attestation.json";
const TRANSLATION_RECONCILIATION_MAX_AGE_MS = 30 * 60 * 1_000;

const topicKind = "production-topic-reconciliation-v1" as const;
const translationKind = "production-translation-reconciliation-v1" as const;
const stagedTranslationKind =
  "production-staged-translation-reconciliation-v1" as const;
const maximumEvidenceBytes = 64 * 1_024;
const workerVersionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const gitObjectPattern = /^[0-9a-f]{40,64}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export type ReleaseSequenceArtifactSummary = {
  sourceFingerprintSha256: string;
  sourceFingerprintFileCount: number;
  workerSourceSha256: string;
  wranglerConfigSha256: string;
  assetManifestSha256: string;
  assetManifestFileCount: number;
  assetManifestBytes: number;
};

export type ReleaseSequenceIdentity = {
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  git: GitReleaseIdentity;
  artifactEvidence: ReleaseSequenceArtifactSummary;
};

export type ReleaseSequenceServingPhase =
  | "uploaded-inactive"
  | "candidate-active";

export type ReleaseSequenceCurrentRelease = {
  phase: ReleaseSequenceServingPhase;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  phaseEvidenceSha256: string;
  phaseEvidenceCreatedAt: string;
  soleServingVersionId: string;
  git: GitReleaseIdentity;
  artifactEvidence: WorkerDeployArtifactEvidence;
};

export type TopicReconciliationAttestation = {
  kind: typeof topicKind;
  createdAt: string;
  backupDir: string;
  status: "reconciled";
  ok: true;
  release: ReleaseSequenceIdentity;
  vectorizeReadinessCreatedAt: string;
  topic: {
    seedSha256: string;
    verifiedTopics: number;
    verifiedArchivedTopics: number;
  };
};

export type TranslationReconciliationMethod = "read-only-drift" | "atomic-repair";

type StagedTranslationReconciliationCommonBinding = Readonly<{
  releaseMode: "staged-canonical-English-fallback";
  attestationKind:
    | typeof CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND
    | typeof STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND;
  sitePromotionMode: "none-current-availability" | "afrikaans-finalized";
  artifactFileSha256: string;
  attestationSha256: string;
  sourceManifestFileSha256: string;
  sourceCatalogRootSha256: string;
  availabilityManifestFileSha256: string;
  availabilityLogicalSha256: string;
  availabilityNamespaceEntries: number;
  localizedHtmlPaths: number;
  localizedHtmlPathsSha256: string;
  curatedSiteTreeSha256: string;
  staticMainAppTreeSha256: string;
  targetSetSha256: string;
  cleanTargetSetSha256: string;
  pendingLedgerSha256: string;
  pendingEntries: number;
  pendingMissing: number;
  pendingStale: number;
  fallbackPolicySha256: string;
  d1Corpus: Readonly<{
    siteRows: number;
    mainAppRows: number;
    exactRows: number;
    rowSetSha256: string;
    payloadCorpusSha256: string;
    cutoverPolicy: "preserve-serving-baseline-until-candidate-active-cleanup";
    preActivationMutationAllowed: false;
    postActivationExactCleanupRequired: true;
  }>;
}>;

export type CurrentFallbackTranslationReconciliationBinding =
  StagedTranslationReconciliationCommonBinding & Readonly<{
    attestationKind: typeof CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND;
    sitePromotionMode: "none-current-availability";
  }>;

export type AfrikaansFinalizedTranslationReconciliationBinding =
  StagedTranslationReconciliationCommonBinding & Readonly<{
    attestationKind: typeof STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND;
    sitePromotionMode: "afrikaans-finalized";
    afrikaansProofSha256: string;
    afrikaansAuditManifestSha256: string;
    afrikaansSemanticEvidenceSha256: string;
    afrikaansPromotionTransactionId: string;
    afrikaansJournalBindingSha256: string;
    afrikaansPostSiteTreeSha256: string;
  }>;

export type StagedTranslationReconciliationBinding =
  | CurrentFallbackTranslationReconciliationBinding
  | AfrikaansFinalizedTranslationReconciliationBinding;

export type TranslationReconciliationAttestation = {
  kind: typeof translationKind;
  createdAt: string;
  backupDir: string;
  status: "checking" | "reconciled";
  ok: boolean;
  release: ReleaseSequenceIdentity;
  vectorizeReadinessCreatedAt: string;
  topicReconciliationCreatedAt: string;
  method: TranslationReconciliationMethod;
  verification: null | {
    remoteQueries: number;
    billedRowsRead: number;
    repairApplied: boolean;
  };
};

export type StagedTranslationReconciliationAttestation = Omit<
  TranslationReconciliationAttestation,
  "kind"
> & {
  kind: typeof stagedTranslationKind;
  stagedRelease: StagedTranslationReconciliationBinding;
  pendingEvidenceSha256: string | null;
};

export type AnyTranslationReconciliationAttestation =
  | TranslationReconciliationAttestation
  | StagedTranslationReconciliationAttestation;

export function stagedTranslationReconciliationBindingFromAttestation(input: {
  attestation: TranslationFallbackReleaseAttestationHandle;
  d1Corpus: Omit<
    StagedTranslationReconciliationBinding["d1Corpus"],
    | "cutoverPolicy"
    | "preActivationMutationAllowed"
    | "postActivationExactCleanupRequired"
  >;
}): StagedTranslationReconciliationBinding {
  const { artifact } = input.attestation;
  const inventory = artifact.inventory;
  const common = {
    releaseMode: artifact.releaseMode,
    attestationKind: artifact.kind,
    artifactFileSha256: input.attestation.sha256,
    attestationSha256: artifact.attestationSha256,
    sourceManifestFileSha256: inventory.sourceManifest.fileSha256,
    sourceCatalogRootSha256: inventory.sourceManifest.catalogRootSha256,
    availabilityManifestFileSha256:
      inventory.availabilityManifest.fileSha256,
    availabilityLogicalSha256: inventory.availabilityManifest.logicalSha256,
    availabilityNamespaceEntries:
      inventory.availabilityManifest.namespaceEntries,
    localizedHtmlPaths: inventory.availabilityManifest.localizedHtmlPaths,
    localizedHtmlPathsSha256:
      inventory.availabilityManifest.localizedHtmlPathsSha256,
    curatedSiteTreeSha256: inventory.curatedSiteTree.sha256,
    staticMainAppTreeSha256: inventory.staticMainAppTree.sha256,
    targetSetSha256: inventory.targetSetSha256,
    cleanTargetSetSha256: inventory.cleanTargetSetSha256,
    pendingLedgerSha256: inventory.pendingLedger.sha256,
    pendingEntries: inventory.pendingLedger.entries.length,
    pendingMissing: inventory.pendingLedger.missing,
    pendingStale: inventory.pendingLedger.stale,
    fallbackPolicySha256: artifact.fallbackPolicySha256,
    d1Corpus: {
      ...input.d1Corpus,
      cutoverPolicy:
        "preserve-serving-baseline-until-candidate-active-cleanup",
      preActivationMutationAllowed: false,
      postActivationExactCleanupRequired: true,
    },
  } as const;
  if (artifact.kind === CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND) {
    return parseStagedTranslationReconciliationBinding({
      ...common,
      sitePromotionMode: "none-current-availability",
    });
  }
  return parseStagedTranslationReconciliationBinding({
    ...common,
    sitePromotionMode: "afrikaans-finalized",
    afrikaansProofSha256: artifact.afrikaansProof.proofSha256,
    afrikaansAuditManifestSha256:
      artifact.afrikaansProof.auditManifestSha256,
    afrikaansSemanticEvidenceSha256:
      artifact.afrikaansProof.semanticEvidenceSha256,
    afrikaansPromotionTransactionId:
      artifact.afrikaansProof.promotion.transactionId,
    afrikaansJournalBindingSha256:
      artifact.afrikaansProof.promotion.journalBindingSha256,
    afrikaansPostSiteTreeSha256:
      artifact.afrikaansProof.promotion.postSiteTreeSha256,
  });
}

export function releaseSequenceIdentityFromCurrentRelease(
  current: ReleaseSequenceCurrentRelease,
): ReleaseSequenceIdentity {
  const parsed = parseCurrentRelease(current);
  return parseReleaseSequenceIdentity({
    targetCandidateVersionId: parsed.targetCandidateVersionId,
    serviceBaselineVersionId: parsed.serviceBaselineVersionId,
    uploadEvidenceSha256: parsed.uploadEvidenceSha256,
    git: current.git,
    artifactEvidence: summarizeArtifacts(current.artifactEvidence),
  });
}

export function assertReleaseSequenceCurrentReleaseBinding(input: {
  backupDir: string;
  currentRelease: ReleaseSequenceCurrentRelease;
}) {
  const backupDir = path.resolve(input.backupDir);
  const current = parseCurrentRelease(input.currentRelease);
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDir),
  );
  const expectedIdentity = parseReleaseSequenceIdentity({
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    git: upload.value.git,
    artifactEvidence: upload.value.artifacts,
  });
  const currentIdentity = releaseSequenceIdentityFromCurrentRelease(current);
  if (!sameReleaseIdentity(currentIdentity, expectedIdentity)) {
    throw new Error(
      "Current release does not match the immutable uploaded candidate, clean pushed Git, or artifacts.",
    );
  }

  if (current.phase === "uploaded-inactive") {
    if (
      current.phaseEvidenceSha256 !== upload.sha256 ||
      current.phaseEvidenceCreatedAt !== upload.value.createdAt
    ) {
      throw new Error(
        "Uploaded-inactive release phase is not bound to the immutable upload evidence.",
      );
    }
    return { currentRelease: current, identity: currentIdentity, upload } as const;
  }

  const staged = readWorkerCandidateStagedEvidence(
    workerCandidateStagedEvidencePath(backupDir),
  );
  const activation = readWorkerCandidateActivationEvidence(
    workerCandidateActivationEvidencePath(backupDir),
  );
  verifyWorkerCandidateActivationEvidence({
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidence: staged.value,
    stagedEvidenceSha256: staged.sha256,
    activationEvidence: activation.value,
    activationEvidenceSha256: activation.sha256,
  });
  if (
    current.phaseEvidenceSha256 !== activation.sha256 ||
    current.phaseEvidenceCreatedAt !== activation.value.createdAt
  ) {
    throw new Error(
      "Candidate-active release phase is not bound to the complete upload, staged, and activation evidence chain.",
    );
  }
  return {
    currentRelease: current,
    identity: currentIdentity,
    upload,
    staged,
    activation,
  } as const;
}

export function createTopicReconciliationAttestation(input: {
  createdAt: string;
  backupDir: string;
  release: ReleaseSequenceIdentity;
  vectorizeReadinessCreatedAt: string;
  seedSha256: string;
  verifiedTopics: number;
  verifiedArchivedTopics: number;
}) {
  return parseTopicReconciliationAttestation({
    kind: topicKind,
    createdAt: input.createdAt,
    backupDir: path.resolve(input.backupDir),
    status: "reconciled",
    ok: true,
    release: input.release,
    vectorizeReadinessCreatedAt: input.vectorizeReadinessCreatedAt,
    topic: {
      seedSha256: input.seedSha256,
      verifiedTopics: input.verifiedTopics,
      verifiedArchivedTopics: input.verifiedArchivedTopics,
    },
  });
}

export function writeTopicReconciliationAttestation(
  report: TopicReconciliationAttestation,
  backupDir: string,
) {
  return writeAttestation(topicAttestationPath(backupDir), report);
}

export function assertProductionTopicReconciliationReleaseBinding(input: {
  backupDir: string;
  currentRelease: ReleaseSequenceCurrentRelease;
}) {
  const report = parseTopicReconciliationAttestation(
    readPrivateJsonNoFollow(topicAttestationPath(input.backupDir), maximumEvidenceBytes),
  );
  assertBackupAndReleaseBinding(
    report.backupDir,
    report.release,
    input.backupDir,
    input.currentRelease,
    "Topic reconciliation",
  );
  return report;
}

export function writeTranslationReconciliationPending(input: {
  createdAt: string;
  backupDir: string;
  currentRelease: ReleaseSequenceCurrentRelease;
  vectorizeReadiness: Pick<VectorizeReadinessReport, "createdAt">;
  topicAttestation: Pick<
    TopicReconciliationAttestation,
    "createdAt" | "vectorizeReadinessCreatedAt"
  >;
  method: TranslationReconciliationMethod;
  stagedRelease?: StagedTranslationReconciliationBinding;
}) {
  if (input.stagedRelease) {
    assertSelectedCurrentNoPromotionBindingKind(input.stagedRelease);
  }
  assertReleaseSequenceCurrentReleaseBinding({
    backupDir: input.backupDir,
    currentRelease: input.currentRelease,
  });
  const vectorizeReadinessCreatedAt = translationVectorPredecessorTimestamp(input);
  const report = parseAnyTranslationReconciliationAttestation({
    kind: input.stagedRelease ? stagedTranslationKind : translationKind,
    createdAt: input.createdAt,
    backupDir: path.resolve(input.backupDir),
    status: "checking",
    ok: false,
    release: releaseSequenceIdentityFromCurrentRelease(input.currentRelease),
    vectorizeReadinessCreatedAt,
    topicReconciliationCreatedAt: input.topicAttestation.createdAt,
    method: input.method,
    verification: null,
    ...(input.stagedRelease
      ? {
          stagedRelease: input.stagedRelease,
          pendingEvidenceSha256: null,
        }
      : {}),
  });
  writeAttestation(translationAttestationPath(input.backupDir), report);
  return report;
}

export function writeTranslationReconciliationSuccess(input: {
  createdAt: string;
  backupDir: string;
  currentRelease: ReleaseSequenceCurrentRelease;
  vectorizeReadiness: Pick<VectorizeReadinessReport, "createdAt">;
  topicAttestation: Pick<
    TopicReconciliationAttestation,
    "createdAt" | "vectorizeReadinessCreatedAt"
  >;
  method: TranslationReconciliationMethod;
  remoteQueries: number;
  billedRowsRead: number;
  stagedRelease?: StagedTranslationReconciliationBinding;
}) {
  if (input.stagedRelease) {
    assertSelectedCurrentNoPromotionBindingKind(input.stagedRelease);
  }
  assertReleaseSequenceCurrentReleaseBinding({
    backupDir: input.backupDir,
    currentRelease: input.currentRelease,
  });
  const vectorizeReadinessCreatedAt = translationVectorPredecessorTimestamp(input);
  const stagedPending = input.stagedRelease
    ? readExactStagedTranslationPending({
        backupDir: input.backupDir,
        currentRelease: input.currentRelease,
        stagedRelease: input.stagedRelease,
        method: input.method,
        topicCreatedAt: input.topicAttestation.createdAt,
        successCreatedAt: input.createdAt,
      })
    : null;
  const report = parseAnyTranslationReconciliationAttestation({
    kind: input.stagedRelease ? stagedTranslationKind : translationKind,
    createdAt: input.createdAt,
    backupDir: path.resolve(input.backupDir),
    status: "reconciled",
    ok: true,
    release: releaseSequenceIdentityFromCurrentRelease(input.currentRelease),
    vectorizeReadinessCreatedAt,
    topicReconciliationCreatedAt: input.topicAttestation.createdAt,
    method: input.method,
    verification: {
      remoteQueries: input.remoteQueries,
      billedRowsRead: input.billedRowsRead,
      repairApplied: input.method === "atomic-repair",
    },
    ...(input.stagedRelease
      ? {
          stagedRelease: input.stagedRelease,
          pendingEvidenceSha256: stagedPending?.sha256,
        }
      : {}),
  });
  writeAttestation(translationAttestationPath(input.backupDir), report);
  return report;
}

export function assertProductionTranslationReconciliationReleaseBinding(input: {
  backupDir: string;
  currentRelease: ReleaseSequenceCurrentRelease;
}) {
  const topic = assertProductionTopicReconciliationReleaseBinding(input);
  const report = parseAnyTranslationReconciliationAttestation(
    readPrivateJsonNoFollow(translationAttestationPath(input.backupDir), maximumEvidenceBytes),
  );
  assertBackupAndReleaseBinding(
    report.backupDir,
    report.release,
    input.backupDir,
    input.currentRelease,
    "Translation reconciliation",
  );
  if (
    report.status !== "reconciled" ||
    report.ok !== true ||
    report.verification === null ||
    report.topicReconciliationCreatedAt !== topic.createdAt
  ) {
    throw new Error(
      "Translation reconciliation evidence is incomplete or does not follow the current topic reconciliation.",
    );
  }
  if (report.kind === stagedTranslationKind) {
    assertCurrentStagedTranslationBinding(report.stagedRelease);
  }
  return report;
}

export function assertFreshProductionTranslationReconciliation(input: {
  backupDir: string;
  currentRelease: ReleaseSequenceCurrentRelease;
  now?: Date;
}) {
  const report = assertProductionTranslationReconciliationReleaseBinding(input);
  const now = validDate(input.now ?? new Date(), "translation reconciliation validation clock");
  const ageMs = now.getTime() - Date.parse(report.createdAt);
  if (ageMs < 0 || ageMs > TRANSLATION_RECONCILIATION_MAX_AGE_MS) {
    throw new Error("Translation reconciliation evidence is stale or from the future.");
  }
  return report;
}

function parseTopicReconciliationAttestation(
  value: unknown,
): TopicReconciliationAttestation {
  const report = exactRecord(
    value,
    ["backupDir", "createdAt", "kind", "ok", "release", "status", "topic", "vectorizeReadinessCreatedAt"],
    "Topic reconciliation evidence",
  );
  const topic = exactRecord(
    report.topic,
    ["seedSha256", "verifiedArchivedTopics", "verifiedTopics"],
    "Topic reconciliation result",
  );
  const createdAt = exactIsoTimestamp(report.createdAt, "topic reconciliation createdAt");
  const vectorizeReadinessCreatedAt = exactIsoTimestamp(
    report.vectorizeReadinessCreatedAt,
    "topic Vectorize readiness timestamp",
  );
  if (
    report.kind !== topicKind ||
    report.status !== "reconciled" ||
    report.ok !== true ||
    Date.parse(vectorizeReadinessCreatedAt) > Date.parse(createdAt)
  ) {
    throw new Error("Topic reconciliation evidence has the wrong successful release contract.");
  }
  return {
    kind: topicKind,
    createdAt,
    backupDir: absolutePath(report.backupDir, "topic reconciliation backup directory"),
    status: "reconciled",
    ok: true,
    release: parseReleaseSequenceIdentity(report.release),
    vectorizeReadinessCreatedAt,
    topic: {
      seedSha256: sha256(topic.seedSha256, "topic seed hash"),
      verifiedTopics: positiveSafeInteger(topic.verifiedTopics, "verified topics"),
      verifiedArchivedTopics: nonNegativeSafeInteger(
        topic.verifiedArchivedTopics,
        "verified archived topics",
      ),
    },
  };
}

function parseTranslationReconciliationAttestation(
  value: unknown,
): TranslationReconciliationAttestation {
  const report = exactRecord(
    value,
    [
      "backupDir",
      "createdAt",
      "kind",
      "method",
      "ok",
      "release",
      "status",
      "topicReconciliationCreatedAt",
      "vectorizeReadinessCreatedAt",
      "verification",
    ],
    "Translation reconciliation evidence",
  );
  const createdAt = exactIsoTimestamp(report.createdAt, "translation reconciliation createdAt");
  const vectorizeReadinessCreatedAt = exactIsoTimestamp(
    report.vectorizeReadinessCreatedAt,
    "translation Vectorize readiness timestamp",
  );
  const topicReconciliationCreatedAt = exactIsoTimestamp(
    report.topicReconciliationCreatedAt,
    "translation topic reconciliation timestamp",
  );
  const method = translationMethod(report.method);
  const status = report.status;
  let verification: TranslationReconciliationAttestation["verification"] = null;
  if (status === "checking") {
    if (report.ok !== false || report.verification !== null) {
      throw new Error("Checking translation reconciliation evidence cannot authorize a release.");
    }
  } else if (status === "reconciled") {
    if (report.ok !== true) {
      throw new Error("Reconciled translation evidence must be successful.");
    }
    const checked = exactRecord(
      report.verification,
      ["billedRowsRead", "remoteQueries", "repairApplied"],
      "Translation reconciliation verification",
    );
    verification = {
      remoteQueries: positiveSafeInteger(checked.remoteQueries, "translation remote queries"),
      billedRowsRead: nonNegativeSafeInteger(
        checked.billedRowsRead,
        "translation billed rows read",
      ),
      repairApplied: requiredBoolean(checked.repairApplied, "translation repair applied"),
    };
    if (verification.repairApplied !== (method === "atomic-repair")) {
      throw new Error("Translation reconciliation method and repair proof disagree.");
    }
  } else {
    throw new Error("Translation reconciliation evidence has an unknown status.");
  }
  if (
    report.kind !== translationKind ||
    Date.parse(vectorizeReadinessCreatedAt) > Date.parse(topicReconciliationCreatedAt) ||
    Date.parse(vectorizeReadinessCreatedAt) > Date.parse(createdAt) ||
    Date.parse(topicReconciliationCreatedAt) > Date.parse(createdAt)
  ) {
    throw new Error("Translation reconciliation evidence has the wrong release contract.");
  }
  return {
    kind: translationKind,
    createdAt,
    backupDir: absolutePath(report.backupDir, "translation reconciliation backup directory"),
    status,
    ok: status === "reconciled",
    release: parseReleaseSequenceIdentity(report.release),
    vectorizeReadinessCreatedAt,
    topicReconciliationCreatedAt,
    method,
    verification,
  };
}

function parseAnyTranslationReconciliationAttestation(
  value: unknown,
): AnyTranslationReconciliationAttestation {
  if (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === stagedTranslationKind
  ) {
    const report = exactRecord(
      value,
      [
        "backupDir",
        "createdAt",
        "kind",
        "method",
        "ok",
        "pendingEvidenceSha256",
        "release",
        "stagedRelease",
        "status",
        "topicReconciliationCreatedAt",
        "vectorizeReadinessCreatedAt",
        "verification",
      ],
      "Staged translation reconciliation evidence",
    );
    const common = parseTranslationReconciliationAttestation({
      backupDir: report.backupDir,
      createdAt: report.createdAt,
      kind: translationKind,
      method: report.method,
      ok: report.ok,
      release: report.release,
      status: report.status,
      topicReconciliationCreatedAt: report.topicReconciliationCreatedAt,
      vectorizeReadinessCreatedAt: report.vectorizeReadinessCreatedAt,
      verification: report.verification,
    });
    if (
      common.method !== "read-only-drift" ||
      (common.verification !== null &&
        common.verification.repairApplied !== false)
    ) {
      throw new Error(
        "Staged translation reconciliation must remain a read-only preactivation plan seal.",
      );
    }
    return {
      ...common,
      kind: stagedTranslationKind,
      stagedRelease: parseStagedTranslationReconciliationBinding(
        report.stagedRelease,
      ),
      pendingEvidenceSha256:
        common.status === "checking"
          ? requireNull(
              report.pendingEvidenceSha256,
              "checking staged translation pending evidence hash",
            )
          : sha256(
              report.pendingEvidenceSha256,
              "staged translation pending evidence hash",
            ),
    };
  }
  return parseTranslationReconciliationAttestation(value);
}

function readExactStagedTranslationPending(input: {
  backupDir: string;
  currentRelease: ReleaseSequenceCurrentRelease;
  stagedRelease: StagedTranslationReconciliationBinding;
  method: TranslationReconciliationMethod;
  topicCreatedAt: string;
  successCreatedAt: string;
}) {
  const value = readPrivateJsonNoFollow(
    translationAttestationPath(input.backupDir),
    maximumEvidenceBytes,
  );
  const pending = parseAnyTranslationReconciliationAttestation(value);
  if (
    pending.kind !== stagedTranslationKind ||
    pending.status !== "checking" ||
    pending.ok !== false ||
    pending.verification !== null ||
    pending.pendingEvidenceSha256 !== null ||
    pending.method !== input.method ||
    pending.topicReconciliationCreatedAt !== input.topicCreatedAt ||
    !sameReleaseIdentity(
      pending.release,
      releaseSequenceIdentityFromCurrentRelease(input.currentRelease),
    ) ||
    JSON.stringify(pending.stagedRelease) !==
      JSON.stringify(parseStagedTranslationReconciliationBinding(input.stagedRelease)) ||
    Date.parse(pending.createdAt) > Date.parse(input.successCreatedAt)
  ) {
    throw new Error(
      "Staged translation reconciliation success requires its exact pending candidate, release mode, plan, and topic evidence.",
    );
  }
  return {
    value: pending,
    sha256: createHash("sha256")
      .update(JSON.stringify(pending))
      .digest("hex"),
  } as const;
}

function parseStagedTranslationReconciliationBinding(
  value: unknown,
): StagedTranslationReconciliationBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Staged translation release binding must be an object.");
  }
  const sitePromotionMode = Reflect.get(value, "sitePromotionMode");
  const promotionKeys =
    sitePromotionMode === "afrikaans-finalized"
      ? [
          "afrikaansJournalBindingSha256",
          "afrikaansAuditManifestSha256",
          "afrikaansPostSiteTreeSha256",
          "afrikaansPromotionTransactionId",
          "afrikaansProofSha256",
          "afrikaansSemanticEvidenceSha256",
        ]
      : sitePromotionMode === "none-current-availability"
        ? []
        : null;
  if (promotionKeys === null) {
    throw new Error("Staged translation evidence has an unknown site promotion mode.");
  }
  const binding = exactRecord(
    value,
    [
      ...promotionKeys,
      "artifactFileSha256",
      "attestationKind",
      "attestationSha256",
      "availabilityLogicalSha256",
      "availabilityManifestFileSha256",
      "availabilityNamespaceEntries",
      "cleanTargetSetSha256",
      "curatedSiteTreeSha256",
      "d1Corpus",
      "fallbackPolicySha256",
      "localizedHtmlPaths",
      "localizedHtmlPathsSha256",
      "pendingEntries",
      "pendingLedgerSha256",
      "pendingMissing",
      "pendingStale",
      "releaseMode",
      "sitePromotionMode",
      "sourceCatalogRootSha256",
      "sourceManifestFileSha256",
      "staticMainAppTreeSha256",
      "targetSetSha256",
    ],
    "Staged translation release binding",
  );
  const corpus = exactRecord(
    binding.d1Corpus,
    [
      "cutoverPolicy",
      "exactRows",
      "mainAppRows",
      "payloadCorpusSha256",
      "postActivationExactCleanupRequired",
      "preActivationMutationAllowed",
      "rowSetSha256",
      "siteRows",
    ],
    "Staged translation D1 corpus binding",
  );
  if (binding.releaseMode !== "staged-canonical-English-fallback") {
    throw new Error("Staged translation evidence has the wrong release mode.");
  }
  if (
    (sitePromotionMode === "none-current-availability" &&
      binding.attestationKind !==
        CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND) ||
    (sitePromotionMode === "afrikaans-finalized" &&
      binding.attestationKind !== STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND)
  ) {
    throw new Error(
      "Staged translation evidence mixes its attestation kind and promotion mode.",
    );
  }
  const siteRows = positiveSafeInteger(corpus.siteRows, "staged D1 site rows");
  const mainAppRows = positiveSafeInteger(
    corpus.mainAppRows,
    "staged D1 main-app rows",
  );
  const exactRows = positiveSafeInteger(corpus.exactRows, "staged D1 exact rows");
  const pendingEntries = nonNegativeSafeInteger(
    binding.pendingEntries,
    "staged pending entries",
  );
  const pendingMissing = nonNegativeSafeInteger(
    binding.pendingMissing,
    "staged pending missing rows",
  );
  const pendingStale = nonNegativeSafeInteger(
    binding.pendingStale,
    "staged pending stale rows",
  );
  if (
    exactRows !== siteRows + mainAppRows ||
    pendingEntries !== pendingMissing + pendingStale ||
    corpus.cutoverPolicy !==
      "preserve-serving-baseline-until-candidate-active-cleanup" ||
    corpus.preActivationMutationAllowed !== false ||
    corpus.postActivationExactCleanupRequired !== true
  ) {
    throw new Error("Staged translation D1 row accounting is inconsistent.");
  }
  const common = {
    releaseMode: "staged-canonical-English-fallback",
    attestationKind: binding.attestationKind,
    sitePromotionMode,
    artifactFileSha256: sha256(
      binding.artifactFileSha256,
      "staged attestation file hash",
    ),
    attestationSha256: sha256(
      binding.attestationSha256,
      "staged attestation self hash",
    ),
    sourceManifestFileSha256: sha256(
      binding.sourceManifestFileSha256,
      "staged source manifest hash",
    ),
    sourceCatalogRootSha256: sha256(
      binding.sourceCatalogRootSha256,
      "staged source catalog root",
    ),
    availabilityManifestFileSha256: sha256(
      binding.availabilityManifestFileSha256,
      "staged availability manifest hash",
    ),
    availabilityLogicalSha256: sha256(
      binding.availabilityLogicalSha256,
      "staged availability logical hash",
    ),
    availabilityNamespaceEntries: nonNegativeSafeInteger(
      binding.availabilityNamespaceEntries,
      "staged availability namespace entries",
    ),
    localizedHtmlPaths: nonNegativeSafeInteger(
      binding.localizedHtmlPaths,
      "staged localized HTML paths",
    ),
    localizedHtmlPathsSha256: sha256(
      binding.localizedHtmlPathsSha256,
      "staged localized path hash",
    ),
    curatedSiteTreeSha256: sha256(
      binding.curatedSiteTreeSha256,
      "staged curated tree hash",
    ),
    staticMainAppTreeSha256: sha256(
      binding.staticMainAppTreeSha256,
      "staged main-app tree hash",
    ),
    targetSetSha256: sha256(
      binding.targetSetSha256,
      "staged target-set hash",
    ),
    cleanTargetSetSha256: sha256(
      binding.cleanTargetSetSha256,
      "staged clean target hash",
    ),
    pendingLedgerSha256: sha256(
      binding.pendingLedgerSha256,
      "staged pending ledger hash",
    ),
    pendingEntries,
    pendingMissing,
    pendingStale,
    fallbackPolicySha256: sha256(
      binding.fallbackPolicySha256,
      "staged fallback policy hash",
    ),
    d1Corpus: {
      siteRows,
      mainAppRows,
      exactRows,
      rowSetSha256: sha256(corpus.rowSetSha256, "staged D1 row-set hash"),
      payloadCorpusSha256: sha256(
        corpus.payloadCorpusSha256,
        "staged D1 payload corpus hash",
      ),
      cutoverPolicy:
        "preserve-serving-baseline-until-candidate-active-cleanup",
      preActivationMutationAllowed: false,
      postActivationExactCleanupRequired: true,
    },
  } as const;
  if (sitePromotionMode === "none-current-availability") {
    return {
      ...common,
      attestationKind: CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND,
      sitePromotionMode,
    };
  }
  return {
    ...common,
    attestationKind: STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND,
    sitePromotionMode,
    afrikaansProofSha256: sha256(
      binding.afrikaansProofSha256,
      "staged Afrikaans proof hash",
    ),
    afrikaansAuditManifestSha256: sha256(
      binding.afrikaansAuditManifestSha256,
      "staged Afrikaans audit manifest hash",
    ),
    afrikaansSemanticEvidenceSha256: sha256(
      binding.afrikaansSemanticEvidenceSha256,
      "staged Afrikaans semantic evidence hash",
    ),
    afrikaansPromotionTransactionId: sha256(
      binding.afrikaansPromotionTransactionId,
      "staged Afrikaans promotion transaction",
    ),
    afrikaansJournalBindingSha256: sha256(
      binding.afrikaansJournalBindingSha256,
      "staged Afrikaans journal hash",
    ),
    afrikaansPostSiteTreeSha256: sha256(
      binding.afrikaansPostSiteTreeSha256,
      "staged Afrikaans post-tree hash",
    ),
  };
}

function assertCurrentStagedTranslationBinding(
  binding: StagedTranslationReconciliationBinding,
) {
  const corpus = loadStagedTranslationFallbackD1SiteCorpus(process.cwd());
  const current = corpus.attestation;
  const expected = stagedTranslationReconciliationBindingFromAttestation({
    attestation: current,
    d1Corpus: {
      siteRows: corpus.rows.length,
      mainAppRows: corpus.mainAppRows.length,
      exactRows: corpus.rows.length + corpus.mainAppRows.length,
      rowSetSha256: corpus.rowSetSha256,
      payloadCorpusSha256: corpus.payloadCorpusSha256,
    },
  });
  if (JSON.stringify(expected) !== JSON.stringify(binding)) {
    throw new Error(
      "Staged translation reconciliation evidence is stale for the current fallback release.",
    );
  }
}

function assertSelectedCurrentNoPromotionBindingKind(
  binding: StagedTranslationReconciliationBinding,
) {
  if (
    binding.sitePromotionMode !== "none-current-availability" ||
    binding.attestationKind !== CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND
  ) {
    throw new Error(
      "This release accepts only the selected current no-site-promotion translation evidence.",
    );
  }
}

export function topicAttestationPath(backupDir: string) {
  return path.join(cloudflareDir(path.resolve(backupDir)), path.basename(TOPIC_RECONCILIATION_ATTESTATION));
}

export function translationAttestationPath(backupDir: string) {
  return path.join(
    cloudflareDir(path.resolve(backupDir)),
    path.basename(TRANSLATION_RECONCILIATION_ATTESTATION),
  );
}

function writeAttestation(file: string, value: unknown) {
  return writePrivateJsonDurably(file, value, { replace: fs.existsSync(file) });
}

function translationVectorPredecessorTimestamp(input: {
  createdAt: string;
  vectorizeReadiness: Pick<VectorizeReadinessReport, "createdAt">;
  topicAttestation: Pick<
    TopicReconciliationAttestation,
    "createdAt" | "vectorizeReadinessCreatedAt"
  >;
}) {
  const createdAt = exactIsoTimestamp(input.createdAt, "translation attestation timestamp");
  const currentVectorizeCreatedAt = exactIsoTimestamp(
    input.vectorizeReadiness.createdAt,
    "current Vectorize readiness timestamp",
  );
  const predecessorVectorizeCreatedAt = exactIsoTimestamp(
    input.topicAttestation.vectorizeReadinessCreatedAt,
    "topic predecessor Vectorize readiness timestamp",
  );
  const topicCreatedAt = exactIsoTimestamp(
    input.topicAttestation.createdAt,
    "topic reconciliation timestamp",
  );
  if (
    Date.parse(predecessorVectorizeCreatedAt) > Date.parse(topicCreatedAt) ||
    Date.parse(topicCreatedAt) > Date.parse(createdAt) ||
    Date.parse(currentVectorizeCreatedAt) < Date.parse(predecessorVectorizeCreatedAt) ||
    Date.parse(currentVectorizeCreatedAt) > Date.parse(createdAt)
  ) {
    throw new Error("Translation reconciliation predecessors are not in causal order.");
  }
  return predecessorVectorizeCreatedAt;
}

function assertBackupAndReleaseBinding(
  reportBackupDir: string,
  reportRelease: ReleaseSequenceIdentity,
  backupDir: string,
  current: ReleaseSequenceCurrentRelease,
  label: string,
) {
  const expected = assertReleaseSequenceCurrentReleaseBinding({
    backupDir,
    currentRelease: current,
  }).identity;
  if (
    path.resolve(reportBackupDir) !== path.resolve(backupDir) ||
    !sameReleaseIdentity(reportRelease, expected)
  ) {
    throw new Error(`${label} evidence does not authorize this exact candidate and source.`);
  }
}

export function parseReleaseSequenceIdentity(
  value: unknown,
): ReleaseSequenceIdentity {
  const release = exactRecord(
    value,
    [
      "artifactEvidence",
      "git",
      "serviceBaselineVersionId",
      "targetCandidateVersionId",
      "uploadEvidenceSha256",
    ],
    "Release-sequence identity",
  );
  const git = exactRecord(release.git, ["head", "upstream", "upstreamRef"], "Release Git identity");
  const artifacts = exactRecord(
    release.artifactEvidence,
    [
      "assetManifestBytes",
      "assetManifestFileCount",
      "assetManifestSha256",
      "sourceFingerprintFileCount",
      "sourceFingerprintSha256",
      "workerSourceSha256",
      "wranglerConfigSha256",
    ],
    "Release artifact identity",
  );
  const targetCandidateVersionId = workerVersion(
    release.targetCandidateVersionId,
    "release target candidate version",
  );
  const serviceBaselineVersionId = workerVersion(
    release.serviceBaselineVersionId,
    "release service baseline version",
  );
  const uploadEvidenceSha256 = sha256(
    release.uploadEvidenceSha256,
    "release upload evidence hash",
  );
  const parsedGit = {
    head: gitObject(git.head, "release Git HEAD"),
    upstream: gitObject(git.upstream, "release Git upstream"),
    upstreamRef: boundedString(git.upstreamRef, "release Git upstream ref"),
  };
  if (
    targetCandidateVersionId === serviceBaselineVersionId ||
    parsedGit.head !== parsedGit.upstream
  ) {
    throw new Error(
      "Release-sequence identity must bind distinct candidate/baseline UUIDs and clean pushed Git.",
    );
  }
  return {
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
    git: parsedGit,
    artifactEvidence: {
      sourceFingerprintSha256: sha256(artifacts.sourceFingerprintSha256, "source fingerprint"),
      sourceFingerprintFileCount: nonNegativeSafeInteger(
        artifacts.sourceFingerprintFileCount,
        "source file count",
      ),
      workerSourceSha256: sha256(artifacts.workerSourceSha256, "Worker source hash"),
      wranglerConfigSha256: sha256(artifacts.wranglerConfigSha256, "Wrangler config hash"),
      assetManifestSha256: sha256(artifacts.assetManifestSha256, "Static Assets hash"),
      assetManifestFileCount: nonNegativeSafeInteger(
        artifacts.assetManifestFileCount,
        "Static Assets file count",
      ),
      assetManifestBytes: nonNegativeSafeInteger(
        artifacts.assetManifestBytes,
        "Static Assets bytes",
      ),
    },
  };
}

function parseCurrentRelease(
  current: ReleaseSequenceCurrentRelease,
): ReleaseSequenceCurrentRelease {
  const phase = servingPhase(current.phase);
  const targetCandidateVersionId = workerVersion(
    current.targetCandidateVersionId,
    "current target candidate version",
  );
  const serviceBaselineVersionId = workerVersion(
    current.serviceBaselineVersionId,
    "current service baseline version",
  );
  const soleServingVersionId = workerVersion(
    current.soleServingVersionId,
    "current sole-serving version",
  );
  if (targetCandidateVersionId === serviceBaselineVersionId) {
    throw new Error("Current release candidate and service baseline must differ.");
  }
  const expectedServingVersionId =
    phase === "uploaded-inactive"
      ? serviceBaselineVersionId
      : targetCandidateVersionId;
  if (soleServingVersionId !== expectedServingVersionId) {
    throw new Error(
      `${phase} release phase has the wrong sole-serving Worker version.`,
    );
  }
  return {
    phase,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256: sha256(
      current.uploadEvidenceSha256,
      "current upload evidence hash",
    ),
    phaseEvidenceSha256: sha256(
      current.phaseEvidenceSha256,
      "current phase evidence hash",
    ),
    phaseEvidenceCreatedAt: exactIsoTimestamp(
      current.phaseEvidenceCreatedAt,
      "current phase evidence timestamp",
    ),
    soleServingVersionId,
    git: current.git,
    artifactEvidence: current.artifactEvidence,
  };
}

function summarizeArtifacts(evidence: WorkerDeployArtifactEvidence): ReleaseSequenceArtifactSummary {
  return {
    sourceFingerprintSha256: evidence.sourceFingerprint.sha256,
    sourceFingerprintFileCount: evidence.sourceFingerprint.fileCount,
    workerSourceSha256: evidence.workerSourceSha256,
    wranglerConfigSha256: evidence.wranglerConfigSha256,
    assetManifestSha256: evidence.assetManifest.sha256,
    assetManifestFileCount: evidence.assetManifest.fileCount,
    assetManifestBytes: evidence.assetManifest.bytes,
  };
}

function sameReleaseIdentity(left: ReleaseSequenceIdentity, right: ReleaseSequenceIdentity) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || expected.some((entry, index) => actual[index] !== entry)) {
    throw new Error(`${label} has unexpected or missing fields.`);
  }
  return record;
}

function boundedString(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2_048 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function workerVersion(value: unknown, label: string) {
  const version = boundedString(value, label);
  if (!workerVersionPattern.test(version)) throw new Error(`${label} must be a lowercase Worker UUID.`);
  return version;
}

function gitObject(value: unknown, label: string) {
  const objectId = boundedString(value, label);
  if (!gitObjectPattern.test(objectId)) throw new Error(`${label} must be a lowercase Git object ID.`);
  return objectId;
}

function sha256(value: unknown, label: string) {
  const hash = boundedString(value, label);
  if (!sha256Pattern.test(hash)) throw new Error(`${label} must be a lowercase SHA-256 hash.`);
  return hash;
}

function exactIsoTimestamp(value: unknown, label: string) {
  const timestamp = boundedString(value, label);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw new Error(`${label} must be an exact ISO timestamp.`);
  }
  return timestamp;
}

function absolutePath(value: unknown, label: string) {
  const filePath = boundedString(value, label);
  if (!path.isAbsolute(filePath)) throw new Error(`${label} must be absolute.`);
  return filePath;
}

function nonNegativeSafeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, label: string) {
  const integer = nonNegativeSafeInteger(value, label);
  if (integer === 0) throw new Error(`${label} must be positive.`);
  return integer;
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function requireNull(value: unknown, label: string): null {
  if (value !== null) throw new Error(`${label} must be null.`);
  return null;
}

function translationMethod(value: unknown): TranslationReconciliationMethod {
  if (value !== "read-only-drift" && value !== "atomic-repair") {
    throw new Error("Translation reconciliation method is invalid.");
  }
  return value;
}

function servingPhase(value: unknown): ReleaseSequenceServingPhase {
  if (value !== "uploaded-inactive" && value !== "candidate-active") {
    throw new Error("Release serving phase must be explicit.");
  }
  return value;
}

function validDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
