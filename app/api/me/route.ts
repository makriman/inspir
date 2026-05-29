import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getUserById, updateUserProfile } from "@/lib/db/queries";
import { normalizeLanguage } from "@/lib/content/languages";
import { calculateAge, validateDateOfBirth } from "@/lib/profile/age";
import { updateProfileSchema } from "@/lib/profile/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserById(session.user.id);
  return NextResponse.json({ user: serializeUser(user) });
}

export async function PATCH(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = updateProfileSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile update" }, { status: 400 });

  if (parsed.data.dateOfBirth) {
    const dob = validateDateOfBirth(parsed.data.dateOfBirth);
    if (!dob.success) return NextResponse.json({ error: dob.error }, { status: 400 });
  }

  const user = await updateUserProfile(session.user.id, {
    preferredLanguage: parsed.data.preferredLanguage
      ? normalizeLanguage(parsed.data.preferredLanguage)
      : undefined,
    dateOfBirth: parsed.data.dateOfBirth,
    dateOfBirthSource: parsed.data.dateOfBirth ? "user" : undefined,
  });
  return NextResponse.json({ user: serializeUser(user) });
}

function serializeUser(user: Awaited<ReturnType<typeof getUserById>>) {
  if (!user) return null;
  return {
    ...user,
    age: calculateAge(user.dateOfBirth),
  };
}
