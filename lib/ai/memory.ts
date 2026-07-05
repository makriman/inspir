import { z } from "zod";
import type { Message, Topic } from "@/lib/db/schema";
import {
  clearUserMemories,
  createUserMemory,
  createMemorySynthesisRun,
  deleteUserMemoryProfile,
  deleteUserMemory,
  deleteMatchingChatMemoryTurnsByText,
  ensureUserMemorySettings,
  findExistingMemoryByNormalized,
  findMemoriesBySourceMessage,
  findMatchingMemoriesByText,
  getActiveMemoriesByCategory,
  getActiveUserMemories,
  getRecentChatMemoryTurnsForUser,
  getRecentMemorySourceFeedback,
  getUserMemoriesByIds,
  getUserMemorySummary,
  getUserMemoryProfiles,
  finishMemorySynthesisRun,
  insertMemoryEvent,
  lexicalMemoryRank,
  markMemoriesUsed,
  markChatTurnsUsed,
  memoryUseMetadata,
  normalizeMemoryContent,
  searchChatMemoryTurnsByEmbedding,
  searchChatMemoryTurnsByText,
  searchUserMemoriesByEmbedding,
  updateUserMemory,
  upsertChatMemorySummary,
  upsertChatMemoryTurn,
  upsertUserMemorySummary,
  upsertUserMemoryProfile,
  type ChatTurnSearchResult,
  type MemorySearchResult,
  type UserMemorySummarySection,
} from "@/lib/db/memory";
import { getVisibleMessageContent } from "@/lib/ai/visible-content";
import { resolveEmbeddingModelName, resolveModelName } from "@/lib/ai/model-router";
import { consumeDailyLlmBudget, numberFromEnv, quotaDefaults } from "@/lib/utils/rate-limit";
import { embedOpenAiText, generateOpenAiJsonObject } from "@/lib/ai/openai-client";
import { hasOpenAiRuntimeCredentials } from "@/lib/ai/openai-provider";

type TopicLike = Pick<Topic, "id" | "name" | "slug">;
type PersistedMessage = Pick<Message, "id" | "role" | "content">;

export type PromptMemory = {
  id: string;
  kind: string;
  category: string;
  content: string;
  tags: string[];
};

export type PromptMemoryProfile = {
  category: string;
  summary: string;
};

export type PromptMemorySummarySection = {
  id: string;
  title: string;
  category: string;
  summary: string;
  sourceMemoryIds: string[];
  sourceTurnIds: string[];
};

export type PromptChatSummary = {
  chatId: string;
  summary: string;
  topics: string[];
};

export type PromptPriorChatTurn = {
  id: string;
  chatId: string;
  question: string;
  answerExcerpt: string;
  topics: string[];
};

export type PromptMemorySource = {
  type: "memory" | "summary" | "past_chat";
  id: string;
  label: string;
  excerpt: string;
  reason?: string;
  memoryId?: string;
  chatTurnId?: string;
  summarySectionId?: string;
};

export type MemoryIntent =
  | "generic"
  | "explicit_remember"
  | "explicit_forget"
  | "ask_about_memory"
  | "personalized";

export type MemoryStatus = {
  enabled: boolean;
  intent: MemoryIntent;
  shouldAcknowledge: boolean;
};

export type MemoryPromptContext = {
  used: boolean;
  gateReason?: string;
  status?: MemoryStatus;
  memories: PromptMemory[];
  summarySections: PromptMemorySummarySection[];
  profiles: PromptMemoryProfile[];
  chatSummaries: PromptChatSummary[];
  priorChatTurns: PromptPriorChatTurn[];
  sources: PromptMemorySource[];
};

export type MemoryRetrievalResult = MemoryPromptContext & {
  settingsEnabled: boolean;
  memoryIds: string[];
  profileCategories: string[];
  chatSummaryIds: string[];
  chatTurnIds: string[];
  summarySectionIds: string[];
};

const memoryGateSchema = z.object({
  useMemory: z.boolean(),
  reason: z.string().min(1),
  query: z.string().trim().max(500).optional(),
});
const defaultEmbeddingTimeoutMs = 10_000;

const memoryExtractionSchema = z.object({
  memories: z
    .array(
      z.object({
        content: z.string().trim().min(8).max(500),
        category: z
          .enum([
            "identity",
            "preferences",
            "learning_style",
            "projects",
            "goals",
            "knowledge",
            "constraints",
            "interaction",
            "general",
          ])
          .default("general"),
        kind: z.enum(["explicit", "auto"]).default("auto"),
        tags: z.array(z.string().trim().min(1).max(32)).max(6).default([]),
        confidence: z.number().int().min(1).max(100).default(70),
        salience: z.number().int().min(1).max(100).default(50),
      }),
    )
    .max(6)
    .default([]),
  forget: z
    .array(
      z.object({
        query: z.string().trim().min(1).max(300),
        reason: z.string().trim().max(240).optional(),
      }),
    )
    .max(6)
    .default([]),
  clearAll: z.boolean().default(false),
  chatSummary: z
    .object({
      summary: z.string().trim().min(8).max(700),
      topics: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    })
    .optional(),
});

const memoryProfileSchema = z.object({
  summary: z.string().trim().min(8).max(1200),
});

const memorySynthesisSchema = z.object({
  summary: z.string().trim().max(1800).default(""),
  sections: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(80),
        category: z.string().trim().min(1).max(60).default("general"),
        summary: z.string().trim().min(8).max(700),
        sourceMemoryIds: z.array(z.string().trim().min(1)).max(20).default([]),
        sourceTurnIds: z.array(z.string().trim().min(1)).max(20).default([]),
        doNotMention: z.boolean().default(false),
      }),
    )
    .max(8)
    .default([]),
  memoryUpdates: z
    .array(
      z.object({
        action: z.enum(["create", "update", "suppress"]).default("create"),
        id: z.string().trim().optional(),
        content: z.string().trim().min(8).max(600),
        category: z.string().trim().min(1).max(60).default("general"),
        sourceMemoryIds: z.array(z.string().trim().min(1)).max(20).default([]),
        sourceTurnIds: z.array(z.string().trim().min(1)).max(20).default([]),
        tags: z.array(z.string().trim().min(1).max(32)).max(8).default([]),
        confidence: z.number().int().min(1).max(100).default(75),
        salience: z.number().int().min(1).max(100).default(65),
        validFrom: z.string().trim().nullable().optional(),
        validUntil: z.string().trim().nullable().optional(),
        freshnessStatus: z.enum(["current", "stale", "expired"]).default("current"),
      }),
    )
    .max(10)
    .default([]),
});

type MemoryExtraction = z.infer<typeof memoryExtractionSchema>;
type MemorySynthesis = z.infer<typeof memorySynthesisSchema>;

const memoryRelevanceTerms = [
  "remember",
  "remeber",
  "rember",
  "rememebr",
  "remembr",
  "remebr",
  "forget",
  "save that",
  "save this",
  "keep in mind",
  "i prefer",
  "my preference",
  "my favorite",
  "my favourite",
  "favorite food",
  "favourite food",
  "my food",
  "my foods",
  "my foos",
  "fav",
  "you know about me",
  "what do you know",
  "last time",
  "previous",
  "earlier",
  "past chat",
  "previous chat",
  "chat history",
  "conversation history",
  "what did i ask",
  "what have i asked",
  "we discussed",
  "we talked",
  "continue",
  "resume",
  "my project",
  "my essay",
  "my exam",
  "my style",
  "my preferences",
  "for me",
  "personalize",
  "based on me",
  "do you remember",
];

const explicitRememberPatterns = [
  /\b(?:remember|remeber|rember|rememebr|remembr|remebr)\s+(?:that\s+)?(.+)/i,
  /\bkeep in mind\s+(?:that\s+)?(.+)/i,
  /\bsave\s+(?:that|this)\s+(.+)/i,
  /\bmake a note\s+(?:that\s+)?(.+)/i,
];

const preferencePatterns = [
  /\bi prefer\s+(.+)/i,
  /\bi like\s+(.+)/i,
  /\bi struggle with\s+(.+)/i,
  /\bi am working on\s+(.+)/i,
  /\bi'm working on\s+(.+)/i,
];

const strongPersonalMemoryCuePattern =
  /\b(my|mine|me)\b.*\b(favo[u]?rite|fav|prefer|preference|like|likes|food|foods|foos|colour|color|project|exam|essay|goal|style|progress|plan|work)\b|\b(favo[u]?rite|fav|prefer|like|likes)\b.*\b(my|mine|me)\b/i;

