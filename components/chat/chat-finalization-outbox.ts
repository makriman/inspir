import {
  reconcilePersistedChatMessageId,
  type ChatMessage,
} from "./chat-message-model";

export const MAX_CLIENT_FINALIZED_ASSISTANT_CHARS = 12_000;
export const MAX_CLIENT_FINALIZED_ASSISTANT_UTF8_BYTES = 19_000;
export const MAX_CHAT_FINALIZATION_REQUEST_BYTES = 20 * 1_024;
export const CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_PER_ACCOUNT = 8;
export const CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_GLOBAL = 16;
export const CHAT_FINALIZATION_OUTBOX_MAX_BYTES_PER_ACCOUNT = 96 * 1_024;
const CHAT_FINALIZATION_OUTBOX_MAX_BYTES_GLOBAL = 192 * 1_024;
export const CHAT_FINALIZATION_OUTBOX_TTL_MS = 2 * 60 * 60 * 1_000;
export const CHAT_FINALIZATION_DRAIN_MAX_ITEMS = 4;
export const CHAT_FINALIZATION_ATTEMPTS_PER_DRAIN = 2;
export const CHAT_FINALIZATION_RETRY_DELAY_MS = 250;

const outboxDatabaseName = "inspir-chat-finalization-v1";
const outboxStoreName = "pending-finalizations";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxAccountIdChars = 128;
const maxTemporaryMessageIdChars = 160;
const maxRecordedAttempts = 100;

export type BoundedAssistantText = {
  text: string;
  codeUnits: number;
  characters: number;
  utf8Bytes: number;
  reachedLimit: boolean;
};

export type PendingChatFinalization = {
  id: string;
  accountId: string;
  aiRunId: string;
  chatId: string;
  userMessageId: string;
  temporaryMessageId: string;
  content: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  nextAttemptAt: number;
  byteSize: number;
};

export type ChatFinalizationOutbox = {
  enqueue(item: PendingChatFinalization, now?: number): Promise<void>;
  list(accountId: string, now?: number): Promise<PendingChatFinalization[]>;
  recordFailure(
    id: string,
    accountId: string,
    attempts: number,
    nextAttemptAt: number,
  ): Promise<void>;
  removeAfterSuccess(id: string, accountId: string): Promise<void>;
};

export type ChatFinalizationRetryResult = {
  attempted: number;
  succeeded: number;
  pending: number;
};

export function reconcilePendingChatFinalizationMessages(input: {
  currentAccountId: string;
  currentChatId: string | undefined;
  messages: readonly ChatMessage[];
  pending: PendingChatFinalization;
  persistedAssistantMessageId: string;
}) {
  if (
    input.currentAccountId !== input.pending.accountId ||
    input.currentChatId !== input.pending.chatId ||
    !uuidPattern.test(input.persistedAssistantMessageId)
  ) {
    return null;
  }

  let reconciled = false;
  const messages = input.messages.map((message) => {
    const messageAiRunId = message.metadata?.aiRunId;
    if (
      message.id !== input.pending.temporaryMessageId ||
      typeof messageAiRunId !== "string" ||
      messageAiRunId.toLowerCase() !== input.pending.aiRunId
    ) {
      return message;
    }
    reconciled = true;
    return reconcilePersistedChatMessageId(
      message,
      input.pending.temporaryMessageId,
      input.persistedAssistantMessageId.toLowerCase(),
    );
  });
  return reconciled ? messages : null;
}

export function emptyBoundedAssistantText(): BoundedAssistantText {
  return { text: "", codeUnits: 0, characters: 0, utf8Bytes: 0, reachedLimit: false };
}

export function appendBoundedAssistantText(
  current: BoundedAssistantText,
  addition: string,
): BoundedAssistantText {
  if (!addition || current.reachedLimit) return current;

  let codeUnits = current.codeUnits;
  let characters = current.characters;
  let utf8Bytes = current.utf8Bytes;
  let reachedLimit = false;
  const accepted: string[] = [];
  for (const rawCharacter of addition) {
    const codePoint = rawCharacter.codePointAt(0) ?? 0;
    const character = codePoint >= 0xd800 && codePoint <= 0xdfff ? "\ufffd" : rawCharacter;
    const characterBytes = utf8BytesForCharacter(character);
    if (
      codeUnits + character.length > MAX_CLIENT_FINALIZED_ASSISTANT_CHARS ||
      utf8Bytes + characterBytes > MAX_CLIENT_FINALIZED_ASSISTANT_UTF8_BYTES
    ) {
      reachedLimit = true;
      break;
    }
    accepted.push(character);
    codeUnits += character.length;
    characters += 1;
    utf8Bytes += characterBytes;
    if (
      codeUnits === MAX_CLIENT_FINALIZED_ASSISTANT_CHARS ||
      utf8Bytes === MAX_CLIENT_FINALIZED_ASSISTANT_UTF8_BYTES
    ) {
      reachedLimit = true;
      break;
    }
  }

  return {
    text: `${current.text}${accepted.join("")}`,
    codeUnits,
    characters,
    utf8Bytes,
    reachedLimit,
  };
}

