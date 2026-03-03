"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Play, Pause, RotateCw } from "lucide-react";
import { SkeletonCanvas } from "@/components/SkeletonCanvas";
import { StreamInspector } from "@/components/StreamInspector";
import { CoachingChat } from "@/components/CoachingChat";
import { SimulationPanel } from "@/components/SimulationPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type PoseFrame } from "@/lib/pose";
import { generateMockFrame, prefetchRealData, SEVEN_MINUTE_EXERCISES, type ExerciseId } from "@/lib/mock";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ChatMessage } from "@/lib/chatTypes";
import { type RepEvent } from "@/lib/repCounter";
import Link from "next/link";

// ─── Turntable transform ──────────────────────────────────────────────────────
// Simulates a camera orbiting the figure by scaling x around the body centre.
// Full revolution every TURNTABLE_PERIOD seconds.
const TURNTABLE_PERIOD = 10;

function applyTurntable(frame: PoseFrame): PoseFrame {
  const angle = (Date.now() / 1000) * (2 * Math.PI / TURNTABLE_PERIOD);
  const lHip = frame.keypoints.find((k) => k.name === "left_hip");
  const rHip = frame.keypoints.find((k) => k.name === "right_hip");
  const cx = lHip && rHip ? (lHip.x + rHip.x) / 2 : 0.5;
  const cosA = Math.cos(angle);
  return {
    ...frame,
    keypoints: frame.keypoints.map((kp) => ({ ...kp, x: cx + (kp.x - cx) * cosA })),
  };
}

type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
type AppMode = "mock" | "simulate" | "live";

// Candidate hosts tried in parallel when in Live mode.
// First WebSocket to open wins; snapshot thumbnail tries each independently.
const CANDIDATE_HOSTS = ["192.168.42.230", "pi-zero-ai.local", "raspberrypi.local"];
const CANDIDATE_WS_URLS = CANDIDATE_HOSTS.map((h) => `ws://${h}:8765`);
const CANDIDATE_SNAPSHOT_URLS = CANDIDATE_HOSTS.map((h) => `http://${h}:8766/snapshot`);

const CHAT_WIDTH_MIN = 120;
const CHAT_WIDTH_MAX = 560;
const CHAT_WIDTH_DEFAULT = 220;

let _msgCounter = 0;
function makeId(): string {
  return `msg-${Date.now()}-${++_msgCounter}`;
}

// ─── Data-source badge ────────────────────────────────────────────────────────

interface DataSourceBadgeProps {
  mode: AppMode;
  status: ConnectionStatus;
  exercise?: ExerciseId;
  realDataReady: Set<ExerciseId>;
}

