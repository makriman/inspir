"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { googleAnalyticsId } from "@/components/analytics/AnalyticsScripts";
import { trackProductEvent, type ProductEventProperties } from "@/components/analytics/trackProductEvent";

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
