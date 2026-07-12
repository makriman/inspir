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
import { trackProductEvent } from "@/components/analytics/trackProductEvent";
import type { ActivityRun } from "@/components/chat/activity-model";
import { ChatMainSection } from "@/components/chat/ChatMainSection";
import { ChatPanelOverlays } from "@/components/chat/ChatPanelOverlays";
import { CompactTranscriptDetails } from "@/components/chat/CompactTranscriptDetails";
import {
  getDefaultSidebarTopicIds,
  type LearningStoreTopic,
} from "@/components/chat/learning-store-utils";
import { LearningStore } from "@/components/chat/LearningStore";
import {
  clearPendingAssistantMetadata,
  getMessageContentNextOffset,
  type ChatMessage as Message,
  type MessageMemorySource,
} from "@/components/chat/chat-message-model";
import {
  appendBoundedAssistantText,
  createBrowserChatFinalizationOutbox,
  createPendingChatFinalization,
  emptyBoundedAssistantText,
  postPendingChatFinalization,
  reconcilePendingChatFinalizationMessages,
  retryPendingChatFinalizations,
  type ChatFinalizationOutbox,
  type PendingChatFinalization,
} from "@/components/chat/chat-finalization-outbox";
import { FlashcardWorkspace } from "@/components/chat/FlashcardWorkspace";
import { GuidedMiniAppWorkspace } from "@/components/chat/GuidedMiniAppWorkspace";
import { GuestFeatureGate } from "@/components/chat/GuestFeatureGate";
import { parseOpenAiSseText } from "@/components/chat/openai-sse";
import {
  type MemoryCreateInput,
  type MemoryDashboard,
  type MemoryItem,
  type MemorySettings,
  type MemorySettingsPatch,
  type MemoryUpdateInput,
} from "@/components/chat/memory-model";
import { displayMessages } from "@/components/chat/message-display";
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
import { setClientLanguagePreferenceCookie } from "@/components/i18n/client-language-preference";
import { defaultLanguage } from "@/lib/content/languages";
import { topicWorkspacePath } from "@/lib/content/topic-path";
import { parseSupportedChatLanguage } from "@/lib/i18n/chat-locale-reconciliation";
import { localeCookieName, localizeHref } from "@/lib/i18n/routing";
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
const ProfilePanel = dynamic(() =>
  import("@/components/chat/ProfilePanel").then((mod) => mod.ProfilePanel),
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
  messagePage?: ChatMessagePage;
  topic?: { id?: string | null } | null;
  activityRun?: ActivityRun | null;
};

type ChatMessagePage = {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
};

type MessageContentChunk = {
  content: string;
  hasMore: boolean;
  nextOffset: number | null;
};

type RecentChatsResponse = {
  chats?: RecentChat[];
};

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseChatMessagePage(value: unknown): ChatMessagePage | null {
  if (
    !isJsonRecord(value) ||
    typeof value.hasMore !== "boolean" ||
    (typeof value.nextCursor !== "string" && value.nextCursor !== null) ||
    typeof value.limit !== "number" ||
    !Number.isInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > 100
  ) {
    return null;
  }
  return { hasMore: value.hasMore, nextCursor: value.nextCursor, limit: value.limit };
}

function parseChatMessage(value: unknown): Message | null {
  if (
    !isJsonRecord(value) ||
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant" && value.role !== "system") ||
    typeof value.content !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    metadata: isJsonRecord(value.metadata) ? value.metadata : undefined,
  };
}

function parseChatHistoryPage(
  value: unknown,
  expectedChatId: string,
): { messages: Message[]; messagePage: ChatMessagePage } | null {
  if (
    !isJsonRecord(value) ||
    !isJsonRecord(value.chat) ||
    value.chat.id !== expectedChatId ||
    !Array.isArray(value.messages)
  ) {
    return null;
  }
  const messages = value.messages.map(parseChatMessage);
  const messagePage = parseChatMessagePage(value.messagePage);
  if (messages.some((message) => message === null) || !messagePage) return null;
  return {
    messages: messages.filter((message): message is Message => message !== null),
    messagePage,
  };
}

function parseActivityRun(value: unknown): ActivityRun | null {
  if (
    !isJsonRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.chatId !== "string" ||
    typeof value.type !== "string" ||
    typeof value.status !== "string" ||
    !isJsonRecord(value.state) ||
    (typeof value.score !== "number" && value.score !== null) ||
    (typeof value.maxScore !== "number" && value.maxScore !== null) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    (typeof value.completedAt !== "string" && value.completedAt !== null)
  ) {
    return null;
  }
  return {
    id: value.id,
    chatId: value.chatId,
    type: value.type,
    status: value.status,
    state: value.state,
    score: value.score,
    maxScore: value.maxScore,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
  };
}

function parseChatLoadResponse(value: unknown, expectedChatId: string): ChatLoadResponse | null {
  const history = parseChatHistoryPage(value, expectedChatId);
  if (!history || !isJsonRecord(value)) return null;

  let topic: ChatLoadResponse["topic"] = null;
  if (value.topic !== undefined && value.topic !== null) {
    if (
      !isJsonRecord(value.topic) ||
      (value.topic.id !== undefined && typeof value.topic.id !== "string" && value.topic.id !== null)
    ) {
      return null;
    }
    topic = { id: value.topic.id };
  }

  const activityRun = value.activityRun === undefined || value.activityRun === null
    ? null
    : parseActivityRun(value.activityRun);
  if (value.activityRun !== undefined && value.activityRun !== null && !activityRun) return null;

  return {
    chat: { id: expectedChatId },
    messages: history.messages,
    messagePage: history.messagePage,
    topic,
    activityRun,
  };
}

