import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
} from "../lib/i18n/main-app-source";
import { siteTranslationNamespace } from "../lib/i18n/site-source-constants";
import {
  assertCurrentLongTailReleaseRunRoot,
  LONG_TAIL_NLLB_EXECUTION_PROFILE,
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
  longTailNllbExecutionProfileSchema,
  parseLongTailNllbExecutionProfile,
} from "./long-tail-nllb-execution-profile";

export const TRANSLATION_SEMANTIC_AUDIT_SCHEMA_VERSION = 3 as const;
export const TRANSLATION_SEMANTIC_AUDIT_KIND =
  "inspir-translation-semantic-audit-manifest-v3" as const;
export const TRANSLATION_SEMANTIC_AUDIT_VERSION =
  "inspir-translation-semantic-audit-v2" as const;
export const TRANSLATION_SEMANTIC_AUDIT_FULL_MANIFEST_BASENAME =
  "semantic-audit-full.json" as const;
export const TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_MANIFEST_BASENAME =
  "semantic-audit-afrikaans-smoke.json" as const;
export const TRANSLATION_SEMANTIC_AUDIT_IMPLEMENTATION_RELATIVE_PATH =
  "scripts/audit-translation-semantics.py" as const;
export const TRANSLATION_SEMANTIC_AUDIT_VERIFIER_RELATIVE_PATH =
  "scripts/verify-translation-semantic-audit.ts" as const;
export const TRANSLATION_SEMANTIC_AUDIT_SITE_SOURCE_MANIFEST_RELATIVE_PATH =
  "lib/i18n/site-source-manifest.ts" as const;
export const TRANSLATION_SEMANTIC_AUDIT_CURATED_RELATIVE_PATH =
  "translations/curated" as const;
export const TRANSLATION_SEMANTIC_AUDIT_STATIC_MAIN_APP_RELATIVE_PATH =
  "translations/static-main-app" as const;
export const TRANSLATION_SEMANTIC_AUDIT_MASTER_BASENAME =
  "worklist.json" as const;
export const TRANSLATION_SEMANTIC_AUDIT_CANDIDATE_BASENAME =
  "candidates" as const;
export const TRANSLATION_SEMANTIC_AUDIT_PACK_WORKLIST_BASENAME =
  "worklists" as const;
export const TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_ROOT_BASENAME =
  ".semantic-audit-full.json.checkpoints" as const;
export const TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_CHECKPOINT_ROOT_BASENAME =
  ".semantic-audit-afrikaans-smoke.json.checkpoints" as const;
export const TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_KIND =
  "inspir-translation-semantic-pack-checkpoint-v1" as const;
export const TRANSLATION_SEMANTIC_AUDIT_SESSION_KIND =
  "inspir-translation-semantic-audit-session-v1" as const;
export const TRANSLATION_SEMANTIC_AUDIT_SESSION_RECORD_KIND =
  "inspir-translation-semantic-audit-session-record-v1" as const;
export const TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_EVIDENCE_KIND =
  "inspir-translation-semantic-checkpoint-chain-evidence-v1" as const;

export const TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES = Object.freeze([
  "af", "am", "ar", "as", "az", "bg", "bn", "bs", "ca", "cs", "cy",
  "da", "de", "el", "es", "et", "eu", "fa", "fi", "fil", "fr", "ga",
  "gl", "gu", "ha", "he", "hi", "hr", "hu", "hy", "id", "is", "it",
  "ja", "ka", "kn", "ko", "lt", "lv", "ml", "mr", "ms", "ne", "nl",
  "no", "or", "pa", "pl", "pt", "ro", "ru", "si", "sk", "sl", "so",
  "sq", "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur", "vi",
  "yo", "zh", "zu",
] as const);

export const TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT = 125 as const;
export const TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT = 8_625 as const;
export const TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT =
  69 as const;
export const TRANSLATION_SEMANTIC_AUDIT_EXPECTED_SITE_PACK_COUNT =
  8_556 as const;
export const TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_LOCALES =
  Object.freeze(["af"] as const);
export const TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT =
  125 as const;
export const TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT =
  16_564 as const;
export const TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT =
  121 as const;
export const TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT =
  4 as const;

export const TRANSLATION_SEMANTIC_AUDIT_LANGUAGE_BY_LOCALE = Object.freeze({
  af: "Afrikaans", am: "Amharic", ar: "Arabic", as: "Assamese",
  az: "Azerbaijani", bg: "Bulgarian", bn: "Bengali", bs: "Bosnian",
  ca: "Catalan", cs: "Czech", cy: "Welsh", da: "Danish", de: "German",
  el: "Greek", es: "Spanish", et: "Estonian", eu: "Basque", fa: "Persian",
  fi: "Finnish", fil: "Filipino", fr: "French", ga: "Irish", gl: "Galician",
  gu: "Gujarati", ha: "Hausa", he: "Hebrew", hi: "Hindi", hr: "Croatian",
  hu: "Hungarian", hy: "Armenian", id: "Indonesian", is: "Icelandic",
  it: "Italian", ja: "Japanese", ka: "Georgian", kn: "Kannada", ko: "Korean",
  lt: "Lithuanian", lv: "Latvian", ml: "Malayalam", mr: "Marathi", ms: "Malay",
  ne: "Nepali", nl: "Dutch", no: "Norwegian", or: "Odia", pa: "Punjabi",
  pl: "Polish", pt: "Portuguese", ro: "Romanian", ru: "Russian", si: "Sinhala",
  sk: "Slovak", sl: "Slovenian", so: "Somali", sq: "Albanian", sr: "Serbian",
  sv: "Swedish", sw: "Swahili", ta: "Tamil", te: "Telugu", th: "Thai",
  tr: "Turkish", uk: "Ukrainian", ur: "Urdu", vi: "Vietnamese", yo: "Yoruba",
  zh: "Chinese", zu: "Zulu",
} satisfies Readonly<Record<(typeof TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES)[number], string>>);

const LANGUAGE_BY_LOCALE = TRANSLATION_SEMANTIC_AUDIT_LANGUAGE_BY_LOCALE;

export const TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS = Object.freeze({
  ctranslate2: "4.8.1",
  fasttext: "0.9.3",
  numpy: "1.26.4",
  safetensors: "0.7.0",
  torch: "2.2.2",
  transformers: "4.46.3",
});

export const TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE = Object.freeze({
  schemaVersion: 1,
  kind: "inspir-translation-semantic-execution-profile-v1",
  pythonImplementation: "CPython",
  pythonVersion: "3.9.6",
  pythonExecutableRealPath:
    "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9",
  pythonVenvConfigSha256:
    "b682dbc2a57b67371d3834e1a0c117beef9ede3cb74253b0c34db2cd4eb1caf1",
  semanticDevice: "mps",
  torchNumThreads: 1,
  torchNumInteropThreads: 1,
  backtranslationDevice: "cpu",
  backtranslationComputeType: "int8",
  backtranslationInterThreads: 1,
  backtranslationIntraThreads: 1,
  environment: Object.freeze({
    MKL_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    PYTHONHASHSEED: "0",
    PYTORCH_ENABLE_MPS_FALLBACK: "0",
    TOKENIZERS_PARALLELISM: "false",
    VECLIB_MAXIMUM_THREADS: "1",
  }),
} as const);

const EXPECTED_RUNTIME_VERSIONS =
  TRANSLATION_SEMANTIC_AUDIT_RUNTIME_VERSIONS;

export const TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS = Object.freeze({
  fasttextSha256:
    "7e69ec5451bc261cc7844e49e4792a85d7f09c06789ec800fc4a44aec362764e",
  labseTreeSha256:
    "7d307a12f27ea21388f123d950552e6da1bfa84d173e7a424a5d1a2bfb166465",
  madladTreeSha256:
    "257d46b445016de847c148a1be00b7898ab986e1df983a295d5d4e40850a92a2",
} as const);

export const TRANSLATION_SEMANTIC_AUDIT_POLICY = Object.freeze({
  version: TRANSLATION_SEMANTIC_AUDIT_VERSION,
  expectedNamespaceCount: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
  expectedTargetLocaleCount: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length,
  language: Object.freeze({
    minimumLetters: 3,
    shortTextLetters: 12,
    minimumTargetProbability: 0.55,
    minimumShortTargetProbability: 0.35,
    maximumEnglishProbability: 0.3,
    mixedChunkEnglishProbability: 0.35,
    mixedChunkMinimumLetters: 8,
    afrikaansPackContext: Object.freeze({
      locale: "af",
      targetLabel: "af",
      relatedLabel: "nl",
      normalization:
        "NFKC-casefold-whitespace-collapse-distinct-lexical-space-join-v1",
      minimumDistinctMaskedValues: 20,
      minimumMaskedLetters: 1_000,
      minimumPackTargetProbability: 0.55,
      minimumPackPairProbability: 0.75,
      minimumFieldPairProbability: 0.7,
      trackedCuratedRescue: Object.freeze({
        candidateOriginOnly: true,
        referenceLocale: "af",
        referencePackGateRequired: true,
        conflictPolicy:
          "exclude-source-hash-with-distinct-exact-values-v1",
        supportPairIdentity:
          "locale-source-bytes-source-sha256-value-bytes-value-sha256-v1",
        requiredFailures: Object.freeze([
          "language-target-low-confidence",
        ]),
      }),
    }),
  }),
  semantic: Object.freeze({
    shortMinimum: 0.45,
    mediumMinimum: 0.55,
    standardMinimum: 0.62,
    legalMinimum: 0.7,
    backtranslationTrigger: 0.72,
    backtranslationMinimum: 0.7,
    legalBacktranslationMinimum: 0.76,
    sentenceAlignmentMinimum: 0.58,
    legalSentenceAlignmentMinimum: 0.64,
    minimumBacktranslationLengthRatio: 0.55,
    maximumBacktranslationLengthRatio: 1.8,
    legalMinimumBacktranslationLengthRatio: 0.72,
    legalMaximumBacktranslationLengthRatio: 1.4,
  }),
  sourceCopy: Object.freeze({
    minimumExactNgramWords: 4,
    minimumExactNgramCharacters: 18,
    minimumDistinctEnglishFunctionWords: 3,
  }),
  humanReview: Object.freeze({
    policy: "exceptional-model-threshold-false-positives-only",
    adjudicableFailures: Object.freeze([
      "backtranslation-adequacy-low",
      "language-target-low-confidence",
      "mixed-english",
      "possible-addition",
      "possible-omission",
      "semantic-adequacy-low",
    ]),
    unlistedFailuresAreNonAdjudicable: true,
  }),
  models: Object.freeze({
    language: "fastText lid.176",
    semantic: "sentence-transformers/LaBSE",
    backtranslation: "MADLAD400 3B CTranslate2 int8",
    backtranslationBatchSize: 32,
    backtranslationBeamSize: 1,
    backtranslationMaximumTokens: 512,
  }),
});

export const TRANSLATION_SEMANTIC_AUDIT_RELEASE_WARNINGS = Object.freeze([
  "Automated language, semantic, and backtranslation evidence is not legal advice.",
  "Every legal translation receives stricter independent automated review; exceptional threshold overrides must be exact source/value-bound adjudications.",
  "English policy claims and release suitability still require owner approval and, where appropriate, counsel review.",
] as const);

const MAXIMUM_JSON_BYTES = 64 * 1024 * 1024;
const MAXIMUM_MASTER_BYTES = 160 * 1024 * 1024;
const MAXIMUM_IMPLEMENTATION_BYTES = 4 * 1024 * 1024;
const MAXIMUM_TREE_FILES = 30_000;
const MAXIMUM_TREE_DIRECTORIES = 30_000;
const MAXIMUM_TREE_DEPTH = 64;
const MAXIMUM_TREE_BYTES = 4 * 1024 * 1024 * 1024;
const MAXIMUM_JSON_DEPTH = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
// Python 3.9 is the pinned audit runtime. ECMAScript exposes lowercase but not
// Unicode casefold, so keep the Unicode 13 full-fold differences explicit.
// NFKC runs before this table, matching canonical_afrikaans_pack_context().
const PYTHON_3_9_CASEFOLD_OVERRIDES: Readonly<Record<string, string>> =
  Object.freeze({
    "µ":"μ","ß":"ss","ŉ":"ʼn","ſ":"s","ǰ":"ǰ","ͅ":"ι","ΐ":"ΐ","ΰ":"ΰ","ς":"σ","ϐ":"β","ϑ":"θ","ϕ":"φ","ϖ":"π","ϰ":"κ","ϱ":"ρ","ϵ":"ε","և":"եւ","Ꭰ":"Ꭰ","Ꭱ":"Ꭱ","Ꭲ":"Ꭲ","Ꭳ":"Ꭳ","Ꭴ":"Ꭴ","Ꭵ":"Ꭵ","Ꭶ":"Ꭶ","Ꭷ":"Ꭷ","Ꭸ":"Ꭸ","Ꭹ":"Ꭹ","Ꭺ":"Ꭺ","Ꭻ":"Ꭻ","Ꭼ":"Ꭼ","Ꭽ":"Ꭽ","Ꭾ":"Ꭾ","Ꭿ":"Ꭿ","Ꮀ":"Ꮀ","Ꮁ":"Ꮁ","Ꮂ":"Ꮂ","Ꮃ":"Ꮃ","Ꮄ":"Ꮄ","Ꮅ":"Ꮅ","Ꮆ":"Ꮆ","Ꮇ":"Ꮇ","Ꮈ":"Ꮈ","Ꮉ":"Ꮉ","Ꮊ":"Ꮊ","Ꮋ":"Ꮋ","Ꮌ":"Ꮌ","Ꮍ":"Ꮍ","Ꮎ":"Ꮎ","Ꮏ":"Ꮏ","Ꮐ":"Ꮐ","Ꮑ":"Ꮑ","Ꮒ":"Ꮒ","Ꮓ":"Ꮓ","Ꮔ":"Ꮔ","Ꮕ":"Ꮕ","Ꮖ":"Ꮖ","Ꮗ":"Ꮗ","Ꮘ":"Ꮘ","Ꮙ":"Ꮙ","Ꮚ":"Ꮚ","Ꮛ":"Ꮛ","Ꮜ":"Ꮜ","Ꮝ":"Ꮝ","Ꮞ":"Ꮞ","Ꮟ":"Ꮟ","Ꮠ":"Ꮠ","Ꮡ":"Ꮡ","Ꮢ":"Ꮢ","Ꮣ":"Ꮣ","Ꮤ":"Ꮤ","Ꮥ":"Ꮥ","Ꮦ":"Ꮦ","Ꮧ":"Ꮧ","Ꮨ":"Ꮨ","Ꮩ":"Ꮩ","Ꮪ":"Ꮪ","Ꮫ":"Ꮫ","Ꮬ":"Ꮬ","Ꮭ":"Ꮭ","Ꮮ":"Ꮮ","Ꮯ":"Ꮯ","Ꮰ":"Ꮰ","Ꮱ":"Ꮱ","Ꮲ":"Ꮲ","Ꮳ":"Ꮳ","Ꮴ":"Ꮴ","Ꮵ":"Ꮵ","Ꮶ":"Ꮶ","Ꮷ":"Ꮷ","Ꮸ":"Ꮸ","Ꮹ":"Ꮹ","Ꮺ":"Ꮺ","Ꮻ":"Ꮻ","Ꮼ":"Ꮼ","Ꮽ":"Ꮽ","Ꮾ":"Ꮾ","Ꮿ":"Ꮿ","Ᏸ":"Ᏸ","Ᏹ":"Ᏹ","Ᏺ":"Ᏺ","Ᏻ":"Ᏻ","Ᏼ":"Ᏼ","Ᏽ":"Ᏽ","ᏸ":"Ᏸ","ᏹ":"Ᏹ","ᏺ":"Ᏺ","ᏻ":"Ᏻ","ᏼ":"Ᏼ","ᏽ":"Ᏽ","ᲀ":"в","ᲁ":"д","ᲂ":"о","ᲃ":"с","ᲄ":"т","ᲅ":"т","ᲆ":"ъ","ᲇ":"ѣ","ᲈ":"ꙋ","ẖ":"ẖ","ẗ":"ẗ","ẘ":"ẘ","ẙ":"ẙ","ẚ":"aʾ","ẛ":"ṡ","ẞ":"ss","ὐ":"ὐ","ὒ":"ὒ","ὔ":"ὔ","ὖ":"ὖ","ᾀ":"ἀι","ᾁ":"ἁι","ᾂ":"ἂι","ᾃ":"ἃι","ᾄ":"ἄι","ᾅ":"ἅι","ᾆ":"ἆι","ᾇ":"ἇι","ᾈ":"ἀι","ᾉ":"ἁι","ᾊ":"ἂι","ᾋ":"ἃι","ᾌ":"ἄι","ᾍ":"ἅι","ᾎ":"ἆι","ᾏ":"ἇι","ᾐ":"ἠι","ᾑ":"ἡι","ᾒ":"ἢι","ᾓ":"ἣι","ᾔ":"ἤι","ᾕ":"ἥι","ᾖ":"ἦι","ᾗ":"ἧι","ᾘ":"ἠι","ᾙ":"ἡι","ᾚ":"ἢι","ᾛ":"ἣι","ᾜ":"ἤι","ᾝ":"ἥι","ᾞ":"ἦι","ᾟ":"ἧι","ᾠ":"ὠι","ᾡ":"ὡι","ᾢ":"ὢι","ᾣ":"ὣι","ᾤ":"ὤι","ᾥ":"ὥι","ᾦ":"ὦι","ᾧ":"ὧι","ᾨ":"ὠι","ᾩ":"ὡι","ᾪ":"ὢι","ᾫ":"ὣι","ᾬ":"ὤι","ᾭ":"ὥι","ᾮ":"ὦι","ᾯ":"ὧι","ᾲ":"ὰι","ᾳ":"αι","ᾴ":"άι","ᾶ":"ᾶ","ᾷ":"ᾶι","ᾼ":"αι","ι":"ι","ῂ":"ὴι","ῃ":"ηι","ῄ":"ήι","ῆ":"ῆ","ῇ":"ῆι","ῌ":"ηι","ῒ":"ῒ","ΐ":"ΐ","ῖ":"ῖ","ῗ":"ῗ","ῢ":"ῢ","ΰ":"ΰ","ῤ":"ῤ","ῦ":"ῦ","ῧ":"ῧ","ῲ":"ὼι","ῳ":"ωι","ῴ":"ώι","ῶ":"ῶ","ῷ":"ῶι","ῼ":"ωι","ꭰ":"Ꭰ","ꭱ":"Ꭱ","ꭲ":"Ꭲ","ꭳ":"Ꭳ","ꭴ":"Ꭴ","ꭵ":"Ꭵ","ꭶ":"Ꭶ","ꭷ":"Ꭷ","ꭸ":"Ꭸ","ꭹ":"Ꭹ","ꭺ":"Ꭺ","ꭻ":"Ꭻ","ꭼ":"Ꭼ","ꭽ":"Ꭽ","ꭾ":"Ꭾ","ꭿ":"Ꭿ","ꮀ":"Ꮀ","ꮁ":"Ꮁ","ꮂ":"Ꮂ","ꮃ":"Ꮃ","ꮄ":"Ꮄ","ꮅ":"Ꮅ","ꮆ":"Ꮆ","ꮇ":"Ꮇ","ꮈ":"Ꮈ","ꮉ":"Ꮉ","ꮊ":"Ꮊ","ꮋ":"Ꮋ","ꮌ":"Ꮌ","ꮍ":"Ꮍ","ꮎ":"Ꮎ","ꮏ":"Ꮏ","ꮐ":"Ꮐ","ꮑ":"Ꮑ","ꮒ":"Ꮒ","ꮓ":"Ꮓ","ꮔ":"Ꮔ","ꮕ":"Ꮕ","ꮖ":"Ꮖ","ꮗ":"Ꮗ","ꮘ":"Ꮘ","ꮙ":"Ꮙ","ꮚ":"Ꮚ","ꮛ":"Ꮛ","ꮜ":"Ꮜ","ꮝ":"Ꮝ","ꮞ":"Ꮞ","ꮟ":"Ꮟ","ꮠ":"Ꮠ","ꮡ":"Ꮡ","ꮢ":"Ꮢ","ꮣ":"Ꮣ","ꮤ":"Ꮤ","ꮥ":"Ꮥ","ꮦ":"Ꮦ","ꮧ":"Ꮧ","ꮨ":"Ꮨ","ꮩ":"Ꮩ","ꮪ":"Ꮪ","ꮫ":"Ꮫ","ꮬ":"Ꮬ","ꮭ":"Ꮭ","ꮮ":"Ꮮ","ꮯ":"Ꮯ","ꮰ":"Ꮰ","ꮱ":"Ꮱ","ꮲ":"Ꮲ","ꮳ":"Ꮳ","ꮴ":"Ꮴ","ꮵ":"Ꮵ","ꮶ":"Ꮶ","ꮷ":"Ꮷ","ꮸ":"Ꮸ","ꮹ":"Ꮹ","ꮺ":"Ꮺ","ꮻ":"Ꮻ","ꮼ":"Ꮼ","ꮽ":"Ꮽ","ꮾ":"Ꮾ","ꮿ":"Ꮿ","ﬀ":"ff","ﬁ":"fi","ﬂ":"fl","ﬃ":"ffi","ﬄ":"ffl","ﬅ":"st","ﬆ":"st","ﬓ":"մն","ﬔ":"մե","ﬕ":"մի","ﬖ":"վն","ﬗ":"մխ"
  });
const sha256Schema = z.string().regex(SHA256_PATTERN);
const boundedStringSchema = z.string().max(200_000);
const positiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const localeSchema = z.enum(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES);

export const translationSemanticAuditTreeDigestSchema = z.object({
  exists: z.boolean(),
  sha256: sha256Schema,
  files: nonnegativeIntegerSchema.max(MAXIMUM_TREE_FILES),
  bytes: nonnegativeIntegerSchema.max(MAXIMUM_TREE_BYTES),
}).strict();
const treeEvidenceSchema = translationSemanticAuditTreeDigestSchema.extend({
  path: z.string().min(1).max(4_096),
}).strict();

const afrikaansPackContextSchema = z.object({
  contextSha256: sha256Schema,
  distinctMaskedValues: nonnegativeIntegerSchema.max(20_000),
  maskedLetters: nonnegativeIntegerSchema.max(4_000_000_000),
  eligible: z.boolean(),
  predictions: z.array(z.tuple([
    z.string().min(1).max(32),
    z.number().finite().min(0).max(1),
  ])).max(5),
  gatePassed: z.boolean(),
  rescuedFields: nonnegativeIntegerSchema.max(20_000),
  fieldPairRescuedFields: nonnegativeIntegerSchema.max(20_000),
  trackedCuratedRescuedFields: nonnegativeIntegerSchema.max(20_000),
  referenceMatchFields: nonnegativeIntegerSchema.max(20_000),
  referenceMatchRootSha256: sha256Schema,
  trackedCuratedRescueRootSha256: sha256Schema,
}).strict();

const afrikaansTrackedCuratedSchema = z.object({
  referencePacks: nonnegativeIntegerSchema.max(
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
  ),
  referencePackIdentityRootSha256: sha256Schema,
  referencePackGateEvidenceRootSha256: sha256Schema,
  supportPairCount: nonnegativeIntegerSchema.max(100_000),
  supportPairRootSha256: sha256Schema,
  supportRecordCount: nonnegativeIntegerSchema.max(500_000),
  supportRecordRootSha256: sha256Schema,
  conflictSourceCount: nonnegativeIntegerSchema.max(100_000),
  conflictSourceRootSha256: sha256Schema,
  fieldPairRescuedFields: nonnegativeIntegerSchema.max(500_000),
  trackedCuratedRescuedFields: nonnegativeIntegerSchema.max(500_000),
  trackedCuratedRescueRootSha256: sha256Schema,
}).strict();

const checkpointRescueRecordSchema = z.tuple([
  sha256Schema,
  z.enum(["field-pair", "tracked-curated"]),
  sha256Schema.nullable(),
]);

const checkpointPackRescueRecordSchema = z.object({
  ordinal: positiveIntegerSchema.max(
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
  ),
  locale: localeSchema,
  namespace: z.string().min(1).max(1_024),
  rescueRecordCount: nonnegativeIntegerSchema.max(20_000),
  rescueRecordRootSha256: sha256Schema,
  rescueRecords: z.array(checkpointRescueRecordSchema).max(20_000),
}).strict();

const checkpointEvidenceBindingSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_EVIDENCE_KIND),
  checkpointRootPath: z.string().min(1).max(4_096),
  sessionSha256: sha256Schema,
  sessionRecordSha256: sha256Schema,
  sessionFileSha256: sha256Schema,
  checkpointCount: z.literal(
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
  ),
  terminalCheckpointSha256: sha256Schema,
  checkpointChainRootSha256: sha256Schema,
  packRescueRecordCount: z.literal(
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
  ),
  packRescueRecordRootSha256: sha256Schema,
  fieldPairRescuedFields: nonnegativeIntegerSchema.max(500_000),
  trackedCuratedRescuedFields: nonnegativeIntegerSchema.max(500_000),
}).strict();

const checkpointEvidenceSchema = checkpointEvidenceBindingSchema.extend({
  packRescueRecords: z.array(checkpointPackRescueRecordSchema).length(
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
  ),
}).strict();

