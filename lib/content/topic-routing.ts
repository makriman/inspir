import { defaultTopicSlug, topicSeeds } from "@/lib/content/topics";

const uuidPathSegmentPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const topicSlugAliases: Record<string, string> = {
  askmeanything: defaultTopicSlug,
  "ask-me-anything": defaultTopicSlug,
};

const knownTopicSlugs = new Set(topicSeeds.map((topic) => topic.slug));

export function isUuidPathSegment(value: string) {
  return uuidPathSegmentPattern.test(value);
}

export function topicPath(slug: string) {
  return `/chat/${slug}`;
}

export function defaultTopicPath() {
  return topicPath(defaultTopicSlug);
}

export function resolveTopicSlug(value: string | null | undefined) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const aliased = topicSlugAliases[normalized] ?? normalized;
  return knownTopicSlugs.has(aliased) ? aliased : undefined;
}

export function isKnownTopicSlug(value: string | null | undefined) {
  return resolveTopicSlug(value) !== undefined;
}
