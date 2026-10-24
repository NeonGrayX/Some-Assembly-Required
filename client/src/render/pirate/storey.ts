import * as THREE from 'three';
import { add } from '../interiors.ts';
import { atNight } from '../daynight.ts';
import { FRAME as WALL_FRAME } from '../details.ts';
import { hex, put, windowBoxPlants } from '../nature.ts';
import { bevelBox } from '../shapes.ts';
import { Surface, madeOf } from '../styles.ts';
import { Quads, block, coloured, fitting, made, rod, slab, times } from './kit.ts';
import type { RoofWalls } from './roofs.ts';

/** The timber-framed upper storey: its walls, windows, knee braces and lanterns. */

/** A storey's timber frame, a rich dark brown. */
const FRAME = 0x66401f;
/** The boards under a jetty, in its shade. */
const SOFFIT = 0x5b3b22;
/**
 * The iron of a building's straps, plates and brackets: a dark grey, catching the light (any
 * bluer or paler and the blue sky in it turns it bright blue).
 */
const STRAP = 0x484b50;
/** The leading of a lattice window. */
const LEADING = 0x2b2723;
/** A shutter's boards. */
const SHUTTER = 0x80522c;
/** The warm glow of a lamp-lit room behind glass. */
const GLOW = 0xffc46a;

/** A building's ironwork: grey, its edges catching the light, but less of a mirror than steel. */
const strapIron = () => made(STRAP, Surface.Metal, 0.55, 0.4);

let lampLit: THREE.MeshStandardMaterial | null = null;

/** Glass with a lamp-lit room behind it: warm by day, glowing at night. */
export function litGlass(): THREE.MeshStandardMaterial {
  lampLit ??= atNight(
    madeOf(
      new THREE.MeshStandardMaterial({
        color: 0xe9b65a,
        emissive: GLOW,
        emissiveIntensity: 0.22,
        roughness: 0.3,
      }),
      Surface.Auto,
    ),
    1.3,
  );
  return lampLit;
}

/** One side of a storey, by the way out of it in its frame. */
export type StoreySide = '-z' | '+z' | '-x' | '+x';

/** What a storey stands on, in its frame (see `storeyModel`). */
export interface StoreyBelow {
  /** The outer faces of the walls under it. */
  walls: RoofWalls;
  /**
   * Where nothing may come down the walls under its jetty: round the doorways and windows in
   * them, and whatever stands against them up there (a porch's roof).
   */
  keepOut: THREE.Box3[];
  /** Whether those walls are plank walls framed in timber (see `UNDER_FRAME`). */
  framed: boolean;
}

/**
 * The timber frame round a plank building's walls (drawn with the house's details, see
 * `WALL_FRAME`): how far the beam along their tops stands out from them (and a little more), and
 * how deep it is; and how far its corner posts, with the iron straps round them, reach along
 * the walls from the corners (and a centimetre more).
 */
const UNDER_FRAME = {
  proud: WALL_FRAME.beamProud + 0.002,
  beam: WALL_FRAME.beam,
  corner: Math.max(WALL_FRAME.post, WALL_FRAME.strap.length) + 0.01,
};

/** How a side of a storey lies in its frame: turned `turn` about y from the front (-z). */
const SIDES: { side: StoreySide; turn: number }[] = [
  { side: '-z', turn: 0 },
  { side: '+z', turn: Math.PI },
  { side: '-x', turn: Math.PI / 2 },
  { side: '+x', turn: -Math.PI / 2 },
];

/**
 * The lattice of a window `pw` wide and `ph` tall about (`uc`, `yc`) in the plane z = `z`,
 * facing -z: diamond panes between thin strips of leading, as flat quads.
 */
