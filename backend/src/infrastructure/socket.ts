/**
 * ============================================================================
 * WebSocket Infrastructure (Socket.io)
 * ============================================================================
 * Initializes, manages, and closes the Socket.io server instance attached to the HTTP server.
 * ============================================================================
 */

import type http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type { Logger } from "pino";

import { env } from "../config/env.ts";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../types/socket.ts";
import { socketAuthMiddleware } from "./socket.auth.ts";
import { registerSocketEvents } from "./socket.events.ts";

export type AppSocketServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

let io: AppSocketServer | null = null;

/**
 * Initializes the Socket.io server and binds it to the provided HTTP server.
 */
export function initSocketServer(
  httpServer: http.Server,
  logger: Logger,
): AppSocketServer {
  io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: env.frontendUrl,
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    const userId = socket.data.user?.id;
    if (userId) {
      void socket.join(`user:${userId}`);
    }

    if (io) {
      registerSocketEvents(io, socket, logger);
    }

    logger.info({ socketId: socket.id, userId }, "WebSocket client connected");

    socket.on("disconnect", (reason) => {
      logger.info(
        { socketId: socket.id, userId, reason },
        "WebSocket client disconnected",
      );
    });
  });

  logger.info("Socket.io initialized successfully");
  return io;
}

/**
 * Returns the active Socket.io server instance.
 */
export function getSocketServer(): AppSocketServer {
  if (!io) {
    throw new Error("Socket server has not been initialized yet");
  }
  return io;
}

/**
 * Gracefully shuts down the Socket.io server, disconnecting active clients.
 */
export async function closeSocketServer(): Promise<void> {
  if (!io) return;
  const server = io;
  io = null;

  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
