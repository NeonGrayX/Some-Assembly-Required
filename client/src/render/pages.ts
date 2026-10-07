import * as THREE from 'three';
import { BRICK_TYPES, COLOURS, PLATE_H, STUD, footprint, localCentre } from '@sar/shared';
import { brickName, pageNumber } from '@sar/shared';
import type {
  BrickTypeId,
  ColourId,
  PageHalf,
  PageView,
  Placement,
  PrintedPage,
  TargetBrick,
  TargetBuild,
} from '@sar/shared';
import { baseplateMarker, brickGeometry, brickMaterial } from './bricks.ts';

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
  /** Half of a paired step: A prints positions without colours, B colours without positions. */
  half?: PageHalf;
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
    ...(printed.half ? { half: printed.half } : {}),
  };
}

/** Uncoloured bricks, for half A of a paired page: the shape and the place, not the colour. */
const plainMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b4a8, roughness: 0.7 });
const HALF_NOTES: Record<PageHalf, string> = {
  A: 'Half A: where the bricks go. Half B says which colours they are.',
  B: 'Half B: which colours the bricks are. Half A shows where they go.',
};

const BASEPLATE: Placement = { type: 'baseplate16', x: 0, y: 0, z: 0, rot: 0 };

const fadedMaterials = new Map<ColourId, THREE.MeshStandardMaterial>();
function fadedMaterial(colour: ColourId): THREE.MeshStandardMaterial {
  let m = fadedMaterials.get(colour);
  if (!m) {
    const c = new THREE.Color(COLOURS[colour].hex).lerp(new THREE.Color(0xffffff), 0.55);
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
    fadedMaterials.set(colour, m);
  }
  return m;
}

const outline = new THREE.LineBasicMaterial({ color: 0x111111 });

/** Adds a brick mesh (and optionally an outline) to `parent`, in baseplate grid coordinates. */
export function addBrickMesh(
  parent: THREE.Object3D,
  b: Placement & { colour: ColourId },
  material: THREE.Material,
  withOutline = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(brickGeometry(b.type), material);
  const c = localCentre(b);
  mesh.position.set(c.x, c.y, c.z);
  mesh.rotation.y = (b.rot * Math.PI) / 2;
  mesh.castShadow = mesh.receiveShadow = true;
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
  const { w, d } = footprint(b.type, b.rot);
  const h = BRICK_TYPES[b.type].plates;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w * STUD + 0.03, h * PLATE_H + 0.03, d * STUD + 0.03),
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
  /** Box art per build object, so an imported build that replaces another gets new art. */
  private readonly covers = new WeakMap<TargetBuild, HTMLCanvasElement>();

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

  /** Picture of a single brick, for parts lists and bins; `null` colour prints it uncoloured. */
  partIcon(type: BrickTypeId, colour: ColourId | null): HTMLCanvasElement {
    const key = `icon:${type}:${colour ?? 'plain'}`;
    let c = this.cache.get(key);
    if (!c) {
      const g = new THREE.Group();
      const material = colour ? brickMaterial(colour) : plainMaterial;
      addBrickMesh(g, { type, colour: colour ?? 'white', x: 0, y: 0, z: 0, rot: 0 }, material);
      c = this.snapshot(g, 128, 128, 1.15);
      this.cache.set(key, c);
    }
    return c;
  }

  /** The finished model, as on the front of the box. */
  boxArt(build: TargetBuild): HTMLCanvasElement {
    let c = this.covers.get(build);
    if (!c) {
      const g = new THREE.Group();
      addBrickMesh(
        g,
        { ...BASEPLATE, colour: 'baseplate-green' },
        brickMaterial('baseplate-green'),
      );
      g.add(baseplateMarker());
      for (const b of build.steps.flatMap((s) => s.bricks))
        addBrickMesh(g, b, brickMaterial(b.colour));
      c = this.snapshot(g, 400, 400, build.cover?.zoom, build.cover?.turn);
      this.covers.set(build, c);
    }
    return c;
  }

  page(content: PageContent, key?: string): HTMLCanvasElement {
    const cacheKey = key && `page:${key}`;
    const cached = cacheKey ? this.cache.get(cacheKey) : undefined;
    if (cached) return cached;

    const model = new THREE.Group();
    addBrickMesh(
      model,
      { ...BASEPLATE, colour: 'baseplate-green' },
      fadedMaterial('baseplate-green'),
    );
    model.add(baseplateMarker());
    for (const b of content.before) addBrickMesh(model, b, fadedMaterial(b.colour));
    // Half B keeps its new bricks off the picture: it only says which colours they are.
    const half = content.half;
    if (half !== 'B') {
      for (const b of content.added) {
        addBrickMesh(model, b, half === 'A' ? plainMaterial : brickMaterial(b.colour), true);
      }
    }
    const note = half ? HALF_NOTES[half] : content.note;
    // A note takes a line off the bottom of the picture.
    const pictureH = note ? 440 : 470;
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
    g.fillText(
      `Step ${content.step + 1} of ${content.totalSteps}${half ? ` · half ${half}` : ''}`,
      PAGE_W - 24,
      28,
    );
    g.textAlign = 'left';
    g.fillRect(24, 66, PAGE_W - 48, 3);

    g.drawImage(picture, 20, 76);
    if (note) {
      g.font = 'italic 18px system-ui, sans-serif';
      g.fillText(note, 24, 76 + pictureH + 6, PAGE_W - 48);
    }

    // Parts list. Half A lists shapes only, so bricks of one shape in different colours merge.
    const parts = new Map<string, { type: BrickTypeId; colour: ColourId | null; n: number }>();
    for (const b of content.added) {
      const colour = half === 'A' ? null : b.colour;
      const k = `${b.type}:${colour ?? ''}`;
      const p = parts.get(k) ?? { type: b.type, colour, n: 0 };
      p.n++;
      parts.set(k, p);
    }
    const boxY = 556;
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.strokeRect(24, boxY, PAGE_W - 48, 170);
    g.font = '18px system-ui, sans-serif';
    g.fillText('Add these bricks:', 36, boxY + 10);
    let x = 36;
    for (const p of parts.values()) {
      g.drawImage(this.partIcon(p.type, p.colour), x, boxY + 30, 84, 84);
      g.font = 'bold 22px system-ui, sans-serif';
      g.fillText(`${p.n}×`, x + 4, boxY + 118);
      g.font = '13px system-ui, sans-serif';
      g.fillText(p.colour ? `${p.colour} ${p.type}` : `${p.type} (see half B)`, x + 4, boxY + 144);
      x += 132;
    }

    // Big page number and the ink stamp.
    g.font = 'bold 64px system-ui, sans-serif';
    g.fillText(pageNumber(content), 28, PAGE_H - 92);
    drawStamp(g, PAGE_W - 92, PAGE_H - 62, content.stamp);

    if (cacheKey) this.cache.set(cacheKey, c);
    return c;
  }
}

