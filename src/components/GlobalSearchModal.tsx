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
  Scissors,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';

// ── types ─────────────────────────────────────────────────────────────────────

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

interface Snippet {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
}

type Tab = 'files' | 'sessions' | 'snippets';

// ── helpers ───────────────────────────────────────────────────────────────────

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
  const before =
    previewStart > 0 ? '…' + text.slice(previewStart, start) : text.slice(0, start);
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

/** Highlight all occurrences of `query` inside `text` (case-insensitive). */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <span>{text}</span>;
  const lc = text.toLowerCase();
  const ql = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx: number;
  while ((idx = lc.indexOf(ql, cursor)) !== -1) {
    if (idx > cursor) parts.push(<span key={cursor}>{text.slice(cursor, idx)}</span>);
    parts.push(
      <span key={idx} className="bg-accent-primary/30 text-text-primary rounded-[2px] px-[1px]">
        {text.slice(idx, idx + ql.length)}
      </span>,
    );
    cursor = idx + ql.length;
  }
  if (cursor < text.length) parts.push(<span key={cursor}>{text.slice(cursor)}</span>);
  return <>{parts}</>;
}

// ── main component ─────────────────────────────────────────────────────────────

export function GlobalSearchModal() {
  const closeModal = useAppStore((s) => s.closeModal);
  const openFileTab = useAppStore((s) => s.openFileTab);
  const pinnedRepoPath = useAppStore((s) => s.pinnedRepoPath);
  const activeCwd = useTerminalStore((s) => {
    const id = s.activeTerminalId;
    return id ? s.terminals.get(id)?.config.working_directory ?? null : null;
  });
  const searchRoot = pinnedRepoPath ?? activeCwd;

  const [tab, setTab] = useState<Tab>('files');
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);

  // ── Files tab state ──────────────────────────────────────────────────────
  const [fileSearching, setFileSearching] = useState(false);
  const [fileSummary, setFileSummary] = useState<SearchSummary | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [fileSelected, setFileSelected] = useState<{ fileIdx: number; matchIdx: number }>({
    fileIdx: 0,
    matchIdx: 0,
  });
  const fileSearchToken = useRef(0);

  // ── Sessions tab state ───────────────────────────────────────────────────
  const [sessionSearching, setSessionSearching] = useState(false);
  const [sessionResults, setSessionResults] = useState<SessionSearchResult[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionSelected, setSessionSelected] = useState(0);
  const sessionSearchToken = useRef(0);

  // ── Snippets tab state ───────────────────────────────────────────────────
  const [allSnippets, setAllSnippets] = useState<Snippet[]>([]);
  const [snippetSelected, setSnippetSelected] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Focus input when switching tabs
  useEffect(() => {
    inputRef.current?.focus();
  }, [tab]);

  // ── Files search (debounced) ─────────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'files') return;
    if (!searchRoot) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setFileSummary(null);
      setFileError(null);
      setFileSearching(false);
      return;
    }
    setFileSearching(true);
    const myToken = ++fileSearchToken.current;
    const handle = setTimeout(async () => {
      try {
        const res = await invoke<SearchSummary>('search_in_files', {
          path: searchRoot,
          query: trimmed,
          caseSensitive,
          includeFileContents: true,
        });
        if (myToken !== fileSearchToken.current) return;
        setFileSummary(res);
        setFileError(null);
        setCollapsedFiles(new Set());
        setFileSelected({ fileIdx: 0, matchIdx: 0 });
      } catch (err) {
        if (myToken !== fileSearchToken.current) return;
        setFileError(typeof err === 'string' ? err : 'Search failed');
        setFileSummary(null);
      } finally {
        if (myToken === fileSearchToken.current) setFileSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, caseSensitive, searchRoot, tab]);

  // ── Sessions search (debounced) ──────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'sessions') return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSessionResults([]);
      setSessionError(null);
      setSessionSearching(false);
      return;
    }
    setSessionSearching(true);
    const myToken = ++sessionSearchToken.current;
    const handle = setTimeout(async () => {
      try {
        const res = await invoke<SessionSearchResult[]>('search_session_history', {
          query: trimmed,
        });
        if (myToken !== sessionSearchToken.current) return;
        setSessionResults(res);
        setSessionError(null);
        setSessionSelected(0);
      } catch (err) {
        if (myToken !== sessionSearchToken.current) return;
        setSessionError(typeof err === 'string' ? err : 'Search failed');
        setSessionResults([]);
      } finally {
        if (myToken === sessionSearchToken.current) setSessionSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, tab]);

  // ── Load snippets once on mount ──────────────────────────────────────────
  useEffect(() => {
    invoke<Snippet[]>('get_snippets')
      .then(setAllSnippets)
      .catch(() => {/* non-fatal */});
  }, []);

  const filteredSnippets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSnippets;
    return allSnippets.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q),
    );
  }, [query, allSnippets]);

  // ── Files: flat navigation ───────────────────────────────────────────────
  const fileResults = fileSummary?.results ?? [];
  const flatFileNav = useMemo(() => {
    const out: { fileIdx: number; matchIdx: number }[] = [];
    fileResults.forEach((file, fileIdx) => {
      if (collapsedFiles.has(file.file_path)) return;
      file.matches.forEach((_, matchIdx) => out.push({ fileIdx, matchIdx }));
      if (file.matches.length === 0) out.push({ fileIdx, matchIdx: -1 });
    });
    return out;
  }, [fileResults, collapsedFiles]);

  const flatFileIndex = useMemo(
    () =>
      flatFileNav.findIndex(
        (e) => e.fileIdx === fileSelected.fileIdx && e.matchIdx === fileSelected.matchIdx,
      ),
    [flatFileNav, fileSelected],
  );

  const openFileMatch = useCallback(
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

  // ── Keyboard navigation ──────────────────────────────────────────────────
  const moveFileSelection = (delta: number) => {
    if (flatFileNav.length === 0) return;
    const idx = flatFileIndex < 0 ? 0 : flatFileIndex;
    const next = (idx + delta + flatFileNav.length) % flatFileNav.length;
    setFileSelected(flatFileNav[next]);
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-nav="${flatFileNav[next].fileIdx}-${flatFileNav[next].matchIdx}"]`,
      );
      el?.scrollIntoView({ block: 'nearest' });
    });
  };

  const moveSessionSelection = (delta: number) => {
    if (sessionResults.length === 0) return;
    const next = (sessionSelected + delta + sessionResults.length) % sessionResults.length;
    setSessionSelected(next);
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-session-idx="${next}"]`,
      );
      el?.scrollIntoView({ block: 'nearest' });
    });
  };

  const moveSnippetSelection = (delta: number) => {
    if (filteredSnippets.length === 0) return;
    setSnippetSelected(
      (prev) => (prev + delta + filteredSnippets.length) % filteredSnippets.length,
    );
  };


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      setTab((t) => (t === 'files' ? 'sessions' : t === 'sessions' ? 'snippets' : 'files'));
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      setTab((t) => (t === 'files' ? 'snippets' : t === 'sessions' ? 'files' : 'sessions'));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (tab === 'files') moveFileSelection(1);
      else if (tab === 'sessions') moveSessionSelection(1);
      else moveSnippetSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (tab === 'files') moveFileSelection(-1);
      else if (tab === 'sessions') moveSessionSelection(-1);
      else moveSnippetSelection(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (tab === 'files') {
        const file = fileResults[fileSelected.fileIdx];
        if (file) openFileMatch(file);
      }
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'files', label: 'Files', icon: <FileCode2 size={11} strokeWidth={1.75} /> },
    { id: 'sessions', label: 'Sessions', icon: <Clock size={11} strokeWidth={1.75} /> },
    { id: 'snippets', label: 'Snippets', icon: <Scissors size={11} strokeWidth={1.75} /> },
  ];

  const isSearching =
    tab === 'files' ? fileSearching : tab === 'sessions' ? sessionSearching : false;


  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[8vh]"
      onMouseDown={(e) => {
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

          <button
            onClick={closeModal}
            className="p-1 rounded hover:bg-white/[0.06] text-text-tertiary hover:text-text-primary transition-colors"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 pt-2 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-medium rounded-t transition-colors border-b-2 -mb-px ${
                tab === t.id
                  ? 'border-accent-primary text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              }`}
              tabIndex={-1}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Search input row */}
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
                tab === 'files'
                  ? 'Search across the workspace…'
                  : tab === 'sessions'
                    ? 'Search session history…'
                    : 'Filter snippets…'
              }
              className="w-full bg-elevation-1 ring-1 ring-inset ring-border rounded-md h-9 pl-9 pr-24 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-accent-primary/60"
            />
            {tab === 'files' && (
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
            <div className="text-text-tertiary truncate" title={searchRoot ?? ''}>
              {tab === 'files' ? (
                searchRoot ? (
                  <>
                    in <span className="font-mono text-text-secondary">{searchRoot}</span>
                  </>
                ) : (
                  'No active workspace — open a terminal first'
                )
              ) : tab === 'sessions' ? (
                'Searching session history & log files'
              ) : (
                `${allSnippets.length} snippet${allSnippets.length === 1 ? '' : 's'} loaded`
              )}
            </div>
            <div className="text-text-tertiary flex items-center gap-2">
              {isSearching && <Loader2 size={11} className="animate-spin" />}
              {tab === 'files' && fileSummary && !fileSearching && (
                <span>
                  {fileSummary.total_matches} match
                  {fileSummary.total_matches === 1 ? '' : 'es'} in {fileSummary.total_files} file
                  {fileSummary.total_files === 1 ? '' : 's'}
                  {fileSummary.truncated && ' (truncated)'}
                </span>
              )}
              {tab === 'sessions' && !sessionSearching && sessionResults.length > 0 && (
                <span>
                  {sessionResults.length} result{sessionResults.length === 1 ? '' : 's'}
                </span>
              )}
              {tab === 'snippets' && (
                <span>
                  {filteredSnippets.length} / {allSnippets.length}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">

          {/* ── Files tab ──────────────────────────────────────────────── */}
          {tab === 'files' && (
            <>
              {fileError && (
                <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-error">
                  <AlertCircle size={13} />
                  {fileError}
                </div>
              )}
              {!fileError && !fileSearching && fileSummary && fileSummary.results.length === 0 && query.trim() && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  No matches found
                </div>
              )}
              {!fileError && !query.trim() && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  Type to search file names and contents across the workspace.
                </div>
              )}
              {!fileError &&
                fileResults.map((file, fileIdx) => {
                  const collapsed = collapsedFiles.has(file.file_path);
                  const isFileRowSelected =
                    fileSelected.fileIdx === fileIdx && fileSelected.matchIdx === -1;
                  return (
                    <div key={file.file_path} className="mb-0.5">
                      <button
                        data-nav={`${fileIdx}--1`}
                        onClick={() => toggleFile(file.file_path)}
                        onDoubleClick={() => openFileMatch(file)}
                        className={`w-full flex items-center gap-1.5 px-3 py-1 text-left transition-colors ${
                          isFileRowSelected ? 'bg-accent-primary/10' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        {collapsed ? (
                          <ChevronRight size={11} className="text-text-tertiary flex-shrink-0" strokeWidth={1.75} />
                        ) : (
                          <ChevronDown size={11} className="text-text-tertiary flex-shrink-0" strokeWidth={1.75} />
                        )}
                        <FileCode2 size={11} className="text-text-tertiary flex-shrink-0" strokeWidth={1.75} />
                        <span className="text-[12px] text-text-primary font-mono truncate" title={file.relative_path}>
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
                            const isSel =
                              fileSelected.fileIdx === fileIdx &&
                              fileSelected.matchIdx === matchIdx;
                            return (
                              <button
                                key={`${m.line}-${matchIdx}`}
                                data-nav={`${fileIdx}-${matchIdx}`}
                                onClick={() => {
                                  setFileSelected({ fileIdx, matchIdx });
                                  openFileMatch(file);
                                }}
                                onMouseEnter={() => setFileSelected({ fileIdx, matchIdx })}
                                className={`w-full flex items-baseline gap-2 px-3 py-0.5 text-left transition-colors ${
                                  isSel ? 'bg-accent-primary/12' : 'hover:bg-white/[0.04]'
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

          {/* ── Sessions tab ─────────────────────────────────────────────── */}
          {tab === 'sessions' && (
            <>
              {sessionError && (
                <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-error">
                  <AlertCircle size={13} />
                  {sessionError}
                </div>
              )}
              {!sessionError && !query.trim() && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  Type to search session labels and log file contents.
                </div>
              )}
              {!sessionError && query.trim() && !sessionSearching && sessionResults.length === 0 && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  No sessions match &ldquo;{query.trim()}&rdquo;
                </div>
              )}
              {!sessionError &&
                sessionResults.map((r, idx) => {
                  const isSel = sessionSelected === idx;
                  return (
                    <div
                      key={`${r.session_id}-${r.line_no}-${idx}`}
                      data-session-idx={idx}
                      onMouseEnter={() => setSessionSelected(idx)}
                      className={`flex flex-col px-4 py-2 transition-colors cursor-default ${
                        isSel ? 'bg-accent-primary/10' : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Clock size={10} className="text-text-tertiary flex-shrink-0" strokeWidth={1.75} />
                        <span className="text-[12px] text-text-primary font-medium truncate">
                          <HighlightedText text={r.label} query={query.trim()} />
                        </span>
                        {r.line_no > 0 && (
                          <span className="text-[10px] text-text-tertiary flex-shrink-0 font-mono">
                            line {r.line_no}
                          </span>
                        )}
                        <span className="text-[10px] text-text-tertiary flex-shrink-0 ml-auto">
                          {r.timestamp.slice(0, 10)}
                        </span>
                      </div>
                      {r.snippet && r.snippet !== r.label && (
                        <div className="mt-0.5 pl-4 text-[11.5px] text-text-tertiary font-mono truncate">
                          <HighlightedText text={r.snippet} query={query.trim()} />
                        </div>
                      )}
                    </div>
                  );
                })}
            </>
          )}

          {/* ── Snippets tab ──────────────────────────────────────────────── */}
          {tab === 'snippets' && (
            <>
              {allSnippets.length === 0 && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  No snippets saved yet.
                </div>
              )}
              {allSnippets.length > 0 && filteredSnippets.length === 0 && query.trim() && (
                <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
                  No snippets match &ldquo;{query.trim()}&rdquo;
                </div>
              )}
              {filteredSnippets.map((s, idx) => {
                const isSel = snippetSelected === idx;
                return (
                  <div
                    key={s.id}
                    onMouseEnter={() => setSnippetSelected(idx)}
                    className={`flex flex-col px-4 py-2 transition-colors cursor-default ${
                      isSel ? 'bg-accent-primary/10' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Scissors size={10} className="text-text-tertiary flex-shrink-0" strokeWidth={1.75} />
                      <span className="text-[12px] text-text-primary font-medium truncate">
                        <HighlightedText text={s.title} query={query.trim()} />
                      </span>
                      {s.category && (
                        <span className="text-[9px] uppercase tracking-wider text-accent-primary bg-accent-primary/15 px-1 rounded flex-shrink-0">
                          {s.category}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 pl-4 text-[11.5px] text-text-tertiary font-mono truncate">
                      <HighlightedText
                        text={s.content.split('\n')[0]}
                        query={query.trim()}
                      />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-text-tertiary">
          <span>
            <kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">↑↓</kbd>{' '}
            navigate
          </span>
          {tab === 'files' && (
            <span>
              <kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">↵</kbd>{' '}
              open file
            </span>
          )}
          <span>
            <kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">Tab</kbd>{' '}
            switch tab
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">esc</kbd>{' '}
            close
          </span>
          {tab === 'files' && (
            <span className="ml-auto">
              <kbd className="px-1 py-0.5 bg-elevation-2 rounded border border-border font-mono">Aa</kbd>{' '}
              match case
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
