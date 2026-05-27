import type { Message } from "@/lib/db/schema";

export function buildModelMessages(
  systemPrompt: string,
  persistedMessages: Pick<Message, "role" | "content">[],
) {
  const messages = persistedMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));

  return {
    system:
      systemPrompt +
      "\n\nKeep the response clear, practical, and in the selected module's behavior. Preserve quiz and debate turn-taking when relevant.",
    messages,
  };
}
