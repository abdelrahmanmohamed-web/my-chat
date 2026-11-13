import { create } from "zustand";

export interface OutboxEntry {
  clientId: string;
  conversationId: string;
  content: string;
  createdAt: string;
}

interface OutboxState {
  items: OutboxEntry[];
  enqueue: (entry: OutboxEntry) => void;
  remove: (clientId: string) => void;
  has: (clientId: string) => boolean;
  clearOutbox: () => void;
}

/**
 * In-memory queue of outgoing text messages awaiting transport recovery.
 * Populated only after transient network or 5xx failures; cleared on logout.
 */
export const useOutboxStore = create<OutboxState>((set, get) => ({
  items: [],
  enqueue: (entry) =>
    set((state) => {
      if (state.items.some((item) => item.clientId === entry.clientId)) {
        return state;
      }
      return { items: [...state.items, entry] };
    }),
  remove: (clientId) =>
    set((state) => {
      if (!state.items.some((item) => item.clientId === clientId)) {
        return state;
      }
      return {
        items: state.items.filter((item) => item.clientId !== clientId),
      };
    }),
  has: (clientId) => get().items.some((item) => item.clientId === clientId),
  clearOutbox: () => set({ items: [] }),
}));
