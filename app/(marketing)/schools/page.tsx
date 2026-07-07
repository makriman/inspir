import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  generateSchoolsMetadata,
  SchoolsPageContent,
} from "@/components/marketing/pages/SchoolsMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateSchoolsMetadata(defaultLanguage);
}

export default function SchoolsPage() {
  return <SchoolsPageContent language={defaultLanguage} pathname="/schools" />;
}
