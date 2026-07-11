export const defaultTopicSlug = "learn-anything";

const publicTopicSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const privateIdentifierPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function topicPath(slug: string) {
  return `/chat/${slug}`;
}

export function topicWorkspacePath(slug: string) {
  const normalized = normalizePublicTopicSlug(slug);
  if (!normalized) throw new TypeError();
  return `/chat?topic=${encodeURIComponent(normalized)}`;
}

export function topicSlugFromChatLocation(pathAndSearch: string) {
  const url = new URL(pathAndSearch, "https://inspir.invalid");
  const segments = url.pathname.split("/").filter(Boolean);
  const chatIndex = segments.lastIndexOf("chat");
  const encodedPathSlug = chatIndex >= 0 ? segments[chatIndex + 1] : undefined;
  if (encodedPathSlug) {
    try {
      const pathSlug = normalizePublicTopicSlug(decodeURIComponent(encodedPathSlug));
      if (pathSlug) return pathSlug;
    } catch {
      // Invalid path encoding falls through to the validated query fallback.
    }
  }
  return normalizePublicTopicSlug(url.searchParams.get("topic"));
}

export function defaultTopicPath() {
  return topicPath(defaultTopicSlug);
}

export function defaultTopicWorkspacePath() {
  return topicWorkspacePath(defaultTopicSlug);
}

function normalizePublicTopicSlug(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length <= 120 &&
    publicTopicSlugPattern.test(normalized) &&
    !privateIdentifierPattern.test(normalized)
    ? normalized
    : null;
}