const checkpointPredictionSchema = z.tuple([
  z.string().min(1).max(32),
  z.number().finite().min(0).max(1),
]);
const checkpointFieldEvidenceSchema = z.object({
  targetLanguageProbability: z.number().finite().min(0).max(1).nullable(),
  englishProbability: z.number().finite().min(0).max(1).nullable(),
  semanticSimilarity: z.number().finite().min(-1).max(1).nullable(),
  lidApplicable: z.boolean(),
  backtranslationRequired: z.boolean(),
  afrikaansRescueKind: z.enum([
    "none",
    "field-pair",
    "tracked-curated",
  ]),
  supportPairIdentity: sha256Schema.nullable(),
  backtranslationSha256: sha256Schema.optional(),
  backtranslationSimilarity: z.number().finite().min(-1).max(1).optional(),
  backtranslationLengthRatio: z.number().finite().min(0).max(200_000).optional(),
  minimumSourceSentenceAlignment: z.number().finite().min(-1).max(1).optional(),
  minimumBacktranslationSentenceAlignment: z.number().finite().min(-1).max(1).optional(),
}).strict();
const checkpointAlignmentSchema = z.object({
  sourceSentences: z.array(boundedStringSchema).min(1).max(32),
  backtranslationSentences: z.array(boundedStringSchema).min(1).max(32),
  scores: z.array(z.number().finite().min(-1).max(1)).max(1_024),
}).strict();
const checkpointDerivationEvidenceSchema = z.object({
  wholePredictions: z.array(checkpointPredictionSchema).max(5),
  semanticSimilarityRaw: z.number().finite().min(-1).max(1).nullable(),
  mixedChunkPredictions: z.array(
    z.array(checkpointPredictionSchema).max(5),
  ).max(20_000),
  backtranslation: boundedStringSchema.nullable(),
  backtranslationSimilarityRaw: z.number().finite().min(-1).max(1).nullable(),
  alignment: checkpointAlignmentSchema.nullable(),
}).strict();
const checkpointFailureCodeSchema = z.string().min(1).max(128);
const checkpointFieldRowSchema = z.tuple([
  sha256Schema,
  checkpointFieldEvidenceSchema,
  z.array(checkpointFailureCodeSchema).max(64),
  z.array(checkpointFailureCodeSchema).max(64),
  z.array(checkpointFailureCodeSchema).max(64),
]);
const checkpointDerivationRowSchema = z.tuple([
  sha256Schema,
  checkpointDerivationEvidenceSchema,
]);
const checkpointCountsSchema = z.object({
  packs: z.literal(1),
  fields: positiveIntegerSchema.max(20_000),
  candidatePacks: z.union([z.literal(0), z.literal(1)]),
  curatedPacks: z.union([z.literal(0), z.literal(1)]),
  legalFields: nonnegativeIntegerSchema.max(20_000),
  languageEvidenceFields: nonnegativeIntegerSchema.max(20_000),
  backtranslatedFields: nonnegativeIntegerSchema.max(20_000),
  unadjudicatedFields: z.literal(0),
  unadjudicatedFailures: z.literal(0),
  adjudicatedFields: z.literal(0),
  adjudicatedFailures: z.literal(0),
}).strict();
const checkpointTrackedReferencePackSchema = z.object({
  locale: z.literal("af"),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  packFileSha256: sha256Schema,
  fields: positiveIntegerSchema.max(20_000),
  fieldValueRootSha256: sha256Schema,
  contextSha256: sha256Schema,
  distinctMaskedValues: nonnegativeIntegerSchema.max(20_000),
  maskedLetters: nonnegativeIntegerSchema.max(4_000_000_000),
  eligible: z.boolean(),
  predictions: z.array(checkpointPredictionSchema).max(5),
  gatePassed: z.boolean(),
}).strict();
const checkpointTrackedReferenceEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(
    "inspir-afrikaans-tracked-curated-reference-evidence-v1",
  ),
  sessionSha256: sha256Schema,
  referencePackIdentityRootSha256: sha256Schema,
  referencePackGateEvidenceRootSha256: sha256Schema,
  referencePacks: z.array(checkpointTrackedReferencePackSchema).max(
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
  ),
  supportPairCount: nonnegativeIntegerSchema.max(100_000),
  supportPairRootSha256: sha256Schema,
  supportRecordCount: nonnegativeIntegerSchema.max(500_000),
  supportRecordRootSha256: sha256Schema,
  conflictSourceCount: nonnegativeIntegerSchema.max(100_000),
  conflictSourceRootSha256: sha256Schema,
}).strict();
const checkpointSessionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(TRANSLATION_SEMANTIC_AUDIT_SESSION_RECORD_KIND),
  sessionSha256: sha256Schema,
  session: z.record(z.string(), z.unknown()),
  createdAt: z.string().regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/,
  ),
  sessionRecordSha256: sha256Schema,
}).strict();

const packBindingSchema = z.object({
  locale: localeSchema,
  language: z.string().min(1).max(128),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  origin: z.enum(["curated", "candidate"]),
  packFileSha256: sha256Schema,
  fields: positiveIntegerSchema.max(20_000),
  fieldIdentityRootSha256: sha256Schema,
  fieldEvidenceRootSha256: sha256Schema,
  afrikaansPackContext: afrikaansPackContextSchema.nullable(),
  unadjudicatedFields: nonnegativeIntegerSchema.max(20_000),
  adjudicatedFields: nonnegativeIntegerSchema.max(20_000),
}).strict();

const resultCountsSchema = z.object({
  packs: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
  fields: positiveIntegerSchema,
  candidatePacks: nonnegativeIntegerSchema,
  curatedPacks: nonnegativeIntegerSchema,
  legalFields: nonnegativeIntegerSchema,
  languageEvidenceFields: nonnegativeIntegerSchema,
  backtranslatedFields: nonnegativeIntegerSchema,
  unadjudicatedFields: z.literal(0),
  unadjudicatedFailures: z.literal(0),
  adjudicatedFields: z.literal(0),
  adjudicatedFailures: z.literal(0),
}).strict();

const failureRecordSchema = z.object({
  identitySha256: sha256Schema,
  locale: localeSchema,
  namespace: z.string().min(1).max(1_024),
  key: z.string().min(1).max(1_024),
  sourceSha256: sha256Schema,
  valueSha256: sha256Schema,
  failureCodes: z.array(z.string().min(1).max(128)).min(1).max(64),
}).strict();

const checkpointSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_KIND),
  sessionSha256: sha256Schema,
  ordinal: positiveIntegerSchema.max(
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
  ),
  totalPacks: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
  packInputSha256: sha256Schema,
  previousCheckpointSha256: sha256Schema.nullable(),
  packBinding: packBindingSchema,
  trackedAfrikaansReferences: checkpointTrackedReferenceEvidenceSchema,
  counts: checkpointCountsSchema,
  fieldEvidenceRows: z.array(checkpointFieldRowSchema).min(1).max(20_000),
  derivationEvidenceRows: z.array(checkpointDerivationRowSchema).min(1).max(20_000),
  failureRecords: z.object({
    records: z.array(failureRecordSchema).max(20_000),
    codeCounts: z.record(z.string().min(1).max(128), nonnegativeIntegerSchema),
    adjudicatedCodeCounts: z.record(
      z.string().min(1).max(128),
      nonnegativeIntegerSchema,
    ),
  }).strict(),
  consumedAdjudications: z.array(sha256Schema).max(20_000),
  checkpointSha256: sha256Schema,
}).strict();

const afrikaansCheckpointEvidenceBindingSchema =
  checkpointEvidenceBindingSchema.extend({
    checkpointCount: z.literal(
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
    ),
    packRescueRecordCount: z.literal(
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
    ),
  }).strict();

const afrikaansCheckpointEvidenceSchema =
  afrikaansCheckpointEvidenceBindingSchema.extend({
    packRescueRecords: z.array(checkpointPackRescueRecordSchema).length(
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
    ),
  }).strict();

const afrikaansCheckpointSchema = checkpointSchema.extend({
  ordinal: positiveIntegerSchema.max(
    TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
  ),
  totalPacks: z.literal(
    TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
  ),
}).strict();

const afrikaansResultCountsSchema = resultCountsSchema.extend({
  packs: z.literal(
    TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
  ),
  fields: z.literal(
    TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
  ),
  candidatePacks: z.literal(
    TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
  ),
  curatedPacks: z.literal(
    TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT,
  ),
}).strict();

const emptyCountMapSchema = z.record(z.string().min(1).max(128), nonnegativeIntegerSchema)
  .refine((value) => Object.keys(value).length === 0, "Failure code counts must be empty.");

export const translationSemanticAuditManifestSchema = z.object({
  schemaVersion: z.literal(TRANSLATION_SEMANTIC_AUDIT_SCHEMA_VERSION),
  kind: z.literal(TRANSLATION_SEMANTIC_AUDIT_KIND),
  auditVersion: z.literal(TRANSLATION_SEMANTIC_AUDIT_VERSION),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/),
  scope: z.object({
    name: z.literal("full"),
    locales: z.array(localeSchema).length(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length),
    namespaces: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT),
    packs: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
    fields: positiveIntegerSchema,
  }).strict(),
  policy: z.object({
    sha256: sha256Schema,
    implementationSha256: sha256Schema,
    value: z.record(z.string(), z.unknown()),
  }).strict(),
  models: z.object({
    modelLockSha256: sha256Schema,
    fasttext: z.object({
      label: z.literal("fastText lid.176"),
      sha256: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.fasttextSha256,
      ),
    }).strict(),
    labse: z.object({
      label: z.literal("sentence-transformers/LaBSE"),
      treeSha256: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.labseTreeSha256,
      ),
    }).strict(),
    madlad: z.object({
      label: z.literal("MADLAD400 3B CTranslate2 int8"),
      treeSha256: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.madladTreeSha256,
      ),
    }).strict(),
    runtimeVersions: z.object({
      ctranslate2: z.literal(EXPECTED_RUNTIME_VERSIONS.ctranslate2),
      fasttext: z.literal(EXPECTED_RUNTIME_VERSIONS.fasttext),
      numpy: z.literal(EXPECTED_RUNTIME_VERSIONS.numpy),
      safetensors: z.literal(EXPECTED_RUNTIME_VERSIONS.safetensors),
      torch: z.literal(EXPECTED_RUNTIME_VERSIONS.torch),
      transformers: z.literal(EXPECTED_RUNTIME_VERSIONS.transformers),
    }).strict(),
  }).strict(),
  inputs: z.object({
    masterWorklist: z.object({
      path: z.string().min(1).max(4_096),
      fileSha256: sha256Schema,
      worklistSha256: sha256Schema,
      generatorExecutionProfile: longTailNllbExecutionProfileSchema,
      generatorExecutionProfileSha256: z.literal(
        LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
      ),
    }).strict(),
    curatedTree: treeEvidenceSchema,
    staticMainAppTree: treeEvidenceSchema,
    candidateTree: treeEvidenceSchema,
    packWorklistTree: treeEvidenceSchema,
    adjudicationSha256: z.null(),
  }).strict(),
  results: z.object({
    passed: z.literal(true),
    counts: resultCountsSchema,
    packIdentityRootSha256: sha256Schema,
    packEvidenceRootSha256: sha256Schema,
    packBindings: z.array(packBindingSchema).length(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
    afrikaansTrackedCurated: afrikaansTrackedCuratedSchema,
    checkpointEvidence: checkpointEvidenceSchema,
    failureRecords: z.object({
      count: z.literal(0),
      sha256: sha256Schema,
      codeCounts: emptyCountMapSchema,
      adjudicatedCodeCounts: emptyCountMapSchema,
      samples: z.array(failureRecordSchema).length(0),
      omittedSamples: z.literal(0),
    }).strict(),
  }).strict(),
  releaseWarnings: z.tuple([
    z.literal(TRANSLATION_SEMANTIC_AUDIT_RELEASE_WARNINGS[0]),
    z.literal(TRANSLATION_SEMANTIC_AUDIT_RELEASE_WARNINGS[1]),
    z.literal(TRANSLATION_SEMANTIC_AUDIT_RELEASE_WARNINGS[2]),
  ]),
  manifestSha256: sha256Schema,
}).strict();

export type TranslationSemanticAuditManifest = z.infer<
  typeof translationSemanticAuditManifestSchema
>;

export const afrikaansTranslationSemanticAuditManifestSchema =
  translationSemanticAuditManifestSchema.omit({
    scope: true,
    results: true,
  }).extend({
    scope: z.object({
      name: z.literal("afrikaans-smoke"),
      locales: z.tuple([z.literal("af")]),
      namespaces: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
      ),
      packs: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
      ),
      fields: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
      ),
    }).strict(),
    results: z.object({
      passed: z.literal(true),
      counts: afrikaansResultCountsSchema,
      packIdentityRootSha256: sha256Schema,
      packEvidenceRootSha256: sha256Schema,
      packBindings: z.array(packBindingSchema).length(
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
      ),
      afrikaansTrackedCurated: afrikaansTrackedCuratedSchema,
      checkpointEvidence: afrikaansCheckpointEvidenceSchema,
      failureRecords: z.object({
        count: z.literal(0),
        sha256: sha256Schema,
        codeCounts: emptyCountMapSchema,
        adjudicatedCodeCounts: emptyCountMapSchema,
        samples: z.array(failureRecordSchema).length(0),
        omittedSamples: z.literal(0),
      }).strict(),
    }).strict(),
  }).strict();

export type AfrikaansTranslationSemanticAuditManifest = z.infer<
  typeof afrikaansTranslationSemanticAuditManifestSchema
>;

type AnyTranslationSemanticAuditManifest =
  | TranslationSemanticAuditManifest
  | AfrikaansTranslationSemanticAuditManifest;

export const TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND =
  "inspir-translation-semantic-promotion-evidence-v2" as const;

const semanticPromotionEvidenceMaterialSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal(TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND),
  manifestSha256: sha256Schema,
  masterWorklistSha256: sha256Schema,
  generatorExecutionProfile: longTailNllbExecutionProfileSchema,
  generatorExecutionProfileSha256: z.literal(
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  ),
  auditVersion: z.literal(TRANSLATION_SEMANTIC_AUDIT_VERSION),
  auditPolicySha256: sha256Schema,
  auditImplementationSha256: sha256Schema,
  verifierImplementationSha256: sha256Schema,
  modelLockSha256: sha256Schema,
  modelDigests: z.object({
    fasttextSha256: z.literal(
      TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.fasttextSha256,
    ),
    labseTreeSha256: z.literal(
      TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.labseTreeSha256,
    ),
    madladTreeSha256: z.literal(
      TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.madladTreeSha256,
    ),
  }).strict(),
  runtimeVersions: z.object({
    ctranslate2: z.literal(EXPECTED_RUNTIME_VERSIONS.ctranslate2),
    fasttext: z.literal(EXPECTED_RUNTIME_VERSIONS.fasttext),
    numpy: z.literal(EXPECTED_RUNTIME_VERSIONS.numpy),
    safetensors: z.literal(EXPECTED_RUNTIME_VERSIONS.safetensors),
    torch: z.literal(EXPECTED_RUNTIME_VERSIONS.torch),
    transformers: z.literal(EXPECTED_RUNTIME_VERSIONS.transformers),
  }).strict(),
  scope: z.object({
    locales: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length),
    namespaces: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT),
    packs: z.literal(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
    fields: positiveIntegerSchema,
    candidatePacks: nonnegativeIntegerSchema,
    curatedPacks: nonnegativeIntegerSchema,
  }).strict(),
  inputTrees: z.object({
    curated: translationSemanticAuditTreeDigestSchema,
    staticMainApp: translationSemanticAuditTreeDigestSchema,
    candidates: translationSemanticAuditTreeDigestSchema,
    packWorklists: translationSemanticAuditTreeDigestSchema,
  }).strict(),
  siteSourceCatalog: z.object({
    path: z.literal(
      TRANSLATION_SEMANTIC_AUDIT_SITE_SOURCE_MANIFEST_RELATIVE_PATH,
    ),
    fileSha256: sha256Schema,
    catalogRootSha256: sha256Schema,
    namespaces: z.literal(
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT - 1,
    ),
    fields: positiveIntegerSchema,
  }).strict(),
  packIdentityRootSha256: sha256Schema,
  packEvidenceRootSha256: sha256Schema,
  afrikaansTrackedCurated: afrikaansTrackedCuratedSchema,
  checkpointEvidence: checkpointEvidenceBindingSchema,
}).strict();

export const translationSemanticPromotionEvidenceSchema =
  semanticPromotionEvidenceMaterialSchema.extend({
    semanticEvidenceSha256: sha256Schema,
  }).strict();

export type TranslationSemanticPromotionEvidence = z.infer<
  typeof translationSemanticPromotionEvidenceSchema
>;

export const AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND =
  "inspir-afrikaans-staged-semantic-promotion-evidence-v1" as const;

const afrikaansSemanticPromotionEvidenceMaterialSchema =
  semanticPromotionEvidenceMaterialSchema.omit({
    schemaVersion: true,
    kind: true,
    scope: true,
    checkpointEvidence: true,
  }).extend({
    schemaVersion: z.literal(1),
    kind: z.literal(
      AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
    ),
    scope: z.object({
      locales: z.literal(1),
      namespaces: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
      ),
      packs: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
      ),
      fields: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
      ),
      candidatePacks: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
      ),
      curatedPacks: z.literal(
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT,
      ),
    }).strict(),
    checkpointEvidence: afrikaansCheckpointEvidenceBindingSchema,
  }).strict();

export const afrikaansTranslationSemanticPromotionEvidenceSchema =
  afrikaansSemanticPromotionEvidenceMaterialSchema.extend({
    semanticEvidenceSha256: sha256Schema,
  }).strict();

export type AfrikaansTranslationSemanticPromotionEvidence = z.infer<
  typeof afrikaansTranslationSemanticPromotionEvidenceSchema
>;

export const translationSemanticPromotionEvidenceUnionSchema =
  z.discriminatedUnion("kind", [
    translationSemanticPromotionEvidenceSchema,
    afrikaansTranslationSemanticPromotionEvidenceSchema,
  ]);

export type TranslationSemanticPromotionEvidenceUnion = z.infer<
  typeof translationSemanticPromotionEvidenceUnionSchema
>;

const protectedSegmentSchema = z.object({
  kind: z.enum(["text", "literal"]),
  value: boundedStringSchema,
}).strict();

type ProtectedSourceSpan = Readonly<{
  start: number;
  end: number;
  value: string;
  priority: number;
}>;

