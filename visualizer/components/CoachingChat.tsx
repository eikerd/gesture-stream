"use client";

import { useEffect, useRef } from "react";
import { type ChatMessage, type ChatMessageType } from "@/lib/chatTypes";

interface CoachingChatProps {
  messages: ChatMessage[];
  onClear: () => void;
}

const MAX_MESSAGES = 200;

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
  const visibleMessages = messages.slice(-MAX_MESSAGES);
  const originTs = visibleMessages[0]?.ts ?? Date.now();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "#0a0a0a" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-xs font-mono font-semibold text-zinc-400 tracking-wide uppercase">
          Coach Log
        </span>
        <button
          onClick={onClear}
          className="text-xs font-mono text-zinc-600 hover:text-zinc-300 transition-colors px-1"
          aria-label="Clear log"
        >
          clear
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 scrollbar-thin">
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
