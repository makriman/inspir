import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  generateSubjectsMetadata,
  SubjectsPageContent,
} from "@/components/marketing/pages/SubjectsMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateSubjectsMetadata(defaultLanguage);
}

export default function SubjectHubPage() {
  return <SubjectsPageContent language={defaultLanguage} pathname="/subjects" />;
}
