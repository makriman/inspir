"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  ArrowLeft,
  CalendarDays,
  History,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  RotateCcw,
  Search,
  Send,
  Trophy,
  User,
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
    setRecentOpen(false);

    const now = new Date();
    const userMessage: Message = {
      id: `local-user-${now.getTime()}`,
      role: "user",
      content,
      createdAt: now,
    };
    const assistantMessage: Message = {
      id: `local-assistant-${now.getTime()}`,
      role: "assistant",
      content: "",
      createdAt: new Date(),
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);

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
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id ? { ...message, content: assistantText } : message,
          ),
        );
      }
      await loadChat(chatId);
    } catch {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                content: "I could not answer right now. Please try again.",
              }
            : message,
        ),
      );
    } finally {
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
    <div className="flex h-screen overflow-hidden bg-black text-white">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-[min(86vw,496px)] border-r border-[#242424] bg-[#030303] transition-transform duration-200 md:static md:block md:w-[496px] md:translate-x-0 ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <TopicSidebar
          topics={topics}
          filteredTopics={filteredTopics}
          activeTopicId={activeTopicId}
          search={search}
          onSearch={setSearch}
          onSelect={selectTopic}
        />
      </aside>

      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close topics"
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <section className="flex min-w-0 flex-1 flex-col">
        <TopBar
          avatarSrc={avatarSrc}
          title={recentOpen ? `${activeTopic.name}'s Recent Conversations` : activeTopic.name}
          recentOpen={recentOpen}
          onProfile={() => setProfileOpen(true)}
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
          <main className="relative flex min-h-0 flex-1 flex-col bg-[#050505]">
            <div ref={listRef} className="app-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-10">
              <TopicIntroCard topic={activeTopic} />
              <div className="mt-8 flex flex-col gap-4 pb-28">
                {messages
                  .filter((message) => message.role !== "system")
                  .map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                {sending && messages[messages.length - 1]?.content === "" ? (
                  <div className="w-fit rounded-[9px] border-b-4 border-[#59c96b] bg-white px-5 py-4 text-xl font-black text-black">
                    Thinking...
                  </div>
                ) : null}
              </div>
            </div>
            <form
              onSubmit={submitMessage}
              className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black to-transparent px-4 pb-5 pt-8 md:px-10"
            >
              <div className="mx-auto flex h-[54px] max-w-3xl items-stretch">
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={activeTopic.inputboxText}
                  disabled={sending}
                  className="min-w-0 flex-1 rounded-l-[8px] border-2 border-r-0 border-[#8c8c8c] bg-[#0a0a0a] px-4 text-base font-bold text-white outline-none placeholder:text-[#9f9f9f]"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  aria-label="Send message"
                  className="grid w-[62px] place-items-center rounded-r-[8px] border-2 border-l-0 border-[#8c8c8c] bg-[#262626] text-white disabled:opacity-50"
                >
                  <Send size={26} fill="currentColor" />
                </button>
              </div>
            </form>
          </main>
        )}
      </section>

      <ProfileDrawer
        user={user}
        avatarSrc={avatarSrc}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </div>
  );
}

