import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({ ...base, testMatch: "work-orders.spec.ts", outputDir: "test-results/work-orders-desktop", projects: [
  { name: "desktop-1440x900", use: { viewport: { width: 1440, height: 900 } } },
  { name: "desktop-1920x1080", use: { viewport: { width: 1920, height: 1080 } } },
  { name: "desktop-2560x1440", use: { viewport: { width: 2560, height: 1440 } } },
] });
