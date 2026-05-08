import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';
import type { FileTabState, ModalKind } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';
import type { TerminalConfig, ClosedTerminalRecord } from '../store/terminalStore';
import {
  Terminal,
  Settings,
  PanelLeft,
  LayoutGrid,
  Lightbulb,
  FolderOpen,
  User,
  History,
  Scissors,
  FileCode,
  Search,
  Plus,
  Copy,
  Send,
  Brain,
  Clock,
  Wrench,
  Users,
  GitBranch,
  SplitSquareHorizontal,
  X,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';

interface HintCategory {
  category: string;
  hints: { command: string; description: string }[];
}

interface Snippet {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
}

interface ConfigProfile {
  id: string;
  name: string;
  description: string | null;
  working_directory: string;
  claude_args: string[];
  env_vars: Record<string, string>;
  is_default: boolean;
  last_used_at: string | null;
}

interface SessionHistoryEntry {
  id: number;
  terminal_id: string;
  label: string;
  started_at: string;
  ended_at: string | null;
  log_path: string | null;
}

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  category: string;
  icon?: LucideIcon;
  shortcut?: string;
  action: () => void;
}

type ReplaceModal = (modal: ModalKind, options?: { profileId?: string; repoPath?: string }) => void;

function fuzzyMatch(text: string, query: string): { matches: boolean; score: number } {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();

  // Exact substring match (highest score)
  const subIdx = lower.indexOf(q);
  if (subIdx !== -1) {
    // Prefer matches at the start
    return { matches: true, score: 100 - subIdx };
  }

  // Character-by-character fuzzy match
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      qi++;
      // Bonus for consecutive matches
      score += lastMatchIdx === i - 1 ? 3 : 1;
      lastMatchIdx = i;
    }
  }
  if (qi === q.length) {
    return { matches: true, score };
  }
  return { matches: false, score: 0 };
}

// ─── Command-group builder functions ────────────────────────────────────────
// Each builder is a pure function that takes only the data it needs.

function buildTerminalItems(
  terminals: Map<string, { config: TerminalConfig }>,
  setActiveTerminal: (id: string) => void,
  closeModal: () => void,
): PaletteItem[] {
  const items: PaletteItem[] = [];
  terminals.forEach((instance) => {
    const config = instance.config;
    items.push({
      id: `terminal-${config.id}`,
      label: config.nickname || config.label,
      description: `${config.working_directory} (${config.status})`,
      category: 'Terminals',
      icon: Terminal,
      action: () => { setActiveTerminal(config.id); closeModal(); },
    });
  });
  return items;
}

function buildClosedTerminalItems(
  closedTerminalHistory: ClosedTerminalRecord[],
  closeModal: () => void,
): PaletteItem[] {
  const now = Date.now();
  const FIVE_MIN = 5 * 60 * 1000;
  return closedTerminalHistory
    .filter(r => now - r.closedAt < FIVE_MIN)
    .map((record, i) => {
      const { label, working_directory, claude_args, env_vars, color_tag, nickname } = record.config;
      return {
        id: `closed-terminal-${i}`,
        label: `Reopen: ${nickname || label}`,
        description: working_directory,
        category: 'Closed Terminals',
        icon: RotateCcw,
        action: () => {
          useTerminalStore.getState().createTerminal(
            label, working_directory, claude_args, env_vars,
            color_tag ?? undefined, nickname ?? undefined,
          );
          closeModal();
        },
      };
    });
}

