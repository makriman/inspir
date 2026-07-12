import { placeholdersIn } from "@/lib/i18n/translation-validation";

const languageSpecificIdenticalTranslations: Record<string, ReadonlySet<string>> = {
  French: new Set(["Blog", "Mission", "Modes", "Social"]),
  German: new Set(["Blog", "Mission", "Social", "Start"]),
  Italian: new Set(["Blog", "Media", "Privacy", "Social"]),
  Portuguese: new Set(["Blog", "Media", "Privacy", "Prompts", "Social"]),
  Polish: new Set(["Blog", "Media", "Social", "Start"]),
  Romanian: new Set(["Blog", "Media", "Prompts", "Social"]),
  Spanish: new Set(["Blog", "Prompts", "Social", "agenda"]),
  Dutch: new Set([
    "Blog",
    "Media",
    "Privacy",
    "Social",
    "Start",
    "Start 10 min",
  ]),
  Czech: new Set(["Sparring partner"]),
  Indonesian: new Set(["2 September 1666", "Media"]),
  Malay: new Set(["2 September 1666", "Media"]),
  Afrikaans: new Set(["2 September 1666", "Media"]),
  Yoruba: new Set(["Media"]),
  Norwegian: new Set(["Blog", "Media", "Social", "Start", "Start 10 min"]),
  Swedish: new Set(["Blog", "Media", "Social", "Start"]),
  Danish: new Set(["Blog", "Media", "Mission", "Social", "Start", "Start 10 min"]),
  Finnish: new Set(["Blog", "Media", "Social"]),
  Catalan: new Set(["Modes"]),
  Welsh: new Set(["Map"]),
  Albanian: new Set(["Media"]),
  Azerbaijani: new Set(["Media"]),
};

const globalIdenticalTranslations = new Set(["GitHub", "inspir", "STEM"]);
const historicalProperNameLiterals = new Set([
  "Ada Lovelace, Cleopatra, B. R. Ambedkar...",
  "B. R. Ambedkar",
  "Chandni Chowk",
  "Chang'an",
  "Fatehpur Sikri",
  "Faubourg Saint-Antoine",
  "Kashmere Gate",
  "Les Invalides",
  "Pudding Lane",
  "Stoa Basileios",
  "West Market",
  "Winston Churchill",
]);
const mustTranslatePhrases = new Set([
  "AI Homework Coach With Hints, Not Answer Dumping",
  "AI Learning Mode",
  "Ask anything",
  "Free public AI learning platform",
  "Get unstuck",
  "Homework Coach",
  "Learn Anything",
  "Learn Anything With a Free AI Tutor",
  "Open guest chat",
  "Practical guide",
  "Public AI learning platform",
  "Read the mission",
  "Socratic Instruction",
  "Socratic tutor",
  "Start learning",
  "Think deeper",
  "Transcript",
]);
const mustTranslateSingleWords = new Set([
  "About",
  "Answer",
  "Compare",
  "Continue",
  "Learn",
  "Map",
  "Media",
  "Mission",
  "Modes",
  "Paths",
  "Privacy",
  "Prompts",
  "Schools",
  "Start",
  "Subjects",
  "Terms",
  "Trust",
]);

export function isValidFieldTranslation(source: string, value: string | undefined, language?: string) {
  if (!value?.trim()) return false;
  const sourcePlaceholders = placeholdersIn(source).sort().join("|");
  const valuePlaceholders = placeholdersIn(value).sort().join("|");
  if (sourcePlaceholders !== valuePlaceholders) return false;
  if (hasLikelyExtraneousTranslationArtifact(source, value, language)) return false;
  if (source.trim() === value.trim() && !canRemainUntranslated(source, language)) return false;
  return true;
}

/**
 * Returns true only for source literals that are deliberately allowed to keep
 * their lexical content. The token comparison permits target-language
 * punctuation around proper names without treating ordinary English UI copy
 * as translated.
 */
export function isPreservedTranslationLiteral(
  source: string,
  value: string | undefined,
  language?: string,
) {
  if (!value?.trim() || !canRemainUntranslated(source, language)) return false;
  if (source.trim() === value.trim()) return true;
  if (!historicalProperNameLiterals.has(source.trim())) return false;
  return lexicalLiteralTokens(source).join("\u0000") === lexicalLiteralTokens(value).join("\u0000");
}

function hasLikelyExtraneousTranslationArtifact(source: string, value: string, language?: string) {
  if (language !== "Spanish") return false;
  if (/\bvuelta\b/i.test(value) && !/\b(?:again|back|cycle|return|round|turn)\b/i.test(source)) return true;
  if (/\btienda\b/i.test(value) && !/\b(?:shop|store|tent)\b/i.test(source)) return true;
  return false;
}

function canRemainUntranslated(source: string, language?: string) {
  const value = source.trim();
  if (mustTranslatePhrases.has(value) || mustTranslateSingleWords.has(value)) return false;
  const literalText = value
    .replace(/\{[a-zA-Z0-9_]+\}/g, "")
    .replace(/\binspir\b/gi, "")
    .trim();
  if (!/[A-Za-z]/.test(literalText)) return true;
  if (!/[A-Za-z]/.test(value)) return true;
  if (globalIdenticalTranslations.has(value)) return true;
  if (isSchemaOrCodeIdentifier(value)) return true;
  if (isEscapedCodeLiteral(value)) return true;
  if (isSlugKeywordList(value)) return true;
  if (language && languageSpecificIdenticalTranslations[language]?.has(value)) return true;
  if (historicalProperNameLiterals.has(value)) return true;
  if (isQuotedHistoricalPlaceYearLiteral(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^\d+\s*[-–]\s*\d+\s*(?:min|mins|minutes|sec|secs|hours?|hrs?)$/i.test(value)) return true;
  return false;
}

function isSchemaOrCodeIdentifier(value: string) {
  if (value === "use client" || value === "use server") return true;
  if (/^[A-Z][A-Za-z]+Object$/.test(value)) return true;
  if (/^[A-Z][A-Za-z]*[a-z][A-Z][A-Za-z]*$/.test(value)) return true;
  if (/^[a-z]+(?:\s+[a-z]+=[a-z_][a-z0-9_]*)+$/i.test(value)) return true;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value)) return true;
  return false;
}

function isQuotedHistoricalPlaceYearLiteral(value: string) {
  return /^["“][\p{L}\p{M} .’'’-]+,\s*\d{3,4}["”]$/u.test(value);
}

function isEscapedCodeLiteral(value: string) {
  return /^\\u[0-9a-fA-F]{4}$/.test(value);
}

function isSlugKeywordList(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+(?:,\s*[a-z0-9]+(?:-[a-z0-9]+)+)*$/.test(value);
}

function lexicalLiteralTokens(value: string) {
  return (value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []);
}
