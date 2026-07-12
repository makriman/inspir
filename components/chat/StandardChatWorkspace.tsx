"use client";

import { FormEvent, KeyboardEvent, RefObject } from "react";
import { Send, Square } from "lucide-react";
import {
  getChatMessageRenderId,
  isPendingAssistantMessage,
  type ChatMessage as Message,
  type MessageMemorySource,
} from "@/components/chat/chat-message-model";
import { MessageCard } from "@/components/chat/MessageCard";
import { StarterGrid } from "@/components/chat/StarterGrid";
import { ThinkingMarker } from "@/components/chat/ThinkingMarker";
import { TopicIntroCard } from "@/components/chat/TopicIntroCard";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import { topicIntroProps, type Topic, type TopicMetadata } from "@/components/chat/topic-model";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";

type StandardChatWorkspaceProps = {
  activeTopic: Topic;
  awaitingResponse: boolean;
  handleComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  metadata?: TopicMetadata;
  olderMessagesAvailable: boolean;
  olderMessagesLoading: boolean;
  sendMessage: (content: string) => Promise<void>;
  sending: boolean;
  setInput: (value: string) => void;
  stopGeneration: () => void;
  streamingMessageId: string | null;
  submitMessage: (event?: FormEvent) => void;
  userDisplayName: string;
  visibleChatMessages: Message[];
  onLoadOlderMessages: () => void;
  isMessageContentLoading: (messageId: string) => boolean;
  onContinueMessageContent: (messageId: string) => void;
  onMemorySources: (messageId: string, sources: MessageMemorySource[]) => void;
  t: UiTranslator;
};

export function StandardChatWorkspace({
  activeTopic,
  awaitingResponse,
  handleComposerKeyDown,
  input,
  inputRef,
  listRef,
  metadata,
  olderMessagesAvailable,
  olderMessagesLoading,
  sendMessage,
  sending,
  setInput,
  stopGeneration,
  streamingMessageId,
  submitMessage,
  userDisplayName,
  visibleChatMessages,
  onLoadOlderMessages,
  isMessageContentLoading,
  onContinueMessageContent,
  onMemorySources,
  t,
}: StandardChatWorkspaceProps) {
  const hasPendingAssistantCard = Boolean(
    awaitingResponse &&
      streamingMessageId &&
      visibleChatMessages.some((message) => message.id === streamingMessageId && isPendingAssistantMessage(message)),
  );

  return (
    <main className="inspir-workspace">
      <MessageScrollerProvider autoScroll={false} defaultScrollPosition="end" scrollEdgeThreshold={64} scrollMargin={112}>
        <MessageScroller className="inspir-message-scroller">
          <MessageScrollerViewport ref={listRef} className="inspir-message-scroll app-scrollbar">
            <MessageScrollerContent className="inspir-message-stack">
              {olderMessagesAvailable ? (
                <MessageScrollerItem>
                  <div className="inspir-past-chat-loader">
                    <button
                      type="button"
                      aria-busy={olderMessagesLoading}
                      disabled={olderMessagesLoading}
                      onClick={onLoadOlderMessages}
                    >
                      {t("Past chats")}
                    </button>
                  </div>
                </MessageScrollerItem>
              ) : null}
              {visibleChatMessages.length === 0 ? (
                <MessageScrollerItem>
                  <TopicIntroCard {...topicIntroProps(activeTopic)} />
                </MessageScrollerItem>
              ) : null}
              {visibleChatMessages.length === 0 ? (
                <MessageScrollerItem>
                  <StarterGrid starters={metadata?.starters ?? []} onStart={(starter) => void sendMessage(starter)} />
                </MessageScrollerItem>
              ) : null}
              {visibleChatMessages.map((message) => (
                <MessageScrollerItem key={getChatMessageRenderId(message)} messageId={message.id}>
                  <MessageCard
                    message={message}
                    isStreaming={message.id === streamingMessageId}
                    userLabel={userDisplayName}
                    contentLoading={isMessageContentLoading(message.id)}
                    continueLabel={t("Continue")}
                    onContinueContent={onContinueMessageContent}
                    onMemorySources={(sources) => onMemorySources(message.id, sources)}
                  />
                </MessageScrollerItem>
              ))}
              {awaitingResponse && !hasPendingAssistantCard ? (
                <MessageScrollerItem>
                  <ThinkingMarker label="Thinking" />
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="inspir-scroll-button" />
        </MessageScroller>
      </MessageScrollerProvider>
      <form onSubmit={submitMessage} className="inspir-composer">
        <div className="inspir-composer-inner">
          <textarea
            aria-label="Message"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={activeTopic.inputboxText}
            disabled={sending}
            className="inspir-composer-input"
            rows={1}
          />
          <button
            type={sending ? "button" : "submit"}
            onClick={sending ? stopGeneration : undefined}
            disabled={!sending && !input.trim()}
            aria-label={sending ? "Stop response" : "Send message"}
            className="inspir-send-button"
          >
            {sending ? <Square size={18} fill="currentColor" /> : <Send size={23} />}
          </button>
        </div>
      </form>
    </main>
  );
}
