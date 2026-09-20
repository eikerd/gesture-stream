// A small fixed-window limiter for routes that cost money per call.
//
// In memory on purpose: this visualizer runs as a single process beside the
// pose publisher, so a counter in the process is the whole picture and adds no
// infrastructure. Behind more than one instance the limit becomes per-instance
// and this should move to a shared store (Redis/Upstash) — that is the only
// reason to change it.

interface Window {
  count: number;
  resetAt: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const minuteWindows = new Map<string, Window>();
const dayWindows = new Map<string, Window>();

/** Drops windows that have expired, so a long-running process does not grow a
 *  map entry for every address that ever called. */
function bump(windows: Map<string, Window>, key: string, limit: number, spanMs: number, now: number): boolean {
  for (const [k, w] of windows) {
    if (w.resetAt <= now) windows.delete(k);
  }
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + spanMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

export interface RateLimitResult {
  ok: boolean;
  /** Which window rejected the call, for the caller's log line. */
  scope?: "minute" | "day";
}

/** Counts one call against `key`. Both windows are consumed only when both
 *  have room, so a rejected call never eats the caller's daily allowance. */
export function consume(
  key: string,
  perMinute = 20,
  perDay = 500,
  now: number = Date.now()
): RateLimitResult {
  const minute = minuteWindows.get(key);
  const day = dayWindows.get(key);
  const minuteFull = minute !== undefined && minute.resetAt > now && minute.count >= perMinute;
  const dayFull = day !== undefined && day.resetAt > now && day.count >= perDay;
  if (minuteFull) return { ok: false, scope: "minute" };
  if (dayFull) return { ok: false, scope: "day" };

  bump(minuteWindows, key, perMinute, MINUTE_MS, now);
  bump(dayWindows, key, perDay, DAY_MS, now);
  return { ok: true };
}

/** The caller's address, as far as the proxy chain reports it. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test seam: the windows live for the process, so tests need a clean slate. */
export function resetRateLimits(): void {
  minuteWindows.clear();
  dayWindows.clear();
}
