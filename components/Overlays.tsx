import { useState, type FormEvent } from "react";
import { Leaderboard } from "./Leaderboard";
import { validateUsername, type StoredPlayer } from "../lib/player";
import type { Player } from "../lib/supabase";

const overlayBg =
  "fixed inset-0 z-30 grid place-items-center bg-[radial-gradient(120%_90%_at_50%_28%,rgba(28,18,60,0.55),rgba(8,8,22,0.93))] backdrop-blur-md";

// ----- Sign-in -----
type SignInProps = {
  onSignedIn: (p: Player) => Promise<void> | void;
  signIn: (username: string) => Promise<Player>;
};
export function SignInScreen({ onSignedIn, signIn }: SignInProps) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const check = validateUsername(username);
    if (!check.ok) { setErr(check.error); return; }
    setBusy(true); setErr(null);
    try {
      const p = await signIn(check.value);
      await onSignedIn(p);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Couldn't enter the drift.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={overlayBg}>
      <div className="animate-rise text-center max-w-[560px] px-6">
        <h1 className="font-heading title-gradient text-6xl sm:text-7xl md:text-8xl leading-[0.92] tracking-[0.04em]">
          XENO<br />DRIFT
        </h1>
        <div className="mt-3 font-heading text-xs sm:text-sm uppercase tracking-[0.36em] text-secondary-light">
          Aliens hunt · monsters survive
        </div>
        <p className="mt-5 text-[15px] text-[#bca9e6] leading-relaxed max-w-[440px] mx-auto">
          Claim a callsign to enter the drift. Your callsign IS your account —
          your score posts to the global leaderboard the moment you die.
        </p>

        <form onSubmit={submit} className="mt-7 flex flex-col items-center gap-3">
          <div className="hud-panel px-4 py-3 w-full max-w-[360px] focus-within:border-primary transition-colors">
            <div className="text-[10px] tracking-[0.26em] uppercase text-muted-foreground text-left">Callsign</div>
            <input
              autoFocus
              value={username}
              onChange={(e) => { setUsername(e.target.value); if (err) setErr(null); }}
              maxLength={16}
              placeholder="e.g. NEON_REAPER"
              spellCheck={false}
              autoComplete="off"
              className="w-full bg-transparent outline-none font-heading text-xl text-foreground tracking-[0.08em] mt-1 placeholder:text-[#5b4e85]"
            />
          </div>
          {err && (
            <div className="text-[13px] text-destructive-light tracking-wide" style={{ color: "#fb7185" }}>
              {err}
            </div>
          )}
          <button type="submit" disabled={busy} className="cta mt-2">
            {busy ? "Entering…" : "Enter the drift"}
          </button>
          <div className="text-[11px] tracking-[0.16em] uppercase text-[#6f5f93] mt-1">
            new callsign creates an account · existing one signs in
          </div>
        </form>
      </div>
    </div>
  );
}

// ----- Start (after sign-in) -----
type StartProps = {
  player: StoredPlayer & Partial<Player>;
  onStart: () => void;
  onMultiplayer: () => void;
  onSignOut: () => void;
};
export function StartScreen({ player, onStart, onMultiplayer, onSignOut }: StartProps) {
  return (
    <div className={overlayBg}>
      <div className="animate-rise flex flex-col md:flex-row gap-8 items-center md:items-stretch max-w-[1100px] w-full px-6">
        <div className="text-center md:text-left flex-1">
          <div className="font-heading text-xs uppercase tracking-[0.26em] text-muted-foreground">
            Welcome back, pilot
          </div>
          <h1 className="font-heading title-gradient text-6xl sm:text-7xl md:text-8xl leading-[0.92] tracking-[0.04em] mt-1">
            XENO<br />DRIFT
          </h1>
          <div className="mt-3 font-heading text-xs sm:text-sm uppercase tracking-[0.36em] text-secondary-light">
            {player.username} · best {(player.best_score ?? 0).toLocaleString()}
          </div>
          <p className="mt-5 text-[15px] text-[#bca9e6] leading-relaxed max-w-[460px]">
            You are the last monster adrift in dead space. <b>Move and dodge</b> — your monster
            auto-targets the nearest alien and fires on its own. Slip past the drifting
            organisms, grab power-ups, and outlast the swarm.
          </p>

          <div className="flex gap-4 justify-center md:justify-start flex-wrap mt-5 text-[13px] text-[#cbb9ec]">
            <Legend color="#a3e635" label="You — monster" />
            <Legend color="#7c3aed" label="Aliens — hunt & shoot" />
            <Legend color="#22d3ee" label="Organisms — avoid" />
          </div>

          <div className="flex gap-3.5 justify-center md:justify-start flex-wrap mt-4 text-xs text-[#a89bc8]">
            <Powerchip color="#a3e635" glyph="+" label="Heal" />
            <Powerchip color="#22d3ee" glyph="S" label="Shield" />
            <Powerchip color="#fbbf24" glyph="R" label="Rapid" />
            <Powerchip color="#fb7185" glyph="3" label="Spread" />
          </div>

          <div className="hidden sm:flex gap-2 justify-center md:justify-start flex-wrap mt-6 items-center">
            <span className="keycap">W A S D</span><span className="text-[12px] text-[#8b78b5] tracking-[0.08em]">move</span>
            <span className="keycap">SHIFT</span><span className="text-[12px] text-[#8b78b5] tracking-[0.08em]">dash</span>
            <span className="keycap">AUTO</span><span className="text-[12px] text-[#8b78b5] tracking-[0.08em]">aim & fire</span>
          </div>

          <div className="mt-7 flex gap-3 items-center justify-center md:justify-start flex-wrap">
            <button onClick={onStart} className="cta">Enter the drift</button>
            <button onClick={onMultiplayer} className="cta cta-secondary">Play with friend</button>
            <button
              onClick={onSignOut}
              className="font-heading text-[11px] tracking-[0.18em] uppercase text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-3 py-2"
            >
              Switch pilot
            </button>
          </div>
          <div className="mt-3 text-[11px] tracking-[0.16em] uppercase text-[#6f5f93] text-center md:text-left">
            press Enter · touch: drag to move
          </div>
        </div>

        <div className="flex-shrink-0">
          <Leaderboard currentPlayerId={player.id} />
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-3.5 h-3.5 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
      {label}
    </div>
  );
}
function Powerchip({ color, glyph, label }: { color: string; glyph: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-5 h-5 rounded-md grid place-items-center font-heading text-xs font-bold"
        style={{ background: color, color: "#0b0b1a" }}
      >
        {glyph}
      </span>
      {label}
    </div>
  );
}

