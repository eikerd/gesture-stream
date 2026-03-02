"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { type ChatMessage, type ChatMessageType } from "@/lib/chatTypes";

interface CoachingChatProps {
  messages: ChatMessage[];
  onClear: () => void;
}

const MAX_MESSAGES = 200;

// Only these message types are spoken aloud
const TTS_TYPES = new Set<ChatMessageType>(["rep_bad", "form_warning", "coach_tip"]);

function buildSpeechText(msg: ChatMessage): string {
  if (msg.type === "rep_bad" && msg.repNumber !== undefined) {
    return `Rep ${msg.repNumber}. ${msg.text}`;
  }
  return msg.text;
}

function formatTimestamp(ts: number, originTs: number): string {
  const elapsed = Math.max(0, ts - originTs);
  const totalSeconds = Math.floor(elapsed / 1000);
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const ss = (totalSeconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function getMessageColor(type: ChatMessageType): string {
  switch (type) {
    case "rep_good":
      return "text-green-400";
    case "rep_bad":
      return "text-red-400";
    case "form_warning":
      return "text-amber-400";
    case "coach_tip":
      return "text-cyan-400";
    case "session_start":
    case "session_end":
    case "timer":
    default:
      return "text-zinc-400";
  }
}

function getMessagePrefix(type: ChatMessageType): string {
  switch (type) {
    case "rep_good":
      return "✓";
    case "rep_bad":
      return "✗";
    case "form_warning":
      return "⚠";
    case "coach_tip":
      return "🤖";
    case "session_start":
      return "▶";
    case "session_end":
      return "■";
    case "timer":
      return "🕐";
    default:
      return " ";
  }
}

function MessageRow({
  message,
  originTs,
}: {
  message: ChatMessage;
  originTs: number;
}) {
  const color = getMessageColor(message.type);
  const prefix = getMessagePrefix(message.type);
  const time = formatTimestamp(message.ts, originTs);
  const isCoachTip = message.type === "coach_tip";
  const isRep = message.type === "rep_good" || message.type === "rep_bad";

  return (
    <div
      className={`flex gap-2 text-xs font-mono leading-5 ${isCoachTip ? "pl-4" : ""}`}
    >
      <span className="text-zinc-600 shrink-0 w-10">{time}</span>
      <span className={`shrink-0 w-3 ${color}`}>{prefix}</span>
      <span className={`flex-1 ${color} break-words`}>
        {isRep && message.repNumber !== undefined ? (
          <>
            <span>Rep {message.repNumber}</span>
            {message.angle !== undefined && (
              <span className="text-zinc-500 ml-2">
                {message.angle.toFixed(0)}°
              </span>
            )}
            <span className="ml-2">{message.text}</span>
          </>
        ) : (
          message.text
        )}
      </span>
    </div>
  );
}

export function CoachingChat({ messages, onClear }: CoachingChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);

  const visibleMessages = messages.slice(-MAX_MESSAGES);
  const originTs = visibleMessages[0]?.ts ?? Date.now();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // TTS: speak new cue messages when enabled
  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.05;
    utt.pitch = 1;
    window.speechSynthesis.speak(utt);
  }, []);

  useEffect(() => {
    if (!ttsEnabled || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.id === lastSpokenIdRef.current) return;
    lastSpokenIdRef.current = last.id;
    if (!TTS_TYPES.has(last.type)) return;
    speak(buildSpeechText(last));
  }, [messages, ttsEnabled, speak]);

  // Stop speaking when TTS is turned off
  useEffect(() => {
    if (!ttsEnabled && typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, [ttsEnabled]);

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      style={{ backgroundColor: "#0a0a0a" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-xs font-mono font-semibold text-zinc-400 tracking-wide uppercase">
          Coach Log
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTtsEnabled((v) => !v)}
            className={`transition-colors ${
              ttsEnabled ? "text-cyan-400 hover:text-cyan-200" : "text-zinc-600 hover:text-zinc-300"
            }`}
            aria-label={ttsEnabled ? "Mute voice cues" : "Enable voice cues"}
            title={ttsEnabled ? "Voice cues on" : "Voice cues off"}
          >
            {ttsEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={onClear}
            className="text-xs font-mono text-zinc-600 hover:text-zinc-300 transition-colors px-1"
            aria-label="Clear log"
          >
            clear
          </button>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5">
        {visibleMessages.length === 0 ? (
          <p className="text-xs font-mono text-zinc-700 italic mt-2">
            Waiting for session...
          </p>
        ) : (
          visibleMessages.map((msg) => (
            <MessageRow key={msg.id} message={msg} originTs={originTs} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
