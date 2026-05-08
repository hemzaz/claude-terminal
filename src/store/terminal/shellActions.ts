import { invoke } from '@tauri-apps/api/core';
import type { StateCreator } from 'zustand';
import type { TerminalConfig } from '../../types/ipc';
import type { TerminalState } from '../terminalStore';

type TerminalStoreSet = Parameters<StateCreator<TerminalState>>[0];

type ShellActions = Pick<
  TerminalState,
  'openShellTerminal' | 'closeShellTerminal' | 'setActiveBottomTerminal'
>;

export const createShellActions = (set: TerminalStoreSet): ShellActions => ({
  openShellTerminal: async (label, cwd) => {
    const config = await invoke<TerminalConfig>('create_shell_terminal', { label, cwd });
    set((state) => {
      const nextTerminals = new Map(state.terminals);
      nextTerminals.set(config.id, {
        config,
        xterm: null,
        isWorktree: false,
        isShellTerminal: true,
      });
      return {
        terminals: nextTerminals,
        bottomTerminalIds: [...state.bottomTerminalIds, config.id],
        activeBottomTerminalId: config.id,
      };
    });
    return config.id;
  },

  closeShellTerminal: async (id) => {
    try {
      await invoke('close_terminal', { id });
    } catch {
      // Already gone — fall through to store cleanup.
    }
    set((state) => {
      const nextTerminals = new Map(state.terminals);
      const inst = nextTerminals.get(id);
      if (inst?.xterm) inst.xterm.dispose();
      nextTerminals.delete(id);
      const nextIds = state.bottomTerminalIds.filter((x) => x !== id);
      let nextActive: string | null = state.activeBottomTerminalId;
      if (nextActive === id) {
        const removedIdx = state.bottomTerminalIds.indexOf(id);
        if (nextIds.length === 0) {
          nextActive = null;
        } else {
          const fallbackIdx = Math.min(Math.max(removedIdx, 0), nextIds.length - 1);
          nextActive = nextIds[fallbackIdx];
        }
      }
      return {
        terminals: nextTerminals,
        bottomTerminalIds: nextIds,
        activeBottomTerminalId: nextActive,
      };
    });
  },

  setActiveBottomTerminal: (id) => set({ activeBottomTerminalId: id }),
});
