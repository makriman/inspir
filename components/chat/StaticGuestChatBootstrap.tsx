"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ActivityRun } from "@/components/chat/activity-model";
import { ChatClient } from "@/components/chat/ChatClient";
import type { ChatMessage } from "@/components/chat/chat-message-model";
import {
  profileFromApiUser,
  type ApiProfileUser,
  type UserProfile,
} from "@/components/chat/profile-model";
import type { Topic } from "@/components/chat/topic-model";
import { setClientLanguagePreferenceCookie } from "@/components/i18n/client-language-preference";
import {
  parsePublicTopicsResponse,
} from "@/lib/content/public-topic-contract";
import { topicSlugFromChatLocation } from "@/lib/content/topic-path";
import { supportedLanguages, type SupportedLanguage } from "@/lib/content/languages";
import {
  getChatLocaleRedirect,
  parseSupportedChatLanguage,
  type ChatLocaleRedirect,
} from "@/lib/i18n/chat-locale-reconciliation";
import type { MainAppTranslationBundle } from "@/lib/i18n/main-app-types";
import { localeCookieName } from "@/lib/i18n/routing";

type StaticGuestChatBootstrapProps = {
  defaultTopicId: string;
  language: SupportedLanguage;
  translationBundleUrl: string;
  translationSourceHash: string;
  loadingLabel: string;
  loadErrorLabel: string;
  retryLabel: string;
  authErrorLabel: string;
};

type StaticChatBootstrapData = {
  topics: Topic[];
  translationBundle: MainAppTranslationBundle;
  authMode: "authenticated" | "guest";
  user: UserProfile;
  initialChatId?: string;
  initialMessages: ChatMessage[];
  initialMessagePage: StaticChatMessagePage | null;
  initialActivityRun: ActivityRun | null;
  initialTopicId?: string;
  localeRedirect: ChatLocaleRedirect | null;
};

type StaticChatMessagePage = {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
};

type StaticChatBootstrapSnapshot =
  | { status: "loading"; data: null }
  | { status: "ready"; data: StaticChatBootstrapData }
  | { status: "failed"; data: null };

type StaticChatBootstrapResource = {
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): StaticChatBootstrapSnapshot;
  getServerSnapshot(): StaticChatBootstrapSnapshot;
};

const loadingBootstrapSnapshot: StaticChatBootstrapSnapshot = { status: "loading", data: null };
const staticChatBootstrapResources = new Map<string, StaticChatBootstrapResource>();

