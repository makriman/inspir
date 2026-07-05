import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { authOptions } from "@/lib/auth/config";
import { isAdminEmail } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { topics } from "@/lib/db/schema";
import { slugify } from "@/lib/utils/slug";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const topicSchema = z.object({
  name: z.string().trim().min(1),
  subText: z.string().trim().min(1),
  description: z.string().trim().min(1),
  inputboxText: z.string().trim().min(1),
  systemPrompt: z.string().trim().min(1),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const freeze = writeFreezeResponse("admin-topics");
  if (freeze) return freeze;

  const parsed = topicSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid topic" }, { status: 400 });
  const slug = slugify(parsed.data.name);

  const [existing] = await db.select({ id: topics.id }).from(topics).where(eq(topics.slug, slug)).limit(1);
  if (existing) {
    return NextResponse.json({ error: "A topic with this slug already exists", slug }, { status: 409 });
  }

  const [topic] = await db
    .insert(topics)
    .values({
      ...parsed.data,
      slug,
      status: "active",
      sortOrder: 100,
    })
    .returning();

  return NextResponse.json({ topic });
}
