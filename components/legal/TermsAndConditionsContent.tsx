import { ContentPage } from "@/components/legal/ContentPage";
import { extractedPages } from "@/lib/content/extracted-pages";

export const termsDescription =
  "The terms that describe acceptable use, account responsibilities, and public service conditions for inspir.";

export function TermsAndConditionsContent({ path = "/terms" }: { path?: string }) {
  return (
    <ContentPage
      title="Terms And Conditions"
      blocks={extractedPages.tnc}
      description={termsDescription}
      eyebrow="Terms"
      path={path}
      relatedLinks={[
        { href: "/privacy", label: "Privacy Policy" },
        { href: "/mission", label: "Mission" },
        { href: "/topics", label: "Learning modes" },
      ]}
    />
  );
}
