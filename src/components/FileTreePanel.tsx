import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';
import { getFileIconUrl, getFolderIconUrl } from '../utils/fileIcons';

interface DirEntryInfo {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
}

interface TreeNode {
  entry: DirEntryInfo;
  children: TreeNode[] | null; // null = not loaded yet
  loading: boolean;
  expanded: boolean;
  error: string | null;
}

function makeNode(entry: DirEntryInfo): TreeNode {
  return { entry, children: null, loading: false, expanded: false, error: null };
}

function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function FileTreePanel() {
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const terminals = useTerminalStore((s) => s.terminals);
  const pinnedRepoPath = useAppStore((s) => s.pinnedRepoPath);
  const openFileTab = useAppStore((s) => s.openFileTab);
  const changesRefreshTrigger = useAppStore((s) => s.changesRefreshTrigger);

  const activeCwd = useMemo(() => {
    if (!activeTerminalId) return null;
    return terminals.get(activeTerminalId)?.config.working_directory ?? null;
  }, [activeTerminalId, terminals]);

  const rootPath = pinnedRepoPath ?? activeCwd;

  const [rootChildren, setRootChildren] = useState<TreeNode[] | null>(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);

  // Track expanded folders across refreshes by absolute path
  const expandedPathsRef = useRef<Set<string>>(new Set());

  const loadChildren = useCallback(async (path: string): Promise<DirEntryInfo[]> => {
    return await invoke<DirEntryInfo[]>('list_directory', { path });
  }, []);

  const refreshRoot = useCallback(async () => {
    if (!rootPath) {
      setRootChildren(null);
      setRootError(null);
      return;
    }
    setRootLoading(true);
    setRootError(null);
    try {
      const entries = await loadChildren(rootPath);
      // Preserve expansion state for paths still present.
      const existing = new Map<string, TreeNode>();
      const collect = (nodes: TreeNode[] | null) => {
        if (!nodes) return;
        for (const n of nodes) {
          existing.set(n.entry.path, n);
          if (n.children) collect(n.children);
        }
      };
      collect(rootChildren);

      const nextRoot: TreeNode[] = entries.map((e) => {
        const prev = existing.get(e.path);
        if (prev && prev.entry.is_dir === e.is_dir) {
          return { ...prev, entry: e };
        }
        return makeNode(e);
      });
      setRootChildren(nextRoot);
    } catch (err) {
      setRootError(typeof err === 'string' ? err : 'Failed to read folder');
      setRootChildren(null);
    } finally {
      setRootLoading(false);
    }
  }, [rootPath, loadChildren]);

  useEffect(() => {
    expandedPathsRef.current = new Set();
    refreshRoot();
  }, [rootPath, changesRefreshTrigger]); // reload on terminal change and external refresh

  const updateNode = useCallback((targetPath: string, updater: (n: TreeNode) => TreeNode) => {
    setRootChildren((prev) => {
      if (!prev) return prev;
      const walk = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) => {
          if (n.entry.path === targetPath) return updater(n);
          if (n.children) {
            const nextChildren = walk(n.children);
            if (nextChildren !== n.children) return { ...n, children: nextChildren };
          }
          return n;
        });
      return walk(prev);
    });
  }, []);

  const toggleExpand = useCallback(async (node: TreeNode) => {
    if (!node.entry.is_dir) return;
    const { path } = node.entry;
    // Collapse
    if (node.expanded) {
      expandedPathsRef.current.delete(path);
      updateNode(path, (n) => ({ ...n, expanded: false }));
      return;
    }
    // Expand — if children already loaded, just flip the flag
    if (node.children) {
      expandedPathsRef.current.add(path);
      updateNode(path, (n) => ({ ...n, expanded: true }));
      return;
    }
    // Lazy-load children
    updateNode(path, (n) => ({ ...n, loading: true, error: null }));
    try {
      const entries = await loadChildren(path);
      expandedPathsRef.current.add(path);
      updateNode(path, (n) => ({
        ...n,
        loading: false,
        expanded: true,
        children: entries.map(makeNode),
        error: null,
      }));
    } catch (err) {
      updateNode(path, (n) => ({
        ...n,
        loading: false,
        error: typeof err === 'string' ? err : 'Failed to read folder',
      }));
    }
  }, [loadChildren, updateNode]);

  return (
    <div className="flex flex-col h-full min-h-0 border-t border-[var(--ij-divider-soft)]">
      {/* Section header */}
      <div className="flex items-center justify-between h-[26px] px-3 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-text-secondary">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">Explorer</span>
        </div>
        <button
          onClick={refreshRoot}
          disabled={rootLoading}
          className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-white/[0.06] text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={11} className={rootLoading ? 'animate-spin' : ''} strokeWidth={1.75} />
        </button>
      </div>

      {/* Root path label */}
      {rootPath && (
        <div className="px-3 pb-1 flex-shrink-0">
          <p className="text-text-tertiary text-[10.5px] font-mono truncate" title={rootPath}>
            {basename(rootPath)}
          </p>
        </div>
      )}

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {!rootPath && (
          <div className="px-3 py-2 text-text-tertiary text-[11px]">
            No active terminal
          </div>
        )}
        {rootPath && rootError && (
          <div className="px-3 py-2 text-red-400 text-[11px]">{rootError}</div>
        )}
        {rootPath && !rootError && rootChildren === null && rootLoading && (
          <div className="px-3 py-2 text-text-tertiary text-[11px]">Loading…</div>
        )}
        {rootChildren && rootChildren.length === 0 && (
          <div className="px-3 py-2 text-text-tertiary text-[11px]">(empty folder)</div>
        )}
        {rootChildren && rootChildren.map((node) => (
          <TreeRow
            key={node.entry.path}
            node={node}
            depth={0}
            onToggle={toggleExpand}
            onOpenFile={(p) => { void openFileTab(p); }}
          />
        ))}
      </div>
    </div>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  onToggle: (n: TreeNode) => void;
  onOpenFile: (path: string) => void;
}

