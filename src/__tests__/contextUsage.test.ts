import { describe, expect, it } from 'vitest';
import {
  appendContextUsageBuffer,
  extractContextUsageFraction,
  stripAnsiForContextUsage,
} from '../lib/contextUsage';

describe('extractContextUsageFraction', () => {
  it('parses percent context usage', () => {
    expect(extractContextUsageFraction('status: context: 82% used')).toBe(0.82);
  });

  it('parses reversed percent context usage', () => {
    expect(extractContextUsageFraction('status: 37% context remaining line')).toBe(0.37);
  });

  it('parses token fractions', () => {
    expect(extractContextUsageFraction('context window 160000 / 200000 tokens')).toBe(0.8);
  });

  it('strips ANSI escape sequences before parsing', () => {
    const input = '\x1b[2K\r\x1b[32mcontext:\x1b[0m 45%';

    expect(stripAnsiForContextUsage(input)).toBe('context: 45%');
    expect(extractContextUsageFraction(input)).toBe(0.45);
  });

  it('returns null for invalid values', () => {
    expect(extractContextUsageFraction('context: 101%')).toBeNull();
    expect(extractContextUsageFraction('12000 / 10000 tokens')).toBeNull();
    expect(extractContextUsageFraction('900 / 1000 tokens')).toBeNull();
    expect(extractContextUsageFraction('no usage here')).toBeNull();
  });

  it('parses comma-separated token fractions', () => {
    expect(extractContextUsageFraction('164,523 / 200,000 tokens')).toBeCloseTo(0.822615);
  });
});

describe('appendContextUsageBuffer', () => {
  it('keeps only the newest characters when the buffer exceeds the limit', () => {
    expect(appendContextUsageBuffer('abcdef', 'ghi', 5)).toBe('efghi');
  });

  it('returns the full buffer when it is within the limit', () => {
    expect(appendContextUsageBuffer('abc', 'de', 5)).toBe('abcde');
  });
});
