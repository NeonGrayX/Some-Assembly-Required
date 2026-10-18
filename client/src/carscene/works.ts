import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  BUCKET_SHOTS,
  BUILDS,
  DT,
  HOUSE,
  MACHINE_SIZE,
  PLAYER_FEET,
  Sim,
  isLooseBrick,
  machineFront,
  machineOutputs,
  shapeName,
  yawQuat,
  rotate,
  add,
  v3,
} from '@sar/shared';
import type {
  Action,
  AimHit,
  BoxDef,
  BrickTypeId,
  ColourId,
  LevelDef,
  MachineDef,
  MachineKind,
  MachinePart,
  MachineState,
  Made,
  Player,
  TargetBuild,
  Vec3,
} from '@sar/shared';
import { does } from '../hints.ts';
import type { Hint } from '../hints.ts';
import { machineHint, openPicker, outputHint, toolHint } from '../machineUse.ts';
import { brickGeometry, brickMaterial, drawnHex } from '../render/bricks.ts';
import { addBrickMesh, addBrickMeshes } from '../render/pages.ts';
import type { MachinePicker } from '../ui/machinePicker.ts';
import { mat } from './kit.ts';
import { bucket, mouldBlock } from './machines.ts';

/**
 * The car test map's brick works, working: the game's own simulation of its machines runs under
 * the car-style models, so the silo fills buckets, the mould vendor hands out moulds, the brick
 * press takes them and makes parts, and the UV printer prints on them, as in a round. A click on
 * them does what it does in the game, through the game's picker, and the game's hints say what.
 *
 * The simulation is the game's level with nothing in it but the four machines where the models
 * stand and the pad under them (everything else it needs is put far out of the map's way), and
 * one player, kept where the walker is. What the machines make is drawn in the models' own
 * places for it, which are not quite where the game's models have them: a click on one aims the
 * game's player at where the game has it.
 */

/** How far off the machines the level's other fittings go (the job site, the dog…): out of reach. */
const AWAY = 120;

/** How big the press draws a part lying in its bay, across at most: the bay holds three. */
const BAY_PART = 0.17;
/** How big a mould shows the part it makes. */
const MOULD_PART = 0.16;

/** The game's level, with only the brick works in it (see above). */
function worksLevel(machines: MachineDef[], pad: BoxDef): LevelDef {
  const away = (v: Vec3): Vec3 => ({ ...v, x: v.x + AWAY });
  const {
    floor,
    sites,
    divide,
    terrain,
    water,
    sea,
    groundHole,
    groundHoles,
    catapult,
    moreBoards,
    ...rest
  } = HOUSE;
  return {
    ...rest,
    floorSize: 4 * AWAY,
    boxes: [pad],
    decals: [],
    machines,
    baseplate: away(HOUSE.baseplate),
    inspector: { ...HOUSE.inspector, pos: away(HOUSE.inspector.pos) },
    doneButton: away(HOUSE.doneButton),
    bell: away(HOUSE.bell),
    board: { ...HOUSE.board, pos: away(HOUSE.board.pos) },
    pageSpots: [],
    hideouts: [],
    ladders: [],
    meetingSeats: [],
    lights: [],
    interiors: [],
    windows: [],
    doors: [],
    stairs: [],
    spawn: away(HOUSE.spawn),
    dog: {
      ...HOUSE.dog,
      points: HOUSE.dog.points.map(away),
      treatJar: away(HOUSE.dog.treatJar),
      treatJars: (HOUSE.dog.treatJars ?? []).map(away),
    },
    vacuum: { ...HOUSE.vacuum, pos: away(HOUSE.vacuum.pos) },
  };
}

/** Every printed part of every build, so the printer has pictures for parts of many kinds. */
function allPrints(): TargetBuild {
  return {
    ...BUILDS[0]!,
    steps: BUILDS.flatMap((b) => b.steps),
    svgs: Object.assign({}, ...BUILDS.map((b) => b.svgs ?? {})) as Record<string, string>,
  };
}

/**
 * `o` set down on the origin, the middle of its foot there, and made no bigger than `fit`
 * across.
 */
function seated(o: THREE.Object3D, fit = Infinity): THREE.Group {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(o);
  inner.position.set(-centre.x, -box.min.y, -centre.z);
  const g = new THREE.Group();
  g.scale.setScalar(Math.min(1, fit / Math.max(size.x, size.z)));
  g.add(inner);
  return g;
}

