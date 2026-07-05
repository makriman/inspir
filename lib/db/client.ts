import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { getRuntimeCloudflareEnv } from "@/lib/runtime/cloudflare";
import * as schema from "./schema";

export type AppDb = DrizzleD1Database<typeof schema>;

export function getD1() {
  return getRuntimeCloudflareEnv()?.DB ?? getCloudflareContext().env.DB;
}

export function getVectorIndex() {
  return getRuntimeCloudflareEnv()?.MEMORY_VECTORIZE ?? getCloudflareContext().env.MEMORY_VECTORIZE;
}

export function getDb(): AppDb {
  return drizzle(getD1(), { schema });
}

export const db = new Proxy({} as AppDb, {
  get(_target, property, receiver) {
    const database = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(database, property, receiver);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export async function d1All<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]) {
  const result = await getD1()
    .prepare(query)
    .bind(...bindings)
    .all<T>();
  return result.results ?? [];
}

export async function d1First<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]) {
  return getD1()
    .prepare(query)
    .bind(...bindings)
    .first<T>();
}

export async function d1Run(query: string, ...bindings: unknown[]) {
  return getD1()
    .prepare(query)
    .bind(...bindings)
    .run();
}

type RetiredPostgresSqlTag = ((strings: TemplateStringsArray, ...values: unknown[]) => never) & {
  begin: () => never;
  end: (_options?: unknown) => never;
};

export const sql: RetiredPostgresSqlTag = Object.assign(
  () => {
    throw new Error("The Postgres sql tag has been retired. Use D1 helpers or Cloudflare migration scripts.");
  },
  {
    begin() {
      throw new Error("Postgres transactions are not available after the D1 migration.");
    },
    end() {
      throw new Error("Postgres connections are not available after the D1 migration.");
    },
  },
);
