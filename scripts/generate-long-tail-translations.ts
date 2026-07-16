import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  createReadStream,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  type BigIntStats,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "@/lib/i18n/main-app-source";
import {
  getAllSiteTranslationNamespaces,
  getSiteSourceHash,
  getSiteTranslationSourceKey,
  getSiteTranslationSource,
} from "@/lib/i18n/site-source";
import { validateTranslationCandidateField } from "@/lib/i18n/translation-candidate-quality";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import {
  afrikaansProductCopyHistoricalSource,
  afrikaansProductCopyPhraseBindings,
  inspectTranslationFieldFluency,
  isTranslationBundleCompleteAndFluent,
  isTranslationBundleFieldValid,
  isTranslationFieldLikelyFluent,
  translationEmbeddedSourcePhrases,
  translationHistoricalEmbeddedSourcePhrases,
} from "@/lib/i18n/translation-quality";
import type {
  TranslationBundle,
  TranslationSource,
} from "@/lib/i18n/translation-types";
import {
  assertCurrentLongTailValidatorPolicy,
  createLongTailValidatorPolicyProvenance,
  LONG_TAIL_VALIDATOR_POLICY_KIND,
  LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS,
  type LongTailValidatorPolicyProvenance,
} from "./translation-validator-policy-provenance";
import {
  finalizeLongTailPromotionSnapshot,
  LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND,
  LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
  LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND,
  promoteLongTailPromotionSnapshot,
  recoverLongTailPromotionSnapshotByExactArtifacts,
  readAndValidateAfrikaansStagedPromotionProof,
  type FinalizedAfrikaansStagedPromotionProof,
  type LongTailPromotionSnapshotArtifact,
  type LongTailPromotionSnapshotCrashHook,
} from "./long-tail-promotion-snapshot";
import {
  parseStrictTranslationSemanticJsonBytes,
  AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT,
  TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  verifyAfrikaansTranslationSemanticAuditManifest,
  verifyTranslationSemanticAuditManifest,
  type AfrikaansTranslationSemanticPromotionEvidence,
  type TranslationSemanticPromotionEvidenceUnion,
  type VerifiedAfrikaansTranslationSemanticAudit,
  type VerifiedTranslationSemanticAudit,
} from "./verify-translation-semantic-audit";
import {
  createTranslationSemanticReleaseAttestation,
} from "./translation-semantic-release-attestation";
import {
  assertCurrentLongTailReleaseRunRoot,
  LONG_TAIL_NLLB_EXECUTION_PROFILE,
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
  longTailNllbExecutionProfileSchema,
  parseLongTailNllbExecutionProfile,
  type LongTailNllbExecutionProfile,
} from "./long-tail-nllb-execution-profile";
import type {
  LegacyLongTailSeedSalvageAcceptanceReference,
  LegacyLongTailSeedSalvageCurrentValidation,
  LegacyLongTailSeedSalvageEvidenceReference,
} from "./legacy-long-tail-seed-salvage-contract";

export { LONG_TAIL_TRANSLATION_PIPELINE_VERSION };
export const LONG_TAIL_TRANSLATION_PROTECTOR_VERSION =
  "inspir-long-tail-literal-protector-v1" as const;
export const LONG_TAIL_TRANSLATION_WORKLIST_KIND =
  "inspir-long-tail-translation-worklist-v1" as const;
export const LONG_TAIL_TRANSLATION_PACK_WORKLIST_KIND =
  "inspir-long-tail-translation-pack-worklist-v1" as const;
export const LONG_TAIL_TRANSLATION_CANDIDATE_KIND =
  "inspir-long-tail-translation-candidate-v1" as const;
export const LONG_TAIL_TRANSLATION_CURATED_PROVENANCE_KIND =
  "inspir-long-tail-curated-provenance-v1" as const;
export const LONG_TAIL_TRANSLATION_CHECKPOINT_KIND =
  "inspir-long-tail-translation-checkpoint-v1" as const;

const afrikaansProductCopyGlossaryContract = Object.freeze([
  Object.freeze({
    literal: "Math Step Coach",
    canonicalSource: "Math Step Coach",
    sourceSha256:
      "ede47ecd996d2f775d4a883b02173f4eeeb5d379284591609432560d3665b87a",
    value: "Wiskunde-stap-afrigter",
    valueSha256:
      "7b98cbc750e88bea3b2096d167b7d00c2e47945d15db025be9e2ebda259155ec",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "main-app",
        sourceHash:
          "fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0",
        key: "topic.math-step-coach.name",
      }),
      Object.freeze({
        namespace: "route:home",
        sourceHash:
          "fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce",
        key: "site.accca8c4b44c698f11",
      }),
    ]),
  }),
  Object.freeze({
    literal: "Flashcard Builder",
    canonicalSource: "Flashcard Builder",
    sourceSha256:
      "1bb089c0c03e996014285b1fbbf579cb4cee7059c2a29a2509d1d20c6d04a439",
    value: "Flitskaartbouer",
    valueSha256:
      "928103c4c9b6c4b987430d342d930b00c2e6dc51797fad5ad1cc70b5657b661a",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "main-app",
        sourceHash:
          "fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0",
        key: "topic.flashcard-builder.name",
      }),
      Object.freeze({
        namespace: "route:home",
        sourceHash:
          "fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce",
        key: "site.8d3383856ae937dbc8",
      }),
    ]),
  }),
  Object.freeze({
    literal: "Quiz Me On Trivia",
    canonicalSource: "Quiz me on Trivia",
    sourceSha256:
      "b608e818c109f6cd3eea2246842ef71474c802ad45c05443e75559171c6e80f5",
    value: "Vasvra my oor trivia",
    valueSha256:
      "d57de088afc8bb84858120f99be017e59e56efc9022ad2638fe6db756df13274",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "main-app",
        sourceHash:
          "fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0",
        key: "topic.quiz-me-on-trivia.name",
      }),
      Object.freeze({
        namespace: "route:home",
        sourceHash:
          "fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce",
        key: "site.5728bdb5f3eb838312",
      }),
    ]),
  }),
  Object.freeze({
    literal: "Writing Coach",
    canonicalSource: "Writing Coach",
    sourceSha256:
      "570e5fcb31c6bb613543d2c334b0cda2f6c7a52f636ecb7f2c125d397cdcdf19",
    value: "Skryfafrigter",
    valueSha256:
      "06495a5215a29b3f95e85f902c2a22c0b07eac2db9737ddbf49f36149a0be684",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "main-app",
        sourceHash:
          "fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0",
        key: "topic.writing-coach.name",
      }),
      Object.freeze({
        namespace: "route:home",
        sourceHash:
          "fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce",
        key: "site.031857a0f03861e726",
      }),
    ]),
  }),
] as const);

// Curated generation-only rescues for exact NLLB sources that exhausted all
// bounded decode profiles. Each source, value, and production occurrence is
// content-bound; these never bypass field or bundle validation.
export const afrikaansCuratedGenerationSeedContract = Object.freeze([
  Object.freeze({
    source:
      "Interview Coach AI Learning Mode is a focused way to use AI for learning instead of passive answer collection. The mode is built around a specific job: Prepare for school, internship, job, or scholarship interviews with realistic questions and feedback.",
    sourceSha256:
      "fc7e2f06c58930f1e58c65b27d7fff131d5badddd5e91bf72edc35b238bf3820",
    value:
      "Onderhoudsafrigter se KI-leermodus is 'n doelgerigte manier om KI vir leer te gebruik eerder as om passief antwoorde in te samel. Die modus is rondom 'n spesifieke taak gebou: Berei voor vir onderhoude vir skool, internskap, werk of studiebeurse met realistiese vrae en terugvoer.",
    valueSha256:
      "24de7171c86b64dbc662be2e6104e345d5f3947f6b97eb80a2d2d46dc8efc681",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "blog:ai-interview-coach-guide",
        sourceHash:
          "bcd043adb3a48bf609462d1b75eb261d3ea96a548ae68a303d6a2a614c43e118",
        key: "site.991b1619b5b850481b",
      }),
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.991b1619b5b850481b",
      }),
    ]),
  }),
  Object.freeze({
    source:
      "Habit Coach AI Learning Mode is a focused way to use AI for learning instead of passive answer collection. The mode is built around a specific job: Turn intentions into small repeatable learning habits with triggers, rewards, and recovery plans.",
    sourceSha256:
      "fc6bff84341dbb08437a1ec23f662a8064b07d38c23097a29216b1b2883bee79",
    value:
      "Gewoonteafrigter se KI-leermodus is 'n doelgerigte manier om KI vir leer te gebruik eerder as om passief antwoorde in te samel. Die modus is rondom 'n spesifieke taak gebou: Omskep voornemens in klein, herhaalbare leergewoontes met snellers, belonings en herstelplanne.",
    valueSha256:
      "63f0fccf816c452e43451d8a3d422f637e215afe88cc38a047bba635b29830f9",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "blog:ai-habit-coach-guide",
        sourceHash:
          "3e2c4ddab48ccee8187127eee206cd675a7cb74eb01dea518bd6c3993b320a76",
        key: "site.790dbced167e15d580",
      }),
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.790dbced167e15d580",
      }),
    ]),
  }),
  Object.freeze({
    source:
      "Concept Map Builder AI Learning Mode is a focused way to use AI for learning instead of passive answer collection. The mode is built around a specific job: Map how ideas relate, from causes and effects to categories, examples, and contradictions.",
    sourceSha256:
      "fbb48c0f62b2d0866c8618a1a2eef5b6f11d7999518bacf20abe638c0ade274f",
    value:
      "Konsepkaartbouer se KI-leermodus is 'n doelgerigte manier om KI vir leer te gebruik eerder as om passief antwoorde in te samel. Die modus is rondom 'n spesifieke taak gebou: Bring in kaart hoe idees verband hou, van oorsake en gevolge tot kategorieë, voorbeelde en teenstrydighede.",
    valueSha256:
      "6bab86f06e71bf38fd79dd1021f99c462bdf5742c9c02f892c12077ff8f1439f",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "blog:ai-concept-map-builder-guide",
        sourceHash:
          "2c9ee9c299723c2e7ba2b6ea530f3e98eff6aaf62470451ba089f74d57981a9a",
        key: "site.67c82ad42d9352f555",
      }),
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.67c82ad42d9352f555",
      }),
    ]),
  }),
  Object.freeze({
    source:
      "Roleplay Scenario AI Learning Mode is a focused way to use AI for learning instead of passive answer collection. The mode is built around a specific job: Practice negotiation, conflict, customer support, leadership, or any high-stakes conversation.",
    sourceSha256:
      "fb14c9272c033b45dbc06016367bf68d312a4d0f8de61b5991f383c26084aaf7",
    value:
      "Die KI-leermodus vir rolspel-scenario's is 'n doelgerigte manier om KI vir leer te gebruik eerder as om passief antwoorde in te samel. Die modus is rondom 'n spesifieke taak gebou: Oefen onderhandeling, konflikhantering, kliëntediens, leierskap of enige gesprek met hoë belange.",
    valueSha256:
      "1d68db3fd21cd5277401fb2e0271357787ec9262656882df18a04b67db7a950e",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "blog:ai-roleplay-scenario-guide",
        sourceHash:
          "37f9e10f0dfca0ddd57204c18fc0ff26bf1c60d325202467a5dc73b47d8f67ff",
        key: "site.93f68ed0e1964ad554",
      }),
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.93f68ed0e1964ad554",
      }),
    ]),
  }),
  Object.freeze({
    source:
      "Use Debate Any Topic to test claims against counterarguments.",
    sourceSha256:
      "f6cea7a517ad59034fc3154fe4d97f83a1923390b1ead3fd12414f5b20618645",
    value:
      "Gebruik Debatteer enige onderwerp om bewerings aan die hand van teenargumente te toets.",
    valueSha256:
      "6ff166c64e9b29c9767206ee17b6559b42ea08dc37675082245a2e3f654b12f4",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.bf18b2089e2f217da8",
      }),
    ]),
  }),
  Object.freeze({
    source:
      "Try it in Flashcard Builder. If you need to understand the topic before making cards, start in Learn Anything. If you want pressure after reviewing cards, move into Quiz Me On Trivia or Viva Practice.",
    sourceSha256:
      "8e227ba67e984856c878dc5209abe51751c834ad4f5742239e4f482175aef2a3",
    value:
      "Probeer dit in Flitskaartbouer. As jy die onderwerp moet verstaan voordat jy kaarte maak, begin met Leer enigiets. As jy jou kennis ná die hersiening van die kaarte onder groter druk wil toets, gaan oor na Vasvra my oor trivia of Viva-oefening.",
    valueSha256:
      "a12cb2b04be6637fc9c542ed89816dcbc47f2073fed7cd425f3fcd2e54ceec06",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "blog:ai-flashcards-and-active-recall",
        sourceHash:
          "98b4c6f97d305c542bf445f7c0426ea64704c47443cf94aeec951af63816343d",
        key: "site.d5514935a76e0a9d66",
      }),
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.d5514935a76e0a9d66",
      }),
    ]),
  }),
  Object.freeze({
    source:
      "A practical guide to using Case Study Simulator on inspir for immersion learning, with prompts, study loops, and safer AI habits.",
    sourceSha256:
      "f5ba6c92e3394f99029e39962d75cd0f6c29beb36ee00ad7391548a9a912d847",
    value:
      "’n Praktiese gids om Gevallestudiesimulator op inspir vir meeslepende leer te gebruik, met prompts, studielusse en veiliger KI-gewoontes.",
    valueSha256:
      "f10534aa4fa724db16086e1f6ecc01eb780be4ab212c9e6b944b20b49a471fb6",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "blog:ai-case-study-simulator-guide",
        sourceHash:
          "d25e29048727587d8bcdcc15b1e1ed16c600d1d495d2bacf9fc6deb4fb4e2655",
        key: "site.e1323b5ebaf3ecae8d",
      }),
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.e1323b5ebaf3ecae8d",
      }),
    ]),
  }),
  Object.freeze({
    source:
      "Case Study Simulator AI Learning Mode is a focused way to use AI for learning instead of passive answer collection. The mode is built around a specific job: Enter a realistic case, make decisions, see consequences, and learn the principle behind each choice.",
    sourceSha256:
      "f2dd0879eda2a2159b958b34e01896ce68879c683a7ecb35f3044d2e4774f19e",
    value:
      "Gevallestudiesimulator se KI-leermodus is ’n doelgerigte manier om KI vir leer te gebruik eerder as om passief antwoorde in te samel. Die modus is rondom ’n spesifieke taak gebou: Betree ’n realistiese saak, neem besluite, sien gevolge en leer die beginsel agter elke keuse.",
    valueSha256:
      "90a1781478c0fadd3476793b039670812152c68d9683a3ca29400594640368b6",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "blog:ai-case-study-simulator-guide",
        sourceHash:
          "d25e29048727587d8bcdcc15b1e1ed16c600d1d495d2bacf9fc6deb4fb4e2655",
        key: "site.bc64634fca85b780b9",
      }),
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.bc64634fca85b780b9",
      }),
    ]),
  }),
  Object.freeze({
    source:
      "Use Case Study Simulator when this is the right mode for the job. If you want a related path, try Feynman Tutor. You can also browse the AI learning blog for study methods, Socratic learning, flashcards, roleplay, and active recall.",
    sourceSha256:
      "f29c6dd11a9cb5a2e3134f68923ee2bf46dfb03233002dc2eee1a05088a51396",
    value:
      "Gebruik Gevallestudiesimulator wanneer dit die regte modus vir die taak is. As jy ’n verwante leerpad wil volg, probeer Feynman Tutor. Jy kan ook deur die KI-leerblog blaai vir studiemetodes, Sokratiese leer, flitskaarte, rolspel en aktiewe herroeping.",
    valueSha256:
      "3b0c87fb7a637bbbfb48341a5b5935e4191bfebec04f145e6bab130134be89d0",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "blog:case-study-simulator-prompts-and-study-loop",
        sourceHash:
          "ae93e71916cb8c96898b54aa328a39f08ef1ee6f799425b2baa6637a1e583287",
        key: "site.d835e997c12945b8ec",
      }),
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.d835e997c12945b8ec",
      }),
    ]),
  }),
  // Independently reviewed after the exact source exhausted all three bounded
  // MPS retries and the two-replica deterministic CPU rescue. The historical
  // R12-R15 model output is deliberately not reused: this value is the sole
  // source-hash- and occurrence-bound manual rescue for the current wording.
  Object.freeze({
    source:
      "Civics Coach AI Learning Mode is a focused way to use AI for learning instead of passive answer collection. The mode is built around a specific job: Learn constitutions, democracy, elections, courts, rights, duties, and public policy.",
    sourceSha256:
      "f20e1ae1b0659633731779b7e2a20b3f586d09b582c1f57160905cd6618e0e17",
    value:
      "Civics Coach se KI-leermodus is ’n doelgerigte manier om KI vir leer te gebruik eerder as om passief antwoorde in te samel. Die modus is rondom ’n spesifieke taak gebou: Leer oor grondwette, demokrasie, verkiesings, howe, regte, pligte en openbare beleid.",
    valueSha256:
      "7b52389138278c3b190e4caa1d23760c69d123efa9234bf0fbe519ad753bbaa3",
    requiredOccurrences: Object.freeze([
      Object.freeze({
        namespace: "blog:ai-civics-coach-guide",
        sourceHash:
          "441d65898f6c21bdcf5b68d5c2f695c45a5df7254ed028af7ea8411f697aa0cd",
        key: "site.d3623627f25eddf8fa",
      }),
      Object.freeze({
        namespace: "route:blog",
        sourceHash:
          "3d5296735a4d992afe94bd58bf37c4177ffef5a4ed08b6a486fc6c7b77c3ce8d",
        key: "site.d3623627f25eddf8fa",
      }),
    ]),
  }),
] as const);
const afrikaansProductCopyHistoricalSourceSha256 =
  "d1c3aad9169ce77ed81f205e28108d50eccdbd3cd0bed9da3f3bf2eea46b84a1" as const;
export const LONG_TAIL_TRANSLATION_SEED_MEMORY_KIND =
  "inspir-long-tail-translation-seed-memory-v1" as const;
export const LONG_TAIL_GENERATION_OVERRIDES_KIND =
  "inspir-long-tail-generation-overrides-v1" as const;
export const LONG_TAIL_HISTORICAL_SQL_SEED_KIND =
  "inspir-long-tail-historical-sql-seed-v1" as const;
export const LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND =
  "inspir-long-tail-source-stale-replacement-v1" as const;
export const LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND =
  "inspir-long-tail-quality-stale-replacement-v1" as const;
export const LONG_TAIL_WORKER_RUNTIME_PREFLIGHT_KIND =
  "inspir-long-tail-worker-runtime-preflight-v2" as const;

export type LongTailSemanticPromotionAudit = Readonly<{
  masterWorklistSha256: string;
  promotionEvidence: TranslationSemanticPromotionEvidenceUnion;
  manifest: Readonly<{
    results: Readonly<{
      packBindings: readonly Readonly<{
        locale: string;
        namespace: string;
        origin: "curated" | "candidate";
        packFileSha256: string;
      }>[];
    }>;
  }>;
}>;

const DEFAULT_RUN_DIRECTORY = "tmp/long-tail-translation-pipeline-v10";
const DEFAULT_MODEL_DIRECTORY = path.join(
  os.homedir(),
  ".cache/inspirlearning/nllb-200-distilled-1.3B",
);
const DEFAULT_PYTHON = "tmp/nllb-venv/bin/python";
const DEFAULT_WORKER_SCRIPT =
  "scripts/generate-long-tail-translations-worker.py";
const DEFAULT_MODEL_LABEL = "nllb-200-distilled-1.3B-local";
const EXPECTED_PRODUCTION_PACKS = 7_865;
const EXPECTED_PRODUCTION_COMPLETED_BASELINE_PACKS = 760;
const EXPECTED_PRODUCTION_SOURCE_STALE_PACKS = 12;
const EXPECTED_PRODUCTION_QUALITY_STALE_PACKS = 80;
const EXPECTED_PRODUCTION_REPAIR_BASELINE_COMPLETED_PACKS = 668;
const EXPECTED_PRODUCTION_TOTAL_PACKS = 8_625;
const EXPECTED_PRODUCTION_LANGUAGES = 65;
const EXPECTED_PRODUCTION_NAMESPACES = 121;
const EXPECTED_PRODUCTION_TOTAL_LANGUAGES = 69;
const EXPECTED_PRODUCTION_TOTAL_NAMESPACES = 125;
const MAXIMUM_HISTORICAL_SQL_BYTES = 256 * 1024 * 1024;
const EXPECTED_HISTORICAL_APP_TRANSLATION_ROWS = 8_625;
const EXPECTED_HISTORICAL_SOURCE_ROWS = 125;
const EXPECTED_HISTORICAL_SOURCE_STRING_ROWS = 19_142;
const MAXIMUM_WORKERS = 4;
const MAXIMUM_JSON_BYTES = 64 * 1024 * 1024;
const MAXIMUM_MASTER_WORKLIST_BYTES = 160 * 1024 * 1024;
const MAXIMUM_RUNTIME_PREFLIGHT_OUTPUT_BYTES = 64 * 1024;
const MAXIMUM_RUNTIME_PREFLIGHT_TIMEOUT_MS = 20 * 60 * 1_000;
const DEFAULT_RUNTIME_PREFLIGHT_TIMEOUT_MS = 60 * 1_000;
const DEFAULT_MODEL_RUNTIME_SMOKE_TIMEOUT_MS = 20 * 60 * 1_000;
const localModelEnvironmentPassthroughKeys = Object.freeze([
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "DYLD_LIBRARY_PATH",
] as const);
const longTailWorkerCoreRuntimeNames = Object.freeze([
  "numpy",
  "safetensors",
  "sentencepiece",
  "tokenizers",
  "torch",
  "transformers",
] as const);
const longTailWorkerCoreRuntimeVersions = Object.freeze({
  numpy: "1.26.4",
  safetensors: "0.7.0",
  sentencepiece: "0.2.1",
  tokenizers: "0.20.3",
  torch: "2.2.2",
  transformers: "4.46.3",
} as const satisfies Readonly<
  Record<(typeof longTailWorkerCoreRuntimeNames)[number], string>
>);
const sha256Pattern = /^[a-f0-9]{64}$/;
const productionHistoricalTranslationSnapshots = Object.freeze([
  Object.freeze({
    basename: "d1-before-seo-cta-repair-2026-07-10T21-15-42-557Z.sql",
    sha256:
      "8e27a4deffc6a5b9c6bda341b0bc49819c87ceffbacd3af80b5f85d67b115828",
  }),
  Object.freeze({
    basename: "d1-before-seo-cta-repair-2026-07-10T21-17-19-781Z.sql",
    sha256:
      "5198be4d91da078661ba3381df07e70dec8e91d3f52b659b249feb1d32fc40d6",
  }),
  Object.freeze({
    basename: "d1-before-seo-cta-repair-2026-07-10T21-29-42-177Z.sql",
    sha256:
      "3d6d876f76c316979cda54b1751e757d2ab3250128f3f01d23513141252d3c38",
  }),
  Object.freeze({
    basename: "d1-before-seo-cta-repair-2026-07-11T02-44-08-010Z.sql",
    sha256:
      "ca22d68152018117a00b4dc66c588aa61431f36429a9de74a32c793b1be17ca9",
  }),
] as const);
const productionHistoricalTranslationSnapshotSha256s = Object.freeze(
  productionHistoricalTranslationSnapshots.map((snapshot) => snapshot.sha256),
);
const sourceStaleReplacementLanguageList = Object.freeze([
  "Arabic",
  "Hindi",
  "Malayalam",
  "Spanish",
] as const);
const sourceStaleReplacementLanguages = new Set<SupportedLanguage>(
  sourceStaleReplacementLanguageList,
);

const nllbCodeByLocale: Readonly<Record<string, string>> = Object.freeze({
  af: "afr_Latn",
  am: "amh_Ethi",
  ar: "arb_Arab",
  as: "asm_Beng",
  az: "azj_Latn",
  bg: "bul_Cyrl",
  bn: "ben_Beng",
  bs: "bos_Latn",
  ca: "cat_Latn",
  cs: "ces_Latn",
  cy: "cym_Latn",
  da: "dan_Latn",
  de: "deu_Latn",
  el: "ell_Grek",
  es: "spa_Latn",
  et: "est_Latn",
  eu: "eus_Latn",
  fa: "pes_Arab",
  fi: "fin_Latn",
  fil: "tgl_Latn",
  fr: "fra_Latn",
  ga: "gle_Latn",
  gl: "glg_Latn",
  gu: "guj_Gujr",
  ha: "hau_Latn",
  he: "heb_Hebr",
  hi: "hin_Deva",
  hr: "hrv_Latn",
  hu: "hun_Latn",
  hy: "hye_Armn",
  id: "ind_Latn",
  is: "isl_Latn",
  it: "ita_Latn",
  ja: "jpn_Jpan",
  ka: "kat_Geor",
  kn: "kan_Knda",
  ko: "kor_Hang",
  lt: "lit_Latn",
  lv: "lvs_Latn",
  ml: "mal_Mlym",
  mr: "mar_Deva",
  ms: "zsm_Latn",
  ne: "npi_Deva",
  nl: "nld_Latn",
  no: "nob_Latn",
  or: "ory_Orya",
  pa: "pan_Guru",
  pl: "pol_Latn",
  pt: "por_Latn",
  ro: "ron_Latn",
  ru: "rus_Cyrl",
  si: "sin_Sinh",
  sk: "slk_Latn",
  sl: "slv_Latn",
  so: "som_Latn",
  sq: "als_Latn",
  sr: "srp_Cyrl",
  sv: "swe_Latn",
  sw: "swh_Latn",
  ta: "tam_Taml",
  te: "tel_Telu",
  th: "tha_Thai",
  tr: "tur_Latn",
  uk: "ukr_Cyrl",
  ur: "urd_Arab",
  vi: "vie_Latn",
  yo: "yor_Latn",
  zh: "zho_Hans",
  zu: "zul_Latn",
});

const targetLanguageSchema = z.enum(supportedLanguages).refine(
  (language) => language !== defaultLanguage,
  "English is not a translation target.",
);
const sha256Schema = z.string().regex(sha256Pattern);
const safePositiveIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const relativePathSchema = z.string().min(1).max(1_024).refine(
  (value) => isSafeRelativePath(value),
  "Expected a safe normalized relative path.",
);
const protectedSegmentSchema = z.object({
  kind: z.enum(["text", "literal"]),
  value: z.string().max(100_000),
}).strict();
const sourceEntrySchema = z.object({
  key: z.string().min(1).max(1_024),
  source: z.string().max(100_000),
  sourceSha256: sha256Schema,
  invariantSha256: sha256Schema,
  segments: z.array(protectedSegmentSchema).min(1).max(10_000),
}).strict();
const sourceCatalogEntrySchema = z.object({
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  entries: z.array(sourceEntrySchema).min(1).max(20_000),
}).strict();
const generationConfigSchema = z.object({
  batchSize: safePositiveIntegerSchema.refine((value) => value <= 256),
  numBeams: safePositiveIntegerSchema.refine((value) => value <= 8),
  noRepeatNgramSize: z.number().int().min(0).max(16),
  dtype: z.enum(["float16", "float32"]),
  device: z.enum(["auto", "cpu", "mps"]),
  maxSourceTokens: safePositiveIntegerSchema.refine((value) => value <= 1_022),
  maxNewTokens: safePositiveIntegerSchema.refine((value) => value <= 1_022),
  maxRetryAttempts: safePositiveIntegerSchema.refine((value) => value <= 3),
  deterministicAlgorithms: z.literal(true),
  manualSeed: z.literal(0),
}).strict();
const longTailWorkerRuntimeVersionsSchema = z.object({
  numpy: z.string(),
  safetensors: z.string(),
  sentencepiece: z.string(),
  tokenizers: z.string(),
  torch: z.string(),
  transformers: z.string(),
}).strict();
const longTailWorkerRuntimeOriginsSchema = z.object({
  numpy: z.string().min(1).max(4_096),
  safetensors: z.string().min(1).max(4_096),
  sentencepiece: z.string().min(1).max(4_096),
  tokenizers: z.string().min(1).max(4_096),
  torch: z.string().min(1).max(4_096),
  transformers: z.string().min(1).max(4_096),
}).strict();
const longTailWorkerRuntimePreflightSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal(LONG_TAIL_WORKER_RUNTIME_PREFLIGHT_KIND),
  executionProfile: longTailNllbExecutionProfileSchema,
  observedEnvironment: z.object({
    MKL_NUM_THREADS: z.literal(
      LONG_TAIL_NLLB_EXECUTION_PROFILE.environment.MKL_NUM_THREADS,
    ),
    OMP_NUM_THREADS: z.literal(
      LONG_TAIL_NLLB_EXECUTION_PROFILE.environment.OMP_NUM_THREADS,
    ),
    PYTORCH_ENABLE_MPS_FALLBACK: z.literal(
      LONG_TAIL_NLLB_EXECUTION_PROFILE.environment
        .PYTORCH_ENABLE_MPS_FALLBACK,
    ),
    VECLIB_MAXIMUM_THREADS: z.literal(
      LONG_TAIL_NLLB_EXECUTION_PROFILE.environment.VECLIB_MAXIMUM_THREADS,
    ),
  }).strict(),
  torchThreads: z.object({
    interopThreads: z.literal(
      LONG_TAIL_NLLB_EXECUTION_PROFILE.torch.interopThreads,
    ),
    intraopThreads: z.literal(
      LONG_TAIL_NLLB_EXECUTION_PROFILE.torch.intraopThreads,
    ),
  }).strict(),
  pythonImplementation: z.string(),
  pythonVersion: z.string(),
  machine: z.string(),
  userSiteEnabled: z.boolean(),
  sitePackages: z.string().min(1).max(4_096),
  versions: longTailWorkerRuntimeVersionsSchema,
  origins: longTailWorkerRuntimeOriginsSchema,
  mpsBuilt: z.boolean(),
  mpsAvailable: z.boolean(),
  primaryDeterminism: z.object({
    deterministicAlgorithms: z.literal(true),
    warnOnly: z.literal(false),
    manualSeed: z.literal(0),
  }).strict(),
  modelSmoke: z.discriminatedUnion("performed", [
    z.object({ performed: z.literal(false) }).strict(),
    z.object({
      performed: z.literal(true),
      device: z.enum(["cpu", "mps"]),
      dtype: z.enum(["float16", "float32"]),
      deterministicAlgorithms: z.literal(true),
      manualSeed: z.literal(0),
      eosObserved: z.literal(true),
      generatedTokens: safePositiveIntegerSchema.refine((value) => value <= 512),
      outputSha256: sha256Schema,
    }).strict(),
  ]),
}).strict();
export type LongTailWorkerRuntimePreflight = Readonly<
  z.infer<typeof longTailWorkerRuntimePreflightSchema>
