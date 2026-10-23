import { BRICK_TYPES, PLATE_H, STUD, footprint } from '../bricks.ts';
import { LDU_PER_PLATE, LDU_PER_STUD, axisVector, placedShape } from '../lattice.ts';
import { faceVector, partBox } from '../parts.ts';
import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';
import { sameCells } from '../builds/match.ts';
import { printKey } from '../builds/types.ts';
import type { Prints, TargetBrick } from '../builds/types.ts';
import { levelSites } from '../content/house.ts';
import type { BrickGrid, Placement } from '../grid.ts';
import { canFlip } from '../snap.ts';
import { frameMetres } from '../frames.ts';
import { add, conj, length, rotate, sub, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { isLooseBrick } from '../sim/sim.ts';
import type { Assembly, Player, ViewAsk } from '../sim/sim.ts';
import { FEET } from './nav.ts';
import { JUMP_LIFT, MAX_PITCH, REACH, brickKey } from './common.ts';
import type { Bot, Job, Wanted } from './bot.ts';
import type { Target } from './clicking.ts';

/** View angles to place a brick at, after how many quarter turns, and the layer aim first. */
interface PlaceAim {
  yaw: number;
  pitch: number;
  turns: number;
  /** Flip the part in hand first (see `canFlip`). */
  flip?: boolean;
  /** Turn the part in hand 45° on, or back off (see `Holding.eighth`). */
  eighth?: boolean;
  lock?: { yaw: number; pitch: number };
}

/**
 * A bot at the build: putting the bricks the page it remembers asks for where they go (aiming
 * each one in from where it can, jumping for the high ones), taking off what is wrong, and
 * pressing Done.
 */
export class Building {
  constructor(private readonly bot: Bot) {}

  holdingBrick(): Assembly | undefined {
    const p = this.bot.me();
    const sim = this.bot.squad.game.sim;
    const a = p?.holding ? sim.assemblies.get(p.holding.assemblyId) : undefined;
    return a && isLooseBrick(a) ? a : undefined;
  }

  /** Whether what is in hand is this part. */
  holds(type: BrickTypeId, colour: ColourId, prints?: Prints): boolean {
    const a = this.holdingBrick();
    const b = a?.grid.bricks.values().next().value;
    return !!b && b.type === type && b.colour === colour && printKey(b.prints) === printKey(prints);
  }

  *buildOne(brick: Wanted): Job {
    const key = brickKey(brick);
    this.bot.squad.claims.set(this.bot.id, { key, brick, since: this.bot.squad.tick });
    try {
      const got = yield* this.bot.making.fetch(brick.type, brick.colour, brick.prints);
      if (!got) {
        this.bot.squad.trace?.(this.bot.id, `could not get ${key}`);
        this.bot.failed(`brick|${key}`, 15);
        return false;
      }
      const placed = yield* this.place(brick);
      if (!placed) {
        this.bot.failed(`brick|${key}`, 20);
        const f = this.bot.feet();
        this.bot.squad.trace?.(
          this.bot.id,
          `could not place ${key} from ${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)}`,
        );
      }
      return placed;
    } finally {
      this.bot.squad.claims.delete(this.bot.id);
    }
  }

  /** Where the target brick would sit, in the world. */
  private brickWorld(b: Placement): Vec3 {
    const sim = this.bot.squad.game.sim;
    return sim.brickPose(sim.build(this.bot.site), b).pos;
  }

  /**
   * How to put the brick in hand exactly where `b` goes from where the bot stands: view angles
   * and the quarter turns of the brick in hand, found by trying aims around the spot it sits on
   * and asking the sim where each would snap. A brick bridging a gap, with nothing under its
   * middle to aim at, goes on the way a player puts it: aim at a top face at its height, hold
   * Shift to lock snapping to that layer, then aim at where it goes (`lock` is the first aim).
   * With a `lift`, from that much higher up (at the top of a jump).
   */
  private placement(b: Wanted, lift = 0): PlaceAim | null {
    const p = this.bot.me();
    const sim = this.bot.squad.game.sim;
    const build = sim.build(this.bot.site);
    if (!p?.holding || build.heldBy !== null || build.grid.overlaps(b)) return null;
    const eye = add(sim.eye(p), v3(0, lift, 0));
    const pos = build.body.translation();
    const rot = build.body.rotation();
    const box = partBox(b);
    const w = box.x1 - box.x0;
    const d = box.z1 - box.z0;
    const cx = (box.x0 + box.x1) / 2;
    const cz = (box.z0 + box.z1) / 2;
    const local: Vec3[] = [];
    if (b.orient) {
      // Turned: aim at the face of a part holding it, right by a stud or receiver it takes.
      local.push(...holdAims(build.grid, b));
    } else if (b.face) {
      // Clipped on sideways: aim at the side face it clips onto, behind its middle.
      const v = faceVector(b.face);
      const plane = v.x ? (v.x > 0 ? box.x0 : box.x1) : v.z > 0 ? box.z0 : box.z1;
      const up = ((box.y0 + box.y1) / 2) * PLATE_H;
      const mid = v.x ? (box.z0 + box.z1) / 2 : (box.x0 + box.x1) / 2;
      for (const [da, du] of [
        [0, 0],
        [0.25, 0],
        [-0.25, 0],
        [0, 0.02],
        [0, -0.02],
      ] as const) {
        const inside = plane - 0.03 * (v.x || v.z);
        local.push(
          v.x
            ? v3(inside * STUD, up + du, (mid + da) * STUD)
            : v3((mid + da) * STUD, up + du, inside * STUD),
        );
      }
    }
    const y = b.y * PLATE_H;
    for (const [ox, oz] of [
      [0, 0],
      [0.25, 0],
      [-0.25, 0],
      [0, 0.25],
      [0, -0.25],
      [0.3, 0.3],
      [-0.3, -0.3],
      [0.3, -0.3],
      [-0.3, 0.3],
      [0.6, 0],
      [-0.6, 0],
      [0, 0.6],
      [0, -0.6],
    ] as const) {
      local.push(v3((cx + ox) * STUD, y, (cz + oz) * STUD));
    }
    const angles = (l: Vec3): { yaw: number; pitch: number } | null => {
      const dv = sub(add(pos, rotate(rot, l)), eye);
      if (length(dv) > REACH + 0.3) return null;
      const yaw = Math.atan2(-dv.x, -dv.z);
      const pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, Math.atan2(dv.y, Math.hypot(dv.x, dv.z))),
      );
      return { yaw, pitch };
    };
    const turn = p.holding.rot;
    const flipped = !!p.holding.flip;
    const eighth = !!p.holding.eighth;
    /**
     * The view with aim `a` and the brick in hand turned `k` more quarter turns, flipped
     * (`flip`) or not, and turned 45° on (`on`) or not.
     */
    const view = (
      a: { yaw: number; pitch: number },
      k: number,
      lock?: Player['snapLock'],
      flip = flipped,
      on = eighth,
    ) => ({
      eye,
      yaw: a.yaw,
      pitch: a.pitch,
      firstPerson: true,
      rot: ((turn + k) % 4) as Rotation,
      flip,
      eighth: on,
      lock,
    });
    // A part that flips (a headlight brick by its back) is tried both ways, as it is first.
    const flips = canFlip(b.type) ? [flipped, !flipped] : [flipped];
    // A part turned 45° is tried that way too, and one turned so in hand the other way.
    const eighths = b.frame || eighth ? [eighth, !eighth] : [eighth];
    const fits = (ask: ViewAsk): boolean => {
      // The click must not land on something it would use instead (a button behind the spot).
      const hit = sim.sight.aim(p, ask);
      if (hit && !['brick', 'static', 'player'].includes(hit.owner.kind)) return false;
      const preview = sim.placing.snapPreview(p, ask);
      const got = preview?.bricks[0]?.placement;
      if (!preview || preview.targetId !== build.id || preview.bricks.length !== 1 || !got)
        return false;
      return got.type === b.type && sameCells(got as TargetBrick, b);
    };
    for (const l of local) {
      const a = angles(b.frame ? frameMetres(b.frame, l) : l);
      if (!a) continue;
      for (const e of eighths)
        for (const f of flips)
          for (let k = 0; k < 4; k++)
            if (fits(view(a, k, undefined, f, e)))
              return { ...a, turns: k, flip: f !== flipped, eighth: e !== eighth };
    }
    if (b.face || b.orient || b.frame) return null;
    // Locked to the layer: an aim at a top face at the brick's height, then the spot itself.
    const anchors: Vec3[] = [];
    for (const o of build.grid.bricks.values()) {
      if (o.y + BRICK_TYPES[o.type].plates !== b.y || o.face) continue;
      const f = footprint(o.type, o.rot);
      for (let x = o.x; x < o.x + f.w; x++) {
        for (let z = o.z; z < o.z + f.d; z++) {
          // Cells under the brick, or right next to it.
          if (x < b.x - 1 || x > b.x + w || z < b.z - 1 || z > b.z + d) continue;
          anchors.push(v3((x + 0.5) * STUD, y, (z + 0.5) * STUD));
        }
      }
    }
    anchors.sort(
      (u, v) =>
        Math.hypot(u.x / STUD - cx, u.z / STUD - cz) - Math.hypot(v.x / STUD - cx, v.z / STUD - cz),
    );
    const spot = angles(v3(cx * STUD, y, cz * STUD));
    if (!spot) return null;
    for (const l of anchors.slice(0, 12)) {
      const a = angles(l);
      if (!a) continue;
      for (let k = 0; k < 4; k++) {
        const unlocked = view(a, k, null, false, false);
        const hit = sim.sight.aim(p, unlocked);
        if (hit?.owner.kind !== 'brick' || hit.owner.assemblyId !== build.id) break;
        if (rotate(rot, v3(0, 1, 0)).y < 0.9 || hit.normal.y < 0.7) break;
        // The face it lands on must be the one at the brick's height (not something on it).
        const up = rotate(conj(rot), sub(hit.point, pos)).y;
        if (Math.round(up / PLATE_H) !== b.y) break;
        if (!sim.placing.snapPreview(p, unlocked)) continue;
        if (fits(view(spot, k, { y: b.y, down: false, targetId: build.id }, false, false)))
          return { ...spot, turns: k, flip: flipped, eighth, lock: a };
      }
    }
    return null;
  }

  /** Puts the brick in hand on the build where `b` goes. */
  private *place(b: Wanted): Job {
    const sim = this.bot.squad.game.sim;
    const nav = this.bot.squad.nav;
    const tried = new Set<number>();
    const placed = (): boolean =>
      [...sim.build(this.bot.site).grid.bricks.values()].some(
        (x) => x.type === b.type && sameCells(x, b),
      );
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!this.holdingBrick()) return false;
      let sol = this.placement(b);
      if (!sol) {
        const at = this.brickWorld(b);
        const me = this.bot.feet();
        const centre = sim.buildCentre(sim.build(this.bot.site));
        // Stand on the brick's side of the build, looking down on where it goes.
        const goals = nav
          .around(at, 2.1, 2.4, 0.4)
          .filter(
            (n) =>
              !tried.has(n) &&
              !this.bot.walking.overPlate(nav.xs[n]!, nav.ys[n]!, nav.zs[n]!) &&
              this.holdClear(nav.pos(n), at),
          )
          .map((n) => {
            const flat = Math.hypot(nav.xs[n]! - at.x, nav.zs[n]! - at.z);
            const fromCentre = Math.hypot(nav.xs[n]! - centre.x, nav.zs[n]! - centre.z);
            const fromMe = Math.hypot(nav.xs[n]! - me.x, nav.zs[n]! - me.z);
            // A part clipped on sideways is put on from the side it faces.
            let side = 0;
            if (b.face) {
              const v = rotate(sim.build(this.bot.site).body.rotation(), faceVector(b.face));
              side = (nav.xs[n]! - at.x) * v.x + (nav.zs[n]! - at.z) * v.z > 0.3 ? 0 : 2;
            }
            return {
              n,
              score: Math.abs(flat - 0.95) - 0.3 * Math.min(fromCentre, 1.6) + 0.05 * fromMe + side,
            };
          })
          .sort((x, y) => x.score - y.score)
          .slice(0, 3)
          .map((s) => s.n);
        if (!goals.length) return false;
        for (const g of goals) tried.add(g);
        yield* this.bot.walking.walk(
          goals,
          () => !!this.placement(b) || !!this.placement(b, JUMP_LIFT),
        );
      }
      // Stand still, Shift up (it may be down from running, and no layer may stay locked from
      // before), and find the aim again from where it stopped.
      this.bot.halt();
      for (let k = 0; k < 30; k++) {
        yield;
        const me = this.bot.me();
        const v = me?.body.linvel();
        if (me?.grounded && v && Math.hypot(v.x, v.y, v.z) < 0.05 && k >= 2) break;
      }
      yield* this.bot.afford(4);
      sol = this.placement(b);
      if (!sol) {
        // Too high to see from the floor: jump and put it on at the top of the jump, from far
        // enough off that the part in its hands does not sweep through the build going up.
        if (!this.jumpSafe()) yield* this.backOff();
        if (this.jumpSafe() && (yield* this.jumpPlace(b))) return true;
        continue;
      }
      this.turnInHand(sol);
      if (sol.lock) {
        // Aim at the layer, hold Shift to lock onto it, then aim where the brick goes.
        yield* this.bot.face(sol.lock.yaw, sol.lock.pitch);
        this.bot.ctl.sprint = true;
        yield;
        yield;
      }
      yield* this.bot.face(sol.yaw, sol.pitch);
      // Still where it was (nothing moved it, it did not slip off something)?
      const again = sol.lock ? this.lockedAim(b, sol) : this.placement(b);
      if (
        !again ||
        again.turns !== 0 ||
        again.flip ||
        again.eighth ||
        Math.abs(again.yaw - sol.yaw) > 0.02 ||
        Math.abs(again.pitch - sol.pitch) > 0.02
      ) {
        this.bot.ctl.sprint = false;
        continue;
      }
      this.bot.act({ kind: 'place' }, again.yaw, again.pitch);
      yield;
      yield;
      this.bot.ctl.sprint = false;
      if (placed()) return true;
    }
    return false;
  }

  /** Turns and flips the part in hand as `sol` says, each step by name, wherever it looks now. */
  private turnInHand(sol: PlaceAim): void {
    for (let k = 0; k < sol.turns; k++)
      this.bot.act({ kind: 'rotate', step: 'quarter' }, this.bot.view.yaw, this.bot.view.pitch);
    if (sol.eighth)
      this.bot.act({ kind: 'rotate', step: 'eighth' }, this.bot.view.yaw, this.bot.view.pitch);
    if (sol.flip) this.bot.act({ kind: 'flip' }, this.bot.view.yaw, this.bot.view.pitch);
  }

  /** With a layer locked: whether the aim found still puts `b` where it goes from here. */
  private lockedAim(b: Wanted, sol: PlaceAim): PlaceAim | null {
    const p = this.bot.me();
    const sim = this.bot.squad.game.sim;
    if (!p?.holding || !p.snapLock) return null;
    const ask = { yaw: sol.yaw, pitch: sol.pitch };
    const got = sim.placing.snapPreview(p, ask)?.bricks[0]?.placement;
    const hit = sim.sight.aim(p, ask);
    if (hit && !['brick', 'static', 'player'].includes(hit.owner.kind)) return null;
    return got && got.type === b.type && sameCells(got as TargetBrick, b)
      ? { yaw: sol.yaw, pitch: sol.pitch, turns: 0 }
      : null;
  }

  /** The view angles at the middle of where `b` goes, from where the eye is now. */
  private spotAim(b: Wanted): { yaw: number; pitch: number } {
    const sim = this.bot.squad.game.sim;
    const build = sim.build(this.bot.site);
    const { w, d } = footprint(b.type, b.rot);
    const at = add(
      build.body.translation(),
      rotate(build.body.rotation(), v3((b.x + w / 2) * STUD, b.y * PLATE_H, (b.z + d / 2) * STUD)),
    );
    const dv = sub(at, sim.eye(this.bot.me()!));
    return {
      yaw: Math.atan2(-dv.x, -dv.z),
      pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(dv.y, Math.hypot(dv.x, dv.z)))),
    };
  }

  /** Whether it looks (nearly) this way now. */
  private looking(a: { yaw: number; pitch: number }): boolean {
    const d = Math.atan2(Math.sin(a.yaw - this.bot.view.yaw), Math.cos(a.yaw - this.bot.view.yaw));
    return Math.abs(d) < 0.005 && Math.abs(a.pitch - this.bot.view.pitch) < 0.005;
  }

  /**
   * Jumps and places `b` in the air, where only the top of a jump gives a view of where it
   * goes; locking onto the layer (Shift) mid-jump when that is how it goes on.
   */
  private *jumpPlace(b: Wanted): Job {
    yield* this.bot.afford(5);
    const sol = this.placement(b, JUMP_LIFT);
    if (!sol) return false;
    const sim = this.bot.squad.game.sim;
    const placed = (): boolean =>
      [...sim.build(this.bot.site).grid.bricks.values()].some(
        (x) => x.type === b.type && sameCells(x, b),
      );
    this.turnInHand(sol);
    yield* this.bot.face((sol.lock ?? sol).yaw, (sol.lock ?? sol).pitch);
    this.bot.ctl.jump = true;
    try {
      for (let k = 0; k < 55; k++) {
        yield;
        const p = this.bot.me();
        if (!p?.holding) return false;
        if (p.snapLock && p.snapLock.y === b.y && !p.snapLock.down) {
          // Locked onto the layer: turn to where it goes and put it there.
          const spot = this.spotAim(b);
          this.bot.ctl.yaw = spot.yaw;
          this.bot.ctl.pitch = spot.pitch;
          if (this.looking(spot) && this.lockedAim(b, { ...spot, turns: 0 })) {
            this.bot.act({ kind: 'place' }, spot.yaw, spot.pitch);
            yield;
            yield;
            return placed();
          }
          continue;
        }
        const now = this.placement(b);
        if (now && now.turns === 0 && !now.flip && !now.eighth && !now.lock) {
          this.bot.act({ kind: 'place' }, now.yaw, now.pitch);
          yield;
          yield;
          return placed();
        }
        if (now?.lock && now.turns === 0 && !now.flip && !now.eighth) {
          this.bot.ctl.yaw = now.lock.yaw;
          this.bot.ctl.pitch = now.lock.pitch;
          if (this.looking(now.lock)) this.bot.ctl.sprint = true;
          continue;
        }
        // Keep looking where it will be able to aim from, higher up.
        const ahead = this.placement(b, Math.max(0, JUMP_LIFT - this.lifted()));
        if (ahead && ahead.turns === 0) {
          this.bot.ctl.yaw = (ahead.lock ?? ahead).yaw;
          this.bot.ctl.pitch = (ahead.lock ?? ahead).pitch;
        }
      }
      return false;
    } finally {
      this.bot.ctl.sprint = false;
    }
  }

  /**
   * Whether the part in its hands stays clear of the build with the bot standing at `feet`
   * facing `toward`: carried at chest height, it would knock into a tall build's upper bricks.
   */
  private holdClear(feet: Vec3, toward: Vec3): boolean {
    const sim = this.bot.squad.game.sim;
    const p = this.bot.me();
    const held = p?.holding ? sim.assemblies.get(p.holding.assemblyId) : undefined;
    if (!held) return true;
    const hb = held.grid.bricks.values().next().value!;
    const hf = footprint(hb.type, hb.rot);
    const long = (Math.max(hf.w, hf.d) * STUD) / 2;
    const dx = toward.x - feet.x;
    const dz = toward.z - feet.z;
    const d = Math.hypot(dx, dz) || 1;
    const out = 0.27 + long;
    const hold = v3(feet.x + (dx / d) * out, feet.y + FEET + 0.15, feet.z + (dz / d) * out);
    const build = sim.build(this.bot.site);
    for (const b of build.grid.bricks.values()) {
      if (BRICK_TYPES[b.type].fixture) continue;
      const pos = sim.brickPose(build, b).pos;
      if (Math.abs(pos.y - hold.y) > 0.2) continue;
      const f = footprint(b.type, b.rot);
      if (Math.hypot(pos.x - hold.x, pos.z - hold.z) < long + (Math.max(f.w, f.d) * STUD) / 2 + 0.1)
        return false;
    }
    return true;
  }

  /** Whether the part in its hands, going up a jump's height, stays clear of the build. */
  private jumpSafe(): boolean {
    const sim = this.bot.squad.game.sim;
    const p = this.bot.me();
    const held = p?.holding ? sim.assemblies.get(p.holding.assemblyId) : undefined;
    if (!held) return true;
    const hp = held.body.translation();
    const hb = held.grid.bricks.values().next().value!;
    const hf = footprint(hb.type, hb.rot);
    const hr = (Math.max(hf.w, hf.d) * STUD) / 2;
    const build = sim.build(this.bot.site);
    for (const b of build.grid.bricks.values()) {
      if (BRICK_TYPES[b.type].fixture) continue;
      const pos = sim.brickPose(build, b).pos;
      const f = footprint(b.type, b.rot);
      const br = (Math.max(f.w, f.d) * STUD) / 2;
      if (pos.y < hp.y - 0.15 || pos.y > hp.y + 1.1) continue;
      if (Math.hypot(pos.x - hp.x, pos.z - hp.z) < hr + br + 0.05) return false;
    }
    return true;
  }

  /** Steps back from the build a little. */
  private *backOff(): Job {
    const sim = this.bot.squad.game.sim;
    const nav = this.bot.squad.nav;
    const centre = sim.buildCentre(sim.build(this.bot.site));
    const me = this.bot.feet();
    const d = Math.hypot(me.x - centre.x, me.z - centre.z) || 1;
    const to = v3(me.x + ((me.x - centre.x) / d) * 0.4, me.y, me.z + ((me.z - centre.z) / d) * 0.4);
    const n = nav.closest(to, 0.4, 0.4);
    if (n === null) return false;
    yield* this.bot.walking.walk([n], undefined, 5);
    this.bot.halt();
    for (let k = 0; k < 10; k++) yield;
    return true;
  }

  /** How far above the floor its feet are now (mid-jump). */
  private lifted(): number {
    const feet = this.bot.feet();
    const n = this.bot.squad.nav.locate(feet);
    return n === null ? 0 : Math.max(0, feet.y - this.bot.squad.nav.ys[n]!);
  }

  /** Takes a wrong brick off the build (and puts the right one on, when it knows which). */
  *fixBrick(id: number): Job {
    const sim = this.bot.squad.game.sim;
    const build = sim.build(this.bot.site);
    const ok = yield* this.bot.clicking.use(
      {
        key: `fix|${id}`,
        point: () => {
          const x = build.grid.bricks.get(id);
          return x ? sim.brickPose(build, x).pos : null;
        },
        ok: (o) => o.kind === 'brick' && o.assemblyId === build.id && o.brickId === id,
      },
      { kind: 'pull' },
      1,
    );
    if (!ok || !this.holdingBrick()) {
      this.bot.failed(`fix|${id}`, 30);
      return false;
    }
    // Away from the build with it.
    yield* this.bot.chores.throwAway();
    return true;
  }

  /** Walks to the Done button and presses it twice, unless another bot is on it already. */
  *pressDone(): Job {
    if (this.bot.squad.doneBy !== null) {
      for (let k = 0; k < 60; k++) yield;
      return false;
    }
    return yield* this.bot.onDuty('doneBy', this.pushDone());
  }

  private *pushDone(): Job {
    const sim = this.bot.squad.game.sim;
    const round = this.bot.squad.game.round!;
    const site = levelSites(sim.level)[this.bot.site]!;
    const point = add(site.doneButton, v3(0, 0.85, 0));
    const t: Target = {
      key: 'done',
      point: () => point,
      ok: (o) => o.kind === 'button' && o.buttonId === 'done' && o.site === this.bot.site,
    };
    if (!(yield* this.bot.clicking.use(t, { kind: 'grab' }))) return false;
    this.bot.say('That is all of it. Pressing Done!');
    for (let k = 0; k < 20; k++) yield;
    if (round.phase === 'building' && round.doneArmedFor(this.bot.site))
      yield* this.bot.clicking.use(t, { kind: 'grab' });
    return true;
  }
}

