import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Connect Four",
  description: "A focused, deterministic Connect Four mini-app with complete replayable results.",
  manifest: "/games/connect-four/manifest.webmanifest",
  alternates: { canonical: "/games/connect-four" },
  appleWebApp: { capable: true, title: "inspir Connect Four", statusBarStyle: "black-translucent" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = { themeColor: "#f59e0b", colorScheme: "dark" };

export default function ConnectFourLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
