"use client";

import { type PoseFrame } from "@/lib/pose";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

interface StreamInspectorProps {
  status: ConnectionStatus;
  fps: number;
  latencyMs: number;
  frame: PoseFrame | null;
  exercise?: string;
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
