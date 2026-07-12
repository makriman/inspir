import type { ChatMessage, MessageMemorySource } from "@/components/chat/chat-message-model";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import { MessageCard } from "@/components/chat/MessageCard";

type CompactTranscriptDetailsProps = {
  messages: ChatMessage[];
  userDisplayName: string;
  olderMessagesAvailable: boolean;
  olderMessagesLoading: boolean;
  isMessageContentLoading: (messageId: string) => boolean;
  onContinueMessageContent: (messageId: string) => void;
  onLoadOlderMessages: () => void;
  onMemorySources: (messageId: string, sources: MessageMemorySource[]) => void;
  t: UiTranslator;
};

export function CompactTranscriptDetails({
  messages,
  userDisplayName,
  olderMessagesAvailable,
  olderMessagesLoading,
  isMessageContentLoading,
  onContinueMessageContent,
  onLoadOlderMessages,
  onMemorySources,
  t,
}: CompactTranscriptDetailsProps) {
  if (messages.length === 0 && !olderMessagesAvailable) return null;

  return (
    <aside className="inspir-compact-transcript">
      <details>
        <summary>
          <span>{t("Past chats")}</span>
          <span aria-hidden="true">{messages.length}</span>
        </summary>
        <div className="inspir-compact-transcript-body app-scrollbar">
          {olderMessagesAvailable ? (
            <button
              type="button"
              className="inspir-compact-transcript-more"
              aria-busy={olderMessagesLoading}
              disabled={olderMessagesLoading}
              onClick={onLoadOlderMessages}
            >
              {t("Past chats")}
            </button>
          ) : null}
          <div className="inspir-compact-transcript-list">
            {messages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                userLabel={userDisplayName}
                contentLoading={isMessageContentLoading(message.id)}
                continueLabel={t("Continue")}
                onContinueContent={onContinueMessageContent}
                onMemorySources={(sources) => onMemorySources(message.id, sources)}
              />
            ))}
          </div>
        </div>
      </details>
    </aside>
  );
}
