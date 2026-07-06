import { headers } from "next/headers";
import { createAuth } from "./better-auth";

type AuthenticatedSession = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
};

export async function requireSession(options: { refresh?: boolean } = {}) {
  const session = await createAuth().api.getSession({
    headers: await headers(),
    query: {
      disableRefresh: options.refresh === false,
    },
  });
  if (!session?.user?.id) return null;
  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    },
    session: session.session,
  } satisfies AuthenticatedSession;
}
