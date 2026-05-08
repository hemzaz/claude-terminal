import { useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useAppStore } from '../store/appStore';

/**
 * After setup is confirmed, checks whether the app version changed since the
 * last launch and opens the What's New modal if so.
 */
export function useAppWhatsNew(showSetup: boolean | null) {
  const lastSeenVersion = useAppStore((s) => s.lastSeenVersion);
  const setLastSeenVersion = useAppStore((s) => s.setLastSeenVersion);
  const openModal = useAppStore((s) => s.openModal);

  useEffect(() => {
    if (showSetup !== false) return;

    const checkWhatsNew = async () => {
      try {
        const currentVersion = await getVersion();
        if (!lastSeenVersion) {
          // Fresh install — just record the current version, no popup
          setLastSeenVersion(currentVersion);
        } else if (lastSeenVersion !== currentVersion) {
          openModal('whatsNew');
        }
      } catch (err) {
        console.error('Failed to check version for What\'s New:', err);
      }
    };

    checkWhatsNew();
  }, [showSetup, lastSeenVersion, setLastSeenVersion, openModal]);
}
