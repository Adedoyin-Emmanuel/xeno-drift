import { supabase, type Player } from "./supabase";

const STORAGE_KEY = "xeno_drift_player_v1";

export type StoredPlayer = { id: string; username: string };

export function loadStoredPlayer(): StoredPlayer | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p.id === "string" && typeof p.username === "string") return p;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveStoredPlayer(p: StoredPlayer) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export function clearStoredPlayer() {
  localStorage.removeItem(STORAGE_KEY);
}

export function validateUsername(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim();
  if (v.length < 3) return { ok: false, error: "Username must be at least 3 characters." };
  if (v.length > 16) return { ok: false, error: "Username must be 16 characters or fewer." };
  if (!/^[A-Za-z0-9_\-]+$/.test(v)) return { ok: false, error: "Letters, numbers, _ and - only." };
  return { ok: true, value: v };
}

/**
 * Sign in or create a player by username. No password — username IS the account
 * for this leaderboard demo. If the name exists we attach to it; otherwise we
 * create a new row.
 */
export async function signInOrCreate(usernameRaw: string): Promise<Player> {
  const check = validateUsername(usernameRaw);
  if (!check.ok) throw new Error(check.error);
  const username = check.value;

  // Case-insensitive lookup
  const { data: existing, error: lookupErr } = await supabase
    .from("players")
    .select("*")
    .ilike("username", username)
    .limit(1)
    .maybeSingle();

  if (lookupErr) throw new Error(lookupErr.message);
  if (existing) {
    saveStoredPlayer({ id: existing.id, username: existing.username });
    return existing as Player;
  }

  const { data: created, error: insertErr } = await supabase
    .from("players")
    .insert({ username })
    .select("*")
    .single();

  if (insertErr) {
    // Race condition / unique violation — retry lookup
    if (insertErr.code === "23505") {
      const { data: again } = await supabase
        .from("players")
        .select("*")
        .ilike("username", username)
        .limit(1)
        .maybeSingle();
      if (again) {
        saveStoredPlayer({ id: again.id, username: again.username });
        return again as Player;
      }
    }
    throw new Error(insertErr.message);
  }
  saveStoredPlayer({ id: created.id, username: created.username });
  return created as Player;
}

export type GameResult = { score: number; wave: number; kills: number };

/**
 * Submit a game result: insert a score row + update the player's aggregate stats.
 */
export async function submitGameResult(player: StoredPlayer, result: GameResult): Promise<Player | null> {
  const { error: scoreErr } = await supabase.from("scores").insert({
    player_id: player.id,
    username: player.username,
    score: result.score,
    wave: result.wave,
    kills: result.kills,
  });
  if (scoreErr) {
    console.error("score insert failed", scoreErr);
  }

  // Read current best to update aggregate
  const { data: current } = await supabase
    .from("players")
    .select("*")
    .eq("id", player.id)
    .maybeSingle();

  if (!current) return null;

  const update = {
    best_score: Math.max(current.best_score, result.score),
    best_wave: Math.max(current.best_wave, result.wave),
    total_kills: current.total_kills + result.kills,
    games_played: current.games_played + 1,
  };
  const { data: updated, error: updateErr } = await supabase
    .from("players")
    .update(update)
    .eq("id", player.id)
    .select("*")
    .single();
  if (updateErr) {
    console.error("player update failed", updateErr);
    return current as Player;
  }
  return updated as Player;
}
