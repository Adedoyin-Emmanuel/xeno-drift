// Realtime PvP channel layer via Supabase Broadcast.
//
// Protocol (host-authoritative):
//   guest -> host:  type="hello"   { username }
//   guest -> host:  type="input"   { mvx, mvy, dash, aim, fire, ts } (~30Hz)
//   guest -> host:  type="bye"
//   host  -> guest: type="welcome" { hostUsername }
//   host  -> guest: type="snapshot" { full state + players + bullets }
//   host  -> guest: type="countdown" { value }
//   host  -> guest: type="bye"

import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LEN; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== CODE_LEN) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export type GuestInput = {
  mvx: number;
  mvy: number;
  dash: boolean;
  aim: number;
  fire: boolean;
  ts?: number;
};

export type CoopSnapshot = {
  state: "menu" | "playing" | "over";
  score: number;          // host kills
  opponentScore: number;   // guest kills
  hp: number;
  maxHp: number;
  dashCd: number;
  dashMax: number;
  muted: boolean;
  host: {
    x: number; y: number; aim: number; alive: boolean;
    hp: number; maxHp: number; dashCd: number; dashMax: number; score: number;
  };
  guest: {
    x: number; y: number; aim: number; alive: boolean;
    hp: number; maxHp: number; dashCd: number; dashMax: number; score: number;
  };
  bullets: number[]; // [x, y, r, owner]
  W: number;
  H: number;
  tick: number;
};

export type HostMessage =
  | { type: "welcome"; hostUsername: string }
  | { type: "snapshot"; s: CoopSnapshot }
  | { type: "countdown"; value: number }
  | { type: "bye" };

export type GuestMessage =
  | { type: "hello"; username: string }
  | { type: "input"; i: GuestInput }
  | { type: "bye" };

export type HostHandle = {
  code: string;
  channel: RealtimeChannel;
  send: (m: HostMessage) => void;
  close: () => Promise<void>;
};

export type HostCallbacks = {
  onGuestJoin: (username: string) => void;
  onGuestLeave: () => void;
  onInput: (i: GuestInput) => void;
};

export async function createHostRoom(callbacks: HostCallbacks): Promise<HostHandle> {
  const code = generateRoomCode();
  const channel = supabase.channel(`xeno-room:${code}`, {
    config: { broadcast: { self: false, ack: false } },
  });

  channel.on("broadcast", { event: "g" }, ({ payload }) => {
    const m = payload as GuestMessage;
    if (m.type === "hello") callbacks.onGuestJoin(m.username);
    else if (m.type === "input") callbacks.onInput(m.i);
    else if (m.type === "bye") callbacks.onGuestLeave();
  });

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("Failed to open room channel"));
    });
  });

  const send = (m: HostMessage) => {
    channel.send({ type: "broadcast", event: "h", payload: m }).catch(() => {});
  };
  const close = async () => {
    try { send({ type: "bye" }); } catch {}
    await supabase.removeChannel(channel);
  };
  return { code, channel, send, close };
}

export type GuestHandle = {
  channel: RealtimeChannel;
  send: (m: GuestMessage) => void;
  close: () => Promise<void>;
};

export type GuestCallbacks = {
  onWelcome: (hostUsername: string) => void;
  onSnapshot: (s: CoopSnapshot) => void;
  onCountdown: (v: number) => void;
  onHostLeave: () => void;
};

export async function joinGuestRoom(code: string, callbacks: GuestCallbacks): Promise<GuestHandle> {
  const channel = supabase.channel(`xeno-room:${code}`, {
    config: { broadcast: { self: false, ack: false } },
  });

  channel.on("broadcast", { event: "h" }, ({ payload }) => {
    const m = payload as HostMessage;
    if (m.type === "welcome") callbacks.onWelcome(m.hostUsername);
    else if (m.type === "snapshot") callbacks.onSnapshot(m.s);
    else if (m.type === "countdown") callbacks.onCountdown(m.value);
    else if (m.type === "bye") callbacks.onHostLeave();
  });

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("Failed to join room"));
    });
  });

  const send = (m: GuestMessage) => {
    channel.send({ type: "broadcast", event: "g", payload: m }).catch(() => {});
  };
  const close = async () => {
    try { send({ type: "bye" }); } catch {}
    await supabase.removeChannel(channel);
  };
  return { channel, send, close };
}

// Kept for backwards-compat imports (no-op)
export async function submitCoopResult(_args: unknown) {
  /* no-op — not used in PvP mode */
}
