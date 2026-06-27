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
    <div className="arcade-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="arcade-card p-6 max-w-sm w-full text-center animate-rise">
        <h2 className="title-gradient font-heading text-[clamp(30px,6vw,44px)] mb-2">Co-op room</h2>
        <p className="mb-5 text-xs font-bold text-muted-foreground">Team up with a friend in realtime.</p>
        <div className="flex flex-col gap-3">
          <button onClick={() => { playClick(); onCreate(); }} className="cta cta-secondary !py-3 text-sm">Create room</button>
          <button onClick={() => { playClick(); onJoin(); }} className="cta !py-3 text-sm">Join room</button>
          <button onClick={() => { playClickSmall(); onCancel(); }} className="cta cta-secondary mt-1 !py-2.5 text-xs">Back</button>
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
    <div className="arcade-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="arcade-card p-6 max-w-sm w-full text-center animate-rise">
        <h2 className="title-gradient font-heading text-[clamp(30px,6vw,44px)] mb-1">Room open</h2>
        <p className="text-muted-foreground text-xs font-bold mb-4">Share this code</p>
        <div className="bg-muted border-2 border-border rounded-3xl px-4 py-3 text-2xl font-heading text-foreground tracking-[0.14em] mb-2 flex items-center justify-center gap-3">
          <span>{code}</span>
          <button
            onClick={handleCopy}
            className="grid h-9 w-9 place-items-center rounded-2xl bg-white text-muted-foreground transition hover:text-secondary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-secondary/20 cursor-pointer"
            aria-label="Copy room code"
          >
            {copied ? <Check size={19} className="text-primary" /> : <Copy size={19} />}
          </button>
        </div>
        <div className={`mb-4 h-5 text-xs font-extrabold transition ${copied ? "text-primary opacity-100" : "text-muted-foreground opacity-0"}`} aria-live="polite">
          Room code copied!
        </div>
        <div className="text-xs font-extrabold text-muted-foreground mb-4 leading-5">
          Host: <span className="text-primary">{hostName}</span><br />
          Ally: <span className={guestName ? "text-secondary" : "text-muted-foreground"}>{guestName ?? "Waiting…"}</span>
        </div>
        {countdown !== null && (
          <div className="text-5xl font-heading text-accent mb-4 animate-pulse-soft">{countdown}</div>
        )}
        <button onClick={() => { playClickSmall(); onCancel(); }} className="cta cta-secondary w-full !py-2.5 text-xs">Cancel</button>
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
    <div className="arcade-overlay fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="arcade-card p-6 max-w-sm w-full text-center animate-rise">
        <h2 className="title-gradient font-heading text-[clamp(30px,6vw,44px)] mb-2">Join room</h2>
        {status === "input" && (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") onSubmitCode(code); }}
              placeholder="ROOM CODE"
              maxLength={6}
              className="input-game mb-3 text-center text-sm tracking-[0.2em]"
            />
            {errorMsg && <p className="text-destructive text-xs font-extrabold mb-2">{errorMsg}</p>}
            <button onClick={() => { playClick(); onSubmitCode(code); }} className="cta w-full !py-3 text-sm">Join</button>
            <button onClick={() => { playClickSmall(); onCancel(); }} className="cta cta-secondary mt-3 w-full !py-2.5 text-xs">Back</button>
          </>
        )}
        {status === "connecting" && (
          <p className="text-muted-foreground text-sm font-extrabold animate-pulse-soft">Connecting…</p>
        )}
        {status === "waiting" && (
          <>
            <div className="text-xs font-extrabold text-muted-foreground mb-3 leading-5">
              Host: <span className="text-primary">{hostName ?? "—"}</span><br />
              You: <span className="text-secondary">{guestName ?? "—"}</span>
            </div>
            {countdown !== null && (
              <div className="text-5xl font-heading text-accent mb-4 animate-pulse-soft">{countdown}</div>
            )}
            <p className="text-muted-foreground text-xs font-bold mb-4">Waiting for host…</p>
            <button onClick={() => { playClickSmall(); onCancel(); }} className="cta cta-secondary w-full !py-2.5 text-xs">Leave</button>
          </>
        )}
      </div>
    </div>
  );
}