function buildActionItems(
  closeModal: () => void,
  replaceModal: ReplaceModal,
): PaletteItem[] {
  const actions: { label: string; description: string; icon: LucideIcon; shortcut?: string; action: () => void }[] = [
    { label: 'New Terminal', description: 'Create a new terminal instance', icon: Plus, shortcut: 'Ctrl+Shift+N', action: () => { replaceModal('newTerminal'); } },
    { label: 'Toggle Sidebar', description: 'Show or hide the sidebar', icon: PanelLeft, shortcut: 'Ctrl+B', action: () => { useAppStore.getState().toggleSidebar(); closeModal(); } },
    { label: 'Open Settings', description: 'Open application settings', icon: Settings, shortcut: 'Ctrl+,', action: () => { replaceModal('settings'); } },
    { label: 'Toggle Grid View', description: 'Switch between tab and grid view', icon: LayoutGrid, shortcut: 'Ctrl+G', action: () => { useAppStore.getState().toggleGridMode(); closeModal(); } },
    { label: 'Toggle Hints Panel', description: 'Show or hide Claude Code hints', icon: Lightbulb, shortcut: 'F1', action: () => { useAppStore.getState().toggleHints(); closeModal(); } },
    { label: 'Toggle File Changes', description: 'Show or hide the file changes panel', icon: FileCode, action: () => { useAppStore.getState().toggleChanges(); closeModal(); } },
    { label: 'Toggle Agent Teams', description: 'Show or hide the agent orchestration panel', icon: Users, action: () => { useAppStore.getState().toggleOrchestration(); closeModal(); } },
    { label: 'Open Memory Editor', description: 'Edit Claude memory and CLAUDE.md files', icon: Brain, action: () => { replaceModal('memoryEditor'); } },
    { label: 'Open Session Timeline', description: 'View the session timeline and history', icon: Clock, action: () => { replaceModal('sessionTimeline'); } },
    { label: 'Open Claude Config', description: 'Configure Claude Code settings and agents', icon: Wrench, action: () => { replaceModal('claudeConfig'); } },
    { label: 'Open Global Search', description: 'Search across all file contents', icon: Search, shortcut: 'Ctrl+Shift+F', action: () => { replaceModal('globalSearch'); } },
    { label: 'Open Worktree Manager', description: 'Manage git worktrees for the active terminal', icon: GitBranch, shortcut: 'Ctrl+Shift+W', action: () => {
      const activeId = useTerminalStore.getState().activeTerminalId;
      if (activeId) {
        const gitInfo = useTerminalStore.getState().gitInfoCache.get(activeId);
        if (gitInfo?.is_git_repo) {
          const terminal = useTerminalStore.getState().terminals.get(activeId);
          const repoPath = gitInfo.is_worktree && gitInfo.main_repo_path
            ? gitInfo.main_repo_path
            : terminal?.config.working_directory || '';
          replaceModal('worktree', { repoPath });
          return;
        }
      }
      closeModal();
    } },
    { label: 'Split View', description: 'Split the current terminal with another', icon: SplitSquareHorizontal, shortcut: 'Ctrl+\\', action: () => {
      const { splitMode, clearSplit, setSplitTerminals, setSplitMode } = useAppStore.getState();
      if (splitMode) {
        clearSplit();
      } else {
        const terminals = useTerminalStore.getState().terminals;
        const activeId = useTerminalStore.getState().activeTerminalId;
        const terminalIds = Array.from(terminals.keys());
        if (terminalIds.length >= 2 && activeId) {
          const other = terminalIds.find(id => id !== activeId);
          if (other) { setSplitTerminals([activeId, other]); setSplitMode(true); }
        }
      }
      closeModal();
    } },
    { label: 'Close Active Terminal', description: 'Close the currently active terminal', icon: X, shortcut: 'Ctrl+W', action: () => {
      const activeId = useTerminalStore.getState().activeTerminalId;
      if (activeId) useTerminalStore.getState().closeTerminal(activeId);
      closeModal();
    } },
    { label: 'Manage Profiles', description: 'Open profile management', icon: User, action: () => { replaceModal('profile'); } },
    { label: 'Workspaces', description: 'Open workspace manager', icon: FolderOpen, action: () => { replaceModal('workspace'); } },
    { label: 'Snippets', description: 'Open snippet manager', icon: Scissors, shortcut: 'Ctrl+Shift+S', action: () => { replaceModal('snippets'); } },
    { label: 'Session History', description: 'View past terminal sessions', icon: History, action: () => { replaceModal('sessionHistory'); } },
  ];
  return actions.map((a, i) => ({
    id: `action-${i}`,
    label: a.label,
    description: a.description,
    category: 'Commands',
    icon: a.icon,
    shortcut: a.shortcut,
    action: a.action,
  }));
}

