import assert from "node:assert/strict";
import test from "node:test";
import {
  isCaseOnlyPseudoTranslation,
  isValidFieldTranslation,
  listCaseOnlyPseudoTranslations,
} from "../lib/i18n/translation-field-validation";
import { isTranslationFieldLikelyFluent } from "../lib/i18n/translation-quality";

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

test("case-only source-copy detection preserves only exact reviewed locale casing", () => {
  assert.equal(isCaseOnlyPseudoTranslation("Assumption map", "assumption map", "Nepali"), true);
  assert.equal(isCaseOnlyPseudoTranslation("Claim tracker", "claim tracker", "Urdu"), true);

  assert.equal(isCaseOnlyPseudoTranslation("Blog", "blog", "French"), true);
  assert.equal(isCaseOnlyPseudoTranslation("Harvard", "harvard", "Nepali"), true);
  assert.equal(isValidFieldTranslation("Blog", "Blog", "French", "navigation.blog"), true);
  assert.equal(isValidFieldTranslation("Blog", "blog", "French", "navigation.blog"), false);
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
