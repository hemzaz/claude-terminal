import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus, Search, MoreVertical, Copy, Trash2, Edit3, Tag, Grid3X3, FolderOpen, Clock, FileText, Settings, GitBranch, GitFork, Brain, GripVertical, ChevronsLeft, ChevronsRight, UserCog, ChevronDown, ChevronRight, BarChart2 } from 'lucide-react';
import { useTerminalStore } from '../store/terminalStore';
import { useAppStore } from '../store/appStore';
import { useCostStore } from '../store/costStore';
import { setDragData } from '../utils/dragDrop';
import { FileTreePanel } from './FileTreePanel';
import { modelBadge } from '../lib/models';

const STATUS_COLORS = {
  Running: 'bg-success',
  Idle: 'bg-warning',
  Error: 'bg-error',
  Stopped: 'bg-text-tertiary',
};

const STATUS_LABELS: Record<string, string> = {
  Running: 'running',
  Idle: 'idle',
  Error: 'error',
  Stopped: 'stopped',
};

export function Sidebar() {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNicknameId, setEditingNicknameId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const { terminals, activeTerminalId, setActiveTerminal, closeTerminal, updateLabel, updateNickname, unreadTerminalIds, gitInfoCache } = useTerminalStore();
  const { sidebarCollapsed, toggleSidebarCollapse, openModal, addToGrid, removeFromGrid, gridTerminalIds, setGridMode, showFileTree, explorerHeightRatio, setExplorerHeightRatio, toolsCollapsed, toggleToolsCollapsed } = useAppStore();
  const { openDashboard: openCostDashboard } = useCostStore();

  // Splitter between terminal list and Explorer. Measures the stack's bounding
  // rect during drag so the ratio is always computed relative to the sidebar's
  // current height, not a cached value.
  const splitStackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const onSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const el = splitStackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;
      const y = e.clientY - rect.top;
      // explorerHeightRatio is the explorer's share, so it's 1 - (terminalShare)
      const terminalShare = y / rect.height;
      setExplorerHeightRatio(1 - terminalShare);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setExplorerHeightRatio]);

  const terminalList = useMemo(() =>
    Array.from(terminals.values())
      // Script children belong under their parent in the main area, and
      // bottom-pane shells belong in the BottomTerminalPane — neither
      // appears in the sidebar.
      .filter(t => !t.scriptParentId && !t.isShellTerminal)
      .map(t => t.config)
      .filter(t => {
        const searchLower = search.toLowerCase();
        return t.label.toLowerCase().includes(searchLower) ||
          (t.nickname && t.nickname.toLowerCase().includes(searchLower));
      }),
    [terminals, search]
  );

  const handleNewTerminal = () => {
    openModal('newTerminal');
  };

  const handleRename = async (id: string, newLabel: string) => {
    await updateLabel(id, newLabel);
    setEditingId(null);
  };

  const handleNicknameChange = async (id: string, newNickname: string) => {
    await updateNickname(id, newNickname);
    setEditingNicknameId(null);
  };

  // ─── Collapsed icon-rail mode (IntelliJ tool-window rail) ───
  if (sidebarCollapsed) {
    return (
      <div className="h-full bg-elevation-1 border-r border-[var(--ij-divider)] flex flex-col items-center py-2 gap-0.5" style={{ width: 48 }}>
        <button
          onClick={handleNewTerminal}
          className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-accent-primary hover:bg-accent-secondary text-white transition-colors shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]"
          title="New Terminal"
        >
          <Plus size={15} strokeWidth={2} />
        </button>
        <div className="h-px w-6 bg-[var(--ij-divider-soft)] my-2" />
        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-0.5 w-full px-1">
          {Array.from(terminals.values()).filter((instance) => !instance.scriptParentId).map((instance) => {
            const t = instance.config;
            const isActive = activeTerminalId === t.id;
            const hasUnread = unreadTerminalIds.has(t.id) && !isActive;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTerminal(t.id)}
                className={`relative w-8 h-8 flex items-center justify-center rounded-[6px] transition-colors ${
                  isActive ? 'bg-accent-primary/20 text-accent-primary' : 'hover:bg-white/[0.06]'
                }`}
                title={`${t.nickname || t.label} (${t.status})`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r bg-accent-primary" />
                )}
                <div className={`w-2.5 h-2.5 rounded-full ${t.color_tag || STATUS_COLORS[t.status]}`} />
                {hasUnread && (
                  <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
        <div className="h-px w-6 bg-[var(--ij-divider-soft)] my-2" />
        <button onClick={() => openModal('workspace')} className="w-8 h-8 flex items-center justify-center rounded-[6px] hover:bg-white/[0.06] text-text-secondary hover:text-text-primary transition-colors" title="Workspaces"><FolderOpen size={14} strokeWidth={1.75} /></button>
        <button onClick={() => openModal('snippets')} className="w-8 h-8 flex items-center justify-center rounded-[6px] hover:bg-white/[0.06] text-text-secondary hover:text-text-primary transition-colors" title="Snippets"><FileText size={14} strokeWidth={1.75} /></button>
        <button onClick={() => openModal('sessionHistory')} className="w-8 h-8 flex items-center justify-center rounded-[6px] hover:bg-white/[0.06] text-text-secondary hover:text-text-primary transition-colors" title="Session History"><Clock size={14} strokeWidth={1.75} /></button>
        <button onClick={() => openModal('profile')} className="w-8 h-8 flex items-center justify-center rounded-[6px] hover:bg-white/[0.06] text-text-secondary hover:text-text-primary transition-colors" title="Profiles"><Settings size={14} strokeWidth={1.75} /></button>
        <button onClick={toggleSidebarCollapse} className="w-8 h-8 flex items-center justify-center rounded-[6px] hover:bg-white/[0.06] text-text-tertiary hover:text-text-secondary transition-colors mt-1" title="Expand sidebar"><ChevronsRight size={14} strokeWidth={1.75} /></button>
      </div>
    );
  }

  // ─── Full expanded mode (IntelliJ tool window) ───
  return (
    <div className="h-full bg-elevation-1 border-r border-[var(--ij-divider)] flex flex-col">
      {/* Tool-window header */}
      <div className="flex items-center justify-between h-[30px] px-3 border-b border-[var(--ij-divider-soft)]">
        <span className="text-text-secondary text-[11px] font-semibold uppercase tracking-[0.06em]">
          Terminals
        </span>
        <button
          onClick={toggleSidebarCollapse}
          className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-white/[0.06] text-text-tertiary hover:text-text-secondary transition-colors"
          title="Collapse sidebar"
        >
          <ChevronsLeft size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Actions + search */}
      <div className="px-2 pt-2 pb-2 border-b border-[var(--ij-divider-soft)]">
        <button
          onClick={handleNewTerminal}
          className="w-full flex items-center justify-center gap-2 bg-accent-primary hover:bg-accent-secondary text-white h-8 px-3 rounded-[6px] font-medium text-[12.5px] transition-colors shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]"
        >
          <Plus size={14} strokeWidth={2.25} />
          New Terminal
        </button>

        <div className="mt-2 relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="Filter terminals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-elevation-0 ring-1 ring-inset ring-[var(--ij-divider)] rounded-[4px] h-7 pl-7 pr-2 text-[12px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-accent-primary/60 transition-colors"
          />
        </div>
      </div>

      {/* Terminal list + Explorer stack (with draggable splitter between them when showFileTree) */}
      <div ref={splitStackRef} className="flex-1 min-h-0 flex flex-col">
      {/* Terminal List */}
      <div
        className="min-h-0 overflow-y-auto p-1.5"
        style={showFileTree ? { flex: `${1 - explorerHeightRatio} 1 0` } : { flex: '1 1 0' }}
      >
        {terminalList.map((terminal) => (
          <div
            key={terminal.id}
            draggable
            onDragStart={(e) => {
              setDragData(e, { terminalId: terminal.id, source: 'sidebar' });
              setDraggingId(terminal.id);
              if (e.dataTransfer.setDragImage) {
                const el = e.currentTarget;
                e.dataTransfer.setDragImage(el, 20, 20);
              }
            }}
            onDragEnd={() => setDraggingId(null)}
            onClick={() => setActiveTerminal(terminal.id)}
            className={`group relative py-2 pl-3 pr-2 rounded-[4px] mb-px cursor-pointer transition-colors ${
              draggingId === terminal.id ? 'opacity-40' : ''
            } ${
              activeTerminalId === terminal.id
                ? 'bg-accent-primary/18 text-text-primary'
                : 'hover:bg-white/[0.045]'
            }`}
          >
            {activeTerminalId === terminal.id && (
              <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r bg-accent-primary" />
            )}
            <div className="flex items-start gap-2.5">
              <GripVertical size={12} className="mt-1.5 text-text-tertiary opacity-0 group-hover:opacity-50 flex-shrink-0 cursor-grab" />
              {/* Color Tag & Status & Unread */}
              <div className="mt-1.5 flex items-center gap-1.5 flex-shrink-0">
                {terminal.color_tag && (
                  <div className={`w-2 h-2 rounded-full ${terminal.color_tag} flex-shrink-0`} />
                )}
                <div className="relative">
                  <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[terminal.status]}`} />
                  {unreadTerminalIds.has(terminal.id) && activeTerminalId !== terminal.id && (
                    <div className="absolute -top-1 -right-1.5 w-1.5 h-1.5 rounded-full bg-accent-primary" />
                  )}
                </div>
              </div>

              {/* Label & Info */}
              <div className="flex-1 min-w-0">
                {editingId === terminal.id ? (
                  <input
                    autoFocus
                    defaultValue={terminal.label}
                    onBlur={(e) => handleRename(terminal.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(terminal.id, e.currentTarget.value);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="w-full bg-transparent border-b border-accent-primary text-text-primary text-[12px] focus:outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : editingNicknameId === terminal.id ? (
                  <input
                    autoFocus
                    defaultValue={terminal.nickname || ''}
                    placeholder="Enter nickname..."
                    onBlur={(e) => handleNicknameChange(terminal.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleNicknameChange(terminal.id, e.currentTarget.value);
                      if (e.key === 'Escape') setEditingNicknameId(null);
                    }}
                    className="w-full bg-transparent border-b border-accent-primary text-text-primary text-[12px] focus:outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <p className="text-text-primary text-[12px] font-medium truncate">
                        {terminal.nickname || terminal.label}
                      </p>
                      <span className={`text-[11px] ${
                        terminal.status === 'Running' ? 'text-success' :
                        terminal.status === 'Error' ? 'text-error' :
                        'text-text-tertiary'
                      }`}>
                        {STATUS_LABELS[terminal.status]}
                      </span>
                      {(() => {
                        const instance = terminals.get(terminal.id);
                        return (
                          <>
                            {instance?.isWorktree && (
                              <GitBranch size={10} className="text-cyan-400 flex-shrink-0" />
                            )}
                            {instance?.loopInfo && (
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse flex-shrink-0" title={`Loop: ${instance.loopInfo.interval}`} />
                            )}
                            {instance?.model && (
                              <span className={`text-[9px] px-1 rounded font-medium flex-shrink-0 ${modelBadge(instance.model)}`}>
                                {instance.model}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    {gitInfoCache.get(terminal.id)?.is_git_repo && (
                      <div className="flex items-center gap-1 mt-0.5">
                        {gitInfoCache.get(terminal.id)?.is_worktree ? (
                          <GitFork size={11} className="text-purple-400 flex-shrink-0" />
                        ) : (
                          <GitBranch size={11} className="text-accent-primary flex-shrink-0" />
                        )}
                        <span className={`text-[11px] font-mono truncate ${
                          gitInfoCache.get(terminal.id)?.is_worktree ? 'text-purple-400' : 'text-accent-primary'
                        }`}>
                          {gitInfoCache.get(terminal.id)?.current_branch || '(detached)'}
                        </span>
                        {gitInfoCache.get(terminal.id)?.is_worktree && (
                          <span className="text-[10px] px-1 rounded bg-purple-400/10 text-purple-400 flex-shrink-0">
                            worktree
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-text-tertiary text-[11px] truncate mt-0.5">
                      {terminal.working_directory}
                    </p>
                  </>
                )}
              </div>

              {/* Actions Menu */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === terminal.id ? null : terminal.id);
                  }}
                  className="p-0.5 rounded hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical size={14} className="text-text-secondary" />
                </button>

                <AnimatePresence>
                  {menuOpenId === terminal.id && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(null);
                        }}
                      />
                      <div className="absolute right-0 top-full mt-1 bg-elevation-3 ring-1 ring-white/[0.08] rounded-lg shadow-elevation-3 py-1 min-w-[140px] z-50">
                        {gridTerminalIds.includes(terminal.id) ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromGrid(terminal.id);
                              setMenuOpenId(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-accent-primary hover:bg-accent-primary/10"
                          >
                            <Grid3X3 size={14} /> Remove from Grid
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addToGrid(terminal.id);
                              setGridMode(true);
                              setMenuOpenId(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-white/[0.04]"
                          >
                            <Grid3X3 size={14} /> Add to Grid
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNicknameId(terminal.id);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-white/[0.04]"
                        >
                          <Tag size={14} /> Set Nickname
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(terminal.id);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-white/[0.04]"
                        >
                          <Edit3 size={14} /> Rename
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-white/[0.04]"
                        >
                          <Copy size={14} /> Duplicate
                        </button>
                        {gitInfoCache.get(terminal.id)?.is_git_repo && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const gitInfo = gitInfoCache.get(terminal.id);
                              const repoPath = gitInfo?.is_worktree
                                ? gitInfo.main_repo_path || terminal.working_directory
                                : terminal.working_directory;
                              openModal('worktree', { repoPath });
                              setMenuOpenId(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-white/[0.04]"
                          >
                            <GitFork size={14} /> Worktrees...
                          </button>
                        )}
                        <div className="h-px bg-border my-1" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTerminal(terminal.id);
                            setMenuOpenId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 size={14} /> Close
                        </button>
                      </div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        ))}

        {terminalList.length === 0 && (
          <div className="text-center text-text-tertiary text-[12px] py-8">
            {search ? 'No terminals found' : 'No terminals yet'}
          </div>
        )}
      </div>

      {/* Explorer (file tree) — with a draggable splitter above it */}
      {showFileTree && (
        <>
          <div
            onMouseDown={onSplitterMouseDown}
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize Explorer"
            className="h-1 shrink-0 cursor-row-resize bg-transparent hover:bg-accent-primary/50 active:bg-accent-primary/70 transition-colors"
          />
          <div
            className="min-h-0 flex flex-col"
            style={{ flex: `${explorerHeightRatio} 1 0` }}
          >
            <FileTreePanel />
          </div>
        </>
      )}
      </div>

      {/* Footer — collapsible tool links so the Explorer above can claim
          the freed vertical space when collapsed (the default). */}
      <div className="border-t border-[var(--ij-divider-soft)] flex-shrink-0">
        <button
          onClick={toggleToolsCollapsed}
          aria-expanded={!toolsCollapsed}
          className="w-full flex items-center gap-1.5 h-[26px] px-3 text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
          title={toolsCollapsed ? 'Show tools' : 'Hide tools'}
        >
          {toolsCollapsed ? (
            <ChevronRight size={11} className="text-text-tertiary" strokeWidth={2} />
          ) : (
            <ChevronDown size={11} className="text-text-tertiary" strokeWidth={2} />
          )}
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">Tools</span>
        </button>
        {!toolsCollapsed && (
          <div className="p-1.5 pt-0 space-y-px">
            <button
              onClick={() => openModal('workspace')}
              className="w-full flex items-center justify-start gap-1.5 text-text-secondary hover:text-text-primary text-[12px] py-1 px-2 hover:bg-white/[0.05] rounded-[4px] transition-colors"
            >
              <FolderOpen size={13} />
              Workspaces
            </button>
            <button
              onClick={() => openModal('sessionHistory')}
              className="w-full flex items-center justify-start gap-1.5 text-text-secondary hover:text-text-primary text-[12px] py-1 px-2 hover:bg-white/[0.05] rounded-[4px] transition-colors"
            >
              <Clock size={13} />
              Session History
            </button>
            <button
              onClick={() => openModal('snippets')}
              className="w-full flex items-center justify-start gap-1.5 text-text-secondary hover:text-text-primary text-[12px] py-1 px-2 hover:bg-white/[0.05] rounded-[4px] transition-colors"
            >
              <FileText size={13} />
              Snippets
            </button>
            <button
              onClick={() => openModal('sessionTimeline')}
              className="w-full flex items-center justify-start gap-1.5 text-text-secondary hover:text-text-primary text-[12px] py-1 px-2 hover:bg-white/[0.05] rounded-[4px] transition-colors"
            >
              <Clock size={13} />
              Session Timeline
            </button>
            <button
              onClick={() => openModal('claudeConfig')}
              className="w-full flex items-center justify-start gap-1.5 text-text-secondary hover:text-text-primary text-[12px] py-1 px-2 hover:bg-white/[0.05] rounded-[4px] transition-colors"
            >
              <Settings size={13} />
              Claude Config
            </button>
            <button
              onClick={() => openModal('memoryEditor')}
              className="w-full flex items-center justify-start gap-1.5 text-text-secondary hover:text-text-primary text-[12px] py-1 px-2 hover:bg-white/[0.05] rounded-[4px] transition-colors"
            >
              <Brain size={13} />
              Memory Editor
            </button>
            <button
              onClick={() => openModal('profile')}
              className="w-full flex items-center justify-start gap-1.5 text-text-secondary hover:text-text-primary text-[12px] py-1 px-2 hover:bg-white/[0.05] rounded-[4px] transition-colors"
            >
              <UserCog size={13} />
              Manage Profiles
            </button>
            <button
              onClick={openCostDashboard}
              className="w-full flex items-center justify-start gap-1.5 text-text-secondary hover:text-text-primary text-[12px] py-1 px-2 hover:bg-white/[0.05] rounded-[4px] transition-colors"
            >
              <BarChart2 size={13} />
              Cost Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
