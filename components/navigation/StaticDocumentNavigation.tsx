"use client";

import { useEffect } from "react";

export function StaticDocumentNavigation() {
  useEffect(() => {
    const navigateAsDocument = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const anchor = target instanceof Element ? target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.href === window.location.href) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(destination.href);
    };

    window.addEventListener("click", navigateAsDocument, true);
    return () => window.removeEventListener("click", navigateAsDocument, true);
  }, []);

  return null;
}