/** A part of this type and colour, lying the right way up. */
function partMesh(type: BrickTypeId, colour: ColourId): THREE.Mesh {
  const mesh = new THREE.Mesh(brickGeometry(type), brickMaterial(colour));
  mesh.castShadow = true;
  return mesh;
}

/** What a machine made, as it waits in its place in the model: its foot's middle at the origin. */
function madeModel(made: Made, kind: MachineKind): THREE.Group {
  if (made.kind === 'bucket') {
    const g = new THREE.Group();
    // Under the silo's spout its handle is folded out of the way.
    bucket(g, drawnHex(made.colour), 0, 0, 0, kind === 'silo');
    return g;
  }
  if (made.kind === 'mould') {
    const g = mouldBlock(seated(partMesh(made.type, 'light-grey'), MOULD_PART));
    g.scale.setScalar(0.9);
    return g;
  }
  return seated(partMesh(made.type, made.colour), BAY_PART);
}

/** The part on the printer's bed, at its own size, its pictures on it. */
function bedPart(part: MachinePart, svgs: Record<string, string>): THREE.Group {
  const g = new THREE.Group();
  addBrickMesh(
    g,
    { type: part.type, x: 0, y: 0, z: 0, rot: 0, colour: part.colour, prints: part.prints },
    brickMaterial(part.colour),
    false,
    svgs,
  );
  return seated(g);
}

/** The pellets' plastic, colour by colour. */
const pelletMaterials = new Map<ColourId, THREE.Material>();
function pelletMaterial(colour: ColourId): THREE.Material {
  let m = pelletMaterials.get(colour);
  if (!m) {
    m = mat(drawnHex(colour), { mottle: 'plastic', roughness: 0.35 });
    pelletMaterials.set(colour, m);
  }
  return m;
}

/** Where the walker's player is and which way the camera looks: what aiming needs. */
export interface Aim {
  camera: THREE.Camera;
  /** The player's head: things between it and the camera are not aimed at. */
  head: THREE.Vector3;
}

export class BrickWorksPlay {
  readonly sim: Sim;
  readonly me: Player;
  /** The game's hints name colours. */
  readonly colourBlind = false;
  /** What the crosshair is on, as the game sees it: what a click acts on. */
  aimed: AimHit | null = null;
  /** Time not yet stepped, in seconds. */
  private time = 0;
  /** Each machine's model, by the machine's id. */
  private readonly models = new Map<number, THREE.Object3D>();
  /** What each model shows of its machine's state, to redraw it only when that changes. */
  private readonly shown = new Map<number, string>();
  /** What lies in the machines' output places, as drawn: what clicks are tried on first. */
  private readonly items: THREE.Object3D[] = [];
  /** The loose parts, each as drawn, and the version of it drawn. */
  private readonly parts = new Map<number, { group: THREE.Group; version: number }>();
  /** The mould or bucket in the player's hands, as drawn, and what it is. */
  private held: { group: THREE.Group; key: string } | null = null;
  private readonly ray = new THREE.Raycaster();

  /**
   * `machines`: the brick works' models, each named for its kind, before the scene is baked
   * together (their pad is measured for the game's level). `scene`: where loose parts are drawn;
   * `hands`: the player's model, the mould or bucket in hand drawn in front of it.
   */
  constructor(
    R: typeof RAPIER,
    machines: THREE.Object3D,
    private readonly scene: THREE.Object3D,
    private readonly hands: THREE.Object3D,
  ) {
    machines.updateMatrixWorld(true);
    const defs: MachineDef[] = [];
    const turn = new THREE.Euler();
    const quat = new THREE.Quaternion();
    const at = new THREE.Vector3();
    for (const model of machines.children) {
      const kind = model.name as MachineKind;
      if (!(['silo', 'press', 'dispenser', 'printer'] as string[]).includes(kind)) continue;
      model.getWorldPosition(at);
      turn.setFromQuaternion(model.getWorldQuaternion(quat), 'YXZ');
      const def: MachineDef = {
        id: defs.length + 1,
        kind,
        pos: { x: at.x, y: at.y, z: at.z },
        size: { ...MACHINE_SIZE[kind] },
        facing: turn.y,
      };
      defs.push(def);
      this.models.set(def.id, model);
    }
    const padBox = new THREE.Box3().setFromObject(machines.getObjectByName('pad')!);
    const centre = padBox.getCenter(new THREE.Vector3());
    const size = padBox.getSize(new THREE.Vector3());
    const pad: BoxDef = {
      pos: { x: centre.x, y: centre.y, z: centre.z },
      size: { x: size.x, y: size.y, z: size.z },
      colour: 0x9a9c9c,
    };
    this.sim = new Sim(R, worksLevel(defs, pad));
    this.sim.loadPrints(allPrints());
    const silo = this.machine('silo');
    this.me = this.sim.addPlayer({ spawn: this.standAt(silo) });
    this.seed();
  }

