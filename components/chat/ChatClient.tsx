"use client";

import {
  FormEvent,
  KeyboardEvent,
  RefObject,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  AlertTriangle,
  BookOpenCheck,
  Compass,
  Coins,
  FileText,
  Gauge,
  Gavel,
  History,
  Landmark,
  Languages,
  MapPin,
  MessageCircle,
  Scale,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Stamp,
  StickyNote,
  Thermometer,
  UserRound,
  Users,
  Waypoints,
} from "lucide-react";
import type { ActivityRun } from "@/components/chat/activity-model";
import { ChatMainSection } from "@/components/chat/ChatMainSection";
import { ChatPanelOverlays } from "@/components/chat/ChatPanelOverlays";
import {
  getDefaultSidebarTopicIds,
  type LearningStoreTopic,
} from "@/components/chat/learning-store-utils";
import { LearningStore } from "@/components/chat/LearningStore";
import {
  clearPendingAssistantMetadata,
  type ChatMessage as Message,
  type MessageMemorySource,
} from "@/components/chat/chat-message-model";
import { ClockIcon } from "@/components/chat/ClockIcon";
import {
  CoachChatSession,
  type CoachChatAction,
  type CoachChatDetail,
} from "@/components/chat/CoachChatSession";
import { CollaborativeInstructionWorkspace } from "@/components/chat/CollaborativeInstructionWorkspace";
import { FlashcardWorkspace } from "@/components/chat/FlashcardWorkspace";
import { GuestFeatureGate } from "@/components/chat/GuestFeatureGate";
import {
  type MemoryCreateInput,
  type MemoryDashboard,
  type MemorySettingsPatch,
  type MemoryUpdateInput,
} from "@/components/chat/memory-model";
import { MessageCard } from "@/components/chat/MessageCard";
import { MiniIcon } from "@/components/chat/MiniIcon";
import type { MiniAppIcon } from "@/components/chat/mini-icon-types";
import { displayMessages } from "@/components/chat/message-display";
import { ProfilePanel } from "@/components/chat/ProfilePanel";
import {
  profileFromApiUser,
  type ProfileDetailsInput,
  type ProfileResponse,
  type UserProfile,
} from "@/components/chat/profile-model";
import { QuizWorkspace } from "@/components/chat/QuizWorkspace";
import { RecentConversations } from "@/components/chat/RecentConversations";
import { StandardChatWorkspace } from "@/components/chat/StandardChatWorkspace";
import {
  mergeStateReducer,
  type MergeStateAction,
} from "@/components/chat/state-utils";
import { ThinkingMarker } from "@/components/chat/ThinkingMarker";
import { TopicIntroCard } from "@/components/chat/TopicIntroCard";
import {
  localizedTopicHref,
  type Topic,
  topicIntroProps,
  type TopicMetadata,
  topicMetadata,
  topicSearchContent,
} from "@/components/chat/topic-model";
import { TopicSidebar } from "@/components/chat/TopicSidebar";
import { FocusTimerWorkspace, usePersistentLearningTools } from "@/components/chat/PersistentLearningTools";
import { defaultLanguage } from "@/lib/content/languages";
import { topicPath } from "@/lib/content/topic-routing";
import { localizeHref } from "@/lib/i18n/routing";
import { buildMiniAppInstruction } from "@/lib/ai/visible-content";
import type { MainAppTranslationBundle } from "@/lib/i18n/main-app-types";

const InteractiveInstructionWorkspace = dynamic(() =>
  import("@/components/chat/InteractiveInstructionWorkspace").then((mod) => mod.InteractiveInstructionWorkspace),
);
const FocusMusicWorkspace = dynamic(() =>
  import("@/components/chat/FocusMusicWorkspace").then((mod) => mod.FocusMusicWorkspace),
);
const SocraticWorkspace = dynamic(() =>
  import("@/components/chat/SocraticWorkspace").then((mod) => mod.SocraticWorkspace),
);

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

type ChatCreateResponse = {
  chatId: string;
};

type ChatLoadResponse = {
  chat: { id: string };
  messages?: Message[];
  topic?: { id?: string | null } | null;
  activityRun?: ActivityRun | null;
};

type RecentChatsResponse = {
  chats?: RecentChat[];
};

class StaleChatRequestError extends Error {
  constructor() {
    super("Chat request was superseded");
    this.name = "StaleChatRequestError";
  }
}

type MiniMode = Exclude<TopicMetadata["uiMode"], "chat" | "quiz" | "flashcards" | "study-timer" | "focus-music">;

function readStoredGuestUsage(limit: number) {
  if (typeof window === "undefined") return 0;
  try {
    const stored = Number(window.localStorage.getItem("inspir_guest_messages_used") ?? "0");
    if (!Number.isFinite(stored) || stored <= 0) return 0;
    return Math.min(stored, limit);
  } catch {
    return 0;
  }
}

function writeStoredGuestUsage(used: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("inspir_guest_messages_used", String(used));
  } catch {
    // Guest limits are enforced server-side; local storage is only a UX hint.
  }
}

const sidebarFeatureStorageKey = "inspir_sidebar_feature_ids_v1";

function readStoredSidebarFeatureIds() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(sidebarFeatureStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : null;
  } catch {
    return null;
  }
}

function writeStoredSidebarFeatureIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sidebarFeatureStorageKey, JSON.stringify(ids));
  } catch {
    // The sidebar can fall back to defaults if persistence is unavailable.
  }
}

function uniqueValidTopicIds(ids: string[], topics: Topic[]) {
  const valid = new Set(topics.map((topic) => topic.id));
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (!valid.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function assistantResponseMetadata(response: Response) {
  const aiRunId = response.headers.get("x-inspir-ai-run-id")?.trim();
  const memorySources = parseMemorySourcesHeader(response.headers.get("x-inspir-memory-sources"));
  const metadata: Record<string, unknown> = {};
  if (aiRunId) metadata.aiRunId = aiRunId;
  if (memorySources.length > 0) metadata.memorySources = memorySources;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function parseMemorySourcesHeader(value: string | null): MessageMemorySource[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMessageMemorySource);
  } catch {
    return [];
  }
}

function isMessageMemorySource(value: unknown): value is MessageMemorySource {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.id === "string" &&
    typeof source.label === "string" &&
    typeof source.excerpt === "string" &&
    (source.type === "memory" || source.type === "summary" || source.type === "past_chat")
  );
}

function isExplicitMemoryMutationRequest(value: string) {
  return /\b(remember|remeber|rember|rememebr|remembr|remebr|keep in mind|save that|save this|forget|clear memory|clear memories|delete memory|delete memories)\b/i.test(
    value,
  );
}

const translatableAttributes = ["aria-label", "title", "placeholder"];

function buildTranslationTextMap(bundle: MainAppTranslationBundle | null | undefined) {
  const map = new Map<string, string>();
  if (!bundle) return map;
  for (const [key, source] of Object.entries(bundle.sourceStrings)) {
    const translated = bundle.strings[key];
    if (!translated) continue;
    map.set(source.trim(), translated);
  }
  return map;
}

function translateRawText(value: string, textMap: Map<string, string>) {
  if (!value.trim()) return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.trim();
  const translated = textMap.get(core);
  return translated ? `${leading}${translated}${trailing}` : value;
}

function translateTopic(topic: Topic, textMap: Map<string, string>): Topic {
  const metadata = topicMetadata(topic);
  return {
    ...topic,
    name: translateRawText(topic.name, textMap),
    subText: translateRawText(topic.subText, textMap),
    description: translateRawText(topic.description, textMap),
    inputboxText: translateRawText(topic.inputboxText, textMap),
    metadata: metadata
      ? {
          ...metadata,
          category: translateRawText(metadata.category, textMap),
          starters: metadata.starters.map((starter) => translateRawText(starter, textMap)),
        }
      : topic.metadata,
  };
}

function shouldSkipTranslation(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest("[data-no-auto-translate], code, pre, script, style"));
}

function useAutoTranslate(
  ref: MutableRefObject<HTMLElement | null>,
  bundle: MainAppTranslationBundle | null | undefined,
) {
  const textMap = useMemo(() => buildTranslationTextMap(bundle), [bundle]);

  useEffect(() => {
    const root = ref.current;
    if (!root || textMap.size === 0) return;
    const translateRoot = root;

    function translateNodeTree() {
      for (const element of Array.from(translateRoot.querySelectorAll<HTMLElement>("*"))) {
        if (shouldSkipTranslation(element)) continue;
        for (const attribute of translatableAttributes) {
          const value = element.getAttribute(attribute);
          if (!value) continue;
          const translated = translateRawText(value, textMap);
          if (translated !== value) element.setAttribute(attribute, translated);
        }
      }

      const walker = document.createTreeWalker(translateRoot, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
      for (const node of textNodes) {
        if (shouldSkipTranslation(node)) continue;
        const translated = translateRawText(node.data, textMap);
        if (translated !== node.data) node.data = translated;
      }
    }

    translateNodeTree();
    const observer = new MutationObserver(() => translateNodeTree());
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatableAttributes,
    });
    return () => observer.disconnect();
  }, [bundle?.language, bundle?.sourceHash, ref, textMap]);
}

function resolveSetState<Value>(nextValue: SetStateAction<Value>, currentValue: Value) {
  if (typeof nextValue === "function") return (nextValue as (value: Value) => Value)(currentValue);
  return nextValue;
}

type ChatClientState = {
  activeTopicId: string;
  activeChatId: string | undefined;
  messages: Message[];
  streamingMessageId: string | null;
  activityRun: ActivityRun | null;
  input: string;
  sending: boolean;
  awaitingResponse: boolean;
  search: string;
  storeOpen: boolean;
  sidebarTopicIds: string[] | null;
  profileOpen: boolean;
  recentOpen: boolean;
  recentChats: RecentChat[];
  recentLoading: boolean;
  mobileSidebarOpen: boolean;
  profileUser: UserProfile;
  agePromptOpen: boolean;
  translationBundle: MainAppTranslationBundle;
  languageSaving: boolean;
  guestMessagesUsed: number;
  guestPromptOpen: boolean;
  workspaceResetCount: number;
  memoryDashboard: MemoryDashboard | null;
  memoryLoading: boolean;
  memorySaving: boolean;
  memoryError: string | null;
  memorySourceModal: { messageId: string; sources: MessageMemorySource[] } | null;
};

function chatClientStateReducer(state: ChatClientState, nextState: MergeStateAction<ChatClientState>) {
  return mergeStateReducer(state, nextState);
}

type ChatClientProps = {
  authMode?: "authenticated" | "guest";
  user: UserProfile;
  topics: Topic[];
  initialTopicId: string;
  initialChatId?: string;
  initialMessages: Message[];
  initialActivityRun: ActivityRun | null;
  initialTranslationBundle: MainAppTranslationBundle;
  guestMessageLimit?: number;
};

export function ChatClient(props: ChatClientProps) {
  return <ChatClientLayout {...useChatClientController(props)} />;
}

type ChatClientController = ReturnType<typeof useChatClientController>;

