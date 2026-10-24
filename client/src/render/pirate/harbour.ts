import * as THREE from 'three';
import { add, box, mat } from '../interiors.ts';
import { LAMP_FIXTURE } from '../daynight.ts';
import { lanternGlass, lanternGlow } from '../garden.ts';
import { hex, put, shadowCore } from '../nature.ts';
import { bevelBox, bevelCylinder } from '../shapes.ts';
import { Surface } from '../styles.ts';
import {
  CARRIAGE,
  INSIDE,
  TIMBER,
  coloured,
  evenly,
  iron,
  lathe,
  made,
  slab,
  times,
} from './kit.ts';
import type { Column, Turn } from './kit.ts';
import { ropeTube, timberPost } from './rope.ts';

/**
 * The harbour's things: iron hooped barrels, lanterns on posts, coils of rope, an anchor and the
 * cannon on its truck carriage.
 */

/** How far a barrel's staves bulge: its middle this much wider than its ends, as a share. */
const BULGE = 0.14;
/** How thick a barrel's staves are. */
const STAVE = 0.028;

/**
 * A barrel standing on its end, filling the box: a dozen or so staves bulging out in the
 * middle, each its own shade with a dark groove before it and a worn lighter edge, bound with
 * four flat iron hoops, its head of planks sunk a little inside the rim. `open` leaves the head
 * out: the barrel is open at the top, dark inside down to a floor that far under the rim (a bin
 * bricks are thrown in, see `bins.ts`).
 *
 * There are a couple of dozen on the island, so each is kept to a thousand triangles or so: the
 * staves in three lines of points each (the groove, the worn edge and the stave's far side; a
 * stave's own curve across it is a few millimetres, which only its shading showed), four rows up
 * the bulge, and hoops with as few segments round as keep them clear of the staves. The staves
 * and hoops cast no shadow: a plain drum hidden inside them casts the barrel's (see
 * `shadowCore`).
 */
export function barrelModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  open = 0,
): void {
  const hoop = 0.012;
  const R = Math.min(w, d) / 2 - hoop - 0.012;
  const foot = -h / 2;
  const top = h / 2;
  const rAt = (y: number) => R * (1 - BULGE + BULGE * Math.sin((Math.PI * (y - foot)) / h));
  const staves = 12 + Math.floor(seed() * 3);
  const columns: Column[] = [];
  for (let i = 0; i < staves; i++) {
    const tone = 0.84 + seed() * 0.3;
    const a = (i / staves) * Math.PI * 2;
    const da = (Math.PI * 2) / staves;
    columns.push(
      { a, out: 0.965, shade: 0.42 },
      { a: a + da * 0.12, out: 1, shade: 1.14 * tone },
      { a: a + da * 0.8, out: 1.006, shade: 0.9 * tone },
    );
  }
  const wood = hex(colour);
  const end = wood.clone().lerp(hex(0xd9c29a), 0.4);
  const turns: Turn[] = [
    { y: foot, r: 0, colour: times(wood, 0.3) },
    { y: foot, r: rAt(foot) - 0.008, colour: times(wood, 0.45), relief: 1 },
  ];
  // (The bulge is gentle: four rows follow it to within a few millimetres.)
  const rows = 4;
  for (let i = 0; i <= rows; i++) {
    const y = foot + 0.012 + ((h - 0.024) * i) / rows;
    // Darker low down, in the shade of its own belly.
    const shade = 0.66 + 0.34 * Math.min(1, (i / rows) * 1.7);
    turns.push({ y, r: rAt(y), colour: times(wood, shade), relief: 1 });
  }
  // The rim: the staves' ends, worn pale, and inside them the head (or the dark inside).
  turns.push(
    { y: top, r: rAt(top) - 0.008, colour: end, relief: 1 },
    { y: top, r: rAt(top) - STAVE, colour: times(end, 0.9), relief: 0.6 },
  );
  const head = top - (open || 0.03);
  const dark = hex(INSIDE);
  if (open > 0)
    turns.push(
      { y: top - 0.03, r: rAt(top - 0.03) - STAVE, colour: times(wood, 0.4), relief: 0.6 },
      { y: head, r: rAt(head) - STAVE, colour: dark, relief: 0.6 },
      { y: head, r: 0, colour: dark },
    );
  else
    turns.push(
      { y: head, r: rAt(head) - STAVE, colour: times(wood, 0.4), relief: 0.6 },
      { y: head, r: 0, colour: dark },
    );
  // Turned its own way (in its points, so its bounds stay square to the box).
  const yaw = seed() * Math.PI * 2;
  put(g, lathe(turns, columns).rotateY(yaw), Surface.Auto, false);
  if (!open)
    put(
      g,
      barrelHead(rAt(head) - STAVE - 0.003, head + 0.006, end, seed).rotateY(yaw),
      Surface.Auto,
      false,
    );
  // Its shadow: a drum just inside the staves, bulging with them, its lid under the head. An
  // open barrel's has no lid, and stops under the rim: seen down inside it, its far side faces
  // away (and is not drawn), and its near side is behind the staves.
  const coreTop = open > 0 ? top - 0.035 : head - 0.02;
  const core: [number, number][] = [foot + 0.03, foot + h / 2, coreTop].map((y) => [
    rAt(y) * 0.94,
    y,
  ]);
  shadowCore(g, open > 0 ? core : [...core, [0, coreTop]], 12);
  // The hoops: two near each end, flat iron bands with their top edges rounded, open on the
  // inside (it is sunk in the staves, and seen from nowhere) and underneath (seen only from the
  // ground). Eighteen segments round keep even the middle of each clear of the staves.
  for (const f of [0.1, 0.26, 0.74, 0.9]) {
    const y = foot + f * h;
    const half = Math.min(0.026, h * 0.03);
    const y0 = y - half;
    const y1 = y + half;
    const inner = Math.min(rAt(y0), rAt(y1)) - 0.004;
    const r0 = rAt(y0) + hoop;
    const r1 = rAt(y1) + hoop;
    const c = 0.005;
    const band = new THREE.LatheGeometry(
      [
        [r0, y0],
        [r1, y1 - c],
        [r1 - c, y1],
        [inner, y1],
      ].map(([r, yy]) => new THREE.Vector2(r, yy)),
      18,
    );
    add(g, band, iron(), 0, 0, 0).castShadow = false;
  }
}

