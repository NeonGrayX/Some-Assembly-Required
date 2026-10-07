/**
 * Load-test bots: fake players that wander, grab bricks from bins and drop them.
 *
 *   npm run bots -w @sar/server -- [ROOM] [--count 6] [--url ws://localhost:7777/ws] [--start]
 *
 * Without ROOM the first bot creates a room and prints its code.
 */
import { FACES, HATS, PROTOCOL_VERSION, SHIRTS, decode, encode } from '@sar/shared';
import type { Action, ClientMsg, ServerMsg } from '@sar/shared';
import WebSocket from 'ws';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const url = opt('url', 'ws://localhost:7777/ws');
const count = Number(opt('count', '6'));
const autostart = args.includes('--start');
let room = args.find((a) => /^[A-Za-z]{4}$/.test(a))?.toUpperCase();

function bot(n: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'nodebuffer';
    const send = (msg: ClientMsg) => ws.readyState === ws.OPEN && ws.send(encode(msg));
    let me = -1;
    let seq = 0;
    let yaw = Math.random() * Math.PI * 2;
    let snaps = 0;
    // Each bot in its own hat, face and shirt, so a crowd of them shows every one.
    const look = {
      hat: HATS[n % HATS.length]!.id,
      face: FACES[n % FACES.length]!.id,
      shirt: SHIRTS[n % SHIRTS.length]!.id,
    };
    ws.on('open', () => send({ t: 'hello', v: PROTOCOL_VERSION, name: `Bot ${n}`, room, ...look }));
    ws.on('error', reject);
    ws.on('message', (data: Buffer) => {
      const msg = decode<ServerMsg>(new Uint8Array(data));
      if (msg.t === 'welcome') {
        me = msg.you;
        resolve(msg.room);
        send({ t: 'ready', ready: true });
      } else if (msg.t === 'error') {
        console.error(`bot ${n}: ${msg.message}`);
        ws.close();
      } else if (msg.t === 'lobby' && autostart && msg.host === me && msg.phase === 'lobby') {
        if (msg.players.length >= count && msg.players.every((p) => p.ready)) send({ t: 'start' });
      } else if (msg.t === 'snap') {
        snaps++;
      }
    });
    // Wander: change heading now and then, sometimes grab or drop something.
    const timer = setInterval(() => {
      if (me < 0) return;
      if (Math.random() < 0.01) yaw += (Math.random() - 0.5) * 2;
      seq++;
      send({
        t: 'input',
        seq,
        f: 1,
        r: 0,
        jump: Math.random() < 0.005,
        sprint: false,
        yaw,
        pitch: -0.4,
        fp: false,
      });
      if (Math.random() < 0.01) {
        const a: Action = {
          kind: (['grab', 'place', 'drop', 'throw', 'pull'] as const)[
            Math.floor(Math.random() * 5)
          ]!,
        };
        send({ t: 'act', a, seq, yaw, pitch: -0.4, fp: false });
      }
    }, 1000 / 60);
    ws.on('close', () => {
      clearInterval(timer);
      console.log(`bot ${n} disconnected after ${snaps} snapshots`);
    });
  });
}

room = await bot(1);
console.log(`room ${room}: ${url.replace('ws', 'http').replace('/ws', '')}/${room}`);
for (let n = 2; n <= count; n++) await bot(n);
console.log(`${count} bots running. Ctrl+C to stop.`);
