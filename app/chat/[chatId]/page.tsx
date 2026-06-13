import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ChatClient } from "@/components/chat/ChatClient";
import { sanitizeActivityRun } from "@/lib/activities/quiz";
import { authOptions } from "@/lib/auth/config";
import { seededTopics, topicFromSeed } from "@/lib/content/seeded-topics";
import { topicSeeds } from "@/lib/content/topics";
import { isUuidPathSegment, resolveTopicSlug } from "@/lib/content/topic-routing";
import {
  getChatMessages,
  getDefaultTopic,
  getLatestActivityRun,
  getOwnedChat,
  getPublicActiveTopics,
  getUserProfileById,
  toPublicTopic,
} from "@/lib/db/queries";
import { getCachedMainAppTranslationBundle } from "@/lib/i18n/main-app-translations";
import { getEnglishMainAppTranslationBundle } from "@/lib/i18n/main-app-source";
import type { MainAppTranslationBundle } from "@/lib/i18n/main-app-types";
import { getRequestLanguage } from "@/lib/i18n/request-locale";
import { localizePath } from "@/lib/i18n/routing";
import { calculateAge } from "@/lib/profile/age";
import { numberFromEnv, quotaDefaults } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRoutePageProps = {
  params: Promise<{ chatId: string }>;
};

const publicTopicDbTimeoutMs = 1500;

const guestMessageLimit = numberFromEnv("RATE_LIMIT_GUEST_SESSION_DAILY", quotaDefaults.guestSessionDaily);

function findSeedTopic(slug: string) {
  return topicSeeds.find((topic) => topic.slug === slug);
}

function guestUser(preferredLanguage = "English") {
  return {
    id: "guest",
    name: "Guest learner",
    email: "",
    image: null,
    score: 0,
    preferredLanguage,
    dateOfBirth: null,
    age: null,
    createdAt: new Date(),
    profileImageHash: null,
  };
}

function translateMainAppText(text: string, bundle: MainAppTranslationBundle) {
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const trailing = text.match(/\s*$/)?.[0] ?? "";
  const core = text.trim();
  for (const [key, sourceText] of Object.entries(bundle.sourceStrings)) {
    if (sourceText.trim() === core) {
      return `${leading}${bundle.strings[key] ?? sourceText}${trailing}`;
    }
  }
  return text;
}

async function withPublicTopicTimeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Public topic database lookup timed out")), publicTopicDbTimeoutMs);
    }),
  ]);
}

export async function generateMetadata({ params }: ChatRoutePageProps): Promise<Metadata> {
  const { chatId } = await params;
  const slug = resolveTopicSlug(chatId);
  const requestLanguage = await getRequestLanguage();

  if (slug) {
    const topic = findSeedTopic(slug);
    if (!topic) return {};
    const translationBundle =
      (await getCachedMainAppTranslationBundle(requestLanguage)) ?? getEnglishMainAppTranslationBundle();
    const title = translateMainAppText(topic.name, translationBundle);
    const description = translateMainAppText(topic.subText || topic.description, translationBundle);
    return {
      title,
      description,
      robots: { index: false, follow: true },
      alternates: {},
      keywords: [],
      openGraph: {
        title: `${title} | inspir`,
        description,
        type: "website",
      },
      twitter: {
        card: "summary",
        title: `${title} | inspir`,
        description,
      },
      other: {},
    };
  }

  if (isUuidPathSegment(chatId)) {
    return {
      title: "Private chat",
      description: "A private saved inspir chat.",
      robots: { index: false, follow: false, nocache: true },
      alternates: {},
      keywords: [],
      openGraph: {
        title: "Private chat | inspir",
        description: "A private saved inspir chat.",
        type: "website",
      },
      twitter: {
        card: "summary",
        title: "Private chat | inspir",
        description: "A private saved inspir chat.",
      },
      other: {},
    };
  }

  return {
    title: "Chat not found",
    robots: { index: false, follow: false },
    alternates: {},
    keywords: [],
    other: {},
  };
}

