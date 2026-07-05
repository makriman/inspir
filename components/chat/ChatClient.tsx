"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  RefObject,
  type ComponentType,
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
import Image from "next/image";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  BookOpenCheck,
  Bot,
  BrainCircuit,
  Camera,
  Check,
  CheckCircle2,
  Clipboard,
  Compass,
  Copy,
  Coins,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  Gavel,
  GitPullRequestArrow,
  HeartHandshake,
  History,
  Landmark,
  Languages,
  Lightbulb,
  ListChecks,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquareText,
  PencilLine,
  Plus,
  RefreshCw,
  Route,
  RotateCcw,
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
  Timer,
  Trash2,
  UserRound,
  Users,
  Waypoints,
  Workflow,
  X,
  XCircle,
} from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import {
  getDefaultSidebarTopicIds,
  type LearningStoreTopic,
} from "@/components/chat/learning-store-utils";
import { LearningStore } from "@/components/chat/LearningStore";
import { FocusTimerWorkspace, usePersistentLearningTools } from "@/components/chat/PersistentLearningTools";
import { PersistentLearningDock } from "@/components/chat/PersistentLearningDock";
import { RichMarkdownContent } from "@/components/chat/RichMarkdownContent";
import { LanguagePicker } from "@/components/i18n/LanguagePicker";
import { GoogleContinueButton } from "@/components/marketing/SignInButton";
import {
  Bubble as ChatBubblePrimitive,
  BubbleContent as ChatBubbleContent,
} from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message as ChatMessagePrimitive,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";
import { topicPath } from "@/lib/content/topic-routing";
import { localizeHref } from "@/lib/i18n/routing";
import { formatBubbleDate } from "@/lib/utils/dates";
import { buildMiniAppInstruction, getVisibleMessageContent } from "@/lib/ai/visible-content";
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

type TopicMetadata = {
  category: string;
  uiMode:
    | "chat"
    | "quiz"
    | "flashcards"
    | "time-travel"
    | "historical-person"
    | "interactive-instruction"
    | "collaborative-instruction"
    | "socratic-instruction"
    | "study-timer"
    | "focus-music";
  modelProfile: "fast" | "reasoning" | "structured";
  starters: string[];
  keywords?: string[];
  source?: string;
  toolId?: string;
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
  dateOfBirth?: string | null;
  age?: number | null;
  createdAt: string | Date;
  profileImageHash?: string | null;
};

type ApiProfileUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  score?: number | null;
  preferredLanguage?: string | null;
  dateOfBirth?: string | null;
  age?: number | null;
  createdAt: string | Date;
  profileImageHash?: string | null;
};

type ProfileDetailsInput = {
  name: string;
  dateOfBirth: string | null;
  preferredLanguage: string;
};

type UiTranslator = (source: string) => string;

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

type MemorySettings = {
  enabled: boolean;
  savedMemoryEnabled: boolean;
  chatHistoryEnabled: boolean;
  dreamingEnabled: boolean;
  captureScope: string;
  retrievalMode: string;
  noticeSeenAt: string | Date | null;
};