export function displayMemoryContent(content: string) {
  return content
    .replace(/\bthe learner's\b/gi, "your")
    .replace(/\blearner's\b/gi, "your")
    .replace(/\bthe learner\b/gi, "you")
    .replace(/\blearner\b/gi, "you")
    .replace(/\s+/g, " ")
    .trim();
}

export function isUsefulMemoryContent(value: string) {
  const text = cleanMemoryText(value).toLowerCase();
  if (!text || text.length < 5) return false;
  if (
    /^(that|this|it|its|it's|that's|thats|about me|all about me|what about me|what you know about me|what do you know about me|what do you remember about me|what all do you remember about me|what all do you remeber about me|remember about me|remember me)$/i.test(
      text,
    )
  ) {
    return false;
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && words.every((word) => /^(about|me|my|mine|that|this|it|its|remember|know)$/i.test(word))) {
    return false;
  }
  if (
    words.length <= 3 &&
    !/\b(i|i'm|im|my|mine|me|learner|user|you|your|prefer|preference|like|likes|favo[u]?rite|goal|project|exam|essay|style|constraint|struggle|working)\b/i.test(
      text,
    ) &&
    !/\b(is|are|am|prefer|like|likes|want|wants|need|needs)\b/i.test(text)
  ) {
    return false;
  }
  return true;
}

export function extractDirectMemoryActions(message: string): MemoryExtraction {
  const text = getVisibleMessageContent(message).trim();
  const lower = text.toLowerCase();
  const empty: MemoryExtraction = { memories: [], forget: [], clearAll: false };
  if (!text) return empty;

  if (/\b(clear|delete|erase|remove)\s+(all\s+)?memor(y|ies)\b/i.test(text)) {
    return { memories: [], forget: [], clearAll: true };
  }

  if (/^\s*(forget|delete|erase|remove)\b/i.test(text) || /\bforget\s+(?:that|my|this)\b/i.test(text)) {
    const forgetText = text.replace(/^\s*(please|can you|could you|would you)\s+/i, "");
    const query = cleanMemoryText(
      forgetText
        .replace(/^\s*(forget|delete|erase|remove)\s+(that\s+)?/i, "")
        .replace(/\bforget\s+(that\s+)?/i, ""),
    );
    return {
      memories: [],
      forget: query ? [{ query, reason: "Explicit forget request." }] : [],
      clearAll: false,
    };
  }

  if (isAskAboutMemoryQuestion(text)) return empty;

  for (const pattern of explicitRememberPatterns) {
    const match = text.match(pattern);
    const content = cleanMemoryText(match?.[1] ?? "");
    if (
      content &&
      isDurableExplicitMemoryRequest(match?.[0] ?? "", content) &&
      !isAmbiguousPronounMemory(content) &&
      isUsefulMemoryContent(content) &&
      !looksSensitive(content)
    ) {
      return {
        memories: [
          {
            content,
            category: categorizeMemoryContent(content),
            kind: "explicit",
            tags: ["explicit"],
            confidence: 95,
            salience: 90,
          },
        ],
        forget: [],
        clearAll: false,
      };
    }
  }

  if (/\b(password|token|api key|secret|credit card|payment)\b/i.test(lower)) return empty;

  for (const pattern of preferencePatterns) {
    const match = text.match(pattern);
    const content = cleanMemoryText(match?.[0] ?? "");
    if (content && isUsefulMemoryContent(content) && !looksSensitive(content)) {
      return {
        memories: [
          {
            content,
            category: categorizeMemoryContent(content),
            kind: "auto",
            tags: ["durable"],
            confidence: 80,
            salience: 70,
          },
        ],
        forget: [],
        clearAll: false,
      };
    }
  }

  return empty;
}

export function extractDirectMemoryActionsFromTurn(input: {
  userMessage: string;
  assistantMessage?: string;
  contextMessages?: Array<Pick<PersistedMessage, "role" | "content">>;
}): MemoryExtraction {
  const direct = extractDirectMemoryActions(input.userMessage);
  if (direct.clearAll || direct.forget.length) return direct;

  const inferred = inferExplicitMemoryFromCompletedTurn(input);
  return mergeMemoryExtractions(direct, inferred);
}

export function detectMemoryIntent(message: string): MemoryIntent {
  const text = getVisibleMessageContent(message).trim().toLowerCase();
  if (!text) return "generic";
  if (/\b(clear|delete|erase|remove)\s+(all\s+)?memor(y|ies)\b/.test(text)) return "explicit_forget";
  if (/^\s*(forget|delete|erase|remove)\b/.test(text) || /\bforget\s+(?:that|my|this)\b/.test(text)) return "explicit_forget";
  if (isAskAboutMemoryQuestion(text)) {
    return "ask_about_memory";
  }
  if (explicitRememberPatterns.some((pattern) => pattern.test(text))) return "explicit_remember";
  if (/\b(my|mine|i|me)\b/.test(text) && /\b(project|exam|essay|goal|style|preference|progress|plan|work)\b/.test(text)) {
    return "personalized";
  }
  if (preferencePatterns.some((pattern) => pattern.test(text))) return "personalized";
  if (strongPersonalMemoryCuePattern.test(text)) return "personalized";
  if (isPriorChatRecallCue(text)) return "personalized";
  return memoryRelevanceTerms.some((term) => text.includes(term)) ? "personalized" : "generic";
}

export function shouldUseMemoryHeuristic(message: string) {
  const intent = detectMemoryIntent(message);
  if (intent !== "generic") return true;
  const text = message.toLowerCase();
  if (/\b(remember|remeber|rember|rememebr|remembr|remebr|forget)\b/.test(text)) return true;
  if (/\b(my|mine|i|me)\b/.test(text) && /\b(project|exam|essay|goal|style|preference|progress|plan|work)\b/.test(text)) {
    return true;
  }
  if (strongPersonalMemoryCuePattern.test(text)) return true;
  if (isPriorChatRecallCue(text)) return true;
  return memoryRelevanceTerms.some((term) => text.includes(term));
}

export async function retrieveRelevantMemoryForTurn(input: {
  userId: string;
  chatId: string;
  userMessageId: string;
  message: string;
  topic: TopicLike;
  contextMessages: PersistedMessage[];
  embeddingTimeoutMs?: number;
  recordUsage?: boolean;
  skipLlmGate?: boolean;
}): Promise<MemoryRetrievalResult> {
  const intent = detectMemoryIntent(input.message);
  const settings = await ensureUserMemorySettings(input.userId);
  if (!settings.enabled || !settings.savedMemoryEnabled) {
    await insertMemoryEvent({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.userMessageId,
      eventType: "skipped",
      reason: !settings.enabled ? "memory_disabled" : "saved_memory_disabled",
    });
    return emptyMemoryRetrieval(false, "Memory is disabled for this user.", intent);
  }

  const gate = await shouldUseMemory({
    message: input.message,
    topicName: input.topic.name,
    contextMessages: input.contextMessages,
    intent,
    skipLlmGate: input.skipLlmGate,
  });

  if (!gate.useMemory) {
    await insertMemoryEvent({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.userMessageId,
      eventType: "skipped",
      reason: gate.reason,
    });
    return emptyMemoryRetrieval(true, gate.reason, intent);
  }

  const query = gate.query || input.message;
  const [embedding, rawMemories, allProfiles, summary] = await Promise.all([
    embedText(query, input.embeddingTimeoutMs),
    getActiveUserMemories(input.userId, 100),
    getUserMemoryProfiles(input.userId),
    getUserMemorySummary(input.userId),
  ]);
  const allMemories = rawMemories.filter(
    (memory) =>
      isUsefulMemoryContent(memory.content) &&
      !memory.doNotMention &&
      memory.freshnessStatus !== "expired" &&
      (settings.chatHistoryEnabled || !isChatHistoryMemory(memory)),
  );

  let vectorMemories: MemorySearchResult[] = [];
  if (embedding) {
    try {
      vectorMemories = await searchUserMemoriesByEmbedding(input.userId, embedding, 12);
    } catch {
      vectorMemories = [];
    }
  }

  const lexicalMemories = lexicalMemoryRank(query, allMemories, 12);
  const selectedMemories = dedupeById([...vectorMemories, ...lexicalMemories])
    .filter(
      (memory) =>
        isUsefulMemoryContent(memory.content) &&
        !memory.doNotMention &&
        memory.freshnessStatus !== "expired" &&
        (settings.chatHistoryEnabled || !isChatHistoryMemory(memory)) &&
        !(isChatHistoryMemory(memory) && memory.sourceChatId === input.chatId),
    )
    .toSorted((left, right) => memoryPromptScore(right) - memoryPromptScore(left));

  const explicit = selectedMemories.filter((memory) => memory.kind === "explicit").slice(0, 3);
  const auto = selectedMemories
    .filter((memory) => memory.kind !== "explicit" && !explicit.some((selected) => selected.id === memory.id))
    .slice(0, 4);
  const memories = [...explicit, ...auto].slice(0, 5);

  const categories = [...new Set(memories.map((memory) => memory.category))];
  const summarySections = selectSummarySections(summary?.sections ?? [], {
    query,
    categories,
    intent,
  }).slice(0, 3);
  const profiles = allProfiles
    .filter((profile) => (categories.length ? categories.includes(profile.category) : intent === "ask_about_memory"))
    .slice(0, 1)
    .map((profile) => ({
      category: profile.category,
      summary: profile.summary,
    }));

  const promptMemories = memories.map((memory) => ({
    id: memory.id,
    kind: memory.kind,
    category: memory.category,
    content: memory.content,
      tags: memory.tags ?? [],
    }));

  const priorChatTurns =
    settings.chatHistoryEnabled && (embedding || isPriorChatRecallCue(query) || intent === "personalized")
      ? await retrievePriorChatTurns({
          userId: input.userId,
          chatId: input.chatId,
          query,
          embedding,
        })
      : [];

  if (input.recordUsage !== false) {
    await recordMemoryRetrievalUsage({
      userId: input.userId,
      memoryIds: promptMemories.map((memory) => memory.id),
      chatTurnIds: priorChatTurns.map((turn) => turn.id),
      chatId: input.chatId,
      userMessageId: input.userMessageId,
      reason: gate.reason,
    });
  }

  const promptSummarySections = summarySections.map((section) => ({
    id: section.id,
    title: section.title,
    category: section.category,
    summary: section.summary,
    sourceMemoryIds: section.sourceMemoryIds ?? [],
    sourceTurnIds: section.sourceTurnIds ?? [],
  }));
  const promptPriorChatTurns = priorChatTurns.map((turn) => ({
    id: turn.id,
    chatId: turn.chatId,
    question: turn.question,
    answerExcerpt: turn.answerExcerpt,
    topics: turn.topics ?? [],
  }));
  const sources = buildPromptMemorySources({
    memories,
    summarySections: promptSummarySections,
    priorChatTurns: promptPriorChatTurns,
  });
  const shouldIncludeStatus = intent === "explicit_remember" || intent === "explicit_forget" || intent === "ask_about_memory";
  const used =
    shouldIncludeStatus ||
    promptMemories.length > 0 ||
    promptSummarySections.length > 0 ||
    profiles.length > 0 ||
    promptPriorChatTurns.length > 0;

  return {
    settingsEnabled: true,
    used,
    gateReason: gate.reason,
    status: {
      enabled: true,
      intent,
      shouldAcknowledge: intent === "explicit_remember" || intent === "explicit_forget",
    },
    memories: promptMemories,
    summarySections: promptSummarySections,
    profiles,
    chatSummaries: [],
    priorChatTurns: promptPriorChatTurns,
    sources,
    memoryIds: promptMemories.map((memory) => memory.id),
    profileCategories: profiles.map((profile) => profile.category),
    chatSummaryIds: [],
    chatTurnIds: promptPriorChatTurns.map((turn) => turn.id),
    summarySectionIds: promptSummarySections.map((section) => section.id),
  };
}

export async function recordMemoryRetrievalUsage(input: {
  userId: string;
  memoryIds: string[];
  chatTurnIds: string[];
  chatId?: string | null;
  userMessageId?: string | null;
  reason?: string | null;
}) {
  const memoryIds = [...new Set(input.memoryIds)].filter(Boolean);
  const chatTurnIds = [...new Set(input.chatTurnIds)].filter(Boolean);
  await Promise.all([
    memoryIds.length
      ? markMemoriesUsed({
          userId: input.userId,
          memoryIds,
          chatId: input.chatId,
          messageId: input.userMessageId,
          reason: input.reason ?? undefined,
        })
      : Promise.resolve(),
    chatTurnIds.length
      ? markChatTurnsUsed({
          userId: input.userId,
          turnIds: chatTurnIds,
          chatId: input.chatId,
          messageId: input.userMessageId,
          reason: input.reason ?? undefined,
        })
      : Promise.resolve(),
  ]);
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function isChatHistoryMemory(memory: Pick<MemorySearchResult, "tags" | "sourceType">) {
  return memory.sourceType === "prior_chat" || (memory.tags ?? []).includes("prior_chat") || (memory.tags ?? []).includes("chat_history");
}

function memoryPromptScore(memory: MemorySearchResult) {
  return (
    memory.salience +
    (memory.kind === "explicit" || memory.sourceType === "manual" ? 30 : 0) +
    (memory.pinned ? 25 : 0) +
    (memory.similarity ? memory.similarity * 40 : 0) -
    (memory.freshnessStatus === "stale" ? 15 : 0)
  );
}

function selectSummarySections(
  sections: UserMemorySummarySection[],
  input: { query: string; categories: string[]; intent: MemoryIntent },
) {
  if (!sections.length) return [];
  const terms = lexicalPromptTerms(input.query);
  const categorySet = new Set(input.categories);
  return sections
    .filter((section) => !section.doNotMention && section.summary?.trim())
    .map((section) => {
      const haystack = `${section.title} ${section.category} ${section.summary}`.toLowerCase();
      const overlap = terms.filter((term) => haystack.includes(term)).length;
      const categoryScore = categorySet.has(section.category) ? 3 : 0;
      const intentScore = input.intent === "ask_about_memory" ? 2 : 0;
      return { section, score: overlap + categoryScore + intentScore };
    })
    .filter(({ score }) => score > 0 || input.intent === "ask_about_memory")
    .sort((left, right) => right.score - left.score)
    .map(({ section }) => section);
}

async function retrievePriorChatTurns(input: {
  userId: string;
  chatId: string;
  query: string;
  embedding: number[] | null;
}) {
  let vectorTurns: ChatTurnSearchResult[] = [];
  if (input.embedding) {
    try {
      vectorTurns = await searchChatMemoryTurnsByEmbedding(input.userId, input.embedding, input.chatId, 6);
    } catch {
      vectorTurns = [];
    }
  }
  const textTurns = await searchChatMemoryTurnsByText(input.userId, input.query, input.chatId, 6);
  return dedupeById([...vectorTurns, ...textTurns])
    .filter((turn) => turn.chatId !== input.chatId)
    .sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0))
    .slice(0, 4);
}

function buildPromptMemorySources(input: {
  memories: MemorySearchResult[];
  summarySections: PromptMemorySummarySection[];
  priorChatTurns: PromptPriorChatTurn[];
}): PromptMemorySource[] {
  const memorySources = input.memories.slice(0, 5).map((memory) => ({
    type: "memory" as const,
    id: `memory:${memory.id}`,
    memoryId: memory.id,
    label: memorySourceLabel(memory),
    excerpt: displayMemoryContent(memory.content),
    reason: memory.kind === "explicit" || memory.sourceType === "manual" ? "Saved memory" : "Relevant learned memory",
  }));
  const summarySources = input.summarySections.slice(0, 3).map((section) => ({
    type: "summary" as const,
    id: `summary:${section.id}`,
    summarySectionId: section.id,
    label: section.title,
    excerpt: section.summary,
    reason: "Memory summary",
  }));
  const turnSources = input.priorChatTurns.slice(0, 4).map((turn) => ({
    type: "past_chat" as const,
    id: `turn:${turn.id}`,
    chatTurnId: turn.id,
    label: "Past chat",
    excerpt: compactText(`You asked: ${turn.question}${turn.answerExcerpt ? ` Inspir replied: ${turn.answerExcerpt}` : ""}`, 420),
    reason: "Related earlier chat",
  }));
  return [...memorySources, ...summarySources, ...turnSources].slice(0, 10);
}

function memorySourceLabel(memory: Pick<MemorySearchResult, "kind" | "sourceType" | "tags">) {
  if (memory.sourceType === "manual" || (memory.tags ?? []).includes("manual")) return "Added manually";
  if (memory.sourceType === "prior_chat" || (memory.tags ?? []).includes("prior_chat")) return "From previous chat";
  if (memory.kind === "explicit") return "Remembered from chat";
  if (memory.sourceType === "synthesized") return "Synthesized from chats";
  return "Learned from chats";
}

function lexicalPromptTerms(query: string) {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2),
    ),
  ];
}