function lattice(uc: number, yc: number, pw: number, ph: number, z: number): THREE.BufferGeometry {
  const q = new Quads();
  const c = hex(LEADING);
  const bar = 0.014;
  // The two families of lines, u - uc = ±k (y - yc) + c: diamonds taller than they are wide.
  const k = 0.62;
  const spacing = pw / 3;
  const out = new THREE.Vector3(0, 0, -1);
  for (const s of [-1, 1])
    for (let i = -6; i <= 6; i++) {
      const c0 = i * spacing;
      // Where the line is in the pane: y over its height, cut where u leaves it.
      const ys: number[] = [];
      for (const [ya, yb] of [[-ph / 2, ph / 2]]) {
        let lo = ya!;
        let hi = yb!;
        // u = c0 + s k y must lie in [-pw/2, pw/2].
        const y1 = (-pw / 2 - c0) / (s * k);
        const y2 = (pw / 2 - c0) / (s * k);
        lo = Math.max(lo, Math.min(y1, y2));
        hi = Math.min(hi, Math.max(y1, y2));
        if (hi - lo > 0.02) ys.push(lo, hi);
      }
      if (ys.length < 2) continue;
      const [y0, y1] = ys as [number, number];
      const a = new THREE.Vector3(uc + c0 + s * k * y0, yc + y0, z);
      const b = new THREE.Vector3(uc + c0 + s * k * y1, yc + y1, z);
      const along = b.clone().sub(a).normalize();
      const across = new THREE.Vector3(-along.y, along.x, 0).multiplyScalar(bar / 2);
      q.flat(
        [
          a.clone().add(across),
          b.clone().add(across),
          b.clone().sub(across),
          a.clone().sub(across),
        ],
        out,
        c,
      );
    }
  return q.geometry();
}

/**
 * The upper storey of a half-timbered building over the walls of its room, the box, jutting out
 * past them (`below`) on its jetty: on every side a dark timber frame of a sill and a head beam,
 * posts at the corners and studs between, braced on the slant, with plaster in `colour` in the
 * panels between them; on each side one or two windows of leaded diamond panes, lit warm, in chunky
 * frames, with board shutters open either side and a sill under them, and a window box of
 * flowers under the front's. Under it the floor's joists run out to the jetty, capped in iron,
 * and on the longer stretches of wall below, heavy knee braces strapped in iron hold it up. The
 * head beams cross at the corners and run out past them, capped in iron; iron plates bind the
 * corners, and a lantern hangs at the front on an iron arm.
 *
 * The frame stands at the box's faces and the plaster a little in from them; what stands out
 * from a wall (shutters, sills, the window box, the lantern, the head beams' ends) reaches out
 * of the box, and the knee braces down the walls under it.
 */