>;
const seedMemoryEntrySchema = z.object({
  language: targetLanguageSchema,
  locale: z.string().min(1).max(32),
  source: z.string().max(100_000),
  sourceSha256: sha256Schema,
  value: z.string().min(1).max(200_000),
  valueSha256: sha256Schema,
}).strict();
const seedMemoryConflictSchema = z.object({
  language: targetLanguageSchema,
  locale: z.string().min(1).max(32),
  sourceSha256: sha256Schema,
}).strict();
const seedMemoryMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(LONG_TAIL_TRANSLATION_SEED_MEMORY_KIND),
  entries: z.array(seedMemoryEntrySchema).max(500_000),
  conflicts: z.array(seedMemoryConflictSchema).max(500_000),
}).strict();
const seedMemorySchema = seedMemoryMaterialSchema.extend({
  seedMemorySha256: sha256Schema,
}).strict();
const generationOverrideOccurrenceSchema = z.object({
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  key: z.string().min(1).max(1_024),
}).strict();
const generationOverrideEntrySchema = seedMemoryEntrySchema.extend({
  requiredOccurrences: z.array(generationOverrideOccurrenceSchema)
    .min(1)
    .max(100),
}).strict();
const generationOverridesMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(LONG_TAIL_GENERATION_OVERRIDES_KIND),
  entries: z.array(generationOverrideEntrySchema).max(64),
}).strict();
const generationOverridesSchema = generationOverridesMaterialSchema.extend({
  generationOverridesSha256: sha256Schema,
}).strict();
const historicalSqlSeedEvidenceSchema = z.object({
  kind: z.literal(LONG_TAIL_HISTORICAL_SQL_SEED_KIND),
  selectionPolicy: z.enum(["single-snapshot", "all-snapshots-exact"]),
  bytes: z.number().int().min(1).max(256 * 1024 * 1024),
  sha256: sha256Schema,
  supportingSnapshotSha256s: z.array(sha256Schema).max(3),
  excludedNonConsensusPayloadFields: z.number().int().min(0).max(2_000_000),
  excludedNonConsensusSourceStrings: z.number().int().min(0).max(100_000),
  appTranslationRows: z.number().int().min(1).max(100_000),
  appTranslationSourceRows: z.number().int().min(1).max(10_000),
  appTranslationSourceStringRows: z.number().int().min(1).max(100_000),
  languages: z.number().int().min(1).max(1_000),
  namespaces: z.number().int().min(1).max(10_000),
}).strict();
const historicalTranslationPayloadSchema = z.record(
  z.string().min(1).max(1_024),
  z.string().min(1).max(200_000),
);
const validatorPolicyFileSchema = z.object({
  relativePath: relativePathSchema,
  bytes: z.number().int().min(0).max(MAXIMUM_JSON_BYTES),
  sha256: sha256Schema,
}).strict();
const validatorPolicySchema: z.ZodType<LongTailValidatorPolicyProvenance> =
  z.object({
    kind: z.literal(LONG_TAIL_VALIDATOR_POLICY_KIND),
    files: z.array(validatorPolicyFileSchema).length(
      LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS.length,
    ),
    validatorPolicySha256: sha256Schema,
  }).strict();
const provenanceSchema = z.object({
  pipelineVersion: z.literal(LONG_TAIL_TRANSLATION_PIPELINE_VERSION),
  executionProfile: longTailNllbExecutionProfileSchema,
  protectorVersion: z.literal(LONG_TAIL_TRANSLATION_PROTECTOR_VERSION),
  protectorSha256: sha256Schema,
  pipelineImplementationSha256: sha256Schema,
  workerImplementationSha256: sha256Schema,
  validatorPolicy: validatorPolicySchema,
  modelLabel: z.string().min(1).max(256),
  modelSha256: sha256Schema,
  seedMemorySha256: sha256Schema,
  seedMemoryEntries: z.number().int().min(0).max(500_000),
  seedMemoryConflicts: z.number().int().min(0).max(500_000),
  generationOverridesSha256: sha256Schema,
  generationOverrideEntries: z.number().int().min(0).max(64),
  generationConfig: generationConfigSchema,
}).strict();
const sourceStaleReplacementApprovalSchema = z.object({
  language: targetLanguageSchema,
  namespace: z.string().min(1).max(1_024),
  priorSourceHash: sha256Schema,
  newSourceHash: sha256Schema,
}).strict().refine(
  (value) => value.priorSourceHash !== value.newSourceHash,
  "A source-stale approval must bind different prior and new source hashes.",
);
const sourceStaleReplacementBindingSchema = z.object({
  kind: z.literal(LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND),
  existingFileSha256: sha256Schema,
  priorSourceHash: sha256Schema,
}).strict();
const qualityStaleReplacementBindingSchema = z.object({
  kind: z.literal(LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND),
  existingFileSha256: sha256Schema,
  sourceHash: sha256Schema,
  validatorPolicySha256: sha256Schema,
}).strict();
const replacementBindingSchema = z.discriminatedUnion("kind", [
  sourceStaleReplacementBindingSchema,
  qualityStaleReplacementBindingSchema,
]);
const jobMaterialSchema = z.object({
  language: targetLanguageSchema,
  locale: z.string().min(1).max(32),
  nllbCode: z.string().regex(/^[a-z]{3}_[A-Za-z]{4}$/),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  entryCount: safePositiveIntegerSchema,
  worklistRelativePath: relativePathSchema,
  candidateRelativePath: relativePathSchema,
  targetRelativePath: relativePathSchema,
  replacement: replacementBindingSchema.optional(),
}).strict();
const jobSchema = jobMaterialSchema.extend({
  jobSha256: sha256Schema,
}).strict();
const masterWorklistMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(LONG_TAIL_TRANSLATION_WORKLIST_KIND),
  provenance: provenanceSchema,
  seedMemory: seedMemorySchema,
  generationOverrides: generationOverridesSchema,
  sources: z.array(sourceCatalogEntrySchema).min(1).max(1_000),
  jobs: z.array(jobSchema).max(100_000),
}).strict();
const masterWorklistSchema = masterWorklistMaterialSchema.extend({
  worklistSha256: sha256Schema,
}).strict();
const packWorklistMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(LONG_TAIL_TRANSLATION_PACK_WORKLIST_KIND),
  masterWorklistSha256: sha256Schema,
  provenance: provenanceSchema,
  job: jobSchema,
  source: sourceCatalogEntrySchema,
}).strict();
const packWorklistSchema = packWorklistMaterialSchema.extend({
  packWorklistSha256: sha256Schema,
}).strict();
const candidateEntrySchema = z.object({
  key: z.string().min(1).max(1_024),
  source: z.string().max(100_000),
  sourceSha256: sha256Schema,
  value: z.string().min(1).max(200_000),
}).strict();
const candidateSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(LONG_TAIL_TRANSLATION_CANDIDATE_KIND),
  pipelineVersion: z.literal(LONG_TAIL_TRANSLATION_PIPELINE_VERSION),
  executionProfileSha256: z.literal(
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  ),
  masterWorklistSha256: sha256Schema,
  packWorklistSha256: sha256Schema,
  jobSha256: sha256Schema,
  language: targetLanguageSchema,
  locale: z.string().min(1).max(32),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  modelLabel: z.string().min(1).max(256),
  modelSha256: sha256Schema,
  workerImplementationSha256: sha256Schema,
  validatorPolicySha256: sha256Schema,
  entries: z.array(candidateEntrySchema).min(1).max(20_000),
}).strict();
const existingCuratedPackSchema = z.object({
  schemaVersion: z.literal(1),
  language: z.enum(supportedLanguages),
  locale: z.string().min(1).max(32),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  entries: z.array(z.object({
    key: z.string().min(1).max(1_024),
    source: z.string().max(100_000),
    value: z.string().min(1).max(200_000),
  }).strict()).max(20_000).optional(),
  translations: z.record(z.string(), z.string()).optional(),
}).passthrough();
const trackedStaticMainAppPackSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("static-main-app-values"),
  language: z.enum(supportedLanguages),
  locale: z.string().min(1).max(32),
  sourceHash: sha256Schema,
  keyCount: safePositiveIntegerSchema.refine((value) => value <= 20_000),
  strings: z.array(z.string().min(1).max(200_000)).min(1).max(20_000),
}).strict();

export type LongTailProtectedSegment = z.infer<typeof protectedSegmentSchema>;
export type LongTailSourceEntry = z.infer<typeof sourceEntrySchema>;
export type LongTailSourceCatalogEntry = z.infer<
  typeof sourceCatalogEntrySchema
>;
export type LongTailGenerationConfig = z.infer<typeof generationConfigSchema>;
export type LongTailSeedMemory = z.infer<typeof seedMemorySchema>;
export type LongTailGenerationOverrides = z.infer<
  typeof generationOverridesSchema
>;
export type LongTailHistoricalSqlSeedEvidence = z.infer<
  typeof historicalSqlSeedEvidenceSchema
>;
export type LongTailPipelineProvenance = z.infer<typeof provenanceSchema>;
export type LongTailSourceStaleReplacementApproval = z.infer<
  typeof sourceStaleReplacementApprovalSchema
>;
export type LongTailTranslationJob = z.infer<typeof jobSchema>;
export type LongTailMasterWorklist = z.infer<typeof masterWorklistSchema>;
export type LongTailPackWorklist = z.infer<typeof packWorklistSchema>;
export type LongTailCandidate = z.infer<typeof candidateSchema>;

type LongTailHistoricalTranslationRow = Readonly<{
  namespace: string;
  language: SupportedLanguage;
  sourceHash: string;
  payload: Readonly<Record<string, string>>;
  model: string;
}>;

type LongTailHistoricalSourceRow = Readonly<{
  namespace: string;
  sourceHash: string;
}>;

export type LongTailHistoricalTranslationSeed = Readonly<{
  evidence: LongTailHistoricalSqlSeedEvidence;
  rows: ReadonlyMap<string, LongTailHistoricalTranslationRow>;
  sources: ReadonlyMap<string, LongTailHistoricalSourceRow>;
  sourceStrings: ReadonlyMap<string, ReadonlyMap<string, string>>;
}>;

const productionSourceStaleReplacementHashPairs = Object.freeze([
  Object.freeze({
    namespace: "legal:privacy",
    priorSourceHash:
      "91c1b6ff25b53cc0143c710bd821d17945a82dd164a0555c0a1311294c24106a",
    newSourceHash:
      "28716f737f9e79719469e06bfbbca5084c1e533315b1b9ef5fa6f270503e67bb",
  }),
  Object.freeze({
    namespace: "legal:terms",
    priorSourceHash:
      "fff6b8bcbcaa4ebe5be2eda02d0d4b3f54f7383acb7837245ca73c16b84f01e8",
    newSourceHash:
      "f8f20182b03b4c9fa33c4c90dd7f765e65b61206e43ee1ec15f7e88c3c30dc0b",
  }),
  Object.freeze({
    namespace: "legal:tnc",
    priorSourceHash:
      "330fd5f27bd9bdf95efc483b3f61dfc02a61cee56aa3ca8688715973d14d151b",
    newSourceHash:
      "f8f20182b03b4c9fa33c4c90dd7f765e65b61206e43ee1ec15f7e88c3c30dc0b",
  }),
]);

// CLI input can never expand this extractor-audited production allowlist.
export const PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS:
  readonly LongTailSourceStaleReplacementApproval[] = Object.freeze(
    sourceStaleReplacementLanguageList.flatMap((language) =>
      productionSourceStaleReplacementHashPairs.map((pair) => Object.freeze({
        language,
        namespace: pair.namespace,
        priorSourceHash: pair.priorSourceHash,
        newSourceHash: pair.newSourceHash,
      }))
    ),
  );

export type LongTailInventory = Readonly<{
  languages: readonly SupportedLanguage[];
  sources: readonly TranslationSource[];
  curatedRoot: string;
  staticMainAppRoot?: string;
}>;

export type LongTailWorklistBuildResult = Readonly<{
  worklist: LongTailMasterWorklist;
  completedPacks: number;
  missingPacks: number;
  sourceStalePacks: number;
  qualityStalePacks: number;
  totalPacks: number;
  targetLanguages: readonly SupportedLanguage[];
  targetNamespaces: readonly string[];
  missingTargetLanguages: readonly SupportedLanguage[];
  missingTargetNamespaces: readonly string[];
  sourceStaleTargetLanguages: readonly SupportedLanguage[];
  sourceStaleTargetNamespaces: readonly string[];
  qualityStaleTargetLanguages: readonly SupportedLanguage[];
  qualityStaleTargetNamespaces: readonly string[];
}>;

export type LongTailPipelineErrorCode =
  | "LONG_TAIL_CONTRACT_INVALID"
  | "LONG_TAIL_SOURCE_DRIFT"
  | "LONG_TAIL_EXISTING_PACK_INVALID"
  | "LONG_TAIL_PATH_UNSAFE"
  | "LONG_TAIL_CONFLICT"
  | "LONG_TAIL_CANDIDATE_INVALID"
  | "LONG_TAIL_WORKER_FAILED";

export class LongTailPipelineError extends Error {
  readonly code: LongTailPipelineErrorCode;

  constructor(code: LongTailPipelineErrorCode, message: string) {
    super(message);
    this.name = "LongTailPipelineError";
    this.code = code;
  }
}

type ProtectedSpan = Readonly<{
  start: number;
  end: number;
  value: string;
  priority: number;
}>;

const protectedPatterns = [
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

export function protectLongTailSourceText(source: string): Readonly<{
  segments: readonly LongTailProtectedSegment[];
  invariantSha256: string;
}> {
  const spans: ProtectedSpan[] = [];
  for (const { pattern, priority } of protectedPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined || !match[0]) continue;
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        value: match[0],
        priority,
      });
    }
  }
  spans.sort(
    (left, right) =>
      left.start - right.start ||
      left.priority - right.priority ||
      right.end - right.start - (left.end - left.start),
  );
  const selected: ProtectedSpan[] = [];
  let claimedUntil = 0;
  for (const span of spans) {
    if (span.start < claimedUntil) continue;
    selected.push(span);
    claimedUntil = span.end;
  }
  const segments: LongTailProtectedSegment[] = [];
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
  if (!segments.length) segments.push({ kind: "text", value: source });
  const immutableSegments = segments.map((segment) => Object.freeze(segment));
  const invariants = immutableSegments
    .filter((segment) => segment.kind === "literal")
    .map((segment) => segment.value);
  return Object.freeze({
    segments: Object.freeze(immutableSegments),
    invariantSha256: sha256Canonical(invariants),
  });
}

export function hasExactLongTailInvariantParity(
  source: string,
  value: string,
) {
  const sourceLiterals = protectLongTailSourceText(source).segments
    .filter((segment) => segment.kind === "literal")
    .map((segment) => segment.value);
  const valueLiterals = protectLongTailSourceText(value).segments
    .filter((segment) => segment.kind === "literal")
    .map((segment) => segment.value);
  return sourceLiterals.length === valueLiterals.length &&
    sourceLiterals.every((literal, index) => literal === valueLiterals[index]);
}

export function createProductionLongTailInventory(
  repoRoot = process.cwd(),
): LongTailInventory {
  const mainAppStrings = getMainAppSourceStrings();
  const sources: TranslationSource[] = [
    {
      namespace: mainAppTranslationNamespace,
      sourceHash: getMainAppSourceHash(mainAppStrings),
      sourceStrings: mainAppStrings,
    },
    ...getAllSiteTranslationNamespaces().map((namespace) =>
      getSiteTranslationSource(namespace),
    ),
  ];
  return Object.freeze({
    languages: Object.freeze(
      supportedLanguages.filter((language) => language !== defaultLanguage),
    ),
    sources: Object.freeze(sources),
    curatedRoot: path.join(path.resolve(repoRoot), "translations/curated"),
    staticMainAppRoot: path.join(
      path.resolve(repoRoot),
      "translations/static-main-app",
    ),
  });
}

const historicalAppTranslationInsertPrefix =
  'INSERT INTO "app_translations" ("namespace","language","source_hash","payload","model","created_at","updated_at") VALUES(';
const historicalSourceInsertPrefix =
  'INSERT INTO "app_translation_sources" ("namespace","source_hash","updated_at") VALUES(';
const historicalSourceStringInsertPrefix =
  'INSERT INTO "app_translation_source_strings" ("namespace","source_key","source_text") VALUES(';
const MAXIMUM_HISTORICAL_SQL_LINE_BYTES = 2 * 1024 * 1024;

type HistoricalSqlValueKind = "string" | "integer-or-null";

function sanitizedHistoricalSeedBasename(sqlPath: string) {
  return path.basename(sqlPath).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128) ||
    "historical-seed.sql";
}

function historicalSeedContractError(
  basename: string,
  reason: string,
  lineNumber?: number,
) {
  return pipelineError(
    "LONG_TAIL_CONTRACT_INVALID",
    `Historical translation seed ${basename}${
      lineNumber === undefined ? "" : ` at row ${lineNumber}`
    } ${reason}.`,
  );
}

function parseHistoricalSqlInsertValues(input: {
  line: string;
  prefix: string;
  kinds: readonly HistoricalSqlValueKind[];
  basename: string;
  lineNumber: number;
}) {
  if (!input.line.startsWith(input.prefix)) {
    throw historicalSeedContractError(
      input.basename,
      "uses an unexpected INSERT shape",
      input.lineNumber,
    );
  }
  const values: Array<string | null> = [];
  let cursor = input.prefix.length;
  for (const [index, kind] of input.kinds.entries()) {
    if (kind === "string") {
      if (input.line[cursor] !== "'") {
        throw historicalSeedContractError(
          input.basename,
          "has a non-string SQL value",
          input.lineNumber,
        );
      }
      cursor += 1;
      let value = "";
      let closed = false;
      while (cursor < input.line.length) {
        const character = input.line[cursor];
        if (character !== "'") {
          value += character;
          cursor += 1;
          continue;
        }
        if (input.line[cursor + 1] === "'") {
          value += "'";
          cursor += 2;
          continue;
        }
        cursor += 1;
        closed = true;
        break;
      }
      if (!closed) {
        throw historicalSeedContractError(
          input.basename,
          "has an unterminated SQL string",
          input.lineNumber,
        );
      }
      values.push(value);
    } else {
      const terminator = index === input.kinds.length - 1 ? ");" : ",";
      const end = input.line.indexOf(terminator, cursor);
      if (end === -1) {
        throw historicalSeedContractError(
          input.basename,
          "has a malformed integer timestamp",
          input.lineNumber,
        );
      }
      const raw = input.line.slice(cursor, end);
      if (raw !== "NULL" && !/^(?:0|[1-9][0-9]*)$/.test(raw)) {
        throw historicalSeedContractError(
          input.basename,
          "has a noncanonical integer timestamp",
          input.lineNumber,
        );
      }
      values.push(raw === "NULL" ? null : raw);
      cursor = end;
    }
    const final = index === input.kinds.length - 1;
    const separator = final ? ");" : ",";
    if (input.line.slice(cursor, cursor + separator.length) !== separator) {
      throw historicalSeedContractError(
        input.basename,
        "has unexpected SQL separators",
        input.lineNumber,
      );
    }
    cursor += separator.length;
  }
  if (cursor !== input.line.length) {
    throw historicalSeedContractError(
      input.basename,
      "has trailing SQL content",
      input.lineNumber,
    );
  }
  return Object.freeze(values);
}

function assertHistoricalFileIdentity(
  basename: string,
  expected: Stats,
  actual: Stats,
) {
  if (
    expected.dev !== actual.dev ||
    expected.ino !== actual.ino ||
    expected.size !== actual.size ||
    expected.mtimeMs !== actual.mtimeMs ||
    expected.ctimeMs !== actual.ctimeMs
  ) {
    throw historicalSeedContractError(
      basename,
      "changed while it was being read",
    );
  }
}

export function loadLongTailHistoricalTranslationSqlSeed(input: {
  repoRoot: string;
  sqlPath: string;
  trustedSha256s?: readonly string[];
  expectedAppTranslationRows?: number;
  expectedSourceRows?: number;
  expectedSourceStringRows?: number;
}): LongTailHistoricalTranslationSeed {
  const repoRoot = path.resolve(input.repoRoot);
  const confinedRoot = path.join(
    repoRoot,
    "tmp/cloudflare-reports/cloudflare",
  );
  const sqlPath = path.resolve(repoRoot, input.sqlPath);
  const basename = sanitizedHistoricalSeedBasename(sqlPath);
  if (!sqlPath.startsWith(`${confinedRoot}${path.sep}`)) {
    throw historicalSeedContractError(
      basename,
      "must remain under the ignored Cloudflare report directory",
    );
  }
  assertExistingPathComponentsAreNotSymlinks(confinedRoot);
  assertExistingPathComponentsAreNotSymlinks(sqlPath);
  const currentUid = typeof process.getuid === "function"
    ? process.getuid()
    : undefined;
  if (currentUid === undefined) {
    throw historicalSeedContractError(
      basename,
      "requires an operating-system user identity",
    );
  }
  const before = lstatSync(sqlPath);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    (before.mode & 0o7777) !== 0o600 ||
    before.uid !== currentUid ||
    before.size < 1 ||
    before.size > MAXIMUM_HISTORICAL_SQL_BYTES
  ) {
    throw historicalSeedContractError(
      basename,
      "must be a current-owner 0600 regular non-linked file within the size limit",
    );
  }
  const descriptor = openSync(
    sqlPath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  let bytes: Buffer;
  try {
    const opened = fstatSync(descriptor);
    assertHistoricalFileIdentity(basename, before, opened);
    bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        null,
      );
      if (read === 0) {
        throw historicalSeedContractError(
          basename,
          "ended before its declared byte length",
        );
      }
      offset += read;
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0) {
      throw historicalSeedContractError(
        basename,
        "grew beyond its declared byte length",
      );
    }
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(sqlPath);
    assertHistoricalFileIdentity(basename, before, afterDescriptor);
    assertHistoricalFileIdentity(basename, before, afterPath);
  } finally {
    closeSync(descriptor);
  }
  if (bytes.includes(0)) {
    throw historicalSeedContractError(basename, "contains a NUL byte");
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw historicalSeedContractError(basename, "is not exact UTF-8");
  }
  const sha256 = sha256Buffer(bytes);
  const trustedSha256s = input.trustedSha256s ??
    productionHistoricalTranslationSnapshotSha256s;
  if (
    !trustedSha256s.length ||
    trustedSha256s.some((digest) => !sha256Pattern.test(digest)) ||
    !trustedSha256s.includes(sha256)
  ) {
    throw historicalSeedContractError(
      basename,
      "does not match the extractor-audited digest allowlist",
    );
  }

  const rows = new Map<string, LongTailHistoricalTranslationRow>();
  const sources = new Map<string, LongTailHistoricalSourceRow>();
  const sourceStrings = new Map<string, Map<string, string>>();
  const languages = new Set<SupportedLanguage>();
  const namespaces = new Set<string>();
  let sourceStringRows = 0;
  let lineNumber = 0;
  let cursor = 0;
  while (cursor <= text.length) {
    const nextNewline = text.indexOf("\n", cursor);
    const end = nextNewline === -1 ? text.length : nextNewline;
    const line = text.slice(cursor, end);
    lineNumber += 1;
    if (
      line.length > MAXIMUM_HISTORICAL_SQL_LINE_BYTES ||
      Buffer.byteLength(line, "utf8") > MAXIMUM_HISTORICAL_SQL_LINE_BYTES
    ) {
      throw historicalSeedContractError(
        basename,
        "exceeds the bounded SQL row size",
        lineNumber,
      );
    }
    if (line.startsWith(historicalAppTranslationInsertPrefix)) {
      const values = parseHistoricalSqlInsertValues({
        line,
        prefix: historicalAppTranslationInsertPrefix,
        kinds: [
          "string",
          "string",
          "string",
          "string",
          "string",
          "integer-or-null",
          "integer-or-null",
        ],
        basename,
        lineNumber,
      });
      const [namespaceValue, languageValue, sourceHash, payloadJson, model] =
        values;
      const languageResult = targetLanguageSchema.safeParse(languageValue);
      if (
        typeof namespaceValue !== "string" ||
        !namespaceValue ||
        namespaceValue.length > 1_024 ||
        !languageResult.success ||
        typeof sourceHash !== "string" ||
        !sha256Pattern.test(sourceHash) ||
        typeof payloadJson !== "string" ||
        Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_JSON_BYTES ||
        typeof model !== "string" ||
        !model ||
        model.length > 256
      ) {
        throw historicalSeedContractError(
          basename,
          "has malformed app_translations metadata",
          lineNumber,
        );
      }
      let payloadValue: unknown;
      try {
        payloadValue = JSON.parse(payloadJson) as unknown;
      } catch {
        throw historicalSeedContractError(
          basename,
          "has malformed payload JSON",
          lineNumber,
        );
      }
      const payloadResult = historicalTranslationPayloadSchema.safeParse(
        payloadValue,
      );
      if (
        !payloadResult.success ||
        Object.keys(payloadResult.data).length < 1 ||
        Object.keys(payloadResult.data).length > 20_000
      ) {
        throw historicalSeedContractError(
          basename,
          "has a malformed translation payload",
          lineNumber,
        );
      }
      const language = languageResult.data;
      const identity = `${language}\u0000${namespaceValue}`;
      if (rows.has(identity)) {
        throw historicalSeedContractError(
          basename,
          "contains a duplicate language and namespace",
          lineNumber,
        );
      }
      rows.set(identity, Object.freeze({
        namespace: namespaceValue,
        language,
        sourceHash,
        payload: Object.freeze(payloadResult.data),
        model,
      }));
      languages.add(language);
      namespaces.add(namespaceValue);
    } else if (line.startsWith(historicalSourceInsertPrefix)) {
      const values = parseHistoricalSqlInsertValues({
        line,
        prefix: historicalSourceInsertPrefix,
        kinds: ["string", "string", "integer-or-null"],
        basename,
        lineNumber,
      });
      const [namespaceValue, sourceHash] = values;
      if (
        typeof namespaceValue !== "string" ||
        !namespaceValue ||
        namespaceValue.length > 1_024 ||
        typeof sourceHash !== "string" ||
        !sha256Pattern.test(sourceHash)
      ) {
        throw historicalSeedContractError(
          basename,
          "has malformed app_translation_sources metadata",
          lineNumber,
        );
      }
      if (sources.has(namespaceValue)) {
        throw historicalSeedContractError(
          basename,
          "contains a duplicate translation source namespace",
          lineNumber,
        );
      }
      sources.set(namespaceValue, Object.freeze({
        namespace: namespaceValue,
        sourceHash,
      }));
    } else if (line.startsWith(historicalSourceStringInsertPrefix)) {
      const values = parseHistoricalSqlInsertValues({
        line,
        prefix: historicalSourceStringInsertPrefix,
        kinds: ["string", "string", "string"],
        basename,
        lineNumber,
      });
      const [namespaceValue, sourceKey, sourceText] = values;
      if (
        typeof namespaceValue !== "string" ||
        !namespaceValue ||
        namespaceValue.length > 1_024 ||
        typeof sourceKey !== "string" ||
        !sourceKey ||
        sourceKey.length > 1_024 ||
        typeof sourceText !== "string" ||
        Buffer.byteLength(sourceText, "utf8") > 100_000
      ) {
        throw historicalSeedContractError(
          basename,
          "has malformed app_translation_source_strings metadata",
          lineNumber,
        );
      }
      let namespaceStrings = sourceStrings.get(namespaceValue);
      if (!namespaceStrings) {
        namespaceStrings = new Map<string, string>();
        sourceStrings.set(namespaceValue, namespaceStrings);
      }
      if (namespaceStrings.has(sourceKey)) {
        throw historicalSeedContractError(
          basename,
          "contains a duplicate translation source string",
          lineNumber,
        );
      }
      namespaceStrings.set(sourceKey, sourceText);
      sourceStringRows += 1;
    } else if (line.startsWith("INSERT INTO")) {
      throw historicalSeedContractError(
        basename,
        "contains an unexpected table INSERT",
        lineNumber,
      );
    }
    if (nextNewline === -1) break;
    cursor = nextNewline + 1;
  }
  if (
    input.expectedAppTranslationRows !== undefined &&
    rows.size !== input.expectedAppTranslationRows
  ) {
    throw historicalSeedContractError(
      basename,
      "does not contain the expected app_translations row count",
    );
  }
  if (
    input.expectedSourceRows !== undefined &&
    sources.size !== input.expectedSourceRows
  ) {
    throw historicalSeedContractError(
      basename,
      "does not contain the expected translation-source row count",
    );
  }
  if (
    input.expectedSourceStringRows !== undefined &&
    sourceStringRows !== input.expectedSourceStringRows
  ) {
    throw historicalSeedContractError(
      basename,
      "does not contain the expected translation-source-string row count",
    );
  }
  for (const namespace of sourceStrings.keys()) {
    if (!sources.has(namespace)) {
      throw historicalSeedContractError(
        basename,
        "contains source strings without a declared translation source",
      );
    }
  }
  const evidence = parseSchema(historicalSqlSeedEvidenceSchema, {
    kind: LONG_TAIL_HISTORICAL_SQL_SEED_KIND,
    selectionPolicy: "single-snapshot",
    bytes: bytes.length,
    sha256,
    supportingSnapshotSha256s: [],
    excludedNonConsensusPayloadFields: 0,
    excludedNonConsensusSourceStrings: 0,
    appTranslationRows: rows.size,
    appTranslationSourceRows: sources.size,
    appTranslationSourceStringRows: sourceStringRows,
    languages: languages.size,
    namespaces: namespaces.size,
  }, "historical translation seed evidence");
  return Object.freeze({
    evidence: Object.freeze(evidence),
    rows: rows as ReadonlyMap<string, LongTailHistoricalTranslationRow>,
    sources: sources as ReadonlyMap<string, LongTailHistoricalSourceRow>,
    sourceStrings: sourceStrings as ReadonlyMap<
      string,
      ReadonlyMap<string, string>
    >,
  });
}