export function formatMemoryPromptContext(context: MemoryPromptContext | undefined) {
  if (!context?.used) return undefined;
  const lines = [
    "\nRelevant learner memory:",
    "Use this only when it helps the current request. The learner's current message and current chat override older memory. Explicit saved memories have priority over automatic summaries.",
  ];

  if (context.status) {
    if (context.status.enabled) {
      lines.push(
        "Memory is enabled for this signed-in learner. Do not say you only remember during this conversation.",
      );
      if (context.status.intent === "explicit_remember") {
        lines.push("If the learner asks you to remember something, briefly acknowledge that it will be saved after this response.");
      }
      if (context.status.intent === "explicit_forget") {
        lines.push("If the learner asks you to forget something, briefly acknowledge that matching saved memory will be removed after this response.");
      }
      if (context.status.intent === "ask_about_memory") {
        lines.push("If no saved memories or related chats are listed below, say you do not have saved information about them yet.");
      }
    } else {
      lines.push("Memory is currently off for this signed-in learner. Do not claim that a new memory will be saved.");
    }
  }

  if (context.memories.length) {
    lines.push("\nSaved memories:");
    for (const memory of context.memories.slice(0, 5)) {
      lines.push(`- [${memory.kind}/${memory.category}] ${memory.content}`);
    }
  }

  if (context.summarySections.length) {
    lines.push("\nMemory summary:");
    for (const section of context.summarySections.slice(0, 3)) {
      lines.push(`- [${section.category}] ${section.title}: ${section.summary}`);
    }
  }

  if (context.profiles.length) {
    lines.push("\nUser knowledge summary:");
    for (const profile of context.profiles.slice(0, 1)) {
      lines.push(`- [${profile.category}] ${profile.summary}`);
    }
  }

  if (context.chatSummaries.length) {
    lines.push("\nRecent related chats:");
    for (const summary of context.chatSummaries.slice(0, 2)) {
      const topicText = summary.topics.length ? ` (${summary.topics.join(", ")})` : "";
      lines.push(`- ${summary.summary}${topicText}`);
    }
  }

  if (context.priorChatTurns.length) {
    lines.push("\nPrior related chat turns:");
    for (const turn of context.priorChatTurns.slice(0, 4)) {
      const topicText = turn.topics.length ? ` (${turn.topics.join(", ")})` : "";
      lines.push(`- Learner asked: ${turn.question}${topicText}`);
      if (turn.answerExcerpt) lines.push(`  Inspir replied: ${turn.answerExcerpt}`);
    }
  }

  return lines.join("\n");
}

