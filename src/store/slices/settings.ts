import { invoke } from '@tauri-apps/api/core';
import { StateCreator } from 'zustand';
import type { AppState, SettingsSlice } from '../types';

export const createSettingsSlice: StateCreator<AppState, [], [], SettingsSlice> = (set) => ({
  defaultClaudeArgs: [],
  notifyOnFinish: true,
  restoreSession: true,
  telemetryEnabled: true,
  errorReportingEnabled: true,
  lastSeenVersion: null,
  // macOS update source — defaults to Homebrew (cleanest UX, no quarantine re-prompts).
  macUpdateSource: 'homebrew' as const,
  seenUpdateSourceToast: false,
  // Default global hotkey: Cmd+` (Meta+Backquote) on macOS.
  globalHotkey: 'Meta+Backquote',
  autoHideOnBlur: false,
  // Keybinding overrides — populated at boot via loadKeybindings(); not persisted.
  keybindingOverrides: {},

  setDefaultClaudeArgs: (args) => set({ defaultClaudeArgs: args }),
  setNotifyOnFinish: (enabled) => set({ notifyOnFinish: enabled }),
  setRestoreSession: (enabled) => set({ restoreSession: enabled }),
  setTelemetryEnabled: (enabled) => set({ telemetryEnabled: enabled }),
  setErrorReportingEnabled: (enabled) => set({ errorReportingEnabled: enabled }),
  setLastSeenVersion: (version) => set({ lastSeenVersion: version }),
  setMacUpdateSource: (source) => set({ macUpdateSource: source }),
  setSeenUpdateSourceToast: (seen) => set({ seenUpdateSourceToast: seen }),
  setGlobalHotkey: (hotkey) => set({ globalHotkey: hotkey }),
  setAutoHideOnBlur: (enabled) => set({ autoHideOnBlur: enabled }),

  loadKeybindings: async () => {
    try {
      await invoke('ensure_keybindings_file_exists');
      const overrides = await invoke<Record<string, string>>('read_keybindings');
      set({ keybindingOverrides: overrides });
    } catch {
      // Non-fatal: fall back to empty overrides (defaults will be used)
    }
  },
});
