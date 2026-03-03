/** Single connection event recorded by the live-mode health tracker. */
export interface ConnEvent {
  type: "connect" | "disconnect";
  ts: number; // unix ms
  /** How long the connection lasted in ms (only present on disconnect events) */
  duration?: number;
}

/** Derive summary statistics from an event log. */
export function connHealthStats(events: ConnEvent[]): {
  dropCount: number;
  avgSessionMs: number | null;
  longestSessionMs: number | null;
} {
  const disconnects = events.filter((e) => e.type === "disconnect" && e.duration != null);
  const durations = disconnects.map((e) => e.duration!);
  const dropCount = disconnects.length;
  const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const longest = durations.length > 0 ? Math.max(...durations) : null;
  return { dropCount, avgSessionMs: avg, longestSessionMs: longest };
}
