import { Volume2, VolumeX, LogOut, X } from "lucide-react";
import type { PublicState } from "../game/engine";
import { playClickSmall } from "../lib/sounds";

export function HUD({
  gameState,
  onToggleMute,
  onSignOut,
  onExitPractice,
}: {
  gameState: PublicState;
  onToggleMute: () => void;
  onSignOut: () => void;
  onExitPractice: () => void;
}) {
  if (!gameState) return null;
  const hpPct = Math.max(0, Math.min(100, Math.round((gameState.hp / gameState.maxHp) * 100)));
  return (
    <div className="fixed inset-0 pointer-events-none z-20">
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between">
        <div className="pointer-events-auto flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-widest text-white/60">HP</div>
          <div className="w-40 h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-lime-400 transition-all duration-150"
              style={{ width: `${hpPct}%` }}
            />
          </div>
          {gameState.wave > 0 && (
            <div className="text-[10px] uppercase tracking-widest text-violet-300 mt-1">
              Wave {gameState.wave}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {gameState.partner && (
            <div className="text-xs font-mono text-cyan-300 mr-2">
              Partner: {gameState.partnerScore}
            </div>
          )}
          {gameState.mode === "solo" && (
            <button
              onClick={() => { playClickSmall(); onExitPractice(); }}
              className="p-2 rounded-md bg-white/10 hover:bg-rose-500/30 text-white transition cursor-pointer"
              aria-label="Exit practice"
            >
              <X size={16} />
            </button>
          )}
          <button
            onClick={() => { playClickSmall(); onToggleMute(); }}
            className="p-2 rounded-md bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            aria-label="Toggle mute"
          >
            {gameState.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            onClick={() => { playClickSmall(); onSignOut(); }}
            className="p-2 rounded-md bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
