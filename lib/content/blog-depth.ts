import {
  getBlogPostTopic,
  type BlogPost,
} from "@/lib/content/blog";
import {
  getBlogPostLearningGraph,
  type BlogLearningLink,
} from "@/lib/content/blog-link-graph";
import { getBlogPostPracticePlan } from "@/lib/content/blog-practice";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicPath } from "@/lib/content/topic-routing";

export type BlogDepthLink = Pick<BlogLearningLink, "href" | "title" | "description" | "eyebrow">;

export type BlogDepthSection = {
  title: string;
  paragraphs: string[];
  bullets: string[];
  links: BlogDepthLink[];
};

export type BlogDepth = {
  title: string;
  intro: string;
  sections: BlogDepthSection[];
};

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function promptField(systemPrompt: string, label: string) {
  const line = systemPrompt.split("\n").find((item) => item.startsWith(`${label}: `));
  return line?.replace(`${label}: `, "").trim() ?? "";
}

function uniqueLinks(links: BlogDepthLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.href)) return false;
    seen.add(link.href);
    return true;
  });
}

function fallbackLinks(modeHref: string, modeName: string): BlogDepthLink[] {
  return [
    {
      eyebrow: "Live mode",
      title: modeName,
      href: modeHref,
      description: `Open ${modeName} and turn the guide into a live tutoring session.`,
    },
    {
      eyebrow: "Prompt library",
      title: "AI learning prompt library",
      href: "/prompts",
      description: "Find starter prompts for explanations, checks, practice, planning, and revision.",
    },
    {
      eyebrow: "Learning map",
      title: "AI learning map",
      href: "/ai-learning-map",
      description: "Choose a workflow that connects articles, prompts, and public learning modes.",
    },
    {
      eyebrow: "Mode directory",
      title: "All AI learning modes",
      href: "/topics",
      description: "Compare every guest mode and pick the format that fits the learning job.",
    },
    {
      eyebrow: "Subject hubs",
      title: "AI subject learning hubs",
      href: "/subjects",
      description: "Find subject-specific routes for math, writing, coding, history, homework, and exams.",
    },
    {
      eyebrow: "Study path",
      title: "Understand a hard topic",
      href: "/learn/understand-a-hard-topic",
      description: "Use a guided path for moving from confusion to examples, checks, and recall.",
    },
    {
      eyebrow: "Audience path",
      title: "AI learning for students",
      href: "/for/students",
      description: "See how students can use AI tutoring while keeping the thinking active.",
    },
    {
      eyebrow: "Trust",
      title: "Guest mode and private chats",
      href: "/trust",
      description: "Review the public/private boundaries behind guest modes and saved chats.",
    },
    {
      eyebrow: "Blog hub",
      title: "AI learning guide library",
      href: "/blog",
      description: "Browse the full library of AI tutor guides, prompt loops, and study methods.",
    },
  ];
}

