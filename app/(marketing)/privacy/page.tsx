import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";
import { defaultLanguage } from "@/lib/content/languages";

export const dynamic = "force-static";
export const revalidate = false;

export function generateMetadata() {
  return PrivacyPolicyContent.generateMetadata(defaultLanguage);
}

export default function PrivacyPage() {
  return <PrivacyPolicyContent language={defaultLanguage} />;
}
