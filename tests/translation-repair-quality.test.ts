import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  isReviewedTranslationPreserve,
  isTranslationBundleCompleteAndFluent,
  reviewedTranslationPreserveCount,
} from "../lib/i18n/translation-quality";
import {
  assertTranslationCandidateManifestMode,
  finalizeTranslationRepairWrite,
  hasExactProtectedTranslationLiterals,
  loadTranslationRepairScope,
  repairScopeJobKey,
  shouldWriteTranslationRepairJob,
  translationRepairScopeFingerprint,
  type TranslationRepairScopeEntry,
} from "../scripts/repair-curated-translation-quality";

test("translation repair preserves overlapping product and domain literals exactly", () => {
  assert.equal(
    hasExactProtectedTranslationLiterals(
      "From inspir.app to inspirlearning.com",
      "inspir.app سے inspirlearning.com تک",
    ),
    true,
  );
  assert.equal(
    hasExactProtectedTranslationLiterals(
      "Use inspir with inspirlearning.com.",
      "inspir کو inspirlearning.com کے ساتھ استعمال کریں۔",
    ),
    true,
  );
  assert.equal(
    hasExactProtectedTranslationLiterals(
      "Use inspir with inspirlearning.com.",
      "inspir کو inspirlearning.example کے ساتھ استعمال کریں۔",
    ),
    false,
  );
  assert.equal(
    hasExactProtectedTranslationLiterals(
      "Use inspir with inspirlearning.com.",
      "inspir inspir کو inspirlearning.com کے ساتھ استعمال کریں۔",
    ),
    false,
  );
  assert.equal(
    hasExactProtectedTranslationLiterals(
      "Everything Inspir remembers is shown below.",
      "Kaikki, mitä inspir muistaa, näkyy alla.",
    ),
    true,
  );
  assert.equal(
    hasExactProtectedTranslationLiterals(
      "Correct what Inspir should remember.",
      "Korjaa, mitä inspirin pitäisi muistaa.",
    ),
    true,
  );
  assert.equal(
    hasExactProtectedTranslationLiterals(
      "Mission | inspir",
      "Mission d'inspir | inspir",
    ),
    true,
  );
  assert.equal(
    hasExactProtectedTranslationLiterals(
      "Everything Inspir remembers is shown below.",
      "Kaikki muistot näkyvät alla.",
    ),
    false,
  );
});

test("translation repair writes only jobs with repaired or duplicate keys", () => {
  assert.equal(shouldWriteTranslationRepairJob([], []), false);
  assert.equal(shouldWriteTranslationRepairJob(["broken"], []), true);
  assert.equal(shouldWriteTranslationRepairJob([], ["duplicate"]), true);
});

test("reviewed translation preserves are exact value-bound identities", () => {
  const source = {
    namespace: "main-app",
    sourceHash: "fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0",
    sourceStrings: {
      "component.0fedfa66d0ac": "Pressure-test my startup idea",
    },
  };
  const context = {
    namespace: source.namespace,
    sourceHash: source.sourceHash,
    key: "component.0fedfa66d0ac",
  };
  const reviewedValue = "የstartup ሐሳቤን በግፊት ፈትን";

  assert.equal(reviewedTranslationPreserveCount, 260);
  assert.equal(isReviewedTranslationPreserve(reviewedValue, "Amharic", context), true);
  assert.equal(
    isReviewedTranslationPreserve(`${reviewedValue} changed`, "Amharic", context),
    false,
  );
  assert.equal(
    isReviewedTranslationPreserve(reviewedValue, "Amharic", {
      ...context,
      key: "component.different",
    }),
    false,
  );
  assert.equal(
    isTranslationBundleCompleteAndFluent(
      source,
      {
        ...source,
        language: "Amharic",
        strings: { "component.0fedfa66d0ac": reviewedValue },
      },
      "Amharic",
    ),
    true,
  );

  const malayalamContext = {
    namespace: "main-app",
    sourceHash: "fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0",
    key: "language.prompt.english",
  };
  const malayalamReviewedValue = "English ഉപയോഗിച്ച് തുടരുക";
  assert.equal(
    isReviewedTranslationPreserve(malayalamReviewedValue, "Malayalam", malayalamContext),
    true,
  );
  assert.equal(
    isReviewedTranslationPreserve(
      malayalamReviewedValue + ".",
      "Malayalam",
      malayalamContext,
    ),
    false,
  );

  const productionFluencyContext = {
    namespace: "main-app",
    sourceHash: "fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0",
    key: "component.011074a0acd3",
  };
  const productionFluencyReviewedValue = "Suriin ang token ng guild";
  assert.equal(
    isReviewedTranslationPreserve(
      productionFluencyReviewedValue,
      "Filipino",
      productionFluencyContext,
    ),
    true,
  );
  assert.equal(
    isReviewedTranslationPreserve(
      `${productionFluencyReviewedValue}.`,
      "Filipino",
      productionFluencyContext,
    ),
    false,
  );
});

