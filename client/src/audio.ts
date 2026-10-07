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

  /**
   * Bricks breaking off and scattering: a dull hit, then a clatter of plastic landing, longer
   * and busier the more pieces there are.
   */
  crash(volume = 1, count = 3): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.knock(t, 160, 0.3 * volume, 0.1);
    this.hiss(t, 0.08, 'lowpass', 1200, 0.3 * volume);
    const n = Math.min(24, 5 + count * 3);
    for (let i = 0; i < n; i++) {
      // Thinning out as the pieces come to rest.
      const at = t + 0.03 + 0.5 * (i / n) ** 1.6 + Math.random() * 0.03;
      this.tick(at, 1500 + Math.random() * 2500, (0.2 - 0.12 * (i / n)) * volume);
    }
  }

  /** The meeting bell: a clapper strike, then a bright ring with a long tail. */
  bell(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.02, 'highpass', 2500, 0.3);
    this.tick(t, 3500, 0.15);
    // A real bell's partials are not quite in tune with one another.
    for (const [f, peak, decay] of [
      [880, 0.25, 2.2],
      [1327, 0.12, 1.6],
      [2210, 0.07, 1.1],
      [2960, 0.03, 0.6],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(this.gain(t, peak, decay));
      o.start(t);
      o.stop(t + decay + 0.1);
    }
  }

  /** Paper being shuffled nearby: a soft, crinkly rustle, for something sneaky happening. */
  rustle(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    this.paper(ctx.currentTime, 0.4, 0.2 * volume);
  }

  /** Something heavy and soft landing on the floor: a low thud with a bit of body to it. */
  thump(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.knock(t, 60, 0.3 * volume, 0.14);
    this.hiss(t, 0.1, 'lowpass', 500, 0.35 * volume);
  }

  /**
   * The electrical panel blowing: a crackling zap, a bang, and the house's hum sagging away to
   * nothing as the lights die.
   */
  powerOut(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 7; i++)
      this.hiss(t + i * 0.035 + Math.random() * 0.02, 0.03, 'highpass', 3500, 0.25);
    this.knock(t + 0.24, 70, 0.35, 0.25);
    this.hum(t, 1.4, 100, 35, 0.12);
  }

  /** The panel fixed: the breaker clunks back up and the hum swells in, with a flicker of ticks. */
  powerOn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.knock(t, 110, 0.3, 0.12);
    this.tick(t + 0.01, 900, 0.2);
    this.hum(t + 0.05, 0.9, 50, 100, 0.08);
    for (const at of [0.15, 0.28, 0.33]) this.tick(t + at, 2400, 0.06);
  }

  /** Mains hum, gliding from `from` to `to` Hz over `seconds` and fading out. */
  private hum(at: number, seconds: number, from: number, to: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    o.connect(filter).connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + seconds + 0.05);
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

  /** Woof woof: a bark has a breathy burst at its front and a growly voice behind it. */
  bark(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    for (const delay of [0, 0.24]) {
      const t = ctx.currentTime + delay;
      const voice = ctx.createOscillator();
      voice.type = 'sawtooth';
      voice.frequency.setValueAtTime(380, t);
      voice.frequency.linearRampToValueAtTime(560, t + 0.03);
      voice.frequency.exponentialRampToValueAtTime(260, t + 0.13);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, t);
      filter.frequency.exponentialRampToValueAtTime(600, t + 0.13);
      filter.Q.value = 1.5;
      voice.connect(filter).connect(this.gain(t + 0.01, 0.3 * volume, 0.14));
      voice.start(t);
      voice.stop(t + 0.16);
      this.hiss(t, 0.06, 'bandpass', 1800, 0.18 * volume, 0.2);
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

  /** A contented little whine, up and down, from a dog being patted. */
  whine(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(820, t);
    o.frequency.linearRampToValueAtTime(1100, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.42);
    o.connect(this.gain(t, 0.14 * volume, 0.44));
    o.start(t);
    o.stop(t + 0.45);
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

  /** A brick clicking onto a build: a sharp plastic snap with a short hollow ring. */
  snap(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.tick(t, 3200, 0.3 * volume);
    this.tick(t + 0.012, 2400, 0.2 * volume);
    this.knock(t, 1100, 0.1 * volume, 0.05);
  }

  /** A loose brick, or a whole build, picked up: a light plastic tick and a little swish. */
  pickUp(volume = 1, count = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.tick(t, 1800, 0.1 * volume);
    if (count > 1) this.tick(t + 0.03, 1300, 0.08 * volume);
    this.hiss(t, 0.12, 'lowpass', 1500, 0.08 * volume, 0.4);
  }

  /**
   * Something let go of and landing: one brick clacks on the floor and bounces once; a build
   * of many lands with a heavier clunk and a rattle of its bricks.
   */
  drop(volume = 1, count = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    if (count <= 1) {
      this.tick(t, 2200, 0.25 * volume);
      this.knock(t, 420, 0.12 * volume, 0.05);
      this.tick(t + 0.07, 2600, 0.1 * volume);
      return;
    }
    const size = Math.min(1, count / 20);
    this.knock(t, 150 - 60 * size, (0.25 + 0.2 * size) * volume, 0.1 + 0.08 * size);
    this.hiss(t, 0.06, 'lowpass', 900, 0.2 * volume);
    for (let i = 0, n = Math.min(8, 2 + count); i < n; i++)
      this.tick(t + 0.01 + Math.random() * 0.15, 1800 + Math.random() * 1800, 0.12 * volume);
  }

  /** A brick dropped back into a bin full of them: a plastic rattle in a hollow box. */
  binDrop(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.knock(t, 480, 0.12 * volume, 0.12);
    for (let i = 0; i < 5; i++)
      this.tick(t + i * 0.035 + Math.random() * 0.02, 2000 + Math.random() * 2000, 0.16 * volume);
  }

  /** A build settling onto its base plate: a firm clunk and the click of it seating. */
  anchor(volume = 1, count = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const size = Math.min(1, count / 20);
    this.knock(t, 110 - 40 * size, (0.3 + 0.2 * size) * volume, 0.14);
    this.hiss(t, 0.05, 'lowpass', 800, 0.25 * volume);
    this.tick(t + 0.02, 2600, 0.2 * volume);
    this.tick(t + 0.035, 2000, 0.15 * volume);
  }

  /** A page picked up or passed about: a quick flick of paper. */
  page(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    this.paper(ctx.currentTime, 0.16, 0.3 * volume);
  }

  /** A page pinned up: the pin pushed into cork, and the page settling against the board. */
  pin(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.04, 'lowpass', 700, 0.4 * volume, 0.3);
    this.knock(t, 300, 0.12 * volume, 0.04);
    this.tick(t, 2800, 0.06 * volume);
    this.paper(t + 0.04, 0.12, 0.15 * volume);
  }

  /** A big button pressed: it goes down with a tick and comes back up with a tock. */
  button(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.tick(t, 1400, 0.2 * volume);
    this.knock(t, 500, 0.1 * volume, 0.04);
    this.knock(t + 0.09, 320, 0.15 * volume, 0.05);
    this.tick(t + 0.09, 900, 0.1 * volume);
  }

  /** A hand in the treat bag: the bag crinkles and the biscuits rattle. */
  treats(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.paper(t, 0.3, 0.25 * volume, 5500);
    for (let i = 0; i < 4; i++) {
      const at = t + 0.05 + i * 0.05 + Math.random() * 0.03;
      this.knock(at, 700 + Math.random() * 300, 0.08 * volume, 0.03);
    }
  }

  /** Someone voted out and sent home: a glum little slide-trombone "wah wah". */
  sentHome(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [start, from, to, len] of [
      [0, 330, 311, 0.45],
      [0.5, 294, 262, 0.8],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(from, t + start);
      o.frequency.exponentialRampToValueAtTime(to, t + start + len);
      const wobble = ctx.createOscillator();
      wobble.frequency.value = 6;
      const depth = ctx.createGain();
      depth.gain.value = 4;
      wobble.connect(depth).connect(o.frequency);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, t + start);
      filter.frequency.exponentialRampToValueAtTime(500, t + start + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.exponentialRampToValueAtTime(0.12, t + start + 0.05);
      g.gain.setValueAtTime(0.12, t + start + len * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + len);
      g.connect(this.master!);
      o.connect(filter).connect(g);
      o.start(t + start);
      wobble.start(t + start);
      o.stop(t + start + len + 0.01);
      wobble.stop(t + start + len + 0.01);
    }
  }

  /** A plastic click at `f` Hz: a tiny ping with a burst of noise at its front. */
  private tick(at: number, f: number, peak: number): void {
    const o = this.ctx!.createOscillator();
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, at + 0.02);
    o.connect(this.gain(at, peak, 0.025));
    o.start(at);
    o.stop(at + 0.035);
    this.hiss(at, 0.012, 'highpass', 3000, peak * 1.2);
  }

  /** Paper moving: a soft rustle with crinkles in it, `seconds` long. */
  private paper(at: number, seconds: number, peak: number, crinkle = 4000): void {
    this.hiss(at, seconds, 'highpass', 2500, peak, 0.3);
    for (let i = 0, n = Math.round(seconds * 25); i < n; i++)
      this.tick(at + Math.random() * seconds, crinkle + Math.random() * 2000, peak * 0.3);
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