function buildHintItems(
  hints: HintCategory[],
  closeModal: () => void,
): PaletteItem[] {
  const items: PaletteItem[] = [];
  hints.forEach((cat) => {
    cat.hints.forEach((hint, i) => {
      items.push({
        id: `hint-${cat.category}-${i}`,
        label: hint.command,
        description: hint.description,
        category: 'Hints',
        icon: Copy,
        action: () => { navigator.clipboard.writeText(hint.command); closeModal(); },
      });
    });
  });
  return items;
}

function buildSnippetItems(
  snippets: Snippet[],
  activeTerminalId: string | null,
  writeToTerminal: (id: string, data: string) => Promise<void>,
  closeModal: () => void,
): PaletteItem[] {
  return snippets.map((snippet) => ({
    id: `snippet-${snippet.id}`,
    label: snippet.title,
    description: `[${snippet.category}] ${snippet.content.slice(0, 60)}${snippet.content.length > 60 ? '...' : ''}`,
    category: 'Snippets',
    icon: Send,
    action: () => {
      if (activeTerminalId) writeToTerminal(activeTerminalId, snippet.content);
      closeModal();
    },
  }));
}

function buildProfileItems(
  profiles: ConfigProfile[],
  closeModal: () => void,
): PaletteItem[] {
  return profiles.map((profile) => ({
    id: `profile-${profile.id}`,
    label: profile.name,
    description: profile.description ?? profile.working_directory,
    category: 'Profiles',
    icon: User,
    action: () => {
      useTerminalStore.getState().createTerminal(
        profile.name,
        profile.working_directory,
        profile.claude_args,
        profile.env_vars,
      );
      closeModal();
    },
  }));
}

function buildSessionItems(
  sessions: SessionHistoryEntry[],
  replaceModal: ReplaceModal,
): PaletteItem[] {
  return sessions.slice(0, 15).map((session) => {
    const date = session.started_at.slice(0, 10);
    return {
      id: `session-${session.id}`,
      label: session.label,
      description: `${date} — ${session.ended_at ? 'ended' : 'running'}`,
      category: 'Recent Sessions',
      icon: History,
      action: () => { replaceModal('sessionHistory'); },
    };
  });
}

