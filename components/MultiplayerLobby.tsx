import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { playClick, playClickSmall } from "../lib/sounds";

export function MultiplayerChoice({
  onCreate,
  onJoin,
  onCancel,
}: {
  onCreate: () => void;
  onJoin: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0b1a]/90 backdrop-blur">
      <div className="bg-[#0e1021]/90 border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4 text-center">
        <h2 className="text-xl font-bold text-white mb-4">Co-op Arena</h2>
        <div className="flex flex-col gap-3">
          <button onClick={() => { playClick(); onCreate(); }} className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-2 rounded-lg transition cursor-pointer">Create Room</button>
          <button onClick={() => { playClick(); onJoin(); }} className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-2 rounded-lg transition cursor-pointer">Join Room</button>
          <button onClick={() => { playClickSmall(); onCancel(); }} className="text-white/50 text-sm mt-2 hover:text-white/80 cursor-pointer">Back</button>
        </div>
      </div>
    </div>
  );
}

export function HostLobby({
  code,
  hostName,
  guestName,
  countdown,
  onCancel,
}: {
  code: string;
  hostName: string;
  guestName: string | null;
  countdown: number | null;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      playClickSmall();
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard not available */ }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0b1a]/90 backdrop-blur">
      <div className="bg-[#0e1021]/90 border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4 text-center">
        <h2 className="text-xl font-bold text-white mb-2">Room Open</h2>
        <p className="text-white/50 text-sm mb-4">Share this code with a friend</p>
        <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-2xl font-mono text-white tracking-widest mb-4 flex items-center justify-center gap-3">
          <span>{code}</span>
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-white/10 transition cursor-pointer text-white/60 hover:text-white"
            aria-label="Copy room code"
          >
            {copied ? <Check size={18} className="text-lime-400" /> : <Copy size={18} />}
          </button>
        </div>
        <div className="text-sm text-white/60 mb-4">
          Host: <span className="text-lime-400">{hostName}</span><br />
          Guest: <span className={guestName ? "text-cyan-400" : "text-white/30"}>{guestName ?? "Waiting…"}</span>
        </div>
        {countdown !== null && <div className="text-5xl font-bold text-violet-400 mb-4">{countdown}</div>}
        <button onClick={() => { playClickSmall(); onCancel(); }} className="text-white/50 text-sm hover:text-white/80 cursor-pointer">Cancel</button>
      </div>
    </div>
  );
}

export function GuestLobby({
  status,
  hostName,
  guestName,
  countdown,
  onSubmitCode,
  onCancel,
  errorMsg,
}: {
  status: "input" | "connecting" | "waiting";
  hostName: string | null;
  guestName: string | null;
  countdown: number | null;
  onSubmitCode: (code: string) => void;
  onCancel: () => void;
  errorMsg: string | null;
}) {
  const [code, setCode] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0b1a]/90 backdrop-blur">
      <div className="bg-[#0e1021]/90 border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4 text-center">
        <h2 className="text-xl font-bold text-white mb-2">Join Room</h2>
        {status === "input" && (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") onSubmitCode(code); }}
              placeholder="ROOM CODE"
              maxLength={6}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-center tracking-widest placeholder-white/30 focus:outline-none focus:border-violet-400 mb-3"
            />
            {errorMsg && <p className="text-rose-400 text-xs mb-2">{errorMsg}</p>}
            <button onClick={() => { playClick(); onSubmitCode(code); }} className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-2 rounded-lg transition cursor-pointer">Join</button>
            <button onClick={() => { playClickSmall(); onCancel(); }} className="text-white/50 text-sm mt-3 hover:text-white/80 cursor-pointer">Back</button>
          </>
        )}
        {status === "connecting" && <p className="text-white/60">Connecting…</p>}
        {status === "waiting" && (
          <>
            <div className="text-sm text-white/60 mb-2">
              Host: <span className="text-lime-400">{hostName ?? "—"}</span><br />
              You: <span className="text-cyan-400">{guestName ?? "—"}</span>
            </div>
            {countdown !== null && <div className="text-5xl font-bold text-violet-400 mb-4">{countdown}</div>}
            <p className="text-white/40 text-xs">Waiting for host…</p>
            <button onClick={() => { playClickSmall(); onCancel(); }} className="text-white/50 text-sm mt-4 hover:text-white/80 cursor-pointer">Leave</button>
          </>
        )}
      </div>
    </div>
  );
}
