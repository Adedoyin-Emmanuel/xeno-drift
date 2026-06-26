import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ulpybonhetptxjocylrt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cuhOWwp-SQ8QhG-vnpvwSA_DxIQSTIY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export type Player = {
  id: string;
  username: string;
  created_at: string;
  best_score: number;
  best_wave: number;
  total_kills: number;
  games_played: number;
};

export type ScoreRow = {
  id: string;
  player_id: string;
  username: string;
  score: number;
  wave: number;
  kills: number;
  created_at: string;
};
