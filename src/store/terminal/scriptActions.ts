import { invoke } from '@tauri-apps/api/core';
import type { StateCreator } from 'zustand';
import type { TerminalConfig } from '../../types/ipc';
import type { TerminalState } from '../terminalStore';

type TerminalStoreSet = Parameters<StateCreator<TerminalState>>[0];
type TerminalStoreGet = Parameters<StateCreator<TerminalState>>[1];

type ScriptActions = Pick<TerminalState, 'runScript' | 'closeScript'>;

export const createScriptActions = (
  set: TerminalStoreSet,
  get: TerminalStoreGet
): ScriptActions => ({
  runScript: async (parentId, scriptName, cwdOverride) => {
    const parent = get().terminals.get(parentId);
    if (!parent) throw new Error('Parent terminal not found');

    // Replace any existing script child for this parent so the UI always
    // shows the most recently-requested script.
    const existingChildId = get().scriptChildren.get(parentId);
    if (existingChildId) {
      await get().closeScript(parentId).catch(() => { /* non-fatal: no existing script child to close */ });
    }

    const cwd = cwdOverride ?? parent.config.working_directory;
    const config = await invoke<TerminalConfig>('create_script_terminal', {
      cwd,
      scriptName,
    });

    set((state) => {
      const nextTerminals = new Map(state.terminals);
      nextTerminals.set(config.id, {
        config,
        xterm: null,
        isWorktree: false,
        scriptName,
        scriptParentId: parentId,
      });
      const nextChildren = new Map(state.scriptChildren);
      nextChildren.set(parentId, config.id);
      return { terminals: nextTerminals, scriptChildren: nextChildren };
    });

    return config.id;
  },

  closeScript: async (parentId) => {
    const childId = get().scriptChildren.get(parentId);
    if (!childId) return;
    try {
      await invoke('close_terminal', { id: childId });
    } catch {
      // Already closed — fall through to store cleanup.
    }
    set((state) => {
      const nextTerminals = new Map(state.terminals);
      const inst = nextTerminals.get(childId);
      if (inst?.xterm) inst.xterm.dispose();
      nextTerminals.delete(childId);
      const nextChildren = new Map(state.scriptChildren);
      nextChildren.delete(parentId);
      return { terminals: nextTerminals, scriptChildren: nextChildren };
    });
  },
});
