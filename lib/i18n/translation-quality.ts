import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
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
  "film",
  "first",
  "flashcards",
  "for",
  "free",
  "from",
  "guide",
  "guided",
  "guides",
  "has",
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
  "markers",
  "mode",
  "modes",
  "not",
  "of",
  "open",
  "or",
  "path",
  "page",
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
  "text",
  "timed",
  "to",
  "tool",
  "topic",
  "topics",
  "transcript",
  "tutor",
  "use",
  "ways",
  "with",
  "without",
  "writing",
  "you",
  "your",
  "captions",
  "chapter",
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

const mustTranslateEmbeddedPhrases = [
  "Homework Coach",
  "Learn Anything",
  "Socratic Instruction",
] as const;

const predominantlyNonLatinLanguages = new Set<SupportedLanguage>([
  "Hindi",
  "Russian",
  "Ukrainian",
  "Greek",
  "Arabic",
  "Hebrew",
  "Persian",
  "Urdu",
  "Bengali",
  "Tamil",
  "Telugu",
  "Marathi",
  "Gujarati",
  "Kannada",
  "Malayalam",
  "Punjabi",
  "Odia",
  "Assamese",
  "Nepali",
  "Sinhala",
  "Chinese",
  "Japanese",
  "Korean",
  "Thai",
  "Amharic",
  "Serbian",
  "Bulgarian",
  "Georgian",
  "Armenian",
]);

export function isTranslationBundleCompleteAndFluent(
  source: TranslationSource,
  bundle: TranslationBundle | null,
  language: SupportedLanguage,
) {
  if (language === defaultLanguage) return true;
  if (!bundle || !isTranslationBundleFieldValid(source, bundle, language)) return false;
  if (hasSuspiciousTranslationReuse(source, bundle)) return false;

  return Object.entries(source.sourceStrings).every(([key, sourceText]) => {
    const translated = bundle.strings[key];
    return isLikelyFluentSiteTranslation(sourceText, translated, language);
  });
}

export function isTranslationBundleFieldValid(
  source: TranslationSource,
  bundle: TranslationBundle | null,
  language: SupportedLanguage,
) {
  if (!bundle || bundle.sourceHash !== source.sourceHash || bundle.language !== language) return false;

  return Object.entries(source.sourceStrings).every(([key, sourceText]) => {
    const translated = bundle.strings[key];
    if (typeof translated !== "string" || translated !== translated.normalize("NFC")) return false;
    return language === defaultLanguage
      ? translated === sourceText
      : isValidFieldTranslation(sourceText, translated, language);
  });
}

function hasSuspiciousTranslationReuse(source: TranslationSource, bundle: TranslationBundle) {
  const sourcesByTranslation = new Map<string, Set<string>>();
  for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
    const translated = bundle.strings[key]?.trim();
    if (!translated) continue;
    const normalized = comparableText(translated);
    if (!normalized) continue;
    const sourceTexts = sourcesByTranslation.get(normalized) ?? new Set<string>();
    sourceTexts.add(comparableText(sourceText));
    if (sourceTexts.size >= 3) return true;
    sourcesByTranslation.set(normalized, sourceTexts);
  }
  return false;
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
  if (
    mustTranslateEmbeddedPhrases.some(
      (phrase) => sourceText.includes(phrase) && translated.includes(phrase),
    )
  ) {
    return false;
  }

  return !hasLikelyEnglishLeakage(sourceText, translated, language);
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

function hasLikelyEnglishLeakage(
  sourceText: string,
  translated: string,
  language: SupportedLanguage,
) {
  const sourceWords = latinWordTokens(sourceText).filter((word) => !protectedTerms.has(word));
  const translatedWords = latinWordTokens(translated).filter((word) => !protectedTerms.has(word));
  if (sourceWords.length < 5) return false;

  if (predominantlyNonLatinLanguages.has(language) && hasUnexpectedLatinDominance(translated)) {
    return true;
  }
  if (translatedWords.length < 5) return false;

  const sourceEnglishCount = sourceWords.filter((word) => englishLeakageWords.has(word)).length;
  if (sourceEnglishCount < 3) return false;

  const sourceEnglishWords = new Set(sourceWords.filter((word) => englishLeakageWords.has(word)));
  const leakedWords = translatedWords.filter((word) => sourceEnglishWords.has(word));
  const leakedFunctionWords = leakedWords.filter((word) => englishFunctionLeakageWords.has(word));
  const leakageRatio = leakedWords.length / translatedWords.length;
  if (!isMostlyNonLatinText(translated)) {
    const functionLeakageRatio = leakedFunctionWords.length / translatedWords.length;
    return (
      (new Set(leakedFunctionWords).size >= 3 && functionLeakageRatio >= 0.12) ||
      (new Set(leakedWords).size >= 4 && leakageRatio >= 0.25)
    );
  }
  return new Set(leakedWords).size >= 3 && leakageRatio >= 0.18;
}

function hasUnexpectedLatinDominance(value: string) {
  const latin = value.match(/[A-Za-z]/g)?.length ?? 0;
  const nonLatin = value.match(/[^\u0000-\u024f\s\d\p{P}\p{S}]/gu)?.length ?? 0;
  return latin >= 24 && latin > nonLatin;
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
  const words = value.toLowerCase().match(/\p{L}+(?:['’-]\p{L}+)*/gu) ?? [];
  return words.filter((word) => /^[a-z]+(?:['-][a-z]+)*$/.test(word));
}
