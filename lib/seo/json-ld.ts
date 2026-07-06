import type { BlogPost } from "@/lib/content/blog";
import {
  estimateBlogIndexedReadingMinutes,
  estimateBlogIndexedWordCount,
} from "@/lib/content/blog-depth";
import type { TopicSeed } from "@/lib/content/topics";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { absoluteUrl, siteDescription, siteName, siteUrl, socialImage, socialProfiles } from "@/lib/seo/config";

const primarySiteNavigation = [
  { name: "Start learning", url: "/chat/learn-anything" },
  { name: "Learning modes", url: "/topics" },
  { name: "Subjects", url: "/subjects" },
  { name: "Prompts", url: "/prompts" },
  { name: "Learning paths", url: "/learn" },
  { name: "AI learning map", url: "/ai-learning-map" },
  { name: "Compare AI tutors", url: "/compare" },
  { name: "Blog", url: "/blog" },
  { name: "Schools", url: "/schools" },
  { name: "Trust", url: "/trust" },
  { name: "About", url: "/about" },
] as const;

export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": ["Organization", "EducationalOrganization"],
    "@id": `${siteUrl}/#organization`,
    name: siteName,
    url: siteUrl,
    logo: absoluteUrl("/icon.png"),
    sameAs: socialProfiles,
    description: siteDescription,
    slogan: "Learning is for everyone.",
    areaServed: "Worldwide",
    knowsAbout: [
      "AI tutoring",
      "Socratic learning",
      "active recall",
      "homework coaching",
      "flashcards",
      "study planning",
      "educational technology",
    ],
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: siteName,
    url: siteUrl,
    inLanguage: "en-US",
    publisher: { "@id": `${siteUrl}/#organization` },
    about: [
      "free AI tutoring",
      "AI learning modes",
      "active recall",
      "Socratic learning",
      "homework coaching",
      "AI study prompts",
    ],
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/chat/learn-anything?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function siteNavigationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${siteUrl}/#site-navigation`,
    name: "inspir public navigation",
    itemListElement: primarySiteNavigation.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "SiteNavigationElement",
        name: item.name,
        url: absoluteUrl(item.url),
        isPartOf: { "@id": `${siteUrl}/#website` },
      },
    })),
  };
}

export function webApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${siteUrl}/#app`,
    name: "inspir AI learning platform",
    url: siteUrl,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": `${siteUrl}/#organization` },
    description: siteDescription,
    isAccessibleForFree: true,
    browserRequirements: "Requires a modern web browser with JavaScript enabled.",
    featureList: [
      "AI explanations",
      "Socratic tutoring",
      "homework coaching",
      "quiz generation",
      "flashcard generation",
      "writing feedback",
      "coding help",
      "study planning",
      "AI learning prompt library",
    ],
    audience: [
      { "@type": "Audience", audienceType: "Students" },
      { "@type": "Audience", audienceType: "Parents" },
      { "@type": "Audience", audienceType: "Teachers" },
      { "@type": "Audience", audienceType: "Self-taught learners" },
    ],
  };
}

export function videoObjectJsonLd({
  path,
  name,
  description,
  thumbnailUrl,
  contentUrl,
  duration,
  uploadDate,
  transcript,
  clips,
}: {
  path: string;
  name: string;
  description: string;
    thumbnailUrl: string;
    contentUrl: string;
    duration?: string;
    uploadDate?: string;
    transcript?: string;
  clips?: ReadonlyArray<{ title: string; start: number; end?: number; text?: string }>;
}) {
  const url = absoluteUrl(path);
  const encodingFormat = contentUrl.endsWith(".webm") ? "video/webm" : "video/mp4";
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "@id": `${url}#video`,
    name,
    description,
    thumbnailUrl: [absoluteUrl(thumbnailUrl)],
    contentUrl: absoluteUrl(contentUrl),
    encodingFormat,
    url: `${url}#learning-film`,
    duration,
    uploadDate,
    transcript,
    isAccessibleForFree: true,
    accessibilityFeature: ["captions", "transcript", "chapters"],
    accessibilitySummary:
      "The film has a text transcript, timed captions, and chapter markers on the page.",
    publisher: { "@id": `${siteUrl}/#organization` },
    isPartOf: { "@id": `${url}#webpage` },
    hasPart: clips?.map((clip, index) => ({
      "@type": "Clip",
      "@id": `${url}#learning-film-chapter-${index + 1}`,
      name: clip.title,
      description: clip.text,
      startOffset: clip.start,
      endOffset: clip.end,
      url: `${url}#learning-film`,
    })),
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.url),
    })),
  };
}

