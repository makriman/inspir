import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { getUserById, updateUserLanguage } from "@/lib/db/queries";
import { normalizeLanguage, supportedLanguages } from "@/lib/content/languages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserById(session.user.id);
  return NextResponse.json({ user });
}

const updateMeSchema = z.object({
  preferredLanguage: z.enum(supportedLanguages).optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = updateMeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile update" }, { status: 400 });

  if (parsed.data.preferredLanguage) {
    const user = await updateUserLanguage(session.user.id, normalizeLanguage(parsed.data.preferredLanguage));
    return NextResponse.json({ user });
  }

  const user = await getUserById(session.user.id);
  return NextResponse.json({ user });
}
