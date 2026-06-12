import { languageAlternatesForPath } from "@/lib/i18n/routing";

export const siteUrl = "https://inspirlearning.com";
export const siteName = "inspir";
export const siteTitle = "inspir | Free AI tutor and learning companion";
export const siteDescription =
  "inspir is a free AI tutor and learning companion for explanations, Socratic tutoring, homework coaching, quizzes, flashcards, debate, role-play, writing feedback, coding help, and study planning.";

export const defaultSocialImage = {
  url: `${siteUrl}/inspir-social-preview.png`,
  width: 1200,
  height: 630,
  alt: "inspir free AI learning for everyone",
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
  "https://github.com/makriman/inspir",
];

export function absoluteUrl(path = "/") {
  if (/^https?:\/\//.test(path)) return path;
  return new URL(path, siteUrl).toString();
}

export function metadataAlternates(canonical: string) {
  const languages: Record<string, string> = {
    ...languageAlternatesForPath(canonical),
    "x-default": canonical,
  };

  return {
    canonical,
    languages,
    types: {
      "application/rss+xml": "/rss.xml",
      "text/plain": "/llms.txt",
      "application/json": "/ai-content-index.json",
    },
  };
}

function encodeOgParam(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function socialImage({ title, eyebrow, description }: SocialImageInput) {
  const params = new URLSearchParams({
    title: encodeOgParam(title, 120),
  });

  if (eyebrow) params.set("eyebrow", encodeOgParam(eyebrow, 64));
  if (description) params.set("description", encodeOgParam(description, 180));

  return {
    url: `${siteUrl}/og?${params.toString()}`,
    width: 1200,
    height: 630,
    alt: `${title} | ${siteName}`,
  };
}
