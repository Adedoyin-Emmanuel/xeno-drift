// Xeno Drift — sound utilities (background music + UI click sounds)

let sharedCtx: AudioContext | null = null;
let musicEl: HTMLAudioElement | null = null;
let musicBaseVolume = 0.3;

function getCtx(): AudioContext | null {
  if (!sharedCtx) {
    try {
      const AC = (
        window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
      ).AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) sharedCtx = new AC();
    } catch {
      /* no audio context available */
    }
  }
  return sharedCtx;
}

/** Create (if needed) and return the background-music <audio> element. */
export function initMusic(): HTMLAudioElement {
  if (!musicEl) {
    musicEl = new Audio(new URL("../public/Daemon.mp3", import.meta.url).href);
    musicEl.loop = true;
    musicEl.volume = musicBaseVolume;
    musicEl.preload = "auto";
  }
  return musicEl;
}

/** Set music volume (0–1). Ducked during gameplay. */
export function setMusicVolume(v: number) {
  musicBaseVolume = Math.max(0, Math.min(1, v));
  if (musicEl) musicEl.volume = musicBaseVolume;
}

/** Duck music for gameplay — call with true when playing, false when in menus. */
export function duckMusic(active: boolean) {
  if (!musicEl) return;
  musicEl.volume = active ? musicBaseVolume * 0.35 : musicBaseVolume;
}

/** Play the background music from wherever it is (no-op if already playing). */
export function playMusic() {
  const el = initMusic();
  el.play().catch(() => {});
}

/** Restart the track from 0. */
export function restartMusic() {
  const el = initMusic();
  el.currentTime = 0;
  el.play().catch(() => {});
}

export function pauseMusic() {
  if (musicEl && !musicEl.paused) musicEl.pause();
}

export function resumeMusic() {
  if (musicEl && musicEl.paused) playMusic();
}

/** Short, satisfying click for primary buttons. */
export function playClick() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.05);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.06);
  } catch {
    /* ignore */
  }
}

/** Softer click for secondary / back buttons. */
export function playClickSmall() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.04);
    g.gain.setValueAtTime(0.04, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.05);
  } catch {
    /* ignore */
  }
}