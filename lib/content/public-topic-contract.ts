import type { TopicMetadata, TopicModelProfile, TopicUiMode } from "@/lib/content/topics";

export type PublicSeededTopic = {
  id: string;
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
  iconUrl: null;
  sortOrder: number;
  metadata: TopicMetadata;
};

const topicUiModes: readonly TopicUiMode[] = [
  "chat",
  "quiz",
  "flashcards",
  "time-travel",
  "historical-person",
  "interactive-instruction",
  "collaborative-instruction",
  "socratic-instruction",
  "study-timer",
  "focus-music",
];
const topicModelProfiles: readonly TopicModelProfile[] = ["fast", "reasoning", "structured"];

export function parsePublicTopicsResponse(value: unknown): PublicSeededTopic[] | null {
  if (!isRecord(value) || !Array.isArray(value.topics)) return null;
  const topics = value.topics.map(parsePublicTopic);
  if (topics.some((topic) => topic === null)) return null;
  const completeTopics = topics.filter((topic): topic is PublicSeededTopic => topic !== null);
  if (completeTopics.length < 50 || completeTopics.length > 100) return null;
  if (new Set(completeTopics.map((topic) => topic.slug)).size !== completeTopics.length) return null;
  return completeTopics;
}

function parsePublicTopic(value: unknown): PublicSeededTopic | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const slug = nonEmptyString(value.slug);
  const name = nonEmptyString(value.name);
  const subText = nonEmptyString(value.subText);
  const description = nonEmptyString(value.description);
  const inputboxText = nonEmptyString(value.inputboxText);
  const metadata = parseTopicMetadata(value.metadata);
  if (
    !id ||
    !slug ||
    id !== slug ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !name ||
    !subText ||
    !description ||
    !inputboxText ||
    value.iconUrl !== null ||
    typeof value.sortOrder !== "number" ||
    !Number.isInteger(value.sortOrder) ||
    !metadata
  ) {
    return null;
  }
  return {
    id,
    slug,
    name,
    subText,
    description,
    inputboxText,
    iconUrl: null,
    sortOrder: value.sortOrder,
    metadata,
  };
}

function parseTopicMetadata(value: unknown): TopicMetadata | null {
  if (!isRecord(value)) return null;
  const category = nonEmptyString(value.category);
  const uiMode = value.uiMode;
  const modelProfile = value.modelProfile;
  const starters = stringArray(value.starters);
  if (!category || !isTopicUiMode(uiMode) || !isTopicModelProfile(modelProfile) || !starters) {
    return null;
  }
  const keywords = value.keywords === undefined ? undefined : stringArray(value.keywords);
  const source = value.source === undefined ? undefined : nonEmptyString(value.source);
  const toolId = value.toolId === undefined ? undefined : nonEmptyString(value.toolId);
  if (
    (value.keywords !== undefined && !keywords) ||
    (value.source !== undefined && !source) ||
    (value.toolId !== undefined && !toolId)
  ) {
    return null;
  }
  return {
    category,
    uiMode,
    modelProfile,
    starters,
    ...(keywords ? { keywords } : {}),
    ...(source ? { source } : {}),
    ...(toolId ? { toolId } : {}),
  };
}

function isTopicUiMode(value: unknown): value is TopicUiMode {
  return typeof value === "string" && topicUiModes.some((candidate) => candidate === value);
}

function isTopicModelProfile(value: unknown): value is TopicModelProfile {
  return typeof value === "string" && topicModelProfiles.some((candidate) => candidate === value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.map(nonEmptyString);
  return strings.some((entry) => entry === null)
    ? null
    : strings.filter((entry): entry is string => entry !== null);
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
