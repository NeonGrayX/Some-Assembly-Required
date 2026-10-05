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

- [x] Target build format (`shared/src/builds/`) and a validator that checks every step can be built in order
- [x] The lighthouse: 32 bricks in 8 steps, interlocking red and white tower layers
- [x] Page renderer: isometric render of step N with earlier bricks faded and new bricks outlined, parts list, page number, stamp, watermark
- [x] Page as a carryable world item (one per pocket), page reading UI
- [x] `matchBuild(target, actual)` → per-brick correct/close/wrong/missing/extra (unit tested)
- [x] Inspector station: a per-step verdict display. The baseplate can be lifted off the job site, carried over, set down gently and scanned; put back on the job site it locks into place again
- [x] Results screen: side-by-side turntable with highlights
- [x] Simple build editor tool (place bricks, assign steps, export JSON) at `/editor.html`

Decisions made while building it:

- The baseplate has a yellow stripe and arrow on its front edge, shown on every page. The plate is square, so without it a build could be made a quarter turn off.
- Builds pass at 95% bricks exactly right (31 of 32 for the lighthouse) and at most one stray brick. One look-alike swap is survivable, two are not.
- Done has to be pressed twice within 3 seconds, so a stray click does not end the round.
- Dropping a carried build lowers it to the ground first. Throwing it is still possible.

**Done when:** one player can find pages, build the lighthouse, inspect it and see a result screen.

## M3: Multiplayer core (2 weeks) ⚠️ second biggest risk

- [x] Protocol definitions in `shared/src/net/protocol.ts` (messages, MessagePack codec with float32 numbers)
- [x] Rooms: create, join by 4-letter code or link, lobby with names and colours, ready-up, host picks the round length
- [x] Server-authoritative Rapier world. Runs at 60 Hz (the same step as single player), snapshots at 20 Hz
- [x] Snapshots of bodies that moved, plus reliable messages for structure changes (bricks snapped, builds broken, pages pocketed) and sound events
- [x] Client: interpolation of remote things 100 ms behind, prediction of own movement with error correction
- [x] Networked grab, carry, snap and break (the server runs every action; clients only send intent)
- [x] Join in progress and reconnect: a dropped player keeps their spot for 30 s, a reload rejoins as the same player
- [x] Simulated latency for testing: add `?lag=150` to the URL (packet loss does not apply, WebSockets are reliable)
- [x] Bot clients: `npm run bots -w @sar/server -- [CODE] --count 8 --start`

How it is built:

- `Room` (`shared/src/net/room.ts`) is the whole authoritative game for one lobby and only talks through a `send` callback. The Node server wraps it with WebSockets; **Play solo** runs the same `Room` inside the browser tab, so solo needs no server.
- Clients keep a replica of the world (`Sim` in replica mode): bricks and pages are kinematic bodies posed from snapshots, so aiming, the snap ghost and walking into things work locally.
- Own movement is predicted with the same character controller as the server. Each snapshot says which input the server applied last; the client compares its prediction at that input with the server's position and shifts by the difference. Prediction errors measured in testing were under 1 mm.
- An action carries the number of the movement input it was made after, and the server waits until it has applied that input, so it aims from the position the player saw.
- Your own held brick is drawn at your hands right away instead of waiting for the server.

Measured: 8 bots in one room during a round cost 1.3 ms per 16.7 ms tick on the test machine, about 8% of one core.

**Done when:** 4+ people in different browsers can build together with 100 ms of simulated lag, and it feels OK.

## M4: Round loop and social deduction (1–2 weeks)

