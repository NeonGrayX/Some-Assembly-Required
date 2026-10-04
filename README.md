# Some Assembly Required

A browser-based multiplayer building game with a hidden saboteur.

The team gets a target model (a lighthouse, a rocket, a giant duck) and a timer. The instruction pages are scattered around the map and the bricks sit in bins, some colours rarer than others. One player is secretly the saboteur. They try to make the build fail or come out wrong without getting caught.

**Status:** M0 to M3 are implemented. Several players can build together in a room (or alone with **Play solo**): find the hidden instruction pages, build the lighthouse, check it at the quality inspector and hand it in. The saboteur comes next; see the [roadmap](docs/04-roadmap.md).

## Running it

Requires Node.js 22 or newer.

```sh
npm install
npm run dev        # game server on :7777 plus the Vite dev server on http://localhost:5173
```

Open http://localhost:5173, enter a name and **Create a room**. Friends open the same address with the room code (or the link from **Copy link**) and join. **Play solo** works without any server. The build editor is at http://localhost:5173/editor.html.

To host for real (one process serving everything, the way a LAN host or a VPS would):

```sh
npm run build
npm start          # http://localhost:7777, and the LAN address printed in the console
```

Everyone else on the network opens the printed `http://192.168.x.x:7777` address in their browser.

Testing helpers: add `?lag=150` to the URL to simulate a slow connection, and `npm run bots -w @sar/server -- CODE --count 6` sends wandering bots into room CODE.

Other commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`.

### Controls

| Key                 | Action                                                               |
| ------------------- | -------------------------------------------------------------------- |
| WASD, Space, Shift  | Move, jump, sprint                                                   |
| Left click or E     | Grab a brick or build, take a brick from a bin, place the held brick |
| Right click         | Pull a single brick off a build                                      |
| R                   | Rotate the held brick                                                |
| G / T               | Drop / throw                                                         |
| V                   | First / third person                                                 |
| Click a page        | Put it in your pocket (one at a time)                                |
| Q / X               | Read / drop the page in your pocket                                  |
| Click the baseplate | Lift the whole build, to carry it to the quality inspector           |
| H                   | Show or hide the help panel                                          |

### Code layout

| Folder    | Contents                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/` | Brick catalogue, grid and snapping rules, break logic, the Rapier simulation, target builds and matching, the round rules (timer, pages, inspector), and the multiplayer room and protocol. No rendering, so the server runs it |
| `client/` | Vite + Three.js app: rendering, instruction page printing, input, HUD, results screen, sound effects, build editor                                                                                                              |
| `server/` | Node server: serves the built client and runs the rooms over WebSockets; load-test bots                                                                                                                                         |
| `docs/`   | Design and planning documents                                                                                                                                                                                                   |

## Documents

| Doc                                                                        | Contents                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [docs/01-feasibility.md](docs/01-feasibility.md)                           | Can this run in a browser? What is hard, and how we get around it                    |
| [docs/02-game-design.md](docs/02-game-design.md)                           | Rules, roles, round flow, saboteur tools, counterplay, and what goes in the MVP      |
| [docs/03-architecture.md](docs/03-architecture.md)                         | Tech stack, networking, hosting (VPS or LAN host), physics, voice chat, data formats |
| [docs/04-roadmap.md](docs/04-roadmap.md)                                   | Milestones and tasks, from an empty repo to a playable vertical slice and beyond     |
| [docs/05-risks-and-open-questions.md](docs/05-risks-and-open-questions.md) | Known risks, mitigations, and decisions that are still open                          |

## Summary

- **Platform:** desktop browser. Players install nothing and join through a link or a LAN address.
- **Stack:** TypeScript, Three.js for rendering, Rapier (WASM) for physics, and a small Node.js WebSocket server.
- **Multiplayer:** one authoritative server that runs either on a cheap VPS (1 vCPU, 1 GB RAM is plenty) or on one player's PC as a small host app that people on the LAN connect to by IP.
- **Players:** 4 to 8 per lobby.
