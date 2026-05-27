import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { ChatClient } from "@/components/chat/ChatClient";
import { getActiveTopics, getDefaultTopic, getUserById } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/");

  const [topics, defaultTopic, user] = await Promise.all([
    getActiveTopics(),
    getDefaultTopic(),
    getUserById(session.user.id),
  ]);

  if (!defaultTopic) throw new Error("Default topic missing");

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
      initialTopicId={defaultTopic.id}
      initialMessages={[]}
      initialActivityRun={null}
    />
  );
}
