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
  // Assigning fnRef.current during render (the previous form) is a
  // render-phase side effect — React may discard a render without
  // committing it, and a ref write during that discarded render still
  // mutates the ref, which is exactly the kind of impurity effects exist to
  // avoid (HRA-78). Deferred to an effect instead; `run` (below) only ever
  // reads fnRef.current from inside an async callback invoked after commit,
  // so this doesn't change when the latest `fn` actually takes effect.
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);

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