export function StaticGuestChatBootstrap({
  defaultTopicId,
  language,
  translationBundleUrl,
  translationSourceHash,
  loadingLabel,
  loadErrorLabel,
  retryLabel,
  authErrorLabel,
}: StaticGuestChatBootstrapProps) {
  const redirectingToRef = useRef<string | null>(null);
  const location = useSyncExternalStore(subscribeToLocation, readBrowserLocation, readServerLocation);
  const bootstrapResource = getStaticChatBootstrapResource(
    language,
    translationBundleUrl,
    translationSourceHash,
    location ?? "",
  );
  const bootstrapSnapshot = useSyncExternalStore(
    bootstrapResource.subscribe,
    bootstrapResource.getSnapshot,
    bootstrapResource.getServerSnapshot,
  );
  const bootstrapData = bootstrapSnapshot.status === "ready" ? bootstrapSnapshot.data : null;
  const bootstrapFailed = bootstrapSnapshot.status === "failed";
  const topics = bootstrapData?.topics ?? [];
  const slug = location === null ? null : topicSlugFromChatLocation(location);
  const routeTopic = slug ? topics.find((topic) => topic.slug === slug) : undefined;
  const initialTopicId =
    location === null ? null : bootstrapData?.initialTopicId ?? routeTopic?.id ?? defaultTopicId;
  const authenticatedLanguage =
    bootstrapData?.authMode === "authenticated"
      ? parseSupportedChatLanguage(bootstrapData.user.preferredLanguage)
      : null;

  useEffect(() => {
    if (!authenticatedLanguage) return;
    setClientLanguagePreferenceCookie(localeCookieName, authenticatedLanguage);

    const redirect = bootstrapData?.localeRedirect;
    if (!redirect || redirectingToRef.current === redirect.href) return;
    redirectingToRef.current = redirect.href;
    window.location.replace(redirect.href);
  }, [authenticatedLanguage, bootstrapData]);

  if (!initialTopicId || !bootstrapData || bootstrapData.localeRedirect) {
    return (
      <main
        className="inspir-workspace"
        aria-busy={bootstrapFailed ? undefined : "true"}
        data-bootstrap-load={bootstrapFailed ? "failed" : "pending"}
      >
        {bootstrapFailed ? (
          <section className="inspir-bootstrap-error" role="alert">
            <p>{loadErrorLabel}</p>
            <button type="button" onClick={() => window.location.reload()}>
              {retryLabel}
            </button>
          </section>
        ) : (
          <p className="sr-only">{loadingLabel}</p>
        )}
      </main>
    );
  }

  return (
    <>
      {location && authErrorFromLocation(location) ? (
        <div className="inspir-auth-error-notice" role="alert">
          {authErrorLabel}
        </div>
      ) : null}
      <ChatClient
        authMode={bootstrapData.authMode}
        user={bootstrapData.user}
        topics={topics}
        initialTopicId={initialTopicId}
        initialChatId={bootstrapData.initialChatId}
        initialMessages={bootstrapData.initialMessages}
        initialMessagePage={bootstrapData.initialMessagePage}
        initialActivityRun={bootstrapData.initialActivityRun}
        initialTranslationBundle={bootstrapData.translationBundle}
        guestMessageLimit={10}
      />
    </>
  );
}

const knownAuthErrors = new Set([
  "account_not_linked",
  "identity_verification_failed",
  "invalid_state",
  "missing_code",
  "oauth_callback_failed",
  "oauth_start_failed",
  "provider_error",
  "unable_to_link_account",
]);

function authErrorFromLocation(location: string) {
  try {
    const error = new URL(location, "https://inspir.invalid").searchParams.get("error");
    return error && knownAuthErrors.has(error) ? error : null;
  } catch {
    return null;
  }
}

function getStaticChatBootstrapResource(
  language: SupportedLanguage,
  translationBundleUrl: string,
  translationSourceHash: string,
  location: string,
) {
  const key = `${language}\u0000${translationBundleUrl}\u0000${translationSourceHash}\u0000${location}`;
  const cached = staticChatBootstrapResources.get(key);
  if (cached) return cached;

  let snapshot = loadingBootstrapSnapshot;
  let started = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const resource: StaticChatBootstrapResource = {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      if (!started) {
        started = true;
        void loadStaticChatBootstrap(language, translationBundleUrl, translationSourceHash, location)
          .then((data) => {
            snapshot = { status: "ready", data };
            notify();
          })
          .catch(() => {
            console.error(JSON.stringify({ event: "static_chat_bootstrap_unavailable", language }));
            snapshot = { status: "failed", data: null };
            notify();
          });
      }
      return () => listeners.delete(onStoreChange);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => loadingBootstrapSnapshot,
  };
  if (staticChatBootstrapResources.size >= supportedLanguages.length) {
    const oldestKey = staticChatBootstrapResources.keys().next().value;
    if (oldestKey) staticChatBootstrapResources.delete(oldestKey);
  }
  staticChatBootstrapResources.set(key, resource);
  return resource;
}

