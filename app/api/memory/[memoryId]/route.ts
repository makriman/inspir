import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { buildMemoryEmbedding, compileUserMemoryProfile, displayMemoryContent, isUsefulMemoryContent } from "@/lib/ai/memory";
import { deleteUserMemory, getUserMemory, updateUserMemory } from "@/lib/db/memory";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const memoryUpdateSchema = z.object({
  content: z.string().trim().min(1).max(600).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
  pinned: z.boolean().optional(),
  doNotMention: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ memoryId: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("memory");
  if (freeze) return freeze;

  const { memoryId } = await params;
  const parsed = memoryUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid memory update" }, { status: 400 });

  const nextContent = parsed.data.content;
  if (nextContent && !isUsefulMemoryContent(nextContent)) {
    return NextResponse.json({ error: "That memory needs a little more detail." }, { status: 400 });
  }
  const existing = await getUserMemory(session.user.id, memoryId);
  if (!existing || existing.status !== "active") return NextResponse.json({ error: "Memory not found" }, { status: 404 });

  const userEdited = Boolean(nextContent || parsed.data.category || parsed.data.tags);
  const nextTags = userEdited
    ? [
        ...new Set([
          ...(parsed.data.tags ?? existing.tags ?? []).filter((tag) => tag !== "prior_chat" && tag !== "chat_history"),
          "manual",
        ]),
      ].slice(0, 8)
    : parsed.data.tags;

  const memory = await updateUserMemory(session.user.id, memoryId, {
    ...(nextContent ? { content: nextContent, embedding: await buildMemoryEmbedding(nextContent), kind: "explicit" as const } : {}),
    ...(parsed.data.category ? { category: parsed.data.category } : {}),
    ...(nextTags ? { tags: nextTags } : {}),
    ...(userEdited ? { sourceType: "manual", pinned: true } : {}),
    ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
    ...(parsed.data.doNotMention !== undefined ? { doNotMention: parsed.data.doNotMention } : {}),
    salience: 90,
  });
  if (!memory) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  await Promise.all(
    [...new Set([existing.category, memory.category])].map((category) => compileUserMemoryProfile(session.user.id, category)),
  );

  return NextResponse.json({
    memory: {
      id: memory.id,
      kind: memory.kind,
      category: memory.category,
      content: memory.content,
      displayContent: displayMemoryContent(memory.content),
      sourceLabel: memorySourceLabel(memory.kind, memory.tags ?? [], memory.sourceType),
      tags: memory.tags,
      confidence: memory.confidence,
      salience: memory.salience,
      sourceType: memory.sourceType,
      freshnessStatus: memory.freshnessStatus,
      pinned: memory.pinned,
      doNotMention: memory.doNotMention,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    },
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ memoryId: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("memory");
  if (freeze) return freeze;

  const { memoryId } = await params;
  const memory = await deleteUserMemory(session.user.id, memoryId);
  if (!memory) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  await compileUserMemoryProfile(session.user.id, memory.category);

  return NextResponse.json({ ok: true });
}

function memorySourceLabel(kind: string, tags: string[], sourceType?: string) {
  if (sourceType === "manual" || tags.includes("manual")) return "Added manually";
  if (sourceType === "prior_chat" || tags.includes("prior_chat")) return "From previous chat";
  if (sourceType === "synthesized") return "Synthesized from chats";
  if (kind === "explicit") return "Remembered from chat";
  return "Learned from chats";
}
