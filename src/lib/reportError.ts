import { reportError as _backendReport } from './errorReporter';

/**
 * Returns a .catch() handler that logs and reports the error via the Rust
 * error reporter. Use instead of bare .catch(() => {}).
 *
 * @example
 *   invoke('my_command').catch(reportError('my_command'));
 */
export function reportError(label: string): (e: unknown) => void {
  return (e: unknown) => {
    console.error(`[${label}]`, e);
    _backendReport(label, String(e));
  };
}