type MemoryItem = {
  id: string;
  kind: string;
  category: string;
  content: string;
  displayContent?: string;
  sourceLabel?: string;
  tags: string[];
  confidence: number;
  salience: number;
  sourceType?: string;
  freshnessStatus?: string;
  pinned?: boolean;
  doNotMention?: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type MemorySummarySection = {
  id: string;
  title: string;
  category: string;
  summary: string;
  sourceMemoryIds?: string[];
  sourceTurnIds?: string[];
  doNotMention?: boolean;
};

type MemorySummary = {
  summary: string;
  sections: MemorySummarySection[];
  lastSynthesizedAt: string | Date;
  updatedAt: string | Date;
};

type MemoryProfile = {
  category: string;
  summary: string;
  updatedAt: string | Date;
};

type MemoryDashboard = {
  settings: MemorySettings;
  summary: MemorySummary | null;
  memories: MemoryItem[];
  profiles: MemoryProfile[];
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

type ProfileResponse = {
  user?: ApiProfileUser;
  error?: string;
};

type ActivityRunResponse = {
  activityRun: ActivityRun | null;
};

type MessageMemorySource = {
  type: "memory" | "summary" | "past_chat";
  id: string;
  label: string;
  excerpt: string;
  reason?: string;
  memoryId?: string;
  chatTurnId?: string;
  summarySectionId?: string;
};

class StaleChatRequestError extends Error {
  constructor() {
    super("Chat request was superseded");
    this.name = "StaleChatRequestError";
  }
}

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

type PublicFlashcard = {
  id: string;
  front: string;
  back?: string;
  hint?: string;
  example?: string;
  trap?: string;
  tags?: string[];
  isRevealed?: boolean;
  rating?: "known" | "again";
  reviewedAt?: string;
};

type PublicFlashcardState = {
  topic: string;
  source?: string;
  currentIndex: number;
  knownCount: number;
  reviewedCount: number;
  maxCards: 12;
  completed: boolean;
  cards: PublicFlashcard[];
};

type MiniMode = Exclude<TopicMetadata["uiMode"], "chat" | "quiz" | "flashcards" | "study-timer" | "focus-music">;

function topicMetadata(topic: Topic | undefined): TopicMetadata | undefined {
  const metadata = topic?.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  if (!("uiMode" in metadata) || !("starters" in metadata)) return undefined;
  return metadata as TopicMetadata;
}

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

function topicSearchContent(topic: Topic) {
  const metadata = topicMetadata(topic);
  return [
    topic.name,
    topic.subText,
    topic.description,
    topic.inputboxText,
    metadata?.category,
    metadata?.uiMode,
    metadata?.source,
    ...(metadata?.starters ?? []),
    ...(metadata?.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isQuizState(value: Record<string, unknown>): value is PublicQuizState {
  return (
    typeof value.topic === "string" &&
    Array.isArray(value.questions) &&
    typeof value.currentIndex === "number"
  );
}

function isFlashcardState(value: Record<string, unknown>): value is PublicFlashcardState {
  return (
    typeof value.topic === "string" &&
    Array.isArray(value.cards) &&
    typeof value.currentIndex === "number" &&
    typeof value.reviewedCount === "number"
  );
}

function toDisplayMessage(message: Message): Message | null {
  if (message.role === "system") return null;
  const content = getVisibleMessageContent(message.content).trim();
  if (!content) return null;
  return content === message.content ? message : { ...message, content };
}

function displayMessages(messages: Message[]) {
  return messages.map(toDisplayMessage).filter((message): message is Message => Boolean(message));
}

function isExplicitMemoryMutationRequest(value: string) {
  return /\b(remember|remeber|rember|rememebr|remembr|remebr|keep in mind|save that|save this|forget|clear memory|clear memories|delete memory|delete memories)\b/i.test(
    value,
  );
}

function profileFromApiUser(user: ApiProfileUser): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    score: user.score ?? 0,
    preferredLanguage: user.preferredLanguage ?? defaultLanguage,
    dateOfBirth: user.dateOfBirth ?? null,
    age: user.age ?? null,
    createdAt: user.createdAt,
    profileImageHash: user.profileImageHash ?? null,
  };
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

type MergeStateAction<State> = Partial<State> | ((state: State) => Partial<State>);

function mergeStateReducer<State>(state: State, nextState: MergeStateAction<State>) {
  const patch = typeof nextState === "function" ? nextState(state) : nextState;
  return { ...state, ...patch };
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
  const usesManagedMessageScroller = uiMode === "chat";
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

  useEffect(() => {
    const used = readStoredGuestUsage(guestMessageLimit);
    if (used) updateChatState({ guestMessagesUsed: used });
  }, [guestMessageLimit]);

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

  const scheduleMessageScrollToEnd = useCallback((behavior: ScrollBehavior = "auto") => {
    if (usesManagedMessageScroller) return;
    if (!shouldAutoFollowMessagesRef.current && !forceAutoFollowMessagesRef.current) return;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const element = listRef.current;
      if (!element || (!shouldAutoFollowMessagesRef.current && !forceAutoFollowMessagesRef.current)) return;
      element.scrollTo({ top: element.scrollHeight, behavior });
    });
  }, [usesManagedMessageScroller]);

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

  useEffect(() => {
    shouldAutoFollowMessagesRef.current = true;
    forceAutoFollowMessagesRef.current = true;
    scheduleMessageScrollToEnd("auto");
  }, [activeChatId, activeTopicId, scheduleMessageScrollToEnd]);

  useEffect(() => {
    scheduleMessageScrollToEnd("auto");
  }, [visibleChatMessages.length, activityRun, scheduleMessageScrollToEnd]);

  useEffect(() => {
    scheduleMessageScrollToEnd("auto");
  }, [messages, streamingMessageId, scheduleMessageScrollToEnd]);

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
    if (isGuest && guestMessagesUsed >= guestMessageLimit) {
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
    if (appendUser) setMessages((current) => [...current, userMessage]);
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
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        return;
      }
      if (!response.ok || !response.body) throw new Error("No assistant response");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let assistantInserted = false;
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

      function flushAssistantText() {
        cancelAssistantFlush();
        if (!assistantText) return;
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
              },
            ],
          }));
        } else {
          updateChatState((current) => ({
            messages: current.messages.map((message) =>
              message.id === assistantMessageId ? { ...message, content: assistantText } : message,
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
          flushAssistantText();
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
          : Math.min(guestMessagesUsed + 1, guestMessageLimit);
        saveGuestUsage(Math.min(nextUsed, guestMessageLimit));
      }
      if (isCurrentRequest() && !isGuest && chatId) {
        await loadChat(chatId, { preserveRequest: true });
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

  async function patchMemorySettings(input: {
    enabled?: boolean;
    savedMemoryEnabled?: boolean;
    chatHistoryEnabled?: boolean;
    dreamingEnabled?: boolean;
    noticeSeen?: boolean;
    refreshSummary?: boolean;
    correction?: string;
  }) {
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

  async function createMemoryItem(input: { content: string; category?: string }) {
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
    input: { content?: string; category?: string; tags?: string[]; pinned?: boolean; doNotMention?: boolean },
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
    activeTopicId,
    addSidebarTopic,
    addedTopicIds,
    avatarSrc,
    displayTopics,
    filteredTopics,
    isGuest,
    mobileSidebarOpen,
    openLearningStore,
    profileOpen,
    search,
    selectTopic,
    sidebarTopics,
    setGuestPromptOpen,
    setMobileSidebarOpen,
    setProfileOpen,
    setSearch,
    translationBundle,
    translationRootRef,
  } = controller;

  return (
    <div
      key={`${translationBundle.language}-${translationBundle.sourceHash}`}
      ref={translationRootRef}
      className={`bubble-chat-root ${profileOpen ? "profile-open" : ""}`}
    >
      <aside className={`bubble-sidebar ${mobileSidebarOpen ? "is-open" : ""}`}>
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
          className="bubble-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <ChatMainSection controller={controller} />
      <ChatPanelOverlays controller={controller} />
    </div>
  );
}

function ChatMainSection({ controller }: { controller: ChatClientController }) {
  const {
    activeTopic,
    isFlashcardMode,
    isGuest,
    isQuizMode,
    messages,
    openRecentConversations,
    profileOpen,
    recentOpen,
    regenerateLast,
    resetChat,
    sending,
    setMobileSidebarOpen,
    setProfileOpen,
    setRecentOpen,
    setStoreOpen,
    stopGeneration,
    storeOpen,
  } = controller;

  return (
    <section className="bubble-main-shell">
      <TopBar
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
      />
      <ChatWorkspaceSwitch controller={controller} />
    </section>
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
    setRecentOpen,
    setProfileOpen,
    stopGeneration,
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
      return <GuestFeatureGate topic={activeTopic} featureName="scored AI quizzes" language={currentLanguage} />;
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
      return <GuestFeatureGate topic={activeTopic} featureName="AI flashcard decks" language={currentLanguage} />;
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

  if (!miniAppMode) return <StandardChatWorkspace controller={controller} />;

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

function StandardChatWorkspace({ controller }: { controller: ChatClientController }) {
  const {
    activeTopic,
    activeChatId,
    activeTopicId,
    awaitingResponse,
    handleComposerKeyDown,
    input,
    inputRef,
    listRef,
    metadata,
    sendMessage,
    sending,
    setInput,
    setMemorySourceModal,
    stopGeneration,
    streamingMessageId,
    submitMessage,
    userDisplayName,
    visibleChatMessages,
  } = controller;
  const streamingMessageLength = streamingMessageId
    ? (visibleChatMessages.find((message) => message.id === streamingMessageId)?.content.length ?? 0)
    : 0;

  return (
    <main className="bubble-workspace">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end" scrollEdgeThreshold={64} scrollMargin={112}>
        <StandardChatScrollFollow
          activeChatId={activeChatId}
          activeTopicId={activeTopicId}
          awaitingResponse={awaitingResponse}
          messageCount={visibleChatMessages.length}
          sending={sending}
          streamingMessageId={streamingMessageId}
          streamingMessageLength={streamingMessageLength}
        />
        <MessageScroller className="bubble-message-scroller">
          <MessageScrollerViewport ref={listRef} className="bubble-message-scroll app-scrollbar">
            <MessageScrollerContent className="bubble-message-stack">
              {visibleChatMessages.length === 0 ? (
                <MessageScrollerItem>
                  <TopicIntroCard topic={activeTopic} />
                </MessageScrollerItem>
              ) : null}
              {visibleChatMessages.length === 0 ? (
                <MessageScrollerItem>
                  <StarterGrid starters={metadata?.starters ?? []} onStart={(starter) => void sendMessage(starter)} />
                </MessageScrollerItem>
              ) : null}
              {visibleChatMessages.map((message) => (
                <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor>
                  <MessageBubble
                    message={message}
                    isStreaming={message.id === streamingMessageId}
                    userLabel={userDisplayName}
                    onMemorySources={(sources) => setMemorySourceModal({ messageId: message.id, sources })}
                  />
                </MessageScrollerItem>
              ))}
              {awaitingResponse ? (
                <MessageScrollerItem scrollAnchor>
                  <ThinkingMarker label="Thinking" />
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="bubble-scroll-button" />
        </MessageScroller>
      </MessageScrollerProvider>
      <form onSubmit={submitMessage} className="bubble-composer">
        <div className="bubble-composer-inner">
          <textarea
            aria-label="Message"
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
  );
}

function StandardChatScrollFollow({
  activeChatId,
  activeTopicId,
  awaitingResponse,
  messageCount,
  sending,
  streamingMessageId,
  streamingMessageLength,
}: {
  activeChatId: string | undefined;
  activeTopicId: string;
  awaitingResponse: boolean;
  messageCount: number;
  sending: boolean;
  streamingMessageId: string | null;
  streamingMessageLength: number;
}) {
  const { scrollToEnd } = useMessageScroller();
  const shouldFollow = sending || awaitingResponse || Boolean(streamingMessageId);

  useLayoutEffect(() => {
    if (!shouldFollow) return;
    scrollToEnd({ behavior: "auto" });
  }, [
    activeChatId,
    activeTopicId,
    awaitingResponse,
    messageCount,
    scrollToEnd,
    sending,
    shouldFollow,
    streamingMessageId,
    streamingMessageLength,
  ]);

  return null;
}

function ChatPanelOverlays({ controller }: { controller: ChatClientController }) {
  const {
    activeTopic,
    agePromptOpen,
    guestMessageLimit,
    guestMessagesUsed,
    guestPromptOpen,
    currentLanguage,
    isGuest,
    learningTools,
    memorySourceModal,
    openFirstTopicWithMode,
    profileUser,
    setAgePromptOpen,
    setGuestPromptOpen,
    setMemorySourceModal,
    setProfileUser,
    submitMemorySourceFeedback,
    translateUi,
  } = controller;

  return (
    <>
      <PersistentLearningDock
        tools={learningTools}
        onOpenTimer={() => openFirstTopicWithMode("study-timer")}
        onOpenMusic={() => openFirstTopicWithMode("focus-music")}
      />
      {isGuest && guestPromptOpen ? (
        <GuestContinueModal
          used={guestMessagesUsed}
          limit={guestMessageLimit}
          callbackUrl={localizeHref(activeTopic ? topicPath(activeTopic.slug) : "/chat", currentLanguage)}
          onClose={() => setGuestPromptOpen(false)}
        />
      ) : null}
      {!isGuest && agePromptOpen && !profileUser.dateOfBirth ? (
        <AgePromptModal
          initialLanguage={profileUser.preferredLanguage || defaultLanguage}
          onClose={() => setAgePromptOpen(false)}
          onSaved={(updatedUser) => {
            setProfileUser(updatedUser);
            setAgePromptOpen(false);
          }}
          t={translateUi}
        />
      ) : null}
      {memorySourceModal ? (
        <MemorySourcesModal
          sources={memorySourceModal.sources}
          onClose={() => setMemorySourceModal(null)}
          onFeedback={(source, action) => void submitMemorySourceFeedback(source, action)}
        />
      ) : null}
    </>
  );
}

function TopicSidebar({
  isGuest,
  avatarSrc,
  topics,
  sidebarTopics,
  filteredTopics,
  currentLanguage,
  activeTopicId,
  addedTopicIds,
  search,
  onAddFeature,
  onOpenStore,
  onProfile,
  onSearch,
  onSelect,
}: {
  isGuest: boolean;
  avatarSrc?: string;
  topics: Topic[];
  sidebarTopics: Topic[];
  filteredTopics: Topic[];
  currentLanguage: string;
  activeTopicId: string;
  addedTopicIds: string[];
  search: string;
  onAddFeature: (topicId: string) => void;
  onOpenStore: () => void;
  onProfile: () => void;
  onSearch: (value: string) => void;
  onSelect: (topicId: string) => void;
}) {
  const activeTopic = topics.find((topic) => topic.id === activeTopicId);
  const rows = search ? filteredTopics : sidebarTopics;
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
        {isGuest ? (
          <GoogleContinueButton
            className="bubble-guest-auth-button"
            callbackUrl={localizeHref(activeTopic ? topicPath(activeTopic.slug) : "/chat", currentLanguage)}
          >
            Continue with Google
          </GoogleContinueButton>
        ) : (
          <button type="button" onClick={onProfile} aria-label="Open profile" className="bubble-avatar-button">
            {avatarSrc ? (
              <Image src={avatarSrc} alt="" width={40} height={40} sizes="40px" unoptimized />
            ) : null}
          </button>
        )}
        <InspirLogo className="bubble-sidebar-logo" />
        <button
          type="button"
          onClick={onOpenStore}
          aria-label="Open learning store"
          title="Open learning store"
          className="bubble-sidebar-store-button"
        >
          <Plus size={20} />
        </button>
      </div>
      <div className="bubble-search-row">
        <div className="bubble-search-shell">
          <input
            aria-label="Search chats"
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
        {!search && rows.length === 0 && activeTopic ? (
          <button
            type="button"
            onClick={() => onSelect(activeTopic.id)}
            className={`bubble-topic-row ${activeTopic.id === activeTopicId ? "is-active" : ""}`}
          >
            <span className="bubble-topic-title">{activeTopic.name}</span>
            <span className="bubble-topic-subtitle">{activeTopic.subText}</span>
          </button>
        ) : null}
        {groups.map((group) => (
          <section key={group.category} className="bubble-topic-group">
            <h3>{group.category}</h3>
            {group.topics.map((topic) => {
              const isAdded = addedTopicIds.includes(topic.id);
              return (
                <div key={topic.id} className="bubble-topic-row-shell">
                  <button
                    type="button"
                    onClick={() => onSelect(topic.id)}
                    className={`bubble-topic-row ${search ? "has-sidebar-action" : ""} ${
                      topic.id === activeTopicId ? "is-active" : ""
                    }`}
                  >
                    <span className="bubble-topic-title">{topic.name}</span>
                    <span className="bubble-topic-subtitle">{topic.subText}</span>
                  </button>
                  {search ? (
                    isAdded ? (
                      <span className="bubble-topic-row-action is-added" aria-label={`${topic.name} is added`}>
                        <Check size={16} />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onAddFeature(topic.id);
                        }}
                        className="bubble-topic-row-action"
                        aria-label={`Add ${topic.name} to sidebar`}
                        title={`Add ${topic.name} to sidebar`}
                      >
                        <Plus size={16} />
                      </button>
                    )
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function TopBar({
  title,
  recentOpen,
  showRecent,
  sending,
  canRegenerate,
  onReset,
  onRecent,
  onBack,
  onMenu,
  onStop,
  onRegenerate,
  showSessionActions = true,
}: {
  title: string;
  recentOpen: boolean;
  showRecent: boolean;
  sending: boolean;
  canRegenerate: boolean;
  onReset: () => void;
  onRecent: () => void;
  onBack: () => void;
  onMenu: () => void;
  onStop: () => void;
  onRegenerate: () => void;
  showSessionActions?: boolean;
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
        {showSessionActions ? (
          <>
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
            {showRecent ? (
              <button type="button" onClick={onRecent} aria-label="Recent conversations" className="bubble-history-button">
                <History size={26} strokeWidth={3} />
              </button>
            ) : null}
          </>
        ) : null}
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

function GuestFeatureGate({ topic, featureName, language }: { topic: Topic; featureName: string; language: string }) {
  const starters = topicMetadata(topic)?.starters ?? [];
  const topicHref = localizeHref(topicPath(topic.slug), language);

  return (
    <main className="bubble-workspace">
      <section className="bubble-guest-feature-gate">
        <TopicIntroCard topic={topic} />
        <div className="bubble-guest-feature-card">
          <Sparkles size={26} />
          <span>Sign in to keep learning</span>
          <h2>Continue with Google to use {featureName}.</h2>
          <p>Sign in keeps your progress, score, generated activities, and future conversations saved.</p>
          <GoogleContinueButton className="bubble-guest-modal-primary" callbackUrl={topicHref}>
            Continue with Google
          </GoogleContinueButton>
        </div>
        {starters.length ? (
          <div className="bubble-starter-grid">
            {starters.map((starter) => (
              <a key={starter} href={topicHref}>
                <Sparkles size={16} />
                <span>{starter}</span>
              </a>
            ))}
          </div>
        ) : null}
      </section>
    </main>
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
    <main className="bubble-workspace bubble-time-workspace">
      <div className="bubble-time-scroll app-scrollbar">
        <section className="bubble-time-onboarding">
          <div className="bubble-time-stage">
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
    <div className="bubble-time-departure">
      <header className="bubble-time-hero">
        <div>
          <span>{topic.name}</span>
          <h2>Departures beyond the present</h2>
        </div>
        <button type="button" onClick={onRandom} className="bubble-time-icon-button">
          <Waypoints size={18} />
          <span>Send me somewhere consequential</span>
        </button>
      </header>

      <form className="bubble-time-search-board" onSubmit={onResolve}>
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

      <div className="bubble-time-map-board" aria-label="Historical hotspots">
        {featured.map((journey) => (
          <button key={journey.id} type="button" onClick={() => onSelect(journey)} className="bubble-time-hotspot">
            <MapPin size={16} />
            <span>{journey.label}</span>
          </button>
        ))}
      </div>

      <ol className="bubble-time-timeline-stops">
        {featured.map((journey) => (
          <li key={journey.id}>
            <button type="button" onClick={() => onSelect(journey)}>
              <span>{journey.date}</span>
              <strong>{journey.place}</strong>
            </button>
          </li>
        ))}
      </ol>

      <div className="bubble-time-journey-grid">
        {timeTravelJourneyTemplates.slice(0, 6).map((journey) => (
          <button key={journey.id} type="button" onClick={() => onSelect(journey)} className="bubble-time-journey-card">
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
    <div className="bubble-time-question">
      <button type="button" onClick={onBack} className="bubble-time-back">
        <ArrowLeft size={17} />
        <span>Departure board</span>
      </button>
      <span>Arrival point</span>
      <h2>{intent.trim() ? "Choose the strongest entry point." : "Choose your arrival point."}</h2>
      <p>Center of power, street-level life, and the edge of the system reveal different histories.</p>
      <div className="bubble-time-option-grid">
        {options.map((journey) => (
          <button key={journey.id} type="button" onClick={() => onSelect(journey)} className="bubble-time-option-card">
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
    <div className="bubble-time-question">
      <button type="button" onClick={onBack} className="bubble-time-back">
        <ArrowLeft size={17} />
        <span>Back</span>
      </button>
      <span>{kicker}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="bubble-time-option-grid">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => onSelect(choice.id)}
            className={`bubble-time-option-card ${choice.id === selectedId ? "is-selected" : ""}`}
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
    <div className="bubble-time-clearance">
      <button type="button" onClick={onBack} className="bubble-time-back">
        <ArrowLeft size={17} />
        <span>Back</span>
      </button>
      <div className="bubble-time-clearance-head">
        <ShieldCheck size={28} />
        <div>
          <span>Travel advisory</span>
          <h2>{journey.arrival}</h2>
        </div>
      </div>
      <div className="bubble-time-advisory-grid">
        <TimeTravelAdvisoryItem icon="language" label="Languages" value={journey.languages.join(", ")} />
        <TimeTravelAdvisoryItem icon="risk" label="Risk" value={`${journey.risk} - ${journey.exposureRisk}`} />
        <TimeTravelAdvisoryItem icon="money" label="Money" value={identity?.money ?? journey.currency} />
        <TimeTravelAdvisoryItem icon="status" label="Status" value={identity?.status ?? "Pending identity clearance"} />
        <TimeTravelAdvisoryItem icon="rules" label="Do not forget" value={journey.socialRules[0] ?? "Local rules apply"} />
        <TimeTravelAdvisoryItem icon="evidence" label="Evidence" value={journey.confidence} />
      </div>
      <div className="bubble-time-warning">
        <AlertTriangle size={20} />
        <span>{journey.exposureRisk}</span>
      </div>
      <button type="button" disabled={!ready || sending} onClick={onBegin} className="bubble-time-enter-button">
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
    <article className="bubble-time-advisory-item">
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
    <aside className={`bubble-time-passport ${compact ? "is-compact" : ""}`}>
      <div className="bubble-time-passport-cover">
        <div>
          <span>Temporal passport</span>
          <h3>{journey?.label ?? "Clearance pending"}</h3>
        </div>
        <Stamp size={28} />
      </div>
      <dl className="bubble-time-passport-fields">
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
      <div className="bubble-time-stamps">
        {stamps.length ? (
          stamps.map((stamp) => <span key={stamp}>{stamp}</span>)
        ) : (
          <span>Awaiting first stamp</span>
        )}
      </div>
    </aside>
  );
}

type CoachChatAction = {
  label: string;
  icon?: ComponentType<{ size?: number }>;
  onClick: () => void;
  disabled?: boolean;
};

type CoachChatDetail = {
  title: string;
  body: string;
  icon?: ComponentType<{ size?: number }>;
};

function CoachChatSession({
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
    <main className="bubble-workspace coach-chat-workspace">
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
                <MessageBubble
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

          <form onSubmit={onSubmit} className="bubble-composer coach-chat-composer">
            <div className="bubble-composer-inner">
              <textarea
                aria-label="Message coach"
                ref={inputRef}
                value={input}
                onChange={(event) => onInput(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
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
        </section>
      </section>
    </main>
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

const collaborationModeOptions = [
  {
    id: "friendly_builder",
    label: "Friendly builder",
    role: "supportive peer and co-builder",
    tone: "warm, practical, momentum-focused",
    instruction: "Build momentum, make a useful first pass, and ask for decisions without overpraising.",
    icon: HeartHandshake,
  },
  {
    id: "sharp_sparring_partner",
    label: "Sharp sparring partner",
    role: "tough critic and editor",
    tone: "direct, constructive, evidence-focused",
    instruction: "Challenge weak assumptions, vague claims, and missing evidence while keeping the user as decision owner.",
    icon: BrainCircuit,
  },
  {
    id: "structured_operator",
    label: "Structured operator",
    role: "project-room operator",
    tone: "crisp, organized, completion-focused",
    instruction: "Break the work into tasks, track blockers, keep the decision log current, and push toward a concrete output.",
    icon: ListChecks,
  },
] as const;

type CollaborationModeId = (typeof collaborationModeOptions)[number]["id"];

const collaborationRoomTemplates = {
  pair_builder: {
    label: "Pair builder",
    title: "Shared draft room",
    artifactTitle: "Working artifact",
    icon: FileText,
    sections: [
      { title: "Output", body: "Define the thing we are making and the standard it has to meet." },
      { title: "Structure", body: "Sketch the outline, sections, or table before polishing language." },
      { title: "Evidence", body: "Collect examples, facts, quotes, or constraints that support the work." },
      { title: "Revision", body: "Track accepted changes, rejected changes, and the next edit." },
    ],
    comments: ["Clarify the audience", "Preserve user voice", "Show changes before merging"],
  },
  sparring_partner: {
    label: "Sparring partner",
    title: "Argument test room",
    artifactTitle: "Assumption map",
    icon: GitPullRequestArrow,
    sections: [
      { title: "Claim", body: "State the idea in one sentence so it can be tested." },
      { title: "Assumptions", body: "List what has to be true for the idea to work." },
      { title: "Weakest point", body: "Attack the most fragile assumption first." },
      { title: "Decision", body: "Accept, revise, reject, or gather evidence." },
    ],
    comments: ["Prove this", "Separate logic from execution", "Name the tradeoff"],
  },
  study_buddy: {
    label: "Study buddy",
    title: "Learning workroom",
    artifactTitle: "Concept board",
    icon: Lightbulb,
    sections: [
      { title: "Core idea", body: "Build the plain-language explanation together." },
      { title: "User explanation", body: "The learner explains it back in their own words." },
      { title: "AI challenge", body: "One targeted question tests the current understanding." },
      { title: "Recap", body: "Lock useful notes only after the idea has been used." },
    ],
    comments: ["Unclear", "Try an example", "Check understanding before moving on"],
  },
  project_operator: {
    label: "Project operator",
    title: "Execution room",
    artifactTitle: "Task board",
    icon: Workflow,
    sections: [
      { title: "Goal", body: "Define the concrete finish line and owner." },
      { title: "Next actions", body: "Split work into AI-owned, user-owned, and shared moves." },
      { title: "Blockers", body: "Expose missing input, risk, time pressure, or unclear scope." },
      { title: "Checkpoint", body: "End every sprint with an artifact or decision." },
    ],
    comments: ["Make it smaller", "Assign ownership", "End with output"],
  },
  creative_partner: {
    label: "Creative partner",
    title: "Idea studio",
    artifactTitle: "Option board",
    icon: Sparkles,
    sections: [
      { title: "Raw options", body: "Generate enough material to choose from." },
      { title: "Clusters", body: "Group similar ideas and name the pattern." },
      { title: "Kill list", body: "Remove weak, generic, or low-fit ideas quickly." },
      { title: "Prototype", body: "Develop the strongest option into something testable." },
    ],
    comments: ["Expand", "Cut", "Make it stranger", "Pick the strongest"],
  },
} as const;

type CollaborationRoomType = keyof typeof collaborationRoomTemplates;

const collaborationQuickStarts = [
  "Prepare for a class discussion on Tata's acquisition of JLR",
  "Build an essay outline on climate adaptation",
  "Pressure-test my startup idea",
  "Learn supply and demand by working through examples",
];

const collaborationHandoffActions = [
  {
    label: "AI, take first pass",
    prompt: "Take the first pass on the shared artifact. Make the structure visible, mark assumptions, and ask me to accept, edit, or reject.",
    icon: Bot,
  },
  {
    label: "I will try",
    prompt: "Hand the next move to me. Give me one clear task and wait for my contribution before you revise.",
    icon: UserRound,
  },
  {
    label: "Challenge me",
    prompt: "Challenge the weakest part of the current artifact. Be direct, name the assumption, and ask me to defend or revise it.",
    icon: BrainCircuit,
  },
  {
    label: "Rewrite this",
    prompt: "Rewrite the current rough section as a suggested edit. Show what changed and why before asking me to merge it.",
    icon: PencilLine,
  },
  {
    label: "Just advise",
    prompt: "Stop editing directly for this turn. Give concise advice and one practical next move.",
    icon: MessageSquareText,
  },
  {
    label: "Merge changes",
    prompt: "Merge the accepted changes into a clean current version, then update the decision log and open questions.",
    icon: GitPullRequestArrow,
  },
] as const;

function getCollaborationMode(modeId: CollaborationModeId) {
  return collaborationModeOptions.find((mode) => mode.id === modeId) ?? collaborationModeOptions[0];
}

function inferCollaborationRoomType(goal: string): CollaborationRoomType {
  const normalized = goal.toLowerCase();
  if (
    /\b(essay|write|draft|memo|deck|pitch|outline|paper|article|answer|story|script|proposal)\b/.test(
      normalized,
    )
  ) {
    return "pair_builder";
  }
  if (/\b(idea|argument|assumption|strategy|decision|hypothesis|risk|case|debate|thesis)\b/.test(normalized)) {
    return "sparring_partner";
  }
  if (/\b(project|execute|plan|tasks|deadline|launch|ship|finish|operator|sprint)\b/.test(normalized)) {
    return "project_operator";
  }
  if (/\b(brainstorm|creative|ideas|name|concept|options|prototype)\b/.test(normalized)) {
    return "creative_partner";
  }
  return "study_buddy";
}

function extractCollaborationGoal(messages: Message[]) {
  const firstUser = messages.find((message) => message.role === "user")?.content.trim();
  if (!firstUser) return "";
  const extracted = extractCollaborationGoalFromContent(firstUser);
  if (extracted) return extracted;
  return firstUser.length > 180 ? `${firstUser.slice(0, 177).trim()}...` : firstUser;
}

function extractCollaborationGoalFromContent(content: string) {
  const match = content.match(/collaborative workroom for:\s*([\s\S]*?)(?:\n\nMode:|$)/i);
  return match?.[1]?.trim() ?? "";
}

function buildCollaborativeInstructionPrompt({
  goal,
  mode,
  roomType,
}: {
  goal: string;
  mode: (typeof collaborationModeOptions)[number];
  roomType: CollaborationRoomType;
}) {
  const room = collaborationRoomTemplates[roomType];
  return buildMiniAppInstruction({
    visible: `Open workroom: ${goal} (${mode.label})`,
    instructions: [
      `Let's open a collaborative workroom for: ${goal}`,
      "",
      `Mode: ${mode.label}`,
      `AI role: ${mode.role}`,
      `Tone: ${mode.tone}`,
      `Workspace: ${room.label} - ${room.artifactTitle}`,
      "",
      "Make the first rough structure before giving advice. Start with: \"I made the first rough structure. Edit anything. I will react to your changes.\"",
      "Use visible sections: Shared artifact, AI contribution, User move, Inline comments, Decision log, Open questions, Next action.",
      mode.instruction,
      "Track decisions and open questions. Preserve my voice in writing tasks. Ask at most one practical question if context is missing.",
    ].join("\n"),
  });
}

function formatSprintTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function CollaborativeInstructionWorkspace({
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
  const [{ goal, roomGoal, modeId, sprintSeconds, sprintRunning }, updateCollaborationState] = useReducer(
    mergeStateReducer<{
      goal: string;
      roomGoal: string;
      modeId: CollaborationModeId;
      sprintSeconds: number;
      sprintRunning: boolean;
    }>,
    {
      goal: "",
      roomGoal: "",
      modeId: "friendly_builder",
      sprintSeconds: 10 * 60,
      sprintRunning: false,
    },
  );
  const rawMessages = messages.filter((message) => message.role !== "system");
  const visibleMessages = displayMessages(messages);
  const recoveredGoal = extractCollaborationGoal(rawMessages);
  const activeGoal = roomGoal || recoveredGoal || goal;
  const roomType = inferCollaborationRoomType(activeGoal);
  const room = collaborationRoomTemplates[roomType];
  const RoomIcon = room.icon;
  const activeMode = getCollaborationMode(modeId);
  const hasSession = rawMessages.length > 0 || sending || awaitingResponse || Boolean(roomGoal);

  useEffect(() => {
    if (!sprintRunning) return;
    const timer = window.setInterval(() => {
      updateCollaborationState((current) => {
        if (current.sprintSeconds <= 1) {
          window.clearInterval(timer);
          window.setTimeout(() => updateCollaborationState({ sprintRunning: false }), 0);
          return { sprintSeconds: 0 };
        }
        return { sprintSeconds: current.sprintSeconds - 1 };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sprintRunning]);

  function startWorkroom(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed || sending) return;
    const nextRoomType = inferCollaborationRoomType(trimmed);
    updateCollaborationState({ roomGoal: trimmed });
    void onSend(
      buildCollaborativeInstructionPrompt({
        goal: trimmed,
        mode: activeMode,
        roomType: nextRoomType,
      }),
    );
  }

  function switchMode(nextModeId: CollaborationModeId) {
    if (nextModeId === modeId || sending) return;
    const nextMode = getCollaborationMode(nextModeId);
    updateCollaborationState({ modeId: nextModeId });
    if (hasSession) {
      void onSend(
        buildMiniAppInstruction({
          visible: `Switch to ${nextMode.label}`,
          instructions: `Switch collaboration mode to ${nextMode.label}. Keep the same shared artifact, decision log, open questions, and user ownership.`,
        }),
      );
    }
  }

  function sendHandoff(action: (typeof collaborationHandoffActions)[number]) {
    if (sending) return;
    void onSend(
      buildMiniAppInstruction({
        visible: action.label,
        instructions: action.prompt,
      }),
    );
  }

  function startSprint() {
    if (sending) return;
    updateCollaborationState({ sprintSeconds: 10 * 60, sprintRunning: true });
    void onSend(
      buildMiniAppInstruction({
        visible: "Start 10-minute sprint",
        instructions: `Start a 10-minute sprint for "${activeGoal || topic.name}". Pick one concrete artifact checkpoint, assign my move and your support role, then end with a checkpoint.`,
      }),
    );
  }

  if (hasSession) {
    return (
      <CollaborativeSession
        activeGoal={activeGoal}
        activeMode={activeMode}
        awaitingResponse={awaitingResponse}
        input={input}
        inputRef={inputRef}
        listRef={listRef}
        messages={visibleMessages}
        modeId={modeId}
        room={room}
        roomIcon={RoomIcon}
        sending={sending}
        sprintRunning={sprintRunning}
        sprintSeconds={sprintSeconds}
        topic={topic}
        userName={userName}
        onHandoff={sendHandoff}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onReset={onReset}
        onSprint={startSprint}
        onStop={onStop}
        onSubmit={onSubmit}
        onSwitchMode={switchMode}
      />
    );
  }

  return (
    <CollaborativeSetup
      activeMode={activeMode}
      goal={goal}
      listRef={listRef}
      modeId={modeId}
      room={room}
      roomIcon={RoomIcon}
      sending={sending}
      onGoal={(value) => updateCollaborationState({ goal: value })}
      onMode={(value) => updateCollaborationState({ modeId: value })}
      onStartWorkroom={startWorkroom}
    />
  );
}

function CollaborativeSession({
  activeGoal,
  activeMode,
  awaitingResponse,
  input,
  inputRef,
  listRef,
  messages,
  modeId,
  room,
  roomIcon: RoomIcon,
  sending,
  sprintRunning,
  sprintSeconds,
  topic,
  userName,
  onHandoff,
  onInput,
  onKeyDown,
  onReset,
  onSprint,
  onStop,
  onSubmit,
  onSwitchMode,
}: {
  activeGoal: string;
  activeMode: (typeof collaborationModeOptions)[number];
  awaitingResponse: boolean;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  messages: Message[];
  modeId: CollaborationModeId;
  room: (typeof collaborationRoomTemplates)[CollaborationRoomType];
  roomIcon: ComponentType<{ size?: number }>;
  sending: boolean;
  sprintRunning: boolean;
  sprintSeconds: number;
  topic: Topic;
  userName: string;
  onHandoff: (action: (typeof collaborationHandoffActions)[number]) => void;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onReset: () => void;
  onSprint: () => void;
  onStop: () => void;
  onSubmit: (event?: FormEvent) => void;
  onSwitchMode: (modeId: CollaborationModeId) => void;
}) {
  const ActiveModeIcon = activeMode.icon;
  const actionItems: CoachChatAction[] = [
    ...collaborationHandoffActions.map((action) => ({
      label: action.label,
      icon: action.icon,
      disabled: sending,
      onClick: () => onHandoff(action),
    })),
    {
      label: sprintRunning ? "Sprint running" : "Start 10 min",
      icon: Timer,
      disabled: sending || sprintRunning,
      onClick: onSprint,
    },
    ...collaborationModeOptions.map((modeOption) => ({
      label: modeOption.label,
      icon: modeOption.icon,
      disabled: sending || modeOption.id === modeId,
      onClick: () => onSwitchMode(modeOption.id),
    })),
  ];

  return (
    <CoachChatSession
      eyebrow="Collaborative Instruction"
      title={activeGoal || topic.name}
      subtitle={`${room.title} - ${activeMode.label}`}
      userName={userName}
      coachName="Collaborator"
      placeholder="Add, edit, challenge, or decide the next move"
      messages={messages}
      input={input}
      sending={sending}
      awaitingResponse={awaitingResponse}
      inputRef={inputRef}
      listRef={listRef}
      actions={actionItems}
      details={[
        { title: "Workspace", body: `${room.label} - ${room.artifactTitle}`, icon: RoomIcon },
        { title: "Working style", body: `${activeMode.role}. ${activeMode.tone}.`, icon: ActiveModeIcon },
        {
          title: "Sprint clock",
          body: sprintRunning ? `${formatSprintTime(sprintSeconds)} remaining` : "Ready for a 10-minute checkpoint",
          icon: Timer,
        },
        ...room.sections.map((section) => ({ title: section.title, body: section.body, icon: FileText })),
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

function CollaborativeSetup({
  activeMode,
  goal,
  listRef,
  modeId,
  room,
  roomIcon: RoomIcon,
  sending,
  onGoal,
  onMode,
  onStartWorkroom,
}: {
  activeMode: (typeof collaborationModeOptions)[number];
  goal: string;
  listRef: RefObject<HTMLDivElement | null>;
  modeId: CollaborationModeId;
  room: (typeof collaborationRoomTemplates)[CollaborationRoomType];
  roomIcon: ComponentType<{ size?: number }>;
  sending: boolean;
  onGoal: (value: string) => void;
  onMode: (value: CollaborationModeId) => void;
  onStartWorkroom: (event?: FormEvent) => void;
}) {
  const ActiveModeIcon = activeMode.icon;
  return (
    <main className="bubble-workspace bubble-collab-workspace">
      <div ref={listRef} className="bubble-collab-scroll app-scrollbar">
        <section className="bubble-collab-start">
          <header className="bubble-collab-roombar">
            <div>
              <span>Shared workroom</span>
              <h2>Collaborative Instruction</h2>
            </div>
            <strong className="bubble-collab-status-pill">
              <ActiveModeIcon size={15} />
              Mode: {activeMode.label}
            </strong>
          </header>
          <div className="bubble-collab-start-grid">
            <form className="bubble-collab-intent-panel" onSubmit={onStartWorkroom}>
              <label htmlFor="collab-goal">What are we trying to build, solve, learn, or improve?</label>
              <textarea
                id="collab-goal"
                value={goal}
                onChange={(event) => onGoal(event.target.value)}
                placeholder="Prepare for a class discussion on Tata's acquisition of JLR"
                rows={5}
                disabled={sending}
              />
              <fieldset className="bubble-collab-mode-picker">
                <legend className="sr-only">Collaboration style</legend>
                {collaborationModeOptions.map((modeOption) => {
                  const ModeIcon = modeOption.icon;
                  return (
                    <button
                      key={modeOption.id}
                      type="button"
                      onClick={() => onMode(modeOption.id)}
                      className={modeOption.id === modeId ? "is-active" : ""}
                    >
                      <ModeIcon size={17} />
                      <span>{modeOption.label}</span>
                    </button>
                  );
                })}
              </fieldset>
              <button type="submit" disabled={!goal.trim() || sending} className="bubble-collab-open-button">
                <Route size={18} />
                Open workroom
              </button>
            </form>
            <section className="bubble-collab-canvas-preview" aria-label="Workspace preview">
              <div className="bubble-collab-preview-head">
                <RoomIcon size={22} />
                <div>
                  <span>{room.title}</span>
                  <strong>{room.artifactTitle}</strong>
                </div>
              </div>
              <div className="bubble-collab-preview-grid">
                {room.sections.map((section) => (
                  <article key={section.title}>
                    <strong>{section.title}</strong>
                    <span>{section.body}</span>
                  </article>
                ))}
              </div>
              <div className="bubble-collab-quick-starts">
                {collaborationQuickStarts.map((quickStart) => (
                  <button key={quickStart} type="button" onClick={() => onGoal(quickStart)}>
                    <Sparkles size={14} />
                    <span>{quickStart}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
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
    <main className="bubble-workspace bubble-mini-workspace">
      <div ref={listRef} className="bubble-mini-scroll app-scrollbar">
        {!hasSession ? (
          <section className="bubble-mini-start">
            <TopicIntroCard topic={topic} />
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
                  <MessageBubble key={message.id} message={message} userLabel={userName} />
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
        <form onSubmit={onSubmit} className="bubble-composer">
          <div className="bubble-composer-inner">
            <textarea
              aria-label="Debate message"
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
    <main className="bubble-workspace historical-workspace">
      <div ref={listRef} className="historical-scroll app-scrollbar">
        {!hasSession ? (
          <section className="historical-start">
            <div className="historical-start-main">
              <TopicIntroCard topic={topic} />
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

              <div className="bubble-message-stack historical-message-stack">
                {visibleMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} userLabel={userName} />
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
        <form onSubmit={onSubmit} className="bubble-composer">
          <div className="bubble-composer-inner">
            <textarea
              aria-label="Historical conversation message"
              ref={inputRef}
              value={input}
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask, challenge, request evidence, or open a dossier item..."
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

function ClockIcon() {
  return <History size={20} />;
}

function MiniIcon({ icon }: { icon: MiniAppConfig["icon"] }) {
  return (
    <div className="bubble-mini-icon">
      <MiniIconGlyph icon={icon} />
    </div>
  );
}

function MiniIconGlyph({ icon }: { icon: MiniAppConfig["icon"] }) {
  switch (icon) {
    case "compass":
      return <Compass size={24} />;
    case "landmark":
      return <Landmark size={24} />;
    case "lesson":
      return <BookOpenCheck size={24} />;
    case "collab":
      return <Clipboard size={24} />;
    case "socratic":
      return <Gauge size={24} />;
  }
}

function MessageBubble({
  message,
  isStreaming = false,
  userLabel = "Learner",
  assistantLabel = "Coach response",
  onMemorySources,
}: {
  message: Message;
  isStreaming?: boolean;
  userLabel?: string;
  assistantLabel?: string;
  onMemorySources?: (sources: MessageMemorySource[]) => void;
}) {
  const isUser = message.role === "user";
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
      className={`bubble-message-row ${isUser ? "is-user" : "is-assistant"}`}
    >
      <MessageAvatar className="bubble-message-avatar" aria-hidden="true">
        {isUser ? <UserRound size={15} /> : <Bot size={15} />}
      </MessageAvatar>
      <MessageContent className="bubble-message-content">
        <ChatBubblePrimitive
          align={isUser ? "end" : "start"}
          variant={isUser ? "default" : "ghost"}
          className="bubble-message-bubble-shell"
        >
          <ChatBubbleContent asChild>
            <article className="bubble-message-bubble">
              <MessageHeader className="bubble-message-author">
                {isUser ? <UserRound size={14} /> : <Bot size={14} />}
                <strong>{isUser ? userLabel : assistantLabel}</strong>
              </MessageHeader>
              <RichMarkdownContent content={message.content} streaming={isStreaming} />
              <MessageFooter className="bubble-message-footer">
                <time>{formatBubbleDate(message.createdAt)}</time>
                {!isUser && memorySources.length > 0 && onMemorySources ? (
                  <button
                    type="button"
                    onClick={() => onMemorySources(memorySources)}
                    aria-label="Show memory sources"
                    className="bubble-memory-source-button"
                  >
                    <StickyNote size={14} />
                  </button>
                ) : null}
                <button type="button" onClick={copyMessage} aria-label="Copy message">
                  {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                </button>
              </MessageFooter>
            </article>
          </ChatBubbleContent>
        </ChatBubblePrimitive>
      </MessageContent>
    </ChatMessagePrimitive>
  );
}

function ThinkingMarker({ label }: { label: string }) {
  return (
    <Marker className="bubble-thinking" aria-live="polite">
      <MarkerIcon className="bubble-thinking-dots">
        <span />
        <span />
        <span />
      </MarkerIcon>
      <MarkerContent>
        <strong>{label}</strong>
      </MarkerContent>
    </Marker>
  );
}

function MemorySourcesModal({
  sources,
  onClose,
  onFeedback,
}: {
  sources: MessageMemorySource[];
  onClose: () => void;
  onFeedback: (source: MessageMemorySource, action: "relevant" | "not_relevant" | "dont_mention") => void;
}) {
  return (
    <div className="bubble-modal-backdrop" role="presentation">
      <section className="bubble-memory-source-modal" role="dialog" aria-modal="true" aria-label="Memory sources">
        <header>
          <div>
            <strong>Memory sources</strong>
            <span>{sources.length} used for this reply</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close memory sources">
            <X size={20} />
          </button>
        </header>
        <div className="bubble-memory-source-list app-scrollbar">
          {sources.map((source) => (
            <article key={source.id} className="bubble-memory-source-card">
              <div>
                <strong>{source.label}</strong>
                {source.reason ? <span>{source.reason}</span> : null}
              </div>
              <p>{source.excerpt}</p>
              <div className="bubble-memory-source-actions">
                <button type="button" onClick={() => onFeedback(source, "relevant")} aria-label="Mark source relevant">
                  <Check size={15} />
                </button>
                <button type="button" onClick={() => onFeedback(source, "not_relevant")} aria-label="Mark source not relevant">
                  <XCircle size={15} />
                </button>
                <button type="button" onClick={() => onFeedback(source, "dont_mention")} aria-label="Do not mention this source">
                  <EyeOff size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
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
  const [{ topic, loading, buildProgress, answering, error }, updateQuizState] = useReducer(
    mergeStateReducer<{
      topic: string;
      loading: boolean;
      buildProgress: number;
      answering: boolean;
      error: string;
    }>,
    { topic: "", loading: false, buildProgress: 0, answering: false, error: "" },
  );
  const quiz = activityRun?.type === "quiz" && isQuizState(activityRun.state) ? activityRun.state : null;
  const currentQuestion = quiz?.questions[quiz.currentIndex];
  const lastAnswered = quiz
    ? [...quiz.questions].reverse().find((question) => question.userAnswerIndex !== undefined)
    : undefined;

  useEffect(() => {
    if (!loading) return;
    const interval = window.setInterval(() => {
      updateQuizState((current) => ({
        buildProgress: Math.min(94, current.buildProgress + Math.max(3, Math.round((100 - current.buildProgress) / 7))),
      }));
    }, 520);

    return () => window.clearInterval(interval);
  }, [loading]);

  async function startQuiz(event?: FormEvent) {
    event?.preventDefault();
    const quizTopic = topic.trim();
    if (!quizTopic || loading) return;
    updateQuizState({ error: "", buildProgress: 8, loading: true });
    try {
      const chatId = activeChatId ?? (await createChat(activeTopicId));
      const response = await fetch("/api/activities/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, topic: quizTopic }),
      });
      if (!response.ok) throw new Error("Could not build quiz");
      const data = (await response.json()) as ActivityRunResponse;
      updateQuizState({ buildProgress: 100 });
      onActivityRun(data.activityRun);
    } catch {
      updateQuizState({
        error: "I could not build that quiz right now. Try a simpler topic or try again.",
        buildProgress: 0,
      });
    } finally {
      updateQuizState({ loading: false });
    }
  }

  async function answerQuestion(answerIndex: number) {
    if (!activityRun || answering) return;
    updateQuizState({ answering: true, error: "" });
    try {
      const response = await fetch(`/api/activities/quiz/${activityRun.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answerIndex }),
      });
      if (!response.ok) throw new Error("Could not score answer");
      const data = (await response.json()) as ActivityRunResponse;
      onActivityRun(data.activityRun);
    } catch {
      updateQuizState({ error: "I could not score that answer. Please try again." });
    } finally {
      updateQuizState({ answering: false });
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
                aria-label="Quiz topic"
                value={topic}
                onChange={(event) => updateQuizState({ topic: event.target.value })}
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

const flashcardBuildSteps = [
  "Finding atomic ideas",
  "Writing recall prompts",
  "Adding memory hints",
  "Checking common traps",
  "Stacking the deck",
  "Ready for review",
];

function FlashcardWorkspace({
  activeChatId,
  activeTopicId,
  activityRun,
  createChat,
  onActivityRun,
  onReset,
}: {
  activeChatId?: string;
  activeTopicId: string;
  activityRun: ActivityRun | null;
  createChat: (topicId?: string) => Promise<string>;
  onActivityRun: (run: ActivityRun | null) => void;
  onReset: () => void;
}) {
  const [{ topic, source, loading, buildProgress, reviewing, error, hintCardId }, updateFlashcardState] = useReducer(
    mergeStateReducer<{
      topic: string;
      source: string;
      loading: boolean;
      buildProgress: number;
      reviewing: boolean;
      error: string;
      hintCardId: string | null;
    }>,
    { topic: "", source: "", loading: false, buildProgress: 0, reviewing: false, error: "", hintCardId: null },
  );
  const deck = activityRun?.type === "flashcards" && isFlashcardState(activityRun.state) ? activityRun.state : null;
  const currentCard = deck?.cards[deck.currentIndex];
  const missedCards = deck?.cards.filter((card) => card.rating === "again") ?? [];
  const remainingCount = deck ? Math.max(0, deck.maxCards - deck.reviewedCount) : 0;
  const progressPercent = deck ? Math.round((deck.reviewedCount / deck.maxCards) * 100) : 0;
  const hintOpen = Boolean(currentCard && hintCardId === currentCard.id);

  useEffect(() => {
    if (!loading) return;
    const interval = window.setInterval(() => {
      updateFlashcardState((current) => ({
        buildProgress: Math.min(94, current.buildProgress + Math.max(4, Math.round((100 - current.buildProgress) / 6))),
      }));
    }, 520);

    return () => window.clearInterval(interval);
  }, [loading]);

  async function startFlashcards(event?: FormEvent) {
    event?.preventDefault();
    const deckTopic = topic.trim();
    if (!deckTopic || loading) return;
    updateFlashcardState({ error: "", buildProgress: 8, loading: true });
    try {
      const chatId = activeChatId ?? (await createChat(activeTopicId));
      const response = await fetch("/api/activities/flashcards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, topic: deckTopic, source: source.trim() || undefined }),
      });
      if (!response.ok) throw new Error("Could not build flashcards");
      const data = (await response.json()) as ActivityRunResponse;
      updateFlashcardState({ buildProgress: 100 });
      onActivityRun(data.activityRun);
    } catch {
      updateFlashcardState({
        error: "I could not build that deck right now. Try a shorter topic or simpler notes.",
        buildProgress: 0,
      });
    } finally {
      updateFlashcardState({ loading: false });
    }
  }

  async function reviewCard(action: "reveal" | "known" | "again") {
    if (!activityRun || reviewing) return;
    updateFlashcardState({ reviewing: true, error: "" });
    try {
      const response = await fetch(`/api/activities/flashcards/${activityRun.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "reveal" ? { action: "reveal" } : { action: "rate", rating: action },
        ),
      });
      if (!response.ok) throw new Error("Could not review card");
      const data = (await response.json()) as ActivityRunResponse;
      onActivityRun(data.activityRun);
    } catch {
      updateFlashcardState({ error: "I could not save that card review. Please try again." });
    } finally {
      updateFlashcardState({ reviewing: false });
    }
  }

  function changeDeck() {
    onReset();
    updateFlashcardState({ topic: "", source: "", error: "", hintCardId: null, buildProgress: 0 });
  }

  function reviewMissed(deckState: PublicFlashcardState) {
    const missed = deckState.cards.filter((card) => card.rating === "again");
    updateFlashcardState({
      topic: `Weak spots from ${deckState.topic}`,
      source: missed
        .map((card, index) => `${index + 1}. ${card.front}\nAnswer: ${card.back ?? ""}\nTrap: ${card.trap ?? ""}`)
        .join("\n\n"),
      error: "",
      hintCardId: null,
    });
    onActivityRun(null);
  }

  return (
    <main className="bubble-workspace bubble-flashcard-workspace">
      {!deck ? (
        loading ? (
          <FlashcardBuildLoader topic={topic} progress={buildProgress} />
        ) : (
          <form onSubmit={startFlashcards} className="bubble-flashcard-start">
            <div className="bubble-flashcard-start-copy">
              <div className="bubble-flashcard-start-icon">
                <Clipboard size={28} />
              </div>
              <span>Active recall builder</span>
              <h2>Turn material into a deck you actually test yourself on.</h2>
              <p>Give me a topic or paste notes. I will build 12 focused cards with optional hints, traps, and examples.</p>
            </div>
            <div className="bubble-flashcard-start-panel">
              <div className="bubble-flashcard-input-stack">
                <label>
                  <span>Deck topic</span>
                  <input
                    value={topic}
                    onChange={(event) => updateFlashcardState({ topic: event.target.value })}
                    placeholder="Mitosis, climate zones, irregular verbs..."
                    disabled={loading}
                  />
                </label>
                <label>
                  <span>Source notes</span>
                  <textarea
                    value={source}
                    onChange={(event) => updateFlashcardState({ source: event.target.value })}
                    placeholder="Optional: paste notes, syllabus points, or facts to prioritize"
                    disabled={loading}
                    rows={5}
                  />
                </label>
              </div>
              <button type="submit" disabled={loading || !topic.trim()}>
                Build deck
              </button>
              <div className="bubble-flashcard-start-rules" aria-label="Deck rules">
                <span>Recall before reveal</span>
                <span>Hints stay optional</span>
                <span>Misses become a smaller review deck</span>
              </div>
              {error ? <span className="bubble-quiz-error">{error}</span> : null}
            </div>
          </form>
        )
      ) : (
        <section className="bubble-flashcard-shell">
          <header className="bubble-flashcard-header">
            <div>
              <span>Flashcards on</span>
              <h2>{deck.topic}</h2>
            </div>
            <button type="button" onClick={changeDeck}>
              <RotateCcw size={16} />
              <span>Change deck</span>
            </button>
          </header>
          <div className="bubble-quiz-progress">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="bubble-flashcard-stats" aria-label="Deck progress">
            <FlashcardStat label="Known" value={`${deck.knownCount}/${deck.maxCards}`} />
            <FlashcardStat label="Again" value={String(missedCards.length)} />
            <FlashcardStat label="Left" value={String(remainingCount)} />
          </div>

          {deck.completed ? (
            <FlashcardReview deck={deck} onReviewMissed={reviewMissed} onStartOver={changeDeck} />
          ) : currentCard ? (
            <article className={`bubble-flashcard-card ${currentCard.back ? "is-revealed" : ""}`}>
              <div className="bubble-flashcard-card-top">
                <span>
                  Card {deck.currentIndex + 1} of {deck.maxCards}
                </span>
                <div>
                  {(currentCard.tags ?? []).map((tag) => (
                    <small key={tag}>{tag}</small>
                  ))}
                </div>
              </div>
              <h3>{currentCard.front}</h3>
              {currentCard.hint && hintOpen && !currentCard.back ? (
                <p className="bubble-flashcard-hint">
                  <strong>Hint</strong>
                  {currentCard.hint}
                </p>
              ) : null}

              {currentCard.back ? (
                <div className="bubble-flashcard-answer">
                  <strong>Answer</strong>
                  <p>{currentCard.back}</p>
                  {currentCard.example ? <span>Example: {currentCard.example}</span> : null}
                  {currentCard.trap ? <span>Watch out: {currentCard.trap}</span> : null}
                </div>
              ) : null}

              <div className="bubble-flashcard-actions">
                {!currentCard.back ? (
                  <>
                    {currentCard.hint ? (
                      <button
                        type="button"
                        disabled={reviewing}
                        onClick={() => updateFlashcardState({ hintCardId: hintOpen ? null : currentCard.id })}
                      >
                        {hintOpen ? "Hide hint" : "Need a hint"}
                      </button>
                    ) : null}
                    <button type="button" disabled={reviewing} onClick={() => void reviewCard("reveal")}>
                      Show answer
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={reviewing} onClick={() => void reviewCard("again")}>
                      Review again
                    </button>
                    <button type="button" disabled={reviewing} onClick={() => void reviewCard("known")}>
                      I knew it
                    </button>
                  </>
                )}
              </div>
            </article>
          ) : null}
          {error ? <span className="bubble-quiz-error">{error}</span> : null}
        </section>
      )}
    </main>
  );
}

function FlashcardBuildLoader({ topic, progress }: { topic: string; progress: number }) {
  const stepIndex = Math.min(
    flashcardBuildSteps.length - 1,
    Math.floor((progress / 100) * flashcardBuildSteps.length),
  );
  return (
    <section className="bubble-quiz-loader bubble-flashcard-loader" aria-live="polite">
      <div className="bubble-flashcard-loader-stack">
        <span />
        <span />
        <span />
        <Clipboard size={26} />
      </div>
      <div>
        <span className="bubble-quiz-loader-kicker">Building your deck</span>
        <h2>{topic.trim() || "Your topic"}</h2>
        <p>{flashcardBuildSteps[stepIndex]}</p>
      </div>
      <div className="bubble-quiz-loader-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className="bubble-quiz-loader-steps">
        {flashcardBuildSteps.map((step, index) => (
          <li key={step} className={index <= stepIndex ? "is-active" : ""}>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

function FlashcardStat({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function FlashcardReview({
  deck,
  onReviewMissed,
  onStartOver,
}: {
  deck: PublicFlashcardState;
  onReviewMissed: (deck: PublicFlashcardState) => void;
  onStartOver: () => void;
}) {
  const missed = deck.cards.filter((card) => card.rating === "again");
  return (
    <article className="bubble-flashcard-review">
      <h3>Deck complete: {deck.knownCount}/12 known</h3>
      <p>
        {missed.length
          ? "Review the cards marked again, then rebuild a smaller deck from those weak spots."
          : "Clean sweep. Come back later and test the same deck from memory."}
      </p>
      <div className="bubble-flashcard-review-actions">
        {missed.length ? (
          <button type="button" onClick={() => onReviewMissed(deck)}>
            Review missed cards
          </button>
        ) : null}
        <button type="button" onClick={onStartOver}>
          Build another deck
        </button>
      </div>
      <div className="bubble-review-list">
        {deck.cards.map((card, index) => (
          <div key={card.id} className={card.rating === "known" ? "is-correct" : "is-wrong"}>
            <strong>
              {index + 1}. {card.front}
            </strong>
            <span>{card.back}</span>
            {card.trap ? <p>Trap: {card.trap}</p> : null}
          </div>
        ))}
      </div>
    </article>
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
      {loading ? <p className="bubble-recent-empty">Loading…</p> : null}
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

function GuestContinueModal({
  used,
  limit,
  callbackUrl,
  onClose,
}: {
  used: number;
  limit: number;
  callbackUrl: string;
  onClose: () => void;
}) {
  return (
    <div className="bubble-guest-modal-backdrop" role="presentation">
      <dialog open className="bubble-guest-modal" aria-modal="true" aria-labelledby="guest-modal-title">
        <button type="button" onClick={onClose} aria-label="Close" className="bubble-guest-modal-close">
          <X size={20} />
        </button>
        <span className="bubble-guest-modal-kicker">
          {Math.min(used, limit)}/{limit} free guest messages used
        </span>
        <h2 id="guest-modal-title">Continue learning</h2>
        <p>
          Easy Google login, then inspir stores your learning history, language preference, and chats so
          everything is ready next time. inspir stays free to use.
        </p>
        <GoogleContinueButton className="bubble-guest-modal-primary" callbackUrl={callbackUrl}>
          Continue with Google
        </GoogleContinueButton>
        <button type="button" onClick={onClose} className="bubble-guest-modal-secondary">
          Maybe later
        </button>
      </dialog>
    </div>
  );
}

function AgePromptModal({
  onClose,
  onSaved,
  initialLanguage,
  t,
}: {
  onClose: () => void;
  onSaved: (user: UserProfile) => void;
  initialLanguage: string;
  t: UiTranslator;
}) {
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState<SupportedLanguage>((initialLanguage as SupportedLanguage) || defaultLanguage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  async function submitDateOfBirth(event: FormEvent) {
    event.preventDefault();
    if (!dateOfBirth) {
      setError(t("Please enter your date of birth."));
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dateOfBirth, preferredLanguage }),
      });
      const data = (await response.json().catch(() => null)) as ProfileResponse | null;
      if (!response.ok || !data?.user) {
        throw new Error(data?.error || t("Could not save date of birth"));
      }
      onSaved(profileFromApiUser(data.user));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("Please enter a valid date of birth."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bubble-guest-modal-backdrop" role="presentation">
      <dialog
        open
        className="bubble-guest-modal bubble-age-modal"
        aria-modal="true"
        aria-labelledby="age-modal-title"
      >
        <button type="button" onClick={onClose} aria-label={t("Close")} className="bubble-guest-modal-close">
          <X size={20} />
        </button>
        <span className="bubble-guest-modal-kicker">{t("Age-appropriate learning")}</span>
        <h2 id="age-modal-title">{t("Help inspir fit your age")}</h2>
        <p>
          {t(
            "Add your date of birth and preferred language so inspir can adapt examples, tone, safety boundaries, and app text for your learning experience.",
          )}
        </p>
        <form onSubmit={submitDateOfBirth} className="bubble-age-form">
          <label className="bubble-age-label" htmlFor="date-of-birth">
            {t("Date of birth")}
          </label>
          <input
            id="date-of-birth"
            type="date"
            value={dateOfBirth}
            max={today}
            onChange={(event) => setDateOfBirth(event.target.value)}
            className="bubble-age-input"
            required
          />
          <LanguagePicker
            currentLanguage={preferredLanguage}
            recommendedLanguage={preferredLanguage}
            buttonLabel={t("Preferred Language")}
            title={t("Choose your learning language")}
            description={t("App text and tutoring replies will follow this setting.")}
            closeLabel={t("Close")}
            quickChoicesLabel={t("Preferred Language")}
            onSelect={setPreferredLanguage}
            className="bubble-modal-language-picker"
          />
          {error ? <span className="bubble-age-error">{error}</span> : null}
          <button type="submit" disabled={saving} className="bubble-guest-modal-primary">
            {saving ? t("Saving...") : t("Continue")}
          </button>
          <button type="button" onClick={onClose} className="bubble-guest-modal-secondary">
            {t("Maybe later")}
          </button>
        </form>
      </dialog>
    </div>
  );
}

function ProfilePanel({
  user,
  avatarSrc,
  languageSaving,
  memoryDashboard,
  memoryLoading,
  memorySaving,
  memoryError,
  onPhotoUpload,
  onPhotoRemove,
  onProfileSave,
  onMemorySettings,
  onMemoryCreate,
  onMemoryUpdate,
  onMemoryDelete,
  onMemoryClear,
  onClose,
  t,
}: {
  user: UserProfile;
  avatarSrc?: string;
  languageSaving: boolean;
  memoryDashboard: MemoryDashboard | null;
  memoryLoading: boolean;
  memorySaving: boolean;
  memoryError: string | null;
  onPhotoUpload: (file: File) => Promise<string | null>;
  onPhotoRemove: () => Promise<void>;
  onProfileSave: (input: ProfileDetailsInput) => Promise<UserProfile>;
  onMemorySettings: (input: {
    enabled?: boolean;
    savedMemoryEnabled?: boolean;
    chatHistoryEnabled?: boolean;
    dreamingEnabled?: boolean;
    noticeSeen?: boolean;
    refreshSummary?: boolean;
    correction?: string;
  }) => void;
  onMemoryCreate: (input: { content: string; category?: string }) => void;
  onMemoryUpdate: (
    memoryId: string,
    input: { content?: string; category?: string; tags?: string[]; pinned?: boolean; doNotMention?: boolean },
  ) => void;
  onMemoryDelete: (memoryId: string) => void;
  onMemoryClear: () => void;
  onClose: () => void;
  t: UiTranslator;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth ?? "");
  const [preferredLanguage, setPreferredLanguage] = useState<SupportedLanguage>(
    (user.preferredLanguage as SupportedLanguage) || defaultLanguage,
  );
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoMessage, setPhotoMessage] = useState("");
  const [photoError, setPhotoError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoSaving(true);
    setPhotoError("");
    setPhotoMessage("");
    try {
      await onPhotoUpload(file);
      setPhotoMessage(t("Profile photo updated."));
    } catch (uploadError) {
      setPhotoError(uploadError instanceof Error ? uploadError.message : t("Could not update profile photo."));
    } finally {
      setPhotoSaving(false);
      event.target.value = "";
    }
  }

  async function resetPhoto() {
    setPhotoSaving(true);
    setPhotoError("");
    setPhotoMessage("");
    try {
      await onPhotoRemove();
      setPhotoMessage(t("Using your Google photo."));
    } catch (removeError) {
      setPhotoError(removeError instanceof Error ? removeError.message : t("Could not reset profile photo."));
    } finally {
      setPhotoSaving(false);
    }
  }

  async function submitProfileDetails(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setDetailsError(t("Enter a display name."));
      setDetailsMessage("");
      return;
    }

    setDetailsSaving(true);
    setDetailsError("");
    setDetailsMessage("");
    const previousLanguage = user.preferredLanguage || defaultLanguage;
    try {
      const updatedUser = await onProfileSave({
        name: trimmedName,
        dateOfBirth: dateOfBirth || null,
        preferredLanguage,
      });
      setName(updatedUser.name ?? "");
      setDateOfBirth(updatedUser.dateOfBirth ?? "");
      setPreferredLanguage((updatedUser.preferredLanguage as SupportedLanguage) || defaultLanguage);
      setDetailsMessage(t("Profile saved."));
      if ((updatedUser.preferredLanguage || defaultLanguage) !== previousLanguage) {
        window.location.assign(localizeHref(window.location.pathname + window.location.search, updatedUser.preferredLanguage));
      }
    } catch (saveError) {
      setDetailsError(saveError instanceof Error ? saveError.message : t("Could not save profile."));
    } finally {
      setDetailsSaving(false);
    }
  }

  return (
    <main className="bubble-profile-panel bubble-profile-workspace app-scrollbar">
      <div className="bubble-profile-header">
        <div>
          <span>{t("Learning profile")}</span>
          <h2>{t("Make inspir feel like it knows how you learn.")}</h2>
        </div>
        <button type="button" aria-label={t("Close profile")} onClick={onClose}>
          <X size={24} strokeWidth={3.5} />
        </button>
      </div>
      <div className="bubble-profile-body">
        <section className="bubble-profile-hero">
          <div className="bubble-profile-avatar">
            {avatarSrc ? (
              <Image key={avatarSrc} src={avatarSrc} alt="" width={96} height={96} sizes="96px" unoptimized />
            ) : (
              <UserRound size={42} />
            )}
          </div>
          <div>
            <h3>{user.name || "Learner"}</h3>
            <p>{user.email || "user@example.com"}</p>
            <div className="bubble-profile-photo-actions">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="bubble-profile-photo-input"
                onChange={(event) => void handlePhotoChange(event)}
              />
              <button
                type="button"
                disabled={photoSaving}
                onClick={() => photoInputRef.current?.click()}
                className="bubble-profile-photo-button"
              >
                <Camera size={16} />
                <span>{photoSaving ? t("Saving...") : t("Change photo")}</span>
              </button>
              {user.profileImageHash ? (
                <button
                  type="button"
                  disabled={photoSaving}
                  onClick={() => void resetPhoto()}
                  className="bubble-profile-photo-button is-muted"
                >
                  <Trash2 size={15} />
                  <span>{t("Use Google photo")}</span>
                </button>
              ) : null}
            </div>
            {photoError ? <span className="bubble-profile-details-error">{photoError}</span> : null}
            {photoMessage ? <span className="bubble-profile-details-success">{photoMessage}</span> : null}
          </div>
        </section>

        <section className="bubble-profile-section">
          <div className="bubble-profile-section-head">
            <span>{t("Profile details")}</span>
            <h3>{t("Your app identity")}</h3>
          </div>
          <form className="bubble-profile-details-form" onSubmit={submitProfileDetails}>
            <label>
              <span>{t("Display name")}</span>
              <input
                type="text"
                value={name}
                maxLength={120}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <span>{t("Date of birth")}</span>
              <input
                type="date"
                value={dateOfBirth}
                max={today}
                onChange={(event) => setDateOfBirth(event.target.value)}
              />
            </label>
            <div className="bubble-profile-details-language">
              <span>{t("Preferred Language")}</span>
              <LanguagePicker
                currentLanguage={preferredLanguage}
                recommendedLanguage={preferredLanguage}
                disabled={detailsSaving || languageSaving}
                buttonLabel={t("Preferred Language")}
                title={t("Choose your learning language")}
                description={t("All app text and tutoring replies follow this setting.")}
                closeLabel={t("Close")}
                quickChoicesLabel={t("Preferred Language")}
                onSelect={setPreferredLanguage}
                className="bubble-profile-language-picker"
              />
            </div>
            {detailsError ? <span className="bubble-profile-details-error">{detailsError}</span> : null}
            {detailsMessage ? <span className="bubble-profile-details-success">{detailsMessage}</span> : null}
            <button type="submit" disabled={detailsSaving || languageSaving} className="bubble-profile-save-button">
              {detailsSaving || languageSaving ? t("Saving...") : t("Save profile")}
            </button>
          </form>
        </section>

        <section className="bubble-profile-section">
          <div className="bubble-profile-section-head">
            <span>{t("Overview")}</span>
            <h3>{t("Your learning snapshot")}</h3>
          </div>
          <div className="bubble-profile-stats-grid">
            <ProfileStat
              label={t("Age")}
              value={typeof user.age === "number" ? String(user.age) : t("Add your date of birth")}
            />
            <ProfileStat label={t("Learning score")} value={String(user.score ?? 0)} />
            <ProfileStat label={t("inspir'ed since")} value={formatBubbleDate(user.createdAt)} />
          </div>
        </section>

        <section className="bubble-profile-section">
          <div className="bubble-profile-section-head">
            <span>{t("Memory")}</span>
            <h3>{t("What inspir can remember")}</h3>
          </div>
          <MemoryPanel
            dashboard={memoryDashboard}
            loading={memoryLoading}
            saving={memorySaving}
            error={memoryError}
            onSettings={onMemorySettings}
            onCreate={onMemoryCreate}
            onUpdate={onMemoryUpdate}
            onDelete={onMemoryDelete}
            onClear={onMemoryClear}
            t={t}
          />
        </section>

        <section className="bubble-profile-section bubble-profile-account-section">
          <div className="bubble-profile-section-head">
            <span>{t("Account and privacy")}</span>
            <h3>{t("Control what stays with you")}</h3>
          </div>
          <p>
            {t(
              "Your saved chats, language preference, date of birth, and learning memory are used to make the app more useful for you.",
            )}
          </p>
          <div className="bubble-profile-account-list">
            <div className="bubble-profile-account-row">
              <span>{t("Google email")}</span>
              <strong>{user.email || "Not connected"}</strong>
            </div>
          </div>
          <div className="bubble-profile-account-actions">
            <Link href="/terms">{t("Terms")}</Link>
            <Link href="/privacy">{t("Privacy")}</Link>
            <button type="button" onClick={() => void signOutToHome()} className="bubble-profile-logout">
              {t("Logout")}
            </button>
          </div>
          <SocialLinks compact className="bubble-profile-social" />
        </section>
      </div>
    </main>
  );
}

async function signOutToHome() {
  try {
    const csrfResponse = await fetch("/api/auth/csrf");
    const csrf = (await csrfResponse.json().catch(() => null)) as { csrfToken?: string } | null;
    const body = new URLSearchParams({
      callbackUrl: "/",
      json: "true",
    });
    if (csrf?.csrfToken) body.set("csrfToken", csrf.csrfToken);
    await fetch("/api/auth/signout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } finally {
    window.location.assign("/");
  }
}

function getMessageMemorySources(message: Message): MessageMemorySource[] {
  const sources = message.metadata?.memorySources;
  if (!Array.isArray(sources)) return [];
  const parsed: MessageMemorySource[] = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const record = source as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.label !== "string" || typeof record.excerpt !== "string") {
      continue;
    }
    const type =
      record.type === "memory" || record.type === "summary" || record.type === "past_chat"
        ? record.type
        : "memory";
    parsed.push({
      type,
      id: record.id,
      label: record.label,
      excerpt: record.excerpt,
      reason: typeof record.reason === "string" ? record.reason : undefined,
      memoryId: typeof record.memoryId === "string" ? record.memoryId : undefined,
      chatTurnId: typeof record.chatTurnId === "string" ? record.chatTurnId : undefined,
      summarySectionId: typeof record.summarySectionId === "string" ? record.summarySectionId : undefined,
    });
  }
  return parsed;
}

function findAiRunIdForMessage(messages: Message[], messageId: string) {
  const message = messages.find((item) => item.id === messageId);
  const aiRunId = message?.metadata?.aiRunId;
  return typeof aiRunId === "string" ? aiRunId : undefined;
}

function MemoryPanel({
  dashboard,
  loading,
  saving,
  error,
  onSettings,
  onCreate,
  onUpdate,
  onDelete,
  onClear,
  t,
}: {
  dashboard: MemoryDashboard | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onSettings: (input: {
    enabled?: boolean;
    savedMemoryEnabled?: boolean;
    chatHistoryEnabled?: boolean;
    dreamingEnabled?: boolean;
    noticeSeen?: boolean;
    refreshSummary?: boolean;
    correction?: string;
  }) => void;
  onCreate: (input: { content: string; category?: string }) => void;
  onUpdate: (
    memoryId: string,
    input: { content?: string; category?: string; tags?: string[]; pinned?: boolean; doNotMention?: boolean },
  ) => void;
  onDelete: (memoryId: string) => void;
  onClear: () => void;
  t: UiTranslator;
}) {
  const settings = dashboard?.settings;
  const enabled = settings?.enabled ?? true;
  const savedMemoryEnabled = settings?.savedMemoryEnabled ?? true;
  const chatHistoryEnabled = settings?.chatHistoryEnabled ?? true;
  const dreamingEnabled = settings?.dreamingEnabled ?? true;
  const grouped = useMemo(() => groupMemoriesByCategory(dashboard?.memories ?? []), [dashboard?.memories]);
  const memoryControlsDisabled = saving || !enabled || !savedMemoryEnabled;
  const [adding, setAdding] = useState(false);
  const [newMemory, setNewMemory] = useState("");
  const [newCategory, setNewCategory] = useState("preferences");
  const [correction, setCorrection] = useState("");

  function addMemory() {
    const content = newMemory.trim();
    if (!content) return;
    onCreate({ content, category: newCategory });
    setNewMemory("");
    setNewCategory("preferences");
    setAdding(false);
  }

  function saveCorrection() {
    const content = correction.trim();
    if (!content) return;
    onSettings({ correction: content });
    setCorrection("");
  }

  async function muteSummarySection(section: MemorySummarySection) {
    await fetch("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summarySectionId: section.id,
        action: "dont_mention",
      }),
    }).catch(() => undefined);
    onSettings({ refreshSummary: true });
  }

  return (
    <section className="bubble-memory-card">
      <div className="bubble-memory-head">
        <div className="bubble-profile-line-icon">
          <BrainCircuit size={22} />
        </div>
        <div>
          <strong>{t("Memory")}</strong>
          <span>{enabled ? t("On for this account") : t("Off for this account")}</span>
        </div>
      </div>

      <div className="bubble-memory-status-row bubble-memory-master-row">
        <div>
          <strong>{enabled ? t("Memory is on") : t("Memory is off")}</strong>
          <span>{enabled ? t("Used only when it helps.") : t("Nothing is saved or used.")}</span>
        </div>
        <button
          type="button"
          className={`bubble-memory-toggle ${enabled ? "is-on" : ""}`}
          aria-label={enabled ? t("Off") : t("On")}
          aria-pressed={enabled}
          disabled={saving || loading}
          onClick={() => onSettings({ enabled: !enabled })}
        >
          <span className="bubble-memory-toggle-track">
            <span className="bubble-memory-toggle-thumb" />
          </span>
          <strong>{enabled ? t("On") : t("Off")}</strong>
        </button>
      </div>

      {enabled ? (
        <div className="bubble-memory-setting-list">
          <MemoryMiniToggle
            label={t("Saved memory")}
            checked={savedMemoryEnabled}
            disabled={saving || loading}
            onChange={(checked) => onSettings({ savedMemoryEnabled: checked })}
          />
          <MemoryMiniToggle
            label={t("Past chats")}
            checked={chatHistoryEnabled}
            disabled={saving || loading || !savedMemoryEnabled}
            onChange={(checked) => onSettings({ chatHistoryEnabled: checked })}
          />
          <MemoryMiniToggle
            label={t("Synthesis")}
            checked={dreamingEnabled}
            disabled={saving || loading || !savedMemoryEnabled}
            onChange={(checked) => onSettings({ dreamingEnabled: checked })}
          />
        </div>
      ) : null}

      {loading ? <p className="bubble-memory-muted">{t("Loading memory...")}</p> : null}
      {error ? <p className="bubble-memory-error">{error}</p> : null}

      {settings && !settings.noticeSeenAt ? (
        <div className="bubble-memory-notice">
          <strong>{t("Memory is on for signed-in accounts.")}</strong>
          <p>
            {t(
              "Everything Inspir remembers is shown below as editable memory cards. You can add, edit, delete, or clear them anytime.",
            )}
          </p>
          <button type="button" disabled={saving} onClick={() => onSettings({ noticeSeen: true })}>
            {t("Got it")}
          </button>
        </div>
      ) : null}

      {dashboard ? (
        <>
          <MemorySummaryCard
            summary={dashboard.summary}
            saving={memoryControlsDisabled}
            correction={correction}
            onCorrection={setCorrection}
            onSaveCorrection={saveCorrection}
            onRefresh={() => onSettings({ refreshSummary: true })}
            onMuteSection={(section) => void muteSummarySection(section)}
            t={t}
          />

          <div className="bubble-memory-summary">
            <span>
              {dashboard.memories.length}{" "}
              {dashboard.memories.length === 1 ? t("saved memory") : t("saved memories")}
            </span>
            <div className="bubble-memory-summary-actions">
              <button type="button" disabled={memoryControlsDisabled} onClick={() => setAdding((current) => !current)}>
                <Plus size={15} />
                <span>{t("Add")}</span>
              </button>
              <button type="button" disabled={saving || dashboard.memories.length === 0} onClick={onClear}>
                {t("Clear all")}
              </button>
            </div>
          </div>

          {adding ? (
            <div className="bubble-memory-add">
              <textarea
                aria-label={t("Add")}
                value={newMemory}
                onChange={(event) => setNewMemory(event.target.value)}
                placeholder={t("Correct or add what Inspir should remember.")}
                rows={3}
                maxLength={600}
                disabled={memoryControlsDisabled}
              />
              <div className="bubble-memory-add-actions">
                <select
                  aria-label={t("Memory category")}
                  value={newCategory}
                  disabled={memoryControlsDisabled}
                  onChange={(event) => setNewCategory(event.target.value)}
                >
                  {memoryCategoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={memoryControlsDisabled || !newMemory.trim()} onClick={addMemory}>
                  {t("Save")}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setAdding(false);
                    setNewMemory("");
                    setNewCategory("preferences");
                  }}
                >
                  {t("Cancel")}
                </button>
              </div>
            </div>
          ) : null}

          <div className="bubble-memory-list">
            {dashboard.memories.length === 0 ? (
              <p className="bubble-memory-muted">{t("No saved memories yet.")}</p>
            ) : (
              grouped.map((group) => (
                <div key={group.category} className="bubble-memory-group">
                  <h4>{translatedMemoryCategoryLabel(group.category, t)}</h4>
                  {group.memories.map((memory) => (
                    <MemoryItemEditor
                      key={memory.id}
                      memory={memory}
                      saving={saving}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      t={t}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function MemoryMiniToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`bubble-memory-mini-toggle ${checked ? "is-on" : ""}`}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className="bubble-memory-mini-switch" />
    </button>
  );
}

function MemorySummaryCard({
  summary,
  saving,
  correction,
  onCorrection,
  onSaveCorrection,
  onRefresh,
  onMuteSection,
  t,
}: {
  summary: MemorySummary | null;
  saving: boolean;
  correction: string;
  onCorrection: (value: string) => void;
  onSaveCorrection: () => void;
  onRefresh: () => void;
  onMuteSection: (section: MemorySummarySection) => void;
  t: UiTranslator;
}) {
  const sections = summary?.sections?.filter((section) => !section.doNotMention) ?? [];
  return (
    <div className="bubble-memory-summary-card">
      <div className="bubble-memory-summary-card-head">
        <div>
          <strong>{t("Memory summary")}</strong>
          <span>
            {summary?.lastSynthesizedAt
              ? formatBubbleDate(summary.lastSynthesizedAt)
              : t("No summary yet")}
          </span>
        </div>
        <button type="button" disabled={saving} onClick={onRefresh} aria-label={t("Memory summary")}>
          <RefreshCw size={15} />
        </button>
      </div>

      {sections.length ? (
        <div className="bubble-memory-summary-sections">
          {sections.map((section) => (
            <article key={section.id} className="bubble-memory-summary-section">
              <div>
                <strong>{section.title || translatedMemoryCategoryLabel(section.category, t)}</strong>
                <p>{section.summary}</p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => onMuteSection(section)}
                aria-label={t("Off")}
              >
                <XCircle size={15} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="bubble-memory-muted">{t("No summary yet")}</p>
      )}

      <div className="bubble-memory-correction">
        <textarea
          aria-label={t("Correct or add what Inspir should remember.")}
          value={correction}
          onChange={(event) => onCorrection(event.target.value)}
          placeholder={t("Correct or add what Inspir should remember.")}
          rows={2}
          maxLength={800}
          disabled={saving}
        />
        <button type="button" disabled={saving || !correction.trim()} onClick={onSaveCorrection}>
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

function MemoryItemEditor({
  memory,
  saving,
  onUpdate,
  onDelete,
  t,
}: {
  memory: MemoryItem;
  saving: boolean;
  onUpdate: (
    memoryId: string,
    input: { content?: string; category?: string; tags?: string[]; pinned?: boolean; doNotMention?: boolean },
  ) => void;
  onDelete: (memoryId: string) => void;
  t: UiTranslator;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftCategory, setDraftCategory] = useState(memory.category || "general");

  function save() {
    const next = draft.trim();
    const categoryChanged = draftCategory !== memory.category;
    const contentChanged = next && next !== memory.content && next !== memory.displayContent;
    if (!contentChanged && !categoryChanged) {
      setEditing(false);
      setDraft(editableMemoryText(memory));
      setDraftCategory(memory.category || "general");
      return;
    }
    onUpdate(memory.id, {
      ...(contentChanged ? { content: next } : {}),
      ...(categoryChanged ? { category: draftCategory } : {}),
    });
    setEditing(false);
  }

  return (
    <article className="bubble-memory-item">
      {editing ? (
        <>
          <textarea
            aria-label={t("Saved memory")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="bubble-memory-edit"
            rows={3}
            maxLength={600}
          />
          <select
            aria-label={t("Memory category")}
            value={draftCategory}
            disabled={saving}
            className="bubble-memory-edit-category"
            onChange={(event) => setDraftCategory(event.target.value)}
          >
            {memoryCategoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className={memory.doNotMention ? "is-muted-memory" : undefined}>{memory.displayContent ?? memory.content}</p>
      )}
      <div className="bubble-memory-item-meta">
        <span>{memory.sourceLabel ? t(memory.sourceLabel) : memory.kind === "explicit" ? t("Saved memory") : t("Past chats")}</span>
        {memory.doNotMention ? <span>{t("Off")}</span> : null}
      </div>
      <div className="bubble-memory-actions">
        {editing ? (
          <>
            <button type="button" disabled={saving} onClick={save} aria-label={t("Save")}>
              <CheckCircle2 size={16} />
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setDraft(editableMemoryText(memory));
                setDraftCategory(memory.category || "general");
              }}
              aria-label={t("Cancel")}
            >
              <XCircle size={16} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(editableMemoryText(memory));
                setDraftCategory(memory.category || "general");
                setEditing(true);
              }}
              aria-label={t("Saved memory")}
            >
              <PencilLine size={16} />
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onUpdate(memory.id, { doNotMention: !memory.doNotMention })}
              aria-label={memory.doNotMention ? t("On") : t("Off")}
            >
              {memory.doNotMention ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <button type="button" disabled={saving} onClick={() => onDelete(memory.id)} aria-label={t("Clear all")}>
              <XCircle size={16} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

const memoryCategoryOptions = [
  { value: "preferences", label: "Preferences" },
  { value: "learning_style", label: "Learning style" },
  { value: "projects", label: "Projects" },
  { value: "goals", label: "Goals" },
  { value: "knowledge", label: "Knowledge" },
  { value: "constraints", label: "Constraints" },
  { value: "interaction", label: "Interaction" },
  { value: "identity", label: "Identity" },
  { value: "general", label: "General" },
];

function editableMemoryText(memory: MemoryItem) {
  return memory.displayContent ?? memory.content;
}

function groupMemoriesByCategory(memories: MemoryItem[]) {
  const map = new Map<string, MemoryItem[]>();
  for (const memory of memories) {
    const key = memory.category || "general";
    map.set(key, [...(map.get(key) ?? []), memory]);
  }
  return Array.from(map.entries())
    .toSorted(([a], [b]) => memoryCategoryLabel(a).localeCompare(memoryCategoryLabel(b)))
    .map(([category, items]) => ({ category, memories: items }));
}

function memoryCategoryLabel(category: string) {
  return category
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function translatedMemoryCategoryLabel(category: string, t: UiTranslator) {
  return t(memoryCategoryLabel(category));
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bubble-profile-stat">
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}
