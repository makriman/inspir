import type { BlogPost } from "@/lib/content/blog";
import type { TopicSeed } from "@/lib/content/topics";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { absoluteUrl, siteDescription, siteName, siteUrl, socialImage, socialProfiles } from "@/lib/seo/config";

export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: siteName,
    url: siteUrl,
    logo: absoluteUrl("/icon.png"),
    sameAs: socialProfiles,
    description: siteDescription,
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: siteName,
    url: siteUrl,
    publisher: { "@id": `${siteUrl}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/chat/learn-anything?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
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
  };
}

export function videoObjectJsonLd({
  path,
  name,
  description,
  thumbnailUrl,
  contentUrl,
}: {
  path: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  contentUrl: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "@id": `${absoluteUrl(path)}#video`,
    name,
    description,
    thumbnailUrl: [thumbnailUrl],
    contentUrl: absoluteUrl(contentUrl),
    publisher: { "@id": `${siteUrl}/#organization` },
    isPartOf: { "@id": `${absoluteUrl(path)}#webpage` },
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
    image:
      post.image ??
      socialImage({
        title: post.title,
        eyebrow: "Learning guide",
        description: post.description,
      }).url,
    keywords: post.tags.join(", "),
    articleSection: post.tags,
    isPartOf: { "@id": `${siteUrl}/blog#blog` },
  };
}
