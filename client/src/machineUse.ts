import { MOULD_TYPES, isLooseBrick, makeableColours, shapeName } from '@sar/shared';
import type { Action, MachineState, Made, Player, Sim, Tool } from '@sar/shared';
import { does, inline } from './hints.ts';
import type { Hint } from './hints.ts';
import type { MachinePicker } from './ui/machinePicker.ts';

/**
 * Using the brick works' machines: what a click on one does when it has to ask first (the
 * picker), and the hints saying what a click on a machine, on what waits in its output area,
 * or with a mould or a bucket in hand, would do.
 */

/** What these need of a game: its simulation, and whether colours are named. */
export interface WorksGame {
  readonly sim: Sim;
  readonly colourBlind: boolean;
}

/**
 * A click (`action`, a grab or a place) on the silo, the mould dispenser or the UV printer with
 * a part on it asks what to make first: opens the picker for it instead, and returns the machine
 * it is open for (what is picked then goes as its own action); null if the click goes ahead.
 */
export function openPicker(
  g: WorksGame,
  me: Player,
  picker: MachinePicker,
  action: Action,
): MachineState | null {
  if (action.kind !== 'grab' && action.kind !== 'place') return null;
  if (g.sim.vacuum.heldBy === me.id) return null;
  const hit = g.sim.sight.aim(me);
  if (hit?.owner.kind !== 'machine' || !g.sim.mayUse(me, hit.point)) return null;
  const m = g.sim.machines.get(hit.owner.machineId);
  // A jammed machine only takes a click to clear it; one without power makes nothing to pick,
  // and nor does one still making something or with its output area full.
  if (!m || m.jammed || !g.sim.working.machinesPowered) return null;
  const busy = m.making !== null || !m.out.includes(null);
  // What the silo and the dispenser make waits in their output areas, so the hands may be full.
  if (m.def.kind === 'silo' && !busy) {
    picker.openColours(makeableColours(), g.colourBlind);
    return m;
  }
  // With a mould in hand, a click puts it back.
  if (m.def.kind === 'dispenser' && me.tool?.kind !== 'mould' && !busy) {
    picker.openMoulds(MOULD_TYPES);
    return m;
  }
  if (m.def.kind === 'printer' && m.part && !me.tool && !me.holding) {
    const type = m.part.type;
    const jobs = g.sim.printJobs
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => job.type === type);
    picker.openPrints(type, jobs, g.sim.level.svgs ?? {});
    return m;
  }
  return null;
}

/** What to do with the mould or the bucket of pellets in hand. */
export function toolHint(g: WorksGame, tool: Tool): Hint {
  if (tool.kind === 'mould') {
    return [
      inline(`Your ${shapeName(tool.type)} mould: `, 'click', ' a moulding machine to put it in'),
      does('drop', 'put it away'),
    ];
  }
  const what = g.colourBlind ? 'pellets' : `${tool.colour.replaceAll('-', ' ')} pellets`;
  return [
    inline(`A bucket of ${what}: `, 'click', ' a moulding machine to pour them in'),
    does('drop', 'put it away'),
  ];
}

/** What a click on one of the brick works' machines would do. */
export function machineHint(g: WorksGame, p: Player, m: MachineState): Hint {
  const colour = (c: string) => (g.colourBlind ? '' : `${c.replaceAll('-', ' ')} `);
  if (m.jammed) {
    if (m.fixer !== null) return [`Someone is clearing the jam`];
    return [inline('Jammed, it makes nothing. ', 'use', ': clear the jam (stay here)')];
  }
  if (!g.sim.working.machinesPowered) {
    return ['No power: the machines are dead until someone fixes the electrical panel'];
  }
  const making = m.making?.made;
  const full = !m.out.includes(null);
  if (m.def.kind === 'silo') {
    if (making?.kind === 'bucket') {
      return [`Pellet silo: filling a bucket with ${colour(making.colour)}pellets…`];
    }
    if (full) return ['Pellet silo. Take the bucket from under its tap to fill another'];
    return [does('use', 'fill a bucket with pellets of any colour')];
  }
  if (m.def.kind === 'dispenser') {
    if (p.tool?.kind === 'mould')
      return [does('use', `put the ${shapeName(p.tool.type)} mould back`)];
    if (making?.kind === 'mould') {
      return [`Mould dispenser: dropping a ${shapeName(making.type)} mould in its hatch…`];
    }
    if (full) return ['Mould dispenser. Take the mould from its hatch to get another'];
    return [does('use', 'pick a mould to take to a moulding machine')];
  }
  if (m.def.kind === 'printer') {
    const part = m.part;
    if (part) {
      const name = `${colour(part.colour)}${shapeName(part.type)}`;
      if (p.holding || p.tool)
        return [`UV printer, with a ${name} on its bed. Your hands are full`];
      return [does('use', `pick a print for the ${name} on the bed, or take it out`)];
    }
    const held = p.holding ? g.sim.assemblies.get(p.holding.assemblyId) : undefined;
    if (held && isLooseBrick(held)) return [does('use', "put the part on the UV printer's bed")];
    return ['UV printer: put a part on its bed to print a picture on it'];
  }
  const loaded = m.mould ? `${shapeName(m.mould)} mould` : 'no mould';
  const pellets = m.colour ? `${colour(m.colour)}pellets for ${m.shots}` : 'no pellets';
  if (p.tool?.kind === 'mould') {
    return [does('use', `put your ${shapeName(p.tool.type)} mould in (it has ${loaded})`)];
  }
  if (p.tool?.kind === 'bucket') {
    return [does('use', `pour your ${colour(p.tool.colour)}pellets in (it has ${pellets})`)];
  }
  if (making?.kind === 'part') {
    return [`Moulding machine: making a ${colour(making.colour)}${shapeName(making.type)}…`];
  }
  if (full) return ['Moulding machine: its tray is full. Take the parts out to make more'];
  if (!m.mould) return ['Moulding machine: bring it a mould from the mould dispenser'];
  if (!m.colour) return [`Moulding machine with a ${loaded}: bring it pellets from the silo`];
  return [
    does('use', `make a ${colour(m.colour)}${shapeName(m.mould)} (pellets for ${m.shots} more)`),
  ];
}

/** What a click on something waiting in a machine's output area would do. */
export function outputHint(g: WorksGame, p: Player, made: Made): Hint {
  const colour = (c: string) => (g.colourBlind ? '' : `${c.replaceAll('-', ' ')} `);
  const carrying = p.holding !== null || g.sim.vacuum.heldBy === p.id;
  if (made.kind === 'part') {
    const name = `${colour(made.colour)}${shapeName(made.type)}`;
    if (carrying || p.tool) return [`A ${name}. Your hands are full`];
    return [does('use', `take the ${name}`)];
  }
  const name =
    made.kind === 'mould'
      ? `${shapeName(made.type)} mould`
      : `bucket of ${colour(made.colour)}pellets`;
  if (carrying) return [`A ${name}. Put down what you carry to take it`];
  // A mould is swapped for the mould in hand, a bucket for the bucket.
  if (p.tool && p.tool.kind !== made.kind) return [`A ${name}. Your hands are full`];
  return [does('use', `take the ${name}${p.tool ? ' (yours is put away)' : ''}`)];
}
