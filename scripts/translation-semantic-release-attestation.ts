import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  calculateTranslationSemanticAuditTreeEvidence,
  calculateTranslationSemanticSiteSourceCatalogEvidence,
  canonicalTranslationAuditJson,
  isTranslationSemanticMainAppWorkbenchPath,
  parseStrictTranslationSemanticJsonBytes,
  sha256CanonicalTranslationAuditJson,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_SITE_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_LANGUAGE_BY_LOCALE,
  TRANSLATION_SEMANTIC_AUDIT_IMPLEMENTATION_RELATIVE_PATH,
  TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
  TRANSLATION_SEMANTIC_AUDIT_POLICY,
  TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
  TRANSLATION_SEMANTIC_AUDIT_VERIFIER_RELATIVE_PATH,
  translationSemanticAuditTreeDigestSchema,
  translationSemanticPromotionEvidenceSchema,
  type TranslationSemanticPromotionEvidence,
} from "./verify-translation-semantic-audit";
import {
  assertLongTailPromotionSnapshotTransactionRootSettled,
  LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
  longTailPromotionJournalBindingSchema,
  readAndValidateLongTailPromotionJournal,
} from "./long-tail-promotion-snapshot";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE,
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  parseLongTailNllbExecutionProfile,
} from "./long-tail-nllb-execution-profile";

export const TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_KIND =
  "inspir-translation-semantic-release-attestation-v3" as const;
export const TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_RELATIVE_PATH =
  "translations/semantic-release-attestation.json" as const;
export const TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_CHECK_NAME =
  "tracked semantic translation release attestation" as const;

const MAXIMUM_ATTESTATION_BYTES = 4 * 1024 * 1024;
const MAXIMUM_IMPLEMENTATION_BYTES = 4 * 1024 * 1024;
const MAXIMUM_CURATED_PACK_BYTES = 16 * 1024 * 1024;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const attestationLocaleSchema = z.enum(
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES,
);
const curatedCorpusSchema = z.object({
  locales: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length),
  namespaces: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT),
  packs: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
  packIdentityRootSha256: sha256Schema,
  fieldSetRootSha256: sha256Schema,
}).strict();
const publicationCountsSchema = z.object({
  created: z.number().int().nonnegative().max(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
  replayed: z.number().int().nonnegative().max(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
  replaced: z.number().int().nonnegative().max(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
}).strict();
const zeroPublicationCountsSchema = z.object({
  created: z.literal(0),
  replayed: z.literal(0),
  replaced: z.literal(0),
}).strict();
const attestedPromotionSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("already-complete"),
    transactionId: z.null(),
    transactionRoot: z.null(),
    publications: zeroPublicationCountsSchema,
    journal: z.null(),
  }).strict(),
  z.object({
    outcome: z.literal("committed"),
    transactionId: sha256Schema,
    transactionRoot: z.literal(
      LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
    ),
    publications: publicationCountsSchema,
    journal: longTailPromotionJournalBindingSchema,
  }).strict(),
]);
const attestationMaterialSchema = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal(TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_KIND),
  semanticEvidence: translationSemanticPromotionEvidenceSchema,
  generatorExecutionProfileSha256: z.literal(
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  ),
  promotion: attestedPromotionSchema,
  curatedTree: translationSemanticAuditTreeDigestSchema,
  staticMainAppTree: translationSemanticAuditTreeDigestSchema,
  curatedCorpus: curatedCorpusSchema,
  implementationPaths: z.object({
    audit: z.literal(TRANSLATION_SEMANTIC_AUDIT_IMPLEMENTATION_RELATIVE_PATH),
    verifier: z.literal(TRANSLATION_SEMANTIC_AUDIT_VERIFIER_RELATIVE_PATH),
  }).strict(),
}).strict();
export const translationSemanticReleaseAttestationSchema =
  attestationMaterialSchema.extend({
    attestationSha256: sha256Schema,
  }).strict();

export type TranslationSemanticReleaseAttestation = z.infer<
  typeof translationSemanticReleaseAttestationSchema
>;

export type TranslationSemanticReleaseAttestationHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  artifact: TranslationSemanticReleaseAttestation;
}>;

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNoSymlinkComponents(target: string, label: string): void {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const metadata = lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) throw new Error(`${label} path does not exist: ${current}`);
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic-link component.`);
    }
  }
}

function readStableFile(
  file: string,
  maximumBytes: number,
  label: string,
): Readonly<{
  path: string;
  maximumBytes: number;
  bytes: Buffer;
  sha256: string;
  identity: Readonly<{
    device: string;
    inode: string;
    bytes: string;
    mtimeNs: string;
    ctimeNs: string;
    mode: string;
    uid: string;
  }>;
}> {
  assertNoSymlinkComponents(file, label);
  const pathBefore = lstatSync(file, { bigint: true });
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.nlink !== BigInt(1) ||
    pathBefore.size > BigInt(maximumBytes)
  ) {
    throw new Error(`${label} must be a bounded single-link regular file.`);
  }
  const descriptor = openSync(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  let bytes: Buffer;
  let stableIdentity: Readonly<{
    device: string;
    inode: string;
    bytes: string;
    mtimeNs: string;
    ctimeNs: string;
    mode: string;
    uid: string;
  }> | null = null;
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== BigInt(1) ||
      before.size > BigInt(maximumBytes)
    ) {
      throw new Error(`${label} must be a bounded single-link regular file.`);
    }
    const expectedBytes = Number(before.size);
    bytes = Buffer.allocUnsafe(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        expectedBytes - offset,
        null,
      );
      if (count === 0) throw new Error(`${label} was truncated while it was read.`);
      offset += count;
    }
    const growthProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, growthProbe, 0, 1, null) !== 0) {
      throw new Error(`${label} grew while it was read.`);
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(file, { bigint: true });
    if (
      pathBefore.dev !== before.dev ||
      pathBefore.ino !== before.ino ||
      pathBefore.nlink !== before.nlink ||
      pathBefore.size !== before.size ||
      pathBefore.mtimeNs !== before.mtimeNs ||
      pathBefore.ctimeNs !== before.ctimeNs ||
      pathBefore.mode !== before.mode ||
      pathBefore.uid !== before.uid ||
      !before.isFile() ||
      before.nlink !== BigInt(1) ||
      before.nlink !== after.nlink ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.mode !== after.mode ||
      before.uid !== after.uid ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino ||
      after.nlink !== pathAfter.nlink ||
      after.size !== pathAfter.size ||
      after.mtimeNs !== pathAfter.mtimeNs ||
      after.ctimeNs !== pathAfter.ctimeNs ||
      after.mode !== pathAfter.mode ||
      after.uid !== pathAfter.uid ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new Error(`${label} changed while it was read.`);
    }
    stableIdentity = Object.freeze({
      device: after.dev.toString(),
      inode: after.ino.toString(),
      bytes: after.size.toString(),
      mtimeNs: after.mtimeNs.toString(),
      ctimeNs: after.ctimeNs.toString(),
      mode: after.mode.toString(),
      uid: after.uid.toString(),
    });
  } finally {
    closeSync(descriptor);
  }
  if (!stableIdentity) {
    throw new Error(`${label} identity was not captured.`);
  }
  return Object.freeze({
    path: file,
    maximumBytes,
    bytes,
    sha256: sha256Bytes(bytes),
    identity: stableIdentity,
  });
}

function assertStableFileUnchanged(
  prior: ReturnType<typeof readStableFile>,
  label: string,
): void {
  const current = readStableFile(prior.path, prior.maximumBytes, label);
  if (
    current.sha256 !== prior.sha256 ||
    canonicalTranslationAuditJson(current.identity) !==
      canonicalTranslationAuditJson(prior.identity)
  ) {
    throw new Error(`${label} changed during semantic release validation.`);
  }
}

function parseAttestation(bytes: Buffer): TranslationSemanticReleaseAttestation {
  let value: unknown;
  try {
    value = parseStrictTranslationSemanticJsonBytes(
      bytes,
      "Semantic release attestation",
    );
  } catch {
    throw new Error("Semantic release attestation is not valid JSON.");
  }
  const parsed = translationSemanticReleaseAttestationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Semantic release attestation violates its exact schema: ${z.prettifyError(parsed.error)}`,
    );
  }
  const canonicalBytes = Buffer.from(
    `${JSON.stringify(parsed.data, null, 2)}\n`,
    "utf8",
  );
  if (!canonicalBytes.equals(bytes)) {
    throw new Error("Semantic release attestation bytes are noncanonical.");
  }
  const { attestationSha256, ...material } = parsed.data;
  if (sha256CanonicalTranslationAuditJson(material) !== attestationSha256) {
    throw new Error("Semantic release attestation self-hash is invalid.");
  }
  return parsed.data;
}

const curatedPackIdentitySchema = z.object({
  schemaVersion: z.literal(1),
  language: z.string().min(1).max(128),
  locale: z.enum(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  entries: z.array(z.object({
    key: z.string().min(1).max(1_024),
    source: z.string().min(1).max(200_000),
    value: z.string().min(1).max(200_000),
  }).passthrough()).min(1).max(20_000).optional(),
  translations: z.record(
    z.string().min(1).max(1_024),
    z.string().min(1).max(200_000),
  ).optional(),
}).passthrough().refine(
  (value) => Boolean(value.entries) !== Boolean(value.translations),
  "Curated pack must contain exactly one supported translation payload.",
);
const staticMainAppIdentitySchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("static-main-app-values"),
  language: z.string().min(1).max(128),
  locale: z.enum(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES),
  sourceHash: sha256Schema,
  keyCount: z.number().int().positive().max(20_000),
  strings: z.array(z.string().min(1).max(200_000)).min(1).max(20_000),
}).strict();

function fileSafeNamespace(namespace: string): string {
  const safe = namespace.replace(/[^a-z0-9.-]+/gi, "__");
  if (!safe || safe === "." || safe === "..") {
    throw new Error("Curated translation namespace has no safe canonical filename.");
  }
  return safe;
}

