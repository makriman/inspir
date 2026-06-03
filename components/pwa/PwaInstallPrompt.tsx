"use client";

import Image from "next/image";
import { Download, EyeOff, Plus, Share, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

const DISMISSED_AT_KEY = "pwa_install_dismissed_at";
const NEVER_SHOW_KEY = "pwa_install_never_show";
const INSTALLED_AT_KEY = "pwa_install_installed_at";
const VISIT_COUNT_KEY = "pwa_install_visit_count";
const VISIT_COUNTED_SESSION_KEY = "pwa_install_visit_counted";
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MINIMUM_WAIT_MS = 30 * 1000;

type InstallMode = "native" | "ios";

type BeforeInstallPromptChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<BeforeInstallPromptChoice>;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

type SheetState = {
  isVisible: boolean;
  mode: InstallMode | null;
  showIosSteps: boolean;
};

const hiddenSheetState: SheetState = {
  isVisible: false,
  mode: null,
  showIosSteps: false,
};

function isStandaloneDisplayMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    Boolean((window.navigator as NavigatorWithStandalone).standalone)
  );
}

function isLikelyMobileOrTablet() {
  const userAgent = window.navigator.userAgent;
  const isAppleTablet = /Macintosh/i.test(userAgent) && window.navigator.maxTouchPoints > 1;
  const hasMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(userAgent) || isAppleTablet;
  const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const fitsTabletViewport = window.innerWidth <= 1366;

  return fitsTabletViewport && (hasCoarsePointer || hasMobileUserAgent);
}

function isIosSafari() {
  const userAgent = window.navigator.userAgent;
  const isIosDevice =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && window.navigator.maxTouchPoints > 1);
  const isWebKit = /WebKit/i.test(userAgent);
  const isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(userAgent);

  return isIosDevice && isWebKit && !isOtherIosBrowser;
}

function readTimestamp(key: string) {
  const value = window.localStorage.getItem(key);
  const timestamp = value ? Number(value) : Number.NaN;

  return Number.isFinite(timestamp) ? timestamp : null;
}

function wasDismissedRecently(now: number) {
  const dismissedAt = readTimestamp(DISMISSED_AT_KEY);

  return dismissedAt !== null && now - dismissedAt < FOURTEEN_DAYS_MS;
}

function registerVisit() {
  const storedVisits = Number(window.localStorage.getItem(VISIT_COUNT_KEY) ?? "0");
  const currentVisits = Number.isFinite(storedVisits) ? storedVisits : 0;

  if (window.sessionStorage.getItem(VISIT_COUNTED_SESSION_KEY) === "true") {
    return currentVisits;
  }

  const nextVisits = currentVisits + 1;
  window.localStorage.setItem(VISIT_COUNT_KEY, String(nextVisits));
  window.sessionStorage.setItem(VISIT_COUNTED_SESSION_KEY, "true");

  return nextVisits;
}

