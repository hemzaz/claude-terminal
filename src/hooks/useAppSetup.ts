import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface SystemStatus {
  node_installed: boolean;
  node_version: string | null;
  npm_installed: boolean;
  npm_version: string | null;
  claude_installed: boolean;
  claude_version: string | null;
}

/**
 * Checks whether Claude Code is installed on startup.
 * Returns showSetup state — null while loading, true if setup needed, false if ready.
 */
export function useAppSetup() {
  const [showSetup, setShowSetup] = useState<boolean | null>(null);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const status = await invoke<SystemStatus>('check_system_requirements');
        setShowSetup(!status.claude_installed);
      } catch {
        setShowSetup(true);
      }
    };
    checkSetup();
  }, []);

  return { showSetup, setShowSetup };
}