export function createLongTailHistoricalTranslationSeedConsensus(
  input: {
    primary: LongTailHistoricalTranslationSeed;
    supporting: readonly LongTailHistoricalTranslationSeed[];
  },
): LongTailHistoricalTranslationSeed {
  const primary = input.primary;
  if (
    primary.evidence.selectionPolicy !== "single-snapshot" ||
    input.supporting.length < 1 ||
    input.supporting.length > 3 ||
    input.supporting.some(
      (seed) => seed.evidence.selectionPolicy !== "single-snapshot",
    )
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Historical translation consensus requires two to four individual snapshots.",
    );
  }
  const snapshotSha256s = [
    primary.evidence.sha256,
    ...input.supporting.map((seed) => seed.evidence.sha256),
  ];
  if (new Set(snapshotSha256s).size !== snapshotSha256s.length) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Historical translation consensus cannot reuse the same snapshot digest.",
    );
  }
  const excludedPayloadKeys = new Map<string, Set<string>>();
  const excludedSourceStringKeys = new Map<string, Set<string>>();
  const supportingSnapshotSha256s: string[] = [];
  for (const supporting of input.supporting) {
    if (
      supporting.evidence.appTranslationRows !==
        primary.evidence.appTranslationRows ||
      supporting.evidence.appTranslationSourceRows !==
        primary.evidence.appTranslationSourceRows ||
      supporting.evidence.appTranslationSourceStringRows !==
        primary.evidence.appTranslationSourceStringRows ||
      supporting.evidence.languages !== primary.evidence.languages ||
      supporting.evidence.namespaces !== primary.evidence.namespaces
    ) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        "Historical translation consensus snapshots have different aggregate shapes.",
      );
    }
    supportingSnapshotSha256s.push(supporting.evidence.sha256);
    for (const identity of supporting.rows.keys()) {
      if (!primary.rows.has(identity)) {
        throw pipelineError(
          "LONG_TAIL_CONTRACT_INVALID",
          "A supporting historical translation snapshot contains an unexpected row identity.",
        );
      }
    }
    for (const [identity, primaryRow] of primary.rows) {
      const supportingRow = supporting.rows.get(identity);
      const payloadKeys = new Set([
        ...Object.keys(primaryRow.payload),
        ...Object.keys(supportingRow?.payload ?? {}),
      ]);
      for (const key of payloadKeys) {
        if (supportingRow?.payload[key] === primaryRow.payload[key]) continue;
        let excluded = excludedPayloadKeys.get(identity);
        if (!excluded) {
          excluded = new Set<string>();
          excludedPayloadKeys.set(identity, excluded);
        }
        excluded.add(key);
      }
    }
    for (const [namespace, primaryStrings] of primary.sourceStrings) {
      const supportingStrings = supporting.sourceStrings.get(namespace);
      const sourceKeys = new Set([
        ...primaryStrings.keys(),
        ...(supportingStrings?.keys() ?? []),
      ]);
      for (const key of sourceKeys) {
        if (supportingStrings?.get(key) === primaryStrings.get(key)) continue;
        let excluded = excludedSourceStringKeys.get(namespace);
        if (!excluded) {
          excluded = new Set<string>();
          excludedSourceStringKeys.set(namespace, excluded);
        }
        excluded.add(key);
      }
    }
  }

  let excludedNonConsensusPayloadFields = 0;
  const rows = new Map<string, LongTailHistoricalTranslationRow>();
  for (const [identity, row] of primary.rows) {
    const excluded = excludedPayloadKeys.get(identity);
    if (!excluded?.size) {
      rows.set(identity, row);
      continue;
    }
    excludedNonConsensusPayloadFields += excluded.size;
    rows.set(identity, Object.freeze({
      ...row,
      payload: Object.freeze(Object.fromEntries(
        Object.entries(row.payload).filter(([key]) => !excluded.has(key)),
      )),
    }));
  }
  const sourceStrings = new Map<string, ReadonlyMap<string, string>>();
  for (const [namespace, strings] of primary.sourceStrings) {
    const excluded = excludedSourceStringKeys.get(namespace);
    sourceStrings.set(
      namespace,
      !excluded?.size
        ? strings
        : new Map(
          [...strings].filter(([key]) => !excluded.has(key)),
        ),
    );
  }
  const evidence = parseSchema(historicalSqlSeedEvidenceSchema, {
    ...primary.evidence,
    selectionPolicy: "all-snapshots-exact",
    supportingSnapshotSha256s,
    excludedNonConsensusPayloadFields,
    excludedNonConsensusSourceStrings: [...excludedSourceStringKeys.values()]
      .reduce((total, keys) => total + keys.size, 0),
  }, "historical translation consensus evidence");
  return Object.freeze({
    evidence: Object.freeze(evidence),
    rows: rows as ReadonlyMap<string, LongTailHistoricalTranslationRow>,
    sources: primary.sources,
    sourceStrings,
  });
}

export function loadProductionLongTailHistoricalTranslationSqlSeedConsensus(
  input: { repoRoot: string; primarySqlPath: string },
): LongTailHistoricalTranslationSeed {
  const preferred = productionHistoricalTranslationSnapshots.at(-1);
  if (!preferred) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "The production historical translation snapshot allowlist is empty.",
    );
  }
  const loadSnapshot = (sqlPath: string, trustedSha256: string) =>
    loadLongTailHistoricalTranslationSqlSeed({
      repoRoot: input.repoRoot,
      sqlPath,
      trustedSha256s: [trustedSha256],
      expectedAppTranslationRows:
        EXPECTED_HISTORICAL_APP_TRANSLATION_ROWS,
      expectedSourceRows: EXPECTED_HISTORICAL_SOURCE_ROWS,
      expectedSourceStringRows:
        EXPECTED_HISTORICAL_SOURCE_STRING_ROWS,
    });
  const primary = loadSnapshot(input.primarySqlPath, preferred.sha256);
  const supporting = productionHistoricalTranslationSnapshots
    .slice(0, -1)
    .map((snapshot) => loadSnapshot(
      path.join(
        path.resolve(input.repoRoot),
        "tmp/cloudflare-reports/cloudflare",
        snapshot.basename,
      ),
      snapshot.sha256,
    ));
  return createLongTailHistoricalTranslationSeedConsensus({
    primary,
    supporting,
  });
}

function parseSourceStaleReplacementApprovals(
  value: readonly LongTailSourceStaleReplacementApproval[],
) {
  const approvals = value.map((approval) =>
    parseSchema(
      sourceStaleReplacementApprovalSchema,
      approval,
      "source-stale replacement approval",
    )
  ).sort((left, right) =>
    compareCodePoints(left.language, right.language) ||
    compareCodePoints(left.namespace, right.namespace) ||
    compareCodePoints(left.priorSourceHash, right.priorSourceHash) ||
    compareCodePoints(left.newSourceHash, right.newSourceHash)
  );
  const identities = new Set<string>();
  for (const approval of approvals) {
    if (!sourceStaleReplacementLanguages.has(approval.language)) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Source-stale replacement is not permitted for ${approval.language}.`,
      );
    }
    const identity = `${approval.language}\u0000${approval.namespace}`;
    if (identities.has(identity)) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Duplicate source-stale replacement approval for ${approval.language}/${approval.namespace}.`,
      );
    }
    identities.add(identity);
  }
  return Object.freeze(approvals.map((approval) => Object.freeze(approval)));
}

function findSourceStaleReplacementApproval(input: {
  approvals: readonly LongTailSourceStaleReplacementApproval[];
  language: SupportedLanguage;
  namespace: string;
  priorSourceHash: string;
  newSourceHash: string;
}) {
  return input.approvals.find((approval) =>
    approval.language === input.language &&
    approval.namespace === input.namespace &&
    approval.priorSourceHash === input.priorSourceHash &&
    approval.newSourceHash === input.newSourceHash
  );
}

function assertReplacementJobApproved(input: {
  job: LongTailTranslationJob;
  approvals: readonly LongTailSourceStaleReplacementApproval[];
  validatorPolicySha256: string;
}) {
  const replacement = input.job.replacement;
  if (!replacement) return;
  if (replacement.kind === LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND) {
    if (
      replacement.sourceHash !== input.job.sourceHash ||
      replacement.validatorPolicySha256 !== input.validatorPolicySha256
    ) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Quality-stale replacement job lost its exact source or validator binding: ${input.job.language}/${input.job.namespace}.`,
      );
    }
    return;
  }
  if (!findSourceStaleReplacementApproval({
    approvals: input.approvals,
    language: input.job.language,
    namespace: input.job.namespace,
    priorSourceHash: replacement.priorSourceHash,
    newSourceHash: input.job.sourceHash,
  })) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Replacement job is not present in the exact approval set: ${input.job.language}/${input.job.namespace}.`,
    );
  }
}

export function composeLongTailEmbeddedSourcePhraseTranslations(input: {
  source: string;
  value: string;
  replacements: ReadonlyMap<string, string>;
}) {
  const literalReplacements: Array<readonly [string, string]> = [];
  for (const phrase of translationEmbeddedSourcePhrases) {
    if (!input.source.includes(phrase) || !input.value.includes(phrase)) {
      continue;
    }
    const replacement = input.replacements.get(phrase);
    if (replacement === undefined || replacement === phrase) continue;
    literalReplacements.push([phrase, replacement]);
  }
  literalReplacements.sort((left, right) =>
    right[0].length - left[0].length || compareCodePoints(left[0], right[0])
  );
  if (!literalReplacements.length) return input.value;

  let cursor = 0;
  let composed = "";
  while (cursor < input.value.length) {
    let nextMatch: Readonly<{
      index: number;
      phrase: string;
      replacement: string;
    }> | undefined;
    for (const [phrase, replacement] of literalReplacements) {
      const index = input.value.indexOf(phrase, cursor);
      if (index < 0 || (nextMatch && index >= nextMatch.index)) continue;
      nextMatch = { index, phrase, replacement };
    }
    if (!nextMatch) return composed + input.value.slice(cursor);
    composed += input.value.slice(cursor, nextMatch.index);
    composed += nextMatch.replacement;
    cursor = nextMatch.index + nextMatch.phrase.length;
  }
  return composed;
}

type AfrikaansProductCopyGlossaryOccurrence = Readonly<{
  namespace: string;
  sourceHash: string;
  key: string;
  source: string;
  sourceSha256: string;
  value?: string;
  valueSha256?: string;
}>;

function isRequiredAfrikaansProductCopyGlossaryIdentity(
  namespace: string,
  key: string,
) {
  return afrikaansProductCopyGlossaryContract.some((binding) =>
    binding.requiredOccurrences.some(
      (occurrence) =>
        occurrence.namespace === namespace && occurrence.key === key,
    )
  );
}

function canonicalInventorySourceHash(
  source: LongTailSourceCatalogEntry,
): string {
  const sourceStrings = Object.fromEntries(
    source.entries.map((entry) => [entry.key, entry.source]),
  );
  return source.namespace === mainAppTranslationNamespace
    ? getMainAppSourceHash(sourceStrings)
    : getSiteSourceHash(sourceStrings);
}

function resolveAfrikaansProductCopyGlossary(
  occurrences: readonly AfrikaansProductCopyGlossaryOccurrence[],
) {
  const qualityPolicyBindings = afrikaansProductCopyPhraseBindings.map(
    ({ literal, canonicalSource }) => ({ literal, canonicalSource }),
  );
  const pipelineBindings = afrikaansProductCopyGlossaryContract.map(
    ({ literal, canonicalSource }) => ({ literal, canonicalSource }),
  );
  if (canonicalJson(qualityPolicyBindings) !== canonicalJson(pipelineBindings)) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "Afrikaans product-copy glossary drifted from the translation quality policy.",
    );
  }

  const replacements = new Map<string, string>();
  for (const binding of afrikaansProductCopyGlossaryContract) {
    if (
      sha256Text(binding.canonicalSource) !== binding.sourceSha256 ||
      sha256Text(binding.value) !== binding.valueSha256
    ) {
      throw pipelineError(
        "LONG_TAIL_SOURCE_DRIFT",
        `Afrikaans product-copy glossary hashes drifted for ${binding.canonicalSource}.`,
      );
    }

    for (const required of binding.requiredOccurrences) {
      const matches = occurrences.filter(
        (occurrence) =>
          occurrence.namespace === required.namespace &&
          occurrence.key === required.key,
      );
      if (!matches.length) {
        throw pipelineError(
          "LONG_TAIL_CONTRACT_INVALID",
          `Afrikaans product-copy glossary is missing ${required.namespace}/${required.key}.`,
        );
      }
      if (matches.length !== 1) {
        throw pipelineError(
          "LONG_TAIL_SOURCE_DRIFT",
          `Afrikaans product-copy glossary duplicated ${required.namespace}/${required.key}.`,
        );
      }
      const occurrence = matches[0];
      if (
        !occurrence ||
        occurrence.sourceHash !== required.sourceHash ||
        occurrence.source !== binding.canonicalSource ||
        occurrence.sourceSha256 !== binding.sourceSha256
      ) {
        throw pipelineError(
          "LONG_TAIL_SOURCE_DRIFT",
          `Afrikaans product-copy glossary source drifted for ${required.namespace}/${required.key}.`,
        );
      }
      if (
        occurrence.value === undefined ||
        occurrence.valueSha256 === undefined
      ) {
        throw pipelineError(
          "LONG_TAIL_CONTRACT_INVALID",
          `Afrikaans product-copy glossary has no tracked value for ${required.namespace}/${required.key}.`,
        );
      }
      if (
        occurrence.value !== binding.value ||
        occurrence.valueSha256 !== binding.valueSha256
      ) {
        throw pipelineError(
          "LONG_TAIL_CONFLICT",
          `Afrikaans product-copy glossary conflicts for ${binding.canonicalSource}.`,
        );
      }
    }

    for (const occurrence of occurrences) {
      if (
        occurrence.source !== binding.canonicalSource ||
        occurrence.value === undefined
      ) {
        continue;
      }
      if (
        occurrence.sourceSha256 !== binding.sourceSha256 ||
        occurrence.value !== binding.value ||
        occurrence.valueSha256 !== binding.valueSha256
      ) {
        throw pipelineError(
          "LONG_TAIL_CONFLICT",
          `Tracked Afrikaans product label conflicts for ${binding.canonicalSource}.`,
        );
      }
    }
    replacements.set(binding.literal, binding.value);
    replacements.set(binding.canonicalSource, binding.value);
  }
  return replacements;
}

export function createLongTailSeedMemory(
  inventory: LongTailInventory,
  sourceStaleReplacementApprovals:
    readonly LongTailSourceStaleReplacementApproval[] = [],
  historicalSeed?: LongTailHistoricalTranslationSeed,
): LongTailSeedMemory {
  const approvals = parseSourceStaleReplacementApprovals(
    sourceStaleReplacementApprovals,
  );
  const sources = [...inventory.sources]
    .map(createSourceCatalogEntry)
    .sort((left, right) => compareCodePoints(left.namespace, right.namespace));
  const entries: z.infer<typeof seedMemoryEntrySchema>[] = [];
  const conflicts: z.infer<typeof seedMemoryConflictSchema>[] = [];
  for (const language of [...inventory.languages].sort(compareCodePoints)) {
    if (language === defaultLanguage) continue;
    const locale = languageConfigs[language].prefix ||
      languageConfigs[language].locale;
    let hasPendingPack = false;
    const exactSourceByHash = new Map<string, string>();
    const valueBySourceHash = new Map<string, string>();
    const conflictedSourceHashes = new Set<string>();
    const neededSourceHashes = new Set<string>();
    const pendingSources: LongTailSourceCatalogEntry[] = [];
    const afrikaansProductCopyOccurrences:
      AfrikaansProductCopyGlossaryOccurrence[] = [];
    let afrikaansProductCopyReplacements: ReadonlyMap<string, string> | undefined;
    const addValidatedSeedValue = (input: {
      source: string;
      value: string;
      key?: string;
      context?: Readonly<{
        namespace: string;
        sourceHash: string;
        key: string;
      }>;
    }) => {
      const failures = validateTranslationCandidateField({
        language,
        source: input.source,
        value: input.value,
      }).failures;
      if (
        failures.length ||
        input.value !== input.value.normalize("NFC") ||
        !hasExactLongTailInvariantParity(input.source, input.value) ||
        !isValidFieldTranslation(
          input.source,
          input.value,
          language,
          input.key,
        ) ||
        !isTranslationFieldLikelyFluent(
          input.source,
          input.value,
          language,
          input.context,
        )
      ) {
        return;
      }
      const sourceSha256 = sha256Text(input.source);
      const priorSource = exactSourceByHash.get(sourceSha256);
      if (priorSource !== undefined && priorSource !== input.source) {
        throw pipelineError(
          "LONG_TAIL_CONFLICT",
          `Seed memory source hash collision for ${language}.`,
        );
      }
      exactSourceByHash.set(sourceSha256, input.source);
      if (conflictedSourceHashes.has(sourceSha256)) return;
      const priorValue = valueBySourceHash.get(sourceSha256);
      if (priorValue !== undefined && priorValue !== input.value) {
        valueBySourceHash.delete(sourceSha256);
        conflictedSourceHashes.add(sourceSha256);
        return;
      }
      if (priorValue !== undefined) return;
      valueBySourceHash.set(sourceSha256, input.value);
    };
    const composeHistoricalSeedValue = (source: string, value: string) => {
      const hasAfrikaansProductCopy =
        language === "Afrikaans" &&
        afrikaansProductCopyGlossaryContract.some(
          (binding) =>
            source.includes(binding.literal) ||
            source.includes(binding.canonicalSource),
        );
      if (hasAfrikaansProductCopy) {
        if (!afrikaansProductCopyReplacements) {
          throw pipelineError(
            "LONG_TAIL_SOURCE_DRIFT",
            "Afrikaans product-copy composition lost its exact glossary binding.",
          );
        }
        if (
          source === afrikaansProductCopyHistoricalSource &&
          sha256Text(source) !== afrikaansProductCopyHistoricalSourceSha256
        ) {
          throw pipelineError(
            "LONG_TAIL_SOURCE_DRIFT",
            "Afrikaans product-copy historical source hash drifted.",
          );
        }
        value = composeLongTailEmbeddedSourcePhraseTranslations({
          source,
          value,
          replacements: afrikaansProductCopyReplacements,
        });
      }
      const replacements = new Map<string, string>();
      for (const phrase of translationHistoricalEmbeddedSourcePhrases) {
        if (!source.includes(phrase) || !value.includes(phrase)) continue;
        const phraseSha256 = sha256Text(phrase);
        if (
          exactSourceByHash.get(phraseSha256) !== phrase ||
          conflictedSourceHashes.has(phraseSha256)
        ) {
          continue;
        }
        const translatedPhrase = valueBySourceHash.get(phraseSha256);
        if (!translatedPhrase || translatedPhrase === phrase) continue;
        replacements.set(phrase, translatedPhrase);
      }
      return composeLongTailEmbeddedSourcePhraseTranslations({
        source,
        value,
        replacements,
      });
    };
    const addHistoricalSeedValues = (
      source: LongTailSourceCatalogEntry,
      embeddedPhrasesOnly = false,
    ) => {
      const row = historicalSeed?.rows.get(
        `${language}\u0000${source.namespace}`,
      );
      if (!row) return;
      if (
        row.language !== language ||
        row.namespace !== source.namespace
      ) {
        throw pipelineError(
          "LONG_TAIL_CONTRACT_INVALID",
          "Historical translation seed row identity drifted after validation.",
        );
      }
      const historicalSource = historicalSeed?.sources.get(source.namespace);
      const historicalSourceStrings = historicalSeed?.sourceStrings.get(
        source.namespace,
      );
      if (
        !historicalSource ||
        !historicalSourceStrings
      ) {
        return;
      }
      if (source.namespace === mainAppTranslationNamespace) {
        const sourceKeys = source.entries.map((entry) => entry.key)
          .sort(compareCodePoints);
        const payloadKeys = Object.keys(row.payload).sort(compareCodePoints);
        const historicalSourceKeys = [...historicalSourceStrings.keys()]
          .sort(compareCodePoints);
        if (
          historicalSource.sourceHash !== row.sourceHash ||
          row.sourceHash !== source.sourceHash ||
          canonicalJson(sourceKeys) !== canonicalJson(payloadKeys) ||
          canonicalJson(sourceKeys) !== canonicalJson(historicalSourceKeys)
        ) {
          return;
        }
        for (const entry of source.entries) {
          if (
            embeddedPhrasesOnly &&
            !translationHistoricalEmbeddedSourcePhrases.some(
              (phrase) => phrase === entry.source,
            )
          ) {
            continue;
          }
          if (historicalSourceStrings.get(entry.key) !== entry.source) continue;
          const value = row.payload[entry.key];
          if (value === undefined) continue;
          addValidatedSeedValue({
            source: entry.source,
            value: composeHistoricalSeedValue(entry.source, value),
            key: entry.key,
            context: {
              namespace: source.namespace,
              sourceHash: source.sourceHash,
              key: entry.key,
            },
          });
        }
        return;
      }
      for (const entry of source.entries) {
        if (
          embeddedPhrasesOnly &&
          !translationHistoricalEmbeddedSourcePhrases.some(
            (phrase) => phrase === entry.source,
          )
        ) {
          continue;
        }
        const expectedContentAddressedKey =
          `site.${sha1Text(entry.source).slice(0, 18)}`;
        if (
          getSiteTranslationSourceKey(entry.source) !==
            expectedContentAddressedKey
        ) {
          throw pipelineError(
            "LONG_TAIL_SOURCE_DRIFT",
            "The shared site translation key derivation drifted from the provenance-bound pipeline algorithm.",
          );
        }
        if (
          entry.key !== expectedContentAddressedKey ||
          historicalSourceStrings.get(entry.key) !== entry.source ||
          !Object.prototype.hasOwnProperty.call(row.payload, entry.key)
        ) {
          continue;
        }
        const value = row.payload[entry.key];
        if (value === undefined) continue;
        addValidatedSeedValue({
          source: entry.source,
          value: composeHistoricalSeedValue(entry.source, value),
          key: entry.key,
          context: {
            namespace: source.namespace,
            sourceHash: source.sourceHash,
            key: entry.key,
          },
        });
      }
    };
    for (const source of sources) {
      const existing = readExistingCuratedPackValues({
        curatedRoot: inventory.curatedRoot,
        staticMainAppRoot: inventory.staticMainAppRoot,
        language,
        locale,
        source,
      });
      if (language === "Afrikaans") {
        const trackedValues =
          existing.status === "complete" || existing.status === "quality-stale"
            ? existing.values
            : undefined;
        for (const entry of source.entries) {
          const canonicalProductSource =
            afrikaansProductCopyGlossaryContract.some(
              (binding) => binding.canonicalSource === entry.source,
            );
          const requiredIdentity =
            isRequiredAfrikaansProductCopyGlossaryIdentity(
              source.namespace,
              entry.key,
            );
          if (!requiredIdentity && (!trackedValues || !canonicalProductSource)) {
            continue;
          }
          const value = trackedValues?.get(entry.key);
          afrikaansProductCopyOccurrences.push(Object.freeze({
            namespace: source.namespace,
            sourceHash: source.sourceHash,
            key: entry.key,
            source: entry.source,
            sourceSha256: entry.sourceSha256,
            ...(value === undefined
              ? {}
              : { value, valueSha256: sha256Text(value) }),
          }));
        }
      }
      if (existing.status === "missing") {
        hasPendingPack = true;
        for (const entry of source.entries) {
          neededSourceHashes.add(entry.sourceSha256);
        }
        pendingSources.push(source);
        continue;
      }
      if (existing.status === "source-stale") {
        const approval = findSourceStaleReplacementApproval({
          approvals,
          language,
          namespace: source.namespace,
          priorSourceHash: existing.priorSourceHash,
          newSourceHash: source.sourceHash,
        });
        if (!approval) continue;
        hasPendingPack = true;
        for (const entry of source.entries) {
          neededSourceHashes.add(entry.sourceSha256);
        }
        for (const legacy of existing.legacyEntries) {
          addValidatedSeedValue({
            source: legacy.source,
            value: legacy.value,
          });
        }
        pendingSources.push(source);
        continue;
      }
      if (existing.status === "quality-stale") {
        hasPendingPack = true;
        for (const entry of source.entries) {
          neededSourceHashes.add(entry.sourceSha256);
          const value = existing.values.get(entry.key);
          if (!value) continue;
          addValidatedSeedValue({
            source: entry.source,
            value,
            key: entry.key,
            context: {
              namespace: source.namespace,
              sourceHash: source.sourceHash,
              key: entry.key,
            },
          });
        }
        pendingSources.push(source);
        continue;
      }
      if (existing.status !== "complete") continue;
      const strings = Object.fromEntries(existing.values);
      const sourceStrings = Object.fromEntries(
        source.entries.map((entry) => [entry.key, entry.source]),
      );
      const sourceBundle: TranslationSource = {
        namespace: source.namespace,
        sourceHash: source.sourceHash,
        sourceStrings,
      };
      const bundle: TranslationBundle = {
        namespace: source.namespace,
        language,
        sourceHash: source.sourceHash,
        sourceStrings,
        strings,
      };
      if (
        !isTranslationBundleFieldValid(sourceBundle, bundle, language) ||
        !isTranslationBundleCompleteAndFluent(sourceBundle, bundle, language)
      ) {
        continue;
      }
      for (const sourceEntry of source.entries) {
        const value = existing.values.get(sourceEntry.key);
        if (!value) continue;
        addValidatedSeedValue({
          source: sourceEntry.source,
          value,
          key: sourceEntry.key,
          context: {
            namespace: source.namespace,
            sourceHash: source.sourceHash,
            key: sourceEntry.key,
          },
        });
      }
    }
    if (
      language === "Afrikaans" &&
      sources.some((source) =>
        source.entries.some((entry) =>
          afrikaansProductCopyGlossaryContract.some(
            (binding) =>
              entry.source.includes(binding.literal) ||
              entry.source.includes(binding.canonicalSource),
          )
        )
      )
    ) {
      if (
        sha256Text(afrikaansProductCopyHistoricalSource) !==
          afrikaansProductCopyHistoricalSourceSha256
      ) {
        throw pipelineError(
          "LONG_TAIL_SOURCE_DRIFT",
          "Afrikaans product-copy historical source hash drifted.",
        );
      }
      afrikaansProductCopyReplacements = resolveAfrikaansProductCopyGlossary(
        afrikaansProductCopyOccurrences,
      );
    }
    for (const source of pendingSources) {
      addHistoricalSeedValues(source, true);
    }
    for (const source of pendingSources) addHistoricalSeedValues(source);
    if (language === "Afrikaans") {
      for (const binding of afrikaansCuratedGenerationSeedContract) {
        if (!neededSourceHashes.has(binding.sourceSha256)) continue;
        if (
          sha256Text(binding.source) !== binding.sourceSha256 ||
          sha256Text(binding.value) !== binding.valueSha256
        ) {
          throw pipelineError(
            "LONG_TAIL_SOURCE_DRIFT",
            "Afrikaans curated generation seed content drifted from its exact hashes.",
          );
        }
        const observedOccurrences = sources.flatMap((source) => {
          const matchingEntries = source.entries.filter(
            (entry) => entry.sourceSha256 === binding.sourceSha256,
          );
          if (!matchingEntries.length) return [];
          if (canonicalInventorySourceHash(source) !== source.sourceHash) {
            throw pipelineError(
              "LONG_TAIL_SOURCE_DRIFT",
              `Afrikaans curated generation seed namespace hash drifted for ${source.namespace}.`,
            );
          }
          return matchingEntries.map((entry) => Object.freeze({
            namespace: source.namespace,
            sourceHash: source.sourceHash,
            key: entry.key,
            source: entry.source,
          }));
        }).sort((left, right) =>
          compareCodePoints(left.namespace, right.namespace) ||
          compareCodePoints(left.sourceHash, right.sourceHash) ||
          compareCodePoints(left.key, right.key)
        );
        const expectedOccurrences = binding.requiredOccurrences.map(
          (occurrence) => Object.freeze({
            ...occurrence,
            source: binding.source,
          }),
        ).sort((left, right) =>
          compareCodePoints(left.namespace, right.namespace) ||
          compareCodePoints(left.sourceHash, right.sourceHash) ||
          compareCodePoints(left.key, right.key)
        );
        if (
          canonicalJson(observedOccurrences) !==
            canonicalJson(expectedOccurrences)
        ) {
          throw pipelineError(
            "LONG_TAIL_SOURCE_DRIFT",
            "Afrikaans curated generation seed occurrence identities drifted.",
          );
        }
        addValidatedSeedValue({
          source: binding.source,
          value: binding.value,
        });
        if (
          conflictedSourceHashes.has(binding.sourceSha256) ||
          valueBySourceHash.get(binding.sourceSha256) !== binding.value
        ) {
          throw pipelineError(
            "LONG_TAIL_CONFLICT",
            "Afrikaans curated generation seed conflicts with validated tracked or historical evidence.",
          );
        }
      }
    }
    if (!hasPendingPack) continue;
    for (const [sourceSha256, value] of valueBySourceHash) {
      if (!neededSourceHashes.has(sourceSha256)) continue;
      const source = exactSourceByHash.get(sourceSha256);
      if (!source) {
        throw pipelineError(
          "LONG_TAIL_CONTRACT_INVALID",
          `Seed memory lost exact source bytes for ${language}/${sourceSha256}.`,
        );
      }
      entries.push({
        language,
        locale,
        source,
        sourceSha256,
        value,
        valueSha256: sha256Text(value),
      });
    }
    for (const sourceSha256 of conflictedSourceHashes) {
      if (!neededSourceHashes.has(sourceSha256)) continue;
      conflicts.push({ language, locale, sourceSha256 });
    }
  }
  entries.sort((left, right) =>
    compareCodePoints(left.locale, right.locale) ||
    compareCodePoints(left.sourceSha256, right.sourceSha256)
  );
  conflicts.sort((left, right) =>
    compareCodePoints(left.locale, right.locale) ||
    compareCodePoints(left.sourceSha256, right.sourceSha256)
  );
  const material = parseSchema(seedMemoryMaterialSchema, {
    schemaVersion: 1,
    kind: LONG_TAIL_TRANSLATION_SEED_MEMORY_KIND,
    entries,
    conflicts,
  }, "seed translation memory");
  return deepFreeze(parseSchema(seedMemorySchema, {
    ...material,
    seedMemorySha256: sha256Canonical(material),
  }, "seed translation memory"));
}

