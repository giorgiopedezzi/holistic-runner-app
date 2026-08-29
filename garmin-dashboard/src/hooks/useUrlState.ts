import { useCallback, useState } from "react";

function readUrlParam(key: string, defaultValue: string): string {
  return new URLSearchParams(window.location.search).get(key) ?? defaultValue;
}

// Reads window.location.search fresh on every write (not a cached copy), so
// independent useUrlState call sites merge into the one live query string
// instead of racing each other with stale snapshots — this is what makes
// multiple simultaneous named values safe (HRA-193 risk note).
function writeUrlParam(key: string, value: string) {
  const params = new URLSearchParams(window.location.search);
  params.set(key, value);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

/**
 * Persists one named value in the URL's query string, merging into existing
 * params rather than overwriting the whole search string, and updating via
 * history.replaceState so switching values never adds a new history entry.
 */
export function useUrlState(key: string, defaultValue: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => readUrlParam(key, defaultValue));

  const setUrlValue = useCallback((next: string) => {
    writeUrlParam(key, next);
    setValue(next);
  }, [key]);

  return [value, setUrlValue];
}
