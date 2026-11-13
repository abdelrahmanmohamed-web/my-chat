/**
 * ============================================================================
 * Environment & Secrets Pre-Build Validation Script
 * ============================================================================
 * Validates that all required environment variables and secrets are present,
 * well-formed, and meet security requirements before compiling/building.
 *
 * Runs automatically prior to build (`npm run prebuild`), or on demand:
 *   npm run check:env
 * ============================================================================
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { envSchema, formatEnvIssues } from "../src/config/env.schema.ts";

function loadLocalEnvFiles(): void {
  // Candidate env files in priority order
  const candidates = [".env.secrets", ".env", ".env.local"];

  for (const candidate of candidates) {
    const fullPath = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(fullPath)) {
      try {
        process.loadEnvFile(fullPath);
      } catch (err) {
        console.warn(`[env-check] Warning: Could not parse ${candidate}:`, err);
      }
    }
  }
}

function run(): void {
  loadLocalEnvFiles();

  const parseResult = envSchema.safeParse(process.env);

  if (!parseResult.success) {
    console.error("\n=======================================================");
    console.error("❌ [env-check] ENVIRONMENT VALIDATION FAILED");
    console.error("=======================================================");
    console.error(
      "The following environment variables or secrets are missing or invalid:\n"
    );

    const issues = formatEnvIssues(parseResult.error.issues);
    for (const issue of issues) {
      console.error(issue);
    }

    console.error("\nℹ️  Please update your .env.secrets or .env file before building.");
    console.error("=======================================================\n");

    process.exit(1);
  }

  const { data } = parseResult;
  console.log("\n=======================================================");
  console.log("✅ [env-check] ENVIRONMENT VALIDATION PASSED");
  console.log("=======================================================");
  console.log(` • NODE_ENV:             ${data.NODE_ENV}`);
  console.log(` • PORT:                 ${data.PORT}`);
  console.log(` • FRONTEND_URL:         ${data.FRONTEND_URL}`);
  console.log(` • MONGODB_URI:          [CONFIGURED]`);
  console.log(` • ACCESS_TOKEN_SECRET:  [CONFIGURED (>= 32 bytes)]`);
  console.log(` • REFRESH_TOKEN_SECRET: [CONFIGURED (>= 32 bytes)]`);
  console.log(` • JWT_ISSUER:           ${data.JWT_ISSUER}`);
  console.log(` • JWT_AUDIENCE:         ${data.JWT_AUDIENCE}`);
  console.log(` • LOG_LEVEL:            ${data.LOG_LEVEL}`);
  console.log(` • ACCESS_TTL:           ${data.ACCESS_TTL}s`);
  console.log(` • REFRESH_TTL_SECONDS:  ${data.REFRESH_TTL_SECONDS}s`);
  console.log("=======================================================\n");
}

run();
