import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/MarketingShell";

export default function NotFound() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <section className="marketing-status-page" aria-labelledby="not-found-title">
        <div className="marketing-status-copy">
          <span>404</span>
          <h1 id="not-found-title">This page has moved out of view.</h1>
          <p>
            The fastest way back is to start a public learning mode, browse the mode directory,
            or read a guide that links into the live chat experience.
          </p>
          <div className="marketing-status-actions">
            <ArrowLink href="/chat/learn-anything">Start learning</ArrowLink>
            <ArrowLink href="/topics">Browse modes</ArrowLink>
            <ArrowLink href="/blog">Read guides</ArrowLink>
          </div>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
