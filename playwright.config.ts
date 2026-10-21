import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    browserName: "chromium",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH ??
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${new URL(baseURL).port || "5173"}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
