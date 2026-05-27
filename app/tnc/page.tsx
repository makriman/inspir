import { ContentPage } from "@/components/legal/ContentPage";
import { extractedPages } from "@/lib/content/extracted-pages";

export default function TermsAndConditionsPage() {
  return <ContentPage title="Terms And Conditions" blocks={extractedPages.tnc} />;
}
