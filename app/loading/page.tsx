import type { Metadata } from "next";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import { metadataAlternates } from "@/lib/seo/config";

export const metadata: Metadata = {
  title: "Loading",
  description: "A temporary loading state for inspir.",
  alternates: metadataAlternates("/loading"),
  robots: { index: false, follow: false, nocache: true },
};

export default function LoadingPage() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <section className="marketing-status-page" aria-labelledby="loading-title">
        <div className="marketing-loader" aria-hidden="true">
          <div />
          <InspirLogo className="marketing-loader-logo" />
        </div>
        <div className="marketing-status-copy is-compact">
          <span>Loading</span>
          <h1 id="loading-title">Getting your learning space ready.</h1>
          <p>This page is a temporary app state and is intentionally kept out of search results.</p>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
