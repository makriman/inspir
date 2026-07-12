import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  canonicalJsonSha256,
  exportHybridTranslationRepairSubset,
  mergeHybridTranslationRepairCandidates,
  requiredHighQualityRoutingReason,
  validateHybridTranslationCandidateManifest,
} from "../scripts/compose-hybrid-translation-candidates";
import { validateTranslationRepairCandidateDirectories } from "../scripts/validate-translation-repair-candidates";

const sourceHash = "a".repeat(64);
const protectorFingerprint = "b".repeat(64);

test("canonical JSON uses locale-independent Unicode code-point ordering", () => {
  const value = {
    "\u{10000}": 4,
    "\ue000": 3,
    "profile.details.saved": 2,
    "profile.details.saveError": 1,
  };
  const expected =
    '{"profile.details.saveError":1,"profile.details.saved":2,"\ue000":3,"\u{10000}":4}';
  assert.equal(
    canonicalJsonSha256(value),
    createHash("sha256").update(expected).digest("hex"),
  );
});

test("high-quality routing covers the exact forced language and namespace sets", () => {
  for (const language of ["Arabic", "Spanish", "Hindi"]) {
    assert.equal(
      requiredHighQualityRoutingReason(language, "main-app"),
      "core-main-app-high-quality-pass",
    );
  }
  for (const language of ["Arabic", "Spanish", "Hindi", "Malayalam"]) {
    assert.equal(
      requiredHighQualityRoutingReason(language, "legal:privacy"),
      "legal-high-quality-pass",
    );
  }
  assert.equal(requiredHighQualityRoutingReason("Malayalam", "main-app"), null);
  assert.equal(requiredHighQualityRoutingReason("French", "legal:privacy"), null);
  assert.equal(requiredHighQualityRoutingReason("Spanish", "route:home"), null);
});

