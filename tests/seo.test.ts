import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import robots from "../app/robots";
import manifest from "../app/manifest";
import nextConfig from "../next.config";
import {
  blogHeadingId,
  estimateBlogReadingMinutes,
  extractBlogHeadings,
  getBlogCategories,
  getBlogPost,
  getBlogPostTopic,
  getBlogPosts,
  getRelatedBlogPosts,
} from "../lib/content/blog";
import {
  estimateBlogIndexedReadingMinutes,
  estimateBlogIndexedWordCount,
  getBlogPostDepth,
  getBlogPostDepthText,
} from "../lib/content/blog-depth";
import { getBlogPostLearningGraph } from "../lib/content/blog-link-graph";
import { getBlogPostPracticePlan } from "../lib/content/blog-practice";
import {
  audienceHubFaqs,
  audienceHubSearchIntents,
  audiencePath,
  getAudiencePage,
  getAudiencePageResources,
  getAudiencePages,
} from "../lib/content/audiences";
import {
  aboutFaqs,
  aboutProofPoints,
  aboutStoryLinks,
  aboutTimeline,
  authorityReferenceLinks,
  mediaAttributionFacts,
  mediaCitationSnippets,
  mediaCoverageLinks,
  mediaFaqs,
  mediaLinkingTargets,
  mediaOfficialLinks,
  mediaStoryAngles,
  missionFaqs,
  missionPrinciples,
  schoolDeploymentSteps,
  schoolFaqs,
  schoolFeatures,
  schoolSearchIntents,
  schoolUseCases,
  trustFaqs,
  trustPrinciples,
  trustPublicAccessPolicies,
  trustReferenceLinks,
  trustSafeguards,
} from "../lib/content/authority";
import {
  blogHubFaqs,
  getBlogCategoryFaqs,
  getBlogCategoryFeaturedPosts,
  getBlogCategoryProfile,
  getBlogCategoryRelatedModes,
  getBlogPillarClusters,
} from "../lib/content/blog-directory";
import { categoryHasIndexedPosts, indexedBlogPosts, isIndexedBlogPost } from "../lib/content/blog-seo-policy";
import { supportedLanguages } from "../lib/content/languages";
import {
  comparisonHubFaqs,
  comparisonHubSearchIntents,
  comparisonPath,
  getComparisonPage,
  getComparisonPageResources,
  getComparisonPages,
} from "../lib/content/comparisons";
import {
  homepageFaqs,
  homepageFilm,
  homepageHeroRoutes,
  homepageLearningPaths,
  learningPathHref,
} from "../lib/content/landing";
import {
  getLearningMapWorkflows,
  learningMapFaqs,
  learningMapSearchIntents,
} from "../lib/content/learning-map";
import {
  getPromptCategoryHubs,
  getPromptEntries,
  getPromptSpotlightEntries,
  promptLibraryFaqs,
  promptLibrarySearchIntents,
} from "../lib/content/prompt-library";
import {
  getSubjectPage,
  getSubjectPageResources,
  getSubjectPages,
  subjectHubFaqs,
  subjectHubSearchIntents,
  subjectPath,
} from "../lib/content/subjects";
import {
  getTopicCategoryHubs,
  getTopicSpotlightModes,
  topicDirectoryFaqs,
} from "../lib/content/topic-directory";
import {
  getRelatedBlogGuidesForTopic,
  getRelatedLearningPathsForTopic,
  getRelatedTopicModesForTopic,
  topicPublicFaqs,
} from "../lib/content/topic-public-seo";
import { getTopicSeo } from "../lib/content/topic-seo";
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
  blogLearningResourceJsonLd,
  blogPostingJsonLd,
  faqPageJsonLd,
  howToJsonLd,
  itemListJsonLd,
  learningModesItemListJsonLd,
  serializeJsonLd,
  siteNavigationJsonLd,
  topicJsonLd,
  videoObjectJsonLd,
  webPageJsonLd,
} from "../lib/seo/json-ld";
import { buildRssFeed } from "../lib/seo/rss";
import sitemap, {
  buildLanguageSitemapXml,
  buildSitemapIndexXml,
  buildSitemapXml,
  languageFromSitemapFileSlug,
  sitemapFilePathForLanguage,
  sitemapIndexEntries,
  sitemapLanguages,
} from "../lib/seo/sitemap";

