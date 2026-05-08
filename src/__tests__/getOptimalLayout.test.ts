import { describe, it, expect, vi } from 'vitest';

// Mock Tauri SDK before importing from appStore (prevents runtime errors in test env)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { getOptimalLayout } from '../store/appStore';

describe('getOptimalLayout', () => {
  it('returns 1x1 for 0 terminals (default fallback)', () => {
    expect(getOptimalLayout(0)).toBe('1x1');
  });

  it('returns 1x1 for 1 terminal', () => {
    expect(getOptimalLayout(1)).toBe('1x1');
  });

  it('returns 1x2 for 2 terminals', () => {
    expect(getOptimalLayout(2)).toBe('1x2');
  });

  it('returns 1x3 for 3 terminals', () => {
    expect(getOptimalLayout(3)).toBe('1x3');
  });

  it('returns 2x2 for 4 terminals', () => {
    expect(getOptimalLayout(4)).toBe('2x2');
  });

  it('returns 2x3 for 5 terminals', () => {
    expect(getOptimalLayout(5)).toBe('2x3');
  });

  it('returns 2x3 for 6 terminals (groups 5 and 6 together)', () => {
    expect(getOptimalLayout(6)).toBe('2x3');
  });

  it('returns 2x4 for 7 terminals', () => {
    expect(getOptimalLayout(7)).toBe('2x4');
  });

  it('returns 2x4 for 8 terminals (maximum grid size)', () => {
    expect(getOptimalLayout(8)).toBe('2x4');
  });

  it('returns 1x1 for counts above 8 (default fallback)', () => {
    expect(getOptimalLayout(9)).toBe('1x1');
    expect(getOptimalLayout(100)).toBe('1x1');
  });

  it('returns 1x1 for negative counts (default fallback)', () => {
    expect(getOptimalLayout(-1)).toBe('1x1');
  });
});
