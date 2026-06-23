// Xeno Drift — canvas game engine. Self-contained, no React inside.
// Emits state to React via a callback so the HUD can re-render.
//
// Supports three modes:
//  - solo:  one local player, standard rules.
//  - host:  two players in the same arena; player 1 is local, player 2 is
//           driven by remote inputs fed via setRemoteInput(). The engine
//           periodically calls onSnapshot() with a full state dump for the
//           host to broadcast to the guest.
//  - guest: rendering-only client. The local engine does NOT simulate; it
//           applies snapshots received from the host via applySnapshot().
//           The guest still produces local inputs (keys/mouse) which are
//           sampled via consumeLocalInput() and sent to the host.

import type { CoopSnapshot } from "../lib/realtime";

export type GameState = "menu" | "playing" | "paused" | "over";
export type EngineMode = "solo" | "host" | "guest";

export type PublicState = {
  state: GameState;
  score: number;
  wave: number;
  kills: number;
  hp: number;
  maxHp: number;
  dashCd: number;
  dashMax: number;
  combo: number;
  buffs: { shield: number; rapid: number; spread: number };
  boss: { hp: number; maxHp: number } | null;
  muted: boolean;
  // Co-op extras (undefined in solo)
  partner?: {
    username: string;
    hp: number;
    maxHp: number;
    alive: boolean;
  };
  selfAlive?: boolean;
  mode?: EngineMode;
};

type EngineCallbacks = {
  onState: (s: PublicState) => void;
  onGameOver: (result: { score: number; wave: number; kills: number }) => void;
  onSnapshot?: (s: CoopSnapshot) => void;
};

type Bullet = { x: number; y: number; vx: number; vy: number; r: number; life: number };
type Alien = {
  x: number; y: number; vx: number; vy: number; r: number;
  hp: number; maxhp: number; maxspeed: number; range: number;
  strafe: 1 | -1; fireCd: number; interval: number;
  gunner: boolean; rot: number; blink: number;
  // which player this alien is targeting (for co-op aggro spread)
  target: 0 | 1;
};
type Boss = {
  x: number; y: number; vx: number; vy: number; r: number;
  hp: number; maxhp: number; fireCd: number; ringCd: number; blink: number; rot: number;
};
type Organism = { x: number; y: number; vx: number; vy: number; r: number; phase: number; hue: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; hue: number };
type Popup = { x: number; y: number; text: string; life: number; big?: boolean; hue: number };
type PowerType = "heal" | "shield" | "rapid" | "spread";
type Powerup = { x: number; y: number; type: PowerType; vx: number; vy: number; life: number; phase: number };

type PlayerEntity = {
  x: number; y: number; vx: number; vy: number; r: number;
  speed: number; hp: number; maxhp: number; aim: number;
  shootCd: number; fireRate: number;
  dashCd: number; dashMax: number; dashTime: number;
  invuln: number; hurtCd: number; wob: number;
  buffs: { spread: number; rapid: number; shield: number };
  alive: boolean;
  // Skin tint hue for visual distinction (player 0 = lime 90, player 1 = cyan 190)
  hue: number;
  // Cached input vector for this player (set by input pipeline)
  inputMx: number;
  inputMy: number;
  // Per-frame dash request flag
  dashRequested: boolean;
};

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

const POW: Record<PowerType, { col: string; hue: number; glyph: string }> = {
  heal:   { col: "#a3e635", hue: 90,  glyph: "+" },
  shield: { col: "#22d3ee", hue: 190, glyph: "S" },
  rapid:  { col: "#fbbf24", hue: 45,  glyph: "R" },
  spread: { col: "#fb7185", hue: 345, glyph: "3" },
};
const POW_TYPES: PowerType[] = ["heal", "shield", "rapid", "spread"];

