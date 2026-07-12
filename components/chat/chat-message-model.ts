export type ChatMessage = {
  id: string;
  clientRenderId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string | Date;
  metadata?: Record<string, unknown>;
};

export type MessageMemorySource = {
  type: "memory" | "summary" | "past_chat";
  id: string;
  label: string;
  excerpt: string;
  reason?: string;
  memoryId?: string;
  chatTurnId?: string;
  summarySectionId?: string;
};

export function isPendingAssistantMessage(message: ChatMessage) {
  return message.role === "assistant" && message.metadata?.pendingAssistant === true;
}

export function getChatMessageRenderId(message: ChatMessage) {
  return message.clientRenderId ?? message.id;
}

export function reconcilePersistedChatMessageId(
  message: ChatMessage,
  temporaryMessageId: string,
  persistedMessageId: string,
) {
  if (message.id !== temporaryMessageId) return message;
  return {
    ...message,
    id: persistedMessageId,
    clientRenderId: getChatMessageRenderId(message),
  };
}

export function getMessageContentNextOffset(message: ChatMessage) {
  const offset = message.metadata?.contentNextOffset;
  return typeof offset === "number" && Number.isSafeInteger(offset) && offset > 0
    ? offset
    : null;
}

export function clearPendingAssistantMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata?.pendingAssistant) return metadata;
  const rest = { ...metadata };
  delete rest.pendingAssistant;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function getMessageMemorySources(message: ChatMessage): MessageMemorySource[] {
  const sources = message.metadata?.memorySources;
  if (!Array.isArray(sources)) return [];
  const parsed: MessageMemorySource[] = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const record = source as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.label !== "string" || typeof record.excerpt !== "string") {
      continue;
    }
    const type =
      record.type === "memory" || record.type === "summary" || record.type === "past_chat"
        ? record.type
        : "memory";
    parsed.push({
      type,
      id: record.id,
      label: record.label,
      excerpt: record.excerpt,
      reason: typeof record.reason === "string" ? record.reason : undefined,
      memoryId: typeof record.memoryId === "string" ? record.memoryId : undefined,
      chatTurnId: typeof record.chatTurnId === "string" ? record.chatTurnId : undefined,
      summarySectionId: typeof record.summarySectionId === "string" ? record.summarySectionId : undefined,
    });
  }
  return parsed;
}