/** A barrel's head: planks across a disc `r` round at `y`, each its own shade, gaps between. */
function barrelHead(r: number, y: number, wood: THREE.Color, seed: () => number) {
  const planks = 4;
  const gap = 0.006;
  const positions: number[] = [];
  const colours: number[] = [];
  for (let k = 0; k < planks; k++) {
    const z0 = -r + (2 * r * k) / planks + gap / 2;
    const z1 = -r + (2 * r * (k + 1)) / planks - gap / 2;
    const tone = times(wood, 0.82 + seed() * 0.3);
    // Its outline: down one side of the disc and back up the other.
    const steps = 4;
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const z = z0 + ((z1 - z0) * i) / steps;
      ring.push(new THREE.Vector3(-Math.sqrt(Math.max(0, r * r - z * z)), y, z));
    }
    for (let i = steps; i >= 0; i--) {
      const z = z0 + ((z1 - z0) * i) / steps;
      ring.push(new THREE.Vector3(Math.sqrt(Math.max(0, r * r - z * z)), y, z));
    }
    // A fan from its first corner, wound to face up.
    for (let i = 1; i + 1 < ring.length; i++) {
      const [a, b, c] = [ring[0]!, ring[i]!, ring[i + 1]!];
      const up = b.clone().sub(a).cross(c.clone().sub(a)).y >= 0;
      for (const p of up ? [a, b, c] : [a, c, b]) {
        positions.push(p.x, p.y, p.z);
        colours.push(tone.r, tone.g, tone.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** About how high over the ground under it a harbour lantern's glass hangs. */
const LANTERN_GLASS = 2.15;

/**
 * A harbour lantern on its post, the box: a rough hewn timber post in `colour`, darker at its
 * foot, with an arm out over the box's front from a little under its top, on a diagonal brace,
 * strapped and bolted in iron; from an eye under the arm's end a short chain, and on it a chunky
 * iron lantern: a cage of bars round its glass on a plate with a drop under it, a pointed cap
 * and a ring on top. Its glass hangs about `LANTERN_GLASS` over the ground under it (`floorAt`,
 * in the model's frame, or flat at the box's foot), the chain as long as the post allows. It
 * glows and lights the night as a garden lamp does (see `lanternGlow`). The arm and the lantern
 * hang out beyond the box's front, over head height.
 */
export function lanternPostModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  floorAt?: (x: number, z: number) => number,
): void {
  const lamp = new THREE.Group();
  g.add(lamp);
  const ironwork = iron();
  const wood = hex(colour);
  const tone = () => times(wood, 0.86 + seed() * 0.24);
  const r = Math.min(w, d) / 2 - 0.005;
  const foot = -h / 2;
  const top = h / 2;
  timberPost(lamp, r, 0, foot, top, 0, colour, seed);

  // The arm, from the back of the post out over the front, its end cut back underneath; level,
  // or raking up as far as it must to hang the lantern high enough over the ground in front.
  const armW = 0.11;
  const armH = 0.13;
  const reach = 0.56 + seed() * 0.08;
  const armTop = top - 0.05 - seed() * 0.04;
  const under = armTop - armH;
  const back = r + 0.04;
  const end = -reach - 0.1;
  const lz = -reach;

  // The lantern's height: from the arm's underside the eye's plate and ring, the chain (a link
  // at least), and the lantern from its ring down to the middle of its glass.
  const ground = floorAt ? Math.max(floorAt(0, 0), floorAt(0, lz)) : foot;
  const want = ground + LANTERN_GLASS + (seed() - 0.5) * 0.08;
  const pitch = 0.05;
  const toGlass = 0.042 + 0.09 + 0.331;
  /** How far the arm rises toward its end, for each metre out from the post. */
  const rake = Math.min(0.45, Math.max(0, want - 0.03 - (under - toGlass)) / (back - lz));
  /** The arm's underside at `z` along it. */
  const underAt = (z: number) => under + rake * (back - z);

  const arm = slab(
    [
      [back, under],
      [back, armTop],
      [end, armTop + rake * (back - end)],
      [end + 0.06, underAt(end + 0.06)],
    ],
    -armW / 2,
    armW / 2,
    0.014,
  );
  put(lamp, coloured(arm, times(wood, 1.05)), Surface.Auto);
  // The brace: a straight timber from the post's face up to the arm's underside, its ends cut
  // to sit square on both (and sunk a little into them).
  const drop = 0.36 + seed() * 0.08;
  const bt = 0.085;
  const from = new THREE.Vector2(-r, under - drop);
  const to = new THREE.Vector2(-reach * 0.62, underAt(-reach * 0.62));
  const along = to.clone().sub(from).normalize();
  const across = new THREE.Vector2(-along.y, along.x).multiplyScalar(bt / 2);
  const zPost = -r * 0.82;
  // Where an edge of it (the middle line moved `s` across) meets the post's face, and the arm.
  const atPost = (s: number): [number, number] => {
    const p = from.clone().addScaledVector(across, s);
    return [zPost, p.y + ((zPost - p.x) * along.y) / along.x];
  };
  const atArm = (s: number): [number, number] => {
    const p = from.clone().addScaledVector(across, s);
    // (Along it to where it meets the underside, sunk a little into the arm.)
    const t = (underAt(p.x) + 0.012 - p.y) / (along.y + rake * along.x);
    return [p.x + t * along.x, p.y + t * along.y];
  };
  const brace = slab([atPost(-1), atPost(1), atArm(1), atArm(-1)], -0.04, 0.04, 0.012);
  put(lamp, coloured(brace, tone()), Surface.Auto);

  // Iron: a band round the post under the arm and another at the brace's foot, straps along
  // the arm's sides from the post, bolted through. (Too little proud of the timber for their
  // shadows to show, they cast none: nor do the chain and its rings, too fine to.)
  const band = (y: number) => {
    const rb = r + 0.008;
    const profile = [
      [rb - 0.02, y - 0.03],
      [rb, y - 0.03],
      [rb + 0.006, y],
      [rb, y + 0.03],
      [rb - 0.02, y + 0.03],
    ].map(([a, b]) => new THREE.Vector2(a, b));
    add(lamp, new THREE.LatheGeometry(profile, 10), ironwork, 0, 0, 0).castShadow = false;
  };
  band(under - 0.07);
  band(from.y - 0.05);
  const tilt = Math.atan(rake);
  for (const s of [-1, 1]) {
    const strap = add(
      lamp,
      bevelBox(0.012, armH * 0.62, 0.3),
      ironwork,
      s * (armW / 2 + 0.006),
      underAt(-r - 0.1) + armH / 2,
      -r - 0.1,
    );
    strap.rotation.x = tilt;
    strap.castShadow = false;
  }
  for (const z of [-r - 0.04, -r - 0.2])
    add(
      lamp,
      new THREE.CylinderGeometry(0.018, 0.018, armW + 0.04, 6).rotateZ(Math.PI / 2),
      ironwork,
      0,
      underAt(z) + armH / 2,
      z,
    ).castShadow = false;

  const eyeY = underAt(lz) - 0.042;
  const links = Math.min(12, Math.max(1, Math.round((eyeY - toGlass + 0.042 - want) / pitch) + 1));
  const ringY = eyeY - 0.09 - (links - 1) * pitch;
  const ly = ringY - 0.331;

  const eye = add(lamp, bevelBox(0.08, 0.016, 0.08), ironwork, 0, underAt(lz) - 0.008, lz);
  eye.rotation.x = tilt;
  eye.castShadow = false;
  const ring = (y: number, turn: number) => {
    const m = add(lamp, new THREE.TorusGeometry(0.026, 0.008, 4, 10), ironwork, 0, y, lz);
    m.rotation.y = turn;
    m.castShadow = false;
  };
  ring(eyeY, Math.PI / 2);
  // The chain: links hung each through the last, every other one turned a quarter.
  for (let k = 0; k < links; k++) {
    const link = add(
      lamp,
      new THREE.TorusGeometry(0.021, 0.0075, 4, 8).scale(1, 1.55, 1),
      ironwork,
      0,
      eyeY - 0.045 - k * pitch,
      lz,
    );
    link.rotation.y = k % 2 === 0 ? 0 : Math.PI / 2;
    link.castShadow = false;
  }
  ring(ringY, links % 2 === 0 ? 0 : Math.PI / 2);

  // The lantern: a cage of iron bars round the glass, a broad plate under it with a drop, and
  // a plate over it under a pointed cap with a little vent on top.
  const gw = 0.19;
  const gh = 0.27;
  const glass = add(lamp, new THREE.BoxGeometry(gw, gh, gw), lanternGlass(), 0, ly, lz);
  glass.castShadow = false;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      add(lamp, bevelBox(0.032, gh + 0.02, 0.032), ironwork, (sx * gw) / 2, ly, lz + (sz * gw) / 2);
  for (const [x, z, alongX] of [
    [0, -gw / 2 - 0.004, true],
    [0, gw / 2 + 0.004, true],
    [-gw / 2 - 0.004, 0, false],
    [gw / 2 + 0.004, 0, false],
  ] as const) {
    add(lamp, new THREE.BoxGeometry(0.016, gh, 0.016), ironwork, x, ly, lz + z);
    const hoop = alongX
      ? new THREE.BoxGeometry(gw, 0.022, 0.014)
      : new THREE.BoxGeometry(0.014, 0.022, gw);
    add(lamp, hoop, ironwork, x, ly - gh * 0.18, lz + z);
  }
  add(lamp, bevelBox(gw + 0.07, 0.045, gw + 0.07), ironwork, 0, ly - gh / 2 - 0.02, lz);
  add(
    lamp,
    new THREE.ConeGeometry(0.05, 0.08, 4).rotateX(Math.PI),
    ironwork,
    0,
    ly - gh / 2 - 0.08,
    lz,
  );
  add(lamp, bevelBox(gw + 0.05, 0.035, gw + 0.05), ironwork, 0, ly + gh / 2 + 0.017, lz);
  add(lamp, new THREE.ConeGeometry(0.19, 0.14, 4).rotateY(Math.PI / 4), ironwork, 0, ly + 0.24, lz);
  add(lamp, bevelCylinder(0.03, 0.036, 0.04, 8), ironwork, 0, ly + 0.285, lz);
  // (The lantern's ring is the chain's last: see above.)

  // Every part of it is the lamp's own body round its light (see `LAMP_FIXTURE`).
  lamp.traverse((o) => {
    if (o instanceof THREE.Mesh) o.userData[LAMP_FIXTURE] = true;
  });
  lanternGlow(g, new THREE.Vector3(0, ly, lz), foot, floorAt);
}

/**
 * A group for a model lying on the ground in its box, `w` by `d` and `h` high: its y = 0 on the
 * ground (`floorAt`, in the model's frame) under the box's middle, `sink` into it, and tilted to
 * the ground's slope across the box. Without `floorAt`, or where the ground is not about the
 * box's foot (it lies on decking, or a ship's deck), it lies flat on the box's foot.
 */
function lyingOn(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  floorAt?: (x: number, z: number) => number,
  sink = 0,
): THREE.Group {
  const bed = new THREE.Group();
  g.add(bed);
  bed.position.y = -h / 2;
  if (!floorAt) return bed;
  const [ex, ez] = [w * 0.4, d * 0.4];
  const [x0, x1, z0, z1] = [floorAt(-ex, 0), floorAt(ex, 0), floorAt(0, -ez), floorAt(0, ez)];
  const y = (x0 + x1 + z0 + z1) / 4 - sink;
  if (Math.abs(y + h / 2) > 0.3) return bed;
  bed.position.y = Math.min(h / 2 - 0.1, Math.max(-h / 2, y));
  const slope = (a: number, b: number, e: number) => Math.max(-0.35, Math.min(0.35, (b - a) / e));
  const up = new THREE.Vector3(-slope(x0, x1, 2 * ex), 1, -slope(z0, z1, 2 * ez)).normalize();
  bed.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  return bed;
}

/** A smooth step from 0 to 1 as `t` goes from 0 to 1. */
const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * A coil of thick rope in `colour` lying flat in the box: two or three turns laid one on the
 * other, each a little in from the one under it, the rope climbing over itself once a turn; its
 * end comes off the top turn over the side and trails away along the ground (on along the box's
 * long side, if it has the room, else round the coil's foot), frayed at its tip. Each is its
 * own, from `seed`.
 */
export function ropeCoilModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  floorAt?: (x: number, z: number) => number,
): void {
  const bed = lyingOn(g, w, h, d, floorAt, 0.01);
  const alongX = w >= d;
  const L = Math.max(w, d);
  const T = Math.min(w, d);
  const turns = seed() < 0.3 ? 2 : 3;
  const stack = 1.55;
  const rr = Math.max(0.012, Math.min(0.05, (h - 0.004) / (2 + stack * (turns - 1))));
  const foot = 0;
  // With room along its long side the coil lies at one end of it and its tail runs on to the
  // other; without, it lies in the middle with room round it for its tail.
  const room = L - T > 0.3;
  const R0 = (room ? T / 2 : T / 2 - Math.max(0.1, rr * 2.4)) - rr - 0.006;
  const cu = room ? -(L - T) / 2 : 0;
  const dir = seed() < 0.5 ? 1 : -1;
  const squash = 0.93 + seed() * 0.07;
  // Where the rope comes off the top: toward its tail's way, if it has one.
  const aEnd = room ? (seed() - 0.5) * 0.9 : seed() * Math.PI * 2;
  const a0 = aEnd - dir * turns * Math.PI * 2;
  const wobble = seed() * Math.PI * 2;
  // In the coil's own terms: u along the box's long side, v across it.
  const P = (u: number, y: number, v: number) =>
    alongX ? new THREE.Vector3(u, y, v) : new THREE.Vector3(v, y, u);
  const radius = (t: number, level: number) =>
    R0 * (1 - 0.05 * level) * (1 + 0.02 * Math.sin(t * 7.3 + wobble));
  const points: THREE.Vector3[] = [];
  const per = 20;
  let level = 0;
  for (let i = 0; i <= turns * per; i++) {
    const t = i / per;
    const k = Math.min(turns - 1, Math.floor(t));
    // Flat round each turn, climbing onto the next over the last fifth of it.
    level = k + (k < turns - 1 ? smoothstep((t - k - 0.8) / 0.2) : 0);
    const a = a0 + dir * t * Math.PI * 2;
    const R = radius(t, level);
    points.push(P(cu + R * Math.cos(a), foot + rr + stack * rr * level, R * Math.sin(a) * squash));
  }
  // The tail: off the top turn over its side, down to the ground and away.
  const top = foot + rr + stack * rr * level;
  const out = new THREE.Vector2(Math.cos(aEnd), Math.sin(aEnd) * squash).normalize();
  const way = new THREE.Vector2(-Math.sin(aEnd), Math.cos(aEnd) * squash)
    .normalize()
    .multiplyScalar(dir);
  const Re = radius(turns, level);
  const lip = new THREE.Vector2(Math.cos(aEnd) * Re, Math.sin(aEnd) * Re * squash);
  const at = (o: number, f: number, y: number) => {
    const p = lip.clone().addScaledVector(out, o).addScaledVector(way, f);
    return P(cu + p.x, y, p.y);
  };
  const ground = foot + rr;
  points.push(at(rr * 1.6, 0.07, top), at(rr * 3, 0.13, (top + ground) / 2));
  if (room) {
    // Along the ground to near the box's far end, swinging a little from side to side.
    const u0 = cu + lip.x + rr * 3.6;
    const u1 = L / 2 - rr * 2 - 0.03;
    const v0 = lip.y + way.y * 0.16;
    const side = T / 2 - rr - 0.02;
    const swing = (seed() < 0.5 ? -1 : 1) * Math.min(side * 0.6, 0.12);
    const n = Math.max(2, Math.round((u1 - u0) / 0.14));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const v = v0 * (1 - f) + swing * Math.sin(f * Math.PI * 1.3);
      points.push(P(u0 + (u1 - u0) * f, ground, Math.min(side, Math.max(-side, v))));
    }
  } else {
    // Round the coil's foot, a third of the way about.
    const Rf = R0 + rr * 2.6;
    const around = 1.3 + seed() * 0.8;
    const n = 6;
    for (let i = 1; i <= n; i++) {
      const a = aEnd + dir * (0.25 + (around * i) / n);
      const Rr = Math.min(Rf + (i / n) * 0.03, T / 2 - rr - 0.01);
      points.push(P(cu + Rr * Math.cos(a), ground, Rr * Math.sin(a) * squash));
    }
  }
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const segments = Math.round(curve.getLength() / 0.05);
  put(bed, ropeTube(curve, segments, rr, colour, false, 5), Surface.Auto, false);
  // Its shadow: a ring as high as the turns, inside them, round the middle of each (open, as
  // the coil is: see `shadowCore`). The tail on the ground casts next to none.
  const ring: [number, number][] = [];
  for (let k = 0; k < turns; k++) {
    const y = foot + rr + stack * rr * k;
    const r = R0 * (1 - 0.05 * k) * 1.015;
    if (k === 0) ring.push([r, foot + rr * 0.4]);
    ring.push([r, y]);
    if (k === turns - 1) ring.push([r, y + rr * 0.6]);
  }
  const core = shadowCore(bed, ring, 12);
  core.scale.z = squash;
  core.rotation.y = alongX ? 0 : Math.PI / 2;
  core.position.copy(P(cu, 0, 0));
  // Its ends: the bottom one whipped, a dark band round it, the tail's frayed to a tuft.
  const base = hex(colour);
  const start = curve.getPointAt(0);
  const knot = new THREE.SphereGeometry(rr * 0.98, 6, 4);
  put(
    bed,
    coloured(knot, times(base, 0.7)).translate(start.x, start.y, start.z),
    Surface.Auto,
    false,
  );
  const tip = curve.getPointAt(1);
  const toward = curve.getTangentAt(1);
  // (Its point in the rope, flaring out to the end.)
  const tuft = new THREE.ConeGeometry(rr * 1.2, rr * 2, 5)
    .rotateX(Math.PI)
    .translate(0, rr * 0.7, 0);
  tuft.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), toward),
  );
  put(
    g,
    coloured(tuft, base.clone().lerp(hex(0xf0e2bc), 0.45)).translate(tip.x, tip.y, tip.z),
    Surface.Auto,
    false,
  );
}

