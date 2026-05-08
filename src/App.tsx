import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { reportError } from './lib/errorReporter';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { TerminalTabs } from './components/TerminalTabs';
import { HintsPanel } from './components/HintsPanel';
import { FileChangesPanel } from './components/FileChangesPanel';
import { SettingsModal } from './components/SettingsModal';
import { ProfileModal } from './components/ProfileModal';
import { NewTerminalModal } from './components/NewTerminalModal';
import { WorkspaceModal } from './components/WorkspaceModal';
import { WorktreeModal } from './components/WorktreeModal';
import { SessionHistory } from './components/SessionHistory';
import { SnippetsModal } from './components/SnippetsModal';
import { CommandPalette } from './components/CommandPalette';
import { SetupWizard } from './components/SetupWizard';
import { AutoUpdater } from './components/AutoUpdater';
import { WhatsNewModal } from './components/WhatsNewModal';
import { ClaudeConfigModal } from './components/ClaudeConfigModal';
import { OrchestrationPanel } from './components/OrchestrationPanel';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { SessionTimeline } from './components/SessionTimeline';
import { MemoryEditor } from './components/MemoryEditor';
import { CostDashboard } from './components/CostDashboard';
import { StatusBar } from './components/StatusBar';
import { ToastContainer } from './components/ToastContainer';
import { useAppStore } from './store/appStore';
import { useCostStore } from './store/costStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAppSetup } from './hooks/useAppSetup';
import { useAppWhatsNew } from './hooks/useAppWhatsNew';
import { useAppUpdateSourceToast } from './hooks/useAppUpdateSourceToast';
import { useAppSettingsSync } from './hooks/useAppSettingsSync';
import { useAppTelemetry } from './hooks/useAppTelemetry';
import { useAppTerminalEvents } from './hooks/useAppTerminalEvents';
import { useAppMenuEvents } from './hooks/useAppMenuEvents';
import { useAppSession } from './hooks/useAppSession';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(
      error.name,
      error.message,
      `${error.stack ?? ''}\n\nReact stack:${info.componentStack ?? ''}`,
    );
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen bg-bg-primary flex items-center justify-center">
          <div className="text-center max-w-md p-6">
            <h2 className="text-text-primary text-lg font-semibold mb-2">Something went wrong</h2>
            <p className="text-text-secondary text-sm mb-4">
              The app hit an unexpected error. Reload to recover.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-accent-primary hover:bg-accent-secondary text-white px-4 py-2 rounded-md text-sm"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const { sidebarOpen, sidebarCollapsed, hintsOpen, changesOpen, orchestrationOpen, activeModal, showRestoreBanner, pendingRestoreConfigs } = useAppStore();
  const isCostDashboardOpen = useCostStore((s) => s.isOpen);

  useKeyboardShortcuts();
  const { showSetup, setShowSetup } = useAppSetup();
  useAppWhatsNew(showSetup);
  useAppUpdateSourceToast(showSetup);
  useAppSettingsSync();
  useAppTelemetry(showSetup);
  useAppTerminalEvents();
  useAppMenuEvents();
  const { handleRestore, handleDismissRestore } = useAppSession(showSetup);

  if (showSetup === null) {
    return (
      <div className="h-screen w-screen bg-bg-primary flex items-center justify-center">
        <div className="text-text-secondary text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-bg-primary flex flex-col overflow-hidden rounded-[4px] ring-1 ring-black/60">
      <AnimatePresence>
        {showSetup && (
          <SetupWizard onComplete={() => setShowSetup(false)} />
        )}
      </AnimatePresence>

      {!showSetup && (
        <>
          <AutoUpdater />

          {/* Restore Banner (F3) */}
          <AnimatePresence>
            {showRestoreBanner && pendingRestoreConfigs && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="bg-accent-primary/10 border-b border-accent-primary/20 overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-2.5">
                  <p className="text-text-primary text-[13px]">
                    Restore {pendingRestoreConfigs.length} terminal{pendingRestoreConfigs.length !== 1 ? 's' : ''} from your previous session?
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRestore}
                      className="bg-accent-primary hover:bg-accent-secondary text-white px-3 py-1 rounded-md text-[12px] font-medium transition-colors"
                    >
                      Restore
                    </button>
                    <button
                      onClick={handleDismissRestore}
                      className="text-text-secondary hover:text-text-primary px-3 py-1 rounded-md text-[12px] transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <TitleBar />

          <div className="flex-1 flex overflow-hidden">
            <AnimatePresence mode="wait">
              {sidebarOpen && (
                <div
                  className="h-full overflow-hidden transition-all duration-200 ease-out"
                  style={{ width: sidebarCollapsed ? 48 : 280 }}
                >
                  <Sidebar />
                </div>
              )}
            </AnimatePresence>

            <main className="flex-1 flex flex-col overflow-hidden">
              <TerminalTabs />
            </main>

            <AnimatePresence mode="wait">
              {changesOpen && (
                <div
                  className="h-full overflow-hidden transition-all duration-150 ease-out"
                  style={{ width: 420 }}
                >
                  <FileChangesPanel />
                </div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {orchestrationOpen && (
                <div
                  className="h-full overflow-hidden transition-all duration-150 ease-out"
                  style={{ width: 320 }}
                >
                  <OrchestrationPanel />
                </div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {hintsOpen && (
                <div
                  className="h-full overflow-hidden transition-all duration-150 ease-out"
                  style={{ width: 320 }}
                >
                  <HintsPanel />
                </div>
              )}
            </AnimatePresence>
          </div>

          <StatusBar />

          <AnimatePresence>
            {activeModal === 'settings' && <SettingsModal />}
            {activeModal === 'profile' && <ProfileModal />}
            {activeModal === 'newTerminal' && <NewTerminalModal />}
            {activeModal === 'workspace' && <WorkspaceModal />}
            {activeModal === 'worktree' && <WorktreeModal />}
            {activeModal === 'sessionHistory' && <SessionHistory />}
            {activeModal === 'snippets' && <SnippetsModal />}
            {activeModal === 'whatsNew' && <WhatsNewModal />}
            {activeModal === 'claudeConfig' && <ClaudeConfigModal />}
            {activeModal === 'sessionTimeline' && <SessionTimeline />}
            {activeModal === 'memoryEditor' && <MemoryEditor />}
          </AnimatePresence>
          {activeModal === 'commandPalette' && <CommandPalette />}
          <AnimatePresence>
            {activeModal === 'globalSearch' && <GlobalSearchModal />}
          </AnimatePresence>
          <AnimatePresence>
            {isCostDashboardOpen && <CostDashboard />}
          </AnimatePresence>
        </>
      )}

      <ToastContainer />
    </div>
  );
}

function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithBoundary;
