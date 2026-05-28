import { getBlogPostTopic, type BlogPost } from "@/lib/content/blog";
import { homepageLearningPaths, learningPathHref } from "@/lib/content/landing";
import { getLearningMapWorkflows } from "@/lib/content/learning-map";
import { getPromptEntries } from "@/lib/content/prompt-library";
import { getSubjectPages, subjectPath } from "@/lib/content/subjects";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicPath } from "@/lib/content/topic-routing";
import {
  getRelatedLearningPathsForTopic,
  getRelatedTopicModesForTopic,
} from "@/lib/content/topic-public-seo";

export type BlogLearningLink = {
  kind: "mode" | "subject" | "path" | "workflow" | "prompt" | "related-mode";
  eyebrow: string;
  title: string;
  href: string;
  description: string;
};

function uniqueLinks(links: BlogLearningLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.kind}:${link.href}:${link.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getBlogPostLearningGraph(post: BlogPost) {
  const topic = getBlogPostTopic(post);
  const subjectMatches = getSubjectPages().filter((page) => {
    if (page.guideSlugs.includes(post.slug)) return true;
    if (topic && page.modeSlugs.includes(topic.slug)) return true;
    return post.tags.some((tag) => page.searchIntents.some((intent) => intent.toLowerCase().includes(tag.toLowerCase())));
  });
  const learningPaths = topic
    ? getRelatedLearningPathsForTopic(topic)
    : homepageLearningPaths
        .filter((path) => (path.relatedBlogSlugs as readonly string[]).includes(post.slug))
        .map((path) => ({
          title: path.title,
          href: learningPathHref(path.slug),
          description: path.description,
        }));
  const workflows = getLearningMapWorkflows()
    .filter((workflow) => {
      const guideMatch = workflow.guides.some((guide) => guide.href === `/blog/${post.slug}`);
      const modeMatch = topic ? workflow.modes.some((mode) => mode.slug === topic.slug) : false;
      return guideMatch || modeMatch;
    })
    .map((workflow) => ({
      title: workflow.title,
      href: workflow.href,
      description: workflow.description,
    }));
  const prompts = topic
    ? getPromptEntries()
        .filter((entry) => entry.topicSlug === topic.slug)
        .slice(0, 3)
    : [];
  const relatedModes = topic ? getRelatedTopicModesForTopic(topic, 4) : [];

  const modeLink: BlogLearningLink[] = topic
    ? [
        {
          kind: "mode",
          eyebrow: "Live mode",
          title: topic.name,
          href: topicPath(topic.slug),
          description: getTopicSeo(topic).description,
        },
      ]
    : [];
  const subjectLinks: BlogLearningLink[] = subjectMatches.map((page) => ({
    kind: "subject",
    eyebrow: "Subject hub",
    title: page.seoTitle,
    href: subjectPath(page.slug),
    description: page.description,
  }));
  const pathLinks: BlogLearningLink[] = learningPaths.map((path) => ({
    kind: "path",
    eyebrow: "Learning path",
    title: path.title,
    href: path.href,
    description: path.description,
  }));
  const workflowLinks: BlogLearningLink[] = workflows.map((workflow) => ({
    kind: "workflow",
    eyebrow: "Workflow",
    title: workflow.title,
    href: workflow.href,
    description: workflow.description,
  }));
  const promptLinks: BlogLearningLink[] = prompts.map((prompt) => ({
    kind: "prompt",
    eyebrow: "Starter prompt",
    title: prompt.prompt,
    href: prompt.href,
    description: `Try this prompt in ${prompt.topicName}: ${prompt.description}`,
  }));
  const relatedModeLinks: BlogLearningLink[] = relatedModes.map((mode) => ({
    kind: "related-mode",
    eyebrow: mode.category,
    title: mode.title,
    href: mode.href,
    description: mode.description,
  }));

  const primaryLinks = uniqueLinks([
    ...modeLink,
    ...subjectLinks.slice(0, 1),
    ...pathLinks.slice(0, 1),
    ...workflowLinks.slice(0, 1),
  ]);
  const secondaryLinks = uniqueLinks([
    ...subjectLinks,
    ...pathLinks,
    ...workflowLinks,
    ...relatedModeLinks,
    ...promptLinks,
  ]).slice(0, 10);

  return {
    topic,
    primaryLinks,
    secondaryLinks,
    subjectLinks,
    learningPaths: pathLinks,
    workflows: workflowLinks,
    prompts: promptLinks,
    relatedModes: relatedModeLinks,
  };
}
