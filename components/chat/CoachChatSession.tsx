"use client";

import {
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useState,
} from "react";
import {
  Bot,
  FileText,
  RotateCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
} from "lucide-react";
import type { ChatMessage as Message } from "@/components/chat/chat-message-model";
import { MessageCard } from "@/components/chat/MessageCard";
import { ThinkingMarker } from "@/components/chat/ThinkingMarker";

export type CoachChatAction = {
  label: string;
  icon?: ComponentType<{ size?: number }>;
  onClick: () => void;
  disabled?: boolean;
};

export type CoachChatDetail = {
  title: string;
  body: string;
  icon?: ComponentType<{ size?: number }>;
};

export function CoachChatSession({
  eyebrow,
  title,
  subtitle,
  userName,
  coachName,
  placeholder,
  messages,
  input,
  sending,
  awaitingResponse,
  inputRef,
  listRef,
  actions,
  details,
  resetLabel,
  onInput,
  onSubmit,
  onKeyDown,
  onStop,
  onReset,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  userName: string;
  coachName: string;
  placeholder: string;
  messages: Message[];
  input: string;
  sending: boolean;
  awaitingResponse: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  actions?: CoachChatAction[];
  details?: CoachChatDetail[];
  resetLabel: string;
  onInput: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetails = Boolean(details?.length);

  return (
    <main className="inspir-workspace coach-chat-workspace">
      <section className={`coach-chat-shell ${detailsOpen ? "is-details-open" : ""}`}>
        <header className="coach-chat-top">
          <div className="coach-chat-avatar" aria-hidden="true">
            <Bot size={24} />
          </div>
          <div className="coach-chat-title">
            <span>{eyebrow}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <div className="coach-chat-toolbar">
            {hasDetails ? (
              <button type="button" onClick={() => setDetailsOpen((open) => !open)}>
                <SlidersHorizontal size={17} />
                <span>{detailsOpen ? "Hide details" : "Details"}</span>
              </button>
            ) : null}
            <button type="button" onClick={onReset}>
              <RotateCcw size={17} />
              <span>{resetLabel}</span>
            </button>
          </div>
        </header>

        {actions?.length ? (
          <div className="coach-chat-action-strip" aria-label="Coach actions">
            {actions.map((action) => {
              const ActionIcon = action.icon ?? Sparkles;
              return (
                <button key={action.label} type="button" onClick={action.onClick} disabled={action.disabled}>
                  <ActionIcon size={16} />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {detailsOpen && details?.length ? (
          <aside className="coach-chat-details" aria-label="Session details">
            <div className="coach-chat-details-head">
              <ShieldCheck size={18} />
              <strong>Session setup</strong>
            </div>
            <div className="coach-chat-details-grid">
              {details.map((detail) => {
                const DetailIcon = detail.icon ?? FileText;
                return (
                  <article key={detail.title}>
                    <DetailIcon size={17} />
                    <div>
                      <strong>{detail.title}</strong>
                      <span>{detail.body}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </aside>
        ) : null}

        <section className="coach-chat-body">
          <div ref={listRef} className="coach-chat-log app-scrollbar">
            <div className="coach-chat-message-stack">
              {messages.map((message) => (
                <MessageCard
                  key={message.id}
                  message={message}
                  userLabel={userName}
                  assistantLabel={`${coachName} response`}
                />
              ))}
              {awaitingResponse ? (
                <ThinkingMarker label={`${coachName} is thinking`} />
              ) : null}
            </div>
          </div>

          <form onSubmit={onSubmit} className="inspir-composer coach-chat-composer">
            <div className="inspir-composer-inner">
              <textarea
                aria-label="Message coach"
                ref={inputRef}
                value={input}
                onChange={(event) => onInput(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                disabled={sending}
                className="inspir-composer-input"
                rows={1}
              />
              <button
                type={sending ? "button" : "submit"}
                onClick={sending ? onStop : undefined}
                disabled={!sending && !input.trim()}
                aria-label={sending ? "Stop response" : "Send message"}
                className="inspir-send-button"
              >
                {sending ? <Square size={18} fill="currentColor" /> : <Send size={23} />}
              </button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
