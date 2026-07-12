export const NATIVE_ADMIN_TOTALS_KEY = "native-admin-totals-v1";
export const DISPOSABLE_VALIDATION_EMAIL_SUFFIX = "@inspirlearning.invalid";

export const REFRESH_NATIVE_ADMIN_TOTALS_SQL = `insert into app_metadata ("key", value, updated_at)
select ?1,
       json_object(
         'users', (
           select count(*) from users as counted_users
           where lower(counted_users.email) not like '%' || ?3
         ),
         'chats', (
           select count(*) from chats as counted_chats
           where not exists (
             select 1 from users as validation_users
             where validation_users.id = counted_chats.user_id
               and lower(validation_users.email) like '%' || ?3
           )
         ),
         'messages', (
           select count(*) from messages as counted_messages
           where not exists (
             select 1 from chats as validation_chats
             join users as validation_users on validation_users.id = validation_chats.user_id
             where validation_chats.id = counted_messages.chat_id
               and lower(validation_users.email) like '%' || ?3
           )
         ),
         'aiRuns', (
           select count(*) from ai_runs as counted_ai_runs
           where not exists (
             select 1 from chats as validation_chats
             join users as validation_users on validation_users.id = validation_chats.user_id
             where validation_chats.id = counted_ai_runs.chat_id
               and lower(validation_users.email) like '%' || ?3
           )
         )
       ),
       ?2
on conflict ("key") do update set
  value = excluded.value,
  updated_at = excluded.updated_at`;

export type NativeAdminDurableTotals = {
  users: number;
  chats: number;
  messages: number;
  aiRuns: number;
  updatedAt: number;
};

export async function refreshNativeAdminTotals(db: D1Database, now = Date.now()) {
  const result = await db
    .prepare(REFRESH_NATIVE_ADMIN_TOTALS_SQL)
    .bind(NATIVE_ADMIN_TOTALS_KEY, now, DISPOSABLE_VALIDATION_EMAIL_SUFFIX)
    .run();
  return { changed: result.meta.changes, updatedAt: now };
}

export async function readNativeAdminTotals(db: D1Database) {
  const row = await db
    .prepare(
      `select substr(value, 1, 1001) as value, updated_at as updatedAt
       from app_metadata where "key" = ?1 limit 1`,
    )
    .bind(NATIVE_ADMIN_TOTALS_KEY)
    .first<Record<string, unknown>>();
  return parseNativeAdminTotalsRow(row);
}

export function parseNativeAdminTotalsRow(row: unknown) {
  if (!isRecord(row) || typeof row.value !== "string" || !isNonNegativeInteger(row.updatedAt)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const users = nonNegativeInteger(parsed.users);
  const chats = nonNegativeInteger(parsed.chats);
  const messages = nonNegativeInteger(parsed.messages);
  const aiRuns = nonNegativeInteger(parsed.aiRuns);
  if (users === null || chats === null || messages === null || aiRuns === null) return null;
  return { users, chats, messages, aiRuns, updatedAt: row.updatedAt } satisfies NativeAdminDurableTotals;
}

function nonNegativeInteger(value: unknown) {
  return isNonNegativeInteger(value) ? value : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
