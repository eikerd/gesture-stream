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
}

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

export function StreamInspector({
  status,
  fps,
  latencyMs,
  frame,
}: StreamInspectorProps) {
  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
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
        <CardContent className="flex flex-col gap-2">
          {frame ? (
            frame.keypoints.map((kp) => (
              <div key={kp.name} className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-28 shrink-0 truncate">
                  {kp.name.replace(/_/g, " ")}
                </span>
                <Progress
                  value={Math.round(kp.score * 100)}
                  className="h-1.5 flex-1"
                />
                <span className="text-xs font-mono text-zinc-300 w-10 text-right shrink-0">
                  {kp.score.toFixed(2)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-zinc-500 italic">No data</p>
          )}
        </CardContent>
      </Card>

      {/* Raw JSON */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-400">Raw JSON</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs font-mono text-zinc-400 overflow-auto max-h-48 whitespace-pre-wrap break-all">
            {frame
              ? JSON.stringify(
                  { ts: frame.ts, keypoints: frame.keypoints.slice(0, 4) },
                  null,
                  2
                ) + "\n  ..."
              : "—"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
