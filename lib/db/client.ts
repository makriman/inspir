import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/inspir_placeholder";

const globalForDb = globalThis as unknown as {
  inspirSql?: postgres.Sql;
};

export const sql =
  globalForDb.inspirSql ??
  postgres(connectionString, {
    max: Number(process.env.DATABASE_MAX_CONNECTIONS ?? 2),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.inspirSql = sql;
}

export const db = drizzle(sql, { schema });