export function parseLongTailSeedMemory(value: unknown): LongTailSeedMemory {
  const memory = parseSchema(
    seedMemorySchema,
    value,
    "seed translation memory",
  );
  const { seedMemorySha256, ...material } = memory;
  if (sha256Canonical(material) !== seedMemorySha256) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "Seed translation memory hash is stale or tampered.",
    );
  }
  const identities = new Set<string>();
  let priorIdentity = "";
  for (const entry of memory.entries) {
    const identity = `${entry.locale}\u0000${entry.sourceSha256}`;
    const failures = validateTranslationCandidateField({
      language: entry.language,
      source: entry.source,
      value: entry.value,
    }).failures;
    if (
      identity <= priorIdentity ||
      identities.has(identity) ||
      entry.locale !==
        (languageConfigs[entry.language].prefix ||
          languageConfigs[entry.language].locale) ||
      sha256Text(entry.source) !== entry.sourceSha256 ||
      sha256Text(entry.value) !== entry.valueSha256 ||
      entry.value !== entry.value.normalize("NFC") ||
      failures.length ||
      !hasExactLongTailInvariantParity(entry.source, entry.value)
    ) {
      throw pipelineError(
        "LONG_TAIL_SOURCE_DRIFT",
        `Seed translation memory entry is invalid for ${entry.language}/${entry.sourceSha256}.`,
      );
    }
    identities.add(identity);
    priorIdentity = identity;
  }
  let priorConflictIdentity = "";
  for (const conflict of memory.conflicts) {
    const identity = `${conflict.locale}\u0000${conflict.sourceSha256}`;
    if (
      identity <= priorConflictIdentity ||
      identities.has(identity) ||
      conflict.locale !==
        (languageConfigs[conflict.language].prefix ||
          languageConfigs[conflict.language].locale)
    ) {
      throw pipelineError(
        "LONG_TAIL_SOURCE_DRIFT",
        `Seed translation conflict record is invalid for ${conflict.language}/${conflict.sourceSha256}.`,
      );
    }
    priorConflictIdentity = identity;
  }
  return deepFreeze(memory);
}

function expectedAfrikaansGenerationOverrideEntries(
  seedMemory: LongTailSeedMemory,
) {
  const afrikaansLocale = languageConfigs.Afrikaans.prefix ||
    languageConfigs.Afrikaans.locale;
  const seedByIdentity = new Map(
    seedMemory.entries.map((entry) => [
      `${entry.locale}\u0000${entry.sourceSha256}`,
      entry,
    ] as const),
  );
  return afrikaansCuratedGenerationSeedContract.flatMap((binding) => {
    const seed = seedByIdentity.get(
      `${afrikaansLocale}\u0000${binding.sourceSha256}`,
    );
    if (!seed) return [];
    if (
      seed.language !== "Afrikaans" ||
      seed.locale !== afrikaansLocale ||
      seed.source !== binding.source ||
      seed.sourceSha256 !== binding.sourceSha256 ||
      seed.value !== binding.value ||
      seed.valueSha256 !== binding.valueSha256
    ) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        "Afrikaans generation override differs from its exact reviewed seed entry.",
      );
    }
    return [{
      language: seed.language,
      locale: seed.locale,
      source: binding.source,
      sourceSha256: binding.sourceSha256,
      value: binding.value,
      valueSha256: binding.valueSha256,
      requiredOccurrences: [...binding.requiredOccurrences]
        .sort((left, right) =>
          compareCodePoints(left.namespace, right.namespace) ||
          compareCodePoints(left.sourceHash, right.sourceHash) ||
          compareCodePoints(left.key, right.key)
        ),
    }];
  }).sort((left, right) =>
    compareCodePoints(left.locale, right.locale) ||
    compareCodePoints(left.sourceSha256, right.sourceSha256)
  );
}

function observedGenerationOverrideOccurrences(
  sources: readonly LongTailSourceCatalogEntry[],
  sourceSha256: string,
) {
  return sources.flatMap((source) =>
    source.entries
      .filter((entry) => entry.sourceSha256 === sourceSha256)
      .map((entry) => ({
        namespace: source.namespace,
        sourceHash: source.sourceHash,
        key: entry.key,
      }))
  ).sort((left, right) =>
    compareCodePoints(left.namespace, right.namespace) ||
    compareCodePoints(left.sourceHash, right.sourceHash) ||
    compareCodePoints(left.key, right.key)
  );
}

export function createLongTailGenerationOverrides(
  seedMemory: LongTailSeedMemory,
  sources?: readonly LongTailSourceCatalogEntry[],
): LongTailGenerationOverrides {
  const entries = expectedAfrikaansGenerationOverrideEntries(seedMemory);
  for (const entry of sources ? entries : []) {
    if (
      canonicalJson(observedGenerationOverrideOccurrences(
        sources ?? [],
        entry.sourceSha256,
      )) !== canonicalJson(entry.requiredOccurrences)
    ) {
      throw pipelineError(
        "LONG_TAIL_SOURCE_DRIFT",
        "Afrikaans generation override occurrence identities drifted.",
      );
    }
  }
  const material = parseSchema(generationOverridesMaterialSchema, {
    schemaVersion: 1,
    kind: LONG_TAIL_GENERATION_OVERRIDES_KIND,
    entries,
  }, "long-tail generation overrides");
  return deepFreeze(parseSchema(generationOverridesSchema, {
    ...material,
    generationOverridesSha256: sha256Canonical(material),
  }, "long-tail generation overrides"));
}

export function parseLongTailGenerationOverrides(input: {
  value: unknown;
  seedMemory: LongTailSeedMemory;
  sources: readonly LongTailSourceCatalogEntry[];
}): LongTailGenerationOverrides {
  const overrides = parseSchema(
    generationOverridesSchema,
    input.value,
    "long-tail generation overrides",
  );
  const { generationOverridesSha256, ...material } = overrides;
  if (sha256Canonical(material) !== generationOverridesSha256) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "Long-tail generation overrides hash is stale or tampered.",
    );
  }
  const expectedEntries = expectedAfrikaansGenerationOverrideEntries(
    input.seedMemory,
  );
  if (canonicalJson(overrides.entries) !== canonicalJson(expectedEntries)) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "Long-tail generation overrides are missing, duplicated, out of order, or differ from reviewed seed entries.",
    );
  }
  for (const entry of overrides.entries) {
    if (
      sha256Text(entry.source) !== entry.sourceSha256 ||
      sha256Text(entry.value) !== entry.valueSha256 ||
      canonicalJson(observedGenerationOverrideOccurrences(
        input.sources,
        entry.sourceSha256,
      )) !== canonicalJson(entry.requiredOccurrences)
    ) {
      throw pipelineError(
        "LONG_TAIL_SOURCE_DRIFT",
        "Long-tail generation override content or occurrence provenance drifted.",
      );
    }
  }
  return deepFreeze(overrides);
}

export function buildLongTailMasterWorklist(input: {
  inventory: LongTailInventory;
  provenance: LongTailPipelineProvenance;
  seedMemory: LongTailSeedMemory;
  replaceSourceStale?: boolean;
  replaceQualityStale?: boolean;
  sourceStaleReplacementApprovals?:
    readonly LongTailSourceStaleReplacementApproval[];
}): LongTailWorklistBuildResult {
  const provenance = parseSchema(
    provenanceSchema,
    input.provenance,
    "long-tail provenance",
  );
  const languages = [...input.inventory.languages]
    .filter((language) => language !== defaultLanguage)
    .sort(compareCodePoints);
  const sources = [...input.inventory.sources]
    .map(createSourceCatalogEntry)
    .sort((left, right) => compareCodePoints(left.namespace, right.namespace));
  const seedMemory = parseLongTailSeedMemory(input.seedMemory);
  const generationOverrides = createLongTailGenerationOverrides(
    seedMemory,
    sources,
  );
  const approvals = parseSourceStaleReplacementApprovals(
    input.sourceStaleReplacementApprovals ?? [],
  );
  if (
    seedMemory.seedMemorySha256 !== provenance.seedMemorySha256 ||
    seedMemory.entries.length !== provenance.seedMemoryEntries ||
    seedMemory.conflicts.length !== provenance.seedMemoryConflicts ||
    generationOverrides.generationOverridesSha256 !==
      provenance.generationOverridesSha256 ||
    generationOverrides.entries.length !== provenance.generationOverrideEntries
  ) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "Seed translation memory differs from its provenance binding.",
    );
  }
  assertUnique(languages, "target language");
  assertUnique(
    sources.map((source) => source.namespace),
    "source namespace",
  );
  const jobs: LongTailTranslationJob[] = [];
  const missingJobs: LongTailTranslationJob[] = [];
  const sourceStaleJobs: LongTailTranslationJob[] = [];
  const qualityStaleJobs: LongTailTranslationJob[] = [];
  let completedPacks = 0;
  for (const language of languages) {
    const locale = languageConfigs[language].prefix ||
      languageConfigs[language].locale;
    const nllbCode = nllbCodeByLocale[locale];
    if (!nllbCode) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `No local NLLB target code is registered for ${language}/${locale}.`,
      );
    }
    for (const source of sources) {
      const targetRelativePath = packRelativePath(locale, source.namespace);
      const existing = inspectExistingCuratedPack({
        curatedRoot: input.inventory.curatedRoot,
        staticMainAppRoot: input.inventory.staticMainAppRoot,
        language,
        locale,
        source,
      });
      if (existing.status === "complete") {
        completedPacks += 1;
        continue;
      }
      if (existing.status === "malformed-or-current-invalid") {
        throw pipelineError(
          "LONG_TAIL_EXISTING_PACK_INVALID",
          `Existing curated pack for ${language}/${source.namespace} is malformed or invalid for its current source hash.`,
        );
      }
      let replacement: z.infer<typeof replacementBindingSchema> | undefined;
      if (existing.status === "source-stale") {
        const approval = findSourceStaleReplacementApproval({
          approvals,
          language,
          namespace: source.namespace,
          priorSourceHash: existing.priorSourceHash,
          newSourceHash: source.sourceHash,
        });
        if (!approval) {
          throw pipelineError(
            "LONG_TAIL_EXISTING_PACK_INVALID",
            `Source-stale curated pack for ${language}/${source.namespace} is not bound to an exact approved prior/new source-hash pair.`,
          );
        }
        if (!input.replaceSourceStale) {
          throw pipelineError(
            "LONG_TAIL_SOURCE_DRIFT",
            `Approved source-stale curated pack for ${language}/${source.namespace} requires explicit replacement mode.`,
          );
        }
        replacement = {
          kind: LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND,
          existingFileSha256: existing.existingFileSha256,
          priorSourceHash: existing.priorSourceHash,
        };
      } else if (existing.status === "quality-stale") {
        if (!input.replaceQualityStale) {
          throw pipelineError(
            "LONG_TAIL_SOURCE_DRIFT",
            `Quality-stale curated pack for ${language}/${source.namespace} requires explicit replacement mode.`,
          );
        }
        replacement = {
          kind: LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND,
          existingFileSha256: existing.existingFileSha256,
          sourceHash: source.sourceHash,
          validatorPolicySha256:
            provenance.validatorPolicy.validatorPolicySha256,
        };
      }
      const material = parseSchema(jobMaterialSchema, {
        language,
        locale,
        nllbCode,
        namespace: source.namespace,
        sourceHash: source.sourceHash,
        sourceEntriesSha256: source.sourceEntriesSha256,
        entryCount: source.entries.length,
        worklistRelativePath: targetRelativePath,
        candidateRelativePath: targetRelativePath,
        targetRelativePath,
        ...(replacement ? { replacement } : {}),
      }, `long-tail job ${language}/${source.namespace}`);
      const job = Object.freeze({
        ...material,
        jobSha256: sha256Canonical(material),
      });
      jobs.push(job);
      if (replacement?.kind === LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND) {
        sourceStaleJobs.push(job);
      } else if (
        replacement?.kind === LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND
      ) {
        qualityStaleJobs.push(job);
      } else {
        missingJobs.push(job);
      }
    }
  }
  jobs.sort((left, right) =>
    compareCodePoints(left.candidateRelativePath, right.candidateRelativePath),
  );
  assertUnique(
    jobs.map((job) => job.jobSha256),
    "job hash",
  );
  assertUnique(
    jobs.map((job) => job.targetRelativePath),
    "job target path",
  );
  const material = parseSchema(masterWorklistMaterialSchema, {
    schemaVersion: 1,
    kind: LONG_TAIL_TRANSLATION_WORKLIST_KIND,
    provenance,
    seedMemory,
    generationOverrides,
    sources,
    jobs,
  }, "long-tail master worklist");
  const worklist = deepFreeze(
    parseSchema(masterWorklistSchema, {
      ...material,
      worklistSha256: sha256Canonical(material),
    }, "long-tail master worklist"),
  );
  const targetLanguageSet = new Set(jobs.map((job) => job.language));
  const targetNamespaceSet = new Set(jobs.map((job) => job.namespace));
  const missingLanguageSet = new Set(missingJobs.map((job) => job.language));
  const missingNamespaceSet = new Set(missingJobs.map((job) => job.namespace));
  const sourceStaleLanguageSet = new Set(
    sourceStaleJobs.map((job) => job.language),
  );
  const sourceStaleNamespaceSet = new Set(
    sourceStaleJobs.map((job) => job.namespace),
  );
  const qualityStaleLanguageSet = new Set(
    qualityStaleJobs.map((job) => job.language),
  );
  const qualityStaleNamespaceSet = new Set(
    qualityStaleJobs.map((job) => job.namespace),
  );
  const totalPacks = languages.length * sources.length;
  if (
    completedPacks + missingJobs.length + sourceStaleJobs.length +
      qualityStaleJobs.length !== totalPacks
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Curated inventory accounting does not cover the exact language/source matrix.",
    );
  }
  return Object.freeze({
    worklist,
    completedPacks,
    missingPacks: missingJobs.length,
    sourceStalePacks: sourceStaleJobs.length,
    qualityStalePacks: qualityStaleJobs.length,
    totalPacks,
    targetLanguages: Object.freeze(
      languages.filter((language) => targetLanguageSet.has(language)),
    ),
    targetNamespaces: Object.freeze(
      sources
        .map((source) => source.namespace)
        .filter((namespace) => targetNamespaceSet.has(namespace)),
    ),
    missingTargetLanguages: Object.freeze(
      languages.filter((language) => missingLanguageSet.has(language)),
    ),
    missingTargetNamespaces: Object.freeze(
      sources
        .map((source) => source.namespace)
        .filter((namespace) => missingNamespaceSet.has(namespace)),
    ),
    sourceStaleTargetLanguages: Object.freeze(
      languages.filter((language) => sourceStaleLanguageSet.has(language)),
    ),
    sourceStaleTargetNamespaces: Object.freeze(
      sources
        .map((source) => source.namespace)
        .filter((namespace) => sourceStaleNamespaceSet.has(namespace)),
    ),
    qualityStaleTargetLanguages: Object.freeze(
      languages.filter((language) => qualityStaleLanguageSet.has(language)),
    ),
    qualityStaleTargetNamespaces: Object.freeze(
      sources
        .map((source) => source.namespace)
        .filter((namespace) => qualityStaleNamespaceSet.has(namespace)),
    ),
  });
}

export function createLongTailSmokeWorklist(
  masterValue: LongTailMasterWorklist,
  packCount: number,
): LongTailMasterWorklist {
  const master = parseLongTailMasterWorklist(masterValue);
  const generationOverrideIdentities = new Set(
    master.generationOverrides.entries.map(
      (entry) => `${entry.locale}\u0000${entry.sourceSha256}`,
    ),
  );
  const seededIdentities = new Set(
    master.seedMemory.entries.flatMap((entry) => {
      const identity = `${entry.locale}\u0000${entry.sourceSha256}`;
      return generationOverrideIdentities.has(identity) ? [] : [identity];
    }),
  );
  const sourceByNamespace = new Map(
    master.sources.map((source) => [source.namespace, source]),
  );
  const eligibleJobs = master.jobs.filter((job) => {
    if (job.replacement) return false;
    const source = sourceByNamespace.get(job.namespace);
    return source?.entries.some(
      (entry) =>
        !seededIdentities.has(`${job.locale}\u0000${entry.sourceSha256}`),
    ) === true;
  });
  if (
    !Number.isSafeInteger(packCount) ||
    packCount < 1 ||
    packCount > 10 ||
    packCount > eligibleJobs.length
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Smoke worklist requires 1–10 packs within the production worklist.",
    );
  }
  const material = parseSchema(masterWorklistMaterialSchema, {
    schemaVersion: master.schemaVersion,
    kind: master.kind,
    provenance: master.provenance,
    seedMemory: master.seedMemory,
    generationOverrides: master.generationOverrides,
    sources: master.sources,
    jobs: eligibleJobs.slice(0, packCount),
  }, "long-tail smoke worklist");
  return deepFreeze(parseSchema(masterWorklistSchema, {
    ...material,
    worklistSha256: sha256Canonical(material),
  }, "long-tail smoke worklist"));
}

export function createLongTailLocaleSmokeWorklist(
  masterValue: LongTailMasterWorklist,
  locale: string,
): LongTailMasterWorklist {
  const master = parseLongTailMasterWorklist(masterValue);
  const language = supportedLanguages.find((candidate) =>
    candidate !== defaultLanguage &&
    (languageConfigs[candidate].prefix ||
      languageConfigs[candidate].locale) === locale
  );
  if (!language) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Locale smoke requires one exact supported non-English locale: ${locale}.`,
    );
  }
  const jobs = master.jobs.filter((job) =>
    job.language === language && job.locale === locale
  );
  if (!jobs.length) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Locale smoke has no pending or stale packs for ${language}/${locale}.`,
    );
  }
  const material = parseSchema(masterWorklistMaterialSchema, {
    schemaVersion: master.schemaVersion,
    kind: master.kind,
    provenance: master.provenance,
    seedMemory: master.seedMemory,
    generationOverrides: master.generationOverrides,
    sources: master.sources,
    jobs,
  }, `long-tail ${locale} locale smoke worklist`);
  return deepFreeze(parseSchema(masterWorklistSchema, {
    ...material,
    worklistSha256: sha256Canonical(material),
  }, `long-tail ${locale} locale smoke worklist`));
}

export function createSourceCatalogEntry(
  source: TranslationSource,
): LongTailSourceCatalogEntry {
  if (!sha256Pattern.test(source.sourceHash)) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Source ${source.namespace} has a noncanonical source hash.`,
    );
  }
  const entries = Object.entries(source.sourceStrings)
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([key, sourceText]) => {
      const protectedText = protectLongTailSourceText(sourceText);
      return Object.freeze({
        key,
        source: sourceText,
        sourceSha256: sha256Text(sourceText),
        invariantSha256: protectedText.invariantSha256,
        segments: protectedText.segments,
      });
    });
  if (!entries.length) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Source ${source.namespace} has no translation entries.`,
    );
  }
  const sourceEntriesSha256 = sha256Canonical(entries);
  return deepFreeze(
    parseSchema(sourceCatalogEntrySchema, {
      namespace: source.namespace,
      sourceHash: source.sourceHash,
      sourceEntriesSha256,
      entries,
    }, `source catalog ${source.namespace}`),
  );
}

type LegacySourceTranslation = Readonly<{
  source: string;
  value: string;
}>;

type ExistingCuratedPackInspection =
  | Readonly<{ status: "missing" }>
  | Readonly<{
    status: "complete";
    values: ReadonlyMap<string, string>;
  }>
  | Readonly<{
    status: "source-stale";
    existingFileSha256: string;
    priorSourceHash: string;
    legacyEntries: readonly LegacySourceTranslation[];
  }>
  | Readonly<{
    status: "quality-stale";
    existingFileSha256: string;
    values: ReadonlyMap<string, string>;
  }>
  | Readonly<{ status: "malformed-or-current-invalid" }>;

function inspectExistingCuratedPack(input: {
  curatedRoot: string;
  staticMainAppRoot?: string;
  language: SupportedLanguage;
  locale: string;
  source: LongTailSourceCatalogEntry;
}): ExistingCuratedPackInspection {
  return readExistingCuratedPackValues(input);
}

function readExistingCuratedPackValues(input: {
  curatedRoot: string;
  staticMainAppRoot?: string;
  language: SupportedLanguage;
  locale: string;
  source: LongTailSourceCatalogEntry;
}): ExistingCuratedPackInspection {
  const language = input.language;
  if (language === defaultLanguage) {
    return Object.freeze({ status: "malformed-or-current-invalid" });
  }
  if (input.source.namespace === mainAppTranslationNamespace) {
    if (!input.staticMainAppRoot) {
      return Object.freeze({ status: "malformed-or-current-invalid" });
    }
    const staticPath = path.join(
      path.resolve(input.staticMainAppRoot),
      `${input.locale}.json`,
    );
    try {
      assertRegularUnlinkedFile(staticPath, "tracked static main-app pack");
      const parsed = parseSchema(
        trackedStaticMainAppPackSchema,
        readBoundedJson(staticPath),
        `tracked static main-app pack ${language}`,
      );
      const orderedEntries = [...input.source.entries].sort((left, right) =>
        compareCodePoints(left.key, right.key)
      );
      if (
        parsed.language !== language ||
        parsed.locale !== languageConfigs[language].locale ||
        parsed.sourceHash !== input.source.sourceHash ||
        parsed.keyCount !== orderedEntries.length ||
        parsed.strings.length !== orderedEntries.length
      ) {
        return Object.freeze({ status: "malformed-or-current-invalid" });
      }
      const values = new Map<string, string>();
      for (let index = 0; index < orderedEntries.length; index += 1) {
        const entry = orderedEntries[index];
        const value = parsed.strings[index];
        if (
          !entry ||
          !value ||
          value !== value.normalize("NFC") ||
          !isValidFieldTranslation(entry.source, value, language, entry.key)
        ) {
          return Object.freeze({ status: "malformed-or-current-invalid" });
        }
        values.set(entry.key, value);
      }
      return Object.freeze({ status: "complete", values });
    } catch {
      return Object.freeze({ status: "malformed-or-current-invalid" });
    }
  }
  const languageDirectory = path.join(
    path.resolve(input.curatedRoot),
    input.locale,
  );
  if (!existsSync(languageDirectory)) return Object.freeze({ status: "missing" });
  const safeNamespace = fileSafeNamespace(input.source.namespace);
  const files = readdirSync(languageDirectory)
    .filter(
      (file) =>
        file === `${safeNamespace}.json` ||
        (file.startsWith(`${safeNamespace}.part-`) && file.endsWith(".json")),
    )
    .sort(compareCodePoints);
  if (!files.length) return Object.freeze({ status: "missing" });
  const parsedFiles: Array<z.infer<typeof existingCuratedPackSchema>> = [];
  const filePaths: string[] = [];
  const fileBytes: Buffer[] = [];
  try {
    for (const file of files) {
      const filePath = path.join(languageDirectory, file);
      assertRegularUnlinkedFile(filePath, "existing curated pack");
      const stable = readStableBoundedJsonFile(filePath, MAXIMUM_JSON_BYTES);
      const parsed = parseSchema(
        existingCuratedPackSchema,
        stable.value,
        `existing curated pack ${input.language}/${input.source.namespace}`,
      );
      if (
        parsed.language !== input.language ||
        parsed.locale !== input.locale ||
        parsed.namespace !== input.source.namespace ||
        (parsed.entries === undefined) === (parsed.translations === undefined)
      ) {
        return Object.freeze({ status: "malformed-or-current-invalid" });
      }
      parsedFiles.push(parsed);
      filePaths.push(filePath);
      fileBytes.push(stable.bytes);
    }
  } catch {
    return Object.freeze({ status: "malformed-or-current-invalid" });
  }
  const priorHashes = new Set(parsedFiles.map((parsed) => parsed.sourceHash));
  if (
    priorHashes.size !== 1 ||
    (parsedFiles.some((parsed) => parsed.sourceHash !== input.source.sourceHash) &&
      parsedFiles.length !== 1)
  ) {
    return Object.freeze({ status: "malformed-or-current-invalid" });
  }
  const parsed = parsedFiles[0];
  const filePath = filePaths[0];
  const stableFileBytes = fileBytes[0];
  if (!parsed || !filePath || !stableFileBytes) {
    return Object.freeze({ status: "malformed-or-current-invalid" });
  }
  if (parsed.sourceHash !== input.source.sourceHash) {
    const expectedFile = `${fileSafeNamespace(input.source.namespace)}.json`;
    if (files[0] !== expectedFile) {
      return Object.freeze({ status: "malformed-or-current-invalid" });
    }
    const keys = new Set<string>();
    for (const entry of parsed.entries ?? []) {
      if (keys.has(entry.key)) {
        return Object.freeze({ status: "malformed-or-current-invalid" });
      }
      keys.add(entry.key);
    }
    return Object.freeze({
      status: "source-stale",
      existingFileSha256: sha256Buffer(stableFileBytes),
      priorSourceHash: parsed.sourceHash,
      legacyEntries: Object.freeze(
        (parsed.entries ?? []).map((entry) => Object.freeze({
          source: entry.source,
          value: entry.value,
        })),
      ),
    });
  }
  const values = new Map<string, string>();
  try {
    for (const current of parsedFiles) {
      for (const [key, value] of Object.entries(current.translations ?? {})) {
        if (values.has(key)) {
          return Object.freeze({ status: "malformed-or-current-invalid" });
        }
        values.set(key, value);
      }
      for (const entry of current.entries ?? []) {
        if (
          values.has(entry.key) ||
          input.source.entries.find((sourceEntry) => sourceEntry.key === entry.key)
            ?.source !== entry.source
        ) {
          return Object.freeze({ status: "malformed-or-current-invalid" });
        }
        values.set(entry.key, entry.value);
      }
    }
  } catch {
    return Object.freeze({ status: "malformed-or-current-invalid" });
  }
  if (values.size !== input.source.entries.length) {
    return Object.freeze({ status: "malformed-or-current-invalid" });
  }
  for (const entry of input.source.entries) {
    const value = values.get(entry.key);
    if (
      !value ||
      !isValidFieldTranslation(entry.source, value, language, entry.key)
    ) {
      return Object.freeze({ status: "malformed-or-current-invalid" });
    }
  }
  const sourceStrings = Object.fromEntries(
    input.source.entries.map((entry) => [entry.key, entry.source]),
  );
  const sourceBundle: TranslationSource = {
    namespace: input.source.namespace,
    sourceHash: input.source.sourceHash,
    sourceStrings,
  };
  const translationBundle: TranslationBundle = {
    namespace: input.source.namespace,
    language,
    sourceHash: input.source.sourceHash,
    sourceStrings,
    strings: Object.fromEntries(values),
  };
  if (
    !isTranslationBundleFieldValid(sourceBundle, translationBundle, language) ||
    !isTranslationBundleCompleteAndFluent(
      sourceBundle,
      translationBundle,
      language,
    )
  ) {
    const expectedFile = `${fileSafeNamespace(input.source.namespace)}.json`;
    if (files.length !== 1 || files[0] !== expectedFile) {
      return Object.freeze({ status: "malformed-or-current-invalid" });
    }
    return Object.freeze({
      status: "quality-stale",
      existingFileSha256: sha256Buffer(stableFileBytes),
      values,
    });
  }
  return Object.freeze({ status: "complete", values });
}

