import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

export type GridLayout = '1x1' | '1x2' | '2x1' | '2x2' | '1x3' | '3x1' | '2x3' | '3x2' | '2x4' | '4x2';

export type SplitOrientation = 'horizontal' | 'vertical';
export type ModalKind =
  | 'settings'
  | 'profile'
  | 'newTerminal'
  | 'workspace'
  | 'worktree'
  | 'globalSearch'
  | 'commandPalette'
  | 'sessionHistory'
  | 'snippets'
  | 'claudeConfig'
  | 'sessionTimeline'
  | 'memoryEditor'
  | 'whatsNew';

export interface FileTabState {
  path: string;
  content: string;
  original: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  // 'edit' → plain Monaco editor. 'diff' → Monaco DiffEditor showing HEAD vs working copy.
  mode: 'edit' | 'diff';
  // HEAD version, used as the "original" side in diff mode. Empty string for
  // new/untracked files. Always present so the user can toggle into diff mode.
  headContent: string;
  // Repo context for re-fetching HEAD (mode switches, reloads).
  repoRoot: string | null;
  relativePath: string | null;
}

interface AppState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;  // true = icon rail (48px), false = full width (280px)
  hintsOpen: boolean;
  changesOpen: boolean;
  activeModal: ModalKind | null;
  editingProfileId: string | null;
  worktreeModalRepoPath: string | null;
  defaultClaudeArgs: string[];
  notifyOnFinish: boolean;
  restoreSession: boolean;
  telemetryEnabled: boolean;
  errorReportingEnabled: boolean;
  showGitPanel: boolean;
  showFileTree: boolean;

  // Changes panel
  changesRefreshTrigger: number;

  // Shared repo selection — file changes panel pins a repo, file tree follows it
  pinnedRepoPath: string | null;

  // File tabs (Monaco editor tabs living next to terminal tabs)
  openFiles: FileTabState[];
  activeFilePath: string | null;

  // Sidebar layout
  explorerHeightRatio: number; // 0.15..0.85, portion of sidebar height reserved for Explorer
  toolsCollapsed: boolean; // sidebar footer (Workspaces/Snippets/etc.) — collapsed gives Explorer more height

  // File Changes panel split: Repositories (top) vs Changes (bottom)
  repositoriesHeightRatio: number; // 0.15..0.85

  // Grid state
  gridMode: boolean;
  gridTerminalIds: string[];
  gridLayout: GridLayout;
  gridFocusedIndex: number | null;

  // Crash Recovery (F3)
  showRestoreBanner: boolean;
  pendingRestoreConfigs: SavedTerminalConfig[] | null;

  // Split Pane (Ctrl+\)
  splitMode: boolean;
  splitTerminalIds: [string, string] | null;
  splitOrientation: SplitOrientation;
  splitRatio: number;

  // Agent Teams (F4)
  orchestrationOpen: boolean;

  lastSeenVersion: string | null;

  // macOS update channel — Homebrew tap (default) or in-app updater. Ignored
  // on Windows. Persisted so the choice survives restarts.
  macUpdateSource: 'homebrew' | 'in-app';

  // Whether the first-launch "update source" hint toast has already been shown.
  seenUpdateSourceToast: boolean;

  // Global hotkey — summons the window from anywhere on the system.
  // Empty string disables the hotkey. Stored as a Tauri shortcut string
  // (e.g. "Meta+Backquote", "CommandOrControl+Shift+T").
  globalHotkey: string;
  // Auto-hide the window when it loses focus (only active when a hotkey is set).
  autoHideOnBlur: boolean;

  toggleSidebar: () => void;
  toggleSidebarCollapse: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleHints: () => void;
  toggleChanges: () => void;
  triggerChangesRefresh: () => void;
  openModal: (modal: ModalKind, options?: { profileId?: string; repoPath?: string }) => void;
  closeModal: () => void;
  replaceModal: (modal: ModalKind, options?: { profileId?: string; repoPath?: string }) => void;
  setDefaultClaudeArgs: (args: string[]) => void;
  setNotifyOnFinish: (enabled: boolean) => void;
  setRestoreSession: (enabled: boolean) => void;
  setTelemetryEnabled: (enabled: boolean) => void;
  setErrorReportingEnabled: (enabled: boolean) => void;
  setShowGitPanel: (enabled: boolean) => void;
  setShowFileTree: (enabled: boolean) => void;
  setPinnedRepoPath: (path: string | null) => void;
  openFileTab: (path: string) => Promise<void>;
  openDiffTab: (path: string, repoRoot: string, relativePath: string) => Promise<void>;
  closeFileTab: (path: string) => void;
  setActiveFilePath: (path: string | null) => void;
  setFileTabContent: (path: string, content: string) => void;
  setFileTabError: (path: string, error: string | null) => void;
  setFileTabMode: (path: string, mode: 'edit' | 'diff') => void;
  saveFileTab: (path: string) => Promise<void>;
  reloadFileTab: (path: string) => Promise<void>;
  setExplorerHeightRatio: (ratio: number) => void;
  setRepositoriesHeightRatio: (ratio: number) => void;
  toggleToolsCollapsed: () => void;

  // Grid actions
  toggleGridMode: () => void;
  setGridMode: (enabled: boolean) => void;
  addToGrid: (terminalId: string) => void;
  removeFromGrid: (terminalId: string) => void;
  setGridTerminals: (terminalIds: string[]) => void;
  setGridLayout: (layout: GridLayout) => void;
  setGridFocusedIndex: (index: number | null) => void;
  clearGrid: () => void;
  swapGridPositions: (fromIndex: number, toIndex: number) => void;
  replaceInGrid: (index: number, terminalId: string) => void;

  // Crash Recovery actions (F3)
  setShowRestoreBanner: (show: boolean) => void;
  setPendingRestoreConfigs: (configs: SavedTerminalConfig[] | null) => void;

  // Split Pane actions (Ctrl+\)
  toggleSplitMode: () => void;
  setSplitMode: (enabled: boolean) => void;
  setSplitTerminals: (ids: [string, string] | null) => void;
  setSplitOrientation: (orientation: SplitOrientation) => void;
  setSplitRatio: (ratio: number) => void;
  clearSplit: () => void;

  // Agent Teams actions (F4)
  toggleOrchestration: () => void;

  setLastSeenVersion: (version: string) => void;

  // macOS update source actions
  setMacUpdateSource: (source: 'homebrew' | 'in-app') => void;
  setSeenUpdateSourceToast: (seen: boolean) => void;

  // Global hotkey actions
  setGlobalHotkey: (hotkey: string) => void;
  setAutoHideOnBlur: (enabled: boolean) => void;
}

