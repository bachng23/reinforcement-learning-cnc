import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "production-dss.spec.ts",
  projects: [1280, 1440, 1920, 2560].map(width => ({ name: `desktop-${width}`, use: { viewport: { width, height: width === 2560 ? 1440 : 1000 } } })),
});