// ----- Pause -----
export function PauseScreen({ onResume }: { onResume: () => void }) {
  return (
    <div className={overlayBg}>
      <div className="animate-rise text-center px-6">
        <h1 className="font-heading title-gradient text-5xl sm:text-7xl tracking-[0.04em]">PAUSED</h1>
        <button onClick={onResume} className="cta cta-secondary mt-7">Resume</button>
        <div className="mt-4 text-[11px] tracking-[0.16em] uppercase text-[#6f5f93]">press P or Esc</div>
      </div>
    </div>
  );
}

// ----- Game over -----
type OverProps = {
  result: { score: number; wave: number; kills: number };
  best: number;
  isNewBest: boolean;
  saving: boolean;
  playerId?: string;
  onRetry: () => void;
  // Co-op extras
  isCoop?: boolean;
  hostUsername?: string;
  guestUsername?: string;
  onExitCoop?: () => void;
};
export function GameOverScreen({
  result, best, isNewBest, saving, playerId, onRetry,
  isCoop, hostUsername, guestUsername, onExitCoop,
}: OverProps) {
  return (
    <div className={overlayBg}>
      <div className="animate-rise flex flex-col md:flex-row gap-8 items-center md:items-stretch max-w-[1100px] w-full px-6">
        <div className="text-center md:text-left flex-1">
          <h1 className="font-heading title-gradient-rose text-5xl sm:text-7xl md:text-8xl tracking-[0.04em]">
            {isCoop ? "HIVE WINS" : "CONSUMED"}
          </h1>
          <div className="mt-2 font-heading text-xs sm:text-sm uppercase tracking-[0.36em] text-destructive-light" style={{ color: "#fb7185" }}>
            {isCoop ? "both pilots downed" : "the swarm got you"}
          </div>

          {isCoop && (
            <div className="mt-4 font-heading text-sm tracking-[0.14em]">
              <span style={{ color: "#a3e635" }}>{hostUsername}</span>
              <span className="text-muted-foreground mx-2">+</span>
              <span style={{ color: "#22d3ee" }}>{guestUsername}</span>
            </div>
          )}

          <div className="flex gap-3 justify-center md:justify-start mt-6 flex-wrap">
            <Stat label="Score" value={result.score.toLocaleString()} />
            {!isCoop && <Stat label="Best" value={best.toLocaleString()} />}
            <Stat label="Wave" value={String(result.wave)} />
            <Stat label="Kills" value={String(result.kills)} />
          </div>

          {isNewBest && !isCoop && (
            <div className="mt-4 font-heading uppercase tracking-[0.18em] text-sm animate-pulse-soft" style={{ color: "#fb7185" }}>
              ★ New high score ★
            </div>
          )}
          {saving && (
            <div className="mt-3 text-[12px] tracking-[0.16em] uppercase text-muted-foreground">
              Saving to global drift…
            </div>
          )}

          <div className="mt-7 flex gap-3 items-center justify-center md:justify-start flex-wrap">
            {isCoop ? (
              <button onClick={onExitCoop} className="cta">Back to menu</button>
            ) : (
              <button onClick={onRetry} className="cta">Respawn</button>
            )}
          </div>
          {!isCoop && (
            <div className="mt-3 text-[11px] tracking-[0.16em] uppercase text-[#6f5f93] text-center md:text-left">
              or press Enter
            </div>
          )}
        </div>
        <div className="flex-shrink-0">
          <Leaderboard currentPlayerId={playerId} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hud-panel px-5 py-3.5 min-w-[104px]">
      <div className="text-[10px] tracking-[0.26em] uppercase text-muted-foreground font-semibold">{label}</div>
      <div className="font-heading text-2xl text-white text-glow-secondary mt-1.5">{value}</div>
    </div>
  );
}