- [x] Phase flow: lobby → role reveal → building ⇄ Brick Meeting → results → lobby
- [x] Role assignment (1 saboteur for 3–6 players, 2 from 7, host can override, 0 for co-op) and hidden information: each client only learns its own role (saboteurs learn each other), and saboteur tells only reach players within 6 m
- [x] Map: a house next to the yard (kitchen, living room, break room, a walkable roof reached by a ladder) with 29 hiding spots: 15 open surfaces and 14 closed hiding places (fridge, kitchen drawers, sofa cushion, TV cabinet, lockers, rugs, mailbox, toolbox, chest)
- [x] Page distribution into spots, the master index item (the real stamp and every page's parts list)
- [x] Rare colours: bins hold what the round's colours need plus one spare, and bins the build doesn't use get a decoy count from the same numbers; a matching brick can be put back
- [x] Show page to nearby players (B, within 5 m), pin pages on the corkboard at the job site, read any page you look at without picking it up (Q)
- [x] Brick Meeting: bell, everyone drops what they hold and gathers at the break room table, 90 s discussion and voting, sending a player home, spectator mode, 60 s penalty for an innocent
- [x] Win condition checks: builders win by handing in a correct build; saboteurs win on time, a wrong build, or two innocents sent home
- [x] Saboteur tools: forged page, brick swap, hide page, with cooldowns (60/40/45 s) and a puff-and-rustle tell for anyone within 6 m
- [x] Text chat: within 12 m while building, everyone in the lobby and meetings, and a separate channel for players sent home

Each round also recolours the model (see "Colours change every round" in the design doc), so forged colours are not obvious.

How the saboteur tools work:

- **Forge** (2): reprints the page in your pocket. One brick changes: usually a look-alike colour, which shows up against the master index's parts list; sometimes the brick moves by a stud, which only the stamp, the inspector or a sharp eye catches. The stamp becomes a near-copy (● → ◉, ★ → ✩). Forgeries always stay buildable, so they lead the team down a wrong path rather than asking for something impossible.
- **Swap** (1): the brick you aim at turns into its look-alike colour, in place.
- **Hide** (3): the page in your pocket is tucked into the closed hiding place farthest from every player.

**Done when:** the MVP is playable start to finish with friends. **First real playtest.**

## M5: LAN host package and VPS deploy (3–5 days)

- [x] Server serves the embedded client bundle
- [x] Self-signed certificate generation, HTTPS by default, `--http` flag
- [x] Print LAN IP addresses on start
- [x] `bun build --compile` (or Node SEA) for Windows, Linux and macOS in CI, attached to GitHub Releases
- [x] Dockerfile plus Caddy config plus a short VPS deploy guide

How it is built:

- **Bun** compiles the host app (`server/scripts/build-host.ts`): it cross-compiles every platform from one machine, and the built client is embedded file by file. macOS builds run on a macOS runner so they come out signed, which Apple silicon requires. Downloads are 26–40 MB compressed.
- The host app opens the game in the browser, lists the addresses friends can use (home networks first, VPNs and virtual machines after), and keeps its certificate in `~/.some-assembly-required`, made again only when the computer gets a new address.
- With HTTPS on, the same port also answers plain HTTP with a redirect, so typing the address without `https://` still works.
- `npm run smoke -w @sar/server -- <executable or URL>` starts a host (or checks a running one), loads the page and joins a room. CI runs it on the Linux build and the Docker image; releases run it on each platform's own build.
- The Docker image holds only the executable; Caddy in front gets a Let's Encrypt certificate. See the [hosting guide](06-hosting.md).

**Done when:** a non-developer friend can start the host file and others join from their browsers.

## M6: Ragdolls, comedy and remaining saboteur tools (1–2 weeks)

- [x] Client-side ragdolls (about 6 bodies), knock-down state synced
- [x] Trips: random trips while running carrying heavy things, getting hit by assemblies
- [x] Clumsy mode (saboteur)
- [x] Barefoot trap: brick trigger, scream sound effect, limp
- [x] The dog: wanders around, holds a page, can be chased or given a treat
- [x] Sound effects pass (brick clicks, crashes, bell, screams)

How it is built:

- **Knock-downs** are decided by the server: hit by an assembly of at least 5 kg moving at 3.5 m/s or more, tripping while sprinting with a build (a 1.2 % chance per second per kg it weighs), or landing faster than 8.5 m/s (jumping off the roof). The player drops what they carry, which keeps flying, slides a little and lies there for 2.5 s. Snapshots carry each player's down and limp timers and a knock counter; clients start one ragdoll per knock.
- **Players** are little builders (torso, head with visor and hard hat, arms, legs) whose limbs swing as they walk. The ragdoll is those parts as 6 bodies joined at the neck, shoulders and hips, in the client's copy of the world and colliding only with the level; the hard hat flies off on its own.
- **Clumsy mode** (4) is a knock-down like any other, plus a shove to whatever is within a metre in front: loose builds fly, and the job-site build takes a knock that breaks its weaker joints. Two charges a round, 30 s apart, and no tell beyond the trip.
- **Barefoot trap** (5) spills three small bricks. Anyone walking onto a loose brick lying on the floor (anyone's, not only a trap's) screams and limps for 10 s at under half speed; sprinting onto one knocks them over too.
- **The dog** walks a hand-placed network of points through the yard and house (a test sweeps its body along every link), routes through the network to anything it cannot walk straight to, fetches pages lying on the floor, runs from sprinters (4.6 m/s, slower than a sprint) and drops its page when clicked. The treat jar in the kitchen hands out treats: the dog begs from whoever holds one, and feeding it makes it drop its page at their feet and follow them for 20 s.
- **Sounds** are synthesised like the others: a two-formant scream with a different pitch per player, a grunt and thud for falls, barks, a yelp and a biscuit crunch. The voice-chat scream boost waits for M7.

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
