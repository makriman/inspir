import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getUserById } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserById(session.user.id);
  return NextResponse.json({ user });
}
