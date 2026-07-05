import { AsyncLocalStorage } from "node:async_hooks";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type RuntimeCloudflareEnv = Partial<CloudflareEnv>;

const runtimeEnvStore = new AsyncLocalStorage<RuntimeCloudflareEnv>();

export function runWithRuntimeCloudflareEnv<T>(env: RuntimeCloudflareEnv, callback: () => T | Promise<T>) {
  return runtimeEnvStore.run(env, callback);
}

export function getRuntimeCloudflareEnv() {
  return runtimeEnvStore.getStore();
}

export function readRuntimeEnv(name: string) {
  const value = (getRuntimeCloudflareEnv() as Record<string, unknown> | undefined)?.[name];
  if (typeof value === "string") return value.trim() || undefined;
  try {
    const cloudflareValue = (getCloudflareContext().env as unknown as Record<string, unknown>)[name];
    if (typeof cloudflareValue === "string") return cloudflareValue.trim() || undefined;
  } catch {
    // getCloudflareContext is only available while handling an OpenNext request.
  }
  return process.env[name]?.trim() || undefined;
}
