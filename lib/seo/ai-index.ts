import {
  getBlogCategories,
  getBlogPostTopic,
  getBlogPosts,
  type BlogCategory,
  type BlogPost,
} from "@/lib/content/blog";
import { homepageLearningPaths, learningPathHref, type HomepageLearningPath } from "@/lib/content/landing";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicSeeds, type TopicSeed } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";
import { absoluteUrl, siteDescription, siteName, siteUrl } from "@/lib/seo/config";

const contentLastUpdated = "2026-05-28";

const publicPages = [
  {
    name: "Home",
    url: absoluteUrl("/"),
    purpose: "Primary entry point for free AI learning, guest mode, and the most useful learning paths.",
  },
  {
    name: "Mission",
    url: absoluteUrl("/mission"),
    purpose: "Explains the mission, access model, and why inspir exists.",
  },
  {
    name: "Learning modes",
    url: absoluteUrl("/topics"),
    purpose: "Server-rendered directory of all public guest learning modes.",
  },
  {
    name: "Learning paths",
    url: absoluteUrl("/learn"),
    purpose: "Search-friendly study workflows that connect public modes, prompts, and related guides.",
  },
  {
    name: "Schools",
    url: absoluteUrl("/schools"),
    purpose: "Information for schools, teachers, and education partners.",
  },
  {
    name: "Blog",
    url: absoluteUrl("/blog"),
    purpose: "Long-form learning guides, study methods, AI tutor examples, and mode-specific SEO clusters.",
  },
  {
    name: "Media",
    url: absoluteUrl("/media"),
    purpose: "Press, official assets, story, and public media references.",
  },
  {
    name: "About",
    url: absoluteUrl("/about"),
    purpose: "Company and product background.",
  },
];

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function markdownList(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function relatedPostsForTopic(topic: TopicSeed, posts: BlogPost[]) {
  return posts
    .filter((post) => getBlogPostTopic(post)?.slug === topic.slug)
    .slice(0, 6)
    .map((post) => ({
      title: post.title,
      url: absoluteUrl(`/blog/${post.slug}`),
      description: post.description,
    }));
}

function modeIndex(topic: TopicSeed, posts: BlogPost[]) {
  const seo = getTopicSeo(topic);

  return {
    slug: topic.slug,
    name: topic.name,
    url: absoluteUrl(topicPath(topic.slug)),
    canonicalUrl: absoluteUrl(topicPath(topic.slug)),
    category: topic.metadata.category,
    uiMode: topic.metadata.uiMode,
    summary: topic.subText,
    description: cleanText(seo.description),
    helps: cleanText(seo.who),
    whyItIsDifferent: cleanText(seo.whyDifferent),
    outcomes: seo.outcomes,
    searchIntents: seo.searchIntents,
    starterPrompts: topic.metadata.starters,
    relatedGuides: relatedPostsForTopic(topic, posts),
  };
}

function blogPostIndex(post: BlogPost) {
  const topic = getBlogPostTopic(post);

  return {
    slug: post.slug,
    title: post.title,
    url: absoluteUrl(`/blog/${post.slug}`),
    description: cleanText(post.description),
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    tags: post.tags,
    relatedMode: topic
      ? {
          slug: topic.slug,
          name: topic.name,
          url: absoluteUrl(topicPath(topic.slug)),
        }
      : null,
  };
}

function categoryIndex(category: BlogCategory) {
  return {
    slug: category.slug,
    name: category.name,
    url: absoluteUrl(`/blog/category/${category.slug}`),
    postCount: category.count,
    featuredPosts: category.posts.slice(0, 12).map((post) => ({
      title: post.title,
      url: absoluteUrl(`/blog/${post.slug}`),
      description: cleanText(post.description),
    })),
  };
}

function learningPathIndex(path: HomepageLearningPath) {
  return {
    slug: path.slug,
    name: path.title,
    url: absoluteUrl(learningPathHref(path.slug)),
    description: cleanText(path.seoDescription),
    audience: cleanText(path.audience),
    outcome: cleanText(path.outcome),
    proofPoints: path.proofPoints,
    steps: path.steps.map((step) => ({
      title: step.title,
      description: cleanText(step.text),
      url: absoluteUrl(step.href),
    })),
    publicModes: path.links.map((link) => ({
      label: link.label,
      url: absoluteUrl(link.href),
    })),
    relatedGuides: path.relatedBlogSlugs.map((slug) => absoluteUrl(`/blog/${slug}`)),
  };
}

export function buildAiContentIndex() {
  const posts = getBlogPosts();
  const categories = getBlogCategories();

  return {
    "@context": "https://schema.org",
    "@type": "DataCatalog",
    name: `${siteName} AI learning content index`,
    url: absoluteUrl("/ai-content-index.json"),
    description: siteDescription,
    inLanguage: "en",
    dateModified: contentLastUpdated,
    publisher: {
      "@type": "Organization",
      name: siteName,
      url: siteUrl,
    },
    discovery: {
      sitemap: absoluteUrl("/sitemap.xml"),
      robots: absoluteUrl("/robots.txt"),
      llms: absoluteUrl("/llms.txt"),
      llmsFull: absoluteUrl("/llms-full.txt"),
      rss: absoluteUrl("/rss.xml"),
      publicModesHub: absoluteUrl("/topics"),
      defaultGuestMode: absoluteUrl(topicPath("learn-anything")),
    },
    indexingPolicy: {
      publicGuestModes: "Public learning entrypoints are canonical at /chat/{topicSlug}.",
      privateSavedChats: "Saved user conversations use non-public identifiers, require the right session, and are excluded from discovery surfaces.",
      userContent: "User transcripts, account data, admin tools, password reset flows, and service endpoints are not public source content.",
      historicalPersonaCaution:
        "Historical and persona modes are learning simulations. Generated dialogue should not be cited as authenticated quotation.",
    },
    publicPages,
    learningPaths: homepageLearningPaths.map(learningPathIndex),
    publicLearningModes: topicSeeds.map((topic) => modeIndex(topic, posts)),
    blog: {
      postCount: posts.length,
      categoryCount: categories.length,
      posts: posts.map(blogPostIndex),
      categories: categories.map(categoryIndex),
    },
  };
}

export function buildLlmsTxt() {
  const index = buildAiContentIndex();

  return [
    `# ${siteName}`,
    "",
    siteDescription,
    "",
    "## Canonical discovery files",
    `- Sitemap: ${index.discovery.sitemap}`,
    `- Robots: ${index.discovery.robots}`,
    `- RSS feed: ${index.discovery.rss}`,
    `- Full AI-readable index: ${index.discovery.llmsFull}`,
    `- JSON content catalog: ${index.url}`,
    "",
    "## Indexing policy",
    `- ${index.indexingPolicy.publicGuestModes}`,
    `- ${index.indexingPolicy.privateSavedChats}`,
    `- ${index.indexingPolicy.userContent}`,
    `- ${index.indexingPolicy.historicalPersonaCaution}`,
    "",
    "## Best entrypoints",
    ...publicPages.map((page) => `- ${page.name}: ${page.url} - ${page.purpose}`),
    "",
    "## AI learning paths",
    ...index.learningPaths.map((path) => `- ${path.name}: ${path.url} - ${path.description}`),
    "",
    "## Public AI learning modes",
    ...index.publicLearningModes.map((mode) => `- ${mode.name}: ${mode.url} - ${mode.description}`),
    "",
    "## Blog posts",
    ...index.blog.posts.map((post) => `- ${post.title}: ${post.url} - ${post.description}`),
    "",
    "## Blog categories",
    ...index.blog.categories.map((category) => `- ${category.name}: ${category.url} (${category.postCount} guides)`),
    "",
  ].join("\n");
}

export function buildLlmsFullTxt() {
  const index = buildAiContentIndex();
  const publicPageLines = publicPages.map((page) => `- ${page.name}: ${page.url}\n  Purpose: ${page.purpose}`);
  const modeSections = index.publicLearningModes.map((mode) =>
    [
      `### ${mode.name}`,
      `URL: ${mode.url}`,
      `Canonical: ${mode.canonicalUrl}`,
      `Category: ${mode.category}`,
      `Interface: ${mode.uiMode}`,
      `Summary: ${mode.summary}`,
      `Description: ${mode.description}`,
      `Who it helps: ${mode.helps}`,
      `Why it is different: ${mode.whyItIsDifferent}`,
      "Outcomes:",
      markdownList(mode.outcomes),
      "Search intents:",
      markdownList(mode.searchIntents),
      "Starter prompts:",
      markdownList(mode.starterPrompts),
      mode.relatedGuides.length > 0
        ? ["Related guides:", ...mode.relatedGuides.map((post) => `- ${post.title}: ${post.url}`)].join("\n")
        : "Related guides: See the blog and category clusters.",
    ].join("\n"),
  );
  const pathSections = index.learningPaths.map((path) =>
    [
      `### ${path.name}`,
      `URL: ${path.url}`,
      `Description: ${path.description}`,
      `Audience: ${path.audience}`,
      `Outcome: ${path.outcome}`,
      "Steps:",
      ...path.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.description} (${step.url})`),
      "Public modes:",
      ...path.publicModes.map((mode) => `- ${mode.label}: ${mode.url}`),
      "Related guides:",
      ...path.relatedGuides.map((url) => `- ${url}`),
    ].join("\n"),
  );
  const categoryLines = index.blog.categories.map(
    (category) => `- ${category.name}: ${category.url} (${category.postCount} guides)`,
  );
  const blogLines = index.blog.posts.map((post) => {
    const relatedMode = post.relatedMode ? ` Related mode: ${post.relatedMode.name} (${post.relatedMode.url}).` : "";
    return `- ${post.title}: ${post.url}\n  Summary: ${post.description}\n  Tags: ${post.tags.join(", ")}.${relatedMode}`;
  });

  return [
    `# ${siteName} Full AI-Readable Learning Index`,
    "",
    `Site: ${siteUrl}`,
    `Last updated: ${index.dateModified}`,
    `Description: ${index.description}`,
    "",
    "## How to cite and index inspir",
    "Use canonical public URLs from this file. Public guest learning modes live at /chat/{topicSlug}. Private saved conversations are intentionally absent from this index and should not be inferred from public pages. Historical and persona simulations are interactive learning experiences, not primary sources or authenticated quotations.",
    "",
    "## Discovery files",
    `- Sitemap: ${index.discovery.sitemap}`,
    `- Robots: ${index.discovery.robots}`,
    `- RSS feed: ${index.discovery.rss}`,
    `- Compact llms.txt: ${index.discovery.llms}`,
    `- JSON content catalog: ${index.url}`,
    "",
    "## Public pages",
    ...publicPageLines,
    "",
    "## AI learning paths",
    ...pathSections,
    "",
    "## Public learning modes",
    ...modeSections,
    "",
    "## Blog category clusters",
    ...categoryLines,
    "",
    "## Blog guide library",
    ...blogLines,
    "",
  ].join("\n");
}
