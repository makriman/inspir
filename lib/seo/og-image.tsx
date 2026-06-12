import { ImageResponse } from "next/og";

import { siteDescription, siteName, siteTitle } from "@/lib/seo/config";

const size = {
  width: 1200,
  height: 630,
};

function clean(value: string | null, fallback: string, maxLength: number) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, maxLength);
}

export function createOgImageResponse(request: Request) {
  const url = new URL(request.url);
  const title = clean(url.searchParams.get("title"), siteTitle, 120);
  const eyebrow = clean(url.searchParams.get("eyebrow"), "inspir learning", 64);
  const description = clean(url.searchParams.get("description"), siteDescription, 180);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #f8fff4 0%, #ffffff 46%, #eaf7f0 100%)",
          color: "#0f172a",
          padding: "68px",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
          border: "1px solid #dfe8dd",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <div
              style={{
                width: 70,
                height: 70,
                borderRadius: 18,
                background: "#1f7a3a",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 44,
                fontWeight: 900,
              }}
            >
              i
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 0 }}>{siteName}</div>
              <div style={{ fontSize: 22, color: "#3f5f47", letterSpacing: 0 }}>Free AI learning companion</div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              borderRadius: 999,
              padding: "14px 22px",
              background: "#ffd84d",
              color: "#17330f",
              fontSize: 22,
              fontWeight: 850,
            }}
          >
            {eyebrow}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26, width: "94%" }}>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 72 ? 66 : 76,
              fontWeight: 950,
              lineHeight: 1.02,
              letterSpacing: 0,
              color: "#07110b",
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              lineHeight: 1.28,
              color: "#2f3a35",
              maxWidth: 940,
              letterSpacing: 0,
            }}
          >
            {description}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            fontSize: 24,
            color: "#315a38",
            fontWeight: 800,
          }}
        >
          <div>Explanations, questions, quizzes, flashcards, and study plans</div>
          <div>inspirlearning.com</div>
        </div>
      </div>
    ),
    size,
  );
}
