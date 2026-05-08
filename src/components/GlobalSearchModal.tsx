import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import {
  Search as SearchIcon,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  CaseSensitive,
  FileCode2,
  AlertCircle,
  Clock,
  Terminal,
  Scissors,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';

// ── Types ────────────────────────────────────────────────────────────────────

interface SearchMatch {
  line: number;
  column: number;
  line_text: string;
  match_length: number;
}

interface FileSearchResult {
  file_path: string;
  relative_path: string;
  matches: SearchMatch[];
  name_match: boolean;
}

interface SearchSummary {
  results: FileSearchResult[];
  total_matches: number;
  total_files: number;
  truncated: boolean;
}

interface SessionSearchResult {
  session_id: number;
  terminal_id: string;
  label: string;
  snippet: string;
  line_no: number;
  timestamp: string;
}

interface SnippetItem {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
}

type ActiveTab = 'files' | 'sessions' | 'snippets';

// ── Helpers ───────────────────────────────────────────────────────────────────

function HighlightedLine({
  text,
  column,
  matchLength,
}: {
  text: string;
  column: number;
  matchLength: number;
}) {
  const start = Math.max(0, column - 1);
  const end = Math.min(text.length, start + matchLength);
  if (end <= start) return <span>{text}</span>;
  const previewStart = Math.max(0, start - 80);
  const before = previewStart > 0 ? '…' + text.slice(previewStart, start) : text.slice(0, start);
  const matched = text.slice(start, end);
  const after = text.slice(end);
  return (
    <>
      <span className="text-text-tertiary">{before}</span>
      <span className="bg-accent-primary/30 text-text-primary rounded-[2px] px-[1px]">{matched}</span>
      <span className="text-text-tertiary">{after}</span>
    </>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <span className="text-text-tertiary">{text}</span>;
  return (
    <>
      <span className="text-text-tertiary">{text.slice(0, idx)}</span>
      <span className="bg-accent-primary/30 text-text-primary rounded-[2px] px-[1px]">
        {text.slice(idx, idx + query.length)}
      </span>
      <span className="text-text-tertiary">{text.slice(idx + query.length)}</span>
    </>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GlobalSearchModal() {
  const closeModal = useAppStore((s) => s.closeModal);
  const openFileTab = useAppStore((s) => s.openFileTab);
  const pinnedRepoPath = useAppStore((s) => s.pinnedRepoPath);
  const activeCwd = useTerminalStore((s) => {
    const id = s.activeTerminalId;
    return id ? s.terminals.get(id)?.config.working_directory ?? null : null;
  });
  const searchRoot = pinnedRepoPath ?? activeCwd;

  // ── Shared ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('files');
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileToken = useRef(0);
  const sessionToken = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // ── Files tab ─────────────────────────────────────────────────────────────
  const [searching, setSearching] = useState(false);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ fileIdx: number; matchIdx: number }>({
    fileIdx: 0,
    matchIdx: 0,
  });

  useEffect(() => {
    if (activeTab !== 'files') return;
    if (!searchRoot) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSummary(null);
      setError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const myToken = ++fileToken.current;
    const handle = setTimeout(async () => {
      try {
        const res = await invoke<SearchSummary>('search_in_files', {
          path: searchRoot,
          query: trimmed,
          caseSensitive,
          includeFileContents: true,
        });
        if (myToken !== fileToken.current) return;
        setSummary(res);
        setError(null);
        setCollapsedFiles(new Set());
        setSelected({ fileIdx: 0, matchIdx: 0 });
      } catch (err) {
        if (myToken !== fileToken.current) return;
        setError(typeof err === 'string' ? err : 'Search failed');
        setSummary(null);
      } finally {
        if (myToken === fileToken.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, caseSensitive, searchRoot, activeTab]);

  const results = summary?.results ?? [];

  const flatNav = useMemo(() => {
    const out: { fileIdx: number; matchIdx: number }[] = [];
    results.forEach((file, fileIdx) => {
      if (collapsedFiles.has(file.file_path)) return;
      file.matches.forEach((_, matchIdx) => out.push({ fileIdx, matchIdx }));
      if (file.matches.length === 0) out.push({ fileIdx, matchIdx: -1 });
    });
    return out;
  }, [results, collapsedFiles]);

  const flatIndex = useMemo(
    () =>
      flatNav.findIndex(
        (e) => e.fileIdx === selected.fileIdx && e.matchIdx === selected.matchIdx,
      ),
    [flatNav, selected],
  );

  const openMatch = useCallback(
    async (file: FileSearchResult) => {
      try {
        await openFileTab(file.file_path);
        closeModal();
      } catch {
        /* errors surface via the file tab itself */
      }
    },
    [openFileTab, closeModal],
  );

  const toggleFile = (filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const moveSelection = (delta: number) => {
    if (flatNav.length === 0) return;
    const idx = flatIndex < 0 ? 0 : flatIndex;
    const next = (idx + delta + flatNav.length) % flatNav.length;
    setSelected(flatNav[next]);
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-nav="${flatNav[next].fileIdx}-${flatNav[next].matchIdx}"]`,
      );
      el?.scrollIntoView({ block: 'nearest' });
    });
  };

  // ── Sessions tab ──────────────────────────────────────────────────────────
  const [sessionResults, setSessionResults] = useState<SessionSearchResult[]>([]);
  const [sessionSearching, setSessionSearching] = useState(false);

  useEffect(() => {
    if (activeTab !== 'sessions') return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSessionResults([]);
      setSessionSearching(false);
      return;
    }
    setSessionSearching(true);
    const myToken = ++sessionToken.current;
    const handle = setTimeout(async () => {
      try {
        const res = await invoke<SessionSearchResult[]>('search_session_history', {
          query: trimmed,
        });
        if (myToken !== sessionToken.current) return;
        setSessionResults(res);
      } catch {
        if (myToken !== sessionToken.current) return;
        setSessionResults([]);
      } finally {
        if (myToken === sessionToken.current) setSessionSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, activeTab]);

  // ── Snippets tab ──────────────────────────────────────────────────────────
  const [allSnippets, setAllSnippets] = useState<SnippetItem[]>([]);

  useEffect(() => {
    invoke<SnippetItem[]>('get_snippets').then(setAllSnippets).catch(() => {});
  }, []);

  const filteredSnippets = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return allSnippets;
    return allSnippets.filter(
      (s) =>
        s.title.toLowerCase().includes(trimmed) || s.content.toLowerCase().includes(trimmed),
    );
  }, [allSnippets, query]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    } else if (activeTab === 'files') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const file = results[selected.fileIdx];
        if (file) openMatch(file);
      }
    }
  };

  const tabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'files', label: 'Files', icon: <FileCode2 size={11} strokeWidth={1.75} /> },
    { id: 'sessions', label: 'Sessions', icon: <Terminal size={11} strokeWidth={1.75} /> },
    { id: 'snippets', label: 'Snippets', icon: <Scissors size={11} strokeWidth={1.75} /> },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[8vh]"
      onMouseDown={(e) => {
        // Click on backdrop (not modal) closes
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -8 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-full max-w-[820px] mx-4 bg-elevation-3 ring-1 ring-white/[0.08] rounded-xl shadow-elevation-3 overflow-hidden flex flex-col"
        style={{ maxHeight: '80vh' }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-text-primary text-[13px] font-semibold">
            <SearchIcon size={14} className="text-accent-primary" />
            Global Search
          </div>

          {/* Tab switcher */}
          <div className="flex items-center gap-0.5 bg-elevation-2 rounded-md p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-elevation-3 text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={closeModal}
            className="p-1 rounded hover:bg-white/[0.06] text-text-tertiary hover:text-text-primary transition-colors"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search input */}
        <div className="px-4 py-3 border-b border-border">
          <div className="relative flex items-center">
            <SearchIcon
              size={13}
              className="absolute left-3 text-text-tertiary"
              strokeWidth={1.75}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                activeTab === 'files'
                  ? 'Search across the workspace…'
                  : activeTab === 'sessions'
                    ? 'Search session history…'
                    : 'Filter snippets…'
              }
              className="w-full bg-elevation-1 ring-1 ring-inset ring-border rounded-md h-9 pl-9 pr-24 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-accent-primary/60"
            />
            {activeTab === 'files' && (
              <div className="absolute right-2 flex items-center gap-1">
                <button
                  onClick={() => setCaseSensitive((v) => !v)}
                  className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                    caseSensitive
                      ? 'bg-accent-primary/20 text-accent-primary ring-1 ring-inset ring-accent-primary/40'
                      : 'text-text-tertiary hover:bg-white/[0.06] hover:text-text-secondary'
                  }`}
                  title="Match case (Aa)"
                  tabIndex={-1}
                >
                  <CaseSensitive size={14} strokeWidth={1.75} />
                </button>
              </div>
            )}
          </div>

          {/* Status line */}
          <div className="mt-2 flex items-center justify-between text-[11px]">
            {activeTab === 'files' ? (
              <>
                <div className="text-text-tertiary truncate" title={searchRoot ?? ''}>
                  {searchRoot ? (
                    <>
                      in <span className="font-mono text-text-secondary">{searchRoot}</span>
                    </>
                  ) : (
                    'No active workspace — open a terminal first'
                  )}
                </div>
                <div className="text-text-tertiary flex items-center gap-2">
                  {searching && <Loader2 size={11} className="animate-spin" />}
                  {summary && !searching && (
                    <span>
                      {summary.total_matches} match
                      {summary.total_matches === 1 ? '' : 'es'} in {summary.total_files} file
                      {summary.total_files === 1 ? '' : 's'}
                      {summary.truncated && ' (truncated)'}
                    </span>
                  )}
                </div>
              </>
            ) : activeTab === 'sessions' ? (
              <div className="text-text-tertiary flex items-center gap-2">
                {sessionSearching && <Loader2 size={11} className="animate-spin" />}
                {!sessionSearching && query.trim() && (
                  <span>
                    {sessionResults.length} result{sessionResults.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-text-tertiary">
                {filteredSnippets.length} snippet{filteredSnippets.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">

          {/* ── Files ──────────────────────────────────────────────────────── */}
          {activeTab === 'files' && (
            <>
              {error && (
                <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-error">
                  <AlertCircle size={13} />
                  {error}
                </div>
              )}
              {!error && !searching && summary && summary.results.length === 0 && query.trim() && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  No matches found
                </div>
              )}
              {!error && !query.trim() && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  Type to search file names and contents across the workspace.
                </div>
              )}
              {!error &&
                results.map((file, fileIdx) => {
                  const collapsed = collapsedFiles.has(file.file_path);
                  const fileSelected = selected.fileIdx === fileIdx && selected.matchIdx === -1;
                  return (
                    <div key={file.file_path} className="mb-0.5">
                      <button
                        data-nav={`${fileIdx}--1`}
                        onClick={() => toggleFile(file.file_path)}
                        onDoubleClick={() => openMatch(file)}
                        className={`w-full flex items-center gap-1.5 px-3 py-1 text-left transition-colors ${
                          fileSelected ? 'bg-accent-primary/10' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        {collapsed ? (
                          <ChevronRight
                            size={11}
                            className="text-text-tertiary flex-shrink-0"
                            strokeWidth={1.75}
                          />
                        ) : (
                          <ChevronDown
                            size={11}
                            className="text-text-tertiary flex-shrink-0"
                            strokeWidth={1.75}
                          />
                        )}
                        <FileCode2
                          size={11}
                          className="text-text-tertiary flex-shrink-0"
                          strokeWidth={1.75}
                        />
                        <span
                          className="text-[12px] text-text-primary font-mono truncate"
                          title={file.relative_path}
                        >
                          {file.relative_path}
                        </span>
                        {file.name_match && (
                          <span className="text-[9px] uppercase tracking-wider text-accent-primary bg-accent-primary/15 px-1 rounded flex-shrink-0">
                            name
                          </span>
                        )}
                        <span className="text-text-tertiary text-[10.5px] flex-shrink-0 ml-auto">
                          {file.matches.length || (file.name_match ? '·' : 0)}
                        </span>
                      </button>

                      {!collapsed && (
                        <div className="ml-5 border-l border-border">
                          {file.matches.map((m, matchIdx) => {
                            const isSelected =
                              selected.fileIdx === fileIdx && selected.matchIdx === matchIdx;
                            return (
                              <button
                                key={`${m.line}-${matchIdx}`}
                                data-nav={`${fileIdx}-${matchIdx}`}
                                onClick={() => {
                                  setSelected({ fileIdx, matchIdx });
                                  openMatch(file);
                                }}
                                onMouseEnter={() => setSelected({ fileIdx, matchIdx })}
                                className={`w-full flex items-baseline gap-2 px-3 py-0.5 text-left transition-colors ${
                                  isSelected ? 'bg-accent-primary/12' : 'hover:bg-white/[0.04]'
                                }`}
                              >
                                <span className="text-text-tertiary text-[10.5px] font-mono flex-shrink-0 w-8 text-right tabular-nums">
                                  {m.line}
                                </span>
                                <span className="text-[12px] font-mono truncate flex-1 min-w-0">
                                  <HighlightedLine
                                    text={m.line_text}
                                    column={m.column}
                                    matchLength={m.match_length}
                                  />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </>
          )}

          {/* ── Sessions ───────────────────────────────────────────────────── */}
          {activeTab === 'sessions' && (
            <>
              {!query.trim() && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  Type to search across session history and terminal logs.
                </div>
              )}
              {query.trim() && !sessionSearching && sessionResults.length === 0 && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  No session matches found.
                </div>
              )}
              {sessionResults.map((r, idx) => (
                <div
                  key={`${r.session_id}-${idx}`}
                  className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors border-b border-border/40 last:border-b-0"
                >
                  <Clock
                    size={12}
                    className="text-text-tertiary flex-shrink-0 mt-0.5"
                    strokeWidth={1.75}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] text-text-primary font-medium truncate">
                        <HighlightText text={r.label} query={query.trim()} />
                      </span>
                      {r.line_no > 0 && (
                        <span className="text-[10px] text-text-tertiary font-mono flex-shrink-0">
                          line {r.line_no}
                        </span>
                      )}
                    </div>
                    {r.snippet !== r.label && (
                      <div className="text-[11px] font-mono truncate mt-0.5">
                        <HighlightText text={r.snippet} query={query.trim()} />
                      </div>
                    )}
                    <div className="text-[10px] text-text-tertiary mt-0.5">
                      {new Date(r.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── Snippets ────────────────────────────────────────────────────── */}
          {activeTab === 'snippets' && (
            <>
              {allSnippets.length === 0 && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  No snippets saved yet. Create snippets from the Snippets panel (Ctrl+Shift+S).
                </div>
              )}
              {allSnippets.length > 0 && filteredSnippets.length === 0 && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  No snippets match your query.
                </div>
              )}
              {filteredSnippets.map((s) => (
                <div
                  key={s.id}
                  className="px-4 py-2.5 hover:bg-white/[0.04] transition-colors border-b border-border/40 last:border-b-0"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Scissors
                      size={11}
                      className="text-text-tertiary flex-shrink-0"
                      strokeWidth={1.75}
                    />
                    <span className="text-[12px] text-text-primary font-medium truncate">
                      <HighlightText text={s.title} query={query.trim()} />
                    </span>
                    {s.category && (
                      <span className="text-[9px] uppercase tracking-wider text-text-tertiary bg-elevation-2 px-1.5 py-0.5 rounded flex-shrink-0">
                        {s.category}
                      </span>
                    )}
                  </div>
                  <pre className="text-[11px] text-text-tertiary font-mono whitespace-pre-wrap break-all line-clamp-3 ml-4">
                    <HighlightText text={s.content} query={query.trim()} />
                  </pre>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-text-tertiary">
          {activeTab === 'files' && (
            <>
              <span>
                <kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">
                  ↑↓
                </kbd>{' '}
                navigate
              </span>
              <span>
                <kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">
                  ↵
                </kbd>{' '}
                open file
              </span>
              <span className="ml-auto">
                <kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">
                  Aa
                </kbd>{' '}
                match case
              </span>
            </>
          )}
          {activeTab === 'sessions' && (
            <span>Searches session labels and terminal log contents</span>
          )}
          {activeTab === 'snippets' && <span>Filters by title and content</span>}
          <span className={activeTab === 'files' ? '' : 'ml-auto'}>
            <kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">
              esc
            </kbd>{' '}
            close
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