export function getBlogPostDepth(post: BlogPost): BlogDepth {
  const topic = getBlogPostTopic(post);
  const graph = getBlogPostLearningGraph(post);
  const practicePlan = getBlogPostPracticePlan(post);
  const modeName = topic?.name ?? "Learn Anything";
  const modeHref = topic ? topicPath(topic.slug) : "/chat/learn-anything";
  const seo = topic ? getTopicSeo(topic) : null;
  const guideType = post.slug.endsWith("-prompts-and-study-loop") ? "prompt loop" : "guide";
  const category = topic?.metadata.category ?? post.tags[0] ?? "learning";
  const starters = topic?.metadata.starters.slice(0, 3) ?? [
    "Explain the idea simply",
    "Ask me one check question",
    "Turn this into a practice plan",
  ];
  const purpose = topic ? promptField(topic.systemPrompt, "Purpose") : "";
  const loop = topic ? promptField(topic.systemPrompt, "Learning loop") : "";
  const output = topic ? promptField(topic.systemPrompt, "Output style") : "";
  const defaultLinks = fallbackLinks(modeHref, modeName);
  const links = uniqueLinks([
    defaultLinks[0],
    ...graph.primaryLinks,
    ...graph.prompts,
    ...graph.secondaryLinks,
    ...practicePlan.routes,
    ...defaultLinks.slice(1),
  ]);

  return {
    title: `How to turn this ${guideType} into active learning`,
    intro: `${post.title} is designed to be used, not just read. The best next step is to move from the article into a specific learning job: open ${modeName}, give it context, answer before asking for the solution, and use the feedback to decide what to review next.`,
    sections: [
      {
        title: `When ${modeName} is the right next step`,
        paragraphs: [
          cleanText(
            `${modeName} fits this article because it is built for ${category.toLowerCase()} learning, not generic chat. ${
              seo?.who ?? "It is useful for learners who want guidance, practice, and a clearer next move."
            }`,
          ),
          cleanText(
            purpose
              ? `Inside the live mode, the core job is: ${purpose}. That focus keeps the session pointed at progress instead of another long explanation.`
              : "Inside the live mode, the goal is to turn a vague question into a focused session with examples, checks, and a useful next action.",
          ),
        ],
        bullets: [
          seo?.outcomes[0] ?? "Name the topic or skill you want to understand.",
          seo?.outcomes[1] ?? "Ask for one small task before asking for the answer.",
          seo?.outcomes[2] ?? "Close with a recap or review plan you can use later.",
        ],
        links: links.slice(0, 3),
      },
      {
        title: "A stronger first prompt",
        paragraphs: [
          `A weak prompt only names a topic. A strong prompt names the topic, the level, the sticking point, and the kind of help you want. Use this ${guideType} as the context, then ask the mode to make you do something with it.`,
          cleanText(
            loop
              ? `The session should follow this loop: ${loop}. If the AI skips straight to the finish, ask it to slow down and check your reasoning first.`
              : "The session should move through explanation, your attempt, feedback, repair, and a short proof of understanding.",
          ),
        ],
        bullets: starters.map((starter) => `Start with "${starter}", then add what you already know and where you are stuck.`),
        links: links.slice(3, 6),
      },
      {
        title: "Checks that keep the learning honest",
        paragraphs: [
          cleanText(
            output
              ? `Good output for this mode should feel usable: ${output}. If the response is too broad, ask for one example, one misconception, or one check question.`
              : "Good output should make the next action obvious. If the response is too broad, ask for one example, one misconception, or one check question.",
          ),
          "Before leaving the article, prove that the idea is yours. Write a short recap from memory, answer a fresh question, or explain the concept to an imaginary beginner without copying the AI's phrasing.",
        ],
        bullets: [
          "Did you answer at least one question before reading the correction?",
          "Can you explain the main idea without looking back at the article?",
          "Do you know which route to use next: a mode, prompt, subject hub, or related guide?",
        ],
        links: links.slice(6, 9),
      },
    ],
  };
}

export function getBlogPostDepthText(post: BlogPost) {
  const depth = getBlogPostDepth(post);

  return [
    depth.title,
    depth.intro,
    ...depth.sections.flatMap((section) => [
      section.title,
      ...section.paragraphs,
      ...section.bullets,
      ...section.links.flatMap((link) => [link.title, link.description]),
    ]),
  ].join(" ");
}

export function estimateBlogIndexedWordCount(post: BlogPost) {
  const practicePlan = getBlogPostPracticePlan(post);
  const practiceText = [
    practicePlan.title,
    practicePlan.intro,
    ...practicePlan.steps.flatMap((step) => [step.title, step.text]),
    ...practicePlan.checks,
    ...practicePlan.routes.flatMap((route) => [route.title, route.description]),
  ].join(" ");

  return wordCount([post.body, getBlogPostDepthText(post), practiceText].join(" "));
}

export function estimateBlogIndexedReadingMinutes(post: BlogPost) {
  return Math.max(1, Math.ceil(estimateBlogIndexedWordCount(post) / 220));
}
