import { openai, type OpenAIEmbeddingModelOptions } from "@ai-sdk/openai";
import { embed, generateObject } from "ai";
import { z } from "zod";
import type { Message, Topic } from "@/lib/db/schema";
import {
  clearUserMemories,
  createUserMemory,
  deleteUserMemoryProfile,
  deleteUserMemory,
  deleteMatchingChatMemoryTurnsByText,
  ensureUserMemorySettings,
  findExistingMemoryByNormalized,
  findMatchingMemoriesByText,
  getActiveMemoriesByCategory,
  getActiveUserMemories,
  getUserMemoryProfiles,
  insertMemoryEvent,
  lexicalMemoryRank,
  markChatTurnsUsed,
  markMemoriesUsed,
  memoryUseMetadata,
  normalizeMemoryContent,
  searchChatMemoryTurnsByEmbedding,
  searchChatMemoryTurnsByText,
  searchChatSummariesByEmbedding,
  searchUserMemoriesByEmbedding,
  updateUserMemory,
  upsertChatMemorySummary,
  upsertChatMemoryTurn,
  upsertUserMemoryProfile,
  type ChatSummarySearchResult,
  type ChatTurnSearchResult,
  type MemorySearchResult,
} from "@/lib/db/memory";
import { getVisibleMessageContent } from "@/lib/ai/visible-content";
import { resolveEmbeddingModelName, resolveModelName } from "@/lib/ai/model-router";

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
  profiles: PromptMemoryProfile[];
  chatSummaries: PromptChatSummary[];
  priorChatTurns: PromptPriorChatTurn[];
};

export type MemoryRetrievalResult = MemoryPromptContext & {
  settingsEnabled: boolean;
  memoryIds: string[];
  profileCategories: string[];
  chatSummaryIds: string[];
  chatTurnIds: string[];
};

const memoryGateSchema = z.object({
  useMemory: z.boolean(),
  reason: z.string().min(1),
  query: z.string().trim().max(500).optional(),
});

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

type MemoryExtraction = z.infer<typeof memoryExtractionSchema>;

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
  return memoryRelevanceTerms.some((term) => text.includes(term));
}