test("topic routing separates public slugs from private uuid chats", () => {
  assert.equal(defaultTopicPath(), "/chat/learn-anything");
  assert.equal(resolveTopicSlug("askmeanything"), "learn-anything");
  assert.equal(resolveTopicSlug("socratic-instruction"), "socratic-instruction");
  assert.equal(isKnownTopicSlug("homework-coach"), true);
  assert.equal(isKnownTopicSlug("not-a-topic"), false);
  assert.equal(isUuidPathSegment("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(isUuidPathSegment("learn-anything"), false);
});

test("sitemap includes SEO pages but excludes chat app surfaces", () => {
  const urls = sitemap().map((entry) => entry.url);
  const posts = getBlogPosts();
  const indexedPosts = indexedBlogPosts(posts);

  for (const topic of topicSeeds) {
    assert.equal(urls.includes(absoluteUrl(topicPath(topic.slug))), false, `${topic.slug} chat should stay out of sitemap`);
  }

  for (const post of indexedPosts) {
    assert.ok(urls.includes(absoluteUrl(`/blog/${post.slug}`)), `${post.slug} should be in sitemap`);
  }

  for (const post of posts.filter((post) => !isIndexedBlogPost(post))) {
    assert.equal(urls.includes(absoluteUrl(`/blog/${post.slug}`)), false, `${post.slug} should stay out of sitemap`);
  }

  for (const category of getBlogCategories()) {
    assert.equal(
      urls.includes(absoluteUrl(`/blog/category/${category.slug}`)),
      categoryHasIndexedPosts(category),
      `${category.slug} sitemap inclusion should follow indexed guide availability`,
    );
  }

  assert.ok(posts.length >= 100);
  assert.ok(indexedPosts.length > 0);
  assert.ok(urls.includes(absoluteUrl("/")));
  assert.ok(urls.includes(absoluteUrl("/topics")));
  assert.ok(urls.includes(absoluteUrl("/subjects")));
  assert.ok(urls.includes(absoluteUrl("/prompts")));
  assert.ok(urls.includes(absoluteUrl("/ai-learning-map")));
  assert.ok(urls.includes(absoluteUrl("/compare")));
  assert.ok(urls.includes(absoluteUrl("/for")));
  assert.ok(urls.includes(absoluteUrl("/learn")));
  assert.ok(urls.includes(absoluteUrl("/schools")));
  assert.ok(urls.includes(absoluteUrl("/trust")));
  assert.ok(urls.includes(absoluteUrl("/blog")));
  for (const path of homepageLearningPaths) {
    assert.ok(urls.includes(absoluteUrl(learningPathHref(path.slug))), `${path.slug} should be in sitemap`);
  }
  for (const page of getComparisonPages()) {
    assert.ok(urls.includes(absoluteUrl(comparisonPath(page.slug))), `${page.slug} should be in sitemap`);
  }
  for (const page of getAudiencePages()) {
    assert.ok(urls.includes(absoluteUrl(audiencePath(page.slug))), `${page.slug} should be in sitemap`);
  }
  for (const page of getSubjectPages()) {
    assert.ok(urls.includes(absoluteUrl(subjectPath(page.slug))), `${page.slug} should be in sitemap`);
  }
  assert.ok(sitemap().some((entry) => entry.images?.some((image) => image.startsWith(absoluteUrl("/og?")))));
  const homeEntry = sitemap().find((entry) => entry.url === absoluteUrl("/"));
  assert.ok(homeEntry?.videos?.some((video) => video.content_loc === absoluteUrl(homepageFilm.contentUrl)));
  assert.ok(homeEntry?.videos?.some((video) => video.thumbnail_loc === absoluteUrl(homepageFilm.thumbnailUrl)));
  assert.equal(homeEntry?.videos?.[0]?.duration, 31);
  assert.equal(homeEntry?.videos?.[0]?.requires_subscription, "no");
  assert.equal(homeEntry?.alternates?.languages?.["en-US"], absoluteUrl("/"));
  assert.equal(homeEntry?.alternates?.languages?.es, absoluteUrl("/es"));
  assert.equal(homeEntry?.alternates?.languages?.ar, absoluteUrl("/ar"));
  assert.equal(homeEntry?.alternates?.languages?.hy, absoluteUrl("/hy"));
  assert.equal(homeEntry?.alternates?.languages?.["x-default"], absoluteUrl("/"));
  assert.equal(urls.some((url) => url.includes("/admin") || url.includes("/api/")), false);
  assert.equal(urls.some((url) => url.includes("/chat")), false);
  assert.equal(urls.some((url) => /\/chat\/[0-9a-f-]{36}$/i.test(url)), false);
});

test("sitemap index advertises every source-current language sitemap", () => {
  const entries = sitemapIndexEntries();
  const xml = buildSitemapIndexXml();

  assert.deepEqual([...sitemapLanguages()], [...supportedLanguages]);
  assert.equal(entries.length, sitemapLanguages().length);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>'));
  assert.ok(xml.includes('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  assert.ok(xml.includes(`<loc>${absoluteUrl(sitemapFilePathForLanguage("English"))}</loc>`));
  assert.ok(xml.includes(`<loc>${absoluteUrl(sitemapFilePathForLanguage("Spanish"))}</loc>`));
  assert.ok(xml.includes(`<loc>${absoluteUrl(sitemapFilePathForLanguage("Arabic"))}</loc>`));
  assert.ok(xml.includes(`<loc>${absoluteUrl(sitemapFilePathForLanguage("Armenian"))}</loc>`));
  assert.ok(xml.endsWith("</sitemapindex>\n"));
  assert.equal(xml.includes("<urlset"), false);
  assert.equal(languageFromSitemapFileSlug("en-US.xml"), "English");
  assert.equal(languageFromSitemapFileSlug("es.xml"), "Spanish");
  assert.equal(languageFromSitemapFileSlug("ar"), "Arabic");
  assert.equal(languageFromSitemapFileSlug("hy.xml"), "Armenian");
  assert.equal(languageFromSitemapFileSlug("made-up.xml"), null);
  assert.ok(xml.length < 1_000_000);
});

test("language sitemap helpers emit localized complete locale clusters", () => {
  const post = getBlogPosts()[0];
  assert.ok(post);

  const spanishUrls = sitemap("Spanish").map((entry) => entry.url);
  assert.ok(spanishUrls.includes(absoluteUrl("/es")));
  assert.ok(spanishUrls.includes(absoluteUrl("/es/topics")));
  assert.ok(spanishUrls.includes(absoluteUrl(`/es/blog/${post.slug}`)));
  assert.ok(spanishUrls.includes(absoluteUrl(`/es/blog/category/${getBlogCategories()[0].slug}`)));
  assert.equal(spanishUrls.includes(absoluteUrl(`/es${topicPath(topicSeeds[0].slug)}`)), false);
  assert.equal(spanishUrls.some((url) => url.includes("/admin") || url.includes("/api/")), false);
  assert.equal(spanishUrls.some((url) => url.includes("/chat")), false);
  assert.equal(spanishUrls.some((url) => /\/chat\/[0-9a-f-]{36}$/i.test(url)), false);

  const spanishHome = sitemap("Spanish").find((entry) => entry.url === absoluteUrl("/es"));
  assert.equal(spanishHome?.alternates?.languages?.["en-US"], absoluteUrl("/"));
  assert.equal(spanishHome?.alternates?.languages?.es, absoluteUrl("/es"));
  assert.equal(spanishHome?.alternates?.languages?.ar, absoluteUrl("/ar"));
  assert.equal(spanishHome?.alternates?.languages?.hy, absoluteUrl("/hy"));
  assert.equal(spanishHome?.alternates?.languages?.["x-default"], absoluteUrl("/"));

  const spanishXml = buildLanguageSitemapXml("Spanish");
  const arabicXml = buildLanguageSitemapXml("Arabic");
  assert.ok(spanishXml.includes(`<loc>${absoluteUrl("/es")}</loc>`));
  assert.ok(spanishXml.includes(`hreflang="es"`));
  assert.ok(spanishXml.includes(`hreflang="x-default"`));
  assert.ok(arabicXml.includes(`<loc>${absoluteUrl("/ar")}</loc>`));
  assert.ok(arabicXml.includes(`href="${absoluteUrl("/ar")}"`));
  assert.ok(arabicXml.includes(`hreflang="ar"`));
  assert.ok(spanishXml.length < 20_000_000);
  assert.ok(arabicXml.length < 20_000_000);

  assert.ok(buildLanguageSitemapXml("English").includes(`<loc>${absoluteUrl(sitemap("English")[0].url)}</loc>`));
});

test("sitemap xml stays valid, styled, and crawler-readable", () => {
  const xml = buildSitemapXml();
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>'));
  assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
  assert.ok(xml.includes(`<loc>${absoluteUrl("/")}</loc>`));
  assert.ok(xml.includes(`<video:content_loc>${absoluteUrl(homepageFilm.contentUrl)}</video:content_loc>`));
  assert.ok(xml.endsWith("</urlset>\n"));
  assert.equal(xml.includes("<script"), false);
  assert.equal(xml.includes("&lt;urlset"), false);
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

test("public topic and blog category snippets stay search-result friendly", () => {
  for (const topic of topicSeeds) {
    const seo = getTopicSeo(topic);
    assert.ok(seo.description.length >= 80, `${topic.slug} description is too short`);
    assert.ok(seo.description.length <= 180, `${topic.slug} description is too long`);
    assert.ok(`${seo.title} | inspir`.length <= 75, `${topic.slug} title is too long`);
  }

  for (const category of getBlogCategories()) {
    const profile = getBlogCategoryProfile(category);
    const description = `${profile.description} Browse ${category.count} guides linked to live AI learning modes.`;
    assert.ok(description.length >= 80, `${category.slug} description is too short`);
    assert.ok(description.length <= 180, `${category.slug} description is too long`);
  }
});

test("learning modes item list exposes every public topic", () => {
  const jsonLd = learningModesItemListJsonLd(topicSeeds);
  const serialized = JSON.stringify(jsonLd);

  assert.equal(jsonLd.itemListElement.length, topicSeeds.length);
  for (const topic of topicSeeds) {
    assert.ok(serialized.includes(absoluteUrl(topicPath(topic.slug))), `${topic.slug} should be in item list`);
  }
});

test("topic directory exposes category anchors, featured modes, and public faq schema", () => {
  const hubs = getTopicCategoryHubs();
  const spotlightModes = getTopicSpotlightModes();
  const categoryList = itemListJsonLd({
    path: "/topics",
    id: "mode-categories",
    name: "AI learning mode categories",
    items: hubs.map((hub) => ({
      name: hub.name,
      url: hub.href,
      description: hub.description,
    })),
  });
  const faq = faqPageJsonLd({ path: "/topics", questions: topicDirectoryFaqs });
  const serialized = serializeJsonLd([categoryList, faq]);

  assert.ok(hubs.length >= 8);
  assert.equal(hubs.reduce((sum, hub) => sum + hub.modeCount, 0), topicSeeds.length);
  assert.ok(hubs.some((hub) => hub.slug === "foundations" && hub.href === "/topics#foundations"));
  assert.ok(hubs.some((hub) => hub.name === "STEM" && hub.searchIntents.includes("AI math tutor")));
  assert.ok(spotlightModes.some((mode) => mode.slug === "homework-coach" && mode.href === "/chat/homework-coach"));
  assert.equal(faq.mainEntity.length, topicDirectoryFaqs.length);
  assert.ok(serialized.includes(absoluteUrl("/topics#foundations")));
  assert.ok(serialized.includes("public guest-mode entrypoints"));
});

test("prompt library exposes public starters, categories, common questions, and faq schema", () => {
  const entries = getPromptEntries();
  const categoryHubs = getPromptCategoryHubs();
  const spotlight = getPromptSpotlightEntries();
  const categoryList = itemListJsonLd({
    path: "/prompts",
    id: "prompt-categories",
    name: "AI learning prompt categories",
    items: categoryHubs.map((hub) => ({
      name: hub.name,
      url: hub.href,
      description: hub.description,
    })),
  });
  const promptList = itemListJsonLd({
    path: "/prompts",
    id: "all-prompts",
    name: "All inspir AI learning prompt starters",
    items: entries.map((entry) => ({
      name: `${entry.topicName}: ${entry.prompt}`,
      url: entry.href,
      description: entry.description,
    })),
  });
  const intentList = itemListJsonLd({
    path: "/prompts",
    id: "prompt-common-questions",
    name: "AI learning prompt questions",
    items: promptLibrarySearchIntents.map((intent) => ({
      name: intent,
      url: "/prompts",
    })),
  });
  const faq = faqPageJsonLd({ path: "/prompts", questions: promptLibraryFaqs });
  const serialized = serializeJsonLd([categoryList, promptList, intentList, faq]);

  assert.equal(entries.length, topicSeeds.reduce((sum, topic) => sum + topic.metadata.starters.length, 0));
  assert.ok(entries.length >= topicSeeds.length * 3);
  assert.equal(categoryHubs.reduce((sum, hub) => sum + hub.promptCount, 0), entries.length);
  assert.ok(categoryHubs.some((hub) => hub.slug === "foundations" && hub.href === "/prompts#foundations"));
  assert.ok(spotlight.some((entry) => entry.topicSlug === "learn-anything" && entry.href === "/chat/learn-anything"));
  assert.ok(entries.some((entry) => entry.prompt === "Explain black holes simply"));
  assert.ok(promptLibrarySearchIntents.includes("AI tutor prompts"));
  assert.equal(faq.mainEntity.length, promptLibraryFaqs.length);
  assert.ok(serialized.includes(absoluteUrl("/prompts#foundations")));
  assert.ok(serialized.includes(absoluteUrl("/chat/learn-anything")));
  assert.ok(serialized.includes("Explain black holes simply"));
  assert.ok(serialized.includes("active learning loops"));
});

test("learning map connects workflows to modes, prompts, paths, and guides", () => {
  const workflows = getLearningMapWorkflows();
  const workflowList = itemListJsonLd({
    path: "/ai-learning-map",
    id: "learning-workflows",
    name: "AI learning workflows",
    items: workflows.map((workflow) => ({
      name: workflow.title,
      url: workflow.href,
      description: workflow.description,
    })),
  });
  const intentList = itemListJsonLd({
    path: "/ai-learning-map",
    id: "common-questions",
    name: "AI learning map questions",
    items: learningMapSearchIntents.map((intent) => ({
      name: intent,
      url: "/ai-learning-map",
    })),
  });
  const faq = faqPageJsonLd({ path: "/ai-learning-map", questions: learningMapFaqs });
  const serialized = serializeJsonLd([workflowList, intentList, faq]);
  const understand = workflows.find((workflow) => workflow.slug === "understand-anything");
  const homework = workflows.find((workflow) => workflow.slug === "homework-without-cheating");

  assert.ok(workflows.length >= 8);
  assert.ok(workflows.every((workflow) => workflow.modes.length >= 3));
  assert.ok(workflows.every((workflow) => workflow.prompts.length >= 3));
  assert.ok(workflows.every((workflow) => workflow.guides.length >= 3));
  assert.ok(understand);
  assert.equal(understand.path?.href, "/learn/understand-a-hard-topic");
  assert.ok(understand.modes.some((mode) => mode.href === "/chat/learn-anything"));
  assert.ok(understand.prompts.some((entry) => entry.prompt === "Explain black holes simply"));
  assert.ok(understand.guides.some((guide) => guide.href === "/blog/ai-learn-anything-guide"));
  assert.equal(homework?.title, "AI homework help without cheating");
  assert.ok(learningMapSearchIntents.includes("AI learning map"));
  assert.equal(workflowList.itemListElement.length, workflows.length);
  assert.equal(faq.mainEntity.length, learningMapFaqs.length);
  assert.ok(serialized.includes(absoluteUrl("/ai-learning-map#understand-anything")));
  assert.ok(serialized.includes("AI prompts for studying"));
  assert.ok(serialized.includes("public learning modes"));
});

test("comparison pages expose fair alternative intent and public learning entrypoints", () => {
  const pages = getComparisonPages();
  const khan = getComparisonPage("khan-academy-alternative");
  assert.ok(khan);
  const resources = getComparisonPageResources(khan);
  const comparisonList = itemListJsonLd({
    path: "/compare",
    id: "comparison-pages",
    name: "AI tutor comparison pages",
    items: pages.map((page) => ({
      name: page.seoTitle,
      url: comparisonPath(page.slug),
      description: page.description,
    })),
  });
  const intentList = itemListJsonLd({
    path: "/compare",
    id: "comparison-common-questions",
    name: "AI tutor comparison questions",
    items: comparisonHubSearchIntents.map((intent) => ({
      name: intent,
      url: "/compare",
    })),
  });
  const pageList = itemListJsonLd({
    path: comparisonPath(khan.slug),
    id: "public-mode-entrypoints",
    name: `${khan.seoTitle} public mode entrypoints`,
    items: resources.modes.map((mode) => ({
      name: mode.name,
      url: mode.href,
      description: mode.description,
    })),
  });
  const faq = faqPageJsonLd({ path: comparisonPath(khan.slug), questions: khan.faqs });
  const hubFaq = faqPageJsonLd({ path: "/compare", questions: comparisonHubFaqs });
  const serialized = serializeJsonLd([comparisonList, intentList, pageList, faq, hubFaq]);

  assert.ok(pages.length >= 1);
  assert.equal(khan.competitorName, "Khan Academy");
  assert.equal(comparisonPath(khan.slug), "/compare/khan-academy-alternative");
  assert.ok(khan.searchIntents.includes("Khan Academy alternative"));
  assert.ok(khan.shortAnswer.includes("Khan Academy"));
  assert.ok(khan.balancedPosition.includes("not a claim"));
  assert.ok(khan.officialReferences.some((reference) => reference.href.includes("khanacademy.org/about")));
  assert.ok(resources.modes.some((mode) => mode.href === "/chat/learn-anything"));
  assert.ok(resources.modes.some((mode) => mode.href === "/chat/homework-coach"));
  assert.ok(resources.guides.some((guide) => guide.href === "/blog/socratic-ai-tutor"));
  assert.ok(resources.workflows.some((workflow) => workflow.href === "/ai-learning-map#understand-anything"));
  assert.equal(faq.mainEntity.length, khan.faqs.length);
  assert.equal(hubFaq.mainEntity.length, comparisonHubFaqs.length);
  assert.ok(serialized.includes(absoluteUrl("/compare/khan-academy-alternative")));
  assert.ok(serialized.includes(absoluteUrl("/chat/learn-anything")));
  assert.ok(serialized.includes("AI tutor alternatives"));
});

test("audience pages route students, parents, teachers, and self-taught learners into public modes", () => {
  const pages = getAudiencePages();
  const students = getAudiencePage("students");
  const teachers = getAudiencePage("teachers");
  assert.ok(students);
  assert.ok(teachers);
  const studentResources = getAudiencePageResources(students);
  const teacherResources = getAudiencePageResources(teachers);
  const hubList = itemListJsonLd({
    path: "/for",
    id: "audience-pages",
    name: "AI learning audience pages",
    items: pages.map((page) => ({
      name: page.seoTitle,
      url: audiencePath(page.slug),
      description: page.description,
    })),
  });
  const intentList = itemListJsonLd({
    path: "/for",
    id: "audience-common-questions",
    name: "AI learning audience questions",
    items: audienceHubSearchIntents.map((intent) => ({
      name: intent,
      url: "/for",
    })),
  });
  const studentModes = itemListJsonLd({
    path: audiencePath(students.slug),
    id: "public-mode-entrypoints",
    name: `${students.seoTitle} public mode entrypoints`,
    items: studentResources.modes.map((mode) => ({
      name: mode.name,
      url: mode.href,
      description: mode.description,
    })),
  });
  const faq = faqPageJsonLd({ path: audiencePath(students.slug), questions: students.faqs });
  const hubFaq = faqPageJsonLd({ path: "/for", questions: audienceHubFaqs });
  const serialized = serializeJsonLd([hubList, intentList, studentModes, faq, hubFaq]);

  assert.equal(pages.length, 4);
  assert.deepEqual(
    pages.map((page) => page.slug),
    ["students", "parents", "teachers", "self-taught-learners"],
  );
  assert.equal(audiencePath("students"), "/for/students");
  assert.ok(students.searchIntents.includes("AI tutor for students"));
  assert.ok(studentResources.modes.some((mode) => mode.href === "/chat/homework-coach"));
  assert.ok(studentResources.guides.some((guide) => guide.href === "/blog/how-to-study-with-ai-without-cheating-yourself"));
  assert.ok(studentResources.workflows.some((workflow) => workflow.href === "/ai-learning-map#homework-without-cheating"));
  assert.ok(studentResources.paths.some((path) => path.href === "/learn/get-unstuck-on-homework"));
  assert.ok(teachers.searchIntents.includes("AI tools for teachers"));
  assert.ok(teacherResources.modes.some((mode) => mode.href === "/chat/socratic-instruction"));
  assert.ok(teacherResources.guides.some((guide) => guide.href === "/blog/ai-source-critic-guide"));
  assert.equal(faq.mainEntity.length, students.faqs.length);
  assert.equal(hubFaq.mainEntity.length, audienceHubFaqs.length);
  assert.ok(serialized.includes(absoluteUrl("/for/students")));
  assert.ok(serialized.includes(absoluteUrl("/chat/homework-coach")));
  assert.ok(serialized.includes("AI tutor for parents"));
});

test("subject pages connect subject intent to public modes, prompts, guides, and review loops", () => {
  const pages = getSubjectPages();
  const math = getSubjectPage("math");
  const coding = getSubjectPage("coding");
  const history = getSubjectPage("history");
  assert.ok(math);
  assert.ok(coding);
  assert.ok(history);
  const mathResources = getSubjectPageResources(math);
  const historyResources = getSubjectPageResources(history);
  const hubList = itemListJsonLd({
    path: "/subjects",
    id: "subject-pages",
    name: "AI tutor subject pages",
    items: pages.map((page) => ({
      name: page.seoTitle,
      url: subjectPath(page.slug),
      description: page.description,
    })),
  });
  const intentList = itemListJsonLd({
    path: "/subjects",
    id: "subject-common-questions",
    name: "AI tutor subject questions",
    items: subjectHubSearchIntents.map((intent) => ({
      name: intent,
      url: "/subjects",
    })),
  });
  const mathModes = itemListJsonLd({
    path: subjectPath(math.slug),
    id: "public-mode-entrypoints",
    name: `${math.seoTitle} public mode entrypoints`,
    items: mathResources.modes.map((mode) => ({
      name: mode.name,
      url: mode.href,
      description: mode.description,
    })),
  });
  const promptList = itemListJsonLd({
    path: subjectPath(math.slug),
    id: "subject-prompts",
    name: `${math.seoTitle} starter prompts`,
    items: mathResources.prompts.map((prompt) => ({
      name: `${prompt.topicName}: ${prompt.prompt}`,
      url: prompt.href,
      description: prompt.description,
    })),
  });
  const faq = faqPageJsonLd({ path: subjectPath(math.slug), questions: math.faqs });
  const hubFaq = faqPageJsonLd({ path: "/subjects", questions: subjectHubFaqs });
  const serialized = serializeJsonLd([hubList, intentList, mathModes, promptList, faq, hubFaq]);

  assert.deepEqual(
    pages.map((page) => page.slug),
    ["math", "writing", "coding", "history", "exam-prep", "homework"],
  );
  assert.equal(subjectPath("math"), "/subjects/math");
  assert.ok(math.searchIntents.includes("AI math tutor"));
  assert.ok(math.reviewLoop.length >= 4);
  assert.ok(mathResources.modes.some((mode) => mode.href === "/chat/math-step-coach"));
  assert.ok(mathResources.modes.some((mode) => mode.href === "/chat/homework-coach"));
  assert.ok(mathResources.prompts.some((prompt) => prompt.href === "/chat/math-step-coach"));
  assert.ok(mathResources.guides.some((guide) => guide.href === "/blog/ai-math-step-coach-guide"));
  assert.ok(mathResources.workflows.some((workflow) => workflow.href === "/ai-learning-map#homework-without-cheating"));
  assert.ok(mathResources.paths.some((path) => path.href === "/learn/get-unstuck-on-homework"));
  assert.ok(coding.searchIntents.includes("AI code tutor"));
  assert.ok(history.searchIntents.includes("talk to historical figures AI"));
  assert.ok(historyResources.modes.some((mode) => mode.href === "/chat/talk-to-a-historical-person"));
  assert.ok(historyResources.guides.some((guide) => guide.href === "/blog/talk-to-historical-figures-with-ai"));
  assert.equal(faq.mainEntity.length, math.faqs.length);
  assert.equal(hubFaq.mainEntity.length, subjectHubFaqs.length);
  assert.ok(serialized.includes(absoluteUrl("/subjects/math")));
  assert.ok(serialized.includes(absoluteUrl("/chat/math-step-coach")));
  assert.ok(serialized.includes("AI homework helper"));
});

test("robots allows AI discovery crawlers while blocking private areas", () => {
  const output = robots();
  const rules = Array.isArray(output.rules) ? output.rules : [output.rules];
  const discoveryRule = rules.find((rule) => {
    const agents = Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent];
    return (
      agents.includes("OAI-SearchBot") &&
      agents.includes("ChatGPT-User") &&
      agents.includes("GPTBot") &&
      agents.includes("ClaudeBot") &&
      agents.includes("PerplexityBot")
    );
  });

  assert.equal(discoveryRule?.allow, "/");
  assert.ok(Array.isArray(discoveryRule?.disallow));
  assert.ok((discoveryRule?.disallow as string[]).includes("/api/"));
  assert.ok((discoveryRule?.disallow as string[]).includes("/admin/"));
  assert.equal(output.sitemap, absoluteUrl("/sitemap.xml"));
});

test("next config preserves canonical legal route and crawler headers", async () => {
  const redirects = nextConfig.redirects ? await nextConfig.redirects() : [];
  const rewrites = nextConfig.rewrites ? await nextConfig.rewrites() : [];
  const headers = nextConfig.headers ? await nextConfig.headers() : [];
  const tncRedirect = redirects.find((redirect) => redirect.source === "/tnc");
  const sitemapRewrite = Array.isArray(rewrites)
    ? rewrites.find((rewrite) => rewrite.source === "/sitemap.xml")
    : rewrites.beforeFiles?.find((rewrite) => rewrite.source === "/sitemap.xml") ??
      rewrites.afterFiles?.find((rewrite) => rewrite.source === "/sitemap.xml") ??
      rewrites.fallback?.find((rewrite) => rewrite.source === "/sitemap.xml");
  const apiHeaders = headers.find((entry) => entry.source === "/api/:path*");
  const mediaHeaders = headers.find((entry) => entry.source === "/media/:path*");

  assert.equal(tncRedirect?.destination, "/terms");
  assert.equal(tncRedirect?.permanent, true);
  assert.equal(sitemapRewrite?.destination, "/sitemap");
  assert.ok(apiHeaders?.headers.some((header) => header.key === "X-Robots-Tag" && header.value === "noindex, nofollow"));
  assert.ok(mediaHeaders?.headers.some((header) => header.key === "Cache-Control" && header.value.includes("immutable")));
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

test("site navigation and blog learning resources expose AI-readable public routes", () => {
  const navigation = siteNavigationJsonLd();
  const post = getBlogPost("socratic-ai-tutor");
  assert.ok(post);
  const resource = blogLearningResourceJsonLd(post);

  assert.equal(navigation["@id"], `${absoluteUrl("/")}#site-navigation`);
  assert.ok(
    navigation.itemListElement.some(
      (item) => item.item.name === "Learning modes" && item.item.url === absoluteUrl("/topics"),
    ),
  );
  assert.equal(resource["@type"], "LearningResource");
  assert.equal(resource.url, absoluteUrl(`/blog/${post.slug}`));
  assert.equal(resource.isAccessibleForFree, true);
  assert.ok((resource.learningResourceType as string[]).includes("Study guide"));
});

test("mission authority content exposes principles, reference links, and faq schema", () => {
  const principles = itemListJsonLd({
    path: "/mission",
    id: "mission-principles",
    name: "inspir mission principles",
    items: missionPrinciples.map((principle) => ({
      name: principle.title,
      url: "/mission",
      description: principle.text,
    })),
  });
  const references = itemListJsonLd({
    path: "/mission",
    id: "authority-reference-links",
    name: "inspir public authority reference links",
    items: authorityReferenceLinks.map((link) => ({
      name: link.title,
      url: link.href,
      description: link.text,
    })),
  });
  const faq = faqPageJsonLd({ path: "/mission", questions: missionFaqs });
  const serialized = serializeJsonLd([principles, references, faq]);

  assert.equal(principles.itemListElement.length, missionPrinciples.length);
  assert.equal(references.itemListElement.length, authorityReferenceLinks.length);
  assert.ok(references.itemListElement.some((item) => item.url === absoluteUrl("/blog")));
  assert.equal(faq.mainEntity.length, missionFaqs.length);
  assert.ok(serialized.includes("Understanding over answers"));
  assert.ok(serialized.includes(absoluteUrl("/topics")));
  assert.ok(serialized.includes("generic AI chatbot"));
});

test("about story content exposes timeline, proof points, reference links, and faq schema", () => {
  const timeline = itemListJsonLd({
    path: "/about",
    id: "story-timeline",
    name: "inspir story timeline",
    items: aboutTimeline.map((item) => ({
      name: `${item.year}: ${item.title}`,
      url: `/about#${item.slug}`,
      description: item.text,
    })),
  });
  const proof = itemListJsonLd({
    path: "/about",
    id: "proof-points",
    name: "inspir public proof points",
    items: aboutProofPoints.map((item) => ({
      name: item.title,
      url: "/about",
      description: item.text,
    })),
  });
  const links = itemListJsonLd({
    path: "/about",
    id: "story-reference-links",
    name: "inspir story reference links",
    items: aboutStoryLinks.map((link) => ({
      name: link.title,
      url: link.href,
      description: link.text,
    })),
  });
  const faq = faqPageJsonLd({ path: "/about", questions: aboutFaqs });
  const serialized = serializeJsonLd([timeline, proof, links, faq]);

  assert.equal(timeline.itemListElement.length, aboutTimeline.length);
  assert.equal(proof.itemListElement.length, aboutProofPoints.length);
  assert.equal(links.itemListElement.length, aboutStoryLinks.length);
  assert.ok(timeline.itemListElement.some((item) => item.url === absoluteUrl("/about#learning-community")));
  assert.ok(links.itemListElement.some((item) => item.url === absoluteUrl("/topics")));
  assert.equal(faq.mainEntity.length, aboutFaqs.length);
  assert.ok(serialized.includes("public quiz and learning community"));
  assert.ok(serialized.includes("mode-specific teaching"));
});

test("media page exposes coverage links, story angles, citation facts, and faq schema", () => {
  const officialLinks = itemListJsonLd({
    path: "/media",
    id: "official-links",
    name: "Official inspir reference links",
    items: mediaOfficialLinks.map((link) => ({
      name: link.title,
      url: link.href,
      description: link.text,
    })),
  });
  const coverageLinks = itemListJsonLd({
    path: "/media",
    id: "coverage-links",
    name: "External coverage and reference links",
    items: mediaCoverageLinks.map((link) => ({
      name: link.label,
      url: link.href,
      description: link.text,
    })),
  });
  const storyAngles = itemListJsonLd({
    path: "/media",
    id: "story-angles",
    name: "inspir media story angles",
    items: mediaStoryAngles.map((angle) => ({
      name: angle.title,
      url: angle.href,
      description: angle.text,
    })),
  });
  const linkingTargets = itemListJsonLd({
    path: "/media",
    id: "linking-targets",
    name: "Recommended inspir citation targets",
    items: mediaLinkingTargets.map((target) => ({
      name: `${target.title}: ${target.anchorText}`,
      url: target.href,
      description: target.text,
    })),
  });
  const citationSnippets = itemListJsonLd({
    path: "/media",
    id: "citation-snippets",
    name: "Suggested inspir citation snippets",
    items: mediaCitationSnippets.map((snippet) => ({
      name: snippet.title,
      url: snippet.href,
      description: snippet.text,
    })),
  });
  const faq = faqPageJsonLd({ path: "/media", questions: mediaFaqs });
  const serialized = serializeJsonLd([officialLinks, coverageLinks, storyAngles, linkingTargets, citationSnippets, faq]);

  assert.equal(officialLinks.itemListElement.length, mediaOfficialLinks.length);
  assert.equal(coverageLinks.itemListElement.length, mediaCoverageLinks.length);
  assert.equal(storyAngles.itemListElement.length, mediaStoryAngles.length);
  assert.equal(linkingTargets.itemListElement.length, mediaLinkingTargets.length);
  assert.equal(citationSnippets.itemListElement.length, mediaCitationSnippets.length);
  assert.ok(mediaAttributionFacts.some(([label, value]) => label === "Category" && value === "Free AI learning platform"));
  assert.ok(coverageLinks.itemListElement.some((item) => item.url.includes("deccanbusiness.com")));
  assert.ok(storyAngles.itemListElement.some((item) => item.url === absoluteUrl("/topics")));
  assert.ok(linkingTargets.itemListElement.some((item) => item.url === absoluteUrl("/chat/learn-anything")));
  assert.ok(citationSnippets.itemListElement.some((item) => item.url === absoluteUrl("/trust")));
  assert.equal(faq.mainEntity.length, mediaFaqs.length);
  assert.ok(serialized.includes("citation-friendly"));
  assert.ok(serialized.includes("free public AI learning"));
  assert.ok(serialized.includes("AI tutor for schools"));
  assert.ok(serialized.includes("inspir makes learning modes open at"));
});

test("schools page exposes deployment steps, use cases, common questions, and faq schema", () => {
  const features = itemListJsonLd({
    path: "/schools",
    id: "school-features",
    name: "inspir school deployment features",
    items: schoolFeatures.map((feature) => ({
      name: feature.title,
      url: feature.href,
      description: feature.text,
    })),
  });
  const deployment = itemListJsonLd({
    path: "/schools",
    id: "school-deployment-steps",
    name: "inspir school deployment path",
    items: schoolDeploymentSteps.map((step) => ({
      name: `${step.step}: ${step.title}`,
      url: step.href,
      description: step.text,
    })),
  });
  const useCases = itemListJsonLd({
    path: "/schools",
    id: "school-use-cases",
    name: "inspir school AI learning use cases",
    items: schoolUseCases.map((useCase) => ({
      name: useCase.title,
      url: useCase.href,
      description: useCase.text,
    })),
  });
  const intents = itemListJsonLd({
    path: "/schools",
    id: "school-common-questions",
    name: "AI learning questions for schools",
    items: schoolSearchIntents.map((intent) => ({
      name: intent,
      url: "/schools",
    })),
  });
  const faq = faqPageJsonLd({ path: "/schools", questions: schoolFaqs });
  const serialized = serializeJsonLd([features, deployment, useCases, intents, faq]);

  assert.equal(features.itemListElement.length, schoolFeatures.length);
  assert.equal(deployment.itemListElement.length, schoolDeploymentSteps.length);
  assert.equal(useCases.itemListElement.length, schoolUseCases.length);
  assert.equal(intents.itemListElement.length, schoolSearchIntents.length);
  assert.equal(faq.mainEntity.length, schoolFaqs.length);
  assert.ok(features.itemListElement.some((item) => item.url === absoluteUrl("/chat/learn-anything")));
  assert.ok(deployment.itemListElement.some((item) => item.url === absoluteUrl("/topics")));
  assert.ok(useCases.itemListElement.some((item) => item.url === absoluteUrl("/chat/socratic-instruction")));
  assert.ok(serialized.includes("white label AI learning platform"));
  assert.ok(serialized.includes("generic AI chatbot"));
});

test("trust page exposes public/private boundaries, references, and faq schema", () => {
  const principles = itemListJsonLd({
    path: "/trust",
    id: "trust-principles",
    name: "inspir trust principles",
    items: trustPrinciples.map((principle) => ({
      name: principle.title,
      url: "/trust",
      description: principle.text,
    })),
  });
  const safeguards = itemListJsonLd({
    path: "/trust",
    id: "trust-safeguards",
    name: "inspir public trust safeguards",
    items: trustSafeguards.map((safeguard) => ({
      name: safeguard.title,
      url: safeguard.href,
      description: safeguard.text,
    })),
  });
  const publicAccess = itemListJsonLd({
    path: "/trust",
    id: "public-access-policy",
    name: "inspir public access policy",
    items: trustPublicAccessPolicies.map((policy) => ({
      name: `${policy.name}: ${policy.status}`,
      url: "/trust#public-private-boundaries",
      description: policy.text,
    })),
  });
  const references = itemListJsonLd({
    path: "/trust",
    id: "trust-reference-links",
    name: "inspir trust reference links",
    items: trustReferenceLinks.map((link) => ({
      name: link.title,
      url: link.href,
      description: link.text,
    })),
  });
  const faq = faqPageJsonLd({ path: "/trust", questions: trustFaqs });
  const serialized = serializeJsonLd([principles, safeguards, publicAccess, references, faq]);

  assert.equal(principles.itemListElement.length, trustPrinciples.length);
  assert.equal(safeguards.itemListElement.length, trustSafeguards.length);
  assert.equal(publicAccess.itemListElement.length, trustPublicAccessPolicies.length);
  assert.equal(references.itemListElement.length, trustReferenceLinks.length);
  assert.equal(faq.mainEntity.length, trustFaqs.length);
  assert.ok(safeguards.itemListElement.some((item) => item.url === absoluteUrl("/robots.txt")));
  assert.ok(references.itemListElement.some((item) => item.url === absoluteUrl("/ai-content-index.json")));
  assert.ok(serialized.includes("Private saved chats stay private"));
  assert.ok(serialized.includes("Public access has boundaries"));
  assert.ok(serialized.includes("Assistant and reference access"));
  assert.ok(serialized.includes("not part of public learning references"));
});

test("video json-ld exposes the public learning film without unsafe markup", () => {
  const video = videoObjectJsonLd({
    path: "/",
    name: homepageFilm.title,
    description: homepageFilm.description,
    thumbnailUrl: homepageFilm.thumbnailUrl,
    contentUrl: homepageFilm.contentUrl,
    duration: homepageFilm.duration,
    uploadDate: homepageFilm.uploadDate,
    transcript: homepageFilm.transcript,
    clips: homepageFilm.chapters,
  });

  assert.equal(video["@type"], "VideoObject");
  assert.equal(video["@id"], `${absoluteUrl("/")}#video`);
  assert.equal(video.contentUrl, absoluteUrl("/media/inspir-learning-film.mp4"));
  assert.equal(video.thumbnailUrl[0], absoluteUrl("/inspir-social-preview.png"));
  assert.equal(video.url, `${absoluteUrl("/")}#learning-film`);
  assert.equal(video.encodingFormat, "video/mp4");
  assert.equal(video.isAccessibleForFree, true);
  assert.deepEqual(video.accessibilityFeature, ["captions", "transcript", "chapters"]);
  assert.equal(video.duration, "PT31S");
  assert.equal(video.uploadDate, homepageFilm.uploadDate);
  assert.equal(video.transcript, homepageFilm.transcript);
  assert.equal(video.hasPart?.length, homepageFilm.chapters.length);
  assert.equal(video.hasPart?.[0].startOffset, 0);
  assert.ok(existsSync(`public${homepageFilm.captionUrl}`));
  assert.ok(existsSync(`public${homepageFilm.chaptersUrl}`));
  assert.ok(readFileSync(`public${homepageFilm.captionUrl}`, "utf8").includes("WEBVTT"));
  assert.ok(readFileSync(`public${homepageFilm.chaptersUrl}`, "utf8").includes(homepageFilm.chapters[0].title));
  assert.equal(serializeJsonLd(video).includes("<iframe"), false);
});

test("homepage video controls stay accessible and compact on mobile", () => {
  const videoEngine = readFileSync("components/marketing/MarketingVideoEngine.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  const mobileHiddenControls = css.match(
    /\.marketing-video-controls button:nth-of-type\(2\),[\s\S]*?display: none;\n  \}/,
  )?.[0];

  assert.ok(videoEngine.includes("hidden={!chaptersOpen}"));
  assert.ok(videoEngine.includes("hidden={!transcriptOpen}"));
  assert.equal(videoEngine.includes('label="English captions" default'), false);
  assert.ok(videoEngine.includes('aria-controls="learning-film-chapters"'));
  assert.ok(videoEngine.includes('aria-controls="learning-film-transcript"'));
  assert.ok(mobileHiddenControls);
  assert.ok(mobileHiddenControls.includes("nth-of-type(4)"));
  assert.ok(mobileHiddenControls.includes("nth-of-type(6)"));
  assert.equal(mobileHiddenControls.includes("nth-of-type(5)"), false);
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

test("homepage learning paths and faqs expose guest-mode guidance", () => {
  assert.deepEqual(
    homepageHeroRoutes.map((route) => route.href),
    ["/chat/learn-anything", "/chat/socratic-instruction", "/chat/homework-coach"],
  );
  assert.ok(homepageHeroRoutes.every((route) => isKnownTopicSlug(route.href.replace("/chat/", ""))));
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
  const subjectList = itemListJsonLd({
    path: "/",
    id: "subject-hubs",
    name: "AI tutors by subject",
    items: getSubjectPages().map((page) => ({
      name: page.seoTitle,
      url: subjectPath(page.slug),
      description: page.description,
    })),
  });

  assert.equal(faq.mainEntity.length, homepageFaqs.length);
  assert.equal(list.itemListElement.length, homepageLearningPaths.length);
  assert.equal(subjectList.itemListElement.length, getSubjectPages().length);
  assert.ok(homepageLearningPaths.every((path) => path.steps.length === 3));
  assert.ok(homepageLearningPaths.every((path) => path.searchIntents.length >= 4));
  assert.ok(homepageLearningPaths.every((path) => path.examplePrompts.length === 3));
  assert.ok(homepageLearningPaths.every((path) => path.avoid.length === 3));
  assert.ok(homepageLearningPaths.every((path) => path.reviewLoop.length === 3));
  assert.ok(homepageLearningPaths.every((path) => path.relatedBlogSlugs.length >= 3));
  assert.ok(JSON.stringify(list).includes(absoluteUrl("/learn/understand-a-hard-topic")));
  assert.ok(JSON.stringify(subjectList).includes(absoluteUrl("/subjects/math")));
  assert.ok(JSON.stringify(subjectList).includes("AI Code Tutor"));
});

test("learning path pages expose prompts, review loops, mistakes, and how-to schema", () => {
  const path = homepageLearningPaths.find((candidate) => candidate.slug === "understand-a-hard-topic");
  assert.ok(path);

  const prompts = itemListJsonLd({
    path: learningPathHref(path.slug),
    id: "example-prompts",
    name: `${path.title} example AI prompts`,
    items: path.examplePrompts.map((prompt) => ({
      name: prompt.title,
      url: prompt.href,
      description: prompt.text,
    })),
  });
  const review = itemListJsonLd({
    path: learningPathHref(path.slug),
    id: "review-loop",
    name: `${path.title} review loop`,
    items: path.reviewLoop.map((step) => ({
      name: step.title,
      url: step.href,
      description: step.text,
    })),
  });
  const mistakes = itemListJsonLd({
    path: learningPathHref(path.slug),
    id: "mistakes-to-avoid",
    name: `${path.title} mistakes to avoid`,
    items: path.avoid.map((mistake, index) => ({
      name: mistake,
      url: `${learningPathHref(path.slug)}#avoid-${index + 1}`,
    })),
  });
  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "@id": `${absoluteUrl(learningPathHref(path.slug))}#how-to`,
    name: path.seoTitle,
    step: path.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.title,
      text: step.text,
      url: absoluteUrl(step.href),
    })),
  };
  const serialized = serializeJsonLd([prompts, review, mistakes, howTo]);

  assert.equal(prompts.itemListElement.length, 3);
  assert.equal(review.itemListElement.length, 3);
  assert.equal(mistakes.itemListElement.length, 3);
  assert.equal(howTo.step.length, path.steps.length);
  assert.ok(path.searchIntents.includes("how to understand a hard topic with AI"));
  assert.ok(serialized.includes(absoluteUrl("/chat/learn-anything")));
  assert.ok(serialized.includes(absoluteUrl("/learn/understand-a-hard-topic#avoid-1")));
  assert.ok(serialized.includes("Socratic questions"));
});

test("public topic companion content exposes related resources and faq schema", () => {
  const topic = topicSeeds.find((candidate) => candidate.slug === "learn-anything");
  assert.ok(topic);

  const paths = getRelatedLearningPathsForTopic(topic);
  const guides = getRelatedBlogGuidesForTopic(topic, 10);
  const modes = getRelatedTopicModesForTopic(topic);
  const faqs = topicPublicFaqs(topic);
  const faq = faqPageJsonLd({ path: topicPath(topic.slug), questions: faqs });
  const list = itemListJsonLd({
    path: topicPath(topic.slug),
    id: "related-topic-resources",
    name: `${topic.name} related learning resources`,
    items: [
      ...paths.map((path) => ({
        name: path.title,
        url: path.href,
        description: path.description,
      })),
      ...guides.map((guide) => ({
        name: guide.title,
        url: guide.href,
        description: guide.description,
      })),
      ...modes.map((mode) => ({
        name: mode.title,
        url: mode.href,
        description: mode.description,
      })),
    ],
  });
  const serialized = serializeJsonLd([faq, list]);

  assert.equal(faq["@id"], `${absoluteUrl("/chat/learn-anything")}#faq`);
  assert.equal(faq.mainEntity.length, 3);
  assert.ok(faq.mainEntity[0].acceptedAnswer.text.includes("guest learning mode"));
  assert.ok(paths.some((path) => path.href === "/learn/understand-a-hard-topic"));
  assert.ok(guides.some((guide) => guide.href === "/blog/ai-learn-anything-guide"));
  assert.equal(guides.some((guide) => guide.href === "/blog/socratic-instruction-prompts-and-study-loop"), false);
  assert.ok(modes.some((mode) => mode.href === "/chat/socratic-instruction"));
  assert.ok(serialized.includes(absoluteUrl("/learn/understand-a-hard-topic")));
  assert.ok(serialized.includes(absoluteUrl("/blog/ai-learn-anything-guide")));
  assert.ok(serialized.includes(absoluteUrl("/chat/socratic-instruction")));
});

test("public chat intro links point to existing guides and prompt loops", () => {
  const postSlugs = new Set(getBlogPosts().map((post) => post.slug));

  for (const topic of topicSeeds.filter((topic) => !topic.metadata.source)) {
    const guideSlug = topic.slug.endsWith("-guide") ? `ai-${topic.slug}` : `ai-${topic.slug}-guide`;

    assert.ok(postSlugs.has(guideSlug), `${topic.slug} should have a mode guide`);
    assert.ok(
      postSlugs.has(`${topic.slug}-prompts-and-study-loop`),
      `${topic.slug} should have a prompt loop guide`,
    );
  }
});

test("blog posts resolve related public modes and category clusters", () => {
  const post = getBlogPost("ai-learn-anything-guide");
  const mathPost = getBlogPost("ai-math-step-coach-guide");
  const socraticLoopPost = getBlogPost("socratic-instruction-prompts-and-study-loop");
  assert.ok(post);
  assert.ok(mathPost);
  assert.ok(socraticLoopPost);
  const topic = getBlogPostTopic(post);
  assert.equal(topic?.slug, "learn-anything");
  assert.equal(getBlogPostTopic(socraticLoopPost)?.slug, "socratic-instruction");

  const related = getRelatedBlogPosts(post, 4);
  const graph = getBlogPostLearningGraph(post);
  const actionList = itemListJsonLd({
    path: `/blog/${post.slug}`,
    id: "article-learning-actions",
    name: `${post.title} learning actions`,
    items: graph.primaryLinks.map((link) => ({
      name: link.title,
      url: link.href,
      description: link.description,
    })),
  });
  const serialized = serializeJsonLd(actionList);
  const mathGraph = getBlogPostLearningGraph(mathPost);
  assert.ok(related.length > 0);
  assert.ok(graph.primaryLinks.some((link) => link.href === "/chat/learn-anything"));
  assert.ok(graph.primaryLinks.some((link) => link.href === "/learn/understand-a-hard-topic"));
  assert.ok(mathGraph.primaryLinks.some((link) => link.href === "/subjects/math"));
  assert.ok(mathGraph.secondaryLinks.some((link) => link.href === "/subjects/math"));
  assert.ok(graph.prompts.some((link) => link.href === "/chat/learn-anything"));
  assert.ok(serialized.includes(absoluteUrl("/chat/learn-anything")));
  assert.ok(serialized.includes("learning actions"));
  assert.ok(getBlogCategories().some((category) => category.slug === "ai-tutor"));
});

test("blog practice plans add active-study depth to every article", () => {
  const posts = getBlogPosts();
  assert.ok(posts.length >= 100);

  for (const post of posts) {
    const plan = getBlogPostPracticePlan(post);

    assert.equal(plan.steps.length, 4, `${post.slug} should expose a four-step practice loop`);
    assert.ok(plan.intro.includes(post.title), `${post.slug} intro should be article-specific`);
    assert.ok(plan.checks.length >= 4, `${post.slug} should include reflection checks`);
    assert.ok(plan.routes.length >= 3, `${post.slug} should expose continuation routes`);
    assert.ok(plan.routes.every((route) => route.href.startsWith("/")), `${post.slug} routes should be internal`);
    assert.equal(
      new Set(plan.routes.map((route) => route.href)).size,
      plan.routes.length,
      `${post.slug} routes should not repeat destinations`,
    );
  }

  const learnAnything = getBlogPost("ai-learn-anything-guide");
  assert.ok(learnAnything);
  const plan = getBlogPostPracticePlan(learnAnything);
  const howTo = howToJsonLd({
    path: `/blog/${learnAnything.slug}`,
    id: "article-practice-loop",
    name: plan.title,
    description: plan.intro,
    totalTime: "PT12M",
    steps: plan.steps.map((step, index) => ({
      name: step.title,
      text: step.text,
      url: `/blog/${learnAnything.slug}#practice-step-${index + 1}`,
    })),
  });

  assert.equal(plan.title, "A 12-minute Learn Anything practice loop");
  assert.ok(plan.routes.some((route) => route.href === "/chat/learn-anything"));
  assert.equal(howTo["@type"], "HowTo");
  assert.equal(howTo.step.length, 4);
  assert.equal(howTo.step[0].url, absoluteUrl("/blog/ai-learn-anything-guide#practice-step-1"));
});

test("blog articles add substantial indexed editorial depth at scale", () => {
  const posts = getBlogPosts();
  assert.ok(posts.length >= 100);

  for (const post of posts) {
    const depth = getBlogPostDepth(post);
    const depthText = getBlogPostDepthText(post);
    const depthWordCount = depthText.trim().split(/\s+/).filter(Boolean).length;
    const depthLinks = depth.sections.flatMap((section) => section.links);
    const uniqueHrefs = new Set(depthLinks.map((link) => link.href));

    assert.equal(depth.sections.length, 3, `${post.slug} should expose three editorial depth sections`);
    assert.ok(depth.intro.includes(post.title), `${post.slug} depth intro should reference the article`);
    assert.ok(depthWordCount >= 320, `${post.slug} should add substantial article-specific depth`);
    assert.ok(depthLinks.length >= 9, `${post.slug} should add continuation links`);
    assert.equal(uniqueHrefs.size, depthLinks.length, `${post.slug} depth links should not repeat`);
    assert.ok(depthLinks.every((link) => link.href.startsWith("/")), `${post.slug} depth links should be internal`);
    assert.ok(
      estimateBlogIndexedWordCount(post) >= 850,
      `${post.slug} should have enough rendered, indexable article copy`,
    );
    assert.ok(estimateBlogIndexedReadingMinutes(post) >= 4, `${post.slug} should expose realistic reading time`);
  }
});

test("cornerstone blog posts are substantial and internally linked", () => {
  const cornerstoneSlugs = [
    "ai-learning-companion-for-everyone",
    "how-to-study-with-ai-without-cheating-yourself",
    "socratic-ai-tutor",
    "talk-to-historical-figures-with-ai",
    "ai-flashcards-and-active-recall",
  ];

  for (const slug of cornerstoneSlugs) {
    const post = getBlogPost(slug);
    assert.ok(post, `${slug} should exist`);

    const wordCount = post.body.trim().split(/\s+/).filter(Boolean).length;
    const internalLinks = post.body.match(/\]\(\/(?:chat|blog|prompts|subjects|topics|learn|ai-learning-map)/g) ?? [];
    const h2Count = post.body.match(/^## /gm)?.length ?? 0;

    assert.ok(wordCount >= 650, `${slug} should be a substantial pillar article`);
    assert.ok(internalLinks.length >= 5, `${slug} should link into the public learning graph`);
    assert.ok(h2Count >= 5, `${slug} should have clear scannable sections`);
  }
});

test("blog hub exposes pillar clusters that connect guides, categories, and live modes", () => {
  const posts = getBlogPosts();
  const clusters = getBlogPillarClusters(posts);
  const list = itemListJsonLd({
    path: "/blog",
    id: "pillar-clusters",
    name: "AI learning blog pillar clusters",
    items: clusters.map((cluster) => ({
      name: cluster.title,
      url: `/blog#${cluster.slug}`,
      description: cluster.description,
    })),
  });
  const faq = faqPageJsonLd({ path: "/blog", questions: blogHubFaqs });
  const serialized = serializeJsonLd([list, faq]);

  assert.equal(clusters.length, 4);
  assert.ok(clusters.every((cluster) => cluster.guides.length >= 4));
  assert.ok(
    clusters.some(
      (cluster) =>
        cluster.slug === "study-with-ai-without-cheating" &&
        cluster.modeHref === "/chat/homework-coach" &&
        cluster.categoryHref === "/blog/category/study-skills",
    ),
  );
  assert.ok(clusters.some((cluster) => cluster.guides.some((guide) => guide.href === "/blog/socratic-ai-tutor")));
  assert.equal(faq.mainEntity.length, blogHubFaqs.length);
  assert.ok(serialized.includes(absoluteUrl("/blog#ai-tutor-fundamentals")));
  assert.ok(serialized.includes("live AI learning tools"));
});

test("blog category hubs expose unique intent, live modes, workflows, and faq schema", () => {
  const category = getBlogCategories().find((item) => item.slug === "ai-tutor");
  assert.ok(category);

  const profile = getBlogCategoryProfile(category);
  const modes = getBlogCategoryRelatedModes(category);
  const featured = getBlogCategoryFeaturedPosts(category);
  const faqs = getBlogCategoryFaqs(category);
  const workflows = itemListJsonLd({
    path: `/blog/category/${category.slug}`,
    id: "category-workflows",
    name: `${category.name} learning workflows`,
    items: profile.workflows.map((workflow, index) => ({
      name: workflow.title,
      url: `/blog/category/${category.slug}#workflow-${index + 1}`,
      description: workflow.text,
    })),
  });
  const relatedModes = itemListJsonLd({
    path: `/blog/category/${category.slug}`,
    id: "related-live-modes",
    name: `${category.name} related public AI learning modes`,
    items: modes.map((mode) => ({
      name: mode.name,
      url: mode.href,
      description: mode.description,
    })),
  });
  const featuredGuides = itemListJsonLd({
    path: `/blog/category/${category.slug}`,
    id: "featured-guides",
    name: `${category.name} featured guides`,
    items: featured.map((post) => ({
      name: post.title,
      url: `/blog/${post.slug}`,
      description: post.description,
    })),
  });
  const faq = faqPageJsonLd({ path: `/blog/category/${category.slug}`, questions: faqs });
  const serialized = serializeJsonLd([workflows, relatedModes, featuredGuides, faq]);

  assert.equal(profile.title, "AI tutor guides");
  assert.ok(profile.searchIntents.includes("AI tutor"));
  assert.ok(profile.workflows.length >= 3);
  assert.ok(modes.some((mode) => mode.href === "/chat/learn-anything"));
  assert.ok(featured.some((post) => post.slug === "ai-learning-companion-for-everyone"));
  assert.equal(faq.mainEntity.length, faqs.length);
  assert.ok(serialized.includes(absoluteUrl("/chat/learn-anything")));
  assert.ok(serialized.includes(absoluteUrl("/blog/category/ai-tutor#workflow-1")));
  assert.ok(serialized.includes("live AI learning tools"));
});

test("blog articles expose navigation anchors and richer article schema", () => {
  const post = getBlogPost("ai-learn-anything-guide");
  assert.ok(post);

  const headings = extractBlogHeadings(post);
  const article = blogPostingJsonLd(post);

  assert.ok(headings.length >= 4);
  assert.ok(headings.some((heading) => heading.id === "what-this-mode-helps-with"));
  assert.equal(blogHeadingId("Why it is different from a generic chatbot"), "why-it-is-different-from-a-generic-chatbot");
  assert.ok(estimateBlogReadingMinutes(post) >= 1);
  assert.equal(article.wordCount, estimateBlogIndexedWordCount(post));
  assert.equal(article.timeRequired, `PT${estimateBlogIndexedReadingMinutes(post)}M`);
  assert.ok(article.wordCount >= 850);
});

test("rss feed exposes the blog library with escaped public links", () => {
  const posts = getBlogPosts();
  const feed = buildRssFeed(posts);

  assert.ok(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(feed.includes('xmlns:content="http://purl.org/rss/1.0/modules/content/"'));
  assert.ok(feed.includes('xmlns:dc="http://purl.org/dc/elements/1.1/"'));
  assert.ok(feed.includes(`<atom:link href="${absoluteUrl("/rss.xml")}" rel="self" type="application/rss+xml" />`));
  assert.ok(feed.includes(absoluteUrl("/blog/ai-learn-anything-guide")));
  assert.ok(feed.includes(absoluteUrl("/og?")));
  assert.ok(feed.includes(`<dc:creator>inspir</dc:creator>`));
  assert.ok(feed.includes("<content:encoded><![CDATA["));
  assert.ok(feed.includes(absoluteUrl("/chat/learn-anything")));
  assert.ok(feed.includes("Browse the AI learning guide library"));
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
  assert.equal(index.discovery.promptLibrary, absoluteUrl("/prompts"));
  assert.equal(index.discovery.learningMap, absoluteUrl("/ai-learning-map"));
  assert.equal(index.discovery.comparisons, absoluteUrl("/compare"));
  assert.equal(index.discovery.audiencePaths, absoluteUrl("/for"));
  assert.equal(index.discovery.subjectHubs, absoluteUrl("/subjects"));
  assert.ok(compact.includes("Public learning entrypoints are canonical at /chat/{topicSlug}."));
  assert.ok(full.includes("# inspir Full AI-Readable Learning Index"));
  assert.ok(index.publicPages.some((page) => page.url === absoluteUrl("/prompts")));
  assert.ok(compact.includes(absoluteUrl("/learn/understand-a-hard-topic")));
  assert.ok(compact.includes("## Public authority pages"));
  assert.ok(full.includes("## Public authority and mission"));
  assert.equal(index.authority.about.timeline.length, aboutTimeline.length);
  assert.equal(index.authority.about.proofPoints.length, aboutProofPoints.length);
  assert.equal(index.authority.about.faq.length, aboutFaqs.length);
  assert.ok(index.authority.about.referenceLinks.some((link) => link.url === absoluteUrl("/topics")));
  assert.ok(full.includes("A learning community begins"));
  assert.equal(index.authority.media.storyAngles.length, mediaStoryAngles.length);
  assert.equal(index.authority.media.linkingTargets.length, mediaLinkingTargets.length);
  assert.equal(index.authority.media.citationSnippets.length, mediaCitationSnippets.length);
  assert.equal(index.authority.media.faq.length, mediaFaqs.length);
  assert.ok(index.authority.media.coverageLinks.some((link) => link.url.includes("deccanbusiness.com")));
  assert.ok(index.authority.media.linkingTargets.some((target) => target.url === absoluteUrl("/chat/learn-anything")));
  assert.ok(index.authority.media.citationSnippets.some((snippet) => snippet.url === absoluteUrl("/trust")));
  assert.ok(full.includes("### Media and press"));
  assert.ok(full.includes("AI learning without passive answer-copying"));
  assert.ok(full.includes("Recommended citation targets:"));
  assert.ok(full.includes("Suggested citation snippets:"));
  assert.equal(index.authority.schools.features.length, schoolFeatures.length);
  assert.equal(index.authority.schools.deploymentSteps.length, schoolDeploymentSteps.length);
  assert.equal(index.authority.schools.useCases.length, schoolUseCases.length);
  assert.equal(index.authority.schools.faq.length, schoolFaqs.length);
  assert.deepEqual([...index.authority.schools.searchIntents], [...schoolSearchIntents]);
  assert.ok(compact.includes("## Schools and partner deployment"));
  assert.ok(full.includes("### Schools and partners"));
  assert.ok(full.includes("white-labelled AI tutoring"));
  assert.equal(index.authority.trust.principles.length, trustPrinciples.length);
  assert.equal(index.authority.trust.safeguards.length, trustSafeguards.length);
  assert.equal(index.authority.trust.publicAccessPolicies.length, trustPublicAccessPolicies.length);
  assert.equal(index.authority.trust.referenceLinks.length, trustReferenceLinks.length);
  assert.equal(index.authority.trust.faq.length, trustFaqs.length);
  assert.ok(index.authority.trust.referenceLinks.some((link) => link.url === absoluteUrl("/robots.txt")));
  assert.ok(index.authority.publicAuthorityPages.some((page) => page.url === absoluteUrl("/trust")));
  assert.ok(compact.includes("## Trust and safety"));
  assert.ok(full.includes("### Trust and safety"));
  assert.ok(full.includes("Private saved chats stay private"));
  assert.equal(index.authority.mission.principles.length, missionPrinciples.length);
  assert.equal(index.authority.mission.faq.length, missionFaqs.length);
  assert.ok(index.authority.publicAuthorityPages.some((page) => page.url === absoluteUrl("/topics")));
  assert.ok(full.includes("## AI learning paths"));
  assert.ok(full.includes(`URL: ${absoluteUrl("/chat/learn-anything")}`));
  assert.ok(full.includes("Historical and persona simulations"));
  assert.equal(index.learningPaths.length, homepageLearningPaths.length);
  assert.ok(index.learningPaths.every((path) => path.url.includes("/learn/")));
  assert.ok(index.learningPaths.every((path) => path.searchIntents.length >= 4));
  assert.ok(index.learningPaths.every((path) => path.examplePrompts.length === 3));
  assert.ok(index.learningPaths.every((path) => path.mistakesToAvoid.length === 3));
  assert.ok(index.learningPaths.every((path) => path.reviewLoop.length === 3));
  assert.ok(full.includes("Example prompts:"));
  assert.ok(full.includes("Mistakes to avoid:"));
  assert.ok(full.includes("Review loop:"));
  assert.equal(index.featuredLearningFilm.title, homepageFilm.title);
  assert.equal(index.featuredLearningFilm.chapters.length, homepageFilm.chapters.length);
  assert.ok(compact.includes(homepageFilm.title));
  assert.ok(full.includes(homepageFilm.transcript));
  assert.equal(index.topicDirectory.modeCount, topicSeeds.length);
  assert.ok(index.topicDirectory.categories.some((category) => category.url === absoluteUrl("/topics#foundations")));
  assert.equal(index.promptLibrary.promptCount, getPromptEntries().length);
  assert.equal(index.promptLibrary.modeCount, topicSeeds.length);
  assert.equal(index.promptLibrary.categoryCount, getPromptCategoryHubs().length);
  assert.ok(index.promptLibrary.searchIntents.includes("AI tutor prompts"));
  assert.ok(index.promptLibrary.categories.some((category) => category.url === absoluteUrl("/prompts#foundations")));
  assert.ok(
    index.promptLibrary.categories.some((category) =>
      category.prompts.some((entry) => entry.prompt === "Explain black holes simply"),
    ),
  );
  assert.ok(compact.includes("## AI prompt library"));
  assert.ok(full.includes("## AI prompt library"));
  assert.ok(full.includes("Explain black holes simply"));
  assert.equal(index.learningMap.workflowCount, getLearningMapWorkflows().length);
  assert.ok(index.learningMap.workflows.some((workflow) => workflow.url === absoluteUrl("/ai-learning-map#understand-anything")));
  assert.ok(
    index.learningMap.workflows.some((workflow) =>
      workflow.modes.some((mode) => mode.url === absoluteUrl("/chat/learn-anything")),
    ),
  );
  assert.ok(
    index.learningMap.workflows.some((workflow) =>
      workflow.guides.some((guide) => guide.url === absoluteUrl("/blog/ai-learn-anything-guide")),
    ),
  );
  assert.ok(compact.includes("## AI learning map"));
  assert.ok(full.includes("## AI learning map"));
  assert.ok(full.includes("AI homework help without cheating"));
  assert.equal(index.comparisons.pageCount, getComparisonPages().length);
  assert.ok(index.comparisons.pages.some((page) => page.url === absoluteUrl("/compare/khan-academy-alternative")));
  assert.ok(
    index.comparisons.pages.some((page) =>
      page.modes.some((mode) => mode.url === absoluteUrl("/chat/homework-coach")),
    ),
  );
  assert.ok(compact.includes("## AI tutor comparisons"));
  assert.ok(full.includes("## AI tutor comparisons"));
  assert.ok(full.includes("Khan Academy Alternative for Live AI Tutoring"));
  assert.equal(index.audiencePaths.pageCount, getAudiencePages().length);
  assert.ok(index.audiencePaths.pages.some((page) => page.url === absoluteUrl("/for/students")));
  assert.ok(
    index.audiencePaths.pages.some((page) =>
      page.modes.some((mode) => mode.url === absoluteUrl("/chat/homework-coach")),
    ),
  );
  assert.ok(compact.includes("## Audience learning paths"));
  assert.ok(full.includes("## Audience learning paths"));
  assert.ok(full.includes("Free AI Tutor for Students"));
  assert.equal(index.subjectHubs.pageCount, getSubjectPages().length);
  assert.ok(index.subjectHubs.pages.some((page) => page.url === absoluteUrl("/subjects/math")));
  assert.ok(
    index.subjectHubs.pages.some((page) =>
      page.modes.some((mode) => mode.url === absoluteUrl("/chat/math-step-coach")),
    ),
  );
  assert.ok(index.subjectHubs.pages.some((page) => page.prompts.some((prompt) => prompt.url === absoluteUrl("/chat/math-step-coach"))));
  assert.ok(compact.includes("## Subject learning hubs"));
  assert.ok(full.includes("## Subject learning hubs"));
  assert.ok(full.includes("AI Math Tutor"));
  assert.equal(index.publicLearningModes.length, topicSeeds.length);
  assert.ok(index.blog.postCount >= 100);
  assert.ok(index.blog.posts.length >= 100);
  assert.ok(index.blog.categoryCount >= 1);
  assert.equal(index.blog.directory.pillarClusters.length, getBlogPillarClusters().length);
  assert.ok(index.blog.directory.pillarClusters.every((cluster) => cluster.guides.length >= 4));
  assert.ok(compact.includes("## Blog pillar clusters"));
  assert.ok(full.includes("## Blog pillar clusters"));
  assert.ok(full.includes(absoluteUrl("/blog#study-with-ai-without-cheating")));
  const aiTutorCategory = index.blog.categories.find((category) => category.slug === "ai-tutor");
  assert.ok(aiTutorCategory);
  assert.equal(aiTutorCategory.title, "AI tutor guides");
  assert.ok(aiTutorCategory.searchIntents.includes("AI tutor"));
  assert.ok(aiTutorCategory.relatedModes.some((mode) => mode.url === absoluteUrl("/chat/learn-anything")));
  assert.ok(aiTutorCategory.featuredPosts.some((post) => post.url === absoluteUrl("/blog/ai-learning-companion-for-everyone")));
  assert.ok(full.includes("### AI tutor guides"));
  assert.ok(full.includes("Related live modes:"));
  assert.ok(index.publicLearningModes.every((mode) => mode.url.includes("/chat/")));
  assert.ok(
    index.publicLearningModes.some(
      (mode) => mode.slug === "socratic-instruction" && mode.searchIntents.includes("AI Socratic tutor"),
    ),
  );

  const learnAnythingGuide = index.blog.posts.find((post) => post.slug === "ai-learn-anything-guide");
  assert.ok(learnAnythingGuide);
  assert.equal(learnAnythingGuide.canonicalUrl, absoluteUrl("/blog/ai-learn-anything-guide"));
  assert.equal(learnAnythingGuide.relatedMode?.slug, "learn-anything");
  assert.ok(learnAnythingGuide.readingMinutes >= 4);
  assert.ok(learnAnythingGuide.wordCount >= 850);
  assert.equal(learnAnythingGuide.indexedWordCount, learnAnythingGuide.wordCount);
  assert.ok(learnAnythingGuide.editorialDepth.sections.length >= 3);
  assert.ok(learnAnythingGuide.headings.some((heading) => heading.id === "what-this-mode-helps-with"));
  assert.ok(
    learnAnythingGuide.learningActions.some((link) => link.url === absoluteUrl("/chat/learn-anything")),
  );
  assert.ok(
    learnAnythingGuide.learningActions.some((link) => link.url === absoluteUrl("/learn/understand-a-hard-topic")),
  );
  assert.ok(
    learnAnythingGuide.learningGraph.some((link) => link.url === absoluteUrl("/chat/socratic-instruction")),
  );
  assert.ok(full.includes("Learning actions:"));
  assert.ok(full.includes("Connected resources:"));
  assert.equal(/\/chat\/[0-9a-f-]{36}/i.test(compact), false);
  assert.equal(/\/chat\/[0-9a-f-]{36}/i.test(full), false);
  assert.equal(/\/chat\/[0-9a-f-]{36}/i.test(serialized), false);
});

test("metadata alternates expose rss, llms, ai index, and language canonicals", () => {
  const alternates = metadataAlternates("/blog");

  assert.equal(alternates.canonical, "/blog");
  assert.equal(alternates.languages["en-US"], "/blog");
  assert.equal(alternates.languages["x-default"], "/blog");
  assert.equal(alternates.types["application/rss+xml"], "/rss.xml");
  assert.equal(alternates.types["text/plain"], "/llms.txt");
  assert.equal(alternates.types["application/json"], "/ai-content-index.json");
});

test("social image helper uses the dynamic branded preview image", () => {
  const image = socialImage({
    title: "AI Socratic Tutor <script>",
    eyebrow: "Learning mode",
    description: "Ask better questions and learn actively.",
  });

  assert.equal(image.width, 1200);
  assert.equal(image.height, 630);
  assert.ok(image.url.startsWith(absoluteUrl("/og?")));
  assert.ok(image.url.includes("AI+Socratic+Tutor"));
  assert.ok(image.url.includes("Learning+mode"));
  assert.equal(image.url.includes("legacy.example"), false);
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
