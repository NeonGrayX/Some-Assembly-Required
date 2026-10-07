import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { LIGHTHOUSE } from './builds/lighthouse.ts';
import { allBricks } from './builds/types.ts';
import { BASEMENT_FLOOR, HOUSE } from './content/house.ts';
import { POWER_FAILS_AFTER, Round, rankTeams } from './round.ts';
import { levelSites } from './content/house.ts';
import { rivalLevel } from './content/rival.ts';
import { matchBuild } from './builds/match.ts';
import { BrickGrid } from './grid.ts';
import { DT, REPAIR_SECONDS, Sim } from './sim/sim.ts';
import type { Player } from './sim/sim.ts';
import type { Vec3 } from './math.ts';

beforeAll(async () => {
  await RAPIER.init();
});

function setup() {
  const sim = new Sim(RAPIER, HOUSE);
  const round = new Round(sim, LIGHTHOUSE, { seconds: 60, seed: 7 });
  const p = sim.addPlayer();
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      sim.step();
      round.update();
      sim.events = [];
    }
  };
  run(30);
  return { sim, round, p, run };
}

function lookAt(sim: Sim, p: Player, standAt: Vec3, target: Vec3) {
  p.body.setTranslation({ x: standAt.x, y: 0.86, z: standAt.z }, true);
  for (let i = 0; i < 3; i++) sim.step();
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
}

