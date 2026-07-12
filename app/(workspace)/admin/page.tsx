import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const dynamic = "force-static";
export const revalidate = false;

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPage() {
  return <AdminDashboard />;
}
