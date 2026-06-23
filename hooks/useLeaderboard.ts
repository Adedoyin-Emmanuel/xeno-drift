import { useEffect, useState } from "react";
import { supabase, type Player } from "../lib/supabase";

export type LeaderboardEntry = Pick<Player, "id" | "username" | "best_score" | "best_wave" | "games_played">;

/**
 * Subscribes to the players table and keeps a live, sorted top-N list of best
 * scores. Updates as soon as anyone in the world finishes a game.
 */
export function useLeaderboard(limit: number = 10) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchTop = async () => {
      const { data, error } = await supabase
        .from("players")
        .select("id, username, best_score, best_wave, games_played")
        .order("best_score", { ascending: false })
        .limit(limit);
      if (cancelled) return;
      if (error) {
        console.error("leaderboard fetch", error);
        setLoading(false);
        return;
      }
      setEntries((data ?? []) as LeaderboardEntry[]);
      setLoading(false);
    };
    fetchTop();

    const channel = supabase
      .channel("public:players:leaderboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players" },
        () => {
          fetchTop();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return { entries, loading };
}

/**
 * Subscribes to every new score row submitted globally — used to render a live
 * "recent games" ticker so it feels like a multiplayer world.
 */
export type RecentScore = {
  id: string;
  username: string;
  score: number;
  wave: number;
  created_at: string;
};

export function useRecentScores(limit: number = 8) {
  const [scores, setScores] = useState<RecentScore[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fetchRecent = async () => {
      const { data } = await supabase
        .from("scores")
        .select("id, username, score, wave, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (cancelled) return;
      if (data) setScores(data as RecentScore[]);
    };
    fetchRecent();

    const channel = supabase
      .channel("public:scores:recent")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scores" },
        (payload) => {
          const row = payload.new as RecentScore;
          setScores((prev) => [row, ...prev].slice(0, limit));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [limit]);
  return scores;
}

// ---------- Co-op ----------
export type CoopEntry = {
  id: string;
  room_code: string;
  host_username: string;
  guest_username: string;
  score: number;
  wave: number;
  created_at: string;
};

export function useCoopLeaderboard(limit: number = 10) {
  const [entries, setEntries] = useState<CoopEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchTop = async () => {
      const { data, error } = await supabase
        .from("coop_leaderboard")
        .select("id, room_code, host_username, guest_username, score, wave, created_at")
        .order("score", { ascending: false })
        .limit(limit);
      if (cancelled) return;
      if (error) {
        console.error("coop leaderboard fetch", error);
        setLoading(false);
        return;
      }
      setEntries((data ?? []) as CoopEntry[]);
      setLoading(false);
    };
    fetchTop();

    const channel = supabase
      .channel("public:coop_leaderboard:top")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "coop_leaderboard" },
        () => { fetchTop(); }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return { entries, loading };
}