/** Rust on old iron. */
const RUST = 0x7a4528;

/**
 * An old iron anchor in `colour` lying on its side in the box, its shank along the box's long
 * side: the crown at one end (the front, if that is the way the long side runs), a knob where
 * its arms curve out and back either side to broad spade flukes, a stock across the shank near
 * its other end (a timber one bound with iron, or an iron bar with knobs on its ends) and the
 * ring through its head, with a few links of chain lying from the ring along the stock. The
 * crown, the arms and the flukes are rusty. Each is its own, from `seed`.
 */
export function anchorModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  floorAt?: (x: number, z: number) => number,
): void {
  const alongX = w >= d;
  const L = Math.max(w, d);
  const T = Math.min(w, d);
  const foot = 0;
  const m = 0.02;
  // Built with the shank along x, crown at -x, arms across z, and turned to lie along the box.
  const a = new THREE.Group();
  // Its crown toward the box's front, if it lies that way; and rolled a hair onto one fluke, as
  // it lies, about its own shank.
  a.rotation.order = 'YXZ';
  a.rotation.x = (seed() - 0.5) * 0.05;
  a.rotation.y = alongX ? (seed() < 0.5 ? Math.PI : 0) : -Math.PI / 2;
  lyingOn(g, w, h, d, floorAt, 0.02).add(a);
  const ironwork = mat(times(hex(colour), 0.95).getHex(), 0.5, 0.45);
  const rusty = mat(
    hex(colour)
      .lerp(hex(RUST), 0.4 + seed() * 0.2)
      .getHex(),
    0.6,
    0.4,
  );
  const lie = (r: number) => foot + Math.min(r, h / 2);
  // The shank, thicker at the crown; the ring through its head.
  const rs = Math.max(0.025, Math.min(0.07, h * 0.42, L * 0.05));
  const rR = Math.max(0.05, Math.min(0.11, T * 0.13, L * 0.08));
  const tR = Math.min(rR * 0.3, h * 0.4);
  const ringX = L / 2 - m - rR - tR;
  const headX = ringX - rR * 0.7;
  const crownX = -L / 2 + m + rs * 1.3;
  const shank = bevelCylinder(rs * 0.72, rs, headX - crownX, 8).rotateZ(-Math.PI / 2);
  add(a, shank, ironwork, (crownX + headX) / 2, lie(rs), 0);
  add(
    a,
    bevelCylinder(rs * 1.05, rs * 1.05, rs * 1.6, 8).rotateZ(Math.PI / 2),
    ironwork,
    headX,
    lie(rs),
    0,
  );
  add(a, new THREE.TorusGeometry(rR, tR, 5, 12).rotateX(Math.PI / 2), ironwork, ringX, lie(tR), 0);
  // The arms: an arc out from the crown either side, curving back toward the ring.
  const fw = Math.max(0.05, Math.min(0.15, T * 0.15));
  const sweep = (62 * Math.PI) / 180;
  const Ra = (T / 2 - m - fw * 1.05) / Math.sin(sweep);
  const ra = rs * 0.9;
  const arc = new THREE.CatmullRomCurve3(
    Array.from({ length: 13 }, (_, i) => {
      const t = -sweep + (2 * sweep * i) / 12;
      return new THREE.Vector3(crownX + Ra * (1 - Math.cos(t)), lie(ra), Ra * Math.sin(t));
    }),
  );
  add(a, new THREE.TubeGeometry(arc, 14, ra, 6, false), rusty, 0, 0, 0);
  add(a, new THREE.SphereGeometry(rs * 1.3, 8, 6), rusty, crownX, lie(rs * 1.3), 0);
  // The flukes: broad spades on the arms' ends, pointing on round the arc.
  const fl = fw * 2.1;
  const ft = Math.min(0.055, h * 0.45);
  for (const s of [-1, 1]) {
    const tip = new THREE.Vector3(crownX + Ra * (1 - Math.cos(sweep)), 0, s * Ra * Math.sin(sweep));
    // The way on round the arc at its end.
    const tx = Math.sin(sweep);
    const tz = s * Math.cos(sweep);
    const shape = new THREE.Shape(
      [
        [-fl * 0.25, 0],
        [0, fw * 0.95],
        [fl * 0.55, fw * 0.8],
        [fl, 0],
        [fl * 0.55, -fw * 0.8],
        [0, -fw * 0.95],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    );
    const spade = new THREE.ExtrudeGeometry(shape, {
      depth: ft - 0.016,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelOffset: -0.008,
      bevelSegments: 1,
    });
    // Laid flat (its outline in x and z), its middle at its foot, turned to point on round.
    spade.rotateX(Math.PI / 2).translate(0, ft / 2 - 0.008, 0);
    spade.rotateY(Math.atan2(-tz, tx));
    add(a, spade, rusty, tip.x - tx * fl * 0.05, lie(ft / 2), tip.z - tz * fl * 0.05);
  }
  // The stock across the shank under the ring.
  const stockX = headX - Math.max(0.07, rR * 1.1);
  const span = T - 2 * m;
  if (seed() < 0.5) {
    // Two timbers bound with iron, tapering to their ends.
    const sk = Math.min(h - 0.01, rs * 2.2);
    const timber = mat(TIMBER, 0.8);
    add(a, bevelBox(sk * 1.1, sk, span), timber, stockX, foot + sk / 2, 0);
    for (const z of [-rs * 2.4, rs * 2.4])
      add(a, bevelBox(sk * 1.1 + 0.02, sk + 0.02, 0.04), ironwork, stockX, foot + sk / 2, z);
  } else {
    // An iron bar with knobs on its ends.
    const knob = Math.min(h / 2 - 0.003, rs * 1.15);
    const bar = bevelCylinder(rs * 0.7, rs * 0.7, span - 2 * knob, 8).rotateX(Math.PI / 2);
    add(a, bar, ironwork, stockX, lie(knob), 0);
    for (const s of [-1, 1])
      add(
        a,
        new THREE.SphereGeometry(knob, 8, 6),
        ironwork,
        stockX,
        lie(knob),
        s * (span / 2 - knob),
      );
  }
  // A few links of chain lying out to one side from the ring, the first on edge through it,
  // then flat and on edge by turns; too fine for their shadows to show.
  const links = 3 + Math.floor(seed() * 3);
  const side = seed() < 0.5 ? -1 : 1;
  const lr = Math.max(0.02, Math.min(rR * 0.42, (h - 0.012) / 2 - 0.008));
  const lt = Math.min(tR * 0.8, lr * 0.32);
  const pitch = lr * 2.3;
  for (let k = 0; k < links; k++) {
    const z = side * (rR + lr * 0.7 + k * pitch);
    if (Math.abs(z) + lr * 1.45 + lt > T / 2 - m) break;
    const flat = k % 2 === 1;
    const link = new THREE.TorusGeometry(lr, lt, 4, 8).scale(1.45, 1, 1);
    if (flat) link.rotateX(Math.PI / 2);
    const x = ringX + Math.sin(k * 1.9 + side) * lr * 0.3;
    add(a, link.rotateY(Math.PI / 2), ironwork, x, lie(flat ? lt : lr + lt), z).castShadow = false;
  }
}

/**
 * A cannon on its truck carriage, its muzzle to the box's front, as big as the box lets it be:
 * the fat iron barrel turned with a swelling muzzle, heavy rings and the knob of its cascabel,
 * dark and polished where the light catches it, cocked up a hair, resting by its trunnions on
 * the carriage's stepped cheeks under iron cap-squares; the cheeks on their axletrees, on four
 * chunky wooden trucks with iron tyres and hubs, bolted.
 */
export function cannonModel(g: THREE.Object3D, w: number, h: number, d: number, colour: number) {
  const barrelIron = mat(new THREE.Color(colour).multiplyScalar(0.85).getHex(), 0.4, 0.55);
  const wood = mat(CARRIAGE, 0.78);
  const dark = mat(TIMBER, 0.8);
  const foot = -h / 2;
  // The trucks.
  const wr = h * 0.25;
  const wt = Math.min(0.11, w * 0.13);
  const tyre = 0.016;
  const wx = w / 2 - wt / 2 - 0.012;
  const axleY = foot + wr + tyre;
  // The carriage's length, and the trucks at its ends.
  const cz0 = -0.24 * d;
  const cz1 = 0.3 * d;
  const trucks = [cz0 + wr * 0.95, cz1 - wr * 0.85];
  const cheekT = 0.08;
  const cheekX = wx - wt / 2 - 0.006 - cheekT / 2;
  // The barrel, as fat as fits between the cheeks, its axis through its trunnions as high as
  // the box lets it.
  const R0 = Math.min(h * 0.27, cheekX - cheekT / 2 - 0.004);
  const Lb = d - 0.04;
  const zt = -0.06 * d;
  const yA = h / 2 - R0 * 1.1 - 0.015;
  const raise = 0.045;
  // The cheeks: stepped down from the trunnions toward the back, on the axletrees.
  const yb = axleY - 0.04;
  const yt = yA - 0.04;
  const steps = 3;
  const rise = (yt - yb - 0.12) / steps;
  const outline: [number, number][] = [
    [cz0, yb],
    [cz0, yt - 0.06],
    [cz0 + 0.06, yt],
    [zt + 0.07, yt],
  ];
  const run = (cz1 - (zt + 0.07)) / steps;
  for (let i = 1; i <= steps; i++) {
    const z = zt + 0.07 + run * (i - 1);
    outline.push([z, yt - rise * (i - 1)], [z, yt - rise * i], [z + run, yt - rise * i]);
  }
  outline.push([cz1, yb]);
  // (Each step's corner once: the outline above lists the riser's top twice.)
  const cheek = outline.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - outline[i - 1]![0], p[1] - outline[i - 1]![1]) > 1e-6,
  );
  for (const s of [-1, 1])
    add(g, slab(cheek, s * cheekX - cheekT / 2, s * cheekX + cheekT / 2, 0.015), wood, 0, 0, 0);
  // The axletrees under them, the transom between their fronts, and the bed under the breech.
  for (const z of trucks) box(g, 2 * wx - wt, 0.1, 0.12, 0, axleY, z, dark);
  box(g, 2 * cheekX - cheekT, 0.14, 0.1, 0, yb + 0.09, cz0 + 0.07, wood);
  const bed = yA - R0 * 1.1 - 0.05;
  box(g, 2 * cheekX - cheekT, 0.05, cz1 - zt - 0.15, 0, bed, (zt + 0.1 + cz1 - 0.05) / 2, wood);
  // The trucks: thick wooden wheels with iron tyres, and hubs with a ring of bolts (which, and
  // the hubs, are too small for their shadows to show). Fourteen sides round are round enough
  // for a wheel a hand and a half across.
  for (const z of trucks)
    for (const s of [-1, 1]) {
      const x = s * wx;
      for (const [geometry, material, casts] of [
        [bevelCylinder(wr, wr, wt, 14), mat(CARRIAGE, 0.82), true],
        [bevelCylinder(wr + tyre, wr + tyre, wt * 0.66, 14), iron(), true],
        [bevelCylinder(wr * 0.32, wr * 0.32, wt + 0.02, 10), iron(), false],
        [bevelCylinder(wr * 0.14, wr * 0.14, wt + 0.05, 8), iron(), false],
      ] as const) {
        add(g, geometry.rotateZ(Math.PI / 2), material, x, axleY, z).castShadow = casts;
      }
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const bolt = new THREE.CylinderGeometry(0.016, 0.016, wt + 0.012, 6).rotateZ(Math.PI / 2);
        add(
          g,
          bolt,
          iron(),
          x,
          axleY + Math.sin(a) * wr * 0.62,
          z + Math.cos(a) * wr * 0.62,
        ).castShadow = false;
      }
    }
  // The barrel, muzzle to -z: turned up the axis from the cascabel's knob to the muzzle's face
  // and down into its bore.
  const knob = R0 * 0.32;
  const P: [number, number][] = [
    [0, 0],
    [knob * 0.75, knob * 0.3],
    [knob, knob],
    [knob * 0.7, knob * 1.75],
    [R0 * 0.26, knob * 2.2],
    [R0 * 0.55, Lb * 0.035],
    [R0 * 0.88, Lb * 0.07],
    [R0, Lb * 0.1],
    [R0 * 1.1, Lb * 0.11],
    [R0 * 1.1, Lb * 0.16],
    [R0, Lb * 0.17],
    [R0 * 0.95, Lb * 0.44],
    [R0 * 1.03, Lb * 0.45],
    [R0 * 1.03, Lb * 0.49],
    [R0 * 0.9, Lb * 0.5],
    [R0 * 0.76, Lb * 0.82],
    [R0 * 0.84, Lb * 0.83],
    [R0 * 0.84, Lb * 0.86],
    [R0 * 0.72, Lb * 0.87],
    [R0 * 0.7, Lb * 0.9],
    [R0 * 0.9, Lb * 0.955],
    [R0 * 0.97, Lb * 0.98],
    [R0 * 0.95, Lb],
    [R0 * 0.42, Lb],
    [R0 * 0.42, Lb - 0.12],
    [0, Lb - 0.12],
  ];
  // (Sixteen lines of points round it: its normals are smooth, so only its outline shows how
  // few, and that is no more than a millimetre or two off round.)
  const barrel = lathe(
    P.map(([r, y]) => ({ y, r, colour: hex(colour) })),
    evenly(16),
  );
  barrel.deleteAttribute('color');
  // Laid along -z with its muzzle at the box's front, its trunnions on the axis, cocked up.
  barrel.rotateX(-Math.PI / 2);
  barrel.translate(0, 0, Lb - (zt - (-d / 2 + 0.02)));
  barrel.rotateX(raise);
  barrel.translate(0, yA, zt);
  add(g, barrel, barrelIron, 0, 0, 0);
  // The bore, dark just inside the muzzle.
  const bore = new THREE.CylinderGeometry(R0 * 0.42, R0 * 0.42, 0.01, 12).rotateX(Math.PI / 2);
  bore.translate(0, 0, -(Lb - 0.02) + (Lb - (zt - (-d / 2 + 0.02))));
  bore.rotateX(raise).translate(0, yA, zt);
  add(g, bore, made(INSIDE, Surface.Auto, 0.9), 0, 0, 0).castShadow = false;
  // The trunnions through it into the cheeks' tops, and the iron cap-squares over them.
  const trunnion = new THREE.CylinderGeometry(0.05, 0.05, 2 * cheekX + cheekT * 0.8, 8);
  add(g, trunnion.rotateZ(Math.PI / 2), barrelIron, 0, yA, zt);
  for (const s of [-1, 1]) {
    box(g, cheekT + 0.012, 0.035, 0.16, s * cheekX, yA + 0.055, zt, iron());
    for (const dz of [-0.06, 0.06])
      add(
        g,
        new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6),
        iron(),
        s * cheekX,
        yA + 0.08,
        zt + dz,
      ).castShadow = false;
    // An iron strap down the cheek's front.
    box(
      g,
      cheekT + 0.012,
      yt - yb - 0.1,
      0.02,
      s * cheekX,
      (yt + yb) / 2 - 0.02,
      cz0 + 0.02,
      iron(),
    );
  }
}
