export const siteUrl = "https://inspirlearning.com";
export const siteName = "inspir";
export const siteTitle = "inspir | Free AI learning for everyone";
export const siteDescription =
  "inspir is a free AI learning platform for explanations, Socratic tutoring, homework coaching, quizzes, flashcards, debate, role-play, and study planning.";

export const defaultSocialImage = {
  url: "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191905644x747393734386347000/inspire-logo-presentation_compressed_page-0008.jpg",
  width: 1200,
  height: 630,
  alt: "inspir mission: learning is for everyone",
};

export type SocialImageInput = {
  title: string;
  eyebrow?: string;
  description?: string;
};

export const socialProfiles = [
  "https://twitter.com/inspiruk",
  "https://www.facebook.com/inspir.uk",
  "https://instagram.com/inspir.uk",
  "https://www.linkedin.com/company/inspiruk/",
];

export function absoluteUrl(path = "/") {
  if (/^https?:\/\//.test(path)) return path;
  return new URL(path, siteUrl).toString();
}

export function metadataAlternates(canonical: string) {
  return {
    canonical,
    types: {
      "application/rss+xml": "/rss.xml",
    },
  };
}

export function socialImage({ title, eyebrow = siteName, description }: SocialImageInput) {
  const params = new URLSearchParams({ title, eyebrow });
  if (description) params.set("description", description);

  return {
    url: absoluteUrl(`/og?${params.toString()}`),
    width: 1200,
    height: 630,
    alt: `${title} | ${siteName}`,
  };
}
