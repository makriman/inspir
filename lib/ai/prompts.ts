import type { Message, Topic } from "@/lib/db/schema";
import type { TopicMetadata } from "@/lib/content/topics";
import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import { formatMemoryPromptContext, type MemoryPromptContext } from "@/lib/ai/memory";

type TopicLike = Pick<Topic, "name" | "slug" | "systemPrompt" | "metadata">;

export const INSPIR_TUTOR_CONTRACT = [
  "You are inspir Buddy, a warm, rigorous learning companion for Inspir.",
  "Mission: make learning accessible, engaging, enjoyable, and useful for every learner.",
  "Teach by helping the learner think, not by overwhelming them. Prefer short, active turns over lectures.",
  "Adapt to the learner's level, language, emotional state, and goal. Ask for missing context when it materially changes the help.",
  "Be accurate and humble. State uncertainty, distinguish facts from speculation, and never invent citations or live verification.",
  "Be safe for young learners: avoid inappropriate content, unsafe instructions, shaming, or manipulation.",
  "Use GitHub-flavored Markdown when it improves clarity: headings, bullets, tables, checklists, and compact examples.",
  "When the mode has turn-taking rules, preserve them exactly.",
].join("\n");

export function getTopicMetadata(topic: Pick<TopicLike, "metadata">): TopicMetadata | undefined {
  const metadata = topic.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return metadata as TopicMetadata;
}

type LearnerContext = {
  learnerAge?: number | null;
  memoryContext?: MemoryPromptContext;
};

export function buildTopicSystemPrompt(
  topic: TopicLike,
  preferredLanguage = defaultLanguage,
  context: LearnerContext = {},
) {
  const metadata = getTopicMetadata(topic);
  const language = normalizeLanguage(preferredLanguage);
  return [
    INSPIR_TUTOR_CONTRACT,
    `\nSelected mode: ${topic.name} (${topic.slug})`,
    `Profile language: ${language}`,
    typeof context.learnerAge === "number"
      ? `Learner age: ${context.learnerAge}`
      : undefined,
    formatMemoryPromptContext(context.memoryContext),
    metadata
      ? `Category: ${metadata.category}\nInterface: ${metadata.uiMode}\nModel profile: ${metadata.modelProfile}`
      : undefined,
    "\nMode instructions:",
    topic.systemPrompt,
    "\nResponse rules:",
    "- Stay inside the selected mode unless the learner explicitly asks to switch.",
    `- Respond in ${language}. If the learner asks for a translation, preserve this profile language unless they explicitly request a different language for that reply.`,
    typeof context.learnerAge === "number"
      ? `- The learner is ${context.learnerAge} years old. Adapt content, examples, tone, and safety boundaries appropriately. Do not mention their age unless directly relevant or asked.`
      : undefined,
    "- Keep responses practical, clear, and interactive.",
    "- Prefer one useful next action at the end of each response.",
    metadata?.uiMode === "collaborative-instruction"
      ? "- For collaborative instruction, make artifact changes visible, track decisions and open questions, and keep the user as the decision owner."
      : undefined,
    "- For homework, exams, and graded work, coach understanding instead of producing a dishonest final submission.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildModelMessages(
  topic: TopicLike,
  persistedMessages: Pick<Message, "role" | "content">[],
  preferredLanguage = defaultLanguage,
  context: LearnerContext = {},
) {
  const messages = persistedMessages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    return {
      role: message.role as "user" | "assistant",
      content: message.content,
    };
  });

  return {
    system: buildTopicSystemPrompt(topic, preferredLanguage, context),
    messages,
  };
}
