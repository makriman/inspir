import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8787";
const expectedWorkerVersion = process.env.EXPECTED_WORKER_VERSION?.trim();
const traceMode = process.env.PLAYWRIGHT_DISABLE_TRACE === "1" ? "off" : "retain-on-failure";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  webServer:
    process.env.PLAYWRIGHT_START_CF_PREVIEW === "1"
      ? {
          command: "pnpm cf:preview",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 180_000,
        }
      : undefined,
  use: {
    baseURL,
    trace: traceMode,
    extraHTTPHeaders: expectedWorkerVersion
      ? {
          "Cloudflare-Workers-Version-Overrides": `inspirlearning="${expectedWorkerVersion}"`,
        }
      : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
