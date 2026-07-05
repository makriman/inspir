import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle-d1",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "a1e5e542dc1d5fe5a5c6b2a10d755a81",
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID ?? "7cb2ddf7-ca3d-4f46-a022-cc8b3a25b7b9",
    token: process.env.CLOUDFLARE_API_TOKEN ?? "",
  },
});