// This is intentionally independent of the candidate generator. A final audit
// must not trust a worklist that reclassifies arbitrary source prose as a
// protected literal and then consistently rehashes every downstream artifact.
const AUDIT_PROTECTED_SOURCE_PATTERNS = [
  { pattern: /<!--[\s\S]*?-->|<!DOCTYPE\s+[^>]+>|<\/?[A-Za-z][^<>]*>/g, priority: 0 },
  { pattern: /\{[A-Za-z0-9_]+\}|\$\{[A-Za-z0-9_.]+\}/g, priority: 1 },
  { pattern: /%(?:\d+\$)?[sdif]/g, priority: 1 },
  { pattern: /https?:\/\/[^\s<>"']+/giu, priority: 1 },
  { pattern: /(?:mailto:|tel:)[^\s<>"']+/giu, priority: 1 },
  { pattern: /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, priority: 1 },
  { pattern: /\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}\b/giu, priority: 1 },
  { pattern: /`[^`\n]+`/g, priority: 1 },
  { pattern: /\\u[0-9a-fA-F]{4}/g, priority: 1 },
  { pattern: /&(?:[A-Za-z][A-Za-z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);/g, priority: 1 },
  {
    pattern:
      /(?<![\p{L}\p{N}+\-])\/(?:[a-z_][a-z0-9_.-]*\/)*(?:[a-z_][a-z0-9_.?=&%#-]*)/giu,
    priority: 2,
  },
  {
    pattern:
      /\b(?:29AAWFG7015K1ZQ|American Express|ChatGPT|Dailyhunt|DeepHack|Great Indian Company|GitHub|Google|Holding Partnership Firm|Mastercard|OpenAI|Visa)\b/giu,
    priority: 2,
  },
  { pattern: /(?<![A-Za-z])inspir(?![A-Za-z])/giu, priority: 2 },
  {
    pattern:
      /[+\-\u2212]?\p{Nd}+(?:[.,\u060c\u066b\u066c:/-]\p{Nd}+)*(?:\s*[%\u066a])?/gu,
    priority: 3,
  },
] as const;

export function deriveTranslationSemanticAuditProtectedSourceText(
  source: string,
): Readonly<{
  segments: readonly z.infer<typeof protectedSegmentSchema>[];
  invariantSha256: string;
}> {
  const spans: ProtectedSourceSpan[] = [];
  for (const { pattern, priority } of AUDIT_PROTECTED_SOURCE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined || !match[0]) continue;
      spans.push(Object.freeze({
        start: match.index,
        end: match.index + match[0].length,
        value: match[0],
        priority,
      }));
    }
  }
  spans.sort((left, right) =>
    left.start - right.start ||
    left.priority - right.priority ||
    right.end - right.start - (left.end - left.start)
  );
  const selected: ProtectedSourceSpan[] = [];
  let claimedUntil = 0;
  for (const span of spans) {
    if (span.start < claimedUntil) continue;
    selected.push(span);
    claimedUntil = span.end;
  }
  const segments: z.infer<typeof protectedSegmentSchema>[] = [];
  let cursor = 0;
  for (const span of selected) {
    if (span.start > cursor) {
      segments.push({ kind: "text", value: source.slice(cursor, span.start) });
    }
    segments.push({ kind: "literal", value: span.value });
    cursor = span.end;
  }
  if (cursor < source.length) {
    segments.push({ kind: "text", value: source.slice(cursor) });
  }
  if (segments.length === 0) segments.push({ kind: "text", value: source });
  const immutableSegments = Object.freeze(
    segments.map((segment) => Object.freeze(segment)),
  );
  return Object.freeze({
    segments: immutableSegments,
    invariantSha256: sha256CanonicalTranslationAuditJson(
      immutableSegments
        .filter((segment) => segment.kind === "literal")
        .map((segment) => segment.value),
    ),
  });
}

const sourceEntrySchema = z.object({
  key: z.string().min(1).max(1_024),
  source: boundedStringSchema,
  sourceSha256: sha256Schema,
  invariantSha256: sha256Schema,
  segments: z.array(protectedSegmentSchema).min(1).max(20_000),
}).strict();
const sourceSchema = z.object({
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  entries: z.array(sourceEntrySchema).min(1).max(20_000),
}).strict();
const relativePathSchema = z.string().min(1).max(4_096).refine(isSafeRelativePath);
const sourceStaleReplacementSchema = z.object({
  kind: z.literal("inspir-long-tail-source-stale-replacement-v1"),
  existingFileSha256: sha256Schema,
  priorSourceHash: sha256Schema,
}).strict();
const qualityStaleReplacementSchema = z.object({
  kind: z.literal("inspir-long-tail-quality-stale-replacement-v1"),
  existingFileSha256: sha256Schema,
  sourceHash: sha256Schema,
  validatorPolicySha256: sha256Schema,
}).strict();
const generatorValidatorPolicySchema = z.object({
  kind: z.literal("inspir-long-tail-validator-policy-v1"),
  files: z.array(z.object({
    relativePath: relativePathSchema,
    bytes: nonnegativeIntegerSchema.max(MAXIMUM_JSON_BYTES),
    sha256: sha256Schema,
  }).strict()).length(7),
  validatorPolicySha256: sha256Schema,
}).strict();
const generatorGenerationConfigSchema = z.object({
  batchSize: positiveIntegerSchema.max(256),
  numBeams: positiveIntegerSchema.max(8),
  noRepeatNgramSize: nonnegativeIntegerSchema.max(16),
  dtype: z.enum(["float16", "float32"]),
  device: z.enum(["auto", "cpu", "mps"]),
  maxSourceTokens: positiveIntegerSchema.max(1_022),
  maxNewTokens: positiveIntegerSchema.max(1_022),
  maxRetryAttempts: positiveIntegerSchema.max(3),
  deterministicAlgorithms: z.literal(true),
  manualSeed: z.literal(0),
}).strict();
const longTailGeneratorProvenanceSchema = z.object({
  pipelineVersion: z.literal(LONG_TAIL_TRANSLATION_PIPELINE_VERSION),
  executionProfile: longTailNllbExecutionProfileSchema,
  protectorVersion: z.literal("inspir-long-tail-literal-protector-v1"),
  protectorSha256: sha256Schema,
  pipelineImplementationSha256: sha256Schema,
  workerImplementationSha256: sha256Schema,
  validatorPolicy: generatorValidatorPolicySchema,
  modelLabel: z.string().min(1).max(256),
  modelSha256: sha256Schema,
  seedMemorySha256: sha256Schema,
  seedMemoryEntries: nonnegativeIntegerSchema.max(500_000),
  seedMemoryConflicts: nonnegativeIntegerSchema.max(500_000),
  generationOverridesSha256: sha256Schema,
  generationOverrideEntries: nonnegativeIntegerSchema.max(64),
  generationConfig: generatorGenerationConfigSchema,
}).strict();
export function assertCurrentTranslationSemanticGeneratorProvenance(
  value: unknown,
): void {
  const provenance = longTailGeneratorProvenanceSchema.parse(value);
  parseLongTailNllbExecutionProfile(provenance.executionProfile);
}
const jobMaterialSchema = z.object({
  language: z.string().min(1).max(128),
  locale: localeSchema,
  nllbCode: z.string().min(1).max(64),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  entryCount: positiveIntegerSchema.max(20_000),
  worklistRelativePath: relativePathSchema,
  candidateRelativePath: relativePathSchema,
  targetRelativePath: relativePathSchema,
  replacement: z.union([sourceStaleReplacementSchema, qualityStaleReplacementSchema]).optional(),
}).strict();
const jobSchema = jobMaterialSchema.extend({ jobSha256: sha256Schema }).strict();
const masterSeedEntrySchema = z.object({
  language: z.string().min(1).max(128),
  locale: localeSchema,
  source: boundedStringSchema,
  sourceSha256: sha256Schema,
  value: z.string().min(1).max(200_000),
  valueSha256: sha256Schema,
}).strict();
const masterSeedConflictSchema = z.object({
  language: z.string().min(1).max(128),
  locale: localeSchema,
  sourceSha256: sha256Schema,
}).strict();
const masterSeedMemorySchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("inspir-long-tail-translation-seed-memory-v1"),
  entries: z.array(masterSeedEntrySchema).max(500_000),
  conflicts: z.array(masterSeedConflictSchema).max(500_000),
  seedMemorySha256: sha256Schema,
}).strict();
const masterGenerationOverrideOccurrenceSchema = z.object({
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  key: z.string().min(1).max(1_024),
}).strict();
const masterGenerationOverrideEntrySchema = masterSeedEntrySchema.extend({
  requiredOccurrences: z.array(masterGenerationOverrideOccurrenceSchema)
    .min(1)
    .max(100),
}).strict();
const masterGenerationOverridesSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("inspir-long-tail-generation-overrides-v1"),
  entries: z.array(masterGenerationOverrideEntrySchema).max(64),
  generationOverridesSha256: sha256Schema,
}).strict();
const CURRENT_GENERATION_OVERRIDE_ENTRIES = 10;
const CURRENT_GENERATION_OVERRIDE_BINDING_SHA256 =
  "3f8cfb3438f54bad2676a5869a60948989c7313a9bbd4634e2a6e409dadb55c5";
const CURRENT_GENERATION_OVERRIDE_VALUE_SHA256_BY_SOURCE = new Map<string, string>([
  ["8e227ba67e984856c878dc5209abe51751c834ad4f5742239e4f482175aef2a3", "a12cb2b04be6637fc9c542ed89816dcbc47f2073fed7cd425f3fcd2e54ceec06"],
  ["f20e1ae1b0659633731779b7e2a20b3f586d09b582c1f57160905cd6618e0e17", "7b52389138278c3b190e4caa1d23760c69d123efa9234bf0fbe519ad753bbaa3"],
  ["f29c6dd11a9cb5a2e3134f68923ee2bf46dfb03233002dc2eee1a05088a51396", "3b0c87fb7a637bbbfb48341a5b5935e4191bfebec04f145e6bab130134be89d0"],
  ["f2dd0879eda2a2159b958b34e01896ce68879c683a7ecb35f3044d2e4774f19e", "90a1781478c0fadd3476793b039670812152c68d9683a3ca29400594640368b6"],
  ["f5ba6c92e3394f99029e39962d75cd0f6c29beb36ee00ad7391548a9a912d847", "f10534aa4fa724db16086e1f6ecc01eb780be4ab212c9e6b944b20b49a471fb6"],
  ["f6cea7a517ad59034fc3154fe4d97f83a1923390b1ead3fd12414f5b20618645", "6ff166c64e9b29c9767206ee17b6559b42ea08dc37675082245a2e3f654b12f4"],
  ["fb14c9272c033b45dbc06016367bf68d312a4d0f8de61b5991f383c26084aaf7", "1d68db3fd21cd5277401fb2e0271357787ec9262656882df18a04b67db7a950e"],
  ["fbb48c0f62b2d0866c8618a1a2eef5b6f11d7999518bacf20abe638c0ade274f", "6bab86f06e71bf38fd79dd1021f99c462bdf5742c9c02f892c12077ff8f1439f"],
  ["fc6bff84341dbb08437a1ec23f662a8064b07d38c23097a29216b1b2883bee79", "63f0fccf816c452e43451d8a3d422f637e215afe88cc38a047bba635b29830f9"],
  ["fc7e2f06c58930f1e58c65b27d7fff131d5badddd5e91bf72edc35b238bf3820", "24de7171c86b64dbc662be2e6104e345d5f3947f6b97eb80a2d2d46dc8efc681"],
] as const);
const CURRENT_GENERATION_OVERRIDE_SOURCE_SHA256S = new Set<string>(
  CURRENT_GENERATION_OVERRIDE_VALUE_SHA256_BY_SOURCE.keys(),
);
const masterWorklistSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("inspir-long-tail-translation-worklist-v1"),
  provenance: longTailGeneratorProvenanceSchema,
  seedMemory: masterSeedMemorySchema,
  generationOverrides: masterGenerationOverridesSchema,
  sources: z.array(sourceSchema).length(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT),
  jobs: z.array(jobSchema).max(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
  worklistSha256: sha256Schema,
}).strict();
const masterGenerationOverrideProjectionSchema = z.object({
  provenance: longTailGeneratorProvenanceSchema,
  seedMemory: masterSeedMemorySchema,
  generationOverrides: masterGenerationOverridesSchema,
  sources: z.array(sourceSchema)
    .max(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT),
  jobs: z.array(jobSchema).max(TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT),
}).strict();
const packWorklistMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("inspir-long-tail-translation-pack-worklist-v1"),
  masterWorklistSha256: sha256Schema,
  provenance: z.record(z.string(), z.unknown()),
  job: z.record(z.string(), z.unknown()),
  source: z.record(z.string(), z.unknown()),
}).strict();
const packWorklistSchema = packWorklistMaterialSchema.extend({
  packWorklistSha256: sha256Schema,
}).strict();

type StableIdentity = Readonly<{
  device: bigint;
  inode: bigint;
  mode: bigint;
  links: bigint;
  bytes: bigint;
  modifiedNanoseconds: bigint;
  changedNanoseconds: bigint;
}>;

type StableFile = Readonly<{
  path: string;
  bytes: Buffer;
  sha256: string;
  identity: StableIdentity;
}>;

type TreeFile = Readonly<{
  relativePath: string;
  bytes: number;
  sha256: string;
  identity: StableIdentity;
}>;

type TreeSnapshot = Readonly<{
  exists: boolean;
  sha256: string;
  files: number;
  bytes: number;
  rows: readonly TreeFile[];
  directories: readonly (readonly [string, StableIdentity])[];
}>;

export type VerifyTranslationSemanticAuditInput = Readonly<{
  workspaceRoot: string;
  runRoot: string;
  committedPromotionEvidence?: TranslationSemanticPromotionEvidence;
  raceHook?: (
    point: "after-pack-collection-before-final-stability-check",
  ) => void;
}>;

export type VerifiedTranslationSemanticAudit = Readonly<{
  manifest: TranslationSemanticAuditManifest;
  promotionEvidence: TranslationSemanticPromotionEvidence;
  manifestPath: string;
  manifestSha256: string;
  masterWorklistSha256: string;
  fields: number;
  packs: typeof TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT;
}>;

export type VerifyAfrikaansTranslationSemanticAuditInput = Readonly<{
  workspaceRoot: string;
  runRoot: string;
  committedPromotionEvidence?:
    AfrikaansTranslationSemanticPromotionEvidence;
  raceHook?: (
    point: "after-pack-collection-before-final-stability-check",
  ) => void;
}>;

export type VerifiedAfrikaansTranslationSemanticAudit = Readonly<{
  manifest: AfrikaansTranslationSemanticAuditManifest;
  promotionEvidence: AfrikaansTranslationSemanticPromotionEvidence;
  manifestPath: string;
  manifestSha256: string;
  masterWorklistSha256: string;
  fields: typeof TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT;
  packs: typeof TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT;
}>;

type SemanticAuditScopeConfiguration = Readonly<{
  name: "full" | "afrikaans-smoke";
  manifestBasename:
    | typeof TRANSLATION_SEMANTIC_AUDIT_FULL_MANIFEST_BASENAME
    | typeof TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_MANIFEST_BASENAME;
  checkpointRootBasename:
    | typeof TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_ROOT_BASENAME
    | typeof TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_CHECKPOINT_ROOT_BASENAME;
  locales: readonly (keyof typeof LANGUAGE_BY_LOCALE)[];
  packs: number;
  fields: number | null;
}>;

const FULL_SEMANTIC_AUDIT_SCOPE: SemanticAuditScopeConfiguration =
  Object.freeze({
    name: "full",
    manifestBasename:
      TRANSLATION_SEMANTIC_AUDIT_FULL_MANIFEST_BASENAME,
    checkpointRootBasename:
      TRANSLATION_SEMANTIC_AUDIT_CHECKPOINT_ROOT_BASENAME,
    locales: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES,
    packs: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
    fields: null,
  });

const AFRIKAANS_SEMANTIC_AUDIT_SCOPE: SemanticAuditScopeConfiguration =
  Object.freeze({
    name: "afrikaans-smoke",
    manifestBasename:
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_MANIFEST_BASENAME,
    checkpointRootBasename:
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_CHECKPOINT_ROOT_BASENAME,
    locales: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_LOCALES,
    packs: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
    fields: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
  });

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalTranslationAuditJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot contain a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalTranslationAuditJson(entry)).join(",")}]`;
  }
  if (isJsonRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalTranslationAuditJson(value[key])}`
    ).join(",")}}`;
  }
  throw new Error("Canonical JSON encountered a non-JSON value.");
}

export function sha256CanonicalTranslationAuditJson(value: unknown): string {
  return sha256Bytes(Buffer.from(canonicalTranslationAuditJson(value), "utf8"));
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSafeRelativePath(value: string): boolean {
  return Boolean(value) &&
    !value.includes("\u0000") &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function translationSemanticAuditPackBasename(namespace: string): string {
  const safe = namespace.replace(/[^a-z0-9.\-]+/gi, "__");
  if (safe === "" || safe === "." || safe === "..") {
    throw new Error("Translation namespace cannot produce a safe filename.");
  }
  return `${safe}.json`;
}

export function isTranslationSemanticAuditPackBasename(
  basename: string,
  namespace: string,
  allowParts: boolean,
): boolean {
  const exact = translationSemanticAuditPackBasename(namespace);
  if (basename === exact) return true;
  if (!allowParts) return false;
  const stem = exact.slice(0, -".json".length);
  const prefix = `${stem}.part-`;
  return basename.startsWith(prefix) &&
    /^[1-9][0-9]*\.json$/.test(basename.slice(prefix.length));
}

function identity(metadata: BigIntStats): StableIdentity {
  return Object.freeze({
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode,
    links: metadata.nlink,
    bytes: metadata.size,
    modifiedNanoseconds: metadata.mtimeNs,
    changedNanoseconds: metadata.ctimeNs,
  });
}

function sameIdentity(first: StableIdentity, second: StableIdentity): boolean {
  return first.device === second.device && first.inode === second.inode &&
    first.mode === second.mode && first.links === second.links &&
    first.bytes === second.bytes &&
    first.modifiedNanoseconds === second.modifiedNanoseconds &&
    first.changedNanoseconds === second.changedNanoseconds;
}

function assertNoSymlinkComponents(targetPath: string, label: string): void {
  const absolute = path.resolve(targetPath);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let metadata: BigIntStats;
    try {
      metadata = lstatSync(current, { bigint: true });
    } catch {
      throw new Error(`${label} does not exist: ${current}`);
    }
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic-link component: ${current}`);
    }
  }
}

function stableRegularIdentity(metadata: BigIntStats, label: string): StableIdentity {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== BigInt(1)
  ) {
    throw new Error(`${label} must be a single-link regular file.`);
  }
  return identity(metadata);
}

function readStableRegularFile(
  filePath: string,
  maximumBytes: number,
  label: string,
  requiredMode?: number,
): StableFile {
  assertNoSymlinkComponents(filePath, label);
  const before = stableRegularIdentity(lstatSync(filePath, { bigint: true }), label);
  if (before.bytes > BigInt(maximumBytes)) {
    throw new Error(`${label} exceeds its byte bound.`);
  }
  if (
    requiredMode !== undefined &&
    Number(before.mode & BigInt(0o777)) !== requiredMode
  ) {
    throw new Error(`${label} permissions must be ${requiredMode.toString(8)}.`);
  }
  const descriptor = openSync(
    filePath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  let bytes: Buffer;
  let opened: StableIdentity;
  let afterRead: StableIdentity;
  try {
    opened = stableRegularIdentity(fstatSync(descriptor, { bigint: true }), label);
    if (opened.bytes > BigInt(maximumBytes)) {
      throw new Error(`${label} exceeds its opened byte bound.`);
    }
    const expectedBytes = Number(opened.bytes);
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
      if (count === 0) throw new Error(`${label} was truncated while reading.`);
      offset += count;
    }
    const growthProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, growthProbe, 0, 1, null) !== 0) {
      throw new Error(`${label} grew while reading.`);
    }
    afterRead = stableRegularIdentity(fstatSync(descriptor, { bigint: true }), label);
  } finally {
    closeSync(descriptor);
  }
  const afterPath = stableRegularIdentity(lstatSync(filePath, { bigint: true }), label);
  if (!sameIdentity(before, opened) || !sameIdentity(opened, afterRead) ||
      !sameIdentity(afterRead, afterPath) || BigInt(bytes.byteLength) !== afterPath.bytes) {
    throw new Error(`${label} changed while it was read.`);
  }
  return Object.freeze({
    path: filePath,
    bytes,
    sha256: sha256Bytes(bytes),
    identity: afterPath,
  });
}

export function parseStrictTranslationSemanticJsonBytes(
  raw: Buffer,
  label: string,
): unknown {
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) {
    throw new Error(`${label} is not valid UTF-8.`);
  }
  const scanner = new StrictJsonScanner(text, label);
  scanner.scan();
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const strictJson = parseStrictTranslationSemanticJsonBytes;

class StrictJsonScanner {
  private index = 0;
  constructor(private readonly raw: string, private readonly label: string) {}

  scan(): void {
    this.whitespace();
    this.value(0);
    this.whitespace();
    if (this.index !== this.raw.length) this.fail("has trailing JSON data");
  }

  private value(depth: number): void {
    if (depth > MAXIMUM_JSON_DEPTH) this.fail("exceeds the JSON nesting bound");
    const token = this.raw[this.index];
    if (token === "{") return this.object(depth + 1);
    if (token === "[") return this.array(depth + 1);
    if (token === '"') { this.string(); return; }
    if (token === "t") return this.literal("true");
    if (token === "f") return this.literal("false");
    if (token === "n") return this.literal("null");
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      this.number(); return;
    }
    this.fail("contains an invalid JSON token");
  }

  private object(depth: number): void {
    this.index += 1; this.whitespace();
    const keys = new Set<string>();
    if (this.raw[this.index] === "}") { this.index += 1; return; }
    for (;;) {
      if (this.raw[this.index] !== '"') this.fail("contains an invalid object key");
      const key = this.string();
      if (keys.has(key)) this.fail(`contains duplicate JSON key ${JSON.stringify(key)}`);
      keys.add(key); this.whitespace();
      if (this.raw[this.index] !== ":") this.fail("contains an invalid object separator");
      this.index += 1; this.whitespace(); this.value(depth); this.whitespace();
      if (this.raw[this.index] === "}") { this.index += 1; return; }
      if (this.raw[this.index] !== ",") this.fail("contains an invalid object delimiter");
      this.index += 1; this.whitespace();
    }
  }

  private array(depth: number): void {
    this.index += 1; this.whitespace();
    if (this.raw[this.index] === "]") { this.index += 1; return; }
    for (;;) {
      this.value(depth); this.whitespace();
      if (this.raw[this.index] === "]") { this.index += 1; return; }
      if (this.raw[this.index] !== ",") this.fail("contains an invalid array delimiter");
      this.index += 1; this.whitespace();
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    for (;;) {
      const character = this.raw[this.index];
      if (character === undefined || character < " ") this.fail("contains an invalid JSON string");
      if (character === '"') {
        this.index += 1;
        const decoded: unknown = JSON.parse(this.raw.slice(start, this.index));
        if (typeof decoded !== "string") this.fail("contains an invalid JSON string");
        return decoded;
      }
      if (character === "\\") {
        this.index += 1;
        const escaped = this.raw[this.index];
        if (escaped === "u") {
          if (!/^[a-fA-F0-9]{4}$/.test(this.raw.slice(this.index + 1, this.index + 5))) {
            this.fail("contains an invalid Unicode escape");
          }
          this.index += 5;
          continue;
        }
        if (escaped === undefined || !'"\\/bfnrt'.includes(escaped)) {
          this.fail("contains an invalid string escape");
        }
      }
      this.index += 1;
    }
  }

  private number(): void {
    const remaining = this.raw.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(remaining);
    if (!match) this.fail("contains an invalid JSON number");
    const next = remaining[match[0].length];
    if (next !== undefined && !/[,\]}\s]/.test(next)) this.fail("contains an invalid JSON number");
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) this.fail("contains a non-finite JSON number");
    this.index += match[0].length;
  }

  private literal(value: string): void {
    if (this.raw.slice(this.index, this.index + value.length) !== value) {
      this.fail("contains an invalid JSON literal");
    }
    this.index += value.length;
  }

  private whitespace(): void {
    while (/\s/.test(this.raw[this.index] ?? "") && this.index < this.raw.length) this.index += 1;
  }

  private fail(reason: string): never { throw new Error(`${this.label} ${reason}.`); }
}

type CanonicalRawJsonMember = Readonly<{
  memberStart: number;
  valueStart: number;
  valueEnd: number;
}>;

class CanonicalRawJsonScanner {
  private index = 0;
  constructor(private readonly raw: string, private readonly label: string) {}

  scanObjectMembers(): ReadonlyMap<string, CanonicalRawJsonMember> {
    const members = this.object(0, true);
    if (this.index !== this.raw.length) this.fail("has trailing JSON data");
    return members;
  }

  private value(depth: number): void {
    if (depth > MAXIMUM_JSON_DEPTH) this.fail("exceeds the JSON nesting bound");
    const token = this.raw[this.index];
    if (token === "{") { this.object(depth + 1, false); return; }
    if (token === "[") { this.array(depth + 1); return; }
    if (token === '"') { this.string(); return; }
    if (token === "t") { this.literal("true"); return; }
    if (token === "f") { this.literal("false"); return; }
    if (token === "n") { this.literal("null"); return; }
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      this.number(); return;
    }
    this.fail("contains an invalid compact JSON token");
  }

  private object(
    depth: number,
    collect: boolean,
  ): ReadonlyMap<string, CanonicalRawJsonMember> {
    if (this.raw[this.index] !== "{") this.fail("is not a JSON object");
    this.index += 1;
    const members = new Map<string, CanonicalRawJsonMember>();
    let priorKey: string | null = null;
    if (this.raw[this.index] === "}") { this.index += 1; return members; }
    for (;;) {
      const memberStart = this.index;
      if (this.raw[this.index] !== '"') this.fail("contains an invalid object key");
      const key = this.string();
      if (
        members.has(key) ||
        (priorKey !== null && compareUnicodeCodePoints(priorKey, key) >= 0)
      ) this.fail("contains duplicate or noncanonical object-key order");
      priorKey = key;
      if (this.raw[this.index] !== ":") this.fail("contains object whitespace or an invalid separator");
      this.index += 1;
      const valueStart = this.index;
      this.value(depth);
      const valueEnd = this.index;
      if (collect) {
        members.set(key, Object.freeze({ memberStart, valueStart, valueEnd }));
      }
      if (this.raw[this.index] === "}") { this.index += 1; return members; }
      if (this.raw[this.index] !== ",") this.fail("contains object whitespace or an invalid delimiter");
      this.index += 1;
    }
  }

  private array(depth: number): void {
    this.index += 1;
    if (this.raw[this.index] === "]") { this.index += 1; return; }
    for (;;) {
      this.value(depth);
      if (this.raw[this.index] === "]") { this.index += 1; return; }
      if (this.raw[this.index] !== ",") this.fail("contains array whitespace or an invalid delimiter");
      this.index += 1;
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    for (;;) {
      const character = this.raw[this.index];
      if (character === undefined || character < " ") {
        this.fail("contains an invalid JSON string");
      }
      if (character === '"') {
        this.index += 1;
        const token = this.raw.slice(start, this.index);
        const decoded: unknown = JSON.parse(token);
        if (typeof decoded !== "string" || JSON.stringify(decoded) !== token) {
          this.fail("contains a noncanonical JSON string");
        }
        return decoded;
      }
      if (character === "\\") {
        this.index += 1;
        const escaped = this.raw[this.index];
        if (escaped === "u") {
          if (!/^[a-f0-9]{4}$/.test(this.raw.slice(this.index + 1, this.index + 5))) {
            this.fail("contains a noncanonical Unicode escape");
          }
          this.index += 5;
          continue;
        }
        if (escaped === undefined || !'"\\/bfnrt'.includes(escaped)) {
          this.fail("contains an invalid string escape");
        }
      }
      this.index += 1;
    }
  }

  private number(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/.exec(
      this.raw.slice(this.index),
    );
    if (!match || !Number.isFinite(Number(match[0]))) {
      this.fail("contains an invalid finite JSON number");
    }
    this.index += match[0].length;
  }

  private literal(value: string): void {
    if (this.raw.slice(this.index, this.index + value.length) !== value) {
      this.fail("contains an invalid JSON literal");
    }
    this.index += value.length;
  }

  private fail(reason: string): never {
    throw new Error(`${this.label} ${reason}.`);
  }
}

function canonicalRawObject(
  raw: Buffer,
  label: string,
): Readonly<{
  text: string;
  members: ReadonlyMap<string, CanonicalRawJsonMember>;
}> {
  if (raw.length < 3 || raw[raw.length - 1] !== 0x0a) {
    throw new Error(`${label} is not newline-terminated canonical JSON.`);
  }
  const body = raw.subarray(0, -1);
  const text = body.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(body)) {
    throw new Error(`${label} is not valid UTF-8.`);
  }
  const members = new CanonicalRawJsonScanner(text, label).scanObjectMembers();
  return Object.freeze({ text, members });
}

function canonicalRawObjectText(
  text: string,
  label: string,
): Readonly<{
  text: string;
  members: ReadonlyMap<string, CanonicalRawJsonMember>;
}> {
  const members = new CanonicalRawJsonScanner(text, label).scanObjectMembers();
  return Object.freeze({ text, members });
}

function rawJsonMemberValue(
  object: Readonly<{
    text: string;
    members: ReadonlyMap<string, CanonicalRawJsonMember>;
  }>,
  key: string,
  label: string,
): string {
  const member = object.members.get(key);
  if (!member) throw new Error(`${label} is missing ${key}.`);
  return object.text.slice(member.valueStart, member.valueEnd);
}

function rawCanonicalObjectDigestWithoutMember(
  object: Readonly<{
    text: string;
    members: ReadonlyMap<string, CanonicalRawJsonMember>;
  }>,
  key: string,
  label: string,
): string {
  const member = object.members.get(key);
  if (!member) throw new Error(`${label} is missing ${key}.`);
  let material: string;
  if (object.text[member.valueEnd] === ",") {
    material = object.text.slice(0, member.memberStart) +
      object.text.slice(member.valueEnd + 1);
  } else if (object.text[member.memberStart - 1] === ",") {
    material = object.text.slice(0, member.memberStart - 1) +
      object.text.slice(member.valueEnd);
  } else {
    material = "{}";
  }
  return sha256Bytes(Buffer.from(material, "utf8"));
}

export function calculateTranslationSemanticAuditRawObjectDigestWithoutMember(
  raw: Buffer | string,
  excludedMember: string,
  label = "Translation semantic audit raw object",
): string {
  const bytes = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
  return rawCanonicalObjectDigestWithoutMember(
    canonicalRawObject(bytes, label),
    excludedMember,
    label,
  );
}

function parseWithSchema<T extends z.ZodType>(
  schema: T,
  value: unknown,
  label: string,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} violates its exact schema: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function resolveExistingDirectory(directory: string, label: string): string {
  const absolute = path.resolve(directory);
  assertNoSymlinkComponents(absolute, label);
  const metadata = lstatSync(absolute, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory.`);
  }
  if (realpathSync(absolute) !== absolute) {
    throw new Error(`${label} resolves through a symbolic link.`);
  }
  return absolute;
}

function workspaceRelative(workspaceRoot: string, target: string): string {
  const relative = path.relative(workspaceRoot, target).split(path.sep).join("/");
  if (!isSafeRelativePath(relative)) throw new Error("Audit input path escaped the workspace.");
  return relative;
}

export function isTranslationSemanticMainAppWorkbenchPath(
  relativePath: string,
): boolean {
  const parts = relativePath.split("/");
  if (parts.length !== 2) return false;
  const [locale, basename] = parts;
  return TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.some(
    (expectedLocale) => expectedLocale === locale,
  ) &&
    /^(?:main-app\.json|main-app\.part-[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json)$/.test(
      basename ?? "",
    );
}

function snapshotTree(
  root: string,
  label: string,
  allowAbsent = false,
  ignoreMainAppWorkbench = false,
): TreeSnapshot {
  let rootMetadata: BigIntStats;
  try {
    rootMetadata = lstatSync(root, { bigint: true });
  } catch {
    if (!allowAbsent) throw new Error(`${label} does not exist.`);
    return Object.freeze({
      exists: false,
      sha256: sha256CanonicalTranslationAuditJson({ exists: false, files: [] }),
      files: 0,
      bytes: 0,
      rows: Object.freeze([]),
      directories: Object.freeze([]),
    });
  }
  assertNoSymlinkComponents(root, label);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory.`);
  }
  const rows: TreeFile[] = [];
  const directories: Array<readonly [string, StableIdentity]> = [];
  let totalBytes = 0;
  let totalResourceBytes = 0;
  let totalFileEntries = 0;
  const visit = (directory: string, relativeDirectory: string): void => {
    const depth = relativeDirectory ? relativeDirectory.split("/").length : 0;
    if (
      depth > MAXIMUM_TREE_DEPTH ||
      directories.length + 1 > MAXIMUM_TREE_DIRECTORIES
    ) {
      throw new Error(`${label} exceeds its directory resource bound.`);
    }
    const directoryMetadata = lstatSync(directory, { bigint: true });
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`${label} contains an invalid directory.`);
    }
    directories.push(Object.freeze([relativeDirectory, identity(directoryMetadata)]));
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        totalFileEntries += 1;
        if (totalFileEntries > MAXIMUM_TREE_FILES) {
          throw new Error(`${label} exceeds its file resource bound.`);
        }
      }
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (
        ignoreMainAppWorkbench &&
        isTranslationSemanticMainAppWorkbenchPath(relative)
      ) {
        const ignoredMetadata = lstatSync(absolute, { bigint: true });
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          !ignoredMetadata.isFile() ||
          ignoredMetadata.isSymbolicLink() ||
          ignoredMetadata.nlink !== BigInt(1) ||
          ignoredMetadata.size > BigInt(MAXIMUM_JSON_BYTES)
        ) {
          throw new Error(
            `${label} contains an unsafe ignored main-app workbench entry: ${relative}`,
          );
        }
        totalResourceBytes += Number(ignoredMetadata.size);
        if (totalResourceBytes > MAXIMUM_TREE_BYTES) {
          throw new Error(`${label} exceeds its byte resource bound.`);
        }
        continue;
      }
      const metadata = lstatSync(absolute, { bigint: true });
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
        throw new Error(`${label} contains a symbolic link: ${relative}`);
      }
      if (entry.isDirectory() && metadata.isDirectory()) {
        visit(absolute, relative); continue;
      }
      if (!entry.isFile() || !metadata.isFile() || !relative.endsWith(".json")) {
        throw new Error(`${label} contains a non-JSON or non-regular entry: ${relative}`);
      }
      const file = readStableRegularFile(absolute, MAXIMUM_JSON_BYTES, `${label} file ${relative}`);
      totalBytes += file.bytes.byteLength;
      totalResourceBytes += file.bytes.byteLength;
      if (totalResourceBytes > MAXIMUM_TREE_BYTES) {
        throw new Error(`${label} exceeds its resource bound.`);
      }
      rows.push(Object.freeze({
        relativePath: relative,
        bytes: file.bytes.byteLength,
        sha256: file.sha256,
        identity: file.identity,
      }));
    }
  };
  visit(root, "");
  rows.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
  directories.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return Object.freeze({
    exists: true,
    sha256: sha256CanonicalTranslationAuditJson({
      exists: true,
      files: rows.map((row) => [row.relativePath, row.bytes, row.sha256]),
    }),
    files: rows.length,
    bytes: totalBytes,
    rows: Object.freeze(rows),
    directories: Object.freeze(directories),
  });
}

export function calculateTranslationSemanticAuditTreeEvidence(input: {
  root: string;
  allowAbsent?: boolean;
  label?: string;
  ignoreMainAppWorkbench?: boolean;
}): z.infer<typeof translationSemanticAuditTreeDigestSchema> {
  const snapshot = snapshotTree(
    path.resolve(input.root),
    input.label ?? "Translation semantic audit tree",
    input.allowAbsent ?? false,
    input.ignoreMainAppWorkbench ?? false,
  );
  return Object.freeze({
    exists: snapshot.exists,
    sha256: snapshot.sha256,
    files: snapshot.files,
    bytes: snapshot.bytes,
  });
}

function sameTree(
  first: TreeSnapshot,
  second: TreeSnapshot,
  relaxIgnoredWorkbenchDirectoryMetadata = false,
): boolean {
  if (first.exists !== second.exists || first.sha256 !== second.sha256 ||
      first.files !== second.files || first.bytes !== second.bytes ||
      first.rows.length !== second.rows.length ||
      first.directories.length !== second.directories.length) return false;
  return first.rows.every((row, index) => {
    const other = second.rows[index];
    return other !== undefined && row.relativePath === other.relativePath &&
      row.bytes === other.bytes && row.sha256 === other.sha256 &&
      sameIdentity(row.identity, other.identity);
  }) && first.directories.every((directory, index) => {
    const other = second.directories[index];
    if (other === undefined || directory[0] !== other[0]) return false;
    return relaxIgnoredWorkbenchDirectoryMetadata
      ? directory[1].device === other[1].device &&
        directory[1].inode === other[1].inode
      : sameIdentity(directory[1], other[1]);
  });
}

function assertTranslationTreeLayout(
  snapshot: TreeSnapshot,
  label: string,
): void {
  const locales = new Set<string>(
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES,
  );
  for (const [relativeDirectory] of snapshot.directories) {
    if (
      relativeDirectory !== "" &&
      (relativeDirectory.includes("/") || !locales.has(relativeDirectory))
    ) {
      throw new Error(`${label} contains an unsupported directory layout.`);
    }
  }
}

function assertTreeEvidence(
  actual: TreeSnapshot,
  recorded: z.infer<typeof treeEvidenceSchema>,
  expectedPath: string,
  label: string,
): void {
  if (recorded.path !== expectedPath || recorded.exists !== actual.exists ||
      recorded.sha256 !== actual.sha256 || recorded.files !== actual.files ||
      recorded.bytes !== actual.bytes) {
    throw new Error(`${label} evidence is stale or path-mismatched.`);
  }
}

function assertStableFileUnchanged(prior: StableFile, maximum: number, label: string, mode?: number): void {
  const current = readStableRegularFile(prior.path, maximum, label, mode);
  if (current.sha256 !== prior.sha256 || !sameIdentity(current.identity, prior.identity)) {
    throw new Error(`${label} changed during verification.`);
  }
}

function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [entryKey, value] of Object.entries(record)) {
    if (entryKey !== key) result[entryKey] = value;
  }
  return result;
}

function assertExactArray(actual: readonly string[], expected: readonly string[], label: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} differs from the exact release contract.`);
  }
}

