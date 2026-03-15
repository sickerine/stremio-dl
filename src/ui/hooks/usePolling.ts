import { useEffect, useRef } from "preact/hooks";

/**
 * Polls a function at a fixed interval while `enabled` is true.
 * Handles cleanup, abort, and prevents zombie loops.
 */
export function usePolling(
  fn: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  enabled: boolean,
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const controller = new AbortController();

    const tick = async () => {
      try {
        await fn(controller.signal);
      } catch (e: unknown) {
        if ((e as Error).name === "AbortError") return;
      }
      if (!cancelled) {
        timeoutRef.current = setTimeout(tick, intervalMs);
      }
    };

    // Immediate first poll
    tick();

    return () => {
      cancelled = true;
      controller.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [fn, intervalMs, enabled]);
}
