import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode || "test", process.cwd(), "");
  // Ensure all env variables are injected into process.env
  Object.assign(process.env, env);

  return {
    test: {
      globals: true,
      environment: "node",
      include: ["tests/**/*.test.ts"],
      exclude: ["tests/smoke.test.ts", "node_modules/**"],
      // Run test files sequentially to avoid MongoDB collection collisions
      fileParallelism: false,
      testTimeout: 20000,
    },
  };
});
