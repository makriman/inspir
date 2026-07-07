import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  generatePromptsMetadata,
  PromptsPageContent,
} from "@/components/marketing/pages/PromptsMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generatePromptsMetadata(defaultLanguage);
}

export default function PromptLibraryPage() {
  return <PromptsPageContent language={defaultLanguage} pathname="/prompts" />;
}
