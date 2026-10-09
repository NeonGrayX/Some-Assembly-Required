import * as THREE from 'three';
import { BRICK_TYPES, PLATE_H, PRINT_SIDES, STUD } from '@sar/shared';
import type { BrickTypeId, PrintSide, Prints } from '@sar/shared';

/*
 * What is drawn onto parts beyond their shape: the prints a build puts on bricks' sides, and
 * the panes in window frames. Each is a flat mesh added to the part's own mesh, so it turns
 * with the part.
 *
 * A print is one of the build's SVGs, laid on a side of the part in its own frame. Looking
 * straight at a side, the picture is upright with its top toward the part's +y (its studs) on
 * front, back, left and right, toward +z on top and bottom. Round parts wrap the side prints a
 * quarter of the way round.
 */

const textures = new Map<string, THREE.CanvasTexture>();

/** Pixels per stud on a pane's canvas. */
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

const paneMaterials = new Map<string, THREE.Material>();

/** Pixels per metre a print is drawn at, and the most along either side. */
const PRINT_PX_PER_M = 2400;
const PRINT_MAX_PX = 1024;

/** Goes up whenever a print finishes loading, so pictures printed before it can be redone. */
let loaded = 0;
let loading = 0;
const loadWaiters: (() => void)[] = [];

/** Changes when a print has finished loading since this was last read. */
export function printsVersion(): number {
  return loaded;
}

/** Resolves once every print asked for so far has loaded (or failed to). */
export function printsReady(): Promise<void> {
  return loading ? new Promise((resolve) => loadWaiters.push(resolve)) : Promise.resolve();
}

/**
 * An SVG drawn into a canvas of the given size, as a texture. It starts empty and is filled in
 * once the browser has drawn the SVG. The SVG is sized to the canvas, so its viewBox is fitted
 * to the side as its own preserveAspectRatio says (whole and centred unless it says otherwise).
 */
function svgTexture(svg: string, w: number, h: number): THREE.CanvasTexture {
  return texture(`svg:${w}x${h}:${svg}`, () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.nodeName !== 'svg') return c;
    root.setAttribute('width', String(w));
    root.setAttribute('height', String(h));
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }),
    );
    const img = new Image();
    const done = (): void => {
      URL.revokeObjectURL(url);
      loading--;
      loaded++;
      if (!loading) loadWaiters.splice(0).forEach((resolve) => resolve());
    };
    loading++;
    img.onload = () => {
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const t = textures.get(`svg:${w}x${h}:${svg}`);
      if (t) t.needsUpdate = true;
      done();
    };
    img.onerror = done;
    img.src = url;
    return c;
  });
}

const printMaterials = new Map<string, THREE.Material>();

/**
 * How a print is drawn: `solid` on a part, `faded` on a part already built (washed out like
 * it), `ghost` see-through and unlit on the placement preview.
 */
export type PrintLook = 'solid' | 'faded' | 'ghost';

function svgMaterial(svg: string, w: number, h: number, look: PrintLook): THREE.Material {
  const px = (m: number) => Math.max(16, Math.min(PRINT_MAX_PX, Math.round(m * PRINT_PX_PER_M)));
  const [pw, ph] = [px(w), px(h)];
  const key = `${look}:${pw}x${ph}:${svg}`;
  let m = printMaterials.get(key);
  if (!m) {
    const map = svgTexture(svg, pw, ph);
    m =
      look === 'ghost'
        ? new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.6, depthWrite: false })
        : new THREE.MeshStandardMaterial({
            map,
            roughness: 0.4,
            transparent: true,
            opacity: look === 'faded' ? 0.5 : 1,
            polygonOffset: true,
            polygonOffsetFactor: -1,
          });
    printMaterials.set(key, m);
  }
  return m;
}

/** How far a print stands off its side, so it is drawn over it. */
const LIFT = 0.0008;

/** The flat shape a print takes on one side of a part, and the picture's size in metres. */
function printGeometry(type: BrickTypeId, side: PrintSide): [THREE.BufferGeometry, number, number] {
  const t = BRICK_TYPES[type];
  const w = t.studsX * STUD - 0.004;
  const d = t.studsZ * STUD - 0.004;
  const h = t.plates * PLATE_H - 0.004;
  const round = t.shape === 'round';
  const r = Math.min(w, d) / 2 + LIFT;
  if (side === 'top' || side === 'bottom') {
    const geo = round ? new THREE.CircleGeometry(r - 2 * LIFT, 32) : new THREE.PlaneGeometry(w, d);
    // The picture's top toward +z, as if the part were tipped toward you to look at it.
    if (side === 'top') geo.rotateX(-Math.PI / 2).rotateY(Math.PI);
    else geo.rotateX(Math.PI / 2);
    geo.translate(0, side === 'top' ? h / 2 + LIFT : -h / 2 - LIFT, 0);
    return [geo, round ? 2 * r : w, round ? 2 * r : d];
  }
  const turn = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 }[side];
  if (round) {
    // A quarter of the way round, centred on the side.
    const geo = new THREE.CylinderGeometry(r, r, h, 12, 1, true, turn - Math.PI / 4, Math.PI / 2);
    return [geo, (Math.PI / 2) * r, h];
  }
  const across = side === 'front' || side === 'back' ? w : d;
  const out = side === 'front' || side === 'back' ? d : w;
  const geo = new THREE.PlaneGeometry(across, h).translate(0, 0, out / 2 + LIFT).rotateY(turn);
  return [geo, across, h];
}

/**
 * Adds a brick's prints to its mesh. `svgs` are the build's pictures by name; a print whose
 * picture is missing is left off.
 */
export function addPrints(
  mesh: THREE.Mesh,
  type: BrickTypeId,
  prints: Prints,
  svgs: Record<string, string>,
  look: PrintLook = 'solid',
): void {
  for (const side of PRINT_SIDES) {
    const svg = prints[side] && svgs[prints[side]];
    if (!svg) continue;
    const [geo, w, h] = printGeometry(type, side);
    const decal = new THREE.Mesh(geo, svgMaterial(svg, w, h, look));
    decal.userData.decoration = true;
    mesh.add(decal);
  }
}

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

function paneMaterial(key: string, draw: () => HTMLCanvasElement): THREE.Material {
  let m = paneMaterials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: texture(key, draw),
      roughness: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    paneMaterials.set(key, m);
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

/** Adds a window frame's pane to its mesh (in the part's own frame, centred on its body). */
export function addDecorations(mesh: THREE.Mesh, type: BrickTypeId): void {
  const t = BRICK_TYPES[type];
  const w = t.studsX * STUD;
  const h = t.plates * PLATE_H;
  if (t.pane) {
    // In the frame's opening, half way through it.
    const geo = new THREE.PlaneGeometry(w * 0.66, h - PLATE_H * 1.8);
    const material =
      t.pane === 'glass' ? glass : paneMaterial('pane:lattice', () => latticeCanvas(2, 2));
    for (const side of [1, -1]) {
      const pane = new THREE.Mesh(geo, material);
      pane.rotation.y = side > 0 ? 0 : Math.PI;
      pane.position.z = side * 0.001;
      pane.userData.decoration = true;
      mesh.add(pane);
    }
  }
}
