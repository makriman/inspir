import assert from "node:assert/strict";
import test from "node:test";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import manifest from "../app/manifest";
import {
  getBlogCategories,
  getBlogPost,
  getBlogPostTopic,
  getBlogPosts,
  getRelatedBlogPosts,
} from "../lib/content/blog";
import { homepageFaqs, homepageLearningPaths, learningPathHref } from "../lib/content/landing";
import { topicSeeds } from "../lib/content/topics";
import {
  defaultTopicPath,
  isKnownTopicSlug,
  isUuidPathSegment,
  resolveTopicSlug,
  topicPath,
} from "../lib/content/topic-routing";
import { buildAiContentIndex, buildLlmsFullTxt, buildLlmsTxt } from "../lib/seo/ai-index";
import { absoluteUrl, metadataAlternates, socialImage } from "../lib/seo/config";
import {
  faqPageJsonLd,
  itemListJsonLd,
  learningModesItemListJsonLd,
  serializeJsonLd,
  topicJsonLd,
  videoObjectJsonLd,
  webPageJsonLd,
} from "../lib/seo/json-ld";
import { buildRssFeed } from "../lib/seo/rss";

test("topic routing separates public slugs from private uuid chats", () => {
  assert.equal(defaultTopicPath(), "/chat/learn-anything");
  assert.equal(resolveTopicSlug("askmeanything"), "learn-anything");
  assert.equal(resolveTopicSlug("socratic-instruction"), "socratic-instruction");
  assert.equal(isKnownTopicSlug("homework-coach"), true);
  assert.equal(isKnownTopicSlug("not-a-topic"), false);
  assert.equal(isUuidPathSegment("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(isUuidPathSegment("learn-anything"), false);
});

test("sitemap includes public topic and blog pages but excludes private surfaces", () => {
  const urls = sitemap().map((entry) => entry.url);
  const posts = getBlogPosts();

  for (const topic of topicSeeds) {
    assert.ok(urls.includes(absoluteUrl(topicPath(topic.slug))), `${topic.slug} should be in sitemap`);
  }

  for (const post of posts) {
    assert.ok(urls.includes(absoluteUrl(`/blog/${post.slug}`)), `${post.slug} should be in sitemap`);
  }

  for (const category of getBlogCategories()) {
    assert.ok(urls.includes(absoluteUrl(`/blog/category/${category.slug}`)), `${category.slug} should be in sitemap`);
  }

  assert.ok(posts.length >= 100);
  assert.ok(urls.includes(absoluteUrl("/")));
  assert.ok(urls.includes(absoluteUrl("/topics")));
  assert.ok(urls.includes(absoluteUrl("/learn")));
  assert.ok(urls.includes(absoluteUrl("/blog")));
  for (const path of homepageLearningPaths) {
    assert.ok(urls.includes(absoluteUrl(learningPathHref(path.slug))), `${path.slug} should be in sitemap`);
  }
  assert.ok(sitemap().some((entry) => entry.images?.includes(absoluteUrl("/inspir-social-preview.png"))));
  assert.equal(urls.some((url) => url.includes("/admin") || url.includes("/api/")), false);
  assert.equal(urls.some((url) => /\/chat\/[0-9a-f-]{36}$/i.test(url)), false);
});

test("topic json-ld uses absolute public chat urls", () => {
  const topic = topicSeeds.find((candidate) => candidate.slug === "socratic-instruction");
  assert.ok(topic);

  const entries = topicJsonLd(topic);
  const serialized = JSON.stringify(entries);
  assert.ok(serialized.includes(absoluteUrl("/chat/socratic-instruction")));
  assert.ok(serialized.includes(absoluteUrl("/topics")));
  assert.ok(serialized.includes("LearningResource"));
  assert.ok(serialized.includes("SoftwareApplication"));
  assert.ok(serialized.includes("BreadcrumbList"));
});

test("learning modes item list exposes every public topic", () => {
  const jsonLd = learningModesItemListJsonLd(topicSeeds);
  const serialized = JSON.stringify(jsonLd);

  assert.equal(jsonLd.itemListElement.length, topicSeeds.length);
  for (const topic of topicSeeds) {
    assert.ok(serialized.includes(absoluteUrl(topicPath(topic.slug))), `${topic.slug} should be in item list`);
  }
});

test("robots allows AI search crawlers while blocking training crawlers and private areas", () => {
  const output = robots();
  const rules = Array.isArray(output.rules) ? output.rules : [output.rules];
  const trainingRule = rules.find((rule) => {
    const agents = Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent];
    return agents.includes("GPTBot") && agents.includes("ClaudeBot");
  });
  const searchRule = rules.find((rule) => {
    const agents = Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent];
    return agents.includes("OAI-SearchBot") && agents.includes("PerplexityBot");
  });

  assert.equal(trainingRule?.disallow, "/");
  assert.equal(searchRule?.allow, "/");
  assert.ok(Array.isArray(searchRule?.disallow));
  assert.ok((searchRule?.disallow as string[]).includes("/api/"));
  assert.equal(output.sitemap, absoluteUrl("/sitemap.xml"));
});

