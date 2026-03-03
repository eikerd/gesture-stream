"use client";

import { useEffect, useState } from "react";
import { type PoseFrame } from "@/lib/pose";
import { type ConnEvent, connHealthStats } from "@/lib/connHealth";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Camera thumbnail ─────────────────────────────────────────────────────────
// Tries all candidate snapshot URLs independently (no dependency on WS state).
// Cycles through candidates on error; polls the working one every 3 s.

interface CameraThumbProps {
  /** Ordered list of snapshot URLs to try. First to respond with a valid image wins. */
  snapshotUrls: string[];
  status: ConnectionStatus;
}

function CameraThumb({ snapshotUrls, status }: CameraThumbProps) {
  const [tick, setTick] = useState(0);
  const [hasImage, setHasImage] = useState(false);

  // Refresh every 3 s
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, []);

  if (snapshotUrls.length === 0) return null;

  // Route through the Next.js proxy — browser never needs a direct route to
  // the Pi. The server-side /api/snapshot handler tries all candidate hosts.
  const src = `/api/snapshot?t=${tick}`;
  const searching = status !== "connected" && !hasImage;

  return (
    <div
      className="relative w-full rounded overflow-hidden bg-zinc-800 border border-zinc-700"
      style={{ aspectRatio: "4/3" }}
    >
      {/* Placeholder layer — visible behind image when no image yet */}
      {!hasImage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <svg viewBox="0 0 24 24" className={`w-8 h-8 ${searching ? "text-zinc-500 animate-pulse" : "text-zinc-700"}`}
            fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
          </svg>
          <span className={`text-[10px] font-mono ${searching ? "text-zinc-500 animate-pulse" : "text-zinc-600"}`}>
            {searching ? "searching…" : "no signal"}
          </span>
        </div>
      )}

      {/* Image — always rendered so browser always attempts the load */}
      <img
        key="pi-snapshot"
        src={src}
        alt="Pi camera"
        className="absolute inset-0 w-full h-full object-cover"
        onLoad={() => setHasImage(true)}
        onError={() => setHasImage(false)}
      />

      <span className="absolute bottom-1 right-1.5 text-zinc-600 text-[10px] font-mono leading-none z-10">
        Pi cam
      </span>
    </div>
  );
}

type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

interface StreamInspectorProps {
  status: ConnectionStatus;
  fps: number;
  latencyMs: number;
  frame: PoseFrame | null;
  exercise?: string;
  /** When provided, the camera thumbnail is shown (tries each URL in order). */
  snapshotUrls?: string[];
  /** Hostname/IP of the currently-connected WS server, if known. */
  connectedHost?: string | null;
  /** Connection event log for health panel. */
  connEvents?: ConnEvent[];
}

// Which keypoints matter most per exercise (used for highlighting)
const KEY_KEYPOINTS: Record<string, Set<string>> = {
  squat: new Set(["left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"]),
  "push-up": new Set(["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"]),
  "jumping-jacks": new Set(["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_ankle", "right_ankle"]),
  lunge: new Set(["left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"]),
  "high-knees": new Set(["left_hip", "right_hip", "left_knee", "right_knee"]),
  plank: new Set(["left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_ankle", "right_ankle"]),
  "wall-sit": new Set(["left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"]),
  "ab-crunch": new Set(["left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_knee", "right_knee"]),
  "tricep-dip": new Set(["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"]),
  "side-plank": new Set(["left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_ankle", "right_ankle"]),
  "step-up": new Set(["left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"]),
  "push-up-rotation": new Set(["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"]),
};

const STATUS_VARIANT: Record<
  ConnectionStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  connected: "default",
  disconnected: "destructive",
  reconnecting: "secondary",
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  reconnecting: "Reconnecting...",
};

