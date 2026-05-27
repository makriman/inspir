"use client";

import {
  FormEvent,
  KeyboardEvent,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { signOut } from "next-auth/react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  Clipboard,
  Compass,
  Copy,
  Gauge,
  History,
  Landmark,
  Languages,
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
import { defaultLanguage, supportedLanguages } from "@/lib/content/languages";
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
  preferredLanguage: string;
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

type MiniMode = Exclude<TopicMetadata["uiMode"], "chat" | "quiz">;

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
  const [profileUser, setProfileUser] = useState(user);
  const [languageSaving, setLanguageSaving] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  const activeTopic = topics.find((topic) => topic.id === activeTopicId) ?? topics[0];
  const metadata = topicMetadata(activeTopic);
  const uiMode = metadata?.uiMode ?? "chat";
  const isQuizMode = uiMode === "quiz";
  const isMiniAppMode = uiMode !== "chat" && uiMode !== "quiz";

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

  async function createChat(topicId = activeTopicId, activate = true) {
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topicId }),
    });
    if (!response.ok) throw new Error("Could not start chat");
    const data = await response.json();
    if (activate) {
      setActiveChatId(data.chatId);
      window.history.replaceState(null, "", `/chat/${data.chatId}`);
    }
    return data.chatId as string;
  }

  function cancelActiveRequest() {
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setAwaitingResponse(false);
    setSending(false);
  }

  async function loadChat(chatId: string, options?: { preserveRequest?: boolean }) {
    if (!options?.preserveRequest) cancelActiveRequest();
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
    cancelActiveRequest();
    const chatId = await createChat(activeTopicId);
    setMessages([]);
    setActivityRun(null);
    setRecentOpen(false);
    window.history.replaceState(null, "", `/chat/${chatId}`);
  }

  async function sendMessage(content: string, appendUser = true) {
    const trimmed = content.trim();
    if (!trimmed || sending || isQuizMode) return;

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    const isCurrentRequest = () => requestSeqRef.current === requestId;

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
      const chatId = activeChatId ?? (await createChat(activeTopicId, false));
      if (!isCurrentRequest()) return;
      if (!activeChatId) {
        setActiveChatId(chatId);
        window.history.replaceState(null, "", `/chat/${chatId}`);
      }
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, content: trimmed }),
        signal: controller.signal,
      });
      if (!isCurrentRequest()) return;
      if (!response.ok || !response.body) throw new Error("No assistant response");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let assistantInserted = false;
      while (true) {
        const { value, done } = await reader.read();
        if (!isCurrentRequest()) {
          await reader.cancel();
          return;
        }
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
      if (isCurrentRequest()) await loadChat(chatId, { preserveRequest: true });
    } catch (error) {
      if (!isCurrentRequest()) return;
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
      if (isCurrentRequest()) {
        abortRef.current = null;
        setAwaitingResponse(false);
        setSending(false);
      }
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
    cancelActiveRequest();
    setActiveTopicId(topicId);
    setActiveChatId(undefined);
    setMessages([]);
    setActivityRun(null);
    setInput("");
    setRecentOpen(false);
    setMobileSidebarOpen(false);
    window.history.replaceState(null, "", "/chat");
  }

  async function updatePreferredLanguage(preferredLanguage: string) {
    const previous = profileUser;
    setLanguageSaving(true);
    setProfileUser((current) => ({ ...current, preferredLanguage }));
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferredLanguage }),
      });
      if (!response.ok) throw new Error("Could not update language");
      const data = await response.json();
      if (data.user) {
        setProfileUser({
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          image: data.user.image,
          score: data.user.score ?? 0,
          preferredLanguage: data.user.preferredLanguage ?? defaultLanguage,
          createdAt: data.user.createdAt,
          profileImageHash: data.user.profileImageHash ?? null,
        });
      }
    } catch {
      setProfileUser(previous);
    } finally {
      setLanguageSaving(false);
    }
  }

  const avatarSrc = profileUser.profileImageHash
    ? `/api/me/photo?hash=${profileUser.profileImageHash}`
    : profileUser.image || undefined;

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
        ) : isMiniAppMode ? (
          <GuidedMiniAppWorkspace
            key={activeTopic.id}
            topic={activeTopic}
            mode={uiMode}
            messages={messages}
            input={input}
            sending={sending}
            awaitingResponse={awaitingResponse}
            inputRef={inputRef}
            listRef={listRef}
            onInput={setInput}
            onSend={sendMessage}
            onSubmit={submitMessage}
            onKeyDown={handleComposerKeyDown}
            onStop={stopGeneration}
            onReset={resetChat}
          />
        ) : (
          <main className="bubble-workspace">
            <div ref={listRef} className="bubble-message-scroll app-scrollbar">
              <TopicIntroCard topic={activeTopic} />
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
          user={profileUser}
          avatarSrc={avatarSrc}
          languageSaving={languageSaving}
          onLanguageChange={updatePreferredLanguage}
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

type MiniAppConfig = {
  icon: "compass" | "landmark" | "lesson" | "collab" | "socratic";
  eyebrow: string;
  setupTitle: string;
  setupBody: string;
  primaryLabel: string;
  primaryPlaceholder: string;
  secondaryLabel: string;
  secondaryPlaceholder: string;
  notesLabel: string;
  notesPlaceholder: string;
  cta: string;
  examples: string[];
  panels: Array<{ title: string; body: string }>;
  milestones: string[];
  buildPrompt: (input: { primary: string; secondary: string; notes: string }) => string;
};

const miniAppConfigs: Record<MiniMode, MiniAppConfig> = {
  "time-travel": {
    icon: "compass",
    eyebrow: "Time Travel Console",
    setupTitle: "Choose the destination.",
    setupBody: "Set a place, period, and mission. Your guide will keep the trip bounded to the era and mark speculation clearly.",
    primaryLabel: "Where and when",
    primaryPlaceholder: "Renaissance Florence in 1490",
    secondaryLabel: "Traveler role",
    secondaryPlaceholder: "Apprentice artist, merchant, visitor...",
    notesLabel: "Learning mission",
    notesPlaceholder: "Daily life, inventions, politics, food...",
    cta: "Open the portal",
    examples: ["Mohenjo-daro around 2500 BCE", "Baghdad during the House of Wisdom", "Tokyo in 2120"],
    panels: [
      { title: "Era Passport", body: "Arrival date, role, norms, and what knowledge belongs in that period." },
      { title: "Scene Choices", body: "Markets, homes, workshops, courts, maps, and decision points." },
      { title: "Timeline Log", body: "Important events, facts learned, and uncertainty notes stay visible." },
    ],
    milestones: ["Arrival", "Explore", "Log", "Choose next"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Take me on a time-travel learning session to ${primary}.`,
        secondary ? `My traveler role: ${secondary}.` : undefined,
        notes ? `My learning mission: ${notes}.` : undefined,
        "Start with an era passport, a vivid arrival scene, three choices for what to do next, and a compact timeline log.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  "historical-person": {
    icon: "landmark",
    eyebrow: "Historical Conversation Studio",
    setupTitle: "Invite a figure into the room.",
    setupBody: "Pick a person and a focus. The app separates in-character replies from context notes and record limits.",
    primaryLabel: "Historical figure",
    primaryPlaceholder: "Ada Lovelace, Cleopatra, B. R. Ambedkar...",
    secondaryLabel: "Conversation focus",
    secondaryPlaceholder: "Science, leadership, democracy, daily life...",
    notesLabel: "What you want to ask",
    notesPlaceholder: "A first question or angle",
    cta: "Begin the conversation",
    examples: ["Ada Lovelace on imagination", "Nelson Mandela on courage", "Hypatia on learning"],
    panels: [
      { title: "Persona Card", body: "Era, public worldview, voice, and what records can support." },
      { title: "Ask About", body: "Question prompts that deepen the exchange without turning it into a lecture." },
      { title: "Context Notes", body: "Short factual notes clarify uncertainty, bias, and interpretation." },
    ],
    milestones: ["Persona", "Question", "Reply", "Context"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Start a historically grounded conversation with ${primary}.`,
        secondary ? `Focus the conversation on ${secondary}.` : undefined,
        notes ? `My opening question or angle: ${notes}.` : undefined,
        "Begin with a persona card, then answer in character with brief context notes and suggested follow-up questions.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  "interactive-instruction": {
    icon: "lesson",
    eyebrow: "Adaptive Lesson Loop",
    setupTitle: "Build a lesson that reacts to you.",
    setupBody: "Choose a concept and starting level. Your tutor teaches a small piece, checks it, then adjusts after every reply.",
    primaryLabel: "Concept",
    primaryPlaceholder: "Fractions, supply and demand, Newton's laws...",
    secondaryLabel: "Starting level",
    secondaryPlaceholder: "Beginner, exam prep, advanced, age 12...",
    notesLabel: "Goal",
    notesPlaceholder: "Understand basics, solve problems, revise fast...",
    cta: "Start the loop",
    examples: ["Teach me ratios", "Explain electric circuits", "Help me learn supply and demand"],
    panels: [
      { title: "Mini Lesson", body: "One short concept chunk at a time, with examples that fit your level." },
      { title: "Quick Check", body: "A single check question before moving forward." },
      { title: "Mastery Meter", body: "Difficulty rises or softens based on your response." },
    ],
    milestones: ["Teach", "Check", "Adapt", "Next step"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Teach me ${primary} through an interactive lesson loop.`,
        secondary ? `My starting level: ${secondary}.` : undefined,
        notes ? `My goal: ${notes}.` : undefined,
        "Start with a tiny lesson, one check question, a mastery meter, and wait for my answer before continuing.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  "collaborative-instruction": {
    icon: "collab",
    eyebrow: "Collaborative Study Room",
    setupTitle: "Set the shared task.",
    setupBody: "Your buddy works beside you: you contribute ideas, the app organizes them, and both of you checkpoint progress.",
    primaryLabel: "Shared goal",
    primaryPlaceholder: "Understand photosynthesis, write an essay plan...",
    secondaryLabel: "What you already know",
    secondaryPlaceholder: "A few facts, a rough draft, where you are stuck...",
    notesLabel: "How we should work",
    notesPlaceholder: "Step by step, brainstorm first, solve together...",
    cta: "Open the study room",
    examples: ["Plan a climate essay", "Work through fractions", "Build a science project idea"],
    panels: [
      { title: "Task Board", body: "A shared goal, next actions, and what is already done." },
      { title: "Your Contribution", body: "You add ideas first so the buddy can build with you." },
      { title: "Checkpoint", body: "Short summaries keep both sides aligned before moving on." },
    ],
    milestones: ["Goal", "Your move", "Buddy build", "Checkpoint"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Start a collaborative instruction study-room session for this goal: ${primary}.`,
        secondary ? `What I already know: ${secondary}.` : undefined,
        notes ? `Preferred working style: ${notes}.` : undefined,
        "Create a shared task board, ask for my first contribution, then work beside me with checkpoints.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  "socratic-instruction": {
    icon: "socratic",
    eyebrow: "Socratic Question Ladder",
    setupTitle: "Start with a question, not a lecture.",
    setupBody: "Name the topic and your current guess. The app builds a ladder of questions, hints, evidence, and synthesis.",
    primaryLabel: "Topic or question",
    primaryPlaceholder: "Why do seasons happen?",
    secondaryLabel: "Current hypothesis",
    secondaryPlaceholder: "What you think so far",
    notesLabel: "Where you feel stuck",
    notesPlaceholder: "Definitions, evidence, first principles...",
    cta: "Climb the ladder",
    examples: ["What makes an argument valid?", "Why did empires fall?", "How do vaccines work?"],
    panels: [
      { title: "Current Hypothesis", body: "State your starting idea so the tutor has something to test." },
      { title: "Hint Ladder", body: "Small nudges arrive before direct explanations." },
      { title: "Synthesis Locked", body: "The final summary waits until you have done real thinking." },
    ],
    milestones: ["Hypothesis", "Question", "Hint", "Synthesis"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Guide me Socratically on: ${primary}.`,
        secondary ? `My current hypothesis: ${secondary}.` : "Ask me for my current hypothesis first.",
        notes ? `Where I feel stuck: ${notes}.` : undefined,
        "Ask one question at a time, track assumptions and evidence, offer hints on request, and do not synthesize until I have tried.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
};

function GuidedMiniAppWorkspace({
  topic,
  mode,
  messages,
  input,
  sending,
  awaitingResponse,
  inputRef,
  listRef,
  onInput,
  onSend,
  onSubmit,
  onKeyDown,
  onStop,
  onReset,
}: {
  topic: Topic;
  mode: MiniMode;
  messages: Message[];
  input: string;
  sending: boolean;
  awaitingResponse: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  onInput: (value: string) => void;
  onSend: (content: string) => Promise<void>;
  onSubmit: (event?: FormEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const config = miniAppConfigs[mode];
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [notes, setNotes] = useState("");
  const visibleMessages = messages.filter((message) => message.role !== "system");
  const hasSession = visibleMessages.length > 0 || sending || awaitingResponse;

  function startMiniApp(event?: FormEvent) {
    event?.preventDefault();
    if (!primary.trim() || sending) return;
    void onSend(
      config.buildPrompt({
        primary: primary.trim(),
        secondary: secondary.trim(),
        notes: notes.trim(),
      }),
    );
  }

  return (
    <main className="bubble-workspace bubble-mini-workspace">
      <div ref={listRef} className="bubble-mini-scroll app-scrollbar">
        {!hasSession ? (
          <section className="bubble-mini-start">
            <div className="bubble-mini-start-copy">
              <span>{config.eyebrow}</span>
              <h2>{config.setupTitle}</h2>
              <p>{config.setupBody}</p>
            </div>
            <form className="bubble-mini-start-form" onSubmit={startMiniApp}>
              <MiniIcon icon={config.icon} />
              <label>
                <span>{config.primaryLabel}</span>
                <input
                  value={primary}
                  onChange={(event) => setPrimary(event.target.value)}
                  placeholder={config.primaryPlaceholder}
                  disabled={sending}
                />
              </label>
              <label>
                <span>{config.secondaryLabel}</span>
                <input
                  value={secondary}
                  onChange={(event) => setSecondary(event.target.value)}
                  placeholder={config.secondaryPlaceholder}
                  disabled={sending}
                />
              </label>
              <label>
                <span>{config.notesLabel}</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={config.notesPlaceholder}
                  disabled={sending}
                  rows={3}
                />
              </label>
              <button type="submit" disabled={!primary.trim() || sending}>
                {config.cta}
              </button>
            </form>
            <div className="bubble-mini-example-row">
              {config.examples.map((example) => (
                <button key={example} type="button" onClick={() => setPrimary(example)}>
                  <Sparkles size={15} />
                  <span>{example}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="bubble-mini-session">
            <aside className="bubble-mini-side">
              <div className="bubble-mini-side-head">
                <MiniIcon icon={config.icon} />
                <div>
                  <span>{config.eyebrow}</span>
                  <strong>{topic.name}</strong>
                </div>
              </div>
              <div className="bubble-mini-side-grid">
                {config.panels.map((panel) => (
                  <article key={panel.title}>
                    <strong>{panel.title}</strong>
                    <span>{panel.body}</span>
                  </article>
                ))}
              </div>
              <button type="button" onClick={onReset} className="bubble-mini-new-session">
                New session
              </button>
            </aside>
            <div className="bubble-mini-conversation">
              <header className="bubble-mini-stage-header">
                <div>
                  <span>Live Session</span>
                  <strong>{config.milestones.join(" -> ")}</strong>
                </div>
                <div className="bubble-mini-stage-pills">
                  {config.milestones.map((milestone, index) => (
                    <span key={milestone} className={index === 0 ? "is-active" : ""}>
                      {milestone}
                    </span>
                  ))}
                </div>
              </header>
              <div className="bubble-message-stack bubble-mini-message-stack">
                {visibleMessages.map((message) => (
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
          </section>
        )}
      </div>
      {hasSession ? (
        <form onSubmit={onSubmit} className="bubble-composer">
          <div className="bubble-composer-inner">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={topic.inputboxText}
              disabled={sending}
              className="bubble-composer-input"
              rows={1}
            />
            <button
              type={sending ? "button" : "submit"}
              onClick={sending ? onStop : undefined}
              disabled={!sending && !input.trim()}
              aria-label={sending ? "Stop response" : "Send message"}
              className="bubble-send-button"
            >
              {sending ? <Square size={18} fill="currentColor" /> : <Send size={23} />}
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}

function MiniIcon({ icon }: { icon: MiniAppConfig["icon"] }) {
  const icons = {
    compass: Compass,
    landmark: Landmark,
    lesson: BookOpenCheck,
    collab: Clipboard,
    socratic: Gauge,
  };
  const Icon = icons[icon];
  return (
    <div className="bubble-mini-icon">
      <Icon size={24} />
    </div>
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
  return (
    <div className="bubble-rich-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          table: ({ children }) => (
            <div className="bubble-table-wrap">
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {normalizeAssistantMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

function normalizeAssistantMarkdown(content: string) {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression: string) => `\n\n$$\n${expression.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression: string) => `$${expression.trim()}$`);
}

const quizBuildSteps = [
  "Scanning the topic",
  "Balancing difficulty",
  "Writing clear options",
  "Hiding the answers",
  "Preparing explanations",
  "Shuffling the challenge",
];

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
  const [buildProgress, setBuildProgress] = useState(0);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState("");
  const quiz = activityRun?.type === "quiz" && isQuizState(activityRun.state) ? activityRun.state : null;
  const currentQuestion = quiz?.questions[quiz.currentIndex];
  const lastAnswered = quiz
    ? [...quiz.questions].reverse().find((question) => question.userAnswerIndex !== undefined)
    : undefined;

  useEffect(() => {
    if (!loading) return;
    const interval = window.setInterval(() => {
      setBuildProgress((current) => Math.min(94, current + Math.max(3, Math.round((100 - current) / 7))));
    }, 520);

    return () => window.clearInterval(interval);
  }, [loading]);

  async function startQuiz(event?: FormEvent) {
    event?.preventDefault();
    const quizTopic = topic.trim();
    if (!quizTopic || loading) return;
    setError("");
    setBuildProgress(8);
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
      setBuildProgress(100);
      onActivityRun(data.activityRun);
    } catch {
      setError("I could not build that quiz right now. Try a simpler topic or try again.");
      setBuildProgress(0);
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
        loading ? (
          <QuizBuildLoader topic={topic} progress={buildProgress} />
        ) : (
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
                Start
              </button>
            </div>
            {error ? <span className="bubble-quiz-error">{error}</span> : null}
          </form>
        )
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

function QuizBuildLoader({ topic, progress }: { topic: string; progress: number }) {
  const stepIndex = Math.min(quizBuildSteps.length - 1, Math.floor((progress / 100) * quizBuildSteps.length));
  return (
    <section className="bubble-quiz-loader" aria-live="polite">
      <div className="bubble-quiz-loader-orbit">
        <Sparkles size={28} />
        <span />
        <span />
        <span />
      </div>
      <div>
        <span className="bubble-quiz-loader-kicker">Building your quiz</span>
        <h2>{topic.trim() || "Your topic"}</h2>
        <p>{quizBuildSteps[stepIndex]}</p>
      </div>
      <div className="bubble-quiz-loader-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className="bubble-quiz-loader-steps">
        {quizBuildSteps.map((step, index) => (
          <li key={step} className={index <= stepIndex ? "is-active" : ""}>
            {step}
          </li>
        ))}
      </ol>
    </section>
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
  languageSaving,
  onLanguageChange,
  onClose,
}: {
  user: UserProfile;
  avatarSrc?: string;
  languageSaving: boolean;
  onLanguageChange: (language: string) => void;
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
      <div className="bubble-profile-body app-scrollbar">
        <section className="bubble-profile-hero">
          <div className="bubble-profile-avatar">{avatarSrc ? <img src={avatarSrc} alt="" /> : null}</div>
          <div>
            <h3>{user.name || "User Name"}</h3>
            <p>{user.email || "user@example.com"}</p>
          </div>
        </section>

        <div className="bubble-profile-info">
          <ProfileLine icon="user" label="Name" value={user.name || "User Name"} />
          <ProfileLine icon="mail" label="Email" value={user.email || "user@example.com"} />
        </div>

        <section className="bubble-language-card">
          <div className="bubble-language-card-head">
            <div className="bubble-profile-line-icon">
              <Languages size={22} />
            </div>
            <div>
              <strong>Response language</strong>
              <span>All tutoring replies follow this setting.</span>
            </div>
          </div>
          <select
            value={user.preferredLanguage || defaultLanguage}
            disabled={languageSaving}
            onChange={(event) => onLanguageChange(event.target.value)}
            className="bubble-language-select"
          >
            {supportedLanguages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
          {languageSaving ? <span className="bubble-language-saving">Saving...</span> : null}
        </section>

        <div className="bubble-profile-stats-grid">
          <ProfileStat label="Learning score" value={String(user.score ?? 0)} />
          <ProfileStat label="inspir'ed since" value={formatBubbleDate(user.createdAt)} />
        </div>

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
      </div>
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
