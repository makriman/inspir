import { topicWorkspacePath } from "@/lib/content/topic-path";
import { localizeHref } from "@/lib/i18n/routing";

export type TopicMetadata = {
  category: string;
  uiMode:
    | "chat"
    | "quiz"
    | "flashcards"
    | "time-travel"
    | "historical-person"
    | "interactive-instruction"
    | "collaborative-instruction"
    | "socratic-instruction"
    | "study-timer"
    | "focus-music";
  modelProfile: "fast" | "reasoning" | "structured";
  starters: string[];
  keywords?: string[];
  source?: string;
  toolId?: string;
};

export type Topic = {
  id: string;
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
  metadata?: TopicMetadata | Record<string, unknown> | null;
};

export function topicMetadata(topic: Topic | undefined): TopicMetadata | undefined {
  const metadata = topic?.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  if (!("uiMode" in metadata) || !("starters" in metadata)) return undefined;
  return metadata as TopicMetadata;
}

export function topicIntroProps(topic: Topic) {
  return {
    category: topicMetadata(topic)?.category ?? "Learning",
    name: topic.name,
    description: topic.description,
  };
}

export function localizedTopicHref(topic: Topic, language: string) {
  return localizeHref(topicWorkspacePath(topic.slug), language);
}

export function topicSearchContent(topic: Topic) {
  const metadata = topicMetadata(topic);
  return [
    topic.name,
    topic.subText,
    topic.description,
    topic.inputboxText,
    metadata?.category,
    metadata?.uiMode,
    metadata?.source,
    ...(metadata?.starters ?? []),
    ...(metadata?.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