export function webPageJsonLd({
  path,
  name,
  description,
  type = "WebPage",
}: {
  path: string;
  name: string;
  description: string;
  type?: "WebPage" | "AboutPage" | "CollectionPage";
}) {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    isPartOf: { "@id": `${siteUrl}/#website` },
    publisher: { "@id": `${siteUrl}/#organization` },
  };
}

export function itemListJsonLd({
  path,
  id,
  name,
  items,
}: {
  path: string;
  id: string;
  name: string;
  items: Array<{ name: string; url: string; description?: string }>;
}) {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${url}#${id}`,
    name,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: absoluteUrl(item.url),
      name: item.name,
      description: item.description,
    })),
  };
}

export function howToJsonLd({
  path,
  id,
  name,
  description,
  totalTime,
  steps,
}: {
  path: string;
  id: string;
  name: string;
  description: string;
  totalTime?: string;
  steps: Array<{ name: string; text: string; url?: string }>;
}) {
  const url = absoluteUrl(path);

  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "@id": `${url}#${id}`,
    name,
    description,
    totalTime,
    step: steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.name,
      text: step.text,
      url: step.url ? absoluteUrl(step.url) : `${url}#${id}-step-${index + 1}`,
    })),
  };
}

export function faqPageJsonLd({
  path,
  questions,
}: {
  path: string;
  questions: ReadonlyArray<{ question: string; answer: string }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${absoluteUrl(path)}#faq`,
    mainEntity: questions.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function topicJsonLd(topic: TopicSeed) {
  const seo = getTopicSeo(topic);
  const url = absoluteUrl(`/chat/${topic.slug}`);
  return [
    {
      "@context": "https://schema.org",
      "@type": "LearningResource",
      "@id": `${url}#learning-resource`,
      name: seo.title,
      url,
      description: seo.description,
      educationalUse: ["Tutoring", "Practice", "Self-study"],
      learningResourceType: "Interactive learning chat",
      teaches: topic.name,
      provider: { "@id": `${siteUrl}/#organization` },
      image: socialImage({
        title: topic.name,
        eyebrow: "Learning mode",
        description: seo.description,
      }).url,
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${url}#software`,
      name: `${topic.name} on inspir`,
      url,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: seo.description,
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Learning modes", url: "/topics" },
      { name: topic.name, url: `/chat/${topic.slug}` },
    ]),
  ];
}

export function learningModesItemListJsonLd(topics: TopicSeed[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${siteUrl}/topics#learning-modes`,
    name: "inspir public AI learning modes",
    itemListElement: topics.map((topic, index) => {
      const seo = getTopicSeo(topic);
      return {
        "@type": "ListItem",
        position: index + 1,
        url: absoluteUrl(`/chat/${topic.slug}`),
        name: topic.name,
        description: seo.description,
      };
    }),
  };
}

export function blogPostingJsonLd(post: BlogPost) {
  const wordCount = estimateBlogIndexedWordCount(post);
  const about = post.tags.map((tag) => ({
    "@type": "Thing",
    name: tag,
  }));

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    author: { "@type": "Organization", name: post.author },
    publisher: { "@id": `${siteUrl}/#organization` },
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
    wordCount,
    timeRequired: `PT${estimateBlogIndexedReadingMinutes(post)}M`,
    image:
      post.image ??
      socialImage({
        title: post.title,
        eyebrow: "Learning guide",
        description: post.description,
      }).url,
    keywords: post.tags.join(", "),
    articleSection: post.tags,
    about,
    mentions: about,
    isAccessibleForFree: true,
    inLanguage: "en-US",
    educationalUse: ["Self-study", "Tutoring", "Practice"],
    learningResourceType: "Learning guide",
    isPartOf: { "@id": `${siteUrl}/blog#blog` },
  };
}

export function blogLearningResourceJsonLd(post: BlogPost) {
  const url = absoluteUrl(`/blog/${post.slug}`);

  return {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    "@id": `${url}#learning-resource`,
    name: post.title,
    url,
    description: post.description,
    inLanguage: "en-US",
    isAccessibleForFree: true,
    educationalUse: ["Self-study", "Tutoring", "Practice"],
    learningResourceType: ["Article", "Study guide", "Prompt guide"],
    teaches: post.tags,
    timeRequired: `PT${estimateBlogIndexedReadingMinutes(post)}M`,
    provider: { "@id": `${siteUrl}/#organization` },
    isPartOf: { "@id": `${siteUrl}/blog#blog` },
  };
}
