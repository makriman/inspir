import { db } from "@/lib/db/client";
import { opsEvents, productEvents } from "@/lib/db/schema";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type EventProperties = Record<string, JsonValue>;

export async function recordOpsEvent(input: {
  eventName: string;
  severity?: "info" | "warning" | "critical";
  surface?: string | null;
  userId?: string | null;
  message?: string | null;
  metadata?: EventProperties;
}) {
  try {
    await db.insert(opsEvents).values({
      eventName: input.eventName,
      severity: input.severity ?? "info",
      surface: input.surface ?? null,
      userId: input.userId ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.warn("ops_event_record_failed", {
      eventName: input.eventName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function recordProductEvent(input: {
  name: string;
  userId?: string | null;
  userEmailSnapshot?: string | null;
  route?: string | null;
  sessionId?: string | null;
  userAgentHash?: string | null;
  properties?: EventProperties;
}) {
  try {
    await db.insert(productEvents).values({
      name: input.name,
      userId: input.userId ?? null,
      userEmailSnapshot: input.userEmailSnapshot ?? null,
      route: input.route ?? null,
      sessionId: input.sessionId ?? null,
      userAgentHash: input.userAgentHash ?? null,
      properties: input.properties ?? {},
    });
  } catch (error) {
    console.warn("product_event_record_failed", {
      name: input.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
