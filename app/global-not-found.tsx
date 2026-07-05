import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Page not found | inspir",
  description: "The page is not available. Start a fresh learning chat or return home.",
};

export default function GlobalNotFound() {
  return (
    <html lang="en-US" dir="ltr" className={cn("h-full antialiased", "font-sans", geist.variable)}>
      <body className="min-h-full bg-[#171614] text-white">
        <main className="inspir-chat-status" aria-labelledby="not-found-title">
          <div>
            <span>404</span>
            <h1 id="not-found-title">Page not found</h1>
            <p>The page is not available. Start a fresh learning chat or return home.</p>
            <div className="inspir-status-actions">
              <Link href="/chat/learn-anything">Start learning</Link>
              <Link href="/">Home</Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
