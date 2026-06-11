import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { topicSeeds, type TopicSeed } from "./topics";

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  author: string;
  tags: string[];
  image?: string;
  body: string;
};

export type BlogCategory = {
  slug: string;
  name: string;
  count: number;
  posts: BlogPost[];
};

export type BlogHeading = {
  id: string;
  level: 2 | 3;
  title: string;
  line: number;
};

const blogDirectory = join(process.cwd(), "content", "blog");
let blogPostCache: BlogPost[] | null = null;

function parseArray(value: string) {
  const trimmed = value.trim();
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  return inner
    .split(",")
    .flatMap((item) => {
      const value = item.trim().replace(/^["']|["']$/g, "");
      return value ? [value] : [];
    });
}

function parseFrontmatter(source: string, slug: string): BlogPost {
  if (!source.startsWith("---\n")) throw new Error(`Blog post ${slug} is missing frontmatter`);
  const end = source.indexOf("\n---", 4);
  if (end === -1) throw new Error(`Blog post ${slug} has invalid frontmatter`);

  const frontmatter = source.slice(4, end).trim();
  const body = source.slice(end + 4).trim();
  const data: Record<string, string> = {};

  for (const line of frontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    data[key] = value;
  }

  for (const required of ["title", "description", "date"]) {
    if (!data[required]) throw new Error(`Blog post ${slug} is missing ${required}`);
  }

  return {
    slug,
    title: data.title,
    description: data.description,
    date: data.date,
    updated: data.updated,
    author: data.author ?? "inspir",
    tags: data.tags ? parseArray(data.tags) : [],
    image: data.image,
    body,
  };
}

export function getBlogPosts() {
  if (blogPostCache) return blogPostCache;
  if (!existsSync(blogDirectory)) return [];
  const posts: BlogPost[] = [];
  for (const file of readdirSync(blogDirectory)) {
    if (!file.endsWith(".md")) continue;
    const slug = file.replace(/\.md$/, "");
    const source = readFileSync(join(blogDirectory, file), "utf8");
    posts.push(parseFrontmatter(source, slug));
  }
  blogPostCache = posts.toSorted((a, b) => b.date.localeCompare(a.date));
  return blogPostCache;
}

export function getBlogPost(slug: string) {
  return getBlogPosts().find((post) => post.slug === slug);
}

export function slugifyBlogTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function blogHeadingId(value: string) {
  return slugifyBlogTag(
    value
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~#]/g, "")
      .replace(/&/g, " and "),
  );
}

export function estimateBlogReadingMinutes(post: BlogPost) {
  const wordCount = post.body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 220));
}

export function extractBlogHeadings(post: BlogPost) {
  const counts = new Map<string, number>();

  return post.body
    .split("\n")
    .map((line, index): BlogHeading | null => {
      const match = /^(##|###)\s+(.+)$/.exec(line.trim());
      if (!match) return null;

      const title = match[2].trim();
      const baseId = blogHeadingId(title);
      if (!baseId) return null;

      const count = counts.get(baseId) ?? 0;
      counts.set(baseId, count + 1);

      return {
        id: count === 0 ? baseId : `${baseId}-${count + 1}`,
        level: match[1] === "##" ? 2 : 3,
        title,
        line: index + 1,
      };
    })
    .filter((heading): heading is BlogHeading => Boolean(heading));
}

function guideSlug(topic: TopicSeed) {
  return topic.slug.endsWith("-guide") ? `ai-${topic.slug}` : `ai-${topic.slug}-guide`;
}

function promptLoopSlug(topic: TopicSeed) {
  return `${topic.slug}-prompts-and-study-loop`;
}

export function getBlogPostTopic(post: BlogPost) {
  const directSlugMatch = topicSeeds.find(
    (topic) => post.slug === guideSlug(topic) || post.slug === promptLoopSlug(topic),
  );
  if (directSlugMatch) return directSlugMatch;

  const lowerTags = new Set(post.tags.map((tag) => tag.toLowerCase()));
  const tagMatch = topicSeeds.find((topic) => lowerTags.has(topic.name.toLowerCase()) || lowerTags.has(topic.slug));
  if (tagMatch) return tagMatch;

  const linkedTopics = topicSeeds.filter((topic) => post.body.includes(`/chat/${topic.slug}`));
  return linkedTopics.length === 1 ? linkedTopics[0] : undefined;
}

export function getRelatedBlogPosts(post: BlogPost, limit = 3) {
  const topic = getBlogPostTopic(post);
  const tagSet = new Set(post.tags.map((tag) => tag.toLowerCase()));

  const scoredPosts: Array<{ post: BlogPost; score: number }> = [];
  for (const candidate of getBlogPosts()) {
    if (candidate.slug === post.slug) continue;
    const candidateTopic = getBlogPostTopic(candidate);
    const candidateTags = new Set(candidate.tags);
    const overlappingTags = candidate.tags.filter((tag) => tagSet.has(tag.toLowerCase())).length;
    const sameTopic = topic && candidateTopic?.slug === topic.slug ? 10 : 0;
    const sameCategory = topic && candidateTags.has(topic.metadata.category) ? 4 : 0;
    const evergreen = candidate.slug === "how-to-study-with-ai-without-cheating-yourself" ? 2 : 0;
    const score = sameTopic + sameCategory + overlappingTags * 3 + evergreen;
    if (score > 0) scoredPosts.push({ post: candidate, score });
  }

  const relatedPosts: BlogPost[] = [];
  for (const candidate of scoredPosts.toSorted((a, b) => b.score - a.score || b.post.date.localeCompare(a.post.date))) {
    relatedPosts.push(candidate.post);
    if (relatedPosts.length >= limit) break;
  }
  return relatedPosts;
}

export function getBlogCategories(minPosts = 3): BlogCategory[] {
  const categories = new Map<string, BlogCategory>();

  for (const post of getBlogPosts()) {
    for (const tag of post.tags) {
      const slug = slugifyBlogTag(tag);
      if (!slug) continue;
      const existing = categories.get(slug);
      if (existing) {
        existing.posts.push(post);
        existing.count += 1;
      } else {
        categories.set(slug, { slug, name: tag, count: 1, posts: [post] });
      }
    }
  }

  return Array.from(categories.values())
    .filter((category) => category.count >= minPosts)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function getBlogCategory(slug: string) {
  return getBlogCategories().find((category) => category.slug === slug);
}
