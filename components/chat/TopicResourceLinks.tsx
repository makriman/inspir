import Link from "next/link";
import { ArrowUpRight, BookOpenCheck, Compass, MessageSquareText, Sparkles } from "lucide-react";
import { defaultLanguage } from "@/lib/content/languages";
import { localizeHref } from "@/lib/i18n/routing";

type TopicResourceLinkTopic = {
  slug: string;
  name: string;
};

function topicGuideHref(topic: TopicResourceLinkTopic) {
  const guideSlug = topic.slug.endsWith("-guide") ? `ai-${topic.slug}` : `ai-${topic.slug}-guide`;
  return `/blog/${guideSlug}`;
}

function topicPromptLoopHref(topic: TopicResourceLinkTopic) {
  return `/blog/${topic.slug}-prompts-and-study-loop`;
}

export function TopicResourceLinks({
  topic,
  language = defaultLanguage,
}: {
  topic: TopicResourceLinkTopic;
  language?: string;
}) {
  const href = (path: string) => localizeHref(path, language);

  return (
    <nav className="bubble-topic-resource-links" aria-label={`${topic.name} learning resources`}>
      <Link href={href(topicGuideHref(topic))}>
        <BookOpenCheck size={16} />
        <span>Read the guide</span>
        <ArrowUpRight size={14} />
      </Link>
      <Link href={href(topicPromptLoopHref(topic))}>
        <MessageSquareText size={16} />
        <span>Use the prompt loop</span>
        <ArrowUpRight size={14} />
      </Link>
      <Link href={href("/prompts")}>
        <Sparkles size={16} />
        <span>Browse prompt starters</span>
        <ArrowUpRight size={14} />
      </Link>
      <Link href={href("/topics")}>
        <Compass size={16} />
        <span>Compare all modes</span>
        <ArrowUpRight size={14} />
      </Link>
    </nav>
  );
}
