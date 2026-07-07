import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  AudiencePageContent,
  generateAudienceMetadata,
} from "@/components/marketing/pages/AudienceMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateAudienceMetadata(defaultLanguage);
}

export default function AudienceHubPage() {
  return <AudiencePageContent language={defaultLanguage} pathname="/for" />;
}
