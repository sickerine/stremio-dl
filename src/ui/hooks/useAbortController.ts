import { useRef, useCallback, useMemo } from "preact/hooks";

/**
 * Returns stable `next` and `abort` functions for managing AbortControllers.
 * The returned object is memoized to prevent cascading callback recreation.
 */
export function useAbortController() {
  const ref = useRef<AbortController | null>(null);

  const next = useCallback((): AbortSignal => {
    ref.current?.abort();
    const controller = new AbortController();
    ref.current = controller;
    return controller.signal;
  }, []);

  const abort = useCallback(() => {
    ref.current?.abort();
    ref.current = null;
  }, []);

  // CRITICAL: useMemo prevents returning a new object reference every render.
  // Without this, any useCallback depending on this object would be recreated
  // every render, causing cascading prop instability and full re-renders.
  return useMemo(() => ({ next, abort }), [next, abort]);
}
