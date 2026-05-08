import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';

/**
 * Listens for macOS native menubar events and dispatches the appropriate
 * store actions. Uses getState() so the effect never needs to re-register.
 */
export function useAppMenuEvents() {
  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      const appState = useAppStore.getState();
      switch (event.payload) {
        case 'menu-new-terminal':
          appState.openModal('newTerminal');
          break;
        case 'menu-close-terminal': {
          const activeId = useTerminalStore.getState().activeTerminalId;
          if (activeId) useTerminalStore.getState().closeTerminal(activeId);
          break;
        }
        case 'menu-toggle-sidebar':
          appState.toggleSidebar();
          break;
        case 'menu-toggle-hints':
          appState.toggleHints();
          break;
        case 'menu-toggle-grid':
          appState.toggleGridMode();
          break;
        case 'menu-find':
          appState.openModal('commandPalette');
          break;
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);
}
