import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { LIGHTHOUSE } from './builds/lighthouse.ts';
import { allBricks } from './builds/types.ts';
import { SANDBOX } from './content/sandbox.ts';
import { Round } from './round.ts';
import { Sim } from './sim/sim.ts';
import type { Player } from './sim/sim.ts';
import type { Vec3 } from './math.ts';

beforeAll(async () => {
  await RAPIER.init();
});

function setup() {
  const sim = new Sim(RAPIER, SANDBOX);
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
  it('hides one page per step and the master index', () => {
    const { sim } = setup();
    expect([...sim.pages.values()].map((p) => p.step).sort()).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('lets a player pocket a page and drop it again', () => {
    const { sim, p, run } = setup();
    const page = [...sim.pages.values()][0]!;
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
    const b = SANDBOX.doneButton;
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
    const b = SANDBOX.doneButton;
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
    const pad = SANDBOX.inspector.pos;
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
    const home = SANDBOX.baseplate;
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
});
