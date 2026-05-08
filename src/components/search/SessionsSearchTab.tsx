import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Clock, AlertCircle } from 'lucide-react';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SessionSearchResult {
  session_id: number;
  terminal_id: string;
  label: string;
  snippet: string;
  line_no: number;
  timestamp: string;
}

// ── Highlight helper ───────────────────────────────────────────────────────────

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

// ── Props ──────────────────────────────────────────────────────────────────────

interface SessionsSearchTabProps {
  query: string;
  active: boolean;
  selected: number;
  onSelect: (idx: number) => void;
  onSearchingChange: (searching: boolean) => void;
  onResultCountChange: (count: number) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SessionsSearchTab({
  query,
  active,
  selected,
  onSelect,
  onSearchingChange,
  onResultCountChange,
}: SessionsSearchTabProps) {
  const fetcher = useCallback(
    (q: string) => invoke<SessionSearchResult[]>('search_session_history', { query: q }),
    [],
  );

  const { results, searching, error } = useDebouncedSearch<SessionSearchResult[]>(
    query,
    active,
    fetcher,
  );

  useEffect(() => { onSearchingChange(searching); }, [searching, onSearchingChange]);

  const sessionResults = results ?? [];

  useEffect(() => { onResultCountChange(sessionResults.length); }, [sessionResults.length, onResultCountChange]);

  if (error) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-error">
        <AlertCircle size={13} />
        {error}
      </div>
    );
  }

  if (!query.trim()) {
    return (
      <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
        Type to search session labels and log file contents.
      </div>
    );
  }

  if (!searching && sessionResults.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
        No sessions match &ldquo;{query.trim()}&rdquo;
      </div>
    );
  }

  return (
    <>
      {sessionResults.map((r, idx) => {
        const isSel = selected === idx;
        return (
          <div
            key={`${r.session_id}-${r.line_no}-${idx}`}
            data-session-idx={idx}
            onMouseEnter={() => onSelect(idx)}
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
  );
}
