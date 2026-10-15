import * as THREE from 'three';
import { glow, mat, put } from './kit.ts';

/**
 * A warning cone, as the picture draws them: a dark round foot with a glowing orange rim, a
 * body shading from bright orange at the foot to deep red at the tip, a warning triangle lit
 * on it, a broken ring of orange light floating round it, and a dark lip at its open top.
 * About 0.75 m tall, standing on y = 0.
 */

export const CONE = { height: 0.76, foot: 0.24, base: 0.11 };
/** Drawn smaller than it is built, to the picture's size. */
const SCALE = 0.78;

const ORANGE = 0xff8a2a;

/** The body: a lathe with its colour shading up it, bright at the foot to dark at the tip. */
function body(): THREE.BufferGeometry {
  const pts = [
    [0.0, CONE.base],
    [0.165, CONE.base],
    [0.155, CONE.base + 0.13],
    [0.075, CONE.height - 0.03],
    [0.07, CONE.height],
    [0.05, CONE.height],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 40).toNonIndexed();
  geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const low = new THREE.Color(0xffc25a);
  const mid = new THREE.Color(0xec7a2c);
  const high = new THREE.Color(0xa8241a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) - CONE.base) / (CONE.height - CONE.base)));
    if (t < 0.5) c.copy(low).lerp(mid, t / 0.5);
    else c.copy(mid).lerp(high, (t - 0.5) / 0.5);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
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
  const ri = 0.045;
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
  // The foot: a deep dark drum, a band of orange light round its middle, a plate on top.
  const foot = new THREE.CylinderGeometry(CONE.foot - 0.02, CONE.foot, CONE.base, 40);
  put(g, foot, mat(0x2e3031, { roughness: 0.55 }), 0, CONE.base / 2, 0);
  put(
    g,
    new THREE.CylinderGeometry(CONE.foot - 0.006, CONE.foot - 0.002, 0.026, 40, 1, true),
    glow(ORANGE, 2),
    0,
    CONE.base * 0.5,
    0,
  );
  put(
    g,
    new THREE.CylinderGeometry(0.19, 0.205, 0.025, 40),
    mat(0x3a3c3d, { roughness: 0.5 }),
    0,
    CONE.base + 0.01,
    0,
  );
  // The body, and a dark band low on it where the sign is printed.
  put(g, body(), mat(0xffffff, { roughness: 0.45, vertexColors: true, mottle: 'none' }));
  put(
    g,
    new THREE.CylinderGeometry(0.147, 0.158, 0.1, 40, 1, true),
    mat(0xc4521f, { roughness: 0.5, mottle: 'none' }),
    0,
    CONE.base + 0.12,
    0,
  );
  // The sign, lit, on three sides.
  const sign = triangle();
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const s = new THREE.Mesh(sign, glow(ORANGE, 1.6));
    const r = 0.157;
    s.position.set(Math.sin(a) * r, CONE.base + 0.12, Math.cos(a) * r);
    s.rotation.set(-0.12, a, 0, 'YXZ');
    g.add(s);
  }
  // The floating ring round it, broken into three arcs.
  for (let i = 0; i < 3; i++) {
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(0.205, 0.004, 6, 40, Math.PI * 0.5),
      glow(ORANGE, 1.2),
    );
    arc.rotation.set(Math.PI / 2, 0, (i * Math.PI * 2) / 3 + 0.3);
    arc.position.y = CONE.base + 0.12;
    g.add(arc);
  }
  // The lip at its open top.
  put(
    g,
    new THREE.TorusGeometry(0.06, 0.014, 8, 24),
    mat(0x3a1a12, { roughness: 0.5 }),
    0,
    CONE.height,
    0,
    Math.PI / 2,
    0,
    0,
  );
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
  const lean = Math.PI / 2 + Math.atan2(CONE.foot - 0.07, CONE.height);
  cone.rotation.z = -lean;
  cone.scale.setScalar(SCALE);
  holder.add(cone);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(cone);
  cone.position.y = -box.min.y;
  holder.rotation.y = heading;
  return holder;
}
