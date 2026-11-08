/** Converts known service failures and unexpected errors into safe responses. */

import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";

function getClientErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate =
    "status" in error
      ? error.status
      : "statusCode" in error
        ? error.statusCode
        : undefined;
  return typeof candidate === "number" && candidate >= 400 && candidate < 500
    ? candidate
    : null;
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, next) => {
    if (res.headersSent) return next(error);

    const status = getClientErrorStatus(error);
    if (status !== null) {
      return res
        .status(status)
        .json({ error: status === 413 ? "Payload too large" : "Bad request" });
    }

    logger.error({ err: error }, "Request failed");
    return res.status(500).json({ error: "Internal server error" });
  };
}
