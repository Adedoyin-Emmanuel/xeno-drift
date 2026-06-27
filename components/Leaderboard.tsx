import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Medal, Radio, Shield, Trophy, Zap } from "lucide-react";

type TopEntry = { id?: string; username: string; best_score: number; best_wave: number; games_played: number };
type RecentEntry = { id: string; player_id?: string | null; username: string; score: number; wave: number; kills: number; created_at: string };

type LeaderboardProps = {
  variant?: "home" | "full";
  currentUsername?: string;
};

function formatTimeAgo(dateString: string) {
  try {
    const elapsed = Date.now() - new Date(dateString).getTime();
    const secs = Math.floor(elapsed / 1000);
    if (secs < 10) return "Just now";
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(dateString).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function RankMark({ rank }: { rank: number }) {
  const colors = ["text-accent", "text-slate-300", "text-orange-300"];
  if (rank <= 3) return <Medal size={17} className={colors[rank - 1]} aria-hidden="true" />;
  return <span className="font-heading text-[11px] text-muted-foreground">#{rank}</span>;
}

function YouBadge() {
  return (
    <span className="shrink-0 px-2 py-0.5 font-heading text-[9px] font-extrabold uppercase tracking-wider text-primary">
      You
    </span>
  );
}

export default function Leaderboard({ variant = "full", currentUsername }: LeaderboardProps) {
  const [topEntries, setTopEntries] = useState<TopEntry[]>([]);
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"top" | "recent">("top");
  const isHome = variant === "home";
  const normalizedCurrentUsername = useMemo(() => currentUsername?.trim().toLowerCase() ?? "", [currentUsername]);
  const isCurrentUser = (username: string) => username.trim().toLowerCase() === normalizedCurrentUsername;

  async function fetchLeaderboardAndRecent() {
    try {
      const { data: topData, error: topError } = await supabase
        .from("players")
        .select("id, username, best_score, best_wave, games_played")
        .order("best_score", { ascending: false })
        .limit(isHome ? 10 : 30);
      if (topError) console.error("Error loading top players:", topError);

      if (!isHome) {
        const { data: recentData, error: recentError } = await supabase
          .from("scores")
          .select("id, player_id, username, score, wave, kills, created_at")
          .order("created_at", { ascending: false })
          .limit(30);
        if (recentError) console.error("Error loading recent scores:", recentError);
        if (recentData) setRecentEntries(recentData as RecentEntry[]);
      }

      if (topData) {
        setTopEntries(
          topData.map((x: any) => ({
            id: x.id,
            username: x.username,
            best_score: x.best_score ?? 0,
            best_wave: x.best_wave ?? 1,
            games_played: x.games_played ?? 0,
          }))
        );
      }
    } catch (err) {
      console.error("Could not load leaderboards:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLeaderboardAndRecent();

    if (isHome) return;
    const channel = supabase
      .channel("live-scores")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scores" },
        (payload) => {
          const newScore = payload.new as RecentEntry;
          if (newScore) {
            setRecentEntries((prev) => [newScore, ...prev.filter((x) => x.id !== newScore.id)].slice(0, 30));
            fetchLeaderboardAndRecent();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isHome]);

  const topList = (
    <section className="flex min-h-0 flex-col overflow-hidden" aria-label="All-time leaderboard">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#F8FAFC]/70">
          <Trophy size={15} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate">All-time leaderboard</span>
        </div>
        {!isHome && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Best scores</span>}
      </div>

      <div className={`scrollbar-game min-h-0 overflow-y-auto pr-1 ${isHome ? "max-h-[min(52vh,480px)] lg:max-h-[min(68vh,560px)]" : "max-h-[calc(100vh-260px)]"}`}>
        {topEntries.length === 0 ? (
          <div className="px-2 py-10 text-center text-xs font-semibold text-muted-foreground">
            No records yet. Be the first pilot on the board.
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {topEntries.map((p, idx) => {
              const you = normalizedCurrentUsername.length > 0 && isCurrentUser(p.username);
              return (
                <div
                  key={p.id || p.username + idx}
                  className={`grid min-w-0 grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 py-2.5 transition duration-200 sm:gap-3 ${you ? "px-2" : "px-1"}`}
                >
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-white/5">
                    <RankMark rank={idx + 1} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-heading text-sm font-bold leading-tight text-white">{p.username}</span>
                      {you && <YouBadge />}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
                      <span className="flex shrink-0 items-center gap-1"><Shield size={11} className="text-secondary" aria-hidden="true" /> Wave {p.best_wave}</span>
                      {!isHome && <span className="truncate">{p.games_played} runs</span>}
                    </div>
                  </div>
                  <div className="max-w-[96px] truncate text-right font-heading text-sm font-extrabold tabular-nums text-accent sm:max-w-none">
                    {p.best_score.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  const recentList = (
    <section className="flex min-h-0 flex-col overflow-hidden" aria-label="Recent runs">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#F8FAFC]/70">
          <Radio size={15} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">Recent runs</span>
        </div>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Live feed</span>
      </div>

      <div className="scrollbar-game min-h-0 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
        {recentEntries.length === 0 ? (
          <div className="px-2 py-10 text-center text-xs font-semibold text-muted-foreground">
            Waiting for new combat logs.
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {recentEntries.map((score, idx) => {
              const you = normalizedCurrentUsername.length > 0 && isCurrentUser(score.username);
              return (
                <div
                  key={score.id || idx}
                  className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 transition duration-200 ${you ? "px-2" : "px-1"}`}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-heading text-sm font-bold leading-tight text-white">{score.username}</span>
                      {you && <YouBadge />}
                    </div>
                    <div className="mt-0.5 text-[10px] font-bold text-muted-foreground">{formatTimeAgo(score.created_at)}</div>
                  </div>
                  <div className="min-w-[76px] text-right">
                    <div className="truncate font-heading text-sm font-extrabold tabular-nums text-secondary">{score.score.toLocaleString()}</div>
                    <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
                      <span>W{score.wave}</span>
                      <span>•</span>
                      <span className="flex items-center gap-0.5"><Zap size={10} aria-hidden="true" /> {score.kills} K</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden text-left text-foreground">
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-muted-foreground">
          <div className="mb-3 h-8 w-8 animate-spin rounded-full border-4 border-transparent border-t-primary" />
          <span className="text-center font-heading text-xs uppercase tracking-widest">Loading board...</span>
        </div>
      ) : isHome ? (
        topList
      ) : (
        <>
          <div className="mb-4 flex rounded-2xl bg-slate-950/35 p-1">
            <button
              onClick={() => setActiveTab("top")}
              className={`flex-1 cursor-pointer rounded-xl px-3 py-2.5 font-heading text-xs font-extrabold uppercase tracking-wider transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary ${activeTab === "top" ? "bg-primary text-white" : "text-muted-foreground hover:text-white"}`}
            >
              All-time
            </button>
            <button
              onClick={() => setActiveTab("recent")}
              className={`flex-1 cursor-pointer rounded-xl px-3 py-2.5 font-heading text-xs font-extrabold uppercase tracking-wider transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary ${activeTab === "recent" ? "bg-secondary text-white" : "text-muted-foreground hover:text-white"}`}
            >
              Recent
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{activeTab === "top" ? topList : recentList}</div>
        </>
      )}
    </div>
  );
}