type ParsedMaster = z.infer<typeof masterWorklistSchema>;

const liveSiteSourceManifestSchema = z.record(
  z.string().min(1).max(1_024),
  z.object({
    sourceHash: sha256Schema,
    sourceStrings: z.record(
      z.string().min(1).max(1_024),
      boundedStringSchema,
    ),
  }).strict(),
);

type LiveSiteSourceCatalog = Readonly<{
  file: StableFile;
  namespaces: readonly string[];
  sources: ReadonlyMap<
    string,
    Readonly<{
      sourceHash: string;
      rows: readonly (readonly [string, string, string])[];
    }>
  >;
  fields: number;
  catalogRootSha256: string;
}>;

function readLiveSiteSourceCatalog(workspaceRoot: string): LiveSiteSourceCatalog {
  const sourceManifestPath = path.join(
    workspaceRoot,
    TRANSLATION_SEMANTIC_AUDIT_SITE_SOURCE_MANIFEST_RELATIVE_PATH,
  );
  const file = readStableRegularFile(
    sourceManifestPath,
    MAXIMUM_IMPLEMENTATION_BYTES,
    "Tracked site source manifest",
  );
  const text = file.bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(file.bytes)) {
    throw new Error("Tracked site source manifest is not valid UTF-8.");
  }
  const marker = "export const siteSourceManifest = ";
  const suffix = " as const;\n";
  const markerIndex = text.indexOf(marker);
  if (
    markerIndex < 0 || text.indexOf(marker, markerIndex + marker.length) >= 0 ||
    !text.endsWith(suffix)
  ) {
    throw new Error("Tracked site source manifest has a noncanonical module shape.");
  }
  const rawCatalog = Buffer.from(
    text.slice(markerIndex + marker.length, -suffix.length),
    "utf8",
  );
  const parsed = parseWithSchema(
    liveSiteSourceManifestSchema,
    strictJson(rawCatalog, "Tracked site source catalog"),
    "Tracked site source catalog",
  );
  const allNamespaces = Object.keys(parsed).sort(compareUnicodeCodePoints);
  const namespaces = allNamespaces.filter(
    (namespace) => namespace !== siteTranslationNamespace,
  );
  if (
    namespaces.length !== TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT - 1 ||
    !Object.prototype.hasOwnProperty.call(parsed, siteTranslationNamespace)
  ) {
    throw new Error("Tracked site source catalog has a partial namespace set.");
  }
  const sources = new Map<
    string,
    Readonly<{
      sourceHash: string;
      rows: readonly (readonly [string, string, string])[];
    }>
  >();
  let fields = 0;
  const catalogRows: unknown[] = [];
  for (const namespace of namespaces) {
    const source = parsed[namespace];
    if (!source) throw new Error("Tracked site source catalog entry disappeared.");
    const keys = Object.keys(source.sourceStrings).sort(compareUnicodeCodePoints);
    const derivedSourceHash = sha256Bytes(Buffer.from(
      keys.map((key) => `${key}\u0000${source.sourceStrings[key] ?? ""}`)
        .join("\u0001"),
      "utf8",
    ));
    if (keys.length === 0 || derivedSourceHash !== source.sourceHash) {
      throw new Error(
        `Tracked site source catalog hash is stale for ${namespace}.`,
      );
    }
    const rows = keys.map((key) => {
      const value = source.sourceStrings[key];
      if (value === undefined) {
        throw new Error(`Tracked site source field disappeared for ${namespace}.`);
      }
      return Object.freeze([
        key,
        value,
        sha256Bytes(Buffer.from(value, "utf8")),
      ] as const);
    });
    fields += rows.length;
    sources.set(namespace, Object.freeze({
      sourceHash: source.sourceHash,
      rows: Object.freeze(rows),
    }));
    catalogRows.push([namespace, source.sourceHash, rows]);
  }
  return Object.freeze({
    file,
    namespaces: Object.freeze(namespaces),
    sources,
    fields,
    catalogRootSha256: sha256CanonicalTranslationAuditJson(catalogRows),
  });
}

export function calculateTranslationSemanticSiteSourceCatalogEvidence(input: {
  workspaceRoot: string;
}): z.infer<
  typeof semanticPromotionEvidenceMaterialSchema
>["siteSourceCatalog"] {
  const workspaceRoot = resolveExistingDirectory(
    input.workspaceRoot,
    "Site-source catalog workspace root",
  );
  const catalog = readLiveSiteSourceCatalog(workspaceRoot);
  assertStableFileUnchanged(
    catalog.file,
    MAXIMUM_IMPLEMENTATION_BYTES,
    "Tracked site source manifest",
  );
  return Object.freeze({
    path: TRANSLATION_SEMANTIC_AUDIT_SITE_SOURCE_MANIFEST_RELATIVE_PATH,
    fileSha256: catalog.file.sha256,
    catalogRootSha256: catalog.catalogRootSha256,
    namespaces: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT - 1,
    fields: catalog.fields,
  });
}

export function assertCurrentTranslationSemanticGenerationOverrides(
  value: unknown,
): void {
  const master = masterGenerationOverrideProjectionSchema.parse(value);
  const seedMaterial = withoutKey(master.seedMemory, "seedMemorySha256");
  if (
    sha256CanonicalTranslationAuditJson(seedMaterial) !==
      master.seedMemory.seedMemorySha256 ||
    master.provenance.seedMemorySha256 !==
      master.seedMemory.seedMemorySha256 ||
    master.provenance.seedMemoryEntries !== master.seedMemory.entries.length ||
    master.provenance.seedMemoryConflicts !== master.seedMemory.conflicts.length
  ) {
    throw new Error("Master seed memory is stale or differs from provenance.");
  }
  const seedByIdentity = new Map<
    string,
    ParsedMaster["seedMemory"]["entries"][number]
  >();
  let priorSeedIdentity = "";
  for (const entry of master.seedMemory.entries) {
    const identity = `${entry.locale}\u0000${entry.sourceSha256}`;
    if (
      identity <= priorSeedIdentity ||
      seedByIdentity.has(identity) ||
      sha256Bytes(Buffer.from(entry.source, "utf8")) !== entry.sourceSha256 ||
      sha256Bytes(Buffer.from(entry.value, "utf8")) !== entry.valueSha256 ||
      entry.value !== entry.value.normalize("NFC")
    ) {
      throw new Error("Master seed-memory entry order or content drifted.");
    }
    seedByIdentity.set(identity, entry);
    priorSeedIdentity = identity;
  }
  let priorSeedConflictIdentity = "";
  for (const conflict of master.seedMemory.conflicts) {
    const identity = `${conflict.locale}\u0000${conflict.sourceSha256}`;
    if (
      identity <= priorSeedConflictIdentity ||
      seedByIdentity.has(identity)
    ) {
      throw new Error("Master seed-memory conflict order drifted.");
    }
    priorSeedConflictIdentity = identity;
  }
  const overrideMaterial = withoutKey(
    master.generationOverrides,
    "generationOverridesSha256",
  );
  if (
    sha256CanonicalTranslationAuditJson(overrideMaterial) !==
      master.generationOverrides.generationOverridesSha256 ||
    master.provenance.generationOverridesSha256 !==
      master.generationOverrides.generationOverridesSha256 ||
    master.provenance.generationOverrideEntries !==
      master.generationOverrides.entries.length
  ) {
    throw new Error(
      "Master generation overrides are stale or differ from provenance.",
    );
  }
  let priorOverrideIdentity = "";
  for (const entry of master.generationOverrides.entries) {
    const identity = `${entry.locale}\u0000${entry.sourceSha256}`;
    const seed = seedByIdentity.get(identity);
    const seedFields = {
      language: entry.language,
      locale: entry.locale,
      source: entry.source,
      sourceSha256: entry.sourceSha256,
      value: entry.value,
      valueSha256: entry.valueSha256,
    };
    if (
      identity <= priorOverrideIdentity ||
      !seed ||
      canonicalTranslationAuditJson(seedFields) !==
        canonicalTranslationAuditJson(seed) ||
      sha256Bytes(Buffer.from(entry.source, "utf8")) !== entry.sourceSha256 ||
      sha256Bytes(Buffer.from(entry.value, "utf8")) !== entry.valueSha256 ||
      entry.value !== entry.value.normalize("NFC")
    ) {
      throw new Error(
        "Master generation override order, seed binding, or content drifted.",
      );
    }
    let priorOccurrenceIdentity = "";
    for (const occurrence of entry.requiredOccurrences) {
      const occurrenceIdentity =
        `${occurrence.namespace}\u0000${occurrence.sourceHash}\u0000${occurrence.key}`;
      if (occurrenceIdentity <= priorOccurrenceIdentity) {
        throw new Error(
          "Master generation override occurrence order drifted.",
        );
      }
      priorOccurrenceIdentity = occurrenceIdentity;
    }
    priorOverrideIdentity = identity;
  }
  const requiredOverrideSourceSha256s = new Set(
    master.seedMemory.entries.flatMap((entry) =>
      entry.locale === "af" &&
        CURRENT_GENERATION_OVERRIDE_SOURCE_SHA256S.has(entry.sourceSha256)
        ? [entry.sourceSha256]
        : []
    ),
  );
  const sourceByNamespaceForOverrides = new Map(
    master.sources.map((source) => [source.namespace, source]),
  );
  for (const job of master.jobs) {
    if (job.language !== "Afrikaans") continue;
    for (
      const entry of
        sourceByNamespaceForOverrides.get(job.namespace)?.entries ?? []
    ) {
      if (CURRENT_GENERATION_OVERRIDE_SOURCE_SHA256S.has(entry.sourceSha256)) {
        requiredOverrideSourceSha256s.add(entry.sourceSha256);
      }
    }
  }
  const expectedOverrideBinding = [...requiredOverrideSourceSha256s]
    .sort()
    .map((sourceSha256) => {
      const valueSha256 =
        CURRENT_GENERATION_OVERRIDE_VALUE_SHA256_BY_SOURCE.get(sourceSha256);
      if (!valueSha256) {
        throw new Error("Required generation override identity is unknown.");
      }
      return {
        language: "Afrikaans",
        locale: "af",
        sourceSha256,
        valueSha256,
      };
    });
  const observedOverrideBinding = master.generationOverrides.entries.map(
    (entry) => ({
      language: entry.language,
      locale: entry.locale,
      sourceSha256: entry.sourceSha256,
      valueSha256: entry.valueSha256,
    }),
  );
  if (
    canonicalTranslationAuditJson(observedOverrideBinding) !==
      canonicalTranslationAuditJson(expectedOverrideBinding) ||
    (
      observedOverrideBinding.length === CURRENT_GENERATION_OVERRIDE_ENTRIES &&
      sha256CanonicalTranslationAuditJson(observedOverrideBinding) !==
        CURRENT_GENERATION_OVERRIDE_BINDING_SHA256
    )
  ) {
    throw new Error(
      "Master generation overrides differ from the exact required reviewed set.",
    );
  }
  for (const override of master.generationOverrides.entries) {
    const observed = master.sources.flatMap((source) =>
      source.entries
        .filter((entry) => entry.sourceSha256 === override.sourceSha256)
        .map((entry) => ({
          namespace: source.namespace,
          sourceHash: source.sourceHash,
          key: entry.key,
          source: entry.source,
        }))
    ).sort((left, right) =>
      left.namespace < right.namespace ? -1
        : left.namespace > right.namespace ? 1
        : left.sourceHash < right.sourceHash ? -1
        : left.sourceHash > right.sourceHash ? 1
        : left.key < right.key ? -1
        : left.key > right.key ? 1
        : 0
    );
    const expected = override.requiredOccurrences.map((occurrence) => ({
      ...occurrence,
      source: override.source,
    }));
    if (
      canonicalTranslationAuditJson(observed) !==
        canonicalTranslationAuditJson(expected)
    ) {
      throw new Error(
        "Master generation override source occurrence provenance drifted.",
      );
    }
  }
}

function validateMaster(
  master: ParsedMaster,
  liveSiteCatalog: LiveSiteSourceCatalog,
  expectedLocales: readonly (keyof typeof LANGUAGE_BY_LOCALE)[],
): Readonly<{
  sources: ReadonlyMap<string, ParsedMaster["sources"][number]>;
  jobs: ReadonlyMap<string, ParsedMaster["jobs"][number]>;
  fields: number;
}> {
  const expectedLocaleSet: ReadonlySet<string> = new Set(expectedLocales);
  assertCurrentTranslationSemanticGeneratorProvenance(master.provenance);
  const generatorExecutionProfile = parseLongTailNllbExecutionProfile(
    master.provenance.executionProfile,
  );
  if (
    canonicalTranslationAuditJson(generatorExecutionProfile) !==
      canonicalTranslationAuditJson(LONG_TAIL_NLLB_EXECUTION_PROFILE)
  ) {
    throw new Error("Master generator execution profile is stale or tampered.");
  }
  const material = withoutKey(master, "worklistSha256");
  if (sha256CanonicalTranslationAuditJson(material) !== master.worklistSha256) {
    throw new Error("Master worklist canonical digest is stale or tampered.");
  }
  assertCurrentTranslationSemanticGenerationOverrides({
    provenance: master.provenance,
    seedMemory: master.seedMemory,
    generationOverrides: master.generationOverrides,
    sources: master.sources,
    jobs: master.jobs,
  });
  const sources = new Map<string, ParsedMaster["sources"][number]>();
  let priorNamespace = "";
  let fieldsPerLocale = 0;
  for (const source of master.sources) {
    if (source.namespace <= priorNamespace || sources.has(source.namespace)) {
      throw new Error("Master source namespaces are duplicate or noncanonical.");
    }
    priorNamespace = source.namespace;
    if (sha256CanonicalTranslationAuditJson(source.entries) !== source.sourceEntriesSha256) {
      throw new Error(`Master source entry digest drifted for ${source.namespace}.`);
    }
    let priorKey = "";
    for (const entry of source.entries) {
      if (entry.key <= priorKey) throw new Error(`Master source keys are noncanonical for ${source.namespace}.`);
      priorKey = entry.key;
      const protectedSource =
        deriveTranslationSemanticAuditProtectedSourceText(entry.source);
      if (sha256Bytes(Buffer.from(entry.source, "utf8")) !== entry.sourceSha256 ||
          entry.segments.map((segment) => segment.value).join("") !== entry.source ||
          entry.invariantSha256 !== protectedSource.invariantSha256 ||
          canonicalTranslationAuditJson(entry.segments) !==
            canonicalTranslationAuditJson(protectedSource.segments)) {
        throw new Error(`Master source field identity drifted for ${source.namespace}/${entry.key}.`);
      }
    }
    fieldsPerLocale += source.entries.length;
    sources.set(source.namespace, source);
  }
  const mainAppSource = sources.get("main-app");
  const currentMainAppStrings = getMainAppSourceStrings();
  const currentMainAppKeys = Object.keys(currentMainAppStrings).sort(
    (left, right) => left < right ? -1 : left > right ? 1 : 0,
  );
  if (
    !mainAppSource ||
    mainAppSource.sourceHash !== getMainAppSourceHash(currentMainAppStrings) ||
    mainAppSource.entries.length !== currentMainAppKeys.length
  ) {
    throw new Error(
      "Master main-app source does not match the current tracked application catalog.",
    );
  }
  for (let index = 0; index < currentMainAppKeys.length; index += 1) {
    const key = currentMainAppKeys[index];
    const entry = mainAppSource.entries[index];
    const currentSource = key === undefined
      ? undefined
      : currentMainAppStrings[key];
    if (
      key === undefined ||
      entry === undefined ||
      currentSource === undefined ||
      entry.key !== key ||
      entry.source !== currentSource ||
      entry.sourceSha256 !== sha256Bytes(Buffer.from(currentSource, "utf8"))
    ) {
      throw new Error(
        "Master main-app source fields do not match the current tracked application catalog.",
      );
    }
  }
  const recordedSiteNamespaces = [...sources.keys()]
    .filter((namespace) => namespace !== "main-app");
  assertExactArray(
    recordedSiteNamespaces,
    liveSiteCatalog.namespaces,
    "Master non-main source namespace order",
  );
  for (const namespace of liveSiteCatalog.namespaces) {
    const recorded = sources.get(namespace);
    const current = liveSiteCatalog.sources.get(namespace);
    if (
      !recorded || !current || recorded.sourceHash !== current.sourceHash ||
      recorded.entries.length !== current.rows.length
    ) {
      throw new Error(
        `Master source does not match the current site catalog: ${namespace}.`,
      );
    }
    for (let index = 0; index < current.rows.length; index += 1) {
      const currentRow = current.rows[index];
      const entry = recorded.entries[index];
      if (
        currentRow === undefined || entry === undefined ||
        entry.key !== currentRow[0] || entry.source !== currentRow[1] ||
        entry.sourceSha256 !== currentRow[2]
      ) {
        throw new Error(
          `Master source fields do not match the current site catalog: ${namespace}.`,
        );
      }
    }
  }
  const jobs = new Map<string, ParsedMaster["jobs"][number]>();
  for (const job of master.jobs) {
    const materialJob = withoutKey(job, "jobSha256");
    if (sha256CanonicalTranslationAuditJson(materialJob) !== job.jobSha256) {
      throw new Error(`Master job digest drifted for ${job.locale}/${job.namespace}.`);
    }
    const source = sources.get(job.namespace);
    const expectedLanguage = LANGUAGE_BY_LOCALE[job.locale];
    if (!expectedLocaleSet.has(job.locale) ||
        !source || job.language !== expectedLanguage || job.sourceHash !== source.sourceHash ||
        job.sourceEntriesSha256 !== source.sourceEntriesSha256 ||
        job.entryCount !== source.entries.length ||
        job.worklistRelativePath !== job.candidateRelativePath ||
        job.candidateRelativePath !== job.targetRelativePath) {
      throw new Error(`Master job contract drifted for ${job.locale}/${job.namespace}.`);
    }
    const key = `${job.locale}\u0000${job.namespace}`;
    if (jobs.has(key)) throw new Error(`Master job is duplicate for ${job.locale}/${job.namespace}.`);
    jobs.set(key, job);
  }
  return Object.freeze({
    sources,
    jobs,
    fields: fieldsPerLocale * expectedLocales.length,
  });
}

function assertExpectedPackWorklistPaths(snapshot: TreeSnapshot, jobs: ReadonlyMap<string, ParsedMaster["jobs"][number]>): void {
  if (!snapshot.exists) throw new Error("Pack worklist tree is absent.");
  const expected = [...jobs.values()].map((job) => job.worklistRelativePath).sort();
  const actual = snapshot.rows.map((row) => row.relativePath);
  assertExactArray(actual, expected, "Pack worklist tree paths");
}

function readSnapshotJson(root: string, row: TreeFile, label: string): unknown {
  const file = readStableRegularFile(path.join(root, ...row.relativePath.split("/")), MAXIMUM_JSON_BYTES, label);
  if (file.sha256 !== row.sha256 || file.bytes.byteLength !== row.bytes ||
      !sameIdentity(file.identity, row.identity)) {
    throw new Error(`${label} changed after its tree snapshot.`);
  }
  return strictJson(file.bytes, label);
}

function validatePackWorklists(
  root: string,
  snapshot: TreeSnapshot,
  master: ParsedMaster,
  validated: ReturnType<typeof validateMaster>,
): ReadonlyMap<string, string> {
  assertExpectedPackWorklistPaths(snapshot, validated.jobs);
  const jobsByPath = new Map(
    [...validated.jobs.values()].map((job) => [
      job.worklistRelativePath,
      job,
    ] as const),
  );
  const hashes = new Map<string, string>();
  for (const row of snapshot.rows) {
    const job = jobsByPath.get(row.relativePath);
    if (!job || hashes.has(row.relativePath)) {
      throw new Error(`Pack worklist identity is unexpected: ${row.relativePath}.`);
    }
    const source = validated.sources.get(job.namespace);
    if (!source) {
      throw new Error(`Pack worklist source is unregistered: ${row.relativePath}.`);
    }
    const payload = parseWithSchema(
      packWorklistSchema,
      readSnapshotJson(root, row, `Pack worklist ${row.relativePath}`),
      `Pack worklist ${row.relativePath}`,
    );
    const { packWorklistSha256, ...material } = payload;
    if (
      sha256CanonicalTranslationAuditJson(material) !== packWorklistSha256 ||
      payload.masterWorklistSha256 !== master.worklistSha256 ||
      canonicalTranslationAuditJson(payload.provenance) !==
        canonicalTranslationAuditJson(master.provenance) ||
      canonicalTranslationAuditJson(payload.job) !==
        canonicalTranslationAuditJson(job) ||
      canonicalTranslationAuditJson(payload.source) !==
        canonicalTranslationAuditJson(source)
    ) {
      throw new Error(`Pack worklist provenance drifted: ${row.relativePath}.`);
    }
    hashes.set(row.relativePath, packWorklistSha256);
  }
  return hashes;
}

function assertCandidatePackWorklistBindings(
  packs: ReadonlyMap<string, PackMaterial>,
  validated: ReturnType<typeof validateMaster>,
  packWorklistHashes: ReadonlyMap<string, string>,
): void {
  for (const [identity, job] of validated.jobs) {
    const pack = packs.get(identity);
    if (
      !pack || pack.origin !== "candidate" ||
      pack.packWorklistSha256 !==
        packWorklistHashes.get(job.worklistRelativePath)
    ) {
      throw new Error(
        `Candidate pack/worklist binding drifted for ${job.locale}/${job.namespace}.`,
      );
    }
  }
}

const candidateEntrySchema = z.object({
  key: z.string().min(1).max(1_024), source: boundedStringSchema,
  sourceSha256: sha256Schema, value: z.string().min(1).max(200_000),
}).strict();
const candidatePackSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("inspir-long-tail-translation-candidate-v1"),
  pipelineVersion: z.literal(LONG_TAIL_TRANSLATION_PIPELINE_VERSION),
  executionProfileSha256: z.literal(LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256),
  masterWorklistSha256: sha256Schema,
  packWorklistSha256: sha256Schema, jobSha256: sha256Schema,
  language: z.string().min(1).max(128), locale: localeSchema,
  namespace: z.string().min(1).max(1_024), sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema, modelLabel: z.string().min(1).max(256),
  modelSha256: sha256Schema, workerImplementationSha256: sha256Schema,
  validatorPolicySha256: sha256Schema,
  entries: z.array(candidateEntrySchema).min(1).max(20_000),
}).strict();
const curatedEntrySchema = z.object({
  key: z.string().min(1).max(1_024), source: boundedStringSchema,
  value: z.string().min(1).max(200_000),
}).passthrough();
const curatedPackSchema = z.object({
  schemaVersion: z.literal(1), language: z.string().min(1).max(128), locale: localeSchema,
  namespace: z.string().min(1).max(1_024), sourceHash: sha256Schema,
  entries: z.array(curatedEntrySchema).max(20_000).optional(),
  translations: z.record(z.string().min(1).max(1_024), z.string().min(1).max(200_000)).optional(),
}).passthrough();
const staticMainAppPackSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("static-main-app-values"),
  language: z.string().min(1).max(128),
  locale: localeSchema,
  sourceHash: sha256Schema,
  keyCount: positiveIntegerSchema.max(20_000),
  strings: z.array(z.string().min(1).max(200_000)).min(1).max(20_000),
}).strict();

