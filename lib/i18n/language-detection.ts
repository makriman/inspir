import {
  defaultLanguage,
  languageCodeToLanguage,
  normalizeLocaleOrLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";

const countryLanguageOverrides: Record<string, SupportedLanguage> = {
  AE: "Arabic",
  AF: "Persian",
  AM: "Armenian",
  AZ: "Azerbaijani",
  BD: "Bengali",
  BG: "Bulgarian",
  BH: "Arabic",
  BA: "Bosnian",
  BR: "Portuguese",
  CN: "Chinese",
  CZ: "Czech",
  DK: "Danish",
  EE: "Estonian",
  EG: "Arabic",
  ES: "Spanish",
  ET: "Amharic",
  FI: "Finnish",
  FR: "French",
  GE: "Georgian",
  GR: "Greek",
  HR: "Croatian",
  HU: "Hungarian",
  ID: "Indonesian",
  IL: "Hebrew",
  IN: "Hindi",
  IR: "Persian",
  IS: "Icelandic",
  IT: "Italian",
  JP: "Japanese",
  KE: "Swahili",
  KR: "Korean",
  LK: "Sinhala",
  LT: "Lithuanian",
  LV: "Latvian",
  MA: "Arabic",
  ML: "French",
  MY: "Malay",
  NG: "Hausa",
  NL: "Dutch",
  NO: "Norwegian",
  NP: "Nepali",
  OM: "Arabic",
  PK: "Urdu",
  PL: "Polish",
  PT: "Portuguese",
  RO: "Romanian",
  RS: "Serbian",
  RU: "Russian",
  SA: "Arabic",
  SE: "Swedish",
  SI: "Slovenian",
  SK: "Slovak",
  SO: "Somali",
  TH: "Thai",
  TR: "Turkish",
  UA: "Ukrainian",
  VN: "Vietnamese",
  ZA: "Zulu",
};

const nonGeographicCountryCodes = new Set(["XX", "T1"]);

export function recommendLanguage(input: {
  countryCode?: string | null;
  acceptLanguage?: string | null;
  fallback?: SupportedLanguage;
}) {
  return (
    recommendLanguageFromCountry(input.countryCode) ??
    recommendLanguageFromAcceptLanguage(input.acceptLanguage) ??
    input.fallback ??
    defaultLanguage
  );
}

export function recommendLanguageFromCountry(countryCode?: string | null) {
  const country = countryCode?.trim().toUpperCase();
  if (!country) return null;
  if (nonGeographicCountryCodes.has(country)) return null;
  if (countryLanguageOverrides[country]) return countryLanguageOverrides[country];

  try {
    const likely = new Intl.Locale(`und-${country}`).maximize().language.toLowerCase();
    return languageCodeToLanguage[likely] ?? null;
  } catch {
    return null;
  }
}

function recommendLanguageFromAcceptLanguage(value?: string | null) {
  if (!value) return null;

  const ranked = value
    .split(",")
    .map((entry) => {
      const [locale, qValue] = entry.trim().split(";q=");
      const q = qValue ? Number.parseFloat(qValue) : 1;
      return { locale, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.locale)
    .sort((a, b) => b.q - a.q);

  for (const entry of ranked) {
    const language = normalizeLocaleOrLanguage(entry.locale);
    if (supportedLanguages.includes(language)) return language;
  }

  return null;
}
