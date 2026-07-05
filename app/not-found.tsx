import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";

export default function NotFound() {
  return (
    <main className="bubble-chat-status" aria-labelledby="not-found-title">
      <div>
        <span>404</span>
        <h1 id="not-found-title">Page not found</h1>
        <p>The page is not available. Start a fresh learning chat or return home.</p>
        <div className="bubble-status-actions">
          <Link href="/chat/learn-anything">Start learning</Link>
          <Link href="/">Home</Link>
        </div>
      </div>
    </main>
  );
}
