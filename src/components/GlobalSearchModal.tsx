import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search as SearchIcon,
  X,
  Loader2,
  CaseSensitive,
  FileCode2,
  Clock,
  Scissors,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';
import { FilesSearchTab, FileSearchResult, SearchSummary } from './search/FilesSearchTab';
import { SessionsSearchTab } from './search/SessionsSearchTab';
import { SnippetsSearchTab } from './search/SnippetsSearchTab';

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = 'files' | 'sessions' | 'snippets';

// ── Component ──────────────────────────────────────────────────────────────────

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

  // ── Per-tab state lifted from children (status line + keyboard nav) ────────
  const [fileSearching, setFileSearching] = useState(false);
  const [fileSummary, setFileSummary] = useState<SearchSummary | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [fileSelected, setFileSelected] = useState<{ fileIdx: number; matchIdx: number }>({
    fileIdx: 0,
    matchIdx: 0,
  });

  const [sessionSearching, setSessionSearching] = useState(false);
  const [sessionResultCount, setSessionResultCount] = useState(0);
  const [sessionSelected, setSessionSelected] = useState(0);

  const [snippetTotal, setSnippetTotal] = useState(0);
  const [snippetFiltered, setSnippetFiltered] = useState(0);
  const [snippetSelected, setSnippetSelected] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, [tab]);

  useEffect(() => {
    setFileSelected({ fileIdx: 0, matchIdx: 0 });
    setSessionSelected(0);
    setSnippetSelected(0);
  }, [query]);

  useEffect(() => { setCollapsedFiles(new Set()); }, [fileSummary]);

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

  const toggleFile = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  // ── Keyboard navigation ──────────────────────────────────────────────────
  const fileResults = fileSummary?.results ?? [];

  const flatFileNav = (() => {
    const out: { fileIdx: number; matchIdx: number }[] = [];
    fileResults.forEach((file, fileIdx) => {
      if (collapsedFiles.has(file.file_path)) return;
      file.matches.forEach((_, matchIdx) => out.push({ fileIdx, matchIdx }));
      if (file.matches.length === 0) out.push({ fileIdx, matchIdx: -1 });
    });
    return out;
  })();

  const flatFileIndex = flatFileNav.findIndex(
    (e) => e.fileIdx === fileSelected.fileIdx && e.matchIdx === fileSelected.matchIdx,
  );

  const moveFileSelection = (delta: number) => {
    if (flatFileNav.length === 0) return;
    const idx = flatFileIndex < 0 ? 0 : flatFileIndex;
    const next = (idx + delta + flatFileNav.length) % flatFileNav.length;
    setFileSelected(flatFileNav[next]);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-nav="${flatFileNav[next].fileIdx}-${flatFileNav[next].matchIdx}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  };

  const moveSessionSelection = (delta: number) => {
    if (sessionResultCount === 0) return;
    const next = (sessionSelected + delta + sessionResultCount) % sessionResultCount;
    setSessionSelected(next);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-session-idx="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  };

  const moveSnippetSelection = (delta: number) => {
    if (snippetFiltered === 0) return;
    setSnippetSelected((prev) => (prev + delta + snippetFiltered) % snippetFiltered);
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

  const isSearching = tab === 'files' ? fileSearching : tab === 'sessions' ? sessionSearching : false;

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
                `${snippetTotal} snippet${snippetTotal === 1 ? '' : 's'} loaded`
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
              {tab === 'sessions' && !sessionSearching && sessionResultCount > 0 && (
                <span>{sessionResultCount} result{sessionResultCount === 1 ? '' : 's'}</span>
              )}
              {tab === 'snippets' && (
                <span>{snippetFiltered} / {snippetTotal}</span>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
          {tab === 'files' && (
            <FilesSearchTab
              query={query}
              caseSensitive={caseSensitive}
              searchRoot={searchRoot}
              active={tab === 'files'}
              selected={fileSelected}
              collapsedFiles={collapsedFiles}
              onSelect={setFileSelected}
              onToggleCollapse={toggleFile}
              onOpenFile={openFileMatch}
              onSearchingChange={setFileSearching}
              onSummaryChange={setFileSummary}
            />
          )}
          {tab === 'sessions' && (
            <SessionsSearchTab
              query={query}
              active={tab === 'sessions'}
              selected={sessionSelected}
              onSelect={setSessionSelected}
              onSearchingChange={setSessionSearching}
              onResultCountChange={setSessionResultCount}
            />
          )}
          {tab === 'snippets' && (
            <SnippetsSearchTab
              query={query}
              selected={snippetSelected}
              onSelect={setSnippetSelected}
              onTotalChange={setSnippetTotal}
              onFilteredChange={setSnippetFiltered}
            />
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
