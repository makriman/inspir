"use client";

import { useEffect, useReducer, useSyncExternalStore } from "react";

type GameInstallSupportProps = Readonly<{
  gameName: string;
  slug: "tic-tac-toe" | "connect-four" | "chess";
}>;

type WorkerStatus = "checking" | "ready" | "unavailable";

function workerStatusReducer(_current: WorkerStatus, next: WorkerStatus): WorkerStatus {
  return next;
}

export function GameInstallSupport({ gameName, slug }: GameInstallSupportProps) {
  const [workerStatus, setWorkerStatus] = useReducer(workerStatusReducer, "checking");
  const standalone = useSyncExternalStore(
    subscribeToStandaloneMode,
    standaloneModeSnapshot,
    serverStandaloneModeSnapshot,
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      const timer = window.setTimeout(() => setWorkerStatus("unavailable"), 0);
      return () => window.clearTimeout(timer);
    }

    let active = true;
    void navigator.serviceWorker
      .register(`/games/${slug}-sw.js`, {
        scope: `/games/${slug}`,
        updateViaCache: "none",
      })
      .then(() => {
        if (active) setWorkerStatus("ready");
      })
      .catch(() => {
        if (active) setWorkerStatus("unavailable");
      });

    return () => {
      active = false;
    };
  }, [slug]);

  if (standalone) {
    return (
      <p className="game-installed-badge" data-testid="install-support">
        <span aria-hidden="true">✓</span> Installed mini-app
      </p>
    );
  }

  return (
    <details className="game-install" data-testid="install-support">
      <summary>Install {gameName}</summary>
      <div>
        <p>
          Use your browser’s <strong>Install app</strong> or <strong>Add to Home Screen</strong> command.
          This game has its own name, launch URL, and app scope.
        </p>
        <p>
          <output className="game-install-status" aria-live="polite">
            {workerStatus === "ready"
              ? "Install support is ready."
              : workerStatus === "unavailable"
                ? "You can still install from a supported browser over HTTPS."
                : "Checking install support…"}
          </output>
        </p>
      </div>
    </details>
  );
}

function subscribeToStandaloneMode(onStoreChange: () => void) {
  const query = window.matchMedia("(display-mode: standalone)");
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function standaloneModeSnapshot() {
  return window.matchMedia("(display-mode: standalone)").matches;
}

function serverStandaloneModeSnapshot() {
  return false;
}
