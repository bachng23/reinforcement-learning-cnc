import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.OPERATIONS_BROWSER_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.OPERATIONS_BROWSER_EXECUTABLE } }
      : {}),
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/login",
    timeout: 120_000,
    env: { NEXT_PUBLIC_OPERATIONS_API_MODE: "real", NEXT_PUBLIC_API_BASE_URL: "", NEXT_PUBLIC_OPERATIONS_FACTORY_ID: "factory-demo-01" },
  },
});
