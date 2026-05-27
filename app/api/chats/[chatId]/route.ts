import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getChatMessages, getOwnedChat } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await params;
  const owned = await getOwnedChat(chatId, session.user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messages = await getChatMessages(chatId);
  return NextResponse.json({ chat: owned.chat, topic: owned.topic, messages });
}
