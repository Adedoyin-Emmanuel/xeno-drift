import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export type LeaderboardEntry = {
  username: string;
  kills: number;
  games: number;
  best: number;
};

function mapRow(row: any): LeaderboardEntry {
  return {
    username: row.username ?? "???",
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
      .from("players")
      .select("username,total_kills,games_played,best_score")
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
        { event: "*", schema: "public", table: "players" },
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