export function storeyModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  below: StoreyBelow | null,
): void {
  const wood = hex(FRAME);
  const tone = () => times(wood, 0.86 + seed() * 0.26);
  const timber = (geometry: THREE.BufferGeometry, parent: THREE.Object3D = g) =>
    put(parent, geometry, Surface.Auto);
  const ironwork = strapIron();
  const foot = -h / 2;
  // How far in from the box's faces the plaster is, and how deep the timbers are from them.
  const e = 0.004;
  const inset = 0.06;
  const deep = inset + 0.03;
  // The joists under it (and the boards on them), the sill and head beams and the posts.
  const joistH = 0.2;
  const boards = 0.05;
  const sillH = 0.2;
  const headH = 0.2;
  const corner = 0.24;
  const stud = 0.13;
  const sillTop = foot + joistH + sillH;
  const headFoot = h / 2 - headH;
  const walls = below?.walls ?? {
    x0: -w / 2 + 0.3,
    x1: w / 2 - 0.3,
    z0: -d / 2 + 0.3,
    z1: d / 2 - 0.3,
  };

  // The plaster, one block in from the faces, on the boards, and its top a hair under the head
  // beams' (where the roof hides it).
  const plasterH = h - joistH - 0.006;
  add(
    g,
    new THREE.BoxGeometry(w - 2 * inset, plasterH, d - 2 * inset),
    made(colour, Surface.Wall, 0.92),
    0,
    foot + joistH + plasterH / 2,
    0,
  );
  // The boards over the joists: the ceiling of the room under it.
  add(
    g,
    new THREE.BoxGeometry(w - 2 * e, boards, d - 2 * e),
    made(SOFFIT, Surface.Planks, 0.85),
    0,
    foot + joistH - boards / 2,
    0,
  );
  // The joists: right across from front to back every half metre or so, and short ones out
  // over the end walls, each end that shows capped in iron and bolted (the caps a hair proud of
  // the boards' edges).
  const jh = joistH - boards;
  const jy = foot + jh / 2;
  const cap = 0.025;
  const capAt = (s: number, half: number) => s * (half - e / 2 - cap / 2);
  const capOn = (x: number, z: number, alongZ: boolean, out: number) => {
    const plate = alongZ ? bevelBox(0.15, jh + 0.02, cap) : bevelBox(cap, jh + 0.02, 0.15);
    fitting(g, plate, ironwork, x, jy, z);
    const bolt = new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6);
    if (alongZ) fitting(g, bolt.rotateX(Math.PI / 2), ironwork, x, jy, z + out * 0.02);
    else fitting(g, bolt.rotateZ(Math.PI / 2), ironwork, x + out * 0.02, jy, z);
  };
  const across = Math.max(2, Math.round((w - 0.3) / 0.48));
  const xs = Array.from({ length: across + 1 }, (_, i) => -w / 2 + 0.15 + ((w - 0.3) * i) / across);
  for (const x of xs) {
    timber(block(0.12, jh, d - 2 * (e + cap), x, jy, 0, tone()));
    for (const s of [-1, 1]) capOn(x, capAt(s, d / 2), true, s);
  }
  const span = walls.z1 - walls.z0 - 0.6;
  const along = Math.max(1, Math.round(span / 0.48));
  const zs = Array.from({ length: along + 1 }, (_, i) => walls.z0 + 0.3 + (span * i) / along);
  for (const s of [-1, 1]) {
    // From the face in to a little over the wall.
    const x0 = s * (w / 2 - e - cap);
    const x1 = (s < 0 ? walls.x0 : walls.x1) - s * 0.25;
    if (s * (x0 - x1) < 0.15) continue;
    for (const z of zs) {
      timber(block(Math.abs(x1 - x0), jh, 0.12, (x0 + x1) / 2, jy, z, tone()));
      capOn(capAt(s, w / 2), z, false, s);
    }
  }

  // Each side, built in a frame of its own: its face the plane z = 0, the way out of it -z, and
  // u (its x) along it.
  for (const { side, turn } of SIDES) {
    const f = new THREE.Group();
    f.rotation.y = turn;
    const long = side === '-z' || side === '+z';
    const L = long ? w : d;
    const half = long ? d / 2 : w / 2;
    f.position.set(-Math.sin(turn) * half, 0, -Math.cos(turn) * half);
    g.add(f);
    // The sill and head beams run from corner to corner on the front and back, and between
    // those on the ends, so that no two faces lie in one plane at a corner. The front's and
    // back's head beams run on out past the corners, where the ends' cross them, capped in iron.
    const ends = long ? L / 2 - e : L / 2 - deep;
    const z = (deep - e) / 2 + e;
    timber(block(2 * ends, sillH, deep - e, 0, foot + joistH + sillH / 2, z, tone()), f);
    const run = long ? 0.16 : 0;
    const headY = h / 2 - headH / 2;
    timber(block(2 * (ends + run), headH, deep - e, 0, headY, z, tone()), f);
    if (long)
      for (const s of [-1, 1]) {
        // Flat against the beam's end (its top, square to the end, would flicker through a
        // cap sunk into it).
        const capping = bevelBox(0.03, headH, deep + 0.01);
        fitting(f, capping, ironwork, s * (ends + run + 0.015), headY, z);
        const bolt = new THREE.CylinderGeometry(0.024, 0.024, 0.03, 6).rotateZ(Math.PI / 2);
        fitting(f, bolt, ironwork, s * (ends + run + 0.03), headY, z);
      }
    // The corner posts, square, showing on both faces (built with the front and back).
    const tall = headFoot - sillTop;
    const ym = sillTop + tall / 2;
    if (long)
      for (const s of [-1, 1])
        timber(
          block(corner, tall, corner, s * (L / 2 - e - corner / 2), ym, e + corner / 2, tone()),
          f,
        );
    // The bays between the corner posts, an odd number of them, with studs between.
    const u0 = -L / 2 + e + corner;
    const u1 = L / 2 - e - corner;
    const bays = Math.max(3, 2 * Math.round(((u1 - u0) / 1.05 - 1) / 2) + 1);
    const bay = (u1 - u0) / bays;
    for (let i = 1; i < bays; i++)
      timber(block(stud, tall, deep - e, u0 + bay * i, ym, z, tone()), f);
    // The windows: in the middle bay, or either side of it on a long side.
    const windows = bays >= 5 && L > 4.6 ? [1, bays - 2] : [(bays - 1) / 2];
    const winW = Math.min(0.78, bay - stud - 0.24);
    const fw = 0.09;
    const winH = Math.min(0.95, tall - 0.5);
    const winY = headFoot - 0.14 - fw - winH / 2;
    for (let i = 0; i < bays; i++) {
      const ua = u0 + bay * i + (i > 0 ? stud / 2 : 0);
      const ub = u0 + bay * (i + 1) - (i < bays - 1 ? stud / 2 : 0);
      if (windows.includes(i)) {
        storeyWindow(f, (ua + ub) / 2, winY, winW, winH, fw, wood, tone, seed, {
          inset,
          deep,
          railTo: [ua, ub],
          box: side === '-z' && i === windows[0],
        });
        continue;
      }
      // A brace on the slant, rising to the corner post in an end bay, or a cross of two (the
      // one behind set back a hair) in a bay between.
      const bw = 0.15;
      const brace = (from: number, to: number, back = 0) => {
        const outline: [number, number][] = [
          [from - bw / 2, sillTop],
          [from + bw / 2, sillTop],
          [to + bw / 2, headFoot],
          [to - bw / 2, headFoot],
        ];
        const geometry = slab(outline, -deep + back, -e - back, 0.012).rotateY(Math.PI / 2);
        timber(coloured(geometry, tone()), f);
      };
      const inA = ua + bw / 2 + 0.01;
      const inB = ub - bw / 2 - 0.01;
      if (i === 0) brace(inB, inA);
      else if (i === bays - 1) brace(inA, inB);
      else {
        brace(inA, inB);
        brace(inB, inA, 0.012);
      }
    }
    // Iron plates binding the corners at the sill and the head, bolted through: on the front
    // and back round the corner's edge, on the ends up to the corner posts.
    const plate = 0.34;
    const reach = long ? L / 2 + 0.012 : L / 2 - deep;
    for (const s of [-1, 1])
      for (const y of [foot + joistH + sillH / 2, headY]) {
        const u = s * (reach - plate / 2);
        fitting(f, bevelBox(plate, 0.12, 0.02), ironwork, u, y, -0.006);
        for (const du of [-0.09, 0.09]) {
          const bolt = new THREE.CylinderGeometry(0.02, 0.02, 0.025, 6).rotateX(Math.PI / 2);
          fitting(f, bolt, ironwork, u + du, y, -0.02);
        }
      }
    // Knee braces under the jetty, where the walls under it run on clear.
    const face = {
      '-z': walls.z0 + d / 2,
      '+z': d / 2 - walls.z1,
      '-x': walls.x0 + w / 2,
      '+x': w / 2 - walls.x1,
    }[side];
    if (below && face > 0.15 + (below.framed ? UNDER_FRAME.proud : 0)) {
      // The wall's ends and the joists over it, along the side.
      const [wa, wb, us] = {
        '-z': [walls.x0, walls.x1, xs],
        '+z': [-walls.x1, -walls.x0, xs.map((x) => -x)],
        '-x': [-walls.z1, -walls.z0, zs.map((zz) => -zz)],
        '+x': [walls.z0, walls.z1, zs],
      }[side] as [number, number, number[]];
      kneeBraces(f, us, wa, wb, face, foot, tone, below, ironwork);
    }
    // A lantern on an iron arm on a front corner post.
    if (side === '-z')
      frontLantern(f, (seed() < 0.5 ? -1 : 1) * (L / 2 - e - corner / 2), headFoot - 0.1, ironwork);
  }
}