function staticMainAppLocaleFromBasename(
  basename: string,
): z.infer<typeof attestationLocaleSchema> | null {
  if (!basename.endsWith(".json")) return null;
  const locale = basename.slice(0, -".json".length);
  const parsed = attestationLocaleSchema.safeParse(locale);
  return parsed.success && basename === `${parsed.data}.json`
    ? parsed.data
    : null;
}

function workspaceRelativePath(
  workspaceRoot: string,
  target: string,
  label: string,
): typeof LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH {
  const relative = path.relative(workspaceRoot, target).split(path.sep).join("/");
  if (relative !== LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH) {
    throw new Error(
      `${label} must be ${LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH}.`,
    );
  }
  return LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function calculateCuratedTranslationCorpusEvidence(input: {
  curatedRoot: string;
  staticMainAppRoot: string;
}): z.infer<typeof curatedCorpusSchema> {
  const curatedRoot = path.resolve(input.curatedRoot);
  assertNoSymlinkComponents(curatedRoot, "Curated translation corpus");
  const rootMetadata = lstatSync(curatedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("Curated translation corpus must be a real directory.");
  }
  const localeEntries = readdirSync(curatedRoot, {
    encoding: "utf8",
    withFileTypes: true,
  }).sort((left, right) => compareCodePoints(left.name, right.name));
  const actualLocales = localeEntries.map((entry) => entry.name);
  const expectedLocales = [...TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES]
    .sort(compareCodePoints);
  if (
    localeEntries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink()) ||
    canonicalTranslationAuditJson(actualLocales) !==
      canonicalTranslationAuditJson(expectedLocales)
  ) {
    throw new Error("Curated translation corpus locale directories are incomplete or unsafe.");
  }

  const rows: Array<readonly [string, string, string]> = [];
  const fieldRows: Array<readonly [string, string, string, readonly string[]]> = [];
  let referenceNamespaces: readonly string[] | null = null;
  const sourceHashes = new Map<string, string>();
  const fieldSets = new Map<string, readonly string[]>();
  for (const locale of TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES) {
    const localeRoot = path.join(curatedRoot, locale);
    const entries = readdirSync(localeRoot, {
      encoding: "utf8",
      withFileTypes: true,
    }).filter((entry) => {
      const relative = `${locale}/${entry.name}`;
      if (!isTranslationSemanticMainAppWorkbenchPath(relative)) return true;
      const metadata = lstatSync(path.join(localeRoot, entry.name));
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.nlink !== 1 ||
        metadata.size > MAXIMUM_CURATED_PACK_BYTES
      ) {
        throw new Error(`Ignored main-app workbench entry is unsafe: ${relative}.`);
      }
      return false;
    }).sort((left, right) => compareCodePoints(left.name, right.name));
    if (
      entries.length !==
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT - 1 ||
      entries.some((entry) =>
        !entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")
      )
    ) {
      throw new Error(`Curated translation corpus is not a complete pack set for ${locale}.`);
    }
    const namespaces: string[] = [];
    const seenNamespaces = new Set<string>();
    for (const entry of entries) {
      const stable = readStableFile(
        path.join(localeRoot, entry.name),
        MAXIMUM_CURATED_PACK_BYTES,
        `Curated translation pack ${locale}/${entry.name}`,
      );
      let value: unknown;
      try {
        value = parseStrictTranslationSemanticJsonBytes(
          stable.bytes,
          `Curated translation pack ${locale}/${entry.name}`,
        );
      } catch {
        throw new Error(`Curated translation pack is invalid JSON: ${locale}/${entry.name}.`);
      }
      const identity = curatedPackIdentitySchema.parse(value);
      if (
        identity.locale !== locale ||
        identity.language !== TRANSLATION_SEMANTIC_AUDIT_LANGUAGE_BY_LOCALE[locale] ||
        entry.name !== `${fileSafeNamespace(identity.namespace)}.json` ||
        seenNamespaces.has(identity.namespace)
      ) {
        throw new Error(`Curated translation pack identity is path-mismatched: ${locale}/${entry.name}.`);
      }
      seenNamespaces.add(identity.namespace);
      namespaces.push(identity.namespace);
      const priorSourceHash = sourceHashes.get(identity.namespace);
      if (priorSourceHash !== undefined && priorSourceHash !== identity.sourceHash) {
        throw new Error(`Curated translation source hash drifted for ${identity.namespace}.`);
      }
      sourceHashes.set(identity.namespace, identity.sourceHash);
      const fieldKeys = identity.entries
        ? identity.entries.map((field) => field.key).sort(compareCodePoints)
        : Object.keys(identity.translations ?? {}).sort(compareCodePoints);
      if (
        fieldKeys.length === 0 ||
        fieldKeys.some((key, index) => index > 0 && key === fieldKeys[index - 1])
      ) {
        throw new Error(`Curated translation fields are empty or duplicate for ${identity.namespace}.`);
      }
      const priorFieldSet = fieldSets.get(identity.namespace);
      if (
        priorFieldSet !== undefined &&
        canonicalTranslationAuditJson(priorFieldSet) !==
          canonicalTranslationAuditJson(fieldKeys)
      ) {
        throw new Error(`Curated translation field set drifted for ${identity.namespace}.`);
      }
      fieldSets.set(identity.namespace, Object.freeze(fieldKeys));
      rows.push([identity.locale, identity.namespace, identity.sourceHash]);
      fieldRows.push([
        identity.locale,
        identity.namespace,
        identity.sourceHash,
        fieldKeys,
      ]);
    }
    namespaces.sort(compareCodePoints);
    if (
      referenceNamespaces !== null &&
      canonicalTranslationAuditJson(namespaces) !==
        canonicalTranslationAuditJson(referenceNamespaces)
    ) {
      throw new Error(`Curated translation namespace set drifted for ${locale}.`);
    }
    referenceNamespaces ??= Object.freeze(namespaces);
  }
  const staticMainAppRoot = path.resolve(input.staticMainAppRoot);
  assertNoSymlinkComponents(
    staticMainAppRoot,
    "Tracked static main-app corpus",
  );
  const staticRootMetadata = lstatSync(staticMainAppRoot);
  if (!staticRootMetadata.isDirectory() || staticRootMetadata.isSymbolicLink()) {
    throw new Error("Tracked static main-app corpus must be a real directory.");
  }
  const staticEntries = readdirSync(staticMainAppRoot, {
    encoding: "utf8",
    withFileTypes: true,
  }).sort((left, right) => compareCodePoints(left.name, right.name));
  if (
    staticEntries.length !==
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT ||
    staticEntries.some((entry) =>
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      staticMainAppLocaleFromBasename(entry.name) === null
    )
  ) {
    throw new Error("Tracked static main-app corpus is not the exact 69-pack set.");
  }
  const seenStaticLocales = new Set<string>();
  let mainAppSourceHash: string | null = null;
  let mainAppKeyCount: number | null = null;
  for (const entry of staticEntries) {
    const locale = staticMainAppLocaleFromBasename(entry.name);
    if (!locale) {
      throw new Error(`Tracked static main-app filename is invalid: ${entry.name}.`);
    }
    const stable = readStableFile(
      path.join(staticMainAppRoot, entry.name),
      MAXIMUM_CURATED_PACK_BYTES,
      `Tracked static main-app pack ${entry.name}`,
    );
    let value: unknown;
    try {
      value = parseStrictTranslationSemanticJsonBytes(
        stable.bytes,
        `Tracked static main-app pack ${entry.name}`,
      );
    } catch {
      throw new Error(`Tracked static main-app pack is invalid JSON: ${entry.name}.`);
    }
    const identity = staticMainAppIdentitySchema.parse(value);
    if (
      identity.locale !== locale ||
      identity.language !== TRANSLATION_SEMANTIC_AUDIT_LANGUAGE_BY_LOCALE[locale] ||
      (mainAppSourceHash !== null && identity.sourceHash !== mainAppSourceHash) ||
      (mainAppKeyCount !== null && identity.keyCount !== mainAppKeyCount) ||
      identity.strings.length !== identity.keyCount ||
      identity.strings.some((translated) =>
        translated !== translated.normalize("NFC")
      ) ||
      seenStaticLocales.has(locale)
    ) {
      throw new Error(`Tracked static main-app binding drifted for ${locale}.`);
    }
    mainAppSourceHash ??= identity.sourceHash;
    mainAppKeyCount ??= identity.keyCount;
    seenStaticLocales.add(locale);
    rows.push([locale, "main-app", identity.sourceHash]);
    fieldRows.push([
      locale,
      "main-app",
      identity.sourceHash,
      identity.strings.map((_, index) => `static-position:${index}`),
    ]);
  }
  if (
    seenStaticLocales.size !== TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length
  ) {
    throw new Error("Tracked static main-app locale coverage is incomplete.");
  }
  rows.sort((left, right) => {
    const first = `${left[0]}\u0000${left[1]}`;
    const second = `${right[0]}\u0000${right[1]}`;
    return first < second ? -1 : first > second ? 1 : 0;
  });
  fieldRows.sort((left, right) => {
    const first = `${left[0]}\u0000${left[1]}`;
    const second = `${right[0]}\u0000${right[1]}`;
    return first < second ? -1 : first > second ? 1 : 0;
  });
  return curatedCorpusSchema.parse({
    locales: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length,
    namespaces: (referenceNamespaces?.length ?? 0) + 1,
    packs: rows.length,
    packIdentityRootSha256: sha256CanonicalTranslationAuditJson(rows),
    fieldSetRootSha256: sha256CanonicalTranslationAuditJson(fieldRows),
  });
}

