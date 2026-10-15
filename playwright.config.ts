import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "4173");
const basePath = process.env.PLAYWRIGHT_BASE_PATH ?? "/";
const runName = basePath === "/" ? "root" : "subpath";
const buildDir = process.env.PLAYWRIGHT_BUILD_DIR ?? `dist-e2e-${runName}`;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${String(port)}${basePath}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: `./test-results/${runName}`,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: [["list"], ["html", { open: "never", outputFolder: `./playwright-report/${runName}` }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [{
    name: "smoke",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  }],
  webServer: process.env.PLAYWRIGHT_SKIP_SERVER === "1" ? undefined : {
    command: `npx vite build --base=${basePath} --outDir=${buildDir} && npx vite preview --base=${basePath} --outDir=${buildDir} --host 127.0.0.1 --port ${String(port)} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
