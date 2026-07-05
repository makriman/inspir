import { ArrowLeft, MessageCircle } from "lucide-react";
import { formatAppDate } from "@/lib/utils/dates";

type RecentConversation = {
  id: string;
  title: string | null;
  firstMessagePreview: string | null;
  replyCount: number;
  updatedAt: string | Date;
};

export function RecentConversations({
  chats,
  loading,
  onBack,
  onOpen,
}: {
  chats: RecentConversation[];
  loading: boolean;
  onBack: () => void;
  onOpen: (chatId: string) => void;
}) {
  return (
    <main className="inspir-recent app-scrollbar">
      <button type="button" onClick={onBack} className="inspir-recent-back">
        <ArrowLeft size={22} />
        Back
      </button>
      {loading ? <p className="inspir-recent-empty">Loading...</p> : null}
      {!loading && chats.length === 0 ? <p className="inspir-recent-empty">No search results</p> : null}
      <div className="inspir-recent-list">
        {chats.map((chat) => (
          <button key={chat.id} type="button" onClick={() => onOpen(chat.id)} className="inspir-recent-card">
            <span className="inspir-recent-title">{chat.firstMessagePreview || chat.title}</span>
            <span className="inspir-recent-meta">
              <MessageCircle size={16} />
              {chat.replyCount} Replies
            </span>
            <time>{formatAppDate(chat.updatedAt)}</time>
          </button>
        ))}
      </div>
    </main>
  );
}
