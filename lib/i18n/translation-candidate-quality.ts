import {
  defaultLanguage,
  languageConfigs,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { isPreservedTranslationLiteral } from "@/lib/i18n/translation-field-validation";
import { placeholdersIn } from "@/lib/i18n/translation-validation";

export type TranslationCandidateTargetLanguage = Exclude<
  SupportedLanguage,
  typeof defaultLanguage
>;

export type TranslationCandidateQualityFailure =
  | "empty"
  | "non-nfc"
  | "source-equality"
  | "placeholder-parity"
  | "protected-literal-parity"
  | "url-parity"
  | "email-parity"
  | "number-parity"
  | "excessive-length"
  | "repeated-sequence"
  | "negation-marker-missing";

export type TranslationCandidateFieldQuality = {
  failures: TranslationCandidateQualityFailure[];
  sourceNegationMarkers: string[];
};

type TargetNegationLexicon = {
  tokens?: readonly string[];
  prefixes?: readonly string[];
  suffixes?: readonly string[];
  fragments?: readonly string[];
};

const targetNegationLexicons = {
  Hindi: { tokens: ["नहीं", "न", "मत", "ना", "बिना"], fragments: ["के बजाय"] },
  Spanish: { tokens: ["no", "nunca", "jamás", "sin", "ni", "ningún", "ninguna", "ninguno", "nada", "tampoco"], fragments: ["en lugar de"] },
  French: { tokens: ["ne", "pas", "jamais", "sans", "ni", "aucun", "aucune", "rien"], prefixes: ["n’", "n'"] },
  German: { tokens: ["nicht", "nie", "niemals", "ohne", "weder", "noch"], prefixes: ["kein"] },
  Italian: { tokens: ["non", "mai", "senza", "né", "ne"], prefixes: ["nessun"] },
  Portuguese: { tokens: ["não", "nunca", "jamais", "sem", "nem", "nenhum", "nenhuma", "nada"] },
  Dutch: { tokens: ["niet", "geen", "nooit", "zonder", "noch"], prefixes: ["onmogelijk"] },
  Russian: { tokens: ["не", "нет", "никогда", "без", "ни"], prefixes: ["невозмож"] },
  Ukrainian: { tokens: ["не", "ні", "ніколи", "без", "немає"], prefixes: ["немож"] },
  Polish: { tokens: ["nie", "nigdy", "bez", "ani"], prefixes: ["żaden", "żadna", "żadne", "niemoż"] },
  Romanian: { tokens: ["nu", "niciodată", "fără", "nici", "nimic"], prefixes: ["imposibil"] },
  Czech: { tokens: ["ne", "není", "nejsou", "nikdy", "bez", "ani"], prefixes: ["žádn", "nemož", "neměl"] },
  Hungarian: {
    tokens: ["nem", "nincs", "nincsen", "soha", "nélkül", "anélkül", "sem", "se"],
    prefixes: ["lehetetlen"],
  },
  Greek: { tokens: ["δεν", "δε", "μην", "μη", "όχι", "ποτέ", "χωρίς", "ούτε", "κανένα", "τίποτα"] },
  Turkish: { tokens: ["değil", "yok", "hayır", "hiç", "olmadan"], prefixes: ["değil", "olmayan", "imkânsız", "imkansız"], suffixes: ["sız", "siz", "suz", "süz"] },
  Arabic: {
    tokens: [
      "لا",
      "ليس",
      "ليست",
      "لن",
      "لم",
      "ما",
      "عدم",
      "ألا",
      "الا",
      "لئلا",
      "دون",
      "بدون",
      "غير",
      "أبداً",
      "أبدًا",
      "قط",
      "ولا",
      "وليس",
      "وليست",
      "ولست",
      "ولن",
      "ولم",
      "وما",
      "وعدم",
      "ودون",
      "وبدون",
      "وغير",
      "فلا",
      "فليس",
      "فليست",
      "فلست",
      "فلن",
      "فلم",
      "فعدم",
      "بعدم",
      "لست",
      "لسنا",
      "لستم",
      "ليسوا",
    ],
  },
  Hebrew: { tokens: ["לא", "אין", "בלי", "מעולם", "אל", "אינו", "אינה"] },
  Persian: { tokens: ["نه", "نیست", "بدون", "هرگز"], prefixes: ["نمی", "نا"] },
  Urdu: { tokens: ["نہیں", "نہ", "بغیر", "مت"] },
  Bengali: { tokens: ["না", "নয়", "নেই", "ছাড়া"], prefixes: ["ছাড়া"] },
  Tamil: { tokens: ["இல்லை", "அல்ல", "வேண்டாம்", "இன்றி", "இல்லாமல்"] },
  Telugu: { tokens: ["కాదు", "లేదు", "వద్దు", "లేకుండా"] },
  Marathi: { tokens: ["नाही", "न", "नको", "शिवाय", "विना"] },
  Gujarati: { tokens: ["નથી", "નહીં", "ન", "વગર", "વિના"] },
  Kannada: { tokens: ["ಇಲ್ಲ", "ಅಲ್ಲ", "ಬೇಡ", "ಇಲ್ಲದೆ"] },
  Malayalam: {
    tokens: [
      "ഇല്ല",
      "അല്ല",
      "വേണ്ട",
      "ഇല്ലാതെ",
      "അരുത്",
      "കൂടാ",
      "പാടില്ല",
      "മാത്രമല്ല",
      "നടിക്കണ്ട",
    ],
    suffixes: ["ാതെ", "രുത്", "മല്ല", "യല്ല", "വല്ല", "ളല്ല", "തല്ല", "ക്കണ്ട"],
    fragments: ["ാത്ത", "ാതിരി", "ില്ല"],
  },
  Punjabi: { tokens: ["ਨਹੀਂ", "ਨਾ", "ਬਿਨਾਂ"] },
  Odia: { tokens: ["ନୁହେଁ", "ନାହିଁ", "ନ", "ବିନା"] },
  Assamese: {
    tokens: ["নহয়", "নাই", "ন", "নকৰ", "বিনা"],
    prefixes: ["নকৰ", "নোৱাৰ", "নাছ", "নাল", "নাপ", "নায", "নোহ"],
    suffixes: ["বিহীন"],
  },
  Nepali: { tokens: ["छैन", "होइन", "न", "बिना", "कहिल्यै"] },
  Sinhala: { tokens: ["නැහැ", "නොවේ", "එපා", "රහිතව"], prefixes: ["නො"] },
  Chinese: { fragments: ["不", "没", "無", "无", "未", "别", "勿", "从不", "不能", "没有"] },
  Japanese: { fragments: ["ない", "ません", "なく", "ず", "ぬ", "無", "ではない", "じゃない"] },
  Korean: { fragments: ["않", "못", "없", "아니다", "아니", "말", "없이"] },
  Vietnamese: { tokens: ["không", "chẳng", "chưa", "đừng", "thiếu"] },
  Thai: { fragments: ["ไม่", "มิ", "ไม่มี", "ห้าม", "ไม่เคย"] },
  Indonesian: { tokens: ["tidak", "bukan", "tanpa", "jangan", "belum", "tak", "tiada"] },
  Malay: { tokens: ["tidak", "bukan", "tanpa", "jangan", "belum", "tak", "tiada"] },
  Filipino: { tokens: ["hindi", "wala", "huwag", "kailanman", "walang"] },
  Swahili: { tokens: ["si", "sio", "bila", "hakuna", "kamwe", "hapana"], prefixes: ["haja", "haku", "hawa", "hatu", "ham"] },
  Afrikaans: { tokens: ["nie", "geen", "nooit", "sonder", "nóg", "nog"] },
  Amharic: { fragments: ["አይ", "አል", "የለም", "አይደለም", "ሳይ", "ያለ"] },
  Yoruba: { tokens: ["kò", "ko", "kì", "lai", "láì", "rara"] },
  Zulu: { tokens: ["hhayi", "cha", "ngaphandle", "akukho"], prefixes: ["akufanele", "unga", "enge"] },
  Hausa: { tokens: ["ba", "babu", "kada", "kar"] },
  Somali: { tokens: ["ma", "maya", "aan", "la'aan", "la’aan", "weligiis"] },
  Norwegian: { tokens: ["ikke", "ingen", "aldri", "uten", "verken"] },
  Swedish: { tokens: ["inte", "ingen", "aldrig", "utan", "varken"] },
  Danish: { tokens: ["ikke", "ingen", "aldrig", "uden", "hverken"] },
  Finnish: { tokens: ["ei", "en", "et", "emme", "ette", "eivät", "ilman", "koskaan", "älä"], suffixes: ["matta", "mättä"] },
  Icelandic: { tokens: ["ekki", "engin", "aldrei", "án", "hvorki"] },
  Irish: { tokens: ["ní", "níl", "nach", "gan", "riamh", "ná"] },
  Welsh: { tokens: ["ddim", "dim", "heb", "byth", "nid", "nac"] },
  Catalan: { tokens: ["no", "mai", "sense", "ni", "cap"] },
  Basque: { tokens: ["ez", "gabe", "inoiz", "ezean"] },
  Galician: { tokens: ["non", "nunca", "sen", "nin", "ningún", "ningunha"] },
  Serbian: { tokens: ["не", "није", "никад", "никада", "без", "ни"] },
  Croatian: { tokens: ["ne", "nije", "nikad", "nikada", "bez", "niti"] },
  Bosnian: { tokens: ["ne", "nije", "nikad", "nikada", "bez", "niti"] },
  Bulgarian: { tokens: ["не", "няма", "никога", "без", "нито"] },
  Slovak: { tokens: ["nie", "nikdy", "bez", "ani"], prefixes: ["žiadn", "nemož"] },
  Slovenian: { tokens: ["ne", "ni", "nikoli", "brez", "niti", "noben"] },
  Lithuanian: { tokens: ["ne", "nėra", "niekada", "be", "nei", "joks"], prefixes: ["negal"] },
  Latvian: { tokens: ["ne", "nav", "nekad", "bez"], prefixes: ["nedrīkst", "nevar"] },
  Estonian: { tokens: ["ei", "pole", "mitte", "kunagi", "ilma", "ega"] },
  Albanian: { tokens: ["nuk", "jo", "pa", "kurrë", "asnjë", "mos"] },
  Georgian: { tokens: ["არ", "არა", "ვერ", "გარეშე", "არასდროს", "ნუ"] },
  Armenian: { tokens: ["ոչ", "առանց", "երբեք", "մի"], prefixes: ["չ"] },
  Azerbaijani: { tokens: ["deyil", "yox", "heç", "olmadan"], prefixes: ["deyil", "mümkünsüz"], suffixes: ["sız", "siz", "suz", "süz"] },
} satisfies Record<TranslationCandidateTargetLanguage, TargetNegationLexicon>;

const protectedPatterns = [
  /\binspir\b/giu,
  /\b(?:29AAWFG7015K1ZQ|American Express|ChatGPT|Dailyhunt|DeepHack|Great Indian Company|GitHub|Google|Holding Partnership Firm|Mastercard|OpenAI|Visa)\b/giu,
  /\{[a-zA-Z0-9_]+\}/g,
  /https?:\/\/[^\s<>"']+/giu,
  /(?:mailto:|tel:)[^\s<>"']+/giu,
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu,
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}\b/giu,
  /`[^`\n]+`/g,
  /\\u[0-9a-fA-F]{4}/g,
  /(?<![\p{L}\p{N}])\/(?:[a-z_][a-z0-9_.-]*\/)*(?:[a-z_][a-z0-9_.?=&%#-]*)/giu,
] as const;

const urlPattern = /https?:\/\/[^\s<>"']+/giu;
const emailPattern = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu;
const numericPattern = /[+\-\u2212]?\p{Nd}+(?:[.,\u060c\u066b\u066c:/-]\p{Nd}+)*(?:\s*[%\u066a])?/gu;
const sourceNegationPattern =
  /\b(?:not|no|never|without|neither|nor|none|nothing|nobody|nowhere|cannot|unable|can['’]t|don['’]t|doesn['’]t|didn['’]t|won['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|shouldn['’]t|wouldn['’]t|couldn['’]t|mustn['’]t|haven['’]t|hasn['’]t|hadn['’]t)\b/giu;

const decimalZeroCodePoints = [
  0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6,
  0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0,
  0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80,
  0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900,
  0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30, 0x11066,
  0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0, 0x11650,
  0x116c0, 0x11730, 0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0,
  0x16a60, 0x16ac0, 0x16b50, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec,
  0x1d7f6, 0x1e140, 0x1e2f0, 0x1e4f0, 0x1e950, 0x1fbf0,
] as const;

type ProtectedSpan = {
  start: number;
  end: number;
  value: string;
};

export function validateTranslationCandidateField(input: {
  language: TranslationCandidateTargetLanguage;
  source: string;
  value: string;
}): TranslationCandidateFieldQuality {
  const { language, source, value } = input;
  if (!value.trim()) return { failures: ["empty"], sourceNegationMarkers: [] };

  const failures: TranslationCandidateQualityFailure[] = [];
  if (value !== value.normalize("NFC")) failures.push("non-nfc");
  if (
    source.trim().normalize("NFC") === value.trim().normalize("NFC") &&
    !isPreservedTranslationLiteral(source, value, language)
  ) {
    failures.push("source-equality");
  }
  if (!sameMultiset(placeholdersIn(source), placeholdersIn(value))) {
    failures.push("placeholder-parity");
  }
  if (!sameMultiset(protectedLiteralsIn(source), protectedLiteralsIn(value))) {
    failures.push("protected-literal-parity");
  }
  if (!sameMultiset(regexMatches(source, urlPattern), regexMatches(value, urlPattern))) {
    failures.push("url-parity");
  }
  if (!sameMultiset(regexMatches(source, emailPattern), regexMatches(value, emailPattern))) {
    failures.push("email-parity");
  }
  if (!sameMultiset(numericLiteralsIn(source), numericLiteralsIn(value))) {
    failures.push("number-parity");
  }
  if (hasExcessiveTranslationLength(source, value)) {
    failures.push("excessive-length");
  }
  if (hasRepeatedSequenceDegeneration(source, value, language)) {
    failures.push("repeated-sequence");
  }
  const sourceNegationMarkers = explicitSourceNegationMarkers(source);
  if (sourceNegationMarkers.length && !hasTargetNegationMarker(value, language)) {
    failures.push("negation-marker-missing");
  }
  return { failures, sourceNegationMarkers };
}

function explicitSourceNegationMarkers(value: string) {
  return Array.from(value.matchAll(sourceNegationPattern), (match) => match[0].toLowerCase()).sort();
}

export function hasTargetNegationMarker(
  value: string,
  language: TranslationCandidateTargetLanguage,
) {
  const lexicon: TargetNegationLexicon = targetNegationLexicons[language];
  const normalized = value.normalize("NFC").toLocaleLowerCase("und");
  const tokens =
    normalized.match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?/gu) ?? [];
  const tokenSet = new Set(tokens);
  if (lexicon.tokens?.some((marker) => tokenSet.has(marker))) return true;
  if (lexicon.prefixes?.some((marker) => tokens.some((token) => token.startsWith(marker)))) {
    return true;
  }
  if (
    lexicon.suffixes?.some((marker) =>
      tokens.some((token) => token.length > marker.length && token.endsWith(marker)),
    )
  ) {
    return true;
  }
  return lexicon.fragments?.some((marker) => normalized.includes(marker)) ?? false;
}

export function protectedLiteralsIn(value: string) {
  const candidates: ProtectedSpan[] = [];
  for (const pattern of protectedPatterns) {
    for (const match of value.matchAll(pattern)) {
      if (match.index === undefined || !match[0]) continue;
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        value: match[0],
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      left.value.localeCompare(right.value),
  );
  const selected: ProtectedSpan[] = [];
  let cursor = -1;
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;
    selected.push(candidate);
    cursor = candidate.end;
  }
  return selected.map((entry) => entry.value).sort();
}

export function numericLiteralsIn(value: string) {
  return regexMatches(value, numericPattern).map(normalizeNumericLiteral).sort();
}

export function hasExcessiveTranslationLength(source: string, value: string) {
  const sourceLength = nonWhitespaceCodePointLength(source);
  const valueLength = nonWhitespaceCodePointLength(value);
  return valueLength > Math.max(200, sourceLength * 3);
}

export function hasRepeatedSequenceDegeneration(
  source: string,
  value: string,
  language: TranslationCandidateTargetLanguage,
) {
  const sourceRepeat = strongestConsecutiveRepeat(source, "English");
  const valueRepeat = strongestConsecutiveRepeat(value, language);
  if (!valueRepeat) return false;
  if (!sourceRepeat) return true;
  return (
    valueRepeat.repeatedTokens > sourceRepeat.repeatedTokens &&
    valueRepeat.coverage > sourceRepeat.coverage
  );
}

type ConsecutiveRepeat = {
  repeatedTokens: number;
  coverage: number;
};

const wordSegmenters = new Map<SupportedLanguage, Intl.Segmenter>();

function strongestConsecutiveRepeat(
  value: string,
  language: SupportedLanguage,
): ConsecutiveRepeat | null {
  const tokens = wordTokens(value, language);
  let strongest: ConsecutiveRepeat | null = null;
  for (let start = 0; start < tokens.length; start += 1) {
    for (let unitLength = 1; unitLength <= 12; unitLength += 1) {
      if (start + unitLength * 2 > tokens.length) break;
      let repeats = 1;
      while (
        start + unitLength * (repeats + 1) <= tokens.length &&
        equalTokenRange(tokens, start, start + unitLength * repeats, unitLength)
      ) {
        repeats += 1;
      }
      const minimumRepeats = unitLength === 1 ? 5 : 3;
      const repeatedTokens = unitLength * repeats;
      const coverage = repeatedTokens / tokens.length;
      if (repeats < minimumRepeats || repeatedTokens < 6 || coverage < 0.35) continue;
      if (
        !strongest ||
        repeatedTokens > strongest.repeatedTokens ||
        (repeatedTokens === strongest.repeatedTokens && coverage > strongest.coverage)
      ) {
        strongest = { repeatedTokens, coverage };
      }
    }
  }
  return strongest;
}

function wordTokens(value: string, language: SupportedLanguage) {
  const normalized = value.normalize("NFC").toLocaleLowerCase("und");
  try {
    let segmenter = wordSegmenters.get(language);
    if (!segmenter) {
      segmenter = new Intl.Segmenter(languageConfigs[language].locale, {
        granularity: "word",
      });
      wordSegmenters.set(language, segmenter);
    }
    return Array.from(segmenter.segment(normalized))
      .filter((entry) => entry.isWordLike)
      .map((entry) => entry.segment);
  } catch {
    return normalized.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  }
}

function equalTokenRange(
  tokens: readonly string[],
  leftStart: number,
  rightStart: number,
  length: number,
) {
  for (let offset = 0; offset < length; offset += 1) {
    if (tokens[leftStart + offset] !== tokens[rightStart + offset]) return false;
  }
  return true;
}

function nonWhitespaceCodePointLength(value: string) {
  return Array.from(value.normalize("NFC").replace(/\s/gu, "")).length;
}

function regexMatches(value: string, pattern: RegExp) {
  return Array.from(value.matchAll(pattern), (match) => match[0]).sort();
}

function sameMultiset(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((entry, index) => entry === sortedRight[index])
  );
}

function normalizeNumericLiteral(value: string) {
  let result = "";
  for (const character of value.normalize("NFKC")) {
    if (/\p{Nd}/u.test(character)) {
      result += decimalDigitValue(character);
      continue;
    }
    if (character === "\u2212") result += "-";
    else if (character === "\u066a") result += "%";
    else if (character === "\u066b") result += ".";
    else if (character === "\u066c" || character === "\u060c") result += ",";
    else if (!/\s/u.test(character)) result += character;
  }
  return result;
}

function decimalDigitValue(character: string) {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) throw new Error("Could not inspect a decimal digit.");
  for (const zero of decimalZeroCodePoints) {
    if (codePoint >= zero && codePoint <= zero + 9) return String(codePoint - zero);
  }
  throw new Error(`Unsupported Unicode decimal digit U+${codePoint.toString(16).toUpperCase()}.`);
}
