import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { buildMemoryEmbedding, compileUserMemoryProfile, displayMemoryContent, isUsefulMemoryContent } from "@/lib/ai/memory";
import { deleteUserMemory, updateUserMemory } from "@/lib/db/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const memoryUpdateSchema = z.object({
  content: z.string().trim().min(1).max(600).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ memoryId: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memoryId } = await params;
  const parsed = memoryUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid memory update" }, { status: 400 });

  const nextContent = parsed.data.content;
  if (nextContent && !isUsefulMemoryContent(nextContent)) {
    return NextResponse.json({ error: "That memory needs a little more detail." }, { status: 400 });
  }
  const memory = await updateUserMemory(session.user.id, memoryId, {
    ...(nextContent ? { content: nextContent, embedding: await buildMemoryEmbedding(nextContent), kind: "explicit" as const } : {}),
    ...(parsed.data.category ? { category: parsed.data.category } : {}),
    ...(parsed.data.tags ? { tags: parsed.data.tags } : {}),
    salience: 90,
  });
  if (!memory) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  await compileUserMemoryProfile(session.user.id, memory.category);

  return NextResponse.json({
    memory: {
      id: memory.id,
      kind: memory.kind,
      category: memory.category,
      content: memory.content,
      displayContent: displayMemoryContent(memory.content),
      sourceLabel: memory.tags?.includes("manual")
        ? "Added manually"
        : memory.kind === "explicit"
          ? "Remembered from chat"
          : "Learned from chats",
      tags: memory.tags,
      confidence: memory.confidence,
      salience: memory.salience,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    },
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ memoryId: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memoryId } = await params;
  const memory = await deleteUserMemory(session.user.id, memoryId);
  if (!memory) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  await compileUserMemoryProfile(session.user.id, memory.category);

  return NextResponse.json({ ok: true });
}