export function parseLongTailMasterWorklist(
  value: unknown,
): LongTailMasterWorklist {
  const worklist = parseSchema(
    masterWorklistSchema,
    value,
    "long-tail master worklist",
  );
  const { worklistSha256, ...material } = worklist;
  if (sha256Canonical(material) !== worklistSha256) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "Long-tail master worklist hash is stale or tampered.",
    );
  }
  const seedMemory = parseLongTailSeedMemory(worklist.seedMemory);
  if (
    seedMemory.seedMemorySha256 !== worklist.provenance.seedMemorySha256 ||
    seedMemory.entries.length !== worklist.provenance.seedMemoryEntries ||
    seedMemory.conflicts.length !== worklist.provenance.seedMemoryConflicts
  ) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "Master worklist seed memory differs from its provenance binding.",
    );
  }
  const sourceByNamespace = new Map<string, LongTailSourceCatalogEntry>();
  for (const source of worklist.sources) {
    if (sourceByNamespace.has(source.namespace)) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Duplicate source namespace ${source.namespace}.`,
      );
    }
    if (sha256Canonical(source.entries) !== source.sourceEntriesSha256) {
      throw pipelineError(
        "LONG_TAIL_SOURCE_DRIFT",
        `Source entry hash drifted for ${source.namespace}.`,
      );
    }
    for (const entry of source.entries) {
      const protectedText = protectLongTailSourceText(entry.source);
      if (
        sha256Text(entry.source) !== entry.sourceSha256 ||
        protectedText.invariantSha256 !== entry.invariantSha256 ||
        canonicalJson(protectedText.segments) !== canonicalJson(entry.segments)
      ) {
        throw pipelineError(
          "LONG_TAIL_SOURCE_DRIFT",
          `Protected source entry drifted for ${source.namespace}/${entry.key}.`,
        );
      }
    }
    sourceByNamespace.set(source.namespace, source);
  }
  const generationOverrides = parseLongTailGenerationOverrides({
    value: worklist.generationOverrides,
    seedMemory,
    sources: worklist.sources,
  });
  if (
    generationOverrides.generationOverridesSha256 !==
      worklist.provenance.generationOverridesSha256 ||
    generationOverrides.entries.length !==
      worklist.provenance.generationOverrideEntries
  ) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "Master generation overrides differ from their provenance binding.",
    );
  }
  const jobHashes = new Set<string>();
  const targetPaths = new Set<string>();
  for (const job of worklist.jobs) {
    const { jobSha256, ...jobMaterial } = job;
    const source = sourceByNamespace.get(job.namespace);
    if (
      sha256Canonical(jobMaterial) !== jobSha256 ||
      !source ||
      source.sourceHash !== job.sourceHash ||
      source.sourceEntriesSha256 !== job.sourceEntriesSha256 ||
      source.entries.length !== job.entryCount ||
      job.locale !==
        (languageConfigs[job.language].prefix ||
          languageConfigs[job.language].locale) ||
      nllbCodeByLocale[job.locale] !== job.nllbCode ||
      job.targetRelativePath !== packRelativePath(job.locale, job.namespace) ||
      job.worklistRelativePath !== job.targetRelativePath ||
      job.candidateRelativePath !== job.targetRelativePath ||
      (job.replacement?.kind === LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND &&
        (!sourceStaleReplacementLanguages.has(job.language) ||
          job.replacement.priorSourceHash === job.sourceHash)) ||
      (job.replacement?.kind === LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND &&
        (job.replacement.sourceHash !== job.sourceHash ||
          job.replacement.validatorPolicySha256 !==
            worklist.provenance.validatorPolicy.validatorPolicySha256)) ||
      jobHashes.has(jobSha256) ||
      targetPaths.has(job.targetRelativePath)
    ) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Long-tail job contract is invalid for ${job.language}/${job.namespace}.`,
      );
    }
    jobHashes.add(jobSha256);
    targetPaths.add(job.targetRelativePath);
  }
  const sortedPaths = worklist.jobs
    .map((job) => job.targetRelativePath)
    .sort(compareCodePoints);
  if (
    worklist.jobs.some(
      (job, index) => job.targetRelativePath !== sortedPaths[index],
    )
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Long-tail jobs are not in deterministic target-path order.",
    );
  }
  return deepFreeze(worklist);
}

export const longTailSeedSalvageCurrentValidation = Object.freeze({
  parseMasterWorklist: parseLongTailMasterWorklist,
  parseSeedMemory: parseLongTailSeedMemory,
  hasExactInvariantParity: hasExactLongTailInvariantParity,
}) satisfies LegacyLongTailSeedSalvageCurrentValidation<
  LongTailMasterWorklist,
  LongTailSeedMemory
>;

export function createLongTailPackWorklist(input: {
  master: LongTailMasterWorklist;
  job: LongTailTranslationJob;
}): LongTailPackWorklist {
  const master = parseLongTailMasterWorklist(input.master);
  const canonicalJob = master.jobs.find(
    (candidate) => candidate.jobSha256 === input.job.jobSha256,
  );
  if (!canonicalJob) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Pack worklist job is not registered by the master worklist.",
    );
  }
  return createPackWorklistFromValidatedMaster(master, canonicalJob);
}

function createPackWorklistFromValidatedMaster(
  master: LongTailMasterWorklist,
  job: LongTailTranslationJob,
): LongTailPackWorklist {
  const source = master.sources.find(
    (candidate) => candidate.namespace === job.namespace,
  );
  if (!source) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Pack worklist job is not registered by the master worklist.",
    );
  }
  const material = parseSchema(packWorklistMaterialSchema, {
    schemaVersion: 1,
    kind: LONG_TAIL_TRANSLATION_PACK_WORKLIST_KIND,
    masterWorklistSha256: master.worklistSha256,
    provenance: master.provenance,
    job,
    source,
  }, `pack worklist ${job.language}/${job.namespace}`);
  return deepFreeze(
    parseSchema(packWorklistSchema, {
      ...material,
      packWorklistSha256: sha256Canonical(material),
    }, `pack worklist ${job.language}/${job.namespace}`),
  );
}

export function parseLongTailPackWorklist(
  value: unknown,
): LongTailPackWorklist {
  const pack = parseSchema(
    packWorklistSchema,
    value,
    "long-tail pack worklist",
  );
  const { packWorklistSha256, ...material } = pack;
  if (
    sha256Canonical(material) !== packWorklistSha256 ||
    pack.source.namespace !== pack.job.namespace ||
    pack.source.sourceHash !== pack.job.sourceHash ||
    pack.source.sourceEntriesSha256 !== pack.job.sourceEntriesSha256 ||
    pack.source.entries.length !== pack.job.entryCount
  ) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "Long-tail pack worklist hash or source binding is stale.",
    );
  }
  return deepFreeze(pack);
}

export function materializeLongTailWorklists(input: {
  master: LongTailMasterWorklist;
  runDirectory: string;
}) {
  const master = parseLongTailMasterWorklist(input.master);
  const runDirectory = path.resolve(input.runDirectory);
  const worklistRoot = path.join(runDirectory, "worklists");
  const masterPath = path.join(runDirectory, "worklist.json");
  const masterBytes = prettyJsonBytes(master);
  if (masterBytes.length > MAXIMUM_MASTER_WORKLIST_BYTES) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Master worklist exceeds ${MAXIMUM_MASTER_WORKLIST_BYTES} bytes.`,
    );
  }
  const masterPublication = publishExactFile(masterPath, masterBytes, {
    maximumExistingBytes: MAXIMUM_MASTER_WORKLIST_BYTES,
  });
  let created = masterPublication === "created" ? 1 : 0;
  let replayed = masterPublication === "exact-replay" ? 1 : 0;
  for (const job of master.jobs) {
    const pack = createPackWorklistFromValidatedMaster(master, job);
    const file = resolveContainedPath(
      worklistRoot,
      job.worklistRelativePath,
      "pack worklist",
    );
    const publication = publishExactFile(file, prettyJsonBytes(pack));
    if (publication === "created") created += 1;
    else replayed += 1;
  }
  return Object.freeze({
    masterPath,
    worklistRoot,
    files: master.jobs.length + 1,
    created,
    replayed,
  });
}

export function listPendingLongTailPackWorklists(input: {
  master: LongTailMasterWorklist;
  runDirectory: string;
}): readonly LongTailTranslationJob[] {
  const master = parseLongTailMasterWorklist(input.master);
  const candidateRoot = path.join(path.resolve(input.runDirectory), "candidates");
  return Object.freeze(
    master.jobs.filter((job) => {
      const candidatePath = resolveContainedPath(
        candidateRoot,
        job.candidateRelativePath,
        "candidate",
      );
      if (!existsSync(candidatePath)) return true;
      try {
        const pack = createPackWorklistFromValidatedMaster(master, job);
        validateLongTailCandidate(pack, readBoundedJson(candidatePath));
        return false;
      } catch {
        return true;
      }
    }),
  );
}

export type LongTailCuratedPack = Readonly<{
  schemaVersion: 1;
  language: SupportedLanguage;
  locale: string;
  namespace: string;
  sourceHash: string;
  model: string;
  provenance: Readonly<{
    kind: typeof LONG_TAIL_TRANSLATION_CURATED_PROVENANCE_KIND;
    pipelineVersion: typeof LONG_TAIL_TRANSLATION_PIPELINE_VERSION;
    executionProfileSha256: string;
    protectorVersion: typeof LONG_TAIL_TRANSLATION_PROTECTOR_VERSION;
    protectorSha256: string;
    masterWorklistSha256: string;
    packWorklistSha256: string;
    jobSha256: string;
    sourceEntriesSha256: string;
    modelSha256: string;
    pipelineImplementationSha256: string;
    workerImplementationSha256: string;
    validatorPolicySha256: string;
    candidateSha256: string;
    provenanceSha256: string;
  }>;
  translations: Readonly<Record<string, string>>;
}>;

export function createLongTailCandidate(input: {
  pack: LongTailPackWorklist;
  values: Readonly<Record<string, string>>;
}): LongTailCandidate {
  const pack = parseLongTailPackWorklist(input.pack);
  const entries = pack.source.entries.map((entry) => ({
    key: entry.key,
    source: entry.source,
    sourceSha256: entry.sourceSha256,
    value: input.values[entry.key] ?? "",
  }));
  return deepFreeze(
    parseSchema(candidateSchema, {
      schemaVersion: 1,
      kind: LONG_TAIL_TRANSLATION_CANDIDATE_KIND,
      pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
      executionProfileSha256:
        pack.provenance.executionProfile.executionProfileSha256,
      masterWorklistSha256: pack.masterWorklistSha256,
      packWorklistSha256: pack.packWorklistSha256,
      jobSha256: pack.job.jobSha256,
      language: pack.job.language,
      locale: pack.job.locale,
      namespace: pack.job.namespace,
      sourceHash: pack.job.sourceHash,
      sourceEntriesSha256: pack.job.sourceEntriesSha256,
      modelLabel: pack.provenance.modelLabel,
      modelSha256: pack.provenance.modelSha256,
      workerImplementationSha256:
        pack.provenance.workerImplementationSha256,
      validatorPolicySha256:
        pack.provenance.validatorPolicy.validatorPolicySha256,
      entries,
    }, `candidate ${pack.job.language}/${pack.job.namespace}`),
  );
}

export function validateLongTailCandidate(
  packValue: LongTailPackWorklist,
  candidateValue: unknown,
): Readonly<{
  candidate: LongTailCandidate;
  candidateSha256: string;
  curatedPack: LongTailCuratedPack;
}> {
  const pack = parseLongTailPackWorklist(packValue);
  const candidate = parseSchema(
    candidateSchema,
    candidateValue,
    `candidate ${pack.job.language}/${pack.job.namespace}`,
  );
  if (
    candidate.masterWorklistSha256 !== pack.masterWorklistSha256 ||
    candidate.executionProfileSha256 !==
      pack.provenance.executionProfile.executionProfileSha256 ||
    candidate.packWorklistSha256 !== pack.packWorklistSha256 ||
    candidate.jobSha256 !== pack.job.jobSha256 ||
    candidate.language !== pack.job.language ||
    candidate.locale !== pack.job.locale ||
    candidate.namespace !== pack.job.namespace ||
    candidate.sourceHash !== pack.job.sourceHash ||
    candidate.sourceEntriesSha256 !== pack.job.sourceEntriesSha256 ||
    candidate.modelLabel !== pack.provenance.modelLabel ||
    candidate.modelSha256 !== pack.provenance.modelSha256 ||
    candidate.workerImplementationSha256 !==
      pack.provenance.workerImplementationSha256 ||
    candidate.validatorPolicySha256 !==
      pack.provenance.validatorPolicy.validatorPolicySha256 ||
    candidate.entries.length !== pack.source.entries.length
  ) {
    throw pipelineError(
      "LONG_TAIL_CANDIDATE_INVALID",
      `Candidate provenance mismatch for ${pack.job.language}/${pack.job.namespace}.`,
    );
  }
  const strings: Record<string, string> = {};
  for (const [index, sourceEntry] of pack.source.entries.entries()) {
    const candidateEntry = candidate.entries[index];
    if (
      !candidateEntry ||
      candidateEntry.key !== sourceEntry.key ||
      candidateEntry.source !== sourceEntry.source ||
      candidateEntry.sourceSha256 !== sourceEntry.sourceSha256
    ) {
      throw pipelineError(
        "LONG_TAIL_CANDIDATE_INVALID",
        `Candidate entry set drifted for ${pack.job.language}/${pack.job.namespace}.`,
      );
    }
    const value = candidateEntry.value;
    const failures = validateTranslationCandidateField({
      language: candidate.language,
      source: sourceEntry.source,
      value,
    }).failures;
    if (
      value !== value.normalize("NFC") ||
      !hasExactLongTailInvariantParity(sourceEntry.source, value) ||
      !isValidFieldTranslation(
        sourceEntry.source,
        value,
        candidate.language,
        sourceEntry.key,
      ) ||
      failures.length > 0
    ) {
      throw pipelineError(
        "LONG_TAIL_CANDIDATE_INVALID",
        `Candidate field failed strict preservation for ${pack.job.language}/${pack.job.namespace}/${sourceEntry.key}: ${failures.join(",") || "invariant-or-field-invalid"}.`,
      );
    }
    strings[sourceEntry.key] = value;
  }
  const source: TranslationSource = {
    namespace: pack.source.namespace,
    sourceHash: pack.source.sourceHash,
    sourceStrings: Object.fromEntries(
      pack.source.entries.map((entry) => [entry.key, entry.source]),
    ),
  };
  const bundle: TranslationBundle = {
    namespace: source.namespace,
    language: candidate.language,
    sourceHash: source.sourceHash,
    sourceStrings: source.sourceStrings,
    strings,
  };
  if (
    !isTranslationBundleFieldValid(source, bundle, candidate.language) ||
    !isTranslationBundleCompleteAndFluent(source, bundle, candidate.language)
  ) {
    throw pipelineError(
      "LONG_TAIL_CANDIDATE_INVALID",
      `Candidate pack failed complete fluent bundle validation for ${candidate.language}/${candidate.namespace}.`,
    );
  }
  const immutableCandidate = deepFreeze(candidate);
  const candidateSha256 = sha256Canonical(immutableCandidate);
  const provenanceMaterial = {
    kind: LONG_TAIL_TRANSLATION_CURATED_PROVENANCE_KIND,
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfileSha256:
      pack.provenance.executionProfile.executionProfileSha256,
    protectorVersion: LONG_TAIL_TRANSLATION_PROTECTOR_VERSION,
    protectorSha256: pack.provenance.protectorSha256,
    masterWorklistSha256: pack.masterWorklistSha256,
    packWorklistSha256: pack.packWorklistSha256,
    jobSha256: pack.job.jobSha256,
    sourceEntriesSha256: pack.job.sourceEntriesSha256,
    modelSha256: pack.provenance.modelSha256,
    pipelineImplementationSha256:
      pack.provenance.pipelineImplementationSha256,
    workerImplementationSha256:
      pack.provenance.workerImplementationSha256,
    validatorPolicySha256:
      pack.provenance.validatorPolicy.validatorPolicySha256,
    candidateSha256,
  } as const;
  const curatedPack = deepFreeze({
    schemaVersion: 1 as const,
    language: candidate.language,
    locale: languageConfigs[candidate.language].locale,
    namespace: candidate.namespace,
    sourceHash: candidate.sourceHash,
    model: candidate.modelLabel,
    provenance: {
      ...provenanceMaterial,
      provenanceSha256: sha256Canonical(provenanceMaterial),
    },
    translations: Object.fromEntries(
      candidate.entries.map((entry) => [entry.key, entry.value]),
    ),
  });
  return Object.freeze({
    candidate: immutableCandidate,
    candidateSha256,
    curatedPack,
  });
}

export function inspectLongTailCandidateRetryFailures(input: {
  pack: LongTailPackWorklist;
  values: Readonly<Record<string, string>>;
}) {
  const pack = parseLongTailPackWorklist(input.pack);
  const candidate = createLongTailCandidate({ pack, values: input.values });
  const failures: Array<Readonly<{
    key: string;
    reasons: readonly string[];
    fluencyReason: ReturnType<
      typeof inspectTranslationFieldFluency
    >["reason"];
  }>> = [];
  for (const [index, sourceEntry] of pack.source.entries.entries()) {
    const candidateEntry = candidate.entries[index];
    if (!candidateEntry) continue;
    const reasons = new Set<string>(
      validateTranslationCandidateField({
        language: candidate.language,
        source: sourceEntry.source,
        value: candidateEntry.value,
      }).failures,
    );
    if (!hasExactLongTailInvariantParity(sourceEntry.source, candidateEntry.value)) {
      reasons.add("invariant-parity");
    }
    if (!isValidFieldTranslation(
      sourceEntry.source,
      candidateEntry.value,
      candidate.language,
      sourceEntry.key,
    )) {
      reasons.add("field-invalid");
    }
    const fluency = inspectTranslationFieldFluency(
      sourceEntry.source,
      candidateEntry.value,
      candidate.language,
      {
        namespace: pack.source.namespace,
        sourceHash: pack.source.sourceHash,
        key: sourceEntry.key,
      },
    );
    if (!fluency.fluent) {
      reasons.add("field-fluency");
    }
    if (reasons.size) {
      failures.push(Object.freeze({
        key: sourceEntry.key,
        reasons: Object.freeze([...reasons].sort(compareCodePoints)),
        fluencyReason: fluency.reason,
      }));
    }
  }
  if (!failures.length) {
    try {
      validateLongTailCandidate(pack, candidate);
    } catch {
      for (const entry of candidate.entries) {
        failures.push(Object.freeze({
          key: entry.key,
          reasons: Object.freeze(["bundle-invalid"]),
          fluencyReason: null,
        }));
      }
    }
  }
  return Object.freeze(failures);
}

export function validateOrQuarantineLongTailCandidate(input: {
  pack: LongTailPackWorklist;
  candidatePath: string;
  candidateRoot: string;
  quarantineRoot: string;
}): ReturnType<typeof validateLongTailCandidate> {
  try {
    assertRegularUnlinkedFile(input.candidatePath, "candidate");
    return validateLongTailCandidate(
      input.pack,
      readBoundedJson(input.candidatePath),
    );
  } catch (error) {
    if (
      existsSync(input.candidatePath) &&
      lstatSync(input.candidatePath).isFile() &&
      !lstatSync(input.candidatePath).isSymbolicLink()
    ) {
      quarantineFile({
        file: input.candidatePath,
        sourceRoot: input.candidateRoot,
        quarantineRoot: input.quarantineRoot,
        reason: boundedError(error),
      });
    }
    if (error instanceof LongTailPipelineError) throw error;
    throw pipelineError(
      "LONG_TAIL_CANDIDATE_INVALID",
      `Malformed candidate was quarantined: ${boundedError(error)}`,
    );
  }
}

function quarantineFile(input: {
  file: string;
  sourceRoot: string;
  quarantineRoot: string;
  reason: string;
}) {
  const source = path.resolve(input.file);
  assertRegularUnlinkedFile(source, "candidate quarantine source");
  const relative = path.relative(path.resolve(input.sourceRoot), source);
  if (!isSafeRelativePath(relative)) {
    throw pipelineError(
      "LONG_TAIL_PATH_UNSAFE",
      "Candidate quarantine source escaped its exact root.",
    );
  }
  const bytes = readStableBoundedFile(
    source,
    MAXIMUM_JSON_BYTES,
    "candidate quarantine source",
  );
  const sha256 = sha256Buffer(bytes);
  const extension = path.extname(relative);
  const stem = extension ? relative.slice(0, -extension.length) : relative;
  const quarantined = resolveContainedPath(
    input.quarantineRoot,
    `${stem}.rejected-${sha256}${extension || ".json"}`,
    "quarantined candidate",
  );
  mkdirSync(path.dirname(quarantined), { recursive: true, mode: 0o700 });
  if (existsSync(quarantined)) {
    if (!readStableBoundedFile(
      quarantined,
      MAXIMUM_JSON_BYTES,
      "quarantined candidate",
    ).equals(bytes)) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        "Quarantine path contains conflicting bytes.",
      );
    }
    unlinkSync(source);
  } else {
    renameSync(source, quarantined);
  }
  const reasonPath = `${quarantined}.reason.json`;
  publishExactFile(
    reasonPath,
    prettyJsonBytes({
      schemaVersion: 1,
      kind: "inspir-long-tail-translation-rejection-v1",
      rejectedSha256: sha256,
      reason: input.reason.slice(0, 2_000),
    }),
  );
}

type ExactPublication = "created" | "exact-replay" | "replaced";

type LongTailCliOptions = Readonly<{
  execute: boolean;
  promote: boolean;
  stagedEnglishFallbackRelease: boolean;
  runtimeSmoke: boolean;
  replaceSourceStale: boolean;
  replaceQualityStale: boolean;
  runDirectory: string;
  modelDirectory: string;
  modelLabel: string;
  python: string;
  workerScript: string;
  historicalSeedSql?: string;
  legacySeedSalvagePath?: string;
  acceptedLegacySeedSalvagePath?: string;
  legacySeedSalvageAcceptancePath?: string;
  importCandidateRoot?: string;
  smokePacks?: number;
  smokeLocale?: string;
  promoteSmokeLocale?: "af";
  workers: number;
  expectedPacks: number;
  generationConfig: LongTailGenerationConfig;
}>;

const runtimeModelFiles = Object.freeze([
  "config.json",
  "generation_config.json",
  "pytorch_model.bin",
  "sentencepiece.bpe.model",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
]);

export function createLongTailWorkerPlan(input: {
  jobs: readonly LongTailTranslationJob[];
  requestedWorkers: number;
}): readonly Readonly<{
  workerIndex: number;
  workerCount: number;
  languages: readonly string[];
  jobSha256s: readonly string[];
}>[] {
  if (
    !Number.isSafeInteger(input.requestedWorkers) ||
    input.requestedWorkers < 1 ||
    input.requestedWorkers > MAXIMUM_WORKERS
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Worker count must be between 1 and ${MAXIMUM_WORKERS}.`,
    );
  }
  const languages = [...new Set(input.jobs.map((job) => job.language))]
    .sort(compareCodePoints);
  if (!languages.length) return Object.freeze([]);
  const workerCount = Math.min(input.requestedWorkers, languages.length);
  const languageSets = Array.from(
    { length: workerCount },
    () => new Set<string>(),
  );
  for (const [index, language] of languages.entries()) {
    languageSets[index % workerCount]?.add(language);
  }
  return Object.freeze(
    languageSets.map((languageSet, workerIndex) => {
      const assignedLanguages = [...languageSet].sort(compareCodePoints);
      return Object.freeze({
        workerIndex,
        workerCount,
        languages: Object.freeze(assignedLanguages),
        jobSha256s: Object.freeze(
          input.jobs
            .filter((job) => languageSet.has(job.language))
            .map((job) => job.jobSha256),
        ),
      });
    }),
  );
}

export function calculateLongTailWorkload(
  masterValue: LongTailMasterWorklist,
) {
  const master = parseLongTailMasterWorklist(masterValue);
  return calculateValidatedLongTailWorkload(master);
}

function calculateValidatedLongTailWorkload(master: LongTailMasterWorklist) {
  const sourceByNamespace = new Map(
    master.sources.map((source) => [source.namespace, source]),
  );
  const sourceLanguagePairs = new Set<string>();
  let packFields = 0;
  for (const job of master.jobs) {
    const source = sourceByNamespace.get(job.namespace);
    if (!source) {
      throw pipelineError(
        "LONG_TAIL_SOURCE_DRIFT",
        `Workload source is missing for ${job.namespace}.`,
      );
    }
    packFields += source.entries.length;
    for (const entry of source.entries) {
      sourceLanguagePairs.add(`${job.locale}\u0000${entry.sourceSha256}`);
    }
  }
  const generationOverridePairs = new Set(
    master.generationOverrides.entries.map(
      (entry) => `${entry.locale}\u0000${entry.sourceSha256}`,
    ),
  );
  const seededPairs = new Set(
    master.seedMemory.entries.flatMap((entry) => {
      const identity = `${entry.locale}\u0000${entry.sourceSha256}`;
      return generationOverridePairs.has(identity) ? [] : [identity];
    }),
  );
  let seededUniqueSourceLanguagePairs = 0;
  for (const identity of seededPairs) {
    if (sourceLanguagePairs.has(identity)) seededUniqueSourceLanguagePairs += 1;
  }
  return Object.freeze({
    packFields,
    uniqueSourceLanguagePairs: sourceLanguagePairs.size,
    seededUniqueSourceLanguagePairs,
    modelSourceLanguagePairs:
      sourceLanguagePairs.size - seededUniqueSourceLanguagePairs,
    rejectedSeedConflicts: master.seedMemory.conflicts.length,
  });
}

export function assertLongTailExecutionSeedReadiness(
  masterValue: LongTailMasterWorklist,
) {
  const master = parseLongTailMasterWorklist(masterValue);
  const sourceByNamespace = new Map(
    master.sources.map((source) => [source.namespace, source] as const),
  );
  const requiresAfrikaansProductCopySeed = master.jobs.some((job) => {
    if (job.language !== "Afrikaans") return false;
    return sourceByNamespace.get(job.namespace)?.entries.some(
      (entry) =>
        entry.sourceSha256 === afrikaansProductCopyHistoricalSourceSha256 &&
        entry.source === afrikaansProductCopyHistoricalSource,
    ) ?? false;
  });
  if (!requiresAfrikaansProductCopySeed) return;

  const exactSeed = master.seedMemory.entries.find(
    (entry) =>
      entry.language === "Afrikaans" &&
      entry.locale === "af" &&
      entry.sourceSha256 === afrikaansProductCopyHistoricalSourceSha256 &&
      entry.source === afrikaansProductCopyHistoricalSource,
  );
  if (!exactSeed) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Afrikaans product-copy execution requires its exact validated seed; supply the extractor-audited --historical-seed-sql consensus input before model execution.",
    );
  }
}