function TreeRow({ node, depth, onToggle, onOpenFile }: TreeRowProps) {
  const { entry } = node;
  const indent = 8 + depth * 12;
  const rowClass = 'group flex items-center gap-1 h-[22px] px-1 rounded-[3px] cursor-pointer hover:bg-white/[0.045] transition-colors';

  if (entry.is_dir) {
    return (
      <>
        <div
          className={rowClass}
          style={{ paddingLeft: indent }}
          onClick={() => onToggle(node)}
        >
          {node.expanded ? (
            <ChevronDown size={11} className="text-text-tertiary shrink-0" strokeWidth={2} />
          ) : (
            <ChevronRight size={11} className="text-text-tertiary shrink-0" strokeWidth={2} />
          )}
          <img
            src={getFolderIconUrl(entry.name, node.expanded)}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="w-[14px] h-[14px] shrink-0 select-none"
          />
          <span className="text-[12px] text-text-primary truncate" title={entry.name}>
            {entry.name}
          </span>
        </div>
        {node.expanded && node.loading && (
          <div className="text-text-tertiary text-[11px]" style={{ paddingLeft: indent + 24 }}>
            Loading…
          </div>
        )}
        {node.expanded && node.error && (
          <div className="text-red-400 text-[11px]" style={{ paddingLeft: indent + 24 }}>
            {node.error}
          </div>
        )}
        {node.expanded && node.children && node.children.map((child) => (
          <TreeRow
            key={child.entry.path}
            node={child}
            depth={depth + 1}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        ))}
      </>
    );
  }

  // File row
  return (
    <div
      className={rowClass}
      style={{ paddingLeft: indent + 12 /* align with folder names */ }}
      onClick={() => onOpenFile(entry.path)}
      title={entry.path}
    >
      <img
        src={getFileIconUrl(entry.name)}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="w-[14px] h-[14px] shrink-0 select-none"
      />
      <span className="text-[12px] text-text-secondary truncate">{entry.name}</span>
    </div>
  );
}
