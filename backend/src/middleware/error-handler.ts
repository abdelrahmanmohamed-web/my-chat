/** Converts known service failures and unexpected errors into safe responses. */

import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";

import { ServiceUnavailableError } from "../utils/service-unavailable-error.ts";

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, _next) => {
    void _next;
    if (error instanceof ServiceUnavailableError) {
      logger.error(
        { err: error.originalError },
        "Authentication service unavailable",
      );
      return res
        .status(503)
        .json({ error: "Authentication service unavailable" });
    }
    logger.error({ err: error }, "Request failed");
    return res.status(500).json({ error: "Internal server error" });
  };
}