export async function hashLocalLongTailModelDirectory(
  modelDirectory: string,
) {
  const root = path.resolve(modelDirectory);
  const digest = createHash("sha256");
  digest.update("inspir-local-model-tree-v1\u0000");
  for (const relative of runtimeModelFiles) {
    const file = resolveContainedPath(root, relative, "local model file");
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Required local model artifact is not a regular file: ${relative}.`,
      );
    }
    digest.update(`${relative}\u0000${metadata.size}\u0000`);
    await streamFileIntoHash(file, digest);
    digest.update("\u0000");
  }
  return digest.digest("hex");
}

export async function createLongTailPipelineProvenance(input: {
  repoRoot: string;
  modelDirectory: string;
  modelLabel: string;
  workerScript: string;
  seedMemory: LongTailSeedMemory;
  generationConfig: LongTailGenerationConfig;
}): Promise<LongTailPipelineProvenance> {
  const repoRoot = path.resolve(input.repoRoot);
  const pipelineFile = path.join(
    repoRoot,
    "scripts/generate-long-tail-translations.ts",
  );
  const workerFile = path.resolve(input.workerScript);
  for (const [label, file] of [
    ["pipeline", pipelineFile],
    ["worker", workerFile],
  ] as const) {
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `The ${label} implementation must be a regular local file.`,
      );
    }
  }
  const [modelSha256, pipelineImplementationSha256, workerImplementationSha256] =
    await Promise.all([
      hashLocalLongTailModelDirectory(input.modelDirectory),
      hashFile(pipelineFile),
      hashFile(workerFile),
    ]);
  const validatorPolicy = createLongTailValidatorPolicyProvenance(repoRoot);
  const generationConfig = parseSchema(
    generationConfigSchema,
    input.generationConfig,
    "generation configuration",
  );
  const seedMemory = parseLongTailSeedMemory(input.seedMemory);
  const generationOverrides = createLongTailGenerationOverrides(seedMemory);
  return deepFreeze(
    parseSchema(provenanceSchema, {
      pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
      executionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
      protectorVersion: LONG_TAIL_TRANSLATION_PROTECTOR_VERSION,
      protectorSha256: sha256Canonical(
        protectedPatterns.map(({ pattern, priority }) => ({
          source: pattern.source,
          flags: pattern.flags,
          priority,
        })),
      ),
      pipelineImplementationSha256,
      workerImplementationSha256,
      validatorPolicy,
      modelLabel: input.modelLabel,
      modelSha256,
      seedMemorySha256: seedMemory.seedMemorySha256,
      seedMemoryEntries: seedMemory.entries.length,
      seedMemoryConflicts: seedMemory.conflicts.length,
      generationOverridesSha256:
        generationOverrides.generationOverridesSha256,
      generationOverrideEntries: generationOverrides.entries.length,
      generationConfig,
    }, "long-tail provenance"),
  );
}

export function rebindLongTailPipelineProvenanceSeedMemory(input: {
  provenance: LongTailPipelineProvenance;
  seedMemory: LongTailSeedMemory;
}): LongTailPipelineProvenance {
  const provenance = parseSchema(
    provenanceSchema,
    input.provenance,
    "long-tail provenance",
  );
  const seedMemory = parseLongTailSeedMemory(input.seedMemory);
  const generationOverrides = createLongTailGenerationOverrides(seedMemory);
  return deepFreeze(parseSchema(provenanceSchema, {
    ...provenance,
    seedMemorySha256: seedMemory.seedMemorySha256,
    seedMemoryEntries: seedMemory.entries.length,
    seedMemoryConflicts: seedMemory.conflicts.length,
    generationOverridesSha256:
      generationOverrides.generationOverridesSha256,
    generationOverrideEntries: generationOverrides.entries.length,
  }, "rebound long-tail provenance"));
}

function assertBoundLongTailValidatorPolicy(
  repoRoot: string,
  provenance: LongTailPipelineProvenance,
) {
  try {
    assertCurrentLongTailValidatorPolicy(
      repoRoot,
      provenance.validatorPolicy,
    );
  } catch (error) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      `Translation validator policy drifted: ${boundedError(error)}`,
    );
  }
}

function publishExactFile(
  file: string,
  bytes: Buffer,
  options: Readonly<{
    expectedExistingSha256?: string;
    maximumExistingBytes?: number;
    overwriteBackupRoot?: string;
    overwriteSourceRoot?: string;
  }> = {},
): ExactPublication {
  const maximumExistingBytes =
    options.maximumExistingBytes ?? MAXIMUM_JSON_BYTES;
  if (
    !Number.isSafeInteger(maximumExistingBytes) ||
    maximumExistingBytes < 0 ||
    maximumExistingBytes > MAXIMUM_MASTER_WORKLIST_BYTES
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Publication target byte bound is invalid.",
    );
  }
  const target = path.resolve(file);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (existsSync(target)) {
    assertRegularUnlinkedFile(target, "publication target");
    const currentBytes = readStableBoundedFile(
      target,
      maximumExistingBytes,
      "publication target",
    );
    if (currentBytes.equals(bytes)) return "exact-replay";
    if (
      !options.expectedExistingSha256 ||
      sha256Buffer(currentBytes) !== options.expectedExistingSha256
    ) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `Refusing to replace ${target} because its exact prior bytes are not approved.`,
      );
    }
  } else if (options.expectedExistingSha256) {
    throw pipelineError(
      "LONG_TAIL_CONFLICT",
      `Approved replacement target disappeared before publication: ${target}.`,
    );
  }
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (!existsSync(target)) {
      if (options.expectedExistingSha256) {
        throw pipelineError(
          "LONG_TAIL_CONFLICT",
          `Approved replacement target disappeared during publication: ${target}.`,
        );
      }
      try {
        linkSync(temporary, target);
        unlinkSync(temporary);
        fsyncDirectory(path.dirname(target));
        return "created";
      } catch (error) {
        if (
          existsSync(target) &&
          readStableBoundedFile(
            target,
            maximumExistingBytes,
            "concurrent publication target",
          ).equals(bytes)
        ) {
          rmSync(temporary, { force: true });
          return "exact-replay";
        }
        throw error;
      }
    }
    if (readStableBoundedFile(
      target,
      maximumExistingBytes,
      "publication target replay",
    ).equals(bytes)) {
      unlinkSync(temporary);
      return "exact-replay";
    }
    if (!options.expectedExistingSha256) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `Refusing to replace concurrently changed file ${target}.`,
      );
    }
    if (!options.overwriteBackupRoot || !options.overwriteSourceRoot) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        "Explicit overwrite requires an immutable backup root and source root.",
      );
    }
    const relative = path.relative(
      path.resolve(options.overwriteSourceRoot),
      target,
    );
    if (!isSafeRelativePath(relative)) {
      throw pipelineError(
        "LONG_TAIL_PATH_UNSAFE",
        "Overwrite target escaped its declared source root.",
      );
    }
    const priorBytes = readStableBoundedFile(
      target,
      maximumExistingBytes,
      "approved replacement target",
    );
    if (sha256Buffer(priorBytes) !== options.expectedExistingSha256) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `Approved replacement target changed before publication: ${target}.`,
      );
    }
    const extension = path.extname(relative);
    const stem = extension ? relative.slice(0, -extension.length) : relative;
    const backup = resolveContainedPath(
      options.overwriteBackupRoot,
      `${stem}.overwritten-${sha256Buffer(priorBytes)}${extension || ".json"}`,
      "overwritten translation backup",
    );
    publishExactFile(backup, priorBytes);
    if (
      !existsSync(target) ||
      sha256Buffer(readStableBoundedFile(
        target,
        maximumExistingBytes,
        "approved replacement target after backup",
      )) !== options.expectedExistingSha256
    ) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `Approved replacement target changed while its backup was published: ${target}.`,
      );
    }
    renameSync(temporary, target);
    fsyncDirectory(path.dirname(target));
    return "replaced";
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function assertRegularUnlinkedFile(file: string, label: string) {
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1
  ) {
    throw pipelineError(
      "LONG_TAIL_PATH_UNSAFE",
      `${label} must be a regular non-symlink, non-hardlinked file.`,
    );
  }
}

export function publishExactLongTailFileForTest(input: Readonly<{
  file: string;
  bytes: Buffer;
  maximumExistingBytes?: number;
}>) {
  return publishExactFile(
    input.file,
    input.bytes,
    input.maximumExistingBytes === undefined
      ? {}
      : { maximumExistingBytes: input.maximumExistingBytes },
  );
}

function fsyncDirectory(directory: string) {
  const descriptor = openSync(directory, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function resolveContainedPath(root: string, relative: string, label: string) {
  if (!isSafeRelativePath(relative)) {
    throw pipelineError(
      "LONG_TAIL_PATH_UNSAFE",
      `${label} uses an unsafe relative path: ${relative}.`,
    );
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw pipelineError(
      "LONG_TAIL_PATH_UNSAFE",
      `${label} escaped its declared root.`,
    );
  }
  let cursor = resolvedRoot;
  for (const segment of relative.split("/")) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw pipelineError(
        "LONG_TAIL_PATH_UNSAFE",
        `${label} root contains a symbolic link.`,
      );
    }
    cursor = path.join(cursor, segment);
  }
  if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
    throw pipelineError(
      "LONG_TAIL_PATH_UNSAFE",
      `${label} target is a symbolic link.`,
    );
  }
  return resolved;
}

function isSafeRelativePath(value: string) {
  if (
    !value ||
    value.includes("\u0000") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value
  ) {
    return false;
  }
  return value.split("/").every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function packRelativePath(locale: string, namespace: string) {
  return `${locale}/${fileSafeNamespace(namespace)}.json`;
}

function fileSafeNamespace(namespace: string) {
  const safe = namespace.replace(/[^a-z0-9.-]+/gi, "__");
  if (!safe || safe === "." || safe === "..") {
    throw pipelineError(
      "LONG_TAIL_PATH_UNSAFE",
      `Namespace cannot produce a safe curated filename: ${namespace}.`,
    );
  }
  return safe;
}

function readBoundedJson(
  file: string,
  maximumBytes = MAXIMUM_JSON_BYTES,
): unknown {
  return readStableBoundedJsonFile(file, maximumBytes).value;
}

export type LongTailStableReadFaultPoint =
  | "after-open-before-read"
  | "after-read-before-final-identity";

export function readStableBoundedLongTailJson(input: Readonly<{
  file: string;
  maximumBytes?: number;
  raceHook?: (point: LongTailStableReadFaultPoint) => void;
}>): unknown {
  return readStableBoundedJsonFile(
    input.file,
    input.maximumBytes ?? MAXIMUM_JSON_BYTES,
    input.raceHook,
  ).value;
}

function readStableBoundedJsonFile(
  file: string,
  maximumBytes: number,
  raceHook?: (point: LongTailStableReadFaultPoint) => void,
): Readonly<{ value: unknown; bytes: Buffer }> {
  const bytes = readStableBoundedFile(
    file,
    maximumBytes,
    "JSON input",
    raceHook,
  );
  return Object.freeze({
    value: parseStrictTranslationSemanticJsonBytes(
      bytes,
      `Long-tail JSON input at ${file}`,
    ),
    bytes,
  });
}

function readStableBoundedFile(
  file: string,
  maximumBytes: number,
  label: string,
  raceHook?: (point: LongTailStableReadFaultPoint) => void,
): Buffer {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `${label} byte bound is invalid.`,
    );
  }
  assertNoSymlinkFileComponents(file, label);
  const pathBefore = lstatSync(file, { bigint: true });
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.nlink !== BigInt(1) ||
    pathBefore.size > BigInt(maximumBytes)
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `${label} must be a bounded single-link regular file: ${file}.`,
    );
  }
  const descriptor = openSync(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== BigInt(1) ||
      before.size > BigInt(maximumBytes) ||
      !sameStableBoundedFileIdentity(pathBefore, before)
    ) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `${label} changed while it was opened: ${file}.`,
      );
    }
    raceHook?.("after-open-before-read");
    const expectedBytes = Number(before.size);
    const bytes = Buffer.allocUnsafe(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        expectedBytes - offset,
        null,
      );
      if (count === 0) {
        throw pipelineError(
          "LONG_TAIL_CONFLICT",
          `${label} was truncated while it was read: ${file}.`,
        );
      }
      offset += count;
    }
    const growthProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, growthProbe, 0, 1, null) !== 0) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `${label} grew while it was read: ${file}.`,
      );
    }
    raceHook?.("after-read-before-final-identity");
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(file, { bigint: true });
    assertNoSymlinkFileComponents(file, label);
    if (
      !sameStableBoundedFileIdentity(before, after) ||
      !sameStableBoundedFileIdentity(after, pathAfter) ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `${label} changed while it was read: ${file}.`,
      );
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function assertNoSymlinkFileComponents(file: string, label: string): void {
  const resolved = path.resolve(file);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const segment of resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) {
      throw pipelineError(
        "LONG_TAIL_PATH_UNSAFE",
        `${label} contains a symbolic-link component: ${cursor}.`,
      );
    }
  }
}

function sameStableBoundedFileIdentity(
  first: BigIntStats,
  second: BigIntStats,
): boolean {
  return first.isFile() && second.isFile() &&
    first.nlink === BigInt(1) && second.nlink === BigInt(1) &&
    first.dev === second.dev && first.ino === second.ino &&
    first.size === second.size && first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs && first.mode === second.mode &&
    first.uid === second.uid;
}

function prettyJsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        "Canonical JSON cannot contain non-finite numbers.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isUnknownRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw pipelineError(
    "LONG_TAIL_CONTRACT_INVALID",
    `Canonical JSON cannot encode ${typeof value}.`,
  );
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Canonical(value: unknown) {
  return sha256Text(canonicalJson(value));
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha1Text(value: string) {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

function sha256Buffer(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(file: string) {
  const digest = createHash("sha256");
  return streamFileIntoHash(file, digest).then(() => digest.digest("hex"));
}

function streamFileIntoHash(
  file: string,
  digest: ReturnType<typeof createHash>,
) {
  return new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `${label} is malformed: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

function assertUnique(values: readonly string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Duplicate ${label}: ${value}.`,
      );
    }
    seen.add(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
  } else if (isUnknownRecord(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    Object.freeze(value);
  }
  return value;
}

function compareCodePoints(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function boundedError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 2_000);
  if (typeof error === "string") return error.slice(0, 2_000);
  return "Unknown long-tail pipeline error.";
}

function pipelineError(
  code: LongTailPipelineErrorCode,
  message: string,
) {
  return new LongTailPipelineError(code, message);
}

export function parseLongTailCliOptions(
  argv: readonly string[],
): LongTailCliOptions {
  const booleanNames = new Set([
    "--execute",
    "--promote",
    "--staged-english-fallback-release",
    "--runtime-smoke",
    "--replace-source-stale",
    "--replace-quality-stale",
  ]);
  const valueNames = new Set([
    "--run-dir",
    "--model",
    "--model-label",
    "--python",
    "--worker-script",
    "--historical-seed-sql",
    "--legacy-seed-salvage",
    "--accepted-legacy-seed-salvage",
    "--legacy-seed-salvage-acceptance",
    "--import-candidate-root",
    "--smoke-packs",
    "--smoke-locale",
    "--promote-smoke-locale",
    "--workers",
    "--expected-packs",
    "--batch-size",
    "--num-beams",
    "--no-repeat-ngram-size",
    "--max-source-tokens",
    "--max-new-tokens",
    "--max-retry-attempts",
    "--dtype",
    "--device",
  ]);
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;
    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument : argument.slice(0, separator);
    if (booleanNames.has(name)) {
      if (separator !== -1 || flags.has(name)) {
        throw pipelineError(
          "LONG_TAIL_CONTRACT_INVALID",
          `Flag ${name} must appear once without a value.`,
        );
      }
      flags.add(name);
      continue;
    }
    if (!valueNames.has(name)) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Unknown long-tail pipeline option: ${argument}.`,
      );
    }
    if (values.has(name)) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Option ${name} may only appear once.`,
      );
    }
    const value = separator === -1 ? argv[index + 1] : argument.slice(separator + 1);
    if (!value || (separator === -1 && value.startsWith("--"))) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `Option ${name} requires a value.`,
      );
    }
    values.set(name, value);
    if (separator === -1) index += 1;
  }
  const integer = (name: string, fallback: number) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `${name} must be a non-negative decimal integer.`,
      );
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        `${name} exceeds the safe integer range.`,
      );
    }
    return parsed;
  };
  const generationConfig = parseSchema(generationConfigSchema, {
    batchSize: integer("--batch-size", 16),
    numBeams: integer("--num-beams", 1),
    noRepeatNgramSize: integer("--no-repeat-ngram-size", 4),
    dtype: values.get("--dtype") ?? "float16",
    device: values.get("--device") ?? "mps",
    maxSourceTokens: integer("--max-source-tokens", 512),
    maxNewTokens: integer("--max-new-tokens", 512),
    maxRetryAttempts: integer("--max-retry-attempts", 2),
    deterministicAlgorithms: true,
    manualSeed: 0,
  }, "generation configuration");
  const workers = integer("--workers", 1);
  const execute = flags.has("--execute");
  const explicitFullPromote = flags.has("--promote");
  const stagedEnglishFallbackRelease = flags.has(
    "--staged-english-fallback-release",
  );
  const promote = explicitFullPromote || stagedEnglishFallbackRelease;
  const runtimeSmoke = flags.has("--runtime-smoke");
  const replaceSourceStale = flags.has("--replace-source-stale");
  const replaceQualityStale = flags.has("--replace-quality-stale");
  const legacySeedSalvageRequested = values.has("--legacy-seed-salvage");
  const acceptedLegacySeedSalvageRequested = values.has(
    "--accepted-legacy-seed-salvage",
  );
  const legacySeedSalvageAcceptanceRequested = values.has(
    "--legacy-seed-salvage-acceptance",
  );
  if (
    legacySeedSalvageRequested &&
    (
      execute ||
      promote ||
      runtimeSmoke ||
      acceptedLegacySeedSalvageRequested ||
      legacySeedSalvageAcceptanceRequested ||
      values.has("--import-candidate-root") ||
      values.has("--smoke-packs") ||
      values.has("--smoke-locale")
    )
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "--legacy-seed-salvage is a diagnostic-only dry-run input and cannot be combined with execution, promotion, runtime smoke, candidate generation smoke, or candidate import.",
    );
  }
  if (
    acceptedLegacySeedSalvageRequested !==
      legacySeedSalvageAcceptanceRequested
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "--accepted-legacy-seed-salvage and --legacy-seed-salvage-acceptance must be supplied together.",
    );
  }
  if (
    acceptedLegacySeedSalvageRequested &&
    (!execute || runtimeSmoke || legacySeedSalvageRequested)
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Accepted legacy seed salvage requires --execute, forbids --runtime-smoke, and is distinct from the diagnostic-only --legacy-seed-salvage path.",
    );
  }
  if (promote && !execute) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "--promote requires --execute; dry-run mode never writes.",
    );
  }
  if (
    runtimeSmoke &&
    (
      execute ||
      promote ||
      replaceSourceStale ||
      replaceQualityStale ||
      values.has("--run-dir") ||
      values.has("--historical-seed-sql") ||
      values.has("--legacy-seed-salvage") ||
      values.has("--accepted-legacy-seed-salvage") ||
      values.has("--legacy-seed-salvage-acceptance") ||
      values.has("--import-candidate-root") ||
      values.has("--smoke-packs") ||
      values.has("--smoke-locale") ||
      values.has("--expected-packs")
    )
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "--runtime-smoke is a read-only standalone gate and cannot be combined with execution, promotion, inventory, replacement, import, or smoke-run options.",
    );
  }
  if (workers < 1 || workers > MAXIMUM_WORKERS) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `--workers must be between 1 and ${MAXIMUM_WORKERS}.`,
    );
  }
  if (workers > 1 && generationConfig.device !== "cpu") {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Multiple model workers require explicit --device=cpu; MPS uses one resident model to avoid memory exhaustion.",
    );
  }
  if (
    generationConfig.device === "cpu" &&
    generationConfig.dtype !== "float32"
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "CPU generation requires --dtype=float32 so provenance matches execution.",
    );
  }
  const expectedPacks = integer("--expected-packs", EXPECTED_PRODUCTION_PACKS);
  if (expectedPacks < 1) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "--expected-packs must be positive.",
    );
  }
  const smokePacks = values.has("--smoke-packs")
    ? integer("--smoke-packs", 0)
    : undefined;
  const smokeLocale = values.get("--smoke-locale");
  const promoteSmokeLocale = values.get("--promote-smoke-locale");
  if (
    [
      smokePacks !== undefined,
      smokeLocale !== undefined,
      promoteSmokeLocale !== undefined,
    ].filter(Boolean).length > 1
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "--smoke-packs, --smoke-locale, and --promote-smoke-locale are mutually exclusive.",
    );
  }
  if (smokeLocale !== undefined) {
    const exactLocale = supportedLanguages.some((language) =>
      language !== defaultLanguage &&
      (languageConfigs[language].prefix || languageConfigs[language].locale) ===
        smokeLocale
    );
    if (!/^[a-z]{2,3}$/.test(smokeLocale) || !exactLocale) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        "--smoke-locale must be one exact supported non-English locale.",
      );
    }
  }
  if (smokePacks !== undefined || smokeLocale !== undefined) {
    if (
      !execute ||
      promote ||
      values.has("--import-candidate-root") ||
      (smokePacks !== undefined &&
        (smokePacks < 1 || smokePacks > 10))
    ) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        "Smoke execution requires --execute, forbids promotion/import, and pack smoke must be between 1 and 10.",
      );
    }
  }
  if (
    stagedEnglishFallbackRelease !== (promoteSmokeLocale !== undefined) ||
    explicitFullPromote && stagedEnglishFallbackRelease
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "--promote-smoke-locale and --staged-english-fallback-release must be supplied together and cannot be combined with --promote.",
    );
  }
  if (promoteSmokeLocale !== undefined) {
    if (
      promoteSmokeLocale !== "af" ||
      !execute ||
      values.has("--import-candidate-root") ||
      values.has("--expected-packs") ||
      workers !== 1
    ) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        "Staged fallback promotion requires --execute --promote-smoke-locale af --staged-english-fallback-release with exactly one worker, and forbids candidate import or an --expected-packs override.",
      );
    }
  }
  const runDirectory = values.get("--run-dir") ??
    (smokePacks === undefined && smokeLocale === undefined &&
        promoteSmokeLocale === undefined
      ? DEFAULT_RUN_DIRECTORY
      : smokeLocale || promoteSmokeLocale
        ? `tmp/long-tail-translation-smoke-${
          smokeLocale ?? promoteSmokeLocale
        }-v10`
        : "tmp/long-tail-translation-smoke-source-stale-v10");
  try {
    assertCurrentLongTailReleaseRunRoot(runDirectory);
  } catch (error) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      boundedError(error),
    );
  }
  return Object.freeze({
    execute,
    promote,
    stagedEnglishFallbackRelease,
    runtimeSmoke,
    replaceSourceStale,
    replaceQualityStale,
    runDirectory,
    modelDirectory: values.get("--model") ?? DEFAULT_MODEL_DIRECTORY,
    modelLabel: values.get("--model-label") ?? DEFAULT_MODEL_LABEL,
    python: values.get("--python") ?? DEFAULT_PYTHON,
    workerScript: values.get("--worker-script") ?? DEFAULT_WORKER_SCRIPT,
    historicalSeedSql: values.get("--historical-seed-sql"),
    legacySeedSalvagePath: values.get("--legacy-seed-salvage"),
    acceptedLegacySeedSalvagePath: values.get(
      "--accepted-legacy-seed-salvage",
    ),
    legacySeedSalvageAcceptancePath: values.get(
      "--legacy-seed-salvage-acceptance",
    ),
    importCandidateRoot: values.get("--import-candidate-root"),
    smokePacks,
    smokeLocale,
    ...(promoteSmokeLocale === "af"
      ? { promoteSmokeLocale }
      : {}),
    workers,
    expectedPacks,
    generationConfig,
  });
}

function assertSafeExecutionPaths(input: {
  repoRoot: string;
  runDirectory: string;
  curatedRoot: string;
}) {
  const repoRoot = path.resolve(input.repoRoot);
  const temporaryRoot = path.join(repoRoot, "tmp");
  const runDirectory = path.resolve(input.runDirectory);
  if (!runDirectory.startsWith(`${temporaryRoot}${path.sep}`)) {
    throw pipelineError(
      "LONG_TAIL_PATH_UNSAFE",
      `Execution run directory must be a child of ${temporaryRoot}.`,
    );
  }
  const curatedRoot = path.resolve(input.curatedRoot);
  const expectedCuratedRoot = path.join(repoRoot, "translations/curated");
  if (curatedRoot !== expectedCuratedRoot) {
    throw pipelineError(
      "LONG_TAIL_PATH_UNSAFE",
      "Production promotion root is not the repository curated directory.",
    );
  }
  assertExistingPathComponentsAreNotSymlinks(repoRoot);
  assertExistingPathComponentsAreNotSymlinks(runDirectory);
  assertExistingPathComponentsAreNotSymlinks(curatedRoot);
}

function assertExistingPathComponentsAreNotSymlinks(target: string) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    if (!existsSync(cursor)) continue;
    if (lstatSync(cursor).isSymbolicLink()) {
      throw pipelineError(
        "LONG_TAIL_PATH_UNSAFE",
        `Execution path contains a symbolic link: ${cursor}.`,
      );
    }
  }
}

function selectResumableMaster(input: {
  current: LongTailWorklistBuildResult;
  runDirectory: string;
  provenance: LongTailPipelineProvenance;
}) {
  const persistedPath = path.join(path.resolve(input.runDirectory), "worklist.json");
  if (!existsSync(persistedPath)) return input.current.worklist;
  const persisted = parseLongTailMasterWorklist(
    readBoundedJson(persistedPath, MAXIMUM_MASTER_WORKLIST_BYTES),
  );
  if (
    canonicalJson(persisted.provenance) !== canonicalJson(input.provenance) ||
    canonicalJson(persisted.sources) !== canonicalJson(input.current.worklist.sources)
  ) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      "The persisted run is bound to different source, model, or implementation bytes; use a new run directory.",
    );
  }
  const persistedTargets = new Set(
    persisted.jobs.map((job) => job.targetRelativePath),
  );
  const untrackedMissing = input.current.worklist.jobs.find(
    (job) => !persistedTargets.has(job.targetRelativePath),
  );
  if (untrackedMissing) {
    throw pipelineError(
      "LONG_TAIL_SOURCE_DRIFT",
      `Persisted run does not cover currently missing pack ${untrackedMissing.targetRelativePath}.`,
    );
  }
  return persisted;
}

export function classifyLongTailProductionInventoryState(input: {
  missingPacks: number;
  sourceStalePacks: number;
  qualityStalePacks: number;
  completedPacks: number;
  totalPacks: number;
  missingTargetLanguages: number;
  missingTargetNamespaces: number;
}):
  | "original-gap"
  | "source-stale-gap"
  | "repair-gap"
  | "fully-complete"
  | "unexpected" {
  const exactAccounting =
    input.totalPacks === EXPECTED_PRODUCTION_TOTAL_PACKS &&
    input.missingPacks + input.sourceStalePacks + input.qualityStalePacks +
      input.completedPacks === input.totalPacks;
  if (
    exactAccounting &&
    input.missingPacks === EXPECTED_PRODUCTION_PACKS &&
    input.completedPacks === EXPECTED_PRODUCTION_COMPLETED_BASELINE_PACKS &&
    input.sourceStalePacks === 0 &&
    input.qualityStalePacks === 0 &&
    input.missingTargetLanguages === EXPECTED_PRODUCTION_LANGUAGES &&
    input.missingTargetNamespaces === EXPECTED_PRODUCTION_NAMESPACES
  ) {
    return "original-gap";
  }
  if (
    exactAccounting &&
    input.missingPacks === EXPECTED_PRODUCTION_PACKS &&
    input.sourceStalePacks > 0 &&
    input.qualityStalePacks === 0 &&
    input.missingTargetLanguages === EXPECTED_PRODUCTION_LANGUAGES &&
    input.missingTargetNamespaces === EXPECTED_PRODUCTION_NAMESPACES
  ) {
    return "source-stale-gap";
  }
  if (
    exactAccounting &&
    input.missingPacks === EXPECTED_PRODUCTION_PACKS &&
    input.sourceStalePacks === EXPECTED_PRODUCTION_SOURCE_STALE_PACKS &&
    input.qualityStalePacks === EXPECTED_PRODUCTION_QUALITY_STALE_PACKS &&
    input.completedPacks ===
      EXPECTED_PRODUCTION_REPAIR_BASELINE_COMPLETED_PACKS &&
    input.missingTargetLanguages === EXPECTED_PRODUCTION_LANGUAGES &&
    input.missingTargetNamespaces === EXPECTED_PRODUCTION_NAMESPACES
  ) {
    return "repair-gap";
  }
  if (
    exactAccounting &&
    input.missingPacks === 0 &&
    input.sourceStalePacks === 0 &&
    input.qualityStalePacks === 0 &&
    input.completedPacks === EXPECTED_PRODUCTION_TOTAL_PACKS &&
    input.missingTargetLanguages === 0 &&
    input.missingTargetNamespaces === 0
  ) {
    return "fully-complete";
  }
  return "unexpected";
}

function assertExpectedProductionMatrix(input: {
  master: LongTailMasterWorklist;
  current: LongTailWorklistBuildResult;
  expectedPacks: number;
  strictProductionShape: boolean;
  hasPersistedMaster: boolean;
}) {
  const { master } = input;
  const missingJobs = master.jobs.filter((job) => !job.replacement);
  const replacementJobs = master.jobs.filter((job) => job.replacement);
  const missingLanguages = new Set(missingJobs.map((job) => job.language));
  const missingNamespaces = new Set(missingJobs.map((job) => job.namespace));
  const productionState = classifyLongTailProductionInventoryState({
    missingPacks: input.current.missingPacks,
    sourceStalePacks: input.current.sourceStalePacks,
    qualityStalePacks: input.current.qualityStalePacks,
    completedPacks: input.current.completedPacks,
    totalPacks: input.current.totalPacks,
    missingTargetLanguages: input.current.missingTargetLanguages.length,
    missingTargetNamespaces: input.current.missingTargetNamespaces.length,
  });
  if (
    !input.hasPersistedMaster &&
    input.strictProductionShape &&
    productionState === "fully-complete"
  ) {
    return;
  }
  if (
    missingJobs.length !== input.expectedPacks ||
    master.jobs.length !== input.expectedPacks + replacementJobs.length
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Expected ${input.expectedPacks} physically missing translation packs plus exact approved replacements; found ${missingJobs.length} missing and ${replacementJobs.length} replacements.`,
    );
  }
  if (
    input.strictProductionShape &&
    (input.current.totalPacks !==
        EXPECTED_PRODUCTION_TOTAL_LANGUAGES *
          EXPECTED_PRODUCTION_TOTAL_NAMESPACES ||
      (!input.hasPersistedMaster &&
        productionState !== "original-gap" &&
        productionState !== "source-stale-gap" &&
        productionState !== "repair-gap") ||
      missingLanguages.size !== EXPECTED_PRODUCTION_LANGUAGES ||
      missingNamespaces.size !== EXPECTED_PRODUCTION_NAMESPACES)
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Expected an exact ${EXPECTED_PRODUCTION_TOTAL_LANGUAGES} × ${EXPECTED_PRODUCTION_TOTAL_NAMESPACES} inventory with a separate ${EXPECTED_PRODUCTION_LANGUAGES} × ${EXPECTED_PRODUCTION_NAMESPACES} physically missing long-tail gap.`,
    );
  }
  for (const job of replacementJobs) {
    assertReplacementJobApproved({
      job,
      approvals: PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
      validatorPolicySha256:
        master.provenance.validatorPolicy.validatorPolicySha256,
    });
  }
}

function runLongTailWorker(input: {
  repoRoot: string;
  python: string;
  workerScript: string;
  pipelineScript: string;
  node: string;
  modelDirectory: string;
  masterPath: string;
  worklistRoot: string;
  candidateRoot: string;
  workerIndex: number;
  workerCount: number;
  provenance: LongTailPipelineProvenance;
}) {
  assertBoundLongTailValidatorPolicy(input.repoRoot, input.provenance);
  const config = input.provenance.generationConfig;
  const args = [
    input.workerScript,
    "--master-worklist",
    input.masterPath,
    "--worklist-root",
    input.worklistRoot,
    "--candidate-root",
    input.candidateRoot,
    "--model",
    input.modelDirectory,
    "--model-sha256",
    input.provenance.modelSha256,
    "--worker-implementation-sha256",
    input.provenance.workerImplementationSha256,
    "--pipeline-script",
    input.pipelineScript,
    "--pipeline-implementation-sha256",
    input.provenance.pipelineImplementationSha256,
    "--validator-policy-sha256",
    input.provenance.validatorPolicy.validatorPolicySha256,
    "--execution-profile-json",
    JSON.stringify(input.provenance.executionProfile),
    "--execution-profile-sha256",
    input.provenance.executionProfile.executionProfileSha256,
    "--node",
    input.node,
    "--worker-index",
    String(input.workerIndex),
    "--worker-count",
    String(input.workerCount),
    "--batch-size",
    String(config.batchSize),
    "--num-beams",
    String(config.numBeams),
    "--no-repeat-ngram-size",
    String(config.noRepeatNgramSize),
    "--dtype",
    config.dtype,
    "--device",
    config.device,
    "--max-source-tokens",
    String(config.maxSourceTokens),
    "--max-new-tokens",
    String(config.maxNewTokens),
    "--max-retry-attempts",
    String(config.maxRetryAttempts),
  ];
  return new Promise<void>((resolve, reject) => {
    const child = spawn(input.python, args, {
      cwd: input.repoRoot,
      env: createLongTailWorkerEnvironment(input.provenance.executionProfile),
      shell: false,
      stdio: "inherit",
    });
    child.once("error", (error) => reject(
      pipelineError(
        "LONG_TAIL_WORKER_FAILED",
        `Could not start local model worker ${input.workerIndex}: ${boundedError(error)}`,
      ),
    ));
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(
        pipelineError(
          "LONG_TAIL_WORKER_FAILED",
          `Local model worker ${input.workerIndex} exited with ${code ?? signal ?? "unknown status"}.`,
        ),
      );
    });
  });
}

export function createLongTailWorkerEnvironment(
  executionProfileValue: LongTailNllbExecutionProfile,
  parentEnvironment: Partial<NodeJS.ProcessEnv> = process.env,
): NodeJS.ProcessEnv {
  const executionProfile = parseLongTailNllbExecutionProfile(
    executionProfileValue,
  );
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: parentEnvironment.NODE_ENV ?? "production",
  };
  for (const key of localModelEnvironmentPassthroughKeys) {
    const value = parentEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  return {
    ...environment,
    HF_DATASETS_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    HF_HUB_OFFLINE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONHASHSEED: "0",
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    TOKENIZERS_PARALLELISM: "false",
    TRANSFORMERS_OFFLINE: "1",
    ...executionProfile.environment,
  };
}

const LONG_TAIL_WORKER_RUNTIME_PREFLIGHT_SOURCE = String.raw`
import hashlib
import importlib
import importlib.metadata
import json
import os
import platform
import site
import sys
from pathlib import Path

config = json.loads(sys.argv[1])
expected_keys = {
    "deterministicAlgorithms",
    "device",
    "dtype",
    "executionProfile",
    "executionProfileSha256",
    "modelDirectory",
    "modelSmoke",
    "manualSeed",
    "sitePackages",
}
if set(config) != expected_keys:
    raise RuntimeError("Runtime preflight configuration is malformed")
if config["deterministicAlgorithms"] is not True or config["manualSeed"] != 0:
    raise RuntimeError("Runtime preflight deterministic configuration is invalid")

expected_profile_material = {
    "schemaVersion": 2,
    "kind": "inspir-long-tail-local-nllb-execution-profile-v2",
    "pipelineVersion": "inspir-long-tail-local-nllb-v5",
    "environment": {
        "MKL_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "PYTORCH_ENABLE_MPS_FALLBACK": "0",
        "VECLIB_MAXIMUM_THREADS": "1",
    },
    "torch": {
        "interopThreads": 1,
        "intraopThreads": 1,
    },
    "terminalRescue": {
        "device": "cpu",
        "dtype": "float32",
        "independentDecodes": 2,
        "deterministicAlgorithms": True,
    },
}
expected_profile_sha256 = hashlib.sha256(
    json.dumps(
        expected_profile_material,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
).hexdigest()
expected_profile = {
    **expected_profile_material,
    "executionProfileSha256": expected_profile_sha256,
}
if (
    config["executionProfile"] != expected_profile
    or config["executionProfileSha256"] != expected_profile_sha256
):
    raise RuntimeError("Runtime preflight execution profile is stale or tampered")
observed_environment = {
    name: os.environ.get(name)
    for name in expected_profile["environment"]
}
if observed_environment != expected_profile["environment"]:
    raise RuntimeError("Runtime preflight inherited environment is missing or drifted")

module_names = (
    "torch",
    "numpy",
    "safetensors",
    "sentencepiece",
    "tokenizers",
    "transformers",
)
torch = importlib.import_module("torch")
torch.set_num_threads(expected_profile["torch"]["intraopThreads"])
torch.set_num_interop_threads(expected_profile["torch"]["interopThreads"])
torch_threads = {
    "interopThreads": int(torch.get_num_interop_threads()),
    "intraopThreads": int(torch.get_num_threads()),
}
if torch_threads != expected_profile["torch"]:
    raise RuntimeError("Runtime preflight torch threads drifted")
try:
    torch.use_deterministic_algorithms(True, warn_only=False)
except (TypeError, RuntimeError) as error:
    raise RuntimeError("Runtime preflight cannot enable hard determinism") from error
torch.manual_seed(config["manualSeed"])
primary_determinism = {
    "deterministicAlgorithms": bool(
        torch.are_deterministic_algorithms_enabled()
    ),
    "warnOnly": bool(
        torch.is_deterministic_algorithms_warn_only_enabled()
    ),
    "manualSeed": config["manualSeed"],
}
if primary_determinism != {
    "deterministicAlgorithms": True,
    "warnOnly": False,
    "manualSeed": 0,
}:
    raise RuntimeError("Runtime preflight hard determinism drifted")
modules = {"torch": torch}
for name in module_names:
    if name != "torch":
        modules[name] = importlib.import_module(name)
site_packages = Path(sys.prefix, "lib", "python3.9", "site-packages").resolve(strict=True)
if site_packages != Path(config["sitePackages"]).resolve(strict=True):
    raise RuntimeError("Runtime preflight resolved an unexpected venv site-packages root")
origins = {}
for name, module in modules.items():
    raw_origin = getattr(module, "__file__", None)
    if not isinstance(raw_origin, str) or not raw_origin:
        raise RuntimeError(f"Runtime module {name} has no regular origin")
    origin = Path(raw_origin).resolve(strict=True)
    if not origin.is_file() or site_packages not in origin.parents:
        raise RuntimeError(f"Runtime module {name} escaped the pinned venv")
    origins[name] = str(origin)

observed_environment = {
    name: os.environ.get(name)
    for name in expected_profile["environment"]
}
torch_threads = {
    "interopThreads": int(torch.get_num_interop_threads()),
    "intraopThreads": int(torch.get_num_threads()),
}
if (
    observed_environment != expected_profile["environment"]
    or torch_threads != expected_profile["torch"]
):
    raise RuntimeError("Runtime preflight environment or torch threads drifted after imports")
primary_determinism = {
    "deterministicAlgorithms": bool(
        torch.are_deterministic_algorithms_enabled()
    ),
    "warnOnly": bool(
        torch.is_deterministic_algorithms_warn_only_enabled()
    ),
    "manualSeed": config["manualSeed"],
}
if primary_determinism != {
    "deterministicAlgorithms": True,
    "warnOnly": False,
    "manualSeed": 0,
}:
    raise RuntimeError("Runtime preflight hard determinism drifted after imports")
mps_built = bool(torch.backends.mps.is_built())
mps_available = bool(torch.backends.mps.is_available())
model_smoke = {"performed": False}
if config["modelSmoke"]:
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    requested_device = config["device"]
    device = requested_device
    if device == "auto":
        device = "mps" if mps_available else "cpu"
    if device == "mps" and not mps_available:
        raise RuntimeError("MPS is unavailable for the requested model smoke")
    if device == "cpu" and config["dtype"] != "float32":
        raise RuntimeError("CPU model smoke requires float32")
    model_dtype = torch.float16 if config["dtype"] == "float16" else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(
        config["modelDirectory"],
        src_lang="eng_Latn",
        local_files_only=True,
    )
    target_token_id = tokenizer.convert_tokens_to_ids("afr_Latn")
    if (
        not isinstance(target_token_id, int)
        or target_token_id < 0
        or target_token_id == tokenizer.unk_token_id
        or not isinstance(tokenizer.eos_token_id, int)
    ):
        raise RuntimeError("Pinned tokenizer has no canonical Afrikaans/EOS token")
    model = AutoModelForSeq2SeqLM.from_pretrained(
        config["modelDirectory"],
        torch_dtype=model_dtype,
        local_files_only=True,
    ).to(device).eval()
    encoded = tokenizer(
        "Learn carefully and explain the next step.",
        return_tensors="pt",
        padding=False,
        truncation=False,
    )
    encoded = {key: value.to(device) for key, value in encoded.items()}
    if (
        not torch.are_deterministic_algorithms_enabled()
        or torch.is_deterministic_algorithms_warn_only_enabled()
    ):
        raise RuntimeError("Runtime preflight hard determinism drifted before decode")
    torch.manual_seed(config["manualSeed"])
    with torch.inference_mode():
        generated = model.generate(
            **encoded,
            forced_bos_token_id=target_token_id,
            do_sample=False,
            num_beams=1,
            max_new_tokens=48,
        )
    generated_ids = generated[0].detach().to("cpu").tolist()
    eos_observed = tokenizer.eos_token_id in generated_ids
    output = tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
    if not eos_observed or not output:
        raise RuntimeError("Pinned model smoke did not produce non-empty EOS output")
    model_smoke = {
        "performed": True,
        "device": device,
        "dtype": config["dtype"],
        "deterministicAlgorithms": True,
        "manualSeed": config["manualSeed"],
        "eosObserved": True,
        "generatedTokens": len(generated_ids),
        "outputSha256": hashlib.sha256(output.encode("utf-8")).hexdigest(),
    }

report = {
    "schemaVersion": 2,
    "kind": "inspir-long-tail-worker-runtime-preflight-v2",
    "executionProfile": expected_profile,
    "observedEnvironment": observed_environment,
    "torchThreads": torch_threads,
    "pythonImplementation": platform.python_implementation(),
    "pythonVersion": platform.python_version(),
    "machine": platform.machine(),
    "userSiteEnabled": bool(site.ENABLE_USER_SITE),
    "sitePackages": str(site_packages),
    "versions": {
        name: importlib.metadata.version(name)
        for name in module_names
    },
    "origins": origins,
    "mpsBuilt": mps_built,
    "mpsAvailable": mps_available,
    "primaryDeterminism": primary_determinism,
    "modelSmoke": model_smoke,
}
print(json.dumps(report, ensure_ascii=True, separators=(",", ":"), sort_keys=True))
`;

function runtimePreflightFailure(message: string) {
  return pipelineError(
    "LONG_TAIL_WORKER_FAILED",
    `Local model runtime preflight failed: ${message}`,
  );
}

function isPathInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative);
}

export async function runLongTailWorkerRuntimePreflight(input: {
  python: string;
  modelDirectory: string;
  generationConfig: Pick<
    LongTailGenerationConfig,
    "device" | "dtype" | "deterministicAlgorithms" | "manualSeed"
  >;
  executionProfile: LongTailNllbExecutionProfile;
  modelSmoke?: boolean;
  parentEnvironment?: Partial<NodeJS.ProcessEnv>;
  timeoutMilliseconds?: number;
  cwd?: string;
}): Promise<LongTailWorkerRuntimePreflight> {
  const executionProfile = parseLongTailNllbExecutionProfile(
    input.executionProfile,
  );
  const python = path.resolve(input.python);
  const virtualEnvironment = path.resolve(path.dirname(python), "..");
  let sitePackages: string;
  try {
    sitePackages = realpathSync(
      path.join(virtualEnvironment, "lib/python3.9/site-packages"),
    );
    if (!statSync(sitePackages).isDirectory()) {
      throw new Error("site-packages is not a directory");
    }
  } catch (error) {
    throw runtimePreflightFailure(
      `the pinned venv site-packages root is unavailable (${boundedError(error)}).`,
    );
  }
  const modelSmoke = input.modelSmoke ?? false;
  const timeoutMilliseconds = input.timeoutMilliseconds ??
    (modelSmoke
      ? DEFAULT_MODEL_RUNTIME_SMOKE_TIMEOUT_MS
      : DEFAULT_RUNTIME_PREFLIGHT_TIMEOUT_MS);
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > MAXIMUM_RUNTIME_PREFLIGHT_TIMEOUT_MS
  ) {
    throw runtimePreflightFailure("the timeout is outside its bounded range.");
  }
  const probeConfiguration = JSON.stringify({
    deterministicAlgorithms: input.generationConfig.deterministicAlgorithms,
    device: input.generationConfig.device,
    dtype: input.generationConfig.dtype,
    executionProfile,
    executionProfileSha256: executionProfile.executionProfileSha256,
    modelDirectory: path.resolve(input.modelDirectory),
    modelSmoke,
    manualSeed: input.generationConfig.manualSeed,
    sitePackages,
  });
  const result = await new Promise<Readonly<{
    stdout: string;
    stderr: string;
  }>>((resolve, reject) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;
    const child = spawn(
      python,
      ["-c", LONG_TAIL_WORKER_RUNTIME_PREFLIGHT_SOURCE, probeConfiguration],
      {
        cwd: input.cwd ?? process.cwd(),
        env: createLongTailWorkerEnvironment(
          executionProfile,
          input.parentEnvironment,
        ),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMilliseconds);
    const append = (
      chunks: Buffer[],
      chunk: Buffer | string,
      currentBytes: number,
    ) => {
      const encoded = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const nextBytes = currentBytes + encoded.length;
      if (nextBytes > MAXIMUM_RUNTIME_PREFLIGHT_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill("SIGKILL");
        return currentBytes;
      }
      chunks.push(encoded);
      return nextBytes;
    };
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBytes = append(stdout, chunk, stdoutBytes);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBytes = append(stderr, chunk, stderrBytes);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(runtimePreflightFailure(`could not start (${boundedError(error)}).`));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (timedOut) {
        reject(runtimePreflightFailure(
          `timed out after ${timeoutMilliseconds}ms.`,
        ));
        return;
      }
      if (outputExceeded) {
        reject(runtimePreflightFailure("exceeded its bounded output limit."));
        return;
      }
      if (code !== 0) {
        reject(runtimePreflightFailure(
          `exited with ${code ?? signal ?? "unknown status"}: ${boundedError(stderrText)}`,
        ));
        return;
      }
      resolve(Object.freeze({ stdout: stdoutText, stderr: stderrText }));
    });
  });
  const stdout = result.stdout.trim();
  if (!stdout || stdout.includes("\n")) {
    throw runtimePreflightFailure("did not emit exactly one JSON record.");
  }
  let rawReport: unknown;
  try {
    rawReport = JSON.parse(stdout);
  } catch (error) {
    throw runtimePreflightFailure(
      `emitted malformed JSON (${boundedError(error)}).`,
    );
  }
  const parsed = longTailWorkerRuntimePreflightSchema.safeParse(rawReport);
  if (!parsed.success) {
    throw runtimePreflightFailure("emitted a malformed attestation record.");
  }
  const report = parsed.data;
  if (
    canonicalJson(report.executionProfile) !== canonicalJson(executionProfile) ||
    canonicalJson(report.observedEnvironment) !==
      canonicalJson(executionProfile.environment) ||
    canonicalJson(report.torchThreads) !== canonicalJson(executionProfile.torch) ||
    report.pythonImplementation !== "CPython" ||
    report.pythonVersion !== "3.9.6" ||
    report.machine !== "arm64" ||
    report.userSiteEnabled ||
    realpathSync(report.sitePackages) !== sitePackages
  ) {
    throw runtimePreflightFailure("Python, architecture, or user-site isolation drifted.");
  }
  for (const name of longTailWorkerCoreRuntimeNames) {
    const expectedVersion = longTailWorkerCoreRuntimeVersions[name];
    if (report.versions[name] !== expectedVersion) {
      throw runtimePreflightFailure(
        `${name} version drifted from ${expectedVersion}.`,
      );
    }
    let origin: string;
    try {
      origin = realpathSync(report.origins[name]);
      if (!statSync(origin).isFile() || !isPathInside(sitePackages, origin)) {
        throw new Error("module origin escaped the venv");
      }
    } catch (error) {
      throw runtimePreflightFailure(
        `${name} origin is not a regular file inside the pinned venv (${boundedError(error)}).`,
      );
    }
  }
  if (
    input.generationConfig.device === "mps" &&
    (!report.mpsBuilt || !report.mpsAvailable)
  ) {
    throw runtimePreflightFailure("MPS was requested but is unavailable.");
  }
  if (report.modelSmoke.performed !== modelSmoke) {
    throw runtimePreflightFailure("model-smoke evidence is missing or unexpected.");
  }
  if (report.modelSmoke.performed) {
    const expectedDevice = input.generationConfig.device === "auto"
      ? (report.mpsAvailable ? "mps" : "cpu")
      : input.generationConfig.device;
    if (
      report.modelSmoke.device !== expectedDevice ||
      report.modelSmoke.dtype !== input.generationConfig.dtype
    ) {
      throw runtimePreflightFailure(
        "model-smoke device or dtype evidence does not match the requested runtime.",
      );
    }
  }
  return deepFreeze(report);
}

function collectValidatedCandidates(input: {
  master: LongTailMasterWorklist;
  runDirectory: string;
}) {
  const master = parseLongTailMasterWorklist(input.master);
  const candidateRoot = path.join(input.runDirectory, "candidates");
  const quarantineRoot = path.join(input.runDirectory, "quarantine");
  const validated: Array<Readonly<{
    job: LongTailTranslationJob;
    pack: LongTailPackWorklist;
    candidatePath: string;
    result: ReturnType<typeof validateLongTailCandidate>;
  }>> = [];
  const failures: string[] = [];
  for (const job of master.jobs) {
    const pack = createPackWorklistFromValidatedMaster(master, job);
    const candidatePath = resolveContainedPath(
      candidateRoot,
      job.candidateRelativePath,
      "candidate",
    );
    if (!existsSync(candidatePath)) {
      failures.push(`${job.targetRelativePath}:missing`);
      continue;
    }
    try {
      validated.push(Object.freeze({
        job,
        pack,
        candidatePath,
        result: validateOrQuarantineLongTailCandidate({
          pack,
          candidatePath,
          candidateRoot,
          quarantineRoot,
        }),
      }));
    } catch (error) {
      failures.push(`${job.targetRelativePath}:${boundedError(error)}`);
    }
  }
  if (failures.length) {
    throw pipelineError(
      "LONG_TAIL_CANDIDATE_INVALID",
      `${failures.length} candidate packs are missing or invalid; nothing was promoted. First failures: ${failures.slice(0, 10).join(" | ")}`,
    );
  }
  return Object.freeze(validated);
}

export function importExactLongTailCandidates(input: {
  master: LongTailMasterWorklist;
  sourceRoot: string;
  runDirectory: string;
}) {
  const master = parseLongTailMasterWorklist(input.master);
  const sourceRoot = path.resolve(input.sourceRoot);
  const candidateRoot = path.join(path.resolve(input.runDirectory), "candidates");
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Candidate import root is not a local directory: ${sourceRoot}.`,
    );
  }
  if (lstatSync(sourceRoot).isSymbolicLink()) {
    throw pipelineError(
      "LONG_TAIL_PATH_UNSAFE",
      "Candidate import root cannot be a symbolic link.",
    );
  }
  let imported = 0;
  let replayed = 0;
  let rejected = 0;
  for (const job of master.jobs) {
    const sourceFile = resolveContainedPath(
      sourceRoot,
      job.candidateRelativePath,
      "candidate import",
    );
    if (!existsSync(sourceFile)) continue;
    try {
      assertRegularUnlinkedFile(sourceFile, "candidate import");
      const pack = createPackWorklistFromValidatedMaster(master, job);
      const parsed = readBoundedJson(sourceFile);
      const validated = validateLongTailCandidate(pack, parsed);
      const target = resolveContainedPath(
        candidateRoot,
        job.candidateRelativePath,
        "candidate",
      );
      const publication = publishExactFile(
        target,
        prettyJsonBytes(validated.candidate),
      );
      if (publication === "created") imported += 1;
      else replayed += 1;
    } catch {
      rejected += 1;
    }
  }
  return Object.freeze({ imported, replayed, rejected });
}

