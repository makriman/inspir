import { redirect, notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { ChatClient } from "@/components/chat/ChatClient";
import { getActiveTopics, getChatMessages, getDefaultTopic, getOwnedChat, getUserById } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ChatThreadPage({ params }: { params: Promise<{ chatId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/");

  const { chatId } = await params;
  const owned = await getOwnedChat(chatId, session.user.id);
  if (!owned) notFound();

  const [topics, defaultTopic, messages, user] = await Promise.all([
    getActiveTopics(),
    getDefaultTopic(),
    getChatMessages(chatId),
    getUserById(session.user.id),
  ]);

  return (
    <ChatClient
      user={{
        id: session.user.id,
        name: user?.name ?? session.user.name ?? "User Name",
        email: user?.email ?? session.user.email ?? "user@example.com",
        image: user?.image ?? session.user.image ?? null,
        score: user?.score ?? 0,
        createdAt: user?.createdAt ?? new Date(),
        profileImageHash: user?.profileImageHash ?? null,
      }}
      topics={topics}
      initialTopicId={owned.topic?.id ?? defaultTopic?.id ?? topics[0]?.id}
      initialChatId={chatId}
      initialMessages={messages.map((message) => ({
        id: message.id,
        role:
          message.role === "assistant" || message.role === "system" || message.role === "user"
            ? message.role
            : "assistant",
        content: message.content,
        createdAt: message.createdAt,
      }))}
    />
  );
}
