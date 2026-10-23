import {
  BRICK_TYPES,
  brickName,
  VACUUM_CAPACITY,
  canFlip,
  gearName,
  isLooseBrick,
  tiredFactor,
  shapeName,
} from '@sar/shared';
import type { AimHit, Player } from '@sar/shared';
import { does, inline } from './hints.ts';
import type { Hint } from './hints.ts';
import { machineHint, outputHint, toolHint } from './machineUse.ts';
import type { ClientGame } from './net/game.ts';
import { view } from './worldView.ts';

/** What the hint line says the player can do, for what they aim at and hold. */
export function hintFor(
  g: ClientGame,
  p: Player,
  hit: AimHit | null,
  canSnap: boolean,
  turns45 = false,
): Hint {
  const o = hit?.owner;
  // Rival teams: the other side is for looking at (its ground too is only ground).
  if (
    hit &&
    o &&
    o.kind !== 'static' &&
    o.kind !== 'player' &&
    o.kind !== 'ground' &&
    !g.sim.mayUse(p, hit.point)
  ) {
    return ["The other team's side: you can look, but only touch things on your own"];
  }
  const power = g.sim.power;
  if (power.fixer === p.id) {
    return [`Fixing the electrical panel… ${Math.round(power.progress * 100)}% (stay here)`];
  }
  if (o?.kind === 'panel') {
    if (power.dead) return ['The panel is dead this round. The headlamp lights the house'];
    if (power.on && g.role === 'saboteur')
      return ['Electrical panel', does('tamper', 'tamper with it (cut the power)')];
    if (power.on) return ['Electrical panel: the power is on'];
    if (power.fixer !== null) return ['Someone is fixing the electrical panel'];
    return [does('use', 'fix the electrical panel and get the lights back on')];
  }
  if (o?.kind === 'catapult') {
    return [
      g.phase === 'building'
        ? 'The catapult only throws between rounds'
        : 'Catapult: step into the bucket at the back to be thrown across the yard',
    ];
  }
  if (o?.kind === 'page') {
    const page = g.sim.pages.get(o.pageId);
    const what = page?.step === -1 ? 'the master index' : 'this page';
    const take = does('use', p.page === null ? `pick up ${what}` : `swap your pocket for ${what}`);
    if (page && !page.printed) {
      const reader = g.reader !== null ? g.nameOf(g.reader) : 'the reader';
      return [take, `only ${reader} can read it: bring it to them or pin it on the board`];
    }
    return [take, does('read', 'read it here')];
  }
  if (
    g.role === 'reader' &&
    (o?.kind === 'machine' || o?.kind === 'output' || o?.kind === 'brick' || o?.kind === 'vacuum')
  ) {
    return ["The reader can't touch bricks: tell the builders what the pages say"];
  }
  if (o?.kind === 'machine') {
    const m = g.sim.machines.get(o.machineId);
    const fixing = m?.fixer === p.id;
    if (fixing) return [`Clearing the jam… ${Math.round(m.progress * 100)}% (stay here)`];
    if (m) {
      const hint = machineHint(g, p, m);
      return g.role === 'saboteur' && !m.jammed
        ? [...hint, does('tamper', 'tamper with it')]
        : hint;
    }
  }
  if (o?.kind === 'output') {
    const made = g.sim.machines.get(o.machineId)?.out[o.slot];
    if (made) return outputHint(g, p, made);
  }
  if (o?.kind === 'gear') {
    const item = g.sim.gear.get(o.gearId);
    return item ? [does('use', `put on the ${gearName(item.kind).toLowerCase()}`)] : [];
  }
  if (o?.kind === 'dog') {
    if (g.sim.dog.leashed) return ['The dog is on its leash now'];
    if (p.gear.has('leash')) return [does('use', 'leash the dog to the pole by its kennel')];
    if (p.treat) {
      return [does('use', 'give the dog your treat (it drops what it carries and follows you)')];
    }
    if (g.sim.dog.page !== null) {
      return [does('use', 'grab its collar, so it lets go of the page')];
    }
    return p.holding ? ['Put down what you carry to pat the dog'] : [does('use', 'pat the dog')];
  }
  if (o?.kind === 'treats') {
    return p.treat
      ? ['You have a treat: the dog will come for it']
      : [does('use', 'take a dog treat')];
  }
  if (o?.kind === 'hideout') {
    const h = g.sim.hideouts.get(o.hideoutId);
    if (!h) return [];
    const name =
      h.def.kind === 'cushion'
        ? 'sofa cushion'
        : h.def.kind === 'cabinet'
          ? 'TV cabinet'
          : h.def.kind;
    if (g.role === 'saboteur' && p.page !== null) {
      return [
        does(
          'use',
          h.def.kind === 'rug' ? 'hide your page under the rug' : `hide your page in the ${name}`,
        ),
      ];
    }
    if (h.locked) {
      return p.gear.has('keys')
        ? [does('use', `unlock the ${name} with your key ring`)]
        : [`Padlocked ${name}. The key ring opens it`];
    }
    if (h.def.kind === 'rug')
      return [does('use', h.open ? 'lay the rug back down' : 'lift the rug')];
    return [does('use', h.open ? `close the ${name}` : `open the ${name}`)];
  }
  if (o?.kind === 'gadget') {
    const says = view.furniture.gadgetHint(o.gadgetId);
    return says ? [does('use', says)] : [];
  }
  if (o?.kind === 'carDoor') return [does('use', g.sim.carDoorHint(o.group))];
  if (o?.kind === 'board') {
    return p.page !== null
      ? [does('use', 'pin your page to the board for everyone')]
      : ['Corkboard: pin pages here so everyone can read them'];
  }
  if (o?.kind === 'button' && o.buttonId === 'bell') {
    if (!g.round) return ['The meeting bell works once a round has started'];
    if (g.rival) return ['No Brick Meetings in a race: there is nobody to vote off'];
    return [does('use', 'ring the bell for a Brick Meeting (one per player per round)')];
  }
  if (o?.kind === 'button') {
    if (!g.round) return ['The Done button works once a round has started'];
    if (g.rival && g.round.handedIn[o.site] != null) return ['This team has handed in its build'];
    if (g.role === 'saboteur') return ["Saboteurs can't hand in the build: leave Done to the team"];
    if (g.mode === 'free') {
      return g.round.doneArmed[o.site]
        ? [
            inline(
              '',
              'use',
              ' again to finish the free build (export it first: Esc, then Export build)',
            ),
          ]
        : [does('use', 'Done (finish the free build and go back to the lobby)')];
    }
    return g.round.doneArmed[o.site]
      ? g.rival
        ? [inline('', 'use', ' again to hand in your build: it is judged and locked as it stands!')]
        : [inline('', 'use', ' again to hand in the build! (It is locked until then)')]
      : g.rival
        ? [does('use', 'Done (hand in your build; accuracy counts first, then speed)')]
        : [does('use', 'Done (hand in the build and end the round)')];
  }
  if (o?.kind === 'vacuum') {
    return p.holding
      ? ['Put down what you carry to take the vacuum']
      : [does('use', 'take the vacuum')];
  }
  if (o?.kind === 'trashBin') {
    if (!p.holding && g.sim.vacuum.heldBy === p.id) {
      return g.sim.vacuum.load > 0
        ? [does('use', `empty the vacuum into the bin (${g.sim.vacuum.load} bricks)`)]
        : ['The vacuum is empty'];
    }
    if (!p.holding) {
      return [
        inline('Rubbish bin: ', 'click', ' it with a brick in hand, or drop one in, to bin it'),
      ];
    }
    return g.sim.isBuild(p.holding.assemblyId)
      ? ["The team's build doesn't go in the bin"]
      : [does('use', 'throw what you carry in the bin (it is gone for good)')];
  }
  if (g.sim.vacuum.heldBy === p.id) {
    const load = g.sim.vacuum.load;
    return [
      load >= VACUUM_CAPACITY
        ? inline('The vacuum is full: ', 'click', ' a rubbish bin to empty it')
        : does(
            'holdUse',
            `suck up loose bricks on the floor at the crosshair (${load}/${VACUUM_CAPACITY})`,
          ),
      does('drop', 'put the vacuum down'),
    ];
  }
  if (p.tool) return toolHint(g, p.tool);
  if (p.holding) {
    const held = g.sim.assemblies.get(p.holding.assemblyId);
    if (held && !isLooseBrick(held)) {
      if (tiredFactor(p) < 1) {
        return [inline('Your arms are tiring: set the build down soon (', 'drop', ')')];
      }
      return canSnap
        ? [
            does('use', 'snap it all on'),
            does('rotate', 'rotate'),
            does('drop', 'set down gently'),
            does('throw', 'throw'),
          ]
        : [
            does('rotate', 'rotate'),
            does('drop', 'set the build down gently'),
            does('throw', 'throw'),
          ];
    }
    // A part that goes on by another hole too (a headlight brick's back) flips to it.
    const [b] = held ? held.grid.bricks.values() : [];
    const hole = b && canFlip(b.type) ? (BRICK_TYPES[b.type].backHole ? 'back' : 'top') : null;
    const flip = !hole
      ? []
      : [does('flip', p.holding.flip ? 'flip back onto its bottom' : `flip onto its ${hole}`)];
    if (canSnap)
      return [
        does('use', 'snap'),
        // Hanging on one stud alone, it turns 45° a step.
        does('rotate', turns45 ? 'turn 45°' : 'rotate'),
        ...flip,
        does('drop', 'drop'),
        does('throw', 'throw'),
      ];
    return [
      p.holding.flip && hole
        ? `Aim at a stud to put it on by its ${hole}`
        : 'Aim at the top of a build to snap',
      ...flip,
      does('use', 'drop'),
      does('throw', 'throw'),
    ];
  }
  if (!o) return [];
  if (o.kind === 'player') {
    const name = g.lobby.players.find((x) => x.id === o.playerId)?.name;
    const page = g.sim.players.get(o.playerId)?.page ?? null;
    if (!name || page === null) return name ? [name] : [];
    const what = g.pocketLabels.get(page) ?? 'a page';
    return [`${name} has ${what} in their pocket`, inline('', 'use', ' fast: pick it out')];
  }
  if (o.kind !== 'brick') return [];
  const a = g.sim.assemblies.get(o.assemblyId);
  if (!a) return [];
  if (a.heldBy !== null) {
    const who = g.lobby.players.find((x) => x.id === a.heldBy)?.name;
    if (!who) return [];
    return isLooseBrick(a)
      ? [`${who} is holding this`]
      : [`${who} carries this`, inline('', 'use', ' fast: tug it away')];
  }
  const brick = a.grid.bricks.get(o.brickId);
  if (!brick) return [];
  if (BRICK_TYPES[brick.type].fixture) {
    if (g.sim.carrying.heavyFor(p)) {
      return a.anchored
        ? [does('carefulUse', 'lift the heavy build (slowly, or wear the back brace)')]
        : [does('use', 'carry the build (slowly, without the back brace)')];
    }
    return [does('use', a.anchored ? 'lift the whole build off the job site' : 'carry the build')];
  }
  const named = g.colourBlind ? shapeName(brick.type) : brickName(brick.type, brick.colour);
  const name = named.charAt(0).toUpperCase() + named.slice(1);
  if (a.anchored) return [name, does('use', 'pull this brick off')];
  if (a.grid.size === 1) return [name, does('use', 'pick up')];
  return [name, does('use', 'carry build'), does('pull', 'pull this brick off')];
}
