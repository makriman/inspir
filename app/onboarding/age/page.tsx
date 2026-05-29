import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { AgeOnboardingForm } from "@/components/onboarding/AgeOnboardingForm";
import { authOptions } from "@/lib/auth/config";
import { getUserById } from "@/lib/db/queries";
import { getCachedMainAppTranslationBundle } from "@/lib/i18n/main-app-translations";
import { getEnglishMainAppTranslationBundle } from "@/lib/i18n/main-app-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set up your learning profile",
  robots: { index: false, follow: false },
};

type AgeOnboardingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AgeOnboardingPage({ searchParams }: AgeOnboardingPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/");

  const params = await searchParams;
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next;
  const nextUrl = safeNextUrl(nextParam);
  const user = await getUserById(session.user.id);
  if (user?.dateOfBirth) redirect(nextUrl);

  const translationBundle =
    (await getCachedMainAppTranslationBundle(user?.preferredLanguage ?? "English")) ??
    getEnglishMainAppTranslationBundle();

  return <AgeOnboardingForm nextUrl={nextUrl} translationBundle={translationBundle} />;
}

function safeNextUrl(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/chat";
  if (value.startsWith("/api/") || value.startsWith("/onboarding/age")) return "/chat";
  return value;
}
