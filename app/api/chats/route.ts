import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createChatForUser, getChatPreviews, getRecentChats } from "@/lib/db/queries";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createChatSchema = z.object({
  topicId: z.string().trim().min(1).max(120),
});

export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const topicId = searchParams.get("topicId") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const chats = await getRecentChats(session.user.id, topicId, q);
  const previews = await getChatPreviews(chats.map((chat) => chat.id));

  const rows = chats.map((chat) => ({
    ...chat,
    firstMessagePreview: previews.get(chat.id) ?? chat.title ?? chat.topicName,
  }));

  return NextResponse.json({ chats: rows });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("chats");
  if (freeze) return freeze;

  const body = createChatSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });

  const chat = await createChatForUser(session.user.id, body.data.topicId);
  if (!chat) return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  return NextResponse.json({ chatId: chat.id, chat });
}
