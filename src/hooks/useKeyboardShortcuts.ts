import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';

const isMac = navigator.platform.toUpperCase().includes('MAC');

/**
 * Parse a key combo string like "Cmd+Shift+T" or "Ctrl+K" and test it against
 * a KeyboardEvent. "Cmd" maps to metaKey on macOS and ctrlKey elsewhere so a
 * single config entry works cross-platform.
 */
function matchesKeyCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  const wantsCmd = parts.some((p) => p.toLowerCase() === 'cmd');
  const wantsCtrl = parts.some((p) => p.toLowerCase() === 'ctrl');
  const wantsShift = parts.some((p) => p.toLowerCase() === 'shift');
  const wantsAlt = parts.some((p) => p.toLowerCase() === 'alt');

  const cmdMatch = wantsCmd ? (isMac ? e.metaKey : e.ctrlKey) : true;
  const ctrlMatch = wantsCtrl ? e.ctrlKey : true;
  const shiftMatch = wantsShift ? e.shiftKey : !e.shiftKey;
  const altMatch = wantsAlt ? e.altKey : !e.altKey;

  // If combo doesn't request meta/ctrl, ensure they're absent
  const noExtraCmd = !wantsCmd ? !e.metaKey : true;
  const noExtraCtrl = (!wantsCmd && !wantsCtrl) ? !e.ctrlKey : true;

  return (
    cmdMatch &&
    ctrlMatch &&
    shiftMatch &&
    altMatch &&
    noExtraCmd &&
    noExtraCtrl &&
    e.key.toLowerCase() === key
  );
}

/** Return the user-configured combo for an action, or the hardcoded default. */
function effectiveCombo(
  action: string,
  defaultCombo: string,
  overrides: Record<string, string>,
): string {
  return overrides[action] ?? defaultCombo;
}

