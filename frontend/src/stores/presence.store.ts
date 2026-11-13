import { create } from "zustand";

export type UserPresenceStatus = "online" | "offline" | "unknown";

interface PresenceState {
  statusByUserId: Record<string, "online" | "offline">;
  setUserStatus: (userId: string, status: "online" | "offline") => void;
  clearPresence: () => void;
}

/**
 * Client-side presence map updated strictly by realtime "user:status" events.
 * Users with no event yet have status "unknown" (never assumed offline).
 * Cleared on every socket reconnect.
 */
export const usePresenceStore = create<PresenceState>((set) => ({
  statusByUserId: {},
  setUserStatus: (userId, status) =>
    set((state) => {
      if (state.statusByUserId[userId] === status) {
        return state;
      }
      return {
        statusByUserId: {
          ...state.statusByUserId,
          [userId]: status,
        },
      };
    }),
  clearPresence: () => set({ statusByUserId: {} }),
}));

export function getUserPresence(
  userId: string | null | undefined,
): UserPresenceStatus {
  if (!userId) {
    return "unknown";
  }
  const status = usePresenceStore.getState().statusByUserId[userId];
  return status ?? "unknown";
}
