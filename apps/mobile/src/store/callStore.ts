import { create } from "zustand";

interface CallState {
  activeCallId: string | null;
  incoming: any | null;
  /** Call id currently shown on the incoming screen, if any. */
  incomingOpen: string | null;
  balance: number;
  totalBilled: number;
  lowBalance: boolean;
  setIncoming: (payload: any | null) => void;
  setIncomingOpen: (callId: string | null) => void;
  setActiveCall: (callId: string | null) => void;
  setBilling: (balance: number, totalBilled: number) => void;
  setLowBalance: (v: boolean) => void;
  reset: () => void;
}

export const useCallStore = create<CallState>((set) => ({
  activeCallId: null,
  incoming: null,
  incomingOpen: null,
  balance: 0,
  totalBilled: 0,
  lowBalance: false,
  setIncoming: (incoming) =>
    set((s) => ({
      incoming,
      // Keep this in step with the payload so a dismiss cannot race the screen.
      incomingOpen: incoming?.call_id ?? (incoming === null ? null : s.incomingOpen),
    })),
  setIncomingOpen: (incomingOpen) => set({ incomingOpen }),
  setActiveCall: (activeCallId) => set({ activeCallId }),
  setBilling: (balance, totalBilled) => set({ balance, totalBilled }),
  setLowBalance: (lowBalance) => set({ lowBalance }),
  reset: () =>
    set({
      activeCallId: null,
      incoming: null,
      incomingOpen: null,
      balance: 0,
      totalBilled: 0,
      lowBalance: false,
    }),
}));