function validateSemanticEvidence(
  evidence: TranslationSemanticPromotionEvidence,
  workspaceRoot: string,
): Readonly<{
  auditImplementation: ReturnType<typeof readStableFile>;
  verifierImplementation: ReturnType<typeof readStableFile>;
}> {
  const parsed = translationSemanticPromotionEvidenceSchema.parse(evidence);
  const { semanticEvidenceSha256, ...material } = parsed;
  if (sha256CanonicalTranslationAuditJson(material) !== semanticEvidenceSha256) {
    throw new Error("Semantic promotion evidence self-hash is invalid.");
  }
  const generatorExecutionProfile = parseLongTailNllbExecutionProfile(
    parsed.generatorExecutionProfile,
  );
  if (
    parsed.generatorExecutionProfileSha256 !==
      LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256 ||
    canonicalTranslationAuditJson(generatorExecutionProfile) !==
      canonicalTranslationAuditJson(LONG_TAIL_NLLB_EXECUTION_PROFILE)
  ) {
    throw new Error("Semantic promotion evidence has stale generator runtime evidence.");
  }
  const currentSiteSourceCatalog =
    calculateTranslationSemanticSiteSourceCatalogEvidence({ workspaceRoot });
  if (
    canonicalTranslationAuditJson(currentSiteSourceCatalog) !==
      canonicalTranslationAuditJson(parsed.siteSourceCatalog)
  ) {
    throw new Error(
      "Semantic promotion evidence is stale for the tracked site source catalog.",
    );
  }
  const expectedPolicySha256 =
    sha256CanonicalTranslationAuditJson(TRANSLATION_SEMANTIC_AUDIT_POLICY);
  const expectedModelLockSha256 = sha256CanonicalTranslationAuditJson({
    fasttextSha256: TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.fasttextSha256,
    labseTreeSha256: TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.labseTreeSha256,
    madladTreeSha256: TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.madladTreeSha256,
    runtimeVersions: TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS,
  });
  if (
    parsed.auditPolicySha256 !== expectedPolicySha256 ||
    parsed.modelLockSha256 !== expectedModelLockSha256 ||
    canonicalTranslationAuditJson(parsed.modelDigests) !==
      canonicalTranslationAuditJson(TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS) ||
    canonicalTranslationAuditJson(parsed.runtimeVersions) !==
      canonicalTranslationAuditJson(TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS) ||
    parsed.scope.packs !== TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT ||
    parsed.scope.candidatePacks + parsed.scope.curatedPacks !==
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT ||
    parsed.inputTrees.candidates.files !== parsed.scope.candidatePacks ||
    parsed.inputTrees.packWorklists.files !== parsed.scope.candidatePacks ||
    !parsed.inputTrees.curated.exists ||
    !parsed.inputTrees.staticMainApp.exists ||
    !parsed.inputTrees.candidates.exists ||
    !parsed.inputTrees.packWorklists.exists ||
    parsed.inputTrees.staticMainApp.files !==
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT ||
    parsed.scope.curatedPacks <
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT ||
    parsed.inputTrees.curated.files <
      parsed.scope.curatedPacks -
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT ||
    parsed.inputTrees.curated.files >
      parsed.scope.curatedPacks -
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT +
        parsed.scope.candidatePacks
  ) {
    throw new Error("Semantic promotion evidence policy, model, or scope drifted.");
  }
  const auditImplementation = readStableFile(
    path.join(workspaceRoot, TRANSLATION_SEMANTIC_AUDIT_IMPLEMENTATION_RELATIVE_PATH),
    MAXIMUM_IMPLEMENTATION_BYTES,
    "Semantic audit implementation",
  );
  const verifierImplementation = readStableFile(
    path.join(workspaceRoot, TRANSLATION_SEMANTIC_AUDIT_VERIFIER_RELATIVE_PATH),
    MAXIMUM_IMPLEMENTATION_BYTES,
    "Semantic audit verifier implementation",
  );
  if (
    parsed.auditImplementationSha256 !== auditImplementation.sha256 ||
    parsed.verifierImplementationSha256 !== verifierImplementation.sha256
  ) {
    throw new Error("Semantic audit or verifier implementation drifted.");
  }
  return Object.freeze({ auditImplementation, verifierImplementation });
}

