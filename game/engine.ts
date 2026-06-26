// Xeno Drift — Co-op canvas engine. Self-contained, no React inside.
import type { CoopSnapshot } from "../lib/realtime";

export type GameState = "menu" | "playing" | "over" | "paused";
export type EngineMode = "solo" | "host" | "guest";

export type PublicState = {
  state: GameState;
  score: number;
  partnerScore?: number;
  hp: number;
  maxHp: number;
  dashCd: number;
  dashMax: number;
  muted: boolean;
  mode?: EngineMode;
  wave: number;
  kills: number;
  partner?: {
    username: string;
    hp: number;
    maxHp: number;
    alive: boolean;
    score: number;
  };
  selfAlive?: boolean;
};

type EngineCallbacks = {
  onState: (s: PublicState) => void;
  onGameOver: (result: { score: number; wave: number; kills: number }) => void;
  onSnapshot?: (s: CoopSnapshot) => void;
  onDuckMusic?: (active: boolean) => void;
};

type Bullet = { x: number; y: number; vx: number; vy: number; r: number; life: number; owner: 0 | 1 | 2 };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; hue: number };
type Popup = { x: number; y: number; text: string; life: number; hue: number };
type Enemy = {
  x: number; y: number; vx: number; vy: number; r: number;
  hp: number; maxhp: number; hue: number;
  shootCd: number; fireRate: number; aim: number;
  alive: boolean; wob: number; kind: "grunt" | "elite" | "mothership";
};
type PlayerEntity = {
  x: number; y: number; vx: number; vy: number; r: number;
  speed: number; hp: number; maxhp: number; aim: number;
  shootCd: number; fireRate: number;
  dashCd: number; dashMax: number; dashTime: number;
  invuln: number; hurtCd: number; wob: number;
  alive: boolean; hue: number;
  inputMx: number; inputMy: number;
  dashRequested: boolean;
  deadTimer: number;
  score: number;
};

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

