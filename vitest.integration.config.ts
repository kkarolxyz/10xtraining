import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve("./src"),
    },
  },
});
