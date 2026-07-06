"use client";

import { FormEvent, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

type AdminUser = {
  email: string;
  addedByEmail?: string | null;
  createdAt: string | Date;
  source?: "database" | "bootstrap";
};

export function AdminUserManager({ initialAdmins }: { initialAdmins: AdminUser[] }) {
  const [admins, setAdmins] = useState(initialAdmins);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function addAdmin(event: FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail }),
      });
      const data = (await response.json().catch(() => null)) as { admin?: AdminUser; error?: string } | null;
      if (!response.ok || !data?.admin) throw new Error(data?.error || "Could not add admin.");
      setAdmins((current) => [data.admin!, ...current.filter((admin) => admin.email !== data.admin!.email)]);
      setEmail("");
      setMessage(`${data.admin.email} can now access admin.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add admin.");
    } finally {
      setSaving(false);
    }
  }

  async function removeAdmin(adminEmail: string) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/users?email=${encodeURIComponent(adminEmail)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not remove admin.");
      setAdmins((current) => current.filter((admin) => admin.email !== adminEmail));
      setMessage(`${adminEmail} was removed from DB admins.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove admin.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.055] p-5">
      <div className="mb-4">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-[#7deb8f]">Access</p>
        <h2 className="mt-1 text-2xl font-black">Admins</h2>
      </div>
      <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={addAdmin}>
        <label className="grid gap-2">
          <span className="text-xs font-black uppercase tracking-[0.08em] text-white/50">Admin email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            className="h-11 rounded-lg border border-white/15 bg-black/25 px-3 text-sm font-bold text-white outline-none focus:border-[#7deb8f]"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-lg bg-[#26943f] px-4 text-sm font-black text-white disabled:opacity-60"
        >
          <Plus size={16} />
          Add admin
        </button>
      </form>
      {message ? <p className="mt-3 text-sm font-bold text-white/70">{message}</p> : null}
      <div className="mt-5 overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/[0.06] text-xs uppercase tracking-[0.08em] text-white/50">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Added by</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.email} className="border-t border-white/10">
                <td className="px-3 py-3 font-bold text-white">{admin.email}</td>
                <td className="px-3 py-3 text-white/62">{admin.source === "bootstrap" ? "Bootstrap" : "Database"}</td>
                <td className="px-3 py-3 text-white/62">{admin.addedByEmail || "system"}</td>
                <td className="px-3 py-3 text-right">
                  {admin.source === "bootstrap" ? (
                    <span className="text-xs font-bold text-white/45">Locked</span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove ${admin.email}`}
                      disabled={saving}
                      onClick={() => void removeAdmin(admin.email)}
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-white hover:border-red-300/50 hover:text-red-200 disabled:opacity-60"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