  /** The first machine of a kind. */
  private machine(kind: MachineKind): MachineState {
    return [...this.sim.machines.values()].find((m) => m.def.kind === kind)!;
  }

  /** Where to stand to use a machine: a step out from the middle of its front. */
  private standAt(m: MachineState): Vec3 {
    return add(machineFront(m.def), rotate(yawQuat(m.def.facing), v3(0, 0, 1.1)));
  }

  /** Points the game's player at `target` from its eyes, as the game's first-person view. */
  private aimAt(target: Vec3): void {
    const eye = this.sim.eye(this.me);
    const [dx, dy, dz] = [target.x - eye.x, target.y - eye.y, target.z - eye.z];
    Object.assign(this.me.input, {
      firstPerson: true,
      yaw: Math.atan2(-dx, -dz),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    });
  }

  /** Puts the player's body where the walker's feet are. */
  private standOn(feet: Vec3): void {
    this.me.body.setTranslation({ x: feet.x, y: feet.y + PLAYER_FEET, z: feet.z }, true);
  }

  /** Steps the simulation until the machine has finished what it is making. */
  private finish(m: MachineState): void {
    while (m.making) this.step();
  }

  private step(): void {
    // The walker moves the player (see `update`); the game only carries what they hold along.
    this.me.pendingInputs = [];
    this.sim.step();
    this.sim.events.length = 0;
  }

  /**
   * Starts it as the picture had it, the game doing the work: a red bucket filled on the silo's
   * grate, the press loaded with a mould and red pellets and two bricks moulded in its bay, and
   * a white part on the printer's bed.
   */
  private seed(): void {
    const use = (m: MachineState, action: Action) => {
      this.standOn(this.standAt(m));
      this.step();
      this.aimAt(add(machineFront(m.def), v3(0, 0.9, 0)));
      this.sim.act(this.me.id, action);
      this.finish(m);
    };
    use(this.machine('silo'), { kind: 'fill', colour: 'red' });
    const press = this.machine('press');
    Object.assign(press, { mould: '2x4', colour: 'red', shots: BUCKET_SHOTS });
    use(press, { kind: 'grab' });
    use(press, { kind: 'grab' });
    this.machine('printer').part = { type: '2x4', colour: 'white' };
  }

  /**
   * Moves the game on by `dt` seconds with the player at the walker's `feet`, aims it where the
   * camera looks, and draws what changed.
   */
  update(dt: number, feet: THREE.Vector3, aim: Aim | null): void {
    this.standOn(feet);
    // Never knocked down or limping here: the walker does the walking.
    Object.assign(this.me, { down: 0, limp: 0 });
    this.time = Math.min(this.time + dt, 4 * DT);
    while (this.time >= DT) {
      this.time -= DT;
      this.step();
    }
    this.aimed = aim ? this.aimFrom(aim) : null;
    this.draw();
  }

  /**
   * What the crosshair is on: the game's own aim along the camera's line from the player's head
   * on, unless something drawn in an output place comes first, then that place's.
   */
  private aimFrom({ camera, head }: Aim): AimHit | null {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const skip = Math.max(0, head.clone().sub(camera.position).dot(dir) - 0.4);
    const from = camera.position.clone().addScaledVector(dir, skip);
    const seen = this.sim.aim(this.me, {
      eye: { x: from.x, y: from.y, z: from.z },
      yaw: Math.atan2(-dir.x, -dir.z),
      pitch: Math.asin(dir.y),
      firstPerson: true,
    });
    this.ray.set(from, dir);
    this.ray.far = seen ? seen.distance + 0.3 : 3;
    const item = this.ray.intersectObjects(this.items, true)[0];
    let o: THREE.Object3D | null = item?.object ?? null;
    while (o && o.userData.slot === undefined) o = o.parent;
    const machine = o ? this.sim.machines.get(o.userData.machine as number) : undefined;
    if (o && machine) {
      this.aimAt(machineOutputs(machine.def)[o.userData.slot as number]!.aim);
    } else if (seen) {
      const p = from.addScaledVector(dir, seen.distance + 0.02);
      this.aimAt({ x: p.x, y: p.y, z: p.z });
    } else {
      Object.assign(this.me.input, {
        firstPerson: true,
        yaw: Math.atan2(-dir.x, -dir.z),
        pitch: Math.asin(dir.y),
      });
      return null;
    }
    return this.sim.aim(this.me);
  }

