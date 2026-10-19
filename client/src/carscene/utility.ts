import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { cbox, glow, mat, put, putSlab, rbox, roundedOutline } from './kit.ts';
import { litSign, paintedSign } from './lettering.ts';
import { SPORT } from './sportscar.ts';
import { Toggle, addGadget, hingedDoor, pivot } from './gadgets.ts';

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

/**
 * The power cabinet. Its doors swing open (a click on either) on the panel inside: a row of
 * breakers and the main switch, whose red lever a click throws down, cutting the map's mains
 * (the floodlights, the street lamps, the crossing and the bus stop go dark, the status lamp
 * turns red and reads OFF), and up again to bring it back, the lights flickering on. What it
 * feeds is hung on it by the scene (`userData.feeds`, see `powered`).
 */
export function powerCabinet(on = true): THREE.Group {
  const g = new THREE.Group();
  g.name = 'power cabinet';
  const { w, d, plinth, body } = CABINET;
  const teal = paint(TEAL);
  rbox(g, charcoal(), 0, plinth / 2, 0, d + 0.06, plinth, w + 0.06, 0.03);
  const y0 = plinth;
  const top = y0 + body;
  // The body: hollow, its back, sides, roof and floor, and a frame round its front's opening.
  const t = 0.03;
  const face = d / 2;
  rbox(g, teal, -face + t / 2, y0 + body / 2, 0, t, body, w, 0.01);
  for (const s of [-1, 1]) rbox(g, teal, 0, y0 + body / 2, s * (w / 2 - t / 2), d, body, t, 0.01);
  rbox(g, teal, 0, top - t / 2, 0, d, t, w - 0.004, 0.01);
  rbox(g, teal, 0, y0 + t / 2, 0, d, t, w - 0.004, 0.01);
  const [dy0, dy1] = [y0 + 0.06, top - 0.06];
  const dz = w / 2 - 0.05;
  for (const s of [-1, 1])
    rbox(g, teal, face - t / 2, y0 + body / 2, s * (dz + 0.025), t, body, 0.05, 0.008);
  for (const y of [(y0 + dy0) / 2, (dy1 + top) / 2])
    rbox(g, teal, face - t / 2, y, 0, t, 0.06, w - 0.004, 0.008);
  // The hood: rounded over the top, out past the body, lit cyan under its front lip.
  rbox(g, charcoal(), -0.01, top + 0.06, 0, d + 0.1, 0.12, w + 0.1, 0.05);
  cbox(g, cyan(2), d / 2 + 0.04, top - 0.002, 0, 0.006, 0.008, w - 0.05, 0.002);
  // Inside: a pale board on the back, a row of breakers along its top, the main switch under.
  const board = mat(0xb9c0c4, { mottle: 'metal', roughness: 0.5, metalness: 0.3 });
  const bx = -face + t + 0.006;
  cbox(g, board, bx, (dy0 + dy1) / 2, 0, 0.008, dy1 - dy0 - 0.04, w - 2 * t - 0.04, 0.002);
  const rail = mat(0x9aa2a7, { mottle: 'metal', roughness: 0.3, metalness: 0.8 });
  cbox(g, rail, bx + 0.012, dy1 - 0.2, 0, 0.012, 0.035, w - 0.16, 0.004);
  for (let k = 0; k < 8; k++) {
    const z = -w / 2 + 0.13 + k * ((w - 0.26) / 7);
    cbox(g, dark(), bx + 0.04, dy1 - 0.2, z, 0.06, 0.14, 0.07, 0.006);
    cbox(
      g,
      mat(0xf1efe8, { mottle: 'none', roughness: 0.5 }),
      bx + 0.072,
      dy1 - 0.17,
      z,
      0.012,
      0.03,
      0.02,
      0.003,
    );
    cbox(
      g,
      glow(k % 3 === 2 ? CAR.amber : POWER_LAMP.on, 1.6),
      bx + 0.071,
      dy1 - 0.25,
      z,
      0.004,
      0.012,
      0.012,
      0.002,
    );
  }
  // The main switch: a dark box, MAIN over it, its red lever on a pivot, up for on.
  const sy = (dy0 + dy1) / 2 - 0.12;
  cbox(g, dark(), bx + 0.05, sy, 0, 0.08, 0.26, 0.2, 0.01);
  const main = paintedSign('MAIN', 0xf4f2ea, 0x1d2326, 0.12);
  main.position.set(bx + 0.003 + 0.09, sy + 0.17, 0);
  main.rotation.y = Math.PI / 2;
  g.add(main);
  const { pivot: lever, leaf } = pivot(g, new THREE.Vector3(bx + 0.095, sy, 0));
  rbox(leaf, polished(), bx + 0.105, sy, 0, 0.03, 0.04, 0.12, 0.01);
  rbox(leaf, paint(SPORT.red), bx + 0.17, sy, 0, 0.13, 0.04, 0.05, 0.015);
  // The doors, hung at the body's sides, meeting in the middle: handles by the meeting edges,
  // louvres at their feet, POWER and the warning on the left, the status window on the right.
  const lampMat = glow(on ? POWER_LAMP.on : POWER_LAMP.off, 3).clone();
  const states: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const door = hingedDoor(
      g,
      'power cabinet',
      new THREE.Vector3(face, (dy0 + dy1) / 2, s * dz),
      'y',
      -s * 1.85,
      (leaf) => {
        const zm = (s * dz) / 2 + s * 0.0025;
        rbox(
          leaf,
          teal,
          face - t / 2,
          (dy0 + dy1) / 2,
          zm,
          t,
          dy1 - dy0 - 0.004,
          dz - 0.009,
          0.008,
        );
        rbox(
          leaf,
          polished(),
          face + 0.025,
          (dy0 + dy1) / 2 + 0.05,
          s * 0.06,
          0.03,
          0.22,
          0.026,
          0.012,
        );
        for (const y of [-0.08, 0.08])
          cbox(
            leaf,
            charcoal(),
            face + 0.012,
            (dy0 + dy1) / 2 + 0.05 + y,
            s * 0.06,
            0.024,
            0.03,
            0.03,
            0.006,
          );
        for (let k = 0; k < 4; k++)
          cbox(
            leaf,
            dark(),
            face + 0.002,
            y0 + 0.14 + k * 0.045,
            s * (w / 4),
            0.004,
            0.018,
            w / 2 - 0.16,
            0.004,
          );
        if (s < 0) {
          const label = paintedSign('POWER', 0xf4f2ea, 0x1d2326, 0.26);
          label.position.set(face + 0.003, top - 0.18, -w / 4);
          label.rotation.y = Math.PI / 2;
          leaf.add(label);
          const tri = warning(0.2);
          tri.position.set(face + 0.002, top - 0.38, -w / 4);
          tri.rotation.y = Math.PI / 2;
          leaf.add(tri);
          return;
        }
        const lock = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 16);
        lock.rotateZ(Math.PI / 2);
        put(leaf, lock, polished(), face + 0.01, (dy0 + dy1) / 2 - 0.12, 0.06);
        // The status window: dark glass, the lamp, and its state lettered.
        cbox(
          leaf,
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
        put(leaf, lamp, lampMat, face + 0.007, top - 0.2, w / 4).name = 'power lamp';
        for (const [i, word] of ['ON', 'OFF'].entries()) {
          const state = litSign(word, i ? POWER_LAMP.off : POWER_LAMP.on, 0.1, 2);
          state.position.set(face + 0.008, top - 0.3, w / 4);
          state.rotation.y = Math.PI / 2;
          state.visible = i === (on ? 0 : 1);
          leaf.add(state);
          states.push(state);
        }
      },
    );
    door.noise = ['click', 'thump'];
  }
  // The switch: what it feeds, and how it shows.
  const feeds: ((k: number) => void)[] = [];
  g.userData.feeds = feeds;
  const [green, red] = [new THREE.Color(POWER_LAMP.on), new THREE.Color(POWER_LAMP.off)];
  let time = 0;
  let was = on ? 1 : 0;
  const mains = addGadget(
    g,
    new Toggle(
      [lever],
      ['switch on the power', 'switch off the power'],
      (k, dt) => {
        time += dt;
        lever.rotation.z = (k - 0.5) * 1.1;
        lampMat.emissive.copy(red).lerp(green, k);
        lampMat.color.copy(lampMat.emissive);
        states[0]!.visible = k > 0.5;
        states[1]!.visible = k <= 0.5;
        // Coming on, the lights flicker before they hold; going off, they die at once.
        const rising = k > was;
        was = k;
        const flicker = Math.sin(time * 53) * Math.sin(time * 31) > 0 ? 1 : 0.2;
        const lit = k >= 1 ? 1 : rising ? k * flicker : 0;
        for (const f of feeds) f(lit);
      },
      0.6,
      on,
    ),
  );
  mains.noise = ['powerOn', 'powerOut'];
  // A cable conduit out of its foot into the ground behind.
  rbox(g, charcoal(), -d / 2 - 0.05, 0.3, 0.25, 0.1, 0.6, 0.1, 0.04);
  return g;
}
