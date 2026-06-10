import type { SupportedLanguage } from "@/lib/content/languages";

export type TranslationSource = {
  namespace: string;
  sourceHash: string;
  sourceStrings: Record<string, string>;
  systemInstruction?: string;
};

export type TranslationBundle = {
  namespace: string;
  language: SupportedLanguage;
  sourceHash: string;
  sourceStrings: Record<string, string>;
  strings: Record<string, string>;
};

export type TranslationResult = {
  bundle: TranslationBundle;
  complete: boolean;
  translatedCount: number;
  totalCount: number;
  retryAfterMs?: number;
};
