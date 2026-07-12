"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { AdminTopicForm } from "@/components/admin/AdminTopicForm";
import { AdminUserManager } from "@/components/admin/AdminUserManager";
import {
  createAdminDashboardResource,
  type AdminDashboardPayload,
  type DashboardRow,
} from "@/components/admin/admin-dashboard-resource";

const dateTimeFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function AdminDashboard() {
  const [resource] = useState(() => createAdminDashboardResource(requestAdminDashboard));
  const snapshot = useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getServerSnapshot,
  );
  const payload = snapshot.status === "ready" ? snapshot.payload : null;
  const error = snapshot.status === "failed" ? snapshot.error : null;

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0c0d0d] px-5 text-white">
        <section className="max-w-lg rounded-xl border border-red-300/20 bg-red-500/10 p-6">
          <p className="text-xs font-black uppercase tracking-[0.08em] text-red-200">Admin unavailable</p>
          <h1 className="mt-2 text-2xl font-black">Could not load operations data</h1>
          <p className="mt-3 text-sm font-bold text-white/70">{error}</p>
          <button type="button" onClick={resource.reload} className="mt-5 rounded-lg bg-white px-4 py-2 font-black text-black">
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (!payload) {
    return <main className="min-h-screen bg-[#0c0d0d]" aria-busy="true" />;
  }

  const { dashboard } = payload;
  return (
    <main className="min-h-screen bg-[#0c0d0d] px-5 py-8 text-white">
      <div className="mx-auto grid max-w-7xl gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.08em] text-[#7deb8f]">Admin</p>
            <h1 className="mt-2 text-4xl font-black tracking-normal">Operations dashboard</h1>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.055] px-3 py-2 text-sm font-bold text-white/62">
            Signed in as <span className="text-white">{payload.user.email}</span>
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
              rows={dashboard.aiDaily.map((row) => cells(row, ["day", "runs", "completed", "failed", "tokens", "cachedPromptTokens"]))}
              empty="No AI runs recorded in this window."
            />
          </DashboardPanel>
          <DashboardPanel title="Quota posture" kicker="Denials and checks">
            <DataTable columns={["Event", "Count"]} rows={dashboard.quotaEvents.map((row) => cells(row, ["eventName", "count"]))} empty="No quota denials or limiter failures." />
          </DashboardPanel>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <DashboardPanel title="Response cache" kicker="Hits, misses, stored answers">
            <DataTable
              columns={["Day", "Hits", "Misses", "Stores", "Bypasses", "Rejected"]}
              rows={dashboard.responseCacheDaily.map((row) => cells(row, ["day", "hits", "misses", "stores", "bypasses", "rejected"]))}
              empty="No response-cache events recorded yet."
            />
          </DashboardPanel>
          <DashboardPanel title="Cache savings" kicker="Avoided provider work">
            <DataTable
              columns={["Metric", "Value"]}
              rows={[
                ["Active entries", dashboard.responseCacheSummary.activeEntries ?? 0],
                ["Stale entries", dashboard.responseCacheSummary.staleEntries ?? 0],
                ["Total hits", dashboard.responseCacheSummary.totalHits ?? 0],
                ["Saved prompt tokens", dashboard.responseCacheSummary.savedPromptTokens ?? 0],
                ["Saved completion tokens", dashboard.responseCacheSummary.savedCompletionTokens ?? 0],
                ["Saved total tokens", dashboard.responseCacheSummary.savedTotalTokens ?? 0],
              ]}
              empty="No cache savings recorded yet."
            />
          </DashboardPanel>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <DashboardPanel title="Cached topics" kicker="Top reusable public starters">
            <DataTable columns={["Topic", "Entries", "Hits", "Saved tokens"]} rows={dashboard.responseCacheTopics.map((row) => cells(row, ["topicSlug", "entries", "hits", "savedTotalTokens"]))} empty="No cached topics yet." />
          </DashboardPanel>
          <DashboardPanel title="LLM budget shards" kicker="Global daily call ledger">
            <DataTable columns={["Day", "Calls"]} rows={dashboard.llmUsage.map((row) => cells(row, ["day", "callCount"]))} empty="No global LLM budget usage recorded." />
          </DashboardPanel>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <DashboardPanel title="Product analytics" kicker="Daily app activity">
            <DataTable columns={["Day", "Events", "Known users"]} rows={dashboard.productDaily.map((row) => cells(row, ["day", "events", "users"]))} empty="No product events recorded yet." />
          </DashboardPanel>
          <DashboardPanel title="Top routes" kicker="Page views">
            <DataTable columns={["Route", "Views", "Known users"]} rows={dashboard.topRoutes.map((row) => cells(row, ["route", "views", "users"]))} empty="No route views recorded yet." />
          </DashboardPanel>
        </section>

        <DashboardPanel title="Recent ops events" kicker="Auth, quota, admin">
          <DataTable
            columns={["Time", "Severity", "Event", "Surface"]}
            rows={dashboard.opsRecent.map((row) => [formatDateCell(row.createdAt), cell(row, "severity"), cell(row, "eventName"), cell(row, "surface")])}
            empty="No recent ops events."
          />
        </DashboardPanel>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <AdminUserManager initialAdmins={payload.admins} />
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

