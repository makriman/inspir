export type StoreTopicMetadata = {
  category?: string;
  starters?: string[];
  keywords?: string[];
  source?: string;
  uiMode?: string;
};

export type LearningStoreTopic = {
  id: string;
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
  metadata?: StoreTopicMetadata | Record<string, unknown> | null;
};

export function storeTopicMetadata(topic: LearningStoreTopic): StoreTopicMetadata {
  const metadata = topic.metadata;
  if (!metadata || typeof metadata !== "object") return {};
  return metadata as StoreTopicMetadata;
}

export function learningFeatureCategory(topic: LearningStoreTopic) {
  return storeTopicMetadata(topic).category ?? "Learning";
}

export function getDefaultSidebarTopicIds(topics: LearningStoreTopic[]) {
  const ids: string[] = [];
  const seenCategories = new Set<string>();
  for (const topic of topics) {
    const category = learningFeatureCategory(topic);
    if (seenCategories.has(category)) continue;
    seenCategories.add(category);
    ids.push(topic.id);
  }
  return ids;
}

function topicSearchText(topic: LearningStoreTopic) {
  const metadata = storeTopicMetadata(topic);
  return [
    topic.name,
    topic.subText,
    topic.description,
    topic.inputboxText,
    metadata.category,
    metadata.uiMode,
    metadata.source,
    ...(metadata.starters ?? []),
    ...(metadata.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function searchTopics(topics: LearningStoreTopic[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return topics;
  return topics
    .filter((topic) => topicSearchText(topic).includes(q))
    .sort((a, b) => {
      const aName = a.name.toLowerCase().includes(q);
      const bName = b.name.toLowerCase().includes(q);
      if (aName && !bName) return -1;
      if (!aName && bName) return 1;
      return a.name.localeCompare(b.name);
    });
}