type PackMaterial = Readonly<{
  origin: "curated" | "candidate";
  locale: (typeof TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES)[number];
  namespace: string;
  language: string;
  packFileSha256: string;
  packWorklistSha256?: string;
  values: ReadonlyMap<string, string>;
}>;

function collectPackMaterial(
  curatedRoot: string,
  curatedTree: TreeSnapshot,
  staticMainAppRoot: string,
  staticMainAppTree: TreeSnapshot,
  candidateRoot: string,
  candidateTree: TreeSnapshot,
  master: ParsedMaster,
  validated: ReturnType<typeof validateMaster>,
  expectedLocales: readonly (keyof typeof LANGUAGE_BY_LOCALE)[],
): ReadonlyMap<string, PackMaterial> {
  const expectedLocaleSet: ReadonlySet<string> = new Set(expectedLocales);
  const curated = new Map<string, Array<{ row: TreeFile; payload: z.infer<typeof curatedPackSchema> }>>();
  for (const row of curatedTree.rows) {
    const pathLocale = row.relativePath.split("/", 1)[0];
    if (
      pathLocale === undefined ||
      !expectedLocaleSet.has(pathLocale)
    ) {
      continue;
    }
    const payload = parseWithSchema(curatedPackSchema, readSnapshotJson(curatedRoot, row, `Curated pack ${row.relativePath}`), `Curated pack ${row.relativePath}`);
    const expectedPrefix = `${payload.locale}/`;
    const basename = row.relativePath.slice(expectedPrefix.length);
    if (!row.relativePath.startsWith(expectedPrefix) || basename.includes("/") ||
        !isTranslationSemanticAuditPackBasename(
          basename,
          payload.namespace,
          true,
        )) {
      throw new Error(`Curated pack path is not canonical: ${row.relativePath}.`);
    }
    const key = `${payload.locale}\u0000${payload.namespace}`;
    const values = curated.get(key) ?? [];
    values.push({ row, payload }); curated.set(key, values);
  }
  const candidates = new Map<string, { row: TreeFile; payload: z.infer<typeof candidatePackSchema> }>();
  for (const row of candidateTree.rows) {
    const payload = parseWithSchema(candidatePackSchema, readSnapshotJson(candidateRoot, row, `Candidate pack ${row.relativePath}`), `Candidate pack ${row.relativePath}`);
    const key = `${payload.locale}\u0000${payload.namespace}`;
    if (payload.namespace === "main-app") {
      throw new Error("Tracked static main-app packs cannot be replaced by semantic candidates.");
    }
    const job = validated.jobs.get(key);
    if (!job || row.relativePath !== job.candidateRelativePath ||
        !isTranslationSemanticAuditPackBasename(
          path.posix.basename(row.relativePath),
          payload.namespace,
          false,
        ) || candidates.has(key)) {
      throw new Error(`Candidate pack path/identity is unexpected: ${row.relativePath}.`);
    }
    candidates.set(key, { row, payload });
  }
  if (
    candidates.size !== validated.jobs.size ||
    [...validated.jobs.keys()].some((key) => !candidates.has(key))
  ) {
    throw new Error(
      "Candidate tree does not exactly cover the master pending/stale jobs.",
    );
  }
  const mainAppSource = validated.sources.get("main-app");
  if (!mainAppSource) {
    throw new Error("Master worklist is missing the canonical main-app source.");
  }
  if (
    staticMainAppTree.files !==
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT ||
    staticMainAppTree.rows.length !==
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_STATIC_MAIN_APP_PACK_COUNT
  ) {
    throw new Error("Tracked static main-app tree is not the exact 69-pack corpus.");
  }
  const staticMainApp = new Map<
    string,
    Readonly<{ row: TreeFile; values: ReadonlyMap<string, string> }>
  >();
  const sortedMainAppEntries = [...mainAppSource.entries].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  );
  for (const row of staticMainAppTree.rows) {
    const locale = path.posix.basename(row.relativePath, ".json");
    if (
      row.relativePath !== `${locale}.json` ||
      !Object.prototype.hasOwnProperty.call(LANGUAGE_BY_LOCALE, locale)
    ) {
      throw new Error(`Tracked static main-app path is unexpected: ${row.relativePath}.`);
    }
    const parsed = parseWithSchema(
      staticMainAppPackSchema,
      readSnapshotJson(
        staticMainAppRoot,
        row,
        `Tracked static main-app pack ${row.relativePath}`,
      ),
      `Tracked static main-app pack ${row.relativePath}`,
    );
    if (
      parsed.locale !== locale ||
      parsed.language !== LANGUAGE_BY_LOCALE[locale as keyof typeof LANGUAGE_BY_LOCALE] ||
      parsed.sourceHash !== mainAppSource.sourceHash ||
      parsed.keyCount !== sortedMainAppEntries.length ||
      parsed.strings.length !== sortedMainAppEntries.length ||
      staticMainApp.has(locale)
    ) {
      throw new Error(`Tracked static main-app binding drifted for ${locale}.`);
    }
    staticMainApp.set(
      locale,
      Object.freeze({
        row,
        values: new Map(
          sortedMainAppEntries.map((entry, index) => {
            const value = parsed.strings[index];
            if (value === undefined) {
              throw new Error(`Tracked static main-app field disappeared for ${locale}/${entry.key}.`);
            }
            return [entry.key, value] as const;
          }),
        ),
      }),
    );
  }
  if (
    staticMainApp.size !== TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.length ||
    TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES.some(
      (locale) => !staticMainApp.has(locale),
    )
  ) {
    throw new Error("Tracked static main-app locale set is incomplete.");
  }
  const result = new Map<string, PackMaterial>();
  for (const locale of expectedLocales) {
    const language = LANGUAGE_BY_LOCALE[locale];
    for (const source of validated.sources.values()) {
      const key = `${locale}\u0000${source.namespace}`;
      const job = validated.jobs.get(key);
      const candidate = candidates.get(key);
      if (source.namespace === "main-app") {
        if (job || candidate || curated.has(key)) {
          throw new Error(
            `Main-app release identity must come only from the tracked static pack for ${locale}.`,
          );
        }
        const staticPack = staticMainApp.get(locale);
        if (!staticPack) {
          throw new Error(`Tracked static main-app pack is missing for ${locale}.`);
        }
        result.set(key, Object.freeze({
          origin: "curated",
          locale,
          namespace: source.namespace,
          language,
          packFileSha256: staticPack.row.sha256,
          values: staticPack.values,
        }));
        continue;
      }
      if (candidate) {
        if (!job) {
          throw new Error(
            `Candidate is not registered by the master for ${locale}/${source.namespace}.`,
          );
        }
        const payload = candidate.payload;
        if (payload.pipelineVersion !== LONG_TAIL_TRANSLATION_PIPELINE_VERSION ||
            payload.pipelineVersion !== master.provenance.pipelineVersion ||
            payload.executionProfileSha256 !==
              LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256 ||
            payload.executionProfileSha256 !==
              master.provenance.executionProfile.executionProfileSha256 ||
            payload.masterWorklistSha256 !== master.worklistSha256 ||
            payload.jobSha256 !== job.jobSha256 || payload.locale !== locale ||
            payload.language !== language || payload.namespace !== source.namespace ||
            payload.sourceHash !== source.sourceHash ||
            payload.sourceEntriesSha256 !== source.sourceEntriesSha256 ||
            payload.modelLabel !== master.provenance.modelLabel ||
            payload.modelSha256 !== master.provenance.modelSha256 ||
            payload.workerImplementationSha256 !==
              master.provenance.workerImplementationSha256 ||
            payload.validatorPolicySha256 !==
              master.provenance.validatorPolicy.validatorPolicySha256 ||
            payload.entries.length !== source.entries.length) {
          throw new Error(`Candidate provenance drifted for ${locale}/${source.namespace}.`);
        }
        const values = new Map<string, string>();
        source.entries.forEach((entry, index) => {
          const translated = payload.entries[index];
          if (!translated || translated.key !== entry.key || translated.source !== entry.source ||
              translated.sourceSha256 !== entry.sourceSha256) {
            throw new Error(`Candidate field identity drifted for ${locale}/${source.namespace}/${entry.key}.`);
          }
          values.set(entry.key, translated.value);
        });
        result.set(key, Object.freeze({
          origin: "candidate", locale, namespace: source.namespace,
          language, packFileSha256: candidate.row.sha256,
          packWorklistSha256: payload.packWorklistSha256,
          values,
        }));
        continue;
      }
      const parts = curated.get(key);
      if (!parts?.length) {
        throw new Error(`Translation union is missing ${locale}/${source.namespace}.`);
      }
      parts.sort((a, b) => {
        const first = path.posix.basename(a.row.relativePath);
        const second = path.posix.basename(b.row.relativePath);
        return first < second ? -1 : first > second ? 1 : 0;
      });
      const values = new Map<string, string>();
      for (const part of parts) {
        const payload = part.payload;
        if (payload.language !== language || payload.locale !== locale ||
          payload.namespace !== source.namespace ||
          payload.sourceHash !== source.sourceHash ||
          Boolean(payload.entries) === Boolean(payload.translations)) {
          throw new Error(`Curated pack binding drifted for ${locale}/${source.namespace}.`);
        }
        if (payload.entries) {
          for (const entry of payload.entries) {
            const expected = source.entries.find((item) => item.key === entry.key);
            if (!expected || entry.source !== expected.source || values.has(entry.key)) {
              throw new Error(`Curated field identity drifted for ${locale}/${source.namespace}/${entry.key}.`);
            }
            values.set(entry.key, entry.value);
          }
        } else if (payload.translations) {
          for (const [fieldKey, value] of Object.entries(payload.translations)) {
            if (values.has(fieldKey)) throw new Error(`Curated field is duplicate for ${locale}/${source.namespace}/${fieldKey}.`);
            values.set(fieldKey, value);
          }
        }
      }
      if (values.size !== source.entries.length || source.entries.some((entry) => !values.has(entry.key))) {
        throw new Error(`Curated pack is partial for ${locale}/${source.namespace}.`);
      }
      const packFileSha256 = sha256CanonicalTranslationAuditJson(parts.map((part) => [
        path.posix.basename(part.row.relativePath), part.row.bytes, part.row.sha256,
      ]));
      result.set(key, Object.freeze({
        origin: "curated", locale, namespace: source.namespace,
        language, packFileSha256, values,
      }));
    }
  }
  const expectedIdentities = new Set(
    expectedLocales.flatMap((locale) =>
      [...validated.sources.keys()].map((namespace) => `${locale}\u0000${namespace}`)
    ),
  );
  const unexpected = [...curated.keys(), ...candidates.keys()].filter(
    (key) => !expectedIdentities.has(key),
  );
  if (unexpected.length) throw new Error("Translation trees contain unexpected pack identities.");
  return result;
}

const MASKED_VALUE_OPAQUE_RE = new RegExp(
  [
    String.raw`https?:\/\/\S+`,
    String.raw`(?:mailto:|tel:)\S+`,
    String.raw`[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_.-]+\.[A-Za-z]{2,}`,
    String.raw`(?<![\p{L}\p{N}_])(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}(?![\p{L}\p{N}_])`,
  ].join("|"),
  "giu",
);

