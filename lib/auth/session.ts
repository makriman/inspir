import { getServerSession } from "next-auth";
import { authOptions } from "./config";

type AuthenticatedSession = Awaited<ReturnType<typeof getServerSession>> & {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return session as AuthenticatedSession;
}
