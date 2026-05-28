import type { Topic } from "@/lib/db/schema";
import { topicSeeds, type TopicSeed } from "@/lib/content/topics";

const seededTopicDate = new Date("2024-01-01T00:00:00.000Z");

export function topicFromSeed(seed: TopicSeed): Topic {
  return {
    id: seed.slug,
    slug: seed.slug,
    legacyBubbleId: null,
    name: seed.name,
    subText: seed.subText,
    description: seed.description,
    inputboxText: seed.inputboxText,
    systemPrompt: seed.systemPrompt,
    iconUrl: null,
    sortOrder: seed.sortOrder,
    status: "active",
    metadata: seed.metadata,
    createdAt: seededTopicDate,
    updatedAt: seededTopicDate,
  };
}

export function seededTopics() {
  return topicSeeds.map(topicFromSeed);
}

export function findSeededTopic(value: string) {
  const normalized = value.trim().toLowerCase();
  const seed = topicSeeds.find((topic) => topic.slug === normalized);
  return seed ? topicFromSeed(seed) : undefined;
}
