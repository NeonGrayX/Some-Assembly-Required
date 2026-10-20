import * as THREE from 'three';
import { RIVAL_ID_OFFSET } from '@sar/shared';
import type { LevelDef, SceneryDef } from '@sar/shared';
import { batchStatic } from '../carscene/batch.ts';
import { CAR_DOOR, CarDoors, doorsIn } from '../carscene/doors.ts';
import type { Swing } from '../carscene/doors.ts';
import { Clockwork, MOVING, Press, Toggle, gadgetsIn } from '../carscene/gadgets.ts';
import { hidingToggles } from '../carscene/hiding.ts';
import { INSPECTOR_FACE, INSPECTOR_SCREEN } from '../carscene/inspector.ts';
import { CHEVRON_LAYOUT } from '../carscene/chevronLayout.ts';
import { buildCarScene } from '../carscene/scene.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { Surface, madeOfAll } from './styles.ts';
import type { HideoutView } from './furniture.ts';

/**
 * A level drawn with the car scene's own models (see `SceneryDef`): the scene built as the map
 * laid it out, its vehicles parked in the round's bays and road works in the empty ones, where
 * the level says; on a rival teams' level a second copy turned about the dividing line for the
 * other yard. What the game has its own of goes (the baseplate), the doors the simulation leaves
 * open stand open and the bins' lids are up; the hiding places are the scene's own doors and
 * lids, opened and shut by the game.
 */
export interface SceneryView {
  root: THREE.Group;
  /** Each hiding place in the level, by its id. */
  hideouts: Map<number, HideoutView>;
  /** Each yard's meeting bell (shown or hidden with the mode). */
  bells: THREE.Object3D[];
  /** Each yard's inspector's screen, to lay the report on. */
  screens: THREE.Object3D[];
  /** Moves what turns by itself on by `dt` seconds. */
  animate(dt: number): void;
}

/** One of the scene's doors or lids as a hiding place: the game opens and shuts it. */
class ToggleHideout implements HideoutView {
  readonly group = new THREE.Group();

  constructor(private readonly toggle: Toggle) {}

  setOpen(open: boolean, now = false): void {
    this.toggle.on = open;
    if (now) this.setAmount(open ? 1 : 0);
  }

  animate(dt: number): void {
    this.toggle.update(dt);
  }

  setAmount(amount: number): void {
    this.toggle.on = amount > 0.5;
    this.toggle.t = amount;
    this.toggle.update(0);
  }

  // The scene's doors have no padlock to hang (Gear Hunt locks are shown by the hint alone).
  setLocked(): void {}
}

/** What a click does on what the scene leaves open for the game: the bins and their lids. */
const LEFT_OPEN = ['open the bin'];

export function buildScenery(level: LevelDef, def: SceneryDef): SceneryView {
  const root = new THREE.Group();
  root.name = 'scenery';
  const ids = new Set(level.hideouts.map((h) => h.id));
  const hideouts = new Map<number, HideoutView>();
  const bells: THREE.Object3D[] = [];
  const screens: THREE.Object3D[] = [];
  const clocks: Clockwork[] = [];
  // The second yard's, turned half round about the middle of the dividing line.
  const copies = level.divide ? [0, 1] : [0];
  for (const k of copies) {
    const scene = buildCarScene({
      layout: CHEVRON_LAYOUT,
      noWorks: true,
      parked: def.parked,
      roadWorks: def.roadWorks,
    });
    const copy = scene.root;
    if (k === 0) copy.position.set(def.x, 0, def.z);
    else {
      copy.position.set(-def.x, 0, 2 * level.divide!.z - def.z);
      copy.rotation.y = Math.PI;
      // One floor under both: the first copy's.
      copy.getObjectByName('floor')?.removeFromParent();
    }
    copy.getObjectByName('baseplate')?.removeFromParent();
    // Finished as the cars' own style makes them: the game's painted finishes left off.
    madeOfAll(copy, Surface.None);
    root.add(copy);

    hidingToggles(copy).forEach(({ toggle }, i) => {
      const id = i + 1 + k * RIVAL_ID_OFFSET;
      if (ids.has(id)) hideouts.set(id, new ToggleHideout(toggle));
    });
    for (const g of gadgetsIn(copy)) {
      if (g instanceof Toggle && LEFT_OPEN.includes(g.hint())) {
        g.on = true;
        g.t = 1;
        g.update(0);
      }
      if (g instanceof Clockwork) clocks.push(g);
      // The bell: hidden in the modes without meetings.
      if (g instanceof Press && g.hint() === 'ring the bell') {
        let bell: THREE.Object3D | null = g.handles[0] ?? null;
        while (bell && bell.name !== 'prop') bell = bell.parent;
        if (bell) bells.push(bell);
      }
    }
    // The houses' doors stand open (nothing in the game's houses shuts them), and the bus's.
    copy.traverse((o) => {
      const slide = o.userData.slide as number | undefined;
      if (o.name === 'door' && slide !== undefined) o.position.x += slide;
    });
    const busDoors = doorsIn(scene.bus.root).filter((d) => d.userData.axis === 'slide');
    for (const d of busDoors) (d.userData.swing as Swing).shut = false;
    new CarDoors(busDoors).update(1, null);

    const face = copy.getObjectByName(INSPECTOR_FACE);
    if (face) {
      for (const c of [...face.children]) c.removeFromParent();
      screens.push(face);
    }
  }
  for (const o of [...bells, ...screens]) o.userData[KEEP_SEPARATE] = true;
  // A draw call per material, not per part: but for what moves.
  batchStatic(
    root,
    (o) =>
      o.name === MOVING || o.name === 'door' || o.name === CAR_DOOR || !!o.userData[KEEP_SEPARATE],
  );
  // Baked already: the game's own baking leaves it be.
  root.userData[KEEP_SEPARATE] = true;
  root.updateMatrixWorld(true);
  return {
    root,
    hideouts,
    bells,
    screens,
    animate: (dt) => {
      for (const c of clocks) c.update(dt);
    },
  };
}

/** The report's picture laid on an inspector's screen, as wide as it is for its height. */
export function screenPicture(texture: THREE.Texture, aspect: number): THREE.Mesh {
  const h = INSPECTOR_SCREEN.h;
  const w = Math.min(INSPECTOR_SCREEN.w, h * aspect);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  m.position.z = 0.001;
  return m;
}
