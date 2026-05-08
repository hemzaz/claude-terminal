import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { createLayoutSlice, getOptimalLayout } from './slices/layout';
import { createModalsSlice } from './slices/modals';
import { createSettingsSlice } from './slices/settings';
import { createSidebarSlice } from './slices/sidebar';
import type { AppState } from './types';

// Re-export public types so existing consumer imports keep working unchanged.
export type { AppState, FileTabState, GridLayout, ModalKind, SplitOrientation } from './types';
export { getOptimalLayout };

export const useAppStore = create<AppState>()(
  persist(
    (...a) => ({
      ...createSidebarSlice(...a),
      ...createModalsSlice(...a),
      ...createSettingsSlice(...a),
      ...createLayoutSlice(...a),
    }),
    {
      name: 'claude-terminal-app',
      // Persist only the fields that should survive a page reload.
      // Keys must remain IDENTICAL to preserve existing localStorage state.
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
    },
  ),
);
