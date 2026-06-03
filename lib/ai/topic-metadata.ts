import type { TopicMetadata } from "@/lib/content/topics";

export function getTopicMetadata(topic: { metadata?: unknown }): TopicMetadata | undefined {
  const metadata = topic.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return metadata as TopicMetadata;
}