export default async function ChatRoutePage({ params }: ChatRoutePageProps) {
  const { chatId } = await params;
  const topicSlug = resolveTopicSlug(chatId);

  if (topicSlug) {
    const seedTopic = findSeedTopic(topicSlug);
    if (!seedTopic) notFound();

    const session = await getServerSession(authOptions);
    const seedFallbackTopics = seededTopics().map(toPublicTopic);
    let topics = seedFallbackTopics;
    let user = null;
    let savedChatsAvailable = false;

    if (session?.user?.id) {
      try {
        const [dbTopics, dbUser] = await withPublicTopicTimeout(
          Promise.all([getPublicActiveTopics(), getUserProfileById(session.user.id)]),
        );
        const dbTopic = dbTopics.find((candidate) => candidate.slug === topicSlug);
        if (dbTopics.length > 0 && dbTopic) {
          topics = dbTopics;
          user = dbUser;
          savedChatsAvailable = true;
        }
      } catch {
        topics = seedFallbackTopics;
        savedChatsAvailable = false;
      }
    }

    const topic = topics.find((candidate) => candidate.slug === topicSlug) ?? topicFromSeed(seedTopic);
    if (!topic) notFound();
    const requestLanguage = await getRequestLanguage();
    const profileUser = session?.user?.id && savedChatsAvailable
      ? {
          id: session.user.id,
          name: user?.name ?? session.user.name ?? "Learner",
          email: user?.email ?? session.user.email ?? "user@example.com",
          image: user?.image ?? session.user.image ?? null,
          score: user?.score ?? 0,
          preferredLanguage: user?.preferredLanguage ?? "English",
          dateOfBirth: user?.dateOfBirth ?? null,
          age: calculateAge(user?.dateOfBirth),
          createdAt: user?.createdAt ?? new Date(),
          profileImageHash: user?.profileImageHash ?? null,
      }
      : guestUser(requestLanguage);
    const translationBundle =
      (await getCachedMainAppTranslationBundle(profileUser.preferredLanguage)) ??
      getEnglishMainAppTranslationBundle();

    return (
      <ChatClient
        authMode={savedChatsAvailable ? "authenticated" : "guest"}
        user={profileUser}
        topics={topics}
        initialTopicId={topic.id}
        initialMessages={[]}
        initialActivityRun={null}
        initialTranslationBundle={translationBundle}
        guestMessageLimit={guestMessageLimit}
      />
    );
  }

  if (!isUuidPathSegment(chatId)) notFound();

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect(localizePath("/", await getRequestLanguage()));

  const owned = await getOwnedChat(chatId, session.user.id);
  if (!owned) notFound();

  const [topics, defaultTopic, messages, user, activityRun] = await Promise.all([
    getPublicActiveTopics(),
    getDefaultTopic(),
    getChatMessages(chatId),
    getUserProfileById(session.user.id),
    getLatestActivityRun(chatId),
  ]);
  const requestLanguage = await getRequestLanguage();
  return (
    <ChatClient
      authMode="authenticated"
      user={{
        id: session.user.id,
        name: user?.name ?? session.user.name ?? "Learner",
        email: user?.email ?? session.user.email ?? "user@example.com",
        image: user?.image ?? session.user.image ?? null,
        score: user?.score ?? 0,
        preferredLanguage: user?.preferredLanguage ?? requestLanguage,
        dateOfBirth: user?.dateOfBirth ?? null,
        age: calculateAge(user?.dateOfBirth),
        createdAt: user?.createdAt ?? "",
        profileImageHash: user?.profileImageHash ?? null,
      }}
      topics={topics}
      initialTopicId={owned.topic?.id ?? defaultTopic?.id ?? topics[0]?.id}
      initialChatId={chatId}
      initialMessages={messages.map((message) => ({
        id: message.id,
        role:
          message.role === "assistant" || message.role === "system" || message.role === "user"
            ? message.role
            : "assistant",
        content: message.content,
        createdAt: message.createdAt,
        metadata: message.metadata,
      }))}
      initialActivityRun={sanitizeActivityRun(activityRun)}
      initialTranslationBundle={
        (await getCachedMainAppTranslationBundle(user?.preferredLanguage ?? requestLanguage)) ??
        getEnglishMainAppTranslationBundle()
      }
    />
  );
}
