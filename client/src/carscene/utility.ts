import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR, shutLine } from './car.ts';
import { cbox, glow, mat, put, putSlab, rbox, roundedOutline } from './kit.ts';
import { litSign, paintedSign } from './lettering.ts';

/**
 * The power cabinet, the map's electrical panel: a street utility cabinet in the cars' style. A
 * teal lacquered box on a charcoal plinth, a rounded charcoal hood over it with cyan light under
 * its lip, two doors meeting in the middle with steel handles and a key lock, louvres at their
 * foot, a yellow warning triangle with a lightning bolt, POWER lettered over it, and a status
 * lamp in a dark window that glows green while the power is on (red when a saboteur has cut it).
 *
 * Built standing on the origin, its doors facing +x: 0.9 m wide (z), 0.42 m deep and 1.45 m to
 * the top of its hood.
 */

const TEAL = 0x2c6670;

const paint = (colour: number) =>
  mat(colour, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
const charcoal = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const dark = () => mat(0x15181a, { mottle: 'none', roughness: 0.8 });
const polished = () =>
  mat(0xdde2e6, { mottle: 'metal', roughness: 0.22, metalness: 0.9, envMapIntensity: 2.6 });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/** The cabinet's lines: its width (z), depth (x), the plinth's and the body's heights. */
export const CABINET = { w: 0.9, d: 0.42, plinth: 0.12, body: 1.18 };

/** The lamp's colours: the power on, and cut. */
export const POWER_LAMP = { on: 0x2fe07a, off: 0xff2a20 };

/** A yellow warning triangle `size` across with a black lightning bolt in it, facing +z. */
function warning(size: number): THREE.Group {
  const g = new THREE.Group();
  const r = size / 2;
  const tri = roundedOutline(
    [
      [-r, -r * 0.85],
      [r, -r * 0.85],
      [0, r * 0.88],
    ],
    size * 0.08,
  );
  putSlab(g, tri, 0.006, paint(BUS.yellow), 0.002);
  const inner = roundedOutline(
    [
      [-r * 0.78, -r * 0.7],
      [r * 0.78, -r * 0.7],
      [0, r * 0.62],
    ],
    size * 0.04,
  );
  putSlab(g, inner, 0.002, dark(), 0.0005, 0, 0, 0.004);
  const yellowIn = roundedOutline(
    [
      [-r * 0.66, -r * 0.62],
      [r * 0.66, -r * 0.62],
      [0, r * 0.48],
    ],
    size * 0.03,
  );
  putSlab(g, yellowIn, 0.002, paint(BUS.yellow), 0.0005, 0, 0, 0.0055);
  const k = r * 0.5;
  const bolt = roundedOutline(
    [
      [0.1 * k, 0.75 * k],
      [-0.35 * k, -0.05 * k],
      [-0.02 * k, -0.05 * k],
      [-0.15 * k, -0.75 * k],
      [0.35 * k, 0.12 * k],
      [0.03 * k, 0.12 * k],
    ],
    0.002,
  );
  putSlab(g, bolt, 0.002, dark(), 0.0005, 0, -r * 0.08, 0.007);
  return g;
}

export function powerCabinet(on = true): THREE.Group {
  const g = new THREE.Group();
  g.name = 'power cabinet';
  const { w, d, plinth, body } = CABINET;
  const teal = paint(TEAL);
  rbox(g, charcoal(), 0, plinth / 2, 0, d + 0.06, plinth, w + 0.06, 0.03);
  const y0 = plinth;
  rbox(g, teal, 0, y0 + body / 2, 0, d, body, w, 0.04);
  // The hood: rounded over the top, out past the body, lit cyan under its front lip.
  const top = y0 + body;
  rbox(g, charcoal(), -0.01, top + 0.06, 0, d + 0.1, 0.12, w + 0.1, 0.05);
  cbox(g, cyan(2), d / 2 + 0.04, top - 0.002, 0, 0.006, 0.008, w - 0.05, 0.002);
  // The doors: a shut line round each and down their meeting edge, handles, a lock.
  const face = d / 2;
  const [dy0, dy1] = [y0 + 0.06, top - 0.06];
  const out = new THREE.Vector3(1, 0, 0);
  const groove = mat(0x1e3038, { mottle: 'none', roughness: 0.85 });
  const lip = mat(0x7fb6bf, { mottle: 'none', roughness: 0.5 });
  const line = (a: THREE.Vector3, b: THREE.Vector3) => shutLine(g, a, b, out, groove, lip);
  for (const s of [-1, 1]) {
    const z0 = s * 0.005;
    const z1 = s * (w / 2 - 0.05);
    line(new THREE.Vector3(face, dy0, z0), new THREE.Vector3(face, dy0, z1));
    line(new THREE.Vector3(face, dy1, z0), new THREE.Vector3(face, dy1, z1));
    line(new THREE.Vector3(face, dy0, z1), new THREE.Vector3(face, dy1, z1));
    // A steel bar handle by the meeting edge.
    rbox(g, polished(), face + 0.025, (dy0 + dy1) / 2 + 0.05, s * 0.06, 0.03, 0.22, 0.026, 0.012);
    for (const y of [-0.08, 0.08])
      cbox(
        g,
        charcoal(),
        face + 0.012,
        (dy0 + dy1) / 2 + 0.05 + y,
        s * 0.06,
        0.024,
        0.03,
        0.03,
        0.006,
      );
    // Louvres at its foot.
    for (let k = 0; k < 4; k++)
      cbox(
        g,
        dark(),
        face + 0.002,
        y0 + 0.14 + k * 0.045,
        s * (w / 4),
        0.004,
        0.018,
        w / 2 - 0.16,
        0.004,
      );
  }
  line(new THREE.Vector3(face, dy0, 0), new THREE.Vector3(face, dy1, 0));
  const lock = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 16);
  lock.rotateZ(Math.PI / 2);
  put(g, lock, polished(), face + 0.01, (dy0 + dy1) / 2 - 0.12, 0.06);
  // The sign: POWER over the warning triangle, on the left door.
  const label = paintedSign('POWER', 0xf4f2ea, 0x1d2326, 0.26);
  label.position.set(face + 0.003, top - 0.18, -w / 4);
  label.rotation.y = Math.PI / 2;
  g.add(label);
  const tri = warning(0.2);
  tri.position.set(face + 0.002, top - 0.38, -w / 4);
  tri.rotation.y = Math.PI / 2;
  g.add(tri);
  // The status window on the right door: dark glass, the lamp, and its state lettered.
  cbox(
    g,
    mat(0x0e1418, { mottle: 'none', roughness: 0.1, envMapIntensity: 2.2 }),
    face + 0.004,
    top - 0.25,
    w / 4,
    0.006,
    0.2,
    0.22,
    0.004,
  );
  const lamp = new THREE.SphereGeometry(0.03, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  lamp.rotateZ(-Math.PI / 2);
  const bulb = put(
    g,
    lamp,
    glow(on ? POWER_LAMP.on : POWER_LAMP.off, 3),
    face + 0.007,
    top - 0.2,
    w / 4,
  );
  bulb.name = 'power lamp';
  const state = litSign(on ? 'ON' : 'OFF', on ? POWER_LAMP.on : POWER_LAMP.off, 0.1, 2);
  state.position.set(face + 0.008, top - 0.3, w / 4);
  state.rotation.y = Math.PI / 2;
  g.add(state);
  // A cable conduit out of its foot into the ground behind.
  rbox(g, charcoal(), -d / 2 - 0.05, 0.3, 0.25, 0.1, 0.6, 0.1, 0.04);
  return g;
}
