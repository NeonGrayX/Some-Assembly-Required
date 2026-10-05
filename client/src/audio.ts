/** Tiny synthesized sound effects, so the game ships without audio files for now. */
export class Sfx {
  private ctx: AudioContext | null = null;
  /** Every sound goes through this, so volume and mute apply to all of them. */
  private master: GainNode | null = null;
  private volume = 1;
  private muted = false;

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
    }
    void this.ctx.resume();
  }

  /** The audio context and the master volume, for voice chat to play through; null until unlocked. */
  output(): { ctx: AudioContext; out: AudioNode } | null {
    return this.ctx && this.master ? { ctx: this.ctx, out: this.master } : null;
  }

  /** Master volume 0..1 and mute, from the settings menu. */
  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    // Squared, so the slider feels even to the ear rather than all at the top.
    this.master?.gain.setValueAtTime(this.muted ? 0 : this.volume ** 2, this.ctx!.currentTime);
  }

  private gain(at: number, peak: number, decay: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    g.connect(this.master!);
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

  /** The meeting bell: a bright ring with a long tail. */
  bell(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, peak] of [
      [880, 0.25],
      [1320, 0.12],
      [2200, 0.06],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(this.gain(t, peak, 2.2));
      o.start(t);
      o.stop(t + 2.3);
    }
  }

  /** A soft rustle, for something sneaky happening nearby. */
  rustle(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000;
    src.connect(filter).connect(this.gain(t, 0.25 * volume, 0.4));
    src.start(t);
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

  /** White noise, `seconds` long, shaped by `envelope` (0..1 through the sound). */
  private noise(seconds: number, envelope: (t: number) => number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * envelope(i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /**
   * A cartoon scream ("aaaah!"): a buzzing voice through two vowel formants, sliding down with
   * a wobble. `pitch` varies it per player (around 1).
   */
  scream(volume = 1, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(620 * pitch, t);
    voice.frequency.linearRampToValueAtTime(760 * pitch, t + 0.12);
    voice.frequency.exponentialRampToValueAtTime(330 * pitch, t + 0.75);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 9;
    const depth = ctx.createGain();
    depth.gain.value = 25 * pitch;
    wobble.connect(depth).connect(voice.frequency);
    const out = this.gain(t, 0.32 * volume, 0.8);
    for (const [f, q] of [
      [850, 6],
      [1250, 8],
    ] as const) {
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = f;
      formant.Q.value = q;
      voice.connect(formant).connect(out);
    }
    voice.start(t);
    wobble.start(t);
    voice.stop(t + 0.82);
    wobble.stop(t + 0.82);
  }

  /** Someone going down: a grunt, then the thud of landing. */
  oof(volume = 1, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(240 * pitch, t);
    voice.frequency.exponentialRampToValueAtTime(130 * pitch, t + 0.16);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    voice.connect(filter).connect(this.gain(t, 0.25 * volume, 0.18));
    voice.start(t);
    voice.stop(t + 0.2);
    setTimeout(() => this.thump(volume), 320);
  }

  /** Woof woof. */
  bark(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    for (const delay of [0, 0.22]) {
      const t = ctx.currentTime + delay;
      const voice = ctx.createOscillator();
      voice.type = 'sawtooth';
      voice.frequency.setValueAtTime(520, t);
      voice.frequency.exponentialRampToValueAtTime(280, t + 0.11);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 2;
      voice.connect(filter).connect(this.gain(t, 0.35 * volume, 0.13));
      voice.start(t);
      voice.stop(t + 0.14);
    }
  }

  /** A startled little whine. */
  yelp(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.18);
    o.connect(this.gain(t, 0.25 * volume, 0.2));
    o.start(t);
    o.stop(t + 0.21);
  }

  /** A dog biscuit going down: a few dry crunches. */
  crunch(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    for (let i = 0; i < 3; i++) {
      const t = ctx.currentTime + i * 0.12;
      const src = this.noise(0.07, (x) => (1 - x) ** 3);
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1800;
      src.connect(filter).connect(this.gain(t, 0.3 * volume, 0.08));
      src.start(t);
    }
  }
}
