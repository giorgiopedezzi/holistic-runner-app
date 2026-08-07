import { useState, useEffect, useCallback, useRef } from "react";

export type QueryState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error";   error: string };

/**
 * useQuery — fires `fn` whenever `deps` change (like useEffect).
 * Returns { state, refetch }.
 *
 * Example:
 *   const { state } = useQuery(() => api.garmin.activities(from, to), [from, to]);
 */
export function useQuery<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { state: QueryState<T>; refetch: () => void } {
  const [state, setState] = useState<QueryState<T>>({ status: "idle" });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await fnRef.current();
      setState({ status: "success", data });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void run(); }, [run]);

  return { state, refetch: run };
}
