import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { ChatClient } from "@/components/chat/ChatClient";
import { getActiveTopics, getDefaultTopic, getUserById } from "@/lib/db/queries";
import { getTopicMetadata } from "@/lib/ai/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await getServerSession(authOptions);

  const [topics, defaultTopic, user] = await Promise.all([
    getActiveTopics(),
    getDefaultTopic(),
    session?.user?.id ? getUserById(session.user.id) : Promise.resolve(null),
  ]);

  if (!defaultTopic) throw new Error("Default topic missing");

  if (!session?.user?.id) {
    const guestTopics = topics.filter((topic) => {
      const uiMode = getTopicMetadata(topic)?.uiMode;
      return uiMode !== "quiz" && uiMode !== "flashcards";
    });
    const initialTopic = guestTopics.find((topic) => topic.id === defaultTopic.id) ?? guestTopics[0];
    if (!initialTopic) redirect("/");

    return (
      <ChatClient
        authMode="guest"
        user={{
          id: "guest",
          name: "Guest learner",
          email: "",
          image: null,
          score: 0,
          preferredLanguage: "English",
          createdAt: new Date(),
          profileImageHash: null,
        }}
        topics={guestTopics}
        initialTopicId={initialTopic.id}
        initialMessages={[]}
        initialActivityRun={null}
      />
    );
  }

  return (
    <ChatClient
      authMode="authenticated"
      user={{
        id: session.user.id,
        name: user?.name ?? session.user.name ?? "User Name",
        email: user?.email ?? session.user.email ?? "user@example.com",
        image: user?.image ?? session.user.image ?? null,
        score: user?.score ?? 0,
        preferredLanguage: user?.preferredLanguage ?? "English",
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
