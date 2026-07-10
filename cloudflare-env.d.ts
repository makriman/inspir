/// <reference types="@cloudflare/workers-types" />

declare global {
  interface CloudflareEnv {
    ASSETS: Fetcher;
    DB: D1Database;
    MEMORY_VECTORIZE: VectorizeIndex;
    MEMORY_POST_TURN_QUEUE: Queue<import("./lib/ai/memory-queue").MemoryQueueMessage>;
    NEXT_CACHE_DO_QUEUE: DurableObjectNamespace<import("./cloudflare-worker").DOQueueHandler>;
    NEXT_INC_CACHE_R2_BUCKET: R2Bucket;
    PROFILE_IMAGES_R2_BUCKET: R2Bucket;
    WORKER_SELF_REFERENCE: Fetcher;
    APP_URL: string;
    AUTH_URL: string;
    BETTER_AUTH_URL: string;
    CLOUDFLARE_AI_GATEWAY_BASE_URL: string;
    CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS: string;
    OPENAI_MODEL: string;
    OPENAI_FAST_MODEL: string;
    OPENAI_REASONING_MODEL: string;
    OPENAI_STRUCTURED_MODEL: string;
    OPENAI_EMBEDDING_MODEL: string;
    RATE_LIMIT_USER_CHAT_DAILY: string;
    RATE_LIMIT_GUEST_SESSION_DAILY: string;
    RATE_LIMIT_GUEST_IP_DAILY: string;
    RATE_LIMIT_ACTIVITY_DAILY: string;
    RATE_LIMIT_MEMORY_DAILY: string;
    LLM_GLOBAL_DAILY_CALL_LIMIT: string;
    MEMORY_POST_TURN_SYNTHESIS_THRESHOLD: string;
    MEMORY_PROFILE_COMPILE_LIMIT: string;
    APP_WRITE_FREEZE: string;
    APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: string;
    OPENAI_API_KEY: string;
    CLOUDFLARE_AI_GATEWAY_TOKEN: string;
    AUTH_SECRET: string;
    AUTH_GOOGLE_ID: string;
    AUTH_GOOGLE_SECRET: string;
    ADMIN_EMAILS: string;
    CRON_SECRET: string;
  }
}

export {};
