"use client";

import { useEffect, useState } from "react";
import { type PoseFrame } from "@/lib/pose";
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
  const [activeIdx, setActiveIdx] = useState(0);
  const [src, setSrc] = useState("");
  const [imgOk, setImgOk] = useState(false);

  // Start polling immediately using the first candidate
  useEffect(() => {
    if (snapshotUrls.length === 0) return;
    const url = snapshotUrls[activeIdx % snapshotUrls.length];
    const refresh = () => setSrc(`${url}?t=${Date.now()}`);
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [snapshotUrls, activeIdx]);

  const handleError = () => {
    setImgOk(false);
    // Try the next candidate on failure
    setActiveIdx((i) => i + 1);
  };

  const searching = status === "reconnecting" || status === "disconnected";

  return (
    <div
      className="relative w-full rounded overflow-hidden bg-zinc-800 border border-zinc-700"
      style={{ aspectRatio: "4/3" }}
    >
      {/* Actual image — hidden until loaded successfully */}
      {src && (
        <img
          src={src}
          alt="Pi camera"
          className={`w-full h-full object-cover absolute inset-0 transition-opacity duration-500 ${imgOk ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setImgOk(true)}
          onError={handleError}
        />
      )}

      {/* Placeholder shown when image is not available */}
      {!imgOk && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          {/* Camera icon SVG */}
          <svg
            viewBox="0 0 24 24"
            className={`w-8 h-8 ${searching ? "text-zinc-500 animate-pulse" : "text-zinc-700"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
            />
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
            />
            {/* X cross when disconnected */}
            {!searching && (
              <>
                <line x1="4" y1="4" x2="20" y2="20" strokeWidth={1.5} strokeLinecap="round" />
              </>
            )}
          </svg>
          <span className={`text-[10px] font-mono ${searching ? "text-zinc-500 animate-pulse" : "text-zinc-600"}`}>
            {searching ? "searching…" : "no signal"}
          </span>
        </div>
      )}

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

export function StreamInspector({
  status,
  fps,
  latencyMs,
  frame,
  exercise,
  snapshotUrls,
}: StreamInspectorProps) {
  const keySet = exercise ? (KEY_KEYPOINTS[exercise] ?? null) : null;

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
          </div>
        </CardContent>
      </Card>

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