/** The tones a storey's timbers are painted in, each its own. */
type Tones = () => THREE.Color;

/** How a window of a storey's side is fitted in its bay (see `storeyWindow`). */
interface WindowFit {
  /** How far in the plaster is from the face, and how deep the timbers are. */
  inset: number;
  deep: number;
  /** The bay it is in, along the side, which the rail under it spans. */
  railTo: [number, number];
  /** Whether a window box of flowers hangs under it. */
  box: boolean;
}

/**
 * A storey's window in a side's frame (see `storeyModel`), its middle at (`uc`, `yc`): leaded
 * diamond panes `winW` by `winH`, lit warm, in a chunky frame `fw` broad standing proud of the
 * timbers, on a rail across its bay, with a sill under it and board shutters open flat either
 * side, battened and hung on long iron straps; and under the front's, a window box of flowers.
 */
function storeyWindow(
  f: THREE.Object3D,
  uc: number,
  yc: number,
  winW: number,
  winH: number,
  fw: number,
  wood: THREE.Color,
  tone: Tones,
  seed: () => number,
  fit: WindowFit,
): void {
  const { inset, deep } = fit;
  const e = 0.004;
  const timber = (geometry: THREE.BufferGeometry) => put(f, geometry, Surface.Auto);
  const proud = 0.035;
  const fz = (deep - proud) / 2;
  const fd = deep + proud;
  const top = yc + winH / 2;
  const bottom = yc - winH / 2;
  // The frame round it, its head and foot across the posts' tops and feet.
  timber(block(winW + 2 * fw, fw, fd, uc, top + fw / 2, fz, tone()));
  timber(block(winW + 2 * fw, fw, fd, uc, bottom - fw / 2, fz, tone()));
  for (const s of [-1, 1])
    timber(block(fw, winH, fd, uc + s * (winW / 2 + fw / 2), yc, fz, tone()));
  // The rail under it across the bay, and the sill standing out over it.
  const railH = 0.12;
  const [ua, ub] = fit.railTo;
  const sillY = bottom - fw;
  timber(
    block(ub - ua, railH, deep - e, (ua + ub) / 2, sillY - railH / 2, (deep - e) / 2 + e, tone()),
  );
  const sillD = 0.12 + deep;
  timber(
    block(winW + 2 * fw + 0.1, 0.06, sillD, uc, sillY - 0.03, deep - sillD / 2, times(wood, 1.05)),
  );
  // The glass, just out from the plaster, and its leading.
  add(f, new THREE.BoxGeometry(winW, winH, 0.01), litGlass(), uc, yc, inset - 0.012);
  put(f, lattice(uc, yc, winW, winH, inset - 0.02), Surface.Auto, false);
  // The shutters either side, each of three boards with battens across and a brace between
  // them, hung on iron straps from the frame's side.
  const ironwork = strapIron();
  const sw = winW / 2 + fw * 0.5;
  const sh = winH + 2 * fw;
  const shutterWood = hex(SHUTTER).lerp(wood, 0.25);
  for (const s of [-1, 1]) {
    const inner = uc + s * (winW / 2 + fw + 0.012);
    const mid = inner + (s * sw) / 2;
    const n = 3;
    const gap = 0.008;
    const bw = (sw - gap * (n - 1)) / n;
    for (let k = 0; k < n; k++) {
      const u = inner + s * (bw / 2 + k * (bw + gap));
      timber(
        block(
          bw,
          sh - seed() * 0.03,
          0.038,
          u,
          yc,
          -0.031,
          times(shutterWood, 0.86 + seed() * 0.26),
        ),
      );
    }
    const battens = [yc - sh * 0.32, yc + sh * 0.32];
    for (const y of battens)
      timber(block(sw - 0.04, 0.08, 0.026, mid, y, -0.063, times(shutterWood, 0.9)));
    // The brace between the battens, rising away from the hinges.
    const geometry = slab(
      [
        [inner + s * 0.05, battens[0]! + 0.04],
        [inner + s * 0.05, battens[0]! + 0.04 + 0.08],
        [inner + s * (sw - 0.05), battens[1]! - 0.04],
        [inner + s * (sw - 0.05), battens[1]! - 0.04 - 0.08],
      ].map(([u, y]) => [u!, y!] as [number, number]),
      0.05,
      0.076,
    ).rotateY(Math.PI / 2);
    timber(coloured(geometry, times(shutterWood, 0.82)));
    // The straps: from the frame's side out along each batten, with a knuckle at the hinge.
    for (const y of battens) {
      const strap = new THREE.BoxGeometry(sw * 0.72, 0.045, 0.008);
      fitting(f, strap, ironwork, inner + s * sw * 0.36, y, -0.08);
      const knuckle = new THREE.CylinderGeometry(0.018, 0.018, 0.09, 6);
      fitting(f, knuckle, ironwork, inner - s * 0.006, y, -0.06);
    }
  }
  if (!fit.box) return;
  // The window box: a planked trough on two iron brackets, flowers spilling over its edge.
  const bx = winW + 2 * fw + 0.04;
  const by = 0.17;
  const bz = 0.2;
  const boxTop = sillY - 0.08;
  const zc = -bz / 2 - 0.006;
  timber(block(bx, by, bz, uc, boxTop - by / 2, zc, times(wood, 1.15)));
  add(
    f,
    new THREE.BoxGeometry(bx - 0.06, 0.01, bz - 0.06),
    made(0x3a2a1c, Surface.Auto, 0.95),
    uc,
    boxTop - 0.025,
    zc,
  );
  for (const s of [-1, 1]) {
    const u = uc + s * (bx / 2 - 0.08);
    fitting(f, bevelBox(0.03, 0.2, 0.02), ironwork, u, boxTop - by - 0.08, -0.012);
    fitting(f, bevelBox(0.03, 0.02, bz), ironwork, u, boxTop - by - 0.01, zc);
  }
  put(
    f,
    windowBoxPlants(bx - 0.06, bz - 0.06, seed).translate(uc, boxTop - 0.03, zc),
    Surface.Auto,
    false,
  );
}

