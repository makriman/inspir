"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const LOCAL_RESULT_PREFIX = "local-";
const LOCAL_RESULT_STORAGE_PREFIX = "inspir:games:result:v1:";
const SAVE_TIMEOUT_MS = 2_500;

export type GameResultSource = "cloud" | "local";

export type LoadedGameResult = Readonly<{
  id: string;
  state: unknown;
  startedAt: string | null;
  completedAt: string;
  durationMs: number | null;
  source: GameResultSource;
  opponent: Readonly<{
    kind: "deterministic-engine";
    engine: Readonly<{ id: string; version: string }>;
  }> | null;
}>;

type LocalGameResult = Readonly<{
  schemaVersion: 1;
  id: string;
  state: unknown;
  startedAt: string;
  completedAt: string;
}>;

export type CompletionNavigationState = "idle" | "saving" | "local" | "failed";

export type CompletionNavigation = Readonly<{
  status: CompletionNavigationState;
  retry: () => void;
  exportResult: () => void;
}>;

export function useCompletedGameNavigation(input: Readonly<{
  slug: "tic-tac-toe" | "connect-four" | "chess";
  state: unknown;
  startedAt: string;
  complete: boolean;
}>): CompletionNavigation {
  const [navigationState, setNavigationState] = useState<CompletionNavigationState>("idle");
  const [attempt, setAttempt] = useState(0);
  const persistedStartedAt = useRef<string | null>(null);

  useEffect(() => {
    if (!input.complete || persistedStartedAt.current === input.startedAt) return;
    persistedStartedAt.current = input.startedAt;
    setNavigationState("saving");

    let active = true;
    void persistCompletedGame(input.state, input.startedAt).then((saved) => {
      if (!active) return;
      if (!saved) {
        setNavigationState("failed");
        return;
      }
      const { id, source } = saved;
      if (source === "local") setNavigationState("local");
      window.location.assign(`/games/${input.slug}/results/${encodeURIComponent(id)}`);
    });

    return () => {
      active = false;
    };
  }, [attempt, input.complete, input.slug, input.startedAt, input.state]);

  const retry = useCallback(() => {
    persistedStartedAt.current = null;
    setNavigationState("idle");
    setAttempt((current) => current + 1);
  }, []);

  const exportResult = useCallback(() => {
    try {
      const serialized = JSON.stringify(
        {
          schemaVersion: 1,
          gameSlug: input.slug,
          state: input.state,
          startedAt: input.startedAt,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      );
      const url = URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `inspir-${input.slug}-result.json`;
      // `@cloudflare/workers-types` intentionally declares its HTMLRewriter
      // `Element.append` globally, so use the DOM-only Node API here.
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setNavigationState("failed");
    }
  }, [input.slug, input.startedAt, input.state]);

  return { status: input.complete ? navigationState : "idle", retry, exportResult };
}

export async function loadCompletedGame(resultId: string): Promise<LoadedGameResult | null> {
  if (!resultId.startsWith(LOCAL_RESULT_PREFIX)) {
    const cloudResult = await loadCloudResult(resultId);
    if (cloudResult) return cloudResult;
  }
  return loadLocalResult(resultId);
}

export function resultIdFromCreateResponse(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.result)) return null;
  return validResultId(value.result.id);
}

async function persistCompletedGame(
  state: unknown,
  startedAt: string,
): Promise<Readonly<{ id: string; source: GameResultSource }> | null> {
  const localId = `${LOCAL_RESULT_PREFIX}${crypto.randomUUID()}`;
  const completedAt = new Date().toISOString();
  const localResult: LocalGameResult = {
    schemaVersion: 1,
    id: localId,
    state,
    startedAt,
    completedAt,
  };
  const localSaved = saveLocalResult(localResult);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
  try {
    const response = await fetch("/api/games/results", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, startedAt }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return localSaved ? { id: localId, source: "local" } : null;
    const body: unknown = await response.json();
    const remoteId = resultIdFromCreateResponse(body);
    if (!remoteId) return localSaved ? { id: localId, source: "local" } : null;

    saveLocalResult({ ...localResult, id: remoteId });
    return { id: remoteId, source: "cloud" };
  } catch {
    return localSaved ? { id: localId, source: "local" } : null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadCloudResult(resultId: string): Promise<LoadedGameResult | null> {
  try {
    const response = await fetch(`/api/games/results/${encodeURIComponent(resultId)}`, {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.result)) return null;

    const result = body.result;
    const id = validResultId(result.id);
    const completedAt = validIsoDate(result.completedAt);
    if (!id || !("state" in result) || !completedAt) return null;

    return {
      id,
      state: result.state,
      startedAt: result.startedAt === null ? null : validIsoDate(result.startedAt),
      completedAt,
      durationMs:
        typeof result.durationMs === "number" && Number.isFinite(result.durationMs)
          ? Math.max(0, result.durationMs)
          : null,
      source: "cloud",
      opponent: parseOpponent(result.opponent),
    };
  } catch {
    return null;
  }
}

function loadLocalResult(resultId: string): LoadedGameResult | null {
  try {
    const serialized = localStorage.getItem(localStorageKey(resultId));
    if (!serialized) return null;
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.schemaVersion !== 1 || !("state" in value)) return null;

    const id = validResultId(value.id);
    const startedAt = validIsoDate(value.startedAt);
    const completedAt = validIsoDate(value.completedAt);
    if (!id || !startedAt || !completedAt) return null;

    return {
      id,
      state: value.state,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      source: "local",
      opponent: null,
    };
  } catch {
    return null;
  }
}

function saveLocalResult(result: LocalGameResult) {
  try {
    localStorage.setItem(localStorageKey(result.id), JSON.stringify(result));
    return true;
  } catch {
    // Storage can be unavailable in private contexts. The remote attempt still runs.
    return false;
  }
}

function localStorageKey(resultId: string) {
  return `${LOCAL_RESULT_STORAGE_PREFIX}${resultId}`;
}

function validResultId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^gr_[a-f0-9]{32}$/.test(value) || /^local-[0-9a-f-]{36}$/.test(value)) return value;
  return null;
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function parseOpponent(value: unknown): LoadedGameResult["opponent"] {
  if (!isRecord(value) || value.kind !== "deterministic-engine" || !isRecord(value.engine)) {
    return null;
  }
  const id = value.engine.id;
  const version = value.engine.version;
  if (typeof id !== "string" || typeof version !== "string") return null;
  return { kind: "deterministic-engine", engine: { id, version } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
