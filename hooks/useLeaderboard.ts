import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export type LeaderboardEntry = {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  kills: number;
  games: number;
  best: number;
};

function mapRow(row: any): LeaderboardEntry {
  return {
    username: row.username ?? "???",
    displayName: row.display_name || row.username || "???",
    avatarUrl: row.avatar_url ?? null,
    kills: row.total_kills ?? 0,
    games: row.games_played ?? 0,
    best: row.best_score ?? 0,
  };
}

export function useLeaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const tickRef = useRef(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("leaderboard_entries")
      .select("username,display_name,avatar_url,total_kills,games_played,best_score")
      .gt("games_played", 0)
      .order("total_kills", { ascending: false })
      .limit(20);

    if (error) {
      console.error("leaderboard fetch", error);
      setEntries([]);
    } else {
      setEntries((data ?? []).map(mapRow));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      load();
      tickRef.current++;
    }, 5000);

    const chan = supabase
      .channel("lb-poll")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leaderboard_entries" },
        () => load()
      )
      .subscribe();

    return () => {
      clearInterval(id);
      supabase.removeChannel(chan);
    };
  }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    load();
  }, [load]);

  return { entries, loading, refresh, tick: tickRef.current };
}