export function createPendingChatFinalization(
  input: {
    accountId: string;
    aiRunId: string;
    chatId: string;
    userMessageId: string;
    temporaryMessageId: string;
    content: string;
  },
  now = Date.now(),
): PendingChatFinalization | null {
  const accountId = boundedIdentifier(input.accountId, maxAccountIdChars);
  const temporaryMessageId = boundedIdentifier(
    input.temporaryMessageId,
    maxTemporaryMessageIdChars,
  );
  if (
    !accountId ||
    !temporaryMessageId ||
    !uuidPattern.test(input.aiRunId) ||
    !uuidPattern.test(input.chatId) ||
    !uuidPattern.test(input.userMessageId) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > Number.MAX_SAFE_INTEGER - CHAT_FINALIZATION_OUTBOX_TTL_MS ||
    input.content.length > MAX_CLIENT_FINALIZED_ASSISTANT_CHARS ||
    !input.content.trim()
  ) {
    return null;
  }

  const contentMetrics = measureUnicodeText(input.content);
  if (
    contentMetrics.codeUnits > MAX_CLIENT_FINALIZED_ASSISTANT_CHARS ||
    contentMetrics.utf8Bytes > MAX_CLIENT_FINALIZED_ASSISTANT_UTF8_BYTES
  ) {
    return null;
  }
  const normalizedIds = {
    aiRunId: input.aiRunId.toLowerCase(),
    chatId: input.chatId.toLowerCase(),
    userMessageId: input.userMessageId.toLowerCase(),
  };
  const requestBody = finalizationRequestBody({
    ...normalizedIds,
    content: input.content,
  });
  if (utf8Bytes(requestBody) > MAX_CHAT_FINALIZATION_REQUEST_BYTES) return null;

  const base = {
    id: normalizedIds.aiRunId,
    accountId,
    ...normalizedIds,
    temporaryMessageId,
    content: input.content,
    createdAt: now,
    expiresAt: now + CHAT_FINALIZATION_OUTBOX_TTL_MS,
    attempts: 0,
    nextAttemptAt: now,
  };
  const byteSize = utf8Bytes(JSON.stringify(base));
  if (byteSize > CHAT_FINALIZATION_OUTBOX_MAX_BYTES_PER_ACCOUNT) return null;
  return { ...base, byteSize };
}

export function retainBoundedChatFinalizations(
  items: readonly PendingChatFinalization[],
  now = Date.now(),
) {
  const newestById = new Map<string, PendingChatFinalization>();
  for (const item of items) {
    const parsed = parsePendingChatFinalization(item);
    if (!parsed || parsed.expiresAt <= now) continue;
    const existing = newestById.get(parsed.id);
    if (!existing || existing.createdAt <= parsed.createdAt) newestById.set(parsed.id, parsed);
  }

  const newestFirst = [...newestById.values()].sort(
    (left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id),
  );
  const accountUsage = new Map<string, { items: number; bytes: number }>();
  const accountBounded: PendingChatFinalization[] = [];
  for (const item of newestFirst) {
    const usage = accountUsage.get(item.accountId) ?? { items: 0, bytes: 0 };
    if (
      usage.items >= CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_PER_ACCOUNT ||
      usage.bytes + item.byteSize > CHAT_FINALIZATION_OUTBOX_MAX_BYTES_PER_ACCOUNT
    ) {
      continue;
    }
    accountUsage.set(item.accountId, {
      items: usage.items + 1,
      bytes: usage.bytes + item.byteSize,
    });
    accountBounded.push(item);
  }

  const retained: PendingChatFinalization[] = [];
  let globalBytes = 0;
  for (const item of accountBounded) {
    if (
      retained.length >= CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_GLOBAL ||
      globalBytes + item.byteSize > CHAT_FINALIZATION_OUTBOX_MAX_BYTES_GLOBAL
    ) {
      continue;
    }
    retained.push(item);
    globalBytes += item.byteSize;
  }
  return retained.sort(
    (left, right) => left.nextAttemptAt - right.nextAttemptAt || left.createdAt - right.createdAt,
  );
}