function assertPromotionHasNoConflicts(input: {
  validated: ReturnType<typeof collectValidatedCandidates>;
  curatedRoot: string;
  sourceStaleReplacementApprovals:
    readonly LongTailSourceStaleReplacementApproval[];
}) {
  for (const item of input.validated) {
    assertReplacementJobApproved({
      job: item.job,
      approvals: input.sourceStaleReplacementApprovals,
      validatorPolicySha256:
        item.pack.provenance.validatorPolicy.validatorPolicySha256,
    });
    const target = resolveContainedPath(
      input.curatedRoot,
      item.job.targetRelativePath,
      "curated target",
    );
    if (!existsSync(target)) {
      if (item.job.replacement) {
        throw pipelineError(
          "LONG_TAIL_CONFLICT",
          `Approved replacement target disappeared before promotion: ${item.job.targetRelativePath}. Nothing was promoted.`,
        );
      }
      continue;
    }
    assertRegularUnlinkedFile(target, "curated target");
    const currentBytes = readStableBoundedFile(
      target,
      MAXIMUM_JSON_BYTES,
      "curated promotion target",
    );
    if (currentBytes.equals(prettyJsonBytes(item.result.curatedPack))) continue;
    if (
      !item.job.replacement ||
      sha256Buffer(currentBytes) !== item.job.replacement.existingFileSha256
    ) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `Curated target changed before promotion: ${item.job.targetRelativePath}. Nothing was promoted.`,
      );
    }
  }
}

export function validateLongTailPromotionBatch(input: {
  master: LongTailMasterWorklist;
  runDirectory: string;
  curatedRoot: string;
  sourceStaleReplacementApprovals?:
    readonly LongTailSourceStaleReplacementApproval[];
}) {
  const approvals = parseSourceStaleReplacementApprovals(
    input.sourceStaleReplacementApprovals ?? [],
  );
  const validated = collectValidatedCandidates({
    master: input.master,
    runDirectory: input.runDirectory,
  });
  assertPromotionHasNoConflicts({
    validated,
    curatedRoot: input.curatedRoot,
    sourceStaleReplacementApprovals: approvals,
  });
  return validated;
}

function buildLongTailPromotionCheckpoint(
  item: ReturnType<typeof collectValidatedCandidates>[number],
) {
  const targetBytes = prettyJsonBytes(item.result.curatedPack);
  const targetSha256 = sha256Buffer(targetBytes);
  return Object.freeze({
    targetBytes,
    targetSha256,
    checkpointRelativePath: `${item.job.jobSha256}.json`,
    checkpointBytes: prettyJsonBytes({
      schemaVersion: 1,
      kind: LONG_TAIL_TRANSLATION_CHECKPOINT_KIND,
      pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
      executionProfileSha256:
        item.pack.provenance.executionProfile.executionProfileSha256,
      masterWorklistSha256: item.pack.masterWorklistSha256,
      packWorklistSha256: item.pack.packWorklistSha256,
      jobSha256: item.job.jobSha256,
      candidateSha256: item.result.candidateSha256,
      targetRelativePath: item.job.targetRelativePath,
      targetSha256,
    }),
  });
}

function readStablePromotionCandidate(file: string): Buffer {
  return readStableBoundedFile(
    file,
    MAXIMUM_JSON_BYTES,
    "Semantic-audited candidate",
  );
}

export function assertLongTailCandidatesMatchSemanticAudit(input: {
  master: LongTailMasterWorklist;
  semanticAudit: LongTailSemanticPromotionAudit;
  validated: ReturnType<typeof collectValidatedCandidates>;
}): void {
  const master = parseLongTailMasterWorklist(input.master);
  if (
    input.semanticAudit.masterWorklistSha256 !== master.worklistSha256 ||
    input.semanticAudit.promotionEvidence.masterWorklistSha256 !==
      master.worklistSha256
  ) {
    throw pipelineError(
      "LONG_TAIL_CONFLICT",
      "Semantic audit belongs to a different master worklist.",
    );
  }
  if (
    input.semanticAudit.promotionEvidence.generatorExecutionProfileSha256 !==
      master.provenance.executionProfile.executionProfileSha256 ||
    canonicalJson(
      input.semanticAudit.promotionEvidence.generatorExecutionProfile,
    ) !== canonicalJson(master.provenance.executionProfile)
  ) {
    throw pipelineError(
      "LONG_TAIL_CONFLICT",
      "Semantic audit belongs to a different local NLLB execution profile.",
    );
  }
  const bindings = new Map(
    input.semanticAudit.manifest.results.packBindings
      .filter((binding) => binding.origin === "candidate")
      .map((binding) => [`${binding.locale}\u0000${binding.namespace}`, binding]),
  );
  if (
    bindings.size !== input.validated.length ||
    bindings.size !== input.semanticAudit.promotionEvidence.scope.candidatePacks
  ) {
    throw pipelineError(
      "LONG_TAIL_CONFLICT",
      "Promoted candidate set does not exactly match semantic-audit coverage.",
    );
  }
  for (const item of input.validated) {
    const key = `${item.job.locale}\u0000${item.job.namespace}`;
    const binding = bindings.get(key);
    if (!binding) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `Candidate was not approved by the semantic audit: ${item.job.targetRelativePath}.`,
      );
    }
    const bytes = readStablePromotionCandidate(item.candidatePath);
    let candidateValue: unknown;
    try {
      candidateValue = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw pipelineError(
        "LONG_TAIL_CANDIDATE_INVALID",
        `Semantic-audited candidate became invalid JSON: ${item.job.targetRelativePath}.`,
      );
    }
    const rebound = validateLongTailCandidate(item.pack, candidateValue);
    if (
      sha256Buffer(bytes) !== binding.packFileSha256 ||
      rebound.candidateSha256 !== item.result.candidateSha256 ||
      rebound.candidateSha256 !== sha256Canonical(candidateValue)
    ) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `Candidate changed after semantic verification: ${item.job.targetRelativePath}.`,
      );
    }
    bindings.delete(key);
  }
  if (bindings.size !== 0) {
    throw pipelineError(
      "LONG_TAIL_CONFLICT",
      "Semantic audit contains candidates outside the promotion batch.",
    );
  }
}

export function assertExactAfrikaansStagedReleaseWorklist(
  value: LongTailMasterWorklist,
): LongTailMasterWorklist {
  const master = parseLongTailMasterWorklist(value);
  if (
    master.sources.length !==
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT ||
    master.jobs.length !==
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT ||
    master.jobs.some((job) =>
      job.locale !== "af" || job.language !== "Afrikaans"
    ) ||
    new Set(master.jobs.map((job) => job.namespace)).size !==
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Staged fallback release requires the exact fresh 121-candidate Afrikaans worklist over the current 125-namespace source catalog.",
    );
  }
  return master;
}

function assertAfrikaansStagedSemanticAudit(
  audit: LongTailSemanticPromotionAudit,
): asserts audit is VerifiedAfrikaansTranslationSemanticAudit {
  const evidence = audit.promotionEvidence;
  if (
    evidence.kind !==
      AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND ||
    evidence.scope.locales !== 1 ||
    evidence.scope.namespaces !==
      TRANSLATION_SEMANTIC_AUDIT_EXPECTED_NAMESPACE_COUNT ||
    evidence.scope.packs !==
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_PACK_COUNT ||
    evidence.scope.fields !==
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_FIELD_COUNT ||
    evidence.scope.candidatePacks !==
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT ||
    evidence.scope.curatedPacks !==
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CURATED_PACK_COUNT
  ) {
    throw pipelineError(
      "LONG_TAIL_CONFLICT",
      "Staged fallback release requires the exact finalized Afrikaans 125-pack semantic proof (121 candidates plus 4 curated packs).",
    );
  }
}

function replacementBackupRelativePath(
  targetRelativePath: string,
  existingSha256: string,
) {
  const extension = path.posix.extname(targetRelativePath);
  const stem = extension
    ? targetRelativePath.slice(0, -extension.length)
    : targetRelativePath;
  return `${stem}.overwritten-${existingSha256}${extension || ".json"}`;
}