function useChatClientController({
  authMode = "authenticated",
  user,
  topics,
  initialTopicId,
  initialChatId,
  initialMessages,
  initialActivityRun,
  initialTranslationBundle,
  guestMessageLimit = 10,
}: ChatClientProps) {
  const isGuest = authMode === "guest";
  const [
    {
      activeTopicId,
      activeChatId,
      messages,
      streamingMessageId,
      activityRun,
      input,
      sending,
      awaitingResponse,
      search,
      storeOpen,
      sidebarTopicIds,
      profileOpen,
      recentOpen,
      recentChats,
      recentLoading,
      mobileSidebarOpen,
      profileUser,
      agePromptOpen,
      translationBundle,
      languageSaving,
      guestMessagesUsed,
      guestPromptOpen,
      workspaceResetCount,
      memoryDashboard,
      memoryLoading,
      memorySaving,
      memoryError,
      memorySourceModal,
    },
    updateChatState,
  ] = useReducer(chatClientStateReducer, {
    activeTopicId: initialTopicId,
    activeChatId: initialChatId,
    messages: initialMessages,
    streamingMessageId: null,
    activityRun: initialActivityRun,
    input: "",
    sending: false,
    awaitingResponse: false,
    search: "",
    storeOpen: false,
    sidebarTopicIds: null,
    profileOpen: false,
    recentOpen: false,
    recentChats: [],
    recentLoading: false,
    mobileSidebarOpen: false,
    profileUser: user,
    agePromptOpen: !isGuest && !user.dateOfBirth,
    translationBundle: initialTranslationBundle,
    languageSaving: false,
    guestMessagesUsed: 0,
    guestPromptOpen: false,
    workspaceResetCount: 0,
    memoryDashboard: null,
    memoryLoading: false,
    memorySaving: false,
    memoryError: null,
    memorySourceModal: null,
  } satisfies ChatClientState);

  function updateChatField<Key extends keyof ChatClientState>(
    key: Key,
    nextValue: SetStateAction<ChatClientState[Key]>,
  ) {
    updateChatState((current) => ({
      [key]: resolveSetState(nextValue, current[key]),
    }));
  }

  const setActiveTopicId = (value: SetStateAction<ChatClientState["activeTopicId"]>) =>
    updateChatField("activeTopicId", value);
  const setActiveChatId = (value: SetStateAction<ChatClientState["activeChatId"]>) =>
    updateChatField("activeChatId", value);
  const setMessages = (value: SetStateAction<ChatClientState["messages"]>) => updateChatField("messages", value);
  const setStreamingMessageId = (value: SetStateAction<ChatClientState["streamingMessageId"]>) =>
    updateChatField("streamingMessageId", value);
  const setActivityRun = (value: SetStateAction<ChatClientState["activityRun"]>) =>
    updateChatField("activityRun", value);
  const setInput = (value: SetStateAction<ChatClientState["input"]>) => updateChatField("input", value);
  const setSending = (value: SetStateAction<ChatClientState["sending"]>) => updateChatField("sending", value);
  const setAwaitingResponse = (value: SetStateAction<ChatClientState["awaitingResponse"]>) =>
    updateChatField("awaitingResponse", value);
  const setSearch = (value: SetStateAction<ChatClientState["search"]>) => updateChatField("search", value);
  const setStoreOpen = (value: SetStateAction<ChatClientState["storeOpen"]>) => updateChatField("storeOpen", value);
  const setSidebarTopicIds = (value: SetStateAction<ChatClientState["sidebarTopicIds"]>) =>
    updateChatField("sidebarTopicIds", value);
  const setProfileOpen = (value: SetStateAction<ChatClientState["profileOpen"]>) =>
    updateChatField("profileOpen", value);
  const setRecentOpen = (value: SetStateAction<ChatClientState["recentOpen"]>) =>
    updateChatField("recentOpen", value);
  const setRecentChats = (value: SetStateAction<ChatClientState["recentChats"]>) =>
    updateChatField("recentChats", value);
  const setRecentLoading = (value: SetStateAction<ChatClientState["recentLoading"]>) =>
    updateChatField("recentLoading", value);
  const setMobileSidebarOpen = (value: SetStateAction<ChatClientState["mobileSidebarOpen"]>) =>
    updateChatField("mobileSidebarOpen", value);
  const setProfileUser = (value: SetStateAction<ChatClientState["profileUser"]>) =>
    updateChatField("profileUser", value);
  const setAgePromptOpen = (value: SetStateAction<ChatClientState["agePromptOpen"]>) =>
    updateChatField("agePromptOpen", value);
  const setLanguageSaving = (value: SetStateAction<ChatClientState["languageSaving"]>) =>
    updateChatField("languageSaving", value);
  const setGuestMessagesUsed = (value: SetStateAction<ChatClientState["guestMessagesUsed"]>) =>
    updateChatField("guestMessagesUsed", value);
  const setGuestPromptOpen = (value: SetStateAction<ChatClientState["guestPromptOpen"]>) =>
    updateChatField("guestPromptOpen", value);
  const setWorkspaceResetCount = (value: SetStateAction<ChatClientState["workspaceResetCount"]>) =>
    updateChatField("workspaceResetCount", value);
  const setMemoryDashboard = (value: SetStateAction<ChatClientState["memoryDashboard"]>) =>
    updateChatField("memoryDashboard", value);
  const setMemorySaving = (value: SetStateAction<ChatClientState["memorySaving"]>) =>
    updateChatField("memorySaving", value);
  const setMemoryError = (value: SetStateAction<ChatClientState["memoryError"]>) =>
    updateChatField("memoryError", value);
  const setMemorySourceModal = (value: SetStateAction<ChatClientState["memorySourceModal"]>) =>
    updateChatField("memorySourceModal", value);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const translationRootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldAutoFollowMessagesRef = useRef(true);
  const forceAutoFollowMessagesRef = useRef(false);
  const sidebarHydratedRef = useRef(false);
  const [sidebarPersonalizationReady, setSidebarPersonalizationReady] = useState(false);
  const translationTextMap = useMemo(() => buildTranslationTextMap(translationBundle), [translationBundle]);
  const translateUi = useCallback((source: string) => translateRawText(source, translationTextMap), [translationTextMap]);
  const displayTopics = useMemo(
    () => topics.map((topic) => translateTopic(topic, translationTextMap)),
    [topics, translationTextMap],
  );
  const learningTools = usePersistentLearningTools();
  useAutoTranslate(translationRootRef, translationBundle);

  const defaultSidebarIds = useMemo(
    () => getDefaultSidebarTopicIds(displayTopics as LearningStoreTopic[]),
    [displayTopics],
  );
  const addedTopicIds = useMemo(
    () =>
      uniqueValidTopicIds(
        sidebarPersonalizationReady ? sidebarTopicIds ?? defaultSidebarIds : defaultSidebarIds,
        displayTopics,
      ),
    [defaultSidebarIds, displayTopics, sidebarPersonalizationReady, sidebarTopicIds],
  );
  const sidebarTopics = useMemo(
    () => displayTopics.filter((topic) => addedTopicIds.includes(topic.id)),
    [addedTopicIds, displayTopics],
  );
  const activeTopic = displayTopics.find((topic) => topic.id === activeTopicId) ?? displayTopics[0];
  const metadata = topicMetadata(activeTopic);
  const uiMode = metadata?.uiMode ?? "chat";
  const isQuizMode = uiMode === "quiz";
  const isFlashcardMode = uiMode === "flashcards";
  const isFocusTimerMode = uiMode === "study-timer";
  const isFocusMusicMode = uiMode === "focus-music";
  const usesManagedMessageScroller = false;
  const isMiniAppMode =
    uiMode !== "chat" &&
    uiMode !== "quiz" &&
    uiMode !== "flashcards" &&
    uiMode !== "study-timer" &&
    uiMode !== "focus-music";
  const miniAppMode = isMiniAppMode ? (uiMode as MiniMode) : null;
  const visibleChatMessages = displayMessages(messages);
  const userDisplayName = profileUser.name?.trim() || "Learner";
  const currentLanguage = profileUser.preferredLanguage || defaultLanguage;

  function saveGuestUsage(used: number) {
    setGuestMessagesUsed(used);
    writeStoredGuestUsage(used);
  }

  const filteredTopics = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return displayTopics;
    return displayTopics.filter((topic) => topicSearchContent(topic).includes(q));
  }, [search, displayTopics]);

  useEffect(() => {
    if (sidebarHydratedRef.current) return;
    sidebarHydratedRef.current = true;
    let timeoutId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        const storedIds = readStoredSidebarFeatureIds();
        if (storedIds) updateChatState({ sidebarTopicIds: storedIds });
        setSidebarPersonalizationReady(true);
      }, 0);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  const loadMemoryDashboard = useCallback(async () => {
    if (isGuest) return;
    updateChatState({ memoryLoading: true, memoryError: null });
    try {
      const response = await fetch("/api/memory");
      if (!response.ok) throw new Error("Could not load memory");
      const data = (await response.json()) as MemoryDashboard;
      updateChatState({ memoryDashboard: data });
    } catch {
      updateChatState({ memoryError: "Could not load memory right now." });
    } finally {
      updateChatState({ memoryLoading: false });
    }
  }, [isGuest]);

  useEffect(() => {
    if (isGuest || !profileOpen || memoryDashboard || memoryLoading) return;
    void loadMemoryDashboard();
  }, [isGuest, profileOpen, memoryDashboard, memoryLoading, loadMemoryDashboard]);

  const isMessageScrollNearEnd = useCallback((threshold = 144) => {
    const element = listRef.current;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
  }, []);

  const scrollMessageViewportToEnd = useCallback((behavior: ScrollBehavior = "auto") => {
    if (usesManagedMessageScroller) return;
    if (!shouldAutoFollowMessagesRef.current && !forceAutoFollowMessagesRef.current) return;
    const element = listRef.current;
    if (!element) return;
    const top = Math.max(0, element.scrollHeight - element.clientHeight);
    if (behavior === "auto") {
      element.scrollTop = top;
      return;
    }
    element.scrollTo({ top, behavior });
  }, [usesManagedMessageScroller]);

  const scheduleMessageScrollToEnd = useCallback((behavior: ScrollBehavior = "auto") => {
    if (usesManagedMessageScroller) return;
    if (!shouldAutoFollowMessagesRef.current && !forceAutoFollowMessagesRef.current) return;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      scrollMessageViewportToEnd(behavior);
    });
  }, [scrollMessageViewportToEnd, usesManagedMessageScroller]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (usesManagedMessageScroller) return;
    const element = listRef.current;
    if (!element) return;

    let pointerScrollIntent = false;
    const handleScroll = () => {
      if (pointerScrollIntent) {
        handleUserScrollIntent();
        return;
      }
      if (!isMessageScrollNearEnd()) return;
      shouldAutoFollowMessagesRef.current = true;
      forceAutoFollowMessagesRef.current = true;
    };
    const handleUserScrollIntent = () => {
      window.requestAnimationFrame(() => {
        const shouldFollow = isMessageScrollNearEnd();
        shouldAutoFollowMessagesRef.current = shouldFollow;
        forceAutoFollowMessagesRef.current = shouldFollow;
      });
    };
    const handleScrollKey = (event: globalThis.KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "].includes(event.key)) {
        handleUserScrollIntent();
      }
    };
    const handlePointerDown = () => {
      pointerScrollIntent = true;
    };
    const handlePointerUp = () => {
      if (pointerScrollIntent) handleUserScrollIntent();
      pointerScrollIntent = false;
    };

    element.addEventListener("scroll", handleScroll, { passive: true });
    element.addEventListener("wheel", handleUserScrollIntent, { passive: true });
    element.addEventListener("touchmove", handleUserScrollIntent, { passive: true });
    element.addEventListener("keydown", handleScrollKey);
    element.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      element.removeEventListener("scroll", handleScroll);
      element.removeEventListener("wheel", handleUserScrollIntent);
      element.removeEventListener("touchmove", handleUserScrollIntent);
      element.removeEventListener("keydown", handleScrollKey);
      element.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isMessageScrollNearEnd, usesManagedMessageScroller]);

  useEffect(() => {
    if (usesManagedMessageScroller) return;
    const element = listRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const contentElement =
      element.querySelector<HTMLElement>('[data-slot="message-scroller-content"]') ??
      (element.firstElementChild instanceof HTMLElement ? element.firstElementChild : null);
    if (!contentElement) return;

    const observer = new ResizeObserver(() => {
      scheduleMessageScrollToEnd("auto");
    });
    observer.observe(contentElement);
    return () => observer.disconnect();
  }, [activeChatId, activeTopicId, scheduleMessageScrollToEnd, usesManagedMessageScroller]);

  useLayoutEffect(() => {
    shouldAutoFollowMessagesRef.current = true;
    forceAutoFollowMessagesRef.current = true;
    scrollMessageViewportToEnd("auto");
  }, [activeChatId, activeTopicId, scrollMessageViewportToEnd]);

  useLayoutEffect(() => {
    scrollMessageViewportToEnd("auto");
  }, [visibleChatMessages.length, activityRun, scrollMessageViewportToEnd]);

  useLayoutEffect(() => {
    scrollMessageViewportToEnd("auto");
  }, [messages, streamingMessageId, scrollMessageViewportToEnd]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, [input]);

  async function createChat(topicId = activeTopicId, activate = true) {
    if (isGuest) return "guest-chat";
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topicId }),
    });
    if (!response.ok) throw new Error("Could not start chat");
    const data = (await response.json()) as ChatCreateResponse;
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
    updateChatState({ awaitingResponse: false, sending: false, streamingMessageId: null });
  }

  async function loadChat(chatId: string, options?: { preserveRequest?: boolean }) {
    if (isGuest) return;
    if (!options?.preserveRequest) cancelActiveRequest();
    const response = await fetch(`/api/chats/${chatId}`);
    if (!response.ok) return;
    const data = (await response.json()) as ChatLoadResponse;
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
    setWorkspaceResetCount((current) => current + 1);
    if (isGuest) {
      setActiveChatId(undefined);
      setMessages([]);
      setActivityRun(null);
      setInput("");
      setRecentOpen(false);
      window.history.replaceState(null, "", localizeHref(topicPath(activeTopic.slug), currentLanguage));
      return;
    }
    const chatId = await createChat(activeTopicId);
    setMessages([]);
    setActivityRun(null);
    setRecentOpen(false);
    window.history.replaceState(null, "", `/chat/${chatId}`);
  }

  async function sendMessage(content: string, appendUser = true) {
    const trimmed = content.trim();
    if (!trimmed || sending || isQuizMode || isFlashcardMode) return;
    const storedGuestMessagesUsed = isGuest ? readStoredGuestUsage(guestMessageLimit) : guestMessagesUsed;
    const effectiveGuestMessagesUsed = isGuest
      ? Math.max(guestMessagesUsed, storedGuestMessagesUsed)
      : guestMessagesUsed;
    if (isGuest && effectiveGuestMessagesUsed !== guestMessagesUsed) {
      setGuestMessagesUsed(effectiveGuestMessagesUsed);
    }
    if (isGuest && effectiveGuestMessagesUsed >= guestMessageLimit) {
      setGuestPromptOpen(true);
      return;
    }

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    const isCurrentRequest = () => requestSeqRef.current === requestId;

    setInput("");
    setSending(true);
    setAwaitingResponse(true);
    setRecentOpen(false);
    setStreamingMessageId(null);
    shouldAutoFollowMessagesRef.current = true;
    forceAutoFollowMessagesRef.current = true;

    const now = new Date();
    const userMessage: Message = {
      id: `local-user-${now.getTime()}`,
      role: "user",
      content: trimmed,
      createdAt: now,
    };
    const assistantMessageId = `local-assistant-${now.getTime()}`;
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: now,
      metadata: { pendingAssistant: true },
    };
    setMessages((current) => [...current, ...(appendUser ? [userMessage] : []), assistantPlaceholder]);
    setStreamingMessageId(assistantMessageId);
    scheduleMessageScrollToEnd("auto");

    const controller = new AbortController();
    abortRef.current = controller;
    let cancelPendingAssistantFlush: (() => void) | null = null;

    try {
      const contextMessages = messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .slice(-12)
        .map((message) => ({ role: message.role, content: message.content }));
      const ensureCurrentRequest = () => {
        if (!isCurrentRequest()) throw new StaleChatRequestError();
      };
      const chatId = isGuest ? undefined : activeChatId ?? (await createChat(activeTopicId, false));
      ensureCurrentRequest();
      if (!isGuest && chatId && !activeChatId) {
        setActiveChatId(chatId);
        window.history.replaceState(null, "", `/chat/${chatId}`);
      }
      const response = await fetch(isGuest ? "/api/guest-chat" : "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isGuest
            ? {
                topicId: activeTopicId,
                content: trimmed,
                messages: contextMessages,
                preferredLanguage: profileUser.preferredLanguage,
              }
            : { chatId, content: trimmed },
        ),
        signal: controller.signal,
      });
      ensureCurrentRequest();
      if (isGuest && response.status === 429) {
        setGuestPromptOpen(true);
        setMessages((current) =>
          current.filter((message) => message.id !== userMessage.id && message.id !== assistantMessageId),
        );
        return;
      }
      if (!response.ok || !response.body) throw new Error("No assistant response");

      const responseAssistantMetadata = assistantResponseMetadata(response);
      if (responseAssistantMetadata) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  metadata: {
                    ...(message.metadata ?? {}),
                    ...responseAssistantMetadata,
                  },
                }
              : message,
          ),
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let assistantInserted = true;
      let assistantFlushTimeout: number | null = null;
      let assistantFlushFrame: number | null = null;

      function ensureCurrentStream() {
        if (isCurrentRequest()) return;
        void reader.cancel();
        throw new StaleChatRequestError();
      }

      function cancelAssistantFlush() {
        if (assistantFlushTimeout !== null) {
          window.clearTimeout(assistantFlushTimeout);
          assistantFlushTimeout = null;
        }
        if (assistantFlushFrame !== null) {
          window.cancelAnimationFrame(assistantFlushFrame);
          assistantFlushFrame = null;
        }
      }
      cancelPendingAssistantFlush = cancelAssistantFlush;

      function flushAssistantText({ final = false }: { final?: boolean } = {}) {
        cancelAssistantFlush();
        if (!assistantText && !final) return;
        if (!assistantInserted) {
          assistantInserted = true;
          updateChatState((current) => ({
            awaitingResponse: false,
            streamingMessageId: assistantMessageId,
            messages: [
              ...current.messages,
              {
                id: assistantMessageId,
                role: "assistant",
                content: assistantText,
                createdAt: new Date(),
                metadata: final
                  ? responseAssistantMetadata ?? undefined
                  : { ...(responseAssistantMetadata ?? {}), pendingAssistant: true },
              },
            ],
          }));
        } else {
          updateChatState((current) => ({
            awaitingResponse: false,
            messages: current.messages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: assistantText,
                    metadata: final ? clearPendingAssistantMetadata(message.metadata) : message.metadata,
                  }
                : message,
            ),
          }));
        }
        scheduleMessageScrollToEnd("auto");
      }

      function scheduleAssistantFlush() {
        if (!assistantInserted) {
          flushAssistantText();
          return;
        }
        if (assistantFlushTimeout !== null || assistantFlushFrame !== null) return;
        assistantFlushTimeout = window.setTimeout(() => {
          assistantFlushTimeout = null;
          assistantFlushFrame = window.requestAnimationFrame(() => {
            assistantFlushFrame = null;
            flushAssistantText();
          });
        }, 48);
      }

      async function readAssistantStream(): Promise<void> {
        ensureCurrentStream();
        const { value, done } = await reader.read();
        ensureCurrentStream();
        if (done) {
          const finalDecoderText = decoder.decode();
          if (finalDecoderText) assistantText += finalDecoderText;
          flushAssistantText({ final: true });
          return;
        }
        assistantText += decoder.decode(value, { stream: true });
        scheduleAssistantFlush();
        return readAssistantStream();
      }

      await readAssistantStream();
      if (isCurrentRequest()) {
        setStreamingMessageId(null);
        scheduleMessageScrollToEnd("auto");
      }
      if (isCurrentRequest() && isGuest) {
        const usedFromServer = Number(response.headers.get("x-guest-messages-used"));
        const nextUsed = Number.isFinite(usedFromServer)
          ? usedFromServer
          : Math.min(effectiveGuestMessagesUsed + 1, guestMessageLimit);
        saveGuestUsage(Math.min(nextUsed, guestMessageLimit));
      }
      if (isCurrentRequest() && !isGuest && chatId) {
        if (isExplicitMemoryMutationRequest(trimmed) && (profileOpen || memoryDashboard)) {
          window.setTimeout(() => {
            void loadMemoryDashboard();
          }, 1200);
        }
      }
    } catch (error) {
      cancelPendingAssistantFlush?.();
      if (error instanceof StaleChatRequestError) return;
      if (!isCurrentRequest()) return;
      setAwaitingResponse(false);
      setStreamingMessageId(null);
      if ((error as Error).name === "AbortError") {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: "Stopped. Send another message whenever you are ready.",
                  metadata: clearPendingAssistantMetadata(message.metadata),
                }
              : message,
          ),
        );
      } else {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: "I could not answer right now. Please try again.",
                  metadata: clearPendingAssistantMetadata(message.metadata),
                }
              : message,
          ),
        );
      }
      scheduleMessageScrollToEnd("auto");
    } finally {
      cancelPendingAssistantFlush?.();
      if (isCurrentRequest()) {
        abortRef.current = null;
        setAwaitingResponse(false);
        setStreamingMessageId(null);
        scheduleMessageScrollToEnd("auto");
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
    shouldAutoFollowMessagesRef.current = true;
    void sendMessage(lastUser.content, false);
  }

  function addSidebarTopic(topicId: string, options?: { selectAfterAdd?: boolean }) {
    setSidebarTopicIds((current) => {
      const base = uniqueValidTopicIds(current ?? defaultSidebarIds, displayTopics);
      const nextIds = base.includes(topicId) ? base : [...base, topicId];
      writeStoredSidebarFeatureIds(nextIds);
      return nextIds;
    });
    if (options?.selectAfterAdd) {
      selectTopic(topicId);
    }
  }

  function removeSidebarTopic(topicId: string) {
    setSidebarTopicIds((current) => {
      const base = uniqueValidTopicIds(current ?? defaultSidebarIds, displayTopics);
      const nextIds = base.filter((id) => id !== topicId);
      writeStoredSidebarFeatureIds(nextIds);
      return nextIds;
    });
  }

  function openLearningStore() {
    setStoreOpen(true);
    setProfileOpen(false);
    setRecentOpen(false);
    setMobileSidebarOpen(false);
  }

  function openFirstTopicWithMode(mode: TopicMetadata["uiMode"]) {
    const topic = topics.find((item) => topicMetadata(item)?.uiMode === mode);
    if (topic) selectTopic(topic.id);
  }

  function selectTopic(topicId: string) {
    const nextTopic = topics.find((topic) => topic.id === topicId);
    cancelActiveRequest();
    shouldAutoFollowMessagesRef.current = true;
    setActiveTopicId(topicId);
    setActiveChatId(undefined);
    setMessages([]);
    setActivityRun(null);
    setInput("");
    setRecentOpen(false);
    setStoreOpen(false);
    setProfileOpen(false);
    setMobileSidebarOpen(false);
    window.history.replaceState(null, "", localizeHref(nextTopic ? topicPath(nextTopic.slug) : "/chat", currentLanguage));
  }

  async function openRecentConversations() {
    if (isGuest) return;
    setRecentLoading(true);
    setRecentOpen(true);
    setProfileOpen(false);
    try {
      const response = await fetch(`/api/chats?topicId=${activeTopicId}`);
      const data = (await response.json()) as RecentChatsResponse;
      setRecentChats(data.chats ?? []);
    } finally {
      setRecentLoading(false);
    }
  }

  async function updatePreferredLanguage(preferredLanguage: string) {
    if (isGuest) return;
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
      const data = (await response.json()) as ProfileResponse;
      if (data.user) {
        setProfileUser(profileFromApiUser(data.user));
      }
      window.location.assign(localizeHref(window.location.pathname + window.location.search, preferredLanguage));
    } catch {
      setProfileUser(previous);
    } finally {
      setLanguageSaving(false);
    }
  }

  async function updateProfileDetails(input: ProfileDetailsInput) {
    if (isGuest) return profileUser;
    const response = await fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await response.json().catch(() => null)) as ProfileResponse | null;
    if (!response.ok || !data?.user) {
      throw new Error(data?.error || "Could not save profile");
    }
    const updatedUser = profileFromApiUser(data.user);
    setProfileUser(updatedUser);
    return updatedUser;
  }

  async function uploadProfilePhoto(file: File) {
    if (isGuest) return null;
    const formData = new FormData();
    formData.set("photo", file);
    const response = await fetch("/api/me/photo", {
      method: "PATCH",
      body: formData,
    });
    const data = (await response.json().catch(() => null)) as { profileImageHash?: string | null; error?: string } | null;
    if (!response.ok) {
      throw new Error(data?.error || "Could not update profile photo.");
    }
    setProfileUser((current) => ({
      ...current,
      profileImageHash: data?.profileImageHash ?? null,
    }));
    return data?.profileImageHash ?? null;
  }

  async function removeProfilePhoto() {
    if (isGuest) return;
    const response = await fetch("/api/me/photo", { method: "DELETE" });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      throw new Error(data?.error || "Could not reset profile photo.");
    }
    setProfileUser((current) => ({
      ...current,
      profileImageHash: null,
    }));
  }

  async function patchMemorySettings(input: MemorySettingsPatch) {
    if (isGuest) return;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch("/api/memory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Could not update memory settings");
      const data = (await response.json()) as MemoryDashboard;
      setMemoryDashboard(data);
    } catch {
      setMemoryError("Could not update memory settings.");
    } finally {
      setMemorySaving(false);
    }
  }

  async function createMemoryItem(input: MemoryCreateInput) {
    if (isGuest) return;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Could not add memory");
      const data = (await response.json()) as MemoryDashboard;
      setMemoryDashboard(data);
    } catch {
      setMemoryError("Could not add that memory.");
    } finally {
      setMemorySaving(false);
    }
  }

  async function updateMemoryItem(
    memoryId: string,
    input: MemoryUpdateInput,
  ) {
    if (isGuest) return;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch(`/api/memory/${memoryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Could not update memory");
      await loadMemoryDashboard();
    } catch {
      setMemoryError("Could not update that memory.");
    } finally {
      setMemorySaving(false);
    }
  }

  async function deleteMemoryItem(memoryId: string) {
    if (isGuest) return;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch(`/api/memory/${memoryId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete memory");
      await loadMemoryDashboard();
    } catch {
      setMemoryError("Could not delete that memory.");
    } finally {
      setMemorySaving(false);
    }
  }

  async function clearMemory() {
    if (isGuest) return;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch("/api/memory", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not clear memory");
      const data = (await response.json()) as MemoryDashboard;
      setMemoryDashboard(data);
    } catch {
      setMemoryError("Could not clear memory.");
    } finally {
      setMemorySaving(false);
    }
  }

  async function submitMemorySourceFeedback(source: MessageMemorySource, action: "relevant" | "not_relevant" | "dont_mention") {
    if (isGuest) return;
    const aiRunId = memorySourceModal ? findAiRunIdForMessage(messages, memorySourceModal.messageId) : undefined;
    try {
      const response = await fetch("/api/memory/source-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          aiRunId,
          memoryId: source.memoryId,
          chatTurnId: source.chatTurnId,
          summarySectionId: source.summarySectionId,
          action,
        }),
      });
      if (!response.ok) throw new Error("Could not save source feedback");
      if (action !== "relevant") await loadMemoryDashboard();
    } catch {
      setMemoryError("Could not update that memory source.");
    }
  }

  const avatarSrc = profileUser.profileImageHash
    ? `/api/me/photo?hash=${profileUser.profileImageHash}`
    : profileUser.image || undefined;

  return {
    activeChatId,
    activeTopic,
    activeTopicId,
    activityRun,
    addSidebarTopic,
    addedTopicIds,
    agePromptOpen,
    awaitingResponse,
    avatarSrc,
    createChat,
    currentLanguage,
    displayTopics,
    filteredTopics,
    guestMessageLimit,
    guestMessagesUsed,
    guestPromptOpen,
    handleComposerKeyDown,
    input,
    inputRef,
    isFlashcardMode,
    isFocusMusicMode,
    isFocusTimerMode,
    isGuest,
    isQuizMode,
    languageSaving,
    learningTools,
    listRef,
    loadChat,
    messages,
    streamingMessageId,
    memoryDashboard,
    memoryError,
    memoryLoading,
    memorySaving,
    memorySourceModal,
    metadata,
    miniAppMode,
    mobileSidebarOpen,
    openRecentConversations,
    openFirstTopicWithMode,
    openLearningStore,
    profileOpen,
    profileUser,
    recentChats,
    recentLoading,
    recentOpen,
    regenerateLast,
    resetChat,
    search,
    selectTopic,
    sendMessage,
    sidebarTopics,
    sending,
    setActivityRun,
    setAgePromptOpen,
    setGuestPromptOpen,
    setInput,
    setMobileSidebarOpen,
    setMemorySourceModal,
    setProfileOpen,
    setProfileUser,
    setRecentOpen,
    setSearch,
    setStoreOpen,
    stopGeneration,
    storeOpen,
    uploadProfilePhoto,
    submitMemorySourceFeedback,
    submitMessage,
    translateUi,
    translationBundle,
    translationRootRef,
    patchMemorySettings,
    createMemoryItem,
    updateMemoryItem,
    updateProfileDetails,
    updatePreferredLanguage,
    deleteMemoryItem,
    clearMemory,
    removeProfilePhoto,
    removeSidebarTopic,
    userDisplayName,
    visibleChatMessages,
    workspaceResetCount,
  };
}

