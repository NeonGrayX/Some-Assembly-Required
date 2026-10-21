# Some Assembly Required

A browser-based multiplayer building game with a hidden saboteur.

The team gets a target model (a lighthouse, a rocket, a giant duck) and a timer. The instruction pages are scattered around the map and the bricks come out of a little brick works: a mould from the mould dispenser and a bucket of coloured pellets from the silo go into a moulding machine, and a UV printer prints the pictures on printed parts. One player is secretly the saboteur. They try to make the build fail or come out wrong without getting caught.

**Status:** M0 to M7 are implemented: the full social deduction loop is playable in a house and yard. A room gets secret roles; builders hunt for the instruction pages and the master index (on surfaces, in drawers, under rugs, up on the roof), build this round's model (one of twenty-two, from a lighthouse on its islet or a giant duck in its pond up to a castle that fills the whole baseplate, and a manga shop, an izakaya, a fire station, a diner, a pagoda, a clock tower, a café, an ice cream shop, a treehouse, a pirate ship, an observatory and a train station of real tiles, slopes, windows and printed signs) in this round's colours and check it at the inspector, while the saboteur forges pages, swaps bricks, hides pages, trips into the build on purpose and leaves bricks on the floor to step on, and jams the machines or cuts the power (no power, no brick works). Players, each a toy mechanic with their colour lit across the visor, ragdoll when they trip or get hit (the cap flies off), and the house dog runs off with pages unless someone catches it or bribes it with a treat. Anyone can ring the bell for a Brick Meeting in the break room and vote someone off the job site. A blind build mode gives one reader the pages and nobody else; rival teams mode races two teams in two yards for the most accurate build; and four maps to play on (the house, a builders' merchant, a country station with a sleeper train, and a lakeside camp), each laid out anew every round. **Gear Hunt** is the co-op mode without saboteurs: the site starts in trouble (grey bricks and manuals, litter on the floors, a dark house, padlocked cupboards, a loose dog, a build too heavy to carry) and one piece of gear per trouble is hidden in the map; everything can be worn at once, so it works alone too ([design](docs/08-gear-hunt-mode.md)). **Free build** has no plans, no clock and no score: build whatever you like on the baseplate and export it as a [build file](docs/07-build-file-format.md#files-from-a-free-build), to play it as a round or finish it in the build editor. Proximity voice chat lets nearby players talk (muffled through walls, everyone together in meetings). A single-file host app for Windows, macOS and Linux runs a game on your network, and a Docker setup runs it on a VPS ([hosting guide](docs/06-hosting.md)). Next: content and variants (M8). See the [roadmap](docs/04-roadmap.md).

## Running it

Requires Node.js 22 or newer.

```sh
npm install
npm run dev        # game server on :7777 plus the Vite dev server on http://localhost:5173
```

Open http://localhost:5173, enter a name and **Create a room**. Friends open the same address with the room code (or the link from **Copy link**) and join. **Play solo** starts a game of your own that never shows in the room list, though friends can still join with its code or link; without a server it runs in the browser tab instead. Open the build editor with **Build editor** on the main menu (or go straight to http://localhost:5173/#editor). **Shared builds** on the main menu is the community page: players share build files, like and comment on them, download them, and play them in demo mode with **Play it**. Every build that comes with the game is on it too. The way around is the same on every screen. The bar in the top right corner has **Settings** and, in the corner itself, the way back: **Back** on the pages off the main menu (the room list, shared builds, the benchmark's pages; Esc does the same) and **Main menu** in a game or the editor. In a game, press Esc to bring the bar up. A game's panels (the lobby or demo mode's choices, and How to play) are tabs in one dock on the left, under the box art, and fold away with the arrow beside the tabs; questions that need an answer (Settings, a meeting's vote, the results) open in the middle. During a round the host also has **End round**, which (on a second click) ends it for everyone and takes the room back to the lobby to start a new one.

To host for real (one process serving everything, the way a LAN host or a VPS would):

```sh
npm run build
npm start          # http://localhost:7777, and the LAN address printed in the console
```

Everyone else on the network opens the printed `http://192.168.x.x:7777` address in their browser. Without a development setup, use the host app instead: one download, no install. See the [hosting guide](docs/06-hosting.md) for that and for running it on a VPS.

`./serve.sh` does the same in one step on this app's own port, http://localhost:4380, so it can run next to the other arrow-lab.de apps. `./deploy.sh` releases a new version to https://sar.arrow-lab.de (see [DEPLOYMENT.md](DEPLOYMENT.md)).

**Bots**: the host can add computer players in the lobby (Add a bot, Fill with bots), at four levels from Easy to Expert, and choose whether they take either side, the saboteurs' or the builders'. They finish builds, hunt pages, run the brick works, feed the dog, sabotage and vote, and answer in the text chat (who they suspect and why, where a page is, "feed the dog", "come here"). `npm run bot-games -w @sar/server -- --games 40 --level normal` plays rounds between bots only and prints who won ([bots](docs/09-bots.md)).

Testing helpers: add `?lag=150` to the URL to simulate a slow connection, and `npm run bots -w @sar/server -- CODE --count 6` sends wandering bots into room CODE.

**Benchmark** on the main menu (or `?bench` in the address) opens its setup, with two kinds of run. The frame-rate run uses the maps and graphics you tick and pick there, and hands the game to a bot that plays each map for about five minutes: walking and sprinting, looking round in first and third person, picking up, throwing and placing bricks, reading pages, opening hiding places, running the brick works, patting the dog, sweeping, pulling bricks off the finished model, a night with a power cut, and a crowd of ten players who all fall over at once. Every frame is recorded, with everything the performance panel (click the fps counter) tracks: each of its parts (physics, game logic, scene update, lighting, rendering, the solo server and what is outside the game), the graphics card's time pass by pass where the browser reports it, physics steps, shader compiles and new textures or geometry, and what the renderer holds on the graphics card. Work done once is kept too: the loading screen's steps, shaders compiled ahead of drawing, and the big painted textures (painted, read back from the browser, or shared). Afterwards it shows the frame rate, frame time, where the frame went, the graphics card, draw calls, triangles and memory over the run, phase by phase and part by part, and saves it all as JSON or CSV. It is the same run every time: the maps are laid out the same way, the bot plays the same script, and your mouse, keys and touches are ignored while it plays, so runs compare. Esc stops it early.

The other run, **bots against bots**, plays whole rounds with only bots in them, with nothing drawn. You pick the mode (saboteur, blind build or plain co-op), the maps, the round length, how many rounds, and each bot's level and role (a saboteur, a builder or dealt at random). Rounds run in the background on every core but one, each as fast as its core can play it, and the page says how many times faster than real time that was. The page fills in as they finish: how often each side won, how long the build took, how much of it was right at the end, who was voted off, meetings and breaks, a win rate for each level on each side, and every round. The results save as JSON, or as CSV with one row per bot per round. The same settings play the same rounds every time.

Other commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`.

### Controls

| Key                  | Action                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| WASD, Space, Shift   | Move, jump, sprint                                                                                |
| Ctrl or Alt (hold)   | Walk carefully over loose bricks                                                                  |
| Left click           | Pick up / place                                                                                   |
| Right click          | Pull one brick off a build                                                                        |
| R                    | Rotate                                                                                            |
| Shift (hold)         | While placing: keep to the layer you are on, to overhang the brick below                          |
| G / T                | Drop / throw                                                                                      |
| V                    | First / third person                                                                              |
| Click a page         | Pocket it (one at a time)                                                                         |
| Q / X / B            | Read / drop / show it to people nearby                                                            |
| Click drawers, rugs… | Pages hide in there                                                                               |
| Click a corkboard    | Pin your page for everyone                                                                        |
| Click the baseplate  | Carry the whole build, e.g. to the inspector                                                      |
| I                    | Last inspection report                                                                            |
| Click the dog        | It drops the page it stole; a treat from the kitchen jar makes it your friend                     |
| Click the dispenser  | Pick a mould and it drops into its hatch; take it from there and put it in a moulding machine     |
| Click the silo       | Pick a colour and a bucket fills with pellets under its tap; take it, pour it into a machine      |
| Click a machine      | With a mould and pellets in it, it makes that part in that colour into its tray (a bucket: 10)    |
| Click the UV printer | Put a part on its bed, then click again to pick a print; the part comes out printed               |
| Click the vacuum     | Hold click to suck up bricks at the crosshair (10 at most); empty it at a rubbish bin (basement). |
| Click the bell       | Call a Brick Meeting (one per round)                                                              |
| Enter                | Chat (nearby only, except in meetings)                                                            |
| C (hold)             | Voice chat (nearby only, except in meetings)                                                      |
| 1 – 5                | Saboteur only: swap a brick, forge your page, trip, drop bricks, tamper with a machine or panel   |
| Click gear           | Gear Hunt only: put it on (goggles, boots, headlamp, key ring, leash, brace; wear it all)         |
| 1 – 6                | Gear Hunt only: take that piece of gear off for someone else                                      |
| F                    | Full screen (in Chrome and Edge, Ctrl+W then no longer closes the tab)                            |
| H                    | Show or hide the help panel                                                                       |

### Graphics

The world is drawn in a chunky, hand-painted cartoon look: saturated colours, broad boards with dark grooves and worn edges, rounded edges on furniture and machines, turquoise water with foam along the shore, and painted country beyond the fence.

The textures are worked out in the shaders from where each surface is in the world, so there are no image files to load (see `client/src/render/styles.ts`).

Settings → Graphics trades looks for speed; everything applies at once, so watch the fps counter (bottom left) while trying it. Presets **Low**, **Medium** (the default), **High** and **Ultra**, or set each part:

| Setting           | Options                                                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolution        | 50 % to 100 % of the screen's resolution: the biggest lever on slow graphics chips                                                                                                                                                                                                              |
| Shadows           | Off, Low, Medium, High (sharper, softer edges) or **Ray traced**: the house is traced in the shader for the sun and every lamp, exact and without leaks. The ceiling lamps shine by day too, and the faked glows under the lamps step back so their real light, shadows and corner shading show |
| Ambient occlusion | Soft shade in corners, under furniture and between bricks                                                                                                                                                                                                                                       |
| Bloom             | A soft glow round the sun, lamps and bright shine, and the frame's colours graded                                                                                                                                                                                                               |

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
| [docs/09-prop-files.md](docs/09-prop-files.md)                             | Prop model files: saving props as .glb and drawing level props from .glb files            |
| [docs/08-gear-hunt-mode.md](docs/08-gear-hunt-mode.md)                     | Gear Hunt: a co-op mode without saboteurs, where one-of-a-kind gear fixes the site        |
| [docs/09-bots.md](docs/09-bots.md)                                         | Bots: lobby settings, levels, how they play, and measured win rates                       |

## Summary

- **Platform:** desktop browser. Players install nothing and join through a link or a LAN address.
- **Stack:** TypeScript, Three.js for rendering, Rapier (WASM) for physics, and a small Node.js WebSocket server.
- **Multiplayer:** one authoritative server that runs either on a cheap VPS (1 vCPU, 1 GB RAM is plenty) or on one player's PC as a small host app that people on the LAN connect to by IP.
- **Players:** 4 to 8 per lobby.
