import { create } from "zustand";

interface DraftsState {
  draftsByConversationId: Record<string, string>;
  pendingSendCounts: Record<string, number>;
  setDraft: (conversationId: string, content: string) => void;
  incrementPendingSend: (conversationId: string) => void;
  decrementPendingSend: (conversationId: string) => void;
  clearDrafts: () => void;
}

/**
 * In-memory per-conversation message drafts and in-flight send tracking.
 * Keeps empty direct chats visible in the sidebar while composing or sending.
 */
export const useDraftStore = create<DraftsState>((set) => ({
  draftsByConversationId: {},
  pendingSendCounts: {},

  setDraft: (conversationId, content) =>
    set((state) => {
      const current = state.draftsByConversationId[conversationId] ?? "";
      if (current === content) {
        return state;
      }

      if (content.length === 0) {
        if (!(conversationId in state.draftsByConversationId)) {
          return state;
        }
        const rest = { ...state.draftsByConversationId };
        delete rest[conversationId];
        return { draftsByConversationId: rest };
      }

      return {
        draftsByConversationId: {
          ...state.draftsByConversationId,
          [conversationId]: content,
        },
      };
    }),

  incrementPendingSend: (conversationId) =>
    set((state) => ({
      pendingSendCounts: {
        ...state.pendingSendCounts,
        [conversationId]: (state.pendingSendCounts[conversationId] ?? 0) + 1,
      },
    })),

  decrementPendingSend: (conversationId) =>
    set((state) => {
      const current = state.pendingSendCounts[conversationId] ?? 0;
      if (current <= 1) {
        if (!(conversationId in state.pendingSendCounts)) {
          return state;
        }
        const rest = { ...state.pendingSendCounts };
        delete rest[conversationId];
        return { pendingSendCounts: rest };
      }

      return {
        pendingSendCounts: {
          ...state.pendingSendCounts,
          [conversationId]: current - 1,
        },
      };
    }),

  clearDrafts: () => set({ draftsByConversationId: {}, pendingSendCounts: {} }),
}));
