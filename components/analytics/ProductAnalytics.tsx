"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { googleAnalyticsId } from "@/components/analytics/AnalyticsScripts";

type ProductEventProperties = Record<string, string | number | boolean | null>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
    inspirTrack?: (name: string, properties?: ProductEventProperties) => void;
  }
}

const authErrorCodes = new Set(["account_not_linked", "unable_to_link_account"]);

export function ProductAnalytics() {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  useEffect(() => {
    window.inspirTrack = trackProductEvent;
    return () => {
      if (window.inspirTrack === trackProductEvent) delete window.inspirTrack;
    };
  }, []);

  useEffect(() => {
    trackProductEvent("page_view", {
      route: pathname,
      auth_error: error && authErrorCodes.has(error) ? error : null,
    });
    window.gtag?.("event", "page_view", {
      send_to: googleAnalyticsId,
      page_path: pathname,
      page_location: window.location.href,
    });
    if (error && authErrorCodes.has(error)) {
      trackProductEvent("auth_error_seen", { error, route: pathname });
    }
    if (pathname.startsWith("/admin")) {
      trackProductEvent("admin_opened", { route: pathname });
    }
  }, [error, pathname]);

  return null;
}

export function trackProductEvent(name: string, properties: ProductEventProperties = {}) {
  const route = typeof window === "undefined" ? "/" : window.location.pathname;
  const payload = JSON.stringify({
    name,
    route,
    sessionId: readAnalyticsSessionId(),
    properties,
  });
  const url = "/api/analytics/events";

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const sent = navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    if (sent) return;
  }

  void fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

function readAnalyticsSessionId() {
  const storageKey = "inspir_analytics_session_id";
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return undefined;
  }
}