interface SavedTerminalConfig {
  id: string;
  label: string;
  nickname: string | null;
  working_directory: string;
  claude_args: string[];
  env_vars: Record<string, string>;
  color_tag: string | null;
}

// Helper to determine optimal layout based on terminal count
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

function getModalState(modal: ModalKind | null, options?: { profileId?: string; repoPath?: string }) {
  return {
    activeModal: modal,
    editingProfileId: modal === 'profile' ? options?.profileId ?? null : null,
    worktreeModalRepoPath: modal === 'worktree' ? options?.repoPath ?? null : null,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarCollapsed: false,
      hintsOpen: false,
      changesOpen: false,
      activeModal: null,
      editingProfileId: null,
      worktreeModalRepoPath: null,
      defaultClaudeArgs: [],
      notifyOnFinish: true,
      restoreSession: true,
      telemetryEnabled: true,
      errorReportingEnabled: true,
      showGitPanel: true,
      showFileTree: true,

      // Changes panel
      changesRefreshTrigger: 0,

      // Shared repo selection
      pinnedRepoPath: null,

      // File tabs
      openFiles: [],
      activeFilePath: null,

      // Sidebar explorer ratio (default: explorer takes 45% of sidebar height)
      explorerHeightRatio: 0.45,
      // Tools footer collapsed by default — surfaces more explorer space; user
      // can expand on demand to reach Workspaces / Snippets / Profiles / etc.
      toolsCollapsed: true,

      // File Changes split (default: repositories takes 35% of available column)
      repositoriesHeightRatio: 0.35,

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
      splitOrientation: 'horizontal' as SplitOrientation,
      splitRatio: 0.5,

      // Agent Teams (F4)
      orchestrationOpen: false,

      lastSeenVersion: null,

      // macOS update source — defaults to Homebrew (cleanest UX, no quarantine
      // re-prompts). User can switch to in-app updater from Settings.
      macUpdateSource: 'homebrew' as const,
      seenUpdateSourceToast: false,

      // Global hotkey — default Cmd+` (Meta+Backquote) on macOS.
      globalHotkey: 'Meta+Backquote',
      autoHideOnBlur: false,

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleSidebarCollapse: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleHints: () => set((state) => ({ hintsOpen: !state.hintsOpen })),
      toggleChanges: () => set((state) => ({ changesOpen: !state.changesOpen })),
      triggerChangesRefresh: () => set((state) => ({ changesRefreshTrigger: state.changesRefreshTrigger + 1 })),
      openModal: (modal, options) => set(getModalState(modal, options)),
      closeModal: () => set(getModalState(null)),
      replaceModal: (modal, options) => set(getModalState(modal, options)),
      setDefaultClaudeArgs: (args) => set({ defaultClaudeArgs: args }),
      setNotifyOnFinish: (enabled) => set({ notifyOnFinish: enabled }),
      setRestoreSession: (enabled) => set({ restoreSession: enabled }),
      setTelemetryEnabled: (enabled) => set({ telemetryEnabled: enabled }),
      setErrorReportingEnabled: (enabled) => set({ errorReportingEnabled: enabled }),
      setShowGitPanel: (enabled) => set({ showGitPanel: enabled }),
      setShowFileTree: (enabled) => set({ showFileTree: enabled }),
      setPinnedRepoPath: (path) => set({ pinnedRepoPath: path }),
      setExplorerHeightRatio: (ratio) => set({
        explorerHeightRatio: Math.max(0.15, Math.min(0.85, ratio)),
      }),
      setRepositoriesHeightRatio: (ratio) => set({
        repositoriesHeightRatio: Math.max(0.15, Math.min(0.85, ratio)),
      }),
      toggleToolsCollapsed: () => set((state) => ({ toolsCollapsed: !state.toolsCollapsed })),

      setActiveFilePath: (path) => set({ activeFilePath: path }),

      setFileTabContent: (path, content) => set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, content } : t
        ),
      })),

      setFileTabError: (path, error) => set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, error, loading: false } : t
        ),
      })),

      openFileTab: async (path) => {
        const existing = (useAppStore.getState().openFiles).find((t) => t.path === path);
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
        // If already open, just switch into diff mode (fetch HEAD if not loaded).
        const existing = useAppStore.getState().openFiles.find((t) => t.path === path);
        if (existing) {
          set({ activeFilePath: path });
          // Ensure repo context + mode are set so the toggle works.
          set((state) => ({
            openFiles: state.openFiles.map((t) =>
              t.path === path
                ? { ...t, mode: 'diff', repoRoot, relativePath }
                : t
            ),
          }));
          // If HEAD content hasn't been fetched yet, grab it.
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

      setFileTabMode: (path, mode) => set((state) => ({
        openFiles: state.openFiles.map((t) =>
          t.path === path ? { ...t, mode } : t
        ),
      })),

      closeFileTab: (path) => set((state) => {
        const idx = state.openFiles.findIndex((t) => t.path === path);
        if (idx === -1) return state;
        const nextFiles = state.openFiles.filter((t) => t.path !== path);
        let nextActive = state.activeFilePath;
        if (state.activeFilePath === path) {
          // Move focus to the next tab in order, or the previous if we closed the last.
          if (nextFiles.length === 0) {
            nextActive = null;
          } else {
            const fallbackIdx = Math.min(idx, nextFiles.length - 1);
            nextActive = nextFiles[fallbackIdx].path;
          }
        }
        return { openFiles: nextFiles, activeFilePath: nextActive };
      }),

      saveFileTab: async (path) => {
        const tab = useAppStore.getState().openFiles.find((t) => t.path === path);
        if (!tab || tab.saving) return;
        set((state) => ({
          openFiles: state.openFiles.map((t) =>
            t.path === path ? { ...t, saving: true } : t
          ),
        }));
        try {
          await invoke('write_text_file', { path, content: tab.content });
          set((state) => ({
            openFiles: state.openFiles.map((t) =>
              t.path === path ? { ...t, saving: false, original: tab.content, error: null } : t
            ),
            // Refresh the git changes panel so new saves show up.
            changesRefreshTrigger: state.changesRefreshTrigger + 1,
          }));
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
          openFiles: state.openFiles.map((t) =>
            t.path === path ? { ...t, loading: true, error: null } : t
          ),
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

      // Grid actions
      toggleGridMode: () => set((state) => ({ gridMode: !state.gridMode })),
      setGridMode: (enabled) => set({ gridMode: enabled }),
      addToGrid: (terminalId) => set((state) => {
        if (state.gridTerminalIds.includes(terminalId)) return state;
        if (state.gridTerminalIds.length >= 8) return state;
        const newIds = [...state.gridTerminalIds, terminalId];
        return {
          gridTerminalIds: newIds,
          gridLayout: getOptimalLayout(newIds.length),
        };
      }),
      removeFromGrid: (terminalId) => set((state) => {
        const newIds = state.gridTerminalIds.filter(id => id !== terminalId);
        return {
          gridTerminalIds: newIds,
          gridLayout: getOptimalLayout(newIds.length),
          gridFocusedIndex: state.gridFocusedIndex !== null && state.gridFocusedIndex >= newIds.length
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
      clearGrid: () => set({
        gridTerminalIds: [],
        gridLayout: '1x1',
        gridFocusedIndex: null,
        gridMode: false,
      }),
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
      setPendingRestoreConfigs: (configs) => set({ pendingRestoreConfigs: configs }),

      // Split Pane actions (Ctrl+\)
      toggleSplitMode: () => set((state) => ({ splitMode: !state.splitMode })),
      setSplitMode: (enabled) => set({ splitMode: enabled }),
      setSplitTerminals: (ids) => set({ splitTerminalIds: ids }),
      setSplitOrientation: (orientation) => set({ splitOrientation: orientation }),
      setSplitRatio: (ratio) => set({ splitRatio: Math.max(0.2, Math.min(0.8, ratio)) }),
      clearSplit: () => set({ splitMode: false, splitTerminalIds: null, splitRatio: 0.5 }),

      // Agent Teams actions (F4)
      toggleOrchestration: () => set((state) => ({ orchestrationOpen: !state.orchestrationOpen })),

      setLastSeenVersion: (version) => set({ lastSeenVersion: version }),

      // macOS update source
      setMacUpdateSource: (source) => set({ macUpdateSource: source }),
      setSeenUpdateSourceToast: (seen) => set({ seenUpdateSourceToast: seen }),

      // Global hotkey
      setGlobalHotkey: (hotkey) => set({ globalHotkey: hotkey }),
      setAutoHideOnBlur: (enabled) => set({ autoHideOnBlur: enabled }),
    }),
    {
      name: 'claude-terminal-app',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarCollapsed: state.sidebarCollapsed,
        hintsOpen: state.hintsOpen,
        changesOpen: state.changesOpen,
        defaultClaudeArgs: state.defaultClaudeArgs,
        notifyOnFinish: state.notifyOnFinish,
        restoreSession: state.restoreSession,
        telemetryEnabled: state.telemetryEnabled,
        errorReportingEnabled: state.errorReportingEnabled,
        showGitPanel: state.showGitPanel,
        showFileTree: state.showFileTree,
        explorerHeightRatio: state.explorerHeightRatio,
        toolsCollapsed: state.toolsCollapsed,
        repositoriesHeightRatio: state.repositoriesHeightRatio,
        orchestrationOpen: state.orchestrationOpen,
        lastSeenVersion: state.lastSeenVersion,
        macUpdateSource: state.macUpdateSource,
        seenUpdateSourceToast: state.seenUpdateSourceToast,
        globalHotkey: state.globalHotkey,
        autoHideOnBlur: state.autoHideOnBlur,
      }),
    }
  )
);
