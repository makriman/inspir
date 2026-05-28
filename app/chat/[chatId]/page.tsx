import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ChatClient } from "@/components/chat/ChatClient";
import { sanitizeActivityRun } from "@/lib/activities/quiz";
import { authOptions } from "@/lib/auth/config";
import { seededTopics, topicFromSeed } from "@/lib/content/seeded-topics";
import { topicSeeds } from "@/lib/content/topics";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { isUuidPathSegment, resolveTopicSlug, topicPath } from "@/lib/content/topic-routing";
import {
  getActiveTopics,
  getChatMessages,
  getDefaultTopic,
  getLatestActivityRun,
  getOwnedChat,
  getUserById,
} from "@/lib/db/queries";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { serializeJsonLd, topicJsonLd } from "@/lib/seo/json-ld";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRoutePageProps = {
  params: Promise<{ chatId: string }>;
};

const publicTopicDbTimeoutMs = 1500;

function findSeedTopic(slug: string) {
  return topicSeeds.find((topic) => topic.slug === slug);
}

function guestUser() {
  return {
    id: "guest",
    name: "Guest learner",
    email: "",
    image: null,
    score: 0,
    preferredLanguage: "English",
    createdAt: new Date(),
    profileImageHash: null,
  };
}

async function withPublicTopicTimeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Public topic database lookup timed out")), publicTopicDbTimeoutMs);
    }),
  ]);
}

export function generateStaticParams() {
  return topicSeeds.map((topic) => ({ chatId: topic.slug }));
}

export async function generateMetadata({ params }: ChatRoutePageProps): Promise<Metadata> {
  const { chatId } = await params;
  const slug = resolveTopicSlug(chatId);

  if (slug) {
    const topic = findSeedTopic(slug);
    if (!topic) return {};
    const seo = getTopicSeo(topic);
    const image = socialImage({
      title: seo.title,
      eyebrow: "Learning mode",
      description: seo.description,
    });
    return {
      title: seo.title,
      description: seo.description,
      alternates: metadataAlternates(topicPath(topic.slug)),
      robots: { index: true, follow: true },
      openGraph: {
        title: seo.title,
        description: seo.description,
        url: topicPath(topic.slug),
        siteName,
        images: [image],
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: seo.title,
        description: seo.description,
        images: [image.url],
      },
    };
  }

  if (isUuidPathSegment(chatId)) {
    return {
      title: "Private chat",
      description: "A private saved inspir chat.",
      robots: { index: false, follow: false, nocache: true },
    };
  }

  return {
    title: "Chat not found",
    robots: { index: false, follow: false },
  };
}

export default async function ChatRoutePage({ params }: ChatRoutePageProps) {
  const { chatId } = await params;
  const topicSlug = resolveTopicSlug(chatId);

  if (topicSlug) {
    const seedTopic = findSeedTopic(topicSlug);
    if (!seedTopic) notFound();

    const session = await getServerSession(authOptions);
    const seedFallbackTopics = seededTopics();
    let topics = seedFallbackTopics;
    let user = null;
    let savedChatsAvailable = false;

    if (session?.user?.id) {
      try {
        const [dbTopics, dbUser] = await withPublicTopicTimeout(
          Promise.all([getActiveTopics(), getUserById(session.user.id)]),
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

    const profileUser = session?.user?.id && savedChatsAvailable
      ? {
          id: session.user.id,
          name: user?.name ?? session.user.name ?? "Learner",
          email: user?.email ?? session.user.email ?? "user@example.com",
          image: user?.image ?? session.user.image ?? null,
          score: user?.score ?? 0,
          preferredLanguage: user?.preferredLanguage ?? "English",
          createdAt: user?.createdAt ?? new Date(),
          profileImageHash: user?.profileImageHash ?? null,
        }
      : guestUser();

    return (
      <>
        {topicJsonLd(seedTopic).map((entry, index) => (
          <script
            key={index}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(entry) }}
          />
        ))}
        <ChatClient
          authMode={savedChatsAvailable ? "authenticated" : "guest"}
          user={profileUser}
          topics={topics}
          initialTopicId={topic.id}
          initialMessages={[]}
          initialActivityRun={null}
        />
      </>
    );
  }

  if (!isUuidPathSegment(chatId)) notFound();

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/");

  const owned = await getOwnedChat(chatId, session.user.id);
  if (!owned) notFound();

  const [topics, defaultTopic, messages, user, activityRun] = await Promise.all([
    getActiveTopics(),
    getDefaultTopic(),
    getChatMessages(chatId),
    getUserById(session.user.id),
    getLatestActivityRun(chatId),
  ]);

  return (
    <ChatClient
      authMode="authenticated"
      user={{
        id: session.user.id,
        name: user?.name ?? session.user.name ?? "Learner",
        email: user?.email ?? session.user.email ?? "user@example.com",
        image: user?.image ?? session.user.image ?? null,
        score: user?.score ?? 0,
        preferredLanguage: user?.preferredLanguage ?? "English",
        createdAt: user?.createdAt ?? new Date(),
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
    />
  );
}
