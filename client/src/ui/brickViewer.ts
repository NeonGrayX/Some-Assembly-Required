import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BRICK_TYPES, COLOURS } from '@sar/shared';
import type { BrickTypeId, ColourId } from '@sar/shared';
import { brickGeometry, brickMaterial } from '../render/bricks.ts';
import { CORNER, addBrickLights, brickEdges, brickThumb, centreBrick } from './brickThumbs.ts';

/**
 * The build editor's brick viewer: every brick type in a list, and the chosen one on its own
 * in a preview that can be turned to any side, underneath included.
 */

/** Readable name: '1x4' is a "1×4 brick", 'plate2x4' a "2×4 plate". */
export function brickName(type: BrickTypeId): string {
  const t = BRICK_TYPES[type];
  if (t.name) return t.name.replace(/(\d)x(\d)/, '$1×$2');
  const size = `${t.studsZ}×${t.studsX}`;
  if (t.fixture) return `${size} baseplate`;
  return `${size} ${t.plates === 1 ? 'plate' : 'brick'}`;
}

/** Camera directions for the side buttons, from the brick's centre. The front is +z. */
const SIDES: Record<string, THREE.Vector3> = {
  Front: new THREE.Vector3(0, 0, 1),
  Back: new THREE.Vector3(0, 0, -1),
  Left: new THREE.Vector3(-1, 0, 0),
  Right: new THREE.Vector3(1, 0, 0),
  // Tipped a little towards the front: straight on, every stud and tube face is the same
  // shade and the brick reads as flat.
  Top: new THREE.Vector3(0, 1, 0.25),
  Bottom: new THREE.Vector3(0, -1, 0.25),
  Corner: CORNER,
};

export interface BrickViewerOptions {
  /** Called with the type when "Use this brick" is pressed (not offered for fixtures). */
  onUse(type: BrickTypeId, colour: ColourId): void;
}

