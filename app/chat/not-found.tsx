import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";

export default function ChatNotFound() {
  return (
    <main className="bubble-chat-status" aria-labelledby="chat-not-found-title">
      <div>
        <span>404</span>
        <h1 id="chat-not-found-title">Chat not found</h1>
        <p>This conversation is not available. Start a fresh learning chat when you are ready.</p>
        <Link href="/chat/learn-anything">Start a new chat</Link>
      </div>
    </main>
  );
}
