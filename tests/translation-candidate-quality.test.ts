import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  defaultLanguage,
  supportedLanguages,
} from "../lib/content/languages";
import {
  hasExcessiveTranslationLength,
  hasRepeatedSequenceDegeneration,
  hasTargetNegationMarker,
  numericLiteralsIn,
  protectedLiteralsIn,
  validateTranslationCandidateField,
  type TranslationCandidateTargetLanguage,
} from "../lib/i18n/translation-candidate-quality";
import { validateTranslationRepairCandidateDirectories } from "../scripts/validate-translation-repair-candidates";

const sourceHash = "a".repeat(64);
const protectorFingerprint = "b".repeat(64);
const negationSamples: Record<TranslationCandidateTargetLanguage, string> = {
  Hindi: "नहीं",
  Spanish: "no",
  French: "pas",
  German: "nicht",
  Italian: "non",
  Portuguese: "não",
  Dutch: "niet",
  Russian: "нет",
  Ukrainian: "ніколи",
  Polish: "nigdy",
  Romanian: "fără",
  Czech: "není",
  Hungarian: "nincs",
  Greek: "δεν",
  Turkish: "değil",
  Arabic: "ليس",
  Hebrew: "אין",
  Persian: "نیست",
  Urdu: "نہیں",
  Bengali: "নেই",
  Tamil: "இல்லை",
  Telugu: "లేదు",
  Marathi: "नाही",
  Gujarati: "નથી",
  Kannada: "ಇಲ್ಲ",
  Malayalam: "ഇല്ല",
  Punjabi: "ਨਹੀਂ",
  Odia: "ନାହିଁ",
  Assamese: "নাই",
  Nepali: "छैन",
  Sinhala: "නැහැ",
  Chinese: "不",
  Japanese: "ない",
  Korean: "없",
  Vietnamese: "không",
  Thai: "ไม่",
  Indonesian: "tidak",
  Malay: "tidak",
  Filipino: "hindi",
  Swahili: "hakuna",
  Afrikaans: "nie",
  Amharic: "የለም",
  Yoruba: "kò",
  Zulu: "akukho",
  Hausa: "babu",
  Somali: "maya",
  Norwegian: "ikke",
  Swedish: "inte",
  Danish: "ikke",
  Finnish: "eivät",
  Icelandic: "ekki",
  Irish: "ní",
  Welsh: "ddim",
  Catalan: "mai",
  Basque: "ez",
  Galician: "non",
  Serbian: "није",
  Croatian: "nije",
  Bosnian: "nije",
  Bulgarian: "няма",
  Slovak: "nikdy",
  Slovenian: "nikoli",
  Lithuanian: "nėra",
  Latvian: "nav",
  Estonian: "pole",
  Albanian: "nuk",
  Georgian: "არა",
  Armenian: "ոչ",
  Azerbaijani: "deyil",
};

test("candidate field QA enforces lossless structural literals and explicit negation", () => {
  const source =
    "Do not remove {count} records from https://inspir.app or email help@inspir.app. Keep 12.";
  const valid =
    "No elimines {count} registros de https://inspir.app ni escribas a help@inspir.app. Conserva 12.";

  assert.deepEqual(
    validateTranslationCandidateField({ language: "Spanish", source, value: valid }),
    { failures: [], sourceNegationMarkers: ["not"] },
  );
  assert.ok(
    validateTranslationCandidateField({ language: "Spanish", source, value: "  " }).failures.includes(
      "empty",
    ),
  );
  assert.ok(
    validateTranslationCandidateField({ language: "Spanish", source, value: source }).failures.includes(
      "source-equality",
    ),
  );
  assert.deepEqual(
    validateTranslationCandidateField({ language: "Spanish", source: "GitHub", value: "GitHub" }).failures,
    [],
  );
  assert.deepEqual(
    validateTranslationCandidateField({ language: "Hindi", source: "JavaScript", value: "JavaScript" }).failures,
    [],
  );
  assert.deepEqual(
    validateTranslationCandidateField({
      language: "Spanish",
      source: '"Chang\'an, 742"',
      value: '"Chang\'an, 742"',
    }).failures,
    [],
  );
  assert.ok(
    validateTranslationCandidateField({
      language: "Spanish",
      source,
      value: valid.replace("{count}", "{total}"),
    }).failures.includes("placeholder-parity"),
  );
  assert.ok(
    validateTranslationCandidateField({
      language: "Spanish",
      source,
      value: valid.replace("https://inspir.app", "https://example.com"),
    }).failures.includes("url-parity"),
  );
  assert.ok(
    validateTranslationCandidateField({
      language: "Spanish",
      source,
      value: valid.replace("help@inspir.app", "hola@inspir.app"),
    }).failures.includes("email-parity"),
  );
  assert.ok(
    validateTranslationCandidateField({
      language: "Spanish",
      source,
      value: valid.replace("12", "13"),
    }).failures.includes("number-parity"),
  );
  assert.ok(
    validateTranslationCandidateField({
      language: "Spanish",
      source,
      value: valid.replace("No elimines", "Elimina").replace("ni escribas", "y escribe"),
    }).failures.includes("negation-marker-missing"),
  );
  assert.ok(
    validateTranslationCandidateField({
      language: "Spanish",
      source,
      value: `${valid} accio\u0301n`,
    }).failures.includes("non-nfc"),
  );
});

