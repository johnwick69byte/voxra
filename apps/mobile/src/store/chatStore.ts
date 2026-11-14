import { create } from "zustand";
import { chatAPI } from "../services/api";

interface ChatState {
  unread: number;
  refresh: () => Promise<void>;
  setUnread: (n: number) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  unread: 0,
  setUnread: (n) => set({ unread: Math.max(0, n) }),
  refresh: async () => {
    try {
      const res = await chatAPI.conversations();
      set({ unread: Number(res.data?.unread_total || 0) });
    } catch {
      /* keep the previous badge */
    }
  },
}));
