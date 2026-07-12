import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultLanguage,
  languageConfigs,
  normalizeLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getCuratedTranslationBundle } from "@/lib/i18n/curated-translations";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "@/lib/i18n/main-app-source";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
  isKnownSiteTranslationNamespace,
} from "@/lib/i18n/site-source";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import { validateTranslationCandidateField } from "@/lib/i18n/translation-candidate-quality";
import {
  isTranslationBundleCompleteAndFluent,
  isTranslationBundleFieldValid,
  isTranslationFieldLikelyFluent,
} from "@/lib/i18n/translation-quality";
import type { TranslationBundle, TranslationSource } from "@/lib/i18n/translation-types";
import {
  validateHybridTranslationCandidateManifest,
  type HybridTranslationCandidateManifestValidation,
} from "./compose-hybrid-translation-candidates";
import { validateTranslationRepairCandidateDirectories } from "./validate-translation-repair-candidates";

const repairVersion = "curated-quality-repair-v3";
const protectorVersion = "literal-protector-v2";
const protectorFingerprint = createHash("sha256").update(protectorVersion).digest("hex");
const defaultWorklistDir = "tmp/translation-repair-worklists";
const defaultRepairNamespaces = [
  mainAppTranslationNamespace,
  "marketing-shell",
  "route:home",
  "route:mission",
] as const;
const sourcesAllowingAdditionalInspirMentions = new Set([
  "Mission | inspir",
  "inspir exists for the moment a learner wants to understand something and needs a patient place to begin. The film introduces the product as a free public learning companion for curiosity, practice, and access.",
]);
export type RepairNamespace = string;
type Args = {
  languages: SupportedLanguage[];
  namespaces: RepairNamespace[];
  mode: "plan" | "export-worklists" | "validate-candidates" | "apply-candidates";
  seedPaths: string[];
  worklistDir: string;
  worklistDirProvided: boolean;
  candidateDir: string | null;
  candidateManifestPath: string | null;
  repairScopePath: string | null;
  allLanguages: boolean;
  allExistingNamespaces: boolean;
};

export type TranslationRepairScopeEntry = {
  language: SupportedLanguage;
  locale: string;
  namespace: RepairNamespace;
  sourceHash: string;
  key: string;
  source: string;
  existingCandidate: string | null;
  reasons?: string[];
};

type TranslationRepairScope = {
  path: string;
  canonicalSha256: string;
  entriesByJob: Map<string, Map<string, TranslationRepairScopeEntry>>;
  fields: number;
};

export type RepairJobSelection = Map<
  string,
  { language: SupportedLanguage; namespace: RepairNamespace }
>;

type RepairJob = {
  source: TranslationSource;
  language: SupportedLanguage;
  strings: Record<string, string>;
  repairKeys: string[];
  duplicateKeys: string[];
  existingCandidates: Record<string, string | undefined>;
  reasons: Record<string, string[]>;
};

type ProtectedText = {
  text: string;
  restore: (value: string) => string;
  validateRestored: (value: string) => boolean;
};

type FileImpact = {
  filesWritten: Set<string>;
  bytesBefore: number;
  bytesAfter: number;
};

export type TranslationRepairTransactionControl = {
  commit: () => void;
  rollback: () => void;
};

type CorpusWriteTransaction = TranslationRepairTransactionControl & {
  impact: FileImpact;
};

type TranslationSeeds = Map<string, Record<string, string>>;

