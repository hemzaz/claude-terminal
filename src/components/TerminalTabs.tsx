import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Reorder } from 'framer-motion';
import { X, Plus, Grid3X3, SplitSquareHorizontal, RotateCw, GitBranch, ChevronLeft, ChevronRight, Copy, File as FileIcon, AlertTriangle, Minimize2, Pin } from 'lucide-react';
import { useTerminalStore } from '../store/terminalStore';
import { useAppStore } from '../store/appStore';
import { TerminalView } from './TerminalView';
import { TerminalGrid } from './TerminalGrid';
import { SplitView } from './SplitView';
import { SessionInsights } from './SessionInsights';
import { FileEditorView } from './FileEditorView';
import { ScriptsMenu } from './ScriptsMenu';
import { ScriptChildPane } from './ScriptChildPane';
import { BottomTerminalPane } from './BottomTerminalPane';
import { getDragData, isTerminalDrag } from '../utils/dragDrop';
import { WelcomePanel } from './WelcomePanel';

function fileBasename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}


export function TerminalTabs() {
  const { terminals, activeTerminalId, setActiveTerminal, closeTerminal, unreadTerminalIds, gitInfoCache, reorderTerminals, scriptChildren, closeScript, writeToTerminal, setPinned } = useTerminalStore();
  const { openModal, gridMode, toggleGridMode, addToGrid, gridTerminalIds, splitMode, splitTerminalIds, splitOrientation, splitRatio, setSplitOrientation, setSplitRatio, clearSplit, setSplitTerminals, setSplitMode, openFiles, activeFilePath, setActiveFilePath, closeFileTab, showFileTree } = useAppStore();

  // Selecting a terminal clears the file-tab focus (so terminal view shows),
  // selecting a file clears the terminal focus-visual intent.
  const focusTerminal = useCallback((id: string) => {
    setActiveFilePath(null);
    setActiveTerminal(id);
  }, [setActiveFilePath, setActiveTerminal]);

  const focusFile = useCallback((path: string) => {
    setActiveFilePath(path);
  }, [setActiveFilePath]);
  // Script-child terminals are rendered below their parent and bottom-pane
  // shells are rendered in BottomTerminalPane — neither belongs in the main
  // tab bar.
  const terminalList = useMemo(
    () =>
      Array.from(terminals.values())
        .filter((t) => !t.scriptParentId && !t.isShellTerminal)
        .map((t) => t.config)
        .sort((a, b) => {
          // Pinned tabs always come first; within each group preserve insertion order
          if (a.pinned === b.pinned) return 0;
          return a.pinned ? -1 : 1;
        }),
    [terminals]
  );

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{ terminalId: string; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu]);

  const handleNewTab = () => {
    openModal('newTerminal');
  };

  const handleAddToGrid = (terminalId: string) => {
    addToGrid(terminalId);
    if (!gridMode) {
      toggleGridMode();
    }
  };

  const [splitDropTargetId, setSplitDropTargetId] = useState<string | null>(null);

  const handleSplitWith = (terminalId: string) => {
    if (activeTerminalId && terminalId !== activeTerminalId) {
      setSplitTerminals([activeTerminalId, terminalId]);
      setSplitMode(true);
    }
  };

  const { createTerminal } = useTerminalStore();
  const handleDuplicate = (terminalId: string) => {
    const instance = terminals.get(terminalId);
    if (!instance) return;
    const { label, working_directory, claude_args, env_vars, color_tag, nickname } = instance.config;
    createTerminal(
      label,
      working_directory,
      claude_args,
      env_vars,
      color_tag ?? undefined,
      nickname ?? undefined,
    );
  };

  const handleTabDragOver = useCallback((e: React.DragEvent, tabTerminalId: string) => {
    if (isTerminalDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setSplitDropTargetId(tabTerminalId);
    }
  }, []);

  const handleTabDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setSplitDropTargetId(null);
    }
  }, []);

  const handleTabDrop = useCallback((e: React.DragEvent, tabTerminalId: string) => {
    e.preventDefault();
    setSplitDropTargetId(null);
    const payload = getDragData(e);
    if (!payload || payload.terminalId === tabTerminalId) return;
    setSplitTerminals([tabTerminalId, payload.terminalId]);
    setSplitMode(true);
  }, [setSplitTerminals, setSplitMode]);

  // Tab scroll overflow detection
  const tabsContainerRef = useRef<HTMLUListElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro.disconnect();
    };
  }, [checkScroll, terminalList.length]);

  const scrollTabs = (direction: 'left' | 'right') => {
    const el = tabsContainerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  // If split mode is active with valid terminals, show split view
  if (splitMode && splitTerminalIds && terminals.has(splitTerminalIds[0]) && terminals.has(splitTerminalIds[1])) {
    return (
      <div className="h-full flex flex-col">
        {/* Split Toolbar */}
        <div className="h-9 bg-elevation-1 border-b border-[var(--ij-divider)] flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <SplitSquareHorizontal size={13} className="text-accent-primary" strokeWidth={1.75} />
            <span className="text-text-primary text-[12px] font-medium">Split View</span>
            <span className="text-text-tertiary text-[11px]">
              {terminals.get(splitTerminalIds[0])?.config.nickname || terminals.get(splitTerminalIds[0])?.config.label}
              {' · '}
              {terminals.get(splitTerminalIds[1])?.config.nickname || terminals.get(splitTerminalIds[1])?.config.label}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSplitOrientation(splitOrientation === 'horizontal' ? 'vertical' : 'horizontal')}
              className="flex items-center gap-1 h-6 px-2 rounded-[4px] text-[11px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
              title="Toggle orientation"
            >
              <RotateCw size={12} strokeWidth={1.75} />
              {splitOrientation === 'horizontal' ? 'Vertical' : 'Horizontal'}
            </button>
            <button
              onClick={clearSplit}
              className="flex items-center gap-1 h-6 px-2 rounded-[4px] text-[11px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
            >
              <X size={12} strokeWidth={1.75} />
              Exit Split
            </button>
          </div>
        </div>
        <div className="flex-1">
          <SplitView
            terminalIds={splitTerminalIds}
            orientation={splitOrientation}
            ratio={splitRatio}
            onRatioChange={setSplitRatio}
          />
        </div>
      </div>
    );
  }

  // If grid mode is active, show the grid
  if (gridMode) {
    return <TerminalGrid />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab Bar — IntelliJ editor tabs */}
      <div className="h-9 bg-elevation-1 border-b border-[var(--ij-divider)] flex items-center justify-between px-0.5">
        <div className="relative flex items-center flex-1 min-w-0">
          {canScrollLeft && (
            <button
              onClick={() => scrollTabs('left')}
              className="absolute left-0 z-10 h-full px-1 flex items-center bg-gradient-to-r from-elevation-1 via-elevation-1/90 to-transparent"
            >
              <ChevronLeft size={14} className="text-text-secondary" strokeWidth={1.75} />
            </button>
          )}
          <Reorder.Group
            ref={tabsContainerRef}
            axis="x"
            values={terminalList}
            onReorder={(next) => reorderTerminals(next.map((t) => t.id))}
            className="flex items-center overflow-x-auto scrollbar-none"
          >
            {terminalList.map((terminal) => {
              const instance = terminals.get(terminal.id);
              const model = instance?.model;
              const isWorktree = instance?.isWorktree;
              const loopInfo = instance?.loopInfo;
              const contextFraction = instance?.contextUsageFraction ?? null;

              return (
              <Reorder.Item
                key={terminal.id}
                value={terminal}
                className="flex-shrink-0"
              >
                <button
                  onClick={() => focusTerminal(terminal.id)}
                  onAuxClick={(e) => {
                    // Middle-click (mouse wheel) closes the tab — same as VS Code.
                    if (e.button === 1) {
                      e.preventDefault();
                      closeTerminal(terminal.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ terminalId: terminal.id, x: e.clientX, y: e.clientY });
                  }}
                  onDragOver={(e) => handleTabDragOver(e, terminal.id)}
                  onDragLeave={handleTabDragLeave}
                  onDrop={(e) => handleTabDrop(e, terminal.id)}
                  className={`group relative flex items-center gap-2 px-3 h-9 text-[12px] transition-colors ${
                    splitDropTargetId === terminal.id
                      ? 'bg-accent-primary/12 text-accent-primary'
                      : activeTerminalId === terminal.id && !activeFilePath
                        ? 'bg-elevation-0 text-text-primary'
                        : 'hover:bg-white/[0.045] text-text-secondary'
                  }`}
                >
                  {/* IntelliJ-style bottom underline for active tab */}
                  {((activeTerminalId === terminal.id && !activeFilePath) || splitDropTargetId === terminal.id) && (
                    <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-t bg-accent-primary" />
                  )}
                  {/* Context window usage bar — fills left-to-right as context fills */}
                  {contextFraction !== null && contextFraction > 0.01 && (
                    <span
                      className={`absolute top-0 left-0 h-[2px] transition-[width] duration-700 ${
                        contextFraction >= 0.9
                          ? 'bg-red-500'
                          : contextFraction >= 0.8
                            ? 'bg-amber-400'
                            : 'bg-blue-500/70'
                      }`}
                      style={{ width: `${Math.min(contextFraction * 100, 100)}%` }}
                      title={`Context: ${Math.round(contextFraction * 100)}% used`}
                    />
                  )}
                  {splitDropTargetId === terminal.id && (
                    <SplitSquareHorizontal size={12} className="text-accent-primary flex-shrink-0 animate-pulse" />
                  )}
                  {unreadTerminalIds.has(terminal.id) && activeTerminalId !== terminal.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-accent-primary flex-shrink-0" />
                  )}
                  {terminal.color_tag && (
                    <div className={`w-2 h-2 rounded-full ${terminal.color_tag} flex-shrink-0`} />
                  )}
                  {terminal.pinned && (
                    <Pin size={10} className="text-accent-primary flex-shrink-0" strokeWidth={2} />
                  )}
                  {/* Badges */}
                  {model && (
                    <span className={`text-[9px] px-1 rounded font-medium flex-shrink-0 ${
                      model === 'opus' ? 'bg-purple-500/20 text-purple-400' :
                      model === 'sonnet' ? 'bg-blue-500/20 text-blue-400' :
                      model === 'haiku' ? 'bg-green-500/20 text-green-400' :
                      'bg-white/[0.06] text-text-tertiary'
                    }`}>
                      {model}
                    </span>
                  )}
                  {isWorktree && (
                    <GitBranch size={10} className="text-cyan-400 flex-shrink-0" />
                  )}
                  {loopInfo && (
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse flex-shrink-0" title={`Loop: ${loopInfo.interval}`} />
                  )}
                  {/* Context warning badge — visible at ≥80% */}
                  {contextFraction !== null && contextFraction >= 0.8 && (
                    <span
                      className="flex-shrink-0"
                      title={`Context ${Math.round(contextFraction * 100)}% — ${contextFraction >= 0.9 ? 'run /compact now' : 'consider /compact soon'}`}
                    >
                      <AlertTriangle
                        size={11}
                        className={contextFraction >= 0.9 ? 'text-red-400 animate-pulse' : 'text-amber-400'}
                      />
                    </span>
                  )}
                  <span className="max-w-[120px] truncate">{terminal.nickname || terminal.label}</span>
                  {gitInfoCache.get(terminal.id)?.current_branch && (
                    <span className={`text-[11px] font-mono max-w-[60px] truncate ${
                      gitInfoCache.get(terminal.id)?.is_worktree ? 'text-purple-400' : 'text-text-tertiary'
                    }`}>
                      {gitInfoCache.get(terminal.id)?.current_branch}
                    </span>
                  )}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* /compact shortcut — always visible when context ≥ 90% */}
                    {contextFraction !== null && contextFraction >= 0.9 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          focusTerminal(terminal.id);
                          void writeToTerminal(terminal.id, '/compact\n');
                        }}
                        className="flex items-center gap-0.5 px-1 h-5 rounded bg-red-500/20 hover:bg-red-500/35 text-red-400 text-[9px] font-medium transition-colors opacity-100"
                        title="Run /compact to free context window"
                      >
                        <Minimize2 size={9} />
                        compact
                      </button>
                    )}
                    {activeTerminalId && terminal.id !== activeTerminalId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSplitWith(terminal.id);
                        }}
                        className="p-0.5 rounded hover:bg-white/[0.08] text-text-tertiary hover:text-text-secondary transition-colors"
                        title="Split with active terminal"
                      >
                        <SplitSquareHorizontal size={12} />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicate(terminal.id);
                      }}
                      className="p-0.5 rounded hover:bg-white/[0.08] text-text-tertiary hover:text-text-secondary transition-colors"
                      title="Duplicate terminal"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToGrid(terminal.id);
                      }}
                      className={`p-0.5 rounded hover:bg-white/[0.08] transition-colors ${
                        gridTerminalIds.includes(terminal.id) ? 'text-accent-primary' : 'text-text-tertiary hover:text-text-secondary'
                      }`}
                      title="Add to grid"
                    >
                      <Grid3X3 size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTerminal(terminal.id);
                      }}
                      className="p-0.5 rounded hover:bg-white/[0.08] text-text-tertiary hover:text-text-secondary"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </button>
              </Reorder.Item>
              );
            })}
          </Reorder.Group>

          {/* File tabs — rendered inline next to terminal tabs, VS Code style */}
          {openFiles.length > 0 && (
            <>
              {terminalList.length > 0 && (
                <span className="w-px h-5 bg-[var(--ij-divider)] mx-0.5 flex-shrink-0" aria-hidden />
              )}
              <div className="flex items-center flex-shrink-0">
                {openFiles.map((tab) => {
                  const isActive = activeFilePath === tab.path;
                  const dirty = tab.content !== tab.original;
                  return (
                    <button
                      key={tab.path}
                      onClick={() => focusFile(tab.path)}
                      onAuxClick={(e) => {
                        if (e.button !== 1) return;
                        e.preventDefault();
                        if (dirty) {
                          const ok = window.confirm(`Discard unsaved changes in ${fileBasename(tab.path)}?`);
                          if (!ok) return;
                        }
                        closeFileTab(tab.path);
                      }}
                      title={tab.path}
                      className={`group relative flex items-center gap-1.5 px-3 h-9 text-[12px] transition-colors flex-shrink-0 ${
                        isActive
                          ? 'bg-elevation-0 text-text-primary'
                          : 'hover:bg-white/[0.045] text-text-secondary'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-t bg-accent-primary" />
                      )}
                      <FileIcon size={11} className="text-text-tertiary flex-shrink-0" strokeWidth={1.75} />
                      <span className="max-w-[140px] truncate">{fileBasename(tab.path)}</span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          if (dirty) {
                            const ok = window.confirm(`Discard unsaved changes in ${fileBasename(tab.path)}?`);
                            if (!ok) return;
                          }
                          closeFileTab(tab.path);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            closeFileTab(tab.path);
                          }
                        }}
                        className="p-0.5 rounded hover:bg-white/[0.08] text-text-tertiary hover:text-text-primary transition-colors flex items-center justify-center"
                        title={dirty ? 'Unsaved changes' : 'Close'}
                      >
                        {dirty ? (
                          <span className="w-2 h-2 rounded-full bg-accent-primary" />
                        ) : (
                          <X size={12} />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {canScrollRight && (
            <button
              onClick={() => scrollTabs('right')}
              className="absolute right-8 z-10 h-full px-1 flex items-center bg-gradient-to-l from-elevation-1 via-elevation-1/90 to-transparent"
            >
              <ChevronRight size={14} className="text-text-secondary" />
            </button>
          )}
          <button
            onClick={handleNewTab}
            className="w-7 h-7 ml-0.5 flex items-center justify-center rounded-[4px] hover:bg-white/[0.06] text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0"
            title="New Terminal"
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </div>

        {/* Per-terminal actions: package.json scripts for the active terminal.
            Hidden when the "Project Tools" setting is off. */}
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {showFileTree && activeTerminalId && !activeFilePath && (() => {
            const inst = terminals.get(activeTerminalId);
            if (!inst || inst.scriptParentId) return null;
            return <ScriptsMenu terminalId={activeTerminalId} cwd={inst.config.working_directory} />;
          })()}
        </div>

        {/* Grid Mode Toggle */}
        <div className="flex items-center gap-1 ml-2 mr-1 flex-shrink-0">
          {gridTerminalIds.length > 0 && (
            <span className="text-[10.5px] text-text-tertiary mr-1 uppercase tracking-wide">
              {gridTerminalIds.length} in grid
            </span>
          )}
          <button
            onClick={toggleGridMode}
            className={`flex items-center gap-1.5 h-7 px-2 rounded-[4px] text-[11.5px] font-medium transition-colors ${
              gridTerminalIds.length > 0
                ? 'bg-accent-primary/18 text-accent-primary ring-1 ring-inset ring-accent-primary/30 hover:bg-accent-primary/25'
                : 'hover:bg-white/[0.06] text-text-secondary hover:text-text-primary'
            }`}
            title="Toggle Grid View"
          >
            <Grid3X3 size={13} strokeWidth={1.75} />
            <span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {/* Content area — terminal stays mounted so scrollback survives the
          switch; the file editor overlays on top when a file tab is active. */}
      <div className="flex-1 relative">
        {activeTerminalId && (() => {
          const scriptChildId = scriptChildren.get(activeTerminalId);
          const scriptInst = scriptChildId ? terminals.get(scriptChildId) : null;
          return (
            <div
              key={activeTerminalId}
              className="absolute inset-0 flex flex-col"
              style={{ visibility: activeFilePath ? 'hidden' : 'visible' }}
              aria-hidden={!!activeFilePath}
            >
              <div className="flex-1 min-h-0 flex flex-col">
                <TerminalView terminalId={activeTerminalId} />
              </div>
              {(() => {
                const inst = terminals.get(activeTerminalId);
                if (inst?.config.status === 'Stopped' && inst?.sessionSummary) {
                  return <SessionInsights summary={inst.sessionSummary} />;
                }
                return null;
              })()}
              {scriptInst && scriptChildId && (
                <ScriptChildPane
                  parentId={activeTerminalId}
                  childId={scriptChildId}
                  scriptName={scriptInst.scriptName ?? ''}
                  status={scriptInst.config.status}
                  onClose={() => { void closeScript(activeTerminalId); }}
                />
              )}
            </div>
          );
        })()}
        {activeFilePath && openFiles.some((t) => t.path === activeFilePath) && (
          <div key={`file:${activeFilePath}`} className="absolute inset-0 z-10">
            <FileEditorView path={activeFilePath} />
          </div>
        )}
        {!activeTerminalId && !activeFilePath && (
          <div className="absolute inset-0">
            <WelcomePanel />
          </div>
        )}
      </div>

      <BottomTerminalPane />

      {/* Right-click context menu for tabs */}
      {contextMenu && (() => {
        const inst = terminals.get(contextMenu.terminalId);
        const isPinned = inst?.config.pinned ?? false;
        return (
          <div
            ref={contextMenuRef}
            style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
            className="bg-elevation-2 border border-[var(--ij-divider)] rounded-[6px] shadow-xl py-1 min-w-[160px]"
          >
            <button
              onClick={() => {
                void setPinned(contextMenu.terminalId, !isPinned);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-white/[0.06] transition-colors"
            >
              <Pin size={12} strokeWidth={1.75} className={isPinned ? 'text-accent-primary' : 'text-text-tertiary'} />
              {isPinned ? 'Unpin tab' : 'Pin tab'}
            </button>
          </div>
        );
      })()}
    </div>
  );
}
