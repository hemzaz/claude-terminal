import type { RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { Block } from '../lib/blockParser';

interface BlockOverlayProps {
  blocks: readonly Block[];
  /** Current xterm viewport top line (from onScroll). */
  viewportY: number;
  /** Block id of the currently-navigated block, for highlight. */
  activeBlockId: string | null;
  /** Ref to the xterm container div — used to read pixel height. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Live xterm Terminal instance — used to read rows count. */
  terminal: Terminal | null;
  /** Called when the user clicks the Copy button on a block. */
  onCopy: (block: Block) => void;
}

/**
 * Absolutely-positioned overlay that renders thin separator lines and copy
 * buttons at the start of each assistant block.
 *
 * The outer div is pointer-events-none so all xterm canvas interactions pass
 * through. Individual buttons re-enable pointer events via pointer-events-auto.
 */
export function BlockOverlay({
  blocks,
  viewportY,
  activeBlockId,
  containerRef,
  terminal,
  onCopy,
}: BlockOverlayProps) {
  if (!terminal || !containerRef.current || blocks.length === 0) return null;

  const containerHeight = containerRef.current.clientHeight;
  const { rows } = terminal;
  if (rows === 0 || containerHeight === 0) return null;
  const rowHeight = containerHeight / rows;

  // Only render blocks that overlap the current viewport
  const visibleBlocks = blocks.filter((b) => {
    const end = b.endLine === -1 ? Infinity : b.endLine;
    return b.startLine < viewportY + rows && end >= viewportY;
  });

  if (visibleBlocks.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {visibleBlocks.map((block) => {
        const linesFromTop = block.startLine - viewportY;
        const top = linesFromTop * rowHeight;
        const isActive = block.id === activeBlockId;

        return (
          <div
            key={block.id}
            className="absolute left-0 right-0 flex items-center"
            style={{ top: Math.max(0, top) }}
          >
            {/* Separator line */}
            <div
              className={`h-px flex-1 transition-colors duration-150 ${
                isActive ? 'bg-accent-primary/60' : 'bg-white/10'
              }`}
            />
            {/* Copy button — pointer-events-auto allows clicks through overlay */}
            <button
              className="pointer-events-auto flex items-center rounded px-1.5 py-0 text-[10px] leading-5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
              onClick={() => onCopy(block)}
              title="Copy Claude response (Cmd+Up/Down to navigate blocks)"
            >
              Copy
            </button>
          </div>
        );
      })}
    </div>
  );
}