export function memoryRunMetadata(retrieval: MemoryRetrievalResult) {
  return memoryUseMetadata({
    used: retrieval.used,
    gateReason: retrieval.gateReason,
    memoryIds: retrieval.memoryIds,
    profileCategories: retrieval.profileCategories,
    chatSummaryIds: retrieval.chatSummaryIds,
    chatTurnIds: retrieval.chatTurnIds,
    summarySectionIds: retrieval.summarySectionIds,
    sources: retrieval.sources,
    memoryIntent: retrieval.status?.intent,
  });
}

export async function processMemoryAfterTurn(input: {
  userId: string;
  chatId: string;
  topic: TopicLike;
  userMessage: PersistedMessage;
  assistantMessage: PersistedMessage;
  contextMessages: PersistedMessage[];
}) {
  const settings = await ensureUserMemorySettings(input.userId);
  if (!settings.enabled || !settings.savedMemoryEnabled) return;

  const extraction = await extractMemoryUpdates(input);
  if (extraction.clearAll) {
    await clearUserMemories(input.userId);
    return;
  }

  const changedCategories = new Set<string>();

  const forgottenCategories = await Promise.all(
    extraction.forget.map((forget) => processForgetMemoryRequest(input, forget)),
  );
  for (const category of forgottenCategories.flat()) changedCategories.add(category);

  const updatedCategories = await Promise.all(
    extraction.memories.map((candidate) => upsertExtractedMemory(input, candidate)),
  );
  for (const category of updatedCategories) {
    if (category) changedCategories.add(category);
  }

  if (settings.chatHistoryEnabled) {
    const summary = extraction.chatSummary ?? fallbackChatSummary(input);
    const turnIndex = extraction.forget.length ? null : buildChatTurnIndex(input, summary.topics);
    const [summaryEmbedding, turnEmbedding] = await Promise.all([
      summary.summary ? embedText(summary.summary) : Promise.resolve(null),
      turnIndex ? embedText(turnIndex.searchableText) : Promise.resolve(null),
    ]);

    if (summary.summary) {
      await upsertChatMemorySummary({
        chatId: input.chatId,
        userId: input.userId,
        topicId: input.topic.id,
        summary: summary.summary,
        topics: summary.topics,
        sourceMessageCount: input.contextMessages.length + 2,
        lastMessageId: input.assistantMessage.id,
        embedding: summaryEmbedding,
      });
    }

    const indexedTurn = turnIndex
      ? await upsertChatMemoryTurn({
          userId: input.userId,
          chatId: input.chatId,
          topicId: input.topic.id,
        userMessageId: input.userMessage.id,
        assistantMessageId: input.assistantMessage.id,
        question: turnIndex.question,
        answerExcerpt: turnIndex.answerExcerpt,
          searchableText: turnIndex.searchableText,
          topics: turnIndex.topics,
          embedding: turnEmbedding,
        })
      : null;

    if (turnIndex) {
      const chatHistoryCategory = await upsertChatHistoryMemoryFromTurn({
        userId: input.userId,
        chatId: input.chatId,
        topicName: input.topic.name,
        topicSlug: input.topic.slug,
        userMessageId: input.userMessage.id,
        sourceTurnId: indexedTurn?.id ?? null,
        question: turnIndex.question,
        answerExcerpt: turnIndex.answerExcerpt,
        topics: turnIndex.topics,
        embedding: turnEmbedding,
      });
      if (chatHistoryCategory) changedCategories.add(chatHistoryCategory);
    }
  }

  await Promise.all(profileCategoriesForTurn(changedCategories).map((category) => compileUserMemoryProfile(input.userId, category)));

  if (settings.dreamingEnabled && shouldSynthesizeAfterTurn(changedCategories.size)) {
    await runWithTimeout(synthesizeUserMemory(input.userId, "post_turn"), 25_000).catch((error) =>
      console.warn("Memory dreaming synthesis failed", error),
    );
  }
}

async function processForgetMemoryRequest(
  input: {
    userId: string;
    chatId: string;
    userMessage: PersistedMessage;
  },
  forget: MemoryExtraction["forget"][number],
) {
  const [matches, deletedTurnIds] = await Promise.all([
    findMatchingMemoriesByText(input.userId, forget.query, 10),
    deleteMatchingChatMemoryTurnsByText(input.userId, forget.query),
  ]);
  await Promise.all([
    ...matches.map((memory) => deleteUserMemory(input.userId, memory.id)),
    ...deletedTurnIds.map((turnId) =>
      insertMemoryEvent({
        userId: input.userId,
        chatId: input.chatId,
        messageId: input.userMessage.id,
        eventType: "deleted",
        reason: forget.reason ?? "Explicit forget request.",
        metadata: { chatTurnId: turnId, query: forget.query },
      }),
    ),
  ]);
  return matches.map((memory) => memory.category);
}

async function upsertExtractedMemory(
  input: {
    userId: string;
    chatId: string;
    userMessage: PersistedMessage;
  },
  candidate: MemoryExtraction["memories"][number],
) {
  if (!isUsefulMemoryContent(candidate.content)) {
    await insertMemoryEvent({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.userMessage.id,
      eventType: "skipped",
      reason: "low_information_memory",
      metadata: { content: candidate.content.slice(0, 120), category: candidate.category, kind: candidate.kind },
    });
    return null;
  }

  const normalized = normalizeMemoryContent(candidate.content);
  const [existing, embedding] = await Promise.all([
    findExistingMemoryByNormalized(input.userId, normalized),
    embedText(candidate.content),
  ]);

  if (existing) {
    await updateUserMemory(input.userId, existing.id, {
      kind: existing.kind === "explicit" ? "explicit" : candidate.kind,
      category: candidate.category,
      content: candidate.content,
      tags: [...new Set([...(existing.tags ?? []), ...candidate.tags])].slice(0, 8),
      confidence: Math.max(existing.confidence, candidate.confidence),
      salience: Math.max(existing.salience, candidate.salience),
      sourceType: existing.sourceType === "manual" ? "manual" : candidate.kind === "explicit" ? "explicit" : "auto",
      sourceChatId: input.chatId,
      sourceMessageId: input.userMessage.id,
      embedding,
    });
  } else {
    await createUserMemory({
      userId: input.userId,
      kind: candidate.kind,
      category: candidate.category,
      content: candidate.content,
      tags: candidate.tags,
      confidence: candidate.confidence,
      salience: candidate.salience,
      sourceType: candidate.kind === "explicit" ? "explicit" : "auto",
      sourceChatId: input.chatId,
      sourceMessageId: input.userMessage.id,
      embedding,
    });
  }
  return candidate.category;
}

