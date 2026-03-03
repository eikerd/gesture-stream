"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  type PoseFrame,
  COCO_CONNECTIONS,
  confidenceColor,
} from "@/lib/pose";

// ─── Auto-fit bounding box ────────────────────────────────────────────────────
// Expands instantly to accommodate new keypoint extents,
// contracts slowly (≈2 s at 30 fps) so scale doesn't jump between frames.
interface BBox { x0: number; x1: number; y0: number; y1: number }

function updateSmoothedBBox(sb: BBox | null, kps: PoseFrame["keypoints"]): BBox {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const kp of kps) {
    if (kp.score < 0.3) continue;
    if (kp.x < x0) x0 = kp.x;
    if (kp.x > x1) x1 = kp.x;
    if (kp.y < y0) y0 = kp.y;
    if (kp.y > y1) y1 = kp.y;
  }
  if (!isFinite(x0)) return sb ?? { x0: 0, x1: 1, y0: 0, y1: 1 };
  if (!sb) return { x0, x1, y0, y1 };

  const SLOW = 0.015; // contract ~2 s at 30 fps
  return {
    x0: x0 < sb.x0 ? x0 : sb.x0 + (x0 - sb.x0) * SLOW,
    x1: x1 > sb.x1 ? x1 : sb.x1 + (x1 - sb.x1) * SLOW,
    y0: y0 < sb.y0 ? y0 : sb.y0 + (y0 - sb.y0) * SLOW,
    y1: y1 > sb.y1 ? y1 : sb.y1 + (y1 - sb.y1) * SLOW,
  };
}

type WsStatus = "connected" | "disconnected" | "reconnecting";

interface SkeletonCanvasProps {
  /** Ordered list of WebSocket URLs to try in parallel; first to open wins. */
  wsUrls: string[];
  mockMode: boolean;
  getMockFrame: () => PoseFrame;
  onFrame: (frame: PoseFrame, fps: number, latencyMs: number) => void;
  onConnectionChange?: (status: WsStatus) => void;
  /** Called with the winning WS URL when a connection is established. */
  onConnectedHost?: (url: string) => void;
  /** When provided, skips internal loops and just renders this frame directly. */
  controlledFrame?: PoseFrame | null;
}

