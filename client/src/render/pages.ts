import * as THREE from 'three';
import { BRICK_TYPES, localCentre, partBounds, partQuat } from '@sar/shared';
import { addDecorations, addPrints, printsVersion } from './prints.ts';
import { brickName, shapeName } from '@sar/shared';
import type {
  BrickTypeId,
  ColourId,
  PageView,
  Placement,
  PrintedPage,
  Prints,
  TargetBrick,
  TargetBuild,
} from '@sar/shared';
import {
  baseplateMarker,
  brickGeometry,
  brickMaterial,
  drawnHex,
  isColourBlind,
} from './bricks.ts';
import { indexLayout } from './indexLayout.ts';
import { partCell, partsLayout } from './partsList.ts';

export const PAGE_W = 600;
export const PAGE_H = 840;
const PAPER = '#fbf8f0';
const INK = '#23252a';

/** What one printed page shows. Kept separate from the build so forgeries can be printed too. */
export interface PageContent {
  title: string;
  /** 0-based step. */
  step: number;
  totalSteps: number;
  /** Bricks already built before this step, drawn faded. */
  before: TargetBrick[];
  /** Bricks this page adds, drawn in full colour with outlines. */
  added: TargetBrick[];
  /** Ink stamp symbol that real pages carry. */
  stamp: string;
  /** How the picture is shot; the plain isometric view when missing. */
  view?: PageView;
  /** One line printed under the picture. */
  note?: string;
  /** The build's pictures, for the bricks' prints. */
  svgs?: Record<string, string>;
}

/** Page content for what is printed on a page: the real model so far, plus the page's bricks. */
export function pageContent(build: TargetBuild, printed: PrintedPage): PageContent {
  return {
    title: build.name,
    step: printed.step,
    totalSteps: build.steps.length,
    before: build.steps.slice(0, printed.step).flatMap((s) => s.bricks),
    added: printed.added,
    stamp: printed.stamp,
    ...build.pages?.[printed.step],
    ...(build.svgs ? { svgs: build.svgs } : {}),
  };
}

const BASEPLATE: Placement = { type: 'baseplate16', x: 0, y: 0, z: 0, rot: 0 };

const fadedMaterials = new Map<string, THREE.MeshStandardMaterial>();
function fadedMaterial(colour: ColourId): THREE.MeshStandardMaterial {
  const key = `${isColourBlind() ? 'grey:' : ''}${colour}`;
  let m = fadedMaterials.get(key);
  if (!m) {
    const c = new THREE.Color(drawnHex(colour)).lerp(new THREE.Color(0xffffff), 0.55);
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
    fadedMaterials.set(key, m);
  }
  return m;
}

/** What a parts list calls a brick: with its colour, or without the goggles only its shape. */
const partName = (type: BrickTypeId, colour: ColourId) =>
  isColourBlind() ? shapeName(type) : brickName(type, colour);

const outline = new THREE.LineBasicMaterial({ color: 0x111111 });

/**
 * Adds a brick mesh (and optionally an outline) to `parent`, in baseplate grid coordinates.
 * With `svgs`, the brick's prints are drawn on it; `faded` washes them out like the brick.
 */
export function addBrickMesh(
  parent: THREE.Object3D,
  b: Placement & { colour: ColourId; prints?: Prints },
  material: THREE.Material,
  withOutline = false,
  svgs?: Record<string, string>,
  faded = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(brickGeometry(b.type), material);
  const c = localCentre(b);
  mesh.position.set(c.x, c.y, c.z);
  const q = partQuat(b);
  mesh.quaternion.set(q.x, q.y, q.z, q.w);
  mesh.castShadow = mesh.receiveShadow = true;
  addDecorations(mesh, b.type);
  if (b.prints && svgs) addPrints(mesh, b.type, b.prints, svgs, faded ? 'faded' : 'solid');
  if (withOutline) {
    const t = BRICK_TYPES[b.type];
    const box = new THREE.BoxGeometry(t.studsX * 0.1, t.plates * 0.04, t.studsZ * 0.1);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), outline));
  }
  parent.add(mesh);
  return mesh;
}

/** A see-through coloured box around a brick, to point it out. */
export function addShell(parent: THREE.Object3D, b: Placement, colour: number): void {
  const { min, max } = partBounds(b);
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(max.x - min.x + 0.03, max.y - min.y + 0.03, max.z - min.z + 0.03),
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
  const c = localCentre(b);
  m.position.set(c.x, c.y, c.z);
  parent.add(m);
}

/**
 * Prints instruction pages, part icons and box art into 2D canvases, using a small
 * off-screen WebGL renderer. Results are cached; printing happens once per page.
 */
