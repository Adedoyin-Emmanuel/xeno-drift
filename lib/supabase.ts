import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ulpybonhetptxjocylrt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cuhOWwp-SQ8QhG-vnpvwSA_DxIQSTIY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: "implicit",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type Player = {
  id: string;
  auth_user_id: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  best_score: number;
  best_wave: number;
  total_kills: number;
  games_played: number;
  best_match_mode?: "solo" | "coop";
  best_coop_partner_username?: string | null;
};

export type ScoreRow = {
  id: string;
  player_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  score: number;
  wave: number;
  kills: number;
  match_mode?: "solo" | "coop";
  coop_partner_username?: string | null;
  room_code?: string | null;
  created_at: string;
};
