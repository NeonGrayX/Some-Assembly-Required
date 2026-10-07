import type { HideoutKind } from '@sar/shared';

/** One way a struck body rings: frequency (Hz), how long it rings for (s), how loud (0..1). */
type Mode = [hz: number, decay: number, amp: number];

/** A breaker in a steel panel: a short, dull clunk with a tinny ring. */
const BREAKER: Mode[] = [
  [170, 0.12, 1],
  [540, 0.07, 0.45],
  [1320, 0.04, 0.25],
  [2900, 0.02, 0.1],
];

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

  /**
   * The electrical panel blowing: a burst of arcing crackle, the breaker clunking out, and the
   * house's hum sagging away to nothing as the lights die.
   */
  powerOut(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.crackle(t, 0.35, 900, 'highpass', 2500, 0.5, (x) => (x < 0.1 ? x * 10 : (1 - x) ** 1.5));
    this.impact(t + 0.25, BREAKER, 0.35, { f: 900, seconds: 0.03, amount: 0.5 });
    this.hum(t, 1.4, 100, 35, 0.12);
  }

  /** The panel fixed: the breaker clunks back up and the hum swells in, with a few sparks. */
  powerOn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.impact(t, BREAKER, 0.3, { f: 1200, seconds: 0.02, amount: 0.4 });
    this.crackle(t + 0.05, 0.25, 120, 'highpass', 3000, 0.25, (x) => 1 - x);
    this.hum(t + 0.05, 0.9, 50, 100, 0.08);
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

  /** A brick clicking onto a build: a sharp plastic snap with a short hollow ring. */
  snap(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.tick(t, 3200, 0.3 * volume);
    this.tick(t + 0.012, 2400, 0.2 * volume);
    this.knock(t, 1100, 0.1 * volume, 0.05);
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

  // ------------------------------------------------------------------ things landing

  /** Something heavy and soft landing on the floor: a low thud with a bit of body to it. */
  thump(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    this.thud(ctx.currentTime, 1, 0.4 * volume);
  }

  /** A body hitting the floor: low thud, the floor answering, and a brush of clothing. */
  private thud(at: number, size: number, peak: number): void {
    this.impact(
      at,
      [
        [55 + 25 * (1 - size), 0.28, 1],
        [95 + 40 * (1 - size), 0.16, 0.6],
        [170, 0.08, 0.3],
      ],
      peak,
      { f: 300, seconds: 0.03, amount: 1.2 },
    );
    this.hiss(at, 0.09, 'lowpass', 450, peak * 0.9, 0.15);
  }

  /** A plastic brick hitting something hard: its bright little body modes, varied each time. */
  private clack(at: number, peak: number, floor = true): void {
    const r = 0.9 + Math.random() * 0.2;
    const modes: Mode[] = [
      [2600 * r, 0.035, 1],
      [3900 * r, 0.03, 0.7],
      [5300 * r, 0.022, 0.4],
    ];
    if (floor) modes.push([430 * r, 0.05, 0.35]);
    this.impact(at, modes, peak, { f: 3500, seconds: 0.004, amount: 0.8 });
  }

  /** Loose bricks knocking against each other: a short, bright rattle. */
  private rattle(at: number, seconds: number, peak: number): void {
    this.crackle(at, seconds, 260, 'bandpass', 3200, peak, (x) => (1 - x) ** 1.5);
  }

  /** A loose brick, or a whole build, picked up: a brush of the hand and a tiny clack. */
  pickUp(volume = 1, count = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.09, 'bandpass', 2200, 0.1 * volume, 0.25);
    if (count <= 1) this.clack(t + 0.01, 0.08 * volume, false);
    else {
      this.impact(t, [[150, 0.07, 1]], 0.1 * volume, { f: 400, seconds: 0.01, amount: 1 });
      this.rattle(t + 0.01, 0.1, 0.1 * volume);
    }
  }

  /**
   * Something landing after being dropped or thrown: one brick clacks on whatever it hit; a
   * build of many lands with a heavier clunk and a rattle of its bricks. `speed` is how hard
   * it hit (m/s): a brick from waist height lands at about 4. Bounces come as landings of
   * their own, so there are none here.
   */
  drop(volume = 1, count = 1, speed = 4): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    volume *= Math.min(1, 0.25 + speed / 5);
    if (count <= 1) {
      this.clack(t, 0.35 * volume);
      return;
    }
    const size = Math.min(1, count / 20);
    this.impact(
      t,
      [
        [120 - 40 * size, 0.14 + 0.06 * size, 1],
        [190 - 50 * size, 0.09, 0.5],
      ],
      (0.24 + 0.14 * size) * volume,
      { f: 500, seconds: 0.02, amount: 1 },
    );
    for (let i = 0, n = Math.min(7, 2 + Math.round(count / 2)); i < n; i++)
      this.clack(t + 0.005 + Math.random() * 0.13, (0.2 - 0.1 * (i / n)) * volume);
    this.rattle(t + 0.03, 0.15 + 0.1 * size, 0.15 * volume);
  }

  /** A brick dropped back into a bin full of them: it hits the heap and the box hums. */
  binDrop(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.impact(
      t,
      [
        [310, 0.14, 1],
        [540, 0.1, 0.55],
        [870, 0.07, 0.3],
      ],
      0.18 * volume,
      { f: 700, seconds: 0.01, amount: 0.8 },
    );
    // Tumbling down between the other bricks, settling as it goes.
    let at = t;
    for (let i = 0, n = 5; i < n; i++) {
      at += 0.025 + i * 0.012 + Math.random() * 0.02;
      this.clack(at, (0.28 - 0.18 * (i / n)) * volume, false);
    }
    this.rattle(t + 0.02, 0.22, 0.14 * volume);
  }

  /** A build settling onto its base plate: a firm clunk, then the clicks of it seating. */
  anchor(volume = 1, count = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    const size = Math.min(1, count / 20);
    this.impact(
      t,
      [
        [95 - 30 * size, 0.2, 1],
        [150 - 40 * size, 0.12, 0.6],
        [240, 0.07, 0.3],
      ],
      (0.28 + 0.14 * size) * volume,
      { f: 450, seconds: 0.02, amount: 1 },
    );
    this.clack(t + 0.025, 0.22 * volume, false);
    this.clack(t + 0.05, 0.16 * volume, false);
    this.rattle(t + 0.02, 0.08 + 0.08 * size, 0.1 * volume);
  }

  // ------------------------------------------------------------------ paper and small things

  /** Paper moving: a soft rustle with crinkles in it, `seconds` long. */
  private paper(at: number, seconds: number, peak: number, density = 220): void {
    this.hiss(at, seconds, 'bandpass', 2600, peak * 0.5, 0.3);
    this.crackle(at, seconds, density, 'lowpass', 5500, peak, (x) => Math.sin(Math.PI * x) ** 0.7);
  }

  /** A page picked up or passed about: a quick flick of paper. */
  page(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    this.paper(ctx.currentTime, 0.16, 0.2 * volume);
  }

  /** Paper being shuffled nearby: a slow, soft rustle, for something sneaky happening. */
  rustle(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    this.paper(ctx.currentTime, 0.5, 0.14 * volume, 140);
  }

  /** A page pinned up: the pin pushed into cork, and the page settling against the board. */
  pin(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    // Cork gives: a soft, dull "thup" with almost no ring.
    this.hiss(t, 0.03, 'lowpass', 550, 0.5 * volume, 0.2);
    this.impact(t, [[650, 0.025, 1]], 0.08 * volume, { f: 1200, seconds: 0.004, amount: 0.5 });
    this.paper(t + 0.03, 0.14, 0.1 * volume, 120);
  }

  /** A hand in the treat bag: the bag crinkles and the biscuits knock about inside. */
  treats(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.crackle(t, 0.38, 420, 'highpass', 3200, 0.3 * volume, (x) => Math.sin(Math.PI * x) ** 0.5);
    for (let i = 0; i < 5; i++) {
      const r = 0.85 + Math.random() * 0.3;
      this.impact(
        t + 0.04 + Math.random() * 0.28,
        [
          [1400 * r, 0.04, 1],
          [2350 * r, 0.03, 0.6],
        ],
        0.12 * volume,
        { f: 2000, seconds: 0.004, amount: 0.6 },
      );
    }
  }

  /** A dog biscuit going down: three bites, each a sharp crack and a crumbly crunch. */
  crunch(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    for (let i = 0; i < 3; i++) {
      const t = ctx.currentTime + i * 0.17 + Math.random() * 0.02;
      this.crackle(t, 0.1, 1600, 'lowpass', 3800, 0.3 * volume, (x) => (1 - x) ** 2.2);
      this.impact(t, [[180, 0.04, 1]], 0.12 * volume, { f: 400, seconds: 0.008, amount: 1 });
    }
  }

  // ------------------------------------------------------------------ voices

  /** Woof woof: a breathy burst at the front, then a growly voice behind it. */
  bark(volume = 1, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    for (const delay of [0, 0.27]) {
      const t = ctx.currentTime + delay;
      this.hiss(t, 0.03, 'highpass', 1500, 0.3 * volume, 0.2);
      this.voice(t + 0.01, 0.15, {
        pitch: [
          [0, 150 * pitch],
          [0.2, 230 * pitch],
          [1, 105 * pitch],
        ],
        formants: [
          [560, 4, 1],
          [1100, 5, 0.6],
          [2300, 6, 0.25],
        ],
        peak: 0.5 * volume,
        attack: 0.008,
        release: 0.06,
        breath: 0.5,
        rough: 28,
      });
    }
  }

  /** A startled little yip. */
  yelp(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.02, 'highpass', 2000, 0.2 * volume, 0.2);
    this.voice(t, 0.22, {
      pitch: [
        [0, 620],
        [0.3, 950],
        [1, 430],
      ],
      formants: [
        [950, 6, 1],
        [1850, 6, 0.5],
        [3000, 8, 0.3],
      ],
      peak: 0.3 * volume,
      attack: 0.01,
      release: 0.08,
      breath: 0.3,
      vibrato: [9, 0.02],
    });
  }

  /** A contented, nasal little whine, up and down twice, from a dog being patted. */
  whine(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.voice(t, 0.65, {
      source: 'triangle',
      pitch: [
        [0, 720],
        [0.25, 1050],
        [0.5, 680],
        [0.75, 960],
        [1, 600],
      ],
      formants: [
        [1000, 8, 1],
        [2000, 8, 0.4],
      ],
      peak: 0.2 * volume,
      attack: 0.05,
      release: 0.15,
      breath: 0.2,
      vibrato: [7, 0.025],
    });
  }

  /** Someone going down: a grunt, a slither, then the thud of landing. */
  oof(volume = 1, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.voice(t, 0.2, {
      pitch: [
        [0, 160 * pitch],
        [0.15, 175 * pitch],
        [1, 105 * pitch],
      ],
      formants: [
        [600, 5, 1],
        [1150, 6, 0.5],
        [2400, 8, 0.2],
      ],
      peak: 0.4 * volume,
      attack: 0.015,
      release: 0.09,
      breath: 0.4,
      rough: 30,
    });
    this.hiss(t + 0.08, 0.25, 'lowpass', 800, 0.1 * volume, 0.5);
    this.thud(t + 0.32, 1, 0.45 * volume);
  }

  /** A cartoon scream ("aaah!"): a wobbling, rasping voice sliding up, then down. */
  scream(volume = 1, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.voice(t, 0.8, {
      pitch: [
        [0, 480 * pitch],
        [0.15, 660 * pitch],
        [0.6, 600 * pitch],
        [1, 360 * pitch],
      ],
      formants: [
        [800, 6, 1],
        [1200, 7, 0.7],
        [2700, 8, 0.3],
        [3500, 8, 0.15],
      ],
      peak: 0.7 * volume,
      attack: 0.03,
      release: 0.15,
      breath: 0.25,
      vibrato: [6, 0.035],
      rough: 32,
    });
  }

  // ------------------------------------------------------------------ the meeting

  /** The meeting bell: a hand bell rung twice, with a bell's spread of partials. */
  bell(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // Hum, prime, tierce, quint and nominal, as a real bell is tuned, around a 1.1 kHz prime.
    const ring: Mode[] = [
      [550, 2.6, 0.5],
      [1100, 2.1, 1],
      [1320, 1.7, 0.6],
      [1650, 1.3, 0.35],
      [2200, 1.0, 0.5],
      [2750, 0.6, 0.2],
      [3300, 0.4, 0.15],
    ];
    this.impact(t, ring, 0.22, { f: 3500, seconds: 0.006, amount: 0.6 });
    this.impact(t + 0.34, ring, 0.16, { f: 3500, seconds: 0.006, amount: 0.5 });
  }

  /** Someone voted out and sent home: a muted trombone's "wah wah wah waaah". */
  sentHome(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // Four notes stepping down, the last one sagging and wobbling.
    const notes: [start: number, hz: number, len: number, sag: number][] = [
      [0, 233, 0.3, 0.98],
      [0.36, 220, 0.3, 0.98],
      [0.72, 208, 0.3, 0.98],
      [1.08, 196, 1.2, 0.86],
    ];
    for (const [start, hz, len, sag] of notes) {
      const at = t + start;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(0.11, at + 0.04);
      out.gain.setValueAtTime(0.11, at + len * 0.7);
      out.gain.exponentialRampToValueAtTime(0.0001, at + len);
      out.connect(this.master!);
      // The mute opening and closing again over each note is what says "wah".
      const mute = ctx.createBiquadFilter();
      mute.type = 'lowpass';
      mute.Q.value = 5;
      mute.frequency.setValueAtTime(500, at);
      mute.frequency.exponentialRampToValueAtTime(1900, at + len * 0.35);
      mute.frequency.exponentialRampToValueAtTime(380, at + len);
      mute.connect(out);
      const wobble = ctx.createOscillator();
      wobble.frequency.value = 5.5;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(hz * 0.004, at);
      depth.gain.linearRampToValueAtTime(hz * (len > 1 ? 0.03 : 0.006), at + len);
      wobble.connect(depth);
      for (const detune of [0, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = detune;
        o.frequency.setValueAtTime(hz, at);
        o.frequency.setValueAtTime(hz, at + len * 0.4);
        o.frequency.exponentialRampToValueAtTime(hz * sag, at + len);
        depth.connect(o.frequency);
        o.connect(mute);
        o.start(at);
        o.stop(at + len + 0.02);
      }
      wobble.start(at);
      wobble.stop(at + len + 0.02);
    }
  }

  // ------------------------------------------------------------------ building blocks

  /**
   * Something struck: its body's modes (frequency, how long each rings, how loud) ringing
   * out from a short burst of noise, `exciter`, shaped around `f`. Each mode is a little
   * out of tune every time, so no two hits are quite alike.
   */
  private impact(
    at: number,
    modes: Mode[],
    peak: number,
    exciter: { f: number; seconds: number; amount: number },
  ): void {
    const ctx = this.ctx!;
    for (const [f, decay, amp] of modes) {
      const o = ctx.createOscillator();
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.01);
      o.connect(this.gain(at, peak * amp, decay));
      o.start(at);
      o.stop(at + decay + 0.02);
    }
    const src = this.noise(exciter.seconds, (x) => (1 - x) ** 2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = exciter.f;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = peak * exciter.amount;
    src.connect(filter).connect(g).connect(this.master!);
    src.start(at);
  }

  /**
   * Sparse random clicks, `density` of them a second, each a tiny decaying burst of its own
   * size: crinkling paper, a crumbling biscuit, bricks rattling. Through a filter, shaped by
   * `envelope` (0..1 through the sound).
   */
  private crackle(
    at: number,
    seconds: number,
    density: number,
    type: BiquadFilterType,
    f: number,
    peak: number,
    envelope: (x: number) => number,
  ): void {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    const n = Math.round(density * seconds);
    for (let k = 0; k < n; k++) {
      const start = Math.floor(Math.random() * len);
      // Most clicks are small and a few are big, as creases and crumbs are.
      const size = Math.random() ** 3;
      const tail = Math.floor(rate * (0.0003 + Math.random() * 0.0012));
      const sign = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < tail && start + i < len; i++)
        data[start + i]! += sign * size * (1 - i / tail) * (Math.random() * 0.5 + 0.5);
    }
    for (let i = 0; i < len; i++) data[i]! *= envelope(i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = type === 'bandpass' ? 0.9 : 0.7;
    const g = ctx.createGain();
    g.gain.value = peak * 2;
    src.connect(filter).connect(g).connect(this.master!);
    src.start(at);
  }

  /**
   * A voice, animal or human: a buzzing source following a `pitch` contour (fraction of the
   * sound, Hz) through parallel vowel `formants` (Hz, Q, loudness), with some `breath` noise
   * through the same formants, an optional `vibrato` (Hz, depth as a fraction of pitch) and
   * `rough`, an amplitude flutter at that many Hz for a growl or a rasp.
   */
  private voice(
    at: number,
    seconds: number,
    v: {
      pitch: [fraction: number, hz: number][];
      formants: [hz: number, q: number, amp: number][];
      peak: number;
      attack: number;
      release: number;
      breath: number;
      source?: OscillatorType;
      vibrato?: [hz: number, depth: number];
      rough?: number;
    },
  ): void {
    const ctx = this.ctx!;
    const end = at + seconds;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, at);
    out.gain.exponentialRampToValueAtTime(v.peak, at + v.attack);
    out.gain.setValueAtTime(v.peak, Math.max(at + v.attack, end - v.release));
    out.gain.exponentialRampToValueAtTime(0.0001, end);
    out.connect(this.master!);
    let into: AudioNode = out;
    if (v.rough) {
      // A flutter in loudness, like vocal folds slapping unevenly.
      const flutter = ctx.createGain();
      flutter.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = v.rough;
      const depth = ctx.createGain();
      depth.gain.value = 0.3;
      lfo.connect(depth).connect(flutter.gain);
      lfo.start(at);
      lfo.stop(end + 0.02);
      flutter.connect(out);
      into = flutter;
    }
    const o = ctx.createOscillator();
    o.type = v.source ?? 'sawtooth';
    const [f0, hz0] = v.pitch[0]!;
    o.frequency.setValueAtTime(hz0, at + f0 * seconds);
    for (const [fraction, hz] of v.pitch.slice(1))
      o.frequency.exponentialRampToValueAtTime(hz, at + fraction * seconds);
    if (v.vibrato) {
      const [rate, depth] = v.vibrato;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const amount = ctx.createGain();
      amount.gain.setValueAtTime(0, at);
      amount.gain.linearRampToValueAtTime(hz0 * depth, at + seconds * 0.4);
      lfo.connect(amount).connect(o.frequency);
      lfo.start(at);
      lfo.stop(end + 0.02);
    }
    const breath = this.noise(seconds, (x) => (x < 0.15 ? 1 : 0.5 + 0.5 * (1 - x)));
    const breathGain = ctx.createGain();
    breathGain.gain.value = v.breath * 0.3;
    breath.connect(breathGain);
    for (const [hz, q, amp] of v.formants) {
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = hz;
      formant.Q.value = q;
      const level = ctx.createGain();
      level.gain.value = amp;
      o.connect(formant);
      breathGain.connect(formant);
      formant.connect(level).connect(into);
    }
    o.start(at);
    o.stop(end + 0.02);
    breath.start(at);
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
