import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import mongoose from "mongoose";
import pino from "pino";
import { pinoHttp } from "pino-http";

import { getAccessTokenSecret } from "./config/auth-config.ts";
import { redis } from "./config/redis.ts";
import { authRouter } from "./routes/auth-routes.ts";
import { sessionRouter } from "./routes/session-routes.ts";
import { ServiceUnavailableError } from "./utils/service-unavailable-error.ts";

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const port = Number(process.env.PORT ?? 3000);
const mongoUri = process.env.MONGODB_URI;
const authRateLimitWindowMs = 15 * 60 * 1000;

function rateLimitFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const loginLimiter = rateLimit({
  windowMs: authRateLimitWindowMs,
  limit: rateLimitFromEnv("AUTH_LOGIN_RATE_LIMIT", 10),
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const registerLimiter = rateLimit({
  windowMs: authRateLimitWindowMs,
  limit: rateLimitFromEnv("AUTH_REGISTER_RATE_LIMIT", 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const refreshLimiter = rateLimit({
  windowMs: authRateLimitWindowMs,
  limit: rateLimitFromEnv("AUTH_REFRESH_RATE_LIMIT", 30),
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

if (!mongoUri) throw new Error("MONGODB_URI is not set");

// Fail at startup if a weak or missing signing key would prevent safe JWT use.
getAccessTokenSecret();

if (process.env.TRUST_PROXY !== undefined) {
  const trustProxyHops = Number(process.env.TRUST_PROXY);
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error("TRUST_PROXY must be a non-negative integer");
  }
  app.set("trust proxy", trustProxyHops);
}

await mongoose.connect(mongoUri);
redis.on("error", (error: Error) =>
  logger.error({ err: error }, "Redis client error"),
);
await redis.connect();
await redis.ping();

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
  }),
);
app.use(express.json({ limit: "16kb" }));
app.use(pinoHttp({ logger }));
app.use(
  "/api",
  rateLimit({
    windowMs: 7 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.post("/api/auth/login", loginLimiter);
app.post("/api/auth/register", registerLimiter);
app.post("/api/auth/refresh", refreshLimiter);
app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
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
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

app.listen(port, () => logger.info({ port }, "Backend server started"));
