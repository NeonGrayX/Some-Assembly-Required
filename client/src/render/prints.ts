import * as THREE from 'three';
import { BRICK_TYPES, PLATE_H, STUD } from '@sar/shared';
import type { BrickTypeId, PrintId } from '@sar/shared';

/*
 * What is drawn onto parts beyond their shape: the prints on printed tiles and the panes in
 * window frames. Each is a flat mesh added to the part's own mesh, so it turns with the part.
 *
 * A print lies on the part's top face. Its picture's top points along the part's +z and its
 * right along -x, so a tile clipped sideways (turned 0) reads the right way up from in front.
 */

const textures = new Map<string, THREE.CanvasTexture>();

/** Pixels per stud on a print's canvas. */
const PX = 96;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w * PX;
  c.height = h * PX;
  return [c, c.getContext('2d')!];
}

function texture(key: string, draw: () => HTMLCanvasElement): THREE.CanvasTexture {
  let t = textures.get(key);
  if (!t) {
    t = new THREE.CanvasTexture(draw());
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    textures.set(key, t);
  }
  return t;
}

const PRINTS: Record<PrintId, (w: number, h: number) => HTMLCanvasElement> = {
  'manga-shop': (w, h) => {
    const [c, g] = canvas(w, h);
    g.fillStyle = '#111214';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#c9ccd1';
    g.font = `bold ${c.height * 0.5}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('MANGA SHOP', c.width / 2, c.height / 2, c.width * 0.9);
    return c;
  },
  poster: (w, h) => {
    const [c, g] = canvas(w, h);
    const s = c.width;
    g.fillStyle = '#e9a25a';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#f4ecdc';
    g.fillRect(s * 0.07, s * 0.07, s * 0.86, s * 0.86);
    g.fillStyle = '#c9402e';
    g.fillRect(s * 0.12, s * 0.1, s * 0.35, s * 0.28);
    g.fillStyle = '#2aa3a1';
    g.fillRect(s * 0.55, s * 0.55, s * 0.32, s * 0.3);
    g.fillStyle = '#d8b25a';
    g.fillRect(s * 0.12, s * 0.62, s * 0.3, s * 0.25);
    g.fillStyle = '#16171a';
    g.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.4);
    return c;
  },
  billboard: (w, h) => {
    const [c, g] = canvas(w, h);
    const grad = g.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, '#3a1d8a');
    grad.addColorStop(0.55, '#7a2bb8');
    grad.addColorStop(1, '#e0479e');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = c.height * 0.05;
    for (const x of [0.6, 0.72]) {
      g.beginPath();
      g.moveTo(c.width * x, c.height);
      g.lineTo(c.width * (x + 0.18), 0);
      g.stroke();
    }
    g.fillStyle = '#f5e14a';
    g.beginPath();
    g.moveTo(c.width * 0.12, c.height * 0.62);
    g.lineTo(c.width * 0.42, c.height * 0.38);
    g.lineTo(c.width * 0.46, c.height * 0.5);
    g.lineTo(c.width * 0.16, c.height * 0.74);
    g.fill();
    g.fillStyle = '#52e3f0';
    g.beginPath();
    g.arc(c.width * 0.66, c.height * 0.5, c.height * 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `italic bold ${c.height * 0.3}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('BANG', c.width * 0.38, c.height * 0.3);
    return c;
  },
  manga: (w, h) => {
    // Read top to bottom when stood on end: each letter turned so its top is the canvas's left.
    const [c, g] = canvas(w, h);
    g.fillStyle = '#f4efe4';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#d2589a';
    g.lineWidth = c.height * 0.06;
    g.strokeRect(c.height * 0.08, c.height * 0.08, c.width - c.height * 0.16, c.height * 0.84);
    g.fillStyle = '#d2589a';
    g.font = `bold ${c.height * 0.62}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const letters = 'MANGA';
    letters.split('').forEach((l, i) => {
      g.save();
      g.translate(((i + 0.5) / letters.length) * c.width, c.height / 2);
      g.rotate(-Math.PI / 2);
      g.fillText(l, 0, 0);
      g.restore();
    });
    return c;
  },
  'cat-face': (w, h) => {
    const [c, g] = canvas(w, h);
    const s = c.width;
    g.fillStyle = '#e8e2d6';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#1f1e1c';
    g.beginPath();
    g.arc(s * 0.5, s * 0.5, s * 0.48, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f2ede4';
    g.beginPath();
    g.ellipse(s * 0.5, s * 0.66, s * 0.22, s * 0.18, 0, 0, Math.PI * 2);
    g.fill();
    // Heart eyes.
    g.fillStyle = '#e8506e';
    for (const x of [0.32, 0.68]) {
      g.beginPath();
      const cx = s * x;
      const cy = s * 0.42;
      const r = s * 0.07;
      g.arc(cx - r * 0.7, cy, r, Math.PI, 0);
      g.arc(cx + r * 0.7, cy, r, Math.PI, 0);
      g.lineTo(cx, cy + r * 2);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#1f1e1c';
    g.beginPath();
    g.arc(s * 0.5, s * 0.6, s * 0.04, 0, Math.PI * 2);
    g.fill();
    return c;
  },
  neon: (w, h) => {
    const [c, g] = canvas(w, h);
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(235, 245, 250, 0.35)';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffffff';
    g.shadowColor = '#9fe7ff';
    g.shadowBlur = c.height * 0.15;
    g.font = `bold ${c.height * 0.55}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ドキドキ', c.width / 2, c.height * 0.52, c.width * 0.9);
    return c;
  },
};

