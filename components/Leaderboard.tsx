import { useLeaderboard } from "../hooks/useLeaderboard";

export default function Leaderboard() {
  const { entries, loading, refresh } = useLeaderboard();
  return (
    <div className="mt-4 w-full max-w-xs mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-widest text-white/60">Leaderboard</h3>
        <button onClick={refresh} className="text-[10px] text-lime-400 hover:text-lime-300 cursor-pointer">Refresh</button>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-4 text-center text-white/40 text-xs">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-xs">No scores yet</div>
        ) : (
          <div className="max-h-48 overflow-y-auto">
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
  );
}
