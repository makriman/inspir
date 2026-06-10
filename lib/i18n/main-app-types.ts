import type { SupportedLanguage } from "@/lib/content/languages";

export type MainAppTranslationBundle = {
  namespace: string;
  language: SupportedLanguage;
  sourceHash: string;
  sourceStrings: Record<string, string>;
  strings: Record<string, string>;
};