async function readActiveChatLoadResponse(
  response: Response,
  expectedChatId: string,
  isActive: () => boolean,
) {
  const value: unknown = await response.json();
  return isActive() ? parseChatLoadResponse(value, expectedChatId) : null;
}

function parseMessageContentChunk(
  value: unknown,
  expectedChatId: string,
  expectedMessageId: string,
  expectedOffset: number,
): MessageContentChunk | null {
  if (
    !isJsonRecord(value) ||
    value.chatId !== expectedChatId ||
    value.messageId !== expectedMessageId ||
    value.offset !== expectedOffset ||
    typeof value.content !== "string" ||
    typeof value.hasMore !== "boolean"
  ) {
    return null;
  }
  const characters = boundedUnicodeLength(value.content, 8_000);
  if (characters === null) return null;
  if (value.hasMore) {
    if (
      characters < 1 ||
      typeof value.nextOffset !== "number" ||
      !Number.isSafeInteger(value.nextOffset) ||
      value.nextOffset !== expectedOffset + characters
    ) {
      return null;
    }
    return { content: value.content, hasMore: true, nextOffset: value.nextOffset };
  }
  return value.nextOffset === null
    ? { content: value.content, hasMore: false, nextOffset: null }
    : null;
}

function boundedUnicodeLength(value: string, limit: number) {
  let characters = 0;
  for (const character of value) {
    characters += character.length > 0 ? 1 : 0;
    if (characters > limit) return null;
  }
  return characters;
}

