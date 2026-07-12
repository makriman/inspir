import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultLanguage,
  languageConfigs,
  normalizeLanguage,
} from "@/lib/content/languages";
import {
  validateTranslationCandidateField,
  type TranslationCandidateQualityFailure,
  type TranslationCandidateTargetLanguage,
} from "@/lib/i18n/translation-candidate-quality";

type CandidateQaArgs = {
  worklistDir: string;
  candidateDir: string;
};

type WorklistEntry = {
  key: string;
  source: string;
  existingCandidate: string | null;
  reasons: string[];
};

type TranslationRepairWorklist = {
  relativePath: string;
  protectorVersion: string;
  protectorFingerprint: string;
  language: TranslationCandidateTargetLanguage;
  locale: string;
  namespace: string;
  sourceHash: string;
  entries: WorklistEntry[];
};

type CandidateEntry = WorklistEntry & {
  value: string;
};

type TranslationRepairCandidate = {
  relativePath: string;
  draftModel: string;
  protectorVersion: string;
  protectorFingerprint: string;
  language: TranslationCandidateTargetLanguage;
  locale: string;
  namespace: string;
  sourceHash: string;
  entries: CandidateEntry[];
};

export type TranslationCandidateQaIssue =
  | {
      code: "missing-candidate-file" | "unexpected-candidate-file";
      relativePath: string;
    }
  | {
      code: "mixed-draft-model";
      relativePath: string;
      draftModel: string;
      expectedDraftModel: string;
    }
  | {
      code: "candidate-field";
      relativePath: string;
      language: TranslationCandidateTargetLanguage;
      namespace: string;
      key: string;
      failures: TranslationCandidateQualityFailure[];
      sourceNegationMarkers: string[];
    };

export type TranslationCandidateQaReport = {
  ok: boolean;
  worklistDir: string;
  candidateDir: string;
  worklistFiles: number;
  candidateFiles: number;
  checkedFiles: number;
  checkedFields: number;
  draftModel: string | null;
  issues: TranslationCandidateQaIssue[];
};

const worklistRootKeys = [
  "entries",
  "kind",
  "language",
  "locale",
  "namespace",
  "protectorFingerprint",
  "protectorVersion",
  "schemaVersion",
  "sourceHash",
] as const;

