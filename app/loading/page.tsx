import { InspirLogo } from "@/components/brand/InspirLogo";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";

export default function LoadingPage() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <section className="marketing-status-page" aria-label="Loading">
        <div className="marketing-loader" aria-hidden="true">
          <div />
          <InspirLogo className="marketing-loader-logo" />
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
