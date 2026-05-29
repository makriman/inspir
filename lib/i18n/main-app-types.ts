export type MainAppTranslationBundle = {
  namespace: string;
  language: string;
  sourceHash: string;
  sourceStrings: Record<string, string>;
  strings: Record<string, string>;
};
