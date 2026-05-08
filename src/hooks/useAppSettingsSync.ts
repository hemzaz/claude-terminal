import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '../store/appStore';
import { reportError as catchError } from '../lib/reportError';

/**
 * Syncs persisted app settings to the Rust backend on mount and on change:
 * - errorReportingEnabled → set_error_reporting_enabled (once on mount)
 * - keybindingOverrides   → loadKeybindings() (once on mount)
 * - globalHotkey          → set_global_hotkey (on change)
 * - autoHideOnBlur        → window focus listener (on change)
 */
export function useAppSettingsSync() {
  const globalHotkey = useAppStore((s) => s.globalHotkey);
  const autoHideOnBlur = useAppStore((s) => s.autoHideOnBlur);
  const loadKeybindings = useAppStore((s) => s.loadKeybindings);

  // Push the persisted error-reporting preference to Rust on mount.
  // The Rust flag defaults to false, so until this fires no panics are reported.
  useEffect(() => {
    const enabled = useAppStore.getState().errorReportingEnabled;
    invoke('set_error_reporting_enabled', { enabled }).catch(catchError('set_error_reporting_enabled'));
  }, []);

  // Load keybinding overrides from disk on boot. Overrides are applied immediately;
  // changes to the file require a restart.
  useEffect(() => {
    loadKeybindings();
  }, [loadKeybindings]);

  // Register the global hotkey whenever the stored value changes.
  // An empty string disables it (Rust side unregisters all before re-registering).
  useEffect(() => {
    invoke('set_global_hotkey', { shortcut: globalHotkey }).catch(catchError('set_global_hotkey'));
  }, [globalHotkey]);

  // Auto-hide on blur: when the window loses focus, hide it so the hotkey can
  // summon it again. Only active when a hotkey is configured.
  useEffect(() => {
    if (!autoHideOnBlur || !globalHotkey) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) appWindow.hide().catch(() => { /* non-fatal: window hide can race with OS focus events */ });
      })
      .then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [autoHideOnBlur, globalHotkey]);
}
