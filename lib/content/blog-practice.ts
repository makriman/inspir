import { getBlogPostTopic, type BlogPost } from "@/lib/content/blog";
import { getBlogPostLearningGraph, type BlogLearningLink } from "@/lib/content/blog-link-graph";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicPath } from "@/lib/content/topic-routing";

export type BlogPracticeStep = {
  title: string;
  text: string;
};

export type BlogPracticePlan = {
  title: string;
  intro: string;
  steps: BlogPracticeStep[];
  checks: string[];
  routes: BlogLearningLink[];
};

function uniqueRoutes(routes: BlogLearningLink[]) {
  const seen = new Set<string>();

  return routes.filter((route) => {
    const key = route.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getBlogPostPracticePlan(post: BlogPost): BlogPracticePlan {
  const topic = getBlogPostTopic(post);
  const graph = getBlogPostLearningGraph(post);
  const modeName = topic?.name ?? "Learn Anything";
  const modeHref = topic ? topicPath(topic.slug) : "/chat/learn-anything";
  const topicSeo = topic ? getTopicSeo(topic) : null;
  const firstStarter = topic?.metadata.starters[0];
  const routeSeed: BlogLearningLink = {
    kind: "mode",
    eyebrow: "Live mode",
    title: modeName,
    href: modeHref,
    description:
      topicSeo?.description ??
      "Use a live AI learning mode to turn this guide into questions, feedback, examples, and next steps.",
  };
  const fallbackRoutes: BlogLearningLink[] = [
    {
      kind: "workflow",
      eyebrow: "Learning map",
      title: "AI Learning Map",
      href: "/ai-learning-map",
      description: "Choose a workflow that connects guides, prompts, and live learning modes.",
    },
    {
      kind: "prompt",
      eyebrow: "Prompt library",
      title: "AI Learning Prompt Library",
      href: "/prompts",
      description: "Browse starter prompts that turn reading into questions, checks, and practice.",
    },
    {
      kind: "related-mode",
      eyebrow: "Mode directory",
      title: "All AI learning modes",
      href: "/topics",
      description: "Compare every public guest mode and choose the right format for the next step.",
    },
  ];
  const routes = uniqueRoutes([
    routeSeed,
    ...graph.primaryLinks,
    ...graph.prompts,
    ...graph.secondaryLinks,
    ...fallbackRoutes,
  ]).slice(0, 5);

  return {
    title: topic ? `A 12-minute ${modeName} practice loop` : "A 12-minute active learning loop",
    intro: `Use "${post.title}" as a launchpad, not a stopping point. The strongest learning session moves from reading into recall, feedback, and one visible next step.`,
    steps: [
      {
        title: "Name the learning job",
        text: `Write one sentence that says what you want to understand, remember, decide, or produce after reading this guide.`,
      },
      {
        title: `Open ${modeName}`,
        text: `Use the live mode and paste your goal, a paragraph from the article, or the part that still feels fuzzy. Ask for one small task before asking for a full explanation.`,
      },
      {
        title: "Make the AI test your thinking",
        text: "Ask for a misconception check, a short retrieval question, or a harder example. Answer before asking the AI to correct you.",
      },
      {
        title: "Close with proof",
        text: "Finish by writing a five-bullet recap from memory, then ask for the one weak spot to review tomorrow.",
      },
    ],
    checks: [
      "Can you explain the main idea without looking back at the article?",
      firstStarter
        ? `Could you handle a starter prompt like "${firstStarter}" with less help than before?`
        : "Could you turn the article into one concrete prompt or question?",
      "Did the AI check your reasoning instead of simply replacing it?",
      "Do you have a next route open: a mode, subject hub, workflow, or related guide?",
    ],
    routes,
  };
}