describe('Round', () => {
  it('in a blind build picks one reader, who may not touch bricks and alone reads pages', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const ids = [sim.addPlayer().id, sim.addPlayer().id, sim.addPlayer().id];
    const round = new Round(sim, LIGHTHOUSE, { seed: 3, players: ids, saboteurs: 1, blind: true });
    const roles = ids.map((id) => round.role(id));
    expect(roles.filter((r) => r === 'reader')).toHaveLength(1);
    expect(roles.filter((r) => r === 'saboteur')).toHaveLength(1);
    const reader = round.reader!;
    for (const id of ids) {
      expect(sim.players.get(id)!.handsOff).toBe(id === reader);
      expect(round.canRead(id)).toBe(id === reader);
    }
    // With one builder left after the saboteur, nobody can be spared to read.
    const sim2 = new Sim(RAPIER, HOUSE);
    const two = [sim2.addPlayer().id, sim2.addPlayer().id];
    const r2 = new Round(sim2, LIGHTHOUSE, { seed: 3, players: two, saboteurs: 1, blind: true });
    expect(r2.reader).toBeNull();
    expect(two.every((id) => r2.canRead(id) && !sim2.players.get(id)!.handsOff)).toBe(true);
  });

  it('hides one page per step (two halves for paired steps) and the master index', () => {
    const { sim, round } = setup();
    const pages = [...sim.pages.values()].map((p) => p.printed!);
    expect(round.paired).toHaveLength(2);
    expect(round.paired).not.toContain(0);
    const expected = [
      -1,
      ...LIGHTHOUSE.steps.flatMap((_, i) => (round.paired.includes(i) ? [i, i] : [i])),
    ];
    expect(pages.map((p) => p.step).sort((a, b) => a - b)).toEqual(expected);
    for (const step of round.paired) {
      const halves = pages.filter((p) => p.step === step).map((p) => p.half);
      expect(halves.sort()).toEqual(['A', 'B']);
    }
    for (const p of pages) if (!round.paired.includes(p.step)) expect(p.half).toBeUndefined();
  });

  it('lets a player pocket a page and drop it again', () => {
    const { sim, p, run } = setup();
    const page = [...sim.pages.values()].find((x) => x.body)!;
    const pos = page.body!.translation();
    lookAt(sim, p, { x: pos.x, y: 0, z: pos.z + 1 }, pos);
    sim.act(p.id, { kind: 'grab' });
    expect(p.page).toBe(page.id);
    expect(page.body).toBeNull();
    sim.act(p.id, { kind: 'dropPage' });
    run(30);
    expect(p.page).toBeNull();
    expect(page.body).not.toBeNull();
  });

  it('ends the round with a score when the Done button is pressed', () => {
    const { sim, round, p, run } = setup();
    const b = HOUSE.doneButton;
    lookAt(sim, p, { x: b.x, y: 0, z: b.z + 1.2 }, { ...b, y: 0.85 });
    sim.act(p.id, { kind: 'grab' });
    run(1);
    // The first press only asks for confirmation.
    expect(round.phase).toBe('building');
    expect(round.doneArmed).toBe(true);
    sim.act(p.id, { kind: 'grab' });
    run(1);
    expect(round.phase).toBe('results');
    expect(round.endReason).toBe('done');
    expect(round.result?.counts.missing).toBe(32);
    expect(round.result?.passed).toBe(false);
  });

  it('forgets a single press of Done after a few seconds', () => {
    const { sim, round, p, run } = setup();
    const b = HOUSE.doneButton;
    lookAt(sim, p, { x: b.x, y: 0, z: b.z + 1.2 }, { ...b, y: 0.85 });
    sim.act(p.id, { kind: 'grab' });
    run(60 * 4);
    expect(round.doneArmed).toBe(false);
    sim.act(p.id, { kind: 'grab' });
    run(1);
    expect(round.phase).toBe('building');
  });

  it('ends the round when time runs out', () => {
    const { round, run } = setup();
    run(60 * 61);
    expect(round.endReason).toBe('time');
  });

  it('scans a build carried to the inspector, then re-anchors it back home', () => {
    const { sim, round, p, run } = setup();
    // Put the first step on the baseplate directly.
    const build = sim.build();
    sim.addBricks(build, LIGHTHOUSE.steps[0]!.bricks);
    const centre = sim.buildCentre();
    lookAt(
      sim,
      p,
      { x: centre.x, y: 0, z: centre.z + 1.4 },
      { x: centre.x, y: 0.04, z: centre.z + 0.7 },
    );
    sim.act(p.id, { kind: 'grab' });
    expect(build.heldBy).toBe(p.id);
    expect(build.anchored).toBe(false);

    // Walk it over to the inspector (teleporting both), then set it down gently.
    const pad = HOUSE.inspector.pos;
    p.body.setTranslation({ x: pad.x, y: 0.86, z: pad.z + 1.6 }, true);
    build.body.setTranslation({ x: pad.x - 0.8, y: 0.6, z: pad.z - 0.8 }, true);
    p.input.yaw = 0;
    p.input.pitch = 0;
    run(30);
    sim.act(p.id, { kind: 'drop' });
    run(120);
    expect(build.heldBy).toBeNull();
    expect(build.grid.size).toBe(1 + LIGHTHOUSE.steps[0]!.bricks.length); // survived
    expect(round.buildOnInspector()).toBe(true);
    run(60 * 5);
    expect(round.inspector.status).toBe('done');
    const report = round.inspector.report!;
    expect(report.steps.slice(0, 2).map((s) => s.verdict)).toEqual(['correct', 'empty']);
    expect(report.correct).toBe(LIGHTHOUSE.steps[0]!.bricks.length);

    // Carry it back and put it down on the job site: it locks into place again.
    const c = sim.buildCentre();
    lookAt(sim, p, { x: c.x, y: 0, z: c.z + 1.4 }, { x: c.x, y: 0.04, z: c.z + 0.7 });
    sim.act(p.id, { kind: 'grab' });
    expect(build.heldBy).toBe(p.id);
    const home = HOUSE.baseplate;
    build.body.setTranslation({ x: home.x + 0.1, y: 0.4, z: home.z - 0.1 }, true);
    // Stand so the hands are right above the job site.
    p.body.setTranslation({ x: 0, y: 0.86, z: 1.3 }, true);
    p.input.yaw = 0;
    p.input.pitch = 0;
    run(30);
    sim.act(p.id, { kind: 'drop' });
    run(180);
    expect(build.anchored).toBe(true);
    const placed = sim.buildCentre();
    expect(placed.x).toBeCloseTo(0, 2);
    expect(placed.z).toBeCloseTo(0, 2);
    expect(round.inspector.status).toBe('idle');
    expect(allBricks(LIGHTHOUSE).length).toBe(32);
  });

  it('breaks the electrical panel four to six minutes after the power last came on', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const round = new Round(sim, LIGHTHOUSE, { seconds: 30 * 60, seed: 3 });
    const outs: number[] = [];
    let ticks = 0;
    let fixedAt = 0;
    while (outs.length < 3 && ticks < 20 * 60 * 60) {
      sim.step();
      round.update();
      ticks++;
      if (sim.events.some((e) => e.kind === 'powerOut')) {
        outs.push((ticks - fixedAt) * DT);
        expect(sim.power.on).toBe(false);
        // Nobody fixes it for a while: it stays out, and no other breakdown is counted down.
        for (let i = 0; i < 600; i++) {
          sim.step();
          round.update();
          ticks++;
        }
        expect(sim.power.on).toBe(false);
        sim.power.on = true;
        fixedAt = ticks;
      }
      sim.events = [];
    }
    expect(outs).toHaveLength(3);
    for (const t of outs) {
      expect(t).toBeGreaterThanOrEqual(POWER_FAILS_AFTER.min - 0.1);
      expect(t).toBeLessThanOrEqual(POWER_FAILS_AFTER.max + 0.1);
    }
  });

  it('gets the lights back on when someone stays at the panel to fix it', () => {
    const { sim, p, run } = setup();
    const panel = sim.panel!;
    expect(panel.y).toBeLessThan(BASEMENT_FLOOR + 2);
    sim.breakPower();
    expect(sim.power.on).toBe(false);
    // In front of it in the basement, looking at it.
    const front = HOUSE.boxes.find((b) => b.model === 'panel')!;
    const stand = { x: front.pos.x, z: front.pos.z - 0.9 };
    const look = () => {
      p.body.setTranslation({ x: stand.x, y: BASEMENT_FLOOR + 0.86, z: stand.z }, true);
      for (let i = 0; i < 3; i++) sim.step();
      const eye = sim.eye(p);
      p.input.firstPerson = true;
      p.input.yaw = Math.atan2(-(panel.x - eye.x), -(panel.z - eye.z));
      p.input.pitch = Math.atan2(panel.y - eye.y, Math.hypot(panel.x - eye.x, panel.z - eye.z));
    };
    look();
    expect(sim.aim(p)?.owner).toEqual({ kind: 'panel' });
    sim.act(p.id, { kind: 'grab' });
    expect(sim.power.fixer).toBe(p.id);
    // Walking off halfway leaves it broken.
    run(Math.round((REPAIR_SECONDS / 2) * 60));
    p.body.setTranslation({ x: 0, y: 0.86, z: 3 }, true);
    run(5);
    expect(sim.power.fixer).toBeNull();
    expect(sim.power.on).toBe(false);
    // Staying there the whole time fixes it.
    look();
    sim.act(p.id, { kind: 'grab' });
    let on = false;
    for (let i = 0; i < REPAIR_SECONDS * 60 + 5; i++) {
      sim.step();
      on ||= sim.events.some((e) => e.kind === 'powerOn');
      sim.events = [];
    }
    expect(on).toBe(true);
    expect(sim.power).toEqual({ on: true, fixer: null, progress: 0 });
  });
});

