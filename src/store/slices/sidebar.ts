import { StateCreator } from 'zustand';
import type { AppState, SidebarSlice } from '../types';

export const createSidebarSlice: StateCreator<AppState, [], [], SidebarSlice> = (set) => ({
  sidebarOpen: true,
  sidebarCollapsed: false,
  hintsOpen: false,
  changesOpen: false,
  pinnedRepoPath: null,
  showGitPanel: true,
  showFileTree: true,
  changesRefreshTrigger: 0,
  // Explorer takes 45% of sidebar height by default
  explorerHeightRatio: 0.45,
  // Tools footer collapsed by default — surfaces more explorer space
  toolsCollapsed: true,
  // Repositories takes 35% of changes column by default
  repositoriesHeightRatio: 0.35,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleSidebarCollapse: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleHints: () => set((state) => ({ hintsOpen: !state.hintsOpen })),
  toggleChanges: () => set((state) => ({ changesOpen: !state.changesOpen })),
  triggerChangesRefresh: () => set((state) => ({ changesRefreshTrigger: state.changesRefreshTrigger + 1 })),
  setShowGitPanel: (enabled) => set({ showGitPanel: enabled }),
  setShowFileTree: (enabled) => set({ showFileTree: enabled }),
  setPinnedRepoPath: (path) => set({ pinnedRepoPath: path }),
  setExplorerHeightRatio: (ratio) => set({ explorerHeightRatio: Math.max(0.15, Math.min(0.85, ratio)) }),
  setRepositoriesHeightRatio: (ratio) => set({ repositoriesHeightRatio: Math.max(0.15, Math.min(0.85, ratio)) }),
  toggleToolsCollapsed: () => set((state) => ({ toolsCollapsed: !state.toolsCollapsed })),
});
