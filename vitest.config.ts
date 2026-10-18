import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    env: {
      GOOGLE_CALENDAR_MODE: "mock",
      // These tests exercise the in-memory demo store directly (resetStore(), getStore()).
      // Force demo mode regardless of an ambient DATABASE_URL in the shell environment.
      DATABASE_URL: "",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
