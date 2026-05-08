import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { toast } from '../store/toastStore';

/**
 * First-launch macOS hint: surfaces the update-source toggle (Homebrew vs in-app).
 * Only fires once; seenUpdateSourceToast is persisted so it survives restarts.
 */
export function useAppUpdateSourceToast(showSetup: boolean | null) {
  const seenUpdateSourceToast = useAppStore((s) => s.seenUpdateSourceToast);
  const setSeenUpdateSourceToast = useAppStore((s) => s.setSeenUpdateSourceToast);
  const openModal = useAppStore((s) => s.openModal);

  useEffect(() => {
    if (showSetup !== false) return;
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    if (!isMac || seenUpdateSourceToast) return;
    setSeenUpdateSourceToast(true);
    toast.info(
      'macOS Update Source',
      'Updates use Homebrew by default. Tap to change in Settings.',
      0, // indefinite — user must dismiss
      () => openModal('settings'),
    );
  }, [showSetup, seenUpdateSourceToast, setSeenUpdateSourceToast, openModal]);
}