/**
 * A page this player may not read (blind build mode): the print is a blur of grey lines, with
 * a note on who can read it.
 */
export function printUnreadable(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PAGE_W;
  c.height = PAGE_H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3efe2';
  g.fillRect(0, 0, PAGE_W, PAGE_H);
  drawWatermark(g);
  // Smudged print: soft grey bars where the picture and the parts list would be.
  g.fillStyle = 'rgba(70, 70, 80, 0.18)';
  g.fillRect(24, 22, 300, 30);
  g.fillRect(24, 92, PAGE_W - 48, 3);
  for (let i = 0; i < 9; i++) g.fillRect(40 + (i % 3) * 30, 130 + i * 48, 400 - (i % 4) * 60, 22);
  g.fillStyle = 'rgba(70, 70, 80, 0.12)';
  g.fillRect(60, 560, PAGE_W - 120, 200);
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 26px system-ui, sans-serif';
  g.fillText("You can't make this out.", PAGE_W / 2, PAGE_H / 2 - 20);
  g.font = '20px system-ui, sans-serif';
  g.fillText('Only the reader can read the pages.', PAGE_W / 2, PAGE_H / 2 + 18);
  g.textAlign = 'start';
  return c;
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
  // Long builds get two columns of smaller print, so up to 16 pages fit.
  const columns = build.steps.length > 8 ? 2 : 1;
  const perColumn = Math.ceil(build.steps.length / columns);
  const colW = (PAGE_W - 48) / columns;
  const line = columns > 1 ? 17 : 20;
  let y = 110;
  build.steps.forEach((step, i) => {
    const col = Math.floor(i / perColumn);
    if (i % perColumn === 0) y = 110;
    const x = 24 + col * colW;
    const parts = new Map<string, number>();
    for (const b of step.bricks) {
      const k = brickName(b.type, b.colour);
      parts.set(k, (parts.get(k) ?? 0) + 1);
    }
    g.font = `bold ${columns > 1 ? 14 : 19}px system-ui, sans-serif`;
    g.fillText(`Page ${i + 1}`, x, y);
    g.font = `${columns > 1 ? 13 : 16}px system-ui, sans-serif`;
    const lines = [...parts].map(([name, n]) => `${n}× ${name}`);
    lines.forEach((text, j) => g.fillText(text, x + (columns > 1 ? 74 : 120), y + 2 + j * line));
    y += Math.max(1, lines.length) * line + (columns > 1 ? 9 : 14);
  });
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
