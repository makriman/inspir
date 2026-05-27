import Link from "next/link";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { SignInButton } from "@/components/marketing/SignInButton";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col bg-black px-6 text-white">
      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center pb-10 pt-12 text-center">
        <InspirLogo className="mb-16 h-32 w-auto object-contain" />
        <h1 className="max-w-4xl text-[clamp(2.4rem,5vw,4.7rem)] font-black leading-[1.04] tracking-normal">
          Revolutionize Your Learning Journey with Artificial intelligence
        </h1>
        <div className="mt-12 w-full">
          <SignInButton />
        </div>
      </section>
      <footer className="mx-auto flex w-full max-w-5xl flex-col items-center gap-5 pb-8 text-sm font-bold text-white/90">
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link href="/tnc" className="hover:text-white">
            Terms and Conditions
          </Link>
          <Link href="/privacy" className="hover:text-white">
            Privacy Policy
          </Link>
          <Link href="/mission" className="hover:text-white">
            Mission
          </Link>
        </nav>
        <SocialLinks />
      </footer>
    </main>
  );
}
