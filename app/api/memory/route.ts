import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  clearUserMemories,
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

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dashboard = await getMemoryDashboard(session.user.id);
  return NextResponse.json(serializeDashboard(dashboard));
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
    memories: dashboard.memories.map((memory) => ({
      id: memory.id,
      kind: memory.kind,
      category: memory.category,
      content: memory.content,
      tags: memory.tags,
      confidence: memory.confidence,
      salience: memory.salience,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    })),
  };
}
