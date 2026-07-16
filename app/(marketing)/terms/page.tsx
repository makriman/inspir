import { TermsAndConditionsContent } from "@/components/legal/TermsAndConditionsContent";
import { defaultLanguage } from "@/lib/content/languages";

export const dynamic = "force-static";
export const revalidate = false;

export function generateMetadata() {
  return TermsAndConditionsContent.generateMetadata(defaultLanguage);
}

export default function TermsPage() {
  return (
    <TermsAndConditionsContent
      path="/terms"
      language={defaultLanguage}
    />
  );
}
