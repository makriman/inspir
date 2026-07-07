import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  generateMissionMetadata,
  MissionPageContent,
} from "@/components/marketing/pages/MissionMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateMissionMetadata(defaultLanguage);
}

export default function MissionPage() {
  return <MissionPageContent language={defaultLanguage} pathname="/mission" />;
}
