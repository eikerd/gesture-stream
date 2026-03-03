"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type PoseFrame } from "@/lib/pose";
import { type ExerciseId, SEVEN_MINUTE_EXERCISES } from "@/lib/mock";
import { generateSimFrame, type SimulationVariant } from "@/lib/simulation";
import { createRepCounter, type ExerciseRepCounter, type RepEvent } from "@/lib/repCounter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimulationPanelProps {
  exercise: ExerciseId;
  onExerciseChange: (exercise: ExerciseId) => void;
  onFrame: (frame: PoseFrame) => void;
  onRepEvent?: (event: RepEvent, exercise: ExerciseId) => void;
}

const SIMULATION_EXERCISES: ExerciseId[] = [
  "squat",
  "push-up",
  "lunge",
  "high-knees",
  "jumping-jacks",
];

const SIMULATION_DURATION = 60; // seconds
const TICK_RATE = 33; // ~30fps

// ─── Angle label per exercise ─────────────────────────────────────────────────

function angleLabel(exercise: ExerciseId): string {
  switch (exercise) {
    case "squat":
    case "lunge":
      return "Knee angle";
    case "push-up":
      return "Elbow angle";
    case "jumping-jacks":
      return "Arm angle";
    case "high-knees":
      return "Knee lift";
    default:
      return "Angle";
  }
}

function formatAngle(exercise: ExerciseId, value: number): string {
  if (exercise === "high-knees") {
    return `${Math.round(value)}% lift`;
  }
  return `${Math.round(value)}°`;
}

// ─── Summary card ─────────────────────────────────────────────────────────────

interface SessionSummary {
  totalReps: number;
  goodReps: number;
  badReps: number;
  avgPeakAngle: number;
}

