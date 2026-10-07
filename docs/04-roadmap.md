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
- [x] Bins never run out, so players can use as many bricks as they like; past 200 bricks lying loose, the longest-lying one is tidied away; a matching brick can be put back
- [x] Show page to nearby players (B, within 5 m), pin pages on the corkboard at the job site, read any page you look at without picking it up (Q)
- [x] Brick Meeting: bell, everyone drops what they hold and gathers at the break room table, 90 s discussion and voting, sending a player home, spectator mode, 60 s penalty for an innocent
- [x] Win condition checks: builders win by handing in a correct build; saboteurs win on time, a wrong build, or two innocents sent home
- [x] Saboteur tools: forged page, brick swap, hide page, with cooldowns (60/40 s; hiding has none since it means walking to the spot) and a puff-and-rustle tell for anyone within 6 m
- [x] Text chat: within 12 m while building, everyone in the lobby and meetings, and a separate channel for players sent home

Each round also recolours the model (see "Colours change every round" in the design doc), so forged colours are not obvious.

How the saboteur tools work:

- **Forge** (2): reprints the page in your pocket. One brick changes to a look-alike colour, which shows up against the master index's parts list; its shape and position never change, since a misplaced brick gives the page away at a glance. The stamp becomes a near-copy (● → ◉, ★ → ✩). Forgeries always stay buildable, so they lead the team down a wrong path rather than asking for something impossible.
- **Swap** (1): the brick you aim at turns into its look-alike colour, in place.
- **Hide** (click a hiding place): walk up to a hiding place with a page in your pocket and click it to put the page in and shut it. It has no key and no place in the tools list. You choose where it goes. A saboteur with a pocketed page who wants to open a hiding place instead drops the page first.

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
- **Players** are little builders (torso, head, arms, legs, hat) whose limbs swing as they walk and go hand over hand up the ladder (the avatar turns to the ladder and steps back off its plane, since the capsule is pressed to the wall with the ladder through it; snapshots carry a climbing flag so everyone sees it). The ragdoll is those parts as 6 bodies joined at the neck, shoulders and hips, in the client's copy of the world and colliding only with the level; the hat flies off on its own.
- **Clumsy mode** (3) is a knock-down like any other, plus a shove to whatever is within a metre in front: loose builds fly, and the job-site build takes a knock that breaks its weaker joints. Two charges a round, 30 s apart, and no tell beyond the trip.
- **Barefoot trap** (4) spills three small bricks. Anyone walking onto a loose brick lying on the floor (anyone's, not only a trap's) screams and limps for 10 s at under half speed; sprinting onto one knocks them over too.
- **The dog** walks a hand-placed network of points through the yard and house (a test sweeps its body along every link), routes through the network to anything it cannot walk straight to, fetches pages lying on the floor, runs from sprinters (4.6 m/s, slower than a sprint) and drops its page when clicked. The treat jar in the kitchen hands out treats: the dog begs from whoever holds one, and feeding it makes it drop its page at their feet and follow them for 20 s.
- **Sounds** are synthesised like the others: a two-formant scream with a different pitch per player, a grunt and thud for falls, barks, a yelp and a biscuit crunch. The voice-chat scream boost came with M7.

## M7: Proximity voice (1 week)

- [x] WebRTC mesh signalled over the game WebSocket
- [x] Distance-based volume and panning, wall muffling
- [x] Global voice in meetings, mute and push-to-talk settings
- [x] Scream boost when stepping on a brick
- [x] STUN config, optional TURN (coturn) for the VPS

How it is built:

