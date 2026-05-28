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

const blogDirectory = join(process.cwd(), "content", "blog");

function parseArray(value: string) {
  const trimmed = value.trim();
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  return inner
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
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
  if (!existsSync(blogDirectory)) return [];
  return readdirSync(blogDirectory)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      const source = readFileSync(join(blogDirectory, file), "utf8");
      return parseFrontmatter(source, slug);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
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

function guideSlug(topic: TopicSeed) {
  return topic.slug.endsWith("-guide") ? `ai-${topic.slug}` : `ai-${topic.slug}-guide`;
}

function promptLoopSlug(topic: TopicSeed) {
  return `${topic.slug}-prompts-and-study-loop`;
}

export function getBlogPostTopic(post: BlogPost) {
  return topicSeeds.find((topic) => {
    return (
      post.slug === guideSlug(topic) ||
      post.slug === promptLoopSlug(topic) ||
      post.tags.some((tag) => tag.toLowerCase() === topic.name.toLowerCase()) ||
      post.body.includes(`/chat/${topic.slug}`)
    );
  });
}

export function getRelatedBlogPosts(post: BlogPost, limit = 3) {
  const topic = getBlogPostTopic(post);
  const tagSet = new Set(post.tags.map((tag) => tag.toLowerCase()));

  return getBlogPosts()
    .filter((candidate) => candidate.slug !== post.slug)
    .map((candidate) => {
      const candidateTopic = getBlogPostTopic(candidate);
      const overlappingTags = candidate.tags.filter((tag) => tagSet.has(tag.toLowerCase())).length;
      const sameTopic = topic && candidateTopic?.slug === topic.slug ? 10 : 0;
      const sameCategory = topic && candidate.tags.includes(topic.metadata.category) ? 4 : 0;
      const evergreen = candidate.slug === "how-to-study-with-ai-without-cheating-yourself" ? 2 : 0;

      return {
        post: candidate,
        score: sameTopic + sameCategory + overlappingTags * 3 + evergreen,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.post.date.localeCompare(a.post.date))
    .slice(0, limit)
    .map((candidate) => candidate.post);
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
