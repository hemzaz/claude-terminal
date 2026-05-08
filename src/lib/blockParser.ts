/**
 * Detects Claude Code CLI conversation turn boundaries from PTY output.
 *
 * The Claude CLI renders human turns behind a `> ` prompt. We detect that
 * pattern (after ANSI stripping) and use it to partition output into assistant
 * blocks — one per Claude response — which can be copied, navigated, and
 * highlighted independently of the underlying xterm.js scrollback.
 */

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][012AB]|\x1b.|\r/g;

export interface Block {
  /** Stable key for React reconciliation. */
  id: string;
  /** Absolute xterm buffer line index where this assistant block starts. */
  startLine: number;
  /** Inclusive end line; -1 means the block is still growing. */
  endLine: number;
}

function isPromptLine(rawText: string): boolean {
  const clean = rawText.replace(ANSI_RE, '').trimStart();
  // Match `> ` Claude CLI prompt. Guard against git conflict markers
  // (>>>>>>>) and extremely long lines that can't be prompts.
  return /^>\s/.test(clean) && clean.length < 512;
}

/**
 * Stateful parser that tracks assistant (Claude response) blocks.
 *
 * Call `onLine(rawText, lineIndex)` for each new buffer line as it arrives;
 * it returns `true` whenever the blocks array changes (open or close).
 * Read the current block list via `.blocks`.
 */
export class BlockParser {
  private _blocks: Block[] = [];
  /** True after a prompt line, until the first non-prompt content line. */
  private _awaitingAssistant = false;

  onLine(rawText: string, lineIndex: number): boolean {
    if (isPromptLine(rawText)) {
      let changed = false;
      // Close the currently-open assistant block
      if (this._blocks.length > 0) {
        const last = this._blocks[this._blocks.length - 1];
        if (last.endLine === -1) {
          this._blocks = [
            ...this._blocks.slice(0, -1),
            { ...last, endLine: lineIndex - 1 },
          ];
          changed = true;
        }
      }
      this._awaitingAssistant = true;
      return changed;
    }

    if (this._awaitingAssistant) {
      // First non-prompt line after a prompt = assistant response begins
      this._awaitingAssistant = false;
      this._blocks = [
        ...this._blocks,
        { id: `blk-${lineIndex}`, startLine: lineIndex, endLine: -1 },
      ];
      return true;
    }

    return false;
  }

  get blocks(): readonly Block[] {
    return this._blocks;
  }
}
