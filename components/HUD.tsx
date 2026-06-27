import { Volume2, VolumeX, LogOut, X, Pause, Play } from "lucide-react";
import type { PublicState } from "../game/engine";
import { playClickSmall } from "../lib/sounds";

export function HUD({
  gameState,
  onToggleMute,
  onSignOut,
  onExitPractice,
  onTogglePause,
}: {
  gameState: PublicState;
  onToggleMute: () => void;
  onSignOut: () => void;
  onExitPractice: () => void;
  onTogglePause: () => void;
}) {
  const hpPct = Math.max(0, Math.min(100, Math.round((gameState.hp / gameState.maxHp) * 100)));
  const isPaused = gameState.state === "paused";
  const partnerHpPct = gameState.partner
    ? Math.max(0, Math.min(100, Math.round((gameState.partner.hp / gameState.partner.maxHp) * 100)))
    : 0;

  return (
    <div className="fixed inset-0 pointer-events-none z-20 p-[clamp(12px,2.6vw,28px)] flex flex-col justify-between">
      <div className="flex justify-between items-start gap-3">
        <div className="hud-panel px-4 py-2.5 pointer-events-auto">
          <div className="text-[11px] tracking-[0.12em] uppercase text-muted-foreground font-extrabold">Score</div>
          <div className="font-heading text-[clamp(24px,3.2vw,32px)] leading-none text-primary">
            {gameState.score.toLocaleString()}
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          {gameState.wave > 0 && (
            <div className="hud-panel px-4 py-2.5 text-center">
              <div className="text-[11px] tracking-[0.12em] uppercase text-muted-foreground font-extrabold">Wave</div>
              <div className="font-heading text-[clamp(24px,3.2vw,32px)] leading-none text-secondary">
                {gameState.wave}
              </div>
            </div>
          )}

          <div className="pointer-events-auto flex flex-wrap justify-end gap-2.5 rounded-3xl bg-slate-950/20 p-2 sm:gap-3 sm:p-3">
            {gameState.mode === "solo" && (
              <button
                onClick={() => { playClickSmall(); onTogglePause(); }}
                className="btn-icon"
                aria-label={isPaused ? "Resume" : "Pause"}
              >
                {isPaused ? <Play size={20} /> : <Pause size={20} />}
              </button>
            )}
            {gameState.mode === "solo" && (
              <button
                onClick={() => { playClickSmall(); onExitPractice(); }}
                className="btn-icon"
                aria-label="Exit practice"
              >
                <X size={20} />
              </button>
            )}
            <button
              onClick={() => { playClickSmall(); onToggleMute(); }}
              className="btn-icon"
              aria-label="Toggle mute"
            >
              {gameState.muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <button
              onClick={() => { playClickSmall(); onSignOut(); }}
              className="btn-icon"
              aria-label="Sign out"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-end gap-3">
        <div className="flex min-w-[min(300px,68vw)] flex-col gap-1.5 sm:gap-2">
          <div className="hud-panel flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
            <span className="w-[42px] font-heading text-xs text-foreground sm:text-sm">Hull</span>
            <div className="h-3.5 flex-1 overflow-hidden rounded-full border-2 border-border bg-muted sm:h-4">
              <div className="h-full rounded-full bg-primary transition-all duration-150" style={{ width: `${hpPct}%` }} />
            </div>
          </div>


          {gameState.partner && (
            <div className="hud-panel flex items-center gap-3 px-4 py-2">
              <span className="font-heading text-xs text-secondary w-[44px]">Ally</span>
              <div className="flex-1 h-3 rounded-full bg-muted border-2 border-border overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-150 bg-secondary"
                  style={{ width: `${gameState.partner.alive ? partnerHpPct : 0}%` }}
                />
              </div>
              <span className="text-[11px] font-extrabold text-secondary">
                {gameState.partner.alive ? gameState.partnerScore?.toLocaleString() : "DOWN"}
              </span>
            </div>
          )}
        </div>

        {gameState.selfAlive === false && (
          <div className="hud-panel px-4 py-2 pointer-events-auto">
            <span className="font-heading text-destructive text-sm animate-pulse-soft">Respawning...</span>
          </div>
        )}
      </div>
    </div>
  );
}
