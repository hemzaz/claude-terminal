import { useState, useEffect, useRef } from 'react';

/**
 * Runs `fetcher(query)` with a debounce delay and a cancellation token so
 * stale responses from earlier queries are ignored.
 *
 * @param query   The current search string (hook re-runs when it changes).
 * @param active  When false the hook stays idle (use to gate on tab visibility).
 * @param fetcher Async function that performs the actual search.
 * @param delay   Debounce delay in ms (default 250).
 */
export function useDebouncedSearch<T>(
  query: string,
  active: boolean,
  fetcher: (q: string) => Promise<T>,
  delay = 250,
): { results: T | null; searching: boolean; error: string | null } {
  const [results, setResults] = useState<T | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setError(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const myToken = ++tokenRef.current;

    const handle = setTimeout(async () => {
      try {
        const res = await fetcher(trimmed);
        if (myToken !== tokenRef.current) return;
        setResults(res);
        setError(null);
      } catch (err) {
        if (myToken !== tokenRef.current) return;
        setError(typeof err === 'string' ? err : 'Search failed');
        setResults(null);
      } finally {
        if (myToken === tokenRef.current) setSearching(false);
      }
    }, delay);

    return () => clearTimeout(handle);
  }, [query, active, fetcher, delay]);

  return { results, searching, error };
}
