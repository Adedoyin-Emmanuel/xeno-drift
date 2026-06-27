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
  planetName?: string;
  transitionMessage?: string;
  activePowerup?: string;
  activePowerupTimer?: number;
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
type Trail = { x: number; y: number; life: number; max: number; hue: number; vx: number; vy: number };
type Popup = { x: number; y: number; text: string; life: number; hue: number };
type PowerUp = { x: number; y: number; r: number; kind: "double" | "shield" | "rapidfire" | "nova"; life: number; wob: number; pickupAnimate: number };
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
  kills: number;
  powerupKind: "double" | "shield" | "rapidfire" | "nova" | "none";
  powerupTime: number;
};

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

function makePlayer(hue: number): PlayerEntity {
  return {
    x: 0, y: 0, vx: 0, vy: 0, r: 18,
    speed: 430, hp: 160, maxhp: 160, aim: 0,
    shootCd: 0, fireRate: 0.1,
    dashCd: 0, dashMax: 1.2, dashTime: 0,
    invuln: 0, hurtCd: 0, wob: 0,
    alive: true, hue,
    inputMx: 0, inputMy: 0,
    dashRequested: false,
    deadTimer: 0,
    score: 0,
    kills: 0,
    powerupKind: "none",
    powerupTime: 0,
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
  
  // Dynamic Space Planet Themes
  private planetThemes = [
    { bg: ["#140f2e", "#0a0a1c"], neb: ["rgba(124,58,237,0.12)", "rgba(244,63,94,0.07)", "rgba(34,211,238,0.06)"], name: "Xeno Nebula Prime" },
    { bg: ["#022c22", "#020617"], neb: ["rgba(16,185,129,0.15)", "rgba(59,130,246,0.1)", "rgba(234,179,8,0.08)"], name: "Toxic Outpost Sector 9" },
    { bg: ["#451a03", "#04020a"], neb: ["rgba(239,68,68,0.15)", "rgba(249,115,22,0.12)", "rgba(234,179,8,0.06)"], name: "Inferno Magma Core" },
    { bg: ["#1e1b4b", "#020617"], neb: ["rgba(99,102,241,0.20)", "rgba(168,85,247,0.14)", "rgba(6,182,212,0.10)"], name: "Titan Frozen Abyss" },
  ];
  private currentPlanetIdx = 0;
  private nextPlanetIdx = 0;
  private planetTransitionProgress = 1.0; // 1 = fully on current planet

  private players: PlayerEntity[] = [makePlayer(120)];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private trails: Trail[] = [];
  private popups: Popup[] = [];
  private enemies: Enemy[] = [];
  private powerups: PowerUp[] = [];

  // Levitation and Planet Jump States
  private pTransitionState: "none" | "levitating" | "warp" | "entering" = "none";
  private pTransitionTimer = 0;

  // Wave system
  private wave = 0;
  private waveMessage = "";
  private waveMessageTimer = 0;
  private enemiesRemaining = 0;
  private mothershipAlive = false;
  private waveDelay = 0;
  private spawnTimers: number[] = [];
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
    this.clearSpawnTimers();
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
    this.clearSpawnTimers();
    this.state = "menu";
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.trails = [];
    this.popups = [];
    this.powerups = [];
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
  requestDash() {
    if (this.state !== "playing") return;
    if (this.mode === "guest") this.guestDashLatched = true;
    else this.players[0].dashRequested = true;
  }
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

  setRemoteInput(mvx: number, mvy: number, dash: boolean, _aim: number) {
    if (this.mode !== "host" || this.players.length < 2) return;
    const p = this.players[1];
    p.inputMx = mvx;
    p.inputMy = mvy;
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
    return { mvx: dx, mvy: dy, dash, aim: 0, fire: true };
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

  private playShotSound(power = false) {
    this.tone(power ? 980 : 760, power ? 0.055 : 0.04, "square", power ? 0.04 : 0.026, power ? -260 : -180);
  }

  private playRapidShotSound(offset = 0) {
    if (!this.actx || this.muted) return;
    const t = this.actx.currentTime + offset;
    const o = this.actx.createOscillator();
    const g = this.actx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(900 + Math.random() * 160, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.045);
    g.gain.setValueAtTime(0.032, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    o.connect(g); g.connect(this.actx.destination);
    o.start(t); o.stop(t + 0.055);
  }

  private playHitSound() {
    this.tone(250, 0.035, "triangle", 0.034, -80);
  }

  private playEnemyObliteratedSound() {
    this.tone(920, 0.075, "sine", 0.052, -420);
    this.noise(0.09, 0.055, 1700);
  }

  private playMothershipObliteratedSound() {
    this.tone(150, 0.4, "sawtooth", 0.09, -70);
    this.tone(620, 0.22, "sine", 0.075, -300);
    this.noise(0.6, 0.28, 720);
  }

  private playWarpBreezeSound() {
    this.noise(0.9, 0.12, 2600);
    this.tone(230, 0.9, "sine", 0.045, 520);
  }

  private playDashSound() {
    this.noise(0.16, 0.055, 3200);
    this.tone(210, 0.16, "sawtooth", 0.055, 320);
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
    
    let activePowerup = undefined;
    let activePowerupTimer = undefined;
    if (me.powerupKind !== "none") {
      activePowerup = me.powerupKind;
      activePowerupTimer = me.powerupTime;
    }

    let transitionMessage = undefined;
    if (this.pTransitionState === "levitating" || this.pTransitionState === "warp") {
      transitionMessage = `WARPING TO ${this.planetThemes[this.nextPlanetIdx].name}...`;
    }

    this.cb.onState({
      state: this.state,
      score: me.score,
      partnerScore: opp?.score,
      hp: me.hp, maxHp: me.maxhp,
      dashCd: me.dashCd, dashMax: me.dashMax,
      muted: this.muted,
      mode: this.mode,
      wave: this.wave,
      kills: me.kills,
      planetName: this.planetThemes[this.currentPlanetIdx].name,
      transitionMessage,
      activePowerup,
      activePowerupTimer,
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
      kills: self.kills,
      planetName: this.planetThemes[this.currentPlanetIdx].name,
      selfAlive: self.alive,
      partner: { username: this.partnerName, hp: opp.hp, maxHp: opp.maxHp, alive: opp.alive, score: opp.score },
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
    this.clearSpawnTimers();
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      p.hp = p.maxhp;
      p.alive = true;
      p.deadTimer = 0;
      p.invuln = 0;
      p.dashCd = 0;
      p.shootCd = 0;
      p.score = 0;
      p.kills = 0;
      p.vx = 0;
      p.vy = 0;
      p.powerupKind = "none";
      p.powerupTime = 0;
    }
    if (this.players.length > 1) {
      this.players[0].x = this.W * 0.3; this.players[0].y = this.H / 2;
      this.players[1].x = this.W * 0.7; this.players[1].y = this.H / 2;
    } else {
      this.players[0].x = this.W / 2; this.players[0].y = this.H / 2;
    }
    this.bullets = [];
    this.particles = [];
    this.trails = [];
    this.popups = [];
    this.enemies = [];
    this.powerups = [];
    this.shake = 0;
    this.flash = 0;
    this.tick = 0;
    this.snapshotCd = 0;
    this.wave = 0;
    this.waveMessage = "";
    this.waveMessageTimer = 0;
    this.enemiesRemaining = 0;
    this.mothershipAlive = false;
    this.waveDelay = 1.2;
    this.currentPlanetIdx = 0;
    this.nextPlanetIdx = 0;
    this.planetTransitionProgress = 1.0;
    this.pTransitionState = "none";
    this.pTransitionTimer = 0;
  }

  private fire(p: PlayerEntity) {
    if (p.shootCd > 0 || !p.alive || this.pTransitionState !== "none") return;
    
    const isRapid = p.powerupKind === "rapidfire";
    const isNova = p.powerupKind === "nova";
    p.shootCd = isNova ? 0.4 : isRapid ? p.fireRate * 0.42 : p.fireRate;
    
    const sp = isNova ? 880 : 970;
    const a = p.aim;
    const sx = Math.cos(a), sy = Math.sin(a);
    const owner = this.players.indexOf(p) as 0 | 1;

    if (isNova) {
      const count = 13;
      const spread = 1.55;
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : i / (count - 1);
        const na = a - spread / 2 + spread * t;
        const laneOffset = (i - (count - 1) / 2) * 1.8;
        this.bullets.push({
          x: p.x + Math.cos(na) * (p.r + 8) - Math.sin(a) * laneOffset,
          y: p.y + Math.sin(na) * (p.r + 8) + Math.cos(a) * laneOffset,
          vx: Math.cos(na) * sp,
          vy: Math.sin(na) * sp,
          r: 5.0,
          life: 0.9,
          owner,
        });
        this.playRapidShotSound(i * 0.018);
      }
      this.burst(p.x + sx * 18, p.y + sy * 18, 190, 14, 2.4, 220);
    } else if (p.powerupKind === "double") {
      const angles = [a - 0.2, a, a + 0.2];
      for (const shotAngle of angles) {
        this.bullets.push({ x: p.x + Math.cos(shotAngle) * (p.r + 6), y: p.y + Math.sin(shotAngle) * (p.r + 6), vx: Math.cos(shotAngle) * sp, vy: Math.sin(shotAngle) * sp, r: 5.5, life: 0.95, owner });
      }
      this.playShotSound(true);
    } else {
      this.bullets.push({ x: p.x + sx * (p.r + 6), y: p.y + sy * (p.r + 6), vx: sx * sp, vy: sy * sp, r: 5.5, life: 0.95, owner });
      this.playShotSound(false);
    }
  }

  private fireEnemy(e: Enemy) {
    if (!e.alive || this.state !== "playing" || this.pTransitionState !== "none") return;
    const a = e.aim;

    if (e.kind === "mothership") {
      // The mothership should feel terrifying: layered fan shots + a drifting plasma ring.
      const fanCount = 11;
      const fanSpread = 1.18;
      for (let i = 0; i < fanCount; i++) {
        const t = fanCount === 1 ? 0.5 : i / (fanCount - 1);
        const shotA = a - fanSpread / 2 + fanSpread * t;
        const sp = 360 + Math.abs(i - (fanCount - 1) / 2) * 14;
        this.bullets.push({
          x: e.x + Math.cos(shotA) * (e.r + 10),
          y: e.y + Math.sin(shotA) * (e.r + 10),
          vx: Math.cos(shotA) * sp,
          vy: Math.sin(shotA) * sp,
          r: 6.5,
          life: 1.65,
          owner: 2,
        });
      }

      const ringCount = 14;
      const spin = e.wob * 0.9;
      for (let i = 0; i < ringCount; i++) {
        const shotA = spin + (i / ringCount) * TAU;
        const sp = 245 + Math.sin(e.wob + i) * 34;
        this.bullets.push({
          x: e.x + Math.cos(shotA) * (e.r + 12),
          y: e.y + Math.sin(shotA) * (e.r + 12),
          vx: Math.cos(shotA) * sp,
          vy: Math.sin(shotA) * sp,
          r: 5.2,
          life: 2.05,
          owner: 2,
        });
      }

      this.tone(120, 0.18, "sawtooth", 0.06, 180);
      this.tone(620, 0.08, "triangle", 0.042, -220);
      return;
    }

    const sp = 470;
    const sx = Math.cos(a), sy = Math.sin(a);
    this.bullets.push({ x: e.x + sx * (e.r + 6), y: e.y + sy * (e.r + 6), vx: sx * sp, vy: sy * sp, r: 4, life: 1.35, owner: 2 });
    this.tone(520, 0.045, "triangle", 0.018, -120);
  }

  private spawnEnemy(kind: "grunt" | "elite" | "mothership") {
    if (this.state !== "playing") return;
    const side = kind === "mothership" ? 0 : Math.floor(Math.random() * 4);
    let x: number, y: number;
    const pad = 50;
    if (kind === "mothership") {
      x = this.W / 2;
      y = -100;
    } else if (side === 0) { x = rand(pad, this.W - pad); y = -pad; }
    else if (side === 1) { x = rand(pad, this.W - pad); y = this.H + pad; }
    else if (side === 2) { x = -pad; y = rand(pad, this.H - pad); }
    else { x = this.W + pad; y = rand(pad, this.H - pad); }
    const alienHues = [8, 32, 190, 215, 262, 292, 328];
    let hp: number, fireRate: number, r: number, hue: number;
    if (kind === "mothership") {
      hp = 340 + this.wave * 52;
      fireRate = 1.05;
      r = 50;
      hue = 320;
      this.mothershipAlive = true;
    } else if (kind === "elite") {
      hp = 34 + this.wave * 6;
      fireRate = Math.max(1.75, 2.55 - this.wave * 0.035);
      r = 17;
      hue = alienHues[Math.floor(Math.random() * alienHues.length)];
    } else {
      hp = 13 + this.wave * 3;
      fireRate = Math.max(1.65, 2.7 - this.wave * 0.04);
      r = 12;
      hue = alienHues[Math.floor(Math.random() * alienHues.length)];
    }
    this.enemies.push({
      x, y, vx: 0, vy: 0, r,
      hp, maxhp: hp, hue,
      shootCd: rand(0.85, 2.0), fireRate,
      aim: Math.atan2(this.H / 2 - y, this.W / 2 - x), alive: true, wob: Math.random() * 6,
      kind,
    });
    this.enemiesRemaining++;
  }

  private queueSpawn(fn: () => void, delay: number) {
    const id = window.setTimeout(() => {
      this.spawnTimers = this.spawnTimers.filter((timer) => timer !== id);
      if (this.state === "playing") fn();
    }, delay);
    this.spawnTimers.push(id);
  }

  private clearSpawnTimers() {
    for (const timer of this.spawnTimers) window.clearTimeout(timer);
    this.spawnTimers = [];
  }

  private spawnPowerup(x: number, y: number, preferredKind?: PowerUp["kind"]) {
    const kinds = ["double", "shield", "rapidfire", "nova", "nova"] as const;
    const randomKind = preferredKind ?? kinds[Math.floor(Math.random() * kinds.length)];
    this.powerups.push({
      x,
      y,
      r: randomKind === "nova" ? 18 : 16,
      kind: randomKind,
      life: 14.0,
      wob: Math.random() * TAU,
      pickupAnimate: 0
    });
    this.tone(520, 0.15, "sine", 0.04, 300);
  }

  private startWave() {
    if (this.state !== "playing") return;
    this.wave++;
    this.clearSpawnTimers();
    this.enemiesRemaining = 0;
    this.mothershipAlive = false;
    this.waveMessage = `WAVE ${this.wave}`;
    this.waveMessageTimer = 2.5;

    const isCoop = this.mode === "host" || this.mode === "guest";
    const wavePressure = Math.min(this.wave, 10);
    const numGrunts = Math.min(isCoop ? 16 : 12, (isCoop ? 3 : 2) + Math.floor(wavePressure * (isCoop ? 1.05 : 0.85)));
    const numElites = Math.min(isCoop ? 5 : 3, Math.max(0, Math.floor((this.wave - (isCoop ? 3 : 4)) / 3)));

    if (this.wave === 2) {
      this.queueSpawn(() => this.spawnPowerup(this.W / 2, this.H / 2, "nova"), 1100);
    }

    for (let i = 0; i < numGrunts; i++) {
      this.queueSpawn(() => this.spawnEnemy("grunt"), i * 430);
    }
    for (let i = 0; i < numElites; i++) {
      this.queueSpawn(() => this.spawnEnemy("elite"), numGrunts * 380 + i * 780);
    }
    
    // Boss arrives later so the player has time to learn movement and powerups.
    if (this.wave >= 5 && this.wave % 4 === 1) {
      this.queueSpawn(() => {
        this.waveMessage = "MOTHERSHIP APPROACHING";
        this.waveMessageTimer = 2.0;
        this.tone(110, 0.45, "sawtooth", 0.06, -50);
      }, 7500);
      this.queueSpawn(() => this.spawnEnemy("mothership"), 10500);
    }
    this.tone(220, 0.4, "sine", 0.06, 440);
  }

  private dash(p: PlayerEntity) {
    if (!p.alive || p.dashCd > 0 || p.dashTime > 0 || this.pTransitionState !== "none") return;
    let dx = p.inputMx, dy = p.inputMy;
    if (!dx && !dy) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    p.vx = dx * 1100; p.vy = dy * 1100;
    p.dashTime = 0.16; p.invuln = 0.34; p.dashCd = p.dashMax;
    this.burst(p.x, p.y, p.hue, 16, 3, 260);
    this.playDashSound();
  }
  private hurt(p: PlayerEntity, dmg: number, kx = 0, ky = 0) {
    if (!p.alive || p.invuln > 0 || this.pTransitionState !== "none") return;
    
    if (p.powerupKind === "shield") {
      p.powerupKind = "none";
      p.powerupTime = 0;
      p.invuln = 1.2;
      this.popups.push({ x: p.x, y: p.y - 30, text: "SHIELD ABSORBED!", life: 1.5, hue: 190 });
      this.tone(440, 0.35, "sine", 0.05, 400);
      return;
    }

    const softenedDamage = Math.max(4, Math.round(dmg * 0.58));
    p.hp -= softenedDamage;
    p.invuln = 1.18; p.hurtCd = 0.36;
    this.shake = 8; this.flash = 0.32;
    p.vx += kx * 0.72; p.vy += ky * 0.72;
    this.burst(p.x, p.y, p.hue, 10, 2.5, 150);
    this.noise(0.18, 0.09);
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
    this.clearSpawnTimers();
    this.state = "over";
    this.cb.onGameOver({ score: this.players[0].score, wave: this.wave, kills: this.players[0].kills });
    this.cb.onDuckMusic?.(false);
    if ((this.mode === "host" || this.mode === "solo") && this.cb.onSnapshot) {
      this.cb.onSnapshot(this.buildSnapshot());
    }
    this.emit();
  }

  private autoAim(p: PlayerEntity) {
    let bestD = Infinity, bestE: Enemy | null = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d < bestD) { bestD = d; bestE = e; }
    }
    if (!bestE) return false;
    p.aim = Math.atan2(bestE.y - p.y, bestE.x - p.x);
    return true;
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
  }

  private update(dt: number) {
    if (this.mode === "guest") return;

    for (const p of this.players) {
      if (p.alive && p.powerupKind !== "none") {
        p.powerupTime -= dt;
        if (p.powerupTime <= 0) {
          p.powerupKind = "none";
          p.powerupTime = 0;
          this.popups.push({ x: p.x, y: p.y - 30, text: "POWERUP EXPIRED", life: 1.0, hue: 0 });
        }
      }
    }

    if (this.pTransitionState !== "none") {
      this.pTransitionTimer += dt;
      if (this.pTransitionState === "levitating") {
        for (const p of this.players) {
          p.vx += (this.W / 2 - p.x) * 0.1 * dt;
          p.vy += (this.H / 2 - p.y) * 0.1 * dt;
          p.x += (this.W / 2 - p.x) * 3 * dt;
          p.y += (this.H / 2 - p.y) * 3 * dt;
        }
        if (this.pTransitionTimer >= 1.5) {
          this.pTransitionState = "warp";
          this.pTransitionTimer = 0;
          this.playWarpBreezeSound();
        }
      } else if (this.pTransitionState === "warp") {
        this.shake = 15;
        this.planetTransitionProgress = clamp(this.pTransitionTimer / 1.5, 0, 1);
        if (this.pTransitionTimer >= 1.8) {
          this.pTransitionState = "entering";
          this.pTransitionTimer = 0;
          this.currentPlanetIdx = this.nextPlanetIdx;
          this.planetTransitionProgress = 1.0;
          this.flash = 1.0;
          this.tone(880, 0.4, "sine", 0.1);

          // Restore Hull integrity on successful planet warping
          for (const p of this.players) {
            if (p.alive) {
              const heal = Math.min(40, p.maxhp - p.hp);
              if (heal > 0) {
                p.hp += heal;
                this.popups.push({ x: p.x, y: p.y - 40, text: `+${heal} HULL REPAIRED!`, life: 2.0, hue: 120 });
              }
            }
          }
        }
      } else if (this.pTransitionState === "entering") {
        if (this.pTransitionTimer >= 1.0) {
          this.pTransitionState = "none";
          this.startWave();
        }
      }
      this.shake = Math.max(0, this.shake - dt * 32);
      this.flash = Math.max(0, this.flash - dt * 2);
      return;
    }

    if (this.wave === 0) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) this.startWave();
    } else if (this.enemiesRemaining <= 0 && this.enemies.filter(e => e.alive).length === 0 && !this.mothershipAlive) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) {
        if (this.wave > 0 && this.wave % 3 === 0) {
          this.pTransitionState = "levitating";
          this.pTransitionTimer = 0;
          this.nextPlanetIdx = (this.currentPlanetIdx + 1) % this.planetThemes.length;
          this.planetTransitionProgress = 0.0;
          this.waveDelay = 0;
          this.playWarpBreezeSound();
        } else {
          this.waveDelay = 1.8;
          this.startWave();
        }
      }
    }

    if (this.waveMessageTimer > 0) this.waveMessageTimer -= dt;

    this.sampleLocalInput();
    for (const p of this.players) {
      if (!p.alive) {
        p.deadTimer -= dt;
        if (p.deadTimer <= 0) {
          p.alive = true; p.hp = p.maxhp; p.invuln = 2.5;
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
      const hasTarget = this.autoAim(p);
      p.shootCd -= dt;
      if (hasTarget && p.shootCd <= 0) { this.fire(p); }
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

    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      p.life -= dt;
      p.wob += dt * 1.5;
      p.y += Math.sin(p.wob) * 0.15;

      if (p.life <= 0) {
        this.powerups.splice(i, 1);
        continue;
      }

      for (const pEnt of this.players) {
        if (pEnt.alive && dist(p.x, p.y, pEnt.x, pEnt.y) < pEnt.r + p.r) {
          pEnt.powerupKind = p.kind;
          pEnt.powerupTime = 10.0;
          const powerupName = p.kind === "nova" ? "NOVA BURST" : p.kind.toUpperCase();
          this.popups.push({ x: p.x, y: p.y - 25, text: `${powerupName} READY!`, life: 1.3, hue: p.kind === "nova" ? 190 : 120 });
          this.tone(880, 0.25, "triangle", 0.065, 260);
          this.burst(p.x, p.y, 120, 20, 4, 300);
          this.powerups.splice(i, 1);
          break;
        }
      }
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
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
      const spd = e.kind === "mothership" ? 34 + this.wave * 4 : (e.kind === "elite" ? 66 + this.wave * 5 : 82 + this.wave * 7);
      const steerSpeed = e.kind === "mothership" ? 1.7 : 4.2;
      e.vx += (Math.cos(strafeA) * spd - e.vx) * Math.min(1, dt * steerSpeed);
      e.vy += (Math.sin(strafeA) * spd - e.vy) * Math.min(1, dt * steerSpeed);
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.x = clamp(e.x, e.r, this.W - e.r);
      e.y = clamp(e.y, e.r, this.H - e.r);
      e.shootCd -= dt;
      if (e.shootCd <= 0) { e.shootCd = e.fireRate; this.fireEnemy(e); }
    }

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
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -30 || b.x > this.W + 30 || b.y < -30 || b.y > this.H + 30) {
        this.bullets.splice(i, 1); continue;
      }
      if (b.owner === 2) {
        for (let j = 0; j < this.players.length; j++) {
          const target = this.players[j];
          if (!target.alive || target.invuln > 0) continue;
          if (dist(b.x, b.y, target.x, target.y) < target.r + b.r) {
            const a = Math.atan2(b.vy, b.vx);
            this.hurt(target, b.owner === 2 ? 8 : 14, Math.cos(a) * 90, Math.sin(a) * 90);
            this.bullets.splice(i, 1); break;
          }
        }
      } else {
        for (let k = this.enemies.length - 1; k >= 0; k--) {
          const e = this.enemies[k];
          if (!e.alive) continue;
          if (dist(b.x, b.y, e.x, e.y) < e.r + b.r) {
            e.hp -= 25;
            this.burst(b.x, b.y, e.hue + 30, 8, 2, 140);
            this.playHitSound();
            this.bullets.splice(i, 1);
            if (e.hp <= 0) {
              e.alive = false;
              this.enemiesRemaining--;
              const points =
                e.kind === "mothership"
                  ? 8000 + this.wave * 700
                  : e.kind === "elite"
                    ? 1400 + this.wave * 120
                    : 450 + this.wave * 35;
              
              let nearest: PlayerEntity | null = null;
              let nd = Infinity;
              for (const p of this.players) {
                if (!p.alive) continue;
                const d = dist(e.x, e.y, p.x, p.y);
                if (d < nd) { nd = d; nearest = p; }
              }
              if (nearest) {
                nearest.score += points;
                nearest.kills += 1;
              }
              
              this.burst(e.x, e.y, e.hue, e.kind === "mothership" ? 50 : 25, e.kind === "mothership" ? 5 : 4, e.kind === "mothership" ? 400 : 240);
              this.popups.push({ x: e.x, y: e.y - 20, text: `+${points}`, life: 1.0, hue: e.kind === "mothership" ? 30 : 60 });
              if (e.kind === "mothership") this.playMothershipObliteratedSound();
              else this.playEnemyObliteratedSound();
              
              const spawnChance = e.kind === "mothership" ? 1.0 : e.kind === "elite" ? 0.45 : this.wave >= 2 ? 0.06 : 0;
              if (Math.random() < spawnChance) {
                this.spawnPowerup(e.x, e.y);
              }

              if (e.kind === "mothership") {
                this.shake = 18; this.flash = 0.6;
                this.mothershipAlive = false;
              }
            }
            break;
          }
        }
      }
    }

    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.x += t.vx * dt; t.y += t.vy * dt;
      t.life -= dt;
      if (t.life <= 0) this.trails.splice(i, 1);
    }
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
    for (const b of this.bullets) bullets.push(b.x, b.y, b.vx, b.vy, b.r, b.owner);
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
        hp: p0.hp, maxHp: p0.maxhp, dashCd: p0.dashCd, dashMax: p0.dashMax, score: p0.score, kills: p0.kills,
      },
      guest: {
        x: p1.x, y: p1.y, aim: p1.aim, alive: p1.alive,
        hp: p1.hp, maxHp: p1.maxhp, dashCd: p1.dashCd, dashMax: p1.dashMax, score: p1.score, kills: p1.kills,
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

  private drawBackground(dt: number) {
    const ctx = this.ctx;
    const themeA = this.planetThemes[this.currentPlanetIdx];
    const themeB = this.planetThemes[this.nextPlanetIdx];
    
    const bgA = themeA.bg;
    const bgB = themeB.bg;

    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    if (this.pTransitionState === "warp") {
      g.addColorStop(0, bgB[0]); bgB[1] && g.addColorStop(1, bgB[1]);
    } else {
      g.addColorStop(0, bgA[0]); bgA[1] && g.addColorStop(1, bgA[1]);
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);

    const currentNebulae = this.pTransitionState === "warp" ? themeB.neb : themeA.neb;
    for (let i = 0; i < currentNebulae.length; i++) {
      const nColor = currentNebulae[i];
      const rx = (0.2 + i * 0.3) * this.W + Math.sin(performance.now() / 3000 + i) * 60;
      const ry = (0.3 + i * 0.2) * this.H + Math.cos(performance.now() / 4000 + i) * 40;
      const rr = 0.55 * Math.max(this.W, this.H);
      const rg = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
      rg.addColorStop(0, nColor);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg; ctx.fillRect(0, 0, this.W, this.H);
    }

    for (const L of this.layers) {
      ctx.fillStyle = `rgba(220,220,255,${L.a})`;
      for (const s of L.arr) {
        let speedMult = 1.0;
        if (this.pTransitionState === "warp") {
          speedMult = 28.0;
        } else if (this.pTransitionState === "levitating") {
          speedMult = 3.5;
        }

        s.y += L.sp * speedMult * dt;
        s.tw += dt * 3;
        
        if (s.y > this.H + 10) {
          s.y = -10;
          s.x = Math.random() * this.W;
        }
        
        ctx.globalAlpha = L.a * (0.6 + 0.4 * Math.sin(s.tw));
        ctx.beginPath();
        if (this.pTransitionState === "warp") {
          ctx.ellipse(s.x, s.y, s.r * 0.8, s.r * 15, 0, 0, TAU);
        } else {
          ctx.arc(s.x, s.y, s.r, 0, TAU);
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayer(p: PlayerEntity) {
    const ctx = this.ctx;
    if (!p.alive) return;
    if (p.invuln > 0 && p.hurtCd > 0 && Math.floor(performance.now() / 70) % 2 === 0) return;
    ctx.save(); ctx.translate(p.x, p.y);

    if (p.dashTime > 0) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = `hsla(${p.hue},85%,60%,0.4)`;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 8, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.shadowColor = `hsla(${p.hue},85%,55%,0.85)`; ctx.shadowBlur = 22;
    const grd = ctx.createRadialGradient(-4, -4, 2, 0, 0, p.r + 4);
    const h = p.hue;
    grd.addColorStop(0, `hsl(${h},95%,92%)`);
    grd.addColorStop(0.5, `hsl(${h},85%,55%)`);
    grd.addColorStop(1, `hsl(${h},60%,22%)`);
    ctx.fillStyle = grd;

    ctx.beginPath();
    const pts = 14;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * TAU;
      const rr = p.r + Math.sin(a * 3 + p.wob) * 2.4 + Math.sin(a * 5 - p.wob * 1.3) * 1.5;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = `hsl(${h},60%,22%)`;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + p.wob * 0.3;
      ctx.beginPath(); ctx.arc(Math.cos(a) * (p.r + 1), Math.sin(a) * (p.r + 1), 3.5, 0, TAU); ctx.fill();
    }

    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(0, 0, p.r * 0.52, 0, TAU); ctx.fill();

    const ex = Math.cos(p.aim) * p.r * 0.24;
    const ey = Math.sin(p.aim) * p.r * 0.24;
    ctx.fillStyle = "#1a1a2e";
    ctx.beginPath(); ctx.arc(ex, ey, p.r * 0.26, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.arc(ex - 2, ey - 2, 2, 0, TAU); ctx.fill();

    if (p.powerupKind === "shield") {
      ctx.strokeStyle = "rgba(6,182,212,0.8)";
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgb(6,182,212)";
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(0, 0, p.r + 12, 0, TAU);
      ctx.stroke();
    } else if (p.powerupKind === "double") {
      ctx.strokeStyle = "rgba(234,179,8,0.7)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, p.r + 10, p.wob, p.wob + TAU);
      ctx.stroke();
    } else if (p.powerupKind === "rapidfire") {
      ctx.strokeStyle = "rgba(236,72,153,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const rSize = p.r + 10 + Math.sin(p.wob * 2) * 3;
      ctx.arc(0, 0, rSize, 0, TAU);
      ctx.stroke();
    } else if (p.powerupKind === "nova") {
      ctx.strokeStyle = "rgba(34,211,238,0.85)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, p.r + 14 + Math.sin(p.wob * 3) * 2, p.wob, p.wob + TAU);
      ctx.stroke();
    }

    if (p.invuln > 0 && p.hurtCd <= 0) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.strokeStyle = `rgba(34,211,238,${0.5 + 0.4 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(34,211,238,0.8)"; ctx.shadowBlur = 14;
    }
    ctx.restore();
  }

  private drawEnemy(e: Enemy) {
    if (!e.alive) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(e.x, e.y);
    const r = e.r;
    const hue = e.hue;

    const bodyMid   = `hsl(${hue}, 92%, 44%)`;
    const bodyDark  = `hsl(${hue}, 76%, 22%)`;
    const bodyLight = `hsl(${hue}, 85%, 82%)`;
    const glass     = `hsl(${hue}, 75%, 65%)`;
    const blink     = Math.sin(Date.now() / 120) * 0.5 + 0.5;

    ctx.fillStyle = bodyMid;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * (e.kind === "mothership" ? 1.72 : 1.5), r * 0.72, 0, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = bodyDark;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.16, r * (e.kind === "mothership" ? 1.52 : 1.3), r * 0.38, 0, 0, Math.PI);
    ctx.fill();

    ctx.fillStyle = bodyLight;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.05);
    ctx.quadraticCurveTo(r * 0.74, -r * 0.42, r * 0.38, r * 0.05);
    ctx.quadraticCurveTo(0, r * 0.24, -r * 0.38, r * 0.05);
    ctx.quadraticCurveTo(-r * 0.74, -r * 0.42, 0, -r * 1.05);
    ctx.fill();

    ctx.fillStyle = glass;
    ctx.globalAlpha = 0.94;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.32, r * 0.56, r * 0.42, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, -r * 0.46, r * 0.16, r * 0.08, -0.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = `rgba(255,200,0,${0.55 + 0.45 * blink})`;
    ctx.shadowColor = "rgba(255,166,0,0.85)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, -r * 0.82, (e.kind === "mothership" ? 5.4 : 3.6), 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    for (let i = -1; i <= 1; i += 2) {
      ctx.fillStyle = `rgba(255,255,255,${0.52 + 0.32 * blink})`;
      ctx.beginPath();
      ctx.arc(i * r * 0.86, r * 0.02, (e.kind === "mothership" ? 4 : 2.5), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPowerup(p: PowerUp) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(p.x, p.y);

    const scale = 1.0 + Math.sin(p.wob * 2) * 0.12;
    const pulseRad = p.r * scale;

    let baseHue = 190;
    let label = "S";
    if (p.kind === "double") { baseHue = 50; label = "2X"; }
    else if (p.kind === "rapidfire") { baseHue = 320; label = "RF"; }
    else if (p.kind === "nova") { baseHue = 190; label = "N"; }
    ctx.shadowColor = `hsl(${baseHue},100%,50%)`;
    ctx.shadowBlur = 16;
    ctx.fillStyle = `hsla(${baseHue},95%,45%,0.3)`;
    ctx.strokeStyle = `hsl(${baseHue},100%,70%)`;
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    const sides = 6;
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * TAU + p.wob * 0.5;
      const hx = Math.cos(angle) * pulseRad;
      const hy = Math.sin(angle) * pulseRad;
      i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px 'Share Tech Mono',monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);

    ctx.restore();
  }

  private drawBullet(b: Bullet) {
    const ctx = this.ctx;
    const a = Math.atan2(b.vy, b.vx);
    const len = b.owner === 2 ? 18 : 28;
    const tailX = b.x - Math.cos(a) * len;
    const tailY = b.y - Math.sin(a) * len;
    const core = b.owner === 2 ? "#ffc800" : b.owner === 0 ? "#58cc02" : "#1cb0f6";
    const glow = b.owner === 2 ? "rgba(255, 170, 0, 0.9)" : b.owner === 0 ? "rgba(88, 204, 2, 0.85)" : "rgba(28, 176, 246, 0.85)";

    ctx.save();
    ctx.lineCap = "round";
    ctx.shadowColor = glow;
    ctx.shadowBlur = b.owner === 2 ? 14 : 18;
    const trail = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    trail.addColorStop(0, "rgba(255,255,255,0)");
    trail.addColorStop(0.45, glow);
    trail.addColorStop(1, "#ffffff");
    ctx.strokeStyle = trail;
    ctx.lineWidth = b.owner === 2 ? 4 : 5;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.72, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private render(dt: number) {
    const ctx = this.ctx;
    this.drawBackground(dt);
    ctx.save();
    if (this.shake > 0) ctx.translate(rand(-this.shake, this.shake) * 0.4, rand(-this.shake, this.shake) * 0.4);

    ctx.lineCap = "round";
    for (const t of this.trails) {
      const a = clamp(t.life / t.max, 0, 1);
      const tx = t.x + t.vx * 3.5;
      const ty = t.y + t.vy * 3.5;
      ctx.globalAlpha = a * 0.92;
      ctx.strokeStyle = `hsl(${t.hue},92%,67%)`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = `hsl(${p.hue},90%,62%)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const p of this.powerups) {
      this.drawPowerup(p);
    }

    for (const b of this.bullets) {
      if (b.owner === 2) this.drawBullet(b);
    }
    for (const b of this.bullets) {
      if (b.owner !== 2) this.drawBullet(b);
    }

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

    if (this.waveMessageTimer > 0) {
      ctx.save();
      const fontSize = Math.min(22, Math.max(15, this.W * 0.026));
      ctx.font = `800 ${fontSize}px 'Baloo 2', system-ui`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.fillText(this.waveMessage, this.W / 2, this.H * 0.28);
      ctx.restore();
    }
    
    if (this.pTransitionState === "levitating" || this.pTransitionState === "warp") {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, this.W, this.H);
      
      const titleSize = Math.min(14, Math.max(11, this.W * 0.018));
      ctx.font = `bold ${titleSize}px 'Share Tech Mono', monospace`;
      ctx.fillStyle = "#38bdf8";
      ctx.textAlign = "center";
      ctx.fillText("WARP JUMP", this.W / 2, this.H * 0.45);
      
      const destSize = Math.min(20, Math.max(13, this.W * 0.026));
      ctx.font = `bold ${destSize}px 'Baloo 2', system-ui`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(this.planetThemes[this.nextPlanetIdx].name.toUpperCase(), this.W / 2, this.H * 0.52);
      ctx.restore();
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.6})`;
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

    for (let i = 0; i < s.enemies.length; i += 9) {
      const ex = s.enemies[i], ey = s.enemies[i + 1], er = s.enemies[i + 2];
      const ehp = s.enemies[i + 3], emaxhp = s.enemies[i + 4], ehue = s.enemies[i + 5];
      const eaim = s.enemies[i + 6], ealive = s.enemies[i + 7] === 1, ekind = s.enemies[i + 8];
      if (!ealive) continue;
      const kindStr = ekind === 2 ? "mothership" as const : ekind === 1 ? "elite" as const : "grunt" as const;
      const tempEnemy: Enemy = {
        x: ex, y: ey, vx: 0, vy: 0, r: er, hp: ehp, maxhp: emaxhp,
        hue: ehue, shootCd: 0, fireRate: 1, aim: eaim, alive: true, wob: 0, kind: kindStr,
      };
      this.drawEnemy(tempEnemy);
    }

    for (let i = 0; i < s.bullets.length; i += 6) {
      const bx = s.bullets[i], by = s.bullets[i + 1], bvx = s.bullets[i + 2], bvy = s.bullets[i + 3], br = s.bullets[i + 4], owner = s.bullets[i + 5] as 0 | 1 | 2;
      this.drawBullet({ x: bx, y: by, vx: bvx, vy: bvy, r: br, life: 1, owner });
    }

    const hP = { ...makePlayer(84), x: s.host.x, y: s.host.y, aim: s.host.aim, alive: s.host.alive, hue: 84 };
    const gP = { ...makePlayer(200), x: s.guest.x, y: s.guest.y, aim: s.guest.aim, alive: s.guest.alive, hue: 200 };
    if (s.state === "playing" || s.state === "over") {
      this.drawPlayer(hP);
      this.drawPlayer(gP);
    }
    ctx.restore();
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