import { io } from "socket.io-client";
import { getAccessToken } from "@/stores";
import type { AppSocket, AppSocketOptions } from "@/types/socket";

const SOCKET_PATH = "/socket.io";

const socketOptions: AppSocketOptions = {
  path: SOCKET_PATH,
  autoConnect: false,
  transports: ["websocket", "polling"],
  tryAllTransports: true,
  auth: (cb) => {
    cb({ token: getAccessToken() });
  },
};

const configuredSocketUrl = import.meta.env.VITE_SOCKET_URL?.trim();

/**
 * Application-wide Socket.io singleton initialized outside React.
 * Handshake credentials are read lazily from the in-memory auth store on every connect.
 */
export const socket: AppSocket = configuredSocketUrl
  ? io(configuredSocketUrl, socketOptions)
  : io(socketOptions);