function DataSourceBadge({ mode, status, exercise, realDataReady }: DataSourceBadgeProps) {
  let label: string;
  let dotColor: string;
  let textColor: string;
  let bgColor: string;
  let pulse = false;

  if (mode === "live") {
    switch (status) {
      case "connected":
        label = "LIVE"; dotColor = "bg-red-500"; textColor = "text-red-300";
        bgColor = "bg-red-950/70 border-red-800"; pulse = true;
        break;
      case "reconnecting":
        label = "RECONNECTING"; dotColor = "bg-amber-400"; textColor = "text-amber-300";
        bgColor = "bg-amber-950/70 border-amber-800"; pulse = true;
        break;
      default:
        label = "DISCONNECTED"; dotColor = "bg-zinc-500"; textColor = "text-zinc-400";
        bgColor = "bg-zinc-900/70 border-zinc-700"; pulse = false;
    }
  } else if (mode === "simulate") {
    label = "SIMULATED"; dotColor = "bg-violet-500"; textColor = "text-violet-300";
    bgColor = "bg-violet-950/70 border-violet-800";
  } else {
    // mock mode
    const isReal = exercise ? realDataReady.has(exercise) : false;
    if (isReal) {
      label = "CONVERTED"; dotColor = "bg-green-500"; textColor = "text-green-300";
      bgColor = "bg-green-950/70 border-green-800";
    } else {
      label = "GENERATED"; dotColor = "bg-amber-500"; textColor = "text-amber-300";
      bgColor = "bg-amber-950/70 border-amber-800";
    }
  }

  return (
    <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-mono font-semibold tracking-widest ${bgColor} ${textColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} ${pulse ? "animate-pulse" : ""}`} />
      {label}
    </div>
  );
}

export default function HomePage() {
  const [mode, setMode] = useState<AppMode>("live");
  const [exercise, setExercise] = useState<ExerciseId>("squat");
  const [simExercise, setSimExercise] = useState<ExerciseId>("squat");
  const [autoCycle, setAutoCycle] = useState(false);
  const [turntable, setTurntable] = useState(false);
  // Extra host the user can manually specify via the Connect form; prepended to candidates
  const [extraHost, setExtraHost] = useState("");
  const [extraHostInput, setExtraHostInput] = useState("");
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [frame, setFrame] = useState<PoseFrame | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const repCounterRef = useRef(0);
  const simRepHistoryRef = useRef<{ repNumber: number; formOk: boolean; angle: number }[]>([]);
  // Epoch incremented on clearMessages — lets in-flight /api/coach fetches detect staleness
  const messageEpochRef = useRef(0);

  // Simulate mode: latest frame from SimulationPanel
  const [simFrame, setSimFrame] = useState<PoseFrame | null>(null);
  const simFpsRef = useRef({ frames: 0, lastTime: Date.now(), fps: 0 });

  // Drag-to-resize: right chat panel width
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH_DEFAULT);
  const dragRef = useRef({ active: false, startX: 0, startWidth: CHAT_WIDTH_DEFAULT });

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { active: true, startX: e.clientX, startWidth: chatWidth };
  }, [chatWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const delta = dragRef.current.startX - e.clientX;
      const w = Math.max(CHAT_WIDTH_MIN, Math.min(CHAT_WIDTH_MAX, dragRef.current.startWidth + delta));
      setChatWidth(w);
    };
    const onUp = () => { dragRef.current.active = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Track which exercises have real capture data loaded (for source label)
  const [realDataReady, setRealDataReady] = useState<Set<ExerciseId>>(new Set());

  // Prefetch real datasets in the background; procedural fallback is used until ready
  useEffect(() => {
    const ids = ["squat", "plank", "lunge", "push-up"] as const;
    for (const id of ids) {
      void prefetchRealData(id as ExerciseId).then(() =>
        setRealDataReady((prev) => new Set([...prev, id as ExerciseId]))
      );
    }
  }, []);

  const getMockFrame = useCallback(() => {
    const f = generateMockFrame(exercise);
    return turntable ? applyTurntable(f) : f;
  }, [exercise, turntable]);

  // Auto-cycle: advance exercise every 5s while active in mock mode
  useEffect(() => {
    if (!autoCycle || mode !== "mock") return;
    const id = setInterval(() => {
      setExercise((prev) => {
        const idx = SEVEN_MINUTE_EXERCISES.findIndex((e) => e.id === prev);
        return SEVEN_MINUTE_EXERCISES[(idx + 1) % SEVEN_MINUTE_EXERCISES.length].id;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [autoCycle, mode]);

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
        const next = [...prev, { ...msg, id: makeId(), ts: Date.now() }];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    },
    []
  );

  const clearMessages = useCallback(() => {
    messageEpochRef.current += 1;
    setMessages([]);
    repCounterRef.current = 0;
    simRepHistoryRef.current = [];
  }, []);

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

      if (event.repNumber % 5 === 0) {
        const epoch = messageEpochRef.current;
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
            if (messageEpochRef.current !== epoch) return; // session was cleared
            if (data.tip) addMessage({ type: "coach_tip", text: data.tip });
          })
          .catch(() => {});
      }
    },
    [addMessage]
  );

  // Mock mode: demo rep messages every 1.5s
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
    }, 1500);
    return () => clearInterval(id);
  }, [mode, addMessage]);

  // Build ordered candidate list: user-supplied host first (if any), then defaults
  const wsUrls = useMemo(() => {
    const extra = extraHost ? [`ws://${extraHost}:8765`] : [];
    return [...extra, ...CANDIDATE_WS_URLS].filter((u, i, a) => a.indexOf(u) === i);
  }, [extraHost]);

  const snapshotUrls = useMemo(() => {
    const extra = extraHost ? [`http://${extraHost}:8766/snapshot`] : [];
    return [...extra, ...CANDIDATE_SNAPSHOT_URLS].filter((u, i, a) => a.indexOf(u) === i);
  }, [extraHost]);

  const isMock = mode === "mock";
  const isLive = mode === "live";
  const isSim = mode === "simulate";
  const activeExercise = isSim ? simExercise : isMock ? exercise : undefined;

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="font-mono font-semibold text-zinc-100 tracking-tight">
          pose.stream
        </span>

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
            if (next !== "live") setStatus("connected");
            if (next !== "mock") { setAutoCycle(false); setTurntable(false); }
          }}
        >
          <TabsList className="h-7 bg-zinc-800">
            <TabsTrigger value="mock" className="text-xs px-3 h-6">Mock</TabsTrigger>
            <TabsTrigger value="simulate" className="text-xs px-3 h-6">Simulate</TabsTrigger>
            <TabsTrigger value="live" className="text-xs px-3 h-6">Live</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Mock exercise selector + auto-cycle + turntable */}
        {isMock && (
          <>
            <Select value={exercise} onValueChange={(v) => setExercise(v as ExerciseId)}>
              <SelectTrigger className="h-7 w-48 text-xs bg-zinc-800 border-zinc-700 text-zinc-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                sideOffset={4}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 z-50"
              >
                {SEVEN_MINUTE_EXERCISES.map((ex) => (
                  <SelectItem key={ex.id} value={ex.id} className="text-xs">
                    {ex.order}. {ex.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Auto-cycle: play/pause through all exercises, 5s each */}
            <button
              onClick={() => setAutoCycle((v) => !v)}
              title={autoCycle ? "Stop auto-cycle" : "Auto-cycle exercises (5 s each)"}
              className={`h-7 w-7 flex items-center justify-center rounded border transition-colors ${
                autoCycle
                  ? "border-green-600 bg-green-900/30 text-green-400"
                  : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
              }`}
            >
              {autoCycle
                ? <Pause className="w-3.5 h-3.5" />
                : <Play  className="w-3.5 h-3.5" />}
            </button>

            {/* Turntable: orbit the character once every 10 s */}
            <button
              onClick={() => setTurntable((v) => !v)}
              title={turntable ? "Stop turntable" : "Rotate character (1 rev / 10 s)"}
              className={`h-7 w-7 flex items-center justify-center rounded border transition-colors ${
                turntable
                  ? "border-blue-600 bg-blue-900/30 text-blue-400"
                  : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
              }`}
            >
              <RotateCw
                className="w-3.5 h-3.5"
                style={turntable ? { animation: "spin 3s linear infinite" } : undefined}
              />
            </button>
          </>
        )}

        {isLive && (
          <form
            className="flex items-center gap-2 ml-2"
            onSubmit={(e) => {
              e.preventDefault();
              setExtraHost(extraHostInput.trim());
            }}
          >
            <span className="text-xs text-zinc-500 font-mono">ws://</span>
            <Input
              value={extraHostInput}
              onChange={(e) => setExtraHostInput(e.target.value)}
              className="h-7 w-44 text-xs font-mono bg-zinc-800 border-zinc-700 text-zinc-100"
              placeholder="auto-discovering…"
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

      {/* Main layout: Left | Center canvas | drag handle | Right chat */}
      <main className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT: Telemetry / Sim controls — hidden on small screens, narrower on medium */}
        <aside className="hidden md:flex flex-col md:w-52 xl:w-64 shrink-0 border-r border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {isSim ? (
              <SimulationPanel
                exercise={simExercise}
                onExerciseChange={(v) => {
                  setSimExercise(v);
                  clearMessages();
                }}
                onFrame={handleSimFrame}
                onRepEvent={handleRepEvent}
              />
            ) : (
              <StreamInspector
                status={isLive ? status : "connected"}
                fps={fps}
                latencyMs={latencyMs}
                frame={frame}
                exercise={activeExercise}
                snapshotUrls={isLive ? snapshotUrls : undefined}
              />
            )}
          </div>
        </aside>

        {/* CENTER: Canvas */}
        <div className="flex-1 min-h-0 p-2 md:p-4 flex items-center justify-center overflow-hidden relative">
          {/* Data-source badge ─ top-centre overlay */}
          <DataSourceBadge
            mode={mode}
            status={status}
            exercise={isMock ? exercise : undefined}
            realDataReady={realDataReady}
          />
          <div className="w-full h-full">
            <SkeletonCanvas
              wsUrls={wsUrls}
              mockMode={!isLive}
              getMockFrame={getMockFrame}
              onFrame={handleFrame}
              onConnectionChange={isLive ? setStatus : undefined}
              controlledFrame={isSim ? simFrame : null}
            />
          </div>
        </div>

        {/* Drag handle */}
        <div
          className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-zinc-500 active:bg-zinc-400 transition-colors"
          onMouseDown={handleDragStart}
        />

        {/* RIGHT: Coach log — resizable, self-contained scroll */}
        <aside
          className="shrink-0 border-l border-zinc-800 bg-zinc-900 flex flex-col overflow-hidden"
          style={{ width: chatWidth }}
        >
          <CoachingChat messages={messages} onClear={clearMessages} />
        </aside>

      </main>
    </div>
  );
}