function ChatClientLayout(controller: ChatClientController) {
  const {
    activeTopic,
    activeTopicId,
    addSidebarTopic,
    addedTopicIds,
    agePromptOpen,
    avatarSrc,
    currentLanguage,
    displayTopics,
    filteredTopics,
    guestMessageLimit,
    guestMessagesUsed,
    guestPromptOpen,
    isFlashcardMode,
    isGuest,
    isQuizMode,
    learningTools,
    memorySourceModal,
    messages,
    mobileSidebarOpen,
    openLearningStore,
    openRecentConversations,
    openFirstTopicWithMode,
    profileOpen,
    profileUser,
    recentOpen,
    regenerateLast,
    resetChat,
    search,
    selectTopic,
    sending,
    sidebarTopics,
    setGuestPromptOpen,
    setAgePromptOpen,
    setMemorySourceModal,
    setMobileSidebarOpen,
    setProfileOpen,
    setProfileUser,
    setRecentOpen,
    setSearch,
    setStoreOpen,
    stopGeneration,
    storeOpen,
    submitMemorySourceFeedback,
    translateUi,
    translationBundle,
    translationRootRef,
  } = controller;
  return (
    <div
      key={`${translationBundle.language}-${translationBundle.sourceHash}`}
      ref={translationRootRef}
      className={`inspir-chat-root ${profileOpen ? "profile-open" : ""}`}
    >
      <aside className={`inspir-sidebar ${mobileSidebarOpen ? "is-open" : ""}`}>
        <TopicSidebar
          isGuest={isGuest}
          avatarSrc={avatarSrc}
          topics={displayTopics}
          sidebarTopics={sidebarTopics}
          filteredTopics={filteredTopics}
          currentLanguage={controller.currentLanguage}
          activeTopicId={activeTopicId}
          addedTopicIds={addedTopicIds}
          search={search}
          onAddFeature={(topicId) => addSidebarTopic(topicId, { selectAfterAdd: true })}
          onOpenStore={openLearningStore}
          onProfile={() => {
            if (isGuest) setGuestPromptOpen(true);
            else {
              controller.setStoreOpen(false);
              controller.setRecentOpen(false);
              setProfileOpen(true);
            }
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
          className="inspir-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <ChatMainSection
        title={
          profileOpen
            ? "Profile"
            : storeOpen
              ? "Learning Store"
              : recentOpen
                ? `${activeTopic.name}'s Recent Conversations`
                : activeTopic.name
        }
        recentOpen={recentOpen || storeOpen || profileOpen}
        showRecent={!isGuest && !storeOpen && !profileOpen}
        sending={sending}
        canRegenerate={
          !profileOpen &&
          !storeOpen &&
          !isGuest &&
          !isQuizMode &&
          !isFlashcardMode &&
          messages.some((message) => message.role === "user")
        }
        onReset={resetChat}
        onRecent={() => void openRecentConversations()}
        onBack={() => {
          if (profileOpen) setProfileOpen(false);
          else if (storeOpen) setStoreOpen(false);
          else setRecentOpen(false);
        }}
        onMenu={() => setMobileSidebarOpen(true)}
        onStop={stopGeneration}
        onRegenerate={regenerateLast}
        showSessionActions={!storeOpen && !profileOpen}
      >
        <ChatWorkspaceSwitch controller={controller} />
      </ChatMainSection>
      <ChatPanelOverlays
        activeTopic={activeTopic}
        agePromptOpen={agePromptOpen}
        currentLanguage={currentLanguage}
        guestMessageLimit={guestMessageLimit}
        guestMessagesUsed={guestMessagesUsed}
        guestPromptOpen={guestPromptOpen}
        isGuest={isGuest}
        learningTools={learningTools}
        memorySourceModal={memorySourceModal}
        profileUser={profileUser}
        onAgePromptOpen={setAgePromptOpen}
        onGuestPromptOpen={setGuestPromptOpen}
        onMemorySourceFeedback={(source, action) => void submitMemorySourceFeedback(source, action)}
        onMemorySourceModal={setMemorySourceModal}
        onOpenMusic={() => openFirstTopicWithMode("focus-music")}
        onOpenTimer={() => openFirstTopicWithMode("study-timer")}
        onProfileUser={setProfileUser}
        t={translateUi}
      />
    </div>
  );
}

function ChatWorkspaceSwitch({ controller }: { controller: ChatClientController }) {
  const {
    activeChatId,
    activeTopic,
    activeTopicId,
    activityRun,
    addSidebarTopic,
    addedTopicIds,
    awaitingResponse,
    createChat,
    displayTopics,
    handleComposerKeyDown,
    input,
    inputRef,
    isFlashcardMode,
    isFocusMusicMode,
    isFocusTimerMode,
    isGuest,
    isQuizMode,
    currentLanguage,
    learningTools,
    listRef,
    loadChat,
    messages,
    metadata,
    memoryDashboard,
    memoryError,
    memoryLoading,
    memorySaving,
    miniAppMode,
    profileOpen,
    profileUser,
    recentChats,
    recentLoading,
    recentOpen,
    removeSidebarTopic,
    resetChat,
    selectTopic,
    sendMessage,
    sending,
    setActivityRun,
    setInput,
    setMemorySourceModal,
    setRecentOpen,
    setProfileOpen,
    stopGeneration,
    streamingMessageId,
    storeOpen,
    submitMessage,
    translateUi,
    avatarSrc,
    clearMemory,
    createMemoryItem,
    deleteMemoryItem,
    languageSaving,
    patchMemorySettings,
    removeProfilePhoto,
    updateMemoryItem,
    updateProfileDetails,
    uploadProfilePhoto,
    userDisplayName,
    visibleChatMessages,
    workspaceResetCount,
  } = controller;

  if (profileOpen) {
    return (
      <ProfilePanel
        user={profileUser}
        avatarSrc={avatarSrc}
        languageSaving={languageSaving}
        memoryDashboard={memoryDashboard}
        memoryLoading={memoryLoading}
        memorySaving={memorySaving}
        memoryError={memoryError}
        onPhotoUpload={uploadProfilePhoto}
        onPhotoRemove={removeProfilePhoto}
        onProfileSave={updateProfileDetails}
        onMemorySettings={patchMemorySettings}
        onMemoryCreate={createMemoryItem}
        onMemoryUpdate={updateMemoryItem}
        onMemoryDelete={deleteMemoryItem}
        onMemoryClear={clearMemory}
        onClose={() => setProfileOpen(false)}
        t={translateUi}
      />
    );
  }

  if (storeOpen) {
    return (
      <LearningStore
        topics={displayTopics as LearningStoreTopic[]}
        addedTopicIds={addedTopicIds}
        activeTopicId={activeTopicId}
        onAdd={addSidebarTopic}
        onRemove={removeSidebarTopic}
        onSelect={selectTopic}
      />
    );
  }

  if (recentOpen && !isGuest) {
    return (
      <RecentConversations
        chats={recentChats}
        loading={recentLoading}
        onBack={() => setRecentOpen(false)}
        onOpen={loadChat}
      />
    );
  }

  if (isQuizMode) {
    if (isGuest) {
      return (
        <GuestFeatureGate
          {...topicIntroProps(activeTopic)}
          featureName="scored AI quizzes"
          starters={topicMetadata(activeTopic)?.starters ?? []}
          topicHref={localizedTopicHref(activeTopic, currentLanguage)}
        />
      );
    }
    return (
      <QuizWorkspace
        activeChatId={activeChatId}
        activeTopicId={activeTopicId}
        activityRun={activityRun}
        createChat={createChat}
        onActivityRun={setActivityRun}
      />
    );
  }

  if (isFlashcardMode) {
    if (isGuest) {
      return (
        <GuestFeatureGate
          {...topicIntroProps(activeTopic)}
          featureName="AI flashcard decks"
          starters={topicMetadata(activeTopic)?.starters ?? []}
          topicHref={localizedTopicHref(activeTopic, currentLanguage)}
        />
      );
    }
    return (
      <FlashcardWorkspace
        activeChatId={activeChatId}
        activeTopicId={activeTopicId}
        activityRun={activityRun}
        createChat={createChat}
        onActivityRun={setActivityRun}
        onReset={resetChat}
      />
    );
  }

  if (isFocusTimerMode) return <FocusTimerWorkspace tools={learningTools} />;
  if (isFocusMusicMode) return <FocusMusicWorkspace tools={learningTools} />;

  if (!miniAppMode) {
    return (
      <StandardChatWorkspace
        activeTopic={activeTopic}
        awaitingResponse={awaitingResponse}
        handleComposerKeyDown={handleComposerKeyDown}
        input={input}
        inputRef={inputRef}
        listRef={listRef}
        metadata={metadata}
        sendMessage={sendMessage}
        sending={sending}
        setInput={setInput}
        stopGeneration={stopGeneration}
        streamingMessageId={streamingMessageId}
        submitMessage={submitMessage}
        userDisplayName={userDisplayName}
        visibleChatMessages={visibleChatMessages}
        onMemorySources={(messageId, sources) => setMemorySourceModal({ messageId, sources })}
      />
    );
  }

  const miniAppProps = {
    key: `${activeTopic.id}-${workspaceResetCount}`,
    topic: activeTopic,
    userName: userDisplayName,
    messages,
    input,
    sending,
    awaitingResponse,
    inputRef,
    listRef,
    language: currentLanguage,
    onInput: setInput,
    onSend: sendMessage,
    onSubmit: submitMessage,
    onKeyDown: handleComposerKeyDown,
    onStop: stopGeneration,
    onReset: resetChat,
  };

  if (miniAppMode === "interactive-instruction") {
    return (
      <InteractiveInstructionWorkspace
        key={miniAppProps.key}
        topic={activeTopic}
        language={currentLanguage}
        onReset={resetChat}
      />
    );
  }
  if (miniAppMode === "time-travel") return <TimeTravelWorkspace {...miniAppProps} />;
  if (miniAppMode === "socratic-instruction") return <SocraticWorkspace {...miniAppProps} />;
  return <GuidedMiniAppWorkspace {...miniAppProps} mode={miniAppMode} />;
}

type TimeTravelStep = "departure" | "destination" | "identity" | "purpose" | "realism" | "depth" | "clearance";

type TimeTravelJourney = {
  id: string;
  label: string;
  place: string;
  date: string;
  arrival: string;
  context: string;
  season: string;
  jurisdiction: string;
  risk: string;
  confidence: string;
  languages: string[];
  currency: string;
  route: string[];
  eventClock: string[];
  people: string[];
  objects: string[];
  socialRules: string[];
  knownFacts: string[];
  reconstructions: string[];
  speculative: string[];
  actions: string[];
  sensory: string;
  exposureRisk: string;
};

type TimeTravelerIdentity = {
  id: string;
  label: string;
  role: string;
  description: string;
  languages: string;
  status: string;
  clothing: string;
  money: string;
  clearance: string;
};

type TimeTravelChoice = {
  id: string;
  label: string;
  description: string;
};

const timeTravelJourneyTemplates: TimeTravelJourney[] = [
  {
    id: "florence-1504",
    label: "Florence, 1504",
    place: "Florence",
    date: "September 1504",
    arrival: "Piazza della Signoria, near the newly installed David",
    context: "Republican Florence after the Medici expulsion, with guild politics and artistic patronage in public view.",
    season: "Early autumn",
    jurisdiction: "Florentine Republic",
    risk: "Moderate",
    confidence: "High for politics and major sites; mixed for street-level dialogue.",
    languages: ["Tuscan Italian", "Latin among educated elites"],
    currency: "Florin, soldi, small coinage",
    route: ["Piazza della Signoria", "Guild workshops", "Mercato Vecchio", "Arno crossings"],
    eventClock: ["David has become a civic symbol", "Guild alliances shape access", "Rumors about Medici return circulate"],
    people: ["Stone carver's apprentice", "Wool guild factor", "Humanist secretary"],
    objects: ["Florin coin", "Workshop chalk study", "Guild token"],
    socialRules: ["Patronage opens doors", "Public speech has factional weight", "Clothing signals rank quickly"],
    knownFacts: ["Michelangelo's David was installed in 1504", "Florence was a republic in this period", "Guilds shaped civic power"],
    reconstructions: ["Market noise, smells, and bargaining norms are inferred from urban records", "Ordinary conversations are plausible composites"],
    speculative: ["Specific private opinions of unnamed residents", "Exact sequence of a street encounter"],
    actions: ["Inspect the guild token", "Ask about the David", "Find a print seller"],
    sensory: "Stone dust, wool dye, bells, and sharp political glances under a crowded square.",
    exposureRisk: "Modern talk of individual artistic genius can sound naive without patronage, guild, and civic context.",
  },
  {
    id: "delhi-1857",
    label: "Delhi, 1857",
    place: "Delhi",
    date: "September 1857",
    arrival: "Market street near Chandni Chowk during the siege",
    context: "The Indian Rebellion of 1857 has made Delhi a contested imperial and military space.",
    season: "Late monsoon",
    jurisdiction: "Mughal symbolic authority under rebel control, contested by the East India Company",
    risk: "High",
    confidence: "High for major military events; mixed for ordinary household details.",
    languages: ["Hindustani", "Persian in elite records", "English among Company forces"],
    currency: "Rupees, silver coin, credit through trusted households",
    route: ["Chandni Chowk", "Kashmere Gate", "Red Fort approaches", "Merchant lanes"],
    eventClock: ["Siege pressure is rising", "Supplies and loyalties are strained", "Rumors move faster than verified news"],
    people: ["Merchant household scribe", "Water carrier", "Sepoy courier"],
    objects: ["Folded letter", "Silver rupee", "Cloth ration bundle"],
    socialRules: ["Questions about allegiance are dangerous", "Language and dress signal risk", "Movement needs a plausible errand"],
    knownFacts: ["Delhi was a central site in the 1857 rebellion", "Kashmere Gate was militarily significant", "Bahadur Shah Zafar became a symbolic focus"],
    reconstructions: ["Street-level errands and household anxieties are built from memoirs and social history", "Unnamed residents are composites"],
    speculative: ["Exact words spoken by ordinary people", "Private motivations without records"],
    actions: ["Deliver the folded letter", "Ask a water carrier what locals know", "Compare rebel and Company information"],
    sensory: "Wet dust, shouted rumors, smoke, prayer calls, and the metallic anxiety of a city under pressure.",
    exposureRisk: "Asking openly who will win could expose you; people here do not have historian hindsight.",
  },
  {
    id: "athens-399-bce",
    label: "Athens, 399 BCE",
    place: "Athens",
    date: "399 BCE",
    arrival: "Agora during the days around Socrates' trial",
    context: "Democratic Athens is recovering from war, oligarchic trauma, and civic suspicion.",
    season: "Spring",
    jurisdiction: "Athenian democracy",
    risk: "Moderate",
    confidence: "High for broad civic institutions; contested for Socrates' exact voice and motives.",
    languages: ["Attic Greek"],
    currency: "Drachmae and obols",
    route: ["Agora", "Stoa Basileios", "Law courts", "Workshops near the square"],
    eventClock: ["Trial talk travels through civic spaces", "Recent political wounds remain raw", "Citizens weigh piety, education, and loyalty"],
    people: ["Potter-citizen", "Metic trader", "Young rhetoric student"],
    objects: ["Ostrakon shard", "Oil flask", "Wax tablet"],
    socialRules: ["Citizenship determines political voice", "Public argument is social performance", "Piety is civic, not private only"],
    knownFacts: ["Socrates was tried and executed in 399 BCE", "The Athenian agora was a civic center", "Citizenship was restricted"],
    reconstructions: ["Ordinary reactions are plausible blends of legal and literary evidence", "Street routes are approximate"],
    speculative: ["How any single bystander felt about Socrates", "Exact trial-day crowd movement"],
    actions: ["Attend court gossip", "Ask a metic what citizenship excludes", "Inspect the ostrakon"],
    sensory: "Olive oil, dust, bronze, public argument, and the uneasy pride of a wounded democracy.",
    exposureRisk: "Modern assumptions about equal citizenship would be immediately out of place.",
  },
  {
    id: "changan-742",
    label: "Chang'an, 742",
    place: "Chang'an",
    date: "742 CE",
    arrival: "West Market during the Tang dynasty",
    context: "Tang Chang'an is a cosmopolitan imperial capital linked to steppe, Central Asian, and Buddhist networks.",
    season: "Late spring",
    jurisdiction: "Tang Empire under Emperor Xuanzong",
    risk: "Low to moderate",
    confidence: "High for city planning and cosmopolitan trade; mixed for market micro-scenes.",
    languages: ["Middle Chinese", "Sogdian among some merchants", "Sanskrit in Buddhist contexts"],
    currency: "Copper cash, bolts of cloth, credit relationships",
    route: ["West Market", "Ward gates", "Buddhist monastery", "Administrative avenues"],
    eventClock: ["Markets operate under timed gates", "Foreign merchants gather in regulated spaces", "Court culture is near its high point"],
    people: ["Sogdian trader", "Monastery translator", "Market inspector"],
    objects: ["Copper cash string", "Perfume resin", "Buddhist manuscript fragment"],
    socialRules: ["Curfews and ward gates matter", "Officials control market order", "Foreignness can be useful and watched"],
    knownFacts: ["Chang'an was the Tang capital", "The West Market hosted long-distance trade", "Ward systems structured urban life"],
    reconstructions: ["Market characters are composites", "Specific prices vary by evidence and period"],
    speculative: ["Exact merchant dialogue", "Precise sensory mix at a given stall"],
    actions: ["Bargain for resin", "Visit a translation hall", "Trace a trade route on the map"],
    sensory: "Horse sweat, incense, lacquer, copper cash, and languages braided through a regulated market.",
    exposureRisk: "Missing the curfew or ignoring official rank can quickly become dangerous.",
  },
  {
    id: "london-1666",
    label: "London, 1666",
    place: "London",
    date: "2 September 1666",
    arrival: "Pudding Lane as fire begins to spread",
    context: "Restoration London faces plague memory, dense timber housing, and a fire that will reshape the city.",
    season: "Dry late summer",
    jurisdiction: "Kingdom of England under Charles II",
    risk: "Very high",
    confidence: "High for the Great Fire timeline; mixed for exact street-level encounters.",
    languages: ["Early Modern English"],
    currency: "Pounds, shillings, pence",
    route: ["Pudding Lane", "London Bridge approaches", "St Paul's area", "River stairs"],
    eventClock: ["Fire spreads with wind and dense buildings", "Householders try to save goods", "Authorities debate demolition"],
    people: ["Baker's neighbor", "River boatman", "Parish watchman"],
    objects: ["Leather fire bucket", "Household ledger", "Bread peel"],
    socialRules: ["Parish ties matter", "Rumor can turn against outsiders", "Property and survival decisions collide"],
    knownFacts: ["The Great Fire began in 1666", "Pudding Lane is associated with the outbreak", "St Paul's Cathedral was destroyed"],
    reconstructions: ["Individual routes through smoke are plausible, not exact", "Ordinary speech is period-informed reconstruction"],
    speculative: ["A named bystander's private thoughts", "Exact timing of every alley evacuation"],
    actions: ["Help carry ledgers", "Find the river stairs", "Ask the watchman what orders exist"],
    sensory: "Hot tar, panicked footsteps, bells, smoke, and the crack of timber in a city built too tightly.",
    exposureRisk: "Standing idle with strange questions during a disaster invites suspicion.",
  },
  {
    id: "fatehpur-sikri-1582",
    label: "Fatehpur Sikri, 1582",
    place: "Fatehpur Sikri",
    date: "1582 CE",
    arrival: "Near Akbar's imperial complex and debate spaces",
    context: "Akbar's Mughal court is experimenting with sovereignty, translation, religion, and imperial administration.",
    season: "Cool season",
    jurisdiction: "Mughal Empire under Akbar",
    risk: "Moderate",
    confidence: "High for court culture and imperial policy; mixed for ordinary court-adjacent life.",
    languages: ["Persian", "Hindavi", "Arabic and Sanskrit in scholarly contexts"],
    currency: "Rupee, dam, gifts, patronage obligations",
    route: ["Diwan-i-Khas precinct", "Imperial workshops", "Market outside the complex", "Scholarly gathering"],
    eventClock: ["Translation projects carry prestige", "Religious debate is politically charged", "Court access depends on patronage"],
    people: ["Court translator", "Workshop painter", "Rajput retainer"],
    objects: ["Illustrated manuscript folio", "Copper dam", "Perfumed petition paper"],
    socialRules: ["Rank controls speech", "Gifts and introductions matter", "Religious language needs care"],
    knownFacts: ["Akbar ruled the Mughal Empire in this period", "Fatehpur Sikri was an imperial center", "Court translation and debate were significant"],
    reconstructions: ["Workshop routines are plausible reconstructions", "Unnamed court figures are composites"],
    speculative: ["Exact conversations inside elite spaces", "Private motives behind every policy"],
    actions: ["Meet a translator", "Inspect a manuscript folio", "Ask how patronage works"],
    sensory: "Red sandstone heat, ink, perfumed paper, controlled silence, and many languages orbiting power.",
    exposureRisk: "Treating religion as private opinion rather than public order would sound strange and possibly dangerous.",
  },
  {
    id: "paris-1789",
    label: "Paris, July 1789",
    place: "Paris",
    date: "13 July 1789",
    arrival: "Faubourg Saint-Antoine on the eve of the Bastille",
    context: "Food prices, rumors, royal politics, and armed crowds are pushing Paris toward a decisive rupture.",
    season: "Summer",
    jurisdiction: "Kingdom of France in revolutionary crisis",
    risk: "High",
    confidence: "High for the political moment; mixed for crowd-level motivations.",
    languages: ["French"],
    currency: "Livres, sous, bread prices as daily pressure",
    route: ["Faubourg Saint-Antoine", "Palais-Royal", "Les Invalides", "Bastille approaches"],
    eventClock: ["Rumors about royal troops spread", "Crowds search for arms", "Bread and legitimacy dominate talk"],
    people: ["Journeyman printer", "Market woman", "National Guard volunteer"],
    objects: ["Pamphlet", "Bread token", "Pike head"],
    socialRules: ["Political language can mobilize or endanger", "Crowds test loyalty fast", "Bread is politics"],
    knownFacts: ["The Bastille fell on 14 July 1789", "Paris was politically volatile", "Pamphlets shaped public opinion"],
    reconstructions: ["Individual crowd interactions are plausible composites", "Exact street conversations are inferred"],
    speculative: ["Specific intent of unnamed participants", "Whether one encounter changes a crowd's direction"],
    actions: ["Read the pamphlet aloud", "Ask about bread prices", "Follow the arms rumor"],
    sensory: "Printer's ink, sweat, bread queues, ironwork, and a city discovering its own force.",
    exposureRisk: "Overconfident modern slogans can be misread; local grievances and fear carry the moment.",
  },
  {
    id: "ostia-117",
    label: "Ostia, 117 CE",
    place: "Ostia",
    date: "117 CE",
    arrival: "Harbor warehouses near Rome's grain supply",
    context: "The Roman Empire under Trajan's final year depends on ports, credit, labor, and imperial logistics.",
    season: "Late summer",
    jurisdiction: "Roman Empire",
    risk: "Moderate",
    confidence: "High for port infrastructure and trade systems; mixed for individual merchant routines.",
    languages: ["Latin", "Greek among traders"],
    currency: "Denarii, sestertii, credit and contracts",
    route: ["Warehouses", "Harbor basin", "Guild office", "Tavern near the docks"],
    eventClock: ["Ships unload grain and oil", "Guilds coordinate labor", "News from the imperial frontier travels slowly"],
    people: ["Freedman accountant", "Dock laborer", "Greek shipmaster"],
    objects: ["Amphora stamp", "Wax contract tablet", "Denarius"],
    socialRules: ["Status follows legal category", "Patrons protect access", "Contracts matter more than charm"],
    knownFacts: ["Ostia served Rome's supply system", "Roman trade used amphorae and contracts", "Legal status shaped daily life"],
    reconstructions: ["Specific price comparisons vary", "Ordinary characters are evidence-aware composites"],
    speculative: ["Exact tavern conversations", "A single merchant's private plan"],
    actions: ["Inspect the amphora stamp", "Negotiate a delivery", "Ask how freed status works"],
    sensory: "Salt air, olive oil, rope fiber, shouted accounts, and the heavy logistics behind imperial abundance.",
    exposureRisk: "Ignoring slavery, freed status, and patronage would make your assumptions visibly modern.",
  },
];

const timeTravelerIdentities: TimeTravelerIdentity[] = [
  {
    id: "guided-self",
    label: "Yourself with a guide",
    role: "Out-of-time observer with a discreet field guide",
    description: "Safer, more explanatory, and allowed to ask modern comparisons.",
    languages: "Guide translates, but locals notice hesitation.",
    status: "Protected outsider",
    clothing: "Conservative local outer layers chosen by the guide",
    money: "Small supervised purse",
    clearance: "Educational clearance",
  },
  {
    id: "plausible-local",
    label: "Plausible local",
    role: "Historically plausible resident attached to ordinary networks",
    description: "More immersive, with tighter limits on what you can know and say.",
    languages: "Local working language with class-appropriate fluency",
    status: "Non-elite but socially legible",
    clothing: "Period-appropriate clothing matched to status",
    money: "Small reserve in local coin or credit",
    clearance: "Immersion clearance",
  },
  {
    id: "trade-assistant",
    label: "Merchant assistant",
    role: "Assistant to a trading household or workshop",
    description: "Best for money, logistics, food, routes, and social exchange.",
    languages: "Trade phrases plus household vocabulary",
    status: "Useful but supervised",
    clothing: "Workable travel clothing",
    money: "Account tokens and a modest coin pouch",
    clearance: "Commercial clearance",
  },
  {
    id: "scribe-translator",
    label: "Scribe or translator",
    role: "Literate helper near records, letters, or multilingual exchange",
    description: "Best for politics, institutions, evidence, and elite-adjacent spaces.",
    languages: "Reading knowledge plus formal speech routines",
    status: "Literate non-elite",
    clothing: "Plain respectable dress with writing tools",
    money: "Small silver or copper reserve",
    clearance: "Document clearance",
  },
];

const timeTravelPurposes: TimeTravelChoice[] = [
  { id: "observe", label: "Observe", description: "Move carefully and notice ordinary life before judging." },
  { id: "investigate", label: "Investigate", description: "Follow a historical question through people, objects, and power." },
  { id: "survive", label: "Survive", description: "Food, shelter, suspicion, money, and risk matter from the first step." },
  { id: "meet-moment", label: "Meet the moment", description: "Arrive near a turning point and track what people know then." },
  { id: "compare", label: "Compare to today", description: "Keep governance, money, labor, technology, and culture in view." },
];

const timeTravelRealism: TimeTravelChoice[] = [
  { id: "guided", label: "Guided", description: "Safe, explanatory, and easier to pause for context." },
  { id: "strict", label: "Strict", description: "No modern hindsight in-world; status, danger, and access are enforced." },
  { id: "source-heavy", label: "Source-heavy", description: "Frequent evidence notes and uncertainty labels." },
];

const timeTravelDepth: TimeTravelChoice[] = [
  { id: "short", label: "10-minute visit", description: "One tight arrival, three discoveries, and a debrief stamp." },
  { id: "guided-expedition", label: "Guided expedition", description: "Several locations, figures, artifacts, and field notes." },
  { id: "open-simulation", label: "Open simulation", description: "Stateful exploration with consequences and evolving risk." },
];

const fallbackTimeTravelJourney: TimeTravelJourney = {
  ...timeTravelJourneyTemplates[0],
  id: "saved-expedition",
  label: "Saved expedition",
  place: "Active destination",
  date: "Saved arrival point",
  arrival: "Current scene",
  context: "Continue the existing historical expedition from the conversation.",
  risk: "Unknown",
  confidence: "Read from the current evidence notes.",
};

function resolveJourneyOptions(intent: string) {
  const query = intent.toLowerCase();
  if (!query.trim()) return timeTravelJourneyTemplates.slice(0, 5);
  if (/mughal|akbar|shah jahan|fatehpur|court/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "fatehpur-sikri-1582")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "delhi-1857")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "ostia-117")!,
    ];
  }
  if (/french|revolution|bastille|paris/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "paris-1789")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "london-1666")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "athens-399-bce")!,
    ];
  }
  if (/roman|rome|trader|trade|merchant/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "ostia-117")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "changan-742")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "fatehpur-sikri-1582")!,
    ];
  }
  if (/battle|war|siege|rebellion|revolt/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "delhi-1857")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "paris-1789")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "london-1666")!,
    ];
  }
  if (/athens|socrates|greek|democracy/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "athens-399-bce")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "florence-1504")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "paris-1789")!,
    ];
  }
  if (/china|tang|silk|chang/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "changan-742")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "fatehpur-sikri-1582")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "ostia-117")!,
    ];
  }

  return [
    buildCustomJourney(intent, "Center of power", "court, assembly, palace, command tent, or administrative center"),
    buildCustomJourney(intent, "Street-level life", "market, household, workshop, port, school, or neighborhood"),
    buildCustomJourney(intent, "Edge of the system", "frontier, trade route, borderland, ship, monastery, or garrison"),
  ];
}