function validateAttestedPromotion(input: {
  workspaceRoot: string;
  semanticEvidence: TranslationSemanticPromotionEvidence;
  promotion: TranslationSemanticReleaseAttestation["promotion"];
  currentSiteTree: z.infer<typeof translationSemanticAuditTreeDigestSchema>;
  currentStaticMainAppTree: z.infer<
    typeof translationSemanticAuditTreeDigestSchema
  >;
}): void {
  const { promotion, semanticEvidence } = input;
  if (promotion.outcome === "already-complete") {
    if (
      semanticEvidence.scope.candidatePacks !== 0 ||
      canonicalTranslationAuditJson(input.currentSiteTree) !==
        canonicalTranslationAuditJson(semanticEvidence.inputTrees.curated) ||
      canonicalTranslationAuditJson(input.currentStaticMainAppTree) !==
        canonicalTranslationAuditJson(
          semanticEvidence.inputTrees.staticMainApp,
        )
    ) {
      throw new Error(
        "No-op semantic release attestation is not bound to its audited trees.",
      );
    }
    return;
  }

  const { bindingSha256, ...journalMaterial } = promotion.journal;
  const publicationTotal = promotion.publications.created +
    promotion.publications.replayed + promotion.publications.replaced;
  const exactNoopJournal = promotion.publications.created === 0 &&
    promotion.publications.replaced === 0 &&
    promotion.publications.replayed === promotion.journal.artifacts &&
    canonicalTranslationAuditJson(promotion.journal.priorSiteTree) ===
      canonicalTranslationAuditJson(promotion.journal.postSiteTree);
  const expectedRetainedPrior = promotion.journal.priorSiteTree.exists &&
    !exactNoopJournal;
  if (
    sha256CanonicalTranslationAuditJson(journalMaterial) !== bindingSha256 ||
    promotion.transactionId !== promotion.journal.transactionId ||
    canonicalTranslationAuditJson(promotion.publications) !==
      canonicalTranslationAuditJson(promotion.journal.publications) ||
    promotion.journal.masterWorklistSha256 !==
      semanticEvidence.masterWorklistSha256 ||
    promotion.journal.semanticEvidenceSha256 !==
      semanticEvidence.semanticEvidenceSha256 ||
    promotion.journal.generatorExecutionProfileSha256 !==
      semanticEvidence.generatorExecutionProfileSha256 ||
    promotion.journal.artifacts !== semanticEvidence.scope.candidatePacks ||
    publicationTotal !== semanticEvidence.scope.candidatePacks ||
    canonicalTranslationAuditJson(promotion.journal.priorSiteTree) !==
      canonicalTranslationAuditJson(semanticEvidence.inputTrees.curated) ||
    canonicalTranslationAuditJson(promotion.journal.staticMainAppTree) !==
      canonicalTranslationAuditJson(
        semanticEvidence.inputTrees.staticMainApp,
      ) ||
    canonicalTranslationAuditJson(promotion.journal.postSiteTree) !==
      canonicalTranslationAuditJson(input.currentSiteTree) ||
    canonicalTranslationAuditJson(promotion.journal.staticMainAppTree) !==
      canonicalTranslationAuditJson(input.currentStaticMainAppTree) ||
    promotion.journal.retainedPrior !== expectedRetainedPrior
  ) {
    throw new Error(
      "Semantic release attestation journal binding is inconsistent.",
    );
  }

  const localTransactionRoot = path.join(
    input.workspaceRoot,
    promotion.transactionRoot,
  );
  if (lstatSync(localTransactionRoot, { throwIfNoEntry: false })) {
    assertLongTailPromotionSnapshotTransactionRootSettled({
      transactionRoot: localTransactionRoot,
    });
    const localJournal = readAndValidateLongTailPromotionJournal({
      curatedRoot: path.join(
        input.workspaceRoot,
        "translations/curated",
      ),
      transactionRoot: localTransactionRoot,
      transactionId: promotion.transactionId,
      expectedSemanticEvidence: semanticEvidence,
    });
    if (
      canonicalTranslationAuditJson(localJournal) !==
        canonicalTranslationAuditJson(promotion.journal)
    ) {
      throw new Error(
        "Tracked semantic release attestation does not match its retained local journals.",
      );
    }
    assertLongTailPromotionSnapshotTransactionRootSettled({
      transactionRoot: localTransactionRoot,
    });
  }
}

