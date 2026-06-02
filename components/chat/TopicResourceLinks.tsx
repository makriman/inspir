import Link from "next/link";
import { ArrowUpRight, BookOpenCheck, Compass, MessageSquareText, Sparkles } from "lucide-react";

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

export function TopicResourceLinks({ topic }: { topic: TopicResourceLinkTopic }) {
  return (
    <nav className="bubble-topic-resource-links" aria-label={`${topic.name} learning resources`}>
      <Link href={topicGuideHref(topic)}>
        <BookOpenCheck size={16} />
        <span>Read the guide</span>
        <ArrowUpRight size={14} />
      </Link>
      <Link href={topicPromptLoopHref(topic)}>
        <MessageSquareText size={16} />
        <span>Use the prompt loop</span>
        <ArrowUpRight size={14} />
      </Link>
      <Link href="/prompts">
        <Sparkles size={16} />
        <span>Browse prompt starters</span>
        <ArrowUpRight size={14} />
      </Link>
      <Link href="/topics">
        <Compass size={16} />
        <span>Compare all modes</span>
        <ArrowUpRight size={14} />
      </Link>
    </nav>
  );
}
