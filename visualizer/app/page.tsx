"use client";

import { useState, useCallback } from "react";
import { SkeletonCanvas } from "@/components/SkeletonCanvas";
import { StreamInspector } from "@/components/StreamInspector";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { type PoseFrame } from "@/lib/pose";
import { generateMockFrame } from "@/lib/mock";
import Link from "next/link";

type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

export default function HomePage() {
  const [mockMode, setMockMode] = useState(true);
  const [wsHost, setWsHost] = useState("pi-zero-ai.local");
  const [wsInput, setWsInput] = useState("pi-zero-ai.local");
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  const getMockFrame = useCallback(() => generateMockFrame(), []);

  const handleFrame = useCallback(
    (f: PoseFrame, newFps: number, newLatency: number) => {
      setFrame(f);
      setFps(newFps);
      setLatencyMs(Math.round(newLatency));
    },
    []
  );

  const wsUrl = `ws://${wsHost}:8765`;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-3 border-b border-zinc-800 bg-zinc-900">
        <span className="font-mono font-semibold text-zinc-100 tracking-tight">
          pose.stream
        </span>

        <div className="flex items-center gap-2 ml-4">
          <Label htmlFor="mock-toggle" className="text-xs text-zinc-400">
            mock
          </Label>
          <Switch
            id="mock-toggle"
            checked={mockMode}
            onCheckedChange={(checked) => {
              setMockMode(checked);
              setStatus(checked ? "connected" : "disconnected");
              setFrame(null);
              setFps(0);
              setLatencyMs(0);
            }}
          />
        </div>

        {!mockMode && (
          <form
            className="flex items-center gap-2 ml-2"
            onSubmit={(e) => {
              e.preventDefault();
              setWsHost(wsInput);
              setStatus("reconnecting");
            }}
          >
            <span className="text-xs text-zinc-500 font-mono">ws://</span>
            <Input
              value={wsInput}
              onChange={(e) => setWsInput(e.target.value)}
              className="h-7 w-52 text-xs font-mono bg-zinc-800 border-zinc-700 text-zinc-100"
              placeholder="pi-zero-ai.local"
            />
            <span className="text-xs text-zinc-500 font-mono">:8765</span>
            <Button type="submit" size="sm" variant="secondary" className="h-7 text-xs">
              Connect
            </Button>
          </form>
        )}

        <div className="ml-auto">
          <Link
            href="/sessions"
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Session History
          </Link>
        </div>
      </header>

      {/* Main layout */}
      <main className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 p-4 flex items-center justify-center min-h-0">
          <div className="w-full max-w-2xl aspect-[4/3]">
            <SkeletonCanvas
              wsUrl={wsUrl}
              mockMode={mockMode}
              getMockFrame={getMockFrame}
              onFrame={handleFrame}
            />
          </div>
        </div>

        {/* Inspector panel */}
        <aside className="w-72 shrink-0 border-l border-zinc-800 bg-zinc-900 p-4 overflow-y-auto">
          <StreamInspector
            status={mockMode ? "connected" : status}
            fps={fps}
            latencyMs={latencyMs}
            frame={frame}
          />
        </aside>
      </main>
    </div>
  );
}