function fsyncDirectory(directory: string): void {
  const descriptor = openSync(
    directory,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeTrackedAttestation(file: string, bytes: Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const existing = lstatSync(file, { throwIfNoEntry: false });
  if (existing) {
    const prior = readStableFile(file, MAXIMUM_ATTESTATION_BYTES, "Prior semantic release attestation");
    if (prior.bytes.equals(bytes)) return;
  }
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp-${process.pid}-${randomUUID()}`,
  );
  const descriptor = openSync(
    temporary,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      fsConstants.O_NOFOLLOW,
    0o644,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    const leftover = lstatSync(temporary, { throwIfNoEntry: false });
    if (leftover) unlinkSync(temporary);
  }
}

export function createTranslationSemanticReleaseAttestation(input: {
  workspaceRoot: string;
  semanticEvidence: TranslationSemanticPromotionEvidence;
  promotion: Readonly<{
    transactionId: string | null;
    transactionRoot?: string;
  }>;
}): TranslationSemanticReleaseAttestationHandle {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const implementations = validateSemanticEvidence(
    input.semanticEvidence,
    workspaceRoot,
  );
  const curatedTree = calculateTranslationSemanticAuditTreeEvidence({
    root: path.join(workspaceRoot, "translations/curated"),
    label: "Committed curated translation tree",
    ignoreMainAppWorkbench: true,
  });
  const staticMainAppTree = calculateTranslationSemanticAuditTreeEvidence({
    root: path.join(workspaceRoot, "translations/static-main-app"),
    label: "Committed tracked static main-app tree",
  });
  if (
    curatedTree.files !== TRANSLATION_SEMANTIC_AUDIT_EXPECTED_SITE_PACK_COUNT ||
    !curatedTree.exists ||
    staticMainAppTree.files !==
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT ||
    !staticMainAppTree.exists
  ) {
    throw new Error("Committed tracked translation trees are not the exact full corpus.");
  }
  const curatedCorpus = calculateCuratedTranslationCorpusEvidence({
    curatedRoot: path.join(workspaceRoot, "translations/curated"),
    staticMainAppRoot: path.join(
      workspaceRoot,
      "translations/static-main-app",
    ),
  });
  const promotion = (() => {
    if (input.promotion.transactionId === null) {
      if (
        input.promotion.transactionRoot !== undefined ||
        input.semanticEvidence.scope.candidatePacks !== 0 ||
        canonicalTranslationAuditJson(curatedTree) !==
          canonicalTranslationAuditJson(
            input.semanticEvidence.inputTrees.curated,
          ) ||
        canonicalTranslationAuditJson(staticMainAppTree) !==
          canonicalTranslationAuditJson(
            input.semanticEvidence.inputTrees.staticMainApp,
          )
      ) {
        throw new Error(
          "No-op semantic release attestation does not match its exact audited trees.",
        );
      }
      return attestedPromotionSchema.parse({
        outcome: "already-complete",
        transactionId: null,
        transactionRoot: null,
        publications: { created: 0, replayed: 0, replaced: 0 },
        journal: null,
      });
    }

    const transactionRoot = path.resolve(
      input.promotion.transactionRoot ??
        path.join(
          workspaceRoot,
          LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
        ),
    );
    const transactionRootRelative = workspaceRelativePath(
      workspaceRoot,
      transactionRoot,
      "Promotion transaction root",
    );
    assertLongTailPromotionSnapshotTransactionRootSettled({ transactionRoot });
    const journal = readAndValidateLongTailPromotionJournal({
      curatedRoot: path.join(workspaceRoot, "translations/curated"),
      transactionRoot,
      transactionId: input.promotion.transactionId,
      expectedSemanticEvidence: input.semanticEvidence,
    });
    assertLongTailPromotionSnapshotTransactionRootSettled({ transactionRoot });
    const publicationTotal = journal.publications.created +
      journal.publications.replayed + journal.publications.replaced;
    if (
      journal.masterWorklistSha256 !==
        input.semanticEvidence.masterWorklistSha256 ||
      journal.semanticEvidenceSha256 !==
        input.semanticEvidence.semanticEvidenceSha256 ||
      journal.generatorExecutionProfileSha256 !==
        input.semanticEvidence.generatorExecutionProfileSha256 ||
      journal.artifacts !== input.semanticEvidence.scope.candidatePacks ||
      publicationTotal !== input.semanticEvidence.scope.candidatePacks ||
      canonicalTranslationAuditJson(journal.priorSiteTree) !==
        canonicalTranslationAuditJson(
          input.semanticEvidence.inputTrees.curated,
        ) ||
      canonicalTranslationAuditJson(journal.postSiteTree) !==
        canonicalTranslationAuditJson(curatedTree) ||
      canonicalTranslationAuditJson(journal.staticMainAppTree) !==
        canonicalTranslationAuditJson(staticMainAppTree)
    ) {
      throw new Error(
        "Promotion journals do not bind the exact semantic release trees and publications.",
      );
    }
    return attestedPromotionSchema.parse({
      outcome: "committed",
      transactionId: journal.transactionId,
      transactionRoot: transactionRootRelative,
      publications: journal.publications,
      journal,
    });
  })();
  validateAttestedPromotion({
    workspaceRoot,
    semanticEvidence: input.semanticEvidence,
    promotion,
    currentSiteTree: curatedTree,
    currentStaticMainAppTree: staticMainAppTree,
  });
  assertStableFileUnchanged(
    implementations.auditImplementation,
    "Semantic audit implementation",
  );
  assertStableFileUnchanged(
    implementations.verifierImplementation,
    "Semantic audit verifier implementation",
  );
  if (
    canonicalTranslationAuditJson(
      calculateTranslationSemanticSiteSourceCatalogEvidence({ workspaceRoot }),
    ) !== canonicalTranslationAuditJson(input.semanticEvidence.siteSourceCatalog)
  ) {
    throw new Error(
      "Tracked site source catalog changed during semantic attestation creation.",
    );
  }
  const material = attestationMaterialSchema.parse({
    schemaVersion: 3,
    kind: TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_KIND,
    semanticEvidence: input.semanticEvidence,
    generatorExecutionProfileSha256:
      input.semanticEvidence.generatorExecutionProfileSha256,
    promotion,
    curatedTree,
    staticMainAppTree,
    curatedCorpus,
    implementationPaths: {
      audit: TRANSLATION_SEMANTIC_AUDIT_IMPLEMENTATION_RELATIVE_PATH,
      verifier: TRANSLATION_SEMANTIC_AUDIT_VERIFIER_RELATIVE_PATH,
    },
  });
  const artifact = translationSemanticReleaseAttestationSchema.parse({
    ...material,
    attestationSha256: sha256CanonicalTranslationAuditJson(material),
  });
  const file = path.join(
    workspaceRoot,
    TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_RELATIVE_PATH,
  );
  writeTrackedAttestation(file, Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8"));
  return readAndValidateTranslationSemanticReleaseAttestation({ workspaceRoot });
}

export function readAndValidateTranslationSemanticReleaseAttestation(input: {
  workspaceRoot: string;
  raceHook?: (point: "after-corpus-before-final-stability-check") => void;
}): TranslationSemanticReleaseAttestationHandle {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const file = path.join(
    workspaceRoot,
    TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_RELATIVE_PATH,
  );
  const stable = readStableFile(
    file,
    MAXIMUM_ATTESTATION_BYTES,
    "Tracked semantic release attestation",
  );
  const artifact = parseAttestation(stable.bytes);
  const implementations = validateSemanticEvidence(
    artifact.semanticEvidence,
    workspaceRoot,
  );
  const currentTree = calculateTranslationSemanticAuditTreeEvidence({
    root: path.join(workspaceRoot, "translations/curated"),
    label: "Current curated translation tree",
    ignoreMainAppWorkbench: true,
  });
  const currentStaticMainAppTree = calculateTranslationSemanticAuditTreeEvidence({
    root: path.join(workspaceRoot, "translations/static-main-app"),
    label: "Current tracked static main-app tree",
  });
  validateAttestedPromotion({
    workspaceRoot,
    semanticEvidence: artifact.semanticEvidence,
    promotion: artifact.promotion,
    currentSiteTree: currentTree,
    currentStaticMainAppTree,
  });
  const currentCorpus = calculateCuratedTranslationCorpusEvidence({
    curatedRoot: path.join(workspaceRoot, "translations/curated"),
    staticMainAppRoot: path.join(
      workspaceRoot,
      "translations/static-main-app",
    ),
  });
  if (
    !currentTree.exists ||
    currentTree.files !== TRANSLATION_SEMANTIC_AUDIT_EXPECTED_SITE_PACK_COUNT ||
    canonicalTranslationAuditJson(currentTree) !==
      canonicalTranslationAuditJson(artifact.curatedTree) ||
    !currentStaticMainAppTree.exists ||
    currentStaticMainAppTree.files !==
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT ||
    canonicalTranslationAuditJson(currentStaticMainAppTree) !==
      canonicalTranslationAuditJson(artifact.staticMainAppTree)
  ) {
    throw new Error("Tracked semantic release attestation is stale for the curated tree.");
  }
  if (
    canonicalTranslationAuditJson(currentCorpus) !==
      canonicalTranslationAuditJson(artifact.curatedCorpus)
  ) {
    throw new Error("Tracked semantic release attestation is stale for pack identities.");
  }
  input.raceHook?.("after-corpus-before-final-stability-check");
  if (
    canonicalTranslationAuditJson(
      calculateTranslationSemanticSiteSourceCatalogEvidence({ workspaceRoot }),
    ) !== canonicalTranslationAuditJson(artifact.semanticEvidence.siteSourceCatalog)
  ) {
    throw new Error(
      "Tracked site source catalog changed during release validation.",
    );
  }
  const finalTree = calculateTranslationSemanticAuditTreeEvidence({
    root: path.join(workspaceRoot, "translations/curated"),
    label: "Final current curated translation tree",
    ignoreMainAppWorkbench: true,
  });
  const finalStaticMainAppTree = calculateTranslationSemanticAuditTreeEvidence({
    root: path.join(workspaceRoot, "translations/static-main-app"),
    label: "Final tracked static main-app tree",
  });
  if (
    canonicalTranslationAuditJson(finalTree) !==
      canonicalTranslationAuditJson(currentTree) ||
    canonicalTranslationAuditJson(finalStaticMainAppTree) !==
      canonicalTranslationAuditJson(currentStaticMainAppTree)
  ) {
    throw new Error("Curated translation tree changed during release validation.");
  }
  assertStableFileUnchanged(
    stable,
    "Tracked semantic release attestation",
  );
  assertStableFileUnchanged(
    implementations.auditImplementation,
    "Semantic audit implementation",
  );
  assertStableFileUnchanged(
    implementations.verifierImplementation,
    "Semantic audit verifier implementation",
  );
  return Object.freeze({
    path: file,
    bytes: stable.bytes.byteLength,
    sha256: stable.sha256,
    artifact,
  });
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  try {
    const result = readAndValidateTranslationSemanticReleaseAttestation({
      workspaceRoot: process.cwd(),
    });
    console.log(JSON.stringify({
      ok: true,
      path: TRANSLATION_SEMANTIC_RELEASE_ATTESTATION_RELATIVE_PATH,
      sha256: result.sha256,
      curatedTreeSha256: result.artifact.curatedTree.sha256,
      semanticEvidenceSha256:
        result.artifact.semanticEvidence.semanticEvidenceSha256,
    }, null, 2));
  } catch (error) {
    console.error(
      `[translations:semantic-release] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
