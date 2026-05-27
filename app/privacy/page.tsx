import { ContentPage } from "@/components/legal/ContentPage";
import { extractedPages } from "@/lib/content/extracted-pages";

export default function PrivacyPage() {
  return <ContentPage title="Privacy Policy" blocks={extractedPages.privacy} />;
}
