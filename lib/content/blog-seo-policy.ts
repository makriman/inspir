import type { BlogCategory, BlogPost } from "@/lib/content/blog";

export const indexedBlogSlugs = new Set([
  "ai-learning-companion-for-everyone",
  "how-to-study-with-ai-without-cheating-yourself",
  "socratic-ai-tutor",
  "talk-to-historical-figures-with-ai",
  "ai-flashcards-and-active-recall",
]);

export function isIndexedBlogPost(postOrSlug: BlogPost | string) {
  const slug = typeof postOrSlug === "string" ? postOrSlug : postOrSlug.slug;
  return indexedBlogSlugs.has(slug);
}

export function indexedBlogPosts(posts: BlogPost[]) {
  return posts.filter(isIndexedBlogPost);
}

export function categoryHasIndexedPosts(category: BlogCategory, posts: BlogPost[] = category.posts) {
  const categorySlugs = new Set(category.posts.map((post) => post.slug));
  return posts.some((post) => categorySlugs.has(post.slug) && isIndexedBlogPost(post));
}