test("candidate QA normalizes Unicode decimal digits but not changed values", () => {
  assert.deepEqual(numericLiteralsIn("Keep 12 of 50%."), ["12", "50%"]);
  assert.deepEqual(numericLiteralsIn("احتفظ بـ ١٢ من ٥٠٪."), ["12", "50%"]);
  assert.deepEqual(
    validateTranslationCandidateField({
      language: "Arabic",
      source: "Keep 12 of 50%.",
      value: "احتفظ بـ ١٢ من ٥٠٪.",
    }).failures,
    [],
  );
  assert.ok(
    validateTranslationCandidateField({
      language: "Arabic",
      source: "Keep 12 of 50%.",
      value: "احتفظ بـ ١٣ من ٥٠٪.",
    }).failures.includes("number-parity"),
  );
});

test("candidate QA rejects excessive length and repeated model degeneration", () => {
  const source =
    "Value = forecast free cash flows discounted for risk + discounted terminal value.";
  const runaway =
    "Die volgende is die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van die totale bedrag van";
  const failures = validateTranslationCandidateField({
    language: "Afrikaans",
    source,
    value: runaway,
  }).failures;
  assert.equal(hasExcessiveTranslationLength(source, runaway), true);
  assert.equal(hasRepeatedSequenceDegeneration(source, runaway, "Afrikaans"), true);
  assert.ok(failures.includes("excessive-length"));
  assert.ok(failures.includes("repeated-sequence"));

  const compactRepeat = "estudia ahora estudia ahora estudia ahora estudia ahora";
  assert.equal(
    hasRepeatedSequenceDegeneration(
      "Study this concept carefully and apply it once.",
      compactRepeat,
      "Spanish",
    ),
    true,
  );
  assert.equal(
    hasRepeatedSequenceDegeneration(
      "Practice now practice now practice now.",
      "Practica ahora practica ahora practica ahora.",
      "Spanish",
    ),
    false,
  );
});

test("candidate QA protects product, provider, route, code, URL, and email literals", () => {
  const source =
    "Use inspir with Google at https://inspir.app, email help@inspir.app, then open `/chat` and {count}.";
  const literals = protectedLiteralsIn(source);
  assert.deepEqual(literals, [
    "Google",
    "`/chat`",
    "help@inspir.app",
    "https://inspir.app,",
    "inspir",
    "{count}",
  ]);
  assert.ok(
    validateTranslationCandidateField({
      language: "Spanish",
      source,
      value:
        "Usa inspir con غوغل en https://inspir.app, escribe a help@inspir.app y abre `/chat` con {count}.",
    }).failures.includes("protected-literal-parity"),
  );
});

