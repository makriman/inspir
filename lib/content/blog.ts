import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
