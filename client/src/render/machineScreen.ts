import * as THREE from 'three';
import { BUCKET_SHOTS, shapeName } from '@sar/shared';
import type { ColourId, MachineKind, MachineState } from '@sar/shared';
import { drawnHex, isColourBlind } from './bricks.ts';

/**
 * The brick works' machines' displays: what each machine is doing and how far along it is, and
 * otherwise what it has in it and what it waits for, drawn on a canvas that lights its screen.
 */

/** How a display reads at a glance: idle and ready, busy, waiting on something, or alarmed. */
export type Tone = 'ready' | 'busy' | 'wait' | 'alarm';

/** A line on a display: words, after a swatch of a pellet colour if there is one. */
export interface ScreenLine {
  text: string;
  colour?: ColourId;
}

/** What a display shows: a heading, a few lines, and a progress bar (0..1) while it works. */
export interface ScreenStatus {
  tone: Tone;
  title: string;
  lines: ScreenLine[];
  progress: number | null;
}

/** A dark screen: the machine has no power. */
export const SCREEN_OFF: ScreenStatus = { tone: 'wait', title: '', lines: [], progress: null };

/** What the machine is doing as its display tells it: what it shows itself make, how far along. */
export interface Doing {
  /** Making something (a part, a bucket, a mould) or printing, how far along (0..1). */
  progress: number;
}

/**
 * What a machine's display says: jammed, at work (`doing`) and how far along, or what it has in
 * it and what it waits for. A colour is named only for those who see colours (see
 * `isColourBlind`); its swatch is drawn as bricks are.
 */
export function screenStatus(
  kind: MachineKind,
  m: MachineState,
  doing: Doing | null,
): ScreenStatus {
  if (m.jammed) {
    const lines = [{ text: m.fixer === null ? 'Clear the jam' : 'Being cleared…' }];
    return { tone: 'alarm', title: 'JAMMED', lines, progress: null };
  }
  const making = m.making?.made;
  const named = (c: ColourId) => (isColourBlind() ? 'pellets' : c.replaceAll('-', ' '));
  if (kind === 'press') {
    const full = !m.out.includes(null);
    if (doing && making?.kind === 'part') {
      return {
        tone: 'busy',
        title: 'MOULDING',
        lines: [{ text: shapeName(making.type), colour: making.colour }],
        progress: doing.progress,
      };
    }
    const lines: ScreenLine[] = [
      { text: m.mould ? `Mould ${shapeName(m.mould)}` : 'No mould' },
      m.colour && m.shots > 0
        ? { text: `${named(m.colour)} ${m.shots}/${BUCKET_SHOTS}`, colour: m.colour }
        : { text: 'No pellets' },
    ];
    const parts = m.out.filter((x) => x !== null).length;
    if (parts) lines.push({ text: full ? 'Tray full' : `Tray ${parts}/${m.out.length}` });
    const ready = !!m.mould && !!m.colour && m.shots > 0 && !full;
    return {
      tone: ready ? 'ready' : 'wait',
      title: ready ? 'READY' : full ? 'TAKE PARTS' : !m.mould ? 'LOAD MOULD' : 'ADD PELLETS',
      lines,
      progress: null,
    };
  }
  if (kind === 'silo') {
    if (doing && making?.kind === 'bucket') {
      return {
        tone: 'busy',
        title: 'FILLING',
        lines: [{ text: named(making.colour), colour: making.colour }],
        progress: doing.progress,
      };
    }
    const waiting = m.out[0];
    if (waiting?.kind === 'bucket') {
      return {
        tone: 'wait',
        title: 'BUCKET FULL',
        lines: [{ text: named(waiting.colour), colour: waiting.colour }, { text: 'Take it' }],
        progress: null,
      };
    }
    return { tone: 'ready', title: 'READY', lines: [{ text: 'Pick a colour' }], progress: null };
  }
  if (kind === 'dispenser') {
    if (doing && making?.kind === 'mould') {
      return {
        tone: 'busy',
        title: 'DISPENSING',
        lines: [{ text: shapeName(making.type) }],
        progress: doing.progress,
      };
    }
    const waiting = m.out[0];
    if (waiting?.kind === 'mould') {
      return {
        tone: 'wait',
        title: 'IN THE HATCH',
        lines: [{ text: `${shapeName(waiting.type)} mould` }, { text: 'Take it' }],
        progress: null,
      };
    }
    return { tone: 'ready', title: 'READY', lines: [{ text: 'Pick a mould' }], progress: null };
  }
  // The printer.
  if (doing) return { tone: 'busy', title: 'PRINTING', lines: [], progress: doing.progress };
  if (m.part) {
    return {
      tone: 'ready',
      title: 'PART ON BED',
      lines: [{ text: shapeName(m.part.type), colour: m.part.colour }, { text: 'Pick a print' }],
      progress: null,
    };
  }
  return {
    tone: 'wait',
    title: 'READY',
    lines: [{ text: 'Lay a part on the bed' }],
    progress: null,
  };
}

