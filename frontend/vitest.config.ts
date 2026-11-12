import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      passWithNoTests: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  }),
);
