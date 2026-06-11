import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowUpRight, CornerDownRight, Sparkles } from "lucide-react";
import { ChatClient } from "@/components/chat/ChatClient";
import { sanitizeActivityRun } from "@/lib/activities/quiz";
import { authOptions } from "@/lib/auth/config";
import { seededTopics, topicFromSeed } from "@/lib/content/seeded-topics";
import {
  getRelatedBlogGuidesForTopic,
  getRelatedLearningPathsForTopic,
  getRelatedTopicModesForTopic,
  topicPublicFaqs,
} from "@/lib/content/topic-public-seo";
import { topicSeeds } from "@/lib/content/topics";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { isUuidPathSegment, resolveTopicSlug, topicPath } from "@/lib/content/topic-routing";
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
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { getEnglishMainAppTranslationBundle } from "@/lib/i18n/main-app-source";
import { getRequestLanguage } from "@/lib/i18n/request-locale";
import {
  getCachedSiteTranslationEntries,
  getSiteTranslationNamespaces,
} from "@/lib/i18n/site-translations";
import { createTranslationLookup } from "@/lib/i18n/translation-lookup";
import { calculateAge } from "@/lib/profile/age";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { faqPageJsonLd, itemListJsonLd, topicJsonLd } from "@/lib/seo/json-ld";
import { numberFromEnv, quotaDefaults } from "@/lib/utils/rate-limit";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";

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

function PublicTopicSeoCompanion({
  topic,
  t = (value) => value,
}: {
  topic: (typeof topicSeeds)[number];
  t?: (value: string) => string;
}) {
  const seo = getTopicSeo(topic);
  const starters = topic.metadata.starters;
  const relatedPaths = getRelatedLearningPathsForTopic(topic);
  const relatedGuides = getRelatedBlogGuidesForTopic(topic);
  const relatedModes = getRelatedTopicModesForTopic(topic);
  const faqs = topicPublicFaqs(topic);
  const hasRelated = relatedPaths.length > 0 || relatedGuides.length > 0 || relatedModes.length > 0;

  return (
    <section
      className="public-topic-seo"
      data-no-auto-translate="true"
      aria-labelledby={`${topic.slug}-seo-title`}
    >
      <div className="public-topic-seo-head">
        <span>
          {t(topic.metadata.category)} {t("learning mode")}
        </span>
        <h1 id={`${topic.slug}-seo-title`}>{t(seo.title)}</h1>
        <p>{t(seo.description)}</p>
        <div className="public-topic-seo-actions">
          <Link href={topicPath(topic.slug)} className="marketing-primary-cta">
            {t("Start")} {t(topic.name)}
            <Sparkles size={18} />
          </Link>
          <Link href="/topics" className="marketing-secondary-cta">
            {t("Browse all modes")}
          </Link>
        </div>
      </div>

      <div className="public-topic-seo-grid">
        <article>
          <strong>{t("Who it helps")}</strong>
          <p>{t(seo.who)}</p>
        </article>
        <article>
          <strong>{t("Why it is different")}</strong>
          <p>{t(seo.whyDifferent)}</p>
        </article>
        <article>
          <strong>{t("What you can practise")}</strong>
          <ul>
            {seo.outcomes.map((outcome) => (
              <li key={outcome}>{t(outcome)}</li>
            ))}
          </ul>
        </article>
      </div>

      {starters.length ? (
        <div className="public-topic-prompt-panel">
          <div>
            <span>{t("Example prompts")}</span>
            <h3>{t("Good ways to start this chat.")}</h3>
          </div>
          <div className="public-topic-prompt-list">
            {starters.map((starter) => (
              <Link key={starter} href={topicPath(topic.slug)}>
                <CornerDownRight size={16} />
                {t(starter)}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {hasRelated ? (
        <div className="public-topic-related">
          {relatedPaths.length ? (
            <section>
              <span>{t("Learning paths")}</span>
              <h3>{t("Use this mode inside a study workflow.")}</h3>
              <div>
                {relatedPaths.map((path) => (
                  <Link key={path.href} href={path.href}>
                    <strong>{t(path.title)}</strong>
                    <p>{t(path.description)}</p>
                    <small>
                      {t("Open path")}
                      <ArrowUpRight size={14} />
                    </small>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {relatedGuides.length ? (
            <section>
              <span>{t("Related guides")}</span>
              <h3>{t("Read a guide, then practise here.")}</h3>
              <div>
                {relatedGuides.map((guide) => (
                  <Link key={guide.href} href={guide.href}>
                    <strong>{t(guide.title)}</strong>
                    <p>{t(guide.description)}</p>
                    <small>
                      {t("Read guide")}
                      <ArrowUpRight size={14} />
                    </small>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {relatedModes.length ? (
            <section>
              <span>{t("Related modes")}</span>
              <h3>{t("Keep learning with the right next chat.")}</h3>
              <div>
                {relatedModes.map((mode) => (
                  <Link key={mode.href} href={mode.href}>
                    <strong>{t(mode.title)}</strong>
                    <p>{t(mode.description)}</p>
                    <small>
                      {t("Start mode")}
                      <ArrowUpRight size={14} />
                    </small>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="public-topic-faq">
        <div>
          <span>{t("Questions learners ask")}</span>
          <h3>
            {t("Before you start")} {t(topic.name)}.
          </h3>
        </div>
        <div className="public-topic-faq-list">
          {faqs.map((item) => (
            <details key={item.question}>
              <summary>{t(item.question)}</summary>
              <p>{t(item.answer)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
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

  if (slug) {
    const topic = findSeedTopic(slug);
    if (!topic) return {};
    const seo = getTopicSeo(topic);
    const image = socialImage({
      title: seo.title,
      eyebrow: "Learning mode",
      description: seo.description,
    });
    return localizeMarketingMetadata({
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
    }, topicPath(topic.slug));
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
    const siteTranslationNamespaces = getSiteTranslationNamespaces(topicPath(seedTopic.slug));
    const siteTranslationEntries = await getCachedSiteTranslationEntries(requestLanguage, siteTranslationNamespaces);
    const siteT = createTranslationLookup(siteTranslationEntries).translate;

    const topicFaqs = topicPublicFaqs(seedTopic);
    const relatedPaths = getRelatedLearningPathsForTopic(seedTopic);
    const relatedGuides = getRelatedBlogGuidesForTopic(seedTopic);
    const relatedModes = getRelatedTopicModesForTopic(seedTopic);
    const topicStructuredData = [
      ...topicJsonLd(seedTopic),
      faqPageJsonLd({
        path: topicPath(seedTopic.slug),
        questions: topicFaqs,
      }),
      itemListJsonLd({
        path: topicPath(seedTopic.slug),
        id: "related-topic-resources",
        name: `${seedTopic.name} related learning resources`,
        items: [
          ...relatedPaths.map((path) => ({
            name: path.title,
            url: path.href,
            description: path.description,
          })),
          ...relatedGuides.map((guide) => ({
            name: guide.title,
            url: guide.href,
            description: guide.description,
          })),
          ...relatedModes.map((mode) => ({
            name: mode.title,
            url: mode.href,
            description: mode.description,
          })),
        ],
      }),
    ];

    return (
      <>
        <JsonLdScripts items={topicStructuredData} />
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
        <PublicTopicSeoCompanion topic={seedTopic} t={siteT} />
      </>
    );
  }

  if (!isUuidPathSegment(chatId)) notFound();

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/");

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