export class PagePrinter {
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  private readonly scene = new THREE.Scene();
  private readonly cache = new Map<string, HTMLCanvasElement>();
  /**
   * Box art per build object, so an imported build that replaces another gets new art, with
   * the prints version it was drawn at.
   */
  private readonly covers = new WeakMap<TargetBuild, [HTMLCanvasElement, number]>();
  /** The same without colours, for a gear hunt without the goggles. */
  private readonly greyCovers = new WeakMap<TargetBuild, [HTMLCanvasElement, number]>();

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);
  }

  /**
   * Renders `model` with an isometric camera into a new canvas of the given size. `turn` quarter
   * turns the model, which moves the camera the other way round it.
   */
  private snapshot(
    model: THREE.Object3D,
    w: number,
    h: number,
    zoom = 1,
    turn = 0,
  ): HTMLCanvasElement {
    this.scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = sphere.radius / zoom;
    const aspect = w / h;
    const cam = new THREE.OrthographicCamera(-r * aspect, r * aspect, r, -r, 0.01, 100);
    cam.position.copy(sphere.center).add(
      new THREE.Vector3(1, 0.9, 1.25)
        .normalize()
        .multiplyScalar(20)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), (-turn * Math.PI) / 2),
    );
    cam.lookAt(sphere.center);
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, cam);
    this.scene.remove(model);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    return out;
  }

  /** Picture of a single brick, for parts lists and bins. */
  partIcon(type: BrickTypeId, colour: ColourId): HTMLCanvasElement {
    const key = `icon:${isColourBlind() ? 'grey:' : ''}${type}:${colour}`;
    let c = this.cache.get(key);
    if (!c) {
      const g = new THREE.Group();
      addBrickMesh(g, { type, colour, x: 0, y: 0, z: 0, rot: 0 }, brickMaterial(colour));
      c = this.snapshot(g, 128, 128, 1.15);
      this.cache.set(key, c);
    }
    return c;
  }

  /** The finished model, as on the front of the box. */
  boxArt(build: TargetBuild): HTMLCanvasElement {
    const covers = isColourBlind() ? this.greyCovers : this.covers;
    const version = printsVersion();
    const drawn = covers.get(build);
    let c = drawn?.[0];
    if (!c || drawn?.[1] !== version) {
      const g = new THREE.Group();
      addBrickMesh(
        g,
        { ...BASEPLATE, colour: 'baseplate-green' },
        brickMaterial('baseplate-green'),
      );
      g.add(baseplateMarker());
      for (const b of build.steps.flatMap((s) => s.bricks))
        addBrickMesh(g, b, brickMaterial(b.colour), false, build.svgs);
      c = this.snapshot(g, 400, 400, build.cover?.zoom, build.cover?.turn);
      covers.set(build, [c, version]);
    }
    return c;
  }

  page(content: PageContent, key?: string): HTMLCanvasElement {
    // A print that loads later changes the picture, so the version is part of the key.
    const cacheKey = key && `page:${isColourBlind() ? 'grey:' : ''}${printsVersion()}:${key}`;
    const cached = cacheKey ? this.cache.get(cacheKey) : undefined;
    if (cached) return cached;

    const model = new THREE.Group();
    addBrickMesh(
      model,
      { ...BASEPLATE, colour: 'baseplate-green' },
      fadedMaterial('baseplate-green'),
    );
    model.add(baseplateMarker());
    for (const b of content.before)
      addBrickMesh(model, b, fadedMaterial(b.colour), false, content.svgs, true);
    for (const b of content.added)
      addBrickMesh(model, b, brickMaterial(b.colour), true, content.svgs);
    // A note takes a line off the bottom of the picture.
    const pictureH = content.note ? 440 : 470;
    const picture = this.snapshot(model, 560, pictureH, content.view?.zoom, content.view?.turn);

    const c = document.createElement('canvas');
    c.width = PAGE_W;
    c.height = PAGE_H;
    const g = c.getContext('2d')!;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, PAGE_W, PAGE_H);
    drawWatermark(g);

    g.fillStyle = INK;
    g.font = 'bold 30px system-ui, sans-serif';
    g.textBaseline = 'top';
    g.fillText(content.title.toUpperCase(), 24, 22);
    g.font = '22px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(`Step ${content.step + 1} of ${content.totalSteps}`, PAGE_W - 24, 28);
    g.textAlign = 'left';
    g.fillRect(24, 66, PAGE_W - 48, 3);

    g.drawImage(picture, 20, 76);
    if (content.note) {
      g.font = 'italic 18px system-ui, sans-serif';
      g.fillText(content.note, 24, 76 + pictureH + 6, PAGE_W - 48);
    }

    // Parts list.
    const parts = new Map<string, { type: BrickTypeId; colour: ColourId; n: number }>();
    for (const b of content.added) {
      const k = `${b.type}:${b.colour}`;
      const p = parts.get(k) ?? { type: b.type, colour: b.colour, n: 0 };
      p.n++;
      parts.set(k, p);
    }
    const boxY = 556;
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.strokeRect(24, boxY, PAGE_W - 48, 170);
    g.font = '18px system-ui, sans-serif';
    g.fillText('Add these bricks:', 36, boxY + 10);
    // Many kinds of brick get smaller icons in more rows, so the list never runs off the box.
    const layout = partsLayout(parts.size, PAGE_W - 72, 140);
    [...parts.values()].forEach((p, i) => {
      const cell = partCell(layout, i);
      const x = 36 + cell.x;
      const y = boxY + 30 + cell.y;
      const name = partName(p.type, p.colour);
      if (layout.stacked) {
        g.drawImage(this.partIcon(p.type, p.colour), x, y, layout.icon, layout.icon);
        g.font = `bold ${layout.countPx}px system-ui, sans-serif`;
        g.fillText(`${p.n}×`, x + 4, y + layout.icon + 4);
        g.font = `${layout.namePx}px system-ui, sans-serif`;
        g.fillText(name, x + 4, y + layout.icon + 30, layout.cellW - 8);
      } else {
        const iconY = y + (layout.cellH - layout.icon) / 2;
        g.drawImage(this.partIcon(p.type, p.colour), x, iconY, layout.icon, layout.icon);
        const textX = x + layout.icon + 4;
        const textW = layout.cellW - layout.icon - 8;
        const textY = y + (layout.cellH - layout.countPx - layout.namePx - 2) / 2;
        g.font = `bold ${layout.countPx}px system-ui, sans-serif`;
        g.fillText(`${p.n}×`, textX, textY, textW);
        g.font = `${layout.namePx}px system-ui, sans-serif`;
        g.fillText(name, textX, textY + layout.countPx + 2, textW);
      }
    });

    // Big page number and the ink stamp.
    g.font = 'bold 64px system-ui, sans-serif';
    g.fillText(String(content.step + 1), 28, PAGE_H - 92);
    drawStamp(g, PAGE_W - 92, PAGE_H - 62, content.stamp);

    if (cacheKey) this.cache.set(cacheKey, c);
    return c;
  }
}

