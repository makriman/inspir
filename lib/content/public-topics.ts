import { topicSeeds } from "@/lib/content/topics";
import type { PublicSeededTopic } from "@/lib/content/public-topic-contract";

export type { PublicSeededTopic } from "@/lib/content/public-topic-contract";

export function getPublicSeededTopics(): PublicSeededTopic[] {
  return topicSeeds.map((topic) => {
    const uiMode = topic.metadata.uiMode === "quiz" || topic.metadata.uiMode === "flashcards"
      ? "chat"
      : topic.metadata.uiMode;
    return {
      id: topic.slug,
      slug: topic.slug,
      name: topic.name,
      subText: topic.subText,
      description: topic.description,
      inputboxText: topic.inputboxText,
      iconUrl: null,
      sortOrder: topic.sortOrder,
      metadata: {
        ...topic.metadata,
        uiMode,
      },
    };
  });
}