export function createBrowserChatFinalizationOutbox(
  factory: IDBFactory = indexedDB,
): ChatFinalizationOutbox {
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = () => {
    databasePromise ??= openOutboxDatabase(factory);
    return databasePromise;
  };

  return {
    async enqueue(item, now = Date.now()) {
      const db = await database();
      await rewriteOutbox(db, (current) => retainBoundedChatFinalizations([...current, item], now));
    },
    async list(accountId, now = Date.now()) {
      const db = await database();
      const retained = await rewriteOutbox(db, (current) =>
        retainBoundedChatFinalizations(current, now),
      );
      return retained.filter((item) => item.accountId === accountId);
    },
    async recordFailure(id, accountId, attempts, nextAttemptAt) {
      const db = await database();
      await mutateOutboxItem(db, id, (current) => {
        if (current.accountId !== accountId) return current;
        return {
          ...current,
          attempts: Number.isFinite(attempts)
            ? Math.max(0, Math.min(maxRecordedAttempts, Math.trunc(attempts)))
            : current.attempts,
          nextAttemptAt: Number.isSafeInteger(nextAttemptAt)
            ? Math.max(current.createdAt, Math.min(current.expiresAt, nextAttemptAt))
            : current.nextAttemptAt,
        };
      });
    },
    async removeAfterSuccess(id, accountId) {
      const db = await database();
      await removeOwnedOutboxItem(db, id, accountId);
    },
  };
}

export async function retryPendingChatFinalizations(input: {
  outbox: ChatFinalizationOutbox;
  accountId: string;
  post: (item: PendingChatFinalization) => Promise<string>;
  onSuccess?: (item: PendingChatFinalization, assistantMessageId: string) => void;
  onlyId?: string;
  force?: boolean;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<ChatFinalizationRetryResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? sleepFor;
  const listed = await input.outbox.list(input.accountId, now());
  const candidates = listed
    .filter((item) => (!input.onlyId || item.id === input.onlyId) && (input.force || item.nextAttemptAt <= now()))
    .slice(0, input.onlyId ? 1 : CHAT_FINALIZATION_DRAIN_MAX_ITEMS);
  let attempted = 0;
  let succeeded = 0;

  for (const item of candidates) {
    let attempts = item.attempts;
    for (let turnAttempt = 0; turnAttempt < CHAT_FINALIZATION_ATTEMPTS_PER_DRAIN; turnAttempt += 1) {
      if (turnAttempt > 0) await sleep(CHAT_FINALIZATION_RETRY_DELAY_MS);
      attempted += 1;
      let assistantMessageId: string;
      try {
        assistantMessageId = await input.post(item);
        await input.outbox.removeAfterSuccess(item.id, input.accountId);
      } catch {
        attempts = Math.min(maxRecordedAttempts, attempts + 1);
        const retryAt = Math.min(
          item.expiresAt,
          now() + Math.min(5 * 60_000, 5_000 * 2 ** Math.min(6, attempts - 1)),
        );
        await input.outbox.recordFailure(item.id, input.accountId, attempts, retryAt);
        continue;
      }
      succeeded += 1;
      try {
        input.onSuccess?.(item, assistantMessageId);
      } catch {
        // Persistence is authoritative; a stale or unmounted UI can reconcile later.
      }
      break;
    }
  }

  const pending = (await input.outbox.list(input.accountId, now())).length;
  return { attempted, succeeded, pending };
}

export async function postPendingChatFinalization(
  item: PendingChatFinalization,
  fetchImplementation: typeof fetch = fetch,
) {
  const response = await fetchImplementation("/api/chat/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: finalizationRequestBody(item),
    credentials: "same-origin",
    keepalive: true,
    signal: AbortSignal.timeout(8_000),
  });
  const value: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !isRecord(value) ||
    value.ok !== true ||
    typeof value.assistantMessageId !== "string" ||
    !uuidPattern.test(value.assistantMessageId)
  ) {
    throw new Error("Authenticated chat completion could not be saved");
  }
  return value.assistantMessageId.toLowerCase();
}

