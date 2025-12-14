import { siteConfig } from './siteConfig';

function ensureMeta(selector, attrs) {
  const existing = document.head.querySelector(selector);
  if (existing) return existing;

  const meta = document.createElement('meta');
  Object.entries(attrs).forEach(([key, value]) => meta.setAttribute(key, value));
  document.head.appendChild(meta);
  return meta;
}

function ensureLink(selector, attrs) {
  const existing = document.head.querySelector(selector);
  if (existing) return existing;

  const link = document.createElement('link');
  Object.entries(attrs).forEach(([key, value]) => link.setAttribute(key, value));
  document.head.appendChild(link);
  return link;
}

function setMetaContent(selector, attrs, content) {
  if (!content) return;
  const meta = ensureMeta(selector, attrs);
  meta.setAttribute('content', content);
}

function removeSeoJsonLd() {
  document.head.querySelectorAll('script[data-seo-jsonld="true"]').forEach((node) => node.remove());
}

function addJsonLd(jsonLd) {
  if (!jsonLd) return;
  const blocks = Array.isArray(jsonLd) ? jsonLd : [jsonLd];

  blocks.forEach((data) => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-seo-jsonld', 'true');
    script.text = JSON.stringify(data);
    document.head.appendChild(script);
  });
}

export function applySeo({
  title,
  description,
  keywords,
  canonicalPath,
  robots,
  ogType,
  imagePath,
  jsonLd,
}) {
  const resolvedTitle = title
    ? siteConfig.titleTemplate.replace('%s', title)
    : siteConfig.defaultTitle;

  const resolvedDescription = description || siteConfig.defaultDescription;
  const resolvedKeywords = (keywords && keywords.length ? keywords : siteConfig.defaultKeywords).join(', ');
  const resolvedOgType = ogType || 'website';
  const resolvedImage = imagePath || siteConfig.defaultImagePath;
  const resolvedCanonicalPath = canonicalPath || '/';

  const canonicalUrl = new URL(resolvedCanonicalPath, siteConfig.baseUrl).toString();
  const imageUrl = new URL(resolvedImage, siteConfig.baseUrl).toString();

  document.title = resolvedTitle;
  setMetaContent('meta[name="title"]', { name: 'title' }, resolvedTitle);

  setMetaContent('meta[name="description"]', { name: 'description' }, resolvedDescription);
  setMetaContent('meta[name="keywords"]', { name: 'keywords' }, resolvedKeywords);
  setMetaContent('meta[name="robots"]', { name: 'robots' }, robots || 'index, follow');

  setMetaContent('meta[property="og:type"]', { property: 'og:type' }, resolvedOgType);
  setMetaContent('meta[property="og:url"]', { property: 'og:url' }, canonicalUrl);
  setMetaContent('meta[property="og:title"]', { property: 'og:title' }, resolvedTitle);
  setMetaContent('meta[property="og:description"]', { property: 'og:description' }, resolvedDescription);
  setMetaContent('meta[property="og:image"]', { property: 'og:image' }, imageUrl);
  setMetaContent(
    'meta[property="og:image:alt"]',
    { property: 'og:image:alt' },
    title ? `${title} - ${siteConfig.siteName}` : `${siteConfig.siteName} - AI Quiz Generator`
  );
  setMetaContent('meta[property="og:site_name"]', { property: 'og:site_name' }, siteConfig.siteName);
  setMetaContent('meta[property="og:locale"]', { property: 'og:locale' }, siteConfig.locale);

  setMetaContent('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image');
  setMetaContent('meta[name="twitter:url"]', { name: 'twitter:url' }, canonicalUrl);
  setMetaContent('meta[name="twitter:title"]', { name: 'twitter:title' }, resolvedTitle);
  setMetaContent('meta[name="twitter:description"]', { name: 'twitter:description' }, resolvedDescription);
  setMetaContent('meta[name="twitter:image"]', { name: 'twitter:image' }, imageUrl);
  setMetaContent(
    'meta[name="twitter:image:alt"]',
    { name: 'twitter:image:alt' },
    title ? `${title} - ${siteConfig.siteName}` : `${siteConfig.siteName} - AI Quiz Generator`
  );

  ensureLink('link[rel="canonical"]', { rel: 'canonical', href: canonicalUrl }).setAttribute('href', canonicalUrl);

  removeSeoJsonLd();
  addJsonLd(jsonLd);
}