async function requestAdminDashboard(signal: AbortSignal): Promise<AdminDashboardPayload | null> {
  const response = await fetch("/api/admin/dashboard", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    window.location.replace("/");
    return null;
  }
  if (!response.ok) throw new Error("The admin dashboard is unavailable.");
  const value: unknown = await response.json();
  const parsed = parseAdminDashboardPayload(value);
  if (!parsed) throw new Error("The admin dashboard returned an invalid response.");
  return parsed;
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.055] p-4">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-white/45">{label}</p>
      <strong className="mt-2 block text-3xl font-black">{value.toLocaleString()}</strong>
    </div>
  );
}

function DashboardPanel({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
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
          <tr>{columns.map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`} className="border-t border-white/10">
              {row.map((value, cellIndex) => <td key={`${rowIndex}-${cellIndex}`} className="px-3 py-3 font-bold text-white/75">{typeof value === "number" ? value.toLocaleString() : value}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cells(row: DashboardRow, keys: string[]) {
  return keys.map((key) => cell(row, key));
}

function cell(row: DashboardRow, key: string): string | number {
  return row[key] ?? "-";
}

function formatDateCell(value: string | number | null | undefined) {
  if (typeof value !== "string" && typeof value !== "number") return "-";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : dateTimeFormatter.format(date);
}

function parseAdminDashboardPayload(value: unknown): AdminDashboardPayload | null {
  if (!isRecord(value) || !isRecord(value.user) || typeof value.user.email !== "string") return null;
  if (!isRecord(value.dashboard) || !isRecord(value.dashboard.totals) || !Array.isArray(value.admins)) return null;
  const totals = value.dashboard.totals;
  const admins = value.admins.map(parseAdmin).filter((admin): admin is AdminDashboardPayload["admins"][number] => admin !== null);
  if (admins.length !== value.admins.length) return null;
  return {
    user: { email: value.user.email },
    admins,
    dashboard: {
      totals: {
        users: numberValue(totals.users),
        chats: numberValue(totals.chats),
        messages: numberValue(totals.messages),
        aiRuns: numberValue(totals.aiRuns),
        snapshotUpdatedAt: numberValue(totals.snapshotUpdatedAt),
        productEvents: numberValue(totals.productEvents),
        opsEvents: numberValue(totals.opsEvents),
        responseCacheEntries: numberValue(totals.responseCacheEntries),
      },
      aiDaily: rows(value.dashboard.aiDaily),
      quotaEvents: rows(value.dashboard.quotaEvents),
      responseCacheDaily: rows(value.dashboard.responseCacheDaily),
      responseCacheSummary: numericRecord(value.dashboard.responseCacheSummary),
      responseCacheTopics: rows(value.dashboard.responseCacheTopics),
      llmUsage: rows(value.dashboard.llmUsage),
      productDaily: rows(value.dashboard.productDaily),
      topRoutes: rows(value.dashboard.topRoutes),
      opsRecent: rows(value.dashboard.opsRecent),
    },
  };
}

function parseAdmin(value: unknown): AdminDashboardPayload["admins"][number] | null {
  if (!isRecord(value) || typeof value.email !== "string") return null;
  return {
    email: value.email,
    addedByEmail: typeof value.addedByEmail === "string" ? value.addedByEmail : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    source: value.source === "bootstrap" ? "bootstrap" : "database",
  };
}

function rows(value: unknown): DashboardRow[] {
  if (!Array.isArray(value)) return [];
  const result: DashboardRow[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const row: DashboardRow = {};
    for (const [key, item] of Object.entries(entry)) {
      if (typeof item === "string" || typeof item === "number" || item === null) row[key] = item;
    }
    result.push(row);
  }
  return result;
}

function numericRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) result[key] = numberValue(item);
  return result;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