function SummaryCard({ summary, exercise }: { summary: SessionSummary; exercise: ExerciseId }) {
  const goodPct = summary.totalReps > 0 ? Math.round((summary.goodReps / summary.totalReps) * 100) : 0;
  return (
    <Card className="bg-zinc-800 border-zinc-700 mt-3">
      <CardHeader className="pb-0 pt-4">
        <CardTitle className="text-sm text-zinc-100">Session Summary</CardTitle>
      </CardHeader>
      <CardContent className="pt-3 pb-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Total reps</span>
          <span className="font-bold text-zinc-100">{summary.totalReps}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Good form</span>
          <span className="font-bold text-green-400">{summary.goodReps} ({goodPct}%)</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Bad form</span>
          <span className="font-bold text-red-400">{summary.badReps}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Avg peak {angleLabel(exercise).toLowerCase()}</span>
          <span className="font-bold text-zinc-100">{formatAngle(exercise, summary.avgPeakAngle)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SimulationPanel({ exercise, onExerciseChange, onFrame, onRepEvent }: SimulationPanelProps) {
  const [variant, setVariant] = useState<SimulationVariant>("good");
  const [isRunning, setIsRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SIMULATION_DURATION);
  const [goodReps, setGoodReps] = useState(0);
  const [badReps, setReps_bad] = useState(0);
  const [currentAngle, setCurrentAngle] = useState(0);
  const [completionPct, setCompletionPct] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simTimeRef = useRef(0);
  const counterRef = useRef<ExerciseRepCounter | null>(null);
  const peakAnglesRef = useRef<number[]>([]);
  const goodRepsRef = useRef(0);
  const badRepsRef = useRef(0);

  const resetState = useCallback(() => {
    simTimeRef.current = 0;
    counterRef.current = createRepCounter(exercise);
    peakAnglesRef.current = [];
    goodRepsRef.current = 0;
    badRepsRef.current = 0;
    setGoodReps(0);
    setReps_bad(0);
    setTimeLeft(SIMULATION_DURATION);
    setCurrentAngle(0);
    setCompletionPct(0);
    setSummary(null);
  }, [exercise]);

  // Re-create counter when exercise changes
  useEffect(() => {
    counterRef.current = createRepCounter(exercise);
  }, [exercise]);

  const stopSession = useCallback((elapsed: number) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    const total = goodRepsRef.current + badRepsRef.current;
    const avgAngle =
      peakAnglesRef.current.length > 0
        ? peakAnglesRef.current.reduce((a, b) => a + b, 0) / peakAnglesRef.current.length
        : 0;
    setSummary({
      totalReps: total,
      goodReps: goodRepsRef.current,
      badReps: badRepsRef.current,
      avgPeakAngle: avgAngle,
    });
  }, []);

  const start = useCallback(() => {
    if (isRunning) return;
    setSummary(null);
    setIsRunning(true);

    const startWall = Date.now();
    const startSim = simTimeRef.current;

    intervalRef.current = setInterval(() => {
      const wallElapsed = (Date.now() - startWall) / 1000;
      const totalElapsed = startSim + wallElapsed;
      const remaining = SIMULATION_DURATION - totalElapsed;

      if (remaining <= 0) {
        setTimeLeft(0);
        simTimeRef.current = SIMULATION_DURATION;
        stopSession(SIMULATION_DURATION);
        return;
      }

      setTimeLeft(Math.ceil(remaining));

      simTimeRef.current = totalElapsed;
      const t = simTimeRef.current;

      const frame = generateSimFrame(exercise, variant, t);
      onFrame(frame);

      const counter = counterRef.current;
      if (counter) {
        const event: RepEvent | null = counter.update(frame);
        if (event) {
          peakAnglesRef.current.push(event.peakAngle);
          if (event.isGood) {
            goodRepsRef.current += 1;
            setGoodReps(goodRepsRef.current);
          } else {
            badRepsRef.current += 1;
            setReps_bad(badRepsRef.current);
          }
          onRepEvent?.(event, exercise);
        }
        setCurrentAngle(counter.getAngle());
        setCompletionPct(counter.getCompletionPct());
      }
    }, TICK_RATE);
  }, [isRunning, exercise, variant, onFrame, stopSession, onRepEvent]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    const total = goodRepsRef.current + badRepsRef.current;
    const avgAngle =
      peakAnglesRef.current.length > 0
        ? peakAnglesRef.current.reduce((a, b) => a + b, 0) / peakAnglesRef.current.length
        : 0;
    setSummary({
      totalReps: total,
      goodReps: goodRepsRef.current,
      badReps: badRepsRef.current,
      avgPeakAngle: avgAngle,
    });
  }, []);

  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    resetState();
  }, [resetState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const timerPct = ((SIMULATION_DURATION - timeLeft) / SIMULATION_DURATION) * 100;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timerDisplay = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const totalReps = goodReps + badReps;

  return (
    <div className="space-y-3 p-3">
      {/* Exercise selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 shrink-0">Exercise</span>
        <Select
          value={exercise}
          onValueChange={(v) => {
            onExerciseChange(v as ExerciseId);
            reset();
          }}
        >
          <SelectTrigger className="h-7 flex-1 text-xs bg-zinc-800 border-zinc-700 text-zinc-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4} className="bg-zinc-800 border-zinc-700 text-zinc-100">
            {SIMULATION_EXERCISES.map((id) => {
              const ex = SEVEN_MINUTE_EXERCISES.find((e) => e.id === id);
              return (
                <SelectItem key={id} value={id} className="text-xs">
                  {ex?.label ?? id}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Form variant toggle */}
      <Tabs
        value={variant}
        onValueChange={(v) => {
          setVariant(v as SimulationVariant);
          reset();
        }}
      >
        <TabsList className="w-full h-8 bg-zinc-800">
          <TabsTrigger value="good" className="flex-1 text-xs data-[state=active]:bg-green-700 data-[state=active]:text-white">
            Good Form
          </TabsTrigger>
          <TabsTrigger value="bad" className="flex-1 text-xs data-[state=active]:bg-red-700 data-[state=active]:text-white">
            Bad Form
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Controls */}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 h-7 text-xs"
          variant={isRunning ? "secondary" : "default"}
          onClick={isRunning ? stop : start}
          disabled={timeLeft === 0 && !isRunning}
        >
          {isRunning ? "STOP" : "START"}
        </Button>
        <Button size="sm" className="h-7 text-xs" variant="outline" onClick={reset}>
          RESET
        </Button>
      </div>

      {/* Timer */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-zinc-400">
          <span>Time</span>
          <span className="font-mono text-zinc-200">{timerDisplay}</span>
        </div>
        <Progress value={timerPct} className="h-2 bg-zinc-700" />
      </div>

      {/* Rep counter */}
      <div className="flex gap-3">
        <div className="flex-1 bg-zinc-800 rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-green-400">{goodReps}</div>
          <div className="text-xs text-zinc-400 mt-0.5">Good reps</div>
        </div>
        <div className="flex-1 bg-zinc-800 rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-red-400">{badReps}</div>
          <div className="text-xs text-zinc-400 mt-0.5">Bad reps</div>
        </div>
        <div className="flex-1 bg-zinc-800 rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-zinc-100">{totalReps}</div>
          <div className="text-xs text-zinc-400 mt-0.5">Total</div>
        </div>
      </div>

      {/* Current angle */}
      <div className="bg-zinc-800 rounded-lg p-2 flex items-center justify-between">
        <span className="text-xs text-zinc-400">{angleLabel(exercise)}</span>
        <span className="text-sm font-mono font-semibold text-zinc-100">
          {formatAngle(exercise, currentAngle)}
        </span>
      </div>

      {/* Rep progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-zinc-400">
          <span>Rep progress</span>
          <span>{Math.round(completionPct)}%</span>
        </div>
        <Progress value={completionPct} className="h-2 bg-zinc-700" />
      </div>

      {/* Summary card */}
      {summary !== null && (
        <SummaryCard summary={summary} exercise={exercise} />
      )}
    </div>
  );
}