export function createBrickViewer(opts: BrickViewerOptions) {
  const root = document.createElement('div');
  root.id = 'brick-viewer';
  root.hidden = true;
  root.innerHTML = `
    <div class="bv-list" role="listbox" aria-label="Brick types"></div>
    <div class="bv-stage">
      <div class="bv-canvas"></div>
      <div class="bv-top">
        <strong class="bv-name"></strong>
        <span class="bv-info"></span>
        <button type="button" class="bv-close" title="Close (Esc)">✕</button>
      </div>
      <div class="bv-bottom">
        <div class="bv-sides"></div>
        <label>Colour <select class="bv-colour"></select></label>
        <label class="inline"><input type="checkbox" class="bv-spin" /> spin</label>
        <button type="button" class="bv-use">Use this brick</button>
      </div>
      <p class="bv-help">Drag to turn · Scroll to zoom · Right drag to pan · ←→↑↓ to step a side</p>
    </div>`;
  document.body.append(root);
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const list = q('.bv-list');
  const holder = q('.bv-canvas');
  const nameEl = q('.bv-name');
  const infoEl = q('.bv-info');
  const colourSel = q<HTMLSelectElement>('.bv-colour');
  const spin = q<HTMLInputElement>('.bv-spin');
  const useBtn = q<HTMLButtonElement>('.bv-use');

  for (const c of Object.values(COLOURS)) colourSel.add(new Option(c.id, c.id));

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  holder.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9e4d8);
  addBrickLights(scene);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.005, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  controls.autoRotateSpeed = 3;

  const mesh = new THREE.Mesh(brickGeometry('2x4'), brickMaterial('red'));
  scene.add(mesh);
  const edges = new THREE.LineSegments(
    undefined,
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
  );
  mesh.add(edges);

  let type: BrickTypeId = '2x4';
  let colour: ColourId = 'red';
  let open = false;
  let radius = 0.3;

  /** Puts the camera looking at the brick from `dir`, far enough to see all of it. */
  function frame(dir: THREE.Vector3): void {
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fit = radius / Math.sin(fov / 2);
    const dist = fit * (camera.aspect < 1 ? 1.25 / camera.aspect : 1.25);
    camera.position.copy(dir).normalize().multiplyScalar(dist);
    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 1.2;
    controls.maxDistance = dist * 4;
    camera.lookAt(0, 0, 0);
    controls.update();
  }

  function resize(): void {
    const w = holder.clientWidth;
    const h = holder.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // Thumbnails: each type drawn once from the corner, in the current colour.
  const items = new Map<BrickTypeId, HTMLButtonElement>();
  for (const t of Object.values(BRICK_TYPES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.innerHTML = `<img alt="" /><span></span>`;
    b.querySelector('span')!.textContent = brickName(t.id);
    b.addEventListener('click', () => select(t.id, false));
    list.append(b);
    items.set(t.id, b);
  }

  function drawThumbnails(): void {
    for (const [id, b] of items) b.querySelector('img')!.src = brickThumb(id, colour);
  }

  function setMesh(id: BrickTypeId): void {
    mesh.geometry = brickGeometry(id);
    edges.geometry = brickEdges(id);
    // Centre on the whole brick, studs included, so it turns about its middle.
    radius = centreBrick(mesh);
  }

  function select(id: BrickTypeId, keepView: boolean): void {
    type = id;
    const t = BRICK_TYPES[id];
    setMesh(id);
    if (!keepView) frame(SIDES.Corner!);
    nameEl.textContent = brickName(id);
    const mm = (n: number) => +n.toFixed(1);
    infoEl.textContent =
      `${t.studsZ} × ${t.studsX} studs · ${t.plates} plate${t.plates > 1 ? 's' : ''} tall · ` +
      `${mm(t.studsZ * 8)} × ${mm(t.studsX * 8)} × ${mm(t.plates * 3.2)} mm` +
      (t.fixture ? ' · fixture, not in the bins' : '');
    useBtn.hidden = !!t.fixture;
    for (const [k, b] of items) b.setAttribute('aria-selected', String(k === id));
    items.get(id)!.scrollIntoView({ block: 'nearest' });
  }

  function setColour(c: ColourId): void {
    colour = c;
    colourSel.value = c;
    mesh.material = brickMaterial(c);
  }

  const sides = q('.bv-sides');
  for (const name of Object.keys(SIDES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => frame(SIDES[name]!));
    sides.append(b);
  }

  colourSel.addEventListener('change', () => {
    setColour(colourSel.value as ColourId);
    drawThumbnails();
  });
  spin.addEventListener('change', () => (controls.autoRotate = spin.checked));
  useBtn.addEventListener('click', () => {
    opts.onUse(type, colour);
    close();
  });
  q('.bv-close').addEventListener('click', () => close());
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });

  const order = Object.keys(BRICK_TYPES) as BrickTypeId[];
  window.addEventListener(
    'keydown',
    (e) => {
      if (!open) return;
      if (e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Step through the list.
        const i = order.indexOf(type) + (e.key === 'ArrowDown' ? 1 : -1);
        select(order[(i + order.length) % order.length]!, false);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Quarter turn around the brick.
        const off = camera.position.clone().sub(controls.target);
        off.applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          ((e.key === 'ArrowLeft' ? -1 : 1) * Math.PI) / 2,
        );
        camera.position.copy(controls.target).add(off);
        controls.update();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  window.addEventListener('resize', () => open && resize());

  function show(startType: BrickTypeId, startColour: ColourId): void {
    open = true;
    root.hidden = false;
    setColour(startColour);
    resize();
    drawThumbnails();
    select(startType, false);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
  }

  function close(): void {
    open = false;
    root.hidden = true;
    renderer.setAnimationLoop(null);
  }

  return {
    show,
    close,
    select: (id: BrickTypeId) => select(id, false),
    view: (side: keyof typeof SIDES) => frame(SIDES[side]!),
    get isOpen() {
      return open;
    },
  };
}
