import { ArrowUpRight, BookOpenCheck, Compass, MessageSquareText, Sparkles } from "lucide-react";

type TopicResourceLinkTopic = {
  slug: string;
  name: string;
};

export function topicGuideHref(topic: TopicResourceLinkTopic) {
  const guideSlug = topic.slug.endsWith("-guide") ? `ai-${topic.slug}` : `ai-${topic.slug}-guide`;
  return `/blog/${guideSlug}`;
}

export function topicPromptLoopHref(topic: TopicResourceLinkTopic) {
  return `/blog/${topic.slug}-prompts-and-study-loop`;
}

export function TopicResourceLinks({ topic }: { topic: TopicResourceLinkTopic }) {
  return (
    <nav className="bubble-topic-resource-links" aria-label={`${topic.name} learning resources`}>
      <a href={topicGuideHref(topic)}>
        <BookOpenCheck size={16} />
        <span>Read the guide</span>
        <ArrowUpRight size={14} />
      </a>
      <a href={topicPromptLoopHref(topic)}>
        <MessageSquareText size={16} />
        <span>Use the prompt loop</span>
        <ArrowUpRight size={14} />
      </a>
      <a href="/prompts">
        <Sparkles size={16} />
        <span>Browse prompt starters</span>
        <ArrowUpRight size={14} />
      </a>
      <a href="/topics">
        <Compass size={16} />
        <span>Compare all modes</span>
        <ArrowUpRight size={14} />
      </a>
    </nav>
  );
}
