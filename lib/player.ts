import type { User } from "@supabase/supabase-js";
import { supabase, type Player } from "./supabase";

const STORAGE_KEY = "xeno_drift_player_v1";

export type StoredPlayer = { id: string; username: string; auth_user_id?: string | null };

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

function sanitizeUsername(raw: string | undefined | null): string {
  const fallback = "Pilot";
  const cleaned = (raw || fallback)
    .split("@")[0]
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);

  if (cleaned.length >= 3) return cleaned;
  return `${cleaned || fallback}${Math.floor(100 + Math.random() * 900)}`.slice(0, 16);
}

function preferredUsername(user: User): string {
  const meta = user.user_metadata ?? {};
  return sanitizeUsername(
    meta.user_name ||
      meta.preferred_username ||
      meta.name ||
      meta.full_name ||
      user.email ||
      user.id
  );
}

function candidateUsernames(base: string): string[] {
  const trimmed = base.slice(0, 16);
  const candidates = [trimmed];
  for (let i = 0; i < 8; i++) {
    const suffix = String(Math.floor(10 + Math.random() * 9999));
    candidates.push(`${trimmed.slice(0, Math.max(3, 16 - suffix.length))}${suffix}`);
  }
  return candidates;
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) throw new Error(error.message);
}

export async function signOutPlayer(): Promise<void> {
  clearStoredPlayer();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function ensurePlayerForUser(user: User): Promise<Player> {
  const { data: existing, error: lookupErr } = await supabase
    .from("players")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (lookupErr) throw new Error(lookupErr.message);
  if (existing) {
    saveStoredPlayer({ id: existing.id, username: existing.username, auth_user_id: existing.auth_user_id });
    return existing as Player;
  }

  for (const username of candidateUsernames(preferredUsername(user))) {
    const { data: created, error: insertErr } = await supabase
      .from("players")
      .insert({ auth_user_id: user.id, username })
      .select("*")
      .single();

    if (!insertErr && created) {
      saveStoredPlayer({ id: created.id, username: created.username, auth_user_id: created.auth_user_id });
      return created as Player;
    }

    if (insertErr?.code === "23505") {
      const { data: raced } = await supabase
        .from("players")
        .select("*")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (raced) {
        saveStoredPlayer({ id: raced.id, username: raced.username, auth_user_id: raced.auth_user_id });
        return raced as Player;
      }
      continue;
    }

    if (insertErr) throw new Error(insertErr.message);
  }

  throw new Error("Could not create a unique pilot profile. Please try again.");
}

export async function getSessionPlayer(): Promise<Player | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session?.user) {
    clearStoredPlayer();
    return null;
  }
  return ensurePlayerForUser(data.session.user);
}

export type GameResult = { score: number; wave: number; kills: number };

/**
 * Submit a game result: insert a score row + update the authenticated player's aggregate stats.
 */
export async function submitGameResult(player: StoredPlayer, result: GameResult): Promise<Player | null> {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw new Error(sessionErr.message);
  const authUserId = sessionData.session?.user.id;
  if (!authUserId) throw new Error("You must be signed in to save scores.");
  if (player.auth_user_id && player.auth_user_id !== authUserId) throw new Error("This score does not belong to the signed-in player.");

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

  const { data: current } = await supabase
    .from("players")
    .select("*")
    .eq("id", player.id)
    .eq("auth_user_id", authUserId)
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
    .eq("auth_user_id", authUserId)
    .select("*")
    .single();
  if (updateErr) {
    console.error("player update failed", updateErr);
    return current as Player;
  }
  return updated as Player;
}
