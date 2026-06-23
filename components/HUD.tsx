import type { ReactNode } from "react";
import type { PublicState } from "../game/engine";

const PauseIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
const SoundOnIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14" />
  </svg>
);
const SoundOffIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <line x1="22" y1="9" x2="16" y2="15" />
    <line x1="16" y1="9" x2="22" y2="15" />
  </svg>
);
const LogOutIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const BUFF_META: Record<"shield" | "rapid" | "spread", { color: string; glyph: string }> = {
  shield: { color: "#22d3ee", glyph: "S" },
  rapid:  { color: "#fbbf24", glyph: "R" },
  spread: { color: "#fb7185", glyph: "3" },
};

type Props = {
  state: PublicState;
  username: string;
  onPause: () => void;
  onToggleMute: () => void;
  onSignOut: () => void;
};

export function HUD({ state, username, onPause, onToggleMute, onSignOut }: Props) {
  const hpPct = Math.max(0, Math.min(100, (state.hp / state.maxHp) * 100));
  const dashPct = Math.max(0, Math.min(100, (1 - state.dashCd / state.dashMax) * 100));
  const bossPct = state.boss ? Math.max(0, Math.min(100, (state.boss.hp / state.boss.maxHp) * 100)) : 0;
  const isCoop = state.mode === "host" || state.mode === "guest";
  const partner = state.partner;
  const partnerPct = partner ? Math.max(0, Math.min(100, (partner.hp / partner.maxHp) * 100)) : 0;
  const selfDowned = isCoop && state.selfAlive === false && state.state === "playing";

  return (
    <div className="fixed inset-0 z-10 pointer-events-none p-4 sm:p-6 flex flex-col justify-between">
      {/* Boss bar */}
      {state.boss && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 hud-panel px-4 py-2 min-w-[min(440px,72vw)] text-center">
          <div className="text-[10px] tracking-[0.26em] uppercase text-destructive-light font-semibold">⬢ Mothership</div>
          <div className="h-3.5 mt-1.5 rounded-lg bg-[rgba(8,8,24,0.7)] border border-border overflow-hidden">
            <div
              className="h-full rounded-lg transition-[width] duration-150"
              style={{
                width: `${bossPct}%`,
                background: "linear-gradient(90deg,#f43f5e,#fb7185)",
                boxShadow: "0 0 16px rgba(244,63,94,0.6)",
              }}
            />
          </div>
        </div>
      )}

      {/* Downed overlay for self in co-op */}
      {selfDowned && (
        <div className="absolute inset-x-0 top-1/3 flex flex-col items-center pointer-events-none">
          <div className="hud-panel px-6 py-4 text-center animate-pulse-soft" style={{ borderColor: "rgba(244,63,94,0.5)" }}>
            <div className="font-heading text-2xl tracking-[0.18em]" style={{ color: "#fb7185" }}>DOWNED</div>
            <div className="text-xs tracking-[0.2em] uppercase text-muted-foreground mt-1">
              respawn next wave · partner fights on
            </div>
          </div>
        </div>
      )}

      {/* Top row */}
      <div className="flex justify-between items-start gap-3">
        <div className="hud-panel px-4 py-2.5">
          <div className="text-[10px] tracking-[0.26em] uppercase text-muted-foreground font-semibold">Score</div>
          <div className="font-heading text-2xl sm:text-3xl text-white text-glow-secondary leading-none mt-0.5">
            {state.score.toLocaleString()}
          </div>
          <div
            className="font-heading text-[13px] mt-1 transition-opacity tracking-[0.1em]"
            style={{ color: "#fb7185", opacity: state.combo > 1 ? 1 : 0 }}
          >
            ×{state.combo} STREAK
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="hud-panel px-3 py-1.5 text-right pointer-events-auto">
            <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Pilot</div>
            <div className="font-heading text-white text-sm">{username}</div>
          </div>
          {partner && (
            <div className="hud-panel px-3 py-1.5 pointer-events-auto min-w-[180px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Partner</span>
                <span
                  className="font-heading text-[11px]"
                  style={{ color: partner.alive ? "#22d3ee" : "#fb7185" }}
                >
                  {partner.alive ? "• LIVE" : "✕ DOWN"}
                </span>
              </div>
              <div className="font-heading text-white text-sm truncate">{partner.username || "—"}</div>
              <div className="h-2 mt-1 rounded-md bg-[rgba(8,8,24,0.7)] border border-border overflow-hidden">
                <div
                  className="h-full rounded-md transition-[width] duration-150"
                  style={{
                    width: `${partnerPct}%`,
                    background: "linear-gradient(90deg,#0891b2,#22d3ee)",
                    boxShadow: "0 0 10px rgba(34,211,238,0.5)",
                  }}
                />
              </div>
            </div>
          )}
          <div className="flex gap-2 items-start">
            <div className="hud-panel px-4 py-2.5 text-center">
              <div className="text-[10px] tracking-[0.26em] uppercase text-muted-foreground font-semibold">Wave</div>
              <div className="font-heading text-2xl sm:text-3xl text-white text-glow-secondary leading-none mt-0.5">
                {state.wave}
              </div>
            </div>
            <IconBtn label="Toggle sound" onClick={onToggleMute}>
              {state.muted ? <SoundOffIcon /> : <SoundOnIcon />}
            </IconBtn>
            {!isCoop && (
              <IconBtn label="Pause" onClick={onPause}>
                <PauseIcon />
              </IconBtn>
            )}
            <IconBtn label="Sign out" onClick={onSignOut}>
              <LogOutIcon />
            </IconBtn>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="flex justify-between items-end gap-3">
        <div className="hud-panel px-4 py-2.5 flex flex-col gap-2 min-w-[min(280px,52vw)]">
          <Bar label="HULL" pct={hpPct} fill="linear-gradient(90deg,#84cc16,#a3e635)" glow="rgba(163,230,53,0.6)" />
          <Bar label="DASH" pct={dashPct} fill="linear-gradient(90deg,#7c3aed,#a78bfa)" glow="rgba(124,58,237,0.5)" />
          <div className="flex gap-1.5 mt-0.5 min-h-[20px]">
            {(["shield", "rapid", "spread"] as const).map((k) => {
              const t = state.buffs[k];
              if (t <= 0) return null;
              const meta = BUFF_META[k];
              return (
                <span
                  key={k}
                  className="font-heading text-[11px] tracking-[0.06em] px-2 py-0.5 rounded-md border flex items-center gap-1"
                  style={{ color: meta.color, borderColor: meta.color }}
                >
                  {meta.glyph} {Math.ceil(t)}s
                </span>
              );
            })}
          </div>
        </div>
        <div />
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="pointer-events-auto cursor-pointer w-10 h-10 grid place-items-center hud-panel text-[#b9a6ee] hover:text-white hover:border-secondary-light transition-all duration-200"
      style={{ borderRadius: 11 }}
    >
      {children}
    </button>
  );
}

function Bar({ label, pct, fill, glow }: { label: string; pct: number; fill: string; glow: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="font-heading text-[11px] tracking-[0.12em] text-muted-foreground w-10">{label}</span>
      <div className="flex-1 h-3 rounded-lg bg-[rgba(8,8,24,0.7)] border border-border overflow-hidden relative">
        <div
          className="h-full rounded-lg transition-[width] duration-150"
          style={{ width: `${pct}%`, background: fill, boxShadow: `0 0 14px ${glow}` }}
        />
      </div>
    </div>
  );
}