export function promoteLongTailCandidateBatch(input: {
  master: LongTailMasterWorklist;
  runDirectory: string;
  curatedRoot: string;
  workspaceRoot?: string;
  semanticAudit?: LongTailSemanticPromotionAudit;
  requireSemanticRelease?: boolean;
  semanticReleaseMode?: "full" | "afrikaans-staged";
  semanticVerificationFailure?: unknown;
  committedSemanticVerifier?: (input: {
    workspaceRoot: string;
    runRoot: string;
    committedPromotionEvidence: Extract<
      TranslationSemanticPromotionEvidenceUnion,
      { kind: typeof TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND }
    >;
  }) => LongTailSemanticPromotionAudit;
  committedAfrikaansSemanticVerifier?: (input: {
    workspaceRoot: string;
    runRoot: string;
    committedPromotionEvidence: AfrikaansTranslationSemanticPromotionEvidence;
  }) => LongTailSemanticPromotionAudit;
  releaseAttestationWriter?: (
    input: Parameters<typeof createTranslationSemanticReleaseAttestation>[0],
  ) => Readonly<{ sha256: string }>;
  stagedPromotionProofReader?: typeof readAndValidateAfrikaansStagedPromotionProof;
  transactionRoot?: string;
  promotionCrashHook?: LongTailPromotionSnapshotCrashHook;
  attestationCrashHook?: () => void;
  sourceStaleReplacementApprovals?:
    readonly LongTailSourceStaleReplacementApproval[];
}) {
  const runDirectory = path.resolve(input.runDirectory);
  const curatedRoot = path.resolve(input.curatedRoot);
  const semanticReleaseMode = input.semanticReleaseMode ?? "full";
  const transactionRoot = path.resolve(
    input.transactionRoot ??
      path.join(
        process.cwd(),
        LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
      ),
  );
  if (input.requireSemanticRelease && !input.workspaceRoot) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "Required semantic promotion needs the exact workspace root.",
    );
  }
  let semanticAudit = input.semanticAudit;
  const writeReleaseAttestation =
    input.releaseAttestationWriter ??
    createTranslationSemanticReleaseAttestation;
  const validated = validateLongTailPromotionBatch({
    master: input.master,
    runDirectory,
    curatedRoot,
    sourceStaleReplacementApprovals:
      input.sourceStaleReplacementApprovals,
  });
  if (semanticReleaseMode === "afrikaans-staged") {
    assertExactAfrikaansStagedReleaseWorklist(input.master);
    if (
      !input.requireSemanticRelease ||
      validated.length !==
        TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT
    ) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        "Afrikaans staged fallback must semantically verify and promote exactly 121 candidates in one finalized transaction.",
      );
    }
    if (semanticAudit) assertAfrikaansStagedSemanticAudit(semanticAudit);
  } else if (
    semanticAudit &&
    semanticAudit.promotionEvidence.kind !==
      TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND
  ) {
    throw pipelineError(
      "LONG_TAIL_CONFLICT",
      "Full release promotion cannot consume staged semantic evidence.",
    );
  }
  if (input.semanticAudit) {
    assertLongTailCandidatesMatchSemanticAudit({
      master: input.master,
      semanticAudit: input.semanticAudit,
      validated,
    });
    if (!input.workspaceRoot) {
      throw pipelineError(
        "LONG_TAIL_CONTRACT_INVALID",
        "Semantic promotion requires the exact workspace root.",
      );
    }
  }
  if (validated.length === 0) {
    if (input.requireSemanticRelease && !semanticAudit) {
      throw pipelineError(
        "LONG_TAIL_CONFLICT",
        `Fixed semantic verification failed and no committed release can recover it: ${boundedError(input.semanticVerificationFailure)}.`,
      );
    }
    const attestation: Readonly<{ sha256: string }> | null =
      semanticReleaseMode === "full" &&
        semanticAudit?.promotionEvidence.kind ===
          TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND &&
        input.workspaceRoot
        ? writeReleaseAttestation({
          workspaceRoot: input.workspaceRoot,
          semanticEvidence: semanticAudit.promotionEvidence,
          promotion: {
            transactionId: null,
          },
        })
        : null;
    return Object.freeze({
      transactionId: null,
      outcome: "already-complete" as const,
      activeTreeSha256: null,
      activeRoot: curatedRoot,
      priorRoot: null,
      publications: Object.freeze({
        created: 0,
        replayed: 0,
        replaced: 0,
      }),
      checkpoints: Object.freeze([]),
      backups: Object.freeze([]),
      finalized: null,
      ...(attestation ? { attestation } : {}),
      candidatesValidated: 0,
    });
  }
  const artifacts: LongTailPromotionSnapshotArtifact[] = validated.map(
    (item) => {
      const checkpoint = buildLongTailPromotionCheckpoint(item);
      const replacement = item.job.replacement;
      const replacementArtifact:
        LongTailPromotionSnapshotArtifact["replacement"] = replacement
        ? replacement.kind === LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND
          ? Object.freeze({
            kind: LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND,
            approvedExistingSha256: replacement.existingFileSha256,
            priorSourceHash: replacement.priorSourceHash,
            newSourceHash: item.job.sourceHash,
            backupRelativePath: replacementBackupRelativePath(
              item.job.targetRelativePath,
              replacement.existingFileSha256,
            ),
          })
          : Object.freeze({
            kind: LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND,
            approvedExistingSha256: replacement.existingFileSha256,
            priorSourceHash: replacement.sourceHash,
            newSourceHash: item.job.sourceHash,
            validatorPolicySha256: replacement.validatorPolicySha256,
            backupRelativePath: replacementBackupRelativePath(
              item.job.targetRelativePath,
              replacement.existingFileSha256,
            ),
          })
        : undefined;
      return Object.freeze({
        targetRelativePath: item.job.targetRelativePath,
        targetBytes: checkpoint.targetBytes,
        checkpointRelativePath: checkpoint.checkpointRelativePath,
        checkpointBytes: checkpoint.checkpointBytes,
        ...(replacementArtifact
          ? { replacement: replacementArtifact }
          : {}),
      });
    },
  );

  try {
    const promotion = (() => {
      if (semanticAudit) {
        return promoteLongTailPromotionSnapshot({
          curatedRoot,
          transactionRoot,
          masterWorklistSha256: input.master.worklistSha256,
          artifacts,
          semanticEvidence: semanticAudit.promotionEvidence,
          crashHook: input.promotionCrashHook,
        });
      }
      if (!input.requireSemanticRelease || !input.workspaceRoot) {
        return promoteLongTailPromotionSnapshot({
          curatedRoot,
          transactionRoot,
          masterWorklistSha256: input.master.worklistSha256,
          artifacts,
          crashHook: input.promotionCrashHook,
        });
      }
      const recovered = recoverLongTailPromotionSnapshotByExactArtifacts({
        curatedRoot,
        transactionRoot,
        masterWorklistSha256: input.master.worklistSha256,
        expectedSemanticEvidenceKind: semanticReleaseMode === "full"
          ? TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND
          : AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
        artifacts,
        crashHook: input.promotionCrashHook,
      });
      if (!recovered.semanticEvidence) {
        throw pipelineError(
          "LONG_TAIL_CONFLICT",
          "Committed promotion recovery has no semantic evidence.",
        );
      }
      if (semanticReleaseMode === "full") {
        if (
          recovered.semanticEvidence.kind !==
            TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND
        ) {
          throw pipelineError(
            "LONG_TAIL_CONFLICT",
            "Full semantic recovery found staged evidence.",
          );
        }
        const verifyCommittedSemanticAudit =
          input.committedSemanticVerifier ??
          verifyTranslationSemanticAuditManifest;
        semanticAudit = verifyCommittedSemanticAudit({
          workspaceRoot: input.workspaceRoot,
          runRoot: runDirectory,
          committedPromotionEvidence: recovered.semanticEvidence,
        });
      } else {
        if (
          recovered.semanticEvidence.kind !==
            AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND
        ) {
          throw pipelineError(
            "LONG_TAIL_CONFLICT",
            "Afrikaans staged recovery found full-release evidence.",
          );
        }
        const verifyCommittedSemanticAudit =
          input.committedAfrikaansSemanticVerifier ??
          verifyAfrikaansTranslationSemanticAuditManifest;
        semanticAudit = verifyCommittedSemanticAudit({
          workspaceRoot: input.workspaceRoot,
          runRoot: runDirectory,
          committedPromotionEvidence: recovered.semanticEvidence,
        });
        assertAfrikaansStagedSemanticAudit(semanticAudit);
      }
      assertLongTailCandidatesMatchSemanticAudit({
        master: input.master,
        semanticAudit,
        validated,
      });
      return recovered;
    })();
    const checkpointRoot = path.join(runDirectory, "checkpoints");
    for (const checkpoint of promotion.checkpoints) {
      publishExactFile(
        resolveContainedPath(
          checkpointRoot,
          checkpoint.relativePath,
          "translation checkpoint",
        ),
        Buffer.from(checkpoint.bytes),
      );
    }
    const persistentBackupRoot = path.join(
      runDirectory,
      "quarantine/overwritten",
    );
    for (const backup of promotion.backups) {
      publishExactFile(
        resolveContainedPath(
          persistentBackupRoot,
          backup.relativePath,
          "persistent overwritten translation backup",
        ),
        Buffer.from(backup.bytes),
      );
    }
    const finalized = finalizeLongTailPromotionSnapshot({
      curatedRoot,
      transactionRoot,
      transactionId: promotion.transactionId,
    });
    input.attestationCrashHook?.();
    const attestation: Readonly<{ sha256: string }> | null =
      semanticReleaseMode === "full" &&
        semanticAudit?.promotionEvidence.kind ===
          TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND &&
        input.workspaceRoot
        ? writeReleaseAttestation({
          workspaceRoot: input.workspaceRoot,
          semanticEvidence: semanticAudit.promotionEvidence,
          promotion: {
            transactionId: promotion.transactionId,
            transactionRoot,
          },
        })
        : null;
    const stagedPromotionProof: FinalizedAfrikaansStagedPromotionProof | null =
      semanticReleaseMode === "afrikaans-staged" && input.workspaceRoot
        ? (input.stagedPromotionProofReader ??
          readAndValidateAfrikaansStagedPromotionProof)({
          workspaceRoot: input.workspaceRoot,
          runRoot: runDirectory,
          transactionRoot,
          transactionId: promotion.transactionId,
        })
        : null;
    return Object.freeze({
      ...promotion,
      finalized,
      ...(attestation ? { attestation } : {}),
      ...(stagedPromotionProof ? { stagedPromotionProof } : {}),
      candidatesValidated: validated.length,
    });
  } catch (error) {
    if (error instanceof LongTailPipelineError) throw error;
    throw pipelineError(
      "LONG_TAIL_CONFLICT",
      `Whole-corpus promotion did not finalize: ${boundedError(error)}`,
    );
  }
}

async function runLongTailPipeline(options: LongTailCliOptions) {
  const repoRoot = process.cwd();
  const runDirectory = path.resolve(repoRoot, options.runDirectory);
  const modelDirectory = path.resolve(options.modelDirectory);
  const pipelineScript = path.join(
    repoRoot,
    "scripts/generate-long-tail-translations.ts",
  );
  const workerScript = path.resolve(repoRoot, options.workerScript);
  const requestedPython = path.resolve(repoRoot, options.python);
  if (!existsSync(modelDirectory) || !statSync(modelDirectory).isDirectory()) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Local NLLB model directory does not exist: ${modelDirectory}.`,
    );
  }
  let python: string;
  const node = realpathSync(process.execPath);
  try {
    const pythonRealPath = realpathSync(requestedPython);
    if (!statSync(pythonRealPath).isFile()) throw new Error("not a regular file");
    accessSync(requestedPython, fsConstants.X_OK);
    // Keep the venv launcher path. Spawning its real target would bypass
    // pyvenv.cfg and silently fall back to ambient site-packages.
    python = requestedPython;
  } catch (error) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Python runtime does not resolve to an executable regular file: ${requestedPython} (${boundedError(error)}).`,
    );
  }
  if (!existsSync(workerScript)) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      `Worker script does not exist: ${workerScript}.`,
    );
  }
  assertRegularUnlinkedFile(workerScript, "worker script");
  if (options.runtimeSmoke) {
    const modelSha256 = await hashLocalLongTailModelDirectory(modelDirectory);
    const runtime = await runLongTailWorkerRuntimePreflight({
      python,
      modelDirectory,
      generationConfig: options.generationConfig,
      executionProfile: LONG_TAIL_NLLB_EXECUTION_PROFILE,
      modelSmoke: true,
    });
    console.log(JSON.stringify({
      mode: "runtime-smoke",
      modelSha256,
      executionProfileSha256:
        runtime.executionProfile.executionProfileSha256,
      runtime,
      writes: 0,
    }, null, 2));
    return;
  }
  const inventory = createProductionLongTailInventory(repoRoot);
  const historicalSeed = options.historicalSeedSql
    ? loadProductionLongTailHistoricalTranslationSqlSeedConsensus({
      repoRoot,
      primarySqlPath: options.historicalSeedSql,
    })
    : undefined;
  let seedMemory = createLongTailSeedMemory(
    inventory,
    PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
    historicalSeed,
  );
  let provenance = await createLongTailPipelineProvenance({
    repoRoot,
    modelDirectory,
    modelLabel: options.modelLabel,
    workerScript,
    seedMemory,
    generationConfig: options.generationConfig,
  });
  let productionCurrent = buildLongTailMasterWorklist({
    inventory,
    provenance,
    seedMemory,
    replaceSourceStale: options.replaceSourceStale,
    replaceQualityStale: options.replaceQualityStale,
    sourceStaleReplacementApprovals:
      PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
  });
  let legacySeedSalvageEvidence:
    | LegacyLongTailSeedSalvageEvidenceReference
    | null = null;
  let legacySeedSalvageAcceptance:
    | LegacyLongTailSeedSalvageAcceptanceReference
    | null = null;
  let acceptedLegacySeedSalvageRevalidation: Readonly<{
    obsoleteWorklistPath: string;
    acceptancePath: string;
    currentPlanningMaster: LongTailMasterWorklist;
    baseSeedMemory: LongTailSeedMemory;
  }> | null = null;
  if (options.legacySeedSalvagePath) {
    const { salvageLegacyLongTailSeedMemory } = await import(
      "./legacy-long-tail-seed-salvage"
    );
    const salvage = salvageLegacyLongTailSeedMemory({
      repoRoot,
      obsoleteWorklistPath: options.legacySeedSalvagePath,
      currentPlanningMaster: productionCurrent.worklist,
      baseSeedMemory: seedMemory,
      currentValidation: longTailSeedSalvageCurrentValidation,
    });
    seedMemory = salvage.seedMemory;
    legacySeedSalvageEvidence = salvage.evidence;
    provenance = rebindLongTailPipelineProvenanceSeedMemory({
      provenance,
      seedMemory,
    });
    productionCurrent = buildLongTailMasterWorklist({
      inventory,
      provenance,
      seedMemory,
      replaceSourceStale: options.replaceSourceStale,
      replaceQualityStale: options.replaceQualityStale,
      sourceStaleReplacementApprovals:
        PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
    });
  } else if (
    options.acceptedLegacySeedSalvagePath &&
    options.legacySeedSalvageAcceptancePath
  ) {
    acceptedLegacySeedSalvageRevalidation = Object.freeze({
      obsoleteWorklistPath: options.acceptedLegacySeedSalvagePath,
      acceptancePath: options.legacySeedSalvageAcceptancePath,
      currentPlanningMaster: productionCurrent.worklist,
      baseSeedMemory: seedMemory,
    });
    const { verifyAcceptedLegacyLongTailSeedSalvage } = await import(
      "./legacy-long-tail-seed-salvage"
    );
    const accepted = verifyAcceptedLegacyLongTailSeedSalvage({
      repoRoot,
      obsoleteWorklistPath: options.acceptedLegacySeedSalvagePath,
      acceptancePath: options.legacySeedSalvageAcceptancePath,
      currentPlanningMaster: productionCurrent.worklist,
      baseSeedMemory: seedMemory,
      currentValidation: longTailSeedSalvageCurrentValidation,
    });
    seedMemory = accepted.seedMemory;
    legacySeedSalvageEvidence = accepted.evidence;
    legacySeedSalvageAcceptance = accepted.acceptance;
    provenance = rebindLongTailPipelineProvenanceSeedMemory({
      provenance,
      seedMemory,
    });
    productionCurrent = buildLongTailMasterWorklist({
      inventory,
      provenance,
      seedMemory,
      replaceSourceStale: options.replaceSourceStale,
      replaceQualityStale: options.replaceQualityStale,
      sourceStaleReplacementApprovals:
        PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
    });
  }
  const smokeRequested =
    options.smokePacks !== undefined || options.smokeLocale !== undefined ||
    options.promoteSmokeLocale !== undefined;
  if (smokeRequested) {
    assertExpectedProductionMatrix({
      master: productionCurrent.worklist,
      current: productionCurrent,
      expectedPacks: options.expectedPacks,
      strictProductionShape: options.expectedPacks ===
        EXPECTED_PRODUCTION_PACKS,
      hasPersistedMaster: false,
    });
  }
  const current = !smokeRequested
    ? productionCurrent
    : (() => {
      const releaseLocale = options.smokeLocale ??
        options.promoteSmokeLocale;
      const worklist = releaseLocale
        ? createLongTailLocaleSmokeWorklist(
          productionCurrent.worklist,
          releaseLocale,
        )
        : createLongTailSmokeWorklist(
          productionCurrent.worklist,
          options.smokePacks ?? 0,
        );
      const missingJobs = worklist.jobs.filter((job) => !job.replacement);
      const sourceStaleJobs = worklist.jobs.filter(
        (job) =>
          job.replacement?.kind ===
            LONG_TAIL_SOURCE_STALE_REPLACEMENT_KIND,
      );
      const qualityStaleJobs = worklist.jobs.filter(
        (job) =>
          job.replacement?.kind ===
            LONG_TAIL_QUALITY_STALE_REPLACEMENT_KIND,
      );
      const totalPacks = releaseLocale
        ? EXPECTED_PRODUCTION_TOTAL_NAMESPACES
        : worklist.jobs.length;
      return Object.freeze({
        ...productionCurrent,
        worklist,
        missingPacks: missingJobs.length,
        sourceStalePacks: sourceStaleJobs.length,
        qualityStalePacks: qualityStaleJobs.length,
        completedPacks: totalPacks - worklist.jobs.length,
        totalPacks,
        targetLanguages: Object.freeze([
          ...new Set(missingJobs.map((job) => job.language)),
        ]),
        targetNamespaces: Object.freeze([
          ...new Set(worklist.jobs.map((job) => job.namespace)),
        ]),
        missingTargetLanguages: Object.freeze([
          ...new Set(worklist.jobs.map((job) => job.language)),
        ]),
        missingTargetNamespaces: Object.freeze([
          ...new Set(missingJobs.map((job) => job.namespace)),
        ]),
        sourceStaleTargetLanguages: Object.freeze([
          ...new Set(sourceStaleJobs.map((job) => job.language)),
        ]),
        sourceStaleTargetNamespaces: Object.freeze([
          ...new Set(sourceStaleJobs.map((job) => job.namespace)),
        ]),
        qualityStaleTargetLanguages: Object.freeze([
          ...new Set(qualityStaleJobs.map((job) => job.language)),
        ]),
        qualityStaleTargetNamespaces: Object.freeze([
          ...new Set(qualityStaleJobs.map((job) => job.namespace)),
        ]),
      });
    })();
  const hasPersistedMaster = existsSync(path.join(runDirectory, "worklist.json"));
  const master = selectResumableMaster({
    current,
    runDirectory,
    provenance,
  });
  if (options.stagedEnglishFallbackRelease) {
    assertExactAfrikaansStagedReleaseWorklist(master);
  }
  assertBoundLongTailValidatorPolicy(repoRoot, master.provenance);
  if (!smokeRequested) {
    assertExpectedProductionMatrix({
      master,
      current,
      expectedPacks: options.expectedPacks,
      strictProductionShape: options.expectedPacks ===
        EXPECTED_PRODUCTION_PACKS,
      hasPersistedMaster,
    });
  }
  const workload = calculateValidatedLongTailWorkload(master);
  const summary = {
    mode: smokeRequested
      ? options.stagedEnglishFallbackRelease
        ? "execute-and-promote-afrikaans-staged-fallback"
        : "smoke-candidates-only"
      : options.execute
        ? (options.promote ? "execute-and-promote" : "execute-candidates-only")
        : "dry-run",
    pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
    executionProfile: provenance.executionProfile,
    executionProfileSha256:
      provenance.executionProfile.executionProfileSha256,
    masterWorklistSha256: master.worklistSha256,
    modelSha256: provenance.modelSha256,
    validatorPolicySha256:
      provenance.validatorPolicy.validatorPolicySha256,
    historicalSeedEvidence: historicalSeed?.evidence ?? null,
    legacySeedSalvageEvidence,
    legacySeedSalvageAcceptance,
    packs: master.jobs.length,
    physicallyMissingPacks: current.missingPacks,
    sourceStaleReplacementPacks: current.sourceStalePacks,
    qualityStaleReplacementPacks: current.qualityStalePacks,
    completedPacks: current.completedPacks,
    totalInventoryPacks: current.totalPacks,
    languages: new Set(master.jobs.map((job) => job.language)).size,
    namespaces: new Set(master.jobs.map((job) => job.namespace)).size,
    ...workload,
    workersRequested: options.workers,
    runDirectory,
  };
  if (!options.execute) {
    console.log(JSON.stringify({ ...summary, writes: 0 }, null, 2));
    console.log(
      "Dry run only. Execute candidates without publishing: pnpm translations:generate-long-tail --execute --replace-source-stale --replace-quality-stale",
    );
    console.log(
      "After candidate validation, run the Afrikaans smoke and fixed full semantic audits before promotion; see deploy.md.",
    );
    return;
  }
  assertLongTailExecutionSeedReadiness(master);
  const runtimePreflight = await runLongTailWorkerRuntimePreflight({
    python,
    modelDirectory,
    generationConfig: options.generationConfig,
    executionProfile: provenance.executionProfile,
  });
  console.log(JSON.stringify({
    event: "long_tail_worker_runtime_preflight_complete",
    executionProfileSha256:
      provenance.executionProfile.executionProfileSha256,
    runtime: runtimePreflight,
  }));
  assertSafeExecutionPaths({
    repoRoot,
    runDirectory,
    curatedRoot: inventory.curatedRoot,
  });
  const materialized = materializeLongTailWorklists({ master, runDirectory });
  const candidateRoot = path.join(runDirectory, "candidates");
  const quarantineRoot = path.join(runDirectory, "quarantine");
  const imported = options.importCandidateRoot
    ? importExactLongTailCandidates({
      master,
      sourceRoot: path.resolve(repoRoot, options.importCandidateRoot),
      runDirectory,
    })
    : Object.freeze({ imported: 0, replayed: 0, rejected: 0 });
  for (const job of master.jobs) {
    const candidatePath = resolveContainedPath(
      candidateRoot,
      job.candidateRelativePath,
      "candidate",
    );
    if (!existsSync(candidatePath)) continue;
    try {
      validateOrQuarantineLongTailCandidate({
        pack: createPackWorklistFromValidatedMaster(master, job),
        candidatePath,
        candidateRoot,
        quarantineRoot,
      });
    } catch {
      // Quarantined candidates are regenerated by the same deterministic job.
    }
  }
  const pending = listPendingLongTailPackWorklists({ master, runDirectory });
  const workerPlan = createLongTailWorkerPlan({
    jobs: pending,
    requestedWorkers: options.workers,
  });
  if (workerPlan.length) {
    const outcomes = await Promise.allSettled(
      workerPlan.map((worker) => runLongTailWorker({
        repoRoot,
        python,
        workerScript,
        pipelineScript,
        node,
        modelDirectory,
        masterPath: materialized.masterPath,
        worklistRoot: materialized.worklistRoot,
        candidateRoot,
        workerIndex: worker.workerIndex,
        workerCount: worker.workerCount,
        provenance,
      })),
    );
    const failures = outcomes.filter((outcome) => outcome.status === "rejected");
    if (failures.length) {
      throw pipelineError(
        "LONG_TAIL_WORKER_FAILED",
        `${failures.length} of ${workerPlan.length} bounded local model workers failed; completed candidate packs remain restart-safe.`,
      );
    }
  }
  assertBoundLongTailValidatorPolicy(repoRoot, master.provenance);
  if (!options.promote) {
    const validated = collectValidatedCandidates({ master, runDirectory });
    console.log(JSON.stringify({
      ...summary,
      worklists: materialized,
      imported,
      workerStarts: workerPlan.length,
      candidatesValidated: validated.length,
      promoted: 0,
    }, null, 2));
    return;
  }
  let semanticAudit:
    | VerifiedTranslationSemanticAudit
    | VerifiedAfrikaansTranslationSemanticAudit
    | undefined;
  let semanticVerificationFailure: unknown;
  try {
    semanticAudit = options.stagedEnglishFallbackRelease
      ? verifyAfrikaansTranslationSemanticAuditManifest({
        workspaceRoot: repoRoot,
        runRoot: runDirectory,
      })
      : verifyTranslationSemanticAuditManifest({
        workspaceRoot: repoRoot,
        runRoot: runDirectory,
      });
  } catch (error) {
    semanticVerificationFailure = error;
  }
  if (acceptedLegacySeedSalvageRevalidation) {
    const { verifyAcceptedLegacyLongTailSeedSalvage } = await import(
      "./legacy-long-tail-seed-salvage"
    );
    const promotionAcceptance = verifyAcceptedLegacyLongTailSeedSalvage({
      repoRoot,
      ...acceptedLegacySeedSalvageRevalidation,
      currentValidation: longTailSeedSalvageCurrentValidation,
    });
    if (
      promotionAcceptance.seedMemory.seedMemorySha256 !==
        master.seedMemory.seedMemorySha256 ||
      promotionAcceptance.evidence.evidenceSha256 !==
        legacySeedSalvageEvidence?.evidenceSha256 ||
      promotionAcceptance.acceptance.acceptanceSha256 !==
        legacySeedSalvageAcceptance?.acceptanceSha256
    ) {
      throw pipelineError(
        "LONG_TAIL_SOURCE_DRIFT",
        "Accepted legacy seed salvage changed before the promotion boundary.",
      );
    }
  }
  const promotion = promoteLongTailCandidateBatch({
    master,
    runDirectory,
    curatedRoot: inventory.curatedRoot,
    workspaceRoot: repoRoot,
    semanticAudit,
    requireSemanticRelease: true,
    semanticReleaseMode: options.stagedEnglishFallbackRelease
      ? "afrikaans-staged"
      : "full",
    semanticVerificationFailure,
    transactionRoot: path.join(
      repoRoot,
      LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH,
    ),
    sourceStaleReplacementApprovals:
      PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
  });
  console.log(JSON.stringify({
    ...summary,
    worklists: materialized,
    imported,
    workerStarts: workerPlan.length,
    candidatesValidated: promotion.candidatesValidated,
    promotionTransactionId: promotion.transactionId,
    promotionTreeSha256: promotion.activeTreeSha256,
    semanticReleaseAttestationSha256: promotion.attestation?.sha256 ?? null,
    stagedAfrikaansPromotionProofSha256:
      "stagedPromotionProof" in promotion
        ? promotion.stagedPromotionProof?.journalBinding.bindingSha256 ?? null
        : null,
    promoted: promotion.publications,
  }, null, 2));
}

async function runLongTailWorkerValidatorStdio() {
  const { createInterface } = await import("node:readline");
  const expectedValidatorPolicySha256 =
    process.env.INSPIR_LONG_TAIL_VALIDATOR_POLICY_SHA256;
  if (
    !expectedValidatorPolicySha256 ||
    !sha256Pattern.test(expectedValidatorPolicySha256)
  ) {
    throw pipelineError(
      "LONG_TAIL_CONTRACT_INVALID",
      "The worker validator requires an exact validator policy digest.",
    );
  }
  const assertWorkerValidatorPolicy = () => {
    const current = createLongTailValidatorPolicyProvenance(process.cwd());
    if (
      current.validatorPolicySha256 !== expectedValidatorPolicySha256
    ) {
      throw pipelineError(
        "LONG_TAIL_SOURCE_DRIFT",
        "The worker validator policy changed after provenance creation.",
      );
    }
  };
  assertWorkerValidatorPolicy();
  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
    terminal: false,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      assertWorkerValidatorPolicy();
      if (Buffer.byteLength(line, "utf8") > MAXIMUM_JSON_BYTES) {
        throw pipelineError(
          "LONG_TAIL_CONTRACT_INVALID",
          "Worker validation request exceeds the JSON byte limit.",
        );
      }
      const request = parseSchema(z.object({
        pack: packWorklistSchema,
        values: z.record(z.string(), z.string()),
      }).strict(), JSON.parse(line) as unknown, "worker validation request");
      const failures = inspectLongTailCandidateRetryFailures(request);
      process.stdout.write(`${JSON.stringify({ ok: true, failures })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        error: boundedError(error),
      })}\n`);
    }
  }
}

function printLongTailHelp() {
  console.log(`Usage: pnpm translations:generate-long-tail [options]

Default mode is a read-only dry run. No model inference or file writes occur.
Fresh release evidence uses tmp/long-tail-translation-pipeline-v10; every pre-v10 run root is rejected.

  --runtime-smoke                 Read-only pinned-runtime and one-row offline model/EOS gate.
  --execute                       Materialize worklists and generate candidates.
  --promote                       Require the fixed full semantic audit, then atomically publish and attest every pack.
  --promote-smoke-locale af       Select the exact Afrikaans-only staged promotion cohort.
  --staged-english-fallback-release
                                  With --execute and --promote-smoke-locale af, publish only the finalized 121-pack Afrikaans semantic proof; never writes the full-release attestation.
  --replace-source-stale          Include exact code-approved stale jobs; only promotion replaces targets.
  --replace-quality-stale         Include current-source packs rejected by the exact validator policy.
  --run-dir PATH                  Fresh v10 ignored run/checkpoint root under repository tmp/.
  --model PATH                    Complete local NLLB model directory.
  --historical-seed-sql PATH      Anchor all-snapshot-exact local D1 translation seed consensus.
  --legacy-seed-salvage PATH      Revalidate an obsolete tmp/ seed worklist as untrusted input under current policy.
  --accepted-legacy-seed-salvage PATH
                                  Recompute one explicitly accepted obsolete tmp/ seed input for execution.
  --legacy-seed-salvage-acceptance PATH
                                  Required exact trusted-local acceptance for the accepted salvage input.
  --import-candidate-root PATH    Reuse only exact current-provenance candidates.
  --smoke-packs N                 Generate 1–10 packs in a separate candidate-only run.
  --smoke-locale LOCALE           Generate all pending/stale packs for one locale without promotion.
  --workers N                     Resident model processes (default 1, maximum 4).
  --device mps|cpu|auto           Generation device (default mps).
  --dtype float16|float32         Model dtype (default float16).
  --batch-size N                  Generation batch size (default 16).
  --num-beams N                   Beam count (default 1).
  --no-repeat-ngram-size N        Decoder repetition control (default 4).
  --max-source-tokens N           Reject an oversized protected chunk (default 512).
  --max-new-tokens N              Hard decoder ceiling with EOS rejection (default 512).
  --max-retry-attempts N          Deterministic quality retries (default 2, maximum 3).
  --expected-packs N              Explicit inventory cardinality contract.
`);
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  if (process.argv.slice(2).includes("--worker-validator-stdio")) {
    void runLongTailWorkerValidatorStdio().catch((error: unknown) => {
      console.error(
        `[translations:worker-validator] executionProfileSha256=${LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256}; ${boundedError(error)}`,
      );
      process.exitCode = 1;
    });
  } else if (process.argv.slice(2).includes("--help")) {
    printLongTailHelp();
  } else {
    void runLongTailPipeline(parseLongTailCliOptions(process.argv.slice(2))).catch(
      (error: unknown) => {
        console.error(
          `[translations:generate-long-tail] executionProfileSha256=${LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256}; ${boundedError(error)}`,
        );
        process.exitCode = 1;
      },
    );
  }
}
