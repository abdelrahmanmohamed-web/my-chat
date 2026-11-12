import { createContext, useContext } from "react";
import { socket, type RealtimeSocket } from "@/lib/socket";

export const SocketContext = createContext<RealtimeSocket>(socket);

export function useRealtimeSocket(): RealtimeSocket {
  return useContext(SocketContext);
}