/**
 * Knee braces in a side's frame (see `storeyModel`) under the jetty, `face` out from the walls,
 * from the joists at `us` (along the side) down the wall between `wa` and `wb`, where it runs
 * on clear of what `below` keeps out (in the storey's frame): a timber knee rounded underneath,
 * strapped to its joist with iron plates either side and bolted through, its foot on an iron
 * plate on the wall. On framed walls the knee stands on the beam along their tops, and below
 * the beam on a short post fixed to the wall, clear of the corner posts. One near each end of
 * the wall, and on a long one, one in the middle.
 */
function kneeBraces(
  f: THREE.Object3D,
  us: number[],
  wa: number,
  wb: number,
  face: number,
  foot: number,
  tone: Tones,
  below: StoreyBelow,
  ironwork: THREE.Material,
): void {
  const drop = 0.5;
  const t = 0.1;
  // The knee's back: on the wall, or on the beam along its top.
  const back = below.framed ? face - UNDER_FRAME.proud - 0.004 : face;
  const ends = below.framed ? UNDER_FRAME.corner + t / 2 + 0.04 : 0.22;
  f.updateMatrix();
  const toStorey = f.matrix;
  const clear = (u: number) => {
    const reach = new THREE.Box3(
      new THREE.Vector3(u - t, foot - drop - 0.1, 0),
      new THREE.Vector3(u + t, foot, face + 0.05),
    ).applyMatrix4(toStorey);
    return !below.keepOut.some((k) => k.intersectsBox(reach));
  };
  const ok = us.filter((u) => u > wa + ends && u < wb - ends && clear(u)).sort((a, b) => a - b);
  if (ok.length === 0) return;
  const picked = new Set([ok[0]!, ok[ok.length - 1]!]);
  if (wb - wa > 4.5) {
    const mid = (wa + wb) / 2;
    const middle = ok.reduce((m, u) => (Math.abs(u - mid) < Math.abs(m - mid) ? u : m));
    if (Math.min(...[...picked].map((u) => Math.abs(u - middle))) > 1) picked.add(middle);
  }
  const strap = Math.min(0.24, back - 0.03);
  for (const u of picked) {
    // The knee: along the joist's underside from the wall out to near the jetty's face, and
    // round from there down to the wall.
    const out = 0.07;
    const outline: [number, number][] = [[back, foot]];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      outline.push([back - (back - out) * Math.cos(a), foot - drop * Math.sin(a)]);
    }
    put(f, coloured(slab(outline, u - t / 2, u + t / 2, 0.015), tone()), Surface.Auto);
    // Strapped to the joist either side, bolted through.
    for (const s of [-1, 1])
      fitting(
        f,
        bevelBox(0.016, 0.2, strap),
        ironwork,
        u + s * (t / 2 + 0.008),
        foot - 0.02,
        back - strap / 2 - 0.01,
      );
    fitting(
      f,
      new THREE.CylinderGeometry(0.02, 0.02, t + 0.06, 6).rotateZ(Math.PI / 2),
      ironwork,
      u,
      foot - 0.05,
      back - Math.min(0.12, strap / 2),
    );
    // Under the beam, the post it springs from, down the wall past its foot.
    const low = foot - drop - 0.1;
    if (below.framed) {
      const high = foot - UNDER_FRAME.beam - 0.02;
      put(
        f,
        coloured(bevelBox(t, high - low, face - back - 0.002, 0.012), tone()),
        Surface.Auto,
      ).position.set(u, (low + high) / 2, (back + face - 0.002) / 2);
    }
    // Its foot on an iron plate on the wall.
    fitting(f, bevelBox(0.18, 0.22, 0.02), ironwork, u, foot - drop + 0.02, face - 0.011);
  }
}

