import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "file:./test.db",
      APP_ENCRYPTION_KEY: "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdDE=",
      PII_HASH_SALT: "test-salt",
      SYNC_BACKGROUND: "off",
    },
    // Integration tests share one SQLite file.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
