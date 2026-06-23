import { useState } from "react";
import { useCoopLeaderboard, useLeaderboard, useRecentScores } from "../hooks/useLeaderboard";

const TrophyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);
const RadioIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
  </svg>
);

type Props = { currentPlayerId?: string };
type Tab = "solo" | "coop";

export function Leaderboard({ currentPlayerId }: Props) {
  const [tab, setTab] = useState<Tab>("solo");
  const { entries, loading } = useLeaderboard(10);
  const { entries: coopEntries, loading: coopLoading } = useCoopLeaderboard(10);
  const recent = useRecentScores(6);

  return (
    <div className="flex flex-col gap-4 w-full max-w-[420px]">
      <div className="hud-panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrophyIcon />
          <h3 className="font-heading text-sm tracking-[0.2em] uppercase text-secondary-light">
            Global Leaderboard
          </h3>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Live
          </span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-3 p-1 rounded-lg bg-[rgba(8,8,24,0.55)] border border-border">
          <TabBtn active={tab === "solo"} onClick={() => setTab("solo")}>Solo</TabBtn>
          <TabBtn active={tab === "coop"} onClick={() => setTab("coop")}>Co-op</TabBtn>
        </div>

        {tab === "solo" ? (
          loading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No survivors yet. Be the first.
            </div>
          ) : (
            <ol className="flex flex-col gap-1">
              {entries.map((e, i) => {
                const isMe = e.id === currentPlayerId;
                const rankColor = i === 0 ? "#fbbf24" : i === 1 ? "#cbd5e1" : i === 2 ? "#fb923c" : "#9d8ad6";
                return (
                  <li
                    key={e.id}
                    className="flex items-center gap-3 py-2 px-2 rounded-lg transition-colors"
                    style={{
                      background: isMe ? "rgba(163,230,53,0.08)" : "transparent",
                      border: isMe ? "1px solid rgba(163,230,53,0.35)" : "1px solid transparent",
                    }}
                  >
                    <span
                      className="font-heading text-sm w-6 text-center"
                      style={{ color: rankColor, textShadow: i < 3 ? `0 0 10px ${rankColor}` : undefined }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1 truncate font-heading text-sm text-foreground">
                      {e.username}
                      {isMe && <span className="ml-2 text-[10px] text-primary tracking-[0.2em]">YOU</span>}
                    </span>
                    <span className="font-heading text-sm text-white text-glow-secondary">
                      {e.best_score.toLocaleString()}
                    </span>
                    <span className="font-heading text-[11px] text-muted-foreground w-12 text-right">
                      W{e.best_wave}
                    </span>
                  </li>
                );
              })}
            </ol>
          )
        ) : (
          coopLoading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>
          ) : coopEntries.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No co-op runs yet. Grab a friend.
            </div>
          ) : (
            <ol className="flex flex-col gap-1">
              {coopEntries.map((e, i) => {
                const rankColor = i === 0 ? "#fbbf24" : i === 1 ? "#cbd5e1" : i === 2 ? "#fb923c" : "#9d8ad6";
                return (
                  <li
                    key={e.id}
                    className="flex items-center gap-3 py-2 px-2 rounded-lg"
                  >
                    <span
                      className="font-heading text-sm w-6 text-center"
                      style={{ color: rankColor, textShadow: i < 3 ? `0 0 10px ${rankColor}` : undefined }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1 truncate font-heading text-[13px] text-foreground">
                      <span style={{ color: "#a3e635" }}>{e.host_username}</span>
                      <span className="text-muted-foreground mx-1">+</span>
                      <span style={{ color: "#22d3ee" }}>{e.guest_username}</span>
                    </span>
                    <span className="font-heading text-sm text-white text-glow-secondary">
                      {e.score.toLocaleString()}
                    </span>
                    <span className="font-heading text-[11px] text-muted-foreground w-12 text-right">
                      W{e.wave}
                    </span>
                  </li>
                );
              })}
            </ol>
          )
        )}
      </div>

      <div className="hud-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <RadioIcon />
          <h3 className="font-heading text-xs tracking-[0.2em] uppercase text-secondary-light">
            Live drift feed
          </h3>
        </div>
        {recent.length === 0 ? (
          <div className="text-muted-foreground text-xs py-2">Waiting for incoming transmissions…</div>
        ) : (
          <ul className="flex flex-col gap-1 max-h-[150px] overflow-hidden">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 text-[12px] font-heading text-muted-foreground animate-rise"
              >
                <span className="text-foreground truncate flex-1">{r.username}</span>
                <span className="text-primary">+{r.score.toLocaleString()}</span>
                <span className="text-[10px] uppercase tracking-[0.15em]">W{r.wave}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TabBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 font-heading text-[11px] tracking-[0.22em] uppercase py-1.5 px-3 rounded-md transition-all duration-150 cursor-pointer"
      style={{
        color: active ? "#fff" : "#9d8ad6",
        background: active ? "linear-gradient(180deg, rgba(167,139,250,0.35), rgba(124,58,237,0.25))" : "transparent",
        boxShadow: active ? "0 0 14px rgba(124,58,237,0.4) inset" : undefined,
      }}
    >
      {children}
    </button>
  );
}
