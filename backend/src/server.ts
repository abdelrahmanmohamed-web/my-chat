/** Boots infrastructure, starts the HTTP server, and owns graceful shutdown. */

import http from "node:http";

import pino from "pino";

import { env } from "./config/env.ts";
import { createApp } from "./app.ts";
import { connectMongoDB, disconnectMongoDB } from "./infrastructure/mongodb.ts";
import { connectRedis, disconnectRedis } from "./infrastructure/redis.ts";
import { redis } from "./config/redis.ts";

const logger = pino({ level: env.logLevel });
let shuttingDown = false;

async function closeHttpServer(server: http.Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function closeResources(server: http.Server): Promise<void> {
  await closeHttpServer(server);
  await Promise.allSettled([disconnectMongoDB(), disconnectRedis()]);
}

async function startServer(): Promise<void> {
  redis.on("error", (error: Error) =>
    logger.error({ err: error }, "Redis client error"),
  );

  let server: http.Server | undefined;
  try {
    await connectMongoDB();
    await connectRedis();
    const httpServer = http.createServer(createApp(logger));
    server = httpServer;

    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, "Shutting down backend");
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
      disconnectRedis(),
    ]);
    logger.error({ err: error }, "Backend startup failed");
    process.exitCode = 1;
  }
}

await startServer();
