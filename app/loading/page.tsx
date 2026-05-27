import Link from "next/link";
import { InspirWordmark } from "@/components/brand/InspirLogo";

export default function LoadingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-white">
      <div className="relative grid h-44 w-44 place-items-center">
        <div className="absolute inset-0 animate-spin rounded-full border-[10px] border-white/10 border-t-[#0500d8]" />
        <div className="grid h-28 w-28 place-items-center rounded-full bg-[#e05055]">
          <InspirWordmark className="text-2xl" />
        </div>
      </div>
      <footer className="absolute bottom-8 flex flex-wrap items-center justify-center gap-3 text-sm font-bold text-white/85">
        <Link href="/tnc">Terms</Link>
        <span>|</span>
        <Link href="/privacy">Privacy</Link>
        <span>|</span>
        <Link href="/mission">Mission</Link>
      </footer>
    </main>
  );
}
