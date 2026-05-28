import { InspirWordmark } from "@/components/brand/InspirLogo";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";

export default function LoadingPage() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <section className="marketing-status-page" aria-label="Loading">
        <div className="marketing-loader" aria-hidden="true">
          <div />
          <InspirWordmark className="marketing-loader-word" />
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
