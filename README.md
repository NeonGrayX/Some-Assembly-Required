# Some Assembly Required

A browser-based multiplayer building game with a hidden saboteur.

The team gets a target model (a lighthouse, a rocket, a giant duck) and a timer. The instruction pages are scattered around the map and the bricks sit in bins that never run out. One player is secretly the saboteur. They try to make the build fail or come out wrong without getting caught.

**Status:** M0 to M7 are implemented: the full social deduction loop is playable in a house and yard. A room gets secret roles; builders hunt for the instruction pages and the master index (on surfaces, in drawers, under rugs, up on the roof), build this round's model (one of ten, from a lighthouse or a giant duck up to a castle that fills the whole baseplate) in this round's colours and check it at the inspector, while the saboteur forges pages, swaps bricks, hides pages, trips into the build on purpose and leaves bricks on the floor to step on. Players, each in a hat, face and shirt of their choosing, ragdoll when they trip or get hit (the hat flies off), and the house dog runs off with pages unless someone catches it or bribes it with a treat. A blind build mode gives one reader the pages and nobody else; rival teams mode races two teams in two yards for the most accurate build. Anyone can ring the bell for a Brick Meeting in the break room and vote someone off the job site. Proximity voice chat lets nearby players talk (muffled through walls, everyone together in meetings). A single-file host app for Windows, macOS and Linux runs a game on your network, and a Docker setup runs it on a VPS ([hosting guide](docs/06-hosting.md)). Next: content and variants (M8). See the [roadmap](docs/04-roadmap.md).

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

Everyone else on the network opens the printed `http://192.168.x.x:7777` address in their browser. Without a development setup, use the host app instead: one download, no install. See the [hosting guide](docs/06-hosting.md) for that and for running it on a VPS.

Testing helpers: add `?lag=150` to the URL to simulate a slow connection, and `npm run bots -w @sar/server -- CODE --count 6` sends wandering bots into room CODE.

Other commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`.

### Controls

| Key                 | Action                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| WASD, Space, Shift  | Move, jump, sprint                                                                                                    |
| Ctrl (hold)         | Walk carefully: slowly, and over loose bricks without stepping on them                                                |
| Left click or E     | Grab a brick or build, take a brick from a bin, place the held brick                                                  |
| Right click         | Pull a single brick off a build                                                                                       |
| R                   | Rotate the held brick                                                                                                 |
| G / T               | Drop / throw                                                                                                          |
| V                   | First / third person                                                                                                  |
| F                   | Full screen. In Chrome and Edge this also keeps Ctrl+W from closing the tab (hold Esc to leave)                       |
| Click a page        | Put it in your pocket (one at a time)                                                                                 |
| Q                   | Read the page you look at, or the one in your pocket                                                                  |
| X / B               | Drop your page / hold it up for everyone within 5 m                                                                   |
| Click furniture     | Open drawers, fridges, lockers, lift rugs: pages hide inside (a saboteur with a page puts it in instead)              |
| Click the corkboard | Pin your page there for everyone to read                                                                              |
| Click the baseplate | Lift the whole build, to carry it to the quality inspector                                                            |
| I                   | Show or hide the last inspection report                                                                               |
| Click the dog       | Make it drop the page it carries, or feed it a treat from the kitchen jar                                             |
| Click the broom     | It leans somewhere in the basement. Carry it; click to sweep stray bricks on the floor ahead of you, G to put it down |
| Click the bell      | Call a Brick Meeting (one per player per round)                                                                       |
| Enter               | Chat (nearby players only while building)                                                                             |
| C (hold)            | Talk on voice chat (push to talk; open mic or off in Settings). Mouse side buttons work too                           |
| 1 – 4               | Saboteur only: swap a brick, forge your page, trip into the build, drop bricks to step on                             |
| H                   | Show or hide the help panel                                                                                           |

### Graphics

Settings → Graphics trades looks for speed; everything applies at once, so watch the fps counter (bottom left) while trying it. Presets **Low**, **Medium** (the default), **High** and **Ultra**, or set each part:

| Setting           | Options                                                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolution        | 50 % to 100 % of the screen's resolution: the biggest lever on slow graphics chips                                                                                                                                                                                                              |
| Shadows           | Off, Low, Medium, High (sharper, softer edges) or **Ray traced**: the house is traced in the shader for the sun and every lamp, exact and without leaks. The ceiling lamps shine by day too, and the faked glows under the lamps step back so their real light, shadows and corner shading show |
| Ambient occlusion | Soft shade in corners, under furniture and between bricks                                                                                                                                                                                                                                       |

Browsers give no access to ray tracing hardware, so the ray traced shadows run in the ordinary shaders against a bounding volume hierarchy of the house ([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)); things that move keep a shadow map. A gaming graphics card handles it easily, a laptop's built-in one may not.

### Code layout

| Folder    | Contents                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/` | Brick catalogue, grid and snapping rules, break logic, the Rapier simulation, target builds and matching, the round rules (timer, pages, inspector), and the multiplayer room and protocol. No rendering, so the server runs it |
| `client/` | Vite + Three.js app: rendering, instruction page printing, input, HUD, results screen, sound effects, build editor                                                                                                              |
| `server/` | Server: serves the client and runs the rooms over WebSockets (HTTPS with a self-signed certificate on request), the host app build, smoke test and load-test bots                                                               |
| `docs/`   | Design and planning documents                                                                                                                                                                                                   |

## Documents

| Doc                                                                        | Contents                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [docs/01-feasibility.md](docs/01-feasibility.md)                           | Can this run in a browser? What is hard, and how we get around it                         |
| [docs/02-game-design.md](docs/02-game-design.md)                           | Rules, roles, round flow, saboteur tools, counterplay, and what goes in the MVP           |
| [docs/03-architecture.md](docs/03-architecture.md)                         | Tech stack, networking, hosting (VPS or LAN host), physics, voice chat, data formats      |
| [docs/04-roadmap.md](docs/04-roadmap.md)                                   | Milestones and tasks, from an empty repo to a playable vertical slice and beyond          |
| [docs/05-risks-and-open-questions.md](docs/05-risks-and-open-questions.md) | Known risks, mitigations, and decisions that are still open                               |
| [docs/08-maps.md](docs/08-maps.md)                                         | Three more map themes, with what each rearranges every round and the engine work it needs |
| [docs/06-hosting.md](docs/06-hosting.md)                                   | Running a game: the host app on a LAN, from source, or on a VPS                           |
| [docs/07-build-file-format.md](docs/07-build-file-format.md)               | Build files: exporting and importing a model with its instruction manual                  |

## Summary

- **Platform:** desktop browser. Players install nothing and join through a link or a LAN address.
- **Stack:** TypeScript, Three.js for rendering, Rapier (WASM) for physics, and a small Node.js WebSocket server.
- **Multiplayer:** one authoritative server that runs either on a cheap VPS (1 vCPU, 1 GB RAM is plenty) or on one player's PC as a small host app that people on the LAN connect to by IP.
- **Players:** 4 to 8 per lobby.
