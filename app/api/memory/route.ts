import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { buildMemoryEmbedding, compileUserMemoryProfile, displayMemoryContent, isUsefulMemoryContent } from "@/lib/ai/memory";
import {
  clearUserMemories,
  createUserMemory,
  getMemoryDashboard,
  serializeMemorySettings,
  updateUserMemorySettings,
} from "@/lib/db/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const memorySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  noticeSeen: z.boolean().optional(),
});

const memoryCreateSchema = z.object({
  content: z.string().trim().min(5).max(600),
  category: z
    .enum([
      "identity",
      "preferences",
      "learning_style",
      "projects",
      "goals",
      "knowledge",
      "constraints",
      "interaction",
      "general",
    ])
    .default("general"),
});

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dashboard = await getMemoryDashboard(session.user.id);
  return NextResponse.json(serializeDashboard(dashboard));
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = memoryCreateSchema.safeParse(await request.json());
  if (!parsed.success || !isUsefulMemoryContent(parsed.data.content)) {
    return NextResponse.json({ error: "That memory needs a little more detail." }, { status: 400 });
  }

  const existingDashboard = await getMemoryDashboard(session.user.id);
  if (!existingDashboard.settings.enabled) {
    return NextResponse.json({ error: "Memory is turned off." }, { status: 409 });
  }

  const embedding = await buildMemoryEmbedding(parsed.data.content);
  await createUserMemory({
    userId: session.user.id,
    kind: "explicit",
    category: parsed.data.category,
    content: parsed.data.content,
    tags: ["manual"],
    confidence: 100,
    salience: 95,
    embedding,
  });
  await compileUserMemoryProfile(session.user.id, parsed.data.category);

  const dashboard = await getMemoryDashboard(session.user.id);
  return NextResponse.json(serializeDashboard(dashboard), { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = memorySettingsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid memory settings" }, { status: 400 });

  await updateUserMemorySettings(session.user.id, {
    enabled: parsed.data.enabled,
    noticeSeenAt: parsed.data.noticeSeen ? new Date() : undefined,
  });
  const dashboard = await getMemoryDashboard(session.user.id);
  return NextResponse.json(serializeDashboard(dashboard));
}

export async function DELETE() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await clearUserMemories(session.user.id);
  const dashboard = await getMemoryDashboard(session.user.id);
  return NextResponse.json(serializeDashboard(dashboard));
}

function serializeDashboard(dashboard: Awaited<ReturnType<typeof getMemoryDashboard>>) {
  return {
    settings: serializeMemorySettings(dashboard.settings),
    profiles: dashboard.profiles.map((profile) => ({
      category: profile.category,
      summary: profile.summary,
      updatedAt: profile.updatedAt,
    })),
    memories: dashboard.memories.filter((memory) => isUsefulMemoryContent(memory.content)).map((memory) => {
      const tags = memory.tags ?? [];
      return {
        id: memory.id,
        kind: memory.kind,
        category: memory.category,
        content: memory.content,
        displayContent: displayMemoryContent(memory.content),
        sourceLabel: tags.includes("manual")
          ? "Added manually"
          : memory.kind === "explicit"
            ? "Remembered from chat"
            : "Learned from chats",
        tags,
        confidence: memory.confidence,
        salience: memory.salience,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      };
    }),
  };
}
