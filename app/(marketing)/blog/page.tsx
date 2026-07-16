import { defaultLanguage } from "@/lib/content/languages";
import {
  BlogPageContent,
  generateBlogMetadata,
} from "@/components/marketing/pages/BlogMarketingPage";

export const dynamic = "force-static";

export function generateMetadata() {
  return generateBlogMetadata(defaultLanguage);
}

export default function BlogIndexPage() {
  return <BlogPageContent language={defaultLanguage} pathname="/blog" />;
}
