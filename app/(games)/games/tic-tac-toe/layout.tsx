import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Tic-Tac-Toe",
  description: "A focused, deterministic Tic-Tac-Toe mini-app with complete replayable results.",
  manifest: "/games/tic-tac-toe/manifest.webmanifest",
  alternates: { canonical: "/games/tic-tac-toe" },
  appleWebApp: { capable: true, title: "inspir Tic-Tac-Toe", statusBarStyle: "black-translucent" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = { themeColor: "#8b5cf6", colorScheme: "dark" };

export default function TicTacToeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
