import * as THREE from 'three';
import { glow, mat, put } from './kit.ts';

/**
 * A warning cone, as the picture draws them: a polished metal foot with a thin line of orange
 * light glowing in a slot under its lip, a glossy body shading from yellow at the foot to deep
 * red at its collared tip, and floating round it a hologram in yellow: a broken ring and warning
 * triangles. About 0.75 m tall, standing on y = 0.
 */

export const CONE = { height: 0.8, foot: 0.27, base: 0.18, tip: 0.094 };
/** Drawn smaller than it is built, to the picture's size. */
const SCALE = 0.78;

const ORANGE = 0xff8a2a;
const HOLOGRAM = 0xffd95a;

/** The body: a lathe with its colour shading up it, bright at the foot to dark at the tip. */
function body(): THREE.BufferGeometry {
  const h = CONE.height;
  const pts = [
    [0.0, CONE.base],
    [0.168, CONE.base],
    [0.162, CONE.base + 0.04],
    [0.088, h - 0.11],
    // The collar at the tip, a step out and a rounded lip, and the hole down into it.
    [0.089, h - 0.105],
    [CONE.tip, h - 0.1],
    [CONE.tip - 0.004, h - 0.008],
    [CONE.tip - 0.014, h],
    [0.05, h],
    [0.048, h - 0.05],
    [0.0, h - 0.05],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 48).toNonIndexed();
  geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const low = new THREE.Color(0xe8a040);
  const mid = new THREE.Color(0xd2501f);
  const high = new THREE.Color(0xa8241a);
  const hole = new THREE.Color(0x2a0c08);
  const collar = new THREE.Color(0x6a1812);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) - CONE.base) / (h - CONE.base)));
    if (Math.hypot(pos.getX(i), pos.getZ(i)) < 0.052 && pos.getY(i) > h - 0.06) c.copy(hole);
    else if (pos.getY(i) > h - 0.106) c.copy(collar);
    else if (t < 0.42) c.copy(low).lerp(mid, t / 0.42);
    else c.copy(mid).lerp(high, Math.min(1, (t - 0.42) / 0.4));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * The foot: a turned metal skirt, a lip at the ground, a narrow slot for the light under an
 * overhanging band, a sloped top.
 */
function foot(): THREE.BufferGeometry {
  const f = CONE.foot;
  const pts = [
    [0.0, 0.0],
    [f - 0.01, 0.0],
    [f, 0.01],
    [f, 0.05],
    [f - 0.008, 0.056],
    [f - 0.03, 0.06],
    [f - 0.03, 0.08],
    [f - 0.006, 0.084],
    [f - 0.004, 0.122],
    [f - 0.024, 0.136],
    [0.2, CONE.base - 0.02],
    [0.18, CONE.base - 0.004],
    [0.17, CONE.base],
    [0.0, CONE.base],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 48);
}

/** A warning triangle with a mark in it, lying in the x-y plane. */
function triangle(): THREE.BufferGeometry {
  const outer = new THREE.Shape();
  const r = 0.07;
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
    if (i === 0) outer.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else outer.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  outer.closePath();
  const hole = new THREE.Path();
  const ri = 0.038;
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 - (i * Math.PI * 2) / 3;
    if (i === 0) hole.moveTo(Math.cos(a) * ri, Math.sin(a) * ri);
    else hole.lineTo(Math.cos(a) * ri, Math.sin(a) * ri);
  }
  hole.closePath();
  outer.holes.push(hole);
  const mark = new THREE.Shape();
  mark.moveTo(-0.006, 0.02);
  mark.lineTo(0.006, 0.02);
  mark.lineTo(0.004, -0.008);
  mark.lineTo(-0.004, -0.008);
  mark.closePath();
  const dot = new THREE.Shape();
  dot.absarc(0, -0.02, 0.006, 0, Math.PI * 2, false);
  return new THREE.ShapeGeometry([outer, mark, dot], 6);
}

export function buildCone(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'cone';
  const f = CONE.foot;
  // The foot, polished metal that catches the studio's light.
  const metal = mat(0xaab2b8, {
    mottle: 'metal',
    roughness: 0.32,
    metalness: 0.6,
    envMapIntensity: 2,
  });
  put(g, foot(), metal);
  // A darker band round its sloped top.
  put(
    g,
    new THREE.LatheGeometry(
      [new THREE.Vector2(f - 0.021, 0.137), new THREE.Vector2(0.202, CONE.base - 0.019)],
      48,
    ),
    mat(0x3a3e42, { mottle: 'metal', roughness: 0.4, metalness: 0.5 }),
  );
  // A dark glass cap under the foot, seen when the cone is knocked over.
  put(
    g,
    new THREE.CircleGeometry(f * 0.72, 40),
    mat(0x15191c, { roughness: 0.15, mottle: 'none', envMapIntensity: 1.5 }),
    0,
    -0.001,
    0,
    Math.PI / 2,
    0,
    0,
  );
  // The light in its slot: a thin glowing line under the band.
  put(
    g,
    new THREE.CylinderGeometry(f - 0.028, f - 0.028, 0.02, 48, 1, true),
    glow(ORANGE, 2.6),
    0,
    0.07,
    0,
  );
  // The body: glossy plastic under a clear coat, so it mirrors the studio's lights.
  put(
    g,
    body(),
    mat(0xffffff, {
      roughness: 0.2,
      vertexColors: true,
      mottle: 'none',
      envMapIntensity: 2.4,
      clearcoat: 1,
      clearcoatRoughness: 0.01,
    }),
  );
  // The hologram: a broken ring of light floating round it, tipped a little, and outside it the
  // warning sign on three sides.
  const holo = new THREE.Group();
  holo.name = 'hologram';
  holo.position.y = CONE.base + 0.15;
  holo.rotation.x = 0.1;
  g.add(holo);
  const dashes = 9;
  const ringGeo = new THREE.TorusGeometry(0.2, 0.008, 6, 16, ((Math.PI * 2) / dashes) * 0.62);
  // Two lines, the lower one's dashes set between the upper's.
  for (const [y, turn] of [
    [0, 0],
    [-0.022, 0.5],
  ] as const)
    for (let i = 0; i < dashes; i++) {
      const arc = new THREE.Mesh(ringGeo, glow(HOLOGRAM, 2.2));
      arc.rotation.set(Math.PI / 2, 0, ((i + turn) / dashes) * Math.PI * 2);
      arc.position.y = y;
      arc.castShadow = false;
      holo.add(arc);
    }
  const sign = triangle();
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const s = new THREE.Mesh(sign, glow(HOLOGRAM, 2.6));
    const r = 0.215;
    s.position.set(Math.sin(a) * r, 0.02, Math.cos(a) * r);
    s.scale.setScalar(1.3);
    s.rotation.set(0, a, 0, 'YXZ');
    s.castShadow = false;
    holo.add(s);
  }
  g.scale.setScalar(SCALE);
  return g;
}

/**
 * A cone knocked over: lying on its side along `heading` (the way its tip points), its foot
 * resting on its rim.
 */
export function fallenCone(heading: number): THREE.Group {
  const holder = new THREE.Group();
  const cone = buildCone();
  // Laid over until the rim of its foot and the lip of its tip both touch the ground.
  const lean = Math.PI / 2 + Math.atan2(CONE.foot - CONE.tip, CONE.height);
  cone.rotation.z = -lean;
  cone.scale.setScalar(SCALE);
  holder.add(cone);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(cone);
  cone.position.y = -box.min.y;
  holder.rotation.y = heading;
  return holder;
}