// Safe JSON syntax highlighter: HTML-escapes first, then wraps tokens in colored spans
function colorizeJson(obj: unknown): string {
  const json = JSON.stringify(obj, null, 2);
  // Escape HTML special chars before injecting spans
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(?:[^"\\]|\\.)*"(?:\s*:)?|true|false|null|-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
    (m) => {
      if (m.endsWith(":")) return `<span class="text-sky-400">${m}</span>`;
      if (m.startsWith('"')) return `<span class="text-emerald-400">${m}</span>`;
      if (m === "true") return `<span class="text-blue-400">${m}</span>`;
      if (m === "false") return `<span class="text-red-400">${m}</span>`;
      if (m === "null") return `<span class="text-zinc-500">${m}</span>`;
      return `<span class="text-amber-300">${m}</span>`;
    }
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m${rem}s`;
}

function useUptime(status: ConnectionStatus): string {
  const [, setTick] = useState(0);
  const connectedAtRef = useState<{ ts: number }>(() => ({ ts: 0 }))[0];

  useEffect(() => {
    if (status === "connected") {
      connectedAtRef.ts = Date.now();
      setTick(0); // reset display immediately
    }
  }, [status, connectedAtRef]);

  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  if (status !== "connected" || connectedAtRef.ts === 0) return "—";
  return fmtMs(Date.now() - connectedAtRef.ts);
}

export function StreamInspector({
  status,
  fps,
  latencyMs,
  frame,
  exercise,
  snapshotUrls,
  connectedHost,
  connEvents = [],
}: StreamInspectorProps) {
  const keySet = exercise ? (KEY_KEYPOINTS[exercise] ?? null) : null;
  const uptime = useUptime(status);
  const { dropCount, avgSessionMs } = connHealthStats(connEvents);

  // Last 5 events for the mini log, most-recent first
  const recentEvents = connEvents.slice(-5).reverse();

  return (
    <div className="flex flex-col gap-4">
      {/* Connection status */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-400">Connection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {snapshotUrls && snapshotUrls.length > 0 && (
            <CameraThumb snapshotUrls={snapshotUrls} status={status} />
          )}
          <Badge variant={STATUS_VARIANT[status]} className="w-fit">
            {STATUS_LABEL[status]}
          </Badge>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-zinc-400">FPS</div>
            <div className="text-zinc-100 font-mono">{fps}</div>
            <div className="text-zinc-400">Latency</div>
            <div className="text-zinc-100 font-mono">
              {latencyMs > 0 ? `${latencyMs}ms` : "—"}
            </div>
            <div className="text-zinc-400">Uptime</div>
            <div className="text-zinc-100 font-mono">{uptime}</div>
            {connectedHost && (
              <>
                <div className="text-zinc-400">Host</div>
                <div className="text-zinc-100 font-mono text-xs truncate" title={connectedHost}>
                  {connectedHost}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Connection health — only shown in live mode when there's history */}
      {connEvents.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-400">Connection Health</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
              <span className="text-zinc-400">Drops</span>
              <span className={`font-mono ${dropCount > 0 ? "text-red-400" : "text-green-400"}`}>
                {dropCount}
              </span>
              <span className="text-zinc-400">Avg session</span>
              <span className="text-zinc-100 font-mono">
                {avgSessionMs != null ? fmtMs(avgSessionMs) : "—"}
              </span>
            </div>
            {/* Mini event log */}
            <div className="mt-1 space-y-0.5">
              {recentEvents.map((ev, i) => {
                const isConn = ev.type === "connect";
                const age = Math.round((Date.now() - ev.ts) / 1000);
                return (
                  <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span className={isConn ? "text-green-500" : "text-red-500"}>
                      {isConn ? "▲" : "▼"}
                    </span>
                    <span className="text-zinc-500">{age}s ago</span>
                    {ev.duration != null && (
                      <span className="text-zinc-600 ml-auto">{fmtMs(ev.duration)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keypoint confidence bars */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-400">Keypoints</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {frame ? (
            frame.keypoints.map((kp) => {
              const isKey = keySet ? keySet.has(kp.name) : false;
              return (
                <div key={kp.name} className="flex items-center gap-2">
                  <span
                    className={`text-xs font-mono w-28 shrink-0 truncate ${
                      isKey ? "text-amber-400 font-semibold" : "text-zinc-500"
                    }`}
                  >
                    {kp.name.replace(/_/g, " ")}
                  </span>
                  <Progress
                    value={Math.round(kp.score * 100)}
                    className={`h-1.5 flex-1 ${isKey ? "[&>div]:bg-amber-400" : ""}`}
                  />
                  <span
                    className={`text-xs font-mono w-10 text-right shrink-0 ${
                      isKey ? "text-amber-300" : "text-zinc-500"
                    }`}
                  >
                    {kp.score.toFixed(2)}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-zinc-500 italic">No data</p>
          )}
        </CardContent>
      </Card>

      {/* Raw JSON — syntax highlighted, fully scrollable */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-400">Raw JSON</CardTitle>
        </CardHeader>
        <CardContent>
          {frame ? (
            <pre
              className="text-xs font-mono overflow-x-auto overflow-y-auto max-h-56 whitespace-pre leading-relaxed"
              dangerouslySetInnerHTML={{
                __html: colorizeJson({
                  ts: frame.ts,
                  keypoints: frame.keypoints,
                }),
              }}
            />
          ) : (
            <span className="text-xs text-zinc-500 font-mono">—</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
