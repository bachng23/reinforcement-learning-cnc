import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/situations-browser',outputDir:'test-results/situations',timeout:60000,workers:1,
  use:{baseURL:'http://127.0.0.1:3116',trace:'retain-on-failure',screenshot:'only-on-failure',
    launchOptions:process.env.OPERATIONS_BROWSER_EXECUTABLE?{executablePath:process.env.OPERATIONS_BROWSER_EXECUTABLE}:{}},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
  webServer:{command:'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3116',url:'http://127.0.0.1:3116/login',timeout:120000,
    env:{NEXT_PUBLIC_API_BASE_URL:'http://127.0.0.1:5197',NEXT_PUBLIC_SKIP_AUTH:'false',CNC_BUILD_DIR:'.next-situations-component'}},
});
