import type { BlogPost } from "@/lib/content/blog";
import type { TopicSeed } from "@/lib/content/topics";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { absoluteUrl, defaultSocialImage, siteDescription, siteName, siteUrl, socialProfiles } from "@/lib/seo/config";

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
      image: defaultSocialImage.url,
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
      { name: "Chat", url: "/chat/learn-anything" },
      { name: topic.name, url: `/chat/${topic.slug}` },
    ]),
  ];
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
    image: post.image ?? defaultSocialImage.url,
    keywords: post.tags.join(", "),
  };
}
