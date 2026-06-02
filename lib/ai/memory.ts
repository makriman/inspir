import { openai, type OpenAIEmbeddingModelOptions } from "@ai-sdk/openai";
import { embed, generateObject } from "ai";
import { z } from "zod";
import type { Message, Topic } from "@/lib/db/schema";
import {
  clearUserMemories,
  createUserMemory,
  deleteUserMemoryProfile,
  deleteUserMemory,
  ensureUserMemorySettings,
  findExistingMemoryByNormalized,
  findMatchingMemoriesByText,
  getActiveMemoriesByCategory,
  getActiveUserMemories,
  getUserMemoryProfiles,
  insertMemoryEvent,
  lexicalMemoryRank,
  markMemoriesUsed,
  memoryUseMetadata,
  normalizeMemoryContent,
  searchChatSummariesByEmbedding,
  searchUserMemoriesByEmbedding,
  updateUserMemory,
  upsertChatMemorySummary,
  upsertUserMemoryProfile,
  type ChatSummarySearchResult,
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

export type MemoryPromptContext = {
  used: boolean;
  gateReason?: string;
  memories: PromptMemory[];
  profiles: PromptMemoryProfile[];
  chatSummaries: PromptChatSummary[];
};

export type MemoryRetrievalResult = MemoryPromptContext & {
  settingsEnabled: boolean;
  memoryIds: string[];
  profileCategories: string[];
  chatSummaryIds: string[];
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

const memoryRelevanceTerms = [
  "remember",
  "forget",
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

export function shouldUseMemoryHeuristic(message: string) {
  const text = message.toLowerCase();
  if (/\b(remember|forget)\b/.test(text)) return true;
  if (/\b(my|mine|i|me)\b/.test(text) && /\b(project|exam|essay|goal|style|preference|progress|plan|work)\b/.test(text)) {
    return true;
  }
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
  const settings = await ensureUserMemorySettings(input.userId);
  if (!settings.enabled) {
    await insertMemoryEvent({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.userMessageId,
      eventType: "skipped",
      reason: "memory_disabled",
    });
    return emptyMemoryRetrieval(false, "Memory is disabled for this user.");
  }

  const gate = await shouldUseMemory({
    message: input.message,
    topicName: input.topic.name,
    contextMessages: input.contextMessages,
  });

  if (!gate.useMemory) {
    await insertMemoryEvent({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.userMessageId,
      eventType: "skipped",
      reason: gate.reason,
    });
    return emptyMemoryRetrieval(true, gate.reason);
  }

  const query = gate.query || input.message;
  const embedding = await embedText(query);
  const [allMemories, allProfiles] = await Promise.all([
    getActiveUserMemories(input.userId, 100),
    getUserMemoryProfiles(input.userId),
  ]);

  let selectedMemories: MemorySearchResult[] = [];
  let selectedSummaries: ChatSummarySearchResult[] = [];

  if (embedding) {
    try {
      [selectedMemories, selectedSummaries] = await Promise.all([
        searchUserMemoriesByEmbedding(input.userId, embedding, 8),
        searchChatSummariesByEmbedding(input.userId, embedding, 4),
      ]);
    } catch {
      selectedMemories = lexicalMemoryRank(query, allMemories, 8);
      selectedSummaries = [];
    }
  } else {
    selectedMemories = lexicalMemoryRank(query, allMemories, 8);
  }

  const explicit = selectedMemories.filter((memory) => memory.kind === "explicit").slice(0, 2);
  const auto = selectedMemories
    .filter((memory) => memory.kind !== "explicit")
    .filter((memory) => !explicit.some((selected) => selected.id === memory.id))
    .slice(0, 4);
  const memories = [...explicit, ...auto].slice(0, 5);

  const categories = [...new Set(memories.map((memory) => memory.category))];
  const profiles = allProfiles
    .filter((profile) => categories.includes(profile.category))
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

  return {
    settingsEnabled: true,
    used: promptMemories.length > 0 || profiles.length > 0 || chatSummaries.length > 0,
    gateReason: gate.reason,
    memories: promptMemories,
    profiles,
    chatSummaries,
    memoryIds: promptMemories.map((memory) => memory.id),
    profileCategories: profiles.map((profile) => profile.category),
    chatSummaryIds: chatSummaries.map((summary) => summary.chatId),
  };
}

export function formatMemoryPromptContext(context: MemoryPromptContext | undefined) {
  if (!context?.used) return undefined;
  const lines = [
    "\nRelevant learner memory:",
    "Use this only when it helps the current request. The learner's current message and current chat override older memory. Explicit saved memories have priority over automatic summaries.",
  ];

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

  return lines.join("\n");
}

export function memoryRunMetadata(retrieval: MemoryRetrievalResult) {
  return memoryUseMetadata({
    used: retrieval.used,
    gateReason: retrieval.gateReason,
    memoryIds: retrieval.memoryIds,
    profileCategories: retrieval.profileCategories,
    chatSummaryIds: retrieval.chatSummaryIds,
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

  for (const forget of extraction.forget) {
    const matches = await findMatchingMemoriesByText(input.userId, forget.query, 10);
    for (const memory of matches) {
      await deleteUserMemory(input.userId, memory.id);
      changedCategories.add(memory.category);
    }
  }

  for (const candidate of extraction.memories) {
    const normalized = normalizeMemoryContent(candidate.content);
    const existing = await findExistingMemoryByNormalized(input.userId, normalized);
    const embedding = await embedText(candidate.content);

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
    changedCategories.add(candidate.category);
  }

  const summary = extraction.chatSummary ?? fallbackChatSummary(input);
  if (summary.summary) {
    await upsertChatMemorySummary({
      chatId: input.chatId,
      userId: input.userId,
      topicId: input.topic.id,
      summary: summary.summary,
      topics: summary.topics,
      sourceMessageCount: input.contextMessages.length + 2,
      lastMessageId: input.assistantMessage.id,
      embedding: await embedText(summary.summary),
    });
  }

  for (const category of changedCategories) {
    await compileUserMemoryProfile(input.userId, category);
  }
}

async function shouldUseMemory(input: {
  message: string;
  topicName: string;
  contextMessages: PersistedMessage[];
}) {
  const fallback = shouldUseMemoryHeuristic(input.message);
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
        "Return true only when memory could materially improve the answer: personal preferences, prior projects, progress, goals, learning style, continuity, remember/forget requests, or direct questions about what the assistant knows.",
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
}): Promise<z.infer<typeof memoryExtractionSchema>> {
  if (!process.env.OPENAI_API_KEY) return fallbackExtraction(input.userMessage.content);

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
    return result.object;
  } catch {
    return fallbackExtraction(input.userMessage.content);
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

function fallbackExtraction(message: string): z.infer<typeof memoryExtractionSchema> {
  const text = getVisibleMessageContent(message).trim();
  if (/^\s*forget\b/i.test(text)) {
    const query = text.replace(/^\s*forget\s+(that\s+)?/i, "").trim();
    return {
      memories: [],
      forget: query ? [{ query, reason: "Explicit forget request." }] : [],
      clearAll: /\beverything|all memories|all memory\b/i.test(text),
    };
  }

  const rememberMatch = text.match(/\bremember\s+(?:that\s+)?(.+)/i);
  if (!rememberMatch?.[1]) {
    return { memories: [], forget: [], clearAll: false };
  }

  return {
    memories: [
      {
        content: rememberMatch[1].trim().slice(0, 500),
        category: "general",
        kind: "explicit",
        tags: ["explicit"],
        confidence: 95,
        salience: 85,
      },
    ],
    forget: [],
    clearAll: false,
  };
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

function emptyMemoryRetrieval(settingsEnabled: boolean, gateReason: string): MemoryRetrievalResult {
  return {
    settingsEnabled,
    used: false,
    gateReason,
    memories: [],
    profiles: [],
    chatSummaries: [],
    memoryIds: [],
    profileCategories: [],
    chatSummaryIds: [],
  };
}
