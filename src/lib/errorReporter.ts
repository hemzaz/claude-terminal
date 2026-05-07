import { invoke } from '@tauri-apps/api/core';

const MESSAGE_MAX = 2048;
const STACK_MAX = 8192;

export function reportError(kind: string, message: string, stack?: string): void {
  const m = clamp(scrub(message), MESSAGE_MAX);
  const s = stack ? clamp(scrub(stack), STACK_MAX) : null;
  invoke('report_error', { payload: { kind: kind ?? null, message: m, stack: s } }).catch(() => {
    // Swallow — never let the reporter break the app.
  });
}

function scrub(s: string): string {
  return s
    .replace(/C:\\Users\\[^\\]+\\/g, 'C:\\Users\\<user>\\')
    .replace(/file:\/\/\/C:\/Users\/[^/]+\//g, 'file:///C:/Users/<user>/');
}

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
