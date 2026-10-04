# 04: Roadmap

Each milestone ends in something you can run and try. The order goes after the biggest unknowns first: building feel, then networking, then the social layer.

Rough time estimates assume one developer working part-time. They are guesses for planning, not commitments.

---

## M0: Project setup (1–2 days)

- [x] npm workspaces: `client`, `server`, `shared`
- [x] TypeScript strict config, ESLint and Prettier, Vitest
- [x] Vite client showing a Three.js scene with a floor and a light
- [x] Node server serving the client build plus a `/ws` echo endpoint
- [x] GitHub Actions: lint, typecheck, test
- [x] `npm run dev` starts both client and server

**Done when:** one command opens a browser with a 3D scene that is connected to the server.

## M1: Brick sandbox, single player (1–2 weeks) ⚠️ most important

- [x] Brick catalogue in `shared/` (about 8 types, about 10 colours, near-miss tables)
- [x] Procedural brick geometry (box + studs). One mesh per brick for now; switch to instancing if draw calls become a problem
- [x] Rapier world: floor, loose bricks
- [x] Character controller: walk, jump, third-person camera
- [x] Grab, carry, drop and throw a loose brick
- [x] Snapping: ghost preview, stud grid, 90° rotation, attach to baseplate or assembly
- [x] Assembly model: compound rigid body plus connection graph plus stud occupancy map
- [x] Pick up and carry an assembly with a spring grip (wobble)
- [x] Breaking: impulse threshold → split the graph into new assemblies
- [x] Brick bins that hand out bricks

Breaking uses the sudden change in velocity during a physics step rather than raw contact impulses, so a resting tower never breaks under its own weight. Thresholds live in `shared/src/breaking.ts`.

**Done when:** you can build a small tower by hand in the browser, carry it, and watch it break when you bump into a wall. **If this does not feel fun, stop and rethink before going on.**

## M2: Builds, pages, matching (1 week)

- [ ] Target build JSON format and loader
- [ ] Hand-write the lighthouse (about 40 bricks, 8 steps)
- [ ] Page renderer: isometric render-to-texture of step N with new bricks highlighted, parts list, page number, stamp, watermark
- [ ] Page as a carryable world item, page reading UI
- [ ] `matchBuild(target, actual)` → per-brick correct/close/wrong/missing/extra (unit tested)
- [ ] Inspector station: a per-step verdict display
- [ ] Results screen: side-by-side turntable with highlights
- [ ] Simple build editor tool (place bricks, assign steps, export JSON)

**Done when:** one player can find pages, build the lighthouse, inspect it and see a result screen.

## M3: Multiplayer core (2 weeks) ⚠️ second biggest risk

- [ ] Protocol definitions in `shared/` (messages, MessagePack codec)
- [ ] Rooms: create, join by code, lobby with names, ready-up, host settings
- [ ] Server-authoritative Rapier world, 30 Hz tick
- [ ] Snapshots of awake bodies plus reliable events for snaps and breaks
- [ ] Client: interpolation of remote entities, prediction plus reconciliation of own movement
- [ ] Networked grab, carry, snap and break (validation on the server)
- [ ] Join in progress or reconnect (resend full state)
- [ ] Simulated latency and packet-loss toggle for testing
- [ ] Bot clients (headless, random walk and grab) for load testing

**Done when:** 4+ people in different browsers can build together with 100 ms of simulated lag, and it feels OK.

## M4: Round loop and social deduction (1–2 weeks)

- [ ] Phase state machine: lobby → reveal → build → meeting → results
- [ ] Role assignment and per-client visibility filter (hidden-information rules)
- [ ] Map: a first blockout of the house and yard with 25+ hiding spots, interactable drawers, rugs, a ladder and a fridge
- [ ] Page distribution into spots, the master index item
- [ ] Rare colours: bin stock limits
- [ ] Show page to nearby players, post page on the board
- [ ] Brick Meeting: bell, teleport to the break room, discussion timer, voting UI, sending a player home, spectator mode, penalty for an innocent
- [ ] Win condition checks, the "Done" vote
- [ ] Saboteur tools: forged page, brick swap, hide page, with cooldowns and witness animations
- [ ] Text chat (proximity and global during meetings)

**Done when:** the MVP is playable start to finish with friends. **First real playtest.**

## M5: LAN host package and VPS deploy (3–5 days)

- [ ] Server serves the embedded client bundle
- [ ] Self-signed certificate generation, HTTPS by default, `--http` flag
- [ ] Print LAN IP addresses on start
- [ ] `bun build --compile` (or Node SEA) for Windows, Linux and macOS in CI, attached to GitHub Releases
- [ ] Dockerfile plus Caddy config plus a short VPS deploy guide

**Done when:** a non-developer friend can start the host file and others join from their browsers.

## M6: Ragdolls, comedy and remaining saboteur tools (1–2 weeks)

- [ ] Client-side ragdolls (about 6 bodies), knock-down state synced
- [ ] Trips: random trips while running carrying heavy things, getting hit by assemblies
- [ ] Clumsy mode (saboteur)
- [ ] Barefoot trap: brick trigger, scream sound effect, limp
- [ ] The dog: wanders around, holds a page, can be chased or given a treat
- [ ] Sound effects pass (brick clicks, crashes, bell, screams)

## M7: Proximity voice (1 week)

- [ ] WebRTC mesh signalled over the game WebSocket
- [ ] Distance-based volume and panning, wall muffling
- [ ] Global voice in meetings, mute and push-to-talk settings
- [ ] Scream boost when stepping on a brick
- [ ] STUN config, optional TURN (coturn) for the VPS

## M8: Content and variants (ongoing)

- [ ] More builds: rocket, giant duck
- [ ] Paired pages
- [ ] Joke builds in the lobby (catapult that launches players)
- [ ] Two saboteurs
- [ ] Blind build mode
- [ ] Rival teams mode (two job sites)
- [ ] Second map
- [ ] Art pass: proper low-poly models, character customisation (hats!)

---

## Suggested first tasks once implementation starts

1. M0 setup.
2. A spike on M1 snapping and assemblies, kept to a few days. This is the riskiest gameplay part.
3. Before M3, a short networking spike: two browsers, one cube each, server-authoritative with interpolation. It validates the approach before networking is built into everything.
