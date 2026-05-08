import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Trash2, Clock, FileText, Download, Loader2, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';

interface SessionHistoryEntry {
  id: number;
  terminal_id: string;
  label: string;
  started_at: string;
  ended_at: string | null;
  log_path: string | null;
}

interface ContextMenuState {
  entry: SessionHistoryEntry;
  x: number;
  y: number;
}

type ExportFormat = 'markdown' | 'html' | 'gist' | 'text';

export function SessionHistory() {
  const { closeModal } = useAppStore();
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<SessionHistoryEntry | null>(null);
  const [logContent, setLogContent] = useState<string>('');
  const [loadingLog, setLoadingLog] = useState(false);

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Export feedback
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [copiedFormat, setCopiedFormat] = useState<ExportFormat | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handle = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [contextMenu]);

  const loadHistory = async () => {
    try {
      const history = await invoke<SessionHistoryEntry[]>('get_session_history');
      setEntries(history);
    } catch (err) {
      console.error('Failed to load session history:', err);
    }
  };

  const handleSelect = async (entry: SessionHistoryEntry) => {
    setSelectedEntry(entry);
    setLogContent('');
    if (entry.log_path) {
      setLoadingLog(true);
      try {
        const content = await invoke<string>('read_log_file', { path: entry.log_path });
        setLogContent(content);
      } catch (err) {
        setLogContent(`Failed to load log: ${err}`);
      } finally {
        setLoadingLog(false);
      }
    }
  };

  const handleDelete = async (entry: SessionHistoryEntry) => {
    try {
      await invoke('delete_session_history', { id: entry.id, logPath: entry.log_path });
      if (selectedEntry?.id === entry.id) {
        setSelectedEntry(null);
        setLogContent('');
      }
      await loadHistory();
    } catch (err) {
      console.error('Failed to delete session history:', err);
    }
  };

  const handleExport = async (entry: SessionHistoryEntry, format: ExportFormat) => {
    if (!entry.log_path) return;
    setContextMenu(null);
    setExporting(format);
    try {
      const result = await invoke<string>('export_session', {
        logPath: entry.log_path,
        label: entry.label,
        startedAt: entry.started_at,
        format,
      });

      if (format === 'gist') {
        // Open the returned Gist URL
        await invoke('open_external_url', { url: result });
      } else {
        // Copy formatted content to clipboard
        await navigator.clipboard.writeText(result);
        setCopiedFormat(format);
        setTimeout(() => setCopiedFormat(null), 2000);
      }
    } catch (err) {
      console.error(`Export (${format}) failed:`, err);
    } finally {
      setExporting(null);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return 'running';
    try {
      const ms = new Date(end).getTime() - new Date(start).getTime();
      const secs = Math.floor(ms / 1000);
      if (secs < 60) return `${secs}s`;
      const mins = Math.floor(secs / 60);
      if (mins < 60) return `${mins}m ${secs % 60}s`;
      const hours = Math.floor(mins / 60);
      return `${hours}h ${mins % 60}m`;
    } catch {
      return '';
    }
  };

  const exportItems: { format: ExportFormat; label: string; hint: string }[] = [
    { format: 'markdown', label: 'Copy as Markdown', hint: 'Code-fenced .md → clipboard' },
    { format: 'html', label: 'Copy as HTML', hint: 'Standalone HTML → clipboard' },
    { format: 'gist', label: 'Create GitHub Gist', hint: 'Upload & open in browser' },
    { format: 'text', label: 'Copy Plain Text', hint: 'Redacted text → clipboard' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-bg-elevated ring-1 ring-white/[0.08] rounded-lg shadow-2xl w-full max-w-4xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-text-secondary" />
            <h2 className="text-text-primary text-[14px] font-semibold">Session History</h2>
          </div>
          <button
            onClick={closeModal}
            className="p-1 rounded hover:bg-white/[0.06] text-text-tertiary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex h-[500px]">
          {/* Left: Entry List */}
          <div className="w-72 border-r border-border overflow-y-auto p-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                onClick={() => handleSelect(entry)}
                onContextMenu={(e) => {
                  if (!entry.log_path) return;
                  e.preventDefault();
                  setContextMenu({ entry, x: e.clientX, y: e.clientY });
                }}
                className={`group p-2.5 rounded-md cursor-pointer transition-colors mb-0.5 ${
                  selectedEntry?.id === entry.id
                    ? 'bg-accent-primary/10 ring-1 ring-accent-primary/30'
                    : 'hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary text-[12px] font-medium truncate">
                      {entry.label}
                    </p>
                    <p className="text-text-tertiary text-[11px] mt-0.5">
                      {formatDate(entry.started_at)}
                    </p>
                    <p className="text-text-tertiary text-[11px]">
                      Duration: {formatDuration(entry.started_at, entry.ended_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(entry);
                    }}
                    className="p-1 rounded hover:bg-red-500/10 text-text-tertiary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}

            {entries.length === 0 && (
              <p className="text-text-tertiary text-[12px] text-center py-8">
                No session history yet
              </p>
            )}
          </div>

          {/* Right: Log Preview */}
          <div className="flex-1 flex flex-col min-w-0">
            {selectedEntry ? (
              <>
                <div className="p-3 border-b border-border flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-text-secondary flex-shrink-0" />
                      <span className="text-text-primary text-[13px] font-medium truncate">
                        {selectedEntry.label}
                      </span>
                    </div>
                    <p className="text-text-tertiary text-[11px] mt-1">
                      {formatDate(selectedEntry.started_at)}
                      {selectedEntry.ended_at && ` — ${formatDate(selectedEntry.ended_at)}`}
                    </p>
                  </div>

                  {/* Export button (opens same context menu) */}
                  {selectedEntry.log_path && (
                    <button
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setContextMenu({
                          entry: selectedEntry,
                          x: rect.left,
                          y: rect.bottom + 4,
                        });
                      }}
                      disabled={exporting !== null}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11.5px] text-text-secondary hover:text-text-primary bg-white/[0.04] hover:bg-white/[0.08] transition-colors flex-shrink-0 disabled:opacity-50"
                      title="Export session (right-click any session)"
                    >
                      {exporting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : copiedFormat ? (
                        <Check size={12} className="text-green-400" />
                      ) : (
                        <Download size={12} />
                      )}
                      {copiedFormat ? 'Copied!' : 'Export'}
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-auto p-3">
                  {loadingLog ? (
                    <p className="text-text-tertiary text-[12px]">Loading log…</p>
                  ) : selectedEntry.log_path ? (
                    <pre className="text-text-secondary text-[11px] font-mono whitespace-pre-wrap break-words leading-relaxed">
                      {logContent}
                    </pre>
                  ) : (
                    <p className="text-text-tertiary text-[12px]">No log file available</p>
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-1 text-text-tertiary text-[13px]">
                <span>Select a session to view its log</span>
                <span className="text-[11px]">Right-click any session to export</span>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Right-click / Export context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
          className="bg-elevation-3 ring-1 ring-white/[0.12] rounded-lg shadow-elevation-3 py-1 min-w-[210px]"
        >
          <div className="px-3 py-1.5 border-b border-border mb-1">
            <p className="text-[11px] font-medium text-text-primary truncate max-w-[185px]">
              {contextMenu.entry.label}
            </p>
            <p className="text-[10px] text-text-tertiary">Export session</p>
          </div>
          {exportItems.map((item) => (
            <button
              key={item.format}
              onClick={() => handleExport(contextMenu.entry, item.format)}
              disabled={exporting !== null}
              className="w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-white/[0.06] transition-colors disabled:opacity-50"
            >
              <span className="text-[12px] text-text-primary">{item.label}</span>
              <span className="text-[10.5px] text-text-tertiary">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
