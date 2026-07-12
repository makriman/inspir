export type DashboardRow = Record<string, string | number | null>;

export type AdminDashboardPayload = {
  user: { email: string };
  admins: Array<{
    email: string;
    addedByEmail: string | null;
    createdAt: string;
    source: "bootstrap" | "database";
  }>;
  dashboard: {
    totals: {
      users: number;
      chats: number;
      messages: number;
      aiRuns: number;
      snapshotUpdatedAt: number;
      productEvents: number;
      opsEvents: number;
      responseCacheEntries: number;
    };
    aiDaily: DashboardRow[];
    quotaEvents: DashboardRow[];
    responseCacheDaily: DashboardRow[];
    responseCacheSummary: Record<string, number>;
    responseCacheTopics: DashboardRow[];
    llmUsage: DashboardRow[];
    productDaily: DashboardRow[];
    topRoutes: DashboardRow[];
    opsRecent: DashboardRow[];
  };
};

type AdminDashboardSnapshot =
  | { status: "loading"; payload: null; error: null }
  | { status: "ready"; payload: AdminDashboardPayload; error: null }
  | { status: "failed"; payload: null; error: string };

type AdminDashboardResource = {
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): AdminDashboardSnapshot;
  getServerSnapshot(): AdminDashboardSnapshot;
  reload(): void;
};

type AdminDashboardRequest = (signal: AbortSignal) => Promise<AdminDashboardPayload | null>;

const loadingDashboardSnapshot: AdminDashboardSnapshot = {
  status: "loading",
  payload: null,
  error: null,
};

export function createAdminDashboardResource(
  request: AdminDashboardRequest,
): AdminDashboardResource {
  let snapshot = loadingDashboardSnapshot;
  let requestSequence = 0;
  let activeRequest: { sequence: number; controller: AbortController } | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const startRequest = () => {
    activeRequest?.controller.abort();
    const controller = new AbortController();
    const sequence = ++requestSequence;
    activeRequest = { sequence, controller };
    if (snapshot.status !== "loading") {
      snapshot = loadingDashboardSnapshot;
      notify();
    }

    void runAdminDashboardRequest(request, controller.signal)
      .then((payload) => {
        if (!isCurrentRequest(activeRequest, sequence, controller.signal)) return;
        activeRequest = null;
        if (!payload) return;
        snapshot = { status: "ready", payload, error: null };
        notify();
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || !isCurrentRequest(activeRequest, sequence, controller.signal)) return;
        activeRequest = null;
        snapshot = {
          status: "failed",
          payload: null,
          error: reason instanceof Error ? reason.message : "The admin dashboard is unavailable.",
        };
        notify();
      });
  };

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      if (!activeRequest && snapshot.status === "loading") startRequest();
      return () => {
        listeners.delete(onStoreChange);
        queueMicrotask(() => {
          if (listeners.size > 0 || !activeRequest) return;
          activeRequest.controller.abort();
          activeRequest = null;
        });
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => loadingDashboardSnapshot,
    reload: startRequest,
  };
}

async function runAdminDashboardRequest(
  request: AdminDashboardRequest,
  signal: AbortSignal,
) {
  return request(signal);
}

function isCurrentRequest(
  activeRequest: { sequence: number; controller: AbortController } | null,
  sequence: number,
  signal: AbortSignal,
) {
  return !signal.aborted && activeRequest?.sequence === sequence;
}
