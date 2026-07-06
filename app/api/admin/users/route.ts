import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminEmail, isAdminEmailAsync, normalizeAdminEmail } from "@/lib/auth/admin";
import { requireSession } from "@/lib/auth/session";
import { addAdminUser, removeAdminUser } from "@/lib/db/queries";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";
import { recordOpsEvent } from "@/lib/observability/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addAdminSchema = z.object({
  email: z.email(),
});

export async function POST(request: Request) {
  const session = await requireAuthorizedAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const freeze = writeFreezeResponse("admin-users");
  if (freeze) return freeze;

  const parsed = addAdminSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });

  const admin = await addAdminUser({
    email: parsed.data.email,
    addedByUserId: session.user.id,
    addedByEmail: session.user.email ?? null,
  });
  await recordOpsEvent({
    eventName: "admin_user_added",
    severity: "info",
    surface: "admin",
    userId: session.user.id,
    metadata: { email: admin.email },
  });
  return NextResponse.json({ admin: { ...admin, source: "database" } });
}

export async function DELETE(request: Request) {
  const session = await requireAuthorizedAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const freeze = writeFreezeResponse("admin-users");
  if (freeze) return freeze;

  const email = normalizeAdminEmail(new URL(request.url).searchParams.get("email"));
  if (!email) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (isAdminEmail(email)) {
    return NextResponse.json({ error: "Bootstrap admins are controlled by code or environment." }, { status: 409 });
  }

  await removeAdminUser(email);
  await recordOpsEvent({
    eventName: "admin_user_removed",
    severity: "info",
    surface: "admin",
    userId: session.user.id,
    metadata: { email },
  });
  return NextResponse.json({ ok: true });
}

async function requireAuthorizedAdmin() {
  const session = await requireSession();
  if (!session || !(await isAdminEmailAsync(session.user.email))) return null;
  return session;
}