function makePlayer(hue: number): PlayerEntity {
  return {
    x: 0, y: 0, vx: 0, vy: 0, r: 18,
    speed: 300, hp: 100, maxhp: 100, aim: 0,
    shootCd: 0, fireRate: 0.13,
    dashCd: 0, dashMax: 1.4, dashTime: 0,
    invuln: 0, hurtCd: 0, wob: 0,
    buffs: { spread: 0, rapid: 0, shield: 0 },
    alive: true,
    hue,
    inputMx: 0, inputMy: 0,
    dashRequested: false,
  };
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;

  private W = 0;
  private H = 0;
  private DPR = 1;

  private state: GameState = "menu";
  private muted = false;

  private rafId = 0;
  private last = 0;
  private disposed = false;

  private actx: AudioContext | null = null;

  // Mode / co-op
  private mode: EngineMode = "solo";
  private partnerName = "";
  private snapshotCd = 0;
  private snapshotInterval = 1 / 18; // ~18Hz
  private tick = 0;
  // Most-recent snapshot for guest rendering
  private snap: CoopSnapshot | null = null;
  // Guest dash latch (set by keydown handler, consumed in consumeLocalInput)
  private guestDashLatched = false;

  // Starfield
  private layers: { arr: { x: number; y: number; r: number; tw: number }[]; sp: number; a: number }[] = [];
  private nebulae = [
    { x: 0.25, y: 0.3, c: "rgba(124,58,237,0.12)" },
    { x: 0.8, y: 0.7, c: "rgba(244,63,94,0.07)" },
    { x: 0.6, y: 0.15, c: "rgba(34,211,238,0.06)" },
  ];

  // Players (1 in solo, 2 in co-op). Index 0 is local in solo/host; index 1 is remote in host.
  private players: PlayerEntity[] = [makePlayer(90)];

  private keys: Record<string, boolean> = {};
  private mouse = { x: 0, y: 0, down: false };
  private isTouch = false;

  private bullets: Bullet[] = [];
  private ebullets: Bullet[] = [];
  private aliens: Alien[] = [];
  private organisms: Organism[] = [];
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private powerups: Powerup[] = [];
  private boss: Boss | null = null;

  private score = 0;
  private wave = 1;
  private kills = 0;
  private combo = 1;
  private comboTimer = 0;
  private killStreak = 0;

  private shake = 0;
  private waveDelay = 0;
  private spawnQueue = 0;
  private flash = 0;

  // Bound handlers
  private boundKeydown = (e: KeyboardEvent) => this.onKeydown(e);
  private boundKeyup = (e: KeyboardEvent) => this.onKeyup(e);
  private boundPointerdown = (e: PointerEvent) => this.onPointerdown(e);
  private boundPointermove = (e: PointerEvent) => this.onPointermove(e);
  private boundPointerup = () => { this.mouse.down = false; };
  private boundResize = () => this.resize();

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    this.ctx = ctx;
    this.cb = callbacks;

    this.resize();
    this.buildStars();

    window.addEventListener("resize", this.boundResize);
    window.addEventListener("keydown", this.boundKeydown);
    window.addEventListener("keyup", this.boundKeyup);
    canvas.addEventListener("pointerdown", this.boundPointerdown);
    window.addEventListener("pointermove", this.boundPointermove);
    window.addEventListener("pointerup", this.boundPointerup);

    this.players[0].x = this.W / 2;
    this.players[0].y = this.H / 2;

    this.last = performance.now();
    this.loop(this.last);
    this.emit();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.boundResize);
    window.removeEventListener("keydown", this.boundKeydown);
    window.removeEventListener("keyup", this.boundKeyup);
    this.canvas.removeEventListener("pointerdown", this.boundPointerdown);
    window.removeEventListener("pointermove", this.boundPointermove);
    window.removeEventListener("pointerup", this.boundPointerup);
  }

  // ---------- Public API ----------
  start() {
    this.ensureAudio();
    if (this.actx && this.actx.state === "suspended") this.actx.resume();
    this.reset();
    this.state = "playing";
    this.emit();
  }
  pause() {
    if (this.state !== "playing") return;
    if (this.mode !== "solo") return; // no pause in co-op
    this.state = "paused";
    this.emit();
  }
  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.emit();
  }
  togglePause() {
    if (this.state === "playing") this.pause();
    else if (this.state === "paused") this.resume();
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.emit();
  }
  isMuted() { return this.muted; }
  getState() { return this.state; }

  // ---------- Co-op API ----------
  setMode(mode: EngineMode, partnerName: string) {
    this.mode = mode;
    this.partnerName = partnerName;
    if (mode === "host" || mode === "guest") {
      // ensure 2 players exist
      if (this.players.length < 2) {
        this.players.push(makePlayer(190)); // cyan partner
      }
    } else {
      this.players = [this.players[0]];
    }
    this.emit();
  }
  getMode() { return this.mode; }

  /** Host: feed guest's input. */
  setRemoteInput(mvx: number, mvy: number, dash: boolean) {
    if (this.mode !== "host" || this.players.length < 2) return;
    const p = this.players[1];
    p.inputMx = mvx;
    p.inputMy = mvy;
    if (dash) p.dashRequested = true;
  }

  /** Guest: sample local input (movement vector + dash latch) to ship to host. */
  consumeLocalInput(): { mvx: number; mvy: number; dash: boolean } {
    let dx = 0, dy = 0;
    if (this.keys["a"] || this.keys["arrowleft"]) dx--;
    if (this.keys["d"] || this.keys["arrowright"]) dx++;
    if (this.keys["w"] || this.keys["arrowup"]) dy--;
    if (this.keys["s"] || this.keys["arrowdown"]) dy++;
    if (this.isTouch && this.mouse.down) {
      const cx = this.W / 2, cy = this.H / 2;
      if (dist(cx, cy, this.mouse.x, this.mouse.y) > 10) {
        const a = Math.atan2(this.mouse.y - cy, this.mouse.x - cx);
        dx = Math.cos(a); dy = Math.sin(a);
      }
    }
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    const dash = this.guestDashLatched;
    this.guestDashLatched = false;
    return { mvx: dx, mvy: dy, dash };
  }

  /** Guest: apply incoming snapshot from host. */
  applySnapshot(s: CoopSnapshot) {
    this.snap = s;
    this.state = s.state;
    this.score = s.score;
    this.wave = s.wave;
    this.kills = s.kills;
    this.combo = s.combo;
    this.muted = s.muted;
    this.emitFromSnapshot();
  }

  // ---------- Internals ----------
  private resize() {
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * this.DPR);
    this.canvas.height = Math.floor(this.H * this.DPR);
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    this.buildStars();
  }

  private buildStars() {
    this.layers = [];
    const cfg = [
      { n: 80, sp: 5, a: 0.35, r: [0.4, 0.9] },
      { n: 50, sp: 12, a: 0.55, r: [0.6, 1.2] },
      { n: 24, sp: 24, a: 0.85, r: [1, 1.8] },
    ];
    for (const c of cfg) {
      const arr: { x: number; y: number; r: number; tw: number }[] = [];
      for (let i = 0; i < c.n; i++) {
        arr.push({ x: Math.random() * this.W, y: Math.random() * this.H, r: rand(c.r[0], c.r[1]), tw: Math.random() * TAU });
      }
      this.layers.push({ arr, sp: c.sp, a: c.a });
    }
  }

  private ensureAudio() {
    if (this.actx) return;
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) this.actx = new AC();
    } catch { /* ignore */ }
  }

  private tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.05, slide = 0) {
    if (this.muted || !this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator();
    const g = this.actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.actx.destination);
    o.start(t); o.stop(t + dur);
  }

  private noise(dur = 0.25, vol = 0.16, cut = 1400) {
    if (this.muted || !this.actx) return;
    const t = this.actx.currentTime;
    const n = Math.floor(this.actx.sampleRate * dur);
    const buf = this.actx.createBuffer(1, n, this.actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.actx.createBufferSource(); s.buffer = buf;
    const g = this.actx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = this.actx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cut;
    s.connect(f); f.connect(g); g.connect(this.actx.destination);
    s.start(t);
  }

  private emit() {
    const me = this.players[0];
    const partner = this.players[1];
    this.cb.onState({
      state: this.state,
      score: this.score,
      wave: this.wave,
      kills: this.kills,
      hp: me.hp,
      maxHp: me.maxhp,
      dashCd: me.dashCd,
      dashMax: me.dashMax,
      combo: this.combo,
      buffs: { ...me.buffs },
      boss: this.boss ? { hp: this.boss.hp, maxHp: this.boss.maxhp } : null,
      muted: this.muted,
      mode: this.mode,
      selfAlive: me.alive,
      partner: partner
        ? {
            username: this.partnerName,
            hp: partner.hp,
            maxHp: partner.maxhp,
            alive: partner.alive,
          }
        : undefined,
    });
  }

  /** Guest variant of emit: derive PublicState from the latest snapshot. */
  private emitFromSnapshot() {
    const s = this.snap;
    if (!s) {
      this.emit();
      return;
    }
    // In guest mode, "self" is the guest = snap.guest.
    this.cb.onState({
      state: s.state,
      score: s.score,
      wave: s.wave,
      kills: s.kills,
      hp: s.guest.hp,
      maxHp: s.guest.maxHp,
      dashCd: s.guest.dashCd,
      dashMax: s.guest.dashMax,
      combo: s.combo,
      buffs: { ...s.guest.buffs },
      boss: s.boss,
      muted: s.muted,
      mode: "guest",
      selfAlive: s.guest.alive,
      partner: {
        username: this.partnerName, // host name
        hp: s.host.hp,
        maxHp: s.host.maxHp,
        alive: s.host.alive,
      },
    });
  }

  // ---------- Input ----------
  private onKeydown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    this.keys[k] = true;
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    if (this.state === "playing") {
      if (k === "shift" || k === " ") {
        if (this.mode === "guest") this.guestDashLatched = true;
        else this.dash(this.players[0]);
      }
      if ((k === "p" || k === "escape") && this.mode === "solo") this.pause();
    } else if (this.state === "paused" && (k === "p" || k === "escape")) {
      this.resume();
    }
  }
  private onKeyup(e: KeyboardEvent) { this.keys[e.key.toLowerCase()] = false; }
  private onPointerdown(e: PointerEvent) {
    if (e.pointerType === "touch") this.isTouch = true;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.down = true;
  }
  private onPointermove(e: PointerEvent) {
    if (e.pointerType === "touch") this.isTouch = true;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
  }

  // ---------- Game flow ----------
  private reset() {
    const offsets = this.mode === "solo" ? [{ x: 0, y: 0 }] : [{ x: -80, y: 0 }, { x: 80, y: 0 }];
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const o = offsets[i] ?? { x: 0, y: 0 };
      p.x = this.W / 2 + o.x;
      p.y = this.H / 2 + o.y;
      p.vx = p.vy = 0;
      p.hp = p.maxhp;
      p.shootCd = 0;
      p.dashCd = 0;
      p.dashTime = 0;
      p.invuln = 0;
      p.hurtCd = 0;
      p.buffs = { spread: 0, rapid: 0, shield: 0 };
      p.alive = true;
      p.inputMx = 0;
      p.inputMy = 0;
      p.dashRequested = false;
    }
    this.bullets = []; this.ebullets = []; this.aliens = [];
    this.organisms = []; this.particles = []; this.popups = []; this.powerups = [];
    this.boss = null;
    this.score = 0; this.wave = 1; this.kills = 0;
    this.combo = 1; this.comboTimer = 0; this.killStreak = 0;
    this.shake = 0; this.flash = 0;
    this.snapshotCd = 0;
    this.tick = 0;
    for (let i = 0; i < 4; i++) this.spawnOrganism();
    this.startWave(1);
  }

  private edgePoint() {
    const m = 60, side = Math.floor(rand(0, 4));
    if (side === 0) return { x: rand(0, this.W), y: -m };
    if (side === 1) return { x: this.W + m, y: rand(0, this.H) };
    if (side === 2) return { x: rand(0, this.W), y: this.H + m };
    return { x: -m, y: rand(0, this.H) };
  }

  private isCoop() { return this.mode === "host"; }
  private coopMultiplier() { return this.isCoop() ? 2 : 1; }

  private startWave(n: number) {
    this.wave = n; this.waveDelay = 0;
    // Co-op: respawn any dead players at the start of each wave
    if (this.isCoop()) {
      for (const p of this.players) {
        if (!p.alive) {
          p.alive = true;
          p.hp = p.maxhp;
          p.invuln = 2.0;
          p.x = this.W / 2 + rand(-80, 80);
          p.y = this.H / 2 + rand(-40, 40);
          this.burst(p.x, p.y, p.hue, 28, 4, 280);
          this.popups.push({ x: p.x, y: p.y - 40, text: "RESPAWN", life: 1.2, hue: p.hue });
        }
      }
    }
    if (n % 5 === 0) {
      this.spawnBoss();
      this.spawnQueue = 2 * this.coopMultiplier();
      this.popups.push({ x: this.W / 2, y: this.H * 0.30, text: "⬢ MOTHERSHIP", life: 2, big: true, hue: 345 });
    } else {
      this.spawnQueue = (2 + n) * this.coopMultiplier();
      this.popups.push({ x: this.W / 2, y: this.H * 0.32, text: "WAVE " + n, life: 1.6, big: true, hue: 265 });
    }
    this.emit();
  }

  private spawnAlien() {
    const p = this.edgePoint();
    const gunner = Math.random() < clamp(0.25 + this.wave * 0.04, 0, 0.6);
    // Pick target: prefer alive players, distribute aggro roughly evenly
    const alivePlayers = this.players.filter((pl) => pl.alive);
    const targetIdx = alivePlayers.length > 0
      ? this.players.indexOf(alivePlayers[Math.floor(Math.random() * alivePlayers.length)])
      : 0;
    this.aliens.push({
      x: p.x, y: p.y, vx: 0, vy: 0,
      r: gunner ? 20 : 16,
      hp: gunner ? 4 : 2, maxhp: gunner ? 4 : 2,
      maxspeed: (gunner ? 120 : 175) + this.wave * 4,
      range: gunner ? 270 : 200,
      strafe: Math.random() < 0.5 ? 1 : -1,
      fireCd: rand(0.6, 1.6),
      interval: gunner ? 1.0 : 1.7,
      gunner, rot: 0, blink: Math.random() * TAU,
      target: (targetIdx === 1 ? 1 : 0),
    });
  }

  private spawnOrganism() {
    const p = this.edgePoint();
    this.organisms.push({
      x: p.x, y: p.y,
      vx: rand(-55, 55), vy: rand(-55, 55),
      r: rand(22, 36), phase: Math.random() * TAU, hue: rand(170, 200),
    });
  }

  private spawnBoss() {
    const p = this.edgePoint();
    const hp = (42 + this.wave * 9) * this.coopMultiplier();
    this.boss = { x: p.x, y: p.y, vx: 0, vy: 0, r: 54, hp, maxhp: hp, fireCd: 2, ringCd: 3.5, blink: 0, rot: 0 };
  }

  private dropPowerup(x: number, y: number, forceType?: PowerType) {
    const type = forceType ?? POW_TYPES[Math.floor(rand(0, POW_TYPES.length))];
    this.powerups.push({ x, y, type, vx: rand(-30, 30), vy: rand(-30, 30), life: 13, phase: Math.random() * TAU });
  }

  private burst(x: number, y: number, hue: number, count: number, spread: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = rand(speed * 0.3, speed);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.4, 0.9), max: 0.9, r: rand(1, spread), hue: hue + rand(-16, 16),
      });
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  private fire(p: PlayerEntity) {
    if (p.shootCd > 0) return;
    const rapid = p.buffs.rapid > 0;
    p.shootCd = rapid ? 0.07 : p.fireRate;
    const sp = 720;
    const angs = p.buffs.spread > 0 ? [-0.2, 0, 0.2] : [0];
    for (const off of angs) {
      const a = p.aim + off;
      const sx = Math.cos(a), sy = Math.sin(a);
      this.bullets.push({
        x: p.x + sx * p.r,
        y: p.y + sy * p.r,
        vx: sx * sp, vy: sy * sp, r: 5, life: 1.2,
      });
    }
    this.tone(660, 0.07, "square", 0.03, -220);
  }

  private dash(p: PlayerEntity) {
    if (!p.alive) return;
    if (p.dashCd > 0 || p.dashTime > 0) return;
    let dx = p.inputMx, dy = p.inputMy;
    if (!dx && !dy) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    p.vx = dx * 1100; p.vy = dy * 1100;
    p.dashTime = 0.16; p.invuln = 0.34; p.dashCd = p.dashMax;
    this.burst(p.x, p.y, p.hue, 16, 3, 260);
    this.tone(180, 0.18, "sawtooth", 0.05, 260);
  }

  private hurt(p: PlayerEntity, dmg: number, kx = 0, ky = 0) {
    if (!p.alive) return;
    if (p.invuln > 0) return;
    if (p.buffs.shield > 0) {
      p.buffs.shield = Math.max(0, p.buffs.shield - 0.6);
      p.invuln = 0.25;
      this.burst(p.x, p.y, 190, 14, 3, 200);
      this.tone(420, 0.12, "sine", 0.05, 120);
      return;
    }
    p.hp -= dmg;
    p.invuln = 0.7; p.hurtCd = 0.5;
    this.shake = 14; this.flash = 0.5;
    p.vx += kx; p.vy += ky;
    // Shared score combo break
    this.combo = 1; this.killStreak = 0; this.comboTimer = 0;
    this.burst(p.x, p.y, p.hue, 18, 3, 220);
    this.noise(0.3, 0.18);
    if (p.hp <= 0) {
      p.hp = 0;
      this.onPlayerDown(p);
    }
    this.emit();
  }

  private onPlayerDown(p: PlayerEntity) {
    p.alive = false;
    this.burst(p.x, p.y, p.hue, 50, 5, 360);
    this.noise(0.5, 0.22, 900);
    if (this.mode === "solo") {
      this.gameOver();
      return;
    }
    // Co-op: continue if any player is alive
    this.popups.push({ x: p.x, y: p.y, text: "DOWNED", life: 1.8, big: true, hue: 345 });
    const anyAlive = this.players.some((q) => q.alive);
    if (!anyAlive) this.gameOver();
  }

  private killAlien(a: Alien, i: number) {
    this.aliens.splice(i, 1);
    this.kills++;
    this.burst(a.x, a.y, 265, a.gunner ? 30 : 20, a.gunner ? 4 : 3, a.gunner ? 300 : 230);
    this.noise(a.gunner ? 0.28 : 0.16, 0.13);
    this.tone(a.gunner ? 150 : 260, 0.2, "sawtooth", 0.05, -120);
    this.killStreak++;
    if (this.killStreak % 4 === 0) this.combo = Math.min(this.combo + 1, 6);
    this.comboTimer = 2.4;
    const g = (a.gunner ? 90 : 50) * this.combo;
    this.score += g;
    this.popups.push({ x: a.x, y: a.y, text: "+" + g, life: 0.85, hue: this.combo > 1 ? 345 : 265 });
    if (Math.random() < 0.14) this.dropPowerup(a.x, a.y);
    this.emit();
  }

  private killBoss() {
    if (!this.boss) return;
    const b = this.boss;
    this.burst(b.x, b.y, 345, 70, 6, 360);
    this.burst(b.x, b.y, 265, 50, 5, 280);
    this.noise(0.6, 0.24, 900);
    this.tone(90, 0.5, "sawtooth", 0.06, -40);
    this.shake = 22;
    const g = 600 + this.wave * 120;
    this.score += g;
    this.popups.push({ x: b.x, y: b.y, text: "+" + g, life: 1.4, big: true, hue: 345 });
    this.dropPowerup(b.x - 40, b.y, "heal");
    this.dropPowerup(b.x + 40, b.y, "shield");
    this.dropPowerup(b.x, b.y - 40);
    this.boss = null;
    this.emit();
  }

  /** Pick the nearest enemy to a player. */
  private nearestTargetFor(p: PlayerEntity): { x: number; y: number } | null {
    let tx: number | null = null, ty: number | null = null, bd = 1e9;
    for (const a of this.aliens) {
      const d = dist(a.x, a.y, p.x, p.y);
      if (d < bd) { bd = d; tx = a.x; ty = a.y; }
    }
    if (this.boss) {
      const d = dist(this.boss.x, this.boss.y, p.x, p.y);
      if (d < bd) { bd = d; tx = this.boss.x; ty = this.boss.y; }
    }
    return tx !== null && ty !== null ? { x: tx, y: ty } : null;
  }

  private applyPowerup(p: PlayerEntity, type: PowerType) {
    const c = POW[type];
    if (type === "heal") p.hp = Math.min(p.maxhp, p.hp + 30);
    else if (type === "shield") p.buffs.shield = 6;
    else if (type === "rapid") p.buffs.rapid = 9;
    else if (type === "spread") p.buffs.spread = 9;
    this.burst(p.x, p.y, c.hue, 18, 3, 200);
    this.tone(720, 0.14, "sine", 0.06, 260);
    this.popups.push({ x: p.x, y: p.y - 26, text: type.toUpperCase(), life: 1, hue: c.hue });
    this.emit();
  }

  private gameOver() {
    this.state = "over";
    this.cb.onGameOver({ score: this.score, wave: this.wave, kills: this.kills });
    // Host: ensure guest sees the final state
    if (this.mode === "host" && this.cb.onSnapshot) {
      this.cb.onSnapshot(this.buildSnapshot());
    }
    this.emit();
  }

  /** Read keyboard/touch into player 0's input fields (host-local or solo). */
  private sampleLocalInputIntoPlayer0() {
    const p = this.players[0];
    let dx = 0, dy = 0;
    if (this.keys["a"] || this.keys["arrowleft"]) dx--;
    if (this.keys["d"] || this.keys["arrowright"]) dx++;
    if (this.keys["w"] || this.keys["arrowup"]) dy--;
    if (this.keys["s"] || this.keys["arrowdown"]) dy++;
    if (this.isTouch && this.mouse.down) {
      if (dist(p.x, p.y, this.mouse.x, this.mouse.y) > 10) {
        const a = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);
        dx = Math.cos(a); dy = Math.sin(a);
      }
    }
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    p.inputMx = dx;
    p.inputMy = dy;
  }

  // ---------- Update ----------
  private update(dt: number) {
    // Movement / aiming / firing for every alive player
    this.sampleLocalInputIntoPlayer0();
    for (let pi = 0; pi < this.players.length; pi++) {
      const p = this.players[pi];
      if (!p.alive) {
        p.vx *= 0.9; p.vy *= 0.9;
        continue;
      }
      const dx = p.inputMx, dy = p.inputMy;

      if (p.dashRequested) {
        this.dash(p);
        p.dashRequested = false;
      }

      if (p.dashTime > 0) {
        p.dashTime -= dt;
      } else {
        const l = Math.hypot(dx, dy);
        const tvx = l ? dx / l * p.speed : 0;
        const tvy = l ? dy / l * p.speed : 0;
        p.vx += (tvx - p.vx) * Math.min(1, dt * 14);
        p.vy += (tvy - p.vy) * Math.min(1, dt * 14);
      }
      p.vx *= 0.92; p.vy *= 0.92;
      p.x = clamp(p.x + p.vx * dt, p.r, this.W - p.r);
      p.y = clamp(p.y + p.vy * dt, p.r, this.H - p.r);
      p.wob += dt * 6;

      // Auto aim + fire
      const tgt = this.nearestTargetFor(p);
      if (tgt) p.aim = Math.atan2(tgt.y - p.y, tgt.x - p.x);
      p.shootCd -= dt;
      if (tgt) this.fire(p);

      if (p.buffs.spread > 0) p.buffs.spread = Math.max(0, p.buffs.spread - dt);
      if (p.buffs.rapid > 0) p.buffs.rapid = Math.max(0, p.buffs.rapid - dt);
      if (p.buffs.shield > 0) p.buffs.shield = Math.max(0, p.buffs.shield - dt);
      if (p.dashCd > 0) p.dashCd -= dt;
      if (p.invuln > 0) p.invuln -= dt;
      if (p.hurtCd > 0) p.hurtCd -= dt;
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 1; this.killStreak = 0; this.emit(); }
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 36);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2);

    // Wave management
    const spawnRateMul = this.isCoop() ? 2 : 1;
    if (this.spawnQueue > 0) {
      if (Math.random() < dt * 2.2 * spawnRateMul) { this.spawnAlien(); this.spawnQueue--; }
    } else if (this.aliens.length === 0 && !this.boss) {
      this.waveDelay += dt;
      if (this.waveDelay > 1.6) {
        for (const p of this.players) {
          if (p.alive) p.hp = Math.min(p.maxhp, p.hp + 22);
        }
        this.score += 200;
        this.popups.push({ x: this.W / 2, y: this.H * 0.4, text: "+200 SURVIVED", life: 1.3, hue: 90 });
        if (this.wave % 2 === 0) this.spawnOrganism();
        this.startWave(this.wave + 1);
      }
    }

    // Powerups
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pw = this.powerups[i];
      pw.x += pw.vx * dt; pw.y += pw.vy * dt;
      pw.vx *= 0.96; pw.vy *= 0.96;
      pw.phase += dt * 3; pw.life -= dt;
      pw.x = clamp(pw.x, 16, this.W - 16); pw.y = clamp(pw.y, 16, this.H - 16);
      if (pw.life <= 0) { this.powerups.splice(i, 1); continue; }
      let picked = false;
      for (const p of this.players) {
        if (!p.alive) continue;
        if (dist(pw.x, pw.y, p.x, p.y) < p.r + 16) {
          this.applyPowerup(p, pw.type);
          picked = true;
          break;
        }
      }
      if (picked) this.powerups.splice(i, 1);
    }

    // Player bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -30 || b.x > this.W + 30 || b.y < -30 || b.y > this.H + 30) {
        this.bullets.splice(i, 1); continue;
      }
      let hit = false;
      for (let j = this.aliens.length - 1; j >= 0; j--) {
        const a = this.aliens[j];
        if (dist(a.x, a.y, b.x, b.y) < a.r + b.r) {
          a.hp--; this.burst(b.x, b.y, 265, 5, 2, 140);
          if (a.hp <= 0) this.killAlien(a, j);
          hit = true; break;
        }
      }
      if (!hit && this.boss && dist(this.boss.x, this.boss.y, b.x, b.y) < this.boss.r + b.r) {
        this.boss.hp--;
        this.burst(b.x, b.y, 345, 5, 2, 140);
        if (this.boss.hp <= 0) this.killBoss();
        else this.emit();
        hit = true;
      }
      if (hit) this.bullets.splice(i, 1);
    }

    // Alien AI — each alien chases its assigned target player (fall back to any)
    for (let i = 0; i < this.aliens.length; i++) {
      const a = this.aliens[i];
      // Re-pick target if dead
      let target = this.players[a.target];
      if (!target || !target.alive) {
        const alivePlayer = this.players.find((p) => p.alive);
        if (!alivePlayer) break;
        target = alivePlayer;
        a.target = this.players.indexOf(alivePlayer) === 1 ? 1 : 0;
      }
      const d = dist(a.x, a.y, target.x, target.y) || 1;
      const tx = (target.x - a.x) / d;
      const ty = (target.y - a.y) / d;
      let mvx: number, mvy: number;
      if (d > a.range * 1.15) { mvx = tx; mvy = ty; }
      else if (d < a.range * 0.7) { mvx = -tx; mvy = -ty; }
      else { mvx = -ty * a.strafe; mvy = tx * a.strafe; }
      let sx = 0, sy = 0;
      for (let k = 0; k < this.aliens.length; k++) {
        if (k === i) continue;
        const o = this.aliens[k];
        const dd = dist(a.x, a.y, o.x, o.y);
        if (dd < a.r + o.r + 30 && dd > 0) { sx += (a.x - o.x) / dd; sy += (a.y - o.y) / dd; }
      }
      for (const o of this.organisms) {
        const dd = dist(a.x, a.y, o.x, o.y);
        if (dd < o.r + 50 && dd > 0) { sx += (a.x - o.x) / dd * 1.4; sy += (a.y - o.y) / dd * 1.4; }
      }
      mvx += sx * 0.8; mvy += sy * 0.8;
      const m = 70;
      if (a.x < m) mvx += 1; if (a.x > this.W - m) mvx -= 1;
      if (a.y < m) mvy += 1; if (a.y > this.H - m) mvy -= 1;
      const ml = Math.hypot(mvx, mvy) || 1;
      mvx /= ml; mvy /= ml;
      a.vx += (mvx * a.maxspeed - a.vx) * Math.min(1, dt * 3.5);
      a.vy += (mvy * a.maxspeed - a.vy) * Math.min(1, dt * 3.5);
      a.x += a.vx * dt; a.y += a.vy * dt;
      a.blink += dt * 4;
      a.rot += ((a.vx * 0.0008) - a.rot) * Math.min(1, dt * 5);
      a.fireCd -= dt;
      if (d < a.range * 1.5 && a.fireCd <= 0) {
        a.fireCd = a.interval * rand(0.8, 1.25);
        const bs = 320, lead = clamp(d / bs, 0, 1.1);
        const px = target.x + target.vx * lead;
        const py = target.y + target.vy * lead;
        const ang = Math.atan2(py - a.y, px - a.x) + rand(-0.08, 0.08);
        this.ebullets.push({ x: a.x, y: a.y, vx: Math.cos(ang) * bs, vy: Math.sin(ang) * bs, r: 6, life: 3.5 });
        this.tone(330, 0.12, "triangle", 0.025, 140);
      }
    }

    // Boss AI — targets the closest alive player
    if (this.boss) {
      const b = this.boss;
      const alivePlayers = this.players.filter((p) => p.alive);
      const target = alivePlayers.length
        ? alivePlayers.reduce((acc, p) => dist(b.x, b.y, p.x, p.y) < dist(b.x, b.y, acc.x, acc.y) ? p : acc)
        : this.players[0];
      const d = dist(b.x, b.y, target.x, target.y) || 1;
      const tx = (target.x - b.x) / d;
      const ty = (target.y - b.y) / d;
      let mvx: number, mvy: number;
      if (d > 360) { mvx = tx; mvy = ty; }
      else if (d < 300) { mvx = -tx; mvy = -ty; }
      else { mvx = -ty; mvy = tx; }
      const m = 100;
      if (b.x < m) mvx += 1; if (b.x > this.W - m) mvx -= 1;
      if (b.y < m) mvy += 1; if (b.y > this.H - m) mvy -= 1;
      const ml = Math.hypot(mvx, mvy) || 1;
      mvx /= ml; mvy /= ml;
      b.vx += (mvx * 78 - b.vx) * Math.min(1, dt * 2.2);
      b.vy += (mvy * 78 - b.vy) * Math.min(1, dt * 2.2);
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.blink += dt * 4; b.rot += dt * 0.5;
      b.fireCd -= dt;
      if (b.fireCd <= 0) {
        b.fireCd = 1.35;
        const bs = 300, lead = clamp(d / bs, 0, 1.2);
        const px = target.x + target.vx * lead;
        const py = target.y + target.vy * lead;
        const base = Math.atan2(py - b.y, px - b.x);
        for (const off of [-0.26, 0, 0.26]) {
          this.ebullets.push({ x: b.x, y: b.y, vx: Math.cos(base + off) * bs, vy: Math.sin(base + off) * bs, r: 7, life: 4 });
        }
        this.tone(220, 0.16, "triangle", 0.04, 120);
      }
      b.ringCd -= dt;
      if (b.ringCd <= 0) {
        b.ringCd = 3.6;
        const N = 18, bs = 210;
        for (let i = 0; i < N; i++) {
          const a = i / N * TAU + b.rot;
          this.ebullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * bs, vy: Math.sin(a) * bs, r: 6, life: 4 });
        }
        this.noise(0.3, 0.14, 900);
        this.shake = 8;
      }
      // Boss collision damage to any player it touches
      for (const p of this.players) {
        if (!p.alive) continue;
        const dd = dist(b.x, b.y, p.x, p.y) || 1;
        if (p.invuln <= 0 && dd < b.r + p.r) {
          const a = Math.atan2(p.y - b.y, p.x - b.x);
          this.hurt(p, 20, Math.cos(a) * 320, Math.sin(a) * 320);
        }
      }
    }

    // Enemy bullets
    for (let i = this.ebullets.length - 1; i >= 0; i--) {
      const b = this.ebullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (Math.random() < 0.4) {
        this.particles.push({
          x: b.x, y: b.y, vx: rand(-10, 10), vy: rand(-10, 10),
          life: 0.25, max: 0.25, r: rand(1, 2.4), hue: 300,
        });
      }
      if (b.life <= 0 || b.x < -30 || b.x > this.W + 30 || b.y < -30 || b.y > this.H + 30) {
        this.ebullets.splice(i, 1); continue;
      }
      let consumed = false;
      for (const p of this.players) {
        if (!p.alive) continue;
        if (p.invuln <= 0 && dist(b.x, b.y, p.x, p.y) < b.r + p.r) {
          const a = Math.atan2(b.vy, b.vx);
          this.hurt(p, 10, Math.cos(a) * 160, Math.sin(a) * 160);
          consumed = true;
          break;
        }
      }
      if (consumed) this.ebullets.splice(i, 1);
    }

    // Organisms
    for (const o of this.organisms) {
      o.x += o.vx * dt; o.y += o.vy * dt;
      o.phase += dt * 2;
      if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx); }
      if (o.x > this.W - o.r) { o.x = this.W - o.r; o.vx = -Math.abs(o.vx); }
      if (o.y < o.r) { o.y = o.r; o.vy = Math.abs(o.vy); }
      if (o.y > this.H - o.r) { o.y = this.H - o.r; o.vy = -Math.abs(o.vy); }
      for (const p of this.players) {
        if (!p.alive) continue;
        if (p.hurtCd <= 0 && dist(o.x, o.y, p.x, p.y) < o.r + p.r) {
          const a = Math.atan2(p.y - o.y, p.x - o.x);
          this.hurt(p, 14, Math.cos(a) * 240, Math.sin(a) * 240);
        }
      }
    }

    // Particles & popups
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.95; p.vy *= 0.95;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.y -= (p.big ? 14 : 30) * dt;
      p.life -= dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }

    this.tick++;

    // Host snapshotting
    if (this.mode === "host" && this.cb.onSnapshot) {
      this.snapshotCd -= dt;
      if (this.snapshotCd <= 0) {
        this.snapshotCd = this.snapshotInterval;
        this.cb.onSnapshot(this.buildSnapshot());
      }
    }
  }

  private buildSnapshot(): CoopSnapshot {
    const me = this.players[0];
    const partner = this.players[1] ?? me;
    const aliens: number[] = [];
    for (const a of this.aliens) {
      aliens.push(a.x, a.y, a.r, a.rot, a.gunner ? 1 : 0, a.hp / a.maxhp);
    }
    const bullets: number[] = [];
    for (const b of this.bullets) bullets.push(b.x, b.y, b.r);
    const ebullets: number[] = [];
    for (const b of this.ebullets) ebullets.push(b.x, b.y, b.r);
    const organisms: number[] = [];
    for (const o of this.organisms) organisms.push(o.x, o.y, o.r, o.hue, o.phase);
    const powerups: number[] = [];
    for (const p of this.powerups) {
      const t = POW_TYPES.indexOf(p.type);
      powerups.push(p.x, p.y, t);
    }
    return {
      state: this.state,
      score: this.score,
      wave: this.wave,
      kills: this.kills,
      combo: this.combo,
      muted: this.muted,
      boss: this.boss ? { hp: this.boss.hp, maxHp: this.boss.maxhp } : null,
      bossX: this.boss?.x ?? 0,
      bossY: this.boss?.y ?? 0,
      bossR: this.boss?.r ?? 0,
      host: {
        hp: me.hp, maxHp: me.maxhp,
        dashCd: me.dashCd, dashMax: me.dashMax,
        buffs: { ...me.buffs },
        x: me.x, y: me.y, aim: me.aim, alive: me.alive,
      },
      guest: {
        hp: partner.hp, maxHp: partner.maxhp,
        dashCd: partner.dashCd, dashMax: partner.dashMax,
        buffs: { ...partner.buffs },
        x: partner.x, y: partner.y, aim: partner.aim, alive: partner.alive,
      },
      aliens, bullets, ebullets, organisms, powerups,
      W: this.W, H: this.H, tick: this.tick,
    };
  }

  // ---------- Draw ----------
  private drawBackground(dt: number) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, "#140f2e"); g.addColorStop(1, "#0a0a1c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    for (const n of this.nebulae) {
      const rr = 0.6 * Math.max(this.W, this.H);
      const rg = ctx.createRadialGradient(n.x * this.W, n.y * this.H, 0, n.x * this.W, n.y * this.H, rr);
      rg.addColorStop(0, n.c); rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg; ctx.fillRect(0, 0, this.W, this.H);
    }
    for (const L of this.layers) {
      ctx.fillStyle = `rgba(220,220,255,${L.a})`;
      for (const s of L.arr) {
        s.y += L.sp * dt; s.tw += dt * 3;
        if (s.y > this.H + 2) { s.y = -2; s.x = Math.random() * this.W; }
        ctx.globalAlpha = L.a * (0.6 + 0.4 * Math.sin(s.tw));
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayer(p: PlayerEntity) {
    const ctx = this.ctx;
    if (!p.alive) return;
    if (p.invuln > 0 && p.hurtCd > 0 && Math.floor(performance.now() / 70) % 2 === 0) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.dashTime > 0) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = `hsla(${p.hue},85%,55%,0.4)`;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 8, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = `hsla(${p.hue},85%,55%,0.85)`; ctx.shadowBlur = 22;
    const grd = ctx.createRadialGradient(-4, -4, 2, 0, 0, p.r + 4);
    grd.addColorStop(0, `hsl(${p.hue},90%,90%)`);
    grd.addColorStop(0.5, `hsl(${p.hue},80%,60%)`);
    grd.addColorStop(1, `hsl(${p.hue},70%,30%)`);
    ctx.fillStyle = grd; ctx.beginPath();
    const pts = 14;
    for (let i = 0; i <= pts; i++) {
      const a = i / pts * TAU;
      const r = p.r + Math.sin(a * 3 + p.wob) * 2.4 + Math.sin(a * 5 - p.wob * 1.3) * 1.5;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = `hsl(${p.hue},70%,30%)`;
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU + p.wob * 0.3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (p.r + 1), Math.sin(a) * (p.r + 1), 3.5, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.52, 0, TAU); ctx.fill();
    const ex = Math.cos(p.aim) * p.r * 0.24;
    const ey = Math.sin(p.aim) * p.r * 0.24;
    ctx.fillStyle = "#1a1a2e"; ctx.beginPath(); ctx.arc(ex, ey, p.r * 0.26, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.arc(ex - 2, ey - 2, 2, 0, TAU); ctx.fill();
    if (p.buffs.shield > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.strokeStyle = `rgba(34,211,238,${0.5 + 0.4 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(34,211,238,0.8)"; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 9, 0, TAU); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  private drawAlien(a: Alien) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(a.x, a.y); ctx.rotate(a.rot);
    ctx.shadowColor = "rgba(124,58,237,0.9)"; ctx.shadowBlur = 22;
    const blink = 0.5 + 0.5 * Math.sin(a.blink);
    const bg = ctx.createLinearGradient(0, -a.r, 0, a.r);
    bg.addColorStop(0, "#c4b5fd"); bg.addColorStop(0.5, "#7c3aed"); bg.addColorStop(1, "#4c1d95");
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(0, 0, a.r * 1.5, a.r * 0.62, 0, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    const dg = ctx.createLinearGradient(0, -a.r, 0, 0);
    dg.addColorStop(0, "#f0abfc"); dg.addColorStop(1, "#a855f7");
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.ellipse(0, -a.r * 0.18, a.r * 0.7, a.r * 0.66, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.ellipse(-a.r * 0.18, -a.r * 0.38, a.r * 0.16, a.r * 0.22, 0, 0, TAU); ctx.fill();
    for (let i = -1; i <= 1; i++) {
      ctx.fillStyle = `rgba(244,63,94,${0.4 + 0.6 * blink})`;
      ctx.beginPath(); ctx.arc(i * a.r * 0.7, a.r * 0.5, 2.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  private drawBoss() {
    if (!this.boss) return;
    const b = this.boss;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(b.x, b.y);
    const blink = 0.5 + 0.5 * Math.sin(b.blink);
    ctx.save(); ctx.rotate(b.rot);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU;
      ctx.fillStyle = `rgba(244,63,94,${0.3 + 0.5 * (0.5 + 0.5 * Math.sin(b.blink + i))})`;
      ctx.shadowColor = "rgba(244,63,94,0.8)"; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(Math.cos(a) * b.r * 1.5, Math.sin(a) * b.r * 0.62, 4, 0, TAU); ctx.fill();
    }
    ctx.restore(); ctx.shadowBlur = 0;
    ctx.shadowColor = "rgba(124,58,237,0.9)"; ctx.shadowBlur = 30;
    const bg = ctx.createLinearGradient(0, -b.r, 0, b.r);
    bg.addColorStop(0, "#ddd6fe"); bg.addColorStop(0.5, "#7c3aed"); bg.addColorStop(1, "#3b0764");
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(0, 0, b.r * 1.6, b.r * 0.7, 0, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    const dg = ctx.createRadialGradient(0, -b.r * 0.3, 4, 0, -b.r * 0.2, b.r * 0.9);
    dg.addColorStop(0, "#fdf4ff"); dg.addColorStop(0.5, "#e879f9"); dg.addColorStop(1, "#a21caf");
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.ellipse(0, -b.r * 0.16, b.r * 0.85, b.r * 0.8, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = `rgba(244,63,94,${0.6 + 0.4 * blink})`;
    ctx.shadowColor = "rgba(244,63,94,0.9)"; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(0, -b.r * 0.2, b.r * 0.26, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private drawOrganism(o: Organism) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(o.x, o.y);
    const pulse = 1 + 0.12 * Math.sin(o.phase);
    ctx.shadowColor = `hsla(${o.hue},85%,60%,0.7)`; ctx.shadowBlur = 20;
    const bg = ctx.createRadialGradient(0, -o.r * 0.2, 2, 0, 0, o.r * pulse);
    bg.addColorStop(0, `hsla(${o.hue},90%,80%,0.55)`);
    bg.addColorStop(1, `hsla(${o.hue},85%,55%,0.12)`);
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(0, 0, o.r * pulse, o.r * 0.85 * pulse, 0, Math.PI, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, o.r * pulse, o.r * 0.5, 0, 0, Math.PI); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `hsla(${o.hue},90%,70%,0.55)`;
    ctx.lineWidth = 2; ctx.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const ox = (i - 2.5) * o.r * 0.28;
      ctx.beginPath(); ctx.moveTo(ox, o.r * 0.3);
      for (let s = 1; s <= 4; s++) {
        const yy = o.r * 0.3 + s * o.r * 0.32;
        const xx = ox + Math.sin(o.phase + s * 0.8 + i) * 5;
        ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPowerup(p: Powerup) {
    const ctx = this.ctx;
    const c = POW[p.type];
    const bob = Math.sin(p.phase) * 3;
    const fade = p.life < 2 ? (0.4 + 0.6 * Math.abs(Math.sin(p.life * 8))) : 1;
    ctx.save(); ctx.translate(p.x, p.y + bob);
    ctx.globalAlpha = fade;
    ctx.rotate(p.phase * 0.4);
    ctx.shadowColor = c.col; ctx.shadowBlur = 18;
    ctx.fillStyle = c.col;
    const s = 12;
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
    ctx.closePath(); ctx.fill();
    ctx.rotate(-p.phase * 0.4); ctx.shadowBlur = 0;
    ctx.fillStyle = "#0b0b1a";
    ctx.font = "700 14px 'Share Tech Mono',monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(c.glyph, 0, 1);
    ctx.restore();
    ctx.globalAlpha = 1; ctx.textBaseline = "alphabetic";
  }

  /** Solo & host renderer — draws all engine state directly. */
  private render(dt: number) {
    const ctx = this.ctx;
    this.drawBackground(dt);
    ctx.save();
    if (this.shake > 0) ctx.translate(rand(-this.shake, this.shake) * 0.4, rand(-this.shake, this.shake) * 0.4);
    for (const o of this.organisms) this.drawOrganism(o);
    for (const p of this.powerups) this.drawPowerup(p);
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = `hsl(${p.hue},90%,62%)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowColor = "rgba(244,63,94,0.9)"; ctx.shadowBlur = 12;
    for (const b of this.ebullets) {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, "#fff"); g.addColorStop(0.4, "#fb7185"); g.addColorStop(1, "#9f1239");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    }
    ctx.shadowColor = "rgba(163,230,53,0.9)";
    for (const b of this.bullets) {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, "#fff"); g.addColorStop(0.5, "#a3e635"); g.addColorStop(1, "rgba(101,163,13,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
    for (const a of this.aliens) this.drawAlien(a);
    if (this.boss) this.drawBoss();
    if (this.state === "playing" || this.state === "paused") {
      for (const p of this.players) this.drawPlayer(p);
    }
    ctx.textAlign = "center";
    for (const p of this.popups) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.font = p.big
        ? "28px 'Share Tech Mono',monospace"
        : "16px 'Share Tech Mono',monospace";
      ctx.fillStyle = `hsl(${p.hue},90%,70%)`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(244,63,94,${this.flash * 0.28})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  /** Guest renderer — draws from the latest snapshot. */
  private renderFromSnapshot(dt: number) {
    const s = this.snap;
    this.drawBackground(dt);
    if (!s) return;
    const ctx = this.ctx;
    // Map from host viewport to local viewport (scale to fit)
    const sx = this.W / Math.max(1, s.W);
    const sy = this.H / Math.max(1, s.H);
    const scale = Math.min(sx, sy);
    const offX = (this.W - s.W * scale) * 0.5;
    const offY = (this.H - s.H * scale) * 0.5;
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);

    // Organisms
    for (let i = 0; i < s.organisms.length; i += 5) {
      const ox = s.organisms[i], oy = s.organisms[i + 1], or = s.organisms[i + 2];
      const oh = s.organisms[i + 3], op = s.organisms[i + 4];
      this.drawOrganism({ x: ox, y: oy, vx: 0, vy: 0, r: or, phase: op, hue: oh });
    }
    // Powerups
    for (let i = 0; i < s.powerups.length; i += 3) {
      const px = s.powerups[i], py = s.powerups[i + 1], t = s.powerups[i + 2] | 0;
      const type = POW_TYPES[t] ?? "heal";
      this.drawPowerup({ x: px, y: py, type, vx: 0, vy: 0, life: 5, phase: performance.now() / 200 });
    }
    // Enemy bullets
    ctx.shadowColor = "rgba(244,63,94,0.9)"; ctx.shadowBlur = 12;
    for (let i = 0; i < s.ebullets.length; i += 3) {
      const bx = s.ebullets[i], by = s.ebullets[i + 1], br = s.ebullets[i + 2];
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, "#fff"); g.addColorStop(0.4, "#fb7185"); g.addColorStop(1, "#9f1239");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
    }
    // Player bullets
    ctx.shadowColor = "rgba(163,230,53,0.9)";
    for (let i = 0; i < s.bullets.length; i += 3) {
      const bx = s.bullets[i], by = s.bullets[i + 1], br = s.bullets[i + 2];
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, "#fff"); g.addColorStop(0.5, "#a3e635"); g.addColorStop(1, "rgba(101,163,13,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
    // Aliens
    for (let i = 0; i < s.aliens.length; i += 6) {
      const ax = s.aliens[i], ay = s.aliens[i + 1], ar = s.aliens[i + 2];
      const arot = s.aliens[i + 3], gunner = s.aliens[i + 4] === 1;
      this.drawAlien({
        x: ax, y: ay, vx: 0, vy: 0, r: ar,
        hp: 1, maxhp: 1, maxspeed: 0, range: 0,
        strafe: 1, fireCd: 0, interval: 0,
        gunner, rot: arot, blink: performance.now() / 250,
        target: 0,
      });
    }
    // Boss
    if (s.boss && s.bossR > 0) {
      // Re-fabricate a Boss for drawBoss
      const prev = this.boss;
      this.boss = {
        x: s.bossX, y: s.bossY, vx: 0, vy: 0, r: s.bossR,
        hp: s.boss.hp, maxhp: s.boss.maxHp,
        fireCd: 0, ringCd: 0, blink: performance.now() / 250, rot: performance.now() / 1000,
      };
      this.drawBoss();
      this.boss = prev;
    }
    // Players: host = lime (hue 90), guest = cyan (hue 190).
    // For the guest view, render BOTH; tag self & partner positions for clarity.
    if (s.state === "playing" || s.state === "paused") {
      const host = {
        ...makePlayer(90),
        x: s.host.x, y: s.host.y, aim: s.host.aim, alive: s.host.alive,
        buffs: { ...s.host.buffs }, hue: 90,
      };
      const guest = {
        ...makePlayer(190),
        x: s.guest.x, y: s.guest.y, aim: s.guest.aim, alive: s.guest.alive,
        buffs: { ...s.guest.buffs }, hue: 190,
      };
      this.drawPlayer(host);
      this.drawPlayer(guest);
    }
    ctx.restore();
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 0.05);
    if (this.mode === "guest") {
      // Guest: no simulation, just render snapshot. Local input is sampled
      // externally via consumeLocalInput().
      this.renderFromSnapshot(dt);
    } else {
      if (this.state === "playing") {
        this.update(dt);
        this.emit();
      }
      this.render(this.state === "playing" ? dt : dt * 0.25);
    }
    this.rafId = requestAnimationFrame(this.loop);
  };
}