test("candidate QA has deterministic negation recognition for all 69 target languages", () => {
  for (const language of supportedLanguages) {
    if (language === defaultLanguage) continue;
    assert.equal(
      hasTargetNegationMarker(negationSamples[language], language),
      true,
      language,
    );
  }
  assert.equal(hasTargetNegationMarker("यह सार्वजनिक नहीं है", "Hindi"), true);
  assert.equal(hasTargetNegationMarker("公開されていない", "Japanese"), true);
  assert.equal(hasTargetNegationMarker("공개되지 않습니다", "Korean"), true);
  assert.equal(hasTargetNegationMarker("أنت توافق على عدم استخدامها", "Arabic"), true);
  assert.equal(hasTargetNegationMarker("خصوصيتك وعدم بيع بياناتك", "Arabic"), true);
  assert.equal(hasTargetNegationMarker("يُمنع بعدم الموافقة", "Arabic"), true);
  assert.equal(hasTargetNegationMarker("أشياء يجب ألا تُختلق", "Arabic"), true);
  assert.equal(hasTargetNegationMarker("لست متأكدة من أين تبدأ", "Arabic"), true);
  assert.equal(hasTargetNegationMarker("কুইজ সৃষ্টি কৰিব নোৱাৰিলে", "Assamese"), true);
  assert.equal(hasTargetNegationMarker("উত্তৰবিহীন পৰামৰ্শ", "Assamese"), true);
  assert.equal(hasTargetNegationMarker("অপরাধবোধ ছাড়াই", "Bengali"), true);
  assert.equal(hasTargetNegationMarker("neměly by se chovat stejně", "Czech"), true);
  assert.equal(hasTargetNegationMarker("όχι μόνο να απαντά", "Greek"), true);
  assert.equal(hasTargetNegationMarker("નાગરિક સંદર્ભ વિના", "Gujarati"), true);
  assert.equal(hasTargetNegationMarker("Níl sé poiblí", "Irish"), true);
  assert.equal(hasTargetNegationMarker("en lugar de copiar", "Spanish"), true);
  assert.equal(hasTargetNegationMarker("नकल के बजाय सीखना", "Hindi"), true);
  assert.equal(hasTargetNegationMarker("അങ്ങനെ ചെയ്യരുത്", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("സ്വയം വഞ്ചിക്കാതെ പഠിക്കുക", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("അത് ലഭ്യമല്ല", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("അത് പോലെയല്ല", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("കാര്യങ്ങൾ മാറിയിട്ടില്ല", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("ആദ്യ വിശദീകരണം ശരിയായില്ലെങ്കിൽ", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("ആദ്യ തടസ്സം കഴിവല്ല", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("ഇതൊന്നും മാജിക് വാക്കുകളല്ല", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("ചോദ്യം അതാണോ എന്നതല്ല", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("അത് എന്താണ് അർഥമാക്കാത്തത്", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("മതിപ്പുളവാക്കാതിരിക്കുക", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("ഉത്തരം മാത്രമല്ല", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("അങ്ങനെ നടിക്കണ്ട", "Malayalam"), true);
  assert.equal(hasTargetNegationMarker("anélkül, hogy bejelentkezne", "Hungarian"), true);
  assert.equal(hasTargetNegationMarker("Bu ictimai deyil", "Azerbaijani"), true);
  assert.equal(hasTargetNegationMarker("Bu kamuya açık değildir", "Turkish"), true);
  assert.equal(hasTargetNegationMarker("Siz hazırsınız", "Turkish"), false);
  assert.equal(hasTargetNegationMarker("Siz hazırsınız", "Azerbaijani"), false);
  assert.equal(hasTargetNegationMarker("Bu risksiz değildir", "Turkish"), true);
  assert.equal(hasTargetNegationMarker("Es ist öffentlich", "German"), false);
});

test("candidate QA keeps genuine Malayalam negation loss selected", () => {
  const source = "AI Homework Coach With Hints, Not Answer Dumping: practical guide";
  const hallucinated = "അന്താരാഷ്ട്ര തലത്തിൽ അന്താരാടന പരിശീലകരുടെ യോഗ്യതാ യോഗ്യതാ പരീക്ഷ";

  assert.equal(hasTargetNegationMarker(hallucinated, "Malayalam"), false);
  assert.ok(
    validateTranslationCandidateField({
      language: "Malayalam",
      source,
      value: hallucinated,
    }).failures.includes("negation-marker-missing"),
  );
});

test("directory QA binds candidate identity, key order, model, and field quality read-only", () => {
  const root = path.resolve("tmp", `translation-candidate-qa-${process.pid}`);
  const worklistDir = path.join(root, "worklists");
  const candidateDir = path.join(root, "candidates");
  const source =
    "Do not remove {count} records from https://inspir.app or email help@inspir.app. Keep 12.";
  const value =
    "No elimines {count} registros de https://inspir.app ni escribas a help@inspir.app. Conserva 12.";
  const worklist = makeWorklist({ namespace: "route:home", source });
  const candidate = makeCandidate(worklist, value, "nllb-1.3b-local");

  try {
    writeJson(path.join(worklistDir, "es/route__home.json"), worklist);
    writeJson(path.join(candidateDir, "es/route__home.json"), candidate);
    const worklistBefore = fs.readFileSync(path.join(worklistDir, "es/route__home.json"), "utf8");
    const candidateBefore = fs.readFileSync(path.join(candidateDir, "es/route__home.json"), "utf8");

    const report = validateTranslationRepairCandidateDirectories({ worklistDir, candidateDir });
    assert.equal(report.ok, true);
    assert.equal(report.checkedFiles, 1);
    assert.equal(report.checkedFields, 1);
    assert.equal(report.draftModel, "nllb-1.3b-local");
    assert.deepEqual(report.issues, []);
    assert.equal(fs.readFileSync(path.join(worklistDir, "es/route__home.json"), "utf8"), worklistBefore);
    assert.equal(fs.readFileSync(path.join(candidateDir, "es/route__home.json"), "utf8"), candidateBefore);

    const brokenCandidate = makeCandidate(
      worklist,
      value.replace("No elimines", "Elimina").replace("ni escribas", "y escribe"),
      "nllb-1.3b-local",
    );
    writeJson(path.join(candidateDir, "es/route__home.json"), brokenCandidate);
    const brokenReport = validateTranslationRepairCandidateDirectories({ worklistDir, candidateDir });
    assert.equal(brokenReport.ok, false);
    assert.deepEqual(brokenReport.issues, [
      {
        code: "candidate-field",
        relativePath: "es/route__home.json",
        language: "Spanish",
        namespace: "route:home",
        key: "site.example",
        failures: ["negation-marker-missing"],
        sourceNegationMarkers: ["not"],
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("directory QA fails closed for missing files, mixed models, and identity drift", () => {
  const root = path.resolve("tmp", `translation-candidate-qa-closed-${process.pid}`);
  const worklistDir = path.join(root, "worklists");
  const candidateDir = path.join(root, "candidates");
  const home = makeWorklist({ namespace: "route:home", source: "Do not stop." });
  const mission = makeWorklist({ namespace: "route:mission", source: "Never stop." });
  const homeCandidate = makeCandidate(home, "No te detengas.", "nllb-1.3b-local");
  const missionCandidate = makeCandidate(mission, "Nunca te detengas.", "nllb-600m-local");

  try {
    writeJson(path.join(worklistDir, "es/route__home.json"), home);
    writeJson(path.join(worklistDir, "es/route__mission.json"), mission);
    writeJson(path.join(candidateDir, "es/route__home.json"), homeCandidate);
    let report = validateTranslationRepairCandidateDirectories({ worklistDir, candidateDir });
    assert.equal(report.ok, false);
    assert.deepEqual(report.issues, [
      { code: "missing-candidate-file", relativePath: "es/route__mission.json" },
    ]);

    writeJson(path.join(candidateDir, "es/route__mission.json"), missionCandidate);
    report = validateTranslationRepairCandidateDirectories({ worklistDir, candidateDir });
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.code === "mixed-draft-model"));

    const drifted = {
      ...homeCandidate,
      entries: homeCandidate.entries.map((entry) => ({ ...entry, source: "Drifted source" })),
    };
    writeJson(path.join(candidateDir, "es/route__home.json"), drifted);
    assert.throws(
      () => validateTranslationRepairCandidateDirectories({ worklistDir, candidateDir }),
      /Candidate entry identity mismatch.*source/,
    );

    writeJson(path.join(candidateDir, "es/route__home.json"), {
      ...homeCandidate,
      unexpected: true,
    });
    assert.throws(
      () => validateTranslationRepairCandidateDirectories({ worklistDir, candidateDir }),
      /Invalid candidate root .* unexpected=unexpected/,
    );

    writeJson(path.join(candidateDir, "es/route__home.json"), {
      ...homeCandidate,
      entries: homeCandidate.entries.map((entry) => ({
        ...entry,
        reasons: ["quality-review", "quality-review"],
      })),
    });
    assert.throws(
      () => validateTranslationRepairCandidateDirectories({ worklistDir, candidateDir }),
      /Reasons must be sorted and unique/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeWorklist(input: { namespace: string; source: string }) {
  return {
    schemaVersion: 1,
    kind: "translation-repair-worklist",
    protectorVersion: "literal-protector-v2",
    protectorFingerprint,
    language: "Spanish",
    locale: "es",
    namespace: input.namespace,
    sourceHash,
    entries: [
      {
        key: "site.example",
        source: input.source,
        existingCandidate: null,
        reasons: ["quality-review"],
        value: "",
      },
    ],
  };
}

function makeCandidate(
  worklist: ReturnType<typeof makeWorklist>,
  value: string,
  draftModel: string,
) {
  return {
    ...worklist,
    kind: "translation-repair-candidate",
    draftModel,
    entries: worklist.entries.map((entry) => ({ ...entry, value })),
  };
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