type EditingValues = {
  strings: Record<string, string>;
  duplicateKeys: string[];
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  void main(args).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main(args: Args) {
  assertTranslationCandidateManifestMode(args.mode, args.candidateManifestPath);
  const selectedJobs = selectRepairJobs(args);
  const namespaces = Array.from(
    new Set(Array.from(selectedJobs.values()).map((entry) => entry.namespace)),
  ).sort();
  const initialSourceSnapshot = assertSiteSourceManifestsFresh(namespaces);
  const sources = namespaces.map(sourceForNamespace);
  const seeds = loadTranslationSeeds(args.seedPaths);
  const repairScope = loadTranslationRepairScope(
    args.repairScopePath,
    sources,
    args.languages,
    selectedJobs,
  );
  const jobs = buildRepairJobs(sources, args.languages, seeds, repairScope, selectedJobs);
  console.log(
    JSON.stringify({
      event: "curated_translation_quality_plan",
      mode: args.mode,
      languages: args.languages.length,
      namespaces,
      allExistingNamespaces: args.allExistingNamespaces,
      jobs: jobs.length,
      repairScope: repairScope
        ? {
            path: repairScope.path,
            fields: repairScope.fields,
            canonicalSha256: repairScope.canonicalSha256,
          }
        : null,
      fieldsToRepair: jobs.reduce((sum, job) => sum + job.repairKeys.length, 0),
      duplicateKeys: jobs.reduce((sum, job) => sum + job.duplicateKeys.length, 0),
      byNamespace: Object.fromEntries(
        namespaces.map((namespace) => [
          namespace,
          {
            sourceHash: jobs.find((job) => job.source.namespace === namespace)?.source.sourceHash,
            sourceFields: Object.keys(
              jobs.find((job) => job.source.namespace === namespace)?.source.sourceStrings ?? {},
            ).length,
            bundles: jobs.filter((job) => job.source.namespace === namespace).length,
            repairFields: jobs
              .filter((job) => job.source.namespace === namespace)
              .reduce((sum, job) => sum + job.repairKeys.length, 0),
          },
        ]),
      ),
    }),
  );

  if (args.mode === "plan") return;
  if (args.mode === "export-worklists") {
    const result = writeWorklists(jobs, args.worklistDir);
    console.log(JSON.stringify({ event: "curated_translation_worklists_exported", ...result }));
    return;
  }

  if (!args.candidateDir) {
    throw new Error(`${args.mode} requires --candidate-dir=<ignored-directory>.`);
  }
  if (!args.worklistDirProvided) {
    throw new Error(`${args.mode} requires --worklist-dir=<ignored-directory>.`);
  }
  assertIgnoredTmpPath(args.worklistDir, "Worklist directory");
  assertIgnoredTmpPath(args.candidateDir, "Candidate directory");
  if (args.candidateManifestPath) {
    assertIgnoredTmpPath(args.candidateManifestPath, "Candidate manifest");
  }
  const candidateQa = validateTranslationRepairCandidateDirectories({
    worklistDir: args.worklistDir,
    candidateDir: args.candidateDir,
  });
  if (!candidateQa.ok) {
    throw new Error(
      `Strict candidate/worklist QA failed with ${candidateQa.issues.length} issue(s): ` +
        JSON.stringify(candidateQa.issues.slice(0, 20)),
    );
  }
  const candidateManifestValidation = args.candidateManifestPath
    ? validateHybridTranslationCandidateManifest({
        worklistDir: args.worklistDir,
        candidateDir: args.candidateDir,
        manifestPath: args.candidateManifestPath,
      })
    : null;
  const repairedJobs = applyManualCandidates(jobs, args.candidateDir);

  validateCorpus(repairedJobs);
  const finalSourceSnapshot = assertSiteSourceManifestsFresh(namespaces);
  if (JSON.stringify(initialSourceSnapshot) !== JSON.stringify(finalSourceSnapshot)) {
    throw new Error("Site translation sources drifted during repair; refusing to write staged packs.");
  }
  if (args.mode === "validate-candidates") {
    console.log(
      JSON.stringify({
        event: "curated_translation_candidates_validated",
        bundles: repairedJobs.length,
        repairedFields: repairedJobs.reduce((sum, job) => sum + job.repairKeys.length, 0),
        candidateManifest: summarizeCandidateManifest(candidateManifestValidation),
      }),
    );
    return;
  }
  assertApplyScope(args, repairScope, selectedJobs);
  const impactedJobs = repairedJobs.filter((job) =>
    shouldWriteTranslationRepairJob(job.repairKeys, job.duplicateKeys),
  );
  if (!args.candidateManifestPath || !candidateManifestValidation) {
    throw new Error("Apply mode reached the write boundary without a candidate manifest.");
  }
  const finalCandidateManifestValidation = validateHybridTranslationCandidateManifest({
    worklistDir: args.worklistDir,
    candidateDir: args.candidateDir,
    manifestPath: args.candidateManifestPath,
  });
  if (
    JSON.stringify(finalCandidateManifestValidation) !==
    JSON.stringify(candidateManifestValidation)
  ) {
    throw new Error("Candidate manifest provenance drifted before the tracked write boundary.");
  }
  const transaction = writeCanonicalCorpusAtomically(impactedJobs);
  finalizeTranslationRepairWrite(transaction, () => regenerateTrackedOutputs(impactedJobs));
  const impact = transaction.impact;
  console.log(
    JSON.stringify({
      event: "curated_translation_quality_repair_complete",
      mode: args.mode,
      jobs: impactedJobs.length,
      validatedJobs: repairedJobs.length,
      fieldsRepaired: repairedJobs.reduce((sum, job) => sum + job.repairKeys.length, 0),
      filesWritten: impact.filesWritten.size,
      bytesBefore: impact.bytesBefore,
      bytesAfter: impact.bytesAfter,
      byteDelta: impact.bytesAfter - impact.bytesBefore,
      candidateManifest: summarizeCandidateManifest(finalCandidateManifestValidation),
    }),
  );
}

export function assertTranslationCandidateManifestMode(
  mode: Args["mode"],
  candidateManifestPath: string | null,
) {
  if (mode === "apply-candidates" && !candidateManifestPath) {
    throw new Error(
      "--apply-candidates requires --candidate-manifest=<ignored-manifest>.",
    );
  }
  if (
    candidateManifestPath &&
    mode !== "validate-candidates" &&
    mode !== "apply-candidates"
  ) {
    throw new Error(
      "--candidate-manifest is only valid with --validate-candidates or --apply-candidates.",
    );
  }
}

function summarizeCandidateManifest(
  validation: HybridTranslationCandidateManifestValidation | null,
) {
  if (!validation) return null;
  return {
    path: validation.manifestPath,
    canonicalSha256: validation.canonicalSha256,
    draftModel: validation.draftModel,
    files: validation.files,
    fields: validation.fields,
    replacedFields: validation.replacedFields,
    ...(validation.composition ? { composition: validation.composition } : {}),
  };
}

function selectRepairJobs(args: Args): RepairJobSelection {
  const selected: RepairJobSelection = new Map();
  const missing: string[] = [];
  for (const language of args.languages) {
    for (const namespace of args.namespaces) {
      const files = editingPackFiles(language, namespace);
      if (!files.length) {
        if (!args.allExistingNamespaces) missing.push(`${language} ${namespace}`);
        continue;
      }
      selected.set(repairScopeJobKey(language, namespace), { language, namespace });
    }
  }
  if (missing.length) {
    throw new Error(
      `No existing curated pack for requested repair job(s): ${missing
        .slice(0, 12)
        .join(", ")}${missing.length > 12 ? `, +${missing.length - 12} more` : ""}.`,
    );
  }
  if (!selected.size) {
    throw new Error("The requested translation repair selection contains no existing packs.");
  }
  return selected;
}

function buildRepairJobs(
  sourcesToCheck: TranslationSource[],
  languages: SupportedLanguage[],
  seeds: TranslationSeeds,
  repairScope: TranslationRepairScope | null,
  selectedJobs: RepairJobSelection,
) {
  const result: RepairJob[] = [];
  for (const source of sourcesToCheck) {
    for (const language of languages) {
      if (!selectedJobs.has(repairScopeJobKey(language, source.namespace))) continue;
      const bundle = readBaselineBundle(source, language);
      const editingValues = readEditingValues(source, language);
      const seededValues = seeds.get(seedKey(source.sourceHash, language)) ?? {};
      const scopedEntries = repairScope?.entriesByJob.get(
        repairScopeJobKey(language, source.namespace),
      );
      const strings: Record<string, string> = {};
      const repairKeys = new Set<string>();
      const existingCandidates: Record<string, string | undefined> = {};
      const reasons: Record<string, string[]> = {};

      for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
        const existing = editingValues.strings[key] ?? seededValues[key] ?? bundle?.strings[key];
        const scopedEntry = scopedEntries?.get(key);
        if (scopedEntry) {
          const currentCandidate = typeof existing === "string" ? existing : null;
          if (currentCandidate !== scopedEntry.existingCandidate) {
            throw new Error(
              `Repair scope candidate drift for ${language} ${source.namespace} ${key}.`,
            );
          }
          repairKeys.add(key);
          existingCandidates[key] = existing;
          reasons[key] = Array.from(
            new Set(["forced-repair-scope", ...(scopedEntry.reasons ?? [])]),
          ).sort();
          continue;
        }
        if (
          typeof existing === "string" &&
          existing === existing.normalize("NFC") &&
          hasExactProtectedTranslationLiterals(sourceText, existing) &&
          isValidFieldTranslation(sourceText, existing, language) &&
          isTranslationFieldLikelyFluent(
            sourceText,
            existing,
            language,
            translationFieldReviewContext(source, key),
          )
        ) {
          strings[key] = existing;
        } else if (
          isValidFieldTranslation(sourceText, sourceText, language) &&
          isTranslationFieldLikelyFluent(
            sourceText,
            sourceText,
            language,
            translationFieldReviewContext(source, key),
          )
        ) {
          strings[key] = sourceText.normalize("NFC");
        } else {
          repairKeys.add(key);
          existingCandidates[key] = existing;
          reasons[key] = candidateFailureReasons(source, key, existing, language);
        }
      }

      for (const key of suspiciousReuseKeys(source, strings)) {
        repairKeys.add(key);
        existingCandidates[key] = strings[key];
        reasons[key] = Array.from(new Set([...(reasons[key] ?? []), "suspicious-reuse"]));
        delete strings[key];
      }
      result.push({
        source,
        language,
        strings,
        repairKeys: Array.from(repairKeys).sort(),
        duplicateKeys: editingValues.duplicateKeys,
        existingCandidates,
        reasons,
      });
    }
  }
  return result;
}

