import { useState } from "react";
import { useLeaderboard } from "../hooks/useLeaderboard";
import { validateUsername, type StoredPlayer } from "../lib/player";
import type { Player } from "../lib/supabase";
import { playClick, playClickSmall } from "../lib/sounds";

export function SignInScreen({
  signIn,
  onSignedIn,
}: {
  signIn: (u: string) => Promise<unknown>;
  onSignedIn: () => void;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    const v = validateUsername(name);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true); setErr(null);
    try { await signIn(v.value); onSignedIn(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0b1a]/90 backdrop-blur">
      <div className="bg-[#0e1021]/90 border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4">
        <h2 className="text-2xl font-bold text-white text-center mb-2">Drift In</h2>
        <p className="text-sm text-white/50 text-center mb-6">Choose a callsign.</p>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Callsign (3–16)"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-violet-400"
        />
        {err && <p className="text-rose-400 text-xs mt-2">{err}</p>}
        <button
          onClick={() => { playClick(); submit(); }}
          disabled={busy}
          className="mt-4 w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2 rounded-lg transition cursor-pointer"
        >
          {busy ? "Entering…" : "Enter Arena"}
        </button>
      </div>
    </div>
  );
}

export function StartScreen({
  player,
  onStart,
  onMultiplayer,
  onSignOut,
}: {
  player: StoredPlayer & Partial<Player>;
  onStart: () => void;
  onMultiplayer: () => void;
  onSignOut: () => void;
}) {
  const { entries, loading, refresh } = useLeaderboard();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0a0b1a]/80 backdrop-blur-sm p-8 md:p-12">
      <div className="flex flex-col md:flex-row w-full max-w-5xl h-full md:h-auto items-center md:items-stretch gap-8">
        {/* Left: title + buttons */}
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="flex flex-col items-center">
            <h1 className="text-5xl md:text-6xl font-bold text-white tracking-tight text-center leading-tight">
              Xeno Drift
            </h1>
            <p className="text-white/50 text-sm mt-3 mb-8 text-center">Co-op arena shooter</p>
            <div className="flex flex-col gap-4 w-full max-w-xs">
              <button onClick={() => { playClick(); onStart(); }} className="w-full bg-lime-500 hover:bg-lime-400 text-[#0b0c1a] font-bold py-3.5 rounded-xl transition cursor-pointer text-lg tracking-wide">Practice</button>
              <button onClick={() => { playClick(); onMultiplayer(); }} className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-3.5 rounded-xl transition cursor-pointer text-lg tracking-wide">Play with a Friend</button>
              <button onClick={() => { playClickSmall(); onSignOut(); }} className="w-full bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-xl transition cursor-pointer">Sign Out</button>
            </div>
          </div>
        </div>

        {/* Right: leaderboard */}
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="w-full max-w-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs uppercase tracking-widest text-white/60">Leaderboard</h3>
              <button onClick={() => { playClickSmall(); refresh(); }} className="text-[10px] text-lime-400 hover:text-lime-300 cursor-pointer">Refresh</button>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              {loading ? (
                <div className="p-4 text-center text-white/40 text-xs">Loading...</div>
              ) : entries.length === 0 ? (
                <div className="p-4 text-center text-white/40 text-xs">No scores yet</div>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {entries.map((e, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm border-b border-white/5 last:border-0">
                      <span className="text-white/80 font-mono">{i + 1}. {e.username}</span>
                      <span className="text-lime-400 font-mono">{e.kills}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PauseScreen({ onResume, onMenu }: { onResume: () => void; onMenu: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0b1a]/70 backdrop-blur">
      <div className="text-center flex flex-col items-center gap-4">
        <h2 className="text-2xl font-bold text-white">Paused</h2>
        <button onClick={() => { playClick(); onResume(); }} className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-lg transition cursor-pointer w-48">Resume</button>
        <button onClick={() => { playClickSmall(); onMenu(); }} className="bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 px-6 py-2 rounded-lg transition cursor-pointer w-48 text-sm">Exit to Menu</button>
      </div>
    </div>
  );
}

export function GameOverScreen({
  result,
  partnerScore,
  onMenu,
}: {
  result: { score: number; wave: number; kills: number };
  partnerScore?: number;
  onMenu: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0b1a]/90 backdrop-blur">
      <div className="bg-[#0e1021]/90 border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4 text-center">
        <h2 className="text-3xl font-bold text-white mb-2">Match Over</h2>
        <p className="text-white/60 text-sm mb-1">
          Wave <span className="text-white font-mono">{result.wave}</span>
        </p>
        <p className="text-white/60 text-sm mb-4">
          You: <span className="text-white font-mono text-lg">{result.kills}</span>
          {partnerScore !== undefined && (
            <> · Partner: <span className="text-white font-mono text-lg">{partnerScore}</span></>
          )}
        </p>
        <button onClick={() => { playClick(); onMenu(); }} className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2 rounded-lg transition cursor-pointer">Back to Menu</button>
      </div>
    </div>
  );
}
