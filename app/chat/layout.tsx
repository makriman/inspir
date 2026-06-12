import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Chat | inspir",
    template: "%s | inspir",
  },
  description: "Private inspir chat workspace.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  keywords: [],
  alternates: {},
  openGraph: {
    title: "Chat | inspir",
    description: "Private inspir chat workspace.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Chat | inspir",
    description: "Private inspir chat workspace.",
  },
  other: {},
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
