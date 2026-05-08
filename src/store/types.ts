/**
 * Shared type definitions for the Zustand store slices.
 * Import from here to avoid circular dependencies between slice files and appStore.ts.
 */

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

export interface SavedTerminalConfig {
  id: string;
  label: string;
  nickname: string | null;
  working_directory: string;
  claude_args: string[];
  env_vars: Record<string, string>;
  color_tag: string | null;
}

// ---------------------------------------------------------------------------
// Slice interfaces
// ---------------------------------------------------------------------------

export interface SidebarSlice {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean; // true = icon rail (48px), false = full width (280px)
  hintsOpen: boolean;
  changesOpen: boolean;
  // Shared repo selection — file changes panel pins a repo, file tree follows it
  pinnedRepoPath: string | null;
  showGitPanel: boolean;
  showFileTree: boolean;
  // Changes panel — bumped on save / explicit refresh to trigger re-fetch
  changesRefreshTrigger: number;
  // Sidebar layout
  explorerHeightRatio: number; // 0.15..0.85, portion of sidebar height for Explorer
  toolsCollapsed: boolean; // sidebar footer (Workspaces/Snippets/etc.)
  // File Changes panel split: Repositories (top) vs Changes (bottom)
  repositoriesHeightRatio: number; // 0.15..0.85

  toggleSidebar: () => void;
  toggleSidebarCollapse: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleHints: () => void;
  toggleChanges: () => void;
  triggerChangesRefresh: () => void;
  setShowGitPanel: (enabled: boolean) => void;
  setShowFileTree: (enabled: boolean) => void;
  setPinnedRepoPath: (path: string | null) => void;
  setExplorerHeightRatio: (ratio: number) => void;
  setRepositoriesHeightRatio: (ratio: number) => void;
  toggleToolsCollapsed: () => void;
}

export interface ModalsSlice {
  activeModal: ModalKind | null;
  editingProfileId: string | null;
  worktreeModalRepoPath: string | null;

  openModal: (modal: ModalKind, options?: { profileId?: string; repoPath?: string }) => void;
  closeModal: () => void;
  replaceModal: (modal: ModalKind, options?: { profileId?: string; repoPath?: string }) => void;
}

export interface SettingsSlice {
  defaultClaudeArgs: string[];
  notifyOnFinish: boolean;
  restoreSession: boolean;
  telemetryEnabled: boolean;
  errorReportingEnabled: boolean;
  lastSeenVersion: string | null;
  // macOS update channel — Homebrew tap (default) or in-app updater. Ignored on Windows.
  macUpdateSource: 'homebrew' | 'in-app';
  // Whether the first-launch "update source" hint toast has already been shown.
  seenUpdateSourceToast: boolean;
  // Global hotkey — summons the window from anywhere on the system.
  // Empty string disables the hotkey. Stored as a Tauri shortcut string.
  globalHotkey: string;
  // Auto-hide the window when it loses focus (only active when a hotkey is set).
  autoHideOnBlur: boolean;
  // Keybinding overrides (loaded from disk at boot; NOT persisted to localStorage)
  keybindingOverrides: Record<string, string>;
  // Whether the first-run onboarding tour has been completed.
  onboardingCompleted: boolean;

  setOnboardingCompleted: (value: boolean) => void;
  setDefaultClaudeArgs: (args: string[]) => void;
  setNotifyOnFinish: (enabled: boolean) => void;
  setRestoreSession: (enabled: boolean) => void;
  setTelemetryEnabled: (enabled: boolean) => void;
  setErrorReportingEnabled: (enabled: boolean) => void;
  setLastSeenVersion: (version: string) => void;
  setMacUpdateSource: (source: 'homebrew' | 'in-app') => void;
  setSeenUpdateSourceToast: (seen: boolean) => void;
  setGlobalHotkey: (hotkey: string) => void;
  setAutoHideOnBlur: (enabled: boolean) => void;
  loadKeybindings: () => Promise<void>;
}

export interface LayoutSlice {
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

  // File tabs (Monaco editor tabs living next to terminal tabs)
  openFiles: FileTabState[];
  activeFilePath: string | null;

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

  // File tab actions
  openFileTab: (path: string) => Promise<void>;
  openDiffTab: (path: string, repoRoot: string, relativePath: string) => Promise<void>;
  closeFileTab: (path: string) => void;
  setActiveFilePath: (path: string | null) => void;
  setFileTabContent: (path: string, content: string) => void;
  setFileTabError: (path: string, error: string | null) => void;
  setFileTabMode: (path: string, mode: 'edit' | 'diff') => void;
  saveFileTab: (path: string) => Promise<void>;
  reloadFileTab: (path: string) => Promise<void>;
}

/** Combined store type — all slices merged. */
export type AppState = SidebarSlice & ModalsSlice & SettingsSlice & LayoutSlice;