async function loadStaticChatBootstrap(
  language: SupportedLanguage,
  translationBundleUrl: string,
  translationSourceHash: string,
  location: string,
) {
  const [translationResponse, topicsResponse, profileResponse] = await Promise.all([
    fetch(translationBundleUrl, {
      cache: "force-cache",
      headers: { accept: "application/json" },
    }),
    fetch("/api/topics", {
      cache: "force-cache",
      headers: { accept: "application/json" },
    }),
    fetch("/api/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    }),
  ]);
  if (!translationResponse.ok || !topicsResponse.ok) {
    throw new Error("Static chat bootstrap request failed");
  }
  const [translationValue, topicsValue]: [unknown, unknown] = await Promise.all([
    translationResponse.json(),
    topicsResponse.json(),
  ]);
  const translationBundle = parseMainAppTranslationBundle(
    translationValue,
    language,
    translationSourceHash,
  );
  const staticTopics = parsePublicTopicsResponse(topicsValue);
  if (!translationBundle || !staticTopics) throw new Error("Static chat bootstrap is invalid");

  if (!profileResponse.ok && profileResponse.status !== 401) {
    throw new Error("Account bootstrap failed");
  }
  const profileValue = profileResponse.ok
    ? await profileResponse.json().catch(() => null)
    : null;
  const profile = profileResponse.ok ? parseProfileResponse(profileValue) : null;
  if (profileResponse.ok && !profile) throw new Error("Account bootstrap response is invalid");
  if (!profile) {
    return {
      topics: staticTopics,
      translationBundle,
      authMode: "guest",
      user: guestUser(language),
      initialMessages: [],
      initialMessagePage: null,
      initialActivityRun: null,
      localeRedirect: null,
    } satisfies StaticChatBootstrapData;
  }

  const apiProfileUser = profileFromApiUser(profile);
  const preferredLanguage = parseSupportedChatLanguage(apiProfileUser.preferredLanguage) ?? language;
  const user = { ...apiProfileUser, preferredLanguage };
  const localeRedirect = getChatLocaleRedirect(location, language, apiProfileUser.preferredLanguage);
  if (localeRedirect) {
    return {
      topics: staticTopics,
      translationBundle,
      authMode: "authenticated",
      user,
      initialMessages: [],
      initialMessagePage: null,
      initialActivityRun: null,
      localeRedirect,
    } satisfies StaticChatBootstrapData;
  }

  const privateChatId = privateChatIdFromLocation(location);
  const [accountTopicsResponse, chatResponse] = await Promise.all([
    fetch("/api/account/topics", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    }),
    privateChatId
      ? fetch(`/api/chats/${encodeURIComponent(privateChatId)}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        })
      : Promise.resolve(null),
  ]);
  const accountTopics = accountTopicsResponse.ok
    ? parseAccountTopicsResponse(await accountTopicsResponse.json().catch(() => null))
    : null;
  const initialChat = chatResponse?.ok
    ? parseInitialChat(await chatResponse.json().catch(() => null))
    : null;
  if (privateChatId && (!chatResponse?.ok || !initialChat)) {
    throw new Error("Saved chat bootstrap failed");
  }

  return {
    topics: accountTopics?.length ? accountTopics : staticTopics,
    translationBundle,
    authMode: "authenticated",
    user,
    initialChatId: initialChat?.chatId,
    initialMessages: initialChat?.messages ?? [],
    initialMessagePage: initialChat?.messagePage ?? null,
    initialActivityRun: initialChat?.activityRun ?? null,
    initialTopicId: initialChat?.topicId,
    localeRedirect: null,
  } satisfies StaticChatBootstrapData;
}

function parseAccountTopicsResponse(value: unknown): Topic[] | null {
  if (!isRecord(value) || !Array.isArray(value.topics)) return null;
  const topics: Topic[] = [];
  for (const item of value.topics) {
    if (!isRecord(item)) return null;
    if (
      typeof item.id !== "string" ||
      typeof item.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) ||
      typeof item.name !== "string" ||
      typeof item.subText !== "string" ||
      typeof item.description !== "string" ||
      typeof item.inputboxText !== "string"
    ) {
      return null;
    }
    topics.push({
      id: item.id,
      slug: item.slug,
      name: item.name,
      subText: item.subText,
      description: item.description,
      inputboxText: item.inputboxText,
      metadata: isRecord(item.metadata) ? item.metadata : null,
    });
  }
  return topics.length > 0 && topics.length <= 200 ? topics : null;
}

function guestUser(language: SupportedLanguage): UserProfile {
  return {
    id: "guest",
    name: "",
    email: "",
    image: null,
    score: 0,
    preferredLanguage: language,
    dateOfBirth: null,
    age: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    profileImageHash: null,
    isAdmin: false,
  };
}

function parseProfileResponse(value: unknown): ApiProfileUser | null {
  if (!isRecord(value) || !isRecord(value.user)) return null;
  const user = value.user;
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    (typeof user.name !== "string" && user.name !== null) ||
    (typeof user.image !== "string" && user.image !== null) ||
    (typeof user.createdAt !== "string" && !(user.createdAt instanceof Date))
  ) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    score: typeof user.score === "number" ? user.score : 0,
    preferredLanguage: typeof user.preferredLanguage === "string" ? user.preferredLanguage : languageFallback,
    dateOfBirth: typeof user.dateOfBirth === "string" || user.dateOfBirth === null ? user.dateOfBirth : null,
    age: typeof user.age === "number" || user.age === null ? user.age : null,
    createdAt: user.createdAt,
    profileImageHash:
      typeof user.profileImageHash === "string" || user.profileImageHash === null ? user.profileImageHash : null,
    isAdmin: user.isAdmin === true,
  };
}

const languageFallback = "English";

function privateChatIdFromLocation(location: string) {
  if (!location) return null;
  const url = new URL(location, "https://inspir.invalid");
  const fromQuery = url.searchParams.get("chat");
  const pathSegment = url.pathname.split("/").filter(Boolean).at(-1) ?? null;
  for (const candidate of [fromQuery, pathSegment]) {
    if (candidate && uuidPattern.test(candidate)) return candidate;
  }
  return null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseInitialChat(value: unknown): {
  chatId: string;
  topicId?: string;
  messages: ChatMessage[];
  messagePage: StaticChatMessagePage | null;
  activityRun: ActivityRun | null;
} | null {
  if (!isRecord(value) || !isRecord(value.chat) || typeof value.chat.id !== "string") return null;
  if (!Array.isArray(value.messages)) return null;
  const parsedMessages = value.messages.map(parseChatMessage);
  const messagePage = parseMessagePage(value.messagePage);
  if (parsedMessages.some((message) => message === null) || !messagePage) return null;
  const messages = parsedMessages.filter((message): message is ChatMessage => message !== null);
  const topicId = isRecord(value.topic) && typeof value.topic.id === "string" ? value.topic.id : undefined;
  return {
    chatId: value.chat.id,
    topicId,
    messages,
    messagePage,
    activityRun: parseActivityRun(value.activityRun),
  };
}

function parseMessagePage(value: unknown): StaticChatMessagePage | null {
  if (
    !isRecord(value) ||
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

function parseChatMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  if (
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
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

function parseActivityRun(value: unknown): ActivityRun | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.chatId !== "string" ||
    typeof value.type !== "string" ||
    typeof value.status !== "string" ||
    !isRecord(value.state) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    chatId: value.chatId,
    type: value.type,
    status: value.status,
    state: value.state,
    score: typeof value.score === "number" ? value.score : null,
    maxScore: typeof value.maxScore === "number" ? value.maxScore : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
  };
}

function subscribeToLocation(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function readBrowserLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function readServerLocation() {
  return null;
}

function parseMainAppTranslationBundle(
  value: unknown,
  language: SupportedLanguage,
  sourceHash: string,
): MainAppTranslationBundle | null {
  if (!isRecord(value)) return null;
  if (value.namespace !== "main-app" || value.language !== language || value.sourceHash !== sourceHash) {
    return null;
  }
  const sourceStrings = stringRecord(value.sourceStrings);
  const strings = stringRecord(value.strings);
  if (!sourceStrings || !strings || Object.keys(sourceStrings).length < 1_000) return null;
  if (Object.keys(sourceStrings).some((key) => !strings[key]?.trim())) return null;
  return { namespace: "main-app", language, sourceHash, sourceStrings, strings };
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return null;
    result[key] = entry;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
