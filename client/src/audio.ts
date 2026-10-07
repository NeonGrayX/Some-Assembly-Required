import type { HideoutKind } from '@sar/shared';

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

  /**
   * A hiding place opening or shutting, to go with its animation: `travel` is how long the
   * part takes to move, so a door's knock lands as it closes. Each kind sounds of what it is
   * made of: a fridge's seal, a wooden door's creak, a steel locker's clang, a drawer's
   * slide, a rug's swish.
   */
  hideout(kind: HideoutKind, open: boolean, travel: number, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const end = t + travel;
    const v = volume;
    switch (kind) {
      case 'fridge':
        if (open) {
          // The seal letting go, then a little air.
          this.knock(t, 140, 0.25 * v, 0.06);
          this.hiss(t + 0.02, 0.25, 'bandpass', 1400, 0.12 * v);
        } else {
          // A puff of air, then the seal catching with a soft thud.
          this.hiss(t, travel, 'lowpass', 700, 0.06 * v);
          this.knock(end - 0.02, 95, 0.4 * v, 0.12);
          this.hiss(end - 0.02, 0.06, 'lowpass', 400, 0.15 * v);
        }
        break;
      case 'cabinet':
        // Wooden door on old hinges.
        this.creak(t, travel * (open ? 1 : 0.8), open ? 1 : 0.85, 0.3 * v);
        if (open) this.knock(t, 900, 0.06 * v, 0.03);
        else this.woodKnock(end, 0.35 * v);
        break;
      case 'locker':
        // A steel door: the latch, a squeal, and a clang when it shuts.
        this.latch(t, 0.18 * v);
        this.creak(t + 0.04, travel * 0.8, 1.8, 0.15 * v);
        if (!open) this.clang(end, [310, 487, 731, 1043], 0.22 * v, 0.5);
        break;
      case 'drawer':
        // Runners sliding, and a knock at the end of the travel.
        this.slide(t, travel, open ? 900 : 1300, open ? 1600 : 700, 0.14 * v);
        this.woodKnock(end, (open ? 0.18 : 0.3) * v);
        break;
      case 'mailbox':
        // A tin flap: a small squeak and a clink.
        this.squeak(t, travel * 0.7, open ? 1300 : 1700, open ? 1700 : 1200, 0.07 * v);
        this.clang(end, [1180, 1730, 2490], 0.12 * v, 0.25);
        break;
      case 'toolbox':
        // Two catches snapping, then the pressed-steel lid.
        if (open) {
          this.latch(t, 0.2 * v);
          this.latch(t + 0.07, 0.18 * v);
          this.squeak(t + 0.1, travel * 0.6, 900, 1150, 0.04 * v);
        } else {
          this.clang(end, [520, 790, 1210, 1730], 0.18 * v, 0.3);
          this.latch(end + 0.12, 0.18 * v);
          this.latch(end + 0.19, 0.16 * v);
        }
        break;
      case 'chest':
        // A heavy wooden lid: a long low creak, and a deep thud when it drops.
        this.creak(t, travel * 1.1, open ? 0.7 : 0.6, 0.3 * v);
        if (!open) this.knock(end, 75, 0.3 * v, 0.2);
        this.woodKnock(open ? t : end, (open ? 0.1 : 0.2) * v);
        break;
      case 'rug':
        // Fabric swished back, then laid flat with a soft pat.
        this.hiss(t, travel * 1.1, 'bandpass', open ? 2200 : 1600, 0.25 * v, 0.8);
        this.hiss(end, 0.08, 'lowpass', 500, (open ? 0.25 : 0.35) * v);
        break;
      case 'cushion':
        // A soft whump, as air goes out of it or it flops back down.
        this.hiss(t, travel * 0.8, 'lowpass', 900, 0.14 * v, 0.9);
        this.knock(open ? t : end, 110, (open ? 0.15 : 0.25) * v, 0.1);
        this.hiss(open ? t : end, 0.12, 'lowpass', 350, 0.25 * v);
        break;
    }
  }

  /** A short dull knock at `f` Hz, starting at `at`. */
  private knock(at: number, f: number, peak: number, decay: number): void {
    const o = this.ctx!.createOscillator();
    o.frequency.setValueAtTime(f * 1.6, at);
    o.frequency.exponentialRampToValueAtTime(f, at + decay * 0.5);
    o.connect(this.gain(at, peak, decay));
    o.start(at);
    o.stop(at + decay + 0.01);
  }

  /** Wood meeting wood: a hollow knock and a tick of noise. */
  private woodKnock(at: number, peak: number): void {
    this.knock(at, 180, peak, 0.09);
    this.knock(at, 420, peak * 0.4, 0.05);
    this.hiss(at, 0.03, 'bandpass', 2500, peak * 0.5);
  }

  /** Filtered noise from `at` for `seconds`, swelling in and out (`attack` 0..1 shapes it). */
  private hiss(
    at: number,
    seconds: number,
    type: BiquadFilterType,
    f: number,
    peak: number,
    attack = 0.05,
  ): void {
    const ctx = this.ctx!;
    const src = this.noise(seconds, (x) =>
      x < attack * 0.5 ? x / (attack * 0.5) : ((1 - x) / (1 - attack * 0.5)) ** 2,
    );
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = type === 'bandpass' ? 0.8 : 0.7;
    const g = ctx.createGain();
    g.gain.value = peak;
    src.connect(filter).connect(g).connect(this.master!);
    src.start(at);
  }

  /** Something sliding on runners: noise swept from `from` Hz to `to` Hz. */
  private slide(at: number, seconds: number, from: number, to: number, peak: number): void {
    const ctx = this.ctx!;
    const src = this.noise(
      seconds,
      (x) => Math.sin(Math.PI * x) ** 0.5 * (0.7 + 0.3 * Math.random()),
    );
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + seconds);
    const g = ctx.createGain();
    g.gain.value = peak;
    src.connect(filter).connect(g).connect(this.master!);
    src.start(at);
  }

  /** A hinge creaking: a rough buzz whose pitch stutters, `pitch` around 1. */
  private creak(at: number, seconds: number, pitch: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    // The stick-slip of a dry hinge: the pitch jumps about rather than gliding.
    for (let i = 0, n = Math.max(3, Math.round(seconds * 30)); i <= n; i++)
      o.frequency.setValueAtTime(
        (70 + 50 * Math.sin((i / n) * Math.PI) + Math.random() * 25) * pitch,
        at + (seconds * i) / n,
      );
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100 * pitch;
    filter.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + seconds * 0.2);
    g.gain.setValueAtTime(peak, at + seconds * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    g.connect(this.master!);
    o.connect(filter).connect(g);
    o.start(at);
    o.stop(at + seconds + 0.01);
  }

  /** A small metal squeak gliding from `from` Hz to `to` Hz. */
  private squeak(at: number, seconds: number, from: number, to: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + seconds * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    g.connect(this.master!);
    o.connect(g);
    o.start(at);
    o.stop(at + seconds + 0.01);
  }

  /** Sheet metal struck: a few inharmonic partials ringing out. */
  private clang(at: number, partials: number[], peak: number, decay: number): void {
    partials.forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      o.frequency.value = f;
      o.connect(this.gain(at, peak / (i + 1), decay / (1 + i * 0.4)));
      o.start(at);
      o.stop(at + decay + 0.01);
    });
    this.hiss(at, 0.03, 'highpass', 3000, peak * 0.6);
  }

  /** A sprung catch snapping: a sharp metallic tick. */
  private latch(at: number, peak: number): void {
    const o = this.ctx!.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(3200, at);
    o.frequency.exponentialRampToValueAtTime(1400, at + 0.02);
    o.connect(this.gain(at, peak * 0.5, 0.03));
    o.start(at);
    o.stop(at + 0.035);
    this.hiss(at, 0.02, 'highpass', 4000, peak);
  }
}