function TopicSidebar({
  topics,
  filteredTopics,
  activeTopicId,
  search,
  onSearch,
  onSelect,
}: {
  topics: Topic[];
  filteredTopics: Topic[];
  activeTopicId: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (topicId: string) => void;
}) {
  const activeTopic = topics.find((topic) => topic.id === activeTopicId);
  const rows = filteredTopics.length ? filteredTopics : activeTopic ? [activeTopic] : [];

  return (
    <div className="flex h-full flex-col bg-[#030303]">
      <div className="border-b border-[#242424] p-5">
        <div className="relative">
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search"
            className="h-12 w-full rounded-[7px] border border-[#8c8c8c] bg-black px-4 pr-11 text-lg font-bold text-white outline-none placeholder:text-white/75"
          />
          {search ? (
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80" size={20} />
          ) : null}
        </div>
      </div>
      <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto">
        {search && filteredTopics.length === 0 ? (
          <div className="px-6 py-12 text-center text-lg font-bold text-white/80">
            No search results
          </div>
        ) : null}
        {rows.map((topic) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => onSelect(topic.id)}
            className={`block w-full border-b border-[#242424] px-7 py-5 text-left transition hover:bg-[#1c1c1c] ${
              topic.id === activeTopicId ? "bg-[#262626]" : "bg-black"
            }`}
          >
            <div className="text-[22px] font-black leading-tight">{topic.name}</div>
            <div className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug text-white/75">
              {topic.subText}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TopBar({
  avatarSrc,
  title,
  recentOpen,
  onProfile,
  onReset,
  onRecent,
  onBack,
  onMenu,
}: {
  avatarSrc?: string;
  title: string;
  recentOpen: boolean;
  onProfile: () => void;
  onReset: () => void;
  onRecent: () => void;
  onBack: () => void;
  onMenu: () => void;
}) {
  return (
    <header className="grid h-[56px] grid-cols-[auto_1fr_auto] items-center bg-[#303030] px-3 md:grid-cols-[56px_170px_1fr_130px]">
      <button type="button" onClick={onMenu} className="mr-2 grid h-10 w-10 place-items-center md:hidden">
        <Menu size={24} />
      </button>
      <button
        type="button"
        onClick={onProfile}
        aria-label="Open profile"
        className="hidden h-11 w-11 overflow-hidden rounded-full bg-white/15 md:block"
      >
        {avatarSrc ? <img src={avatarSrc} alt="" className="h-full w-full object-cover" /> : null}
      </button>
      <div className="hidden items-center justify-center md:flex">
        <InspirLogo className="h-11 w-auto object-contain" />
      </div>
      <div className="flex min-w-0 items-center justify-center gap-3 px-2 text-center text-xl font-black md:text-2xl">
        {recentOpen ? (
          <button type="button" onClick={onBack} aria-label="Back to chat" className="grid h-9 w-9 place-items-center">
            <ArrowLeft size={26} />
          </button>
        ) : null}
        <span className="truncate">{title}</span>
      </div>
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onProfile}
          aria-label="Open profile"
          className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-white/15 md:hidden"
        >
          {avatarSrc ? <img src={avatarSrc} alt="" className="h-full w-full object-cover" /> : <User size={21} />}
        </button>
        <button type="button" onClick={onReset} aria-label="Reset conversation" className="text-[#e05055]">
          <RotateCcw size={27} />
        </button>
        <button type="button" onClick={onRecent} aria-label="Recent conversations" className="text-[#59c96b]">
          <History size={28} />
        </button>
      </div>
    </header>
  );
}

function TopicIntroCard({ topic }: { topic: Topic }) {
  return (
    <article className="max-w-3xl rounded-[9px] border-b-4 border-[#59c96b] bg-white px-5 py-4 text-black">
      <h2 className="text-2xl font-black">{topic.name}</h2>
      <p className="mt-3 text-xl font-black leading-snug">{topic.description}</p>
    </article>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[min(760px,88%)] rounded-[9px] px-5 py-4 text-xl font-black leading-snug ${
          isUser
            ? "bg-[#59c96b] text-white"
            : "border-b-4 border-[#59c96b] bg-white text-black"
        }`}
      >
        <p className="whitespace-pre-line">{message.content}</p>
        <time className={`mt-3 block text-right text-xs font-bold ${isUser ? "text-white/85" : "text-black/55"}`}>
          {formatBubbleDate(message.createdAt)}
        </time>
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
    <main className="app-scrollbar min-h-0 flex-1 overflow-y-auto bg-[#050505] px-4 py-8 md:px-10">
      <button type="button" onClick={onBack} className="mb-6 inline-flex items-center gap-2 font-black">
        <ArrowLeft size={24} />
        Back
      </button>
      <div className="space-y-4">
        {loading ? <p className="font-bold text-white/70">Loading...</p> : null}
        {!loading && chats.length === 0 ? (
          <p className="pt-20 text-center text-lg font-bold text-white/75">No search results</p>
        ) : null}
        {chats.map((chat) => (
          <button
            key={chat.id}
            type="button"
            onClick={() => onOpen(chat.id)}
            className="flex w-full items-center gap-4 rounded-[8px] bg-[#59c96b] px-5 py-4 text-left text-white"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-black">{chat.firstMessagePreview || chat.title}</div>
              <div className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-white/90">
                <MessageCircle size={16} />
                {chat.replyCount} Replies
              </div>
            </div>
            <time className="hidden shrink-0 text-sm font-bold md:block">
              {formatBubbleDate(chat.updatedAt)}
            </time>
          </button>
        ))}
      </div>
    </main>
  );
}

function ProfileDrawer({
  user,
  avatarSrc,
  open,
  onClose,
}: {
  user: UserProfile;
  avatarSrc?: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {open ? <button type="button" aria-label="Close profile" onClick={onClose} className="fixed inset-0 z-40 bg-black/50" /> : null}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-screen w-[min(92vw,460px)] flex-col bg-[#050505] shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-[56px] items-center justify-between border-b border-white/10 px-6">
          <h2 className="text-2xl font-black">Profile</h2>
          <button type="button" aria-label="Close profile" onClick={onClose} className="grid h-9 w-9 place-items-center">
            <X size={26} />
          </button>
        </div>
        <div className="app-scrollbar flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto mb-8 h-32 w-32 overflow-hidden rounded-full bg-white/10">
            {avatarSrc ? <img src={avatarSrc} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div className="space-y-4">
            <ProfileRow icon={User} label="Name" value={user.name || "User Name"} />
            <ProfileRow icon={Mail} label="Email" value={user.email || "user@example.com"} />
            <ProfileRow icon={Trophy} label="Score" value={String(user.score ?? 0)} />
            <ProfileRow icon={CalendarDays} label="inspir'ed since" value={formatBubbleDate(user.createdAt)} />
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-[7px] bg-[#0500d8] text-lg font-black text-white"
          >
            <LogOut size={21} />
            Logout
          </button>
        </div>
        <footer className="border-t border-white/10 px-6 py-5 text-center text-sm font-bold text-white/80">
          <div className="mb-4">
            <a href="/tnc">Terms and Conditions</a> | <a href="/privacy">Privacy Policy</a>
          </div>
          <SocialLinks compact />
        </footer>
      </aside>
    </>
  );
}

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[8px] bg-[#303030] px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-black text-white/80">
        <Icon size={18} />
        {label}
      </div>
      <div className="break-words text-lg font-black">{value}</div>
    </div>
  );
}
