import { NextRequest, NextResponse } from "next/server";
import { isAdminEmailAsync } from "@/lib/auth/admin";
import { requireSession } from "@/lib/auth/session";
import { getUserProfileById, updateUserProfile } from "@/lib/db/queries";
import { normalizeLanguage } from "@/lib/content/languages";
import { calculateAge, validateDateOfBirth } from "@/lib/profile/age";
import { updateProfileSchema } from "@/lib/profile/validation";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserProfileById(session.user.id);
  return NextResponse.json({ user: await serializeUser(user) });
}

export async function PATCH(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("profile");
  if (freeze) return freeze;

  const parsed = updateProfileSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile update" }, { status: 400 });

  if (parsed.data.dateOfBirth) {
    const dob = validateDateOfBirth(parsed.data.dateOfBirth);
    if (!dob.success) return NextResponse.json({ error: dob.error }, { status: 400 });
  }

  const user = await updateUserProfile(session.user.id, {
    name: parsed.data.name,
    preferredLanguage: parsed.data.preferredLanguage
      ? normalizeLanguage(parsed.data.preferredLanguage)
      : undefined,
    dateOfBirth: parsed.data.dateOfBirth,
    dateOfBirthSource: parsed.data.dateOfBirth ? "user" : undefined,
  });
  return NextResponse.json({ user: await serializeUser(user) });
}

async function serializeUser(user: Awaited<ReturnType<typeof getUserProfileById>> | Awaited<ReturnType<typeof updateUserProfile>>) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    score: user.score,
    preferredLanguage: user.preferredLanguage,
    dateOfBirth: user.dateOfBirth,
    createdAt: user.createdAt,
    profileImageHash: hasUsableProfilePhoto(user) ? user.profileImageHash : null,
    age: calculateAge(user.dateOfBirth),
    isAdmin: await isAdminEmailAsync(user.email),
  };
}

function hasUsableProfilePhoto(user: {
  profileImageHash?: string | null;
  profileImageR2Key?: string | null;
  profileImageMime?: string | null;
}) {
  if (!("profileImageR2Key" in user) && !("profileImageMime" in user)) return Boolean(user.profileImageHash);
  return Boolean(user.profileImageHash && user.profileImageR2Key && user.profileImageMime);
}