/** The colours of a display's heading, by its tone. */
const TONES: Record<Tone, string> = {
  ready: '#5dff9a',
  busy: '#7fd8ff',
  wait: '#ffc44d',
  alarm: '#ff5a4a',
};

/** How many pixels a display's canvas is across. */
const PIXELS = 256;

/**
 * A machine's display: a lit pane over its screen, `w` by `h`, its face toward +z, drawn anew
 * whenever what it shows changes.
 */
export class MachineScreen {
  readonly mesh: THREE.Mesh;
  /** What it is drawn on: none without a page to draw on (it stays dark). */
  private readonly canvas: HTMLCanvasElement | null;
  private readonly texture: THREE.CanvasTexture | null;
  private key = '';

  constructor(w: number, h: number) {
    this.canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    this.texture = this.canvas && new THREE.CanvasTexture(this.canvas);
    if (this.canvas && this.texture) {
      this.canvas.width = PIXELS;
      this.canvas.height = Math.max(32, Math.round((PIXELS * h) / w));
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.anisotropy = 4;
    }
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: this.texture ? 0xffffff : 0x04121a,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    this.mesh.name = 'display';
  }

  /** Shows `s` on it (drawn again only if it changed; progress to the percent). */
  show(s: ScreenStatus): void {
    const pct = s.progress === null ? -1 : Math.round(Math.min(1, Math.max(0, s.progress)) * 100);
    const key = JSON.stringify([s.tone, s.title, s.lines, pct, isColourBlind()]);
    if (key === this.key) return;
    this.key = key;
    const { canvas, texture } = this;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !texture) return;
    const { width: W, height: H } = canvas;
    ctx.fillStyle = '#04121a';
    ctx.fillRect(0, 0, W, H);
    if (!s.title) {
      texture.needsUpdate = true;
      return;
    }
    // A band of the tone's colour across the top, the heading on it.
    const tone = TONES[s.tone];
    const band = Math.round(H * 0.3);
    ctx.fillStyle = tone;
    ctx.globalAlpha = s.tone === 'alarm' ? 0.9 : 0.25;
    ctx.fillRect(0, 0, W, band);
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.tone === 'alarm' ? '#1a0402' : tone;
    ctx.font = `bold ${Math.round(band * 0.72)}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(s.title, W * 0.05, band / 2);
    // The lines under it, a swatch first where there is a colour.
    const bar = s.progress !== null;
    const rows = Math.max(1, s.lines.length + (bar ? 1 : 0));
    const row = Math.min(band * 0.85, (H - band) / rows);
    ctx.font = `${Math.round(row * 0.62)}px sans-serif`;
    s.lines.forEach((line, i) => {
      const y = band + row * (i + 0.5);
      let x = W * 0.05;
      if (line.colour) {
        const size = row * 0.6;
        ctx.fillStyle = `#${drawnHex(line.colour).toString(16).padStart(6, '0')}`;
        ctx.fillRect(x, y - size / 2, size, size);
        ctx.strokeStyle = '#cfe9f2';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y - size / 2, size, size);
        x += size + W * 0.03;
      }
      ctx.fillStyle = '#d8f3ff';
      ctx.fillText(line.text, x, y);
    });
    if (bar) {
      // A bar filling up, and its percentage.
      const y = band + row * s.lines.length + row * 0.2;
      const bh = row * 0.6;
      const bw = W * 0.68;
      ctx.fillStyle = '#123848';
      ctx.fillRect(W * 0.05, y, bw, bh);
      ctx.fillStyle = tone;
      ctx.fillRect(W * 0.05, y, (bw * pct) / 100, bh);
      ctx.fillStyle = '#d8f3ff';
      ctx.fillText(`${pct}%`, W * 0.77, y + bh / 2);
    }
    texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture?.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
