import { StaticGuestChatPage } from "@/components/chat/StaticGuestChatPage";

export const dynamic = "force-static";
export const revalidate = false;

export default function ChatPage() {
  return <StaticGuestChatPage />;
}
