import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";

const bootstrapAdminEmails = ["makridroid@gmail.com"] as const;

function getConfiguredAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .flatMap((email) => {
      const normalized = normalizeAdminEmail(email);
      return normalized ? [normalized] : [];
    });
}

export function getBootstrapAdminEmails() {
  return [...new Set([...bootstrapAdminEmails, ...getConfiguredAdminEmails()])];
}

export function isAdminEmail(email: string | null | undefined) {
  const normalized = normalizeAdminEmail(email);
  if (!normalized) return false;
  return getBootstrapAdminEmails().includes(normalized);
}

export async function isAdminEmailAsync(email: string | null | undefined) {
  const normalized = normalizeAdminEmail(email);
  if (!normalized) return false;
  if (isAdminEmail(normalized)) return true;

  const [admin] = await db
    .select({ email: adminUsers.email })
    .from(adminUsers)
    .where(eq(adminUsers.email, normalized))
    .limit(1);
  return Boolean(admin);
}

export function normalizeAdminEmail(email: unknown) {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  return normalized && normalized.includes("@") ? normalized : null;
}
