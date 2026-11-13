import { create } from "zustand";

export const TYPING_RECEIVER_AUTO_EXPIRE_MS = 5_000;

interface TypingState {
  // conversationId -> array of active typing userIds
  typingByConversation: Record<string, string[]>;
  setTyping: (
    conversationId: string,
    userId: string,
    isTyping: boolean,
  ) => void;
  clearConversationTyping: (conversationId: string) => void;
  clearAllTyping: () => void;
}

const activeTimers = new Map<string, number>();

function getTimerKey(conversationId: string, userId: string): string {
  return `${conversationId}:${userId}`;
}

const EMPTY_TYPING_USERS: string[] = [];

export const useTypingStore = create<TypingState>((set, get) => ({
  typingByConversation: {},

  setTyping: (conversationId, userId, isTyping) => {
    const timerKey = getTimerKey(conversationId, userId);
    const existingTimer = activeTimers.get(timerKey);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      activeTimers.delete(timerKey);
    }

    if (!isTyping) {
      set((state) => {
        const currentList = state.typingByConversation[conversationId];
        if (!currentList || !currentList.includes(userId)) {
          return state;
        }
        const nextList = currentList.filter((id) => id !== userId);
        const nextMap = { ...state.typingByConversation };
        if (nextList.length === 0) {
          delete nextMap[conversationId];
        } else {
          nextMap[conversationId] = nextList;
        }
        return { typingByConversation: nextMap };
      });
      return;
    }

    // Schedule auto-expiry after 5000ms
    const timerId = window.setTimeout(() => {
      activeTimers.delete(timerKey);
      get().setTyping(conversationId, userId, false);
    }, TYPING_RECEIVER_AUTO_EXPIRE_MS);
    activeTimers.set(timerKey, timerId);

    set((state) => {
      const currentList = state.typingByConversation[conversationId] ?? [];
      if (currentList.includes(userId)) {
        return state;
      }
      return {
        typingByConversation: {
          ...state.typingByConversation,
          [conversationId]: [...currentList, userId],
        },
      };
    });
  },

  clearConversationTyping: (conversationId) => {
    for (const [key, timerId] of activeTimers.entries()) {
      if (key.startsWith(`${conversationId}:`)) {
        window.clearTimeout(timerId);
        activeTimers.delete(key);
      }
    }

    set((state) => {
      if (!state.typingByConversation[conversationId]) {
        return state;
      }
      const nextMap = { ...state.typingByConversation };
      delete nextMap[conversationId];
      return { typingByConversation: nextMap };
    });
  },

  clearAllTyping: () => {
    for (const timerId of activeTimers.values()) {
      window.clearTimeout(timerId);
    }
    activeTimers.clear();
    set({ typingByConversation: {} });
  },
}));

/**
 * Returns active typing userIds in a conversation.
 * Returns a stable reference when there are no typing users to avoid infinite re-renders.
 */
export function useTypingUserIds(conversationId: string | undefined): string[] {
  return useTypingStore((state) => {
    if (!conversationId) {
      return EMPTY_TYPING_USERS;
    }
    return state.typingByConversation[conversationId] ?? EMPTY_TYPING_USERS;
  });
}
