type CompiledTemplate = {
  source: string;
  translated: string;
  placeholders: string[];
  pattern: RegExp;
};

export type TranslationLookup = {
  size: number;
  translate: (value: string) => string;
};

const placeholderPattern = /\{[a-zA-Z0-9_]+\}/g;

export function createTranslationLookup(entries: Iterable<[string, string]>): TranslationLookup {
  const direct = new Map<string, string>();
  const templates: CompiledTemplate[] = [];

  for (const [source, translated] of entries) {
    const normalizedSource = normalizeTranslationText(source);
    const normalizedTranslated = normalizeTranslationText(translated);
    if (!normalizedSource || !normalizedTranslated) continue;

    direct.set(normalizedSource, normalizedTranslated);
    const template = compileTemplate(normalizedSource, normalizedTranslated);
    if (template) templates.push(template);
  }

  templates.sort((a, b) => b.source.length - a.source.length);

  function translate(value: string, depth = 0): string {
    const normalized = normalizeTranslationText(value);
    if (!normalized) return value;

    const directMatch = direct.get(normalized);
    if (directMatch) return directMatch;
    if (depth >= 2) return normalized;

    for (const template of templates) {
      const match = template.pattern.exec(normalized);
      if (!match) continue;

      let output = template.translated;
      template.placeholders.forEach((placeholder, index) => {
        const captured = match[index + 1] ?? "";
        const localizedCapture = translate(captured, depth + 1);
        output = output.replaceAll(placeholder, localizedCapture);
      });
      return output;
    }

    return normalized;
  }

  return {
    size: direct.size,
    translate,
  };
}

export function normalizeTranslationText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function compileTemplate(source: string, translated: string): CompiledTemplate | null {
  const sourcePlaceholders = source.match(placeholderPattern) ?? [];
  if (!sourcePlaceholders.length || !hasTranslatableLiteral(source)) return null;

  const translatedPlaceholders = translated.match(placeholderPattern) ?? [];
  if (sourcePlaceholders.slice().sort().join("|") !== translatedPlaceholders.slice().sort().join("|")) {
    return null;
  }

  const pattern = new RegExp(`^${templatePattern(source)}$`, "u");
  return {
    source,
    translated,
    placeholders: sourcePlaceholders,
    pattern,
  };
}

function templatePattern(source: string) {
  let pattern = "";
  let cursor = 0;
  for (const match of source.matchAll(placeholderPattern)) {
    pattern += literalPattern(source.slice(cursor, match.index));
    pattern += "(.+?)";
    cursor = (match.index ?? 0) + match[0].length;
  }
  pattern += literalPattern(source.slice(cursor));
  return pattern;
}

function literalPattern(value: string) {
  return escapeRegExp(value).replace(/\\ /g, "\\s+");
}

function hasTranslatableLiteral(value: string) {
  const literal = value.replace(placeholderPattern, " ");
  return /\p{L}/u.test(literal);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
