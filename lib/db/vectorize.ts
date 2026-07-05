import { getVectorIndex } from "./client";

export type MemoryVectorNamespace = "user_memories" | "chat_memory_summaries" | "chat_memory_turns";

const VECTORIZE_FULL_METADATA_TOP_K_LIMIT = 50;

export function vectorizeFullMetadataTopK(topK: number) {
  const normalized = Number.isFinite(topK) ? Math.floor(topK) : 1;
  return Math.min(Math.max(normalized, 1), VECTORIZE_FULL_METADATA_TOP_K_LIMIT);
}

function memoryVectorId(namespace: MemoryVectorNamespace, rowId: string) {
  return `${namespace}:${rowId}`;
}

function rowIdFromMemoryVectorId(namespace: MemoryVectorNamespace, vectorId: string) {
  const prefix = `${namespace}:`;
  return vectorId.startsWith(prefix) ? vectorId.slice(prefix.length) : vectorId;
}

export async function upsertMemoryVector(input: {
  namespace: MemoryVectorNamespace;
  rowId: string;
  embedding: number[] | null | undefined;
  userId: string;
  chatId?: string | null;
  topicId?: string | null;
}) {
  if (!input.embedding?.length) return;
  await getVectorIndex().upsert([
    {
      id: memoryVectorId(input.namespace, input.rowId),
      namespace: input.namespace,
      values: input.embedding,
      metadata: {
        namespace: input.namespace,
        rowId: input.rowId,
        userId: input.userId,
        ...(input.chatId ? { chatId: input.chatId } : {}),
        ...(input.topicId ? { topicId: input.topicId } : {}),
      },
    },
  ]);
}

export async function deleteMemoryVectors(namespace: MemoryVectorNamespace, rowIds: string[]) {
  const ids = [...new Set(rowIds)].filter(Boolean).map((rowId) => memoryVectorId(namespace, rowId));
  if (!ids.length) return;
  await getVectorIndex().deleteByIds(ids);
}

export async function queryMemoryVectors(input: {
  namespace: MemoryVectorNamespace;
  userId: string;
  embedding: number[];
  topK: number;
  excludeChatId?: string;
}) {
  const result = await getVectorIndex().query(input.embedding, {
    namespace: input.namespace,
    topK: vectorizeFullMetadataTopK(input.topK),
    returnMetadata: "all",
    filter: { userId: input.userId },
  });
  return result.matches
    .filter((match) => {
      const metadata = match.metadata as Record<string, unknown> | undefined;
      return !input.excludeChatId || metadata?.chatId !== input.excludeChatId;
    })
    .map((match) => ({
      rowId: rowIdFromMemoryVectorId(input.namespace, match.id),
      score: match.score,
    }));
}
