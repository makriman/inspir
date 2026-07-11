"use client";

import { useSyncExternalStore } from "react";
import { ChatClient } from "@/components/chat/ChatClient";
import {
  parsePublicTopicsResponse,
  type PublicSeededTopic,
} from "@/lib/content/public-topic-contract";
import { topicSlugFromChatLocation } from "@/lib/content/topic-path";
import { supportedLanguages, type SupportedLanguage } from "@/lib/content/languages";
import type { MainAppTranslationBundle } from "@/lib/i18n/main-app-types";

type StaticGuestChatBootstrapProps = {
  defaultTopicId: string;
  language: SupportedLanguage;
  translationBundleUrl: string;
  translationSourceHash: string;
};

type StaticChatBootstrapData = {
  topics: PublicSeededTopic[];
  translationBundle: MainAppTranslationBundle;
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
}: StaticGuestChatBootstrapProps) {
  const location = useSyncExternalStore(subscribeToLocation, readBrowserLocation, readServerLocation);
  const bootstrapResource = getStaticChatBootstrapResource(
    language,
    translationBundleUrl,
    translationSourceHash,
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
  const initialTopicId = location === null ? null : routeTopic?.id ?? defaultTopicId;

  if (!initialTopicId || !bootstrapData) {
    return (
      <main
        className="inspir-workspace"
        aria-busy={bootstrapFailed ? undefined : "true"}
        data-bootstrap-load={bootstrapFailed ? "failed" : "pending"}
      />
    );
  }

  return (
    <ChatClient
      authMode="guest"
      user={{
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
      }}
      topics={topics}
      initialTopicId={initialTopicId}
      initialMessages={[]}
      initialActivityRun={null}
      initialTranslationBundle={bootstrapData.translationBundle}
      guestMessageLimit={10}
    />
  );
}

function getStaticChatBootstrapResource(
  language: SupportedLanguage,
  translationBundleUrl: string,
  translationSourceHash: string,
) {
  const key = `${language}\u0000${translationBundleUrl}\u0000${translationSourceHash}`;
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
        void loadStaticChatBootstrap(language, translationBundleUrl, translationSourceHash)
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
) {
  const [translationResponse, topicsResponse] = await Promise.all([
    fetch(translationBundleUrl, {
      cache: "force-cache",
      headers: { accept: "application/json" },
    }),
    fetch("/api/topics", {
      cache: "force-cache",
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
  const topics = parsePublicTopicsResponse(topicsValue);
  if (!translationBundle || !topics) throw new Error("Static chat bootstrap is invalid");
  return { topics, translationBundle } satisfies StaticChatBootstrapData;
}

function subscribeToLocation(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function readBrowserLocation() {
  return `${window.location.pathname}${window.location.search}`;
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
