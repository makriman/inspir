import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8787";

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
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        }
      : undefined,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