function buildOpenFileItems(
  openFiles: FileTabState[],
  closeModal: () => void,
): PaletteItem[] {
  return openFiles.map((file) => {
    const name = file.path.split('/').pop() ?? file.path;
    return {
      id: `file-${file.path}`,
      label: name,
      description: file.path,
      category: 'Open Files',
      icon: FileCode,
      action: () => {
        useAppStore.getState().setActiveFilePath(file.path);
        closeModal();
      },
    };
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandPalette() {
  const { closeModal, replaceModal, openFiles } = useAppStore();
  const { terminals, activeTerminalId, setActiveTerminal, writeToTerminal, closedTerminalHistory } = useTerminalStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hints, setHints] = useState<HintCategory[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [sessions, setSessions] = useState<SessionHistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    invoke<HintCategory[]>('get_hints').then(setHints).catch(() => {});
    invoke<Snippet[]>('get_snippets').then(setSnippets).catch(() => {});
    invoke<ConfigProfile[]>('get_profiles').then(setProfiles).catch(() => {});
    invoke<SessionHistoryEntry[]>('get_session_history').then(setSessions).catch(() => {});
  }, []);

  // Determine prefix mode
  const prefixMode = useMemo(() => {
    if (query.startsWith('>')) return 'commands';
    if (query.startsWith('@')) return 'terminals';
    if (query.startsWith('#')) return 'snippets';
    return 'all';
  }, [query]);

  const effectiveQuery = useMemo(() => {
    if (prefixMode !== 'all') return query.slice(1).trim();
    return query;
  }, [query, prefixMode]);

  const items = useMemo<PaletteItem[]>(() => {
    const result: PaletteItem[] = [];
    if (prefixMode === 'all' || prefixMode === 'terminals') {
      result.push(...buildTerminalItems(terminals, setActiveTerminal, closeModal));
      result.push(...buildClosedTerminalItems(closedTerminalHistory, closeModal));
    }
    if (prefixMode === 'all' || prefixMode === 'commands') {
      result.push(...buildActionItems(closeModal, replaceModal));
      result.push(...buildHintItems(hints, closeModal));
      result.push(...buildProfileItems(profiles, closeModal));
      result.push(...buildSessionItems(sessions, replaceModal));
      result.push(...buildOpenFileItems(openFiles, closeModal));
    }
    if (prefixMode === 'all' || prefixMode === 'snippets') {
      result.push(...buildSnippetItems(snippets, activeTerminalId, writeToTerminal, closeModal));
    }
    return result;
  }, [terminals, closedTerminalHistory, hints, snippets, profiles, sessions, openFiles, activeTerminalId, closeModal, replaceModal, setActiveTerminal, writeToTerminal, prefixMode]);

  const filtered = useMemo(() => {
    if (!effectiveQuery) return items;
    return items
      .map(item => {
        const labelMatch = fuzzyMatch(item.label, effectiveQuery);
        const descMatch = fuzzyMatch(item.description, effectiveQuery);
        const bestScore = Math.max(labelMatch.score, descMatch.score);
        return { item, matches: labelMatch.matches || descMatch.matches, score: bestScore };
      })
      .filter(r => r.matches)
      .sort((a, b) => b.score - a.score)
      .map(r => r.item);
  }, [items, effectiveQuery]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: { category: string; items: PaletteItem[] }[] = [];
    const catMap = new Map<string, PaletteItem[]>();
    for (const item of filtered) {
      const arr = catMap.get(item.category) || [];
      arr.push(item);
      catMap.set(item.category, arr);
    }
    for (const [category, items] of catMap) {
      groups.push({ category, items });
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => grouped.flatMap(g => g.items), [grouped]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[selectedIndex]) {
        flatItems[selectedIndex].action();
      }
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Placeholder text based on prefix mode
  const placeholder = useMemo(() => {
    switch (prefixMode) {
      case 'commands': return 'Search commands...';
      case 'terminals': return 'Search terminals...';
      case 'snippets': return 'Search snippets...';
      default: return 'Search commands, terminals, snippets...  (> cmds  @ terms  # snips)';
    }
  }, [prefixMode]);

  let flatIndex = 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
      onDoubleClick={closeModal}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="mx-auto mt-[15vh] w-full max-w-[550px]"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div className="bg-elevation-4 ring-1 ring-white/[0.08] rounded-xl shadow-elevation-4 overflow-hidden">
          {/* Search Input */}
          <div className="p-3 border-b border-border">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-text-tertiary" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="w-full bg-elevation-2 ring-1 ring-border-light rounded-lg h-10 pl-9 pr-3 text-text-primary text-[13px] focus:outline-none focus:ring-border-focus transition-all placeholder:text-text-tertiary"
              />
            </div>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
            {grouped.map((group) => (
              <div key={group.category}>
                <div className="px-2.5 py-1.5 text-text-tertiary text-[10px] font-semibold uppercase tracking-widest">
                  {group.category}
                </div>
                {group.items.map((item) => {
                  const idx = flatIndex++;
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      data-index={idx}
                      onClick={item.action}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        selectedIndex === idx
                          ? 'bg-accent-primary/12 text-text-primary'
                          : 'hover:bg-white/[0.04] text-text-secondary'
                      }`}
                    >
                      {Icon && (
                        <Icon
                          size={14}
                          className={
                            selectedIndex === idx
                              ? 'text-accent-primary shrink-0'
                              : 'text-text-tertiary shrink-0'
                          }
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate">{item.label}</p>
                        <p className="text-text-tertiary text-[11px] truncate">{item.description}</p>
                      </div>
                      {item.shortcut && (
                        <kbd className="shrink-0 text-[10px] text-text-tertiary bg-elevation-2 px-1.5 py-0.5 rounded border border-border font-mono">
                          {item.shortcut}
                        </kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {flatItems.length === 0 && (
              <p className="text-text-tertiary text-[12px] text-center py-8">
                No results found
              </p>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 border-t border-border flex items-center gap-4 text-[10px] text-text-tertiary">
            <span><kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">↵</kbd> select</span>
            <span><kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">esc</kbd> close</span>
            <span className="ml-auto"><kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">⌘K</kbd> to open</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
