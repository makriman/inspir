"use client";

import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { signOut } from "next-auth/react";
import {
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  Copy,
  History,
  Mail,
  Menu,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  User as UserIcon,
  X,
  XCircle,
} from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { formatBubbleDate } from "@/lib/utils/dates";

type TopicMetadata = {
  category: string;
  uiMode:
    | "chat"
    | "quiz"
    | "time-travel"
    | "historical-person"
    | "interactive-instruction"
    | "collaborative-instruction"
    | "socratic-instruction";
  modelProfile: "fast" | "reasoning" | "structured";
  starters: string[];
};

type Topic = {
  id: string;
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
  metadata?: TopicMetadata | Record<string, unknown> | null;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string | Date;
  metadata?: Record<string, unknown>;
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

type ActivityRun = {
  id: string;
  chatId: string;
  type: string;
  status: string;
  state: Record<string, unknown>;
  score: number | null;
  maxScore: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
};

type PublicQuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  userAnswerIndex?: number;
  correctIndex?: number;
  explanation?: string;
  isCorrect?: boolean;
};

type PublicQuizState = {
  topic: string;
  currentIndex: number;
  score: number;
  maxScore: 10;
  completed: boolean;
  questions: PublicQuizQuestion[];
};

function topicMetadata(topic: Topic | undefined): TopicMetadata | undefined {
  const metadata = topic?.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  if (!("uiMode" in metadata) || !("starters" in metadata)) return undefined;
  return metadata as TopicMetadata;
}

function isQuizState(value: Record<string, unknown>): value is PublicQuizState {
  return (
    typeof value.topic === "string" &&
    Array.isArray(value.questions) &&
    typeof value.currentIndex === "number"
  );
}

