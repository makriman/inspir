const likePatternEncoder = new TextEncoder();

export function d1ContainsLikePattern(value: string, maxBytes = 50) {
  const byteBudget = Math.max(0, maxBytes - 2);
  let escaped = "";
  let bytes = 0;

  for (const character of value.trim()) {
    const next = /[\\%_]/.test(character) ? `\\${character}` : character;
    const nextBytes = likePatternEncoder.encode(next).byteLength;
    if (bytes + nextBytes > byteBudget) break;
    escaped += next;
    bytes += nextBytes;
  }

  return escaped ? `%${escaped}%` : undefined;
}
