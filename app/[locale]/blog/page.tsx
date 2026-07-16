import type { Metadata } from "next";
import {
  BlogPageContent,
  generateBlogMetadata,
} from "@/components/marketing/pages/BlogMarketingPage";
import {
  generateLocalizedStaticParams,
  resolveLocaleParam,
  type LocaleRouteParams,
} from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/blog");
}

type LocalizedBlogPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({
  params,
}: LocalizedBlogPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateBlogMetadata(language);
}

export default async function LocalizedBlogPage({ params }: LocalizedBlogPageProps) {
  const language = await resolveLocaleParam(params);
  return <BlogPageContent language={language} pathname="/blog" />;
}
