import type { MetadataRoute } from "next";
import { siteDescription, siteName, siteUrl } from "@/lib/seo/config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${siteName} | Free AI learning for everyone`,
    short_name: siteName,
    description: siteDescription,
    id: "/",
    start_url: "/chat/learn-anything",
    scope: "/",
    display: "standalone",
    background_color: "#fffdf8",
    theme_color: "#171614",
    categories: ["education", "productivity"],
    lang: "en-US",
    orientation: "any",
    icons: [
      {
        src: "/inspir-app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/inspir-app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icon.png",
        sizes: "128x118",
        type: "image/png",
      },
    ],
    screenshots: [
      {
        src: "/inspir-social-preview.png",
        sizes: "1200x630",
        type: "image/png",
        form_factor: "wide",
        label: "inspir learning mission",
      },
    ],
    related_applications: [
      {
        platform: "webapp",
        url: siteUrl,
      },
    ],
  };
}
