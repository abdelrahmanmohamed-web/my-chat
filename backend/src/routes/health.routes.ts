/** Exposes liveness and readiness endpoints. */

import { Router } from "express";
import mongoose from "mongoose";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => res.json({ status: "ok" }));

healthRouter.get("/ready", (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  return res
    .status(ready ? 200 : 503)
    .json({ status: ready ? "ready" : "unavailable" });
});
