import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  generateTrustMetadata,
  TrustPageContent,
} from "@/components/marketing/pages/TrustMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateTrustMetadata(defaultLanguage);
}

export default function TrustPage() {
  return <TrustPageContent language={defaultLanguage} pathname="/trust" />;
}
