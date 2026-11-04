import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/simulation-browser', outputDir: './test-results/live-factory-component', timeout: 60000, workers: 1, fullyParallel: false,
  use: {baseURL: 'http://127.0.0.1:3112', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'on',
    ...(process.env.OPERATIONS_BROWSER_EXECUTABLE ? {launchOptions: {executablePath: process.env.OPERATIONS_BROWSER_EXECUTABLE}} : {})},
  projects: [
    {name: 'desktop-1440', use: {viewport: {width: 1440, height: 900}}},
    {name: 'desktop-1920', use: {viewport: {width: 1920, height: 1080}}},
  ],
  webServer: {command: 'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3112', url: 'http://127.0.0.1:3112/login', timeout: 120000,
    env: {NEXT_PUBLIC_API_BASE_URL: '', API_PROXY_URL: '', NEXT_PUBLIC_SKIP_AUTH: 'false', NEXT_PUBLIC_RESEARCH_ENABLED: 'true', CNC_BUILD_DIR: '.next-simulation-browser'}},
});
