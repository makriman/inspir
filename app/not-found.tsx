import Link from "next/link";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";

export default function NotFound() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <section className="marketing-status-page">
        <div className="marketing-status-copy">
          <span>404</span>
          <h1>Oops! 404 error</h1>
          <p>
          The page you&apos;re looking for does not exist.
        </p>
          <Link href="/" className="marketing-primary-cta">
          Go home
        </Link>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
