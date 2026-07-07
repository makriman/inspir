import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  generateMediaMetadata,
  MediaPageContent,
} from "@/components/marketing/pages/MediaMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateMediaMetadata(defaultLanguage);
}

export default function MediaPage() {
  return <MediaPageContent language={defaultLanguage} pathname="/media" />;
}