test("json-ld serialization escapes html-sensitive characters", () => {
  const serialized = serializeJsonLd({ name: "Safe <script>alert(1)</script>" });
  assert.equal(serialized.includes("<script>"), false);
  assert.ok(serialized.includes("\\u003cscript>"));
});

test("public page json-ld helpers emit absolute citation urls", () => {
  const page = webPageJsonLd({
    path: "/media",
    name: "Media",
    description: "Press facts",
    type: "AboutPage",
  });
  const list = itemListJsonLd({
    path: "/media",
    id: "official-links",
    name: "Official links",
    items: [{ name: "Mission", url: "/mission", description: "Mission page" }],
  });

  assert.equal(page.url, absoluteUrl("/media"));
  assert.equal(page["@type"], "AboutPage");
  assert.equal(list.itemListElement[0].url, absoluteUrl("/mission"));
});

test("video json-ld exposes the public learning film without unsafe markup", () => {
  const video = videoObjectJsonLd({
    path: "/",
    name: "inspir: You can Learn Anything",
    description: "A short film about learning.",
    thumbnailUrl: "https://example.com/thumb.jpg",
    contentUrl: "/media/inspir-learning-film.mp4",
  });

  assert.equal(video["@type"], "VideoObject");
  assert.equal(video["@id"], `${absoluteUrl("/")}#video`);
  assert.equal(video.contentUrl, absoluteUrl("/media/inspir-learning-film.mp4"));
  assert.equal(serializeJsonLd(video).includes("<iframe"), false);
});

test("faq json-ld exposes questions as answerable entities", () => {
  const faq = faqPageJsonLd({
    path: "/schools",
    questions: [
      {
        question: "Can schools try inspir first?",
        answer: "Yes. Schools can try public guest modes before a tailored deployment.",
      },
    ],
  });

  assert.equal(faq["@type"], "FAQPage");
  assert.equal(faq["@id"], `${absoluteUrl("/schools")}#faq`);
  assert.equal(faq.mainEntity[0]["@type"], "Question");
  assert.equal(faq.mainEntity[0].acceptedAnswer["@type"], "Answer");
});

test("homepage learning paths and faqs expose crawlable guest-mode guidance", () => {
  assert.equal(homepageLearningPaths.length, 4);
  assert.ok(homepageLearningPaths.every((path) => path.links.every((link) => link.href.startsWith("/chat/"))));
  assert.ok(homepageFaqs.some((item) => item.answer.includes("guest mode")));

  const faq = faqPageJsonLd({ path: "/", questions: homepageFaqs });
  const list = itemListJsonLd({
    path: "/",
    id: "learning-paths",
    name: "Popular AI learning paths",
    items: homepageLearningPaths.map((path) => ({
      name: path.title,
      url: learningPathHref(path.slug),
      description: path.description,
    })),
  });

  assert.equal(faq.mainEntity.length, homepageFaqs.length);
  assert.equal(list.itemListElement.length, homepageLearningPaths.length);
  assert.ok(homepageLearningPaths.every((path) => path.steps.length === 3));
  assert.ok(homepageLearningPaths.every((path) => path.relatedBlogSlugs.length >= 3));
  assert.ok(JSON.stringify(list).includes(absoluteUrl("/learn/understand-a-hard-topic")));
});

