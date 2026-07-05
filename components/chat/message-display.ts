import {
  isPendingAssistantMessage,
  type ChatMessage as Message,
} from "@/components/chat/chat-message-model";
import { getVisibleMessageContent } from "@/lib/ai/visible-content";

function toDisplayMessage(message: Message): Message | null {
  if (message.role === "system") return null;
  if (isPendingAssistantMessage(message) && message.content.trim().length === 0) return message;
  const content = getVisibleMessageContent(message.content).trim();
  if (!content) return null;
  return content === message.content ? message : { ...message, content };
}

export function displayMessages(messages: Message[]) {
  return messages.map(toDisplayMessage).filter((message): message is Message => Boolean(message));
}