// These patterns include backticks, so keep them out of the String.raw list.
const MASKED_VALUE_LITERAL_OR_PATH_RE =
  /`[^`\n]+`|\{[A-Za-z0-9_]+\}|(?<![\p{L}\p{N}_])\/(?:[A-Za-z0-9_.?=&%#-]+\/)*[A-Za-z0-9_.?=&%#-]+/giu;

function python39Casefold(value: string): string {
  return [...value].map((character) =>
    PYTHON_3_9_CASEFOLD_OVERRIDES[character] ?? character.toLowerCase()
  ).join("");
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map((character) => character.codePointAt(0) ?? 0);
  const rightPoints = [...right].map((character) => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function maskTranslationValue(
  value: string,
  source: ParsedMaster["sources"][number]["entries"][number],
): string {
  let masked = value;
  const literals = [...new Set(
    source.segments
      .filter((segment) => segment.kind === "literal" && segment.value.length > 0)
      .map((segment) => segment.value),
  )].sort((left, right) => [...right].length - [...left].length ||
    compareUnicodeCodePoints(left, right));
  for (const literal of literals) masked = masked.replaceAll(literal, " ");
  return masked
    .replace(MASKED_VALUE_OPAQUE_RE, " ")
    .replace(MASKED_VALUE_LITERAL_OR_PATH_RE, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function deriveAfrikaansPackContext(
  pack: PackMaterial,
  source: ParsedMaster["sources"][number],
): Readonly<{
  contextSha256: string;
  distinctMaskedValues: number;
  maskedLetters: number;
}> {
  const values = new Set<string>();
  for (const entry of source.entries) {
    const value = pack.values.get(entry.key);
    if (value === undefined) {
      throw new Error(
        `Translation value disappeared for af/${source.namespace}/${entry.key}.`,
      );
    }
    const normalized = python39Casefold(
      maskTranslationValue(value, entry).normalize("NFKC"),
    ).replace(/\s+/gu, " ").trim();
    if (normalized.length > 0) values.add(normalized);
  }
  const context = [...values].sort(compareUnicodeCodePoints).join(" ");
  return Object.freeze({
    contextSha256: sha256Bytes(Buffer.from(context, "utf8")),
    distinctMaskedValues: values.size,
    maskedLetters: [...context].filter((character) => /\p{L}/u.test(character)).length,
  });
}

function validateAfrikaansPackContextBase(
  binding: TranslationSemanticAuditManifest["results"]["packBindings"][number],
  pack: PackMaterial,
  source: ParsedMaster["sources"][number],
): boolean {
  const evidence = binding.afrikaansPackContext;
  if (binding.locale !== TRANSLATION_SEMANTIC_AUDIT_POLICY.language.afrikaansPackContext.locale) {
    if (evidence !== null) {
      throw new Error(
        `Non-Afrikaans pack has calibration evidence: ${binding.locale}/${binding.namespace}.`,
      );
    }
    return false;
  }
  if (evidence === null) {
    throw new Error(`Afrikaans pack is missing calibration evidence: ${binding.namespace}.`);
  }
  const derived = deriveAfrikaansPackContext(pack, source);
  const policy = TRANSLATION_SEMANTIC_AUDIT_POLICY.language.afrikaansPackContext;
  const eligible =
    derived.distinctMaskedValues >= policy.minimumDistinctMaskedValues &&
    derived.maskedLetters >= policy.minimumMaskedLetters;
  const probabilities = new Map<string, number>();
  let priorProbability = 2;
  for (const [label, probability] of evidence.predictions) {
    if (
      probabilities.has(label) ||
      probability > priorProbability
    ) {
      throw new Error(
        `Afrikaans pack predictions are not unique raw-ranked evidence: ${binding.namespace}.`,
      );
    }
    probabilities.set(label, probability);
    priorProbability = probability;
  }
  if ((eligible && evidence.predictions.length !== 5) ||
      (!eligible && evidence.predictions.length !== 0)) {
    throw new Error(
      `Afrikaans pack prediction eligibility drifted: ${binding.namespace}.`,
    );
  }
  const gatePassed = Boolean(
    eligible &&
    evidence.predictions[0]?.[0] === policy.targetLabel &&
    (probabilities.get(policy.targetLabel) ?? 0) >=
      policy.minimumPackTargetProbability &&
    (probabilities.get(policy.targetLabel) ?? 0) +
      (probabilities.get(policy.relatedLabel) ?? 0) >=
      policy.minimumPackPairProbability,
  );
  if (
    evidence.contextSha256 !== derived.contextSha256 ||
    evidence.distinctMaskedValues !== derived.distinctMaskedValues ||
    evidence.maskedLetters !== derived.maskedLetters ||
    evidence.eligible !== eligible ||
    evidence.gatePassed !== gatePassed ||
    evidence.rescuedFields > binding.fields ||
    evidence.fieldPairRescuedFields > binding.fields ||
    evidence.trackedCuratedRescuedFields > binding.fields ||
    evidence.referenceMatchFields > binding.fields ||
    evidence.rescuedFields !==
      evidence.fieldPairRescuedFields + evidence.trackedCuratedRescuedFields ||
    (!gatePassed && evidence.rescuedFields !== 0) ||
    (binding.origin !== "candidate" &&
      evidence.trackedCuratedRescuedFields !== 0) ||
    (evidence.trackedCuratedRescuedFields === 0 &&
      evidence.trackedCuratedRescueRootSha256 !==
        sha256CanonicalTranslationAuditJson([]))
  ) {
    throw new Error(
      `Afrikaans pack calibration evidence drifted: ${binding.namespace}.`,
    );
  }
  return gatePassed;
}

type TrackedAfrikaansReferenceSummary = Readonly<
  Pick<
    z.infer<typeof afrikaansTrackedCuratedSchema>,
    | "referencePacks"
    | "referencePackIdentityRootSha256"
    | "referencePackGateEvidenceRootSha256"
    | "supportPairCount"
    | "supportPairRootSha256"
    | "supportRecordCount"
    | "supportRecordRootSha256"
    | "conflictSourceCount"
    | "conflictSourceRootSha256"
  >
>;

type TrackedAfrikaansReferenceCatalog = Readonly<{
  summary: TrackedAfrikaansReferenceSummary;
  supportPairIdentities: ReadonlyMap<string, string>;
  referencePackRows: readonly unknown[];
}>;

function compareStringTuples(
  left: readonly string[],
  right: readonly string[],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareUnicodeCodePoints(
      left[index] ?? "",
      right[index] ?? "",
    );
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function trackedSupportKey(
  locale: string,
  source: string,
  sourceSha256: string,
  value: string,
  valueSha256: string,
): string {
  return canonicalTranslationAuditJson([
    locale,
    source,
    sourceSha256,
    value,
    valueSha256,
  ]);
}

function trackedSupportPairIdentity(
  locale: string,
  source: string,
  sourceSha256: string,
  value: string,
  valueSha256: string,
): string {
  return sha256CanonicalTranslationAuditJson([
    locale,
    source,
    sourceSha256,
    value,
    valueSha256,
  ]);
}

function packFieldValueRoot(
  pack: PackMaterial,
  source: ParsedMaster["sources"][number],
): string {
  return sha256CanonicalTranslationAuditJson(source.entries.map((entry) => {
    const value = pack.values.get(entry.key);
    if (value === undefined) {
      throw new Error(
        `Translation value disappeared for ${pack.locale}/${source.namespace}/${entry.key}.`,
      );
    }
    return [
      entry.key,
      entry.sourceSha256,
      sha256Bytes(Buffer.from(value, "utf8")),
    ];
  }));
}

function fieldIdentitySha256(
  binding: TranslationSemanticAuditManifest["results"]["packBindings"][number],
  entry: ParsedMaster["sources"][number]["entries"][number],
  valueSha256: string,
): string {
  return sha256CanonicalTranslationAuditJson([
    binding.locale,
    binding.language,
    binding.namespace,
    binding.sourceHash,
    entry.key,
    entry.sourceSha256,
    valueSha256,
    binding.origin,
    binding.packFileSha256,
  ]);
}

const ENGLISH_FUNCTION_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "but", "by",
  "can", "do", "for", "from", "has", "have", "if", "in", "into", "is",
  "it", "not", "of", "on", "or", "that", "the", "then", "this", "to",
  "when", "which", "will", "with", "you", "your",
]);
const TECHNICAL_SHARED_TERMS = new Set([
  "ai", "api", "apis", "chatgpt", "cloudflare", "css", "github", "google",
  "html", "inspir", "javascript", "openai", "pdf", "python", "seo",
  "typescript", "url", "urls",
]);
const PLACEHOLDER_PATTERN = /\{[A-Za-z0-9_]+\}/gu;
const NUMBER_PATTERN = /(?<![A-Za-z])\p{Nd}+(?:[.,:/-]\p{Nd}+)*(?![A-Za-z])/gu;
const ASCII_WORD_PATTERN = /[A-Za-z][A-Za-z'’\-]*/gu;
const ENGLISH_NEGATION_PATTERN = /\b(?:not|no|never|without|neither|nor|none|nothing|nobody|nowhere|cannot|unable|can['’]t|don['’]t|doesn['’]t|didn['’]t|won['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|shouldn['’]t|wouldn['’]t|couldn['’]t|mustn['’]t|haven['’]t|hasn['’]t|hadn['’]t)\b/iu;
const HIGH_RISK_SOURCE_PATTERN = /\b(?:account|age|child|children|consent|contract|data|delete|deletion|disclose|disclosure|law|legal|liability|liable|license|payment|personal|privacy|refund|rights?|security|terminate|termination|warrant(?:y|ies)|must|shall|may not|will not|prohibited|retention|jurisdiction)\b/iu;

type ParsedSourceEntry = ParsedMaster["sources"][number]["entries"][number];
type ParsedCheckpoint =
  | z.infer<typeof checkpointSchema>
  | z.infer<typeof afrikaansCheckpointSchema>;
type ParsedCheckpointFieldEvidence = z.infer<
  typeof checkpointFieldEvidenceSchema
>;
type ParsedCheckpointDerivationEvidence = z.infer<
  typeof checkpointDerivationEvidenceSchema
>;

function literalSegments(entry: ParsedSourceEntry): readonly string[] {
  return entry.segments
    .filter((segment) => segment.kind === "literal")
    .map((segment) => segment.value);
}

function normalizedWords(value: string): readonly string[] {
  return [...value.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)]
    .map((match) => python39Casefold(match[0].normalize("NFKC")));
}

function countUnicodeLetters(value: string): number {
  return [...value].filter((character) => /\p{L}/u.test(character)).length;
}

function regexValues(value: string, pattern: RegExp): readonly string[] {
  return [...value.matchAll(pattern)].map((match) => match[0]);
}

function sameStringMultiset(
  first: readonly string[],
  second: readonly string[],
): boolean {
  if (first.length !== second.length) return false;
  const counts = new Map<string, number>();
  for (const value of first) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of second) {
    const count = counts.get(value);
    if (!count) return false;
    if (count === 1) counts.delete(value); else counts.set(value, count - 1);
  }
  return counts.size === 0;
}

function literalCounts(
  literals: readonly string[],
  value: string,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const literal of new Set(literals)) {
    if (literal.length === 0) continue;
    result.set(literal, value.split(literal).length - 1);
  }
  return result;
}

function sameNumberMap(
  first: ReadonlyMap<string, number>,
  second: ReadonlyMap<string, number>,
): boolean {
  return first.size === second.size &&
    [...first].every(([key, value]) => second.get(key) === value);
}

function asciiWords(value: string): readonly string[] {
  return regexValues(value, ASCII_WORD_PATTERN).map((word) =>
    python39Casefold(word)
  );
}

function hasSourceNgramCopy(source: string, value: string): boolean {
  const sourceWords = asciiWords(source);
  const valueWords = asciiWords(value);
  const minimumWords = TRANSLATION_SEMANTIC_AUDIT_POLICY.sourceCopy
    .minimumExactNgramWords;
  const minimumCharacters = TRANSLATION_SEMANTIC_AUDIT_POLICY.sourceCopy
    .minimumExactNgramCharacters;
  if (sourceWords.length < minimumWords || valueWords.length < minimumWords) {
    return false;
  }
  const targetNgrams = new Set<string>();
  for (let index = 0; index <= valueWords.length - minimumWords; index += 1) {
    targetNgrams.add(canonicalTranslationAuditJson(
      valueWords.slice(index, index + minimumWords),
    ));
  }
  for (let index = 0; index <= sourceWords.length - minimumWords; index += 1) {
    const ngram = sourceWords.slice(index, index + minimumWords);
    if (
      targetNgrams.has(canonicalTranslationAuditJson(ngram)) &&
      ngram.join(" ").length >= minimumCharacters &&
      ngram.some((word) =>
        !ENGLISH_FUNCTION_WORDS.has(word) &&
        !TECHNICAL_SHARED_TERMS.has(word)
      )
    ) return true;
  }
  return false;
}

function hasUntranslatedSourceTokenCluster(
  source: string,
  value: string,
): boolean {
  const sourceWords = new Set(
    asciiWords(source).filter((word) =>
      word.length >= 5 &&
      !ENGLISH_FUNCTION_WORDS.has(word) &&
      !TECHNICAL_SHARED_TERMS.has(word)
    ),
  );
  const valueWords = new Set(asciiWords(value));
  let matches = 0;
  for (const word of sourceWords) {
    if (valueWords.has(word)) matches += 1;
  }
  return matches >= 3;
}

function splitClauses(value: string): readonly string[] {
  return value.split(/(?<=[.!?…;:])\s+|\n+/u);
}

function hasInternalDuplicateCollapse(source: string, value: string): boolean {
  const sourceWords = normalizedWords(source);
  const valueWords = normalizedWords(value);
  if (new Set(sourceWords).size <= new Set(valueWords).size) return false;
  for (let index = 0; index < valueWords.length; index += 1) {
    const word = valueWords[index];
    if (!word || word.length < 3) continue;
    if (valueWords[index + 1] === word || valueWords[index + 2] === word) {
      return true;
    }
  }
  const clauses = splitClauses(value)
    .map((clause) => normalizedWords(clause).join(" "))
    .filter(Boolean);
  return clauses.length !== new Set(clauses).size;
}

function duplicateFieldIndices(
  source: ParsedMaster["sources"][number],
  pack: PackMaterial,
): ReadonlySet<number> {
  const duplicate = new Set<number>();
  const owners = new Map<string, readonly [number, string]>();
  source.entries.forEach((entry, index) => {
    const value = pack.values.get(entry.key);
    if (value === undefined) {
      throw new Error(`Checkpoint pack value disappeared for ${pack.locale}/${pack.namespace}/${entry.key}.`);
    }
    const normalized = normalizedWords(value).join(" ");
    if (normalized.length < 4) return;
    const prior = owners.get(normalized);
    if (prior && prior[1] !== entry.sourceSha256) {
      duplicate.add(prior[0]);
      duplicate.add(index);
    } else {
      owners.set(normalized, [index, entry.sourceSha256]);
    }
  });
  return duplicate;
}

function semanticThreshold(source: string, legal: boolean): number {
  const policy = TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic;
  if (legal) return policy.legalMinimum;
  const words = normalizedWords(source).length;
  if (words <= 3) return policy.shortMinimum;
  if (words <= 7) return policy.mediumMinimum;
  return policy.standardMinimum;
}

function splitSentences(value: string): readonly string[] {
  const sentences = value.split(/(?<=[.!?…])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length === 0) return value.trim() ? [value.trim()] : [];
  return sentences.slice(0, 32);
}

export function roundTranslationSemanticAuditScoreToSixDecimals(
  raw: number,
): number {
  if (!Number.isFinite(raw)) {
    throw new Error("Cannot round a non-finite semantic score.");
  }
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, raw, false);
  const high = bits.getUint32(0, false);
  const low = bits.getUint32(4, false);
  const zero = BigInt(0);
  const one = BigInt(1);
  const two = BigInt(2);
  const million = BigInt(1_000_000);
  const negative = (high & 0x8000_0000) !== 0;
  const exponentBits = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0x000f_ffff) << BigInt(32)) | BigInt(low);
  const significand = exponentBits === 0
    ? fraction
    : (one << BigInt(52)) | fraction;
  const exponent = exponentBits === 0
    ? -1_074
    : exponentBits - 1_023 - 52;
  let roundedMagnitude: bigint;
  if (significand === zero) {
    roundedMagnitude = zero;
  } else if (exponent >= 0) {
    roundedMagnitude = (significand << BigInt(exponent)) * million;
  } else {
    const numerator = significand * million;
    const denominator = one << BigInt(-exponent);
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    const doubledRemainder = remainder * two;
    roundedMagnitude = quotient + (
        doubledRemainder > denominator ||
        (doubledRemainder === denominator && quotient % two === one)
      ? one
      : zero
    );
  }
  if (roundedMagnitude === zero) return negative ? -0 : 0;
  const signed = negative ? -roundedMagnitude : roundedMagnitude;
  return Number(signed) / 1_000_000;
}

function displayedSixDecimalScoreMatchesRaw(
  displayed: number | null | undefined,
  raw: number,
): boolean {
  if (
    displayed === null || displayed === undefined ||
    !Number.isFinite(displayed) || !Number.isFinite(raw)
  ) return false;
  return Object.is(
    displayed,
    roundTranslationSemanticAuditScoreToSixDecimals(raw),
  );
}

function assertRankedPredictions(
  predictions: readonly (readonly [string, number])[],
  label: string,
  expectedLength = 5,
): ReadonlyMap<string, number> {
  if (predictions.length !== expectedLength) {
    throw new Error(`${label} does not contain the exact pinned top-${expectedLength} predictions.`);
  }
  const result = new Map<string, number>();
  let prior = 2;
  for (const [language, probability] of predictions) {
    if (result.has(language) || probability > prior) {
      throw new Error(`${label} contains duplicate or non-ranked predictions.`);
    }
    result.set(language, probability);
    prior = probability;
  }
  return result;
}

function assertOptionalBacktranslationShape(
  evidence: ParsedCheckpointFieldEvidence,
): void {
  const values = [
    evidence.backtranslationSha256,
    evidence.backtranslationSimilarity,
    evidence.backtranslationLengthRatio,
    evidence.minimumSourceSentenceAlignment,
    evidence.minimumBacktranslationSentenceAlignment,
  ];
  if (evidence.backtranslationRequired !== values.every((value) => value !== undefined)) {
    throw new Error("Checkpoint backtranslation display evidence has a partial shape.");
  }
}

function assertCheckpointLanguagePredictionEvidence(
  binding: TranslationSemanticAuditManifest["results"]["packBindings"][number],
  pack: PackMaterial,
  sourcePack: ParsedMaster["sources"][number],
  index: number,
  evidence: ParsedCheckpointFieldEvidence,
  derivation: ParsedCheckpointDerivationEvidence,
): void {
  const entry = sourcePack.entries[index];
  if (!entry) throw new Error("Checkpoint prediction index escaped its source pack.");
  const value = pack.values.get(entry.key);
  if (value === undefined) throw new Error("Checkpoint prediction value disappeared.");
  const maskedSource = maskTranslationValue(entry.source, entry);
  const maskedValue = maskTranslationValue(value, entry);
  const sourceNormalized = normalizedWords(maskedSource).join(" ");
  const letters = countUnicodeLetters(maskedValue);
  const lidApplicable = Boolean(sourceNormalized) &&
    letters >= TRANSLATION_SEMANTIC_AUDIT_POLICY.language.minimumLetters;
  if (evidence.lidApplicable !== lidApplicable) {
    throw new Error("Checkpoint language applicability drifted.");
  }
  const whole = assertRankedPredictions(
    derivation.wholePredictions,
    "Checkpoint whole-field evidence",
    maskedValue.replace(/\n/gu, " ").trim() ? 5 : 0,
  );
  if (lidApplicable) {
    const targetLabel = binding.locale === "fil" ? "tl" : binding.locale;
    if (
      !displayedSixDecimalScoreMatchesRaw(
        evidence.targetLanguageProbability,
        whole.get(targetLabel) ?? 0,
      ) ||
      !displayedSixDecimalScoreMatchesRaw(
        evidence.englishProbability,
        whole.get("en") ?? 0,
      )
    ) throw new Error("Checkpoint displayed language scores drifted.");
  } else if (
    evidence.targetLanguageProbability !== null ||
    evidence.englishProbability !== null
  ) {
    throw new Error("Checkpoint inapplicable language display evidence is not empty.");
  }
  const expectedChunks = splitClauses(maskedValue)
    .map((chunk) => chunk.trim())
    .filter((chunk) =>
      countUnicodeLetters(chunk) >=
        TRANSLATION_SEMANTIC_AUDIT_POLICY.language.mixedChunkMinimumLetters
    );
  if (derivation.mixedChunkPredictions.length !== expectedChunks.length) {
    throw new Error("Checkpoint mixed-chunk prediction evidence is partial.");
  }
  derivation.mixedChunkPredictions.forEach((predictions) => {
    assertRankedPredictions(
      predictions,
      "Checkpoint mixed-chunk evidence",
      5,
    );
  });
}

function deriveAfrikaansRescue(
  binding: TranslationSemanticAuditManifest["results"]["packBindings"][number],
  pack: PackMaterial,
  sourcePack: ParsedMaster["sources"][number],
  index: number,
  evidence: ParsedCheckpointFieldEvidence,
  derivation: ParsedCheckpointDerivationEvidence,
  packGatePassed: boolean,
  trackedCatalog: TrackedAfrikaansReferenceCatalog,
  duplicateIndices: ReadonlySet<number>,
): Readonly<{
  rescueKind: "none" | "field-pair" | "tracked-curated";
  supportPairIdentity: string | null;
  remainingFailures: readonly string[];
}> {
  const entry = sourcePack.entries[index];
  if (!entry) throw new Error("Checkpoint field index escaped its source pack.");
  const value = pack.values.get(entry.key);
  if (value === undefined) throw new Error("Checkpoint field value disappeared.");
  const literals = literalSegments(entry);
  const maskedSource = maskTranslationValue(entry.source, entry);
  const maskedValue = maskTranslationValue(value, entry);
  const sourceNormalized = normalizedWords(maskedSource).join(" ");
  const valueNormalized = normalizedWords(maskedValue).join(" ");
  const failures = new Set<string>();
  const sourcePlaceholders = regexValues(entry.source, PLACEHOLDER_PATTERN);
  if (!sameStringMultiset(
    sourcePlaceholders,
    regexValues(value, PLACEHOLDER_PATTERN),
  )) failures.add("placeholder-parity");
  const sourceWithoutPlaceholders = entry.source.replace(PLACEHOLDER_PATTERN, " ");
  const valueWithoutPlaceholders = value.replace(PLACEHOLDER_PATTERN, " ");
  if (!sameStringMultiset(
    regexValues(sourceWithoutPlaceholders, NUMBER_PATTERN),
    regexValues(valueWithoutPlaceholders, NUMBER_PATTERN),
  )) failures.add("number-parity");
  if (!sameNumberMap(
    literalCounts(literals, entry.source),
    literalCounts(literals, value),
  )) failures.add("protected-literal-parity");
  if (sourceNormalized && sourceNormalized === valueNormalized) {
    failures.add("source-equality");
  }
  if (hasSourceNgramCopy(maskedSource, maskedValue)) {
    failures.add("source-span-copy");
  }
  if (hasUntranslatedSourceTokenCluster(maskedSource, maskedValue)) {
    failures.add("untranslated-source-token-cluster");
  }
  if (
    hasInternalDuplicateCollapse(maskedSource, maskedValue) ||
    duplicateIndices.has(index)
  ) failures.add("duplicate-collapse");

  const letters = countUnicodeLetters(maskedValue);
  const lidApplicable = Boolean(sourceNormalized) &&
    letters >= TRANSLATION_SEMANTIC_AUDIT_POLICY.language.minimumLetters;
  if (evidence.lidApplicable !== lidApplicable) {
    throw new Error("Checkpoint Afrikaans language applicability drifted.");
  }
  let wholePredictions = new Map<string, number>();
  if (lidApplicable) {
    wholePredictions = new Map(assertRankedPredictions(
      derivation.wholePredictions,
      "Checkpoint whole-field evidence",
    ));
    const targetProbability = wholePredictions.get("af") ?? 0;
    const englishProbability = wholePredictions.get("en") ?? 0;
    if (
      !displayedSixDecimalScoreMatchesRaw(
        evidence.targetLanguageProbability,
        targetProbability,
      ) ||
      !displayedSixDecimalScoreMatchesRaw(
        evidence.englishProbability,
        englishProbability,
      )
    ) throw new Error("Checkpoint Afrikaans displayed language scores drifted.");
    const minimum = letters <
        TRANSLATION_SEMANTIC_AUDIT_POLICY.language.shortTextLetters
      ? TRANSLATION_SEMANTIC_AUDIT_POLICY.language.minimumShortTargetProbability
      : TRANSLATION_SEMANTIC_AUDIT_POLICY.language.minimumTargetProbability;
    if (targetProbability < minimum) {
      failures.add("language-target-low-confidence");
    }
    if (
      englishProbability >
        TRANSLATION_SEMANTIC_AUDIT_POLICY.language.maximumEnglishProbability
    ) failures.add("mixed-english");
    const expectedChunks = splitClauses(maskedValue)
      .map((chunk) => chunk.trim())
      .filter((chunk) =>
        countUnicodeLetters(chunk) >=
          TRANSLATION_SEMANTIC_AUDIT_POLICY.language.mixedChunkMinimumLetters
      );
    if (derivation.mixedChunkPredictions.length !== expectedChunks.length) {
      throw new Error("Checkpoint Afrikaans mixed-chunk evidence is partial.");
    }
    for (const predictions of derivation.mixedChunkPredictions) {
      const probabilities = assertRankedPredictions(
        predictions,
        "Checkpoint mixed-chunk evidence",
      );
      if (
        (probabilities.get("en") ?? 0) >=
          TRANSLATION_SEMANTIC_AUDIT_POLICY.language.mixedChunkEnglishProbability &&
        (probabilities.get("af") ?? 0) <
          TRANSLATION_SEMANTIC_AUDIT_POLICY.language.minimumTargetProbability
      ) failures.add("mixed-english");
    }
  } else {
    if (
      evidence.targetLanguageProbability !== null ||
      evidence.englishProbability !== null
    ) {
      throw new Error("Checkpoint inapplicable language evidence is not empty.");
    }
    if (sourceNormalized) failures.add("language-evidence-insufficient");
  }

  const semanticRaw = derivation.semanticSimilarityRaw;
  const semanticApplicable = entry.segments.some((segment) =>
    segment.kind === "text" && countUnicodeLetters(segment.value) > 0
  );
  if (
    (semanticRaw === null && evidence.semanticSimilarity !== null) ||
    (semanticRaw !== null && !displayedSixDecimalScoreMatchesRaw(
      evidence.semanticSimilarity,
      semanticRaw,
    ))
  ) {
    throw new Error("Checkpoint Afrikaans displayed semantic score drifted.");
  }
  if (semanticApplicable !== (semanticRaw !== null)) {
    if (sourceNormalized && semanticRaw === null) {
      failures.add("model-evidence-missing");
    } else {
      throw new Error("Checkpoint Afrikaans semantic applicability drifted.");
    }
  } else if (
    semanticRaw !== null &&
    semanticRaw < semanticThreshold(entry.source, /^legal(?::|$)/.test(binding.namespace))
  ) failures.add("semantic-adequacy-low");
  const englishFunctionWords = new Set(
    asciiWords(maskedValue).filter((word) => ENGLISH_FUNCTION_WORDS.has(word)),
  );
  if (
    englishFunctionWords.size >=
      TRANSLATION_SEMANTIC_AUDIT_POLICY.sourceCopy.minimumDistinctEnglishFunctionWords
  ) failures.add("mixed-english");

  const legal = /^legal(?::|$)/.test(binding.namespace);
  const highRisk = legal || HIGH_RISK_SOURCE_PATTERN.test(entry.source) ||
    ENGLISH_NEGATION_PATTERN.test(entry.source) || sourcePlaceholders.length > 0 ||
    regexValues(sourceWithoutPlaceholders, NUMBER_PATTERN).length > 0;
  const backtranslationRequired = Boolean(
    sourceNormalized &&
      (highRisk || semanticRaw === null ||
        semanticRaw < TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic.backtranslationTrigger),
  );
  assertOptionalBacktranslationShape(evidence);
  if (evidence.backtranslationRequired !== backtranslationRequired) {
    throw new Error("Checkpoint Afrikaans backtranslation requirement drifted.");
  }
  if (backtranslationRequired) {
    const backtranslation = derivation.backtranslation;
    const backScore = derivation.backtranslationSimilarityRaw;
    const alignment = derivation.alignment;
    if (backtranslation === null || backScore === null || alignment === null) {
      throw new Error("Checkpoint Afrikaans backtranslation evidence is partial.");
    }
    if (
      evidence.backtranslationSha256 !== sha256Bytes(Buffer.from(backtranslation, "utf8")) ||
      !displayedSixDecimalScoreMatchesRaw(
        evidence.backtranslationSimilarity,
        backScore,
      )
    ) throw new Error("Checkpoint Afrikaans backtranslation evidence drifted.");
    const minimumBackScore = legal
      ? TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic.legalBacktranslationMinimum
      : TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic.backtranslationMinimum;
    if (backScore < minimumBackScore) failures.add("backtranslation-adequacy-low");
    if (
      ENGLISH_NEGATION_PATTERN.test(entry.source) !==
        ENGLISH_NEGATION_PATTERN.test(backtranslation)
    ) failures.add("negation-parity");
    const sourceWordCount = Math.max(1, normalizedWords(maskedSource).length);
    const backWordCount = normalizedWords(
      maskTranslationValue(backtranslation, entry),
    ).length;
    const ratio = backWordCount / sourceWordCount;
    if (!displayedSixDecimalScoreMatchesRaw(
      evidence.backtranslationLengthRatio,
      ratio,
    )) {
      throw new Error("Checkpoint Afrikaans backtranslation length ratio drifted.");
    }
    const minimumRatio = legal
      ? TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic.legalMinimumBacktranslationLengthRatio
      : TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic.minimumBacktranslationLengthRatio;
    const maximumRatio = legal
      ? TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic.legalMaximumBacktranslationLengthRatio
      : TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic.maximumBacktranslationLengthRatio;
    if (ratio < minimumRatio) failures.add("possible-omission");
    if (ratio > maximumRatio) failures.add("possible-addition");
    const sourceSentences = splitSentences(entry.source);
    const backSentences = splitSentences(backtranslation);
    if (
      canonicalTranslationAuditJson(alignment.sourceSentences) !==
        canonicalTranslationAuditJson(sourceSentences) ||
      canonicalTranslationAuditJson(alignment.backtranslationSentences) !==
        canonicalTranslationAuditJson(backSentences) ||
      alignment.scores.length !== sourceSentences.length * backSentences.length
    ) throw new Error("Checkpoint Afrikaans sentence alignment inputs drifted.");
    const rows = sourceSentences.map((_, sourceIndex) =>
      alignment.scores.slice(
        sourceIndex * backSentences.length,
        (sourceIndex + 1) * backSentences.length,
      )
    );
    const minimumSource = Math.min(...rows.map((row) => Math.max(...row)));
    const minimumBack = Math.min(...backSentences.map((_, backIndex) =>
      Math.max(...rows.map((row) => row[backIndex] ?? -1))
    ));
    if (
      !displayedSixDecimalScoreMatchesRaw(
        evidence.minimumSourceSentenceAlignment,
        minimumSource,
      ) ||
      !displayedSixDecimalScoreMatchesRaw(
        evidence.minimumBacktranslationSentenceAlignment,
        minimumBack,
      )
    ) throw new Error("Checkpoint Afrikaans sentence alignment minima drifted.");
    const minimumAlignment = legal
      ? TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic.legalSentenceAlignmentMinimum
      : TRANSLATION_SEMANTIC_AUDIT_POLICY.semantic.sentenceAlignmentMinimum;
    if (minimumSource < minimumAlignment) failures.add("possible-omission");
    if (minimumBack < minimumAlignment) failures.add("possible-addition");
  } else if (
    derivation.backtranslation !== null ||
    derivation.backtranslationSimilarityRaw !== null ||
    derivation.alignment !== null
  ) {
    throw new Error("Checkpoint has unexpected Afrikaans backtranslation evidence.");
  }

  const valueSha256 = sha256Bytes(Buffer.from(value, "utf8"));
  const supportPairIdentity = binding.origin === "candidate"
    ? trackedCatalog.supportPairIdentities.get(trackedSupportKey(
      "af", entry.source, entry.sourceSha256, value, valueSha256,
    )) ?? null
    : null;
  if (evidence.supportPairIdentity !== supportPairIdentity) {
    throw new Error("Checkpoint tracked rescue support-pair identity drifted.");
  }
  let rescueKind: "none" | "field-pair" | "tracked-curated" = "none";
  const onlyLow = failures.size === 1 &&
    failures.has("language-target-low-confidence");
  const firstLabels = derivation.wholePredictions.slice(0, 2)
    .map(([label]) => label);
  const pairLabels = firstLabels.length === 2 &&
    new Set(firstLabels).size === 2 && firstLabels.includes("af") &&
    firstLabels.includes("nl");
  if (
    packGatePassed && onlyLow && pairLabels &&
    (wholePredictions.get("af") ?? 0) + (wholePredictions.get("nl") ?? 0) >=
      TRANSLATION_SEMANTIC_AUDIT_POLICY.language.afrikaansPackContext
        .minimumFieldPairProbability &&
    (wholePredictions.get("en") ?? 0) <=
      TRANSLATION_SEMANTIC_AUDIT_POLICY.language.maximumEnglishProbability
  ) {
    rescueKind = "field-pair";
  } else if (
    packGatePassed && onlyLow && binding.origin === "candidate" &&
    supportPairIdentity !== null
  ) {
    rescueKind = "tracked-curated";
  }
  if (evidence.afrikaansRescueKind !== rescueKind) {
    throw new Error("Checkpoint Afrikaans rescue kind drifted from policy evidence.");
  }
  if (rescueKind !== "none") failures.delete("language-target-low-confidence");
  return Object.freeze({
    rescueKind,
    supportPairIdentity,
    remainingFailures: [...failures].sort(compareUnicodeCodePoints),
  });
}

function deriveTrackedAfrikaansReferenceCatalog(
  manifest: AnyTranslationSemanticAuditManifest,
  validated: ReturnType<typeof validateMaster>,
  packs: ReadonlyMap<string, PackMaterial>,
): TrackedAfrikaansReferenceCatalog {
  const bindingByIdentity = new Map<
    string,
    TranslationSemanticAuditManifest["results"]["packBindings"][number]
  >(
    manifest.results.packBindings.map((binding) => [
      `${binding.locale}\u0000${binding.namespace}`,
      binding,
    ] as const),
  );
  const references: Array<Readonly<{
    source: ParsedMaster["sources"][number];
    pack: PackMaterial;
    binding: TranslationSemanticAuditManifest["results"]["packBindings"][number];
    gatePassed: boolean;
  }>> = [];
  const identityRows: unknown[] = [];
  const gateRows: unknown[] = [];
  for (const source of validated.sources.values()) {
    const identity = `af\u0000${source.namespace}`;
    if (validated.jobs.has(identity)) continue;
    const pack = packs.get(identity);
    const binding = bindingByIdentity.get(identity);
    if (
      !pack ||
      !binding ||
      pack.locale !== "af" ||
      pack.origin !== "curated" ||
      binding.origin !== "curated"
    ) {
      throw new Error(
        `Active tracked Afrikaans reference is missing or candidate-origin: ${source.namespace}.`,
      );
    }
    const gatePassed = validateAfrikaansPackContextBase(
      binding,
      pack,
      source,
    );
    const evidence = binding.afrikaansPackContext;
    if (evidence === null) {
      throw new Error(
        `Tracked Afrikaans reference has no pack gate evidence: ${source.namespace}.`,
      );
    }
    const fieldValueRootSha256 = packFieldValueRoot(pack, source);
    identityRows.push([
      "af",
      source.namespace,
      source.sourceHash,
      source.sourceEntriesSha256,
      pack.packFileSha256,
      source.entries.length,
      fieldValueRootSha256,
    ]);
    gateRows.push({
      locale: "af",
      namespace: source.namespace,
      sourceHash: source.sourceHash,
      sourceEntriesSha256: source.sourceEntriesSha256,
      packFileSha256: pack.packFileSha256,
      fields: source.entries.length,
      fieldValueRootSha256,
      contextSha256: evidence.contextSha256,
      distinctMaskedValues: evidence.distinctMaskedValues,
      maskedLetters: evidence.maskedLetters,
      eligible: evidence.eligible,
      predictions: evidence.predictions,
      gatePassed,
    });
    references.push(Object.freeze({ source, pack, binding, gatePassed }));
  }

  type Occurrence = Readonly<{
    namespace: string;
    key: string;
    packFileSha256: string;
    source: string;
    sourceSha256: string;
    value: string;
    valueSha256: string;
    gatePassed: boolean;
  }>;
  const sourceBytesByHash = new Map<string, string>();
  const occurrencesBySourceHash = new Map<string, Occurrence[]>();
  const valuesBySourceHash = new Map<
    string,
    Map<string, readonly [string, string, string]>
  >();
  for (const reference of references) {
    for (const entry of reference.source.entries) {
      const value = reference.pack.values.get(entry.key);
      if (value === undefined) {
        throw new Error(
          `Tracked Afrikaans reference field disappeared: ${reference.source.namespace}/${entry.key}.`,
        );
      }
      const priorSource = sourceBytesByHash.get(entry.sourceSha256);
      if (priorSource !== undefined && priorSource !== entry.source) {
        throw new Error(
          "Tracked Afrikaans references contain a source-hash collision.",
        );
      }
      sourceBytesByHash.set(entry.sourceSha256, entry.source);
      const valueSha256 = sha256Bytes(Buffer.from(value, "utf8"));
      const occurrence: Occurrence = Object.freeze({
        namespace: reference.source.namespace,
        key: entry.key,
        packFileSha256: reference.pack.packFileSha256,
        source: entry.source,
        sourceSha256: entry.sourceSha256,
        value,
        valueSha256,
        gatePassed: reference.gatePassed,
      });
      const occurrences = occurrencesBySourceHash.get(entry.sourceSha256) ?? [];
      occurrences.push(occurrence);
      occurrencesBySourceHash.set(entry.sourceSha256, occurrences);
      const values = valuesBySourceHash.get(entry.sourceSha256) ?? new Map();
      const valueTuple = [entry.source, value, valueSha256] as const;
      values.set(canonicalTranslationAuditJson(valueTuple), valueTuple);
      valuesBySourceHash.set(entry.sourceSha256, values);
    }
  }

  const conflictRows: unknown[] = [];
  const supportPairRows: Array<readonly string[]> = [];
  const supportRecordRows: Array<readonly unknown[]> = [];
  const supportPairIdentities = new Map<string, string>();
  for (const sourceSha256 of [...valuesBySourceHash.keys()].sort()) {
    const values = valuesBySourceHash.get(sourceSha256);
    const occurrences = occurrencesBySourceHash.get(sourceSha256) ?? [];
    if (!values) continue;
    if (values.size !== 1) {
      conflictRows.push([
        sourceSha256,
        [...values.values()].sort(compareStringTuples),
      ]);
      continue;
    }
    const [source, value, valueSha256] = [...values.values()][0] ?? [];
    if (
      source === undefined ||
      value === undefined ||
      valueSha256 === undefined
    ) {
      throw new Error("Tracked Afrikaans reference support is malformed.");
    }
    const supporting = occurrences.filter((occurrence) => occurrence.gatePassed);
    if (supporting.length === 0) continue;
    const pairIdentity = trackedSupportPairIdentity(
      "af",
      source,
      sourceSha256,
      value,
      valueSha256,
    );
    supportPairIdentities.set(
      trackedSupportKey("af", source, sourceSha256, value, valueSha256),
      pairIdentity,
    );
    supportPairRows.push([
      pairIdentity,
      "af",
      source,
      sourceSha256,
      value,
      valueSha256,
    ]);
    for (const occurrence of supporting) {
      supportRecordRows.push([
        "af",
        occurrence.namespace,
        occurrence.key,
        occurrence.packFileSha256,
        source,
        sourceSha256,
        value,
        valueSha256,
        true,
        pairIdentity,
      ]);
    }
  }
  supportPairRows.sort((left, right) =>
    compareUnicodeCodePoints(left[3] ?? "", right[3] ?? "") ||
    compareUnicodeCodePoints(left[5] ?? "", right[5] ?? "")
  );
  supportRecordRows.sort((left, right) =>
    compareUnicodeCodePoints(String(left[1] ?? ""), String(right[1] ?? "")) ||
    compareUnicodeCodePoints(String(left[2] ?? ""), String(right[2] ?? "")) ||
    compareUnicodeCodePoints(String(left[3] ?? ""), String(right[3] ?? ""))
  );
  const summary: TrackedAfrikaansReferenceSummary = Object.freeze({
    referencePacks: references.length,
    referencePackIdentityRootSha256:
      sha256CanonicalTranslationAuditJson(identityRows),
    referencePackGateEvidenceRootSha256:
      manifest.results.afrikaansTrackedCurated
        .referencePackGateEvidenceRootSha256,
    supportPairCount: supportPairRows.length,
    supportPairRootSha256:
      sha256CanonicalTranslationAuditJson(supportPairRows),
    supportRecordCount: supportRecordRows.length,
    supportRecordRootSha256:
      sha256CanonicalTranslationAuditJson(supportRecordRows),
    conflictSourceCount: conflictRows.length,
    conflictSourceRootSha256:
      sha256CanonicalTranslationAuditJson(conflictRows),
  });
  return Object.freeze({
    summary,
    supportPairIdentities,
    referencePackRows: Object.freeze(gateRows),
  });
}

function assertAfrikaansPackContext(
  binding: TranslationSemanticAuditManifest["results"]["packBindings"][number],
  pack: PackMaterial,
  source: ParsedMaster["sources"][number],
  catalog: TrackedAfrikaansReferenceCatalog,
): void {
  validateAfrikaansPackContextBase(binding, pack, source);
  const evidence = binding.afrikaansPackContext;
  if (evidence === null) return;
  const referenceMatchRows: Array<readonly [string, string]> = [];
  if (binding.origin === "candidate") {
    for (const entry of source.entries) {
      const value = pack.values.get(entry.key);
      if (value === undefined) {
        throw new Error(
          `Translation value disappeared for af/${source.namespace}/${entry.key}.`,
        );
      }
      const valueSha256 = sha256Bytes(Buffer.from(value, "utf8"));
      const supportPairIdentity = catalog.supportPairIdentities.get(
        trackedSupportKey(
          "af",
          entry.source,
          entry.sourceSha256,
          value,
          valueSha256,
        ),
      );
      if (supportPairIdentity !== undefined) {
        referenceMatchRows.push([
          fieldIdentitySha256(binding, entry, valueSha256),
          supportPairIdentity,
        ]);
      }
    }
  }
  if (
    evidence.referenceMatchFields !== referenceMatchRows.length ||
    evidence.referenceMatchRootSha256 !==
      sha256CanonicalTranslationAuditJson(referenceMatchRows) ||
    evidence.trackedCuratedRescuedFields > referenceMatchRows.length
  ) {
    throw new Error(
      `Afrikaans tracked-curated match evidence drifted: ${binding.namespace}.`,
    );
  }
}

function assertPackBindings(
  manifest: AnyTranslationSemanticAuditManifest,
  validated: ReturnType<typeof validateMaster>,
  packs: ReadonlyMap<string, PackMaterial>,
  expectedLocales: readonly (keyof typeof LANGUAGE_BY_LOCALE)[],
  expectedPacks: number,
): void {
  const trackedCatalog = deriveTrackedAfrikaansReferenceCatalog(
    manifest,
    validated,
    packs,
  );
  const namespaces = [...validated.sources.keys()];
  const expectedOrder = expectedLocales.flatMap((locale) =>
    namespaces.map((namespace) => `${locale}\u0000${namespace}`)
  );
  const actualOrder = manifest.results.packBindings.map((binding) => `${binding.locale}\u0000${binding.namespace}`);
  assertExactArray(actualOrder, expectedOrder, "Semantic audit pack binding order");
  let fields = 0;
  let curatedPacks = 0;
  let candidatePacks = 0;
  let legalFields = 0;
  let fieldPairRescuedFields = 0;
  let trackedCuratedRescuedFields = 0;
  const trackedRescuePackRows: unknown[] = [];
  for (const binding of manifest.results.packBindings) {
    const key = `${binding.locale}\u0000${binding.namespace}`;
    const source = validated.sources.get(binding.namespace);
    const pack = packs.get(key);
    if (!source || !pack) throw new Error(`Semantic audit pack binding is unregistered: ${binding.locale}/${binding.namespace}.`);
    const fieldRows = source.entries.map((entry) => {
      const value = pack.values.get(entry.key);
      if (value === undefined) throw new Error(`Translation value disappeared for ${binding.locale}/${binding.namespace}/${entry.key}.`);
      const valueSha256 = sha256Bytes(Buffer.from(value, "utf8"));
      const identitySha256 = fieldIdentitySha256(
        binding,
        entry,
        valueSha256,
      );
      return [identitySha256, entry.key, entry.sourceSha256, valueSha256];
    });
    assertAfrikaansPackContext(binding, pack, source, trackedCatalog);
    if (binding.language !== pack.language || binding.sourceHash !== source.sourceHash ||
        binding.sourceEntriesSha256 !== source.sourceEntriesSha256 || binding.origin !== pack.origin ||
        binding.packFileSha256 !== pack.packFileSha256 || binding.fields !== source.entries.length ||
        binding.fieldIdentityRootSha256 !== sha256CanonicalTranslationAuditJson(fieldRows) ||
        binding.unadjudicatedFields !== 0 || binding.adjudicatedFields !== 0) {
      throw new Error(`Semantic audit pack binding drifted for ${binding.locale}/${binding.namespace}.`);
    }
    fields += binding.fields;
    if (binding.origin === "candidate") candidatePacks += 1; else curatedPacks += 1;
    if (/^legal(?::|$)/.test(binding.namespace)) legalFields += binding.fields;
    const context = binding.afrikaansPackContext;
    if (context !== null) {
      fieldPairRescuedFields += context.fieldPairRescuedFields;
      trackedCuratedRescuedFields += context.trackedCuratedRescuedFields;
      trackedRescuePackRows.push([
        binding.locale,
        binding.namespace,
        context.trackedCuratedRescuedFields,
        context.trackedCuratedRescueRootSha256,
      ]);
    }
  }
  const counts = manifest.results.counts;
  if (fields !== validated.fields || counts.fields !== fields ||
      counts.candidatePacks !== candidatePacks || counts.curatedPacks !== curatedPacks ||
      candidatePacks + curatedPacks !== expectedPacks ||
      counts.legalFields !== legalFields || counts.languageEvidenceFields > fields ||
      counts.backtranslatedFields > fields) {
    throw new Error("Semantic audit aggregate counts drifted from pack bindings.");
  }
  const identityRoot = sha256CanonicalTranslationAuditJson(manifest.results.packBindings.map((binding) => [
    binding.locale, binding.namespace, binding.sourceHash, binding.origin,
    binding.packFileSha256, binding.fieldIdentityRootSha256,
  ]));
  const trackedGlobal = {
    ...trackedCatalog.summary,
    fieldPairRescuedFields,
    trackedCuratedRescuedFields,
    trackedCuratedRescueRootSha256:
      sha256CanonicalTranslationAuditJson(trackedRescuePackRows),
  };
  if (
    canonicalTranslationAuditJson(trackedGlobal) !==
      canonicalTranslationAuditJson(
        manifest.results.afrikaansTrackedCurated,
      )
  ) {
    throw new Error(
      "Semantic audit tracked Afrikaans support/conflict/rescue evidence drifted.",
    );
  }
  const packEvidenceRows = manifest.results.packBindings.map((binding) => [
    binding.locale,
    binding.namespace,
    binding.fieldEvidenceRootSha256,
    binding.unadjudicatedFields,
    binding.adjudicatedFields,
  ]);
  const evidenceRoot = sha256CanonicalTranslationAuditJson({
    packBindings: packEvidenceRows,
    afrikaansTrackedCurated: trackedGlobal,
  });
  if (identityRoot !== manifest.results.packIdentityRootSha256 ||
      evidenceRoot !== manifest.results.packEvidenceRootSha256 ||
      manifest.results.failureRecords.sha256 !== sha256CanonicalTranslationAuditJson([])) {
    throw new Error("Semantic audit result roots are stale or tampered.");
  }
}

type VerifiedCheckpointChain = Readonly<{
  rootPath: string;
  rootIdentity: StableIdentity;
  entries: readonly string[];
  files: readonly StableFile[];
  expectedPacks: number;
}>;

function checkpointEvidenceBinding(
  evidence: AnyTranslationSemanticAuditManifest["results"]["checkpointEvidence"],
  scope: SemanticAuditScopeConfiguration,
): z.infer<typeof checkpointEvidenceBindingSchema> |
  z.infer<typeof afrikaansCheckpointEvidenceBindingSchema> {
  const material = {
    schemaVersion: evidence.schemaVersion,
    kind: evidence.kind,
    checkpointRootPath: evidence.checkpointRootPath,
    sessionSha256: evidence.sessionSha256,
    sessionRecordSha256: evidence.sessionRecordSha256,
    sessionFileSha256: evidence.sessionFileSha256,
    checkpointCount: evidence.checkpointCount,
    terminalCheckpointSha256: evidence.terminalCheckpointSha256,
    checkpointChainRootSha256: evidence.checkpointChainRootSha256,
    packRescueRecordCount: evidence.packRescueRecordCount,
    packRescueRecordRootSha256: evidence.packRescueRecordRootSha256,
    fieldPairRescuedFields: evidence.fieldPairRescuedFields,
    trackedCuratedRescuedFields: evidence.trackedCuratedRescuedFields,
  };
  return scope.name === "full"
    ? checkpointEvidenceBindingSchema.parse(material)
    : afrikaansCheckpointEvidenceBindingSchema.parse(material);
}

function privateCheckpointDirectoryIdentity(
  rootPath: string,
): StableIdentity {
  assertNoSymlinkComponents(rootPath, "Semantic checkpoint root");
  const metadata = lstatSync(rootPath, { bigint: true });
  const expectedUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : metadata.uid;
  if (
    !metadata.isDirectory() || metadata.isSymbolicLink() ||
    Number(metadata.mode & BigInt(0o777)) !== 0o700 ||
    metadata.uid !== expectedUid || realpathSync(rootPath) !== rootPath
  ) {
    throw new Error(
      "Semantic checkpoint root must be an owned private mode-0700 directory.",
    );
  }
  return identity(metadata);
}

function checkpointTreeEntries(
  rootPath: string,
  expectedPacks: number,
): readonly string[] {
  const entries = readdirSync(rootPath).sort(compareUnicodeCodePoints);
  if (
    entries.length !== expectedPacks + 1 ||
    entries.filter((entry) => entry === "session.json").length !== 1
  ) {
    throw new Error(
      "Semantic checkpoint root does not contain the exact session and terminal chain.",
    );
  }
  return entries;
}

function assertCheckpointChainUnchanged(
  chain: VerifiedCheckpointChain,
): void {
  const currentIdentity = privateCheckpointDirectoryIdentity(chain.rootPath);
  if (!sameIdentity(chain.rootIdentity, currentIdentity)) {
    throw new Error("Semantic checkpoint root changed during verification.");
  }
  const entries = checkpointTreeEntries(chain.rootPath, chain.expectedPacks);
  if (canonicalTranslationAuditJson(entries) !==
      canonicalTranslationAuditJson(chain.entries)) {
    throw new Error("Semantic checkpoint entry set changed during verification.");
  }
  for (const file of chain.files) {
    assertStableFileUnchanged(
      file,
      MAXIMUM_JSON_BYTES,
      "Semantic checkpoint chain file",
      0o400,
    );
  }
}

function verifyCheckpointChain(input: Readonly<{
  workspaceRoot: string;
  runRoot: string;
  manifestPath: string;
  manifest: AnyTranslationSemanticAuditManifest;
  validated: ReturnType<typeof validateMaster>;
  packs: ReadonlyMap<string, PackMaterial>;
  scope: SemanticAuditScopeConfiguration;
}>): VerifiedCheckpointChain {
  const {
    workspaceRoot,
    runRoot,
    manifestPath,
    manifest,
    validated,
    packs,
    scope,
  } =
    input;
  const checkpointRoot = path.join(
    runRoot,
    scope.checkpointRootBasename,
  );
  const checkpointRootRelative = workspaceRelative(
    workspaceRoot,
    checkpointRoot,
  );
  const evidence = manifest.results.checkpointEvidence;
  if (evidence.checkpointRootPath !== checkpointRootRelative) {
    throw new Error("Semantic checkpoint root path is stale or redirected.");
  }
  const rootIdentity = privateCheckpointDirectoryIdentity(checkpointRoot);
  const entries = checkpointTreeEntries(checkpointRoot, scope.packs);
  const checkpointBasenames = entries.filter((entry) => entry !== "session.json");
  let aggregateBytes = 0;
  for (const basename of entries) {
    const metadata = lstatSync(path.join(checkpointRoot, basename), {
      bigint: true,
    });
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== BigInt(1)) {
      throw new Error("Semantic checkpoint root contains a noncanonical resource.");
    }
    aggregateBytes += Number(metadata.size);
    if (aggregateBytes > MAXIMUM_TREE_BYTES) {
      throw new Error("Semantic checkpoint chain exceeds its cumulative byte bound.");
    }
  }

  const trackedCatalog = deriveTrackedAfrikaansReferenceCatalog(
    manifest,
    validated,
    packs,
  );
  const packOrder = manifest.results.packBindings.map((binding) => [
    binding.locale,
    binding.namespace,
  ]);
  const sessionBinding = {
    schemaVersion: 1,
    kind: TRANSLATION_SEMANTIC_AUDIT_SESSION_KIND,
    auditVersion: manifest.auditVersion,
    scope: {
      name: manifest.scope.name,
      locales: manifest.scope.locales,
      namespaces: manifest.scope.namespaces,
      packs: manifest.scope.packs,
      fields: manifest.scope.fields,
      packOrderSha256: sha256CanonicalTranslationAuditJson(packOrder),
    },
    policy: {
      sha256: manifest.policy.sha256,
      implementationSha256: manifest.policy.implementationSha256,
    },
    models: {
      modelLockSha256: manifest.models.modelLockSha256,
      fasttextSha256: manifest.models.fasttext.sha256,
      labseTreeSha256: manifest.models.labse.treeSha256,
      madladTreeSha256: manifest.models.madlad.treeSha256,
      runtimeVersions: manifest.models.runtimeVersions,
    },
    inputs: {
      paths: {
        masterWorklist: manifest.inputs.masterWorklist.path,
        curatedTree: manifest.inputs.curatedTree.path,
        staticMainAppTree: manifest.inputs.staticMainAppTree.path,
        candidateTree: manifest.inputs.candidateTree.path,
        packWorklistTree: manifest.inputs.packWorklistTree.path,
        output: workspaceRelative(workspaceRoot, manifestPath),
        checkpointRoot: checkpointRootRelative,
      },
      masterWorklistSha256: manifest.inputs.masterWorklist.worklistSha256,
      masterWorklistFileSha256: manifest.inputs.masterWorklist.fileSha256,
      generatorExecutionProfile:
        manifest.inputs.masterWorklist.generatorExecutionProfile,
      generatorExecutionProfileSha256:
        manifest.inputs.masterWorklist.generatorExecutionProfileSha256,
      curatedTree: {
        exists: manifest.inputs.curatedTree.exists,
        sha256: manifest.inputs.curatedTree.sha256,
        files: manifest.inputs.curatedTree.files,
        bytes: manifest.inputs.curatedTree.bytes,
      },
      staticMainAppTree: {
        exists: manifest.inputs.staticMainAppTree.exists,
        sha256: manifest.inputs.staticMainAppTree.sha256,
        files: manifest.inputs.staticMainAppTree.files,
        bytes: manifest.inputs.staticMainAppTree.bytes,
      },
      candidateTree: {
        exists: manifest.inputs.candidateTree.exists,
        sha256: manifest.inputs.candidateTree.sha256,
        files: manifest.inputs.candidateTree.files,
        bytes: manifest.inputs.candidateTree.bytes,
      },
      packWorklistTree: {
        exists: manifest.inputs.packWorklistTree.exists,
        sha256: manifest.inputs.packWorklistTree.sha256,
        files: manifest.inputs.packWorklistTree.files,
        bytes: manifest.inputs.packWorklistTree.bytes,
      },
      adjudicationSha256: manifest.inputs.adjudicationSha256,
      trackedAfrikaansReferences: {
        locale: "af",
        packs: trackedCatalog.summary.referencePacks,
        packIdentityRootSha256:
          trackedCatalog.summary.referencePackIdentityRootSha256,
      },
    },
    executionProfile: TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE,
    executionProfileSha256: sha256CanonicalTranslationAuditJson(
      TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE,
    ),
  };
  const sessionBindingSha256 = sha256CanonicalTranslationAuditJson(
    sessionBinding,
  );
  const plans = manifest.results.packBindings.map((binding, index) => {
    const pack = packs.get(`${binding.locale}\u0000${binding.namespace}`);
    const source = validated.sources.get(binding.namespace);
    if (!pack || !source) {
      throw new Error("Semantic checkpoint plan references an unregistered pack.");
    }
    const descriptor = {
      ordinal: index + 1,
      locale: binding.locale,
      language: binding.language,
      namespace: binding.namespace,
      sourceHash: binding.sourceHash,
      sourceEntriesSha256: binding.sourceEntriesSha256,
      origin: binding.origin,
      packFileSha256: binding.packFileSha256,
      fields: binding.fields,
      fieldValueRootSha256: packFieldValueRoot(pack, source),
    };
    return Object.freeze({
      binding,
      pack,
      source,
      descriptor,
      packInputSha256: sha256CanonicalTranslationAuditJson({
        sessionBindingSha256,
        ...descriptor,
      }),
    });
  });
  const session = {
    ...sessionBinding,
    packInputRootSha256: sha256CanonicalTranslationAuditJson(
      plans.map((plan) => [
        plan.descriptor.ordinal,
        plan.descriptor.locale,
        plan.descriptor.namespace,
        plan.packInputSha256,
      ]),
    ),
  };
  const sessionSha256 = sha256CanonicalTranslationAuditJson(session);
  const sessionFile = readStableRegularFile(
    path.join(checkpointRoot, "session.json"),
    MAXIMUM_JSON_BYTES,
    "Semantic checkpoint session record",
    0o400,
  );
  const rawSessionRecord = strictJson(
    sessionFile.bytes,
    "Semantic checkpoint session record",
  );
  const rawSessionCanonical = canonicalRawObject(
    sessionFile.bytes,
    "Semantic checkpoint session record",
  );
  const sessionRecord = parseWithSchema(
    checkpointSessionRecordSchema,
    rawSessionRecord,
    "Semantic checkpoint session record",
  );
  if (
    rawCanonicalObjectDigestWithoutMember(
      rawSessionCanonical,
      "sessionRecordSha256",
      "Semantic checkpoint session record",
    ) !== sessionRecord.sessionRecordSha256 ||
    sessionRecord.sessionSha256 !== sessionSha256 ||
    canonicalTranslationAuditJson(sessionRecord.session) !==
      canonicalTranslationAuditJson(session) ||
    sessionRecord.createdAt !== manifest.createdAt ||
    evidence.sessionSha256 !== sessionSha256 ||
    evidence.sessionRecordSha256 !== sessionRecord.sessionRecordSha256 ||
    evidence.sessionFileSha256 !== sessionFile.sha256
  ) {
    throw new Error("Semantic checkpoint session binding is stale or tampered.");
  }

  const chainRows: unknown[] = [];
  const rescuePackRootRows: unknown[] = [];
  const stableFiles: StableFile[] = [sessionFile];
  let previousCheckpointSha256: string | null = null;
  let priorTrackedReferenceEvidence: string | null = null;
  let totalLanguageFields = 0;
  let totalBacktranslatedFields = 0;
  let totalFieldPairRescues = 0;
  let totalTrackedRescues = 0;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const basename = checkpointBasenames[index];
    const rescueRecord = evidence.packRescueRecords[index];
    if (!plan || !basename || !rescueRecord) {
      throw new Error("Semantic checkpoint chain is a subset or superset.");
    }
    const match = /^(\d{5})-([a-f0-9]{64})-([a-f0-9]{64})\.json$/.exec(
      basename,
    );
    if (
      !match || Number(match[1]) !== plan.descriptor.ordinal ||
      match[2] !== plan.packInputSha256
    ) {
      throw new Error("Semantic checkpoint filename order or input binding drifted.");
    }
    const checkpointFile = readStableRegularFile(
      path.join(checkpointRoot, basename),
      MAXIMUM_JSON_BYTES,
      `Semantic checkpoint ${plan.descriptor.ordinal}`,
      0o400,
    );
    stableFiles.push(checkpointFile);
    const rawCheckpoint = strictJson(
      checkpointFile.bytes,
      `Semantic checkpoint ${plan.descriptor.ordinal}`,
    );
    const rawCheckpointCanonical = canonicalRawObject(
      checkpointFile.bytes,
      `Semantic checkpoint ${plan.descriptor.ordinal}`,
    );
    const checkpoint: ParsedCheckpoint = scope.name === "full"
      ? parseWithSchema(
        checkpointSchema,
        rawCheckpoint,
        `Semantic checkpoint ${plan.descriptor.ordinal}`,
      )
      : parseWithSchema(
        afrikaansCheckpointSchema,
        rawCheckpoint,
        `Semantic checkpoint ${plan.descriptor.ordinal}`,
      );
    if (
      rawCanonicalObjectDigestWithoutMember(
        rawCheckpointCanonical,
        "checkpointSha256",
        `Semantic checkpoint ${plan.descriptor.ordinal}`,
      ) !== checkpoint.checkpointSha256 ||
      checkpoint.checkpointSha256 !== match[3] ||
      checkpoint.sessionSha256 !== sessionSha256 ||
      checkpoint.ordinal !== plan.descriptor.ordinal ||
      checkpoint.packInputSha256 !== plan.packInputSha256 ||
      checkpoint.previousCheckpointSha256 !== previousCheckpointSha256 ||
      canonicalTranslationAuditJson(checkpoint.packBinding) !==
        canonicalTranslationAuditJson(plan.binding)
    ) {
      throw new Error("Semantic checkpoint chain link is stale, reordered, or replayed.");
    }
    chainRows.push([
      checkpoint.ordinal,
      checkpoint.packInputSha256,
      checkpoint.previousCheckpointSha256,
      checkpoint.checkpointSha256,
      checkpointFile.sha256,
      checkpointFile.bytes.byteLength,
    ]);
    previousCheckpointSha256 = checkpoint.checkpointSha256;

    const trackedEvidence = checkpoint.trackedAfrikaansReferences;
    const trackedEvidenceCanonical = rawJsonMemberValue(
      rawCheckpointCanonical,
      "trackedAfrikaansReferences",
      `Semantic checkpoint ${plan.descriptor.ordinal}`,
    );
    const trackedEvidenceRawObject = canonicalRawObjectText(
      trackedEvidenceCanonical,
      `Semantic checkpoint ${plan.descriptor.ordinal} tracked references`,
    );
    const trackedReferencePacksRaw = rawJsonMemberValue(
      trackedEvidenceRawObject,
      "referencePacks",
      `Semantic checkpoint ${plan.descriptor.ordinal} tracked references`,
    );
    const summaryMatches =
      trackedEvidence.sessionSha256 === sessionSha256 &&
      trackedEvidence.referencePacks.length ===
        trackedCatalog.summary.referencePacks &&
      trackedEvidence.referencePackIdentityRootSha256 ===
        trackedCatalog.summary.referencePackIdentityRootSha256 &&
      trackedEvidence.referencePackGateEvidenceRootSha256 ===
        trackedCatalog.summary.referencePackGateEvidenceRootSha256 &&
      trackedEvidence.supportPairCount === trackedCatalog.summary.supportPairCount &&
      trackedEvidence.supportPairRootSha256 ===
        trackedCatalog.summary.supportPairRootSha256 &&
      trackedEvidence.supportRecordCount ===
        trackedCatalog.summary.supportRecordCount &&
      trackedEvidence.supportRecordRootSha256 ===
        trackedCatalog.summary.supportRecordRootSha256 &&
      trackedEvidence.conflictSourceCount ===
        trackedCatalog.summary.conflictSourceCount &&
      trackedEvidence.conflictSourceRootSha256 ===
        trackedCatalog.summary.conflictSourceRootSha256 &&
      sha256Bytes(Buffer.from(trackedReferencePacksRaw, "utf8")) ===
        trackedEvidence.referencePackGateEvidenceRootSha256 &&
      canonicalTranslationAuditJson(trackedEvidence.referencePacks) ===
        canonicalTranslationAuditJson(trackedCatalog.referencePackRows);
    if (
      !summaryMatches ||
      (priorTrackedReferenceEvidence !== null &&
        priorTrackedReferenceEvidence !== trackedEvidenceCanonical)
    ) {
      throw new Error("Semantic checkpoint tracked-reference evidence is mixed.");
    }
    priorTrackedReferenceEvidence = trackedEvidenceCanonical;

    if (
      checkpoint.fieldEvidenceRows.length !== plan.source.entries.length ||
      checkpoint.derivationEvidenceRows.length !== plan.source.entries.length
    ) throw new Error("Semantic checkpoint field evidence is partial.");
    const duplicateIndices = duplicateFieldIndices(plan.source, plan.pack);
    const derivedRescueRows: Array<readonly [
      string,
      "field-pair" | "tracked-curated",
      string | null,
    ]> = [];
    const referenceMatchRows: Array<readonly [string, string]> = [];
    const trackedRescueRows: Array<readonly [string, string]> = [];
    let packLanguageFields = 0;
    let packBacktranslatedFields = 0;
    let packFieldPairRescues = 0;
    let packTrackedRescues = 0;
    for (let fieldIndex = 0; fieldIndex < plan.source.entries.length; fieldIndex += 1) {
      const entry = plan.source.entries[fieldIndex];
      const fieldRow = checkpoint.fieldEvidenceRows[fieldIndex];
      const derivationRow = checkpoint.derivationEvidenceRows[fieldIndex];
      if (!entry || !fieldRow || !derivationRow) {
        throw new Error("Semantic checkpoint field evidence order is partial.");
      }
      const value = plan.pack.values.get(entry.key);
      if (value === undefined) throw new Error("Semantic checkpoint value disappeared.");
      const fieldIdentity = fieldIdentitySha256(
        plan.binding,
        entry,
        sha256Bytes(Buffer.from(value, "utf8")),
      );
      if (fieldRow[0] !== fieldIdentity || derivationRow[0] !== fieldIdentity) {
        throw new Error("Semantic checkpoint field identity/order drifted.");
      }
      const fieldEvidence = fieldRow[1];
      assertOptionalBacktranslationShape(fieldEvidence);
      assertCheckpointLanguagePredictionEvidence(
        plan.binding,
        plan.pack,
        plan.source,
        fieldIndex,
        fieldEvidence,
        derivationRow[1],
      );
      if (fieldEvidence.lidApplicable) packLanguageFields += 1;
      if (fieldEvidence.backtranslationRequired) packBacktranslatedFields += 1;
      if (
        fieldRow[3].length !== 0 || fieldRow[4].length !== 0
      ) throw new Error("Passed semantic checkpoint contains adjudicated or remaining failures.");
      if (plan.binding.locale === "af") {
        const derived = deriveAfrikaansRescue(
          plan.binding,
          plan.pack,
          plan.source,
          fieldIndex,
          fieldEvidence,
          derivationRow[1],
          plan.binding.afrikaansPackContext?.gatePassed ?? false,
          trackedCatalog,
          duplicateIndices,
        );
        if (
          canonicalTranslationAuditJson(fieldRow[2]) !==
            canonicalTranslationAuditJson(derived.remainingFailures) ||
          derived.remainingFailures.length !== 0
        ) throw new Error(
          `Semantic checkpoint failure derivation is stale for ${
            plan.binding.locale
          }/${plan.binding.namespace}/${entry.key}: ${
            derived.remainingFailures.join(",")
          }.`,
        );
        if (derived.supportPairIdentity !== null) {
          referenceMatchRows.push([fieldIdentity, derived.supportPairIdentity]);
        }
        if (derived.rescueKind !== "none") {
          derivedRescueRows.push([
            fieldIdentity,
            derived.rescueKind,
            derived.supportPairIdentity,
          ]);
        }
        if (derived.rescueKind === "field-pair") {
          packFieldPairRescues += 1;
        } else if (derived.rescueKind === "tracked-curated") {
          packTrackedRescues += 1;
          if (derived.supportPairIdentity === null) {
            throw new Error("Tracked semantic rescue lost its exact support pair.");
          }
          trackedRescueRows.push([fieldIdentity, derived.supportPairIdentity]);
        }
      } else if (
        fieldEvidence.afrikaansRescueKind !== "none" ||
        fieldEvidence.supportPairIdentity !== null || fieldRow[2].length !== 0
      ) {
        throw new Error("Non-Afrikaans checkpoint contains rescue evidence.");
      }
    }
    if (
      plan.binding.fieldEvidenceRootSha256 !==
        sha256Bytes(Buffer.from(rawJsonMemberValue(
          rawCheckpointCanonical,
          "fieldEvidenceRows",
          `Semantic checkpoint ${plan.descriptor.ordinal}`,
        ), "utf8"))
    ) throw new Error("Semantic checkpoint field evidence root drifted.");
    const expectedCounts: ParsedCheckpoint["counts"] = {
      packs: 1,
      fields: plan.binding.fields,
      candidatePacks: plan.binding.origin === "candidate" ? 1 : 0,
      curatedPacks: plan.binding.origin === "curated" ? 1 : 0,
      legalFields: /^legal(?::|$)/.test(plan.binding.namespace)
        ? plan.binding.fields
        : 0,
      languageEvidenceFields: packLanguageFields,
      backtranslatedFields: packBacktranslatedFields,
      unadjudicatedFields: 0,
      unadjudicatedFailures: 0,
      adjudicatedFields: 0,
      adjudicatedFailures: 0,
    };
    if (
      canonicalTranslationAuditJson(checkpoint.counts) !==
        canonicalTranslationAuditJson(expectedCounts) ||
      checkpoint.failureRecords.records.length !== 0 ||
      Object.keys(checkpoint.failureRecords.codeCounts).length !== 0 ||
      Object.keys(checkpoint.failureRecords.adjudicatedCodeCounts).length !== 0 ||
      checkpoint.consumedAdjudications.length !== 0
    ) throw new Error("Semantic checkpoint counts/failure records drifted.");
    const context = plan.binding.afrikaansPackContext;
    if (context !== null) {
      if (
        context.rescuedFields !== packFieldPairRescues + packTrackedRescues ||
        context.fieldPairRescuedFields !== packFieldPairRescues ||
        context.trackedCuratedRescuedFields !== packTrackedRescues ||
        context.referenceMatchFields !== referenceMatchRows.length ||
        context.referenceMatchRootSha256 !==
          sha256CanonicalTranslationAuditJson(referenceMatchRows) ||
        context.trackedCuratedRescueRootSha256 !==
          sha256CanonicalTranslationAuditJson(trackedRescueRows)
      ) throw new Error("Semantic checkpoint Afrikaans rescue split/root drifted.");
    }
    const expectedRescueRecord = {
      ordinal: plan.descriptor.ordinal,
      locale: plan.binding.locale,
      namespace: plan.binding.namespace,
      rescueRecordCount: derivedRescueRows.length,
      rescueRecordRootSha256:
        sha256CanonicalTranslationAuditJson(derivedRescueRows),
      rescueRecords: derivedRescueRows,
    };
    if (
      canonicalTranslationAuditJson(rescueRecord) !==
        canonicalTranslationAuditJson(expectedRescueRecord)
    ) throw new Error("Semantic checkpoint per-pack rescue records drifted.");
    rescuePackRootRows.push([
      expectedRescueRecord.ordinal,
      expectedRescueRecord.locale,
      expectedRescueRecord.namespace,
      expectedRescueRecord.rescueRecordCount,
      expectedRescueRecord.rescueRecordRootSha256,
    ]);
    totalLanguageFields += packLanguageFields;
    totalBacktranslatedFields += packBacktranslatedFields;
    totalFieldPairRescues += packFieldPairRescues;
    totalTrackedRescues += packTrackedRescues;
  }
  if (previousCheckpointSha256 === null) {
    throw new Error("Semantic checkpoint chain has no terminal checkpoint.");
  }
  const resultCounts = manifest.results.counts;
  if (
    totalLanguageFields !== resultCounts.languageEvidenceFields ||
    totalBacktranslatedFields !== resultCounts.backtranslatedFields ||
    totalFieldPairRescues !==
      manifest.results.afrikaansTrackedCurated.fieldPairRescuedFields ||
    totalTrackedRescues !==
      manifest.results.afrikaansTrackedCurated.trackedCuratedRescuedFields ||
    evidence.terminalCheckpointSha256 !== previousCheckpointSha256 ||
    evidence.checkpointChainRootSha256 !==
      sha256CanonicalTranslationAuditJson(chainRows) ||
    evidence.packRescueRecordRootSha256 !==
      sha256CanonicalTranslationAuditJson(rescuePackRootRows) ||
    evidence.fieldPairRescuedFields !== totalFieldPairRescues ||
    evidence.trackedCuratedRescuedFields !== totalTrackedRescues
  ) throw new Error("Semantic checkpoint terminal/chain/rescue aggregate drifted.");
  return Object.freeze({
    rootPath: checkpointRoot,
    rootIdentity,
    entries,
    files: stableFiles,
    expectedPacks: scope.packs,
  });
}

function createSemanticPromotionEvidence(input: {
  manifest: TranslationSemanticAuditManifest;
  verifierImplementationSha256: string;
  liveSiteCatalog: LiveSiteSourceCatalog;
}): TranslationSemanticPromotionEvidence {
  const { manifest } = input;
  const material = semanticPromotionEvidenceMaterialSchema.parse({
    schemaVersion: 2,
    kind: TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
    manifestSha256: manifest.manifestSha256,
    masterWorklistSha256: manifest.inputs.masterWorklist.worklistSha256,
    generatorExecutionProfile:
      manifest.inputs.masterWorklist.generatorExecutionProfile,
    generatorExecutionProfileSha256:
      manifest.inputs.masterWorklist.generatorExecutionProfileSha256,
    auditVersion: manifest.auditVersion,
    auditPolicySha256: manifest.policy.sha256,
    auditImplementationSha256: manifest.policy.implementationSha256,
    verifierImplementationSha256: input.verifierImplementationSha256,
    modelLockSha256: manifest.models.modelLockSha256,
    modelDigests: {
      fasttextSha256: manifest.models.fasttext.sha256,
      labseTreeSha256: manifest.models.labse.treeSha256,
      madladTreeSha256: manifest.models.madlad.treeSha256,
    },
    runtimeVersions: manifest.models.runtimeVersions,
    scope: {
      locales: manifest.scope.locales.length,
      namespaces: manifest.scope.namespaces,
      packs: manifest.scope.packs,
      fields: manifest.scope.fields,
      candidatePacks: manifest.results.counts.candidatePacks,
      curatedPacks: manifest.results.counts.curatedPacks,
    },
    inputTrees: {
      curated: {
        exists: manifest.inputs.curatedTree.exists,
        sha256: manifest.inputs.curatedTree.sha256,
        files: manifest.inputs.curatedTree.files,
        bytes: manifest.inputs.curatedTree.bytes,
      },
      staticMainApp: {
        exists: manifest.inputs.staticMainAppTree.exists,
        sha256: manifest.inputs.staticMainAppTree.sha256,
        files: manifest.inputs.staticMainAppTree.files,
        bytes: manifest.inputs.staticMainAppTree.bytes,
      },
      candidates: {
        exists: manifest.inputs.candidateTree.exists,
        sha256: manifest.inputs.candidateTree.sha256,
        files: manifest.inputs.candidateTree.files,
        bytes: manifest.inputs.candidateTree.bytes,
      },
      packWorklists: {
        exists: manifest.inputs.packWorklistTree.exists,
        sha256: manifest.inputs.packWorklistTree.sha256,
        files: manifest.inputs.packWorklistTree.files,
        bytes: manifest.inputs.packWorklistTree.bytes,
      },
    },
    siteSourceCatalog: {
      path: TRANSLATION_SEMANTIC_AUDIT_SITE_SOURCE_MANIFEST_RELATIVE_PATH,
      fileSha256: input.liveSiteCatalog.file.sha256,
      catalogRootSha256: input.liveSiteCatalog.catalogRootSha256,
      namespaces: input.liveSiteCatalog.namespaces.length,
      fields: input.liveSiteCatalog.fields,
    },
    packIdentityRootSha256: manifest.results.packIdentityRootSha256,
    packEvidenceRootSha256: manifest.results.packEvidenceRootSha256,
    afrikaansTrackedCurated: manifest.results.afrikaansTrackedCurated,
    checkpointEvidence: checkpointEvidenceBinding(
      manifest.results.checkpointEvidence,
      FULL_SEMANTIC_AUDIT_SCOPE,
    ),
  });
  return translationSemanticPromotionEvidenceSchema.parse({
    ...material,
    semanticEvidenceSha256:
      sha256CanonicalTranslationAuditJson(material),
  });
}

function createAfrikaansSemanticPromotionEvidence(input: {
  manifest: AfrikaansTranslationSemanticAuditManifest;
  verifierImplementationSha256: string;
  liveSiteCatalog: LiveSiteSourceCatalog;
}): AfrikaansTranslationSemanticPromotionEvidence {
  const { manifest } = input;
  const material = afrikaansSemanticPromotionEvidenceMaterialSchema.parse({
    schemaVersion: 1,
    kind: AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
    manifestSha256: manifest.manifestSha256,
    masterWorklistSha256: manifest.inputs.masterWorklist.worklistSha256,
    generatorExecutionProfile:
      manifest.inputs.masterWorklist.generatorExecutionProfile,
    generatorExecutionProfileSha256:
      manifest.inputs.masterWorklist.generatorExecutionProfileSha256,
    auditVersion: manifest.auditVersion,
    auditPolicySha256: manifest.policy.sha256,
    auditImplementationSha256: manifest.policy.implementationSha256,
    verifierImplementationSha256: input.verifierImplementationSha256,
    modelLockSha256: manifest.models.modelLockSha256,
    modelDigests: {
      fasttextSha256: manifest.models.fasttext.sha256,
      labseTreeSha256: manifest.models.labse.treeSha256,
      madladTreeSha256: manifest.models.madlad.treeSha256,
    },
    runtimeVersions: manifest.models.runtimeVersions,
    scope: {
      locales: manifest.scope.locales.length,
      namespaces: manifest.scope.namespaces,
      packs: manifest.scope.packs,
      fields: manifest.scope.fields,
      candidatePacks: manifest.results.counts.candidatePacks,
      curatedPacks: manifest.results.counts.curatedPacks,
    },
    inputTrees: {
      curated: {
        exists: manifest.inputs.curatedTree.exists,
        sha256: manifest.inputs.curatedTree.sha256,
        files: manifest.inputs.curatedTree.files,
        bytes: manifest.inputs.curatedTree.bytes,
      },
      staticMainApp: {
        exists: manifest.inputs.staticMainAppTree.exists,
        sha256: manifest.inputs.staticMainAppTree.sha256,
        files: manifest.inputs.staticMainAppTree.files,
        bytes: manifest.inputs.staticMainAppTree.bytes,
      },
      candidates: {
        exists: manifest.inputs.candidateTree.exists,
        sha256: manifest.inputs.candidateTree.sha256,
        files: manifest.inputs.candidateTree.files,
        bytes: manifest.inputs.candidateTree.bytes,
      },
      packWorklists: {
        exists: manifest.inputs.packWorklistTree.exists,
        sha256: manifest.inputs.packWorklistTree.sha256,
        files: manifest.inputs.packWorklistTree.files,
        bytes: manifest.inputs.packWorklistTree.bytes,
      },
    },
    siteSourceCatalog: {
      path: TRANSLATION_SEMANTIC_AUDIT_SITE_SOURCE_MANIFEST_RELATIVE_PATH,
      fileSha256: input.liveSiteCatalog.file.sha256,
      catalogRootSha256: input.liveSiteCatalog.catalogRootSha256,
      namespaces: input.liveSiteCatalog.namespaces.length,
      fields: input.liveSiteCatalog.fields,
    },
    packIdentityRootSha256: manifest.results.packIdentityRootSha256,
    packEvidenceRootSha256: manifest.results.packEvidenceRootSha256,
    afrikaansTrackedCurated: manifest.results.afrikaansTrackedCurated,
    checkpointEvidence: checkpointEvidenceBinding(
      manifest.results.checkpointEvidence,
      AFRIKAANS_SEMANTIC_AUDIT_SCOPE,
    ),
  });
  return afrikaansTranslationSemanticPromotionEvidenceSchema.parse({
    ...material,
    semanticEvidenceSha256:
      sha256CanonicalTranslationAuditJson(material),
  });
}

type VerifiedSemanticAuditCore = Readonly<{
  manifest: AnyTranslationSemanticAuditManifest;
  promotionEvidence: TranslationSemanticPromotionEvidenceUnion;
  manifestPath: string;
  manifestSha256: string;
  masterWorklistSha256: string;
  fields: number;
  packs: number;
}>;

function verifyTranslationSemanticAuditManifestCore(
  input: Readonly<{
    workspaceRoot: string;
    runRoot: string;
    committedPromotionEvidence?: TranslationSemanticPromotionEvidenceUnion;
    raceHook?: (
      point: "after-pack-collection-before-final-stability-check",
    ) => void;
  }>,
  scope: SemanticAuditScopeConfiguration,
): VerifiedSemanticAuditCore {
  const workspaceRoot = resolveExistingDirectory(input.workspaceRoot, "Workspace root");
  const runRoot = resolveExistingDirectory(input.runRoot, "Translation run root");
  const expectedTemporaryRoot = path.join(workspaceRoot, "tmp");
  if (!runRoot.startsWith(`${expectedTemporaryRoot}${path.sep}`)) {
    throw new Error("Translation run root must be a child of workspace tmp/.");
  }
  assertCurrentLongTailReleaseRunRoot(runRoot, "Translation run root");
  const manifestPath = path.join(runRoot, scope.manifestBasename);
  const masterPath = path.join(runRoot, TRANSLATION_SEMANTIC_AUDIT_MASTER_BASENAME);
  const curatedRoot = path.join(workspaceRoot, TRANSLATION_SEMANTIC_AUDIT_CURATED_RELATIVE_PATH);
  const staticMainAppRoot = path.join(
    workspaceRoot,
    TRANSLATION_SEMANTIC_AUDIT_STATIC_MAIN_APP_RELATIVE_PATH,
  );
  const candidateRoot = path.join(runRoot, TRANSLATION_SEMANTIC_AUDIT_CANDIDATE_BASENAME);
  const packWorklistRoot = path.join(runRoot, TRANSLATION_SEMANTIC_AUDIT_PACK_WORKLIST_BASENAME);
  const implementationPath = path.join(workspaceRoot, TRANSLATION_SEMANTIC_AUDIT_IMPLEMENTATION_RELATIVE_PATH);
  const verifierImplementationPath = path.join(
    workspaceRoot,
    TRANSLATION_SEMANTIC_AUDIT_VERIFIER_RELATIVE_PATH,
  );

  const manifestFile = readStableRegularFile(manifestPath, MAXIMUM_JSON_BYTES, "Semantic audit manifest", 0o400);
  const implementationFile = readStableRegularFile(implementationPath, MAXIMUM_IMPLEMENTATION_BYTES, "Semantic audit implementation");
  const verifierImplementationFile = readStableRegularFile(
    verifierImplementationPath,
    MAXIMUM_IMPLEMENTATION_BYTES,
    "Semantic audit verifier implementation",
  );
  const liveSiteCatalog = readLiveSiteSourceCatalog(workspaceRoot);
  const masterFile = readStableRegularFile(masterPath, MAXIMUM_MASTER_BYTES, "Semantic audit master worklist");
  const curatedTree = snapshotTree(
    curatedRoot,
    "Curated site translation tree",
    false,
    true,
  );
  const staticMainAppTree = snapshotTree(
    staticMainAppRoot,
    "Tracked static main-app tree",
  );
  const candidateTree = snapshotTree(candidateRoot, "Candidate translation tree", true);
  const packWorklistTree = snapshotTree(packWorklistRoot, "Pack worklist tree");
  assertTranslationTreeLayout(curatedTree, "Curated translation tree");
  assertTranslationTreeLayout(candidateTree, "Candidate translation tree");

  const rawManifest = strictJson(manifestFile.bytes, "Semantic audit manifest");
  const rawManifestCanonical = canonicalRawObject(
    manifestFile.bytes,
    "Semantic audit manifest",
  );
  const manifest: AnyTranslationSemanticAuditManifest = scope.name === "full"
    ? parseWithSchema(
      translationSemanticAuditManifestSchema,
      rawManifest,
      "Semantic audit manifest",
    )
    : parseWithSchema(
      afrikaansTranslationSemanticAuditManifestSchema,
      rawManifest,
      "Afrikaans semantic audit manifest",
    );
  if (
    rawCanonicalObjectDigestWithoutMember(
      rawManifestCanonical,
      "manifestSha256",
      "Semantic audit manifest",
    ) !== manifest.manifestSha256
  ) {
    throw new Error("Semantic audit manifest raw canonical digest is stale or tampered.");
  }
  assertExactArray(
    manifest.scope.locales,
    scope.locales,
    "Semantic audit locales",
  );
  if (canonicalTranslationAuditJson(manifest.policy.value) !== canonicalTranslationAuditJson(TRANSLATION_SEMANTIC_AUDIT_POLICY) ||
      manifest.policy.sha256 !== sha256CanonicalTranslationAuditJson(TRANSLATION_SEMANTIC_AUDIT_POLICY) ||
      manifest.policy.implementationSha256 !== implementationFile.sha256) {
    throw new Error("Semantic audit policy or implementation binding drifted.");
  }
  const expectedModelLock = sha256CanonicalTranslationAuditJson({
    fasttextSha256: manifest.models.fasttext.sha256,
    labseTreeSha256: manifest.models.labse.treeSha256,
    madladTreeSha256: manifest.models.madlad.treeSha256,
    runtimeVersions: manifest.models.runtimeVersions,
  });
  if (manifest.models.modelLockSha256 !== expectedModelLock) {
    throw new Error("Semantic audit model lock digest is stale or tampered.");
  }

  const expectedMasterRelative = workspaceRelative(workspaceRoot, masterPath);
  const expectedCuratedRelative = workspaceRelative(workspaceRoot, curatedRoot);
  const expectedStaticMainAppRelative = workspaceRelative(
    workspaceRoot,
    staticMainAppRoot,
  );
  const expectedCandidateRelative = workspaceRelative(workspaceRoot, candidateRoot);
  const expectedPackWorklistRelative = workspaceRelative(workspaceRoot, packWorklistRoot);
  if (manifest.inputs.masterWorklist.path !== expectedMasterRelative ||
      manifest.inputs.masterWorklist.fileSha256 !== masterFile.sha256) {
    throw new Error("Semantic audit master file evidence is stale or path-mismatched.");
  }
  if (!input.committedPromotionEvidence) {
    assertTreeEvidence(curatedTree, manifest.inputs.curatedTree, expectedCuratedRelative, "Curated tree");
  } else if (manifest.inputs.curatedTree.path !== expectedCuratedRelative) {
    throw new Error("Committed semantic recovery has a path-mismatched curated input.");
  }
  assertTreeEvidence(
    staticMainAppTree,
    manifest.inputs.staticMainAppTree,
    expectedStaticMainAppRelative,
    "Tracked static main-app tree",
  );
  assertTreeEvidence(candidateTree, manifest.inputs.candidateTree, expectedCandidateRelative, "Candidate tree");
  assertTreeEvidence(packWorklistTree, manifest.inputs.packWorklistTree, expectedPackWorklistRelative, "Pack worklist tree");

  const master = parseWithSchema(masterWorklistSchema, strictJson(masterFile.bytes, "Master worklist"), "Master worklist");
  if (manifest.inputs.masterWorklist.worklistSha256 !== master.worklistSha256) {
    throw new Error("Semantic audit master worklist identity drifted.");
  }
  const manifestGeneratorExecutionProfile = parseLongTailNllbExecutionProfile(
    manifest.inputs.masterWorklist.generatorExecutionProfile,
  );
  if (
    manifest.inputs.masterWorklist.generatorExecutionProfileSha256 !==
      LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256 ||
    canonicalTranslationAuditJson(manifestGeneratorExecutionProfile) !==
      canonicalTranslationAuditJson(master.provenance.executionProfile)
  ) {
    throw new Error(
      "Semantic audit generator execution-profile evidence drifted from the master.",
    );
  }
  const validated = validateMaster(master, liveSiteCatalog, scope.locales);
  if (
    manifest.scope.fields !== validated.fields ||
    (scope.fields !== null && validated.fields !== scope.fields)
  ) {
    throw new Error("Semantic audit field scope is partial or stale.");
  }
  const packs = collectPackMaterial(
    curatedRoot,
    curatedTree,
    staticMainAppRoot,
    staticMainAppTree,
    candidateRoot,
    candidateTree,
    master,
    validated,
    scope.locales,
  );
  assertPackBindings(
    manifest,
    validated,
    packs,
    scope.locales,
    scope.packs,
  );
  const packWorklistHashes = validatePackWorklists(
    packWorklistRoot,
    packWorklistTree,
    master,
    validated,
  );
  assertCandidatePackWorklistBindings(
    packs,
    validated,
    packWorklistHashes,
  );
  const checkpointChain = verifyCheckpointChain({
    workspaceRoot,
    runRoot,
    manifestPath,
    manifest,
    validated,
    packs,
    scope,
  });
  const promotionEvidence: TranslationSemanticPromotionEvidenceUnion =
    manifest.scope.name === "full"
      ? createSemanticPromotionEvidence({
        manifest: translationSemanticAuditManifestSchema.parse(manifest),
        verifierImplementationSha256: verifierImplementationFile.sha256,
        liveSiteCatalog,
      })
      : createAfrikaansSemanticPromotionEvidence({
        manifest: afrikaansTranslationSemanticAuditManifestSchema.parse(
          manifest,
        ),
        verifierImplementationSha256: verifierImplementationFile.sha256,
        liveSiteCatalog,
      });
  if (
    input.committedPromotionEvidence &&
    canonicalTranslationAuditJson(promotionEvidence) !==
      canonicalTranslationAuditJson(
        scope.name === "full"
          ? translationSemanticPromotionEvidenceSchema.parse(
            input.committedPromotionEvidence,
          )
          : afrikaansTranslationSemanticPromotionEvidenceSchema.parse(
            input.committedPromotionEvidence,
          ),
      )
  ) {
    throw new Error("Committed promotion journal does not match the fixed semantic manifest.");
  }

  input.raceHook?.("after-pack-collection-before-final-stability-check");

  assertStableFileUnchanged(manifestFile, MAXIMUM_JSON_BYTES, "Semantic audit manifest", 0o400);
  assertStableFileUnchanged(implementationFile, MAXIMUM_IMPLEMENTATION_BYTES, "Semantic audit implementation");
  assertStableFileUnchanged(
    verifierImplementationFile,
    MAXIMUM_IMPLEMENTATION_BYTES,
    "Semantic audit verifier implementation",
  );
  assertStableFileUnchanged(masterFile, MAXIMUM_MASTER_BYTES, "Semantic audit master worklist");
  assertStableFileUnchanged(
    liveSiteCatalog.file,
    MAXIMUM_IMPLEMENTATION_BYTES,
    "Tracked site source manifest",
  );
  assertCheckpointChainUnchanged(checkpointChain);
  if (!sameTree(
        curatedTree,
        snapshotTree(curatedRoot, "Curated site translation tree", false, true),
        true,
      ) ||
      !sameTree(
        staticMainAppTree,
        snapshotTree(staticMainAppRoot, "Tracked static main-app tree"),
      ) ||
      !sameTree(candidateTree, snapshotTree(candidateRoot, "Candidate translation tree", true)) ||
      !sameTree(packWorklistTree, snapshotTree(packWorklistRoot, "Pack worklist tree"))) {
    throw new Error("Semantic audit input trees changed during verification.");
  }
  return Object.freeze({
    manifest,
    promotionEvidence,
    manifestPath,
    manifestSha256: manifest.manifestSha256,
    masterWorklistSha256: master.worklistSha256,
    fields: validated.fields,
    packs: scope.packs,
  });
}

export function verifyTranslationSemanticAuditManifest(
  input: VerifyTranslationSemanticAuditInput,
): VerifiedTranslationSemanticAudit {
  const verified = verifyTranslationSemanticAuditManifestCore(
    input,
    FULL_SEMANTIC_AUDIT_SCOPE,
  );
  return Object.freeze({
    ...verified,
    manifest: translationSemanticAuditManifestSchema.parse(
      verified.manifest,
    ),
    promotionEvidence: translationSemanticPromotionEvidenceSchema.parse(
      verified.promotionEvidence,
    ),
    packs: TRANSLATION_SEMANTIC_AUDIT_EXPECTED_PACK_COUNT,
  });
}

export function verifyAfrikaansTranslationSemanticAuditManifest(
  input: VerifyAfrikaansTranslationSemanticAuditInput,
): VerifiedAfrikaansTranslationSemanticAudit {
  const verified = verifyTranslationSemanticAuditManifestCore(
    input,
    AFRIKAANS_SEMANTIC_AUDIT_SCOPE,
  );
  return Object.freeze({
    ...verified,
    manifest: afrikaansTranslationSemanticAuditManifestSchema.parse(
      verified.manifest,
    ),
    promotionEvidence:
      afrikaansTranslationSemanticPromotionEvidenceSchema.parse(
        verified.promotionEvidence,
      ),
    fields: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
    packs: TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
  });
}
