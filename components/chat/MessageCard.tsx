"use client";

import { useState } from "react";
import { Bot, CheckCircle2, Copy, StickyNote, UserRound } from "lucide-react";
import {
  getMessageMemorySources,
  isPendingAssistantMessage,
  type ChatMessage,
  type MessageMemorySource,
} from "@/components/chat/chat-message-model";
import { PendingAssistantBody } from "@/components/chat/PendingAssistantBody";
import { RichMarkdownContent } from "@/components/chat/RichMarkdownContent";
import {
  Message as ChatMessagePrimitive,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageCard as ChatCardPrimitive,
  MessageCardContent as ChatCardContent,
} from "@/components/ui/message-card";
import { formatAppDate } from "@/lib/utils/dates";

export function MessageCard({
  message,
  isStreaming = false,
  userLabel = "Learner",
  assistantLabel = "Coach response",
  onMemorySources,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
  userLabel?: string;
  assistantLabel?: string;
  onMemorySources?: (sources: MessageMemorySource[]) => void;
}) {
  const isUser = message.role === "user";
  const isPending = isPendingAssistantMessage(message) && isStreaming && message.content.trim().length === 0;
  const memorySources = getMessageMemorySources(message);
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <ChatMessagePrimitive
      align={isUser ? "end" : "start"}
      className={`inspir-message-row ${isUser ? "is-user" : "is-assistant"}`}
    >
      <MessageAvatar className="inspir-message-avatar" aria-hidden="true">
        {isUser ? <UserRound size={15} /> : <Bot size={15} />}
      </MessageAvatar>
      <MessageContent className="inspir-message-content">
        <ChatCardPrimitive
          align={isUser ? "end" : "start"}
          variant={isUser ? "default" : "ghost"}
          className="inspir-message-card-shell"
        >
          <ChatCardContent asChild>
            <article className="inspir-message-card">
              <MessageHeader className="inspir-message-author">
                {isUser ? <UserRound size={14} /> : <Bot size={14} />}
                <strong>{isUser ? userLabel : assistantLabel}</strong>
              </MessageHeader>
              {isPending ? <PendingAssistantBody /> : <RichMarkdownContent content={message.content} streaming={isStreaming} />}
              {!isPending ? (
                <MessageFooter className="inspir-message-footer">
                  <time>{formatAppDate(message.createdAt)}</time>
                  {!isUser && memorySources.length > 0 && onMemorySources ? (
                    <button
                      type="button"
                      onClick={() => onMemorySources(memorySources)}
                      aria-label="Show memory sources"
                      className="inspir-memory-source-button"
                    >
                      <StickyNote size={14} />
                    </button>
                  ) : null}
                  <button type="button" onClick={copyMessage} aria-label="Copy message">
                    {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                  </button>
                </MessageFooter>
              ) : null}
            </article>
          </ChatCardContent>
        </ChatCardPrimitive>
      </MessageContent>
    </ChatMessagePrimitive>
  );
}
