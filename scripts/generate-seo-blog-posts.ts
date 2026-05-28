import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { topicSeeds, type TopicSeed } from "../lib/content/topics";
import { getTopicSeo } from "../lib/content/topic-seo";

const blogDirectory = join(process.cwd(), "content", "blog");
const launchDate = new Date("2026-05-28T00:00:00.000Z");

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function frontmatterString(value: string) {
  return `"${clean(value).replace(/"/g, '\\"')}"`;
}

function articleDate(index: number) {
  const date = new Date(launchDate);
  date.setUTCDate(launchDate.getUTCDate() - Math.floor(index / 2));
  return date.toISOString().slice(0, 10);
}

function starterList(topic: TopicSeed) {
  return topic.metadata.starters.map((starter) => `- "${starter}"`).join("\n");
}

function relatedTopic(topic: TopicSeed, offset: number) {
  const index = topicSeeds.findIndex((candidate) => candidate.slug === topic.slug);
  return topicSeeds[(index + offset + topicSeeds.length) % topicSeeds.length];
}

function makeGuidePost(topic: TopicSeed, index: number) {
  const seo = getTopicSeo(topic);
  const next = relatedTopic(topic, 1);
  const description = `A practical guide to using ${topic.name} on inspir for ${topic.metadata.category.toLowerCase()} learning, with prompts, study loops, and safer AI habits.`;

  return {
    slug: topic.slug.endsWith("-guide") ? `ai-${topic.slug}` : `ai-${topic.slug}-guide`,
    markdown: `---
title: ${frontmatterString(`${seo.title}: practical guide`)}
description: ${frontmatterString(description)}
date: "${articleDate(index)}"
author: "inspir"
tags: [AI tutor, ${topic.metadata.category}, ${topic.name}]
---

${seo.title} is a focused way to use AI for learning instead of passive answer collection. The mode is built around a specific job: ${clean(topic.description)}

That focus matters. A general chatbot can answer almost anything, but a learning mode gives the conversation a shape. It nudges you toward the kind of thinking, practice, feedback, or exploration that helps the idea stick.

## What this mode helps with

${seo.who}

Use [${topic.name}](/chat/${topic.slug}) when you want a session that starts quickly but still adapts to you. The first goal is not to sound impressive. The first goal is to make the next step feel possible.

This mode is especially useful for learners who want to:

${seo.outcomes.map((outcome) => `- ${outcome}.`).join("\n")}

## Why it is different from a generic chatbot

${seo.whyDifferent}

That difference shows up in the flow. Instead of one giant response, the best sessions move through a loop: set a goal, try something, get feedback, repair the weak spot, and choose the next action.

## Prompts to try

${starterList(topic)}

You can also start with a rough version of your real problem. A messy first prompt is fine. The session can clarify the level, audience, deadline, and style once you begin.

## A stronger study loop

1. Tell the mode what you are trying to learn or produce.
2. Ask for a small first step rather than a final answer.
3. Try the step in your own words.
4. Ask the AI to check your reasoning, not just the result.
5. Finish by writing the idea back from memory.

This is the same habit behind [studying with AI without cheating yourself](/blog/how-to-study-with-ai-without-cheating-yourself): keep the learner active. AI is most useful when it gives you feedback on your thinking.

## Where to go next

Start the live mode at [${topic.name}](/chat/${topic.slug}). If you want a neighboring learning format, try [${next.name}](/chat/${next.slug}). For a broader view of the platform, read [what an AI learning companion should do for everyone](/blog/ai-learning-companion-for-everyone).
`,
  };
}

function makePromptPost(topic: TopicSeed, index: number) {
  const seo = getTopicSeo(topic);
  const previous = relatedTopic(topic, -1);
  const description = `Prompt ideas and a repeatable study loop for getting useful learning results from ${topic.name} on inspir.`;

  return {
    slug: `${topic.slug}-prompts-and-study-loop`,
    markdown: `---
title: ${frontmatterString(`${topic.name} prompts and study loop`)}
description: ${frontmatterString(description)}
date: "${articleDate(index)}"
author: "inspir"
tags: [AI prompts, ${topic.metadata.category}, study skills]
---

The fastest way to get value from [${topic.name}](/chat/${topic.slug}) is to give the AI a learning job, not just a topic. A topic says what you are interested in. A learning job says what kind of help you need.

For this mode, the job is simple: ${seo.description}

## Start with one clear request

Good prompts usually include three things: the subject, your current level, and the kind of help you want. You do not need perfect wording. You only need enough context for the session to begin.

Try one of these starters:

${starterList(topic)}

Then add a constraint that makes the session more personal:

- "Keep it beginner friendly."
- "Ask me questions before explaining too much."
- "Check my answer before giving yours."
- "Give me a harder version after I try."
- "Use examples from my exam, project, or daily life."

## Turn the mode into practice

Reading an AI response is not the same as learning. After the first answer, ask the mode to make you do something with the idea.

For ${topic.name}, a useful practice loop is:

1. State the goal in one sentence.
2. Ask for a tiny first task.
3. Respond before asking for the solution.
4. Request feedback on the part that felt uncertain.
5. End with a recap you write yourself.

That final recap is important. When you explain the idea back, you reveal what is solid and what is still borrowed from the AI.

## Make the output more useful

If the response feels too broad, narrow it. Ask for one example, one misconception, one check question, or one next step. If it feels too easy, ask for a challenge. If it feels too hard, ask for a bridge from what you already know.

The best learning sessions are adjustable. ${seo.whyDifferent}

## Related learning paths

Use [${topic.name}](/chat/${topic.slug}) when this is the right mode for the job. If you want a related path, try [${previous.name}](/chat/${previous.slug}). You can also browse the [AI learning blog](/blog) for study methods, Socratic learning, flashcards, roleplay, and active recall.
`,
  };
}

mkdirSync(blogDirectory, { recursive: true });

const posts = topicSeeds.flatMap((topic, index) => [
  makeGuidePost(topic, index * 2),
  makePromptPost(topic, index * 2 + 1),
]);

let written = 0;
for (const post of posts) {
  const path = join(blogDirectory, `${post.slug}.md`);
  if (existsSync(path)) continue;
  writeFileSync(path, post.markdown, "utf8");
  written += 1;
}

console.log(`Generated ${written} SEO blog posts in ${blogDirectory}`);