async function shouldUseMemory(input: {
  message: string;
  topicName: string;
  contextMessages: PersistedMessage[];
  intent: MemoryIntent;
  skipLlmGate?: boolean;
}) {
  if (
    input.intent === "explicit_remember" ||
    input.intent === "explicit_forget" ||
    input.intent === "ask_about_memory"
  ) {
    return {
      useMemory: true,
      reason: `Memory intent detected: ${input.intent}.`,
      query: input.message,
    };
  }

  const fallback = shouldUseMemoryHeuristic(input.message);
  if (strongPersonalMemoryCuePattern.test(input.message)) {
    return {
      useMemory: true,
      reason: "Strong personal memory cue detected.",
      query: input.message,
    };
  }
  if (!fallback) {
    return {
      useMemory: false,
      reason: "Heuristic found no personal, continuity, remember, or forget cue.",
      query: input.message,
    };
  }
  if (input.skipLlmGate) {
    return {
      useMemory: true,
      reason: "Fast pre-stream heuristic found a relevant memory cue.",
      query: input.message,
    };
  }
  if (!hasOpenAiApiKey()) {
    return {
      useMemory: fallback,
      reason: fallback ? "Heuristic found a personal, continuity, remember, or forget cue." : "Generic turn.",
      query: input.message,
    };
  }
  if (!(await hasLlmBudget("memory_gate"))) {
    return {
      useMemory: fallback,
      reason: fallback ? "Budget fallback heuristic found a relevant memory cue." : "Budget fallback found no memory need.",
      query: input.message,
    };
  }

  try {
    const object = await generateOpenAiJsonObject({
      model: resolveModelName("structured"),
      schemaName: "memory_gate",
      schema: memoryGateSchema,
      system: [
        "Decide whether a tutor should retrieve long-term learner memory before answering.",
        "Return true only when memory could materially improve the answer: personal preferences, prior projects, progress, goals, learning style, continuity, remember/forget requests, prior chat questions and replies, or direct questions about what the assistant knows.",
        "Return false for generic educational questions that can be answered without personal context.",
      ].join("\n"),
      prompt: JSON.stringify({
        topic: input.topicName,
        userMessage: input.message,
        recentUserMessages: input.contextMessages
          .filter((message) => message.role === "user")
          .slice(-4)
          .map((message) => getVisibleMessageContent(message.content)),
      }),
      temperature: 0,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(8_000),
    });
    return object;
  } catch {
    return {
      useMemory: fallback,
      reason: fallback ? "Fallback heuristic found a relevant memory cue." : "Fallback heuristic found no memory need.",
      query: input.message,
    };
  }
}

async function extractMemoryUpdates(input: {
  userId: string;
  chatId: string;
  topic: TopicLike;
  userMessage: PersistedMessage;
  assistantMessage: PersistedMessage;
  contextMessages: PersistedMessage[];
}): Promise<MemoryExtraction> {
  const direct = extractDirectMemoryActionsFromTurn({
    userMessage: input.userMessage.content,
    assistantMessage: input.assistantMessage.content,
    contextMessages: input.contextMessages,
  });
  if (direct.clearAll || direct.forget.length) return direct;
  if (!hasOpenAiApiKey()) return fallbackExtraction(input);
  if (!(await hasLlmBudget("memory_extraction"))) return fallbackExtraction(input);

  const existing = await getActiveUserMemories(input.userId, 60);
  try {
    const object = await generateOpenAiJsonObject({
      model: resolveModelName("structured"),
      schemaName: "memory_extraction",
      schema: memoryExtractionSchema,
      system: [
        "You update long-term memory for Inspir, an AI learning companion.",
        "Save durable facts and preferences that could help future conversations: goals, learning style, level, projects, recurring constraints, strong preferences, and explicit remember requests.",
        "Use broad context, but do not save secrets, temporary tasks, fleeting moods, passwords, access tokens, payment data, or sensitive personal traits unless the learner explicitly asks and it is needed for learning.",
        "If the learner asks to forget something, return forget queries instead of saving new facts.",
        "Prefer compact single-sentence memories. Do not duplicate existing memories unless the new statement updates or corrects them.",
      ].join("\n"),
      prompt: JSON.stringify({
        topic: {
          id: input.topic.id,
          name: input.topic.name,
          slug: input.topic.slug,
        },
        currentUserMessage: getVisibleMessageContent(input.userMessage.content),
        assistantResponse: input.assistantMessage.content.slice(0, 3000),
        recentConversation: input.contextMessages.slice(-10).map((message) => ({
          role: message.role,
          content: getVisibleMessageContent(message.content).slice(0, 1200),
        })),
        existingMemories: existing.map((memory) => ({
          id: memory.id,
          category: memory.category,
          content: memory.content,
        })),
      }),
      temperature: 0.2,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(25_000),
    });
    return mergeMemoryExtractions(direct, object);
  } catch {
    return fallbackExtraction(input);
  }
}

export async function compileUserMemoryProfile(userId: string, category: string) {
  const memories = await getActiveMemoriesByCategory(userId, category, 40);
  if (!memories.length) {
    await deleteUserMemoryProfile(userId, category);
    return;
  }

  if (!hasOpenAiApiKey() || !(await hasLlmBudget("memory_profile"))) {
    await upsertUserMemoryProfile({
      userId,
      category,
      summary: memories
        .slice(0, 8)
        .map((memory) => memory.content)
        .join(" "),
      sourceMemoryIds: memories.slice(0, 20).map((memory) => memory.id),
    });
    return;
  }

  try {
    const object = await generateOpenAiJsonObject({
      model: resolveModelName("structured"),
      schemaName: "memory_profile",
      schema: memoryProfileSchema,
      system: [
        "Compile a dense but careful user knowledge memory for a learning companion.",
        "Preserve stable patterns and preferences. Avoid overstating plans as facts. Mention uncertainty or recency when needed.",
      ].join("\n"),
      prompt: JSON.stringify({
        category,
        memories: memories.map((memory) => ({
          kind: memory.kind,
          content: memory.content,
          confidence: memory.confidence,
          updatedAt: memory.updatedAt,
        })),
      }),
      temperature: 0.2,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20_000),
    });
    await upsertUserMemoryProfile({
      userId,
      category,
      summary: object.summary,
      sourceMemoryIds: memories.slice(0, 30).map((memory) => memory.id),
    });
  } catch {
    await upsertUserMemoryProfile({
      userId,
      category,
      summary: memories
        .slice(0, 8)
        .map((memory) => memory.content)
        .join(" "),
      sourceMemoryIds: memories.slice(0, 20).map((memory) => memory.id),
    });
  }
}

