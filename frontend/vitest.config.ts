import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      passWithNoTests: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      testTimeout: 15000,
    },
  }),
);
