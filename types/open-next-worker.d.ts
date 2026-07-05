declare module "*/.open-next/worker.js" {
  export const DOQueueHandler: unknown;
  export const DOShardedTagCache: unknown;

  const handler: {
    fetch: (request: Request, env: CloudflareEnv, ctx: ExecutionContext) => Response | Promise<Response>;
  };

  export default handler;
}
