import { defineConfig } from "drizzle-kit";

const remoteD1Command = /\b(?:migrate|push|pull|studio|introspect)\b/.test(process.argv.join(" "));

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle-d1",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: d1Env("CLOUDFLARE_ACCOUNT_ID"),
    databaseId: d1Env("CLOUDFLARE_D1_DATABASE_ID"),
    token: d1Env("CLOUDFLARE_API_TOKEN"),
  },
});

function d1Env(name: string) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (!remoteD1Command) return "";
  throw new Error(`${name} is required for remote D1 Drizzle commands. Do not rely on production fallbacks.`);
}
