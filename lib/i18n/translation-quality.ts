import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";
import type { TranslationBundle, TranslationSource } from "@/lib/i18n/translation-types";

const protectedTerms = new Set([
  "ai",
  "api",
  "csr",
  "d1",
  "github",
  "inspir",
  "json",
  "llm",
  "llms",
  "ncert",
  "openai",
  "pwa",
  "r2",
  "rag",
  "rss",
  "seo",
  "url",
  "urls",
  "webp",
]);

const englishLeakageWords = new Set([
  "a",
  "about",
  "access",
  "action",
  "active",
  "after",
  "all",
  "and",
  "answer",
  "answers",
  "ask",
  "back",
  "better",
  "browse",
  "built",
  "can",
  "chat",
  "check",
  "clear",
  "coding",
  "companion",
  "content",
  "custom",
  "debate",
  "design",
  "every",
  "everyone",
  "explain",
  "feedback",
  "first",
  "flashcards",
  "for",
  "free",
  "from",
  "guide",
  "guided",
  "guides",
  "help",
  "homework",
  "into",
  "learn",
  "learner",
  "learners",
  "learning",
  "library",
  "live",
  "map",
  "mode",
  "modes",
  "not",
  "of",
  "open",
  "or",
  "path",
  "practice",
  "prompt",
  "prompts",
  "public",
  "question",
  "questions",
  "quiz",
  "quizzes",
  "read",
  "review",
  "route",
  "school",
  "schools",
  "session",
  "start",
  "study",
  "support",
  "that",
  "the",
  "to",
  "tool",
  "topic",
  "topics",
  "tutor",
  "use",
  "ways",
  "with",
  "without",
  "writing",
  "you",
  "your",
]);

const englishFunctionLeakageWords = new Set([
  "a",
  "about",
  "after",
  "all",
  "and",
  "back",
  "can",
  "every",
  "for",
  "from",
  "into",
  "not",
  "of",
  "or",
  "that",
  "the",
  "to",
  "use",
  "ways",
  "with",
  "without",
  "you",
  "your",
]);

const mustTranslatePhrases = new Set([
  "Free public AI learning platform",
  "Open guest chat",
  "Practical guide",
  "Read the mission",
  "Start learning",
  "Transcript",
]);

export function isTranslationBundleCompleteAndFluent(
  source: TranslationSource,
  bundle: TranslationBundle | null,
  language: SupportedLanguage,
) {
  if (language === defaultLanguage) return true;
  if (!bundle || bundle.sourceHash !== source.sourceHash) return false;

  return Object.entries(source.sourceStrings).every(([key, sourceText]) => {
    const translated = bundle.strings[key];
    return isLikelyFluentSiteTranslation(sourceText, translated, language);
  });
}

function isLikelyFluentSiteTranslation(
  sourceText: string,
  translated: string | undefined,
  language: SupportedLanguage,
) {
  if (language === defaultLanguage) return Boolean(translated?.trim());
  if (!translated?.trim()) return false;

  const normalizedSource = comparableText(sourceText);
  const normalizedTranslated = comparableText(translated);
  if (!normalizedTranslated) return false;
  if (normalizedSource === normalizedTranslated && isPreservableLiteral(sourceText)) return true;
  if (normalizedSource === normalizedTranslated && shouldTranslateSourceText(sourceText)) return false;

  return !hasLikelyEnglishLeakage(sourceText, translated);
}

function shouldTranslateSourceText(sourceText: string) {
  if (mustTranslatePhrases.has(sourceText.trim())) return true;
  const sourceWords = latinWordTokens(sourceText).filter((word) => !protectedTerms.has(word));
  return sourceWords.length >= 4;
}

function isPreservableLiteral(sourceText: string) {
  const value = sourceText.trim();
  if (!value) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^(?:mailto:|tel:)/i.test(value)) return true;
  if (/^\\u[0-9a-fA-F]{4}$/.test(value)) return true;
  if (/^[a-z]+(?:\s+[a-z_][a-z0-9_-]*=[a-z_][a-z0-9_-]*)+$/i.test(value)) return true;
  if (/^[a-z0-9_-]+(?:,[a-z0-9_-]+)+$/i.test(value)) return true;
  return false;
}

function hasLikelyEnglishLeakage(sourceText: string, translated: string) {
  const sourceWords = latinWordTokens(sourceText).filter((word) => !protectedTerms.has(word));
  const translatedWords = latinWordTokens(translated).filter((word) => !protectedTerms.has(word));
  if (sourceWords.length < 5 || translatedWords.length < 5) return false;

  const sourceEnglishCount = sourceWords.filter((word) => englishLeakageWords.has(word)).length;
  if (sourceEnglishCount < 3) return false;

  const leakedWords = translatedWords.filter((word) => englishLeakageWords.has(word));
  const leakedFunctionWords = leakedWords.filter((word) => englishFunctionLeakageWords.has(word));
  const leakageRatio = leakedWords.length / translatedWords.length;
  if (!isMostlyNonLatinText(translated)) {
    const functionLeakageRatio = leakedFunctionWords.length / translatedWords.length;
    return leakedFunctionWords.length >= 3 && functionLeakageRatio >= 0.12;
  }
  return leakedWords.length >= 3 && leakageRatio >= 0.18;
}

function isMostlyNonLatinText(value: string) {
  const latin = value.match(/[A-Za-z]/g)?.length ?? 0;
  const nonLatin = value.match(/[^\u0000-\u024f\s\d\p{P}\p{S}]/gu)?.length ?? 0;
  return nonLatin > latin;
}

function comparableText(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "")
    .replace(/\{[a-zA-Z0-9_]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function latinWordTokens(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized.match(/[a-z][a-z'-]*/g) ?? [];
}
