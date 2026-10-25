import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the real app (React + Worker + local D1) in Chromium,
// at iPhone and laptop sizes. They share one local database, so they run one
// at a time and each test starts from an empty database.

const PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'iphone',
      use: {
        ...devices['iPhone 15'],
        // Chromium stands in for Safari here; real-device checks are manual.
        browserName: 'chromium',
      },
    },
    { name: 'laptop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `node e2e/prepare.mjs && vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
