import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';

const isMac = navigator.platform.toUpperCase().includes('MAC');

export function useKeyboardShortcuts() {
  // Use refs for values that change frequently to avoid re-registering the listener
  const terminalsRef = useRef(useTerminalStore.getState().terminals);
  const activeIdRef = useRef(useTerminalStore.getState().activeTerminalId);
  const gridModeRef = useRef(useAppStore.getState().gridMode);

  useEffect(() => {
    const unsubTerminal = useTerminalStore.subscribe((state) => {
      terminalsRef.current = state.terminals;
      activeIdRef.current = state.activeTerminalId;
    });
    const unsubApp = useAppStore.subscribe((state) => {
      gridModeRef.current = state.gridMode;
    });
    return () => {
      unsubTerminal();
      unsubApp();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const meta = e.metaKey;
      const shift = e.shiftKey;

      // ── macOS-only Cmd shortcuts ───────────────────────────────────────────

      // Cmd+Q: quit application (macOS muscle-memory; Ctrl+Q intentionally unbound)
      if (isMac && meta && !shift && e.key === 'q') {
        e.preventDefault();
        exit(0);
        return;
      }

      // Cmd+M: minimize window (matches macOS system convention)
      if (isMac && meta && !shift && e.key === 'm') {
        e.preventDefault();
        getCurrentWindow().minimize();
        return;
      }

      // Cmd+Shift+W (macOS): close all terminals currently in grid view.
      // Checked before Ctrl+Shift+W → worktree-modal so Cmd+Shift+W on Mac
      // does not accidentally trigger the worktree handler.
      if (isMac && meta && shift && e.key === 'W') {
        e.preventDefault();
        const { gridTerminalIds, clearGrid } = useAppStore.getState();
        const { closeTerminal } = useTerminalStore.getState();
        const ids = [...gridTerminalIds];
        clearGrid();
        ids.forEach((id) => closeTerminal(id));
        return;
      }

      // Cmd+Shift+T (macOS): reopen most-recently-closed terminal.
      // TODO: implement once Issue #15 (soft-delete closed terminals) ships.
      if (isMac && meta && shift && e.key === 'T') {
        e.preventDefault();
        return;
      }

      // ── Cross-platform shortcuts ───────────────────────────────────────────

      if (ctrl && shift && e.key === 'N') {
        e.preventDefault();
        useAppStore.getState().openModal('newTerminal');
      }

      // Cmd+T / Ctrl+T: open new terminal (matches browser/terminal convention)
      if (ctrl && !shift && e.key === 't') {
        e.preventDefault();
        useAppStore.getState().openModal('newTerminal');
      }

      // Command Palette: Ctrl+P or Ctrl+K / Cmd+K
      if ((ctrl && e.key === 'p') || (ctrl && e.key === 'k')) {
        e.preventDefault();
        const state = useAppStore.getState();
        if (state.activeModal === 'commandPalette') {
          state.closeModal();
        } else {
          state.openModal('commandPalette');
        }
      }

      // Snippets: Ctrl+Shift+S
      if (ctrl && shift && e.key === 'S') {
        e.preventDefault();
        useAppStore.getState().openModal('snippets');
      }

      // Split View: Ctrl+\
      if (ctrl && e.key === '\\') {
        e.preventDefault();
        const { splitMode, clearSplit, setSplitTerminals, setSplitMode } = useAppStore.getState();
        if (splitMode) {
          clearSplit();
        } else {
          const terminals = terminalsRef.current;
          const activeId = activeIdRef.current;
          const terminalIds = Array.from(terminals.keys());
          if (terminalIds.length >= 2 && activeId) {
            const otherIds = terminalIds.filter(id => id !== activeId);
            if (otherIds.length > 0) {
              setSplitTerminals([activeId, otherIds[0]]);
              setSplitMode(true);
            }
          }
        }
      }

      // Global file/content search (VS Code style): Ctrl+Shift+F
      if (ctrl && shift && e.key === 'F') {
        e.preventDefault();
        const state = useAppStore.getState();
        if (state.activeModal === 'globalSearch') {
          state.closeModal();
        } else {
          state.openModal('globalSearch');
        }
      }

      if (ctrl && e.key === 'b') {
        e.preventDefault();
        useAppStore.getState().toggleSidebar();
      }

      // Cmd+W / Ctrl+W: close active terminal
      if (ctrl && e.key === 'w') {
        e.preventDefault();
        const activeId = activeIdRef.current;
        if (activeId) useTerminalStore.getState().closeTerminal(activeId);
      }

      // Duplicate active terminal: Ctrl+Shift+D
      if (ctrl && shift && e.key === 'D') {
        e.preventDefault();
        const activeId = activeIdRef.current;
        if (activeId) {
          const instance = terminalsRef.current.get(activeId);
          if (instance) {
            const { label, working_directory, claude_args, env_vars, color_tag, nickname } = instance.config;
            useTerminalStore.getState().createTerminal(
              label,
              working_directory,
              claude_args,
              env_vars,
              color_tag ?? undefined,
              nickname ?? undefined,
            );
          }
        }
      }

      // Cmd+, / Ctrl+,: Settings
      if (ctrl && e.key === ',') {
        e.preventDefault();
        useAppStore.getState().openModal('settings');
      }

      if (e.key === 'F1') {
        e.preventDefault();
        useAppStore.getState().toggleHints();
      }

      // Toggle Grid Mode: Ctrl+G
      if (ctrl && e.key === 'g') {
        e.preventDefault();
        useAppStore.getState().toggleGridMode();
      }

      // Worktree Modal: Ctrl+Shift+W (on macOS, Cmd+Shift+W is handled above)
      if (ctrl && shift && e.key === 'W') {
        e.preventDefault();
        const activeId = activeIdRef.current;
        if (activeId) {
          const gitInfo = useTerminalStore.getState().gitInfoCache.get(activeId);
          if (gitInfo?.is_git_repo) {
            const terminal = terminalsRef.current.get(activeId);
            const repoPath = gitInfo.is_worktree && gitInfo.main_repo_path
              ? gitInfo.main_repo_path
              : terminal?.config.working_directory || '';
            useAppStore.getState().openModal('worktree', { repoPath });
          }
        }
      }

      // Add current terminal to grid: Ctrl+Shift+G
      if (ctrl && shift && e.key === 'G') {
        e.preventDefault();
        const activeId = activeIdRef.current;
        if (activeId) {
          useAppStore.getState().addToGrid(activeId);
          if (!gridModeRef.current) useAppStore.getState().toggleGridMode();
        }
      }

      if (ctrl && e.key === 'Tab') {
        e.preventDefault();
        const terminals = terminalsRef.current;
        const activeId = activeIdRef.current;
        const terminalIds = Array.from(terminals.keys());
        if (terminalIds.length > 0 && activeId) {
          const currentIndex = terminalIds.indexOf(activeId);
          const nextIndex = shift
            ? (currentIndex - 1 + terminalIds.length) % terminalIds.length
            : (currentIndex + 1) % terminalIds.length;
          useTerminalStore.getState().setActiveTerminal(terminalIds[nextIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