function isMemorySettings(value: unknown): value is MemorySettings {
  return (
    isJsonRecord(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.savedMemoryEnabled === "boolean" &&
    typeof value.chatHistoryEnabled === "boolean" &&
    typeof value.dreamingEnabled === "boolean" &&
    typeof value.captureScope === "string" &&
    typeof value.retrievalMode === "string" &&
    (typeof value.noticeSeenAt === "string" || value.noticeSeenAt === null)
  );
}

function isMemoryItem(value: unknown): value is MemoryItem {
  return (
    isJsonRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.category === "string" &&
    typeof value.content === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.confidence === "number" &&
    typeof value.salience === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isMemoryDashboard(value: unknown): value is MemoryDashboard {
  if (
    !isJsonRecord(value) ||
    !isMemorySettings(value.settings) ||
    !Array.isArray(value.memories) ||
    !value.memories.every(isMemoryItem) ||
    !Array.isArray(value.profiles) ||
    !value.profiles.every(isMemoryProfile) ||
    !(value.summary === null || isMemorySummary(value.summary))
  ) {
    return false;
  }
  return value.memoryPage === undefined || isMemoryPage(value.memoryPage);
}

function isMemoryProfile(value: unknown) {
  return (
    isJsonRecord(value) &&
    typeof value.category === "string" &&
    typeof value.summary === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isMemorySummary(value: unknown) {
  return (
    isJsonRecord(value) &&
    typeof value.summary === "string" &&
    Array.isArray(value.sections) &&
    value.sections.every(isMemorySummarySection) &&
    typeof value.lastSynthesizedAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isMemorySummarySection(value: unknown) {
  return (
    isJsonRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.category === "string" &&
    typeof value.summary === "string" &&
    (value.sourceMemoryIds === undefined ||
      (Array.isArray(value.sourceMemoryIds) && value.sourceMemoryIds.every((id) => typeof id === "string"))) &&
    (value.sourceTurnIds === undefined ||
      (Array.isArray(value.sourceTurnIds) && value.sourceTurnIds.every((id) => typeof id === "string"))) &&
    (value.doNotMention === undefined || typeof value.doNotMention === "boolean")
  );
}

function isMemoryPage(value: unknown) {
  return (
    isJsonRecord(value) &&
    typeof value.hasMore === "boolean" &&
    (typeof value.nextCursor === "string" || value.nextCursor === null) &&
    typeof value.limit === "number" &&
    Number.isInteger(value.limit) &&
    value.limit >= 1 &&
    value.limit <= 100
  );
}

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

function pendingChatFinalizationFromResponse(
  response: Response,
  input: {
    accountId: string;
    chatId: string;
    temporaryMessageId: string;
    content: string;
  },
) {
  return createPendingChatFinalization({
    ...input,
    aiRunId: response.headers.get("x-inspir-ai-run-id")?.trim() ?? "",
    userMessageId: response.headers.get("x-inspir-user-message-id")?.trim() ?? "",
  });
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
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest("[data-no-auto-translate], code, pre, script, style"));
}

type AppliedTranslation = {
  source: string;
  applied: string;
};

type AutoTranslationState = {
  textNodes: WeakMap<Text, AppliedTranslation>;
  attributes: WeakMap<Element, Map<string, AppliedTranslation>>;
};

function createAutoTranslationState(): AutoTranslationState {
  return {
    textNodes: new WeakMap(),
    attributes: new WeakMap(),
  };
}

function sourceBeforeAutoTranslation(currentValue: string, previous: AppliedTranslation | undefined) {
  return previous?.applied === currentValue ? previous.source : currentValue;
}

function translateTextNode(node: Text, textMap: Map<string, string>, state: AutoTranslationState) {
  if (shouldSkipTranslation(node)) return;
  const source = sourceBeforeAutoTranslation(node.data, state.textNodes.get(node));
  const translated = translateRawText(source, textMap);
  state.textNodes.set(node, { source, applied: translated });
  if (translated !== node.data) node.data = translated;
}

function translateElementAttribute(
  element: Element,
  attribute: string,
  textMap: Map<string, string>,
  state: AutoTranslationState,
) {
  if (shouldSkipTranslation(element)) return;
  const currentValue = element.getAttribute(attribute);
  if (!currentValue) return;

  let attributeState = state.attributes.get(element);
  if (!attributeState) {
    attributeState = new Map();
    state.attributes.set(element, attributeState);
  }
  const source = sourceBeforeAutoTranslation(currentValue, attributeState.get(attribute));
  const translated = translateRawText(source, textMap);
  attributeState.set(attribute, { source, applied: translated });
  if (translated !== currentValue) element.setAttribute(attribute, translated);
}

function translateNodeTree(node: Node, textMap: Map<string, string>, state: AutoTranslationState) {
  if (shouldSkipTranslation(node)) return;
  if (node instanceof Text) {
    translateTextNode(node, textMap, state);
    return;
  }
  if (node instanceof Element) {
    for (const attribute of translatableAttributes) {
      translateElementAttribute(node, attribute, textMap, state);
    }
  }
  for (const child of Array.from(node.childNodes)) {
    translateNodeTree(child, textMap, state);
  }
}

function useAutoTranslate(
  ref: MutableRefObject<HTMLElement | null>,
  textMap: Map<string, string>,
) {
  const [translationState] = useState(createAutoTranslationState);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    translateNodeTree(root, textMap, translationState);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (shouldSkipTranslation(mutation.target)) continue;
        if (mutation.type === "childList") {
          for (const addedNode of Array.from(mutation.addedNodes)) {
            translateNodeTree(addedNode, textMap, translationState);
          }
          continue;
        }
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          translateTextNode(mutation.target, textMap, translationState);
          continue;
        }
        if (
          mutation.type === "attributes" &&
          mutation.attributeName &&
          mutation.target instanceof Element
        ) {
          translateElementAttribute(mutation.target, mutation.attributeName, textMap, translationState);
        }
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatableAttributes,
    });
    return () => observer.disconnect();
  }, [ref, textMap, translationState]);
}

function resolveSetState<Value>(nextValue: SetStateAction<Value>, currentValue: Value) {
  if (typeof nextValue === "function") return (nextValue as (value: Value) => Value)(currentValue);
  return nextValue;
}

type ChatClientState = {
  activeTopicId: string;
  activeChatId: string | undefined;
  messages: Message[];
  messagePage: ChatMessagePage | null;
  olderMessagesLoading: boolean;
  messageContentLoadingIds: string[];
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
  authMode: "authenticated" | "guest";
  user: UserProfile;
  topics: Topic[];
  initialTopicId: string;
  initialChatId?: string;
  initialMessages: Message[];
  initialMessagePage?: ChatMessagePage | null;
  initialActivityRun: ActivityRun | null;
  initialTranslationBundle: MainAppTranslationBundle;
  guestMessageLimit?: number;
};

export function ChatClient(props: ChatClientProps) {
  return <ChatClientLayout {...useChatClientController(props)} />;
}

type ChatClientController = ReturnType<typeof useChatClientController>;

function useChatClientController({
  authMode,
  user,
  topics,
  initialTopicId,
  initialChatId,
  initialMessages,
  initialMessagePage = null,
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
      messagePage,
      olderMessagesLoading,
      messageContentLoadingIds,
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
    messagePage: initialMessagePage,
    olderMessagesLoading: false,
    messageContentLoadingIds: [],
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
  const setMessagePage = (value: SetStateAction<ChatClientState["messagePage"]>) =>
    updateChatField("messagePage", value);
  const setOlderMessagesLoading = (value: SetStateAction<ChatClientState["olderMessagesLoading"]>) =>
    updateChatField("olderMessagesLoading", value);
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
  const historyRequestSeqRef = useRef(0);
  const messageContentAbortControllersRef = useRef<Map<string, AbortController> | null>(null);
  if (messageContentAbortControllersRef.current === null) {
    messageContentAbortControllersRef.current = new Map<string, AbortController>();
  }
  const messageContentAbortControllers = messageContentAbortControllersRef.current;
  const finalizationOutboxRef = useRef<ChatFinalizationOutbox | null>(null);
  const finalizationDrainRef = useRef<Promise<void> | null>(null);
  const chatClientMountedRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldAutoFollowMessagesRef = useRef(true);
  const forceAutoFollowMessagesRef = useRef(false);
  const historyPrependScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const sidebarHydratedRef = useRef(false);
  const activeChatIdRef = useRef(activeChatId);
  activeChatIdRef.current = activeChatId;
  const [sidebarPersonalizationReady, setSidebarPersonalizationReady] = useState(false);
  const messageContentLoadingSet = useMemo(
    () => new Set(messageContentLoadingIds),
    [messageContentLoadingIds],
  );
  const translationTextMap = useMemo(
    () => buildTranslationTextMap(initialTranslationBundle),
    [initialTranslationBundle],
  );
  const translateUi = useCallback((source: string) => translateRawText(source, translationTextMap), [translationTextMap]);
  const displayTopics = useMemo(
    () => topics.map((topic) => translateTopic(topic, translationTextMap)),
    [topics, translationTextMap],
  );
  const learningTools = usePersistentLearningTools();
  useAutoTranslate(translationRootRef, translationTextMap);

  const getFinalizationOutbox = useCallback(() => {
    if (isGuest || typeof window === "undefined" || !window.indexedDB) return null;
    finalizationOutboxRef.current ??= createBrowserChatFinalizationOutbox(window.indexedDB);
    return finalizationOutboxRef.current;
  }, [isGuest]);

  const reconcileFinalizedAssistant = useCallback(
    (pending: PendingChatFinalization, persistedAssistantMessageId: string) => {
      if (!chatClientMountedRef.current) return;
      updateChatState((current) => {
        const nextMessages = reconcilePendingChatFinalizationMessages({
          currentAccountId: current.profileUser.id,
          currentChatId: current.activeChatId,
          messages: current.messages,
          pending,
          persistedAssistantMessageId,
        });
        return nextMessages ? { messages: nextMessages } : {};
      });
    },
    [],
  );

  const drainFinalizationOutbox = useCallback(() => {
    const outbox = getFinalizationOutbox();
    if (!outbox) return Promise.resolve();
    if (finalizationDrainRef.current) return finalizationDrainRef.current;
    const drain = retryPendingChatFinalizations({
      outbox,
      accountId: user.id,
      force: true,
      post: postPendingChatFinalization,
      onSuccess: reconcileFinalizedAssistant,
    })
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn(
          "Pending chat finalization retry failed",
          error instanceof Error ? error.name : "UnknownError",
        );
      })
      .finally(() => {
        if (finalizationDrainRef.current === drain) finalizationDrainRef.current = null;
      });
    finalizationDrainRef.current = drain;
    return drain;
  }, [getFinalizationOutbox, reconcileFinalizedAssistant, user.id]);

  useEffect(() => {
    chatClientMountedRef.current = true;
    return () => {
      chatClientMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isGuest) return;
    const handleOnline = () => {
      void drainFinalizationOutbox();
    };
    void drainFinalizationOutbox();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [drainFinalizationOutbox, isGuest]);

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
      const page: unknown = await response.json();
      if (!isMemoryDashboard(page)) throw new Error("Memory response is invalid");
      updateChatState({ memoryDashboard: page });
    } catch {
      updateChatState({ memoryError: "Could not load memory right now." });
    } finally {
      updateChatState({ memoryLoading: false });
    }
  }, [isGuest]);

  const loadMoreMemories = useCallback(async () => {
    const cursor = memoryDashboard?.memoryPage?.nextCursor;
    if (isGuest || !cursor || memoryLoading || memorySaving) return;
    updateChatState({ memoryLoading: true, memoryError: null });
    try {
      const response = await fetch(`/api/memory?cursor=${encodeURIComponent(cursor)}`);
      if (!response.ok) throw new Error("Could not load more memory");
      const page: unknown = await response.json();
      if (!isMemoryDashboard(page)) throw new Error("Memory response is invalid");
      updateChatState((current) => {
        const currentDashboard = current.memoryDashboard;
        if (!currentDashboard) return {};
        const memories = new Map(currentDashboard.memories.map((memory) => [memory.id, memory]));
        for (const memory of page.memories) memories.set(memory.id, memory);
        return {
          memoryDashboard: {
            ...currentDashboard,
            memories: [...memories.values()],
            memoryPage: page.memoryPage,
          },
        };
      });
    } catch {
      // Keep the current page intact; the bounded load-more action remains retryable.
    } finally {
      updateChatState({ memoryLoading: false });
    }
  }, [isGuest, memoryDashboard, memoryLoading, memorySaving]);

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
    const controllers = messageContentAbortControllers;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, [messageContentAbortControllers]);

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
    const prependScroll = historyPrependScrollRef.current;
    const element = listRef.current;
    if (prependScroll && element) {
      element.scrollTop = prependScroll.scrollTop + (element.scrollHeight - prependScroll.scrollHeight);
      historyPrependScrollRef.current = null;
      return;
    }
    historyPrependScrollRef.current = null;
    scrollMessageViewportToEnd("auto");
  }, [activityRun, messages, streamingMessageId, scrollMessageViewportToEnd]);

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
      window.history.replaceState(
        null,
        "",
        localizeHref(`/chat/${data.chatId}`, currentLanguage),
      );
    }
    return data.chatId as string;
  }

  function cancelActiveRequest() {
    requestSeqRef.current += 1;
    historyRequestSeqRef.current += 1;
    historyPrependScrollRef.current = null;
    for (const controller of messageContentAbortControllers.values()) controller.abort();
    messageContentAbortControllers.clear();
    abortRef.current?.abort();
    abortRef.current = null;
    updateChatState({
      awaitingResponse: false,
      sending: false,
      streamingMessageId: null,
      olderMessagesLoading: false,
      messageContentLoadingIds: [],
    });
  }

  async function loadChat(chatId: string, options?: { preserveRequest?: boolean }) {
    if (isGuest) return;
    if (!options?.preserveRequest) cancelActiveRequest();
    const requestId = requestSeqRef.current;
    const response = await fetch(`/api/chats/${chatId}`);
    if (!response.ok || requestSeqRef.current !== requestId) return;
    const data = await readActiveChatLoadResponse(
      response,
      chatId,
      () => requestSeqRef.current === requestId,
    );
    if (!data) return;
    if (data.topic?.id) setActiveTopicId(data.topic.id);
    setActiveChatId(data.chat.id);
    setMessages(data.messages ?? []);
    setMessagePage(data.messagePage ?? null);
    setActivityRun(data.activityRun ?? null);
    setRecentOpen(false);
    setMobileSidebarOpen(false);
    window.history.replaceState(
      null,
      "",
      localizeHref(`/chat/${chatId}`, currentLanguage),
    );
  }

  async function resetChat() {
    cancelActiveRequest();
    setWorkspaceResetCount((current) => current + 1);
    if (isGuest) {
      setActiveChatId(undefined);
      setMessages([]);
      setMessagePage(null);
      setActivityRun(null);
      setInput("");
      setRecentOpen(false);
      window.history.replaceState(null, "", localizeHref(topicWorkspacePath(activeTopic.slug), currentLanguage));
      return;
    }
    const chatId = await createChat(activeTopicId);
    setMessages([]);
    setMessagePage(null);
    setActivityRun(null);
    setRecentOpen(false);
    window.history.replaceState(
      null,
      "",
      localizeHref(`/chat/${chatId}`, currentLanguage),
    );
  }

  async function loadOlderMessages() {
    const chatId = activeChatId;
    const cursor = messagePage?.nextCursor;
    if (isGuest || !chatId || !messagePage?.hasMore || !cursor || olderMessagesLoading) return;

    const requestId = historyRequestSeqRef.current + 1;
    historyRequestSeqRef.current = requestId;
    setOlderMessagesLoading(true);
    try {
      const response = await fetch(
        `/api/chats/${encodeURIComponent(chatId)}?messageCursor=${encodeURIComponent(cursor)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        },
      );
      if (!response.ok) throw new Error("Could not load past chats");
      const page = parseChatHistoryPage(await response.json(), chatId);
      if (!page) throw new Error("Past chat response is invalid");
      if (historyRequestSeqRef.current !== requestId || activeChatIdRef.current !== chatId) return;

      const element = listRef.current;
      historyPrependScrollRef.current = element
        ? { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }
        : null;
      shouldAutoFollowMessagesRef.current = false;
      forceAutoFollowMessagesRef.current = false;
      updateChatState((current) => {
        if (current.activeChatId !== chatId) return {};
        const existingIds = new Set(current.messages.map((message) => message.id));
        const olderMessages = page.messages.filter((message) => !existingIds.has(message.id));
        return {
          messages: [...olderMessages, ...current.messages],
          messagePage: page.messagePage,
        };
      });
    } catch {
      historyPrependScrollRef.current = null;
    } finally {
      if (historyRequestSeqRef.current === requestId) setOlderMessagesLoading(false);
    }
  }

  async function loadMoreMessageContent(messageId: string) {
    const chatId = activeChatId;
    const message = messages.find((candidate) => candidate.id === messageId);
    const offset = message ? getMessageContentNextOffset(message) : null;
    const controllers = messageContentAbortControllers;
    if (
      isGuest ||
      !chatId ||
      offset === null ||
      controllers.has(messageId) ||
      controllers.size >= 4
    ) {
      return;
    }

    const controller = new AbortController();
    controllers.set(messageId, controller);
    updateChatState((current) => ({
      messageContentLoadingIds: current.messageContentLoadingIds.includes(messageId)
        ? current.messageContentLoadingIds
        : [...current.messageContentLoadingIds, messageId],
    }));

    try {
      const response = await fetch(
        `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}?offset=${offset}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json" },
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("Message content is unavailable");
      const chunk = parseMessageContentChunk(
        await response.json(),
        chatId,
        messageId,
        offset,
      );
      if (!chunk) throw new Error("Message content response is invalid");
      if (controllers.get(messageId) !== controller || activeChatIdRef.current !== chatId) return;

      updateChatState((current) => {
        if (current.activeChatId !== chatId) return {};
        const currentMessage = current.messages.find((candidate) => candidate.id === messageId);
        if (!currentMessage || getMessageContentNextOffset(currentMessage) !== offset) return {};
        const metadata = { ...(currentMessage.metadata ?? {}) };
        delete metadata.contentNextOffset;
        delete metadata.contentTruncated;
        if (chunk.hasMore && chunk.nextOffset !== null) {
          metadata.contentTruncated = true;
          metadata.contentNextOffset = chunk.nextOffset;
        }
        return {
          messages: current.messages.map((candidate) =>
            candidate.id === messageId
              ? {
                  ...candidate,
                  content: `${candidate.content}${chunk.content}`,
                  metadata,
                }
              : candidate,
          ),
        };
      });
    } catch {
      // The existing Continue control remains available for a bounded retry.
    } finally {
      if (controllers.get(messageId) === controller) {
        controllers.delete(messageId);
        updateChatState((current) => ({
          messageContentLoadingIds: current.messageContentLoadingIds.filter((id) => id !== messageId),
        }));
      }
    }
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
        window.history.replaceState(
          null,
          "",
          localizeHref(`/chat/${chatId}`, currentLanguage),
        );
      }
      const response = await fetch(isGuest ? "/api/guest-chat" : "/api/chat", {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
        },
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
      trackProductEvent("chat_message_sent", {
        guest: isGuest,
        topic: activeTopic.slug,
      });
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
      const isOpenAiSse = response.headers.get("content-type")?.includes("text/event-stream") ?? false;
      let boundedAssistantText = emptyBoundedAssistantText();
      let assistantText = "";
      let sseBuffer = "";
      let assistantInserted = true;
      let assistantHasPaintedText = false;
      let assistantFlushTimeout: number | null = null;
      let assistantFlushFrame: number | null = null;

      function ensureCurrentStream() {
        if (isCurrentRequest()) return;
        void reader.cancel();
        throw new StaleChatRequestError();
      }

      function appendAssistantText(addition: string) {
        boundedAssistantText = appendBoundedAssistantText(boundedAssistantText, addition);
        assistantText = boundedAssistantText.text;
        return boundedAssistantText.reachedLimit;
      }

      function cancelCappedProviderStream() {
        void reader.cancel("assistant_response_limit_reached").catch(() => undefined);
        if (!controller.signal.aborted) controller.abort("assistant_response_limit_reached");
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

      function waitForFirstAssistantPaint() {
        return new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve());
          });
        });
      }

      function flushAssistantText({ final = false }: { final?: boolean } = {}) {
        cancelAssistantFlush();
        if (!assistantText && !final) return;
        const isFirstPaintedText = assistantText.length > 0 && !assistantHasPaintedText;
        if (assistantText.length > 0) assistantHasPaintedText = true;
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
        return isFirstPaintedText;
      }

      function scheduleAssistantFlush() {
        if (!assistantHasPaintedText) {
          return flushAssistantText();
        }
        if (assistantFlushTimeout !== null || assistantFlushFrame !== null) return;
        assistantFlushTimeout = window.setTimeout(() => {
          assistantFlushTimeout = null;
          assistantFlushFrame = window.requestAnimationFrame(() => {
            assistantFlushFrame = null;
            flushAssistantText();
          });
        }, 48);
        return false;
      }

      async function readAssistantStream(): Promise<void> {
        ensureCurrentStream();
        const { value, done } = await reader.read();
        ensureCurrentStream();
        if (done) {
          const finalDecoderText = decoder.decode();
          if (isOpenAiSse) {
            const parsed = parseOpenAiSseText(`${sseBuffer}${finalDecoderText}`, true);
            appendAssistantText(parsed.text);
            sseBuffer = parsed.remainder;
          } else if (finalDecoderText) {
            appendAssistantText(finalDecoderText);
          }
          if (!assistantText.trim()) throw new Error("Empty assistant response");
          flushAssistantText({ final: true });
          return;
        }
        const decoded = decoder.decode(value, { stream: true });
        if (isOpenAiSse) {
          const parsed = parseOpenAiSseText(`${sseBuffer}${decoded}`);
          appendAssistantText(parsed.text);
          sseBuffer = parsed.remainder;
        } else {
          appendAssistantText(decoded);
        }
        if (boundedAssistantText.reachedLimit) {
          cancelCappedProviderStream();
          if (!assistantText.trim()) throw new Error("Empty assistant response");
          flushAssistantText({ final: true });
          return;
        }
        const paintedFirstText = scheduleAssistantFlush();
        if (paintedFirstText) await waitForFirstAssistantPaint();
        return readAssistantStream();
      }

      await readAssistantStream();
      if (isCurrentRequest() && !isGuest && chatId) {
        const pendingFinalization = pendingChatFinalizationFromResponse(response, {
          accountId: user.id,
          chatId,
          temporaryMessageId: assistantMessageId,
          content: assistantText,
        });
        if (!pendingFinalization) {
          console.error(
            "Authenticated chat completion metadata is invalid",
            "InvalidFinalizationMetadata",
          );
        } else {
          const outbox = getFinalizationOutbox();
          if (outbox) {
            try {
              await outbox.enqueue(pendingFinalization);
              const result = await retryPendingChatFinalizations({
                outbox,
                accountId: user.id,
                onlyId: pendingFinalization.id,
                force: true,
                post: postPendingChatFinalization,
                onSuccess: reconcileFinalizedAssistant,
              });
              if (result.succeeded === 0) {
                console.warn("Authenticated chat completion queued for retry", "PendingFinalization");
              }
            } catch (error) {
              console.warn(
                "Authenticated chat finalization outbox failed",
                error instanceof Error ? error.name : "UnknownError",
              );
              try {
                const persistedAssistantMessageId = await postPendingChatFinalization(
                  pendingFinalization,
                );
                reconcileFinalizedAssistant(pendingFinalization, persistedAssistantMessageId);
              } catch (postError) {
                console.error(
                  "Authenticated chat completion persistence failed",
                  postError instanceof Error ? postError.name : "UnknownError",
                );
              }
            }
          } else {
            try {
              const persistedAssistantMessageId = await postPendingChatFinalization(
                pendingFinalization,
              );
              reconcileFinalizedAssistant(pendingFinalization, persistedAssistantMessageId);
            } catch (error) {
              console.error(
                "Authenticated chat completion persistence failed",
                error instanceof Error ? error.name : "UnknownError",
              );
            }
          }
        }
      }
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
    setMessagePage(null);
    setActivityRun(null);
    setInput("");
    setRecentOpen(false);
    setStoreOpen(false);
    setProfileOpen(false);
    setMobileSidebarOpen(false);
    window.history.replaceState(
      null,
      "",
      localizeHref(nextTopic ? topicWorkspacePath(nextTopic.slug) : "/chat", currentLanguage),
    );
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
      if (!data.user) throw new Error("Language update response is invalid");
      const updatedUser = profileFromApiUser(data.user);
      const updatedLanguage = parseSupportedChatLanguage(updatedUser.preferredLanguage);
      if (!updatedLanguage) throw new Error("Language update response is invalid");
      setProfileUser(updatedUser);
      setClientLanguagePreferenceCookie(localeCookieName, updatedLanguage);
      window.location.replace(
        localizeHref(
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
          updatedLanguage,
        ),
      );
    } catch {
      setProfileUser(previous);
    } finally {
      setLanguageSaving(false);
    }
  }

  async function updateProfileDetails(input: ProfileDetailsInput) {
    if (isGuest) return profileUser;
    const previousLanguage = parseSupportedChatLanguage(profileUser.preferredLanguage) ?? defaultLanguage;
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
    const updatedLanguage = parseSupportedChatLanguage(updatedUser.preferredLanguage);
    if (!updatedLanguage) throw new Error("Profile response has an invalid language");
    const normalizedUser = { ...updatedUser, preferredLanguage: updatedLanguage };
    setProfileUser(normalizedUser);
    setClientLanguagePreferenceCookie(localeCookieName, updatedLanguage);
    if (updatedLanguage !== previousLanguage) {
      const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const localizedHref = localizeHref(currentHref, updatedLanguage);
      if (localizedHref !== currentHref) window.location.replace(localizedHref);
    }
    return normalizedUser;
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

  async function patchMemorySettings(input: MemorySettingsPatch) {
    if (isGuest || memoryLoading || memorySaving) return;
    const disablesChatHistory =
      input.chatHistoryEnabled === false && memoryDashboard?.settings.chatHistoryEnabled === true;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch("/api/memory", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-inspir-state-contract": "incremental-v2",
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Could not update memory settings");
      const data: unknown = await response.json();
      if (!isJsonRecord(data) || !isMemorySettings(data.settings)) {
        throw new Error("Memory settings response is invalid");
      }
      const settings = data.settings;
      setMemoryDashboard((current) => (current ? { ...current, settings } : current));
      if (disablesChatHistory || typeof data.correctionMemoryId === "string") {
        await loadMemoryDashboard();
      }
    } catch {
      setMemoryError("Could not update memory settings.");
    } finally {
      setMemorySaving(false);
    }
  }

  async function createMemoryItem(input: MemoryCreateInput) {
    if (isGuest || memoryLoading || memorySaving) return;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-inspir-state-contract": "incremental-v2",
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Could not add memory");
      const data: unknown = await response.json();
      if (!isJsonRecord(data) || !isMemoryItem(data.memory)) {
        throw new Error("Memory response is invalid");
      }
      const createdMemory = data.memory;
      if (memoryDashboard) {
        setMemoryDashboard((current) => {
          if (!current) return current;
          const memories = [createdMemory, ...current.memories.filter((memory) => memory.id !== createdMemory.id)];
          return { ...current, memories };
        });
      } else {
        await loadMemoryDashboard();
      }
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
    if (isGuest || memoryLoading || memorySaving) return;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch(`/api/memory/${memoryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Could not update memory");
      const data: unknown = await response.json();
      if (!isJsonRecord(data) || !isMemoryItem(data.memory)) {
        throw new Error("Memory response is invalid");
      }
      const updatedMemory = data.memory;
      setMemoryDashboard((current) =>
        current
          ? {
              ...current,
              memories: current.memories.map((memory) =>
                memory.id === updatedMemory.id ? updatedMemory : memory,
              ),
            }
          : current,
      );
    } catch {
      setMemoryError("Could not update that memory.");
    } finally {
      setMemorySaving(false);
    }
  }

  async function deleteMemoryItem(memoryId: string) {
    if (isGuest || memoryLoading || memorySaving) return;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch(`/api/memory/${memoryId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete memory");
      await response.body?.cancel();
      setMemoryDashboard((current) =>
        current ? { ...current, memories: current.memories.filter((memory) => memory.id !== memoryId) } : current,
      );
    } catch {
      setMemoryError("Could not delete that memory.");
    } finally {
      setMemorySaving(false);
    }
  }

  async function clearMemory() {
    if (isGuest || memoryLoading || memorySaving) return;
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const response = await fetch("/api/memory", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not clear memory");
      const data: unknown = await response.json();
      if (!isMemoryDashboard(data)) throw new Error("Memory response is invalid");
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
  const avatarFallbackSrc = profileUser.image || undefined;

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
    avatarFallbackSrc,
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
    loadOlderMessages,
    loadMoreMessageContent,
    loadMoreMemories,
    messageContentLoadingSet,
    messagePage,
    messages,
    olderMessagesLoading,
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
    translationRootRef,
    patchMemorySettings,
    createMemoryItem,
    updateMemoryItem,
    updateProfileDetails,
    updatePreferredLanguage,
    deleteMemoryItem,
    clearMemory,
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
    avatarFallbackSrc,
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
    translationRootRef,
  } = controller;
  return (
    <div ref={translationRootRef} className={`inspir-chat-root ${profileOpen ? "profile-open" : ""}`}>
      <aside className={`inspir-sidebar ${mobileSidebarOpen ? "is-open" : ""}`}>
        <TopicSidebar
          isGuest={isGuest}
          avatarSrc={avatarSrc}
          avatarFallbackSrc={avatarFallbackSrc}
          topics={displayTopics}
          sidebarTopics={sidebarTopics}
          filteredTopics={filteredTopics}
          currentLanguage={currentLanguage}
          activeTopicId={activeTopicId}
          addedTopicIds={addedTopicIds}
          search={search}
          t={translateUi}
          onAddFeature={(topicId) => addSidebarTopic(topicId, { selectAfterAdd: true })}
          onOpenStore={openLearningStore}
          onProfile={() => {
            if (isGuest) setGuestPromptOpen(true);
            else {
              controller.setStoreOpen(false);
              controller.setRecentOpen(false);
              setProfileOpen(true);
              trackProductEvent("profile_opened");
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
    loadOlderMessages,
    loadMoreMessageContent,
    loadMoreMemories,
    messageContentLoadingSet,
    messagePage,
    messages,
    metadata,
    memoryDashboard,
    memoryError,
    memoryLoading,
    memorySaving,
    miniAppMode,
    olderMessagesLoading,
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
        memorySaving={memorySaving || memoryLoading}
        memoryError={memoryError}
        onPhotoUpload={uploadProfilePhoto}
        onProfileSave={updateProfileDetails}
        onMemorySettings={patchMemorySettings}
        onMemoryCreate={createMemoryItem}
        onMemoryUpdate={updateMemoryItem}
        onMemoryDelete={deleteMemoryItem}
        onMemoryClear={clearMemory}
        onMemoryLoadMore={() => void loadMoreMemories()}
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

  const transcriptDetails = isGuest ? null : (
    <CompactTranscriptDetails
      messages={visibleChatMessages}
      userDisplayName={userDisplayName}
      olderMessagesAvailable={messagePage?.hasMore === true}
      olderMessagesLoading={olderMessagesLoading}
      isMessageContentLoading={(messageId) => messageContentLoadingSet.has(messageId)}
      onContinueMessageContent={(messageId) => void loadMoreMessageContent(messageId)}
      onLoadOlderMessages={() => void loadOlderMessages()}
      onMemorySources={(messageId, sources) => setMemorySourceModal({ messageId, sources })}
      t={translateUi}
    />
  );

  if (isQuizMode) {
    if (isGuest) {
      return (
        <GuestFeatureGate
          {...topicIntroProps(activeTopic)}
          starters={topicMetadata(activeTopic)?.starters ?? []}
          t={translateUi}
          topicHref={localizedTopicHref(activeTopic, currentLanguage)}
        />
      );
    }
    return (
      <>
        {transcriptDetails}
        <QuizWorkspace
          activeChatId={activeChatId}
          activeTopicId={activeTopicId}
          activityRun={activityRun}
          createChat={createChat}
          onActivityRun={setActivityRun}
          t={translateUi}
        />
      </>
    );
  }

  if (isFlashcardMode) {
    if (isGuest) {
      return (
        <GuestFeatureGate
          {...topicIntroProps(activeTopic)}
          starters={topicMetadata(activeTopic)?.starters ?? []}
          t={translateUi}
          topicHref={localizedTopicHref(activeTopic, currentLanguage)}
        />
      );
    }
    return (
      <>
        {transcriptDetails}
        <FlashcardWorkspace
          activeChatId={activeChatId}
          activeTopicId={activeTopicId}
          activityRun={activityRun}
          createChat={createChat}
          onActivityRun={setActivityRun}
          onReset={resetChat}
          t={translateUi}
        />
      </>
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
        olderMessagesAvailable={messagePage?.hasMore === true}
        olderMessagesLoading={olderMessagesLoading}
        metadata={metadata}
        sendMessage={sendMessage}
        sending={sending}
        setInput={setInput}
        stopGeneration={stopGeneration}
        streamingMessageId={streamingMessageId}
        submitMessage={submitMessage}
        userDisplayName={userDisplayName}
        visibleChatMessages={visibleChatMessages}
        onLoadOlderMessages={() => void loadOlderMessages()}
        isMessageContentLoading={(messageId) => messageContentLoadingSet.has(messageId)}
        onContinueMessageContent={(messageId) => void loadMoreMessageContent(messageId)}
        onMemorySources={(messageId, sources) => setMemorySourceModal({ messageId, sources })}
        t={translateUi}
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
      <>
        {transcriptDetails}
        <InteractiveInstructionWorkspace
          key={miniAppProps.key}
          topic={activeTopic}
          language={currentLanguage}
          onReset={resetChat}
        />
      </>
    );
  }
  if (miniAppMode === "time-travel") {
    return (
      <>
        {transcriptDetails}
        <TimeTravelWorkspace {...miniAppProps} />
      </>
    );
  }
  if (miniAppMode === "socratic-instruction") {
    return (
      <>
        {transcriptDetails}
        <SocraticWorkspace {...miniAppProps} />
      </>
    );
  }
  return (
    <>
      {transcriptDetails}
      <GuidedMiniAppWorkspace {...miniAppProps} mode={miniAppMode} />
    </>
  );
}

function findAiRunIdForMessage(messages: Message[], messageId: string) {
  const message = messages.find((item) => item.id === messageId);
  const aiRunId = message?.metadata?.aiRunId;
  return typeof aiRunId === "string" ? aiRunId : undefined;
}
