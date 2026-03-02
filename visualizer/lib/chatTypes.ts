export type ChatMessageType =
  | "rep_good"
  | "rep_bad"
  | "form_warning"
  | "coach_tip"
  | "session_start"
  | "session_end"
  | "timer";

export interface ChatMessage {
  id: string;
  type: ChatMessageType;
  text: string;
  ts: number; // unix ms
  repNumber?: number;
  angle?: number;
  score?: number;
}

export interface RepEvent {
  repNumber: number;
  angle?: number;
  formOk: boolean;
  exercise: string;
}
