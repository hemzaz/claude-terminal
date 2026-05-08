import { invoke } from '@tauri-apps/api/core';
import { StateCreator } from 'zustand';
import type { AppState, GridLayout, LayoutSlice, SavedTerminalConfig } from '../types';

/** Returns the optimal grid layout string for a given terminal count. */
export function getOptimalLayout(count: number): GridLayout {
  switch (count) {
    case 1: return '1x1';
    case 2: return '1x2';
    case 3: return '1x3';
    case 4: return '2x2';
    case 5:
    case 6: return '2x3';
    case 7:
    case 8: return '2x4';
    default: return '1x1';
  }
}

export const createLayoutSlice: StateCreator<AppState, [], [], LayoutSlice> = (set, get) => ({
  // Grid state
  gridMode: false,
  gridTerminalIds: [],
  gridLayout: '1x1',
  gridFocusedIndex: null,

  // Crash Recovery (F3)
  showRestoreBanner: false,
  pendingRestoreConfigs: null,

  // Split Pane (Ctrl+\)
  splitMode: false,
  splitTerminalIds: null,
  splitOrientation: 'horizontal' as const,
  splitRatio: 0.5,

  // Agent Teams (F4)
  orchestrationOpen: false,

  // File tabs
  openFiles: [],
  activeFilePath: null,

  // Grid actions
  toggleGridMode: () => set((state) => ({ gridMode: !state.gridMode })),
  setGridMode: (enabled) => set({ gridMode: enabled }),
  addToGrid: (terminalId) => set((state) => {
    if (state.gridTerminalIds.includes(terminalId)) return state;
    if (state.gridTerminalIds.length >= 8) return state;
    const newIds = [...state.gridTerminalIds, terminalId];
    return { gridTerminalIds: newIds, gridLayout: getOptimalLayout(newIds.length) };
  }),
  removeFromGrid: (terminalId) => set((state) => {
    const newIds = state.gridTerminalIds.filter((id) => id !== terminalId);
    return {
      gridTerminalIds: newIds,
      gridLayout: getOptimalLayout(newIds.length),
      gridFocusedIndex:
        state.gridFocusedIndex !== null && state.gridFocusedIndex >= newIds.length
          ? null
          : state.gridFocusedIndex,
    };
  }),
  setGridTerminals: (terminalIds) => set({
    gridTerminalIds: terminalIds.slice(0, 8),
    gridLayout: getOptimalLayout(Math.min(terminalIds.length, 8)),
  }),
  setGridLayout: (layout) => set({ gridLayout: layout }),
  setGridFocusedIndex: (index) => set({ gridFocusedIndex: index }),
  clearGrid: () => set({ gridTerminalIds: [], gridLayout: '1x1', gridFocusedIndex: null, gridMode: false }),
  swapGridPositions: (fromIndex, toIndex) => set((state) => {
    const newIds = [...state.gridTerminalIds];
    if (fromIndex < 0 || fromIndex >= newIds.length || toIndex < 0 || toIndex >= newIds.length) return state;
    [newIds[fromIndex], newIds[toIndex]] = [newIds[toIndex], newIds[fromIndex]];
    return { gridTerminalIds: newIds };
  }),
  replaceInGrid: (index, terminalId) => set((state) => {
    const newIds = [...state.gridTerminalIds];
    if (index < 0 || index >= newIds.length) return state;
    if (newIds.includes(terminalId)) return state;
    newIds[index] = terminalId;
    return { gridTerminalIds: newIds };
  }),

  // Crash Recovery actions (F3)
  setShowRestoreBanner: (show) => set({ showRestoreBanner: show }),
  setPendingRestoreConfigs: (configs: SavedTerminalConfig[] | null) => set({ pendingRestoreConfigs: configs }),

  // Split Pane actions (Ctrl+\)
  toggleSplitMode: () => set((state) => ({ splitMode: !state.splitMode })),
  setSplitMode: (enabled) => set({ splitMode: enabled }),
  setSplitTerminals: (ids) => set({ splitTerminalIds: ids }),
  setSplitOrientation: (orientation) => set({ splitOrientation: orientation }),
  setSplitRatio: (ratio) => set({ splitRatio: Math.max(0.2, Math.min(0.8, ratio)) }),
  clearSplit: () => set({ splitMode: false, splitTerminalIds: null, splitRatio: 0.5 }),

  // Agent Teams actions (F4)
  toggleOrchestration: () => set((state) => ({ orchestrationOpen: !state.orchestrationOpen })),

  // File tab actions
  setActiveFilePath: (path) => set({ activeFilePath: path }),

  setFileTabContent: (path, content) => set((state) => ({
    openFiles: state.openFiles.map((t) => t.path === path ? { ...t, content } : t),
  })),

  setFileTabError: (path, error) => set((state) => ({
    openFiles: state.openFiles.map((t) => t.path === path ? { ...t, error, loading: false } : t),
  })),

  setFileTabMode: (path, mode) => set((state) => ({
    openFiles: state.openFiles.map((t) => t.path === path ? { ...t, mode } : t),
  })),

  closeFileTab: (path) => set((state) => {
    const idx = state.openFiles.findIndex((t) => t.path === path);
    if (idx === -1) return state;
    const nextFiles = state.openFiles.filter((t) => t.path !== path);
    let nextActive = state.activeFilePath;
    if (state.activeFilePath === path) {
      nextActive = nextFiles.length === 0
        ? null
        : nextFiles[Math.min(idx, nextFiles.length - 1)].path;
    }
    return { openFiles: nextFiles, activeFilePath: nextActive };
  }),

  openFileTab: async (path) => {
    const existing = get().openFiles.find((t) => t.path === path);
    if (existing) {
      set({ activeFilePath: path });
      return;
    }
    set((state) => ({
      openFiles: [
        ...state.openFiles,
        { path, content: '', original: '', loading: true, saving: false, error: null, mode: 'edit', headContent: '', repoRoot: null, relativePath: null },
      ],
      activeFilePath: path,
    }));
    try {
      const text = await invoke<string>('read_text_file', { path });
      set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, content: text, original: text, loading: false, error: null } : t
        ),
      }));
    } catch (err) {
      const message = typeof err === 'string' ? err : 'Failed to read file';
      set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, loading: false, error: message } : t
        ),
      }));
    }
  },

  openDiffTab: async (path, repoRoot, relativePath) => {
    // If already open, switch into diff mode (fetch HEAD if not loaded).
    const existing = get().openFiles.find((t) => t.path === path);
    if (existing) {
      set({ activeFilePath: path });
      set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, mode: 'diff', repoRoot, relativePath } : t
        ),
      }));
      if (!existing.repoRoot) {
        try {
          const head = await invoke<string>('get_git_head_content', { path: repoRoot, file: relativePath });
          set((state) => ({
            openFiles: state.openFiles.map((t) =>
              t.path === path ? { ...t, headContent: head } : t
            ),
          }));
        } catch {
          // Non-fatal — leave headContent empty; diff will render against "".
        }
      }
      return;
    }
    // Fresh open: fetch both sides in parallel so the diff appears in one render.
    set((state) => ({
      openFiles: [
        ...state.openFiles,
        { path, content: '', original: '', loading: true, saving: false, error: null, mode: 'diff', headContent: '', repoRoot, relativePath },
      ],
      activeFilePath: path,
    }));
    try {
      const [text, head] = await Promise.all([
        invoke<string>('read_text_file', { path }),
        invoke<string>('get_git_head_content', { path: repoRoot, file: relativePath }).catch(() => ''),
      ]);
      set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, content: text, original: text, headContent: head, loading: false, error: null } : t
        ),
      }));
    } catch (err) {
      const message = typeof err === 'string' ? err : 'Failed to read file';
      set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, loading: false, error: message } : t
        ),
      }));
    }
  },

  saveFileTab: async (path) => {
    const tab = get().openFiles.find((t) => t.path === path);
    if (!tab || tab.saving) return;
    set((state) => ({
      openFiles: state.openFiles.map((t) => t.path === path ? { ...t, saving: true } : t),
    }));
    try {
      await invoke('write_text_file', { path, content: tab.content });
      set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, saving: false, original: tab.content, error: null } : t
        ),
      }));
      // Refresh the git changes panel so new saves show up (cross-slice via get()).
      get().triggerChangesRefresh();
    } catch (err) {
      const message = typeof err === 'string' ? err : 'Failed to save file';
      set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, saving: false, error: message } : t
        ),
      }));
      throw err;
    }
  },

  reloadFileTab: async (path) => {
    set((state) => ({
      openFiles: state.openFiles.map((t) => t.path === path ? { ...t, loading: true, error: null } : t),
    }));
    try {
      const text = await invoke<string>('read_text_file', { path });
      set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, content: text, original: text, loading: false, error: null } : t
        ),
      }));
    } catch (err) {
      const message = typeof err === 'string' ? err : 'Failed to read file';
      set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, loading: false, error: message } : t
        ),
      }));
    }
  },
});
