import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  generateTopicsMetadata,
  TopicsPageContent,
} from "@/components/marketing/pages/TopicsMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateTopicsMetadata(defaultLanguage);
}

export default function TopicsPage() {
  return <TopicsPageContent language={defaultLanguage} pathname="/topics" />;
}
