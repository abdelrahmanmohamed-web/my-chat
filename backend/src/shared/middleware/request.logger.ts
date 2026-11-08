/** Installs structured HTTP request logging with the application's logger. */

import type { Express } from "express";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";

export function applyRequestLogger(app: Express, logger: Logger): void {
  app.use(pinoHttp({ logger }));
}
