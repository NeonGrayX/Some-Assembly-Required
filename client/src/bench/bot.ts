import type RAPIER from '@dimforge/rapier3d-compat';
import {
  BRICK_TYPES,
  BUILDS,
  FACES,
  HATS,
  MAPS,
  MAX_PLAYERS,
  SHIRTS,
  add,
  buildById,
  length,
  machineFront,
  machineOutputs,
  machinePose,
  makeableColours,
  rotate,
  scale,
  sub,
  v3,
  yawQuat,
} from '@sar/shared';
import type {
  Action,
  Assembly,
  ColliderOwner,
  MachineKind,
  MachineState,
  MapId,
  Player,
  Room,
  Vec3,
} from '@sar/shared';
import type { Input } from '../input.ts';
import type { ClientGame } from '../net/game.ts';

/** What the bot plays through: the solo room in this tab and the game's own controls. */
export interface BotHost {
  rapier: typeof RAPIER;
  room: Room;
  game(): ClientGame | null;
  input: Input;
  /** Q: opens the page in the pocket in the reader, or closes the reader. */
  read(): void;
}

/** Each map's round builds the same model every run, so runs compare. */
const MAP_BUILDS: Record<MapId, string> = {
  house: 'castle',
  merchant: 'lighthouse',
  station: 'rocket',
  camp: 'giant-duck',
};

const MAX_PITCH = 1.45;

/** A small seeded random number generator: the same run every time. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Tally {
  tries: number;
  /** Times the aim was on the thing meant when the bot clicked. */
  hits: number;
}

/**
 * Plays the game the way a player would, through the same input the keyboard and mouse feed:
 * walking, looking around, picking up, throwing and placing bricks, reading pages, opening
 * hiding places, running the brick works, and so on, on every map. It moves between places by
 * teleporting (the house is no place for a simple bot to find its way), then walks and aims for
 * real. The script is a generator, stepped once per frame.
 */
export class BenchBot {
  /** The run's phases so far, in order; `phase` indexes it. */
  readonly phases: string[] = [];
  phase = -1;
  /** Seconds since the run started. */
  time = 0;
  done = false;
  readonly tally = new Map<string, Tally>();
  private dt = 0;
  private readonly random = rng(1);
  private readonly script: Generator<void>;
  /** Movement held down, applied every frame over what the keyboard says. */
  private readonly move = { forward: 0, right: 0, jump: false, sprint: false };
  private crowd: number[] = [];
  private crowdTimer = 0;

  constructor(
    private readonly host: BotHost,
    private readonly maps: readonly MapId[] = MAPS.map((m) => m.id),
  ) {
    this.script = this.run();
  }

  /** Call once a frame, after the keyboard has been read and before the game ticks. */
  step(dt: number): void {
    if (this.done) return;
    this.dt = dt;
    this.time += dt;
    if (this.script.next().done) {
      this.done = true;
      this.stop();
    }
    const st = this.host.input.state;
    st.forward = this.move.forward;
    st.right = this.move.right;
    st.jump = this.move.jump;
    st.sprint = this.move.sprint;
    st.careful = false;
  }

  /** Lets go of everything: the crowd leaves and the keys come up. */
  stop(): void {
    window.clearInterval(this.crowdTimer);
    for (const id of this.crowd) this.host.room.disconnect(id);
    this.crowd = [];
    this.halt();
  }

  get phaseName(): string {
    return this.phases[this.phase] ?? 'Starting';
  }

  // ---------------------------------------------------------------- the script

  private *run(): Generator<void> {
    for (const map of this.maps) {
      const name = MAPS.find((m) => m.id === map)?.name ?? map;
      this.mark(`${name}: loading`);
      yield* this.newRound(map);
      this.spill();
      this.mark(`${name}: walking`);
      yield* this.wander(6, false);
      yield* this.wander(4, true);
      this.mark(`${name}: looking around`);
      yield* this.lookAround(3, false);
      yield* this.lookAround(3, true);
      this.mark(`${name}: bricks`);
      yield* this.bricks();
      this.mark(`${name}: pages and hiding places`);
      yield* this.pages();
      yield* this.hideouts();
      this.mark(`${name}: brick works`);
      yield* this.brickWorks();
      this.mark(`${name}: dog and vacuum`);
      yield* this.dog();
      yield* this.vacuum();
      this.mark(`${name}: finished build`);
      yield* this.finishedBuild();
      if (map === this.maps[0]) {
        this.mark(`${name}: night, power cut`);
        yield* this.night();
      }
    }
    this.mark(`Crowd of ${MAX_PLAYERS}`);
    yield* this.crowded();
    this.halt();
    yield* this.wait(0.5);
  }