- **The mesh:** every player opens a WebRTC connection to every other player in the room; the server only passes the handshake messages on (checked and rebuilt, and only to a player in the same room) and never carries audio. The player with the lower id makes the offer, so offers never cross. Each connection carries one audio channel both ways from the start, and turning the microphone on or off only swaps its track, so it never needs a new handshake. A connection that fails is restarted.
- **Hearing:** each voice goes through a low-pass filter, a gain and an HRTF panner at the speaker's head, then the master volume. Voices fall off with distance and fade to silence by 22 m. Every wall, shut door or piece of furniture on the line between the two heads (a ray against the level) takes volume and most of the highs. In the lobby, meetings and the results everyone hears everyone, centred. Players sent home only talk among themselves, but hear everyone still on site.
- **Microphone:** push to talk (hold C or a mouse side button; the default), always on, or off, plus a voice volume, in Settings. The browser asks for the microphone on the first press. It only allows a microphone over HTTPS or on localhost, which is why the host app makes its own certificate; over plain HTTP players can still listen. A HUD badge shows whether you are on air, and a speaker icon floats over whoever is talking.
- **Scream boost:** for 2.5 s after stepping on a brick, a player's voice is 2.2 times louder, carries 1.6 times as far and is muffled less by walls.
- **NAT traversal:** the server hands out STUN (Google's by default, `SAR_STUN`) and optionally TURN (`SAR_TURN_URL`, `SAR_TURN_SECRET`) with coturn's time-limited credentials, so the secret never leaves the server. The Docker setup has coturn as an optional profile ([hosting guide](06-hosting.md#voice-chat-over-the-internet)).

## M8: Content and variants (ongoing)

- [x] More builds: a rocket (33 bricks) and a giant duck (32 bricks), both 8 steps like the lighthouse; the host picks the build in the lobby or lets each round pick one at random (never the same twice in a row), with bins for all three in the yard
- [x] Even more builds: a snowman, a robot, a race car, a cottage and a Christmas tree (29 to 35 bricks, 8 pages), plus two big ones: a pyramid (98 bricks, 12 pages) and a castle that fills the whole baseplate (118 bricks, 16 pages); the master index switches to two columns for long builds
- [x] Paired pages: about a quarter of a build's steps (never the first) come as two half-pages, A showing where the bricks go without their colours and B which colours they are without where; two players have to compare them, and a saboteur with half B can lie about half A
- [x] Joke builds in the lobby: a catapult in the south of the yard. Between rounds, step into its bucket and it throws you over the bins towards the job site, two seconds in the air, to land flat on your face (the yard's ramp up to the ledge was already there)
- [x] Two saboteurs: the usual count from 7 players on, and the host can set 0, 1 or 2 in the lobby (M4's role assignment; saboteurs know each other)
- [x] Blind build mode: a lobby mode where one reader is the only one who can read the pages and the master index, and cannot touch bricks; everyone else builds from what the reader tells them
- [x] Gear Hunt co-op mode: one-of-a-kind gear (goggles, boots, headlamp, key ring, leash, back brace) instead of a saboteur, solvable alone ([design](08-gear-hunt-mode.md)). The lobby's Mode setting picks it; the demo panel too
- [x] Rival teams mode: two teams, two yards, the same model, and a race for the most accurate build. No saboteurs, no meetings. Accuracy counts first (more bricks right, then fewer errors), speed only after that, so one right brick beats an empty plate however fast. Handing in judges and locks a build; the race ends when both have handed in, the time runs out, or someone hands in a perfect build. The map is the house and yard twice, facing each other across a low garden wall with a gate: anyone may walk over, but can only act on their own side
- [x] More maps: the builders' merchant (Brick & Mortar), the sleeper train (Platform 9) and the lakeside camp, designed in [08-maps.md](08-maps.md) and picked in the lobby. Each is generated from the round's seed with hiding places placed anew and a structure whose parts rearrange (the shelving aisles and shutters, the carriage order, the jetty and the pitches), and each is checked for play by `mapProblems` and the dog sweep for every seed, alone and doubled for rival teams
- [x] Character customisation: hats! Twelve of them (hard hat, flat cap, beanie, top hat, cowboy hat, party hat, crown, chef's hat, traffic cone, propeller beanie, a 2×2 brick, or none), picked in the lobby and remembered for next time
- [x] Art pass: the builders are dressed now (a shirt in their colour under dungarees with a bib, straps and buttons, a tool belt with a pouch, work gloves, boots, and a face instead of the visor). The dog, the house, the furniture and the props were modelled with their features already
- [x] More customisation: a face (smile, grin, calm, wink, surprised, glasses, moustache, beard) and a shirt (plain, striped, a hi-vis vest, a bow tie, a scarf), picked and shared like the hat
- [x] A character designer in the lobby: your builder on a turntable with previous/next buttons for hat, face and shirt and a Surprise me button; the time to choose is after joining and before pressing ready, which settles the look

How rival teams is built:

- The level is the furnished house and yard plus a copy of it turned half round about the middle of the south fence (`shared/src/content/rival.ts`), so the yards face each other across that fence, now a low wall with a gate; the copy is a second job site (baseplate, inspector, Done button, bell, corkboard), with its own bins, hiding spots, pages and treat jar, and the dog's walks join through the gate. Every renderer builds from the level data, so the second house draws like the first. The simulation keeps one build, inspector and corkboard per site; a player's team is their side, and anything they aim at on the other side is looked at, not touched. A handed-in build is frozen: nothing goes on or comes off it.
- Teams fill up alternately as players join (Switch team in the lobby, until you are ready). The round matches each team's build when it hands in or when time runs out and ranks them: bricks right, then errors, then who handed in sooner. Everyone gets their own team's result and both teams' lines on the results sheet.

How paired pages are built:

- The round draws which steps pair up from its seed and prints two pages for each, marked A and B; both carry the step's bricks, and the page printer draws half A's bricks uncoloured with a shapes-only parts list, and half B's as the coloured parts list under a picture of the model so far. The master index still lists every step whole. Forging works on a half B like any page (one colour turned); a half A has no colours to turn, so the tool does nothing on it.

How the catapult is built:

- The level says where it stands and which way it throws; its shape is one shared constant, so the frame the simulation lets you climb, the bucket spot it checks and the model the client draws agree. Standing in the bucket while it is armed (the room arms it outside rounds) sets a player's upward speed and a carried-along velocity that lasts until they land; the hard landing is the ordinary knock-down. The thrown player's own client predicts the throw with the same check, so the flight is smooth for them; everyone else sees the arm swing and hears it from the server's event. It re-arms after three seconds.

How blind build is built:

- The lobby's Mode setting (host only) starts rounds with a reader: one of the non-saboteurs, drawn with the roles, as long as someone is left to build (alone or with one builder it is an ordinary round). Everyone is told who the reader is; the reveal and the role line say so.
- The server never sends what a page says to anyone but the reader: pages reach other clients with nothing printed on them, held-up pages are not shown to them either, and their client draws a smudged page. The reader's hands are kept off the bricks in the simulation itself (no taking from bins, pulling, placing or sweeping), while pages, hiding places, the dog, the bell and Done work as usual.

How the art pass is built:

- The builder is still a torso, a head and four limbs (a capsule and a ball each), so the walk cycle, the grip, the hats and the ragdoll see the same parts; the clothes are smaller shapes attached to those parts (`client/src/render/avatar.ts`). The bib is a slice of a slightly wider capsule, the straps arcs over the shoulders, the belt a ring; gloves and boots sit at the ends of the limbs and swing with them.
- A player's look is a hat, a face and a shirt. The catalogues (`shared/src/look.ts`) are just ids and names; the shapes are procedural like the rest of the avatar (`client/src/render/hats.ts` and `avatar.ts`): the hat built on the brow line of the head, in a darker shade of the player's colour where a knitted hat would be, the face on the front of the head, the shirt on the torso and sleeves. The server validates the ids and tells everyone through the lobby list, so the look is part of a player's identity like their name and colour, and the browser remembers it for next time. A look can only be changed in the lobby before pressing ready (the designer locks when you are ready): the avatar is rebuilt when it changes, and once ready a player's look is settled like their name.
- A knocked-over player's hat flies off and lands on its own, with a collider the size of that hat; the propeller beanie's propeller spins faster the faster its owner runs.

---

## Suggested first tasks once implementation starts

1. M0 setup.
2. A spike on M1 snapping and assemblies, kept to a few days. This is the riskiest gameplay part.
3. Before M3, a short networking spike: two browsers, one cube each, server-authoritative with interpolation. It validates the approach before networking is built into everything.