/**
 * The master index: the real stamp of this round and every page's parts list, so players can
 * check a page they found against it.
 */
export function printIndex(build: TargetBuild, stamp: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PAGE_W;
  c.height = PAGE_H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3efe2';
  g.fillRect(0, 0, PAGE_W, PAGE_H);
  drawWatermark(g);
  g.fillStyle = INK;
  g.textBaseline = 'top';
  g.font = 'bold 30px system-ui, sans-serif';
  g.fillText('MASTER INDEX', 24, 22);
  g.font = '18px system-ui, sans-serif';
  g.fillText(`${build.name}: every real page carries this stamp`, 24, 62);
  g.fillRect(24, 92, PAGE_W - 48, 3);
  drawStamp(g, PAGE_W - 80, 52, stamp);
  // Every page's parts in the biggest print that fits, in up to three columns.
  const entries = build.steps.map((step, i) => {
    const parts = new Map<string, number>();
    for (const b of step.bricks) {
      const k = partName(b.type, b.colour);
      parts.set(k, (parts.get(k) ?? 0) + 1);
    }
    return { label: `Page ${i + 1}`, parts: [...parts].map(([name, n]) => `${n}× ${name}`) };
  });
  const font = (px: number, bold: boolean) => `${bold ? 'bold ' : ''}${px}px system-ui, sans-serif`;
  const measure = (text: string, px: number, bold: boolean) => {
    g.font = font(px, bold);
    return g.measureText(text).width;
  };
  const top = 110;
  const layout = indexLayout(entries, measure, PAGE_W - 48, PAGE_H - top - 24);
  for (const t of layout.texts) {
    g.font = font(layout.px, t.bold);
    g.fillText(t.text, 24 + t.x, top + t.y);
  }
  return c;
}

function drawWatermark(g: CanvasRenderingContext2D): void {
  g.save();
  g.fillStyle = 'rgba(30, 91, 198, 0.06)';
  g.font = 'bold 26px system-ui, sans-serif';
  g.translate(PAGE_W / 2, PAGE_H / 2);
  g.rotate(-0.5);
  for (let y = -PAGE_H; y < PAGE_H; y += 70) {
    for (let x = -PAGE_W; x < PAGE_W; x += 210)
      g.fillText('SOME ASSEMBLY', x + (y % 140 ? 105 : 0), y);
  }
  g.restore();
}

function drawStamp(g: CanvasRenderingContext2D, x: number, y: number, symbol: string): void {
  g.save();
  g.translate(x, y);
  g.rotate(-0.18);
  g.strokeStyle = 'rgba(201, 26, 26, 0.8)';
  g.fillStyle = 'rgba(201, 26, 26, 0.8)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(0, 0, 44, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, 36, 0, Math.PI * 2);
  g.stroke();
  g.font = 'bold 36px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(symbol, 0, 2);
  g.font = 'bold 8px system-ui, sans-serif';
  g.fillText('APPROVED', 0, -21);
  g.restore();
}
