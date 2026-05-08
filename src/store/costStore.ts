import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CostStoreState {
  isOpen: boolean;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  openDashboard: () => void;
  closeDashboard: () => void;
  setRates: (inputPerMillion: number, outputPerMillion: number) => void;
}

export const useCostStore = create<CostStoreState>()(
  persist(
    (set) => ({
      isOpen: false,
      // Default rates for Claude Sonnet 4 ($/million tokens)
      inputCostPerMillion: 3.0,
      outputCostPerMillion: 15.0,
      openDashboard: () => set({ isOpen: true }),
      closeDashboard: () => set({ isOpen: false }),
      setRates: (inputPerMillion, outputPerMillion) =>
        set({ inputCostPerMillion: inputPerMillion, outputCostPerMillion: outputPerMillion }),
    }),
    {
      name: 'cost-dashboard',
      // Only persist rates, not the open/close state
      partialize: (state) => ({
        inputCostPerMillion: state.inputCostPerMillion,
        outputCostPerMillion: state.outputCostPerMillion,
      }),
    },
  ),
);
