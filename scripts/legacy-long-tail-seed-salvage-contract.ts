import type { SupportedLanguage } from "@/lib/content/languages";
import type { LongTailValidatorPolicyProvenance } from "./translation-validator-policy-provenance";

type LegacyLongTailSeedSalvageTargetLanguage = Exclude<
  SupportedLanguage,
  "English"
>;

export type LegacyLongTailSeedSalvageSeedMemory = Readonly<{
  seedMemorySha256: string;
  entries: readonly Readonly<{
    language: LegacyLongTailSeedSalvageTargetLanguage;
    locale: string;
    source: string;
    sourceSha256: string;
    value: string;
    valueSha256: string;
  }>[];
  conflicts: readonly Readonly<{
    language: LegacyLongTailSeedSalvageTargetLanguage;
    locale: string;
    sourceSha256: string;
  }>[];
}>;

export type LegacyLongTailSeedSalvageMasterWorklist = Readonly<{
  worklistSha256: string;
  seedMemory: Readonly<{
    seedMemorySha256: string;
  }>;
  provenance: Readonly<{
    pipelineImplementationSha256: string;
    validatorPolicy: LongTailValidatorPolicyProvenance;
  }>;
  sources: readonly Readonly<{
    namespace: string;
    sourceHash: string;
    entries: readonly Readonly<{
      key: string;
      source: string;
      sourceSha256: string;
    }>[];
  }>[];
  jobs: readonly Readonly<{
    language: LegacyLongTailSeedSalvageTargetLanguage;
    locale: string;
    namespace: string;
  }>[];
}>;

export type LegacyLongTailSeedSalvageCurrentValidation<
  TMaster extends LegacyLongTailSeedSalvageMasterWorklist =
    LegacyLongTailSeedSalvageMasterWorklist,
  TSeedMemory extends LegacyLongTailSeedSalvageSeedMemory =
    LegacyLongTailSeedSalvageSeedMemory,
> = Readonly<{
  parseMasterWorklist: (value: unknown) => TMaster;
  parseSeedMemory: (value: unknown) => TSeedMemory;
  hasExactInvariantParity: (source: string, value: string) => boolean;
}>;

export type LegacyLongTailSeedSalvageEvidenceReference = Readonly<{
  evidenceSha256: string;
}>;

export type LegacyLongTailSeedSalvageAcceptanceReference = Readonly<{
  acceptanceSha256: string;
}>;
