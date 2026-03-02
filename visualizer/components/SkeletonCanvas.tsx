"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  type PoseFrame,
  COCO_CONNECTIONS,
  confidenceColor,
} from "@/lib/pose";

interface SkeletonCanvasProps {
  wsUrl: string;
  mockMode: boolean;
  getMockFrame: () => PoseFrame;
  onFrame: (frame: PoseFrame, fps: number, latencyMs: number) => void;
}

export function SkeletonCanvas({
  wsUrl,
  mockMode,
  getMockFrame,
  onFrame,
}: SkeletonCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mockRafRef = useRef<number | null>(null);
  const fpsCounterRef = useRef({ frames: 0, lastTime: Date.now() });
  const currentFpsRef = useRef(0);

  const drawFrame = useCallback((canvas: HTMLCanvasElement, frame: PoseFrame) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    const kps = frame.keypoints;

    // Draw connections
    for (const [fromIdx, toIdx] of COCO_CONNECTIONS) {
      const from = kps[fromIdx];
      const to = kps[toIdx];
      if (!from || !to) continue;
      if (from.score < 0.3 || to.score < 0.3) continue;

      const avgScore = (from.score + to.score) / 2;
      ctx.beginPath();
      ctx.moveTo(from.x * W, from.y * H);
      ctx.lineTo(to.x * W, to.y * H);
      ctx.strokeStyle = confidenceColor(avgScore);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // Draw joints
    for (const kp of kps) {
      if (kp.score < 0.3) continue;
      const r = 4 + kp.score * 5;
      ctx.beginPath();
      ctx.arc(kp.x * W, kp.y * H, r, 0, Math.PI * 2);
      ctx.fillStyle = confidenceColor(kp.score);
      ctx.fill();
    }
  }, []);

  const computeFps = useCallback((): number => {
    const now = Date.now();
    fpsCounterRef.current.frames += 1;
    const elapsed = now - fpsCounterRef.current.lastTime;
    if (elapsed >= 1000) {
      currentFpsRef.current = Math.round(
        (fpsCounterRef.current.frames * 1000) / elapsed
      );
      fpsCounterRef.current.frames = 0;
      fpsCounterRef.current.lastTime = now;
    }
    return currentFpsRef.current;
  }, []);

  // Mock mode loop
  useEffect(() => {
    if (!mockMode) return;

    const tick = () => {
      const frame = getMockFrame();
      const latency = 0;
      const fps = computeFps();
      if (canvasRef.current) drawFrame(canvasRef.current, frame);
      onFrame(frame, fps, latency);
      mockRafRef.current = requestAnimationFrame(tick);
    };

    mockRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (mockRafRef.current !== null) {
        cancelAnimationFrame(mockRafRef.current);
        mockRafRef.current = null;
      }
    };
  }, [mockMode, getMockFrame, onFrame, drawFrame, computeFps]);

  // WebSocket mode
  useEffect(() => {
    if (mockMode) return;

    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const frame: PoseFrame = JSON.parse(event.data as string);
            const latency = Date.now() - frame.ts * 1000;
            const fps = computeFps();
            if (canvasRef.current) drawFrame(canvasRef.current, frame);
            onFrame(frame, fps, latency);
          } catch {
            // ignore parse errors
          }
        };

        ws.onerror = () => {
          ws.close();
        };

        ws.onclose = () => {
          wsRef.current = null;
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [mockMode, wsUrl, drawFrame, onFrame, computeFps]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={480}
      className="w-full h-full rounded-md"
      style={{ background: "#0a0a0a" }}
    />
  );
}
