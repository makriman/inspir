import assert from "node:assert/strict";
import test from "node:test";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { getBlogPosts } from "../lib/content/blog";
import { topicSeeds } from "../lib/content/topics";
import {
  defaultTopicPath,
  isKnownTopicSlug,
  isUuidPathSegment,
  resolveTopicSlug,
  topicPath,
} from "../lib/content/topic-routing";
import { absoluteUrl } from "../lib/seo/config";
import { serializeJsonLd, topicJsonLd } from "../lib/seo/json-ld";

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

  assert.ok(posts.length >= 100);
  assert.ok(urls.includes(absoluteUrl("/")));
  assert.ok(urls.includes(absoluteUrl("/blog")));
  assert.equal(urls.some((url) => url.includes("/admin") || url.includes("/api/")), false);
  assert.equal(urls.some((url) => /\/chat\/[0-9a-f-]{36}$/i.test(url)), false);
});

test("topic json-ld uses absolute public chat urls", () => {
  const topic = topicSeeds.find((candidate) => candidate.slug === "socratic-instruction");
  assert.ok(topic);

  const entries = topicJsonLd(topic);
  const serialized = JSON.stringify(entries);
  assert.ok(serialized.includes(absoluteUrl("/chat/socratic-instruction")));
  assert.ok(serialized.includes("LearningResource"));
  assert.ok(serialized.includes("SoftwareApplication"));
  assert.ok(serialized.includes("BreadcrumbList"));
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
