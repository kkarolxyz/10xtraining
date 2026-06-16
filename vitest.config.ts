import path from "path";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: [
      "tests/lib/**/*.test.ts",
      "tests/api/**/*.test.ts",
      "tests/smoke/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve("./src"),
    },
  },
});
