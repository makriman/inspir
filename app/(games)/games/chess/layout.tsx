import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Chess",
  description: "A focused, deterministic Chess mini-app with complete replayable results.",
  manifest: "/games/chess/manifest.webmanifest",
  alternates: { canonical: "/games/chess" },
  appleWebApp: { capable: true, title: "inspir Chess", statusBarStyle: "black-translucent" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = { themeColor: "#06b6d4", colorScheme: "dark" };

export default function ChessLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