test("blog posts resolve related public modes and category clusters", () => {
  const post = getBlogPost("ai-learn-anything-guide");
  assert.ok(post);
  const topic = getBlogPostTopic(post);
  assert.equal(topic?.slug, "learn-anything");

  const related = getRelatedBlogPosts(post, 4);
  assert.ok(related.length > 0);
  assert.ok(getBlogCategories().some((category) => category.slug === "ai-tutor"));
});

test("rss feed exposes the blog library with escaped public links", () => {
  const posts = getBlogPosts();
  const feed = buildRssFeed(posts);

  assert.ok(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(feed.includes(`<atom:link href="${absoluteUrl("/rss.xml")}" rel="self" type="application/rss+xml" />`));
  assert.ok(feed.includes(absoluteUrl("/blog/ai-learn-anything-guide")));
  assert.ok(feed.includes(absoluteUrl("/inspir-social-preview.png")));
  assert.ok((feed.match(/<item>/g) ?? []).length >= 100);

  const escapedFeed = buildRssFeed([{ ...posts[0], title: "Safe <script>alert(1)</script>" }]);
  assert.equal(escapedFeed.includes("<script>"), false);
  assert.ok(escapedFeed.includes("Safe &lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("ai discovery files describe every public mode without exposing private chats", () => {
  const compact = buildLlmsTxt();
  const full = buildLlmsFullTxt();
  const index = buildAiContentIndex();
  const serialized = JSON.stringify(index);

  assert.ok(compact.includes(absoluteUrl("/llms-full.txt")));
  assert.ok(compact.includes(absoluteUrl("/ai-content-index.json")));
  assert.ok(compact.includes("Public learning entrypoints are canonical at /chat/{topicSlug}."));
  assert.ok(full.includes("# inspir Full AI-Readable Learning Index"));
  assert.ok(compact.includes(absoluteUrl("/learn/understand-a-hard-topic")));
  assert.ok(full.includes("## AI learning paths"));
  assert.ok(full.includes(`URL: ${absoluteUrl("/chat/learn-anything")}`));
  assert.ok(full.includes("Historical and persona simulations"));
  assert.equal(index.learningPaths.length, homepageLearningPaths.length);
  assert.ok(index.learningPaths.every((path) => path.url.includes("/learn/")));
  assert.equal(index.publicLearningModes.length, topicSeeds.length);
  assert.ok(index.blog.postCount >= 100);
  assert.ok(index.blog.posts.length >= 100);
  assert.ok(index.blog.categoryCount >= 1);
  assert.ok(index.publicLearningModes.every((mode) => mode.url.includes("/chat/")));
  assert.ok(
    index.publicLearningModes.some(
      (mode) => mode.slug === "socratic-instruction" && mode.searchIntents.includes("AI Socratic tutor"),
    ),
  );
  assert.equal(/\/chat\/[0-9a-f-]{36}/i.test(compact), false);
  assert.equal(/\/chat\/[0-9a-f-]{36}/i.test(full), false);
  assert.equal(/\/chat\/[0-9a-f-]{36}/i.test(serialized), false);
});

test("metadata alternates keep rss discovery alongside canonicals", () => {
  const alternates = metadataAlternates("/blog");

  assert.equal(alternates.canonical, "/blog");
  assert.equal(alternates.types["application/rss+xml"], "/rss.xml");
});

test("social image helper uses the local branded preview image", () => {
  const image = socialImage({
    title: "AI Socratic Tutor <script>",
    eyebrow: "Learning mode",
    description: "Ask better questions and learn actively.",
  });

  assert.equal(image.width, 1200);
  assert.equal(image.height, 630);
  assert.equal(image.url, absoluteUrl("/inspir-social-preview.png"));
  assert.equal(image.url.includes("bubble.io"), false);
  assert.equal(image.alt, "AI Socratic Tutor <script> | inspir");
});

test("web app manifest starts learners on the canonical guest mode", () => {
  const output = manifest();

  assert.equal(output.name, "inspir | Free AI learning for everyone");
  assert.equal(output.start_url, "/chat/learn-anything");
  assert.equal(output.display, "standalone");
  assert.ok(output.icons?.some((icon) => icon.src === "/inspir-app-icon.svg" && icon.purpose?.includes("maskable")));
  assert.ok(output.screenshots?.some((screenshot) => screenshot.src === "/inspir-social-preview.png"));
});
