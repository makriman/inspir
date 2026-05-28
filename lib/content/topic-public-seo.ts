import { getBlogPostTopic, getBlogPosts } from "@/lib/content/blog";
import { homepageLearningPaths, learningPathHref } from "@/lib/content/landing";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicSeeds, type TopicSeed } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";

export function getRelatedLearningPathsForTopic(topic: TopicSeed) {
  return homepageLearningPaths
    .filter((path) => path.links.some((link) => link.href === topicPath(topic.slug)))
    .map((path) => ({
      title: path.title,
      href: learningPathHref(path.slug),
      description: path.description,
    }));
}

export function getRelatedBlogGuidesForTopic(topic: TopicSeed, limit = 3) {
  return getBlogPosts()
    .filter((post) => getBlogPostTopic(post)?.slug === topic.slug)
    .slice(0, limit)
    .map((post) => ({
      title: post.title,
      href: `/blog/${post.slug}`,
      description: post.description,
      date: post.date,
    }));
}

export function getRelatedTopicModesForTopic(topic: TopicSeed, limit = 4) {
  const pathConnectedSlugs = new Set(
    homepageLearningPaths.flatMap((path) => {
      const hasTopic = path.links.some((link) => link.href === topicPath(topic.slug));
      if (!hasTopic) return [];
      return path.links.map((link) => link.href.replace(/^\/chat\//, ""));
    }),
  );

  const scoredTopics = topicSeeds
    .filter((candidate) => candidate.slug !== topic.slug)
    .map((candidate) => ({
      topic: candidate,
      score:
        (pathConnectedSlugs.has(candidate.slug) ? 3 : 0) +
        (candidate.metadata.category === topic.metadata.category ? 2 : 0),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.topic.sortOrder - b.topic.sortOrder)
    .slice(0, limit);

  const fallbackTopics =
    scoredTopics.length > 0
      ? scoredTopics
      : topicSeeds
          .filter((candidate) => candidate.slug !== topic.slug)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .slice(0, limit)
          .map((candidate) => ({ topic: candidate, score: 0 }));

  return fallbackTopics.map(({ topic: relatedTopic }) => {
    const seo = getTopicSeo(relatedTopic);
    return {
      title: relatedTopic.name,
      href: topicPath(relatedTopic.slug),
      description: seo.description,
      category: relatedTopic.metadata.category,
    };
  });
}

export function topicPublicFaqs(topic: TopicSeed) {
  const seo = getTopicSeo(topic);
  const starters = topic.metadata.starters;
  const firstStarter = starters[0] ?? `Help me with ${topic.name.toLowerCase()}`;

  return [
    {
      question: `Can I use ${topic.name} without signing in?`,
      answer: `Yes. ${topic.name} opens as a public guest learning mode at ${topicPath(
        topic.slug,
      )}, so you can start with a few free guest messages before creating an account.`,
    },
    {
      question: `What should I ask ${topic.name} first?`,
      answer: `Start with a specific goal such as "${firstStarter}". The mode works best when you include what you already know, where you are stuck, and what kind of help you want.`,
    },
    {
      question: `How is ${topic.name} different from a generic chatbot?`,
      answer: `${seo.whyDifferent} The page also includes example prompts and related study paths so the session can turn into practice, review, or deeper exploration.`,
    },
  ];
}
