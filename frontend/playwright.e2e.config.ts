import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const artifactRoot = process.env.OPERATIONS_E2E_RUN_ARTIFACT_DIR
  ? path.resolve(process.env.OPERATIONS_E2E_RUN_ARTIFACT_DIR)
  : path.resolve("../artifacts/operations-e2e/local/playwright");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: path.join(artifactRoot, "test-results"),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(artifactRoot, "html-report"), open: "never" }],
  ],
  use: {
    baseURL: process.env.OPERATIONS_E2E_WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
