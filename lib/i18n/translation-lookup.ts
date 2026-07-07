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
  const templateCandidatePattern = buildTemplateCandidatePattern(templates);
  const resultCache = new Map<string, string>();

  function translate(value: string, depth = 0): string {
    const normalized = normalizeTranslationText(value);
    if (!normalized) return value;
    const cacheKey = `${depth}\u0000${normalized}`;
    const cached = resultCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const directMatch = direct.get(normalized);
    if (directMatch) {
      resultCache.set(cacheKey, directMatch);
      return directMatch;
    }
    if (depth >= 2 || !templateCandidatePattern?.test(normalized)) {
      resultCache.set(cacheKey, normalized);
      return normalized;
    }

    for (const template of templates) {
      const match = template.pattern.exec(normalized);
      if (!match) continue;

      let output = template.translated;
      template.placeholders.forEach((placeholder, index) => {
        const captured = match[index + 1] ?? "";
        const localizedCapture = translate(captured, depth + 1);
        output = output.replaceAll(placeholder, localizedCapture);
      });
      resultCache.set(cacheKey, output);
      return output;
    }

    resultCache.set(cacheKey, normalized);
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

function buildTemplateCandidatePattern(templates: CompiledTemplate[]) {
  const hints = new Set<string>();
  for (const template of templates) {
    for (const hint of template.source.split(placeholderPattern)) {
      const normalized = normalizeTranslationText(hint);
      if (normalized.length >= 3 && /\p{L}/u.test(normalized)) hints.add(normalized);
    }
  }

  if (!hints.size) return null;
  return new RegExp(Array.from(hints).sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"), "iu");
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
