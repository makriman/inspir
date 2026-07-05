import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  buildMemoryEmbedding,
  compileUserMemoryProfile,
  displayMemoryContent,
  isUsefulMemoryContent,
  synthesizeUserMemory,
} from "@/lib/ai/memory";
import {
  clearUserMemories,
  createUserMemory,
  getMemoryDashboard,
  serializeMemorySettings,
  updateUserMemorySettings,
} from "@/lib/db/memory";
import { consumeFixedWindowQuota, numberFromEnv, quotaDefaults, safeQuotaKeyPart } from "@/lib/utils/rate-limit";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const memorySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  savedMemoryEnabled: z.boolean().optional(),
  chatHistoryEnabled: z.boolean().optional(),
  dreamingEnabled: z.boolean().optional(),
  noticeSeen: z.boolean().optional(),
  refreshSummary: z.boolean().optional(),
  correction: z.string().trim().min(5).max(800).optional(),
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

type ManualMemoryInput = z.infer<typeof memoryCreateSchema> & {
  userId: string;
};

function createManualMemoryAndLoadDashboard(input: ManualMemoryInput) {
  return buildMemoryEmbedding(input.content)
    .then((embedding) =>
      createUserMemory({
        userId: input.userId,
        kind: "explicit",
        category: input.category,
        content: input.content,
        tags: ["manual"],
        confidence: 100,
        salience: 95,
        sourceType: "manual",
        pinned: true,
        embedding,
      }),
    )
    .then(() => compileUserMemoryProfile(input.userId, input.category))
    .then(() => getMemoryDashboard(input.userId));
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dashboard = await getMemoryDashboard(session.user.id);
  return NextResponse.json(serializeDashboard(dashboard));
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("memory");
  if (freeze) return freeze;

  const parsed = memoryCreateSchema.safeParse(await request.json());
  if (!parsed.success || !isUsefulMemoryContent(parsed.data.content)) {
    return NextResponse.json({ error: "That memory needs a little more detail." }, { status: 400 });
  }

  const existingDashboard = await getMemoryDashboard(session.user.id);
  if (!existingDashboard.settings.enabled) {
    return NextResponse.json({ error: "Memory is turned off." }, { status: 409 });
  }

  const limit = await consumeFixedWindowQuota(
    `memory:create:${safeQuotaKeyPart(session.user.id)}`,
    numberFromEnv("RATE_LIMIT_MEMORY_DAILY", quotaDefaults.memoryDaily),
    24 * 60 * 60 * 1000,
  );
  if (!limit.ok) return quotaResponse("Daily memory limit reached", limit.retryAfterSeconds);

  const dashboard = await createManualMemoryAndLoadDashboard({
    userId: session.user.id,
    ...parsed.data,
  });
  return NextResponse.json(serializeDashboard(dashboard), { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("memory");
  if (freeze) return freeze;

  const parsed = memorySettingsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid memory settings" }, { status: 400 });

  if (parsed.data.refreshSummary || parsed.data.correction) {
    const limit = await consumeFixedWindowQuota(
      `memory:update:${safeQuotaKeyPart(session.user.id)}`,
      numberFromEnv("RATE_LIMIT_MEMORY_DAILY", quotaDefaults.memoryDaily),
      24 * 60 * 60 * 1000,
    );
    if (!limit.ok) return quotaResponse("Daily memory limit reached", limit.retryAfterSeconds);
  }

  await updateUserMemorySettings(session.user.id, {
    enabled: parsed.data.enabled,
    savedMemoryEnabled: parsed.data.savedMemoryEnabled,
    chatHistoryEnabled: parsed.data.chatHistoryEnabled,
    dreamingEnabled: parsed.data.dreamingEnabled,
    noticeSeenAt: parsed.data.noticeSeen ? new Date() : undefined,
  });
  if (parsed.data.correction) {
    const embedding = await buildMemoryEmbedding(parsed.data.correction);
    await createUserMemory({
      userId: session.user.id,
      kind: "explicit",
      category: "general",
      content: parsed.data.correction,
      tags: ["manual", "correction"],
      confidence: 100,
      salience: 95,
      sourceType: "manual",
      pinned: true,
      embedding,
    });
  }
  if (parsed.data.refreshSummary || parsed.data.correction) {
    await synthesizeUserMemory(session.user.id, parsed.data.correction ? "user_correction" : "manual_refresh");
  }
  const dashboard = await getMemoryDashboard(session.user.id);
  return NextResponse.json(serializeDashboard(dashboard));
}

export async function DELETE() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("memory");
  if (freeze) return freeze;

  await clearUserMemories(session.user.id);
  const dashboard = await getMemoryDashboard(session.user.id);
  return NextResponse.json(serializeDashboard(dashboard));
}

function quotaResponse(error: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

function serializeDashboard(dashboard: Awaited<ReturnType<typeof getMemoryDashboard>>) {
  const memories = [];

  for (const memory of dashboard.memories) {
    if (!isUsefulMemoryContent(memory.content)) continue;
    if (memory.doNotMention && memory.sourceType === "prior_chat") continue;

    const tags = memory.tags ?? [];
    memories.push({
      id: memory.id,
      kind: memory.kind,
      category: memory.category,
      content: memory.content,
      displayContent: displayMemoryContent(memory.content),
      sourceLabel: memorySourceLabel(memory.kind, tags, memory.sourceType),
      tags,
      confidence: memory.confidence,
      salience: memory.salience,
      sourceType: memory.sourceType,
      freshnessStatus: memory.freshnessStatus,
      pinned: memory.pinned,
      doNotMention: memory.doNotMention,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    });
  }

  return {
    settings: serializeMemorySettings(dashboard.settings),
    summary: dashboard.summary
      ? {
          summary: dashboard.summary.summary,
          sections: dashboard.summary.sections ?? [],
          lastSynthesizedAt: dashboard.summary.lastSynthesizedAt,
          updatedAt: dashboard.summary.updatedAt,
        }
      : null,
    profiles: dashboard.profiles.map((profile) => ({
      category: profile.category,
      summary: profile.summary,
      updatedAt: profile.updatedAt,
    })),
    memories,
  };
}

function memorySourceLabel(kind: string, tags: string[], sourceType?: string) {
  const tagSet = new Set(tags);
  if (sourceType === "manual" || tagSet.has("manual")) return "Added manually";
  if (sourceType === "prior_chat" || tagSet.has("prior_chat")) return "From previous chat";
  if (sourceType === "synthesized") return "Synthesized from chats";
  if (kind === "explicit") return "Remembered from chat";
  return "Learned from chats";
}
