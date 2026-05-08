import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useTerminalStore } from '../store/terminalStore';
import { TerminalSearch } from './TerminalSearch';
import { TerminalStatusBar } from './TerminalStatusBar';
import { BlockOverlay } from './BlockOverlay';
import { BlockParser, type Block } from '../lib/blockParser';
import '@xterm/xterm/css/xterm.css';

function formatDroppedPath(path: string): string {
  // Strip control characters — macOS/Linux filenames can legally contain
  // newlines, which would otherwise auto-execute whatever follows in the PTY
  // without the user pressing Enter.
  const sanitized = path.replace(/[\x00-\x1f\x7f]/g, '');
  const isWindowsPath = /^([a-zA-Z]:[\\/]|\\\\)/.test(sanitized);
  if (isWindowsPath) {
    // cmd/pwsh don't expand $ or backtick and don't process backslash escapes,
    // so preserve backslashes as path separators and only escape embedded ".
    if (/[\s"'`$&|;<>()*?]/.test(sanitized)) {
      return `"${sanitized.replace(/"/g, '\\"')}"`;
    }
    return sanitized;
  }
  // POSIX path → likely bash/zsh. Single quotes suppress all expansion; an
  // embedded single quote is closed, escaped, and reopened.
  if (/[\s"'`$&|;<>()*?\\]/.test(sanitized)) {
    return `'${sanitized.replace(/'/g, "'\\''")}'`;
  }
  return sanitized;
}

const SCROLLBACK_ACTIVE = 100_000;
const SCROLLBACK_INACTIVE = 10_000;

interface TerminalViewProps {
  terminalId: string;
}

export function TerminalView({ terminalId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  // Narrow selector — only re-render when THIS terminal's instance changes,
  // not on every output-unread-set update for other terminals.
  const instance = useTerminalStore((s) => s.terminals.get(terminalId));
  // Track whether this terminal is the currently active tab so we can
  // adjust scrollback buffer size (active → large, inactive → small).
  const isActive = useTerminalStore((s) => s.activeTerminalId === terminalId);
  // Stable action refs: these are static on the store so pulling them via
  // getState avoids putting them in the effect dep array (which was causing
  // the xterm instance to tear down on every unrelated store update).
  const writeToTerminal = useTerminalStore.getState().writeToTerminal;
  const resizeTerminal = useTerminalStore.getState().resizeTerminal;
  const setXterm = useTerminalStore.getState().setXterm;

  const toggleSearch = useCallback(() => {
    setSearchVisible(prev => !prev);
  }, []);

  // Block-based output state — tracks assistant response boundaries for overlay
  const [blocks, setBlocks] = useState<readonly Block[]>([]);
  const [viewportY, setViewportY] = useState(0);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  // Ref keeps the keyboard handler (captured at effect setup time) in sync with
  // the latest blocks array without needing to re-create the xterm instance.
  const blocksRef = useRef<readonly Block[]>([]);

  // Reads the plain text of a block from the xterm buffer and copies it.
  const handleCopyBlock = useCallback((block: Block) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const buf = terminal.buffer.active;
    const endLine = block.endLine === -1 ? buf.length - 1 : block.endLine;
    const lines: string[] = [];
    for (let y = block.startLine; y <= Math.min(endLine, buf.length - 1); y++) {
      const line = buf.getLine(y);
      if (line) lines.push(line.translateToString(true));
    }
    // Trim trailing blank lines before copying
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
  }, []);

  useEffect(() => {
    if (!containerRef.current || !instance) return;

    const terminal = new Terminal({
      theme: {
        background: '#101010',
        foreground: '#E5E5E5',
        cursor: '#E5E5E5',
        cursorAccent: '#101010',
        selectionBackground: 'rgba(59, 130, 246, 0.25)',
        black: '#171717',
        red: '#EF4444',
        green: '#4ADE80',
        yellow: '#FBBF24',
        blue: '#3B82F6',
        magenta: '#A855F7',
        cyan: '#22D3EE',
        white: '#E5E5E5',
        brightBlack: '#525252',
        brightRed: '#F87171',
        brightGreen: '#86EFAC',
        brightYellow: '#FDE047',
        brightBlue: '#60A5FA',
        brightMagenta: '#C084FC',
        brightCyan: '#67E8F9',
        brightWhite: '#FFFFFF',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      allowProposedApi: true,
      // Start at the reduced scrollback; the active-terminal effect below
      // bumps it to SCROLLBACK_ACTIVE once the terminal gains focus.
      scrollback: SCROLLBACK_INACTIVE,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      invoke('open_external_url', { url: uri }).catch((err) => {
        console.error('Failed to open URL:', err);
      });
    });
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    terminal.open(containerRef.current);

    // Attach WebGL renderer for GPU-accelerated rendering. Gracefully fall
    // back to the default DOM renderer if the context is lost or unavailable
    // (older GPUs, headless CI, etc.).
    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = null;
      });
      terminal.loadAddon(webglAddon);
    } catch (err) {
      console.warn('WebGL renderer unavailable, using DOM fallback:', err);
      webglAddon = null;
    }

    fitAddon.fit();

    // Auto-focus so keyboard input works immediately without requiring a click
    terminal.focus();

    // Block parser — scan new buffer lines after each write to detect Claude
    // prompt boundaries and emit assistant-response Block records.
    const blockParser = new BlockParser();
    let scannedUpTo = 0;
    const writeParsedSub = terminal.onWriteParsed(() => {
      const buf = terminal.buffer.active;
      const end = buf.length;
      let changed = false;
      for (let y = scannedUpTo; y < end; y++) {
        const line = buf.getLine(y);
        if (line && blockParser.onLine(line.translateToString(true), y)) changed = true;
      }
      scannedUpTo = end;
      if (changed) {
        const next = blockParser.blocks;
        blocksRef.current = next;
        setBlocks(next);
      }
    });

    // Track viewport position so BlockOverlay can map line numbers to pixels.
    const scrollSub = terminal.onScroll((newViewportY) => {
      setViewportY(newViewportY);
    });

    // Re-focus xterm if its textarea loses focus to nothing (body) or to its
    // OWN canvas — that combo happens in WebView2 after PTY output triggers
    // React re-renders or when the user clicks the terminal canvas directly.
    // We must NOT refocus if focus moved to a sibling terminal's canvas (e.g.
    // the script-child pane), or to any input/textarea elsewhere — otherwise
    // the user can't type into the other terminal.
    const container = containerRef.current;
    const handleBlur = () => {
      requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (!focused || focused === document.body) {
          terminal.focus();
          return;
        }
        if (focused.tagName === 'CANVAS' && container && container.contains(focused)) {
          terminal.focus();
        }
      });
    };
    terminal.textarea?.addEventListener('blur', handleBlur);

    // Handle Ctrl+C (copy) and Ctrl+V (paste) keyboard shortcuts
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+F: Toggle in-terminal search (Ctrl+Shift+F is reserved for the
      // global file/content search — see useKeyboardShortcuts).
      if (isCtrl && !e.shiftKey && e.key === 'f' && e.type === 'keydown') {
        e.preventDefault();
        toggleSearch();
        return false;
      }

      if (isCtrl && e.key === 'c' && e.type === 'keydown') {
        if (terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection());
          terminal.clearSelection();
          return false; // Prevent xterm from sending \x03
        }
        // No selection — let xterm send interrupt signal (Ctrl+C)
        return true;
      }

      // Ctrl+V: Let browser handle paste natively — fires paste event
      // on xterm's internal textarea, which xterm processes via onData.
      // This is more reliable than the async Clipboard API which can fail
      // silently due to focus/permission issues.
      if (isCtrl && e.key === 'v') {
        return false;
      }

      // Ctrl+Z: Send suspend/EOF signal to terminal (prevent browser undo)
      if (isCtrl && !e.shiftKey && e.key === 'z') {
        if (e.type === 'keydown') {
          e.preventDefault();
          writeToTerminal(terminalId, '\x1a');
        }
        return false;
      }

      // Cmd+Up: scroll to the previous Claude response block
      if (e.metaKey && !e.ctrlKey && e.key === 'ArrowUp' && e.type === 'keydown') {
        e.preventDefault();
        const current = blocksRef.current;
        if (current.length > 0) {
          const vp = terminal.buffer.active.viewportY;
          const prev = [...current].reverse().find((b) => b.startLine < vp);
          const target = prev ?? current[current.length - 1];
          terminal.scrollToLine(target.startLine);
          setActiveBlockId(target.id);
        }
        return false;
      }

      // Cmd+Down: scroll to the next Claude response block
      if (e.metaKey && !e.ctrlKey && e.key === 'ArrowDown' && e.type === 'keydown') {
        e.preventDefault();
        const current = blocksRef.current;
        if (current.length > 0) {
          const vp = terminal.buffer.active.viewportY;
          const next = current.find((b) => b.startLine > vp);
          if (next) {
            terminal.scrollToLine(next.startLine);
            setActiveBlockId(next.id);
          }
        }
        return false;
      }

      return true;
    });

    terminal.onData((data) => {
      writeToTerminal(terminalId, data).catch((err) => {
        console.error(`Failed to write to terminal ${terminalId}:`, err);
      });
      // Fan out to broadcast group peers when this terminal is a member.
      // Per-keystroke cost: each additional member triggers one IPC call
      // (writeToTerminal → invoke('write_to_terminal')). Acceptable for
      // N≤8 PTYs; revisit batching if max group size grows significantly.
      const { broadcastGroupIds } = useTerminalStore.getState();
      if (broadcastGroupIds.has(terminalId)) {
        broadcastGroupIds.forEach((peerId) => {
          if (peerId !== terminalId) {
            useTerminalStore.getState().writeToTerminal(peerId, data).catch((err) => {
              console.warn(`[broadcast] peer ${peerId} write failed:`, err);
            });
          }
        });
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      resizeTerminal(terminalId, terminal.cols, terminal.rows);
    });
    resizeObserver.observe(containerRef.current);

    terminalRef.current = terminal;
    setXterm(terminalId, terminal);

    return () => {
      resizeObserver.disconnect();
      terminal.textarea?.removeEventListener('blur', handleBlur);
      writeParsedSub.dispose();
      scrollSub.dispose();
      searchAddonRef.current = null;
      terminalRef.current = null;
      webglAddon?.dispose();
      terminal.dispose();
    };
    // Intentionally omit store action refs from deps — they are stable via
    // getState() and including them caused the xterm instance to be recreated
    // on every unrelated store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, !!instance, toggleSearch]);

  // OS → terminal file drag-drop. Tauri intercepts drag events at the window
  // level and delivers physical-pixel positions, so we hit-test against this
  // terminal's bounding rect to route drops in grid mode.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const hitTest = (physX: number, physY: number): boolean => {
      const el = containerRef.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const x = physX / scale;
      const y = physY / scale;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'leave') {
          setIsDragOver(false);
          return;
        }
        const inside = hitTest(payload.position.x, payload.position.y);
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDragOver(inside);
          return;
        }
        if (payload.type === 'drop') {
          setIsDragOver(false);
          if (!inside) return;
          const paths = payload.paths ?? [];
          if (paths.length === 0) return;
          const text = paths.map(formatDroppedPath).join(' ') + ' ';
          useTerminalStore.getState().writeToTerminal(terminalId, text).catch((err) => {
            console.error(`Failed to write dropped paths to terminal ${terminalId}:`, err);
          });
          terminalRef.current?.focus();
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        console.warn('Failed to register drag-drop listener:', err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [terminalId]);

  // Adjust xterm scrollback buffer based on focus state.
  // Active terminal gets the full 100k-line buffer; inactive terminals are
  // trimmed to 10k lines to reduce memory pressure when many tabs are open.
  // xterm.js trims the existing buffer immediately when the value is lowered.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.scrollback = isActive ? SCROLLBACK_ACTIVE : SCROLLBACK_INACTIVE;
  }, [isActive]);

  return (
    <div className="h-full w-full bg-bg-primary relative flex flex-col">
      <TerminalSearch
        searchAddon={searchAddonRef.current}
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
      />
      <div
        ref={containerRef}
        className="flex-1 min-h-0 w-full relative"
        onMouseDown={() => terminalRef.current?.focus()}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-accent-primary/10 ring-2 ring-accent-primary/60 ring-inset">
            <div className="bg-bg-primary/90 text-text-primary text-[13px] px-3 py-1.5 rounded-md ring-1 ring-accent-primary/40">
              Drop file to paste path
            </div>
          </div>
        )}
        <BlockOverlay
          blocks={blocks}
          viewportY={viewportY}
          activeBlockId={activeBlockId}
          containerRef={containerRef}
          terminal={terminalRef.current}
          onCopy={handleCopyBlock}
        />
      </div>
      <TerminalStatusBar terminalId={terminalId} />
    </div>
  );
}
