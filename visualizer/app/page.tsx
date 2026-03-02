"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { SkeletonCanvas } from "@/components/SkeletonCanvas";
import { StreamInspector } from "@/components/StreamInspector";
import { CoachingChat } from "@/components/CoachingChat";
import { SimulationPanel } from "@/components/SimulationPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type PoseFrame } from "@/lib/pose";
import { generateMockFrame, SEVEN_MINUTE_EXERCISES, type ExerciseId } from "@/lib/mock";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ChatMessage } from "@/lib/chatTypes";
import { type RepEvent } from "@/lib/repCounter";
import Link from "next/link";

type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
type AppMode = "mock" | "simulate" | "live";

let _msgCounter = 0;
function makeId(): string {
  return `msg-${Date.now()}-${++_msgCounter}`;
}

export default function HomePage() {
  const [mode, setMode] = useState<AppMode>("mock");
  const [exercise, setExercise] = useState<ExerciseId>("jumping-jacks");
  const [simExercise, setSimExercise] = useState<ExerciseId>("squat");
  const [wsHost, setWsHost] = useState("pi-zero-ai.local");
  const [wsInput, setWsInput] = useState("pi-zero-ai.local");
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const repCounterRef = useRef(0);
  const simRepHistoryRef = useRef<{ repNumber: number; formOk: boolean; angle: number }[]>([]);

  // Simulate mode: latest frame from SimulationPanel
  const [simFrame, setSimFrame] = useState<PoseFrame | null>(null);
  const simFpsRef = useRef({ frames: 0, lastTime: Date.now(), fps: 0 });

  const getMockFrame = useCallback(() => generateMockFrame(exercise), [exercise]);

  const handleFrame = useCallback(
    (f: PoseFrame, newFps: number, newLatency: number) => {
      setFrame(f);
      setFps(newFps);
      setLatencyMs(Math.round(newLatency));
    },
    []
  );

  const handleSimFrame = useCallback((f: PoseFrame) => {
    setSimFrame(f);
    setFrame(f);
    const now = Date.now();
    simFpsRef.current.frames += 1;
    const elapsed = now - simFpsRef.current.lastTime;
    if (elapsed >= 1000) {
      simFpsRef.current.fps = Math.round((simFpsRef.current.frames * 1000) / elapsed);
      simFpsRef.current.frames = 0;
      simFpsRef.current.lastTime = now;
    }
    setFps(simFpsRef.current.fps);
    setLatencyMs(0);
  }, []);

  const addMessage = useCallback(
    (msg: Omit<ChatMessage, "id" | "ts">) => {
      setMessages((prev) => {
        const next = [
          ...prev,
          { ...msg, id: makeId(), ts: Date.now() },
        ];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    },
    []
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    repCounterRef.current = 0;
    simRepHistoryRef.current = [];
  }, []);

  // Wire rep events from SimulationPanel → CoachingChat + periodic coach tips
  const handleRepEvent = useCallback(
    (event: RepEvent, ex: ExerciseId) => {
      addMessage({
        type: event.isGood ? "rep_good" : "rep_bad",
        text: event.isGood ? "good form" : "check your form",
        repNumber: event.repNumber,
        angle: event.peakAngle,
      });

      simRepHistoryRef.current.push({
        repNumber: event.repNumber,
        formOk: event.isGood,
        angle: event.peakAngle,
      });

      // Fetch a coach tip every 5 reps
      if (event.repNumber % 5 === 0) {
        const recentReps = simRepHistoryRef.current.slice(-5);
        void fetch("/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exercise: ex,
            reps: recentReps,
            formOk: recentReps.every((r) => r.formOk),
          }),
        })
          .then((res) => res.json() as Promise<{ tip?: string }>)
          .then((data) => {
            if (data.tip) addMessage({ type: "coach_tip", text: data.tip });
          })
          .catch(() => {});
      }
    },
    [addMessage]
  );

  // Test: add a sample message every 3 seconds while in mock mode
  useEffect(() => {
    if (mode !== "mock") return;
    repCounterRef.current = 0;
    const id = setInterval(() => {
      repCounterRef.current += 1;
      const n = repCounterRef.current;
      const isGood = n % 3 !== 0;
      addMessage({
        type: isGood ? "rep_good" : "rep_bad",
        text: isGood ? "good depth" : "knees caved in",
        repNumber: n,
        angle: isGood ? 82 + Math.round(Math.random() * 10) : 55 + Math.round(Math.random() * 8),
      });
    }, 3000);
    return () => clearInterval(id);
  }, [mode, addMessage]);

  const wsUrl = `ws://${wsHost}:8765`;

  const isMock = mode === "mock";
  const isLive = mode === "live";
  const isSim = mode === "simulate";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-3 border-b border-zinc-800 bg-zinc-900">
        <span className="font-mono font-semibold text-zinc-100 tracking-tight">
          pose.stream
        </span>

        {/* Three-way mode toggle */}
        <Tabs
          value={mode}
          onValueChange={(v) => {
            const next = v as AppMode;
            setMode(next);
            setFrame(null);
            setSimFrame(null);
            setFps(0);
            setLatencyMs(0);
            clearMessages();
            setStatus(next === "live" ? "disconnected" : "connected");
          }}
        >
          <TabsList className="h-7 bg-zinc-800">
            <TabsTrigger value="mock" className="text-xs px-3 h-6">
              Mock
            </TabsTrigger>
            <TabsTrigger value="simulate" className="text-xs px-3 h-6">
              Simulate
            </TabsTrigger>
            <TabsTrigger value="live" className="text-xs px-3 h-6">
              Live
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Mock exercise selector */}
        {isMock && (
          <Select value={exercise} onValueChange={(v) => setExercise(v as ExerciseId)}>
            <SelectTrigger className="h-7 w-48 text-xs bg-zinc-800 border-zinc-700 text-zinc-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-100">
              {SEVEN_MINUTE_EXERCISES.map((ex) => (
                <SelectItem key={ex.id} value={ex.id} className="text-xs">
                  {ex.order}. {ex.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Live WS host form */}
        {isLive && (
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
        {/* Left: Canvas + SimulationPanel (in simulate mode) */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Canvas area */}
          <div className="flex-1 p-4 flex items-center justify-center min-h-0">
            <div className="w-full max-w-2xl aspect-[4/3]">
              <SkeletonCanvas
                wsUrl={wsUrl}
                mockMode={isMock}
                getMockFrame={getMockFrame}
                onFrame={handleFrame}
                controlledFrame={isSim ? simFrame : null}
              />
            </div>
          </div>

          {/* SimulationPanel rendered below canvas only in simulate mode */}
          {isSim && (
            <div className="border-t border-zinc-800 bg-zinc-900 overflow-y-auto shrink-0 max-h-80">
              <SimulationPanel
                exercise={simExercise}
                onExerciseChange={(v) => {
                  setSimExercise(v);
                  clearMessages();
                }}
                onFrame={handleSimFrame}
                onRepEvent={handleRepEvent}
              />
            </div>
          )}
        </div>

        {/* Right panel: StreamInspector (top 60%) + CoachingChat (bottom 40%) */}
        <aside className="w-72 shrink-0 border-l border-zinc-800 bg-zinc-900 flex flex-col overflow-hidden">
          <div className="flex-[3] min-h-0 p-4 overflow-y-auto border-b border-zinc-800">
            <StreamInspector
              status={isLive ? status : "connected"}
              fps={fps}
              latencyMs={latencyMs}
              frame={frame}
            />
          </div>
          <div className="flex-[2] min-h-0 overflow-hidden">
            <CoachingChat messages={messages} onClear={clearMessages} />
          </div>
        </aside>
      </main>
    </div>
  );
}