  private mark(name: string): void {
    this.phases.push(name);
    this.phase = this.phases.length - 1;
  }

  /** Starts a round on a map and waits until it is drawn and the player stands in it. */
  private *newRound(map: MapId): Generator<void> {
    this.halt();
    const before = this.host.game()?.worldVersion ?? 0;
    const build = buildById(MAP_BUILDS[map])?.id ?? BUILDS[0]!.id;
    this.host.room.demoRound({ build, night: false, role: 'builder', pinned: false, map });
    const give = this.time + 5;
    while (this.time < give) {
      const g = this.host.game();
      if (g && g.worldVersion !== before && g.me && g.round?.phase === 'building') break;
      yield;
    }
    this.host.input.state.firstPerson = false;
    yield* this.wait(1.5);
  }

  // ---------------------------------------------------------------- moving and looking

  private halt(): void {
    Object.assign(this.move, { forward: 0, right: 0, jump: false, sprint: false });
  }

  private *wait(seconds: number): Generator<void> {
    const end = this.time + seconds;
    while (this.time < end) yield;
  }

  /** Walks about, turning gently and away from whatever it walks into. */
  private *wander(seconds: number, sprint: boolean): Generator<void> {
    const st = this.host.input.state;
    const end = this.time + seconds;
    let turn = (this.random() - 0.5) * 1.2;
    let checkAt = this.time + 0.6;
    let from = this.myPos();
    st.firstPerson = false;
    while (this.time < end) {
      this.move.forward = 1;
      this.move.sprint = sprint;
      this.move.jump = false;
      st.yaw += turn * this.dt;
      st.pitch = -0.2 + 0.15 * Math.sin(this.time * 0.8);
      if (this.time >= checkAt) {
        const at = this.myPos();
        if (at && from && Math.hypot(at.x - from.x, at.z - from.z) < 0.5) {
          // Stuck against something: turn well away and hop.
          st.yaw += Math.PI * (0.5 + this.random());
          this.move.jump = true;
        }
        if (this.random() < 0.3) turn = (this.random() - 0.5) * 1.6;
        if (sprint && this.random() < 0.25) this.move.jump = true;
        from = at;
        checkAt = this.time + 0.6;
      }
      yield;
    }
    this.halt();
  }

  /** Stands still and turns right round, looking up and down: everything in view in turn. */
  private *lookAround(seconds: number, firstPerson: boolean): Generator<void> {
    const st = this.host.input.state;
    st.firstPerson = firstPerson;
    const end = this.time + seconds;
    const yaw = st.yaw;
    const start = this.time;
    while (this.time < end) {
      const f = (this.time - start) / seconds;
      st.yaw = yaw + f * Math.PI * 2;
      st.pitch = 0.5 * Math.sin(f * Math.PI * 4) - 0.1;
      yield;
    }
    st.firstPerson = false;
  }

  private myPos(): Vec3 | null {
    const me = this.host.game()?.me;
    return me ? me.body.translation() : null;
  }

  /** The player as the room (the authority) has them. */
  private serverMe(): Player | undefined {
    const g = this.host.game();
    return g ? this.host.room.sim.players.get(g.myId) : undefined;
  }