export function PwaInstallPrompt() {
  const [sheet, setSheet] = useState<SheetState>(hiddenSheetState);
  const canConsiderPromptRef = useRef(false);
  const hasMeaningfulInteractionRef = useRef(false);
  const hasWaitedLongEnoughRef = useRef(false);
  const isRepeatVisitRef = useRef(false);
  const installModeRef = useRef<InstallMode | null>(null);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const isVisibleRef = useRef(false);
  const dismissedForSessionRef = useRef(false);

  const markInstalled = useCallback(() => {
    const now = String(Date.now());

    window.localStorage.setItem(NEVER_SHOW_KEY, "true");
    window.localStorage.setItem(INSTALLED_AT_KEY, now);
    dismissedForSessionRef.current = true;
    canConsiderPromptRef.current = false;
    deferredPromptRef.current = null;
    isVisibleRef.current = false;
    setSheet(hiddenSheetState);
  }, []);

  const tryShowPrompt = useCallback(() => {
    if (
      dismissedForSessionRef.current ||
      isVisibleRef.current ||
      !canConsiderPromptRef.current ||
      !installModeRef.current ||
      !hasMeaningfulInteractionRef.current ||
      (!hasWaitedLongEnoughRef.current && !isRepeatVisitRef.current)
    ) {
      return;
    }

    if (isStandaloneDisplayMode()) {
      markInstalled();
      return;
    }

    isVisibleRef.current = true;
    setSheet({
      isVisible: true,
      mode: installModeRef.current,
      showIosSteps: false,
    });
  }, [markInstalled]);

  const markInstalledEvent = useEffectEvent(() => {
    markInstalled();
  });

  const tryShowPromptEvent = useEffectEvent(() => {
    tryShowPrompt();
  });

  const dismissForLater = useCallback(() => {
    window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    dismissedForSessionRef.current = true;
    isVisibleRef.current = false;
    setSheet((current) => ({ ...current, isVisible: false }));
  }, []);

  const dismissPermanently = useCallback(() => {
    window.localStorage.setItem(NEVER_SHOW_KEY, "true");
    dismissedForSessionRef.current = true;
    canConsiderPromptRef.current = false;
    isVisibleRef.current = false;
    setSheet(hiddenSheetState);
  }, []);

  useEffect(() => {
    let timeout: number | undefined;

    try {
      if (
        isStandaloneDisplayMode() ||
        window.localStorage.getItem(NEVER_SHOW_KEY) === "true" ||
        window.localStorage.getItem(INSTALLED_AT_KEY) ||
        !isLikelyMobileOrTablet() ||
        wasDismissedRecently(Date.now())
      ) {
        return;
      }

      const repeatVisit = registerVisit() >= 2;
      const shouldUseIosMode = isIosSafari();
      timeout = window.setTimeout(() => {
        canConsiderPromptRef.current = true;
        isRepeatVisitRef.current = repeatVisit;

        if (shouldUseIosMode) {
          installModeRef.current = "ios";
        }
        tryShowPromptEvent();
      }, 0);
    } catch {
      timeout = window.setTimeout(() => {
        canConsiderPromptRef.current = false;
      }, 0);
    }

    return () => {
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      if (!isLikelyMobileOrTablet()) {
        return;
      }

      event.preventDefault();

      try {
        if (
          isStandaloneDisplayMode() ||
          window.localStorage.getItem(NEVER_SHOW_KEY) === "true" ||
          window.localStorage.getItem(INSTALLED_AT_KEY) ||
          wasDismissedRecently(Date.now())
        ) {
          return;
        }

        deferredPromptRef.current = event as BeforeInstallPromptEvent;
        installModeRef.current = "native";
        canConsiderPromptRef.current = true;
        tryShowPromptEvent();
      } catch {
        deferredPromptRef.current = null;
      }
    };

    const handleAppInstalled = () => {
      markInstalledEvent();
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const handleStandaloneChange = () => {
      if (isStandaloneDisplayMode()) {
        markInstalledEvent();
      }
    };

    standaloneQuery.addEventListener("change", handleStandaloneChange);

    return () => {
      standaloneQuery.removeEventListener("change", handleStandaloneChange);
    };
  }, []);

  useEffect(() => {
    const markInteraction = () => {
      hasMeaningfulInteractionRef.current = true;
      tryShowPromptEvent();
    };

    const markScrollInteraction = () => {
      if (Math.abs(window.scrollY) > 24) {
        markInteraction();
      }
    };

    window.addEventListener("pointerdown", markInteraction, { once: true, passive: true });
    window.addEventListener("keydown", markInteraction, { once: true });
    window.addEventListener("scroll", markScrollInteraction, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
      window.removeEventListener("scroll", markScrollInteraction);
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      hasWaitedLongEnoughRef.current = true;
      tryShowPromptEvent();
    }, MINIMUM_WAIT_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  const promptCopy =
    sheet.mode === "ios" && sheet.showIosSteps
      ? {
          headline: "Tiny Safari dance, then you're set",
          subtext: "Tap share, add it to your home screen, and inspir is one thumb away.",
        }
      : {
          headline: "Pocket your tutor",
          subtext: "One tap back to your learning flow, minus the browser tab maze.",
        };

  const handleInstallClick = useCallback(async () => {
    if (sheet.mode === "ios") {
      setSheet((current) => ({ ...current, showIosSteps: true }));
      return;
    }

    if (!deferredPromptRef.current) {
      dismissForLater();
      return;
    }

    const promptEvent = deferredPromptRef.current;
    deferredPromptRef.current = null;

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;

      if (choice.outcome === "accepted") {
        markInstalled();
      } else {
        dismissForLater();
      }
    } catch {
      dismissForLater();
    }
  }, [dismissForLater, markInstalled, sheet.mode]);

  if (!sheet.isVisible || !sheet.mode) {
    return null;
  }

  return (
    <section className="pwa-install-shell" aria-label="Install inspir app">
      <div className="pwa-install-card">
        <div className="pwa-install-content">
          <div className="pwa-install-icon" aria-hidden="true">
            <Image src="/inspir-app-icon.svg" alt="" width={64} height={64} unoptimized />
            <span>
              <Sparkles size={15} strokeWidth={2.7} />
            </span>
          </div>
          <div className="pwa-install-copy">
            <p className="pwa-install-eyebrow">Quick shortcut</p>
            <h2>{promptCopy.headline}</h2>
            <p>{promptCopy.subtext}</p>
          </div>
        </div>

        {sheet.mode === "ios" && sheet.showIosSteps ? (
          <ol className="pwa-install-steps" aria-label="iOS install steps">
            <li>
              <Share size={17} aria-hidden="true" />
              Tap Safari&apos;s share button.
            </li>
            <li>
              <Plus size={17} aria-hidden="true" />
              Choose Add to Home Screen.
            </li>
            <li>
              <Sparkles size={17} aria-hidden="true" />
              Tap Add. Done.
            </li>
          </ol>
        ) : null}

        <div className="pwa-install-actions">
          <button className="pwa-install-primary" type="button" onClick={() => void handleInstallClick()}>
            <Download size={18} aria-hidden="true" />
            Install App
          </button>
          <button className="pwa-install-secondary" type="button" onClick={dismissForLater}>
            <X size={17} aria-hidden="true" />
            Maybe Later
          </button>
          <button className="pwa-install-quiet" type="button" onClick={dismissPermanently}>
            <EyeOff size={17} aria-hidden="true" />
            Don&apos;t show again
          </button>
        </div>
      </div>
    </section>
  );
}