describe('rival teams', () => {
  /** A match result with so many bricks right, so many errors. */
  const outcome = (correct: number, errors: number) => {
    const grid = new BrickGrid();
    const bricks = LIGHTHOUSE.steps.flatMap((s) => s.bricks);
    let id = 1;
    for (const b of bricks.slice(0, correct)) grid.insert({ ...b, id: id++ });
    // Errors: extra bricks far off in a corner of the plate, where nothing belongs.
    for (let i = 0; i < errors; i++)
      grid.insert({ type: '1x1', colour: 'red', x: 15, y: i, z: 15, rot: 0, id: id++ });
    return matchBuild(LIGHTHOUSE, grid);
  };

  it('rank accuracy first, then fewer errors, then who handed in sooner', () => {
    // More right bricks win, however fast the other team was.
    expect(rankTeams([outcome(31, 0), outcome(32, 0)], [500, 100])).toBe(1);
    // Same right bricks: fewer errors win, however fast the other team was.
    expect(rankTeams([outcome(32, 0), outcome(32, 1)], [100, 500])).toBe(0);
    // Same accuracy: handing in earlier (more time left) wins; handing in at all beats not.
    expect(rankTeams([outcome(32, 0), outcome(32, 0)], [300, 400])).toBe(1);
    expect(rankTeams([outcome(32, 0), outcome(32, 0)], [null, 50])).toBe(1);
    // One brick right beats an empty plate, even one handed in at once.
    expect(rankTeams([outcome(1, 0), outcome(0, 0)], [null, 599])).toBe(0);
    // Nothing between them: a draw.
    expect(rankTeams([outcome(5, 1), outcome(5, 1)], [null, null])).toBeNull();
    expect(rankTeams([outcome(5, 1), outcome(5, 1)], [200, 200])).toBeNull();
  });

  it('give each team its own job site, pages and side, and lock a build once handed in', () => {
    const level = rivalLevel(HOUSE);
    const sim = new Sim(RAPIER, level);
    const red = sim.addPlayer({ spawn: levelSites(level)[0]!.spawn });
    const blue = sim.addPlayer({ spawn: levelSites(level)[1]!.spawn });
    const round = new Round(sim, LIGHTHOUSE, {
      seconds: 60,
      seed: 7,
      players: [red.id, blue.id],
      rival: true,
      teams: new Map([
        [red.id, 0],
        [blue.id, 1],
      ]),
    });
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        sim.step();
        round.update();
        sim.events = [];
      }
    };
    run(30);
    expect(round.role(red.id)).toBe('builder');
    expect(round.role(blue.id)).toBe('builder');
    expect(red.team).toBe(0);
    expect(blue.team).toBe(1);
    expect(sim.buildIds).toHaveLength(2);
    // A full set of pages on each side.
    const pages = [...sim.pages.values()];
    const perSide = [0, 1].map(
      (side) =>
        pages.filter((p) => {
          const h =
            p.hideout !== null ? sim.hideouts.get(p.hideout)!.def.pos : p.body!.translation();
          return sim.sideOf(h) === side;
        }).length,
    );
    expect(perSide[0]).toBe(perSide[1]);
    expect(perSide[0]! + perSide[1]!).toBe(pages.length);
    expect(perSide[0]).toBe(LIGHTHOUSE.steps.length + round.paired.length + 1);
    // No meetings in a race.
    expect(round.callMeeting(red.id)).toBe(false);

    // Blue hands in an empty plate: twice on their own Done button.
    const done1 = levelSites(level)[1]!.doneButton;
    lookAt(sim, blue, { x: done1.x, y: 0, z: done1.z + 1.2 }, { ...done1, y: 0.85 });
    sim.act(blue.id, { kind: 'grab' });
    run(1);
    expect(round.doneArmedFor(1)).toBe(true);
    expect(round.doneArmedFor(0)).toBe(false);
    sim.act(blue.id, { kind: 'grab' });
    run(1);
    expect(round.phase).toBe('building');
    expect(round.finished[1]).not.toBeNull();
    expect(sim.build(1).frozen).toBe(true);
    // Red may walk over to Blue's yard, but cannot take from Blue's bins; its own twin works.
    const blueBin = level.bins.find((x) => sim.sideOf(x.pos) === 1)!;
    lookAt(
      sim,
      red,
      { x: blueBin.pos.x, y: 0, z: blueBin.pos.z - 1.4 },
      { ...blueBin.pos, y: 0.6 },
    );
    sim.act(red.id, { kind: 'grab' });
    expect(red.holding).toBeNull();
    const redBin = level.bins.find((x) => x.id === blueBin.id - 1000)!;
    lookAt(sim, red, { x: redBin.pos.x, y: 0, z: redBin.pos.z + 1.4 }, { ...redBin.pos, y: 0.6 });
    sim.act(red.id, { kind: 'grab' });
    expect(red.holding).not.toBeNull();
    sim.dropHeld(red);
    run(5);

    // Red puts one brick right and hands in: one right brick beats an empty plate.
    sim.addBricks(sim.build(0), [LIGHTHOUSE.steps[0]!.bricks[0]!]);
    const done0 = levelSites(level)[0]!.doneButton;
    lookAt(sim, red, { x: done0.x, y: 0, z: done0.z + 1.2 }, { ...done0, y: 0.85 });
    sim.act(red.id, { kind: 'grab' });
    run(1);
    sim.act(red.id, { kind: 'grab' });
    run(1);
    expect(round.phase).toBe('results');
    expect(round.winner).toBe('red');
    expect(round.teamResults[0]!.counts.correct).toBe(1);
    expect(round.teamResults[1]!.counts.correct).toBe(0);
  });

  it('end the race as soon as a team hands in a perfect build', () => {
    const level = rivalLevel(HOUSE);
    const sim = new Sim(RAPIER, level);
    const red = sim.addPlayer({ spawn: levelSites(level)[0]!.spawn });
    const blue = sim.addPlayer({ spawn: levelSites(level)[1]!.spawn });
    const round = new Round(sim, LIGHTHOUSE, {
      seconds: 60,
      seed: 8,
      players: [red.id, blue.id],
      rival: true,
      teams: new Map([
        [red.id, 0],
        [blue.id, 1],
      ]),
    });
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        sim.step();
        round.update();
        sim.events = [];
      }
    };
    run(30);
    sim.finishBuild(round.target, 1);
    const done1 = levelSites(level)[1]!.doneButton;
    lookAt(sim, blue, { x: done1.x, y: 0, z: done1.z + 1.2 }, { ...done1, y: 0.85 });
    sim.act(blue.id, { kind: 'grab' });
    run(1);
    sim.act(blue.id, { kind: 'grab' });
    run(1);
    expect(round.phase).toBe('results');
    expect(round.winner).toBe('blue');
    expect(round.teamResults[1]!.passed).toBe(true);
    expect(round.finished[0]).toBeNull();
  });
});