/**
 * A lantern at `u` along a side's frame (see `storeyModel`), hung from an iron arm out from the
 * wall at height `y`, with a stay under the arm: an iron cage round warm glass under a little
 * pyramid roof.
 */
function frontLantern(f: THREE.Object3D, u: number, y: number, ironwork: THREE.Material): void {
  const reach = 0.46;
  add(f, bevelBox(0.12, 0.42, 0.02), ironwork, u, y - 0.12, -0.012);
  add(f, bevelBox(0.035, 0.035, reach), ironwork, u, y, -reach / 2 - 0.01);
  rod(
    f,
    new THREE.Vector3(u, y - 0.3, -0.02),
    new THREE.Vector3(u, y - 0.01, -reach * 0.7),
    0.014,
    ironwork,
  );
  // The hook, and the lantern under it.
  const lz = -reach + 0.04;
  fitting(f, new THREE.TorusGeometry(0.03, 0.008, 4, 8), ironwork, u, y - 0.04, lz);
  const ly = y - 0.27;
  add(f, new THREE.BoxGeometry(0.15, 0.22, 0.15), litGlass(), u, ly, lz);
  add(f, bevelBox(0.21, 0.035, 0.21), ironwork, u, ly - 0.125, lz);
  add(f, bevelBox(0.19, 0.03, 0.19), ironwork, u, ly + 0.122, lz);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      fitting(
        f,
        new THREE.BoxGeometry(0.022, 0.24, 0.022),
        ironwork,
        u + sx * 0.085,
        ly,
        lz + sz * 0.085,
      );
  const roof = add(f, new THREE.ConeGeometry(0.16, 0.12, 4), ironwork, u, ly + 0.195, lz);
  roof.rotation.y = Math.PI / 4;
  fitting(f, new THREE.TorusGeometry(0.025, 0.007, 4, 8), ironwork, u, ly + 0.27, lz);
}
