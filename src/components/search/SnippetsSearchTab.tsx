import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Scissors } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Snippet {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
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

interface SnippetsSearchTabProps {
  query: string;
  selected: number;
  onSelect: (idx: number) => void;
  onTotalChange: (total: number) => void;
  onFilteredChange: (count: number) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SnippetsSearchTab({
  query,
  selected,
  onSelect,
  onTotalChange,
  onFilteredChange,
}: SnippetsSearchTabProps) {
  const [allSnippets, setAllSnippets] = useState<Snippet[]>([]);

  useEffect(() => {
    invoke<Snippet[]>('get_snippets')
      .then(setAllSnippets)
      .catch(() => { /* non-fatal */ });
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

  useEffect(() => { onTotalChange(allSnippets.length); }, [allSnippets.length, onTotalChange]);
  useEffect(() => { onFilteredChange(filteredSnippets.length); }, [filteredSnippets.length, onFilteredChange]);

  if (allSnippets.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
        No snippets saved yet.
      </div>
    );
  }

  if (filteredSnippets.length === 0 && query.trim()) {
    return (
      <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
        No snippets match &ldquo;{query.trim()}&rdquo;
      </div>
    );
  }

  return (
    <>
      {filteredSnippets.map((s, idx) => {
        const isSel = selected === idx;
        return (
          <div
            key={s.id}
            onMouseEnter={() => onSelect(idx)}
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
  );
}
