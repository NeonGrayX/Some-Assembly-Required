/** Tiny synthesized sound effects, so the game ships without audio files for now. */
export class Sfx {
  private ctx: AudioContext | null = null;

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  private gain(at: number, peak: number, decay: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    g.connect(ctx.destination);
    return g;
  }

  /** Short plastic click. `volume` 0..1 lets distant sounds be quieter. */
  click(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.04);
    o.connect(this.gain(t, 0.12 * volume, 0.06));
    o.start(t);
    o.stop(t + 0.07);
  }

  /** A clattering crash: a burst of filtered noise plus a few random clicks. */
  crash(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    src.connect(filter).connect(this.gain(t, 0.35 * volume, 0.35));
    src.start(t);
    for (let i = 0; i < 4; i++) setTimeout(() => this.click(volume * 0.6), 30 + i * 45);
  }

  thump(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.1);
    o.connect(this.gain(t, 0.2 * volume, 0.12));
    o.start(t);
    o.stop(t + 0.13);
  }
}
