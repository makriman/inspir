import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdminDashboardResource,
  type AdminDashboardPayload,
} from "../components/admin/admin-dashboard-resource";

test("admin dashboard resource aborts superseded requests and ignores stale results", async () => {
  const first = deferred<AdminDashboardPayload | null>();
  const second = deferred<AdminDashboardPayload | null>();
  const signals: AbortSignal[] = [];
  const requests = [first, second];
  const resource = createAdminDashboardResource((signal) => {
    signals.push(signal);
    const request = requests[signals.length - 1];
    if (!request) throw new Error("Unexpected admin dashboard request");
    return request.promise;
  });
  const unsubscribe = resource.subscribe(() => undefined);

  assert.equal(signals.length, 1);
  assert.equal(resource.getSnapshot().status, "loading");

  resource.reload();
  assert.equal(signals.length, 2);
  assert.equal(signals[0]?.aborted, true);

  second.resolve(payload("new@example.com"));
  await flushAsyncWork();
  const currentSnapshot = resource.getSnapshot();
  assert.equal(currentSnapshot.status, "ready");
  if (currentSnapshot.status === "ready") {
    assert.equal(currentSnapshot.payload.user.email, "new@example.com");
  }

  first.resolve(payload("stale@example.com"));
  await flushAsyncWork();
  const settledSnapshot = resource.getSnapshot();
  assert.equal(settledSnapshot.status, "ready");
  if (settledSnapshot.status === "ready") {
    assert.equal(settledSnapshot.payload.user.email, "new@example.com");
  }
  unsubscribe();
});

test("admin dashboard resource exposes failures, retries, and aborts after final unsubscribe", async () => {
  const first = deferred<AdminDashboardPayload | null>();
  const second = deferred<AdminDashboardPayload | null>();
  const signals: AbortSignal[] = [];
  const requests = [first, second];
  const resource = createAdminDashboardResource((signal) => {
    signals.push(signal);
    const request = requests[signals.length - 1];
    if (!request) throw new Error("Unexpected admin dashboard request");
    return request.promise;
  });
  const unsubscribe = resource.subscribe(() => undefined);

  first.reject(new Error("Admin data is temporarily unavailable."));
  await flushAsyncWork();
  const failedSnapshot = resource.getSnapshot();
  assert.equal(failedSnapshot.status, "failed");
  if (failedSnapshot.status === "failed") {
    assert.equal(failedSnapshot.error, "Admin data is temporarily unavailable.");
  }

  resource.reload();
  assert.equal(resource.getSnapshot().status, "loading");
  assert.equal(signals.length, 2);
  unsubscribe();
  await Promise.resolve();
  assert.equal(signals[1]?.aborted, true);
});

function payload(email: string): AdminDashboardPayload {
  return {
    user: { email },
    admins: [],
    dashboard: {
      totals: {
        users: 0,
        chats: 0,
        messages: 0,
        aiRuns: 0,
        snapshotUpdatedAt: 0,
        productEvents: 0,
        opsEvents: 0,
        responseCacheEntries: 0,
      },
      aiDaily: [],
      quotaEvents: [],
      responseCacheDaily: [],
      responseCacheSummary: {},
      responseCacheTopics: [],
      llmUsage: [],
      productDaily: [],
      topRoutes: [],
      opsRecent: [],
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred promise was not initialized");
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error("Deferred promise was not initialized");
  };
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
