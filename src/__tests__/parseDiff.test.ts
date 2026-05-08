import { describe, it, expect } from 'vitest';
import { parseDiff } from '../utils/diffParser';

describe('parseDiff', () => {
  it('returns empty array for empty string', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('returns empty array for diff metadata only (no hunks)', () => {
    const meta = [
      'diff --git a/foo.ts b/foo.ts',
      'index abc1234..def5678 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
    ].join('\n');
    expect(parseDiff(meta)).toEqual([]);
  });

  it('parses a single hunk with added and removed lines', () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,3 @@',
      '-const x = 1;',
      '+const x = 2;',
      ' const y = 3;',
    ].join('\n');

    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(3);

    const removed = hunks[0].lines[0];
    expect(removed.type).toBe('removed');
    expect(removed.content).toBe('const x = 1;');
    expect(removed.oldLineNumber).toBe(1);
    expect(removed.newLineNumber).toBeNull();

    const added = hunks[0].lines[1];
    expect(added.type).toBe('added');
    expect(added.content).toBe('const x = 2;');
    expect(added.oldLineNumber).toBeNull();
    expect(added.newLineNumber).toBe(1);

    const ctx = hunks[0].lines[2];
    expect(ctx.type).toBe('context');
    expect(ctx.content).toBe('const y = 3;');
    expect(ctx.oldLineNumber).toBe(2);
    expect(ctx.newLineNumber).toBe(2);
  });

  it('line numbers increment correctly across context and changed lines', () => {
    const diff = [
      '@@ -10,4 +10,4 @@',
      ' line A',
      '-line B old',
      '+line B new',
      ' line C',
    ].join('\n');

    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    const lines = hunks[0].lines;

    expect(lines[0]).toMatchObject({ type: 'context', oldLineNumber: 10, newLineNumber: 10 });
    expect(lines[1]).toMatchObject({ type: 'removed', oldLineNumber: 11, newLineNumber: null });
    expect(lines[2]).toMatchObject({ type: 'added', oldLineNumber: null, newLineNumber: 11 });
    expect(lines[3]).toMatchObject({ type: 'context', oldLineNumber: 12, newLineNumber: 12 });
  });

  it('parses multiple hunks correctly', () => {
    const diff = [
      '@@ -1,2 +1,2 @@',
      '-old line 1',
      '+new line 1',
      ' ctx 1',
      '@@ -10,2 +10,2 @@',
      '-old line 10',
      '+new line 10',
      ' ctx 10',
    ].join('\n');

    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].lines[0].type).toBe('removed');
    expect(hunks[1].lines[0].type).toBe('removed');
    expect(hunks[1].lines[0].oldLineNumber).toBe(10);
  });

  it('skips "no newline at end of file" markers', () => {
    const diff = [
      '@@ -1,1 +1,1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
    ].join('\n');

    const hunks = parseDiff(diff);
    expect(hunks[0].lines).toHaveLength(2);
    expect(hunks[0].lines.every((l) => l.type !== 'header')).toBe(true);
  });

  it('strips Windows \\r line endings before parsing', () => {
    const diff = '@@ -1,1 +1,1 @@\r\n+new line\r\n';
    const hunks = parseDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines[0].content).toBe('new line');
  });

  it('stores the raw hunk header string', () => {
    const header = '@@ -5,3 +5,3 @@ function foo() {';
    const hunks = parseDiff(header);
    expect(hunks[0].header).toBe(header);
  });
});
