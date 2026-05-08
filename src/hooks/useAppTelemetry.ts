import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { useAppStore } from '../store/appStore';

/**
 * Fires a telemetry heartbeat on startup then every 5 minutes.
 * Does nothing until setup is complete (showSetup === false).
 */
export function useAppTelemetry(showSetup: boolean | null) {
  useEffect(() => {
    if (showSetup !== false) return;

    const sendHeartbeat = () => {
      const enabled = useAppStore.getState().telemetryEnabled;
      getVersion().then((appVersion) => {
        invoke('send_telemetry_heartbeat', { enabled, appVersion }).catch(() => {});
      });
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [showSetup]);
}
