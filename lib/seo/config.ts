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
  "https://x.com/inspiruk",
  "https://www.facebook.com/inspir.uk",
  "https://www.instagram.com/inspir.uk",
  "https://www.linkedin.com/company/inspiruk",
];

export function absoluteUrl(path = "/") {
  if (/^https?:\/\//.test(path)) return path;
  return new URL(path, siteUrl).toString();
}

export function socialImage({ title }: SocialImageInput) {
  return {
    ...defaultSocialImage,
    alt: `${title} | ${siteName}`,
  };
}