const candidateRootKeys = [...worklistRootKeys, "draftModel"] as const;
const entryKeys = ["existingCandidate", "key", "reasons", "source", "value"] as const;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = validateTranslationRepairCandidateDirectories(args);
    if (!report.ok) {
      console.error(
        JSON.stringify(
          {
            event: "translation_repair_candidate_qa_failed",
            ...report,
            issues: report.issues.slice(0, 200),
            omittedIssues: Math.max(0, report.issues.length - 200),
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    } else {
      console.log(
        JSON.stringify({ event: "translation_repair_candidate_qa_passed", ...report }),
      );
    }
  } catch (error: unknown) {
    console.error(
      JSON.stringify(
        {
          event: "translation_repair_candidate_qa_error",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

export function validateTranslationRepairCandidateDirectories(
  args: CandidateQaArgs,
): TranslationCandidateQaReport {
  const worklistDir = resolve(args.worklistDir);
  const candidateDir = resolve(args.candidateDir);
  if (worklistDir === candidateDir) {
    throw new Error("Worklist and candidate directories must be different.");
  }
  const worklistFiles = collectStrictJsonFiles(worklistDir, "Worklist directory");
  const candidateFiles = collectStrictJsonFiles(candidateDir, "Candidate directory");
  if (!worklistFiles.length) throw new Error(`Worklist directory is empty: ${worklistDir}.`);

  const worklists = new Map<string, TranslationRepairWorklist>();
  for (const file of worklistFiles) {
    const relativePath = relativeJsonPath(worklistDir, file);
    worklists.set(relativePath, parseWorklist(file, relativePath));
  }

  const candidates = new Map<string, TranslationRepairCandidate>();
  for (const file of candidateFiles) {
    const relativePath = relativeJsonPath(candidateDir, file);
    candidates.set(relativePath, parseCandidate(file, relativePath));
  }

  const issues: TranslationCandidateQaIssue[] = [];
  for (const relativePath of worklists.keys()) {
    if (!candidates.has(relativePath)) issues.push({ code: "missing-candidate-file", relativePath });
  }
  for (const relativePath of candidates.keys()) {
    if (!worklists.has(relativePath)) issues.push({ code: "unexpected-candidate-file", relativePath });
  }

  const draftModels = Array.from(new Set(candidates.values().map((entry) => entry.draftModel))).sort();
  const expectedDraftModel = draftModels[0] ?? null;
  if (expectedDraftModel && draftModels.length > 1) {
    for (const candidate of candidates.values()) {
      if (candidate.draftModel !== expectedDraftModel) {
        issues.push({
          code: "mixed-draft-model",
          relativePath: candidate.relativePath,
          draftModel: candidate.draftModel,
          expectedDraftModel,
        });
      }
    }
  }

  let checkedFiles = 0;
  let checkedFields = 0;
  for (const [relativePath, worklist] of worklists) {
    const candidate = candidates.get(relativePath);
    if (!candidate) continue;
    assertCandidateIdentity(worklist, candidate);
    checkedFiles += 1;
    checkedFields += worklist.entries.length;
    for (let index = 0; index < worklist.entries.length; index += 1) {
      const worklistEntry = worklist.entries[index];
      const candidateEntry = candidate.entries[index];
      assertCandidateEntryIdentity(worklist, worklistEntry, candidateEntry, index);
      const quality = validateTranslationCandidateField({
        language: worklist.language,
        source: worklistEntry.source,
        value: candidateEntry.value,
      });
      if (quality.failures.length) {
        issues.push({
          code: "candidate-field",
          relativePath,
          language: worklist.language,
          namespace: worklist.namespace,
          key: worklistEntry.key,
          failures: quality.failures,
          sourceNegationMarkers: quality.sourceNegationMarkers,
        });
      }
    }
  }

  issues.sort(compareIssues);
  return {
    ok: issues.length === 0,
    worklistDir,
    candidateDir,
    worklistFiles: worklistFiles.length,
    candidateFiles: candidateFiles.length,
    checkedFiles,
    checkedFields,
    draftModel: draftModels.length === 1 ? draftModels[0] : null,
    issues,
  };
}

function parseWorklist(file: string, relativePath: string): TranslationRepairWorklist {
  const raw = parseJsonRecord(file);
  assertExactKeys(raw, worklistRootKeys, `worklist root ${relativePath}`);
  if (
    raw.schemaVersion !== 1 ||
    raw.kind !== "translation-repair-worklist" ||
    typeof raw.protectorVersion !== "string" ||
    !raw.protectorVersion.trim() ||
    typeof raw.protectorFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.protectorFingerprint) ||
    typeof raw.namespace !== "string" ||
    !raw.namespace.trim() ||
    typeof raw.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.sourceHash) ||
    !Array.isArray(raw.entries)
  ) {
    throw new Error(`Invalid worklist metadata in ${relativePath}.`);
  }
  const language = parseTargetLanguage(raw.language, relativePath);
  const locale = parseLocale(raw.locale, language, relativePath);
  assertCanonicalRelativePath(relativePath, locale, raw.namespace);
  const entries = raw.entries.map((entry, index) =>
    parseWorklistEntry(entry, relativePath, index, true),
  );
  assertUniqueEntryKeys(entries, relativePath);
  if (!entries.length) throw new Error(`Worklist has no entries in ${relativePath}.`);
  return {
    relativePath,
    protectorVersion: raw.protectorVersion,
    protectorFingerprint: raw.protectorFingerprint,
    language,
    locale,
    namespace: raw.namespace,
    sourceHash: raw.sourceHash,
    entries,
  };
}

function parseCandidate(file: string, relativePath: string): TranslationRepairCandidate {
  const raw = parseJsonRecord(file);
  assertExactKeys(raw, candidateRootKeys, `candidate root ${relativePath}`);
  if (
    raw.schemaVersion !== 1 ||
    raw.kind !== "translation-repair-candidate" ||
    typeof raw.draftModel !== "string" ||
    !raw.draftModel.trim() ||
    typeof raw.protectorVersion !== "string" ||
    !raw.protectorVersion.trim() ||
    typeof raw.protectorFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.protectorFingerprint) ||
    typeof raw.namespace !== "string" ||
    !raw.namespace.trim() ||
    typeof raw.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.sourceHash) ||
    !Array.isArray(raw.entries)
  ) {
    throw new Error(`Invalid candidate metadata in ${relativePath}.`);
  }
  const language = parseTargetLanguage(raw.language, relativePath);
  const locale = parseLocale(raw.locale, language, relativePath);
  assertCanonicalRelativePath(relativePath, locale, raw.namespace);
  const entries = raw.entries.map((entry, index) => {
    const base = parseWorklistEntry(entry, relativePath, index, false);
    if (!isRecord(entry) || typeof entry.value !== "string") {
      throw new Error(`Invalid candidate value at ${relativePath} entry ${index}.`);
    }
    return { ...base, value: entry.value };
  });
  assertUniqueEntryKeys(entries, relativePath);
  if (!entries.length) throw new Error(`Candidate has no entries in ${relativePath}.`);
  return {
    relativePath,
    draftModel: raw.draftModel,
    protectorVersion: raw.protectorVersion,
    protectorFingerprint: raw.protectorFingerprint,
    language,
    locale,
    namespace: raw.namespace,
    sourceHash: raw.sourceHash,
    entries,
  };
}

function parseWorklistEntry(
  value: unknown,
  relativePath: string,
  index: number,
  requireEmptyValue: boolean,
): WorklistEntry {
  if (!isRecord(value)) throw new Error(`Invalid entry at ${relativePath} entry ${index}.`);
  assertExactKeys(value, entryKeys, `${relativePath} entry ${index}`);
  if (
    typeof value.key !== "string" ||
    !value.key.trim() ||
    typeof value.source !== "string" ||
    !value.source.trim() ||
    (value.existingCandidate !== null && typeof value.existingCandidate !== "string") ||
    !Array.isArray(value.reasons) ||
    !value.reasons.length ||
    value.reasons.some((reason) => typeof reason !== "string" || !reason.trim()) ||
    typeof value.value !== "string" ||
    (requireEmptyValue && value.value !== "")
  ) {
    throw new Error(`Invalid entry metadata at ${relativePath} entry ${index}.`);
  }
  const reasons = value.reasons.map((reason) => {
    if (typeof reason !== "string") throw new Error(`Invalid reason at ${relativePath} entry ${index}.`);
    return reason;
  });
  const canonicalReasons = Array.from(new Set(reasons)).sort();
  if (
    canonicalReasons.length !== reasons.length ||
    canonicalReasons.some((reason, reasonIndex) => reason !== reasons[reasonIndex])
  ) {
    throw new Error(`Reasons must be sorted and unique at ${relativePath} entry ${index}.`);
  }
  return {
    key: value.key,
    source: value.source,
    existingCandidate: value.existingCandidate,
    reasons,
  };
}

function assertCandidateIdentity(
  worklist: TranslationRepairWorklist,
  candidate: TranslationRepairCandidate,
) {
  const mismatches: string[] = [];
  if (candidate.protectorVersion !== worklist.protectorVersion) mismatches.push("protectorVersion");
  if (candidate.protectorFingerprint !== worklist.protectorFingerprint) mismatches.push("protectorFingerprint");
  if (candidate.language !== worklist.language) mismatches.push("language");
  if (candidate.locale !== worklist.locale) mismatches.push("locale");
  if (candidate.namespace !== worklist.namespace) mismatches.push("namespace");
  if (candidate.sourceHash !== worklist.sourceHash) mismatches.push("sourceHash");
  if (candidate.entries.length !== worklist.entries.length) mismatches.push("entries.length");
  if (mismatches.length) {
    throw new Error(
      `Candidate identity mismatch in ${worklist.relativePath}: ${mismatches.join(", ")}.`,
    );
  }
}

function assertCandidateEntryIdentity(
  worklist: TranslationRepairWorklist,
  worklistEntry: WorklistEntry,
  candidateEntry: CandidateEntry | undefined,
  index: number,
) {
  if (!candidateEntry) {
    throw new Error(`Candidate entry missing in ${worklist.relativePath} at index ${index}.`);
  }
  const mismatches: string[] = [];
  if (candidateEntry.key !== worklistEntry.key) mismatches.push("key");
  if (candidateEntry.source !== worklistEntry.source) mismatches.push("source");
  if (candidateEntry.existingCandidate !== worklistEntry.existingCandidate) {
    mismatches.push("existingCandidate");
  }
  if (!sameStringArray(candidateEntry.reasons, worklistEntry.reasons)) mismatches.push("reasons");
  if (mismatches.length) {
    throw new Error(
      `Candidate entry identity mismatch in ${worklist.relativePath} at index ${index}: ${mismatches.join(", ")}.`,
    );
  }
}

function parseTargetLanguage(value: unknown, relativePath: string) {
  const language = normalizeLanguage(value);
  if (language === defaultLanguage || language !== value) {
    throw new Error(`Invalid target language in ${relativePath}: ${String(value)}.`);
  }
  return language;
}

function parseLocale(
  value: unknown,
  language: TranslationCandidateTargetLanguage,
  relativePath: string,
) {
  if (typeof value !== "string" || value !== languageConfigs[language].locale) {
    throw new Error(`Locale does not match ${language} in ${relativePath}.`);
  }
  return value;
}

function assertCanonicalRelativePath(relativePath: string, locale: string, namespace: string) {
  const expected = `${locale}/${fileSafeNamespace(namespace)}.json`;
  if (relativePath !== expected) {
    throw new Error(`Non-canonical translation repair path ${relativePath}; expected ${expected}.`);
  }
}

function assertUniqueEntryKeys(entries: readonly WorklistEntry[], relativePath: string) {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (keys.has(entry.key)) throw new Error(`Duplicate entry key ${entry.key} in ${relativePath}.`);
    keys.add(entry.key);
  }
}

function collectStrictJsonFiles(root: string, label: string) {
  const stats = lstatSync(root, { throwIfNoEntry: false });
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${root}.`);
  }
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${path}.`);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        throw new Error(`${label} contains an unexpected file: ${path}.`);
      }
      files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function relativeJsonPath(root: string, file: string) {
  return relative(root, file).split(sep).join("/");
}