export function ChatClient({
  user,
  topics,
  initialTopicId,
  initialChatId,
  initialMessages,
  initialActivityRun,
}: {
  user: UserProfile;
  topics: Topic[];
  initialTopicId: string;
  initialChatId?: string;
  initialMessages: Message[];
  initialActivityRun: ActivityRun | null;
}) {
  const [activeTopicId, setActiveTopicId] = useState(initialTopicId);
  const [activeChatId, setActiveChatId] = useState<string | undefined>(initialChatId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [activityRun, setActivityRun] = useState<ActivityRun | null>(initialActivityRun);
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeTopic = topics.find((topic) => topic.id === activeTopicId) ?? topics[0];
  const metadata = topicMetadata(activeTopic);
  const uiMode = metadata?.uiMode ?? "chat";
  const isQuizMode = uiMode === "quiz";

  const filteredTopics = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter(
      (topic) =>
        topic.name.toLowerCase().includes(q) ||
        topic.subText.toLowerCase().includes(q) ||
        topicMetadata(topic)?.category.toLowerCase().includes(q),
    );
  }, [search, topics]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, activityRun]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, [input]);

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
    setActivityRun(data.activityRun ?? null);
    setRecentOpen(false);
    setMobileSidebarOpen(false);
    window.history.replaceState(null, "", `/chat/${chatId}`);
  }

  async function resetChat() {
    const chatId = await createChat(activeTopicId);
    setMessages([]);
    setActivityRun(null);
    setRecentOpen(false);
    window.history.replaceState(null, "", `/chat/${chatId}`);
  }

  async function sendMessage(content: string, appendUser = true) {
    const trimmed = content.trim();
    if (!trimmed || sending || isQuizMode) return;

    setInput("");
    setSending(true);
    setAwaitingResponse(true);
    setRecentOpen(false);

    const now = new Date();
    const userMessage: Message = {
      id: `local-user-${now.getTime()}`,
      role: "user",
      content: trimmed,
      createdAt: now,
    };
    const assistantMessageId = `local-assistant-${now.getTime()}`;
    if (appendUser) setMessages((current) => [...current, userMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const chatId = activeChatId ?? (await createChat(activeTopicId));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, content: trimmed }),
        signal: controller.signal,
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

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId ? { ...message, content: assistantText } : message,
          ),
        );
      }
      await loadChat(chatId);
    } catch (error) {
      setAwaitingResponse(false);
      if ((error as Error).name === "AbortError") {
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "Stopped. Send another message whenever you are ready.",
            createdAt: new Date(),
          },
        ]);
      } else {
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "I could not answer right now. Please try again.",
            createdAt: new Date(),
          },
        ]);
      }
    } finally {
      abortRef.current = null;
      setAwaitingResponse(false);
      setSending(false);
    }
  }

  function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    void sendMessage(input);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  function regenerateLast() {
    const lastUserIndex = [...messages].map((message) => message.role).lastIndexOf("user");
    if (lastUserIndex < 0) return;
    const lastUser = messages[lastUserIndex];
    setMessages((current) => current.slice(0, lastUserIndex + 1));
    void sendMessage(lastUser.content, false);
  }

  function selectTopic(topicId: string) {
    setActiveTopicId(topicId);
    setActiveChatId(undefined);
    setMessages([]);
    setActivityRun(null);
    setInput("");
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
          sending={sending}
          canRegenerate={!isQuizMode && messages.some((message) => message.role === "user")}
          onReset={resetChat}
          onRecent={() => {
            setRecentLoading(true);
            setRecentOpen(true);
          }}
          onBack={() => setRecentOpen(false)}
          onMenu={() => setMobileSidebarOpen(true)}
          onStop={stopGeneration}
          onRegenerate={regenerateLast}
        />

        {recentOpen ? (
          <RecentConversations
            chats={recentChats}
            loading={recentLoading}
            onBack={() => setRecentOpen(false)}
            onOpen={loadChat}
          />
        ) : isQuizMode ? (
          <QuizWorkspace
            activeChatId={activeChatId}
            activeTopicId={activeTopicId}
            activityRun={activityRun}
            createChat={createChat}
            onActivityRun={setActivityRun}
          />
        ) : (
          <main className="bubble-workspace">
            <div ref={listRef} className="bubble-message-scroll app-scrollbar">
              <TopicIntroCard topic={activeTopic} />
              {uiMode !== "chat" ? (
                <MiniAppPanel topic={activeTopic} onStart={(starter) => void sendMessage(starter)} />
              ) : null}
              {messages.filter((message) => message.role !== "system").length === 0 ? (
                <StarterGrid
                  starters={metadata?.starters ?? []}
                  onStart={(starter) => void sendMessage(starter)}
                />
              ) : null}
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
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={activeTopic.inputboxText}
                  disabled={sending}
                  className="bubble-composer-input"
                  rows={1}
                />
                <button
                  type={sending ? "button" : "submit"}
                  onClick={sending ? stopGeneration : undefined}
                  disabled={!sending && !input.trim()}
                  aria-label={sending ? "Stop response" : "Send message"}
                  className="bubble-send-button"
                >
                  {sending ? <Square size={18} fill="currentColor" /> : <Send size={23} />}
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
  const groups = rows.reduce<Array<{ category: string; topics: Topic[] }>>((acc, topic) => {
    const category = topicMetadata(topic)?.category ?? "Learning";
    const existing = acc.find((group) => group.category === category);
    if (existing) existing.topics.push(topic);
    else acc.push({ category, topics: [topic] });
    return acc;
  }, []);

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
        {groups.map((group) => (
          <section key={group.category} className="bubble-topic-group">
            <h3>{group.category}</h3>
            {group.topics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => onSelect(topic.id)}
                className={`bubble-topic-row ${topic.id === activeTopicId ? "is-active" : ""}`}
              >
                <span className="bubble-topic-title">{topic.name}</span>
                <span className="bubble-topic-subtitle">{topic.subText}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function TopBar({
  title,
  recentOpen,
  sending,
  canRegenerate,
  onReset,
  onRecent,
  onBack,
  onMenu,
  onStop,
  onRegenerate,
}: {
  title: string;
  recentOpen: boolean;
  sending: boolean;
  canRegenerate: boolean;
  onReset: () => void;
  onRecent: () => void;
  onBack: () => void;
  onMenu: () => void;
  onStop: () => void;
  onRegenerate: () => void;
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
          <RotateCcw size={25} strokeWidth={3} />
        </button>
        <button
          type="button"
          onClick={sending ? onStop : onRegenerate}
          disabled={!sending && !canRegenerate}
          aria-label={sending ? "Stop response" : "Regenerate response"}
          className="bubble-regenerate-button"
        >
          {sending ? <Square size={18} fill="currentColor" /> : <RefreshCw size={24} strokeWidth={3} />}
        </button>
        <button type="button" onClick={onRecent} aria-label="Recent conversations" className="bubble-history-button">
          <History size={26} strokeWidth={3} />
        </button>
      </div>
    </header>
  );
}

function TopicIntroCard({ topic }: { topic: Topic }) {
  return (
    <article className="bubble-intro-card">
      <div>
        <span>{topicMetadata(topic)?.category ?? "Learning"}</span>
        <h2>{topic.name}</h2>
      </div>
      <p>{topic.description}</p>
    </article>
  );
}

function StarterGrid({
  starters,
  onStart,
}: {
  starters: string[];
  onStart: (starter: string) => void;
}) {
  if (!starters.length) return null;
  return (
    <div className="bubble-starter-grid">
      {starters.map((starter) => (
        <button key={starter} type="button" onClick={() => onStart(starter)}>
          <Sparkles size={16} />
          <span>{starter}</span>
        </button>
      ))}
    </div>
  );
}

function MiniAppPanel({ topic, onStart }: { topic: Topic; onStart: (starter: string) => void }) {
  const metadata = topicMetadata(topic);
  if (!metadata || metadata.uiMode === "chat") return null;
  const cards = getMiniAppCards(metadata.uiMode);
  return (
    <section className="bubble-mini-panel">
      <div className="bubble-mini-panel-header">
        <Clipboard size={20} />
        <div>
          <strong>{miniAppTitle(metadata.uiMode)}</strong>
          <span>{miniAppSubtitle(metadata.uiMode)}</span>
        </div>
      </div>
      <div className="bubble-mini-card-grid">
        {cards.map((card) => (
          <article key={card.title}>
            <strong>{card.title}</strong>
            <span>{card.body}</span>
          </article>
        ))}
      </div>
      <StarterGrid starters={metadata.starters} onStart={onStart} />
    </section>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className={`bubble-message-row ${isUser ? "is-user" : "is-assistant"}`}>
      <article className="bubble-message-bubble">
        <RichMessageContent content={message.content} />
        <footer>
          <time>{formatBubbleDate(message.createdAt)}</time>
          <button type="button" onClick={copyMessage} aria-label="Copy message">
            {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
          </button>
        </footer>
      </article>
    </div>
  );
}

function RichMessageContent({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("|") && lines[index + 1]?.match(/^\s*\|?[-:\s|]+\|?\s*$/)) {
      const tableLines: string[] = [];
      while (lines[index]?.trim().startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(<MarkdownTable key={`table-${index}`} lines={tableLines} />);
      continue;
    }

    if (/^#{1,3}\s/.test(line)) {
      const text = line.replace(/^#{1,3}\s/, "");
      blocks.push(<h3 key={`heading-${index}`}>{inlineParts(text)}</h3>);
      index += 1;
      continue;
    }

    if (/^\s*(-|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (/^\s*(-|\d+\.)\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*(-|\d+\.)\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`}>
          {items.map((item) => (
            <li key={item}>{inlineParts(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      lines[index]?.trim() &&
      !/^#{1,3}\s/.test(lines[index]) &&
      !/^\s*(-|\d+\.)\s+/.test(lines[index]) &&
      !(lines[index].trim().startsWith("|") && lines[index + 1]?.match(/^\s*\|?[-:\s|]+\|?\s*$/))
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{inlineParts(paragraph.join(" "))}</p>);
  }

  return <div className="bubble-rich-content">{blocks}</div>;
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const rows = lines
    .filter((line, index) => index !== 1)
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  const [head, ...body] = rows;
  return (
    <div className="bubble-table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell}>{inlineParts(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={row.join("|") || rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`}>{inlineParts(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function inlineParts(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <span key={index}>{part}</span>;
  });
}

function QuizWorkspace({
  activeChatId,
  activeTopicId,
  activityRun,
  createChat,
  onActivityRun,
}: {
  activeChatId?: string;
  activeTopicId: string;
  activityRun: ActivityRun | null;
  createChat: (topicId?: string) => Promise<string>;
  onActivityRun: (run: ActivityRun | null) => void;
}) {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState("");
  const quiz = activityRun?.type === "quiz" && isQuizState(activityRun.state) ? activityRun.state : null;
  const currentQuestion = quiz?.questions[quiz.currentIndex];
  const lastAnswered = quiz
    ? [...quiz.questions].reverse().find((question) => question.userAnswerIndex !== undefined)
    : undefined;

  async function startQuiz(event?: FormEvent) {
    event?.preventDefault();
    const quizTopic = topic.trim();
    if (!quizTopic || loading) return;
    setError("");
    setLoading(true);
    try {
      const chatId = activeChatId ?? (await createChat(activeTopicId));
      const response = await fetch("/api/activities/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, topic: quizTopic }),
      });
      if (!response.ok) throw new Error("Could not build quiz");
      const data = await response.json();
      onActivityRun(data.activityRun);
    } catch {
      setError("I could not build that quiz right now. Try a simpler topic or try again.");
    } finally {
      setLoading(false);
    }
  }

  async function answerQuestion(answerIndex: number) {
    if (!activityRun || answering) return;
    setAnswering(true);
    setError("");
    try {
      const response = await fetch(`/api/activities/quiz/${activityRun.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answerIndex }),
      });
      if (!response.ok) throw new Error("Could not score answer");
      const data = await response.json();
      onActivityRun(data.activityRun);
    } catch {
      setError("I could not score that answer. Please try again.");
    } finally {
      setAnswering(false);
    }
  }

  return (
    <main className="bubble-workspace bubble-quiz-workspace">
      {!quiz ? (
        <form onSubmit={startQuiz} className="bubble-quiz-start">
          <div className="bubble-quiz-start-icon">
            <Sparkles size={28} />
          </div>
          <h2>What would you like to be quizzed on today?</h2>
          <p>Pick any topic. I will build 10 multiple-choice questions and score you as you go.</p>
          <div className="bubble-quiz-input-row">
            <input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Space exploration, Indian history, algebra..."
              disabled={loading}
            />
            <button type="submit" disabled={loading || !topic.trim()}>
              {loading ? "Building" : "Start"}
            </button>
          </div>
          {error ? <span className="bubble-quiz-error">{error}</span> : null}
        </form>
      ) : (
        <section className="bubble-quiz-card">
          <header className="bubble-quiz-header">
            <div>
              <span>Quiz on</span>
              <h2>{quiz.topic}</h2>
            </div>
            <strong>
              {quiz.score}/{quiz.maxScore}
            </strong>
          </header>
          <div className="bubble-quiz-progress">
            <span style={{ width: `${(quiz.questions.filter((q) => q.userAnswerIndex !== undefined).length / 10) * 100}%` }} />
          </div>

          {lastAnswered ? <QuizFeedback question={lastAnswered} /> : null}

          {!quiz.completed && currentQuestion ? (
            <article className="bubble-question-card">
              <span>
                Question {quiz.currentIndex + 1} of {quiz.maxScore}
              </span>
              <h3>{currentQuestion.prompt}</h3>
              <div className="bubble-option-grid">
                {currentQuestion.options.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    disabled={answering}
                    onClick={() => void answerQuestion(index)}
                  >
                    <strong>{String.fromCharCode(65 + index)}</strong>
                    <span>{option}</span>
                  </button>
                ))}
              </div>
            </article>
          ) : (
            <QuizReview quiz={quiz} />
          )}
          {error ? <span className="bubble-quiz-error">{error}</span> : null}
        </section>
      )}
    </main>
  );
}

function QuizFeedback({ question }: { question: PublicQuizQuestion }) {
  const correct = question.isCorrect;
  return (
    <aside className={`bubble-quiz-feedback ${correct ? "is-correct" : "is-wrong"}`}>
      {correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
      <div>
        <strong>{correct ? "Correct" : "Not quite"}</strong>
        <span>{question.explanation}</span>
      </div>
    </aside>
  );
}

function QuizReview({ quiz }: { quiz: PublicQuizState }) {
  return (
    <article className="bubble-quiz-review">
      <h3>Final score: {quiz.score}/10</h3>
      <p>{quiz.score >= 8 ? "Strong work." : quiz.score >= 5 ? "Good base. Review the misses below." : "You have a starting map now. Let us rebuild the weak spots."}</p>
      <div className="bubble-review-list">
        {quiz.questions.map((question, index) => (
          <div key={question.id} className={question.isCorrect ? "is-correct" : "is-wrong"}>
            <strong>
              {index + 1}. {question.prompt}
            </strong>
            <span>Your answer: {answerLabel(question, question.userAnswerIndex)}</span>
            <span>Correct: {answerLabel(question, question.correctIndex)}</span>
            <p>{question.explanation}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function answerLabel(question: PublicQuizQuestion, index: number | undefined) {
  if (index === undefined) return "Not answered";
  return `${String.fromCharCode(65 + index)}. ${question.options[index] ?? ""}`;
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
      {!loading && chats.length === 0 ? <p className="bubble-recent-empty">No search results</p> : null}
      <div className="bubble-recent-list">
        {chats.map((chat) => (
          <button key={chat.id} type="button" onClick={() => onOpen(chat.id)} className="bubble-recent-card">
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
        <div className="bubble-profile-avatar">{avatarSrc ? <img src={avatarSrc} alt="" /> : null}</div>
      </div>
      <div className="bubble-profile-info">
        <ProfileLine icon="user" label="Name" value={user.name || "User Name"} />
        <ProfileLine icon="mail" label="Email" value={user.email || "user@example.com"} />
      </div>
      <ProfileStat label="Score" value={String(user.score ?? 0)} />
      <ProfileStat label="inspir'ed since" value={formatBubbleDate(user.createdAt)} />
      <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="bubble-profile-logout">
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

function miniAppTitle(mode: TopicMetadata["uiMode"]) {
  const titles: Record<TopicMetadata["uiMode"], string> = {
    chat: "Chat",
    quiz: "Quiz",
    "time-travel": "Time Travel Console",
    "historical-person": "Historical Conversation Studio",
    "interactive-instruction": "Adaptive Lesson Loop",
    "collaborative-instruction": "Study Room",
    "socratic-instruction": "Question Ladder",
  };
  return titles[mode];
}

function miniAppSubtitle(mode: TopicMetadata["uiMode"]) {
  const subtitles: Record<TopicMetadata["uiMode"], string> = {
    chat: "Ask, learn, and go deeper.",
    quiz: "Answer one question at a time.",
    "time-travel": "Set a destination, collect context, and explore through choices.",
    "historical-person": "Meet the figure, ask questions, and keep context notes visible.",
    "interactive-instruction": "Learn in short teach-check-adapt cycles.",
    "collaborative-instruction": "Work beside your buddy with shared checkpoints.",
    "socratic-instruction": "Build understanding through one careful question at a time.",
  };
  return subtitles[mode];
}

function getMiniAppCards(mode: TopicMetadata["uiMode"]) {
  const cards: Record<TopicMetadata["uiMode"], Array<{ title: string; body: string }>> = {
    chat: [],
    quiz: [],
    "time-travel": [
      { title: "Era Passport", body: "Destination, date, role, and what people know in that time." },
      { title: "Scene Choices", body: "Pick where to go next and learn through exploration." },
      { title: "Timeline Log", body: "Keep track of facts, events, and uncertainty." },
    ],
    "historical-person": [
      { title: "Persona Card", body: "Era, worldview, voice, and record limits." },
      { title: "In Character", body: "Conversation stays grounded in public historical context." },
      { title: "Context Notes", body: "Short clarifications separate fact from interpretation." },
    ],
    "interactive-instruction": [
      { title: "Mini Lesson", body: "Short explanation before every check." },
      { title: "Quick Check", body: "One question at a time, no answer leakage." },
      { title: "Level Shift", body: "Simpler or deeper based on your response." },
    ],
    "collaborative-instruction": [
      { title: "Shared Goal", body: "You and inspir Buddy agree what to learn." },
      { title: "Buddy Work", body: "You contribute, the buddy builds with you." },
      { title: "Checkpoint", body: "Short Hindi summaries keep progress clear." },
    ],
    "socratic-instruction": [
      { title: "Current Hypothesis", body: "State what you think first." },
      { title: "Hint Ladder", body: "Small nudges before full explanations." },
      { title: "Synthesis", body: "A final summary after real thinking." },
    ],
  };
  return cards[mode] ?? [];
}
