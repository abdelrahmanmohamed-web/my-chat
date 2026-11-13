/** Boots infrastructure, starts the HTTP server, and owns graceful shutdown. */

import http from "node:http";

import pino from "pino";

import { env } from "./config/env.ts";
import { createApp } from "./app.ts";
import { connectMongoDB, disconnectMongoDB } from "./infrastructure/mongodb.ts";
import {
  initSocketServer,
  closeSocketServer,
} from "./infrastructure/socket.ts";

const logger = pino({
  level: env.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
    ],
    censor: "[REDACTED]",
  },
});
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 10_000;

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  process.exit(1);
});

async function closeHttpServer(server: http.Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function closeResources(server: http.Server): Promise<void> {
  await closeSocketServer();
  await closeHttpServer(server);
  await disconnectMongoDB();
}

async function startServer(): Promise<void> {
  let server: http.Server | undefined;
  try {
    await connectMongoDB();
    const httpServer = http.createServer(createApp(logger));
    initSocketServer(httpServer, logger);
    server = httpServer;

    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, "Shutting down backend");
      const forceExitTimer = setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExitTimer.unref();
      try {
        await closeResources(httpServer);
        logger.info("Backend shutdown complete");
      } catch (error) {
        logger.error({ err: error }, "Backend shutdown failed");
        process.exitCode = 1;
      }
    };

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(env.port, () => {
        logger.info({ port: env.port }, "Backend server started");
        resolve();
      });
    });
  } catch (error) {
    await Promise.allSettled([
      server ? closeHttpServer(server) : Promise.resolve(),
      disconnectMongoDB(),
    ]);
    logger.error({ err: error }, "Backend startup failed");
    process.exitCode = 1;
  }
}

await startServer();