function candidateFailureReasons(
  source: TranslationSource,
  key: string,
  value: string | undefined,
  language: SupportedLanguage,
) {
  const sourceText = source.sourceStrings[key];
  const reasons: string[] = [];
  if (typeof value !== "string" || !value.trim()) return ["missing"];
  if (value !== value.normalize("NFC")) reasons.push("non-nfc");
  if (!hasExactProtectedTranslationLiterals(sourceText, value)) {
    reasons.push("protected-literal");
  }
  if (!isValidFieldTranslation(sourceText, value, language)) reasons.push("field-invalid");
  if (
    !isTranslationFieldLikelyFluent(
      sourceText,
      value,
      language,
      translationFieldReviewContext(source, key),
    )
  ) {
    reasons.push("non-fluent");
  }
  return reasons.length ? reasons : ["bundle-invalid"];
}

function readBaselineBundle(source: TranslationSource, language: SupportedLanguage) {
  try {
    return getCuratedTranslationBundle(source, language);
  } catch (error) {
    if (source.namespace === mainAppTranslationNamespace) return null;
    throw error;
  }
}

function protectText(sourceText: string): ProtectedText {
  const candidates: Array<{ start: number; end: number; value: string; priority: number }> = [];
  addRegexMatches(candidates, sourceText, /\binspir\b/gi, 1);
  addRegexMatches(candidates, sourceText, /\{[a-zA-Z0-9_]+\}/g, 1);
  addRegexMatches(candidates, sourceText, /https?:\/\/[^\s<>"']+/gi, 1);
  addRegexMatches(candidates, sourceText, /(?:mailto:|tel:)[^\s<>"']+/gi, 1);
  addRegexMatches(candidates, sourceText, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, 1);
  // Protect bare public domains as complete literals. Otherwise the shorter
  // product token in `inspir.app` is selected and raw substring counting also
  // sees `inspirlearning.com`, making a faithful two-domain translation
  // impossible to validate.
  addRegexMatches(
    candidates,
    sourceText,
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}\b/gi,
    1,
  );
  addRegexMatches(candidates, sourceText, /`[^`\n]+`/g, 1);
  addRegexMatches(candidates, sourceText, /\\u[0-9a-fA-F]{4}/g, 1);
  addRegexMatches(
    candidates,
    sourceText,
    /(?<![\p{L}\p{N}])\/(?:[a-z_][a-z0-9_.-]*\/)*(?:[a-z_][a-z0-9_.?=&%#-]*)/giu,
    2,
  );

  candidates.sort((left, right) =>
    left.start - right.start || left.priority - right.priority || right.end - right.start - (left.end - left.start),
  );
  const selected: typeof candidates = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;
    selected.push(candidate);
    cursor = candidate.end;
  }

  const restorations: Array<{ token: string; value: string }> = [];
  let text = sourceText;
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const candidate = selected[index];
    const token = `ZXQK${String(index).padStart(4, "0")}I18NQXZ`;
    restorations.unshift({ token, value: candidate.value });
    text = `${text.slice(0, candidate.start)}${token}${text.slice(candidate.end)}`;
  }
  return {
    text,
    restore(value) {
      let restored = value;
      for (const entry of restorations) {
        const occurrences = countLiteral(restored, entry.token);
        if (occurrences !== 1) {
          throw new Error(
            `Protected translation token ${entry.token} occurred ${occurrences} times; expected exactly once.`,
          );
        }
        restored = restored.replace(entry.token, entry.value);
      }
      if (/ZXQK\d{4}I18NQXZ/.test(restored)) {
        throw new Error("Unexpected protected translation token remained after restoration.");
      }
      return restored;
    },
    validateRestored(value) {
      return hasExactProtectedLiteralMultiset(sourceText, value, restorations);
    },
  };
}

export function hasExactProtectedTranslationLiterals(sourceText: string, value: string) {
  return protectText(sourceText).validateRestored(value);
}

function hasExactProtectedLiteralMultiset(
  sourceText: string,
  value: string,
  restorations: Array<{ value: string }>,
) {
  const expected = new Map<string, number>();
  let expectedInspirCount = 0;
  for (const entry of restorations) {
    if (/^inspir$/i.test(entry.value)) {
      expectedInspirCount += 1;
      continue;
    }
    expected.set(entry.value, (expected.get(entry.value) ?? 0) + 1);
  }
  const claimed = new Uint8Array(value.length);
  for (const [literal, expectedCount] of Array.from(expected.entries()).sort(
    ([left], [right]) => right.length - left.length,
  )) {
    let actualCount = 0;
    let offset = 0;
    while (offset <= value.length - literal.length) {
      const index = value.indexOf(literal, offset);
      if (index === -1) break;
      const end = index + literal.length;
      let overlaps = false;
      for (let cursor = index; cursor < end; cursor += 1) {
        if (claimed[cursor] === 1) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        actualCount += 1;
        claimed.fill(1, index, end);
      }
      offset = index + Math.max(1, literal.length);
    }
    if (actualCount !== expectedCount) return false;
  }
  if (expectedInspirCount) {
    const actualInspirCount = Array.from(value.matchAll(/inspir/gi)).filter((match) => {
      const start = match.index ?? -1;
      if (start < 0) return false;
      for (let cursor = start; cursor < start + match[0].length; cursor += 1) {
        if (claimed[cursor] === 1) return false;
      }
      return true;
    }).length;
    if (sourcesAllowingAdditionalInspirMentions.has(sourceText)) {
      return actualInspirCount >= expectedInspirCount;
    }
    return actualInspirCount === expectedInspirCount;
  }
  return true;
}

function countLiteral(value: string, literal: string) {
  if (!literal) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= value.length - literal.length) {
    const index = value.indexOf(literal, offset);
    if (index === -1) break;
    count += 1;
    offset = index + literal.length;
  }
  return count;
}

function addRegexMatches(
  matches: Array<{ start: number; end: number; value: string; priority: number }>,
  source: string,
  pattern: RegExp,
  priority: number,
) {
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined || !match[0]) continue;
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      value: match[0],
      priority,
    });
  }
}

function readEditingValues(source: TranslationSource, language: SupportedLanguage): EditingValues {
  const values: Record<string, string> = {};
  const owners = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const file of editingPackFiles(language, source.namespace)) {
    const pack = parseJsonRecord(file);
    if (pack.language !== language || pack.namespace !== source.namespace) {
      throw new Error(`Mismatched curated pack metadata in ${file}.`);
    }
    const sourceHashFresh = pack.sourceHash === source.sourceHash;
    if (sourceHashFresh && isRecord(pack.translations)) {
      for (const [key, value] of Object.entries(pack.translations)) {
        if (key in source.sourceStrings && typeof value === "string" && value.trim()) {
          setEditingValue(values, owners, duplicates, key, value, file);
        }
      }
    }
    if (Array.isArray(pack.entries)) {
      for (const entry of pack.entries) {
        if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.value !== "string") continue;
        if (!(entry.key in source.sourceStrings) || !entry.value.trim()) continue;
        if (!sourceHashFresh && entry.source !== source.sourceStrings[entry.key]) continue;
        setEditingValue(values, owners, duplicates, entry.key, entry.value, file);
      }
    }
  }
  return { strings: values, duplicateKeys: Array.from(duplicates).sort() };
}

function setEditingValue(
  values: Record<string, string>,
  owners: Map<string, string>,
  duplicates: Set<string>,
  key: string,
  value: string,
  file: string,
) {
  const existing = values[key];
  if (existing !== undefined) {
    duplicates.add(key);
    if (existing !== value) {
      throw new Error(
        `Conflicting curated split key ${key}: ${owners.get(key) ?? "unknown"} differs from ${file}.`,
      );
    }
    return;
  }
  values[key] = value;
  owners.set(key, file);
}

function writeWorklists(jobs: RepairJob[], outputDir: string) {
  assertIgnoredTmpPath(outputDir, "Worklist directory");
  rmSync(outputDir, { recursive: true, force: true });
  let files = 0;
  let fields = 0;
  let bytes = 0;
  for (const job of jobs) {
    if (!job.repairKeys.length) continue;
    const path = join(outputDir, candidateRelativePath(job));
    const payload = {
      schemaVersion: 1,
      kind: "translation-repair-worklist",
      protectorVersion,
      protectorFingerprint,
      language: job.language,
      locale: languageConfigs[job.language].locale,
      namespace: job.source.namespace,
      sourceHash: job.source.sourceHash,
      entries: job.repairKeys.map((key) => ({
        key,
        source: job.source.sourceStrings[key],
        existingCandidate: job.existingCandidates[key] ?? null,
        reasons: job.reasons[key] ?? ["bundle-invalid"],
        value: "",
      })),
    };
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serialized);
    files += 1;
    fields += job.repairKeys.length;
    bytes += Buffer.byteLength(serialized);
  }
  return { outputDir, files, fields, bytes };
}

function applyManualCandidates(jobs: RepairJob[], candidateDir: string) {
  const expectedFiles = new Set(
    jobs
      .filter((job) => job.repairKeys.length)
      .map((job) => resolve(candidateDir, candidateRelativePath(job))),
  );
  const actualFiles = new Set(collectJsonFiles(candidateDir));
  const missingFiles = Array.from(expectedFiles).filter((path) => !actualFiles.has(path));
  const unexpectedFiles = Array.from(actualFiles).filter((path) => !expectedFiles.has(path));
  if (missingFiles.length || unexpectedFiles.length) {
    throw new Error(
      `Candidate file set mismatch: missing=${missingFiles.slice(0, 5).join(",")} unexpected=${unexpectedFiles.slice(0, 5).join(",")}.`,
    );
  }

  return jobs.map((job) => {
    if (!job.repairKeys.length) return job;
    const path = resolve(candidateDir, candidateRelativePath(job));
    const candidate = parseJsonRecord(path);
    if (
      candidate.schemaVersion !== 1 ||
      candidate.kind !== "translation-repair-candidate" ||
      candidate.protectorVersion !== protectorVersion ||
      candidate.protectorFingerprint !== protectorFingerprint ||
      candidate.language !== job.language ||
      candidate.namespace !== job.source.namespace ||
      candidate.sourceHash !== job.source.sourceHash ||
      !Array.isArray(candidate.entries)
    ) {
      throw new Error(`Candidate metadata mismatch in ${path}.`);
    }

    const values = new Map<string, string>();
    for (const rawEntry of candidate.entries) {
      if (
        !isRecord(rawEntry) ||
        typeof rawEntry.key !== "string" ||
        typeof rawEntry.source !== "string" ||
        typeof rawEntry.value !== "string"
      ) {
        throw new Error(`Invalid candidate entry in ${path}.`);
      }
      if (values.has(rawEntry.key)) throw new Error(`Duplicate candidate key ${rawEntry.key} in ${path}.`);
      if (rawEntry.source !== job.source.sourceStrings[rawEntry.key]) {
        throw new Error(`Candidate source drift for ${rawEntry.key} in ${path}.`);
      }
      values.set(rawEntry.key, rawEntry.value);
    }
    const actualKeys = Array.from(values.keys()).sort();
    if (
      actualKeys.length !== job.repairKeys.length ||
      actualKeys.some((key, index) => key !== job.repairKeys[index])
    ) {
      throw new Error(`Candidate key set mismatch in ${path}.`);
    }

    const strings = { ...job.strings };
    const invalidEntries: string[] = [];
    for (const key of job.repairKeys) {
      const value = values.get(key);
      const reasons = manualCandidateFailureReasons(job.source, key, value, job.language);
      if (reasons.length) {
        invalidEntries.push(`${key} [${reasons.join(", ")}]`);
        continue;
      }
      if (value === undefined) continue;
      strings[key] = value;
    }
    if (invalidEntries.length) {
      throw new Error(
        `Candidate validation failed for ${job.language} ${job.source.namespace}: ${invalidEntries
          .slice(0, 40)
          .join("; ")}${invalidEntries.length > 40 ? `; +${invalidEntries.length - 40} more` : ""}.`,
      );
    }
    return { ...job, strings };
  });
}

function manualCandidateFailureReasons(
  source: TranslationSource,
  key: string,
  value: string | undefined,
  language: SupportedLanguage,
) {
  const sourceText = source.sourceStrings[key];
  const reasons: string[] = [];
  if (!value?.trim()) return ["missing"];
  if (language === defaultLanguage) {
    reasons.push("invalid-target-language");
  } else {
    reasons.push(
      ...validateTranslationCandidateField({
        language,
        source: sourceText,
        value,
      }).failures,
    );
  }
  if (value !== value.normalize("NFC")) reasons.push("non-nfc");
  if (/ZXQK\d{4}I18NQXZ/.test(value)) reasons.push("unrestored-sentinel");
  if (!protectText(sourceText).validateRestored(value)) reasons.push("protected-literal");
  if (!isValidFieldTranslation(sourceText, value, language)) reasons.push("field-invalid");
  if (
    !isTranslationFieldLikelyFluent(
      sourceText,
      value,
      language,
      translationFieldReviewContext(source, key),
    )
  ) {
    reasons.push("non-fluent");
  }
  return Array.from(new Set(reasons)).sort();
}

function candidateRelativePath(job: RepairJob) {
  const locale = languageConfigs[job.language].prefix || languageConfigs[job.language].locale;
  return join(locale, `${fileSafeNamespace(job.source.namespace)}.json`);
}

function collectJsonFiles(root: string) {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (path: string) => {
    const stats = statSync(path);
    if (stats.isFile()) {
      if (path.endsWith(".json")) files.push(resolve(path));
      return;
    }
    if (!stats.isDirectory()) return;
    for (const entry of readdirSync(path)) visit(join(path, entry));
  };
  visit(root);
  return files.sort();
}

function validateCorpus(jobsToValidate: RepairJob[]) {
  for (const job of jobsToValidate) {
    const sourceKeys = Object.keys(job.source.sourceStrings).sort();
    const translatedKeys = Object.keys(job.strings).sort();
    if (
      sourceKeys.length !== translatedKeys.length ||
      sourceKeys.some((key, index) => key !== translatedKeys[index])
    ) {
      throw new Error(`Key mismatch in ${job.language} ${job.source.namespace}.`);
    }
    const failures = exactFailures(job.source, job.language, job.strings);
    const bundle = bundleFor(job.source, job.language, job.strings);
    if (
      failures.length ||
      !isTranslationBundleFieldValid(job.source, bundle, job.language) ||
      !isTranslationBundleCompleteAndFluent(job.source, bundle, job.language)
    ) {
      throw new Error(
        `Corpus validation failed for ${job.language} ${job.source.namespace}: ${diagnoseFailures(job.source, job.language, job.strings, failures)}`,
      );
    }
  }
}

export function shouldWriteTranslationRepairJob(
  repairKeys: readonly string[],
  duplicateKeys: readonly string[],
) {
  return repairKeys.length > 0 || duplicateKeys.length > 0;
}

export function finalizeTranslationRepairWrite(
  transaction: TranslationRepairTransactionControl,
  regenerate: () => void,
) {
  try {
    regenerate();
    transaction.commit();
  } catch (error) {
    const recoveryErrors: unknown[] = [error];
    let sourceRollbackComplete = false;
    try {
      transaction.rollback();
      sourceRollbackComplete = true;
    } catch (rollbackError) {
      recoveryErrors.push(rollbackError);
    }
    if (sourceRollbackComplete) {
      try {
        regenerate();
      } catch (regenerationRollbackError) {
        recoveryErrors.push(regenerationRollbackError);
      }
    }
    if (recoveryErrors.length > 1) {
      throw new AggregateError(
        recoveryErrors,
        "Translation repair failed and could not completely restore its generated outputs.",
      );
    }
    throw error;
  }
}

function writeCanonicalCorpusAtomically(jobsToWrite: RepairJob[]): CorpusWriteTransaction {
  const stageRoot = resolve(process.cwd(), "tmp", `curated-repair-stage-${process.pid}`);
  const backupRoot = join(stageRoot, "backup");
  const stagedRoot = join(stageRoot, "staged");
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stagedRoot, { recursive: true });

  const operations = jobsToWrite.map((job) => {
    const locale = languageConfigs[job.language].prefix || languageConfigs[job.language].locale;
    const filename = `${fileSafeNamespace(job.source.namespace)}.json`;
    const target = join(resolve(process.cwd(), "translations/curated"), locale, filename);
    const staged = join(stagedRoot, locale, filename);
    const serialized = `${JSON.stringify(
      {
        schemaVersion: 1,
        language: job.language,
        locale: languageConfigs[job.language].locale,
        namespace: job.source.namespace,
        sourceHash: job.source.sourceHash,
        model: repairVersion,
        entries: Object.keys(job.source.sourceStrings)
          .sort()
          .map((key) => ({
            key,
            source: job.source.sourceStrings[key],
            value: job.strings[key],
          })),
      },
      null,
      2,
    )}\n`;
    mkdirSync(dirname(staged), { recursive: true });
    writeFileSync(staged, serialized);
    const existing = editingPackFiles(job.language, job.source.namespace);
    if (!existing.length) {
      throw new Error(
        `Refusing to create a missing curated pack for ${job.language} ${job.source.namespace}.`,
      );
    }
    return {
      target,
      staged,
      existing,
      bytesAfter: Buffer.byteLength(serialized),
    };
  });

  const existingFiles = Array.from(new Set(operations.flatMap((operation) => operation.existing)));
  const installed: string[] = [];
  const movedBackups: Array<{ original: string; backup: string }> = [];
  try {
    for (const original of existingFiles) {
      const relative = original.slice(resolve(process.cwd(), "translations/curated").length + 1);
      const backup = join(backupRoot, relative);
      mkdirSync(dirname(backup), { recursive: true });
      renameSync(original, backup);
      movedBackups.push({ original, backup });
    }
    for (const operation of operations) {
      mkdirSync(dirname(operation.target), { recursive: true });
      renameSync(operation.staged, operation.target);
      installed.push(operation.target);
    }
  } catch (error) {
    for (const target of installed.reverse()) rmSync(target, { force: true });
    for (const entry of movedBackups.reverse()) {
      mkdirSync(dirname(entry.original), { recursive: true });
      renameSync(entry.backup, entry.original);
    }
    throw error;
  }

  const impact: FileImpact = {
    filesWritten: new Set(operations.map((operation) => operation.target)),
    bytesBefore: existingFiles.reduce(
      (sum, file) => sum + statSync(join(backupRoot, file.slice(resolve(process.cwd(), "translations/curated").length + 1))).size,
      0,
    ),
    bytesAfter: operations.reduce((sum, operation) => sum + operation.bytesAfter, 0),
  };
  let closed = false;
  return {
    impact,
    commit() {
      if (closed) return;
      rmSync(stageRoot, { recursive: true, force: true });
      closed = true;
    },
    rollback() {
      if (closed) return;
      for (const target of [...installed].reverse()) rmSync(target, { force: true });
      for (const entry of [...movedBackups].reverse()) {
        mkdirSync(dirname(entry.original), { recursive: true });
        renameSync(entry.backup, entry.original);
      }
      rmSync(stageRoot, { recursive: true, force: true });
      closed = true;
    },
  };
}

function regenerateTrackedOutputs(jobs: RepairJob[]) {
  if (jobs.some((job) => job.source.namespace === mainAppTranslationNamespace)) {
    execFileSync("pnpm", ["translations:static-main-app", "--clean"], {
      stdio: "inherit",
    });
    execFileSync("pnpm", ["translations:static-main-app:check"], {
      stdio: "inherit",
    });
  }

  const languagesByNamespace = new Map<string, Set<SupportedLanguage>>();
  for (const job of jobs) {
    const languages = languagesByNamespace.get(job.source.namespace) ?? new Set();
    languages.add(job.language);
    languagesByNamespace.set(job.source.namespace, languages);
  }
  for (const [namespace, languages] of Array.from(languagesByNamespace).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    execFileSync(
      "pnpm",
      [
        "translations:status",
        `--languages=${Array.from(languages).sort().join(",")}`,
        `--namespace=${namespace}`,
      ],
      { stdio: "inherit" },
    );
  }
}

function exactFailures(
  source: TranslationSource,
  language: SupportedLanguage,
  strings: Record<string, string>,
) {
  const failures = Object.entries(source.sourceStrings)
    .filter(([key, sourceText]) => {
      const value = strings[key];
      return (
        typeof value !== "string" ||
        value !== value.normalize("NFC") ||
        !hasExactProtectedTranslationLiterals(sourceText, value) ||
        !isValidFieldTranslation(sourceText, value, language) ||
        !isTranslationFieldLikelyFluent(
          sourceText,
          value,
          language,
          translationFieldReviewContext(source, key),
        )
      );
    })
    .map(([key]) => key);
  return Array.from(new Set([...failures, ...suspiciousReuseKeys(source, strings)])).sort();
}

function suspiciousReuseKeys(source: TranslationSource, strings: Record<string, string>) {
  const byTranslation = new Map<string, Array<{ key: string; source: string }>>();
  for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
    const translated = strings[key]?.trim();
    if (!translated) continue;
    const normalized = comparableText(translated);
    if (!normalized) continue;
    const group = byTranslation.get(normalized) ?? [];
    group.push({ key, source: comparableText(sourceText) });
    byTranslation.set(normalized, group);
  }
  return Array.from(byTranslation.values())
    .filter((group) => new Set(group.map((entry) => entry.source)).size >= 3)
    .flatMap((group) => group.map((entry) => entry.key));
}

function comparableText(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "")
    .replace(/\{[a-zA-Z0-9_]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function diagnoseFailures(
  source: TranslationSource,
  language: SupportedLanguage,
  strings: Record<string, string>,
  failures = exactFailures(source, language, strings),
) {
  return failures
    .slice(0, 12)
    .map((key) => `${key}: ${source.sourceStrings[key]} -> ${strings[key] ?? "<missing>"}`)
    .join(" | ");
}

export function translationRepairScopeFingerprint(
  entries: readonly TranslationRepairScopeEntry[],
) {
  const rows = [...entries]
    .sort(compareTranslationRepairScopeEntries)
    .map((entry) =>
      JSON.stringify([
        entry.language,
        entry.locale,
        entry.namespace,
        entry.sourceHash,
        entry.key,
        entry.source,
        entry.existingCandidate,
      ]),
    );
  return createHash("sha256")
    .update(rows.length ? `${rows.join("\n")}\n` : "")
    .digest("hex");
}

export function loadTranslationRepairScope(
  inputPath: string | null,
  sources: TranslationSource[],
  languages: SupportedLanguage[],
  selectedJobs: RepairJobSelection,
): TranslationRepairScope | null {
  if (!inputPath) return null;
  const absolutePath = resolve(inputPath);
  assertIgnoredTmpPath(absolutePath, "Repair scope JSON");

  const raw = parseJsonRecord(absolutePath);
  assertExactRecordKeys(
    raw,
    [
      "canonicalSha256",
      "entries",
      "fields",
      "kind",
      "schemaVersion",
      "sourceHashes",
    ],
    `repair scope root ${absolutePath}`,
  );
  if (
    raw.schemaVersion !== 1 ||
    raw.kind !== "translation-repair-scope" ||
    typeof raw.canonicalSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.canonicalSha256) ||
    !Number.isSafeInteger(raw.fields) ||
    typeof raw.fields !== "number" ||
    raw.fields <= 0 ||
    !isRecord(raw.sourceHashes) ||
    !Array.isArray(raw.entries)
  ) {
    throw new Error(`Invalid translation repair scope metadata in ${absolutePath}.`);
  }

  const sourcesByNamespace = new Map(sources.map((source) => [source.namespace, source]));
  const selectedLanguages = new Set(languages);
  const entries: TranslationRepairScopeEntry[] = [];
  const entriesByJob = new Map<string, Map<string, TranslationRepairScopeEntry>>();
  for (const rawEntry of raw.entries) {
    if (isRecord(rawEntry)) {
      assertExactRecordKeys(
        rawEntry,
        [
          "existingCandidate",
          "key",
          "language",
          "locale",
          "namespace",
          "source",
          "sourceHash",
        ],
        `repair scope entry in ${absolutePath}`,
        ["reasons"],
      );
    }
    if (
      !isRecord(rawEntry) ||
      typeof rawEntry.language !== "string" ||
      typeof rawEntry.locale !== "string" ||
      typeof rawEntry.namespace !== "string" ||
      typeof rawEntry.sourceHash !== "string" ||
      typeof rawEntry.key !== "string" ||
      typeof rawEntry.source !== "string" ||
      (rawEntry.existingCandidate !== null &&
        typeof rawEntry.existingCandidate !== "string")
    ) {
      throw new Error(`Invalid translation repair scope entry in ${absolutePath}.`);
    }
    const language = normalizeLanguage(rawEntry.language);
    if (
      language === defaultLanguage ||
      language !== rawEntry.language ||
      !selectedLanguages.has(language)
    ) {
      throw new Error(`Repair scope includes unselected language ${rawEntry.language}.`);
    }
    if (rawEntry.locale !== languageConfigs[language].locale) {
      throw new Error(
        `Repair scope locale mismatch for ${rawEntry.language}: ${rawEntry.locale}.`,
      );
    }
    if (!isRepairNamespace(rawEntry.namespace)) {
      throw new Error(`Repair scope includes unsupported namespace ${rawEntry.namespace}.`);
    }
    const source = sourcesByNamespace.get(rawEntry.namespace);
    if (!source) {
      throw new Error(`Repair scope includes unselected namespace ${rawEntry.namespace}.`);
    }
    if (
      rawEntry.sourceHash !== source.sourceHash ||
      source.sourceStrings[rawEntry.key] !== rawEntry.source
    ) {
      throw new Error(
        `Repair scope source drift for ${language} ${rawEntry.namespace} ${rawEntry.key}.`,
      );
    }
    const reasons = parseRepairScopeReasons(rawEntry.reasons, absolutePath, rawEntry.key);
    const entry: TranslationRepairScopeEntry = {
      language,
      locale: rawEntry.locale,
      namespace: rawEntry.namespace,
      sourceHash: rawEntry.sourceHash,
      key: rawEntry.key,
      source: rawEntry.source,
      existingCandidate: rawEntry.existingCandidate,
      ...(reasons ? { reasons } : {}),
    };
    const jobKey = repairScopeJobKey(language, entry.namespace);
    if (!selectedJobs.has(jobKey)) {
      throw new Error(
        `Repair scope includes a non-existing job ${language} ${entry.namespace}.`,
      );
    }
    const jobEntries = entriesByJob.get(jobKey) ?? new Map<string, TranslationRepairScopeEntry>();
    if (jobEntries.has(entry.key)) {
      throw new Error(
        `Duplicate repair scope key ${language} ${entry.namespace} ${entry.key}.`,
      );
    }
    jobEntries.set(entry.key, entry);
    entriesByJob.set(jobKey, jobEntries);
    entries.push(entry);
  }

  const canonicalSha256 = translationRepairScopeFingerprint(entries);
  if (canonicalSha256 !== raw.canonicalSha256) {
    throw new Error(
      `Repair scope fingerprint mismatch in ${absolutePath}: expected ${raw.canonicalSha256}, got ${canonicalSha256}.`,
    );
  }
  if (raw.fields !== entries.length) {
    throw new Error(
      `Repair scope field count mismatch in ${absolutePath}: expected ${raw.fields}, got ${entries.length}.`,
    );
  }
  assertRepairScopeSourceHashes(raw.sourceHashes, entries, sourcesByNamespace, absolutePath);
  return {
    path: absolutePath,
    canonicalSha256,
    entriesByJob,
    fields: entries.length,
  };
}

function parseRepairScopeReasons(
  value: unknown,
  path: string,
  key: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((reason) => typeof reason !== "string" || !reason.trim())
  ) {
    throw new Error(`Invalid repair scope reasons for ${key} in ${path}.`);
  }
  const canonical = Array.from(new Set(value)).sort();
  if (
    canonical.length !== value.length ||
    canonical.some((reason, index) => reason !== value[index])
  ) {
    throw new Error(`Repair scope reasons must be sorted and unique for ${key} in ${path}.`);
  }
  return canonical;
}

function assertRepairScopeSourceHashes(
  rawSourceHashes: Record<string, unknown>,
  entries: TranslationRepairScopeEntry[],
  sourcesByNamespace: Map<string, TranslationSource>,
  path: string,
) {
  const expectedNamespaces = Array.from(new Set(entries.map((entry) => entry.namespace))).sort();
  const actualNamespaces = Object.keys(rawSourceHashes);
  if (
    actualNamespaces.length !== expectedNamespaces.length ||
    actualNamespaces.some((namespace, index) => namespace !== expectedNamespaces[index])
  ) {
    throw new Error(`Repair scope sourceHashes keys must be exact and sorted in ${path}.`);
  }
  for (const namespace of expectedNamespaces) {
    const source = sourcesByNamespace.get(namespace);
    if (!source || rawSourceHashes[namespace] !== source.sourceHash) {
      throw new Error(`Repair scope source hash drift for ${namespace} in ${path}.`);
    }
  }
}

export function repairScopeJobKey(language: SupportedLanguage, namespace: string) {
  return `${language}\u0000${namespace}`;
}

function compareTranslationRepairScopeEntries(
  left: TranslationRepairScopeEntry,
  right: TranslationRepairScopeEntry,
) {
  return (
    left.locale.localeCompare(right.locale) ||
    left.namespace.localeCompare(right.namespace) ||
    left.key.localeCompare(right.key) ||
    left.sourceHash.localeCompare(right.sourceHash) ||
    left.source.localeCompare(right.source) ||
    left.language.localeCompare(right.language) ||
    (left.existingCandidate ?? "").localeCompare(right.existingCandidate ?? "")
  );
}

function loadTranslationSeeds(paths: string[]): TranslationSeeds {
  const seeds: TranslationSeeds = new Map();
  for (const path of paths) {
    const absolute = resolve(process.cwd(), path);
    const value: unknown = JSON.parse(readFileSync(absolute, "utf8"));
    if (!Array.isArray(value)) throw new Error(`Seed export must be a Wrangler JSON array: ${absolute}.`);
    for (const result of value) {
      if (!isRecord(result) || !Array.isArray(result.results)) continue;
      for (const rawRow of result.results) {
        if (!isRecord(rawRow)) continue;
        const language = normalizeLanguage(rawRow.language);
        if (
          language === defaultLanguage ||
          typeof rawRow.source_hash !== "string" ||
          (typeof rawRow.payload !== "string" && !isRecord(rawRow.payload))
        ) {
          continue;
        }
        const rawPayload: unknown =
          typeof rawRow.payload === "string" ? JSON.parse(rawRow.payload) : rawRow.payload;
        if (!isRecord(rawPayload)) throw new Error(`Invalid seed payload for ${language} in ${absolute}.`);
        const strings: Record<string, string> = {};
        for (const [key, entry] of Object.entries(rawPayload)) {
          if (typeof entry === "string") strings[key] = entry;
        }
        const key = seedKey(rawRow.source_hash, language);
        const existing = seeds.get(key);
        if (existing && JSON.stringify(existing) !== JSON.stringify(strings)) {
          throw new Error(`Conflicting seed rows for ${language} ${rawRow.source_hash}.`);
        }
        seeds.set(key, strings);
      }
    }
  }
  return seeds;
}

function seedKey(sourceHash: string, language: SupportedLanguage) {
  return `${sourceHash}\u0000${language}`;
}

function assertSiteSourceManifestsFresh(namespaces: RepairNamespace[]) {
  const siteNamespaces = namespaces.filter(
    (namespace): namespace is Exclude<RepairNamespace, typeof mainAppTranslationNamespace> =>
      namespace !== mainAppTranslationNamespace,
  );
  const evaluation = [
    'import { getSiteTranslationSource } from "./lib/i18n/site-source";',
    'import { getMainAppSourceHash, getMainAppSourceStrings, mainAppTranslationNamespace } from "./lib/i18n/main-app-source";',
    `const namespaces = ${JSON.stringify(siteNamespaces)};`,
    "const snapshot = Object.fromEntries(namespaces.map((namespace) => {",
    "  const manifest = getSiteTranslationSource(namespace);",
    '  const extracted = getSiteTranslationSource(namespace, { mode: "extract" });',
    "  return [namespace, { manifest: manifest.sourceHash, extracted: extracted.sourceHash, count: Object.keys(extracted.sourceStrings).length }];",
    "}));",
    "const mainAppStrings = getMainAppSourceStrings();",
    "const mainAppHash = getMainAppSourceHash(mainAppStrings);",
    "snapshot[mainAppTranslationNamespace] = { manifest: mainAppHash, extracted: mainAppHash, count: Object.keys(mainAppStrings).length };",
    "console.log(JSON.stringify(snapshot));",
  ].join("\n");
  const output = execFileSync("pnpm", ["tsx", "-e", evaluation], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  const snapshot: unknown = JSON.parse(output.split(/\r?\n/).at(-1) ?? "{}");
  if (!isRecord(snapshot)) throw new Error("Could not read fresh site translation source snapshot.");
  for (const namespace of namespaces) {
    const entry = snapshot[namespace];
    if (
      !isRecord(entry) ||
      typeof entry.manifest !== "string" ||
      typeof entry.extracted !== "string" ||
      entry.manifest !== entry.extracted
    ) {
      throw new Error(`Site source manifest drift for ${namespace}; regenerate it before repair.`);
    }
  }
  return snapshot;
}

function assertApplyScope(
  parsedArgs: Args,
  repairScope: TranslationRepairScope | null,
  selectedJobs: RepairJobSelection,
) {
  if (!repairScope || !parsedArgs.repairScopePath) {
    throw new Error("--apply-candidates requires --repair-scope-json for an auditable write.");
  }
  if (!selectedJobs.size || !repairScope.fields) {
    throw new Error("--apply-candidates requires a non-empty existing repair scope.");
  }
}

function sourceForNamespace(namespace: RepairNamespace) {
  if (namespace === mainAppTranslationNamespace) {
    const sourceStrings = getMainAppSourceStrings();
    return {
      namespace,
      sourceHash: getMainAppSourceHash(sourceStrings),
      sourceStrings,
    } satisfies TranslationSource;
  }
  return getSiteTranslationSource(namespace);
}

function translationFieldReviewContext(source: TranslationSource, key: string) {
  return {
    namespace: source.namespace,
    sourceHash: source.sourceHash,
    key,
  };
}

function bundleFor(
  source: TranslationSource,
  language: SupportedLanguage,
  strings: Record<string, string>,
): TranslationBundle {
  return {
    namespace: source.namespace,
    language,
    sourceHash: source.sourceHash,
    sourceStrings: source.sourceStrings,
    strings,
  };
}

function editingPackFiles(language: SupportedLanguage, namespace: string) {
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const root = join(resolve(process.cwd(), "translations/curated"), locale);
  if (!existsSync(root)) return [];
  const safeNamespace = fileSafeNamespace(namespace);
  return readdirSync(root)
    .filter((file) => file === `${safeNamespace}.json` || file.startsWith(`${safeNamespace}.part-`))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => join(root, file));
}

function fileSafeNamespace(namespace: string) {
  return namespace.replace(/[^a-z0-9.-]+/gi, "__");
}

function parseJsonRecord(path: string) {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error(`Expected a JSON object in ${path}.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertIgnoredTmpPath(path: string, label: string) {
  const ignoredRoot = resolve(process.cwd(), "tmp");
  const absolutePath = resolve(path);
  if (absolutePath !== ignoredRoot && !absolutePath.startsWith(`${ignoredRoot}/`)) {
    throw new Error(`${label} must stay under the ignored tmp directory: ${absolutePath}.`);
  }
}

function assertExactRecordKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  label: string,
  optionalKeys: readonly string[] = [],
) {
  const required = new Set(requiredKeys);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const actual = Object.keys(value);
  const missing = requiredKeys.filter((key) => !(key in value));
  const unexpected = actual.filter((key) => !allowed.has(key));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Invalid ${label} keys: missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}.`,
    );
  }
  if (required.size !== requiredKeys.length) {
    throw new Error(`Internal duplicate required key in ${label}.`);
  }
}

function parseArgs(rawArgs: string[]): Args {
  const requestedLanguages: string[] = [];
  const requestedNamespaces: string[] = [];
  let allLanguages = false;
  let allExistingNamespaces = false;
  let mode: Args["mode"] = "plan";
  let explicitMode = false;
  const seedPaths: string[] = [];
  let worklistDir = defaultWorklistDir;
  let worklistDirProvided = false;
  let candidateDir: string | null = null;
  let candidateManifestPath: string | null = null;
  let repairScopePath: string | null = null;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--all-languages") allLanguages = true;
    else if (arg === "--languages") {
      requestedLanguages.push(...splitCsv(rawArgs[index + 1] ?? ""));
      index += 1;
    } else if (arg.startsWith("--languages=")) requestedLanguages.push(...splitCsv(arg.slice(12)));
    else if (arg === "--namespaces") {
      requestedNamespaces.push(...splitCsv(rawArgs[index + 1] ?? ""));
      index += 1;
    } else if (arg.startsWith("--namespaces=")) requestedNamespaces.push(...splitCsv(arg.slice(13)));
    else if (arg === "--all-existing-namespaces") allExistingNamespaces = true;
    else if (arg === "--seed-json") {
      seedPaths.push(rawArgs[index + 1] ?? "");
      index += 1;
    } else if (arg.startsWith("--seed-json=")) seedPaths.push(arg.slice(12));
    else if (arg === "--repair-scope-json") {
      repairScopePath = rawArgs[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--repair-scope-json=")) {
      repairScopePath = arg.slice(20);
    } else if (arg === "--worklist-dir") {
      worklistDir = rawArgs[index + 1] ?? worklistDir;
      worklistDirProvided = true;
      index += 1;
    } else if (arg.startsWith("--worklist-dir=")) {
      worklistDir = arg.slice(15);
      worklistDirProvided = true;
    }
    else if (arg === "--candidate-dir") {
      candidateDir = rawArgs[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--candidate-dir=")) candidateDir = arg.slice(16);
    else if (arg === "--candidate-manifest") {
      candidateManifestPath = rawArgs[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--candidate-manifest=")) {
      candidateManifestPath = arg.slice(21);
    }
    else if (arg === "--plan" || arg === "--dry-run") {
      if (explicitMode && mode !== "plan") throw new Error("Choose exactly one repair mode.");
      mode = "plan";
      explicitMode = true;
    } else if (arg === "--export-worklists") {
      if (explicitMode && mode !== "export-worklists") throw new Error("Choose exactly one repair mode.");
      mode = "export-worklists";
      explicitMode = true;
    } else if (arg === "--validate-candidates") {
      if (explicitMode && mode !== "validate-candidates") throw new Error("Choose exactly one repair mode.");
      mode = "validate-candidates";
      explicitMode = true;
    } else if (arg === "--apply-candidates") {
      if (explicitMode && mode !== "apply-candidates") throw new Error("Choose exactly one repair mode.");
      mode = "apply-candidates";
      explicitMode = true;
    } else {
      throw new Error(`Unknown translation repair argument: ${arg}.`);
    }
  }

  const languages = (allLanguages ? [...supportedLanguages] : requestedLanguages.map(normalizeLanguage)).filter(
    (language): language is Exclude<SupportedLanguage, typeof defaultLanguage> => language !== defaultLanguage,
  );
  const uniqueLanguages = Array.from(new Set(languages));
  if (!uniqueLanguages.length) throw new Error("Pass --all-languages or --languages=Hindi,Spanish.");
  if (allExistingNamespaces && requestedNamespaces.length) {
    throw new Error("Choose --all-existing-namespaces or --namespaces, not both.");
  }
  const rawNamespaces = requestedNamespaces.length
    ? requestedNamespaces
    : allExistingNamespaces
      ? [mainAppTranslationNamespace, ...getAllSiteTranslationNamespaces()]
      : [...defaultRepairNamespaces];
  const namespaces = Array.from(new Set(rawNamespaces)).map((namespace) => {
    if (!isRepairNamespace(namespace)) {
      throw new Error(`Unsupported repair namespace: ${namespace}.`);
    }
    return namespace;
  });
  return {
    languages: uniqueLanguages,
    namespaces,
    mode,
    seedPaths: seedPaths.filter(Boolean),
    worklistDir: resolve(worklistDir),
    worklistDirProvided,
    candidateDir: candidateDir ? resolve(candidateDir) : null,
    candidateManifestPath: candidateManifestPath ? resolve(candidateManifestPath) : null,
    repairScopePath: repairScopePath ? resolve(repairScopePath) : null,
    allLanguages,
    allExistingNamespaces,
  };
}

function isRepairNamespace(value: string): value is RepairNamespace {
  return value === mainAppTranslationNamespace || isKnownSiteTranslationNamespace(value);
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
