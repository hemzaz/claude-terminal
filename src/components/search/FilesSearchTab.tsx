import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronRight, FileCode2, AlertCircle } from 'lucide-react';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SearchMatch {
  line: number;
  column: number;
  line_text: string;
  match_length: number;
}

export interface FileSearchResult {
  file_path: string;
  relative_path: string;
  matches: SearchMatch[];
  name_match: boolean;
}

export interface SearchSummary {
  results: FileSearchResult[];
  total_matches: number;
  total_files: number;
  truncated: boolean;
}

// ── Highlight helper ───────────────────────────────────────────────────────────

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

// ── Props ──────────────────────────────────────────────────────────────────────

interface FilesSearchTabProps {
  query: string;
  caseSensitive: boolean;
  searchRoot: string | null;
  active: boolean;
  selected: { fileIdx: number; matchIdx: number };
  collapsedFiles: Set<string>;
  onSelect: (sel: { fileIdx: number; matchIdx: number }) => void;
  onToggleCollapse: (filePath: string) => void;
  onOpenFile: (file: FileSearchResult) => void;
  onSearchingChange: (searching: boolean) => void;
  onSummaryChange: (summary: SearchSummary | null) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function FilesSearchTab({
  query,
  caseSensitive,
  searchRoot,
  active,
  selected,
  collapsedFiles,
  onSelect,
  onToggleCollapse,
  onOpenFile,
  onSearchingChange,
  onSummaryChange,
}: FilesSearchTabProps) {
  const fetcher = useCallback(
    (q: string) =>
      invoke<SearchSummary>('search_in_files', {
        path: searchRoot ?? '',
        query: q,
        caseSensitive,
        includeFileContents: true,
      }),
    [searchRoot, caseSensitive],
  );

  const { results: summary, searching, error } = useDebouncedSearch<SearchSummary>(
    query,
    active && !!searchRoot,
    fetcher,
  );

  useEffect(() => { onSearchingChange(searching); }, [searching, onSearchingChange]);
  useEffect(() => { onSummaryChange(summary); }, [summary, onSummaryChange]);

  const fileResults = summary?.results ?? [];

  if (!searchRoot) {
    return (
      <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
        No active workspace — open a terminal first
      </div>
    );
  }

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
        Type to search file names and contents across the workspace.
      </div>
    );
  }

  if (!searching && summary && fileResults.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-text-tertiary text-[12px]">
        No matches found
      </div>
    );
  }

  return (
    <>
      {fileResults.map((file, fileIdx) => {
        const collapsed = collapsedFiles.has(file.file_path);
        const isFileRowSelected = selected.fileIdx === fileIdx && selected.matchIdx === -1;
        return (
          <div key={file.file_path} className="mb-0.5">
            <button
              data-nav={`${fileIdx}--1`}
              onClick={() => onToggleCollapse(file.file_path)}
              onDoubleClick={() => onOpenFile(file)}
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
                  const isSel = selected.fileIdx === fileIdx && selected.matchIdx === matchIdx;
                  return (
                    <button
                      key={`${m.line}-${matchIdx}`}
                      data-nav={`${fileIdx}-${matchIdx}`}
                      onClick={() => {
                        onSelect({ fileIdx, matchIdx });
                        onOpenFile(file);
                      }}
                      onMouseEnter={() => onSelect({ fileIdx, matchIdx })}
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
  );
}