export async function synthesizeUserMemory(userId: string, reason = "manual_refresh") {
  const settings = await ensureUserMemorySettings(userId);
  if (!settings.enabled || !settings.savedMemoryEnabled || !settings.dreamingEnabled) {
    return null;
  }

  const [memories, turns, existingSummary, feedback] = await Promise.all([
    getActiveUserMemories(userId, 140),
    settings.chatHistoryEnabled ? getRecentChatMemoryTurnsForUser(userId, 100) : Promise.resolve([]),
    getUserMemorySummary(userId),
    getRecentMemorySourceFeedback(userId, 120),
  ]);
  const run = await createMemorySynthesisRun({
    userId,
    reason,
    inputCounts: {
      memories: memories.length,
      turns: turns.length,
      feedback: feedback.length,
      hasExistingSummary: Boolean(existingSummary),
    },
  });

  try {
    const synthesis =
      hasOpenAiApiKey()
        ? await generateMemorySynthesis({
            memories,
            turns,
            existingSummary,
            feedback,
          })
        : buildFallbackMemorySynthesis({
            memories,
            turns,
            feedback,
          });

    const changedCategories = await applyMemorySynthesis(userId, synthesis);
    const sourceMemoryIds = [
      ...new Set([
        ...synthesis.sections.flatMap((section) => section.sourceMemoryIds ?? []),
        ...synthesis.memoryUpdates.flatMap((update) => update.sourceMemoryIds ?? []),
      ]),
    ].slice(0, 80);
    const sourceTurnIds = [
      ...new Set([
        ...synthesis.sections.flatMap((section) => section.sourceTurnIds ?? []),
        ...synthesis.memoryUpdates.flatMap((update) => update.sourceTurnIds ?? []),
      ]),
    ].slice(0, 80);

    const summary = await upsertUserMemorySummary({
      userId,
      summary: synthesis.summary || synthesis.sections.map((section) => section.summary).join("\n"),
      sections: synthesis.sections.map(normalizeSummarySection).slice(0, 8),
      sourceMemoryIds,
      sourceTurnIds,
      version: 1,
    });

    await Promise.all(profileCategoriesForTurn(changedCategories).map((category) => compileUserMemoryProfile(userId, category)));
    await finishMemorySynthesisRun(run.id, {
      status: "completed",
      outputCounts: {
        sections: synthesis.sections.length,
        memoryUpdates: synthesis.memoryUpdates.length,
        changedCategories: changedCategories.size,
      },
    });
    return summary;
  } catch (error) {
    await finishMemorySynthesisRun(run.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function generateMemorySynthesis(input: {
  memories: Awaited<ReturnType<typeof getActiveUserMemories>>;
  turns: Awaited<ReturnType<typeof getRecentChatMemoryTurnsForUser>>;
  existingSummary: Awaited<ReturnType<typeof getUserMemorySummary>>;
  feedback: Awaited<ReturnType<typeof getRecentMemorySourceFeedback>>;
}): Promise<MemorySynthesis> {
  if (!(await hasLlmBudget("memory_synthesis"))) return buildFallbackMemorySynthesis(input);
  try {
    const object = await generateOpenAiJsonObject({
      model: resolveModelName("structured"),
      schemaName: "memory_synthesis",
      schema: memorySynthesisSchema,
      system: [
        "You synthesize long-term learner memory for Inspir.",
        "Create a fresh, concise, grouped memory summary and a small set of high-value editable memory facts.",
        "Prefer explicit/manual memories over inferred memories. Consolidate repeated prior-chat evidence into durable facts instead of preserving one card per turn.",
        "Mark date-sensitive items stale or expired when appropriate. Do not include secrets, payment/access details, or sensitive traits unless the learner explicitly requested saving them and they are learning-relevant.",
        "Respect feedback: if the learner said do not mention something, suppress or omit it.",
      ].join("\n"),
      prompt: JSON.stringify({
        today: new Date().toISOString().slice(0, 10),
        existingSummary: input.existingSummary
          ? {
              summary: input.existingSummary.summary,
              sections: input.existingSummary.sections,
              lastSynthesizedAt: input.existingSummary.lastSynthesizedAt,
            }
          : null,
        memories: input.memories.slice(0, 120).map((memory) => ({
          id: memory.id,
          kind: memory.kind,
          category: memory.category,
          content: memory.content,
          tags: memory.tags,
          sourceType: memory.sourceType,
          freshnessStatus: memory.freshnessStatus,
          doNotMention: memory.doNotMention,
          pinned: memory.pinned,
          updatedAt: memory.updatedAt,
        })),
        recentTurns: input.turns.slice(0, 80).map((turn) => ({
          id: turn.id,
          topicId: turn.topicId,
          question: turn.question,
          answerExcerpt: turn.answerExcerpt,
          topics: turn.topics,
          updatedAt: turn.updatedAt,
        })),
        feedback: input.feedback.slice(0, 80).map((item) => ({
          memoryId: item.memoryId,
          chatTurnId: item.chatTurnId,
          summarySectionId: item.summarySectionId,
          action: item.action,
          note: item.note,
          createdAt: item.createdAt,
        })),
      }),
      temperature: 0.2,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(35_000),
    });
    return object;
  } catch {
    return buildFallbackMemorySynthesis(input);
  }
}

export function buildFallbackMemorySynthesis(input: {
  memories: Array<{
    id: string;
    category: string;
    content: string;
    tags?: string[] | null;
    sourceType?: string;
    sourceTurnIds?: string[] | null;
    doNotMention?: boolean;
    freshnessStatus?: string;
    salience?: number;
  }>;
  turns: Array<{ id: string; question: string; answerExcerpt: string; topics?: string[] | null }>;
  feedback?: Array<{ memoryId?: string | null; chatTurnId?: string | null; summarySectionId?: string | null; action: string }>;
}): MemorySynthesis {
  const suppressedMemoryIds = new Set(
    (input.feedback ?? [])
      .filter((item) => item.action === "dont_mention" || item.action === "not_relevant")
      .map((item) => item.memoryId)
      .filter(Boolean) as string[],
  );
  const usefulMemories = input.memories
    .filter(
      (memory) =>
        !memory.doNotMention &&
        !suppressedMemoryIds.has(memory.id) &&
        memory.freshnessStatus !== "expired" &&
        isUsefulMemoryContent(memory.content),
    )
    .toSorted((left, right) => (right.salience ?? 0) - (left.salience ?? 0));
  const grouped = new Map<string, typeof usefulMemories>();
  for (const memory of usefulMemories.slice(0, 40)) {
    const group = grouped.get(memory.category) ?? [];
    group.push(memory);
    grouped.set(memory.category, group);
  }

  const sections = [...grouped.entries()].slice(0, 8).map(([category, items]) => ({
    id: category,
    title: memoryCategoryTitle(category),
    category,
    summary: items
      .slice(0, 5)
      .map((memory) => displayMemoryContent(memory.content))
      .join(" "),
    sourceMemoryIds: items.slice(0, 12).map((memory) => memory.id),
    sourceTurnIds: [...new Set(items.flatMap((memory) => memory.sourceTurnIds ?? []))].slice(0, 12),
    doNotMention: false,
  }));

  const summary = sections.map((section) => `${section.title}: ${section.summary}`).join("\n");
  const priorChatMemories = usefulMemories.filter((memory) => memory.sourceType === "prior_chat").slice(0, 10);
  const memoryUpdates = priorChatMemories
    .map((memory) => ({
      action: "create" as const,
      content: compactText(displayMemoryContent(memory.content), 520),
      category: memory.category,
      sourceMemoryIds: [memory.id],
      sourceTurnIds: memory.sourceTurnIds ?? [],
      tags: ["synthesized"],
      confidence: 75,
      salience: 65,
      validFrom: null,
      validUntil: null,
      freshnessStatus: "current" as const,
    }))
    .filter((memory) => isUsefulMemoryContent(memory.content));

  return { summary, sections, memoryUpdates };
}

async function applyMemorySynthesis(userId: string, synthesis: MemorySynthesis) {
  const changedCategories = new Set<string>();
  const activeMemoriesById = synthesis.memoryUpdates.some((update) => update.id)
    ? new Map((await getActiveUserMemories(userId, 250)).map((memory) => [memory.id, memory]))
    : new Map();
  for (const update of synthesis.memoryUpdates) {
    if (!isUsefulMemoryContent(update.content) || looksSensitive(update.content)) continue;
    if (update.action === "suppress" && update.id) {
      const memory = await updateUserMemory(userId, update.id, {
        doNotMention: true,
        freshnessStatus: update.freshnessStatus,
      });
      if (memory) changedCategories.add(memory.category);
      continue;
    }

    const embedding = await embedText(update.content);
    const normalized = normalizeMemoryContent(update.content);
    const existing = update.id
      ? activeMemoriesById.get(update.id)
      : await findExistingMemoryByNormalized(userId, normalized);

    if (existing) {
      if (existing.sourceType === "manual" || existing.kind === "explicit" || existing.pinned) {
        await updateUserMemory(userId, existing.id, {
          sourceMemoryIds: [...new Set([...(existing.sourceMemoryIds ?? []), ...(update.sourceMemoryIds ?? [])])].slice(0, 30),
          sourceTurnIds: [...new Set([...(existing.sourceTurnIds ?? []), ...(update.sourceTurnIds ?? [])])].slice(0, 30),
          freshnessStatus: update.freshnessStatus,
          validFrom: parseOptionalDate(update.validFrom),
          validUntil: parseOptionalDate(update.validUntil),
        });
      } else {
        await updateUserMemory(userId, existing.id, {
          category: update.category,
          content: update.content,
          tags: [...new Set([...(existing.tags ?? []), ...update.tags, "synthesized"])].slice(0, 8),
          confidence: Math.max(existing.confidence, update.confidence),
          salience: Math.max(existing.salience, update.salience),
          sourceType: "synthesized",
          sourceMemoryIds: [...new Set([...(existing.sourceMemoryIds ?? []), ...(update.sourceMemoryIds ?? [])])].slice(0, 30),
          sourceTurnIds: [...new Set([...(existing.sourceTurnIds ?? []), ...(update.sourceTurnIds ?? [])])].slice(0, 30),
          freshnessStatus: update.freshnessStatus,
          validFrom: parseOptionalDate(update.validFrom),
          validUntil: parseOptionalDate(update.validUntil),
          embedding,
        });
      }
      changedCategories.add(existing.category);
      changedCategories.add(update.category);
    } else if (update.action !== "suppress") {
      await createUserMemory({
        userId,
        kind: "auto",
        category: update.category,
        content: update.content,
        tags: [...new Set([...update.tags, "synthesized"])].slice(0, 8),
        confidence: update.confidence,
        salience: update.salience,
        sourceType: "synthesized",
        sourceMemoryIds: update.sourceMemoryIds,
        sourceTurnIds: update.sourceTurnIds,
        freshnessStatus: update.freshnessStatus,
        validFrom: parseOptionalDate(update.validFrom),
        validUntil: parseOptionalDate(update.validUntil),
        embedding,
      });
      changedCategories.add(update.category);
    }

    if (update.sourceMemoryIds?.length && update.action !== "suppress") {
      const sourceMemories = await getUserMemoriesByIds(userId, update.sourceMemoryIds);
      await Promise.all(
        sourceMemories
          .filter((memory) => isChatHistoryMemory(memory))
          .map((memory) =>
            updateUserMemory(userId, memory.id, {
              doNotMention: true,
            }),
          ),
      );
    }
  }
  return changedCategories;
}

function normalizeSummarySection(section: MemorySynthesis["sections"][number]): UserMemorySummarySection {
  return {
    id: section.id || section.category,
    title: section.title || memoryCategoryTitle(section.category),
    category: section.category || "general",
    summary: section.summary,
    sourceMemoryIds: section.sourceMemoryIds ?? [],
    sourceTurnIds: section.sourceTurnIds ?? [],
    doNotMention: section.doNotMention ?? false,
  };
}

function memoryCategoryTitle(category: string) {
  return category
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shouldSynthesizeAfterTurn(changedCategoryCount: number) {
  return changedCategoryCount >= numberFromEnv(
    "MEMORY_POST_TURN_SYNTHESIS_THRESHOLD",
    quotaDefaults.memoryPostTurnSynthesisThreshold,
  );
}

function profileCategoriesForTurn(changedCategories: Set<string>) {
  const limit = numberFromEnv("MEMORY_PROFILE_COMPILE_LIMIT", 2);
  return [...changedCategories].slice(0, limit);
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function embedText(value: string, timeoutMs = defaultEmbeddingTimeoutMs) {
  if (!hasOpenAiApiKey()) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!(await hasLlmBudget("memory_embedding"))) return null;
  try {
    return await embedOpenAiText({
      model: resolveEmbeddingModelName(),
      value: trimmed.slice(0, 4000),
      dimensions: 512,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

function hasOpenAiApiKey() {
  return hasOpenAiRuntimeCredentials();
}

async function hasLlmBudget(reason: string) {
  const budget = await consumeDailyLlmBudget();
  if (budget.ok) return true;
  console.warn("llm_budget_exhausted", { reason, day: budget.day, limit: budget.limit });
  return false;
}

export async function buildMemoryEmbedding(value: string) {
  return embedText(value);
}

export function buildChatHistoryMemoryContent(input: {
  topicName: string;
  question: string;
  answerExcerpt?: string | null;
}) {
  const topicName = compactText(input.topicName || "a previous chat", 80);
  const question = compactText(cleanMemoryText(getVisibleMessageContent(input.question)), 220);
  const answerExcerpt = compactText(cleanMemoryText(input.answerExcerpt ?? ""), 260);
  if (!question) return "";
  return compactText(
    [
      `In ${topicName}, you asked: ${question}`,
      answerExcerpt ? `Inspir helped with: ${answerExcerpt}` : undefined,
    ]
      .filter(Boolean)
      .join(". "),
    560,
  );
}

async function upsertChatHistoryMemoryFromTurn(input: {
  userId: string;
  chatId: string;
  topicName: string;
  topicSlug?: string | null;
  userMessageId: string;
  sourceTurnId?: string | null;
  question: string;
  answerExcerpt?: string | null;
  topics?: string[];
  embedding?: number[] | null;
}) {
  const intent = detectMemoryIntent(input.question);
  if (intent === "explicit_remember" || intent === "explicit_forget" || intent === "ask_about_memory") {
    await insertMemoryEvent({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.userMessageId,
      eventType: "skipped",
      reason: "chat_history_memory_control_turn",
      metadata: { intent },
    });
    return null;
  }

  const content = buildChatHistoryMemoryContent(input);
  if (!isUsefulMemoryContent(content) || looksSensitive(content)) {
    await insertMemoryEvent({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.userMessageId,
      eventType: "skipped",
      reason: "chat_history_low_information",
      metadata: { question: compactText(input.question, 160) },
    });
    return null;
  }

  const sourceMemories = await findMemoriesBySourceMessage(input.userId, input.userMessageId);
  const existingChatHistory = sourceMemories.find((memory) => (memory.tags ?? []).includes("prior_chat"));
  if (existingChatHistory?.status === "deleted") return null;
  if (sourceMemories.some((memory) => memory.status === "active" && !(memory.tags ?? []).includes("prior_chat"))) {
    return null;
  }

  const category = categorizeMemoryContent(content);
  const tags = [
    "prior_chat",
    "chat_history",
    ...(input.topicSlug ? [input.topicSlug] : []),
    ...(input.topics ?? []).map((topic) => topic.toLowerCase().replace(/[^a-z0-9]+/g, "_")).filter(Boolean),
  ];
  const uniqueTags = [...new Set(tags)].slice(0, 8);

  if (existingChatHistory) {
    await updateUserMemory(input.userId, existingChatHistory.id, {
      kind: existingChatHistory.kind === "explicit" ? "explicit" : "auto",
      category,
      content,
      tags: [...new Set([...(existingChatHistory.tags ?? []), ...uniqueTags])].slice(0, 8),
      confidence: Math.max(existingChatHistory.confidence, 70),
      salience: Math.max(existingChatHistory.salience, 55),
      sourceType: "prior_chat",
      sourceTurnIds: input.sourceTurnId
        ? [...new Set([...(existingChatHistory.sourceTurnIds ?? []), input.sourceTurnId])]
        : existingChatHistory.sourceTurnIds ?? [],
      sourceChatId: input.chatId,
      sourceMessageId: input.userMessageId,
      embedding: input.embedding ?? (await embedText(content)),
    });
  } else {
    await createUserMemory({
      userId: input.userId,
      kind: "auto",
      category,
      content,
      tags: uniqueTags,
      confidence: 70,
      salience: 55,
      sourceType: "prior_chat",
      sourceTurnIds: input.sourceTurnId ? [input.sourceTurnId] : [],
      sourceChatId: input.chatId,
      sourceMessageId: input.userMessageId,
      embedding: input.embedding ?? (await embedText(content)),
    });
  }

  return category;
}

function fallbackExtraction(input: {
  userMessage: PersistedMessage;
  assistantMessage?: PersistedMessage;
  contextMessages?: PersistedMessage[];
}): MemoryExtraction {
  return extractDirectMemoryActionsFromTurn({
    userMessage: input.userMessage.content,
    assistantMessage: input.assistantMessage?.content,
    contextMessages: input.contextMessages,
  });
}

function mergeMemoryExtractions(primary: MemoryExtraction, secondary: MemoryExtraction): MemoryExtraction {
  if (primary.clearAll || primary.forget.length) return primary;
  if (secondary.clearAll || secondary.forget.length) return secondary;
  const memories = primary.memories.filter((memory) => isUsefulMemoryContent(memory.content));
  const seen = new Set(memories.map((memory) => normalizeMemoryContent(memory.content)));
  for (const memory of secondary.memories) {
    const key = normalizeMemoryContent(memory.content);
    if (!seen.has(key) && isUsefulMemoryContent(memory.content) && !looksSensitive(memory.content)) {
      memories.push(memory);
      seen.add(key);
    }
  }
  return {
    memories: memories.slice(0, 6),
    forget: [],
    clearAll: false,
    chatSummary: secondary.chatSummary,
  };
}

function buildChatTurnIndex(
  input: {
    topic: TopicLike;
    userMessage: PersistedMessage;
    assistantMessage: PersistedMessage;
  },
  summaryTopics: string[] = [],
) {
  const question = compactText(getVisibleMessageContent(input.userMessage.content), 700);
  const answerExcerpt = compactText(input.assistantMessage.content, 900);
  const topics: string[] = [];
  const seenTopics = new Set<string>();
  for (const topic of [input.topic.name, ...summaryTopics]) {
    const trimmed = topic.trim();
    if (!trimmed || seenTopics.has(trimmed)) continue;
    seenTopics.add(trimmed);
    topics.push(trimmed);
    if (topics.length === 8) break;
  }
  return {
    question,
    answerExcerpt,
    topics,
    searchableText: compactText(
      [`Mode: ${input.topic.name}`, `Learner question: ${question}`, `Inspir answer: ${answerExcerpt}`].join("\n"),
      1800,
    ),
  };
}

function inferExplicitMemoryFromCompletedTurn(input: {
  userMessage: string;
  assistantMessage?: string;
  contextMessages?: Array<Pick<PersistedMessage, "role" | "content">>;
}): MemoryExtraction {
  const empty: MemoryExtraction = { memories: [], forget: [], clearAll: false };
  const userText = getVisibleMessageContent(input.userMessage);
  if (!/\b(?:remember|remeber|rember|rememebr|remembr|remebr|keep in mind|save)\b/i.test(userText)) return empty;

  const favoriteKind = favoriteMemoryKind(userText);
  if (!favoriteKind) return empty;

  const assistantText = input.assistantMessage ?? "";
  const subject =
    extractFavoriteSubject(assistantText, favoriteKind) ??
    inferRecentNamedSubject(input.contextMessages ?? []);
  if (!subject || looksSensitive(subject)) return empty;

  const label = favoriteKind === "color" ? "favourite colour" : `favourite ${favoriteKind}`;
  return {
    memories: [
      {
        content: `${subject} is the learner's ${label}.`,
        category: "preferences",
        kind: "explicit",
        tags: ["explicit", "favorite", "favourite", favoriteKind],
        confidence: 95,
        salience: 90,
      },
    ],
    forget: [],
    clearAll: false,
  };
}

function favoriteMemoryKind(text: string) {
  if (!/\bfavo[u]?rite|fav\b/i.test(text)) return null;
  if (/\b(food|foods|foos|dish|meal|snack)\b/i.test(text)) return "food";
  if (/\b(colou?r|colors|colours)\b/i.test(text)) return "color";
  const match = text.match(/\bfavo[u]?rite\s+([a-z][a-z\s]{1,32})/i);
  const kind = cleanMemoryText(match?.[1] ?? "")
    .replace(/\b(is|are|was|were|that|this|it|its|my|mine|please)\b.*$/i, "")
    .trim()
    .toLowerCase();
  if (!kind || kind.length > 32) return null;
  return kind;
}

function extractFavoriteSubject(text: string, favoriteKind: string) {
  const kindPattern =
    favoriteKind === "food"
      ? "(?:food|foods|foos|dish|meal|snack)"
      : favoriteKind === "color"
        ? "(?:color|colour|colors|colours)"
        : escapeRegExp(favoriteKind);
  const favoriteSentencePattern = new RegExp(
    `(?:that\\s+)?(.{2,90}?)\\s+is\\s+(?:your|the learner'?s)\\s+favo[u]?rite(?:\\s+${kindPattern})?\\b`,
    "i",
  );
  const sentences = splitMemorySentences(text);

  for (const sentence of sentences) {
    const match = sentence.match(favoriteSentencePattern);
    const subject = sanitizeFavoriteSubject(match?.[1] ?? "");
    if (subject) return subject;
  }

  return null;
}

function inferRecentNamedSubject(contextMessages: Array<Pick<PersistedMessage, "role" | "content">>) {
  for (const message of [...contextMessages].reverse().slice(0, 6)) {
    const sentences = splitMemorySentences(getVisibleMessageContent(message.content));
    for (const sentence of sentences) {
      const match = sentence.match(/^(?:yes[, ]*)?([A-Z][A-Za-z0-9' -]{1,60}?)\s+is\s+(?:a|an|the|popular)\b/);
      const subject = sanitizeFavoriteSubject(match?.[1] ?? "");
      if (subject) return subject;
    }
  }
  return null;
}

function splitMemorySentences(text: string) {
  return text.split(/[\n.!?]+/).flatMap((sentence) => {
    const trimmed = sentence.trim();
    return trimmed ? [trimmed] : [];
  });
}

function sanitizeFavoriteSubject(value: string) {
  const subject = value
    .replace(/[*_`]/g, "")
    .replace(/^(yes|yep|sure|great|awesome|got it)[, ]*/i, "")
    .replace(/^(i'm glad to hear|glad to hear)\s+/i, "")
    .replace(/^(i'll|i will)\s+remember\s+(that\s+)?/i, "")
    .replace(/^(that|this)\s+/i, "")
    .trim();
  if (!subject || subject.length > 80) return null;
  if (/^(it|it's|its|this|that|they|them|he|she|your|learner|the learner)$/i.test(subject)) return null;
  if (/\b(remember|favo[u]?rite|forget|password|token|secret)\b/i.test(subject)) return null;
  return subject;
}

function isAmbiguousPronounMemory(value: string) {
  return /^(it|it's|its|this|that|that's|thats)\b/i.test(value.trim());
}

function isAskAboutMemoryQuestion(value: string) {
  return (
    /\bwhat(?:\s+all)?\s+(?:do\s+you\s+)?(?:know|remember|remeber|rember|rememebr|remembr|remebr)\s+about\s+me\b/i.test(
      value,
    ) ||
    /\bwhat\s+you\s+(?:know|remember|remeber|rember|rememebr|remembr|remebr)\s+about\s+me\b/i.test(value) ||
    /\bdo\s+you\s+(?:remember|remeber|rember|rememebr|remembr|remebr)\s+me\b/i.test(value)
  );
}

function isPriorChatRecallCue(value: string) {
  return (
    /\b(previous|past|earlier|last)\s+(chat|conversation|question|topic|lesson|session)s?\b/i.test(value) ||
    /\b(chat|conversation)\s+history\b/i.test(value) ||
    /\bwhat\s+(?:did|have)\s+i\s+(?:ask|say|tell|mention|learn|study|discuss|talk)(?:ed)?\b.*\b(before|previously|earlier|last time|past)\b/i.test(
      value,
    ) ||
    /\b(?:we|i)\s+(?:talked|discussed|covered|studied|learned)\b.*\b(before|previously|earlier|last time|past)\b/i.test(
      value,
    )
  );
}

function isDurableExplicitMemoryRequest(matchText: string, content: string) {
  return (
    /\b(?:remember|remeber|rember|rememebr|remembr|remebr|keep in mind|make a note)\s+that\b/i.test(matchText) ||
    /\bsave\s+(?:that|this)\b/i.test(matchText) ||
    /\b(i|i'm|im|my|mine|me|learner|user|you|your|we|our)\b/i.test(content) ||
    strongPersonalMemoryCuePattern.test(content)
  );
}

function cleanMemoryText(value: string) {
  return compactText(
    value
      .replace(/^(please|can you|could you|would you)\s+/i, "")
      .replace(/\s+(please)$/i, "")
      .replace(/[?.!]+$/g, "")
      .trim(),
    500,
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function looksSensitive(value: string) {
  return /\b(password|passcode|token|api key|secret|credit card|card number|cvv|bank account|ssn|social security)\b/i.test(
    value,
  );
}

function categorizeMemoryContent(content: string) {
  const text = content.toLowerCase();
  if (/\b(prefer|like|favorite|favourite|colour|color)\b/.test(text)) return "preferences";
  if (/\b(explain|tone|reply|answer|short|concise|detailed|step by step|visual)\b/.test(text)) return "interaction";
  if (/\b(project|building|working on|app|website|essay)\b/.test(text)) return "projects";
  if (/\b(goal|exam|test|gcse|revise|revision|prepare)\b/.test(text)) return "goals";
  if (/\b(struggle|confused|level|know|understand)\b/.test(text)) return "knowledge";
  return "general";
}

function fallbackChatSummary(input: {
  topic: TopicLike;
  userMessage: PersistedMessage;
  assistantMessage: PersistedMessage;
}) {
  const user = getVisibleMessageContent(input.userMessage.content).slice(0, 220);
  const assistant = input.assistantMessage.content.slice(0, 220);
  return {
    summary: `In ${input.topic.name}, the learner asked: ${user}${assistant ? ` The assistant helped with: ${assistant}` : ""}`,
    topics: [input.topic.name],
  };
}

function emptyMemoryRetrieval(
  settingsEnabled: boolean,
  gateReason: string,
  intent: MemoryIntent = "generic",
): MemoryRetrievalResult {
  const shouldIncludeStatus = intent === "explicit_remember" || intent === "explicit_forget" || intent === "ask_about_memory";
  return {
    settingsEnabled,
    used: shouldIncludeStatus,
    gateReason,
    status: shouldIncludeStatus
      ? {
          enabled: settingsEnabled,
          intent,
          shouldAcknowledge: intent === "explicit_remember" || intent === "explicit_forget",
        }
      : undefined,
    memories: [],
    summarySections: [],
    profiles: [],
    chatSummaries: [],
    priorChatTurns: [],
    sources: [],
    memoryIds: [],
    profileCategories: [],
    chatSummaryIds: [],
    chatTurnIds: [],
    summarySectionIds: [],
  };
}
