/** Dependency-free messages shared by the native and legacy Queue producers. */
export type MemoryVectorCleanupQueueMessage = {
  type: "memory.vector_cleanup.v1";
  enqueuedAt: string;
  reason: string;
};
