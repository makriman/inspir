"use client";

export type ProductEventProperties = Record<string, string | number | boolean | null>;

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