  /**
   * A click: what the game does with it, the picker asking first at the silo, the mould vendor
   * and the printer with a part on it.
   */
  click(picker: MachinePicker): void {
    const p = this.me;
    const output = this.aimed?.owner.kind === 'output';
    const action: Action = { kind: p.holding ? 'place' : 'grab', ...(output ? { output } : {}) };
    if (openPicker(this, p, picker, action)) return;
    this.sim.act(p.id, action);
  }

  /** An action of the game's, from a key or the picker. */
  act(action: Action): void {
    this.sim.act(this.me.id, action);
  }

  /** What a click would do, as the game says it. */
  hint(): Hint {
    const p = this.me;
    const o = this.aimed?.owner;
    if (o?.kind === 'machine') {
      const m = this.sim.machines.get(o.machineId);
      if (m) return machineHint(this, p, m);
    }
    if (o?.kind === 'output') {
      const made = this.sim.machines.get(o.machineId)?.out[o.slot];
      if (made) return outputHint(this, p, made);
    }
    if (p.tool) return toolHint(this, p.tool);
    if (p.holding) {
      return [does('use', 'drop'), does('rotate', 'rotate'), does('throw', 'throw')];
    }
    if (o?.kind === 'brick') {
      const a = this.sim.assemblies.get(o.assemblyId);
      const b = a?.grid.bricks.values().next().value;
      if (a && b && isLooseBrick(a)) {
        const name = `${b.colour.replaceAll('-', ' ')} ${shapeName(b.type)}`;
        return [name.charAt(0).toUpperCase() + name.slice(1), does('use', 'pick up')];
      }
    }
    return [];
  }

  /** Draws the machines' state, the loose parts, and what is in the player's hands. */
  private draw(): void {
    const svgs = this.sim.level.svgs ?? {};
    for (const [id, model] of this.models) {
      const m = this.sim.machines.get(id)!;
      const key = JSON.stringify([m.out, m.part, m.mould, m.colour]);
      if (this.shown.get(id) === key) continue;
      this.shown.set(id, key);
      m.out.forEach((made, slot) => {
        const place = model.getObjectByName(`out${slot}`);
        if (!place) return;
        for (const old of place.children) this.items.splice(this.items.indexOf(old), 1);
        place.clear();
        if (!made) return;
        const thing = madeModel(made, m.def.kind);
        thing.userData = { machine: id, slot };
        place.add(thing);
        this.items.push(thing);
      });
      const bed = model.getObjectByName('bed');
      if (bed) {
        bed.clear();
        if (m.part) bed.add(bedPart(m.part, svgs));
      }
      const mould = model.getObjectByName('mould');
      if (mould) mould.visible = m.mould !== null;
      const pellets = model.getObjectByName('pellets');
      if (pellets) {
        pellets.visible = m.colour !== null;
        if (m.colour) {
          const material = pelletMaterial(m.colour);
          pellets.traverse((c) => {
            if (c instanceof THREE.Mesh) c.material = material;
          });
        }
      }
    }
    for (const [id, v] of this.parts) {
      if (this.sim.assemblies.has(id)) continue;
      this.scene.remove(v.group);
      this.parts.delete(id);
    }
    for (const a of this.sim.assemblies.values()) {
      if (this.sim.isBuild(a.id)) continue;
      let v = this.parts.get(a.id);
      if (!v) {
        v = { group: new THREE.Group(), version: -1 };
        this.scene.add(v.group);
        this.parts.set(a.id, v);
      }
      if (v.version !== a.version) {
        v.group.clear();
        addBrickMeshes(v.group, a.grid.bricks.values(), svgs);
        v.version = a.version;
      }
      const t = a.body.translation();
      const r = a.body.rotation();
      v.group.position.set(t.x, t.y, t.z);
      v.group.quaternion.set(r.x, r.y, r.z, r.w);
    }
    const tool = this.me.tool;
    const key = tool ? JSON.stringify(tool) : '';
    if ((this.held?.key ?? '') !== key) {
      if (this.held) this.hands.remove(this.held.group);
      this.held = null;
      if (tool) {
        const group = madeModel(tool, 'press');
        // Held out before the chest in both hands.
        group.position.set(0, 0.92, -0.42);
        this.hands.add(group);
        this.held = { group, key };
      }
    }
  }
}
