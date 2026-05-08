import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { reportError } from '../lib/reportError';
import { useTerminalStore } from '../store/terminalStore';
import { useAppStore } from '../store/appStore';
import { CLAUDE_MODELS } from '../lib/models';
import {
  Terminal,
  Cpu,
  Bell,
  BellOff,
  ArrowDownCircle,
  Columns,
  LayoutGrid,
} from 'lucide-react';

// Derive status-bar widget styles from the central model registry.
// Uses /15 opacity tints (lighter than badge chips at /20).
const MODEL_COLORS = Object.fromEntries(
  CLAUDE_MODELS.filter((m) => m.id !== 'default').map(({ id, label, badge }) => {
    const [badgeBg, text] = badge.split(' ');
    return [id, { bg: badgeBg.replace('/20', '/15'), text, label }];
  })
);

const STATUS_COLORS: Record<string, string> = {
  Running: 'text-success',
  Idle: 'text-warning',
  Stopped: 'text-text-tertiary',
  Error: 'text-error',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  Running: 'bg-success',
  Idle: 'bg-warning',
  Stopped: 'bg-text-tertiary',
  Error: 'bg-error',
};

export function StatusBar() {
  const { terminals, activeTerminalId } = useTerminalStore();
  const {
    toggleSidebar,
    gridMode,
    toggleGridMode,
    notifyOnFinish,
    setNotifyOnFinish,
    openModal,
  } = useAppStore();

  const [appVersion, setAppVersion] = useState('');
  const [claudeVersion, setClaudeVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(reportError('getVersion'));
    invoke<string>('get_claude_version')
      .then((v) => setClaudeVersion(v))
      .catch(() => setClaudeVersion(null));
  }, []);

  const terminalCount = terminals.size;
  const runningCount = Array.from(terminals.values()).filter(
    (t) => t.config.status === 'Running'
  ).length;

  const activeTerminal = activeTerminalId ? terminals.get(activeTerminalId) : null;
  const activeStatus = activeTerminal?.config.status || 'Stopped';
  const activeModel = activeTerminal?.model;

  // Resolve model display
  const modelKey = activeModel
    ? Object.keys(MODEL_COLORS).find((k) => activeModel.toLowerCase().includes(k))
    : null;
  const modelInfo = modelKey ? MODEL_COLORS[modelKey] : null;

  return (
    <div className="h-[22px] flex items-center justify-between pl-2 pr-1 bg-elevation-1 border-t border-[var(--ij-divider)] text-[11px] select-none shrink-0">
      {/* Left side */}
      <div className="flex items-center gap-0.5">
        {/* Terminal count */}
        <button
          onClick={toggleSidebar}
          className="flex items-center gap-1.5 h-[18px] px-1.5 rounded-[3px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
          title="Toggle sidebar"
        >
          <Terminal size={11} strokeWidth={1.75} />
          <span>
            {runningCount > 0
              ? `${runningCount}/${terminalCount} running`
              : `${terminalCount} terminal${terminalCount !== 1 ? 's' : ''}`}
          </span>
        </button>

        <span className="text-text-tertiary/50 px-1">·</span>

        {/* Active terminal status */}
        {activeTerminal && (
          <div className="flex items-center gap-1.5 h-[18px] px-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_COLORS[activeStatus]}`}
              title={activeStatus}
            />
            <span className={`${STATUS_COLORS[activeStatus]} font-medium truncate max-w-[180px]`}>
              {activeTerminal.config.nickname || activeTerminal.config.label}
            </span>
          </div>
        )}

        {activeTerminal && <span className="text-text-tertiary/50 px-1">·</span>}

        {/* Grid/Split indicator */}
        <button
          onClick={toggleGridMode}
          className={`flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] transition-colors ${
            gridMode
              ? 'text-accent-primary hover:bg-accent-primary/12'
              : 'text-text-tertiary hover:bg-white/[0.06] hover:text-text-secondary'
          }`}
          title={gridMode ? 'Exit grid mode' : 'Enter grid mode'}
        >
          {gridMode ? <LayoutGrid size={10} strokeWidth={1.75} /> : <Columns size={10} strokeWidth={1.75} />}
          <span>{gridMode ? 'Grid' : 'Tabs'}</span>
        </button>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-0.5">
        {/* Model indicator */}
        {modelInfo && (
          <div
            className={`flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] ${modelInfo.bg}`}
          >
            <Cpu size={10} className={modelInfo.text} strokeWidth={1.75} />
            <span className={`${modelInfo.text} font-medium`}>
              {modelInfo.label}
            </span>
          </div>
        )}

        {/* Notifications toggle */}
        <button
          onClick={() => setNotifyOnFinish(!notifyOnFinish)}
          className={`flex items-center h-[18px] w-[22px] justify-center rounded-[3px] transition-colors hover:bg-white/[0.06] ${
            notifyOnFinish ? 'text-text-secondary hover:text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
          }`}
          title={notifyOnFinish ? 'Notifications on' : 'Notifications off'}
        >
          {notifyOnFinish ? <Bell size={11} strokeWidth={1.75} /> : <BellOff size={11} strokeWidth={1.75} />}
        </button>

        {/* Claude version */}
        {claudeVersion && (
          <button
            onClick={() => openModal('settings')}
            className="flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] text-text-tertiary hover:bg-white/[0.06] hover:text-text-secondary transition-colors"
            title="Open settings"
          >
            <ArrowDownCircle size={10} strokeWidth={1.75} />
            <span>Claude {claudeVersion}</span>
          </button>
        )}

        {/* App version */}
        <span className="text-text-tertiary px-1.5 font-mono" title={`ClaudeTerminal v${appVersion}`}>
          v{appVersion}
        </span>
      </div>
    </div>
  );
}