function makePlayer(hue: number): PlayerEntity {
  return {
    x: 0, y: 0, vx: 0, vy: 0, r: 18,
    speed: 320, hp: 120, maxhp: 120, aim: 0,
    shootCd: 0, fireRate: 0.14,
    dashCd: 0, dashMax: 1.4, dashTime: 0,
    invuln: 0, hurtCd: 0, wob: 0,
    alive: true, hue,
    inputMx: 0, inputMy: 0,
    dashRequested: false,
    deadTimer: 0,
    score: 0,
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

  private mode: EngineMode = "solo";
  private partnerName = "";
  private snapshotCd = 0;
  private snapshotInterval = 1 / 15;
  private tick = 0;
  private snap: CoopSnapshot | null = null;
  private guestDashLatched = false;

  private layers: { arr: { x: number; y: number; r: number; tw: number }[]; sp: number; a: number }[] = [];
  private nebulae = [
    { x: 0.25, y: 0.3, c: "rgba(124,58,237,0.12)" },
    { x: 0.8, y: 0.7, c: "rgba(244,63,94,0.07)" },
    { x: 0.6, y: 0.15, c: "rgba(34,211,238,0.06)" },
  ];

  private players: PlayerEntity[] = [makePlayer(120)];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private enemies: Enemy[] = [];

  // Wave system
  private wave = 0;
  private waveMessage = "";
  private waveMessageTimer = 0;
  private enemiesRemaining = 0;
  private mothershipAlive = false;
  private waveDelay = 0;

  private keys: Record<string, boolean> = {};
  private mouse = { x: 0, y: 0, down: false };
  private isTouch = false;

  private shake = 0;
  private flash = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    this.ctx = ctx;
    this.cb = callbacks;

    this.resize();
    this.buildStars();

    const boundResize = () => this.resize();
    const boundKeydown = (e: KeyboardEvent) => this.onKeydown(e);
    const boundKeyup = (e: KeyboardEvent) => this.onKeyup(e);
    const boundPointerdown = (e: PointerEvent) => this.onPointerdown(e);
    const boundPointermove = (e: PointerEvent) => this.onPointermove(e);
    const boundPointerup = () => { this.mouse.down = false; };

    window.addEventListener("resize", boundResize);
    window.addEventListener("keydown", boundKeydown);
    window.addEventListener("keyup", boundKeyup);
    canvas.addEventListener("pointerdown", boundPointerdown);
    window.addEventListener("pointermove", boundPointermove);
    window.addEventListener("pointerup", boundPointerup);

    this.players[0].x = this.W / 2;
    this.players[0].y = this.H / 2;

    this.last = performance.now();
    this.loop(this.last);
    this.emit();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
  }

  start() {
    this.ensureAudio();
    if (this.actx && this.actx.state === "suspended") this.actx.resume();
    this.reset();
    this.state = "playing";
    this.emit();
    this.cb.onDuckMusic?.(true);
  }

  goToMenu() {
    this.state = "menu";
    this.emit();
    this.cb.onDuckMusic?.(false);
  }

  pause() {
    if (this.state !== "playing") return;
    if (this.mode !== "solo") return;
    this.state = "paused";
    this.emit();
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.emit();
  }

  setMuted(m: boolean) { this.muted = m; this.emit(); }
  isMuted() { return this.muted; }
  getState() { return this.state; }

  setMode(mode: EngineMode, partnerName: string) {
    this.mode = mode;
    this.partnerName = partnerName;
    if (mode === "host" || mode === "guest") {
      if (this.players.length < 2) this.players.push(makePlayer(200));
    } else {
      this.players = [this.players[0]];
    }
    this.emit();
  }
  getMode() { return this.mode; }

  setRemoteInput(mvx: number, mvy: number, dash: boolean, aim: number) {
    if (this.mode !== "host" || this.players.length < 2) return;
    const p = this.players[1];
    p.inputMx = mvx;
    p.inputMy = mvy;
    p.aim = aim;
    if (dash) p.dashRequested = true;
  }

  consumeLocalInput(): { mvx: number; mvy: number; dash: boolean; aim: number; fire: boolean } {
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
    let aim = 0;
    if (this.snap) {
      const sx = this.W / Math.max(1, this.snap.W);
      const sy = this.H / Math.max(1, this.snap.H);
      const scale = Math.min(sx, sy);
      const offX = (this.W - this.snap.W * scale) * 0.5;
      const offY = (this.H - this.snap.H * scale) * 0.5;
      const gx = offX + this.snap.guest.x * scale;
      const gy = offY + this.snap.guest.y * scale;
      aim = Math.atan2(this.mouse.y - gy, this.mouse.x - gx);
    } else {
      aim = Math.atan2(this.mouse.y - this.H / 2, this.mouse.x - this.W / 2);
    }
    return { mvx: dx, mvy: dy, dash, aim, fire: true }; // always auto-fire
  }

  applySnapshot(s: CoopSnapshot) {
    this.snap = s;
    this.state = s.state;
    this.muted = s.muted;
    if (s.state === "playing") {
      this.cb.onDuckMusic?.(true);
    } else if (s.state === "over" || s.state === "menu") {
      this.cb.onDuckMusic?.(false);
    }
    this.emitFromSnapshot();
  }

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
      const AC = (window as unknown as any).AudioContext || (window as unknown as any).webkitAudioContext;
      if (AC) this.actx = new AC();
    } catch {}
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
    const opp = this.players[1];
    this.cb.onState({
      state: this.state,
      score: me.score,
      partnerScore: opp?.score,
      hp: me.hp, maxHp: me.maxhp,
      dashCd: me.dashCd, dashMax: me.dashMax,
      muted: this.muted,
      mode: this.mode,
      wave: this.wave,
      kills: me.score,
      selfAlive: me.alive,
      partner: opp
        ? { username: this.partnerName, hp: opp.hp, maxHp: opp.maxhp, alive: opp.alive, score: opp.score }
        : undefined,
    });
  }

  private emitFromSnapshot() {
    const s = this.snap;
    if (!s) { this.emit(); return; }
    const self = s.guest;
    const opp = s.host;
    this.cb.onState({
      state: s.state,
      score: self.score,
      partnerScore: opp.score,
      hp: self.hp, maxHp: self.maxHp,
      dashCd: self.dashCd, dashMax: self.dashMax,
      muted: s.muted,
      mode: "guest",
      wave: s.wave,
      kills: self.score,
      selfAlive: self.alive,
      partner: { username: this.partnerName, hp: opp.hp, maxHp: opp.maxhp, alive: opp.alive, score: opp.score },
    });
  }

  private onKeydown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    this.keys[k] = true;
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    if (this.state === "playing") {
      if (k === "shift") {
        if (this.mode === "guest") this.guestDashLatched = true;
        else this.players[0].dashRequested = true;
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

  private reset() {
    for (const p of this.players) {
      p.hp = p.maxhp; p.alive = true; p.deadTimer = 0; p.invuln = 0;
      p.dashCd = 0; p.shootCd = 0; p.score = 0; p.vx = 0; p.vy = 0;
    }
    if (this.players.length > 1) {
      this.players[0].x = this.W * 0.3; this.players[0].y = this.H / 2;
      this.players[1].x = this.W * 0.7; this.players[1].y = this.H / 2;
    } else {
      this.players[0].x = this.W / 2; this.players[0].y = this.H / 2;
    }
    this.bullets = []; this.particles = []; this.popups = []; this.enemies = [];
    this.shake = 0; this.flash = 0; this.tick = 0; this.snapshotCd = 0;
    this.wave = 0; this.waveMessage = ""; this.waveMessageTimer = 0;
    this.enemiesRemaining = 0; this.mothershipAlive = false; this.waveDelay = 1.2;
  }

  private fire(p: PlayerEntity) {
    if (p.shootCd > 0 || !p.alive) return;
    p.shootCd = p.fireRate;
    const sp = 750;
    const a = p.aim;
    const sx = Math.cos(a), sy = Math.sin(a);
    const owner = this.players.indexOf(p) as 0 | 1;
    this.bullets.push({ x: p.x + sx * p.r, y: p.y + sy * p.r, vx: sx * sp, vy: sy * sp, r: 4.5, life: 1.2, owner });
    this.tone(660, 0.06, "square", 0.025, -180);
  }

  private fireEnemy(e: Enemy) {
    if (!e.alive) return;
    const sp = e.kind === "mothership" ? 420 : 520;
    const a = e.aim;
    const sx = Math.cos(a), sy = Math.sin(a);
    const r = e.kind === "mothership" ? 6 : 3.5;
    this.bullets.push({ x: e.x + sx * e.r, y: e.y + sy * e.r, vx: sx * sp, vy: sy * sp, r, life: 1.5, owner: 2 });
    this.tone(440, 0.05, "sawtooth", 0.018, -100);
  }

  private spawnEnemy(kind: "grunt" | "elite" | "mothership") {
    const side = kind === "mothership" ? 0 : Math.floor(Math.random() * 4);
    let x: number, y: number;
    const pad = 50;
    if (kind === "mothership") {
      x = this.W / 2;
      y = -80;
    } else if (side === 0) { x = rand(pad, this.W - pad); y = -pad; }
    else if (side === 1) { x = rand(pad, this.W - pad); y = this.H + pad; }
    else if (side === 2) { x = -pad; y = rand(pad, this.H - pad); }
    else { x = this.W + pad; y = rand(pad, this.H - pad); }

    const waveScale = 1 + this.wave * 0.15;
    let hp: number, speed: number, fireRate: number, r: number, hue: number;
    if (kind === "mothership") {
      hp = 300 + this.wave * 80;
      speed = 30 + this.wave * 8;
      fireRate = 1.4;
      r = 44;
      hue = 0;
      this.mothershipAlive = true;
    } else if (kind === "elite") {
      hp = Math.floor(50 * waveScale);
      speed = 70 + this.wave * 10;
      fireRate = Math.max(0.6, 1.4 - this.wave * 0.06);
      r = 18;
      hue = 20 + this.wave * 3;
    } else {
      hp = Math.floor(22 * waveScale);
      speed = 90 + this.wave * 14;
      fireRate = Math.max(0.45, 1.6 - this.wave * 0.07);
      r = 13;
      hue = 200 + this.wave * 4;
    }
    this.enemies.push({
      x, y, vx: 0, vy: 0, r,
      hp, maxhp: hp, hue,
      shootCd: rand(0.4, 1.8), fireRate,
      aim: Math.atan2(this.H / 2 - y, this.W / 2 - x), alive: true, wob: Math.random() * 6,
      kind,
    });
    this.enemiesRemaining++;
  }

  private startWave() {
    this.wave++;
    this.enemiesRemaining = 0;
    this.mothershipAlive = false;
    this.waveMessage = `WAVE ${this.wave}`;
    this.waveMessageTimer = 2.0;

    const numGrunts = 3 + this.wave * 2;
    const numElites = Math.max(0, Math.floor((this.wave - 1) / 2));

    for (let i = 0; i < numGrunts; i++) {
      setTimeout(() => this.spawnEnemy("grunt"), i * 180);
    }
    for (let i = 0; i < numElites; i++) {
      setTimeout(() => this.spawnEnemy("elite"), numGrunts * 180 + i * 300);
    }
    // Mothership every 5 waves
    if (this.wave % 5 === 0) {
      setTimeout(() => {
        this.waveMessage = "⚠ MOTHERSHIP INCOMING";
        this.waveMessageTimer = 2.5;
      }, 1200);
      setTimeout(() => this.spawnEnemy("mothership"), 3500);
    }
    this.tone(220, 0.3, "sine", 0.06, 440);
  }

  private dash(p: PlayerEntity) {
    if (!p.alive || p.dashCd > 0 || p.dashTime > 0) return;
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
    if (!p.alive || p.invuln > 0) return;
    p.hp -= dmg;
    p.invuln = 0.9; p.hurtCd = 0.45;
    this.shake = 12; this.flash = 0.5;
    p.vx += kx; p.vy += ky;
    this.burst(p.x, p.y, p.hue, 14, 3, 180);
    this.noise(0.25, 0.16);
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false; p.deadTimer = 2.5;
      this.burst(p.x, p.y, p.hue, 40, 4.5, 300);
      this.noise(0.45, 0.2, 800);
      this.popups.push({ x: p.x, y: p.y - 30, text: "DOWN", life: 1.5, hue: p.hue });
      this.checkGameOver();
    }
    this.emit();
  }

  private checkGameOver() {
    const allDead = this.players.every(p => !p.alive);
    if (allDead) {
      this.gameOver();
    }
  }

  private gameOver() {
    this.state = "over";
    this.cb.onGameOver({ score: this.players[0].score, wave: this.wave, kills: this.players[0].score });
    this.cb.onDuckMusic?.(false);
    if ((this.mode === "host" || this.mode === "solo") && this.cb.onSnapshot) {
      this.cb.onSnapshot(this.buildSnapshot());
    }
    this.emit();
  }

  private sampleLocalInput() {
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
    p.inputMx = dx; p.inputMy = dy;
    p.aim = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);
  }

  private update(dt: number) {
    if (this.mode === "guest") return;

    // Wave management
    if (this.wave === 0) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) this.startWave();
    } else if (this.enemiesRemaining <= 0 && this.enemies.filter(e => e.alive).length === 0 && !this.mothershipAlive) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) {
        this.waveDelay = 1.8;
        this.startWave();
      }
    }

    // Wave message timer
    if (this.waveMessageTimer > 0) this.waveMessageTimer -= dt;

    this.sampleLocalInput();
    for (const p of this.players) {
      if (!p.alive) {
        p.deadTimer -= dt;
        if (p.deadTimer <= 0) {
          p.alive = true; p.hp = p.maxhp; p.invuln = 2.5;
          // Respawn near other player or center
          const other = this.players.find(op => op !== p && op.alive);
          if (other) {
            const a = rand(0, TAU);
            const d = rand(100, 200);
            p.x = clamp(other.x + Math.cos(a) * d, p.r + 20, this.W - p.r - 20);
            p.y = clamp(other.y + Math.sin(a) * d, p.r + 20, this.H - p.r - 20);
          } else {
            p.x = rand(p.r + 20, this.W - p.r - 20);
            p.y = rand(p.r + 20, this.H - p.r - 20);
          }
        }
        continue;
      }
      // Auto-shoot: always fire in aim direction
      p.shootCd -= dt;
      if (p.shootCd <= 0) { this.fire(p); }

      if (p.dashRequested) { this.dash(p); p.dashRequested = false; }
      if (p.dashTime > 0) {
        p.dashTime -= dt;
      } else {
        const l = Math.hypot(p.inputMx, p.inputMy);
        const tvx = l ? p.inputMx / l * p.speed : 0;
        const tvy = l ? p.inputMy / l * p.speed : 0;
        p.vx += (tvx - p.vx) * Math.min(1, dt * 14);
        p.vy += (tvy - p.vy) * Math.min(1, dt * 14);
      }
      p.vx *= 0.92; p.vy *= 0.92;
      p.x = clamp(p.x + p.vx * dt, p.r, this.W - p.r);
      p.y = clamp(p.y + p.vy * dt, p.r, this.H - p.r);
      p.wob += dt * 6;
      if (p.dashCd > 0) p.dashCd -= dt;
      if (p.invuln > 0) p.invuln -= dt;
      if (p.hurtCd > 0) p.hurtCd -= dt;
    }

    // Enemy AI
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // Find nearest alive player
      let bestD = Infinity, bestP: PlayerEntity | null = null;
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = dist(e.x, e.y, p.x, p.y);
        if (d < bestD) { bestD = d; bestP = p; }
      }
      if (bestP) {
        const dx = bestP.x - e.x, dy = bestP.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        e.aim = Math.atan2(dy, dx);
      }
      e.wob += dt * (e.kind === "mothership" ? 1.2 : 3.5);
      const strafeA = e.aim + Math.PI / 2 * Math.sin(e.wob * (e.kind === "mothership" ? 0.6 : 1));
      const spd = e.kind === "mothership" ? 30 + this.wave * 6 : (e.kind === "elite" ? 70 + this.wave * 8 : 90 + this.wave * 12);
      const steerSpeed = e.kind === "mothership" ? 2 : 5;
      e.vx += (Math.cos(strafeA) * spd - e.vx) * Math.min(1, dt * steerSpeed);
      e.vy += (Math.sin(strafeA) * spd - e.vy) * Math.min(1, dt * steerSpeed);
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.x = clamp(e.x, e.r, this.W - e.r);
      e.y = clamp(e.y, e.r, this.H - e.r);
      e.shootCd -= dt;
      if (e.shootCd <= 0) { e.shootCd = e.fireRate; this.fireEnemy(e); }
    }

    // Enemy collision avoidance
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i], b = this.enemies[j];
        if (!a.alive || !b.alive) continue;
        const d = dist(a.x, a.y, b.x, b.y);
        const minDist = a.r + b.r + 8;
        if (d < minDist && d > 0.01) {
          const nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
          const push = (minDist - d) * 0.4;
          a.x += nx * push; a.y += ny * push;
          b.x -= nx * push; b.y -= ny * push;
          a.vx += nx * 40; a.vy += ny * 40;
          b.vx -= nx * 40; b.vy -= ny * 40;
        }
      }
    }

    // Bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -30 || b.x > this.W + 30 || b.y < -30 || b.y > this.H + 30) {
        this.bullets.splice(i, 1); continue;
      }
      // Enemy bullets hit players
      if (b.owner === 2) {
        for (let j = 0; j < this.players.length; j++) {
          const target = this.players[j];
          if (!target.alive || target.invuln > 0) continue;
          if (dist(b.x, b.y, target.x, target.y) < target.r + b.r) {
            const a = Math.atan2(b.vy, b.vx);
            this.hurt(target, 14, Math.cos(a) * 120, Math.sin(a) * 120);
            this.bullets.splice(i, 1); break;
          }
        }
      } else {
        // Player bullets hit enemies
        for (let k = this.enemies.length - 1; k >= 0; k--) {
          const e = this.enemies[k];
          if (!e.alive) continue;
          if (dist(b.x, b.y, e.x, e.y) < e.r + b.r) {
            e.hp -= 22;
            this.burst(b.x, b.y, e.hue + 30, 8, 2, 140);
            this.bullets.splice(i, 1);
            if (e.hp <= 0) {
              e.alive = false;
              this.enemiesRemaining--;
              const points = e.kind === "mothership" ? 10 : e.kind === "elite" ? 3 : 1;
              // Award score to nearest player
              let nearest: PlayerEntity | null = null;
              let nd = Infinity;
              for (const p of this.players) {
                if (!p.alive) continue;
                const d = dist(e.x, e.y, p.x, p.y);
                if (d < nd) { nd = d; nearest = p; }
              }
              if (nearest) nearest.score += points;
              this.burst(e.x, e.y, e.hue, e.kind === "mothership" ? 50 : 25, e.kind === "mothership" ? 5 : 4, e.kind === "mothership" ? 400 : 240);
              this.popups.push({ x: e.x, y: e.y - 20, text: `+${points}`, life: 1.0, hue: e.kind === "mothership" ? 30 : 60 });
              this.tone(e.kind === "mothership" ? 660 : 880, e.kind === "mothership" ? 0.2 : 0.08, "sine", 0.04);
              if (e.kind === "mothership") {
                this.shake = 18; this.flash = 0.6;
                this.noise(0.5, 0.25, 600);
                this.mothershipAlive = false;
              }
            }
            break;
          }
        }
      }
    }

    // Particles & popups
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.y -= 30 * dt; p.life -= dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 32);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2);

    this.tick++;
    if ((this.mode === "host" || this.mode === "solo") && this.cb.onSnapshot) {
      this.snapshotCd -= dt;
      if (this.snapshotCd <= 0) { this.snapshotCd = this.snapshotInterval; this.cb.onSnapshot(this.buildSnapshot()); }
    }
  }

  private buildSnapshot(): CoopSnapshot {
    const p0 = this.players[0];
    const p1 = this.players[1] ?? p0;
    const bullets: number[] = [];
    for (const b of this.bullets) bullets.push(b.x, b.y, b.r, b.owner);
    const enemies: number[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const kindNum = e.kind === "mothership" ? 2 : e.kind === "elite" ? 1 : 0;
      enemies.push(e.x, e.y, e.r, e.hp, e.maxhp, e.hue, e.aim, e.alive ? 1 : 0, kindNum);
    }
    return {
      state: this.state,
      score: p0.score,
      opponentScore: p1.score,
      hp: p0.hp,
      maxHp: p0.maxhp,
      dashCd: p0.dashCd,
      dashMax: p0.dashMax,
      muted: this.muted,
      wave: this.wave,
      enemies,
      host: {
        x: p0.x, y: p0.y, aim: p0.aim, alive: p0.alive,
        hp: p0.hp, maxHp: p0.maxhp, dashCd: p0.dashCd, dashMax: p0.dashMax, score: p0.score,
      },
      guest: {
        x: p1.x, y: p1.y, aim: p1.aim, alive: p1.alive,
        hp: p1.hp, maxHp: p1.maxhp, dashCd: p1.dashCd, dashMax: p1.dashMax, score: p1.score,
      },
      bullets,
      W: this.W, H: this.H, tick: this.tick,
    };
  }

  private burst(x: number, y: number, hue: number, count: number, spread: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = rand(speed * 0.3, speed);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), max: 0.9, r: rand(1, spread), hue: hue + rand(-16, 16) });
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  // ── Drawing ──────────────────────────────────────────────

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
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.rotate(p.aim + Math.PI / 2);

    // Engine glow
    ctx.shadowColor = `hsla(${p.hue},85%,55%,0.7)`; ctx.shadowBlur = 16;

    // Ship body
    const b = p.r;
    ctx.beginPath();
    ctx.moveTo(0, -b); // nose
    ctx.lineTo(-b * 0.7, b * 0.6); // left wingtip
    ctx.lineTo(-b * 0.25, b * 0.25); // left inner
    ctx.lineTo(0, b * 0.5); // center back
    ctx.lineTo(b * 0.25, b * 0.25); // right inner
    ctx.lineTo(b * 0.7, b * 0.6); // right wingtip
    ctx.closePath();
    const grd = ctx.createLinearGradient(0, -b, 0, b);
    grd.addColorStop(0, `hsl(${p.hue},90%,85%)`);
    grd.addColorStop(0.4, `hsl(${p.hue},80%,55%)`);
    grd.addColorStop(1, `hsl(${p.hue},60%,25%)`);
    ctx.fillStyle = grd;
    ctx.fill();

    // Cockpit
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(0, -b * 0.2, b * 0.22, b * 0.35, 0, 0, TAU);
    ctx.fillStyle = "rgba(34,211,238,0.7)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Wing stripes
    ctx.strokeStyle = `hsla(${p.hue},70%,70%,0.5)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-b * 0.18, b * 0.1); ctx.lineTo(-b * 0.55, b * 0.45);
    ctx.moveTo(b * 0.18, b * 0.1); ctx.lineTo(b * 0.55, b * 0.45);
    ctx.stroke();

    ctx.restore();
  }

  private drawBullet(b: Bullet) {
    const ctx = this.ctx;
    const hue = b.owner === 0 ? 120 : b.owner === 2 ? 0 : 200;
    ctx.shadowColor = `hsla(${hue},85%,55%,0.9)`; ctx.shadowBlur = 10;
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, "#fff"); g.addColorStop(0.5, `hsl(${hue},85%,60%)`); g.addColorStop(1, `hsla(${hue},85%,40%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
  }

  private drawCrosshair() {
    const ctx = this.ctx;
    const mx = this.mouse.x, my = this.mouse.y;
    const size = 14, gap = 5;
    ctx.save();
    ctx.translate(mx, my);
    ctx.strokeStyle = "rgba(34,211,238,0.8)";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(34,211,238,0.5)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(-size, 0); ctx.lineTo(-gap, 0);
    ctx.moveTo(size, 0); ctx.lineTo(gap, 0);
    ctx.moveTo(0, -size); ctx.lineTo(0, -gap);
    ctx.moveTo(0, size); ctx.lineTo(0, gap);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(34,211,238,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  private drawEnemy(e: Enemy) {
    if (!e.alive) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.aim + Math.PI / 2);

    const r = e.r;
    const hue = e.kind === "mothership" ? 0 : e.hue;
    const sat = e.kind === "mothership" ? "90%" : "80%";
    const light = e.kind === "mothership" ? "65%" : "55%";

    ctx.shadowColor = `hsla(${hue},${sat},${light},0.7)`; ctx.shadowBlur = e.kind === "mothership" ? 28 : 14;

    if (e.kind === "mothership") {
      // Large, imposing mothership with multiple segments
      const grd = ctx.createLinearGradient(0, -r, 0, r);
      grd.addColorStop(0, `hsl(${hue},95%,80%)`);
      grd.addColorStop(0.3, `hsl(${hue},90%,60%)`);
      grd.addColorStop(1, `hsl(${hue},70%,25%)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      // Main body - oval
      ctx.ellipse(0, 0, r * 0.75, r, 0, 0, TAU);
      ctx.fill();
      // Spikes
      ctx.strokeStyle = `hsl(${hue},85%,50%)`;
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + e.wob * 0.3;
        const spkLen = r * (0.8 + 0.3 * Math.sin(i * 2.5 + e.wob));
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
        ctx.lineTo(Math.cos(a) * spkLen, Math.sin(a) * spkLen);
        ctx.stroke();
      }
      // Inner eye
      ctx.shadowBlur = 0;
      ctx.fillStyle = `hsl(${hue},70%,20%)`;
      ctx.beginPath(); ctx.ellipse(0, -r * 0.15, r * 0.28, r * 0.38, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#f43f5e";
      ctx.beginPath(); ctx.arc(0, -r * 0.25, r * 0.18, 0, TAU); ctx.fill();
    } else if (e.kind === "elite") {
      // Elite — menacing, wider
      const grd = ctx.createLinearGradient(0, -r, 0, r);
      grd.addColorStop(0, `hsl(${hue},90%,75%)`);
      grd.addColorStop(0.5, `hsl(${hue},80%,50%)`);
      grd.addColorStop(1, `hsl(${hue},70%,20%)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.1);
      ctx.lineTo(-r * 0.9, r * 0.5);
      ctx.lineTo(-r * 0.3, r * 0.2);
      ctx.lineTo(0, r * 0.7);
      ctx.lineTo(r * 0.3, r * 0.2);
      ctx.lineTo(r * 0.9, r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `hsla(${hue},60%,40%,0.9)`;
      ctx.beginPath(); ctx.ellipse(0, -r * 0.15, r * 0.2, r * 0.3, 0, 0, TAU); ctx.fill();
    } else {
      // Grunt — classic alien fighter
      const grd = ctx.createLinearGradient(0, -r, 0, r);
      grd.addColorStop(0, `hsl(${hue},90%,80%)`);
      grd.addColorStop(0.4, `hsl(${hue},80%,50%)`);
      grd.addColorStop(1, `hsl(${hue},70%,22%)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(-r * 0.7, r * 0.5);
      ctx.lineTo(-r * 0.25, r * 0.2);
      ctx.lineTo(0, r * 0.55);
      ctx.lineTo(r * 0.25, r * 0.2);
      ctx.lineTo(r * 0.7, r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `hsla(${hue},60%,45%,0.85)`;
      ctx.beginPath(); ctx.ellipse(0, -r * 0.1, r * 0.18, r * 0.28, 0, 0, TAU); ctx.fill();
    }

    // HP bar
    ctx.setTransform(1, 0, 0, 1, e.x, e.y);
    const barW = e.r * 1.8, barH = 3;
    const hpPct = e.hp / e.maxhp;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(-barW / 2, -e.r - 9, barW, barH);
    const barHue = hpPct > 0.5 ? 120 : hpPct > 0.25 ? 40 : 0;
    ctx.fillStyle = `hsl(${barHue},85%,55%)`;
    ctx.fillRect(-barW / 2, -e.r - 9, barW * hpPct, barH);
    ctx.restore();
  }

  private render(dt: number) {
    const ctx = this.ctx;
    this.drawBackground(dt);
    ctx.save();
    if (this.shake > 0) ctx.translate(rand(-this.shake, this.shake) * 0.4, rand(-this.shake, this.shake) * 0.4);
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = `hsl(${p.hue},90%,62%)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const b of this.bullets) this.drawBullet(b);
    for (const e of this.enemies) this.drawEnemy(e);
    if (this.state === "playing" || this.state === "over") {
      for (const p of this.players) this.drawPlayer(p);
    }
    ctx.textAlign = "center";
    for (const p of this.popups) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.font = "16px 'Share Tech Mono',monospace";
      ctx.fillStyle = `hsl(${p.hue},90%,70%)`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Wave message
    if (this.waveMessageTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.waveMessageTimer * 1.5);
      ctx.font = "bold 40px 'Share Tech Mono',monospace";
      ctx.textAlign = "center";
      const isBoss = this.waveMessage.includes("MOTHERSHIP");
      ctx.fillStyle = isBoss ? "#f43f5e" : "#a78bfa";
      ctx.shadowColor = isBoss ? "rgba(244,63,94,0.7)" : "rgba(124,58,237,0.7)";
      ctx.shadowBlur = 20;
      ctx.fillText(this.waveMessage, this.W / 2, this.H * 0.35);
      ctx.restore();
    }

    if (this.state === "playing") this.drawCrosshair();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(244,63,94,${this.flash * 0.28})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  private renderFromSnapshot(dt: number) {
    const s = this.snap;
    this.drawBackground(dt);
    if (!s) return;
    const ctx = this.ctx;
    const sx = this.W / Math.max(1, s.W);
    const sy = this.H / Math.max(1, s.H);
    const scale = Math.min(sx, sy);
    const offX = (this.W - s.W * scale) * 0.5;
    const offY = (this.H - s.H * scale) * 0.5;
    ctx.save(); ctx.translate(offX, offY); ctx.scale(scale, scale);

    // Draw enemies
    for (let i = 0; i < s.enemies.length; i += 9) {
      const ex = s.enemies[i], ey = s.enemies[i + 1], er = s.enemies[i + 2];
      const ehp = s.enemies[i + 3], emaxhp = s.enemies[i + 4], ehue = s.enemies[i + 5];
      const eaim = s.enemies[i + 6], ealive = s.enemies[i + 7] === 1, ekind = s.enemies[i + 8];
      if (!ealive) continue;
      const kindStr = ekind === 2 ? "mothership" : ekind === 1 ? "elite" : "grunt";
      const tempEnemy: Enemy = {
        x: ex, y: ey, vx: 0, vy: 0, r: er, hp: ehp, maxhp: emaxhp,
        hue: ehue, shootCd: 0, fireRate: 1, aim: eaim, alive: true, wob: 0, kind: kindStr,
      };
      this.drawEnemy(tempEnemy);
    }

    // Draw bullets
    for (let i = 0; i < s.bullets.length; i += 4) {
      const bx = s.bullets[i], by = s.bullets[i + 1], br = s.bullets[i + 2], owner = s.bullets[i + 3] as 0 | 1 | 2;
      const hue = owner === 0 ? 120 : owner === 2 ? 0 : 200;
      ctx.shadowColor = `hsla(${hue},85%,55%,0.9)`; ctx.shadowBlur = 10;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, "#fff"); g.addColorStop(0.5, `hsl(${hue},85%,60%)`); g.addColorStop(1, `hsla(${hue},85%,40%,0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Draw players
    const hP = { ...makePlayer(120), x: s.host.x, y: s.host.y, aim: s.host.aim, alive: s.host.alive, hue: 120 };
    const gP = { ...makePlayer(200), x: s.guest.x, y: s.guest.y, aim: s.guest.aim, alive: s.guest.alive, hue: 200 };
    if (s.state === "playing" || s.state === "over") {
      this.drawPlayer(hP);
      this.drawPlayer(gP);
    }
    ctx.restore();
    if (s.state === "playing") this.drawCrosshair();
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 0.05);
    if (this.mode === "guest") {
      this.renderFromSnapshot(dt);
    } else {
      if (this.state === "playing") { this.update(dt); this.emit(); }
      this.render(this.state === "playing" ? dt : dt * 0.25);
    }
    this.rafId = requestAnimationFrame(this.loop);
  };
}
