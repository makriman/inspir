import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getBootstrapAdminEmails, isAdminEmailAsync } from "@/lib/auth/admin";
import { requireSession } from "@/lib/auth/session";
import { getAdminDashboardData, getAdminUsers } from "@/lib/db/queries";
import { AdminUserManager } from "@/components/admin/AdminUserManager";
import { AdminTopicForm } from "@/components/admin/AdminTopicForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true },
};

const adminDateTimeFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function AdminPage() {
  const session = await requireSession();
  if (!session) redirect("/");
  if (!(await isAdminEmailAsync(session.user.email))) redirect("/");

  const [dashboard, dbAdmins] = await Promise.all([getAdminDashboardData(14), getAdminUsers()]);
  const adminRows = mergeAdminRows(dbAdmins);

  return (
    <main className="min-h-screen bg-[#0c0d0d] px-5 py-8 text-white">
      <div className="mx-auto grid max-w-7xl gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.08em] text-[#7deb8f]">Admin</p>
            <h1 className="mt-2 text-4xl font-black tracking-normal">Operations dashboard</h1>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.055] px-3 py-2 text-sm font-bold text-white/62">
            Signed in as <span className="text-white">{session.user.email}</span>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          <MetricCard label="Users" value={dashboard.totals.users} />
          <MetricCard label="Chats" value={dashboard.totals.chats} />
          <MetricCard label="Messages" value={dashboard.totals.messages} />
          <MetricCard label="AI runs" value={dashboard.totals.aiRuns} />
          <MetricCard label="Product events" value={dashboard.totals.productEvents} />
          <MetricCard label="Ops events" value={dashboard.totals.opsEvents} />
          <MetricCard label="Cache entries" value={dashboard.totals.responseCacheEntries} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
          <DashboardPanel title="AI usage" kicker="Daily runs, tokens, failures">
            <DataTable
              columns={["Day", "Runs", "Completed", "Failed", "Tokens", "Cached in"]}
              rows={dashboard.aiDaily.map((row) => [
                row.day,
                row.runs,
                row.completed,
                row.failed,
                row.tokens,
                row.cachedPromptTokens,
              ])}
              empty="No AI runs recorded in this window."
            />
          </DashboardPanel>

          <DashboardPanel title="Quota posture" kicker="Denials and checks">
            <DataTable
              columns={["Event", "Count"]}
              rows={dashboard.quotaEvents.map((row) => [row.eventName, row.count])}
              empty="No quota denials or limiter failures."
            />
          </DashboardPanel>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <DashboardPanel title="Response cache" kicker="Hits, misses, stored answers">
            <DataTable
              columns={["Day", "Hits", "Misses", "Stores", "Bypasses", "Rejected"]}
              rows={dashboard.responseCacheDaily.map((row) => [
                row.day,
                row.hits,
                row.misses,
                row.stores,
                row.bypasses,
                row.rejected,
              ])}
              empty="No response-cache events recorded yet."
            />
          </DashboardPanel>

          <DashboardPanel title="Cache savings" kicker="Avoided provider work">
            <DataTable
              columns={["Metric", "Value"]}
              rows={[
                ["Active entries", dashboard.responseCacheSummary.activeEntries],
                ["Stale entries", dashboard.responseCacheSummary.staleEntries],
                ["Total hits", dashboard.responseCacheSummary.totalHits],
                ["Saved prompt tokens", dashboard.responseCacheSummary.savedPromptTokens],
                ["Saved completion tokens", dashboard.responseCacheSummary.savedCompletionTokens],
                ["Saved total tokens", dashboard.responseCacheSummary.savedTotalTokens],
              ]}
              empty="No cache savings recorded yet."
            />
          </DashboardPanel>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <DashboardPanel title="Cached topics" kicker="Top reusable public starters">
            <DataTable
              columns={["Topic", "Entries", "Hits", "Saved tokens"]}
              rows={dashboard.responseCacheTopics.map((row) => [
                row.topicSlug,
                row.entries,
                row.hits,
                row.savedTotalTokens,
              ])}
              empty="No cached topics yet."
            />
          </DashboardPanel>

          <DashboardPanel title="LLM budget shards" kicker="Global daily call ledger">
            <DataTable
              columns={["Day", "Calls"]}
              rows={dashboard.llmUsage.map((row) => [row.day, row.callCount])}
              empty="No global LLM budget usage recorded."
            />
          </DashboardPanel>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <DashboardPanel title="Product analytics" kicker="Daily app activity">
            <DataTable
              columns={["Day", "Events", "Known users"]}
              rows={dashboard.productDaily.map((row) => [row.day, row.events, row.users])}
              empty="No product events recorded yet."
            />
          </DashboardPanel>

          <DashboardPanel title="Top routes" kicker="Page views">
            <DataTable
              columns={["Route", "Views", "Known users"]}
              rows={dashboard.topRoutes.map((row) => [row.route, row.views, row.users])}
              empty="No route views recorded yet."
            />
          </DashboardPanel>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <DashboardPanel title="Recent ops events" kicker="Auth, quota, admin">
            <DataTable
              columns={["Time", "Severity", "Event", "Surface"]}
              rows={dashboard.opsRecent.map((row) => [
                formatDateTime(row.createdAt),
                row.severity,
                row.eventName,
                row.surface ?? "-",
              ])}
              empty="No recent ops events."
            />
          </DashboardPanel>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <AdminUserManager initialAdmins={adminRows} />
          <section className="rounded-xl border border-white/10 bg-white/[0.055] p-5">
            <div className="mb-4">
              <p className="text-xs font-black uppercase tracking-[0.08em] text-[#7deb8f]">Content</p>
              <h2 className="mt-1 text-2xl font-black">Topics</h2>
            </div>
            <AdminTopicForm />
          </section>
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.055] p-4">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-white/45">{label}</p>
      <strong className="mt-2 block text-3xl font-black">{Number(value ?? 0).toLocaleString()}</strong>
    </div>
  );
}

function DashboardPanel({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.055] p-5">
      <div className="mb-4">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-[#7deb8f]">{kicker}</p>
        <h2 className="mt-1 text-2xl font-black">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DataTable({ columns, rows, empty }: { columns: string[]; rows: Array<Array<string | number>>; empty: string }) {
  if (!rows.length) return <p className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm font-bold text-white/58">{empty}</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-white/[0.06] text-xs uppercase tracking-[0.08em] text-white/50">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`} className="border-t border-white/10">
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className="px-3 py-3 font-bold text-white/75">
                  {typeof cell === "number" ? cell.toLocaleString() : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function mergeAdminRows(dbAdmins: Awaited<ReturnType<typeof getAdminUsers>>) {
  const bootstrap = getBootstrapAdminEmails().map((email) => ({
    email,
    addedByEmail: "system",
    createdAt: new Date(0),
    source: "bootstrap" as const,
  }));
  const database = dbAdmins.map((admin) => ({
    ...admin,
    source: getBootstrapAdminEmails().includes(admin.email) ? ("bootstrap" as const) : ("database" as const),
  }));
  return [...database, ...bootstrap.filter((admin) => !database.some((row) => row.email === admin.email))].sort((a, b) =>
    a.email.localeCompare(b.email),
  );
}

function formatDateTime(value: number | string | Date) {
  return adminDateTimeFormatter.format(new Date(value));
}