function parseJsonRecord(file: string) {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (!isRecord(value)) throw new Error(`Expected a JSON object in ${file}.`);
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
) {
  const expected = [...expectedKeys].sort();
  const actual = Object.keys(value).sort();
  if (!sameStringArray(actual, expected)) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((key) => !actualSet.has(key));
    const unexpected = actual.filter((key) => !expectedSet.has(key));
    throw new Error(
      `Invalid ${label} keys: missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}.`,
    );
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fileSafeNamespace(namespace: string) {
  return namespace.replace(/[^a-z0-9.-]+/gi, "__");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareIssues(left: TranslationCandidateQaIssue, right: TranslationCandidateQaIssue) {
  return (
    left.relativePath.localeCompare(right.relativePath) ||
    left.code.localeCompare(right.code) ||
    (left.code === "candidate-field" ? left.key : "").localeCompare(
      right.code === "candidate-field" ? right.key : "",
    )
  );
}

function parseArgs(rawArgs: string[]): CandidateQaArgs {
  let worklistDir: string | null = null;
  let candidateDir: string | null = null;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (argument === "--worklist-dir") {
      worklistDir = rawArgs[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith("--worklist-dir=")) {
      worklistDir = argument.slice(15);
    } else if (argument === "--candidate-dir") {
      candidateDir = rawArgs[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith("--candidate-dir=")) {
      candidateDir = argument.slice(16);
    } else {
      throw new Error(`Unknown candidate QA argument: ${argument}.`);
    }
  }
  if (!worklistDir || !candidateDir) {
    throw new Error("Pass --worklist-dir=<directory> and --candidate-dir=<directory>.");
  }
  return { worklistDir, candidateDir };
}
