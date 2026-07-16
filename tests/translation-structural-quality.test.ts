import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLanguage,
  supportedLanguages,
} from "../lib/content/languages";
import {
  isCaseOnlyPseudoTranslation,
  isValidFieldTranslation,
  listCaseOnlyPseudoTranslations,
} from "../lib/i18n/translation-field-validation";
import {
  inspectTranslationFieldFluency,
  isTranslationFieldLikelyFluent,
} from "../lib/i18n/translation-quality";

test("translation fluency inspector is equivalent and names the exact failing branch", () => {
  const cases = [
    {
      source: "Set up weekly accountability",
      translated: "सा साप्ताहिक सा सा सा सा",
      language: "Marathi" as const,
      reason: "repeated-token-run",
    },
    {
      source: "London Bridge approaches",
      translated: "(جسر (لندن) يقترب",
      language: "Arabic" as const,
      reason: "unbalanced-delimiters",
    },
    {
      source: "Public learning pages are open, while API routes remain blocked.",
      translated: "Public öğrenme pages are open, while API rotaları remain blocked.",
      language: "Turkish" as const,
      reason: "source-trigram-leakage",
    },
    {
      source: "What are you curious about today?",
      translated: "¿Qué te da curiosidad hoy?",
      language: "Spanish" as const,
      reason: null,
    },
  ];

  for (const entry of cases) {
    const inspection = inspectTranslationFieldFluency(
      entry.source,
      entry.translated,
      entry.language,
    );
    assert.equal(
      inspection.fluent,
      isTranslationFieldLikelyFluent(
        entry.source,
        entry.translated,
        entry.language,
      ),
    );
    assert.equal(inspection.reason, entry.reason);
  }
});

test("translation fluency rejects repeated-token degeneration and lexical loss", () => {
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Set up weekly accountability",
      "सा साप्ताहिक सा सा सा सा",
      "Marathi",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Wartime prime minister in 1940",
      ". . . . 1940",
      "Marathi",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Built since 2013",
      "2013",
      "Malayalam",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "The next phase is connected to inspir.uk.",
      "Fasiunea urmă\u00ad\u00ad inspir.uk.",
      "Romanian",
    ),
    false,
  );
});

test("translation fluency rejects unbalanced delimiters and malformed Spanish spacing", () => {
  assert.equal(
    isTranslationFieldLikelyFluent(
      "London Bridge approaches",
      "(جسر (لندن) يقترب",
      "Arabic",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      '"Should homework exist?"',
      '"¿Deberían existir los deberes?',
      "Spanish",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Put me to the test",
      "Ponme a prueba .",
      "Spanish",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "What should I learn?",
      "¿ Qué debería aprender?",
      "Spanish",
    ),
    false,
  );
});

