import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { isAdminEmail } from "@/lib/auth/admin";
import { AdminTopicForm } from "@/components/admin/AdminTopicForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/");
  if (!isAdminEmail(session.user.email)) redirect("/");

  return (
    <main className="min-h-screen bg-[#171614] px-6 py-10 text-white">
      <h1 className="mx-auto mb-8 max-w-3xl text-4xl font-black">Admin</h1>
      <AdminTopicForm />
    </main>
  );
}