function finalizationRequestBody(input: {
  aiRunId: string;
  chatId: string;
  userMessageId: string;
  content: string;
}) {
  return JSON.stringify({
    aiRunId: input.aiRunId,
    chatId: input.chatId,
    userMessageId: input.userMessageId,
    content: input.content,
  });
}

function measureUnicodeText(value: string) {
  let characters = 0;
  let utf8Length = 0;
  for (const character of value) {
    characters += 1;
    utf8Length += utf8BytesForCharacter(character);
  }
  return { codeUnits: value.length, characters, utf8Bytes: utf8Length };
}

function utf8BytesForCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function boundedIdentifier(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value.length > maxLength) return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= maxLength ? normalized : null;
}

function parsePendingChatFinalization(value: unknown): PendingChatFinalization | null {
  if (!isRecord(value)) return null;
  const created = createPendingChatFinalization(
    {
      accountId: typeof value.accountId === "string" ? value.accountId : "",
      aiRunId: typeof value.aiRunId === "string" ? value.aiRunId : "",
      chatId: typeof value.chatId === "string" ? value.chatId : "",
      userMessageId: typeof value.userMessageId === "string" ? value.userMessageId : "",
      temporaryMessageId:
        typeof value.temporaryMessageId === "string" ? value.temporaryMessageId : "",
      content: typeof value.content === "string" ? value.content : "",
    },
    typeof value.createdAt === "number" ? value.createdAt : Number.NaN,
  );
  if (
    !created ||
    value.id !== created.id ||
    value.expiresAt !== created.expiresAt ||
    value.byteSize !== created.byteSize ||
    typeof value.attempts !== "number" ||
    !Number.isSafeInteger(value.attempts) ||
    value.attempts < 0 ||
    value.attempts > maxRecordedAttempts ||
    typeof value.nextAttemptAt !== "number" ||
    !Number.isSafeInteger(value.nextAttemptAt) ||
    value.nextAttemptAt < created.createdAt ||
    value.nextAttemptAt > created.expiresAt
  ) {
    return null;
  }
  return {
    ...created,
    attempts: value.attempts,
    nextAttemptAt: value.nextAttemptAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openOutboxDatabase(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(outboxDatabaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(outboxStoreName)) {
        request.result.createObjectStore(outboxStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open chat finalization outbox"));
    request.onblocked = () => reject(new Error("Chat finalization outbox is blocked"));
  });
}

function rewriteOutbox(
  database: IDBDatabase,
  select: (items: PendingChatFinalization[]) => PendingChatFinalization[],
) {
  return new Promise<PendingChatFinalization[]>((resolve, reject) => {
    const transaction = database.transaction(outboxStoreName, "readwrite");
    const store = transaction.objectStore(outboxStoreName);
    const request = store.getAll(undefined, CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_GLOBAL + 1);
    let selected: PendingChatFinalization[] = [];
    request.onsuccess = () => {
      selected = select(request.result.flatMap((value) => {
        const parsed = parsePendingChatFinalization(value);
        return parsed ? [parsed] : [];
      }));
      store.clear();
      for (const item of selected) store.put(item);
    };
    transaction.oncomplete = () => resolve(selected);
    transaction.onerror = () => reject(transaction.error ?? new Error("Chat finalization outbox failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Chat finalization outbox aborted"));
  });
}

function mutateOutboxItem(
  database: IDBDatabase,
  id: string,
  mutate: (item: PendingChatFinalization) => PendingChatFinalization,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(outboxStoreName, "readwrite");
    const store = transaction.objectStore(outboxStoreName);
    const request = store.get(id);
    request.onsuccess = () => {
      const current = parsePendingChatFinalization(request.result);
      if (current) store.put(mutate(current));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Chat finalization outbox failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Chat finalization outbox aborted"));
  });
}

function removeOwnedOutboxItem(database: IDBDatabase, id: string, accountId: string) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(outboxStoreName, "readwrite");
    const store = transaction.objectStore(outboxStoreName);
    const request = store.get(id);
    request.onsuccess = () => {
      const current = parsePendingChatFinalization(request.result);
      if (current?.accountId === accountId) store.delete(id);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Chat finalization outbox failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Chat finalization outbox aborted"));
  });
}

function sleepFor(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