test("translation repair scope fingerprints are order-independent and candidate-bound", () => {
  const first: TranslationRepairScopeEntry = {
    language: "Spanish",
    locale: "es",
    namespace: "main-app",
    sourceHash: "source-main",
    key: "topic.example",
    source: "Example",
    existingCandidate: "Ejemplo",
  };
  const second: TranslationRepairScopeEntry = {
    language: "Hindi",
    locale: "hi",
    namespace: "route:mission",
    sourceHash: "source-mission",
    key: "site.example",
    source: "Mission example",
    existingCandidate: null,
  };
  const entries = [first, second];

  const fingerprint = translationRepairScopeFingerprint(entries);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(translationRepairScopeFingerprint([...entries].reverse()), fingerprint);
  assert.equal(
    translationRepairScopeFingerprint([{ ...first, reasons: ["audit"] }, second]),
    fingerprint,
  );
  assert.notEqual(
    translationRepairScopeFingerprint([
      { ...first, existingCandidate: "Ejemplo revisado" },
      second,
    ]),
    fingerprint,
  );
  assert.notEqual(
    translationRepairScopeFingerprint([{ ...first, locale: "es-MX" }, second]),
    fingerprint,
  );
});

test("translation repair scope strictly binds arbitrary existing site jobs", () => {
  const root = path.resolve("tmp", `translation-repair-scope-test-${process.pid}`);
  const scopePath = path.join(root, "scope.json");
  const namespace = "blog:socratic-ai-tutor";
  const source = {
    namespace,
    sourceHash: "source-blog",
    sourceStrings: { "site.example": "A patient learning guide" },
  };
  const entry: TranslationRepairScopeEntry = {
    language: "Spanish",
    locale: "es",
    namespace,
    sourceHash: source.sourceHash,
    key: "site.example",
    source: source.sourceStrings["site.example"],
    existingCandidate: "Una guía de aprendizaje paciente",
    reasons: ["full-corpus-audit"],
  };
  const payload = {
    schemaVersion: 1,
    kind: "translation-repair-scope",
    fields: 1,
    sourceHashes: { [namespace]: source.sourceHash },
    entries: [entry],
    canonicalSha256: translationRepairScopeFingerprint([entry]),
  };
  const selectedJobs = new Map([
    [repairScopeJobKey("Spanish", namespace), { language: "Spanish" as const, namespace }],
  ]);
  const write = (value: unknown) => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(scopePath, `${JSON.stringify(value, null, 2)}\n`);
  };

  try {
    write(payload);
    const scope = loadTranslationRepairScope(
      scopePath,
      [source],
      ["Spanish"],
      selectedJobs,
    );
    assert.equal(scope?.fields, 1);
    assert.equal(scope?.canonicalSha256, payload.canonicalSha256);

    write({ ...payload, kind: "translation-repair-worklist" });
    assert.throws(
      () => loadTranslationRepairScope(scopePath, [source], ["Spanish"], selectedJobs),
      /Invalid translation repair scope metadata/,
    );

    write({ ...payload, canonicalSha256: "0".repeat(64) });
    assert.throws(
      () => loadTranslationRepairScope(scopePath, [source], ["Spanish"], selectedJobs),
      /Repair scope fingerprint mismatch/,
    );

    write({ ...payload, sourceHashes: { [namespace]: "stale" } });
    assert.throws(
      () => loadTranslationRepairScope(scopePath, [source], ["Spanish"], selectedJobs),
      /Repair scope source hash drift/,
    );

    write({ ...payload, unexpected: true });
    assert.throws(
      () => loadTranslationRepairScope(scopePath, [source], ["Spanish"], selectedJobs),
      /Invalid repair scope root .* unexpected=unexpected/,
    );

    const duplicateReasonEntry = {
      ...entry,
      reasons: ["full-corpus-audit", "full-corpus-audit"],
    };
    write({
      ...payload,
      entries: [duplicateReasonEntry],
      canonicalSha256: translationRepairScopeFingerprint([duplicateReasonEntry]),
    });
    assert.throws(
      () => loadTranslationRepairScope(scopePath, [source], ["Spanish"], selectedJobs),
      /Repair scope reasons must be sorted and unique/,
    );

    const wrongSourceEntry = { ...entry, source: "Drifted source" };
    write({
      ...payload,
      entries: [wrongSourceEntry],
      canonicalSha256: translationRepairScopeFingerprint([wrongSourceEntry]),
    });
    assert.throws(
      () => loadTranslationRepairScope(scopePath, [source], ["Spanish"], selectedJobs),
      /Repair scope source drift/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("candidate apply is wired through strict worklist directory QA", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/repair-curated-translation-quality.ts"),
    "utf8",
  );
  assert.match(source, /validateTranslationRepairCandidateDirectories/);
  assert.match(source, /requires --worklist-dir=<ignored-directory>/);
  assert.match(source, /requires --candidate-manifest=<ignored-manifest>/);
  assert.ok(
    source.indexOf("validateTranslationRepairCandidateDirectories({") <
      source.indexOf("applyManualCandidates(jobs, args.candidateDir)"),
  );
  assert.ok(
    source.indexOf("const candidateManifestValidation") <
      source.indexOf("applyManualCandidates(jobs, args.candidateDir)"),
  );
  assert.ok(
    source.indexOf("const finalCandidateManifestValidation") <
      source.indexOf("writeCanonicalCorpusAtomically(impactedJobs)"),
  );
});

test("candidate manifest mode preserves plan/export and fails apply closed", () => {
  assert.doesNotThrow(() => assertTranslationCandidateManifestMode("plan", null));
  assert.doesNotThrow(() =>
    assertTranslationCandidateManifestMode("export-worklists", null),
  );
  assert.doesNotThrow(() =>
    assertTranslationCandidateManifestMode("validate-candidates", null),
  );
  assert.doesNotThrow(() =>
    assertTranslationCandidateManifestMode(
      "validate-candidates",
      "/tmp/hybrid-manifest.json",
    ),
  );
  assert.doesNotThrow(() =>
    assertTranslationCandidateManifestMode(
      "apply-candidates",
      "/tmp/hybrid-manifest.json",
    ),
  );
  assert.throws(
    () => assertTranslationCandidateManifestMode("apply-candidates", null),
    /requires --candidate-manifest/,
  );
  assert.throws(
    () =>
      assertTranslationCandidateManifestMode("plan", "/tmp/hybrid-manifest.json"),
    /only valid with --validate-candidates or --apply-candidates/,
  );
});

test("translation repair retains source backups until generated outputs succeed", () => {
  const successEvents: string[] = [];
  finalizeTranslationRepairWrite(
    {
      commit: () => successEvents.push("commit"),
      rollback: () => successEvents.push("rollback"),
    },
    () => successEvents.push("regenerate"),
  );
  assert.deepEqual(successEvents, ["regenerate", "commit"]);

  const failureEvents: string[] = [];
  const initialFailure = new Error("generated output failed");
  let attempts = 0;
  assert.throws(
    () =>
      finalizeTranslationRepairWrite(
        {
          commit: () => failureEvents.push("commit"),
          rollback: () => failureEvents.push("rollback"),
        },
        () => {
          attempts += 1;
          failureEvents.push(`regenerate-${attempts}`);
          if (attempts === 1) throw initialFailure;
        },
      ),
    (error: unknown) => error === initialFailure,
  );
  assert.deepEqual(failureEvents, ["regenerate-1", "rollback", "regenerate-2"]);
});
