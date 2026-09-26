import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the spec's critical flows: `npm run test:e2e`.
 * Builds the app, starts it in production mode on port 3200 against a throwaway
 * SQLite database (prisma/e2e.db, re-seeded each run) and drives it with Chromium.
 * MDM runs through the labelled demo adapter; no request is sent to MDM.
 * Set PW_CHROMIUM_PATH to use a preinstalled Chromium instead of `npx playwright install`.
 */
const PORT = 3200;
const env = {
  DATABASE_URL: "file:./e2e.db",
  // Throwaway values for the local test server only.
  APP_ENCRYPTION_KEY: "ZTJlLW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM=",
  PII_HASH_SALT: "e2e-only-pii-hash-salt-value",
  CRON_SECRET: "e2e-only-cron-secret-0123456789abcdef",
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx tsx e2e/prepare-db.ts && npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    // E2E_REUSE_SERVER=1 skips the rebuild while iterating on tests (the database is not re-seeded then).
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    env: { ...env, NODE_ENV: "production" },
    stdout: "ignore",
    stderr: "pipe",
  },
});
