import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./games/games.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://inspirlearning.com"),
  title: {
    default: "Game Arena | inspir",
    template: "%s | inspir Game Arena",
  },
  description: "Small, deterministic strategy games with inspectable rules and complete results.",
  applicationName: "inspir Game Arena",
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/inspir-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/inspir-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/inspir-app-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#090d18",
  colorScheme: "dark",
};

export default async function GamesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Strict nonce-based CSP requires request-time rendering so Next can attach
  // the middleware nonce to its framework, page, and inline bootstrap scripts.
  await connection();

  return (
    <html lang="en" className="games-document">
      <body className="games-body">
        <div className="games-app">{children}</div>
      </body>
    </html>
  );
}