test("subset export fails closed unless every forced field carries its routing reason", () => {
  const root = path.resolve("tmp", `hybrid-composer-forced-${process.pid}-${randomUUID()}`);
  const worklistDir = path.join(root, "worklists");
  const primaryDir = path.join(root, "primary");
  const subsetDir = path.join(root, "subset");
  const auditPath = path.join(root, "audit.json");
  const manifestPath = path.join(root, "selection.json");
  const entry = makeEntry("site.forced", "Keep learning.", "Sigue aprendiendo.");
  const worklist = { ...makeWorklist([entry]), namespace: "main-app" };
  const candidate = { ...makeCandidate(worklist, [entry], "nllb-1.3b-local-beam1"), namespace: "main-app" };
  const auditEntry = {
    file: "es/main-app.json",
    locale: "es",
    language: "Spanish",
    namespace: "main-app",
    key: entry.key,
    source: entry.source,
    existingCandidate: entry.existingCandidate,
    value: entry.value,
    sourceWordCount: 2,
    candidateSimilarity: 0.9,
    existingSimilarity: 0.9,
    similarityDelta: 0,
    sourceNumbers: {},
    valueNumbers: {},
    reasons: ["low-cross-lingual-similarity"],
  };
  const writeForcedAudit = (reasons: string[]) =>
    writeJson(auditPath, {
      schemaVersion: 1,
      kind: "translation-labse-audit",
      worklists: worklistDir,
      candidates: primaryDir,
      fields: 1,
      uniqueSources: 1,
      uniqueCandidates: 1,
      uniqueExistingCandidates: 1,
      flagged: 1,
      byReason: Object.fromEntries(reasons.map((reason) => [reason, 1])),
      entries: [{ ...auditEntry, reasons }],
    });

  try {
    writeJson(path.join(worklistDir, "es/main-app.json"), worklist);
    writeJson(path.join(primaryDir, "es/main-app.json"), candidate);
    writeForcedAudit(["low-cross-lingual-similarity"]);
    assert.throws(
      () =>
        exportHybridTranslationRepairSubset({
          worklistDir,
          primaryCandidateDir: primaryDir,
          semanticAuditPath: auditPath,
          subsetWorklistDir: subsetDir,
          selectionManifestPath: manifestPath,
        }),
      /omitted 1 required high-quality beam-4 route/,
    );
    writeForcedAudit(["core-main-app-high-quality-pass"]);
    const result = exportHybridTranslationRepairSubset({
      worklistDir,
      primaryCandidateDir: primaryDir,
      semanticAuditPath: auditPath,
      subsetWorklistDir: subsetDir,
      selectionManifestPath: manifestPath,
    });
    assert.equal(result.selectedFields, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("subset export rejects stale and duplicate semantic-audit identities", () => {
  const stale = makeFixture("stale-audit");
  try {
    writeAudit(stale, [
      {
        ...semanticEntry(stale, "site.semantic"),
        value: "Una traducción que ya no coincide.",
      },
    ]);
    assert.throws(
      () => exportSubset(stale),
      /LaBSE audit identity is stale/,
    );
    assert.equal(fs.existsSync(stale.subsetDir), false);
    assert.equal(fs.existsSync(stale.selectionManifest), false);
  } finally {
    fs.rmSync(stale.root, { recursive: true, force: true });
  }

  const duplicate = makeFixture("duplicate-audit");
  try {
    const entry = semanticEntry(duplicate, "site.semantic");
    writeAudit(duplicate, [entry, entry]);
    assert.throws(
      () => exportSubset(duplicate),
      /Duplicate LaBSE audit identity/,
    );
    assert.equal(fs.existsSync(duplicate.subsetDir), false);
  } finally {
    fs.rmSync(duplicate.root, { recursive: true, force: true });
  }
});

test("subset export cannot bypass exact candidate root and entry ordering", () => {
  const fixture = makeFixture("structural-bypass");
  try {
    const candidateFile = path.join(fixture.primaryDir, "es/route__home.json");
    const candidate = readRecord(candidateFile);
    const entries = requireArray(candidate.entries).map((entry) => {
      const record = requireRecord(entry);
      return {
        source: record.source,
        key: record.key,
        existingCandidate: record.existingCandidate,
        reasons: record.reasons,
        value: record.value,
      };
    });
    writeJson(candidateFile, { ...candidate, entries });
    writeAudit(fixture, [semanticEntry(fixture, "site.semantic")]);

    assert.throws(
      () => exportSubset(fixture),
      /Invalid repair entry .* key order/,
    );
    assert.equal(fs.existsSync(fixture.subsetDir), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("subset export includes every deterministic failure and exact semantic flag", () => {
  const fixture = makeFixture("complete-selection");
  try {
    writeAudit(fixture, [semanticEntry(fixture, "site.semantic")]);
    const result = exportSubset(fixture);
    assert.deepEqual(
      {
        selectedFiles: result.selectedFiles,
        selectedFields: result.selectedFields,
        deterministicFields: result.deterministicFields,
        semanticFields: result.semanticFields,
        overlapFields: result.overlapFields,
      },
      {
        selectedFiles: 1,
        selectedFields: 2,
        deterministicFields: 1,
        semanticFields: 1,
        overlapFields: 0,
      },
    );
    const subset = readRecord(path.join(fixture.subsetDir, "es/route__home.json"));
    assert.deepEqual(
      requireArray(subset.entries).map((entry) => requireRecord(entry).key),
      ["site.deterministic", "site.semantic"],
    );
    const selection = readRecord(fixture.selectionManifest);
    const identities = requireArray(selection.identities).map(requireRecord);
    assert.deepEqual(identities[0]?.deterministicFailures, ["negation-marker-missing"]);
    assert.deepEqual(identities[0]?.semanticReasons, []);
    assert.deepEqual(identities[1]?.deterministicFailures, []);
    assert.deepEqual(identities[1]?.semanticReasons, ["low-cross-lingual-similarity"]);
    assert.equal(fs.statSync(fixture.selectionManifest).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("subset export accepts code-point-sorted mixed-case prefix audit keys", () => {
  const fixture = makeFixture("code-point-order");
  const worklistPath = path.join(fixture.worklistDir, "es/route__home.json");
  const candidatePath = path.join(fixture.primaryDir, "es/route__home.json");
  try {
    for (const documentPath of [worklistPath, candidatePath]) {
      const document = readRecord(documentPath);
      const entries = requireArray(document.entries).map((entry, index) => {
        const record = requireRecord(entry);
        if (index === 0) return { ...record, key: "profile.details.saveError" };
        if (index === 1) return { ...record, key: "profile.details.saved" };
        return record;
      });
      writeJson(documentPath, { ...document, entries });
    }
    const saveError = semanticEntry(fixture, "profile.details.saveError");
    const saved = semanticEntry(fixture, "profile.details.saved");
    writeAudit(fixture, [saved, saveError]);
    assert.throws(
      () => exportSubset(fixture),
      /LaBSE audit entries are not in canonical file\/key order/,
    );
    assert.equal(fs.existsSync(fixture.subsetDir), false);
    assert.equal(fs.existsSync(fixture.selectionManifest), false);

    writeAudit(fixture, [saveError, saved]);

    const result = exportSubset(fixture);
    assert.equal(result.selectedFields, 2);
    const selection = readRecord(fixture.selectionManifest);
    assert.deepEqual(
      requireArray(selection.identities).map((identity) => requireRecord(identity).key),
      ["profile.details.saveError", "profile.details.saved"],
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("merge replaces only exact selected values, preserves inputs, and emits a validated uniform tree", () => {
  const fixture = makeFixture("exact-merge");
  try {
    writeAudit(fixture, [semanticEntry(fixture, "site.semantic")]);
    exportSubset(fixture);
    writeBeamCandidates(fixture, {
      "site.deterministic": "No te detengas.",
      "site.semantic": "Selecciona la respuesta más adecuada.",
    });
    const inputFiles = [
      path.join(fixture.worklistDir, "es/route__home.json"),
      path.join(fixture.primaryDir, "es/route__home.json"),
      path.join(fixture.subsetDir, "es/route__home.json"),
      path.join(fixture.beamDir, "es/route__home.json"),
      fixture.auditPath,
      fixture.selectionManifest,
    ];
    const before = new Map(inputFiles.map((file) => [file, fs.readFileSync(file)]));

    const result = mergeFixture(fixture);
    assert.equal(result.replacedFields, 2);
    assert.equal(result.files, 1);
    assert.equal(result.fields, 3);
    assert.equal(result.draftModel, "nllb-1.3b-local-beam1+beam4-qa-v1");
    const output = readRecord(path.join(fixture.outputDir, "es/route__home.json"));
    const outputEntries = requireArray(output.entries).map(requireRecord);
    assert.deepEqual(
      outputEntries.map((entry) => entry.value),
      [
        "No te detengas.",
        "Selecciona la respuesta más adecuada.",
        "Sigue aprendiendo.",
      ],
    );
    assert.equal(output.draftModel, "nllb-1.3b-local-beam1+beam4-qa-v1");
    assert.deepEqual(Object.keys(output), [
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
    ]);
    const qa = validateTranslationRepairCandidateDirectories({
      worklistDir: fixture.worklistDir,
      candidateDir: fixture.outputDir,
    });
    assert.equal(qa.ok, true);
    assert.equal(qa.draftModel, "nllb-1.3b-local-beam1+beam4-qa-v1");
    for (const [file, contents] of before) assert.deepEqual(fs.readFileSync(file), contents, file);
    assert.equal(fs.statSync(fixture.hybridManifest).mode & 0o777, 0o600);
    const manifest = readRecord(fixture.hybridManifest);
    assert.equal(manifest.kind, "translation-hybrid-candidate-manifest");
    assert.match(String(manifest.canonicalSha256), /^[a-f0-9]{64}$/);
    const manifestIdentities = requireArray(manifest.identities).map(requireRecord);
    assert.deepEqual(
      manifestIdentities.map((entry) => entry.key),
      ["site.deterministic", "site.semantic"],
    );
    assert.notEqual(
      manifestIdentities[0]?.primaryValueSha256,
      manifestIdentities[0]?.beam4ValueSha256,
    );
    assert.deepEqual(
      validateHybridTranslationCandidateManifest({
        worklistDir: fixture.worklistDir,
        candidateDir: fixture.outputDir,
        manifestPath: fixture.hybridManifest,
      }),
      {
        manifestPath: fixture.hybridManifest,
        worklistDir: fixture.worklistDir,
        candidateDir: fixture.outputDir,
        files: 1,
        fields: 3,
        replacedFields: 2,
        draftModel: "nllb-1.3b-local-beam1+beam4-qa-v1",
        canonicalSha256: manifest.canonicalSha256,
      },
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("hybrid manifest validation rejects byte-only and canonical candidate drift", () => {
  const fixture = makeMergedFixture("candidate-drift");
  const candidatePath = path.join(fixture.outputDir, "es/route__home.json");
  try {
    const original = fs.readFileSync(candidatePath, "utf8");
    fs.writeFileSync(candidatePath, JSON.stringify(JSON.parse(original)));
    assert.throws(
      () => validateFixtureManifest(fixture),
      /Hybrid candidate manifest output candidate tree is stale or tampered/,
    );

    fs.writeFileSync(candidatePath, original);
    const candidate = readRecord(candidatePath);
    const entries = requireArray(candidate.entries).map((entry) => {
      const record = requireRecord(entry);
      return record.key === "site.untouched"
        ? { ...record, value: "Continúa aprendiendo." }
        : record;
    });
    writeJson(candidatePath, { ...candidate, entries });
    assert.throws(
      () => validateFixtureManifest(fixture),
      /Hybrid candidate manifest output candidate tree is stale or tampered/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("hybrid manifest validation rejects internally re-fingerprinted count tampering", () => {
  const fixture = makeMergedFixture("manifest-count-tamper");
  try {
    const manifest = readRecord(fixture.hybridManifest);
    const counts = requireRecord(manifest.counts);
    assert.equal(typeof manifest.canonicalSha256, "string");
    const manifestWithoutFingerprint = Object.fromEntries(
      Object.entries({
        ...manifest,
        counts: {
          ...counts,
          replacedFields: Number(counts.replacedFields) + 1,
        },
      }).filter(([key]) => key !== "canonicalSha256"),
    );
    writeJson(fixture.hybridManifest, {
      ...manifestWithoutFingerprint,
      canonicalSha256: canonicalJsonSha256(manifestWithoutFingerprint),
    });
    assert.throws(
      () => validateFixtureManifest(fixture),
      /Hybrid candidate manifest counts is stale or tampered/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("hybrid manifest validation binds exact worklist and output tree paths", () => {
  const fixture = makeMergedFixture("wrong-tree-paths");
  const copiedWorklists = path.join(fixture.root, "copied-worklists");
  const copiedCandidates = path.join(fixture.root, "copied-candidates");
  try {
    fs.cpSync(fixture.worklistDir, copiedWorklists, { recursive: true });
    assert.throws(
      () =>
        validateHybridTranslationCandidateManifest({
          worklistDir: copiedWorklists,
          candidateDir: fixture.outputDir,
          manifestPath: fixture.hybridManifest,
        }),
      /Hybrid candidate manifest provenance is stale or tampered/,
    );

    fs.cpSync(fixture.outputDir, copiedCandidates, { recursive: true });
    assert.throws(
      () =>
        validateHybridTranslationCandidateManifest({
          worklistDir: fixture.worklistDir,
          candidateDir: copiedCandidates,
          manifestPath: fixture.hybridManifest,
        }),
      /Hybrid candidate manifest output candidate tree is stale or tampered/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("hybrid manifest validation rejects missing, nonregular, and symlinked inputs", () => {
  const fixture = makeMergedFixture("unsafe-inputs");
  try {
    assert.throws(
      () =>
        validateHybridTranslationCandidateManifest({
          worklistDir: fixture.worklistDir,
          candidateDir: fixture.outputDir,
          manifestPath: path.join(fixture.root, "missing-manifest.json"),
        }),
      /Hybrid candidate manifest must be a real file/,
    );

    const directoryManifest = path.join(fixture.root, "directory-manifest.json");
    fs.mkdirSync(directoryManifest);
    assert.throws(
      () =>
        validateHybridTranslationCandidateManifest({
          worklistDir: fixture.worklistDir,
          candidateDir: fixture.outputDir,
          manifestPath: directoryManifest,
        }),
      /Hybrid candidate manifest must be a real file/,
    );

    const candidatePath = path.join(fixture.outputDir, "es/route__home.json");
    const candidateBackingPath = path.join(fixture.root, "candidate-backing.json");
    fs.renameSync(candidatePath, candidateBackingPath);
    fs.symlinkSync(candidateBackingPath, candidatePath);
    assert.throws(
      () => validateFixtureManifest(fixture),
      /symbolic link|real file/i,
    );

    fs.rmSync(candidatePath, { force: true });
    fs.renameSync(candidateBackingPath, candidatePath);
    const realParent = path.join(fixture.root, "real-candidate-parent");
    const linkedParent = path.join(fixture.root, "linked-candidate-parent");
    fs.mkdirSync(realParent);
    fs.cpSync(fixture.outputDir, path.join(realParent, "candidates"), {
      recursive: true,
    });
    fs.symlinkSync(realParent, linkedParent);
    assert.throws(
      () =>
        validateHybridTranslationCandidateManifest({
          worklistDir: fixture.worklistDir,
          candidateDir: path.join(linkedParent, "candidates"),
          manifestPath: fixture.hybridManifest,
        }),
      /parent contains a symbolic link/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("merge fails closed before output when a selected beam candidate retains a field defect", () => {
  const fixture = makeFixture("final-validation");
  try {
    writeAudit(fixture, [semanticEntry(fixture, "site.semantic")]);
    exportSubset(fixture);
    writeBeamCandidates(fixture, {
      "site.deterministic": "Detente.",
      "site.semantic": "Selecciona la respuesta más adecuada.",
    });
    assert.throws(
      () => mergeFixture(fixture),
      /Beam-4 subset candidates failed exact structural and field QA/,
    );
    assert.equal(fs.existsSync(fixture.outputDir), false);
    assert.equal(fs.existsSync(fixture.hybridManifest), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("schema v2 merge requires and transitively validates a bound composition manifest", () => {
  const legacyFixture = makeFixture("v2-requires-composition");
  try {
    assert.throws(
      () =>
        mergeHybridTranslationRepairCandidates({
          worklistDir: legacyFixture.worklistDir,
          primaryCandidateDir: legacyFixture.primaryDir,
          subsetWorklistDir: legacyFixture.subsetDir,
          beam4CandidateDir: legacyFixture.beamDir,
          selectionManifestPath: legacyFixture.selectionManifest,
          outputCandidateDir: legacyFixture.outputDir,
          hybridDraftModel:
            "nllb-1.3B-local-primary-beam1+mixed-v3-selected-subset",
          manifestPath: legacyFixture.hybridManifest,
          manifestSchemaVersion: 2,
        }),
      /schemaVersion 2 requires --composition-manifest/,
    );
  } finally {
    fs.rmSync(legacyFixture.root, { recursive: true, force: true });
  }

  const fixture = makeV3Fixture("v2-valid", "مدرب AI");
  try {
    const result = mergeV3Fixture(fixture);
    assert.equal(result.replacedFields, 1);
    assert.match(String(result.compositionCanonicalSha256), /^[a-f0-9]{64}$/);
    const manifest = readRecord(fixture.hybridManifest);
    assert.equal(manifest.schemaVersion, 2);
    const provenance = requireRecord(manifest.provenance);
    assert.deepEqual(Object.keys(provenance), [
      "selectionManifestPath",
      "selectionManifestSha256",
      "worklist",
      "primary",
      "subset",
      "beam4",
      "composition",
    ]);
    const validation = validateV3FixtureManifest(fixture);
    assert.equal(validation.composition?.decisions, 1);
    assert.equal(validation.composition?.corrections, 1);
    assert.equal(validation.composition?.preserves, 0);
    assert.equal(
      validation.composition?.canonicalSha256,
      readRecord(fixture.compositionManifest).canonicalSha256,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("v3 semantic acceptance rejects the Arabic AI tutor truncation", () => {
  const fixture = makeV3Fixture("arabic-ai-tutor-regression", "معلم");
  try {
    assert.throws(
      () => mergeV3Fixture(fixture),
      /omits required term AI/,
    );
    assert.equal(fs.existsSync(fixture.outputDir), false);
    assert.equal(fs.existsSync(fixture.hybridManifest), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("v2 validation rejects byte drift, symlinks, and internally re-fingerprinted composition lies", () => {
  const byteDrift = makeV3Fixture("v2-byte-drift", "مدرب AI");
  try {
    mergeV3Fixture(byteDrift);
    fs.appendFileSync(byteDrift.compositionManifest, "\n");
    assert.throws(
      () => validateV3FixtureManifest(byteDrift),
      /composition manifest descriptor is stale or tampered/i,
    );
  } finally {
    fs.rmSync(byteDrift.root, { recursive: true, force: true });
  }

  const symlink = makeV3Fixture("v2-symlink", "مدرب AI");
  try {
    mergeV3Fixture(symlink);
    const backing = `${symlink.compositionManifest}.backing`;
    fs.renameSync(symlink.compositionManifest, backing);
    fs.symlinkSync(backing, symlink.compositionManifest);
    assert.throws(
      () => validateV3FixtureManifest(symlink),
      /symbolic link|real file/i,
    );
  } finally {
    fs.rmSync(symlink.root, { recursive: true, force: true });
  }

  const refingerprinted = makeV3Fixture("v2-refingerprinted-lie", "مدرب AI");
  try {
    mergeV3Fixture(refingerprinted);
    rewriteSelfFingerprintedJson(refingerprinted.compositionManifest, (manifest) => {
      const decisions = requireArray(manifest.decisions).map(requireRecord);
      return {
        ...manifest,
        decisions: decisions.map((decision, index) =>
          index === 0 ? { ...decision, baseValueSha256: "0".repeat(64) } : decision,
        ),
      };
    });
    rebindCompositionDescriptor(refingerprinted);
    assert.throws(
      () => validateV3FixtureManifest(refingerprinted),
      /value provenance is stale/,
    );
  } finally {
    fs.rmSync(refingerprinted.root, { recursive: true, force: true });
  }
});

test("v2 validation binds every cited semantic evidence file", () => {
  const fixture = makeV3Fixture("v2-semantic-evidence-drift", "مدرب AI");
  try {
    mergeV3Fixture(fixture);
    fs.appendFileSync(fixture.semanticEvidence, "drift");
    assert.throws(
      () => validateV3FixtureManifest(fixture),
      /semantic evidence .* descriptor is stale/i,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("v2 validation result exposes composition byte drift to the apply write-boundary guard", () => {
  const fixture = makeV3Fixture("v2-write-boundary-drift", "مدرب AI");
  try {
    mergeV3Fixture(fixture);
    const before = validateV3FixtureManifest(fixture);
    const composition = readRecord(fixture.compositionManifest);
    fs.writeFileSync(fixture.compositionManifest, `${JSON.stringify(composition)}\n`);
    rebindCompositionDescriptor(fixture);
    const after = validateV3FixtureManifest(fixture);
    assert.notDeepEqual(after, before);
    assert.notEqual(
      after.composition?.byteSha256,
      before.composition?.byteSha256,
    );
    assert.equal(
      after.composition?.canonicalSha256,
      before.composition?.canonicalSha256,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

type Fixture = ReturnType<typeof makeFixture>;

function makeMergedFixture(label: string) {
  const fixture = makeFixture(label);
  writeAudit(fixture, [semanticEntry(fixture, "site.semantic")]);
  exportSubset(fixture);
  writeBeamCandidates(fixture, {
    "site.deterministic": "No te detengas.",
    "site.semantic": "Selecciona la respuesta más adecuada.",
  });
  mergeFixture(fixture);
  return fixture;
}

function validateFixtureManifest(fixture: Fixture) {
  return validateHybridTranslationCandidateManifest({
    worklistDir: fixture.worklistDir,
    candidateDir: fixture.outputDir,
    manifestPath: fixture.hybridManifest,
  });
}

function makeFixture(label: string) {
  const root = path.resolve("tmp", `hybrid-composer-${label}-${process.pid}-${randomUUID()}`);
  const worklistDir = path.join(root, "worklists");
  const primaryDir = path.join(root, "primary");
  const subsetDir = path.join(root, "subset-worklists");
  const beamDir = path.join(root, "beam4-candidates");
  const outputDir = path.join(root, "hybrid-candidates");
  const auditPath = path.join(root, "labse-audit.json");
  const selectionManifest = path.join(root, "selection-manifest.json");
  const hybridManifest = path.join(root, "hybrid-manifest.json");
  const entries = [
    makeEntry("site.deterministic", "Do not stop.", "Detente."),
    makeEntry("site.semantic", "Choose the best answer.", "Elige la mejor respuesta."),
    makeEntry("site.untouched", "Keep learning.", "Sigue aprendiendo."),
  ];
  const worklist = makeWorklist(entries);
  const primary = makeCandidate(worklist, entries, "nllb-1.3b-local-beam1");
  writeJson(path.join(worklistDir, "es/route__home.json"), worklist);
  writeJson(path.join(primaryDir, "es/route__home.json"), primary);
  return {
    root,
    worklistDir,
    primaryDir,
    subsetDir,
    beamDir,
    outputDir,
    auditPath,
    selectionManifest,
    hybridManifest,
  };
}

type FixtureEntry = {
  key: string;
  source: string;
  existingCandidate: string | null;
  reasons: string[];
  value: string;
};

function makeEntry(key: string, source: string, value: string): FixtureEntry {
  return {
    key,
    source,
    existingCandidate: null,
    reasons: ["quality-review"],
    value,
  };
}

function makeWorklist(entries: FixtureEntry[]) {
  return {
    schemaVersion: 1,
    kind: "translation-repair-worklist",
    protectorVersion: "literal-protector-v2",
    protectorFingerprint,
    language: "Spanish",
    locale: "es",
    namespace: "route:home",
    sourceHash,
    entries: entries.map((entry) => ({ ...entry, value: "" })),
  };
}

function makeCandidate(
  worklist: ReturnType<typeof makeWorklist>,
  entries: FixtureEntry[],
  draftModel: string,
) {
  return {
    schemaVersion: worklist.schemaVersion,
    kind: "translation-repair-candidate",
    protectorVersion: worklist.protectorVersion,
    protectorFingerprint: worklist.protectorFingerprint,
    language: worklist.language,
    locale: worklist.locale,
    namespace: worklist.namespace,
    sourceHash: worklist.sourceHash,
    entries,
    draftModel,
  };
}

function semanticEntry(fixture: Fixture, key: string) {
  const candidate = readRecord(path.join(fixture.primaryDir, "es/route__home.json"));
  const entry = requireArray(candidate.entries)
    .map(requireRecord)
    .find((candidateEntry) => candidateEntry.key === key);
  if (!entry) throw new Error(`Missing semantic fixture entry ${key}.`);
  return {
    file: "es/route__home.json",
    locale: "es",
    language: "Spanish",
    namespace: "route:home",
    key,
    source: entry.source,
    existingCandidate: entry.existingCandidate,
    value: entry.value,
    sourceWordCount: 4,
    candidateSimilarity: 0.5,
    existingSimilarity: 1,
    similarityDelta: -0.5,
    sourceNumbers: {},
    valueNumbers: {},
    reasons: ["low-cross-lingual-similarity"],
  };
}

function writeAudit(fixture: Fixture, entries: ReturnType<typeof semanticEntry>[]) {
  const byReason: Record<string, number> = {};
  for (const entry of entries) {
    for (const reason of entry.reasons) byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  writeJson(fixture.auditPath, {
    schemaVersion: 1,
    kind: "translation-labse-audit",
    worklists: fixture.worklistDir,
    candidates: fixture.primaryDir,
    fields: 3,
    uniqueSources: 3,
    uniqueCandidates: 3,
    uniqueExistingCandidates: 3,
    flagged: entries.length,
    byReason,
    entries,
  });
}

function exportSubset(fixture: Fixture) {
  return exportHybridTranslationRepairSubset({
    worklistDir: fixture.worklistDir,
    primaryCandidateDir: fixture.primaryDir,
    semanticAuditPath: fixture.auditPath,
    subsetWorklistDir: fixture.subsetDir,
    selectionManifestPath: fixture.selectionManifest,
  });
}

function writeBeamCandidates(fixture: Fixture, replacements: Record<string, string>) {
  const subset = readRecord(path.join(fixture.subsetDir, "es/route__home.json"));
  const entries: FixtureEntry[] = requireArray(subset.entries).map((entry) => {
    const record = requireRecord(entry);
    const key = String(record.key);
    const value = replacements[key];
    if (!value) throw new Error(`Missing beam replacement fixture for ${key}.`);
    return {
      key,
      source: String(record.source),
      existingCandidate:
        record.existingCandidate === null ? null : String(record.existingCandidate),
      reasons: requireArray(record.reasons).map(String),
      value,
    };
  });
  writeJson(
    path.join(fixture.beamDir, "es/route__home.json"),
    makeCandidate(
      {
        schemaVersion: 1,
        kind: "translation-repair-worklist",
        protectorVersion: String(subset.protectorVersion),
        protectorFingerprint: String(subset.protectorFingerprint),
        language: String(subset.language),
        locale: String(subset.locale),
        namespace: String(subset.namespace),
        sourceHash: String(subset.sourceHash),
        entries: entries.map((entry) => ({
          key: String(entry.key),
          source: String(entry.source),
          existingCandidate:
            entry.existingCandidate === null ? null : String(entry.existingCandidate),
          reasons: requireArray(entry.reasons).map(String),
          value: "",
        })),
      },
      entries.map((entry) => ({
        key: String(entry.key),
        source: String(entry.source),
        existingCandidate:
          entry.existingCandidate === null ? null : String(entry.existingCandidate),
        reasons: requireArray(entry.reasons).map(String),
        value: String(entry.value),
      })),
      "nllb-1.3b-local-beam4",
    ),
  );
}

function mergeFixture(fixture: Fixture) {
  return mergeHybridTranslationRepairCandidates({
    worklistDir: fixture.worklistDir,
    primaryCandidateDir: fixture.primaryDir,
    subsetWorklistDir: fixture.subsetDir,
    beam4CandidateDir: fixture.beamDir,
    selectionManifestPath: fixture.selectionManifest,
    outputCandidateDir: fixture.outputDir,
    hybridDraftModel: "nllb-1.3b-local-beam1+beam4-qa-v1",
    manifestPath: fixture.hybridManifest,
  });
}

function makeV3Fixture(label: string, finalValue: string) {
  const root = path.resolve("tmp", `hybrid-composer-v3-${label}-${process.pid}-${randomUUID()}`);
  const worklistDir = path.join(root, "worklists");
  const primaryDir = path.join(root, "primary");
  const subsetDir = path.join(root, "subset-worklists");
  const rawV2Dir = path.join(root, "raw-v2");
  const baseDir = path.join(root, "v3-base");
  const reducedDir = path.join(root, "reduced-worklists");
  const correctionsDir = path.join(root, "corrections");
  const beamDir = path.join(root, "v3-final-selected");
  const outputDir = path.join(root, "hybrid-output");
  const relativePath = "ar/blog__ai-art-appreciation-guide.json";
  const key = "site.809d1e1957710315a3";
  const source = "AI tutor";
  const existingCandidate = "مدرب AI";
  const primaryValue = "مدرب الذكاء الاصطناعي";
  const baseValue = "معلم";
  const finalDraftModel =
    "nllb-1.3B-local-mixed-v3-primary-beam1+beam4-v2+beam4or8-corrections+reviewed-preserves";
  const hybridDraftModel =
    "nllb-1.3B-local-primary-beam1+mixed-v3-selected-subset";
  const auditPath = path.join(root, "labse-audit.json");
  const selectionManifest = path.join(root, "selection-manifest.json");
  const checkpointEvidence = path.join(root, "raw-v2-checkpoint.json");
  const baseManifest = path.join(root, "v3-base-manifest.json");
  const baseQaEvidence = path.join(root, "v3-base-qa.json");
  const extrasEvidence = path.join(root, "v3-extra-identities.json");
  const reducedManifest = path.join(root, "v3-reduced-worklist-manifest.json");
  const generator = path.join(root, "v3-correction-generator.ts");
  const semanticEvidence = path.join(root, "v3-semantic-review.txt");
  const semanticManifest = path.join(root, "v3-semantic-acceptance.json");
  const compositionManifest = path.join(root, "v3-composition-manifest.json");
  const hybridManifest = path.join(root, "hybrid-manifest.json");

  const selectedEntry: FixtureEntry = {
    key,
    source,
    existingCandidate,
    reasons: ["quality-review"],
    value: primaryValue,
  };
  const worklist = {
    ...makeWorklist([selectedEntry]),
    language: "Arabic",
    locale: "ar",
    namespace: "blog:ai-art-appreciation-guide",
  };
  const primary = makeCandidate(worklist, [selectedEntry], "nllb-1.3B-local-beam1");
  writeJson(path.join(worklistDir, relativePath), worklist);
  writeJson(path.join(primaryDir, relativePath), primary);
  writeJson(auditPath, {
    schemaVersion: 1,
    kind: "translation-labse-audit",
    worklists: worklistDir,
    candidates: primaryDir,
    fields: 1,
    uniqueSources: 1,
    uniqueCandidates: 1,
    uniqueExistingCandidates: 1,
    flagged: 1,
    byReason: { "low-cross-lingual-similarity": 1 },
    entries: [
      {
        file: relativePath,
        locale: "ar",
        language: "Arabic",
        namespace: "blog:ai-art-appreciation-guide",
        key,
        source,
        existingCandidate,
        value: primaryValue,
        sourceWordCount: 2,
        candidateSimilarity: 0.2,
        existingSimilarity: 0.9,
        similarityDelta: -0.7,
        sourceNumbers: {},
        valueNumbers: {},
        reasons: ["low-cross-lingual-similarity"],
      },
    ],
  });
  exportHybridTranslationRepairSubset({
    worklistDir,
    primaryCandidateDir: primaryDir,
    semanticAuditPath: auditPath,
    subsetWorklistDir: subsetDir,
    selectionManifestPath: selectionManifest,
  });
  const subset = readRecord(path.join(subsetDir, relativePath));
  const candidateFor = (value: string, draftModel: string) =>
    makeCandidateFromRecord(subset, value, draftModel);
  writeJson(path.join(rawV2Dir, relativePath), candidateFor(baseValue, "nllb-1.3B-local-beam4-v2"));
  const baseDraftModel =
    "nllb-1.3B-local-beam4-v2+primary-unadjudicated-primary-fallback-v3-base";
  writeJson(path.join(baseDir, relativePath), candidateFor(baseValue, baseDraftModel));
  fs.cpSync(subsetDir, reducedDir, { recursive: true });
  const correctionDraftModel =
    "nllb-1.3B-local-mixed-v3-beam-corrections+reviewed-preserve";
  writeJson(
    path.join(correctionsDir, relativePath),
    candidateFor(finalValue, correctionDraftModel),
  );
  writeJson(path.join(beamDir, relativePath), candidateFor(finalValue, finalDraftModel));

  writeJson(checkpointEvidence, { ok: true, fields: 1 });
  const selection = readRecord(selectionManifest);
  const baseManifestCore = {
    schemaVersion: 1,
    kind: "translation-v3-base-candidate-manifest",
    draftModel: baseDraftModel,
    selection: {
      path: selectionManifest,
      sha256: hashFile(selectionManifest),
      canonicalSha256: String(selection.canonicalSha256),
    },
    rawV2: {
      path: rawV2Dir,
      checkpointEvidencePath: checkpointEvidence,
      checkpointEvidenceSha256: hashFile(checkpointEvidence),
      tree: describeFixtureTree(rawV2Dir),
    },
    primary: {
      ...describeFixtureTree(primaryDir),
      draftModel: "nllb-1.3B-local-beam1",
    },
    output: describeFixtureTree(baseDir),
    counts: {
      "raw-v2-beam4": 1,
      "primary-beam1-fallback": 0,
      total: 1,
    },
    identities: [
      {
        relativePath,
        key,
        sourceSha256: hashText(source),
        origin: "raw-v2-beam4",
        valueSha256: hashText(baseValue),
      },
    ],
  };
  writeSelfFingerprintedJson(baseManifest, baseManifestCore);

  writeJson(baseQaEvidence, { issues: 1, identity: `${relativePath}/${key}` });
  writeJson(extrasEvidence, [{ relativePath, key, reason: "tracked-arabic-ai-gate" }]);
  const reducedManifestCore = {
    schemaVersion: 1,
    kind: "translation-v3-correction-worklist-manifest",
    sourceWorklists: subsetDir,
    baseQa: { path: baseQaEvidence, sha256: hashFile(baseQaEvidence) },
    extras: { path: extrasEvidence, sha256: hashFile(extrasEvidence) },
    tree: describeFixtureTree(reducedDir),
    identities: [
      {
        relativePath,
        key,
        sourceSha256: hashText(source),
        evidence: [{ kind: "tracked-arabic-ai-gate" }],
      },
    ],
  };
  writeSelfFingerprintedJson(reducedManifest, reducedManifestCore);
  fs.writeFileSync(generator, "export const generator = 'fixture-v3';\n");
  fs.writeFileSync(semanticEvidence, "Arabic reviewer accepted the bound AI tutor value.\n");

  const finalDescriptor = {
    ...describeFixtureTree(beamDir),
    draftModel: finalDraftModel,
  };
  const semanticManifestCore = {
    schemaVersion: 1,
    kind: "translation-v3-semantic-acceptance-manifest",
    final: finalDescriptor,
    evidence: [
      {
        id: "tracked-arabic-ai-gate",
        kind: "targeted-semantic-regression",
        ...describeFixtureByteFile(semanticEvidence),
      },
    ],
    counts: { fields: 1, acceptedFields: 1, requiredTermFields: 1 },
    entries: [
      {
        relativePath,
        key,
        sourceSha256: hashText(source),
        finalValueSha256: hashText(finalValue),
        status: "accepted",
        requiredTerms: ["AI"],
        evidence: ["tracked-arabic-ai-gate"],
      },
    ],
  };
  writeSelfFingerprintedJson(semanticManifest, semanticManifestCore);

  const isCorrection = finalValue !== baseValue;
  const compositionManifestCore = {
    schemaVersion: 1,
    kind: "translation-v3-composition-manifest",
    selection: describeFixtureJsonManifest(selectionManifest),
    base: {
      manifest: describeFixtureJsonManifest(baseManifest),
      tree: { ...describeFixtureTree(baseDir), draftModel: baseDraftModel },
    },
    reducedWorklist: {
      manifest: describeFixtureJsonManifest(reducedManifest),
      tree: describeFixtureTree(reducedDir),
    },
    corrections: {
      generator: describeFixtureByteFile(generator),
      tree: { ...describeFixtureTree(correctionsDir), draftModel: correctionDraftModel },
    },
    semanticAudit: describeFixtureJsonManifest(semanticManifest),
    final: finalDescriptor,
    counts: {
      selectedFields: 1,
      correctedFields: isCorrection ? 1 : 0,
      preservedFields: isCorrection ? 0 : 1,
    },
    decisions: [
      {
        relativePath,
        key,
        sourceSha256: hashText(source),
        baseOrigin: "raw-v2-beam4",
        baseValueSha256: hashText(baseValue),
        action: isCorrection ? "correct" : "preserve",
        finalValueSha256: hashText(finalValue),
        method: isCorrection ? "reviewed-preserve" : "raw-v2",
        evidence: ["tracked-arabic-ai-gate"],
      },
    ],
  };
  writeSelfFingerprintedJson(compositionManifest, compositionManifestCore);
  return {
    root,
    worklistDir,
    primaryDir,
    subsetDir,
    beamDir,
    outputDir,
    selectionManifest,
    compositionManifest,
    semanticEvidence,
    hybridManifest,
    hybridDraftModel,
  };
}

type V3Fixture = ReturnType<typeof makeV3Fixture>;

function mergeV3Fixture(fixture: V3Fixture) {
  return mergeHybridTranslationRepairCandidates({
    worklistDir: fixture.worklistDir,
    primaryCandidateDir: fixture.primaryDir,
    subsetWorklistDir: fixture.subsetDir,
    beam4CandidateDir: fixture.beamDir,
    selectionManifestPath: fixture.selectionManifest,
    outputCandidateDir: fixture.outputDir,
    hybridDraftModel: fixture.hybridDraftModel,
    manifestPath: fixture.hybridManifest,
    compositionManifestPath: fixture.compositionManifest,
    manifestSchemaVersion: 2,
  });
}

function validateV3FixtureManifest(fixture: V3Fixture) {
  return validateHybridTranslationCandidateManifest({
    worklistDir: fixture.worklistDir,
    candidateDir: fixture.outputDir,
    manifestPath: fixture.hybridManifest,
  });
}

function makeCandidateFromRecord(worklist: Record<string, unknown>, value: string, draftModel: string) {
  const entries = requireArray(worklist.entries).map((rawEntry) => {
    const entry = requireRecord(rawEntry);
    return { ...entry, value };
  });
  return {
    schemaVersion: worklist.schemaVersion,
    kind: "translation-repair-candidate",
    protectorVersion: worklist.protectorVersion,
    protectorFingerprint: worklist.protectorFingerprint,
    language: worklist.language,
    locale: worklist.locale,
    namespace: worklist.namespace,
    sourceHash: worklist.sourceHash,
    entries,
    draftModel,
  };
}

function describeFixtureTree(root: string) {
  const files = collectFixtureJsonFiles(root);
  const fileRecords = files.map((file) => {
    const bytes = fs.readFileSync(file);
    const raw: unknown = JSON.parse(bytes.toString("utf8"));
    const record = requireRecord(raw);
    return {
      relativePath: path.relative(root, file).split(path.sep).join("/"),
      bytes: bytes.byteLength,
      fields: requireArray(record.entries).length,
      byteSha256: hashBytes(bytes),
      canonicalSha256: canonicalJsonSha256(record),
    };
  });
  return {
    path: root,
    files: fileRecords.length,
    fields: fileRecords.reduce((sum, record) => sum + record.fields, 0),
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

function collectFixtureJsonFiles(root: string) {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(file);
    }
  };
  visit(root);
  return files.sort();
}

function describeFixtureJsonManifest(file: string) {
  const raw = readRecord(file);
  return {
    ...describeFixtureByteFile(file),
    canonicalSha256: String(raw.canonicalSha256),
  };
}

function describeFixtureByteFile(file: string) {
  const bytes = fs.readFileSync(file);
  return { path: file, bytes: bytes.byteLength, byteSha256: hashBytes(bytes) };
}

function writeSelfFingerprintedJson(file: string, core: Record<string, unknown>) {
  const withoutFingerprint = Object.fromEntries(
    Object.entries(core).filter(([key]) => key !== "canonicalSha256"),
  );
  writeJson(file, {
    ...withoutFingerprint,
    canonicalSha256: canonicalJsonSha256(withoutFingerprint),
  });
}

function rewriteSelfFingerprintedJson(
  file: string,
  mutate: (manifest: Record<string, unknown>) => Record<string, unknown>,
) {
  writeSelfFingerprintedJson(file, mutate(readRecord(file)));
}

function rebindCompositionDescriptor(fixture: V3Fixture) {
  rewriteSelfFingerprintedJson(fixture.hybridManifest, (manifest) => {
    const provenance = requireRecord(manifest.provenance);
    return {
      ...manifest,
      provenance: {
        ...provenance,
        composition: describeFixtureJsonManifest(fixture.compositionManifest),
      },
    };
  });
}

function hashFile(file: string) {
  return hashBytes(fs.readFileSync(file));
}

function hashText(value: string) {
  return hashBytes(value);
}

function hashBytes(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readRecord(file: string) {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  return requireRecord(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Expected fixture record.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected fixture array.");
  return value;
}
