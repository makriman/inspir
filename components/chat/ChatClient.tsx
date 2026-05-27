"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  ArrowLeft,
  History,
  Mail,
  Menu,
  MessageCircle,
  RotateCcw,
  Search,
  User as UserIcon,
  X,
} from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { formatBubbleDate } from "@/lib/utils/dates";

type Topic = {
  id: string;
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string | Date;
};

type UserProfile = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  score: number;
  createdAt: string | Date;
  profileImageHash?: string | null;
};

type RecentChat = {
  id: string;
  topicId: string | null;
  topicName: string | null;
  title: string | null;
  firstMessagePreview: string | null;
  replyCount: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export function ChatClient({
  user,
  topics,
  initialTopicId,
  initialChatId,
  initialMessages,
}: {
  user: UserProfile;
  topics: Topic[];
  initialTopicId: string;
  initialChatId?: string;
  initialMessages: Message[];
}) {
  const [activeTopicId, setActiveTopicId] = useState(initialTopicId);
  const [activeChatId, setActiveChatId] = useState<string | undefined>(initialChatId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const activeTopic = topics.find((topic) => topic.id === activeTopicId) ?? topics[0];
  const filteredTopics = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter(
      (topic) =>
        topic.name.toLowerCase().includes(q) || topic.subText.toLowerCase().includes(q),
    );
  }, [search, topics]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!recentOpen) return;
    let cancelled = false;
    fetch(`/api/chats?topicId=${activeTopicId}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setRecentChats(data.chats ?? []);
      })
      .finally(() => {
        if (!cancelled) setRecentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recentOpen, activeTopicId]);

  async function createChat(topicId = activeTopicId) {
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topicId }),
    });
    if (!response.ok) throw new Error("Could not start chat");
    const data = await response.json();
    setActiveChatId(data.chatId);
    window.history.replaceState(null, "", `/chat/${data.chatId}`);
    return data.chatId as string;
  }

  async function loadChat(chatId: string) {
    const response = await fetch(`/api/chats/${chatId}`);
    if (!response.ok) return;
    const data = await response.json();
    if (data.topic?.id) setActiveTopicId(data.topic.id);
    setActiveChatId(data.chat.id);
    setMessages(data.messages ?? []);
    setRecentOpen(false);
    setMobileSidebarOpen(false);
    window.history.replaceState(null, "", `/chat/${chatId}`);
  }

  async function resetChat() {
    const chatId = await createChat(activeTopicId);
    setMessages([]);
    setRecentOpen(false);
    window.history.replaceState(null, "", `/chat/${chatId}`);
  }

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || sending) return;

    setInput("");
    setSending(true);
    setAwaitingResponse(true);
    setRecentOpen(false);

    const now = new Date();
    const userMessage: Message = {
      id: `local-user-${now.getTime()}`,
      role: "user",
      content,
      createdAt: now,
    };
    const assistantMessageId = `local-assistant-${now.getTime()}`;
    setMessages((current) => [...current, userMessage]);

    try {
      const chatId = activeChatId ?? (await createChat(activeTopicId));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, content }),
      });
      if (!response.ok || !response.body) throw new Error("No assistant response");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let assistantInserted = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        if (!assistantInserted) {
          assistantInserted = true;
          setAwaitingResponse(false);
          setMessages((current) => [
            ...current,
            {
              id: assistantMessageId,
              role: "assistant",
              content: assistantText,
              createdAt: new Date(),
            },
          ]);
          continue;
        }

        setMessages((current) => {
          return current.map((message) =>
            message.id === assistantMessageId ? { ...message, content: assistantText } : message,
          );
        });
      }
      await loadChat(chatId);
    } catch {
      setAwaitingResponse(false);
      setMessages((current) => [
        ...current,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "I could not answer right now. Please try again.",
          createdAt: new Date(),
        },
      ]);
    } finally {
      setAwaitingResponse(false);
      setSending(false);
    }
  }

  function selectTopic(topicId: string) {
    setActiveTopicId(topicId);
    setActiveChatId(undefined);
    setMessages([]);
    setRecentOpen(false);
    setMobileSidebarOpen(false);
    window.history.replaceState(null, "", "/chat");
  }

  const avatarSrc = user.profileImageHash
    ? `/api/me/photo?hash=${user.profileImageHash}`
    : user.image || undefined;

  return (
    <div className={`bubble-chat-root ${profileOpen ? "profile-open" : ""}`}>
      <aside className={`bubble-sidebar ${mobileSidebarOpen ? "is-open" : ""}`}>
        <TopicSidebar
          avatarSrc={avatarSrc}
          topics={topics}
          filteredTopics={filteredTopics}
          activeTopicId={activeTopicId}
          search={search}
          onProfile={() => {
            setProfileOpen(true);
            setMobileSidebarOpen(false);
          }}
          onSearch={setSearch}
          onSelect={selectTopic}
        />
      </aside>

      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close topics"
          className="bubble-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <section className="bubble-main-shell">
        <TopBar
          title={recentOpen ? `${activeTopic.name}'s Recent Conversations` : activeTopic.name}
          recentOpen={recentOpen}
          onReset={resetChat}
          onRecent={() => {
            setRecentLoading(true);
            setRecentOpen(true);
          }}
          onBack={() => setRecentOpen(false)}
          onMenu={() => setMobileSidebarOpen(true)}
        />

        {recentOpen ? (
          <RecentConversations
            chats={recentChats}
            loading={recentLoading}
            onBack={() => setRecentOpen(false)}
            onOpen={loadChat}
          />
        ) : (
          <main className="bubble-workspace">
            <div ref={listRef} className="bubble-message-scroll app-scrollbar">
              <TopicIntroCard topic={activeTopic} />
              <div className="bubble-message-stack">
                {messages
                  .filter((message) => message.role !== "system")
                  .map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                {awaitingResponse ? (
                  <div className="bubble-thinking" aria-live="polite">
                    <span />
                    <span />
                    <span />
                    <strong>Thinking</strong>
                  </div>
                ) : null}
              </div>
            </div>
            <form onSubmit={submitMessage} className="bubble-composer">
              <div className="bubble-composer-inner">
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={activeTopic.inputboxText}
                  disabled={sending}
                  className="bubble-composer-input"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  aria-label="Send message"
                  className="bubble-send-button"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="m4.497 20.835 16.51-7.363c1.324-.59 1.324-2.354 0-2.944L4.497 3.164c-1.495-.667-3.047.814-2.306 2.202l3.152 5.904c.245.459.245 1 0 1.458l-3.152 5.904c-.74 1.388.81 2.87 2.306 2.202Z"
                    />
                  </svg>
                </button>
              </div>
            </form>
          </main>
        )}
      </section>

      {profileOpen ? (
        <ProfilePanel
          user={user}
          avatarSrc={avatarSrc}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
    </div>
  );
}

function TopicSidebar({
  avatarSrc,
  topics,
  filteredTopics,
  activeTopicId,
  search,
  onProfile,
  onSearch,
  onSelect,
}: {
  avatarSrc?: string;
  topics: Topic[];
  filteredTopics: Topic[];
  activeTopicId: string;
  search: string;
  onProfile: () => void;
  onSearch: (value: string) => void;
  onSelect: (topicId: string) => void;
}) {
  const activeTopic = topics.find((topic) => topic.id === activeTopicId);
  const rows = filteredTopics.length ? filteredTopics : activeTopic ? [activeTopic] : [];

  return (
    <div className="bubble-sidebar-inner">
      <div className="bubble-sidebar-header">
        <button type="button" onClick={onProfile} aria-label="Open profile" className="bubble-avatar-button">
          {avatarSrc ? <img src={avatarSrc} alt="" /> : null}
        </button>
        <InspirLogo className="bubble-sidebar-logo" />
      </div>
      <div className="bubble-search-row">
        <div className="bubble-search-shell">
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search"
            className="bubble-search-input"
          />
          {search ? <Search className="bubble-search-icon" size={16} /> : null}
        </div>
      </div>
      <div className="bubble-topic-list app-scrollbar">
        {search && filteredTopics.length === 0 ? (
          <div className="bubble-no-results">No search results</div>
        ) : null}
        {rows.map((topic, index) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => onSelect(topic.id)}
            className={`bubble-topic-row ${topic.id === activeTopicId ? "is-active" : ""} ${
              index > 0 ? "has-gap" : ""
            }`}
          >
            <span className="bubble-topic-title">{topic.name}</span>
            <span className="bubble-topic-subtitle">{topic.subText}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TopBar({
  title,
  recentOpen,
  onReset,
  onRecent,
  onBack,
  onMenu,
}: {
  title: string;
  recentOpen: boolean;
  onReset: () => void;
  onRecent: () => void;
  onBack: () => void;
  onMenu: () => void;
}) {
  return (
    <header className="bubble-topbar">
      <button type="button" onClick={onMenu} className="bubble-mobile-menu" aria-label="Open topics">
        <Menu size={26} />
      </button>
      <div className="bubble-topbar-title">
        {recentOpen ? (
          <button type="button" onClick={onBack} aria-label="Back to chat" className="bubble-back-button">
            <ArrowLeft size={22} />
          </button>
        ) : null}
        <span>{title}</span>
      </div>
      <div className="bubble-topbar-actions">
        <button type="button" onClick={onReset} aria-label="Reset conversation" className="bubble-reset-button">
          <RotateCcw size={27} strokeWidth={3.25} />
        </button>
        <button type="button" onClick={onRecent} aria-label="Recent conversations" className="bubble-history-button">
          <History size={27} strokeWidth={3.25} />
        </button>
      </div>
    </header>
  );
}

function TopicIntroCard({ topic }: { topic: Topic }) {
  return (
    <article className="bubble-intro-card">
      <h2>{topic.name}</h2>
      <p>{topic.description}</p>
    </article>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`bubble-message-row ${isUser ? "is-user" : "is-assistant"}`}>
      <article className="bubble-message-bubble">
        <p>{message.content}</p>
        <time>{formatBubbleDate(message.createdAt)}</time>
      </article>
    </div>
  );
}

function RecentConversations({
  chats,
  loading,
  onBack,
  onOpen,
}: {
  chats: RecentChat[];
  loading: boolean;
  onBack: () => void;
  onOpen: (chatId: string) => void;
}) {
  return (
    <main className="bubble-recent app-scrollbar">
      <button type="button" onClick={onBack} className="bubble-recent-back">
        <ArrowLeft size={22} />
        Back
      </button>
      {loading ? <p className="bubble-recent-empty">Loading...</p> : null}
      {!loading && chats.length === 0 ? (
        <p className="bubble-recent-empty">No search results</p>
      ) : null}
      <div className="bubble-recent-list">
        {chats.map((chat) => (
          <button
            key={chat.id}
            type="button"
            onClick={() => onOpen(chat.id)}
            className="bubble-recent-card"
          >
            <span className="bubble-recent-title">{chat.firstMessagePreview || chat.title}</span>
            <span className="bubble-recent-meta">
              <MessageCircle size={16} />
              {chat.replyCount} Replies
            </span>
            <time>{formatBubbleDate(chat.updatedAt)}</time>
          </button>
        ))}
      </div>
    </main>
  );
}

function ProfilePanel({
  user,
  avatarSrc,
  onClose,
}: {
  user: UserProfile;
  avatarSrc?: string;
  onClose: () => void;
}) {
  return (
    <aside className="bubble-profile-panel">
      <div className="bubble-profile-header">
        <h2>Profile</h2>
        <button type="button" aria-label="Close profile" onClick={onClose}>
          <X size={24} strokeWidth={3.5} />
        </button>
      </div>
      <div className="bubble-profile-avatar-wrap">
        <div className="bubble-profile-avatar">
          {avatarSrc ? <img src={avatarSrc} alt="" /> : null}
        </div>
      </div>
      <div className="bubble-profile-info">
        <ProfileLine icon="user" label="Name" value={user.name || "User Name"} />
        <ProfileLine icon="mail" label="Email" value={user.email || "user@example.com"} />
      </div>
      <ProfileStat label="Score" value={String(user.score ?? 0)} />
      <ProfileStat label="inspir'ed since" value={formatBubbleDate(user.createdAt)} />
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        className="bubble-profile-logout"
      >
        Logout
      </button>
      <footer className="bubble-profile-footer">
        <div className="bubble-profile-legal">
          <a href="/tnc">Terms and Conditions</a>
          <span>|</span>
          <a href="/privacy">Privacy Policy</a>
        </div>
        <SocialLinks compact className="bubble-profile-social" />
      </footer>
    </aside>
  );
}

function ProfileLine({
  icon,
  label,
  value,
}: {
  icon: "user" | "mail";
  label: string;
  value: string;
}) {
  return (
    <div className="bubble-profile-line">
      <div className="bubble-profile-line-icon">
        {icon === "mail" ? <Mail size={32} fill="currentColor" /> : <UserIcon size={32} fill="currentColor" />}
      </div>
      <div className="bubble-profile-line-text">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bubble-profile-stat">
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}