  /**
   * Points the view at a spot, from wherever the camera is: in third person the camera sits
   * behind the player, and the aim ray starts there, so a few rounds settle it.
   */
  private aimAt(target: Vec3): void {
    const g = this.host.game();
    const me = g?.me;
    if (!g || !me) return;
    const st = this.host.input.state;
    const eye = g.sim.eye(me);
    let from = eye;
    for (let i = 0; i < 3; i++) {
      const d = sub(target, from);
      st.yaw = Math.atan2(-d.x, -d.z);
      st.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(d.y, Math.hypot(d.x, d.z))));
      from = g.sim.camera(me, eye, st);
    }
  }

  /**
   * Aims at a spot, or if that misses what is meant (a drawer that has slid out, a gap in a
   * wall of bricks), at points around it, the way a player nudges the mouse. Says whether the
   * aim ends up on the kind of thing meant.
   */
  private aimOn(target: Vec3, kind: ColliderOwner['kind']): boolean {
    const g = this.host.game();
    const me = g?.me;
    if (!g || !me) return false;
    const st = this.host.input.state;
    const eye = g.sim.eye(me);
    const back = sub(eye, target);
    const out = scale(back, 1 / Math.max(0.01, length(back)));
    const nudges = [v3(), scale(out, 0.25), scale(out, 0.45)];
    for (const d of [0.12, 0.25]) {
      nudges.push(v3(d, 0, 0), v3(-d, 0, 0), v3(0, d, 0), v3(0, -d, 0), v3(0, 0, d), v3(0, 0, -d));
    }
    const saved = me.input;
    try {
      for (const n of nudges) {
        this.aimAt(add(target, n));
        // Tried on the replica with the view it would have; the next tick sends it for real.
        me.input = { ...saved, yaw: st.yaw, pitch: st.pitch, firstPerson: st.firstPerson };
        if (g.sim.aim(me)?.owner.kind === kind) return true;
      }
    } finally {
      me.input = saved;
    }
    this.aimAt(target);
    return false;
  }

  /**
   * A place to stand `dist` from a spot and look at it: around it, on a floor not far below
   * it, with as few walls as possible in the way.
   */
  private standNear(target: Vec3, dist: number): Vec3 | null {
    const sim = this.host.room.sim;
    const R = this.host.rapier;
    const flags = R.QueryFilterFlags.EXCLUDE_SENSORS | R.QueryFilterFlags.EXCLUDE_DYNAMIC;
    let best: { at: Vec3; score: number } | null = null;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = target.x + Math.cos(a) * dist;
      const z = target.z + Math.sin(a) * dist;
      // From a little above the spot down to the floor; lower starts for a spot just under a
      // floor or a ceiling (the basement's), where the higher ones start inside it.
      let floor: number | null = null;
      for (const up of [1.2, 0.8, 0.4]) {
        const top = target.y + up;
        const hit = sim.world.castRay(
          new R.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }),
          4,
          true,
          flags,
        );
        if (hit && hit.timeOfImpact > 0.05) {
          floor = top - hit.timeOfImpact;
          break;
        }
      }
      if (floor === null) continue;
      if (floor > target.y + 0.4) continue;
      const walls = sim.wallsBetween(v3(x, floor + 1.5, z), target);
      const score = walls * 10 + Math.abs(target.y - 0.8 - floor);
      if (!best || score < best.score) best = { at: v3(x, floor, z), score };
    }
    return best?.at ?? null;
  }

  /** Teleports next to a spot (or onto `stand`) and turns to it. */
  private *approach(target: Vec3, dist = 1.3, stand?: Vec3): Generator<void> {
    this.halt();
    // Up close, as a player would: from behind, the camera's view of small things on the
    // floor is cut off by the player's own head.
    this.host.input.state.firstPerson = true;
    const at = stand ?? this.standNear(target, dist);
    const me = this.serverMe();
    if (!at || !me) return;
    this.host.room.sim.teleportPlayer(me, at);
    // The prediction takes the jump on the next snapshot.
    yield* this.wait(0.35);
    this.aimAt(target);
    yield;
  }

  /**
   * Aims at a spot and clicks (or whatever `action` is), counting whether the aim was on the
   * kind of thing meant.
   */
  private *use(
    label: string,
    kind: ColliderOwner['kind'],
    target: Vec3 | (() => Vec3),
    action: Action,
  ): Generator<void> {
    const spot = () => (typeof target === 'function' ? target() : target);
    this.aimAt(spot());
    yield;
    const t = this.tally.get(label) ?? { tries: 0, hits: 0 };
    t.tries++;
    if (this.aimOn(spot(), kind)) t.hits++;
    this.tally.set(label, t);
    this.host.input.act(action);
    yield* this.wait(0.35);
  }

  private holding(): boolean {
    const me = this.host.game()?.me;
    return !!me && (me.holding !== null || me.tool !== null);
  }

  // ---------------------------------------------------------------- what it does

  /**
   * A heap of loose bricks in the yard, as if a bucket of them had been tipped out: there to
   * pick up and throw, and to keep the physics busy. The house starts a round without any.
   */
  private spill(): void {
    const sim = this.host.room.sim;
    const spawn = sim.level.spawn;
    const colours = makeableColours();
    const types = ['2x4', '2x2', '1x4', '2x3', '1x2'] as const;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = 2.2 + (i % 3) * 0.4;
      sim.spawnBrick(
        types[i % types.length]!,
        colours[i % colours.length]!,
        v3(spawn.x + Math.cos(a) * r, spawn.y + 1 + (i % 4) * 0.3, spawn.z + Math.sin(a) * r),
      );
    }
  }

  private looseBricks(): Assembly[] {
    const sim = this.host.room.sim;
    const me = this.myPos() ?? sim.level.spawn;
    return [...sim.assemblies.values()]
      .filter((a) => !sim.isBuild(a.id) && a.heldBy === null && !a.frozen && a.grid.size <= 4)
      .sort(
        (a, b) => length(sub(a.body.translation(), me)) - length(sub(b.body.translation(), me)),
      );
  }

  /** The middle of the team's baseplate, a little above it. */
  private buildSpot(): Vec3 {
    return add(this.host.room.sim.buildCentre(), v3(0, 0.15, 0));
  }

  private *bricks(): Generator<void> {
    for (let i = 0; i < 5; i++) {
      const a = this.looseBricks()[0];
      if (!a) break;
      const spot = () => a.body.worldCom();
      yield* this.approach(spot(), 1.2);
      yield* this.use('Grab a brick', 'brick', spot, { kind: 'grab' });
      if (!this.holding()) continue;
      for (let r = 0; r < 2; r++) {
        this.host.input.act({ kind: 'rotate' });
        yield* this.wait(0.25);
      }
      this.move.forward = 1;
      yield* this.wait(1.2);
      this.halt();
      if (i % 2) {
        this.host.input.state.pitch = 0.3;
        this.host.input.act({ kind: 'throw' });
        yield* this.wait(0.8);
      } else {
        yield* this.placeOnBuild();
      }
    }
  }

  /** Carries what is in hand to the baseplate and puts it on, or down beside it. */
  private *placeOnBuild(): Generator<void> {
    const spot = this.buildSpot();
    yield* this.approach(spot, 1.6);
    const g = this.host.game();
    yield* this.use('Place on the build', 'brick', spot, {
      kind: g?.me && g.sim.snapPreview(g.me) ? 'place' : 'drop',
    });
    if (this.holding()) this.host.input.act({ kind: 'drop' });
    yield* this.wait(0.3);
  }

  private *pages(): Generator<void> {
    const sim = this.host.room.sim;
    const free = [...sim.pages.values()].filter(
      (p) => p.body && p.carriedBy === null && p.hideout === null && p.pinned === null,
    );
    for (const page of free.slice(0, 2)) {
      const spot = () => page.body?.translation() ?? v3();
      yield* this.approach(spot(), 1.1);
      yield* this.use('Take a page', 'page', spot, { kind: 'grab' });
      if (this.host.game()?.me?.page == null) continue;
      this.host.read();
      yield* this.wait(1.2);
      this.host.read();
      this.host.input.act({ kind: 'dropPage' });
      yield* this.wait(0.4);
    }
  }

  private *hideouts(): Generator<void> {
    const sim = this.host.room.sim;
    const me = this.myPos() ?? sim.level.spawn;
    const near = [...sim.hideouts.values()]
      .sort((a, b) => length(sub(a.def.pos, me)) - length(sub(b.def.pos, me)))
      .slice(0, 3);
    for (const h of near) {
      const { pos, size, facing } = h.def;
      const front = add(pos, rotate(yawQuat(facing), v3(0, size.y / 2, size.z * 0.45)));
      yield* this.approach(front, 1.2);
      yield* this.use('Open a hiding place', 'hideout', front, { kind: 'grab' });
      yield* this.wait(0.6);
      yield* this.use('Shut a hiding place', 'hideout', front, { kind: 'grab' });
    }
  }

  /**
   * A machine as the room has it, where to stand at it, where to look to use it, and where to
   * look to take what lies in each place in its output area.
   */
  private machine(
    kind: MachineKind,
  ): { m: MachineState; stand: Vec3; target: Vec3; outs: Vec3[] } | null {
    const m = [...this.host.room.sim.machines.values()].find((x) => x.def.kind === kind);
    if (!m) return null;
    const turn = yawQuat(m.def.facing);
    const front = machineFront(m.def);
    const height = Math.min(1, machinePose(m.def).half.y * 1.6);
    return {
      m,
      stand: add(front, rotate(turn, v3(0, 0, 1.1))),
      target: add(front, rotate(turn, v3(0, height, -0.05))),
      outs: machineOutputs(m.def).map((o) => o.aim),
    };
  }

  /**
   * Waits for a machine to finish what it was just asked to make, and takes it out of its
   * output area: from the place it was made for, or else the first one with something in it.
   */
  private *takeOut(label: string, at: { m: MachineState; outs: Vec3[] }): Generator<void> {
    const slot = at.m.making?.slot ?? at.m.out.findIndex((x) => x !== null);
    if (slot < 0) return;
    // Done in the room, and there in this tab's copy of the world too, to aim at.
    const shown = () => !!this.host.game()?.sim.machines.get(at.m.def.id)?.out[slot];
    const give = this.time + 4;
    while (this.time < give && (at.m.making || !shown())) yield;
    yield* this.use(label, 'output', at.outs[slot]!, { kind: 'grab' });
  }

  /** A mould to the press, pellets from the silo, a part out, printed, and onto the build. */
  private *brickWorks(): Generator<void> {
    const sim = this.host.room.sim;
    const press = this.machine('press');
    const silo = this.machine('silo');
    const printer = this.machine('printer');
    const dispenser = this.machine('dispenser');
    if (!press || !silo || !dispenser) return;
    yield* this.approach(dispenser.target, 1.1, dispenser.stand);
    yield* this.use('Take a mould', 'machine', dispenser.target, { kind: 'mould', type: '2x4' });
    yield* this.takeOut('Take the mould out', dispenser);
    yield* this.approach(press.target, 1.1, press.stand);
    yield* this.use('Mould into the press', 'machine', press.target, { kind: 'place' });
    yield* this.approach(silo.target, 1.1, silo.stand);
    yield* this.use('Fill a bucket', 'machine', silo.target, {
      kind: 'fill',
      colour: makeableColours()[0]!,
    });
    yield* this.takeOut('Take the bucket out', silo);
    yield* this.approach(press.target, 1.1, press.stand);
    yield* this.use('Pour pellets', 'machine', press.target, { kind: 'grab' });
    yield* this.use('Make a part', 'machine', press.target, { kind: 'grab' });
    yield* this.takeOut('Take the part out', press);
    yield* this.wait(0.6);
    if (printer && this.holding() && sim.printJobs.length) {
      yield* this.approach(printer.target, 1.1, printer.stand);
      yield* this.use('Part onto the printer', 'machine', printer.target, { kind: 'place' });
      this.host.input.act({ kind: 'print', job: 0 });
      yield* this.wait(1.5);
      yield* this.use('Take the print', 'machine', printer.target, { kind: 'grab' });
    }
    if (this.holding()) yield* this.placeOnBuild();
    // A few more for the heap, thrown about.
    for (let i = 0; i < 3; i++) {
      yield* this.approach(press.target, 1.1, press.stand);
      yield* this.use('Make a part', 'machine', press.target, { kind: 'grab' });
      yield* this.takeOut('Take the part out', press);
      this.host.input.state.pitch = 0.2;
      this.host.input.act({ kind: 'throw' });
      yield* this.wait(0.4);
    }
  }

  private *dog(): Generator<void> {
    const sim = this.host.room.sim;
    const spot = () => add(sim.dog.feet, v3(0, 0.35, 0));
    yield* this.approach(spot(), 1.3);
    yield* this.use('Pat the dog', 'dog', spot, { kind: 'grab' });
    yield* this.wait(0.8);
  }

  private *vacuum(): Generator<void> {
    const sim = this.host.room.sim;
    if (sim.vacuum.heldBy !== null) return;
    const spot = add(sim.vacuum.pos, v3(0, 0.45, 0));
    yield* this.approach(spot, 1.1);
    yield* this.use('Take the vacuum', 'vacuum', spot, { kind: 'grab' });
    this.host.input.state.pitch = -0.4;
    this.move.forward = 1;
    yield* this.wait(2.5);
    this.halt();
    this.host.input.act({ kind: 'drop' });
    yield* this.wait(0.3);
  }

  /** The whole model built at once, walked round, and pulled at. */
  private *finishedBuild(): Generator<void> {
    this.host.room.demoFinishBuild();
    yield* this.wait(1);
    const sim = this.host.room.sim;
    const centre = sim.buildCentre();
    const radius = 4.5;
    const me = this.serverMe();
    const start = this.standNear(centre, radius);
    if (me && start) sim.teleportPlayer(me, start);
    yield* this.wait(0.35);
    const st = this.host.input.state;
    st.firstPerson = false;
    const end = this.time + 8;
    while (this.time < end) {
      const at = this.myPos();
      if (at) {
        const d = sub(centre, at);
        const dist = Math.hypot(d.x, d.z);
        st.yaw = Math.atan2(-d.x, -d.z);
        st.pitch = -0.15;
        this.move.right = 1;
        this.move.forward = Math.max(-1, Math.min(1, (dist - radius) * 0.6));
      }
      yield;
    }
    this.halt();
    const build = sim.build();
    const bricks = [...build.grid.bricks.values()].filter((b) => !BRICK_TYPES[b.type].fixture);
    for (let i = 0; i < 3 && bricks.length; i++) {
      const b = bricks[Math.floor(this.random() * bricks.length)]!;
      const at = sim.brickPose(build, b).pos;
      yield* this.approach(at, 1.4);
      yield* this.use('Pull a brick off', 'brick', at, { kind: 'pull' });
      st.pitch = 0.3;
      this.host.input.act({ kind: 'throw' });
      yield* this.wait(0.6);
    }
  }

  private *night(): Generator<void> {
    const room = this.host.room;
    room.demoNight(true);
    room.demoPowerCut();
    yield* this.wait(0.5);
    yield* this.wander(5, false);
    yield* this.lookAround(3, false);
    const panel = room.sim.panel;
    if (panel) {
      yield* this.approach(panel, 1.2);
      yield* this.use('Fix the panel', 'panel', panel, { kind: 'grab' });
      yield* this.wait(2);
    }
    room.demoPowerRestore();
    room.demoNight(false);
    yield* this.wait(0.5);
  }

  /** The room filled with wandering players, who then all fall over at once. */
  private *crowded(): Generator<void> {
    const room = this.host.room;
    for (let n = 1; room.playerCount < MAX_PLAYERS; n++) {
      const r = room.join(`Bot ${n}`, undefined, {
        hat: HATS[n % HATS.length]!.id,
        face: FACES[n % FACES.length]!.id,
        shirt: SHIRTS[n % SHIRTS.length]!.id,
      });
      if (!('id' in r)) break;
      this.crowd.push(r.id);
    }
    const yaws = new Map(this.crowd.map((id) => [id, this.random() * Math.PI * 2]));
    let seq = 0;
    this.crowdTimer = window.setInterval(() => {
      seq++;
      for (const id of this.crowd) {
        let yaw = yaws.get(id)!;
        if (this.random() < 0.02) yaws.set(id, (yaw += (this.random() - 0.5) * 2.5));
        const jump = this.random() < 0.01;
        room.handle(id, {
          t: 'input',
          seq,
          f: 1,
          r: 0,
          jump,
          sprint: false,
          yaw,
          pitch: -0.3,
          fp: false,
        });
        if (this.random() < 0.005) {
          const kind = (['grab', 'drop', 'throw'] as const)[Math.floor(this.random() * 3)]!;
          room.handle(id, { t: 'act', a: { kind }, seq, yaw, pitch: -0.3, fp: false });
        }
      }
    }, 1000 / 60);
    yield* this.wait(1);
    yield* this.wander(8, false);
    yield* this.lookAround(3, false);
    const sim = room.sim;
    for (const p of sim.players.values()) {
      const a = this.random() * Math.PI * 2;
      sim.knockDown(p, v3(Math.cos(a) * 4, 3, Math.sin(a) * 4));
    }
    yield* this.lookAround(4, false);
  }
}