test("translation structural checks preserve legitimate target-language copy", () => {
  assert.equal(
    isTranslationFieldLikelyFluent(
      "What are you curious about today?",
      "¿Qué te da curiosidad hoy?",
      "Spanish",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Tell us your date of birth so we can build an age-appropriate learning experience.",
      "हमें अपनी जन्मतिथि बताएं ताकि हम आपकी उम्र के अनुसार सीखने का अनुभव तैयार कर सकें।",
      "Hindi",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "B. R. Ambedkar",
      "B. R. Ambedkar",
      "Spanish",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent("Harvard", "Harvard", "Spanish"),
    true,
  );
});

test("translation fluency rejects the observed Afrikaans title and UI-list leakage", () => {
  const observed = [
    {
      source:
        "Code Tutor For Learning Programming By Building is a focused way to use AI for learning instead of passive answer collection. The mode is built around a specific job: Understand code, debug errors, learn concepts, and build small projects step by step.",
      translated:
        "Code Tutor For Learning Programming By Building is 'n gefokusde manier om KI vir leer te gebruik in plaas van passiewe antwoordversameling. Die modus is rondom 'n spesifieke taak gebou: verstaan code, ontfout errors, leer konsepte en bou klein projekte stap vir stap.",
      reason: "embedded-source-phrase",
    },
    {
      source:
        "Use compact UI-like sections: Passport, Travel Advisory, Arrival Scene, Location, Identity, Social Rules, Event Clock, Nearby People, Objects, Choices, Evidence, and Field Notes. End major turns with meaningful choices.",
      translated:
        "Gebruik kompakte UI-agtige afdelings: Passport, Travel Advisory, Arrival Scene, Location, Identity, Social Rules, Event Clock, Nearby People, Objects, Choices, Evidence, and Field Notes. Eindig groot beurte met betekenisvolle keuses.",
      reason: "source-trigram-leakage",
    },
    {
      source: "Code Tutor",
      translated: "Code Tutor vir leerders",
      reason: "embedded-source-phrase",
    },
    {
      source: "Code Tutor",
      translated: "Code Tutor-modus",
      reason: "embedded-source-phrase",
    },
  ] as const;

  for (const entry of observed) {
    const inspection = inspectTranslationFieldFluency(
      entry.source,
      entry.translated,
      "Afrikaans",
    );
    assert.equal(inspection.fluent, false);
    assert.equal(inspection.reason, entry.reason);
  }
});

test("unprotected source spans fail closed for every non-English target", () => {
  const source =
    "The learning guide helps every student practice with feedback.";
  const translated =
    "Gelokaliseer: The learning guide helps every student practice with feedback.";

  for (const language of supportedLanguages) {
    if (language === defaultLanguage) continue;
    const inspection = inspectTranslationFieldFluency(
      source,
      translated,
      language,
    );
    assert.equal(inspection.fluent, false, language);
    assert.equal(inspection.reason, "source-trigram-leakage", language);
  }
});

test("source-span leakage cannot hide behind Latin or non-Latin target wrappers", () => {
  const source =
    "Study Plan Builder AI Learning Mode gives every learner a clear next step.";
  const cases = [
    [
      "Spanish",
      "Modo localizado: Study Plan Builder AI Learning Mode ofrece un siguiente paso claro.",
    ],
    [
      "Arabic",
      "وضع تعلّم محلي: Study Plan Builder AI Learning Mode يمنح كل متعلم خطوة تالية واضحة.",
    ],
    [
      "Japanese",
      "ローカライズ済み: Study Plan Builder AI Learning Mode は次の一歩を示します。",
    ],
  ] as const;

  for (const [language, translated] of cases) {
    assert.equal(
      inspectTranslationFieldFluency(source, translated, language).reason,
      "source-trigram-leakage",
      language,
    );
  }
});

test("distributed English content cannot evade the span gate by alternating words", () => {
  const source =
    "The learning guide helps every student practice with clear feedback and guidance.";
  const cases = [
    [
      "Afrikaans",
      "Die learning gids help elke student met practice, duidelike feedback en guidance.",
    ],
    [
      "Spanish",
      "La learning guía ayuda a cada student con practice, feedback claro y guidance.",
    ],
    [
      "Arabic",
      "يساعد learning الدليل كل student على practice مع feedback واضح وguidance مفيدة.",
    ],
  ] as const;

  for (const [language, translated] of cases) {
    const inspection = inspectTranslationFieldFluency(
      source,
      translated,
      language,
    );
    assert.equal(inspection.fluent, false, language);
    assert.ok(
      inspection.reason === "likely-english-leakage" ||
        inspection.reason === "distributed-source-leakage",
      `${language}: ${inspection.reason}`,
    );
  }
});

test("source-span leakage preserves explicit products, names, and technical standards", () => {
  const legitimate = [
    {
      language: "Afrikaans" as const,
      source:
        "Great Indian Company uses TypeScript, JSON, and free cash flow models.",
      translated:
        "Great Indian Company gebruik TypeScript, JSON en free cash flow-modelle.",
    },
    {
      language: "German" as const,
      source: "Format this website in APA, MLA, Chicago, or Harvard.",
      translated:
        "Formatieren Sie diese Website in APA, MLA, Chicago oder Harvard.",
    },
    {
      language: "Filipino" as const,
      source:
        "St Paul's Cathedral and East India Company remain historical names.",
      translated:
        "Nananatiling mga pangalang pangkasaysayan ang St Paul's Cathedral at East India Company.",
    },
    {
      language: "Hindi" as const,
      source: "Use Google, OpenAI, and GitHub with inspirlearning.com.",
      translated:
        "inspirlearning.com के साथ Google, OpenAI और GitHub का उपयोग करें।",
    },
    {
      language: "Afrikaans" as const,
      source:
        "Renaissance Florence and World War I are historical labels, not UI copy.",
      translated:
        "Renaissance Florence en World War I is historiese etikette, nie UI-kopie nie.",
    },
    {
      language: "Arabic" as const,
      source:
        "The Digital Millennium Copyright Act (DMCA) cites 17 U.S.C 512(c)(3).",
      translated:
        "يشير Digital Millennium Copyright Act (DMCA) إلى 17 U.S.C 512(c)(3).",
    },
    {
      language: "Spanish" as const,
      source:
        "The California Consumer Privacy Act (CCPA) is described by California Legislative Information.",
      translated:
        "La California Consumer Privacy Act (CCPA) se describe en California Legislative Information.",
    },
    {
      language: "Spanish" as const,
      source:
        "Payment processors follow the PCI Security Standards Council rules.",
      translated:
        "Los procesadores de pagos siguen las reglas del PCI Security Standards Council.",
    },
    {
      language: "German" as const,
      source:
        "Use a multiple-choice check-in for the Diwan-i-Khas precinct.",
      translated:
        "Verwenden Sie einen Multiple-Choice-Check-in für den Bezirk Diwan-i-Khas.",
    },
    {
      language: "Catalan" as const,
      source:
        "Do not let roleplay replace dates, context, documents, or evidence labels.",
      translated:
        "No deixis que el joc de rol substitueixi dates, context, documents o etiquetes de prova.",
    },
    {
      language: "Afrikaans" as const,
      source: "Why is my algebra answer wrong?",
      translated: "Waarom is my algebra-antwoord verkeerd?",
    },
  ];

  for (const entry of legitimate) {
    const inspection = inspectTranslationFieldFluency(
      entry.source,
      entry.translated,
      entry.language,
    );
    assert.equal(inspection.fluent, true, entry.language);
    assert.equal(inspection.reason, null, entry.language);
  }
});

test("placeholder-only and standardized unit literals stay exact without exempting prose", () => {
  for (const source of ["{value1} {value2}", "{value1} min"] as const) {
    assert.equal(isValidFieldTranslation(source, source, "Afrikaans"), true);
    const inspection = inspectTranslationFieldFluency(
      source,
      source,
      "Afrikaans",
    );
    assert.equal(inspection.fluent, true);
    assert.equal(inspection.reason, null);
  }

  for (const source of [
    "Start {value1} min",
    "{value1} min remaining",
    "{value1} minimum",
  ] as const) {
    assert.equal(isValidFieldTranslation(source, source, "Afrikaans"), false);
    assert.equal(
      inspectTranslationFieldFluency(source, source, "Afrikaans").fluent,
      false,
    );
  }
});

test("case-only source-copy detection preserves only exact reviewed locale casing", () => {
  assert.equal(isCaseOnlyPseudoTranslation("Assumption map", "assumption map", "Nepali"), true);
  assert.equal(isCaseOnlyPseudoTranslation("Claim tracker", "claim tracker", "Urdu"), true);

  assert.equal(isCaseOnlyPseudoTranslation("Blog", "blog", "French"), true);
  assert.equal(isCaseOnlyPseudoTranslation("Harvard", "harvard", "Nepali"), true);
  assert.equal(isValidFieldTranslation("Blog", "Blog", "French", "navigation.blog"), true);
  assert.equal(isValidFieldTranslation("Blog", "blog", "French", "navigation.blog"), false);
  assert.equal(isValidFieldTranslation("Blog", "Blog", "Afrikaans"), true);
  assert.equal(isTranslationFieldLikelyFluent("Blog", "Blog", "Afrikaans"), true);
  assert.equal(
    isCaseOnlyPseudoTranslation(
      "Start",
      "start",
      "Norwegian",
      "activity.quiz.start.action",
    ),
    false,
  );
  assert.equal(
    isCaseOnlyPseudoTranslation("Start", "start", "Norwegian", "unreviewed.start"),
    true,
  );
  assert.equal(
    isValidFieldTranslation(
      "Start",
      "start",
      "Norwegian",
      "activity.quiz.start.action",
    ),
    true,
  );
  assert.equal(isValidFieldTranslation("Start", "start", "Norwegian"), false);
  assert.equal(
    isValidFieldTranslation("Start", "start", "Norwegian", "unreviewed.start"),
    false,
  );
  assert.equal(
    isCaseOnlyPseudoTranslation(
      "2 September 1666",
      "2 september 1666",
      "Dutch",
      "component.7929b59ace63",
    ),
    false,
  );
  assert.equal(
    isCaseOnlyPseudoTranslation(
      "2 September 1666",
      "2 september 1666",
      "Swedish",
      "component.7929b59ace63",
    ),
    false,
  );
  assert.equal(
    isCaseOnlyPseudoTranslation(
      "September 1857",
      "september 1857",
      "Danish",
      "component.cdf2d39e903c",
    ),
    false,
  );
  assert.equal(
    isCaseOnlyPseudoTranslation(
      "September 1857",
      "september 1857",
      "Slovak",
      "component.cdf2d39e903c",
    ),
    false,
  );
  for (const language of ["Albanian", "Slovak", "Welsh"]) {
    assert.equal(
      isCaseOnlyPseudoTranslation(
        "Stoa Basileios",
        "stoa Basileios",
        language,
        "component.081a9237b493",
      ),
      false,
    );
  }
  assert.equal(isCaseOnlyPseudoTranslation("Start", "start", "Swedish"), true);

  assert.deepEqual(
    listCaseOnlyPseudoTranslations(
      {
        "activity.quiz.start.action": "Start",
        broken: "Claim tracker",
        translated: "Learning map",
      },
      {
        "activity.quiz.start.action": "start",
        broken: "claim tracker",
        translated: "सिकाइ नक्सा",
      },
      "Norwegian",
    ),
    [{ key: "broken", source: "Claim tracker", value: "claim tracker" }],
  );
});
