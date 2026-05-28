import { ImageResponse } from "next/og";
import { siteName } from "@/lib/seo/config";

export const runtime = "edge";

function cleanText(value: string | null, fallback: string, maxLength: number) {
  const text = (value ?? fallback).replace(/\s+/g, " ").trim() || fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = cleanText(searchParams.get("title"), "Free AI learning for everyone", 92);
  const eyebrow = cleanText(searchParams.get("eyebrow"), siteName, 36);
  const description = cleanText(
    searchParams.get("description"),
    "A free public AI learning companion for tutoring, practice, quizzes, flashcards, debate, writing, code, and study planning.",
    132,
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#fffdf8",
          color: "#1f1d1b",
          fontFamily: "Arial",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -220,
            right: -110,
            width: 520,
            height: 520,
            borderRadius: 260,
            background: "#ff385c",
            opacity: 0.16,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -150,
            left: -90,
            width: 440,
            height: 440,
            borderRadius: 220,
            background: "#ffd84d",
            opacity: 0.34,
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            padding: "74px 84px 64px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: 54, fontWeight: 900 }}>
              inspir
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: "#1f1d1b",
                  marginLeft: 6,
                  marginBottom: 48,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                border: "2px solid rgba(31,29,27,0.16)",
                borderRadius: 999,
                padding: "12px 20px",
                color: "#ff385c",
                fontSize: 20,
                fontWeight: 900,
                textTransform: "uppercase",
              }}
            >
              {eyebrow}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 930 }}>
            <div
              style={{
                display: "flex",
                fontSize: 78,
                fontWeight: 900,
                lineHeight: 0.96,
                letterSpacing: -2,
              }}
            >
              {title}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 26,
                maxWidth: 850,
                color: "rgba(31,29,27,0.68)",
                fontSize: 30,
                fontWeight: 700,
                lineHeight: 1.22,
              }}
            >
              {description}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, fontWeight: 900 }}>
            <div style={{ width: 42, height: 6, borderRadius: 999, background: "#ff385c" }} />
            Live guest learning mode at inspirlearning.com
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    },
  );
}
