import { defineConfig } from '@playwright/test';

// Browser/component evidence uses the producer fixtures, not an integrated API acceptance gate.
export default defineConfig({
  testDir:'./tests/simulation-browser', outputDir:'test-results/simulation-inspection',
  timeout:60000, workers:1, fullyParallel:false,
  use:{baseURL:'http://127.0.0.1:3114',screenshot:'only-on-failure',trace:'retain-on-failure',
    launchOptions: process.env.OPERATIONS_BROWSER_EXECUTABLE ? {executablePath:process.env.OPERATIONS_BROWSER_EXECUTABLE} : {}},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'narrow',use:{viewport:{width:390,height:844}}}],
  webServer:{command:'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3114',url:'http://127.0.0.1:3114/login',timeout:120000,
    env:{NEXT_PUBLIC_API_BASE_URL:'http://127.0.0.1:5199',NEXT_PUBLIC_SKIP_AUTH:'false',CNC_BUILD_DIR:'.next-simulation-inspection'}},
});
