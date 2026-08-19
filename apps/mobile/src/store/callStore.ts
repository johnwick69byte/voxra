import { create } from "zustand";

interface CallState {
  activeCallId: string | null;
  incoming: any | null;
  balance: number;
  totalBilled: number;
  lowBalance: boolean;
  setIncoming: (payload: any | null) => void;
  setActiveCall: (callId: string | null) => void;
  setBilling: (balance: number, totalBilled: number) => void;
  setLowBalance: (v: boolean) => void;
  reset: () => void;
}

export const useCallStore = create<CallState>((set) => ({
  activeCallId: null,
  incoming: null,
  balance: 0,
  totalBilled: 0,
  lowBalance: false,
  setIncoming: (incoming) => set({ incoming }),
  setActiveCall: (activeCallId) => set({ activeCallId }),
  setBilling: (balance, totalBilled) => set({ balance, totalBilled }),
  setLowBalance: (lowBalance) => set({ lowBalance }),
  reset: () =>
    set({
      activeCallId: null,
      incoming: null,
      balance: 0,
      totalBilled: 0,
      lowBalance: false,
    }),
}));
