import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';
import { toast } from '../store/toastStore';
import { useNotification } from './useNotification';

/**
 * Wires up the two Tauri terminal event listeners:
 * - terminal-output: pipes PTY bytes to xterm.js and detects loop mode
 * - terminal-finished: updates status, shows toast, auto-summarizes session
 */
export function useAppTerminalEvents() {
  const notifyOnFinish = useAppStore((s) => s.notifyOnFinish);
  const { handleTerminalOutput, updateTerminalStatus, setLoopMode, setSessionSummary } = useTerminalStore();
  const { notify } = useNotification();

  useEffect(() => {
    const unlisten = listen<{ id: string; data: number[] }>('terminal-output', (event) => {
      const { id, data } = event.payload;
      handleTerminalOutput(id, new Uint8Array(data));

      // Detect loop mode from terminal output
      try {
        const text = new TextDecoder().decode(new Uint8Array(data));
        const loopMatch = text.match(/loop\s+(\d+[smh])\s+(.+)/i);
        if (loopMatch) {
          setLoopMode(id, { interval: loopMatch[1], prompt: loopMatch[2] });
        }
      } catch {
        // Ignore decode errors
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [handleTerminalOutput, setLoopMode]);

  useEffect(() => {
    const unlisten = listen<{ id: string }>('terminal-finished', (event) => {
      const { id } = event.payload;

      // Get the current terminal name from the store (always up-to-date, even after renames)
      const terminals = useTerminalStore.getState().terminals;
      const terminal = terminals.get(id);
      const name = terminal?.config.nickname || terminal?.config.label || 'Terminal';

      updateTerminalStatus(id, 'Stopped');
      useAppStore.getState().triggerChangesRefresh();

      // Always show in-app toast
      toast.info('Terminal Finished', `${name} has finished running.`);

      if (notifyOnFinish) {
        notify('Terminal Finished', `${name} has finished running.`);
      }

      // Auto-summarize the session
      (async () => {
        try {
          // Check if we already have a summary
          const existing = await invoke<string | null>('get_session_summary', { terminalId: id });
          if (existing) {
            setSessionSummary(id, existing);
            return;
          }

          // Get the log path for this terminal
          const sessions = await invoke<{ id: number; terminal_id: string; log_path: string | null }[]>('get_session_history');
          const session = sessions.find(s => s.terminal_id === id);
          if (!session?.log_path) return;

          const summary = await invoke<string | null>('summarize_session', { logPath: session.log_path });
          if (summary) {
            await invoke('save_session_summary', { terminalId: id, summary });
            setSessionSummary(id, summary);
          }
        } catch (err) {
          console.error('Failed to summarize session:', err);
        }
      })();
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [notifyOnFinish, notify, updateTerminalStatus, setSessionSummary]);
}