export function useKeyboardShortcuts() {
  // Use refs for values that change frequently to avoid re-registering the listener
  const terminalsRef = useRef(useTerminalStore.getState().terminals);
  const activeIdRef = useRef(useTerminalStore.getState().activeTerminalId);
  const gridModeRef = useRef(useAppStore.getState().gridMode);
  const keybindingOverridesRef = useRef(useAppStore.getState().keybindingOverrides);

  useEffect(() => {
    const unsubTerminal = useTerminalStore.subscribe((state) => {
      terminalsRef.current = state.terminals;
      activeIdRef.current = state.activeTerminalId;
    });
    const unsubApp = useAppStore.subscribe((state) => {
      gridModeRef.current = state.gridMode;
      keybindingOverridesRef.current = state.keybindingOverrides;
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
      const ov = keybindingOverridesRef.current;

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

      // terminal.close.all — Cmd+Shift+W (macOS): close all grid terminals.
      // Checked before worktree handler so Cmd+Shift+W on Mac doesn't trigger worktree.
      if (isMac && matchesKeyCombo(e, effectiveCombo('terminal.close.all', 'Cmd+Shift+W', ov))) {
        e.preventDefault();
        const { gridTerminalIds, clearGrid } = useAppStore.getState();
        const { closeTerminal } = useTerminalStore.getState();
        const ids = [...gridTerminalIds];
        clearGrid();
        ids.forEach((id) => closeTerminal(id));
        return;
      }

      // terminal.reopen.last — Cmd+Shift+T (macOS) / Ctrl+Shift+T (Windows/Linux)
      if (matchesKeyCombo(e, effectiveCombo('terminal.reopen.last', 'Cmd+Shift+T', ov))) {
        e.preventDefault();
        useTerminalStore.getState().reopenTerminal();
        return;
      }

      // ── Cross-platform shortcuts ───────────────────────────────────────────

      // terminal.new.shift — Cmd+Shift+N / Ctrl+Shift+N
      if (matchesKeyCombo(e, effectiveCombo('terminal.new.shift', 'Cmd+Shift+N', ov))) {
        e.preventDefault();
        useAppStore.getState().openModal('newTerminal');
        return;
      }

      // terminal.new — Cmd+T / Ctrl+T
      if (matchesKeyCombo(e, effectiveCombo('terminal.new', 'Cmd+T', ov))) {
        e.preventDefault();
        useAppStore.getState().openModal('newTerminal');
        return;
      }

      // palette.open — Cmd+P / Ctrl+P  (also Cmd+K / Ctrl+K)
      if (
        matchesKeyCombo(e, effectiveCombo('palette.open', 'Cmd+P', ov)) ||
        (ctrl && !shift && e.key === 'k')
      ) {
        e.preventDefault();
        const state = useAppStore.getState();
        if (state.activeModal === 'commandPalette') {
          state.closeModal();
        } else {
          state.openModal('commandPalette');
        }
        return;
      }

      // snippets.open — Cmd+Shift+S / Ctrl+Shift+S
      if (matchesKeyCombo(e, effectiveCombo('snippets.open', 'Cmd+Shift+S', ov))) {
        e.preventDefault();
        useAppStore.getState().openModal('snippets');
        return;
      }

      // view.toggle.split — Cmd+\ / Ctrl+\
      if (matchesKeyCombo(e, effectiveCombo('view.toggle.split', 'Cmd+\\', ov))) {
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
        return;
      }

      // search.global — Cmd+Shift+F / Ctrl+Shift+F
      if (matchesKeyCombo(e, effectiveCombo('search.global', 'Cmd+Shift+F', ov))) {
        e.preventDefault();
        const state = useAppStore.getState();
        if (state.activeModal === 'globalSearch') {
          state.closeModal();
        } else {
          state.openModal('globalSearch');
        }
        return;
      }

      // view.toggle.sidebar — Cmd+B / Ctrl+B
      if (matchesKeyCombo(e, effectiveCombo('view.toggle.sidebar', 'Cmd+B', ov))) {
        e.preventDefault();
        useAppStore.getState().toggleSidebar();
        return;
      }

      // terminal.close.active — Cmd+W / Ctrl+W
      if (matchesKeyCombo(e, effectiveCombo('terminal.close.active', 'Cmd+W', ov))) {
        e.preventDefault();
        const activeId = activeIdRef.current;
        if (activeId) useTerminalStore.getState().closeTerminal(activeId);
        return;
      }

      // terminal.duplicate — Cmd+Shift+D / Ctrl+Shift+D
      if (matchesKeyCombo(e, effectiveCombo('terminal.duplicate', 'Cmd+Shift+D', ov))) {
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
        return;
      }

      // app.settings.open — Cmd+, / Ctrl+,
      if (matchesKeyCombo(e, effectiveCombo('app.settings.open', 'Cmd+,', ov))) {
        e.preventDefault();
        useAppStore.getState().openModal('settings');
        return;
      }

      // F1 — command palette (not overridable via keybindings.json)
      if (e.key === 'F1') {
        e.preventDefault();
        const state = useAppStore.getState();
        if (state.activeModal === 'commandPalette') {
          state.closeModal();
        } else {
          state.openModal('commandPalette');
        }
        return;
      }

      // view.toggle.grid — Cmd+G / Ctrl+G
      if (matchesKeyCombo(e, effectiveCombo('view.toggle.grid', 'Cmd+G', ov))) {
        e.preventDefault();
        useAppStore.getState().toggleGridMode();
        return;
      }

      // worktree.open — Ctrl+Shift+W (on macOS, Cmd+Shift+W handled above)
      if (!isMac && matchesKeyCombo(e, effectiveCombo('worktree.open', 'Cmd+Shift+W', ov))) {
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
        return;
      }

      // view.add.to.grid — Cmd+Shift+G / Ctrl+Shift+G
      if (matchesKeyCombo(e, effectiveCombo('view.add.to.grid', 'Cmd+Shift+G', ov))) {
        e.preventDefault();
        const activeId = activeIdRef.current;
        if (activeId) {
          useAppStore.getState().addToGrid(activeId);
          if (!gridModeRef.current) useAppStore.getState().toggleGridMode();
        }
        return;
      }

      // terminal.broadcast.toggle — Cmd+Shift+B / Ctrl+Shift+B
      if (matchesKeyCombo(e, effectiveCombo('terminal.broadcast.toggle', 'Cmd+Shift+B', ov))) {
        e.preventDefault();
        const activeId = activeIdRef.current;
        if (activeId) {
          useTerminalStore.getState().toggleBroadcastMember(activeId);
        }
        return;
      }

      // Tab cycling — Ctrl+Tab / Ctrl+Shift+Tab (not overridable)
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
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
