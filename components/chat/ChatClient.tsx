"use client";

import {
  FormEvent,
  KeyboardEvent,
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
import { FlashcardWorkspace } from "@/components/chat/FlashcardWorkspace";
import { GuidedMiniAppWorkspace } from "@/components/chat/GuidedMiniAppWorkspace";
import { GuestFeatureGate } from "@/components/chat/GuestFeatureGate";
import {
  type MemoryCreateInput,
  type MemoryDashboard,
  type MemorySettingsPatch,
  type MemoryUpdateInput,
} from "@/components/chat/memory-model";
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
import {
  localizedTopicHref,
  type Topic,
  topicIntroProps,
  type TopicMetadata,
  topicMetadata,
  topicSearchContent,
} from "@/components/chat/topic-model";
import { TopicSidebar } from "@/components/chat/TopicSidebar";
import { TimeTravelWorkspace } from "@/components/chat/TimeTravelWorkspace";
import { FocusTimerWorkspace, usePersistentLearningTools } from "@/components/chat/PersistentLearningTools";
import { defaultLanguage } from "@/lib/content/languages";
import { topicPath } from "@/lib/content/topic-routing";
import { localizeHref } from "@/lib/i18n/routing";
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
    const observer = new MutationObserver((mutations) => {
      if (mutations.every((mutation) => shouldSkipTranslation(mutation.target))) return;
      translateNodeTree();
    });
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

  const cancelScheduledMessageScroll = useCallback(() => {
    const frameId = scrollFrameRef.current;
    if (frameId === null) return;
    window.cancelAnimationFrame(frameId);
    scrollFrameRef.current = null;
  }, []);

  const scheduleMessageScrollToEnd = useCallback((behavior: ScrollBehavior = "auto") => {
    if (usesManagedMessageScroller) return;
    if (!shouldAutoFollowMessagesRef.current && !forceAutoFollowMessagesRef.current) return;
    cancelScheduledMessageScroll();
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      scrollMessageViewportToEnd(behavior);
    });
  }, [cancelScheduledMessageScroll, scrollMessageViewportToEnd, usesManagedMessageScroller]);

  useEffect(() => {
    return cancelScheduledMessageScroll;
  }, [cancelScheduledMessageScroll]);

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

function findAiRunIdForMessage(messages: Message[], messageId: string) {
  const message = messages.find((item) => item.id === messageId);
  const aiRunId = message?.metadata?.aiRunId;
  return typeof aiRunId === "string" ? aiRunId : undefined;
}