/**
 * Where to aim (in the build's frame) to put the turned part `b` on: just inside the face of
 * each part holding it, at a stud it takes or a receiver it goes into, and a little to the
 * sides of it. Aimed there, the snapping hangs it on those studs, its up going their way.
 */
function holdAims(grid: BrickGrid, b: TargetBrick): Vec3[] {
  const shape = placedShape(b);
  const mine = new Set(
    [...shape.studs, ...shape.receivers].map((t) => `${t.at.x},${t.at.y},${t.at.z}`),
  );
  const out: Vec3[] = [];
  const ids = new Set(grid.neighbours(b).flatMap((c) => [c.lower, c.upper]));
  for (const id of ids) {
    const theirs = grid.shapeOfBrick(id);
    if (!theirs) continue;
    for (const t of [...theirs.studs, ...theirs.receivers]) {
      if (!mine.has(`${t.at.x},${t.at.y},${t.at.z}`)) continue;
      const v = axisVector(t.dir);
      // Just behind the face, and 5 LDU either way along it.
      const at = v3(t.at.x - v.x * 0.6, t.at.y - v.y * 0.6, t.at.z - v.z * 0.6);
      const sides = (['x', 'y', 'z'] as const).filter((k) => !v[k]);
      for (const [k, n] of [
        [null, 0],
        [sides[0]!, 5],
        [sides[0]!, -5],
        [sides[1]!, 5],
        [sides[1]!, -5],
      ] as const) {
        const q = { ...at };
        if (k) q[k] += n;
        out.push(
          v3(
            (q.x / LDU_PER_STUD) * STUD,
            (q.y / LDU_PER_PLATE) * PLATE_H,
            (q.z / LDU_PER_STUD) * STUD,
          ),
        );
      }
    }
  }
  return out;
}
