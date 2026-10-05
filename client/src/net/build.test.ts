import RAPIER from '@dimforge/rapier3d-compat';
import { Room, decode, emptyInput, encode, length, sub } from '@sar/shared';
import type { ServerMsg } from '@sar/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from './connection.ts';
import { ClientGame } from './game.ts';

beforeAll(async () => {
  await RAPIER.init();
});

describe('the job-site build on a client', () => {
  it('lands exactly where the server puts it back on the job site', () => {
    const inbox: ServerMsg[] = [];
    const conn: Connection = {
      send: () => {},
      close: () => {},
      onMessage: () => {},
      onClose: () => {},
    };
    const room = new Room(RAPIER, {
      code: 'B',
      send: (_id, msg) => inbox.push(decode(encode(msg))),
    });
    const game = new ClientGame(RAPIER, conn);
    const joined = room.join('Pat');
    if (!('id' in joined)) throw new Error('could not join');
    const deliver = () => {
      for (const m of inbox.splice(0)) conn.onMessage(m);
    };
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        room.update();
        deliver();
        game.tick(emptyInput(), []);
      }
    };
    run(10);

    // Stand south of the baseplate, look at its near edge and lift it.
    const sim = room.sim;
    const p = sim.players.get(joined.id)!;
    const home = sim.buildCentre();
    p.body.setTranslation({ x: home.x, y: 0.86, z: home.z + 1.5 }, true);
    run(3);
    const eye = sim.eye(p);
    p.input.firstPerson = true;
    p.input.yaw = 0;
    p.input.pitch = Math.atan2(home.y - eye.y, eye.z - (home.z + 0.7));
    sim.act(p.id, { kind: 'grab' });
    const build = sim.build();
    expect(build.heldBy).toBe(p.id);
    run(60);
    sim.act(p.id, { kind: 'drop' });
    // A lone baseplate is still a build: it is lowered, not dropped.
    expect(build.heldBy).toBe(p.id);
    run(150);
    expect(build.anchored).toBe(true);

    const mine = game.sim.build();
    expect(mine.anchored).toBe(true);
    expect(length(sub(mine.body.translation(), build.body.translation()))).toBeLessThan(0.001);
  });
});
