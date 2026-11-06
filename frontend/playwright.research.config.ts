import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/research-browser', timeout: 60000, workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3108', viewport: {width:1440,height:1000}, screenshot:'only-on-failure', trace:'retain-on-failure',
    ...(process.env.OPERATIONS_BROWSER_EXECUTABLE ? {launchOptions:{executablePath:process.env.OPERATIONS_BROWSER_EXECUTABLE}} : {}) },
  webServer: [
    {command:'node ../scripts/serve-jcst-e2e.js',url:'http://127.0.0.1:5108/api/health',timeout:120000},
    {command:'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3108',url:'http://127.0.0.1:3108/login',timeout:120000,
      env:{NEXT_PUBLIC_API_BASE_URL:'http://127.0.0.1:5108',NEXT_PUBLIC_RESEARCH_ENABLED:'true',NEXT_PUBLIC_SKIP_AUTH:'false',CNC_BUILD_DIR:'.next-research-e2e'}},
  ],
});