export async function retrieveRelevantMemoryForTurn(input: {
  userId: string;
  chatId: string;
  userMessageId: string;
  message: string;
  topic: TopicLike;
  contextMessages: PersistedMessage[];
}): Promise<MemoryRetrievalResult> {
  const intent = detectMemoryIntent(input.message);
  const settings = await ensureUserMemorySettings(input.userId);
  if (!settings.enabled) {
    await insertMemoryEvent({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.userMessageId,
      eventType: "skipped",
      reason: "memory_disabled",
    });
    return emptyMemoryRetrieval(false, "Memory is disabled for this user.", intent);
  }

  const gate = await shouldUseMemory({
    message: input.message,
    topicName: input.topic.name,
    contextMessages: input.contextMessages,
    intent,
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
  const [embedding, rawMemories, allProfiles] = await Promise.all([
    embedText(query),
    getActiveUserMemories(input.userId, 100),
    getUserMemoryProfiles(input.userId),
  ]);
  const allMemories = rawMemories.filter((memory) => isUsefulMemoryContent(memory.content));

  let selectedMemories: MemorySearchResult[] = [];
  let selectedSummaries: ChatSummarySearchResult[] = [];
  let selectedTurns: ChatTurnSearchResult[] = [];

  if (embedding) {
    try {
      [selectedMemories, selectedSummaries, selectedTurns] = await Promise.all([
        searchUserMemoriesByEmbedding(input.userId, embedding, 8),
        searchChatSummariesByEmbedding(input.userId, embedding, 4),
        searchChatMemoryTurnsByEmbedding(input.userId, embedding, input.chatId, 8),
      ]);
    } catch {
      selectedMemories = lexicalMemoryRank(query, allMemories, 8);
      selectedSummaries = [];
      selectedTurns = await searchChatMemoryTurnsByText(input.userId, query, input.chatId, 4);
    }
  } else {
    selectedMemories = lexicalMemoryRank(query, allMemories, 8);
    selectedTurns = await searchChatMemoryTurnsByText(input.userId, query, input.chatId, 4);
  }

  selectedMemories = selectedMemories.filter((memory) => isUsefulMemoryContent(memory.content));

  const explicit = selectedMemories.filter((memory) => memory.kind === "explicit").slice(0, 2);
  const auto = selectedMemories
    .filter((memory) => memory.kind !== "explicit" && !explicit.some((selected) => selected.id === memory.id))
    .slice(0, 4);
  const memories = [...explicit, ...auto].slice(0, 5);

  const categories = [...new Set(memories.map((memory) => memory.category))];
  const profiles = allProfiles
    .filter((profile) => (categories.length ? categories.includes(profile.category) : intent === "ask_about_memory"))
    .slice(0, 1)
    .map((profile) => ({
      category: profile.category,
      summary: profile.summary,
    }));

  const chatSummaries = selectedSummaries
    .filter((summary) => summary.chatId !== input.chatId)
    .slice(0, 2)
    .map((summary) => ({
      chatId: summary.chatId,
      summary: summary.summary,
      topics: summary.topics ?? [],
    }));

  const priorChatTurns = selectedTurns.slice(0, 4).map((turn) => ({
    id: turn.id,
    chatId: turn.chatId,
    question: turn.question,
    answerExcerpt: turn.answerExcerpt,
    topics: turn.topics ?? [],
  }));

  const promptMemories = memories.map((memory) => ({
    id: memory.id,
    kind: memory.kind,
    category: memory.category,
    content: memory.content,
    tags: memory.tags ?? [],
  }));

  if (promptMemories.length) {
    await markMemoriesUsed({
      userId: input.userId,
      memoryIds: promptMemories.map((memory) => memory.id),
      chatId: input.chatId,
      messageId: input.userMessageId,
      reason: gate.reason,
    });
  }
  if (priorChatTurns.length) {
    await markChatTurnsUsed({
      userId: input.userId,
      turnIds: priorChatTurns.map((turn) => turn.id),
      chatId: input.chatId,
      messageId: input.userMessageId,
      reason: gate.reason,
    });
  }

  const shouldIncludeStatus = intent === "explicit_remember" || intent === "explicit_forget" || intent === "ask_about_memory";
  const used =
    shouldIncludeStatus ||
    promptMemories.length > 0 ||
    profiles.length > 0 ||
    chatSummaries.length > 0 ||
    priorChatTurns.length > 0;

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
    profiles,
    chatSummaries,
    priorChatTurns,
    memoryIds: promptMemories.map((memory) => memory.id),
    profileCategories: profiles.map((profile) => profile.category),
    chatSummaryIds: chatSummaries.map((summary) => summary.chatId),
    chatTurnIds: priorChatTurns.map((turn) => turn.id),
  };
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
  if (!settings.enabled) return;

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

  const summary = extraction.chatSummary ?? fallbackChatSummary(input);
  const turnIndex = extraction.forget.length ? null : buildChatTurnIndex(input, summary.topics);
  const [summaryEmbedding, turnEmbedding] = await Promise.all([
    summary.summary ? embedText(summary.summary) : Promise.resolve(null),
    turnIndex ? embedText(turnIndex.searchableText) : Promise.resolve(null),
  ]);
  const persistenceTasks: Promise<unknown>[] = [];
  if (summary.summary) {
    persistenceTasks.push(
      upsertChatMemorySummary({
        chatId: input.chatId,
        userId: input.userId,
        topicId: input.topic.id,
        summary: summary.summary,
        topics: summary.topics,
        sourceMessageCount: input.contextMessages.length + 2,
        lastMessageId: input.assistantMessage.id,
        embedding: summaryEmbedding,
      }),
    );
  }
  if (turnIndex) {
    persistenceTasks.push(
      upsertChatMemoryTurn({
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
      }),
    );
  }
  await Promise.all(persistenceTasks);
  await Promise.all([...changedCategories].map((category) => compileUserMemoryProfile(input.userId, category)));
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
  if (!process.env.OPENAI_API_KEY) {
    return {
      useMemory: fallback,
      reason: fallback ? "Heuristic found a personal, continuity, remember, or forget cue." : "Generic turn.",
      query: input.message,
    };
  }

  try {
    const result = await generateObject({
      model: openai(resolveModelName("structured")),
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
    return result.object;
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
  if (!process.env.OPENAI_API_KEY) return fallbackExtraction(input);

  const existing = await getActiveUserMemories(input.userId, 60);
  try {
    const result = await generateObject({
      model: openai(resolveModelName("structured")),
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
    return mergeMemoryExtractions(direct, result.object);
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

  if (!process.env.OPENAI_API_KEY) {
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
    const result = await generateObject({
      model: openai(resolveModelName("structured")),
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
      summary: result.object.summary,
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

async function embedText(value: string) {
  if (!process.env.OPENAI_API_KEY) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const result = await embed({
      model: openai.embedding(resolveEmbeddingModelName()),
      value: trimmed.slice(0, 4000),
      providerOptions: {
        openai: {
          dimensions: 512,
        } satisfies OpenAIEmbeddingModelOptions,
      },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(10_000),
    });
    return result.embedding;
  } catch {
    return null;
  }
}

export async function buildMemoryEmbedding(value: string) {
  return embedText(value);
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
    profiles: [],
    chatSummaries: [],
    priorChatTurns: [],
    memoryIds: [],
    profileCategories: [],
    chatSummaryIds: [],
    chatTurnIds: [],
  };
}
