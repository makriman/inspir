import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { defaultTopicPath, resolveTopicSlug, topicPath } from "@/lib/content/topic-routing";
import { localizePath } from "@/lib/i18n/routing";
import { getRequestLanguage } from "@/lib/i18n/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Chat",
    description: "Private inspir chat workspace.",
    robots: { index: false, follow: false, nocache: true },
    alternates: {},
    keywords: [],
    other: {},
  };
}

type ChatPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const language = await getRequestLanguage();
  const topicParam = Array.isArray(params.topic) ? params.topic[0] : params.topic;
  const requested = "askmeanything" in params ? "askmeanything" : topicParam;
  const slug = resolveTopicSlug(requested);

  redirect(localizePath(slug ? topicPath(slug) : defaultTopicPath(), language));
}
