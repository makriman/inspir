export function placeholdersIn(value: string) {
  return value.match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
}

export function validateTranslationPayload(
  sourceStrings: Record<string, string>,
  translatedStrings: Record<string, string>,
) {
  const sourceKeys = Object.keys(sourceStrings).sort();
  const translatedKeys = Object.keys(translatedStrings).sort();
  if (sourceKeys.length !== translatedKeys.length) return false;
  for (let index = 0; index < sourceKeys.length; index += 1) {
    const key = sourceKeys[index];
    if (key !== translatedKeys[index]) return false;
    const sourcePlaceholders = placeholdersIn(sourceStrings[key]).sort().join("|");
    const translatedPlaceholders = placeholdersIn(translatedStrings[key]).sort().join("|");
    if (sourcePlaceholders !== translatedPlaceholders) return false;
    if (!translatedStrings[key]?.trim()) return false;
  }
  return true;
}

export function isFreshAppTranslation(
  translation: { sourceHash: string } | null | undefined,
  sourceHash: string,
) {
  return translation?.sourceHash === sourceHash;
}