function buildCustomJourney(intent: string, label: string, arrival: string): TimeTravelJourney {
  const cleanIntent = intent.trim() || "A historical turning point";
  return {
    id: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${cleanIntent.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 28)}`,
    label,
    place: cleanIntent,
    date: "AI-resolved date range",
    arrival,
    context: "The Travel Designer should resolve this intent into a specific historical place, date, and political moment before arrival.",
    season: "To be resolved",
    jurisdiction: "To be resolved",
    risk: "Pending",
    confidence: "Pending evidence check",
    languages: ["To be resolved"],
    currency: "To be resolved",
    route: ["Arrival point", "Ordinary-life node", "Power node", "Exit route"],
    eventClock: ["Resolve the event clock before opening the world", "Separate in-world knowledge from historian knowledge"],
    people: ["Local guide", "Ordinary worker", "Gatekeeper to power"],
    objects: ["Local coin or token", "Document or sign", "Food or tool"],
    socialRules: ["Resolve status rules", "Resolve language risk", "Resolve access limits"],
    knownFacts: ["The assistant must identify known facts before simulating"],
    reconstructions: ["Plausible ordinary life should be labelled as reconstruction"],
    speculative: ["Unverified details must stay visibly uncertain"],
    actions: ["Choose exact entry point", "Build passport", "Request source confidence"],
    sensory: "The first scene should become concrete only after the destination is resolved.",
    exposureRisk: "Unresolved until the historical setting is specified.",
  };
}

function buildTimeTravelPrompt({
  journey,
  identity,
  purpose,
  realism,
  depth,
}: {
  journey: TimeTravelJourney;
  identity: TimeTravelerIdentity;
  purpose: TimeTravelChoice;
  realism: TimeTravelChoice;
  depth: TimeTravelChoice;
}) {
  const state = {
    destination: {
      place: journey.place,
      date_range: journey.date,
      specific_arrival: journey.arrival,
      political_context: journey.context,
      season: journey.season,
      jurisdiction: journey.jurisdiction,
    },
    traveler: {
      identity_mode: identity.id,
      role: identity.role,
      languages: identity.languages,
      status: identity.status,
      clothing: identity.clothing,
      money: identity.money,
    },
    simulation: {
      realism_level: realism.label,
      risk_level: journey.risk,
      current_location: journey.arrival,
      mode: purpose.label,
      depth: depth.label,
      event_clock: journey.eventClock,
    },
    evidence: {
      confidence: journey.confidence,
      known_facts: journey.knownFacts,
      plausible_reconstructions: journey.reconstructions,
      speculative_elements: journey.speculative,
    },
  };

  return buildMiniAppInstruction({
    visible: `Time travel: ${journey.label} as ${identity.label}. Mission: ${purpose.label}.`,
    instructions: [
      "Start a Time Travel expedition. Do not open a generic chat and do not write a broad period summary.",
      "Treat this as a stateful, evidence-aware historical simulation with a passport, travel advisory, world view, and choices.",
      "Simulation state:",
      JSON.stringify(state, null, 2),
      "First response rules:",
      "- If any destination field is AI-resolved or vague, first offer three concrete historically meaningful arrival options and wait for the learner to choose.",
      "- Otherwise, greet the traveler, summarize the passport in one compact paragraph, then ask the first meaningful action question.",
      "- Keep in-world knowledge separate from historian knowledge.",
      "- Mark known facts, plausible reconstruction, and speculation clearly.",
      "- Do not fabricate direct quotes, citations, or private thoughts.",
      "- Do not romanticize violence, empire, slavery, caste, disease, or oppression.",
      "- Apply constraints around language, rank, gender, class, law, religion, money, sanitation, and access.",
      "- End with three meaningful actions plus one option to pause for historian context.",
      "Debrief rule: when the learner asks to end or debrief, summarize discoveries, evidence confidence, remaining uncertainties, and award a passport stamp.",
    ].join("\n"),
  });
}

type MiniAppConfig = {
  icon: MiniAppIcon;
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

function TimeTravelWorkspace({
  topic,
  userName,
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
  language: string;
  userName: string;
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
  const visibleMessages = displayMessages(messages);
  const hasSession = messages.some((message) => message.role !== "system") || sending || awaitingResponse;
  const [
    { intent, step, journeyOptions, selectedJourney, identityId, purposeId, realismId, depthId },
    updateTimeTravel,
  ] = useReducer(mergeStateReducer<{
    intent: string;
    step: TimeTravelStep;
    journeyOptions: TimeTravelJourney[];
    selectedJourney: TimeTravelJourney | null;
    identityId: string;
    purposeId: string;
    realismId: string;
    depthId: string;
  }>, {
    intent: "",
    step: "departure",
    journeyOptions: timeTravelJourneyTemplates.slice(0, 5),
    selectedJourney: null,
    identityId: "",
    purposeId: "",
    realismId: "",
    depthId: "",
  });

  const identity = timeTravelerIdentities.find((option) => option.id === identityId);
  const purpose = timeTravelPurposes.find((option) => option.id === purposeId);
  const realism = timeTravelRealism.find((option) => option.id === realismId);
  const depth = timeTravelDepth.find((option) => option.id === depthId);

  function resolveIntent(event?: FormEvent) {
    event?.preventDefault();
    updateTimeTravel({
      journeyOptions: resolveJourneyOptions(intent),
      selectedJourney: null,
      step: "destination",
    });
  }

  function selectJourney(journey: TimeTravelJourney) {
    updateTimeTravel({ selectedJourney: journey, step: "identity" });
  }

  function sendRandomJourney() {
    const journey =
      timeTravelJourneyTemplates[Math.floor(Math.random() * timeTravelJourneyTemplates.length)] ??
      timeTravelJourneyTemplates[0];
    updateTimeTravel({
      intent: journey.label,
      journeyOptions: resolveJourneyOptions(journey.label),
      selectedJourney: journey,
      step: "identity",
    });
  }

  function beginJourney() {
    if (!selectedJourney || !identity || !purpose || !realism || !depth || sending) return;
    void onSend(buildTimeTravelPrompt({ journey: selectedJourney, identity, purpose, realism, depth }));
  }

  if (hasSession) {
    return (
      <TimeTravelSession
        topic={topic}
        userName={userName}
        journey={selectedJourney ?? fallbackTimeTravelJourney}
        identity={identity ?? timeTravelerIdentities[0]}
        purpose={purpose}
        realism={realism}
        depth={depth}
        messages={visibleMessages}
        input={input}
        sending={sending}
        awaitingResponse={awaitingResponse}
        inputRef={inputRef}
        listRef={listRef}
        onInput={onInput}
        onSend={onSend}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onStop={onStop}
        onReset={onReset}
      />
    );
  }

  return (
    <main className="inspir-workspace inspir-time-workspace">
      <div className="inspir-time-scroll app-scrollbar">
        <section className="inspir-time-onboarding">
          <div className="inspir-time-stage">
            {step === "departure" ? (
              <TimeTravelDepartureBoard
                intent={intent}
                topic={topic}
                onIntent={(nextIntent) => updateTimeTravel({ intent: nextIntent })}
                onResolve={resolveIntent}
                onRandom={sendRandomJourney}
                onSelect={selectJourney}
              />
            ) : step === "destination" ? (
              <TimeTravelDestinationStep
                intent={intent}
                options={journeyOptions}
                onBack={() => updateTimeTravel({ step: "departure" })}
                onSelect={selectJourney}
              />
            ) : step === "identity" ? (
              <TimeTravelChoiceStep
                kicker="Traveler identity"
                title="How do you want to be seen when you arrive?"
                body="Your status controls language, money, access, danger, and what questions sound natural."
                choices={timeTravelerIdentities}
                selectedId={identityId}
                onSelect={(id) => {
                  updateTimeTravel({ identityId: id, step: "purpose" });
                }}
                onBack={() => updateTimeTravel({ step: "destination" })}
              />
            ) : step === "purpose" ? (
              <TimeTravelChoiceStep
                kicker="Mission"
                title="What kind of journey is this?"
                body="The simulation will prioritize different people, risks, objects, and explanations."
                choices={timeTravelPurposes}
                selectedId={purposeId}
                onSelect={(id) => {
                  updateTimeTravel({ purposeId: id, step: "realism" });
                }}
                onBack={() => updateTimeTravel({ step: "identity" })}
              />
            ) : step === "realism" ? (
              <TimeTravelChoiceStep
                kicker="Realism"
                title="How strict should the crossing be?"
                body="Strict mode keeps modern knowledge out of the world and applies social consequences sooner."
                choices={timeTravelRealism}
                selectedId={realismId}
                onSelect={(id) => {
                  updateTimeTravel({ realismId: id, step: "depth" });
                }}
                onBack={() => updateTimeTravel({ step: "purpose" })}
              />
            ) : step === "depth" ? (
              <TimeTravelChoiceStep
                kicker="Duration"
                title="How deep should the expedition go?"
                body="Short visits end with a fast debrief; open simulations keep state and consequences active."
                choices={timeTravelDepth}
                selectedId={depthId}
                onSelect={(id) => {
                  updateTimeTravel({ depthId: id, step: "clearance" });
                }}
                onBack={() => updateTimeTravel({ step: "realism" })}
              />
            ) : (
              <TimeTravelClearance
                journey={selectedJourney ?? fallbackTimeTravelJourney}
                identity={identity}
                purpose={purpose}
                realism={realism}
                depth={depth}
                sending={sending}
                onBack={() => updateTimeTravel({ step: "depth" })}
                onBegin={beginJourney}
              />
            )}
          </div>
          <TimeTravelPassport
            journey={selectedJourney}
            identity={identity}
            purpose={purpose}
            realism={realism}
            depth={depth}
          />
        </section>
      </div>
    </main>
  );
}

function TimeTravelDepartureBoard({
  intent,
  topic,
  onIntent,
  onResolve,
  onRandom,
  onSelect,
}: {
  intent: string;
  topic: Topic;
  onIntent: (value: string) => void;
  onResolve: (event?: FormEvent) => void;
  onRandom: () => void;
  onSelect: (journey: TimeTravelJourney) => void;
}) {
  const featured = timeTravelJourneyTemplates.slice(0, 5);

  return (
    <div className="inspir-time-departure">
      <header className="inspir-time-hero">
        <div>
          <span>{topic.name}</span>
          <h2>Departures beyond the present</h2>
        </div>
        <button type="button" onClick={onRandom} className="inspir-time-icon-button">
          <Waypoints size={18} />
          <span>Send me somewhere consequential</span>
        </button>
      </header>

      <form className="inspir-time-search-board" onSubmit={onResolve}>
        <Search size={20} />
        <input
          aria-label="Time travel destination"
          value={intent}
          onChange={(event) => onIntent(event.target.value)}
          placeholder="Where and when do you want to go?"
        />
        <button type="submit">
          <Compass size={18} />
          <span>Resolve</span>
        </button>
      </form>

      <div className="inspir-time-map-board" aria-label="Historical hotspots">
        {featured.map((journey) => (
          <button key={journey.id} type="button" onClick={() => onSelect(journey)} className="inspir-time-hotspot">
            <MapPin size={16} />
            <span>{journey.label}</span>
          </button>
        ))}
      </div>

      <ol className="inspir-time-timeline-stops">
        {featured.map((journey) => (
          <li key={journey.id}>
            <button type="button" onClick={() => onSelect(journey)}>
              <span>{journey.date}</span>
              <strong>{journey.place}</strong>
            </button>
          </li>
        ))}
      </ol>

      <div className="inspir-time-journey-grid">
        {timeTravelJourneyTemplates.slice(0, 6).map((journey) => (
          <button key={journey.id} type="button" onClick={() => onSelect(journey)} className="inspir-time-journey-card">
            <span>{journey.label}</span>
            <strong>{journey.arrival}</strong>
            <small>{journey.context}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeTravelDestinationStep({
  intent,
  options,
  onBack,
  onSelect,
}: {
  intent: string;
  options: TimeTravelJourney[];
  onBack: () => void;
  onSelect: (journey: TimeTravelJourney) => void;
}) {
  return (
    <div className="inspir-time-question">
      <button type="button" onClick={onBack} className="inspir-time-back">
        <ArrowLeft size={17} />
        <span>Departure board</span>
      </button>
      <span>Arrival point</span>
      <h2>{intent.trim() ? "Choose the strongest entry point." : "Choose your arrival point."}</h2>
      <p>Center of power, street-level life, and the edge of the system reveal different histories.</p>
      <div className="inspir-time-option-grid">
        {options.map((journey) => (
          <button key={journey.id} type="button" onClick={() => onSelect(journey)} className="inspir-time-option-card">
            <strong>{journey.label}</strong>
            <span>{journey.arrival}</span>
            <small>{journey.context}</small>
            <em>{journey.confidence}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeTravelChoiceStep({
  kicker,
  title,
  body,
  choices,
  selectedId,
  onSelect,
  onBack,
}: {
  kicker: string;
  title: string;
  body: string;
  choices: Array<TimeTravelChoice | TimeTravelerIdentity>;
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="inspir-time-question">
      <button type="button" onClick={onBack} className="inspir-time-back">
        <ArrowLeft size={17} />
        <span>Back</span>
      </button>
      <span>{kicker}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="inspir-time-option-grid">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => onSelect(choice.id)}
            className={`inspir-time-option-card ${choice.id === selectedId ? "is-selected" : ""}`}
          >
            <strong>{choice.label}</strong>
            <span>{"role" in choice ? choice.role : choice.description}</span>
            <small>{"status" in choice ? `${choice.status} - ${choice.languages}` : choice.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeTravelClearance({
  journey,
  identity,
  purpose,
  realism,
  depth,
  sending,
  onBack,
  onBegin,
}: {
  journey: TimeTravelJourney;
  identity?: TimeTravelerIdentity;
  purpose?: TimeTravelChoice;
  realism?: TimeTravelChoice;
  depth?: TimeTravelChoice;
  sending: boolean;
  onBack: () => void;
  onBegin: () => void;
}) {
  const ready = Boolean(identity && purpose && realism && depth);
  return (
    <div className="inspir-time-clearance">
      <button type="button" onClick={onBack} className="inspir-time-back">
        <ArrowLeft size={17} />
        <span>Back</span>
      </button>
      <div className="inspir-time-clearance-head">
        <ShieldCheck size={28} />
        <div>
          <span>Travel advisory</span>
          <h2>{journey.arrival}</h2>
        </div>
      </div>
      <div className="inspir-time-advisory-grid">
        <TimeTravelAdvisoryItem icon="language" label="Languages" value={journey.languages.join(", ")} />
        <TimeTravelAdvisoryItem icon="risk" label="Risk" value={`${journey.risk} - ${journey.exposureRisk}`} />
        <TimeTravelAdvisoryItem icon="money" label="Money" value={identity?.money ?? journey.currency} />
        <TimeTravelAdvisoryItem icon="status" label="Status" value={identity?.status ?? "Pending identity clearance"} />
        <TimeTravelAdvisoryItem icon="rules" label="Do not forget" value={journey.socialRules[0] ?? "Local rules apply"} />
        <TimeTravelAdvisoryItem icon="evidence" label="Evidence" value={journey.confidence} />
      </div>
      <div className="inspir-time-warning">
        <AlertTriangle size={20} />
        <span>{journey.exposureRisk}</span>
      </div>
      <button type="button" disabled={!ready || sending} onClick={onBegin} className="inspir-time-enter-button">
        <Compass size={19} />
        <span>{journey.risk === "Very high" ? "Enter carefully" : "Enter the city"}</span>
      </button>
    </div>
  );
}

const timeTravelAdvisoryIcons = {
  language: Languages,
  risk: Thermometer,
  money: Coins,
  status: UserRound,
  rules: Gavel,
  evidence: FileText,
};

type TimeTravelAdvisoryIcon = keyof typeof timeTravelAdvisoryIcons;

function TimeTravelAdvisoryItem({
  icon,
  label,
  value,
}: {
  icon: TimeTravelAdvisoryIcon;
  label: string;
  value: string;
}) {
  const Icon = timeTravelAdvisoryIcons[icon];
  return (
    <article className="inspir-time-advisory-item">
      <Icon size={19} />
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
    </article>
  );
}

function TimeTravelPassport({
  journey,
  identity,
  purpose,
  realism,
  depth,
  compact = false,
}: {
  journey: TimeTravelJourney | null;
  identity?: TimeTravelerIdentity;
  purpose?: TimeTravelChoice;
  realism?: TimeTravelChoice;
  depth?: TimeTravelChoice;
  compact?: boolean;
}) {
  const stamps = [
    journey ? "Destination" : undefined,
    identity ? "Identity" : undefined,
    purpose ? "Mission" : undefined,
    realism ? "Realism" : undefined,
    depth ? "Depth" : undefined,
  ].filter(Boolean);

  return (
    <aside className={`inspir-time-passport ${compact ? "is-compact" : ""}`}>
      <div className="inspir-time-passport-cover">
        <div>
          <span>Temporal passport</span>
          <h3>{journey?.label ?? "Clearance pending"}</h3>
        </div>
        <Stamp size={28} />
      </div>
      <dl className="inspir-time-passport-fields">
        <div>
          <dt>Destination</dt>
          <dd>{journey?.arrival ?? "Choose an arrival point"}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{journey?.date ?? "Unstamped"}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{identity?.role ?? "Identity pending"}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{identity?.languages ?? journey?.languages.join(", ") ?? "Pending"}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{journey?.risk ?? "Pending"}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{purpose?.label ?? "Mission pending"}</dd>
        </div>
      </dl>
      <div className="inspir-time-stamps">
        {stamps.length ? (
          stamps.map((stamp) => <span key={stamp}>{stamp}</span>)
        ) : (
          <span>Awaiting first stamp</span>
        )}
      </div>
    </aside>
  );
}

function TimeTravelSession({
  topic,
  userName,
  journey,
  identity,
  purpose,
  realism,
  depth,
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
  userName: string;
  journey: TimeTravelJourney;
  identity: TimeTravelerIdentity;
  purpose?: TimeTravelChoice;
  realism?: TimeTravelChoice;
  depth?: TimeTravelChoice;
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
  const actions = [
    ...journey.actions,
    "Ask the guide to explain the power structure",
    "Compare this with today",
    "Request debrief and passport stamp",
  ];

  function sendAction(action: string) {
    void onSend(
      buildMiniAppInstruction({
        visible: action,
        instructions: `Action from inside the ${journey.label} expedition: ${action}. Keep the simulation state, constraints, and evidence labels visible.`,
      }),
    );
  }

  const details: CoachChatDetail[] = [
    { title: "Arrival", body: `${journey.arrival} - ${journey.date}`, icon: MapPin },
    { title: "Identity", body: `${identity.role}. ${identity.status}.`, icon: UserRound },
    { title: "Mission", body: `${purpose?.label ?? "Guided"} - ${depth?.label ?? "Open visit"}`, icon: Compass },
    { title: "Realism", body: `${realism?.label ?? "Guided"} realism. ${journey.risk} risk.`, icon: ShieldCheck },
    { title: "Evidence", body: journey.confidence, icon: FileText },
    { title: "Boundary", body: journey.exposureRisk, icon: AlertTriangle },
  ];

  return (
    <CoachChatSession
      eyebrow={topic.name}
      title={journey.place}
      subtitle={`${journey.arrival} - ${identity.role}`}
      userName={userName}
      coachName="Guide"
      placeholder="Ask, act, pause for context, or request a debrief..."
      messages={messages}
      input={input}
      sending={sending}
      awaitingResponse={awaitingResponse}
      inputRef={inputRef}
      listRef={listRef}
      actions={actions.slice(0, 6).map((action) => ({
        label: action,
        icon: Compass,
        disabled: sending,
        onClick: () => sendAction(action),
      }))}
      details={details}
      resetLabel="Change passport"
      onInput={onInput}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      onStop={onStop}
      onReset={onReset}
    />
  );
}

const historicalEngagementModes = [
  {
    id: "interview",
    label: "Interview",
    body: "Ask direct questions and let the historian clarify evidence when needed.",
    role: "historical interviewer",
  },
  {
    id: "debate",
    label: "Debate",
    body: "Challenge ideas while the person defends the worldview of their moment.",
    role: "respectful but challenging interlocutor",
  },
  {
    id: "apprenticeship",
    label: "Apprenticeship",
    body: "Learn how they thought, worked, planned, wrote, governed, or experimented.",
    role: "apprentice studying their method",
  },
  {
    id: "council-room",
    label: "Council room",
    body: "Ask for advice through their period worldview and constraints.",
    role: "advisor seeking counsel",
  },
  {
    id: "cross-examination",
    label: "Cross-examination",
    body: "Confront contradictions, evasions, and consequences with evidence support.",
    role: "prosecutor testing claims",
  },
  {
    id: "day-in-the-life",
    label: "Day-in-the-life",
    body: "Follow an ordinary or decisive day with setting, pressure, and choices.",
    role: "observer inside the scene",
  },
  {
    id: "moral-tribunal",
    label: "Moral tribunal",
    body: "Evaluate legacy without flattening context into excuse or condemnation.",
    role: "tribunal questioner",
  },
  {
    id: "strategy-room",
    label: "Strategy room",
    body: "Reconstruct a decision, alternatives, constraints, and outcomes.",
    role: "strategy analyst",
  },
] as const;

type HistoricalEngagementModeId = (typeof historicalEngagementModes)[number]["id"];

const historicalTimeSliceOptions = [
  "Ask the historian to propose time slices",
  "Formative years before public power",
  "At the decisive turning point",
  "At peak influence or authority",
  "During crisis, exile, trial, or imprisonment",
  "Late-life retrospective before death",
];

const historianVisibilityOptions = [
  {
    value: "medium",
    label: "Balanced",
    body: "Flag important context without crowding every reply.",
  },
  {
    value: "high",
    label: "Evidence-heavy",
    body: "Show more uncertainty, anachronism, and source-boundary notes.",
  },
  {
    value: "low",
    label: "Immersive",
    body: "Keep the sidecar quieter unless something needs correction.",
  },
];

const historicalQuickStarts = [
  {
    label: "Challenge Churchill on empire",
    startType: "direct",
    person: "Winston Churchill",
    timeSlice: "Wartime prime minister in 1940",
    mode: "cross-examination" as HistoricalEngagementModeId,
    setting: "Cabinet room during wartime Britain",
    userRole: "citizen-prosecutor testing imperial assumptions",
    goal: "Challenge the tension between fighting tyranny in Europe and defending empire.",
  },
  {
    label: "Meet Ambedkar in committee",
    startType: "direct",
    person: "B. R. Ambedkar",
    timeSlice: "1946-1949 constitution-making period",
    mode: "debate" as HistoricalEngagementModeId,
    setting: "committee room in Delhi",
    userRole: "MBA student studying institutional design",
    goal: "Debate safeguards, social democracy, and the cost of constitutional compromise.",
  },
  {
    label: "Find an education changer",
    startType: "discover",
    person: "someone who changed education and faced serious opposition",
    timeSlice: "Ask the historian to propose time slices",
    mode: "interview" as HistoricalEngagementModeId,
    setting: "",
    userRole: "curious learner",
    goal: "Suggest candidates with strong evidence and vivid settings.",
  },
];

const historicalDossierActions = [
  {
    title: "Timeline so far",
    body: "Events the person has already lived through.",
    prompt: "Open the timeline so far for this exact time slice. Separate documented events from contested interpretation.",
  },
  {
    title: "Beliefs and blind spots",
    body: "What they value, defend, miss, or refuse.",
    prompt: "Show the person's major beliefs at this time, their blind spots, and what they would likely resist understanding.",
  },
  {
    title: "Allies and enemies",
    body: "Who pressures them, supports them, or threatens them.",
    prompt: "Map allies, enemies, critics, patrons, and pressure groups around this person at this moment.",
  },
  {
    title: "Evidence drawer",
    body: "Sources, confidence, uncertainty, and forbidden quotes.",
    prompt: "Open the evidence drawer. Label high-confidence facts, plausible reconstructions, contested claims, and things you must not fabricate.",
  },
  {
    title: "Questions to ask",
    body: "Openings that produce a better encounter.",
    prompt: "Recommend opening questions for this encounter, grouped by interview, debate, contradiction, and legacy.",
  },
];

const historicalModeSwitches = [
  {
    label: "Historian explains",
    prompt: "Step out of character briefly. Explain the historical context, evidence quality, and uncertainties behind the last exchange.",
  },
  {
    label: "Debate harder",
    prompt: "Increase the challenge. Have the historical person defend their worldview more forcefully while the historian tracks weak claims.",
  },
  {
    label: "Ask as student",
    prompt: "Reframe my next question as a student trying to understand the mental model, not just the biography.",
  },
  {
    label: "Compare legacy",
    prompt: "Compare intentions, contemporary criticism, later consequences, and modern judgement without reducing the person to hero or villain.",
  },
];

function historicalModeIcon(mode: HistoricalEngagementModeId) {
  switch (mode) {
    case "interview":
      return MessageCircle;
    case "debate":
      return Scale;
    case "apprenticeship":
      return BookOpenCheck;
    case "council-room":
      return Users;
    case "cross-examination":
      return Gavel;
    case "day-in-the-life":
      return History;
    case "moral-tribunal":
      return AlertTriangle;
    case "strategy-room":
      return Gauge;
    default:
      return Landmark;
  }
}

function buildHistoricalEncounterPrompt({
  startType,
  personOrTheme,
  timeSlice,
  setting,
  mode,
  userRole,
  openingGoal,
  historianVisibility,
}: {
  startType: "direct" | "discover";
  personOrTheme: string;
  timeSlice: string;
  setting: string;
  mode: HistoricalEngagementModeId;
  userRole: string;
  openingGoal: string;
  historianVisibility: string;
}) {
  const engagement = historicalEngagementModes.find((candidate) => candidate.id === mode) ?? historicalEngagementModes[1];
  const needsTimeSlice = timeSlice === historicalTimeSliceOptions[0];

  return buildMiniAppInstruction({
    visible:
      startType === "discover"
        ? `Find a historical person: ${personOrTheme}`
        : `Historical audience: ${personOrTheme} (${needsTimeSlice ? "choose time slice" : timeSlice})`,
    instructions: [
      "Open the Historical Person mini app as a staged historical audience with a living dossier.",
      "Do not run this as a generic chatbot or a famous-person costume.",
      `Start type: ${startType === "discover" ? "vague discovery request" : "direct person request"}.`,
      startType === "discover"
        ? `Discovery request: ${personOrTheme}. Suggest 3 to 5 historical people first. Each card must include name, era, why they matter, best conversation modes, controversy level, evidence quality, and a fitting setting. Ask me to choose before building a persona.`
        : `Requested person or encounter: ${personOrTheme}.`,
      needsTimeSlice
        ? "Time slice: not chosen yet. If a specific person is named, offer 4 to 5 historically meaningful versions of this person before any in-character dialogue. Explain how each version changes the worldview, stakes, and setting."
        : `Selected time slice: ${timeSlice}. If this slice is too broad, narrow it once with 2 or 3 historically meaningful options before the encounter begins.`,
      setting ? `Preferred setting: ${setting}.` : "Preferred setting: choose a historically fitting room, court, battlefield tent, study, prison, salon, workshop, public square, or other concrete place.",
      `Engagement mode: ${engagement.label}. The user's relationship to the person is: ${userRole || engagement.role}.`,
      openingGoal ? `User's purpose or opening angle: ${openingGoal}.` : "User's purpose: help them choose sharp opening questions.",
      `Historian sidecar visibility: ${historianVisibility}.`,
      "Required flow:",
      "- Before the person speaks, build the room: where we are, year or date range, what has happened so far, current pressures, beliefs, blind spots, and historian uncertainties.",
      "- Create a dossier wall with: timeline so far, personal stakes, allies and enemies, major beliefs at this time, blind spots, known writings or speeches, current pressure, historical context, evidence quality, and recommended opening questions.",
      "- Maintain two layers after the encounter begins: in-character voice bounded by the time slice, and historian sidecar notes that distinguish documented fact, plausible reconstruction, contested interpretation, modern paraphrase, and fictionalized dialogue.",
      "- The historical person may resist, challenge, evade, ask questions back, reject false premises, or reveal period constraints. They should not be infinitely agreeable.",
      "- Do not fabricate exact quotations. If a direct quotation is not sourced in the conversation, mark generated wording as a modernized paraphrase or reconstructed dialogue.",
      "- Do not sanitize harmful views, and do not glorify oppression, casteism, racism, slavery, misogyny, authoritarianism, or violence. Context is not automatic excuse.",
      "- Do not let the persona give medical, legal, financial, or harmful advice as authoritative guidance.",
      "First response format:",
      "1. If discovery or time-slice choice is needed, show choices and stop.",
      "2. Otherwise show the dossier wall first, then invite me to begin with one of the recommended questions.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

function GuidedMiniAppWorkspace({
  topic,
  mode,
  language,
  userName,
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
  language: string;
  userName: string;
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
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [notes, setNotes] = useState("");
  const visibleMessages = displayMessages(messages);
  const hasSession = messages.some((message) => message.role !== "system") || sending || awaitingResponse;

  if (mode === "collaborative-instruction") {
    return (
      <CollaborativeInstructionWorkspace
        topic={topic}
        language={language}
        userName={userName}
        messages={messages}
        input={input}
        sending={sending}
        awaitingResponse={awaitingResponse}
        inputRef={inputRef}
        listRef={listRef}
        onInput={onInput}
        onSend={onSend}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onStop={onStop}
        onReset={onReset}
      />
    );
  }

  if (mode === "historical-person") {
    return (
      <HistoricalPersonWorkspace
        topic={topic}
        language={language}
        userName={userName}
        messages={messages}
        input={input}
        sending={sending}
        awaitingResponse={awaitingResponse}
        inputRef={inputRef}
        listRef={listRef}
        onInput={onInput}
        onSend={onSend}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onStop={onStop}
        onReset={onReset}
      />
    );
  }

  const config = miniAppConfigs[mode];

  function startMiniApp(event?: FormEvent) {
    event?.preventDefault();
    if (!primary.trim() || sending) return;
    void onSend(
      buildMiniAppInstruction({
        visible: `${topic.name}: ${primary.trim()}`,
        instructions: config.buildPrompt({
          primary: primary.trim(),
          secondary: secondary.trim(),
          notes: notes.trim(),
        }),
      }),
    );
  }

  if (hasSession) {
    return (
      <CoachChatSession
        eyebrow={config.eyebrow}
        title={primary.trim() || topic.name}
        subtitle={config.milestones.join(" -> ")}
        userName={userName}
        coachName="Coach"
        placeholder={topic.inputboxText}
        messages={visibleMessages}
        input={input}
        sending={sending}
        awaitingResponse={awaitingResponse}
        inputRef={inputRef}
        listRef={listRef}
        details={[
          { title: config.primaryLabel, body: primary.trim() || "Set in the opening message", icon: BookOpenCheck },
          { title: config.secondaryLabel, body: secondary.trim() || "Use chat to adjust this", icon: SlidersHorizontal },
          { title: config.notesLabel, body: notes.trim() || "No extra notes", icon: StickyNote },
          ...config.panels.map((panel) => ({ title: panel.title, body: panel.body, icon: FileText })),
        ]}
        resetLabel="Change setup"
        onInput={onInput}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onStop={onStop}
        onReset={onReset}
      />
    );
  }

  return (
    <main className="inspir-workspace inspir-mini-workspace">
      <div ref={listRef} className="inspir-mini-scroll app-scrollbar">
        {!hasSession ? (
          <section className="inspir-mini-start">
            <TopicIntroCard {...topicIntroProps(topic)} />
            <div className="inspir-mini-start-copy">
              <span>{config.eyebrow}</span>
              <h2>{config.setupTitle}</h2>
              <p>{config.setupBody}</p>
            </div>
            <form className="inspir-mini-start-form" onSubmit={startMiniApp}>
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
            <div className="inspir-mini-example-row">
              {config.examples.map((example) => (
                <button key={example} type="button" onClick={() => setPrimary(example)}>
                  <Sparkles size={15} />
                  <span>{example}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="inspir-mini-session">
            <aside className="inspir-mini-side">
              <div className="inspir-mini-side-head">
                <MiniIcon icon={config.icon} />
                <div>
                  <span>{config.eyebrow}</span>
                  <strong>{topic.name}</strong>
                </div>
              </div>
              <div className="inspir-mini-side-grid">
                {config.panels.map((panel) => (
                  <article key={panel.title}>
                    <strong>{panel.title}</strong>
                    <span>{panel.body}</span>
                  </article>
                ))}
              </div>
              <button type="button" onClick={onReset} className="inspir-mini-new-session">
                New session
              </button>
            </aside>
            <div className="inspir-mini-conversation">
              <header className="inspir-mini-stage-header">
                <div>
                  <span>Live Session</span>
                  <strong>{config.milestones.join(" -> ")}</strong>
                </div>
                <div className="inspir-mini-stage-pills">
                  {config.milestones.map((milestone, index) => (
                    <span key={milestone} className={index === 0 ? "is-active" : ""}>
                      {milestone}
                    </span>
                  ))}
                </div>
              </header>
              <div className="inspir-message-stack inspir-mini-message-stack">
                {visibleMessages.map((message) => (
                  <MessageCard key={message.id} message={message} userLabel={userName} />
                ))}
                {awaitingResponse ? (
                  <ThinkingMarker label="Thinking" />
                ) : null}
              </div>
            </div>
          </section>
        )}
      </div>
      {hasSession ? (
        <form onSubmit={onSubmit} className="inspir-composer">
          <div className="inspir-composer-inner">
            <textarea
              aria-label="Debate message"
              ref={inputRef}
              value={input}
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={topic.inputboxText}
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
      ) : null}
    </main>
  );
}

type HistoricalState = {
  startType: "direct" | "discover";
  personOrTheme: string;
  timeSlice: string;
  customTimeSlice: string;
  engagementMode: HistoricalEngagementModeId;
  setting: string;
  userRole: string;
  openingGoal: string;
  historianVisibility: string;
};

type HistoricalPersonWorkspaceProps = {
  topic: Topic;
  language: string;
  userName: string;
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
};

function HistoricalPersonWorkspace(props: HistoricalPersonWorkspaceProps) {
  return useHistoricalPersonWorkspace(props);
}

function useHistoricalPersonWorkspace({
  topic,
  userName,
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
}: HistoricalPersonWorkspaceProps) {
  const [
    {
      startType,
      personOrTheme,
      timeSlice,
      customTimeSlice,
      engagementMode,
      setting,
      userRole,
      openingGoal,
      historianVisibility,
    },
    updateHistoricalState,
  ] = useReducer(
    mergeStateReducer<HistoricalState>,
    {
      startType: "direct",
      personOrTheme: "",
      timeSlice: historicalTimeSliceOptions[0],
      customTimeSlice: "",
      engagementMode: "debate",
      setting: "",
      userRole: "respectful but challenging interlocutor",
      openingGoal: "",
      historianVisibility: "medium",
    },
  );
  const visibleMessages = displayMessages(messages);
  const hasSession = messages.some((message) => message.role !== "system") || sending || awaitingResponse;
  const selectedMode =
    historicalEngagementModes.find((mode) => mode.id === engagementMode) ?? historicalEngagementModes[1];
  const selectedTimeSlice = customTimeSlice.trim() || timeSlice;

  function applyQuickStart(example: (typeof historicalQuickStarts)[number]) {
    updateHistoricalState({
      startType: example.startType as "direct" | "discover",
      personOrTheme: example.person,
      timeSlice: historicalTimeSliceOptions.includes(example.timeSlice)
        ? example.timeSlice
        : historicalTimeSliceOptions[0],
      customTimeSlice: historicalTimeSliceOptions.includes(example.timeSlice) ? "" : example.timeSlice,
      engagementMode: example.mode,
      setting: example.setting,
      userRole: example.userRole,
      openingGoal: example.goal,
    });
  }

  function selectEngagementMode(mode: (typeof historicalEngagementModes)[number]) {
    updateHistoricalState((current) => {
      const currentlyPreset = historicalEngagementModes.some((candidate) => candidate.role === current.userRole);
      return {
        engagementMode: mode.id,
        userRole: !current.userRole.trim() || currentlyPreset ? mode.role : current.userRole,
      };
    });
  }

  function startHistoricalEncounter(event?: FormEvent) {
    event?.preventDefault();
    if (!personOrTheme.trim() || sending) return;
    void onSend(
      buildHistoricalEncounterPrompt({
        startType,
        personOrTheme: personOrTheme.trim(),
        timeSlice: selectedTimeSlice,
        setting: setting.trim(),
        mode: engagementMode,
        userRole: userRole.trim() || selectedMode.role,
        openingGoal: openingGoal.trim(),
        historianVisibility,
      }),
    );
  }

  if (hasSession) {
    const encounterTitle =
      personOrTheme.trim() ||
      visibleMessages.find((message) => message.role === "user")?.content.replace(/^Historical audience:\s*/i, "") ||
      topic.name;
    const actions: CoachChatAction[] = [
      ...historicalDossierActions.map((action) => ({
        label: action.title,
        icon: FileText,
        disabled: sending,
        onClick: () =>
          void onSend(
            buildMiniAppInstruction({
              visible: action.title,
              instructions: action.prompt,
            }),
          ),
      })),
      ...historicalModeSwitches.map((switcher) => ({
        label: switcher.label,
        icon: Scale,
        disabled: sending,
        onClick: () =>
          void onSend(
            buildMiniAppInstruction({
              visible: switcher.label,
              instructions: switcher.prompt,
            }),
          ),
      })),
      {
        label: "Generate debrief",
        icon: FileText,
        disabled: sending,
        onClick: () =>
          void onSend(
            buildMiniAppInstruction({
              visible: "Generate debrief",
              instructions:
                "End this session with a debrief artifact: what the person argued, what I challenged, strongest insight, weakest claim, historical context learned, open questions, recommended next encounters, and any saved quotes clearly marked as generated paraphrases unless sourced.",
            }),
          ),
      },
    ];

    return (
      <CoachChatSession
        eyebrow="Historical audience"
        title={encounterTitle}
        subtitle={`${selectedTimeSlice} - ${selectedMode.label}`}
        userName={userName}
        coachName="Historian coach"
        placeholder="Ask, challenge, request evidence, or open a dossier item..."
        messages={visibleMessages}
        input={input}
        sending={sending}
        awaitingResponse={awaitingResponse}
        inputRef={inputRef}
        listRef={listRef}
        actions={actions}
        details={[
          { title: "Time slice", body: selectedTimeSlice, icon: History },
          { title: "Setting", body: setting.trim() || "Historically fitted setting", icon: MapPin },
          { title: "Your role", body: userRole || selectedMode.role, icon: UserRound },
          { title: "Mode", body: selectedMode.body, icon: historicalModeIcon(selectedMode.id) },
          {
            title: "Historian sidecar",
            body: historianVisibilityOptions.find((option) => option.value === historianVisibility)?.body ?? "Evidence labels stay visible.",
            icon: ShieldCheck,
          },
          { title: "Boundary", body: "Generated dialogue is simulation, not authenticated quotation.", icon: AlertTriangle },
        ]}
        resetLabel="Change audience"
        onInput={onInput}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onStop={onStop}
        onReset={onReset}
      />
    );
  }

  return (
    <main className="inspir-workspace historical-workspace">
      <div ref={listRef} className="historical-scroll app-scrollbar">
        {!hasSession ? (
          <section className="historical-start">
            <div className="historical-start-main">
              <TopicIntroCard {...topicIntroProps(topic)} />
              <header className="historical-audience-hero">
                <span>Historical Audience Chamber</span>
                <h2>Stage the person, year, room, and relationship.</h2>
                <p>
                  Build a bounded encounter with a dossier first, then speak through an
                  in-character layer and a historian sidecar.
                </p>
                <div className="historical-contract-strip" aria-label="Historical safeguards">
                  <span>
                    <ShieldCheck size={15} /> Time slice required
                  </span>
                  <span>
                    <FileText size={15} /> No invented quotes
                  </span>
                  <span>
                    <AlertTriangle size={15} /> Context is not endorsement
                  </span>
                </div>
              </header>
              <form className="historical-setup" onSubmit={startHistoricalEncounter}>
                <div className="historical-segmented" aria-label="Start type">
                  <button
                    type="button"
                    aria-pressed={startType === "direct"}
                    className={startType === "direct" ? "is-active" : ""}
                    onClick={() => updateHistoricalState({ startType: "direct" })}
                  >
                    <UserRound size={17} />
                    <span>Direct person</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={startType === "discover"}
                    className={startType === "discover" ? "is-active" : ""}
                    onClick={() => updateHistoricalState({ startType: "discover" })}
                  >
                    <Search size={17} />
                    <span>Vague start</span>
                  </button>
                </div>

                <label className="historical-field">
                  <span>{startType === "direct" ? "Person or challenge" : "What kind of person?"}</span>
                  <textarea
                    value={personOrTheme}
                    onChange={(event) => updateHistoricalState({ personOrTheme: event.target.value })}
                    placeholder={
                      startType === "direct"
                        ? "Napoleon after Austerlitz, Ambedkar in the Constitution committee..."
                        : "Someone who changed education, a leader from a collapsing empire..."
                    }
                    disabled={sending}
                    rows={2}
                  />
                </label>

                <div className="historical-field-grid">
                  <label className="historical-field">
                    <span>Setting</span>
                    <input
                      value={setting}
                      onChange={(event) => updateHistoricalState({ setting: event.target.value })}
                      placeholder="Court, study, prison cell, battlefield tent..."
                      disabled={sending}
                    />
                  </label>
                  <label className="historical-field">
                    <span>Your role</span>
                    <input
                      value={userRole}
                      onChange={(event) => updateHistoricalState({ userRole: event.target.value })}
                      placeholder="Student, rival, journalist, citizen..."
                      disabled={sending}
                    />
                  </label>
                </div>

                <section className="historical-form-block" aria-labelledby="time-slice-label">
                  <div className="historical-form-heading">
                    <ClockIcon />
                    <div>
                      <strong id="time-slice-label">Time slice</strong>
                      <span>The version of a person matters more than the name.</span>
                    </div>
                  </div>
                  <div className="historical-chip-grid">
                    {historicalTimeSliceOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={!customTimeSlice && timeSlice === option ? "is-active" : ""}
                        aria-pressed={!customTimeSlice && timeSlice === option}
                        onClick={() => {
                          updateHistoricalState({ timeSlice: option, customTimeSlice: "" });
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <label className="historical-field">
                    <span>Or write a precise slice</span>
                    <input
                      value={customTimeSlice}
                      onChange={(event) => updateHistoricalState({ customTimeSlice: event.target.value })}
                      placeholder="Salt March strategist, St. Helena retrospective, 1946 committee room..."
                      disabled={sending}
                    />
                  </label>
                </section>

                <section className="historical-form-block" aria-labelledby="engagement-label">
                  <div className="historical-form-heading">
                    <MessageCircle size={20} />
                    <div>
                      <strong id="engagement-label">Engagement contract</strong>
                      <span>Choose the relationship and the purpose of the room.</span>
                    </div>
                  </div>
                  <div className="historical-mode-grid">
                    {historicalEngagementModes.map((mode) => {
                      const Icon = historicalModeIcon(mode.id);
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          aria-pressed={engagementMode === mode.id}
                          className={engagementMode === mode.id ? "is-active" : ""}
                          onClick={() => selectEngagementMode(mode)}
                        >
                          <Icon size={18} />
                          <strong>{mode.label}</strong>
                          <span>{mode.body}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <div className="historical-field-grid">
                  <section className="historical-form-block" aria-label="Historian visibility">
                    <div className="historical-form-heading">
                      <FileText size={20} />
                      <div>
                        <strong>Historian sidecar</strong>
                        <span>How visibly should evidence appear?</span>
                      </div>
                    </div>
                    <div className="historical-visibility-grid">
                      {historianVisibilityOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={historianVisibility === option.value}
                          className={historianVisibility === option.value ? "is-active" : ""}
                          onClick={() => updateHistoricalState({ historianVisibility: option.value })}
                        >
                          <strong>{option.label}</strong>
                          <span>{option.body}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                  <label className="historical-field historical-opening-field">
                    <span>Opening purpose</span>
                    <textarea
                      value={openingGoal}
                      onChange={(event) => updateHistoricalState({ openingGoal: event.target.value })}
                      placeholder="What do you want to ask, test, learn, or confront?"
                      disabled={sending}
                      rows={5}
                    />
                  </label>
                </div>

                <button type="submit" className="historical-primary-action" disabled={!personOrTheme.trim() || sending}>
                  Build the audience
                </button>
              </form>
            </div>

            <aside className="historical-start-rail">
              <section className="historical-rail-panel">
                <div className="historical-rail-heading">
                  <Sparkles size={20} />
                  <strong>Fast starts</strong>
                </div>
                <div className="historical-quick-list">
                  {historicalQuickStarts.map((example) => (
                    <button key={example.label} type="button" onClick={() => applyQuickStart(example)}>
                      <span>{example.label}</span>
                      <small>{example.timeSlice}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section className="historical-rail-panel">
                <div className="historical-rail-heading">
                  <Landmark size={20} />
                  <strong>Dossier wall includes</strong>
                </div>
                <div className="historical-rail-list">
                  {historicalDossierActions.map((item) => (
                    <article key={item.title}>
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                    </article>
                  ))}
                </div>
              </section>
              <section className="historical-rail-panel historical-safety-panel">
                <div className="historical-rail-heading">
                  <AlertTriangle size={20} />
                  <strong>Non-negotiables</strong>
                </div>
                <p>
                  Generated dialogue is simulation. The historian layer must mark evidence,
                  uncertainty, anachronism, and harmful views clearly.
                </p>
              </section>
            </aside>
          </section>
        ) : (
          <section className="historical-stage-grid">
            <aside className="historical-dossier-panel">
              <div className="historical-session-heading">
                <Landmark size={23} />
                <div>
                  <span>Living dossier</span>
                  <strong>{personOrTheme.trim() || topic.name}</strong>
                </div>
              </div>
              <div className="historical-session-meta">
                <span>
                  <ClockIcon /> {selectedTimeSlice}
                </span>
                <span>
                  <MapPin size={15} /> {setting.trim() || "Historically fitted setting"}
                </span>
                <span>
                  <Scale size={15} /> {selectedMode.label}
                </span>
              </div>
              <div className="historical-dossier-actions">
                {historicalDossierActions.map((action) => (
                  <button
                    key={action.title}
                    type="button"
                    disabled={sending}
                    onClick={() =>
                      void onSend(
                        buildMiniAppInstruction({
                          visible: action.title,
                          instructions: action.prompt,
                        }),
                      )
                    }
                  >
                    <strong>{action.title}</strong>
                    <span>{action.body}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={sending}
                className="historical-debrief-button"
                onClick={() =>
                  void onSend(
                    buildMiniAppInstruction({
                      visible: "Generate debrief",
                      instructions:
                        "End this session with a debrief artifact: what the person argued, what I challenged, strongest insight, weakest claim, historical context learned, open questions, recommended next encounters, and any saved quotes clearly marked as generated paraphrases unless sourced.",
                    }),
                  )
                }
              >
                <FileText size={17} />
                <span>Generate debrief</span>
              </button>
              <button type="button" onClick={onReset} className="historical-new-session">
                New audience
              </button>
            </aside>

            <section className="historical-encounter-panel">
              <header className="historical-stage-top">
                <div className="historical-scene-mark">
                  <Landmark size={24} />
                </div>
                <div>
                  <span>Audience in progress</span>
                  <h2>{personOrTheme.trim() || "Historical encounter"}</h2>
                  <p>
                    {setting.trim() || "The scene is being established by the dossier."} · {userRole || selectedMode.role}
                  </p>
                </div>
                <div className="historical-temperature">
                  <Thermometer size={17} />
                  <span>{selectedMode.label}</span>
                </div>
              </header>

              <div className="historical-mode-switcher" aria-label="Conversation controls">
                {historicalModeSwitches.map((switcher) => (
                  <button
                    key={switcher.label}
                    type="button"
                    disabled={sending}
                    onClick={() =>
                      void onSend(
                        buildMiniAppInstruction({
                          visible: switcher.label,
                          instructions: switcher.prompt,
                        }),
                      )
                    }
                  >
                    {switcher.label}
                  </button>
                ))}
              </div>

              <div className="inspir-message-stack historical-message-stack">
                {visibleMessages.map((message) => (
                  <MessageCard key={message.id} message={message} userLabel={userName} />
                ))}
                {awaitingResponse ? (
                  <ThinkingMarker label="Thinking" />
                ) : null}
              </div>
            </section>

            <aside className="historical-sidecar-panel">
              <div className="historical-session-heading">
                <ShieldCheck size={22} />
                <div>
                  <span>Historian sidecar</span>
                  <strong>{historianVisibilityOptions.find((option) => option.value === historianVisibility)?.label}</strong>
                </div>
              </div>
              <div className="historical-sidecar-list">
                <article>
                  <strong>Evidence labels</strong>
                  <span>Documented, plausible reconstruction, modern paraphrase, contested, or fictionalized.</span>
                </article>
                <article>
                  <strong>Knowledge boundary</strong>
                  <span>The person should not know future events unless you explicitly open modern confrontation.</span>
                </article>
                <article>
                  <strong>Claim tracker</strong>
                  <span>Ask to save major claims and classify their evidence strength.</span>
                </article>
                <article>
                  <strong>Pressure check</strong>
                  <span>Use the dossier to see what incentives, fears, allies, and enemies shape the reply.</span>
                </article>
              </div>
            </aside>
          </section>
        )}
      </div>
      {hasSession ? (
        <form onSubmit={onSubmit} className="inspir-composer">
          <div className="inspir-composer-inner">
            <textarea
              aria-label="Historical conversation message"
              ref={inputRef}
              value={input}
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask, challenge, request evidence, or open a dossier item..."
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
      ) : null}
    </main>
  );
}

function findAiRunIdForMessage(messages: Message[], messageId: string) {
  const message = messages.find((item) => item.id === messageId);
  const aiRunId = message?.metadata?.aiRunId;
  return typeof aiRunId === "string" ? aiRunId : undefined;
}
