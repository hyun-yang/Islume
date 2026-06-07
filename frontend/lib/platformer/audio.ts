// Procedural sound for the platformer. Uses Web Audio API directly so we
// don't pull in a runtime audio dependency (and avoid the supply-chain
// release-age gate). Browser autoplay policy requires user gesture before
// the AudioContext can produce sound — call `sound.unlock()` on first input.

const MASTER_VOLUME = 0.3;
const BGM_VOLUME = 0.04;
const STORAGE_MUTE_KEY = "islume:platformer:muted";

type OscType = "sine" | "square" | "triangle" | "sawtooth";

class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private muted = false;
  private bgmTimer: ReturnType<typeof setTimeout> | null = null;
  private currentBgm: string | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      const stored = window.localStorage?.getItem(STORAGE_MUTE_KEY);
      if (stored === "1") this.muted = true;
    }
  }

  unlock(): void {
    if (this.ctx) return;
    if (typeof window === "undefined") return;
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.masterGain.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = BGM_VOLUME;
    this.bgmGain.connect(this.masterGain);
  }

  isMuted(): boolean { return this.muted; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) this.masterGain.gain.value = muted ? 0 : MASTER_VOLUME;
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(STORAGE_MUTE_KEY, muted ? "1" : "0");
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // Single tone with envelope + optional pitch sweep.
  private tone(
    freq: number,
    duration: number,
    opts: { type?: OscType; sweepTo?: number; volume?: number; delayMs?: number } = {},
  ): void {
    const ctx = this.ctx;
    const dest = this.masterGain;
    if (!ctx || !dest) return;
    const start = ctx.currentTime + (opts.delayMs ?? 0) / 1000;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(freq, start);
    if (opts.sweepTo !== undefined) {
      osc.frequency.linearRampToValueAtTime(opts.sweepTo, start + duration);
    }
    const g = ctx.createGain();
    const vol = opts.volume ?? 0.25;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private noise(duration: number, volume: number): void {
    const ctx = this.ctx;
    const dest = this.masterGain;
    if (!ctx || !dest) return;
    const samples = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / samples);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(dest);
    src.start();
  }

  // ---- SFX ----
  jump(): void {
    this.tone(440, 0.10, { type: "square", sweepTo: 880, volume: 0.18 });
  }
  shell(): void {
    this.tone(1320, 0.10, { type: "triangle", volume: 0.16 });
    this.tone(1760, 0.08, { type: "triangle", volume: 0.10, delayMs: 30 });
  }
  heart(): void {
    [523, 659, 784].forEach((f, i) =>
      this.tone(f, 0.10, { type: "sine", volume: 0.18, delayMs: i * 80 }));
  }
  banana(): void {
    this.tone(880, 0.20, { type: "sawtooth", sweepTo: 220, volume: 0.16 });
  }
  pineapple(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, i === 3 ? 0.24 : 0.06, { type: "square", volume: 0.16, delayMs: i * 70 }));
  }
  stomp(): void {
    this.tone(220, 0.08, { type: "square", sweepTo: 80, volume: 0.18 });
    this.noise(0.05, 0.05);
  }
  damage(): void {
    this.tone(180, 0.20, { type: "sawtooth", sweepTo: 60, volume: 0.20 });
    this.noise(0.10, 0.08);
  }
  bump(): void {
    this.tone(120, 0.10, { type: "sine", volume: 0.25 });
  }
  flag(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, i === 3 ? 0.30 : 0.08, { type: "triangle", volume: 0.20, delayMs: i * 80 }));
  }
  bossCleared(): void {
    [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, i === 6 ? 0.50 : 0.08, { type: "square", volume: 0.16, delayMs: i * 60 }));
  }

  // ---- BGM ----
  // Simple arpeggio loop per stage. Volume is well below SFX so it doesn't
  // step on game cues.
  startBgm(stage: "stage1" | "stage2" | "stage3"): void {
    if (!this.ctx || !this.bgmGain) return;
    if (this.currentBgm === stage) return;
    this.stopBgm();
    this.currentBgm = stage;

    const notes =
      stage === "stage1" ? [262, 330, 392, 523, 392, 330, 392, 523]
        : stage === "stage2" ? [220, 262, 330, 440, 392, 330, 262, 196]
        : [165, 196, 247, 330, 392, 330, 247, 196];

    let i = 0;
    const stepMs = 320;
    const tick = () => {
      if (this.currentBgm !== stage || !this.ctx || !this.bgmGain) return;
      const t = this.ctx.currentTime;
      const f = notes[i % notes.length];
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(g).connect(this.bgmGain);
      osc.start(t);
      osc.stop(t + 0.32);
      i++;
      this.bgmTimer = setTimeout(tick, stepMs);
    };
    tick();
  }

  stopBgm(): void {
    this.currentBgm = null;
    if (this.bgmTimer) {
      clearTimeout(this.bgmTimer);
      this.bgmTimer = null;
    }
  }
}

export const sound = new SoundManager();