export function SkeletonCanvas({
  wsUrls,
  mockMode,
  getMockFrame,
  onFrame,
  onConnectionChange,
  onConnectedHost,
  controlledFrame = null,
}: SkeletonCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingSocketsRef = useRef<WebSocket[]>([]);
  const mockRafRef = useRef<number | null>(null);
  const fpsCounterRef = useRef({ frames: 0, lastTime: Date.now() });
  const currentFpsRef = useRef(0);
  const smoothBBoxRef = useRef<BBox | null>(null);

  // Sync canvas internal resolution to its CSS display size (DPR-aware)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio ?? 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.scale(dpr, dpr);
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Clear canvas when disconnected (mock off, no WS data)
  useEffect(() => {
    if (mockMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [mockMode]);

  const drawFrame = useCallback((canvas: HTMLCanvasElement, frame: PoseFrame) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Always draw in CSS pixels — the context is DPR-scaled by the ResizeObserver
    // so using canvas.width (physical pixels) would double-scale on Retina displays.
    const W = canvas.offsetWidth  || canvas.width;
    const H = canvas.offsetHeight || canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    const kps = frame.keypoints;

    // ── Auto-fit: smooth bbox → uniform scale → center ───────────────────────
    smoothBBoxRef.current = updateSmoothedBBox(smoothBBoxRef.current, kps);
    const { x0, x1, y0, y1 } = smoothBBoxRef.current;

    const bw = Math.max(x1 - x0, 0.05);
    const bh = Math.max(y1 - y0, 0.05);
    const PAD = 0.12; // 12% padding on each side
    const px0 = x0 - bw * PAD, px1 = x1 + bw * PAD;
    const py0 = y0 - bh * PAD, py1 = y1 + bh * PAD;

    const scale = Math.min(W / (px1 - px0), H / (py1 - py0));
    const offX  = (W - scale * (px1 - px0)) / 2 - scale * px0;
    const offY  = (H - scale * (py1 - py0)) / 2 - scale * py0;

    const sx = (x: number) => x * scale + offX;
    const sy = (y: number) => y * scale + offY;

    // Draw connections
    for (const [fromIdx, toIdx] of COCO_CONNECTIONS) {
      const from = kps[fromIdx];
      const to   = kps[toIdx];
      if (!from || !to || from.score < 0.3 || to.score < 0.3) continue;

      ctx.beginPath();
      ctx.moveTo(sx(from.x), sy(from.y));
      ctx.lineTo(sx(to.x),   sy(to.y));
      ctx.strokeStyle = confidenceColor((from.score + to.score) / 2);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // Draw joints
    for (const kp of kps) {
      if (kp.score < 0.3) continue;
      ctx.beginPath();
      ctx.arc(sx(kp.x), sy(kp.y), 4 + kp.score * 5, 0, Math.PI * 2);
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

  // Controlled-frame mode: draw the provided frame and emit to parent
  useEffect(() => {
    if (!controlledFrame) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawFrame(canvas, controlledFrame);
    onFrame(controlledFrame, computeFps(), 0);
  }, [controlledFrame, drawFrame, onFrame, computeFps]);

  // Mock mode loop
  useEffect(() => {
    if (!mockMode || controlledFrame != null) return;
    // Reset smoothed bbox so new exercise snaps to its own scale immediately
    smoothBBoxRef.current = null;

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
  }, [mockMode, controlledFrame, getMockFrame, onFrame, drawFrame, computeFps]);

  // WebSocket mode — tries all wsUrls in parallel; first to open wins.
  useEffect(() => {
    if (mockMode || controlledFrame != null) return;

    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      onConnectionChange?.("reconnecting");

      if (wsUrls.length === 0) {
        onConnectionChange?.("disconnected");
        return;
      }

      let winnerFound = false;
      let closedCount = 0;
      const sockets: WebSocket[] = [];
      pendingSocketsRef.current = sockets;

      for (const url of wsUrls) {
        try {
          const ws = new WebSocket(url);
          sockets.push(ws);

          ws.onopen = () => {
            if (winnerFound) { ws.close(); return; }
            winnerFound = true;
            wsRef.current = ws;
            // Close all losing sockets
            for (const s of sockets) {
              if (s !== ws && s.readyState < WebSocket.CLOSING) s.close();
            }
            onConnectionChange?.("connected");
            onConnectedHost?.(url);

            ws.onmessage = (event) => {
              try {
                const frame: PoseFrame = JSON.parse(event.data as string);
                const latency = Date.now() - frame.ts * 1000;
                const fps = computeFps();
                if (canvasRef.current) drawFrame(canvasRef.current, frame);
                onFrame(frame, fps, latency);
              } catch { /* ignore parse errors */ }
            };

            ws.onerror = () => { ws.close(); };

            ws.onclose = () => {
              wsRef.current = null;
              onConnectionChange?.("disconnected");
              reconnectTimeout = setTimeout(connect, 2000);
            };
          };

          ws.onerror = () => { ws.close(); };

          // Non-winner close: count failures; retry when all have closed
          ws.onclose = () => {
            if (!winnerFound) {
              closedCount++;
              if (closedCount === wsUrls.length) {
                onConnectionChange?.("disconnected");
                reconnectTimeout = setTimeout(connect, 2000);
              }
            }
          };
        } catch {
          // Constructor threw (e.g. bad URL) — count as a failure
          closedCount++;
          if (closedCount === wsUrls.length && !winnerFound) {
            onConnectionChange?.("disconnected");
            reconnectTimeout = setTimeout(connect, 3000);
          }
        }
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      wsRef.current?.close();
      wsRef.current = null;
      for (const s of pendingSocketsRef.current) {
        if (s.readyState < WebSocket.CLOSING) s.close();
      }
      pendingSocketsRef.current = [];
    };
  }, [mockMode, controlledFrame, wsUrls, drawFrame, onFrame, computeFps, onConnectionChange, onConnectedHost]);

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
