/** Configures the HTTP security headers and cross-origin policy. */

import cors from "cors";
import type { Express } from "express";
import helmet from "helmet";

import { env } from "../config/env.ts";

export function applySecurityMiddleware(app: Express): void {
  app.use(helmet());
  app.use(cors({ origin: env.frontendUrl }));
}