/** A lattice window's paper pane: tan bars over warm light. */
function latticeCanvas(w: number, h: number): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  g.fillStyle = '#fbf0d6';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#b88a52';
  g.lineWidth = c.width * 0.035;
  for (let i = 1; i < 3; i++) {
    g.beginPath();
    g.moveTo((i / 3) * c.width, 0);
    g.lineTo((i / 3) * c.width, c.height);
    g.stroke();
  }
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(0, (i / 4) * c.height);
    g.lineTo(c.width, (i / 4) * c.height);
    g.stroke();
  }
  return c;
}

const printMaterials = new Map<string, THREE.Material>();

function printMaterial(key: string, draw: () => HTMLCanvasElement, see = false): THREE.Material {
  let m = printMaterials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: texture(key, draw),
      roughness: 0.4,
      transparent: see,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    printMaterials.set(key, m);
  }
  return m;
}

const glass = new THREE.MeshStandardMaterial({
  color: 0xdff2f7,
  roughness: 0.05,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
});

/**
 * Adds a part's print or pane to its mesh (in the part's own frame, centred on its body), if it
 * has one.
 */
export function addDecorations(mesh: THREE.Mesh, type: BrickTypeId): void {
  const t = BRICK_TYPES[type];
  const w = t.studsX * STUD;
  const d = t.studsZ * STUD;
  const h = t.plates * PLATE_H;
  if (t.print) {
    const id = t.print;
    const round = t.shape === 'round';
    const geo = round
      ? new THREE.CircleGeometry(Math.min(w, d) / 2 - 0.004, 32)
      : new THREE.PlaneGeometry(w - 0.004, d - 0.004);
    // Lay it on the top face: picture top toward +z, right toward -x.
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI);
    geo.translate(0, h / 2 + 0.0008, 0);
    const decal = new THREE.Mesh(
      geo,
      printMaterial(`print:${id}`, () => PRINTS[id](t.studsX, t.studsZ), id === 'neon'),
    );
    decal.userData.decoration = true;
    mesh.add(decal);
  }
  if (t.pane) {
    // In the frame's opening, half way through it.
    const geo = new THREE.PlaneGeometry(w * 0.66, h - PLATE_H * 1.8);
    const material =
      t.pane === 'glass' ? glass : printMaterial('pane:lattice', () => latticeCanvas(2, 2));
    for (const side of [1, -1]) {
      const pane = new THREE.Mesh(geo, material);
      pane.rotation.y = side > 0 ? 0 : Math.PI;
      pane.position.z = side * 0.001;
      pane.userData.decoration = true;
      mesh.add(pane);
    }
  }
}
