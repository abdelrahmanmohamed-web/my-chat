import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../backend/docs/openapi.yaml",
  output: {
    path: "src/lib/api/generated",
    tsConfigPath: "./tsconfig.app.json",
  },
  plugins: ["@hey-api/typescript", "@hey-api/sdk", "@hey-api/client-fetch"],
});
