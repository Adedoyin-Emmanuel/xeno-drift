import { useEffect, useRef, useState, type FormEvent } from "react";
import { isValidRoomCode } from "../lib/realtime";

const overlayBg =
  "fixed inset-0 z-30 grid place-items-center bg-[radial-gradient(120%_90%_at_50%_28%,rgba(28,18,60,0.55),rgba(8,8,22,0.93))] backdrop-blur-md";

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

// ---- Choice screen ----
type ChoiceProps = {
  onCreate: () => void;
  onJoin: () => void;
  onCancel: () => void;
  busy?: boolean;
};
export function MultiplayerChoice({ onCreate, onJoin, onCancel, busy }: ChoiceProps) {
  return (
    <div className={overlayBg}>
      <div className="animate-rise text-center max-w-[520px] px-6">
        <div className="font-heading text-xs tracking-[0.26em] uppercase text-secondary-light">
          Hive Defense — 2 pilots
        </div>
        <h1 className="font-heading title-gradient text-5xl sm:text-6xl leading-[0.92] tracking-[0.04em] mt-1">
          PLAY TOGETHER
        </h1>
        <p className="mt-4 text-[14px] text-[#bca9e6] leading-relaxed max-w-[420px] mx-auto">
          Team up against a doubled swarm. Score is shared, HP is not.
          Get downed and you spectate until the next wave — your partner
          fights on alone.
        </p>

        <div className="mt-7 flex flex-col gap-3 items-stretch">
          <button onClick={onCreate} disabled={busy} className="cta">
            {busy ? "Opening room…" : "Create room"}
          </button>
          <button onClick={onJoin} disabled={busy} className="cta cta-secondary">
            Join with code
          </button>
          <button
            onClick={onCancel}
            className="font-heading text-[11px] tracking-[0.18em] uppercase text-muted-foreground hover:text-foreground transition-colors cursor-pointer mt-1"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Host waiting room ----
type HostLobbyProps = {
  code: string;
  hostName: string;
  guestName: string | null;
  countdown: number | null;
  onCancel: () => void;
};
export function HostLobby({ code, hostName, guestName, countdown, onCancel }: HostLobbyProps) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => { /* ignore */ }
    );
  }
  return (
    <div className={overlayBg}>
      <div className="animate-rise text-center max-w-[560px] px-6">
        <div className="font-heading text-xs tracking-[0.26em] uppercase text-secondary-light">
          Hive Defense — room open
        </div>
        <h1 className="font-heading title-gradient text-5xl sm:text-6xl mt-1 tracking-[0.04em]">
          ROOM CODE
        </h1>

        <button
          onClick={copy}
          className="mt-6 hud-panel px-6 py-5 flex items-center gap-4 mx-auto cursor-pointer hover:border-secondary-light transition-colors pointer-events-auto"
          aria-label="Copy room code"
        >
          <span
            className="font-heading text-5xl sm:text-6xl tracking-[0.28em] text-white"
            style={{ textShadow: "0 0 24px rgba(167,139,250,0.65)" }}
          >
            {code}
          </span>
          <span className="text-secondary-light">
            <CopyIcon />
          </span>
        </button>
        <div className="mt-2 text-[11px] tracking-[0.18em] uppercase text-[#6f5f93] min-h-[16px]">
          {copied ? "copied to clipboard" : "tap to copy · share with a friend"}
        </div>

        <div className="mt-6 hud-panel px-5 py-3 inline-flex flex-col gap-1 min-w-[280px]">
          <div className="flex items-center justify-between gap-6">
            <span className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground">Host</span>
            <span className="font-heading text-sm" style={{ color: "#a3e635" }}>{hostName}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground">Guest</span>
            <span className="font-heading text-sm" style={{ color: guestName ? "#22d3ee" : "#6f5f93" }}>
              {guestName ?? "waiting…"}
            </span>
          </div>
        </div>

        {countdown !== null && countdown > 0 && (
          <div className="mt-6 font-heading text-7xl text-white animate-pulse-soft text-glow-secondary">
            {countdown}
          </div>
        )}
        {countdown !== null && countdown === 0 && (
          <div className="mt-6 font-heading text-3xl tracking-[0.2em]" style={{ color: "#fb7185" }}>
            GO!
          </div>
        )}

        {countdown === null && (
          <button
            onClick={onCancel}
            className="mt-7 font-heading text-[11px] tracking-[0.18em] uppercase text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-3 py-2"
          >
            Cancel room
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Guest join form / waiting ----
type GuestLobbyProps = {
  status: "input" | "connecting" | "waiting";
  hostName: string | null;
  guestName: string;
  countdown: number | null;
  onSubmitCode: (code: string) => void;
  onCancel: () => void;
  errorMsg?: string | null;
};
export function GuestLobby({
  status, hostName, guestName, countdown, onSubmitCode, onCancel, errorMsg,
}: GuestLobbyProps) {
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "input") inputRef.current?.focus();
  }, [status]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!isValidRoomCode(c)) return;
    onSubmitCode(c);
  }

  return (
    <div className={overlayBg}>
      <div className="animate-rise text-center max-w-[520px] px-6">
        <div className="font-heading text-xs tracking-[0.26em] uppercase text-secondary-light">
          Hive Defense — join run
        </div>
        <h1 className="font-heading title-gradient text-5xl sm:text-6xl mt-1 tracking-[0.04em]">
          ENTER CODE
        </h1>

        {status === "input" && (
          <form onSubmit={submit} className="mt-7 flex flex-col items-center gap-3">
            <div className="hud-panel px-4 py-3 w-full max-w-[360px] focus-within:border-primary transition-colors">
              <div className="text-[10px] tracking-[0.26em] uppercase text-muted-foreground text-left">Room code</div>
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                maxLength={6}
                placeholder="XK3P9M"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="characters"
                className="w-full bg-transparent outline-none font-heading text-3xl text-foreground tracking-[0.32em] mt-1 placeholder:text-[#5b4e85] text-center"
              />
            </div>
            {errorMsg && (
              <div className="text-[13px] tracking-wide" style={{ color: "#fb7185" }}>
                {errorMsg}
              </div>
            )}
            <button
              type="submit"
              className="cta cta-secondary mt-2"
              disabled={!isValidRoomCode(code.trim().toUpperCase())}
            >
              Join room
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="font-heading text-[11px] tracking-[0.18em] uppercase text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-3 py-2"
            >
              Back
            </button>
          </form>
        )}

        {(status === "connecting" || status === "waiting") && (
          <>
            <div className="mt-6 hud-panel px-5 py-3 inline-flex flex-col gap-1 min-w-[280px]">
              <div className="flex items-center justify-between gap-6">
                <span className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground">Host</span>
                <span className="font-heading text-sm" style={{ color: hostName ? "#a3e635" : "#6f5f93" }}>
                  {hostName ?? "waiting…"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground">Guest</span>
                <span className="font-heading text-sm" style={{ color: "#22d3ee" }}>{guestName}</span>
              </div>
            </div>

            {countdown !== null && countdown > 0 && (
              <div className="mt-6 font-heading text-7xl text-white animate-pulse-soft text-glow-secondary">
                {countdown}
              </div>
            )}
            {countdown !== null && countdown === 0 && (
              <div className="mt-6 font-heading text-3xl tracking-[0.2em]" style={{ color: "#fb7185" }}>
                GO!
              </div>
            )}

            {countdown === null && (
              <>
                <div className="mt-4 text-[12px] tracking-[0.18em] uppercase text-muted-foreground">
                  {status === "connecting" ? "connecting to room…" : "waiting for host to start…"}
                </div>
                <button
                  onClick={onCancel}
                  className="mt-5 font-heading text-[11px] tracking-[0.18em] uppercase text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-3 py-2"
                >
                  Leave room
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
