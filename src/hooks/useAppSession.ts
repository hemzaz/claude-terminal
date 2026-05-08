import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';
import { toast } from '../store/toastStore';

interface SavedTerminalConfig {
  id: string;
  label: string;
  nickname: string | null;
  working_directory: string;
  claude_args: string[];
  env_vars: Record<string, string>;
  color_tag: string | null;
  pinned?: boolean;
}

/**
 * Manages session persistence:
 * - Restores the previous session (or silently reopens pinned tabs) on startup.
 * - Auto-saves the session every 30 seconds.
 * Returns handleRestore and handleDismissRestore for the restore banner UI.
 */
export function useAppSession(showSetup: boolean | null) {
  const restoreSession = useAppStore((s) => s.restoreSession);
  const pendingRestoreConfigs = useAppStore((s) => s.pendingRestoreConfigs);
  const setPendingRestoreConfigs = useAppStore((s) => s.setPendingRestoreConfigs);
  const setShowRestoreBanner = useAppStore((s) => s.setShowRestoreBanner);
  const createTerminal = useTerminalStore((s) => s.createTerminal);

  // Restore previous session on startup.
  // - restoreSession=true: show restore banner for all saved tabs.
  // - restoreSession=false: silently reopen only pinned tabs.
  useEffect(() => {
    if (showSetup !== false) return;

    const checkLastSession = async () => {
      try {
        const configs = await invoke<SavedTerminalConfig[] | null>('get_last_session');
        if (!configs || configs.length === 0) return;

        if (restoreSession) {
          setPendingRestoreConfigs(configs);
          setShowRestoreBanner(true);
        } else {
          // Silently restore pinned tabs regardless of restoreSession setting
          const pinned = configs.filter((c) => c.pinned);
          if (pinned.length === 0) return;
          for (const config of pinned) {
            try {
              await createTerminal(
                config.label,
                config.working_directory,
                config.claude_args,
                config.env_vars,
                config.color_tag ?? undefined,
                config.nickname ?? undefined,
              );
            } catch (err) {
              console.error('Failed to restore pinned terminal:', config.label, err);
            }
          }
        }
      } catch (err) {
        console.error('Failed to check last session:', err);
      }
    };

    checkLastSession();
  }, [showSetup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save session every 30 seconds
  useEffect(() => {
    if (showSetup !== false) return;

    const interval = setInterval(() => {
      invoke('save_session_for_restore').catch((err) => {
        console.error('Failed to auto-save session:', err);
      });
    }, 30000);

    return () => clearInterval(interval);
  }, [showSetup]);

  const handleRestore = async () => {
    if (!pendingRestoreConfigs) return;
    await invoke('clear_last_session');

    // Pre-fetch log content for all terminals in parallel
    const logPromises = pendingRestoreConfigs.map(async (config) => {
      if (!config.id) return null;
      try {
        return await invoke<string | null>('get_session_log', { terminalId: config.id });
      } catch {
        return null;
      }
    });
    const logs = await Promise.all(logPromises);

    for (let i = 0; i < pendingRestoreConfigs.length; i++) {
      const config = pendingRestoreConfigs[i];
      try {
        await createTerminal(
          config.label,
          config.working_directory,
          config.claude_args,
          config.env_vars,
          config.color_tag ?? undefined,
          config.nickname ?? undefined,
          logs[i] ?? undefined,
        );
      } catch (err) {
        console.error('Failed to restore terminal:', config.label, err);
      }
    }
    toast.success(
      'Session Restored',
      `${pendingRestoreConfigs.length} terminal${pendingRestoreConfigs.length !== 1 ? 's' : ''} restored.`,
    );
    setShowRestoreBanner(false);
    setPendingRestoreConfigs(null);
  };

  const handleDismissRestore = async () => {
    await invoke('clear_last_session');
    setShowRestoreBanner(false);
    setPendingRestoreConfigs(null);
  };

  return { handleRestore, handleDismissRestore };
}
