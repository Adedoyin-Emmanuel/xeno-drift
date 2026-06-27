import { useState, type ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { validateUsername, type StoredPlayer } from "../lib/player";
import type { Player } from "../lib/supabase";
import { playClick, playClickSmall } from "../lib/sounds";
import Leaderboard from "./Leaderboard";

function OverlayShell({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#0a0b14] px-4 py-4 sm:py-6">
      {children}
    </div>
  );
}

export function SignInScreen({
  signIn,
  onSignedIn,
}: {
  signIn: (u: string) => Promise<unknown>;
  onSignedIn: () => void;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const v = validateUsername(name);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true); setErr(null);
    try { await signIn(v.value); onSignedIn(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <OverlayShell>
      <div className="arcade-card w-full max-w-sm p-7 text-center">
        <div className="mb-2 font-heading text-[46px] font-extrabold leading-none tracking-tight text-white">Xeno Drift</div>
        <p className="mb-8 text-sm text-muted-foreground">Pick a username</p>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="USERNAME"
          className="input-game text-center tracking-[0.1em] mb-3"
          autoFocus
        />
        {err && <p className="text-destructive text-sm mb-2">{err}</p>}
        <button onClick={() => { playClick(); submit(); }} disabled={busy} className="cta w-full">
          {busy ? "..." : "Start"}
        </button>
      </div>
    </OverlayShell>
  );
}

export function StartScreen({
  player,
  onStart,
  onMultiplayer,
  onSignOut,
  onLeaderboard,
}: {
  player: StoredPlayer & Partial<Player>;
  onStart: () => void;
  onMultiplayer: () => void;
  onSignOut: () => void;
  onLeaderboard: () => void;
}) {
  return (
    <OverlayShell>
      <main className="scrollbar-game grid max-h-[94vh] w-full max-w-6xl grid-cols-1 items-start gap-6 overflow-y-auto px-2 text-center lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:overflow-hidden">
        <section className="flex min-w-0 flex-col items-center lg:min-h-[620px] lg:justify-center">
          <div className="mb-5 sm:mb-6">
            <div className="mb-3 font-heading text-[clamp(40px,9vw,78px)] font-extrabold leading-none tracking-tight text-white">
              Xeno Drift
            </div>
            <p className="mx-auto max-w-lg text-sm font-semibold leading-6 text-[#F8FAFC]/75 sm:text-base sm:leading-7">
              Survive alien waves, grab powerups, and keep drifting.
            </p>
          </div>

          <div className="mb-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-bold text-[#F8FAFC]/80 sm:mb-6 sm:text-sm">
            <span>Pilot <strong className="font-heading text-primary">{player.username}</strong></span>
            <span>Best <strong className="font-heading text-accent">{player.best_score || 0}</strong></span>
            <span>Wave <strong className="font-heading text-secondary">{player.best_wave || 1}</strong></span>
          </div>

          <div className="flex w-full max-w-xs flex-col gap-3 sm:max-w-sm">
            <button onClick={() => { playClick(); onStart(); }} className="cta w-full !py-3 text-base sm:text-[17px]">Solo Flight</button>
            <button onClick={() => { playClick(); onMultiplayer(); }} className="cta cta-secondary w-full !py-3 text-base sm:text-[17px]">Co-op Battle</button>
            <button
              onClick={() => { playClickSmall(); onLeaderboard(); }}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl px-5 py-2.5 font-heading text-xs font-extrabold uppercase tracking-wide text-[#F8FAFC]/80 transition duration-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            >
              <BarChart3 size={17} aria-hidden="true" /> Full leaderboard
            </button>
            <button onClick={() => { playClickSmall(); onSignOut(); }} className="cursor-pointer text-center text-[11px] font-bold uppercase tracking-wider text-[#F8FAFC]/55 transition duration-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary">
              Sign out
            </button>
          </div>
        </section>

        <section className="min-h-[260px] w-full min-w-0 overflow-hidden px-1 pb-2 sm:min-h-[320px] lg:h-[min(620px,86vh)] lg:self-center lg:px-0 lg:pb-0">
          <Leaderboard variant="home" currentUsername={player.username} />
        </section>
      </main>
    </OverlayShell>
  );
}

export function LeaderboardScreen({ onBack, currentUsername }: { onBack: () => void; currentUsername?: string }) {
  return (
    <OverlayShell>
      <div className="flex h-[min(760px,92vh)] w-full max-w-3xl flex-col overflow-hidden p-1 sm:p-2">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0 text-left">
            <h1 className="truncate font-heading text-2xl font-extrabold leading-tight text-white sm:text-3xl">Leaderboard</h1>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">All-time scores and recent combat runs.</p>
          </div>
          <button onClick={() => { playClickSmall(); onBack(); }} className="cta cta-secondary shrink-0 px-5 py-2.5 text-sm">
            Back
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Leaderboard variant="full" currentUsername={currentUsername} />
        </div>
      </div>
    </OverlayShell>
  );
}

export function PauseScreen({ onResume, onMenu }: { onResume: () => void; onMenu: () => void }) {
  return (
    <OverlayShell>
      <div className="arcade-card w-72 p-8 text-center">
        <div className="font-heading text-4xl mb-7">Paused</div>
        <div className="flex flex-col gap-3">
          <button onClick={() => { playClick(); onResume(); }} className="cta">Resume</button>
          <button onClick={() => { playClickSmall(); onMenu(); }} className="cta cta-secondary">Menu</button>
        </div>
      </div>
    </OverlayShell>
  );
}

export function GameOverScreen({
  result,
  onMenu,
  onRetry,
  partnerScore,
  bestScore,
  isNewBest,
}: {
  result: { score: number; wave: number };
  onMenu: () => void;
  onRetry?: () => void;
  partnerScore?: number;
  bestScore?: number;
  isNewBest?: boolean;
}) {
  return (
    <OverlayShell>
      <div className="arcade-card w-72 p-7 text-center">
        <div className="font-heading text-3xl mb-1">Game Over</div>
        {isNewBest && <div className="mb-2 text-xs font-extrabold uppercase tracking-wider text-accent">New best run</div>}
        <div className="text-[56px] tabular-nums font-heading text-primary mt-0 mb-3">{result.score}</div>
        <div className="text-sm mb-2 text-muted-foreground">Wave {result.wave}{partnerScore !== undefined ? " • Ally " + partnerScore : ""}</div>
        {bestScore !== undefined && <div className="mb-6 text-xs font-bold text-muted-foreground">Best: {bestScore.toLocaleString()}</div>}
        <div className="flex flex-col gap-2">
          {onRetry && <button onClick={() => { playClick(); onRetry(); }} className="cta">Retry</button>}
          <button onClick={() => { playClickSmall(); onMenu(); }} className="cta cta-secondary">Menu</button>
        </div>
      </div>
    </OverlayShell>
  );
}
